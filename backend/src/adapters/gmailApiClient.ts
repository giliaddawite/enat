import { z } from 'zod';
import {
  backoffDelayMs,
  DEFAULT_BACKOFF_POLICY,
  isRetryableStatus,
  retryWithBackoff,
  type BackoffPolicy,
  type RetrySchedule,
} from '../domain/backoff.js';
import type { GmailMessageMetadata } from '../domain/email.js';
import type {
  GmailMailboxPort,
  HistoryResult,
  InboxPage,
  MessageBodyParts,
} from '../domain/gmailSync.js';
import type { Logger } from '../logging/logger.js';

/**
 * The real `GmailMailboxPort`: plain REST against the Gmail API with the Gmail batch
 * endpoint for `messages.get`. Every response is zod-validated at this boundary; interior
 * code trusts the resulting types. 429/5xx are retried with exponential backoff + jitter
 * (domain policy, injected clock/randomness).
 *
 * Privacy: nothing in this module ever logs or embeds message content, subjects, or
 * addresses — errors and log lines carry only paths, message ids, counts and statuses.
 */

const GMAIL_API_BASE = 'https://gmail.googleapis.com';
const BATCH_PATH = '/batch/gmail/v1';
/** Fixed boundary is fine: the multipart body we *send* contains only ids we generated. */
const REQUEST_BOUNDARY = 'enat_gmail_batch';

const METADATA_QUERY =
  'format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date';
const BODY_QUERY = 'format=full';

export class GmailApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'GmailApiError';
    this.status = status;
  }
}

const MessageListResponse = z.object({
  messages: z.array(z.object({ id: z.string().min(1) })).optional(),
  nextPageToken: z.string().min(1).optional(),
});

const HistoryListResponse = z.object({
  history: z
    .array(
      z.object({
        messagesAdded: z
          .array(z.object({ message: z.object({ id: z.string().min(1) }) }))
          .optional(),
      }),
    )
    .optional(),
  historyId: z.string().min(1),
  nextPageToken: z.string().min(1).optional(),
});

const ProfileResponse = z.object({ historyId: z.string().min(1) });

const MetadataMessageResponse = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  snippet: z.string().default(''),
  internalDate: z.string().regex(/^\d+$/),
  labelIds: z.array(z.string()).default([]),
  payload: z
    .object({
      headers: z.array(z.object({ name: z.string(), value: z.string() })).default([]),
    })
    .optional(),
});

/** Gmail's MIME tree; `| undefined` spelled out for exactOptionalPropertyTypes. */
interface RawMessagePart {
  readonly mimeType?: string | undefined;
  readonly body?: { readonly data?: string | undefined } | undefined;
  readonly parts?: readonly RawMessagePart[] | undefined;
}

const MessagePart: z.ZodType<RawMessagePart> = z.lazy(() =>
  z.object({
    mimeType: z.string().optional(),
    body: z.object({ data: z.string().optional() }).optional(),
    parts: z.array(MessagePart).optional(),
  }),
);

const FullMessageResponse = z.object({
  id: z.string().min(1),
  payload: MessagePart.optional(),
});

export interface GmailApiClientOptions {
  /** Mints (or returns a cached) OAuth access token for the mailbox's user. */
  readonly getAccessToken: () => Promise<string>;
  readonly fetch?: typeof fetch;
  readonly retryPolicy?: BackoffPolicy;
  /** Injected for deterministic tests; production uses a real timer and Math.random. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
  /** Receives retry warnings only — statuses, counts and attempt numbers, never content. */
  readonly logger?: Logger;
}

export function createGmailApiClient(options: GmailApiClientOptions): GmailMailboxPort {
  const fetchImpl = options.fetch ?? fetch;
  const policy = options.retryPolicy ?? DEFAULT_BACKOFF_POLICY;
  const schedule: RetrySchedule = {
    sleep: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    random: options.random ?? Math.random,
  };
  const logger = options.logger;

  const isRetryable = (error: unknown): boolean =>
    error instanceof GmailApiError && isRetryableStatus(error.status);

  async function requestJson(path: string, params: URLSearchParams): Promise<unknown> {
    return retryWithBackoff(
      async (attempt) => {
        if (attempt > 0) {
          logger?.warn('retrying Gmail API request', { path, attempt });
        }
        const token = await options.getAccessToken();
        const response = await fetchImpl(`${GMAIL_API_BASE}${path}?${params.toString()}`, {
          headers: { authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
          throw new GmailApiError(
            response.status,
            `Gmail API ${path} failed with status ${response.status}`,
          );
        }
        return (await response.json()) as unknown;
      },
      isRetryable,
      policy,
      schedule,
    );
  }

  /**
   * One round of the batch endpoint for `remaining` ids. Per-item failures are split into
   * retryable (429/5xx — returned for the caller's next round) and fatal (thrown).
   */
  async function executeBatch(
    remaining: readonly string[],
    query: string,
  ): Promise<{ succeeded: [string, unknown][]; retryable: string[] }> {
    const token = await options.getAccessToken();
    const body = remaining
      .map((id) =>
        [
          `--${REQUEST_BOUNDARY}`,
          'Content-Type: application/http',
          `Content-ID: <${id}>`,
          '',
          `GET /gmail/v1/users/me/messages/${encodeURIComponent(id)}?${query}`,
          '',
        ].join('\r\n'),
      )
      .join('\r\n')
      .concat(`\r\n--${REQUEST_BOUNDARY}--`);

    const response = await fetchImpl(`${GMAIL_API_BASE}${BATCH_PATH}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': `multipart/mixed; boundary=${REQUEST_BOUNDARY}`,
      },
      body,
    });
    if (!response.ok) {
      throw new GmailApiError(
        response.status,
        `Gmail batch request failed with status ${response.status}`,
      );
    }

    const boundary = boundaryOf(response.headers.get('content-type'));
    const parts = parseBatchParts(await response.text(), boundary);
    const succeeded: [string, unknown][] = [];
    const retryable: string[] = [];
    for (const part of parts) {
      if (part.status >= 200 && part.status < 300) {
        succeeded.push([part.contentId, parseJson(part.body)]);
      } else if (isRetryableStatus(part.status)) {
        retryable.push(part.contentId);
      } else {
        throw new GmailApiError(
          part.status,
          `Gmail batch item for message ${part.contentId} failed with status ${part.status}`,
        );
      }
    }
    return { succeeded, retryable };
  }

  /**
   * Fetches every id via the batch endpoint, retrying only what failed retryably — a
   * whole-batch 429 and a partial one both back off with jitter, and the ids that already
   * succeeded are never fetched twice.
   */
  async function batchGetMessages(
    ids: readonly string[],
    query: string,
  ): Promise<Map<string, unknown>> {
    const results = new Map<string, unknown>();
    let remaining = [...ids];
    for (let attempt = 0; ; attempt += 1) {
      let retryable: string[];
      try {
        const outcome = await executeBatch(remaining, query);
        for (const [id, json] of outcome.succeeded) {
          results.set(id, json);
        }
        retryable = outcome.retryable;
      } catch (error) {
        if (attempt + 1 >= policy.maxAttempts || !isRetryable(error)) {
          throw error;
        }
        retryable = remaining;
      }
      if (retryable.length === 0) {
        return results;
      }
      if (attempt + 1 >= policy.maxAttempts) {
        throw new GmailApiError(
          429,
          `Gmail batch left ${retryable.length} messages unfetched after ${policy.maxAttempts} attempts`,
        );
      }
      logger?.warn('retrying Gmail batch items', { count: retryable.length, attempt });
      await schedule.sleep(backoffDelayMs(attempt, policy, schedule.random));
      remaining = retryable;
    }
  }

  return {
    async getProfile() {
      const json = await requestJson('/gmail/v1/users/me/profile', new URLSearchParams());
      return parseWith(ProfileResponse, json, 'profile');
    },

    async listInboxMessageIds({ maxResults, pageToken }): Promise<InboxPage> {
      const params = new URLSearchParams({ labelIds: 'INBOX', maxResults: String(maxResults) });
      if (pageToken !== undefined) {
        params.set('pageToken', pageToken);
      }
      const json = await requestJson('/gmail/v1/users/me/messages', params);
      const parsed = parseWith(MessageListResponse, json, 'messages.list');
      return {
        messageIds: (parsed.messages ?? []).map((message) => message.id),
        ...(parsed.nextPageToken === undefined ? {} : { nextPageToken: parsed.nextPageToken }),
      };
    },

    async listHistorySince({ startHistoryId, pageToken }): Promise<HistoryResult> {
      const params = new URLSearchParams({
        startHistoryId,
        historyTypes: 'messageAdded',
        labelId: 'INBOX',
      });
      if (pageToken !== undefined) {
        params.set('pageToken', pageToken);
      }
      let json: unknown;
      try {
        json = await requestJson('/gmail/v1/users/me/history', params);
      } catch (error) {
        // Gmail answers 404 when it no longer holds history back to startHistoryId
        // (roughly a week). Not an error: the caller must fall back to a full sync.
        if (error instanceof GmailApiError && error.status === 404) {
          return { kind: 'expired' };
        }
        throw error;
      }
      const parsed = parseWith(HistoryListResponse, json, 'history.list');
      return {
        kind: 'page',
        page: {
          addedMessageIds: (parsed.history ?? []).flatMap((entry) =>
            (entry.messagesAdded ?? []).map((added) => added.message.id),
          ),
          historyId: parsed.historyId,
          ...(parsed.nextPageToken === undefined ? {} : { nextPageToken: parsed.nextPageToken }),
        },
      };
    },

    async getMessagesMetadata(ids): Promise<GmailMessageMetadata[]> {
      if (ids.length === 0) {
        return [];
      }
      const raw = await batchGetMessages(ids, METADATA_QUERY);
      return ids.map((id) => {
        const parsed = parseWith(MetadataMessageResponse, mustHave(raw, id), 'messages.get');
        return {
          id: parsed.id,
          threadId: parsed.threadId,
          headers: Object.fromEntries(
            (parsed.payload?.headers ?? []).map((header) => [
              header.name.toLowerCase(),
              header.value,
            ]),
          ),
          snippet: parsed.snippet,
          internalDate: Number(parsed.internalDate),
          labelIds: parsed.labelIds,
        };
      });
    },

    async getMessageBodies(ids): Promise<MessageBodyParts[]> {
      if (ids.length === 0) {
        return [];
      }
      const raw = await batchGetMessages(ids, BODY_QUERY);
      return ids.map((id) => {
        const parsed = parseWith(FullMessageResponse, mustHave(raw, id), 'messages.get');
        return { id: parsed.id, parts: flattenTextParts(parsed.payload) };
      });
    },
  };
}

/** Walks the MIME tree collecting decoded `text/*` leaves in document order. Attachments
 * and images are skipped — they are never summarized and must never be buffered. */
function flattenTextParts(
  root: RawMessagePart | undefined,
): { mimeType: string; text: string }[] {
  const collected: { mimeType: string; text: string }[] = [];
  const walk = (part: RawMessagePart): void => {
    const mimeType = part.mimeType ?? '';
    const data = part.body?.data;
    if (data !== undefined && data !== '' && mimeType.toLowerCase().startsWith('text/')) {
      collected.push({ mimeType, text: Buffer.from(data, 'base64url').toString('utf8') });
    }
    for (const child of part.parts ?? []) {
      walk(child);
    }
  };
  if (root !== undefined) {
    walk(root);
  }
  return collected;
}

function parseWith<T>(schema: z.ZodType<T>, value: unknown, resource: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    // Deliberately no field values in the message: a malformed Gmail response can still
    // carry snippets or headers, which must never reach a log line.
    throw new Error(`Gmail ${resource} response failed schema validation`, {
      cause: result.error,
    });
  }
  return result.data;
}

function mustHave(results: ReadonlyMap<string, unknown>, id: string): unknown {
  const json = results.get(id);
  if (json === undefined) {
    throw new GmailApiError(502, `Gmail batch response missing message ${id}`);
  }
  return json;
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch (error) {
    throw new Error('Gmail batch item was not valid JSON', { cause: error });
  }
}

function boundaryOf(contentType: string | null): string {
  const match = /boundary="?([^";]+)"?/i.exec(contentType ?? '');
  if (match?.[1] === undefined) {
    throw new GmailApiError(502, 'Gmail batch response had no multipart boundary');
  }
  return match[1];
}

interface BatchPart {
  readonly contentId: string;
  readonly status: number;
  readonly body: string;
}

/**
 * Parses a multipart/mixed batch response. Each part wraps a full HTTP response:
 * part headers (carrying `Content-ID: <response-{id}>`), a blank line, the inner status
 * line + headers, a blank line, then the JSON body.
 */
function parseBatchParts(raw: string, boundary: string): BatchPart[] {
  const parts: BatchPart[] = [];
  for (const segment of raw.split(`--${boundary}`)) {
    const trimmed = segment.trim();
    if (trimmed === '' || trimmed === '--') {
      continue; // preamble / closing marker
    }
    const idMatch = /content-id:\s*<?(?:response-)?([^>\r\n]+)>?/i.exec(trimmed);
    const statusMatch = /HTTP\/[\d.]+\s+(\d{3})/.exec(trimmed);
    const sections = trimmed.split(/\r?\n\r?\n/);
    if (idMatch?.[1] === undefined || statusMatch?.[1] === undefined || sections.length < 3) {
      throw new GmailApiError(502, 'Gmail batch response part was not parseable');
    }
    parts.push({
      contentId: idMatch[1].trim(),
      status: Number(statusMatch[1]),
      // JSON whitespace is insignificant, so rejoining dropped blank lines is safe.
      body: sections.slice(2).join('\n\n'),
    });
  }
  return parts;
}
