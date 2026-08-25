import { normalizeGmailMessage, type Email, type GmailMessageMetadata } from './email.js';
import { pickBodyText, truncateToTokenBudget } from './emailText.js';

/**
 * Gmail sync orchestration (TICKET-103). Pure domain logic: this module decides *what* to
 * fetch — full vs. incremental, page by page, capped — while the ports below carry the
 * *how* (HTTP, batching, auth), implemented in `src/adapters/`.
 */

export interface InboxPage {
  readonly messageIds: readonly string[];
  readonly nextPageToken?: string;
}

export interface HistoryPage {
  /** Ids of messages added to the inbox since the start history id, oldest first. */
  readonly addedMessageIds: readonly string[];
  /** The mailbox's current history id — the next sync's starting point. */
  readonly historyId: string;
  readonly nextPageToken?: string;
}

/** `expired` means Gmail no longer holds history back to the requested id (it keeps about
 * a week); the only correct response is a fresh full sync. */
export type HistoryResult =
  | { readonly kind: 'page'; readonly page: HistoryPage }
  | { readonly kind: 'expired' };

export interface MessageBodyParts {
  readonly id: string;
  /** Decoded text parts of the message, in document order. Wire decoding (base64url,
   * MIME tree flattening) is the adapter's job; the domain only chooses among parts. */
  readonly parts: readonly { readonly mimeType: string; readonly text: string }[];
}

/**
 * A user-scoped view of one Gmail mailbox. Implementations batch `getMessagesMetadata`
 * and `getMessageBodies` over the Gmail batch endpoint and own retry/backoff on 429/5xx;
 * callers may pass up to `GMAIL_BATCH_LIMIT` ids per call.
 */
export interface GmailMailboxPort {
  getProfile(): Promise<{ readonly historyId: string }>;
  listInboxMessageIds(options: {
    readonly maxResults: number;
    readonly pageToken?: string;
  }): Promise<InboxPage>;
  listHistorySince(options: {
    readonly startHistoryId: string;
    readonly pageToken?: string;
  }): Promise<HistoryResult>;
  /** `format=metadata` — headers and snippet only, never bodies. */
  getMessagesMetadata(ids: readonly string[]): Promise<readonly GmailMessageMetadata[]>;
  /** Full fetch for the few messages that will actually be summarized. */
  getMessageBodies(ids: readonly string[]): Promise<readonly MessageBodyParts[]>;
}

/** Where the per-user `historyId` watermark between syncs lives (Firestore in production). */
export interface GmailSyncStateStore {
  getHistoryId(uid: string): Promise<string | null>;
  setHistoryId(uid: string, historyId: string): Promise<void>;
}

export interface InboxSyncResult {
  readonly kind: 'full' | 'incremental';
  /** Newly seen messages, metadata-normalized, newest first. `bodyText` is `null` here —
   * bodies are a separate, deliberate `fetchBodies` call for summarized messages only. */
  readonly emails: readonly Email[];
  /** The watermark this sync ended on; already persisted when the result returns. */
  readonly historyId: string;
}

export interface GmailSyncService {
  /**
   * Runs one sync for `uid`: incremental (`history.list` from the stored watermark) when a
   * watermark exists, a capped full sync of the most recent inbox otherwise or when the
   * watermark expired. Invoked per request/scheduled job — it never polls or loops beyond
   * the pages of this one sync, so the service still scales to zero.
   */
  syncInbox(uid: string): Promise<InboxSyncResult>;
  /**
   * Fetches, flattens and truncates bodies for the given messages. Returns id → plain
   * text, each entry cut to `maxTokensPerBody`. Callers merge with `attachBodies`.
   */
  fetchBodies(
    messageIds: readonly string[],
    maxTokensPerBody: number,
  ): Promise<ReadonlyMap<string, string>>;
}

/** Gmail's batch endpoint accepts at most 100 inner requests; also used as the list page
 * size so one page of ids maps onto exactly one batch call. */
export const GMAIL_BATCH_LIMIT = 100;

/**
 * How many messages one sync will normalize at most. A digest covers ~50 emails/day; 500
 * bounds both memory and metadata calls on a first sync of a huge inbox while leaving
 * generous headroom, and pagination stops as soon as the cap is reached.
 */
export const DEFAULT_MAX_MESSAGES_PER_SYNC = 500;

export interface GmailSyncDependencies {
  /** Already scoped to the user being synced. */
  readonly mailbox: GmailMailboxPort;
  readonly syncState: GmailSyncStateStore;
  readonly maxMessagesPerSync?: number;
}

export function createGmailSyncService(dependencies: GmailSyncDependencies): GmailSyncService {
  const { mailbox, syncState } = dependencies;
  const maxMessages = dependencies.maxMessagesPerSync ?? DEFAULT_MAX_MESSAGES_PER_SYNC;

  /**
   * Pages through the most recent `maxMessages` of the inbox. Each page of ids is turned
   * into normalized emails before the next page is requested, so peak memory is one page
   * of raw metadata plus the (capped) normalized list — a 10k-message inbox is never held
   * at once. The profile's historyId is read *before* listing so messages arriving during
   * the sync land after the watermark and are picked up by the next incremental sync.
   */
  async function fullSync(): Promise<InboxSyncResult> {
    const { historyId } = await mailbox.getProfile();
    const emails: Email[] = [];
    let pageToken: string | undefined;
    do {
      const remaining = maxMessages - emails.length;
      const page = await mailbox.listInboxMessageIds({
        maxResults: Math.min(GMAIL_BATCH_LIMIT, remaining),
        ...(pageToken === undefined ? {} : { pageToken }),
      });
      // Sliced defensively: the cap must hold even if a server ignores maxResults.
      const ids = page.messageIds.slice(0, remaining);
      if (ids.length > 0) {
        const metadata = await mailbox.getMessagesMetadata(ids);
        for (const message of metadata) {
          emails.push(normalizeGmailMessage(message));
        }
      }
      pageToken = page.nextPageToken;
    } while (pageToken !== undefined && emails.length < maxMessages);
    return { kind: 'full', emails, historyId };
  }

  /**
   * The steady-state path. An unchanged inbox costs exactly one API call: one
   * `history.list` that returns no additions and the current watermark.
   */
  async function incrementalSync(startHistoryId: string): Promise<InboxSyncResult> {
    const addedIds: string[] = [];
    const seen = new Set<string>();
    let historyId = startHistoryId;
    let pageToken: string | undefined;
    do {
      const result = await mailbox.listHistorySince({
        startHistoryId,
        ...(pageToken === undefined ? {} : { pageToken }),
      });
      if (result.kind === 'expired') {
        return fullSync();
      }
      historyId = result.page.historyId;
      for (const id of result.page.addedMessageIds) {
        // The same message can appear in several history records (e.g. added then
        // relabeled); it must be fetched — and later summarized — once.
        if (!seen.has(id)) {
          seen.add(id);
          addedIds.push(id);
        }
      }
      pageToken = result.page.nextPageToken;
    } while (pageToken !== undefined);

    // History is oldest-first; when a backlog exceeds the cap, keep the newest messages.
    const recentIds = addedIds.slice(-maxMessages);
    const emails: Email[] = [];
    for (const batch of chunk(recentIds, GMAIL_BATCH_LIMIT)) {
      const metadata = await mailbox.getMessagesMetadata(batch);
      for (const message of metadata) {
        emails.push(normalizeGmailMessage(message));
      }
    }
    return { kind: 'incremental', emails: emails.reverse(), historyId };
  }

  return {
    async syncInbox(uid) {
      const watermark = await syncState.getHistoryId(uid);
      const result = watermark === null ? await fullSync() : await incrementalSync(watermark);
      // Persisted only after the sync succeeded — a failed sync must be retried from the
      // old watermark, not silently skipped past.
      await syncState.setHistoryId(uid, result.historyId);
      return result;
    },

    async fetchBodies(messageIds, maxTokensPerBody) {
      const uniqueIds = [...new Set(messageIds)];
      const bodies = new Map<string, string>();
      for (const batch of chunk(uniqueIds, GMAIL_BATCH_LIMIT)) {
        const results = await mailbox.getMessageBodies(batch);
        for (const message of results) {
          bodies.set(message.id, truncateToTokenBudget(pickBodyText(message.parts), maxTokensPerBody));
        }
      }
      return bodies;
    },
  };
}

/** Merges fetched bodies into their emails; messages without a fetched body keep `null`
 * (they get category-only treatment downstream). */
export function attachBodies(
  emails: readonly Email[],
  bodies: ReadonlyMap<string, string>,
): Email[] {
  return emails.map((email) => {
    const bodyText = bodies.get(email.id);
    return bodyText === undefined ? email : { ...email, bodyText };
  });
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}
