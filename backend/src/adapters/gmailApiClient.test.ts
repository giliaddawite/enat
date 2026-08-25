import { describe, expect, it } from 'vitest';
import type { BackoffPolicy } from '../domain/backoff.js';
import { createGmailApiClient, GmailApiError } from './gmailApiClient.js';

const POLICY: BackoffPolicy = { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 400 };

interface RecordedRequest {
  readonly url: URL;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

/** A scripted fetch: each call consumes the next responder. Fails the test on overrun. */
function scriptedFetch(responders: ((request: RecordedRequest) => Response)[]) {
  const requests: RecordedRequest[] = [];
  const sleeps: number[] = [];
  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
    const request: RecordedRequest = {
      url: new URL(input instanceof Request ? input.url : input),
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(
        Object.entries((init?.headers as Record<string, string> | undefined) ?? {}).map(
          ([name, value]) => [name.toLowerCase(), value],
        ),
      ),
      body: typeof init?.body === 'string' ? init.body : '',
    };
    requests.push(request);
    const responder = responders.shift();
    if (responder === undefined) {
      throw new Error(`unexpected fetch call ${requests.length}: ${request.url.pathname}`);
    }
    return Promise.resolve(responder(request));
  }) as typeof fetch;

  return {
    requests,
    sleeps,
    fetchImpl,
    sleep: (ms: number) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const BOUNDARY = 'reply_boundary';

/** Builds a Gmail batch response: one inner HTTP response per [id, status, json]. */
function batchResponse(items: readonly [string, number, unknown][]): Response {
  const body = items
    .map(([id, status, json]) =>
      [
        `--${BOUNDARY}`,
        'Content-Type: application/http',
        `Content-ID: <response-${id}>`,
        '',
        `HTTP/1.1 ${status} STATUS`,
        'Content-Type: application/json; charset=UTF-8',
        '',
        JSON.stringify(json),
      ].join('\r\n'),
    )
    .join('\r\n')
    .concat(`\r\n--${BOUNDARY}--`);
  return new Response(body, {
    status: 200,
    headers: { 'content-type': `multipart/mixed; boundary=${BOUNDARY}` },
  });
}

function client(script: ReturnType<typeof scriptedFetch>) {
  return createGmailApiClient({
    getAccessToken: () => Promise.resolve('access-token-1'),
    fetch: script.fetchImpl,
    retryPolicy: POLICY,
    sleep: script.sleep,
    random: () => 0.5,
  });
}

const base64url = (text: string): string => Buffer.from(text, 'utf8').toString('base64url');

describe('getProfile', () => {
  it('requests the profile with a bearer token and validates the response', async () => {
    const script = scriptedFetch([() => jsonResponse(200, { historyId: 'history-9' })]);

    const profile = await client(script).getProfile();

    expect(profile).toEqual({ historyId: 'history-9' });
    const request = script.requests[0];
    expect(request?.url.pathname).toBe('/gmail/v1/users/me/profile');
    expect(request?.headers['authorization']).toBe('Bearer access-token-1');
  });

  it('rejects a response that fails schema validation, without echoing its content', async () => {
    const script = scriptedFetch([() => jsonResponse(200, { secretField: 'private-value' })]);

    const error = (await client(script)
      .getProfile()
      .catch((caught: unknown) => caught)) as Error;

    expect(error.message).toContain('schema validation');
    expect(error.message).not.toContain('private-value');
  });
});

describe('listInboxMessageIds', () => {
  it('lists the inbox with maxResults and pageToken', async () => {
    const script = scriptedFetch([
      () =>
        jsonResponse(200, {
          messages: [{ id: 'm2' }, { id: 'm1' }],
          nextPageToken: 'page-2',
        }),
    ]);

    const page = await client(script).listInboxMessageIds({
      maxResults: 50,
      pageToken: 'page-1',
    });

    expect(page).toEqual({ messageIds: ['m2', 'm1'], nextPageToken: 'page-2' });
    const url = script.requests[0]?.url;
    expect(url?.pathname).toBe('/gmail/v1/users/me/messages');
    expect(url?.searchParams.get('labelIds')).toBe('INBOX');
    expect(url?.searchParams.get('maxResults')).toBe('50');
    expect(url?.searchParams.get('pageToken')).toBe('page-1');
  });

  it('treats a missing messages array as an empty page', async () => {
    const script = scriptedFetch([() => jsonResponse(200, {})]);

    const page = await client(script).listInboxMessageIds({ maxResults: 50 });

    expect(page).toEqual({ messageIds: [] });
  });
});

describe('listHistorySince', () => {
  it('collects added message ids and passes the incremental-sync parameters', async () => {
    const script = scriptedFetch([
      () =>
        jsonResponse(200, {
          historyId: 'history-12',
          history: [
            { messagesAdded: [{ message: { id: 'm1' } }, { message: { id: 'm2' } }] },
            {}, // a history record with no additions (e.g. label change only)
          ],
        }),
    ]);

    const result = await client(script).listHistorySince({ startHistoryId: 'history-10' });

    expect(result).toEqual({
      kind: 'page',
      page: { addedMessageIds: ['m1', 'm2'], historyId: 'history-12' },
    });
    const url = script.requests[0]?.url;
    expect(url?.searchParams.get('startHistoryId')).toBe('history-10');
    expect(url?.searchParams.get('historyTypes')).toBe('messageAdded');
    expect(url?.searchParams.get('labelId')).toBe('INBOX');
  });

  it('maps a 404 to an expired watermark instead of an error', async () => {
    const script = scriptedFetch([() => jsonResponse(404, { error: { code: 404 } })]);

    const result = await client(script).listHistorySince({ startHistoryId: 'ancient' });

    expect(result).toEqual({ kind: 'expired' });
    expect(script.sleeps).toEqual([]);
  });
});

describe('retry behavior on plain requests', () => {
  it('retries 429 with jittered exponential backoff and then succeeds', async () => {
    const script = scriptedFetch([
      () => jsonResponse(429, {}),
      () => jsonResponse(503, {}),
      () => jsonResponse(200, { historyId: 'history-9' }),
    ]);

    const profile = await client(script).getProfile();

    expect(profile.historyId).toBe('history-9');
    // random=0.5 over ceilings 100 then 200.
    expect(script.sleeps).toEqual([50, 100]);
  });

  it('gives up after maxAttempts and rethrows the last status', async () => {
    const script = scriptedFetch([
      () => jsonResponse(500, {}),
      () => jsonResponse(500, {}),
      () => jsonResponse(500, {}),
    ]);

    await expect(client(script).getProfile()).rejects.toMatchObject({ status: 500 });
    expect(script.requests).toHaveLength(POLICY.maxAttempts);
  });

  it('does not retry a non-retryable status', async () => {
    const script = scriptedFetch([() => jsonResponse(403, {})]);

    await expect(client(script).getProfile()).rejects.toBeInstanceOf(GmailApiError);
    expect(script.requests).toHaveLength(1);
    expect(script.sleeps).toEqual([]);
  });
});

const metadataJson = (id: string) => ({
  id,
  threadId: `thread-${id}`,
  snippet: `snippet ${id}`,
  internalDate: '1755600000000',
  labelIds: ['INBOX'],
  payload: {
    headers: [
      { name: 'From', value: `${id}@example.com` },
      { name: 'Subject', value: `subject ${id}` },
    ],
  },
});

describe('getMessagesMetadata', () => {
  it('fetches all ids in one batch call with format=metadata and lowercased headers', async () => {
    const script = scriptedFetch([
      () =>
        batchResponse([
          ['m1', 200, metadataJson('m1')],
          ['m2', 200, metadataJson('m2')],
        ]),
    ]);

    const metadata = await client(script).getMessagesMetadata(['m1', 'm2']);

    expect(script.requests).toHaveLength(1);
    const request = script.requests[0];
    expect(request?.url.pathname).toBe('/batch/gmail/v1');
    expect(request?.method).toBe('POST');
    expect(request?.headers['content-type']).toContain('multipart/mixed');
    expect(request?.body).toContain('/gmail/v1/users/me/messages/m1?format=metadata');
    expect(request?.body).toContain('metadataHeaders=Subject');
    expect(metadata.map((message) => message.id)).toEqual(['m1', 'm2']);
    expect(metadata[0]).toEqual({
      id: 'm1',
      threadId: 'thread-m1',
      headers: { from: 'm1@example.com', subject: 'subject m1' },
      snippet: 'snippet m1',
      internalDate: 1755600000000,
      labelIds: ['INBOX'],
    });
  });

  it('retries only the items that failed retryably, keeping earlier successes', async () => {
    const script = scriptedFetch([
      () =>
        batchResponse([
          ['m1', 200, metadataJson('m1')],
          ['m2', 429, { error: { code: 429 } }],
        ]),
      () => batchResponse([['m2', 200, metadataJson('m2')]]),
    ]);

    const metadata = await client(script).getMessagesMetadata(['m1', 'm2']);

    expect(metadata.map((message) => message.id)).toEqual(['m1', 'm2']);
    // The second batch must ask for m2 only.
    expect(script.requests[1]?.body).toContain('/messages/m2?');
    expect(script.requests[1]?.body).not.toContain('/messages/m1?');
    expect(script.sleeps).toEqual([50]);
  });

  it('retries the whole batch when the outer response is retryable', async () => {
    const script = scriptedFetch([
      () => jsonResponse(503, {}),
      () => batchResponse([['m1', 200, metadataJson('m1')]]),
    ]);

    const metadata = await client(script).getMessagesMetadata(['m1']);

    expect(metadata).toHaveLength(1);
    expect(script.sleeps).toEqual([50]);
  });

  it('throws on a non-retryable per-item status', async () => {
    const script = scriptedFetch([
      () => batchResponse([['m1', 404, { error: { code: 404 } }]]),
    ]);

    await expect(client(script).getMessagesMetadata(['m1'])).rejects.toMatchObject({
      status: 404,
    });
  });

  it('gives up when items are still failing after maxAttempts', async () => {
    const script = scriptedFetch([
      () => batchResponse([['m1', 429, {}]]),
      () => batchResponse([['m1', 429, {}]]),
      () => batchResponse([['m1', 429, {}]]),
    ]);

    await expect(client(script).getMessagesMetadata(['m1'])).rejects.toThrow(
      /1 messages unfetched/,
    );
    expect(script.sleeps).toHaveLength(POLICY.maxAttempts - 1);
  });
});

describe('getMessageBodies', () => {
  it('decodes base64url text parts from a nested MIME tree in document order', async () => {
    const script = scriptedFetch([
      () =>
        batchResponse([
          [
            'm1',
            200,
            {
              id: 'm1',
              payload: {
                mimeType: 'multipart/alternative',
                parts: [
                  {
                    mimeType: 'text/plain',
                    body: { data: base64url('Plain body ሰላም') },
                  },
                  { mimeType: 'text/html', body: { data: base64url('<p>Html body</p>') } },
                  { mimeType: 'image/png', body: { data: base64url('not-text') } },
                ],
              },
            },
          ],
        ]),
    ]);

    const bodies = await client(script).getMessageBodies(['m1']);

    expect(script.requests[0]?.body).toContain('/messages/m1?format=full');
    expect(bodies).toEqual([
      {
        id: 'm1',
        parts: [
          { mimeType: 'text/plain', text: 'Plain body ሰላም' },
          { mimeType: 'text/html', text: '<p>Html body</p>' },
        ],
      },
    ]);
  });

  it('returns no parts for a message without a payload', async () => {
    const script = scriptedFetch([() => batchResponse([['m1', 200, { id: 'm1' }]])]);

    const bodies = await client(script).getMessageBodies(['m1']);

    expect(bodies).toEqual([{ id: 'm1', parts: [] }]);
  });

  it('makes no request at all for an empty id list', async () => {
    const script = scriptedFetch([]);

    await expect(client(script).getMessageBodies([])).resolves.toEqual([]);
    expect(script.requests).toHaveLength(0);
  });
});
