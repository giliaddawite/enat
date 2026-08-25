import { describe, expect, it } from 'vitest';
import { attachBodies, createGmailSyncService } from '../domain/gmailSync.js';
import { createFakeFirestore } from '../testing/fakeFirestore.js';
import { createGmailAccessTokenProvider } from './gmailAccessTokens.js';
import { createGmailApiClient } from './gmailApiClient.js';
import { createFirestoreGmailSyncStateStore } from './gmailSyncStateRepository.js';
import {
  createSecretManagerRefreshTokenStore,
  type SecretManagerLike,
} from './refreshTokenStore.js';

/**
 * Integration test for the whole ingestion slice (TICKET-103): the real Gmail API client
 * (REST + batch multipart), the real access-token provider over the real refresh-token
 * store, the real Firestore-backed sync state, and the real domain sync service — against
 * a stateful in-process Gmail API mock. Only the network itself is fake.
 */

const UID = 'google-user-123';
const NOW = () => new Date('2026-08-24T08:00:00.000Z');

interface StoredMessage {
  readonly id: string;
  readonly from: string;
  readonly subject: string;
  readonly bodyHtml: string;
}

interface FakeGmail {
  readonly fetchImpl: typeof fetch;
  /** One entry per HTTP round trip to gmail.googleapis.com — the "API calls" the ticket
   * counts (a batch of 100 gets is one call). Token-endpoint calls are tracked apart. */
  readonly gmailRequests: string[];
  readonly tokenRequests: number[];
  readonly sleeps: number[];
  /** Statuses to answer the next Gmail requests with, before serving real responses. */
  readonly failNext: number[];
  seed(messages: readonly StoredMessage[]): void;
  deliver(message: StoredMessage): void;
}

/** A stateful Gmail API mock: profile, paginated messages.list, history.list with an
 * expiring watermark, the batch endpoint, and Google's OAuth token endpoint. */
function createFakeGmail(): FakeGmail {
  // Newest first, as messages.list returns them.
  const messages: StoredMessage[] = [];
  const historyEvents: { historyId: number; addedId: string }[] = [];
  let currentHistoryId = 1000;
  const oldestKnownHistoryId = 1000;
  const gmailRequests: string[] = [];
  const tokenRequests: number[] = [];
  const sleeps: number[] = [];
  const failNext: number[] = [];

  const internalDateOf = (id: string): string =>
    String(Date.UTC(2026, 7, 20) + historyEvents.length + messages.length);

  const metadataJson = (message: StoredMessage) => ({
    id: message.id,
    threadId: `thread-${message.id}`,
    snippet: `snippet for ${message.id}`,
    internalDate: internalDateOf(message.id),
    labelIds: ['INBOX'],
    payload: {
      headers: [
        { name: 'From', value: message.from },
        { name: 'Subject', value: message.subject },
      ],
    },
  });

  const fullJson = (message: StoredMessage) => ({
    id: message.id,
    threadId: `thread-${message.id}`,
    payload: {
      mimeType: 'multipart/alternative',
      parts: [
        {
          mimeType: 'text/html',
          body: { data: Buffer.from(message.bodyHtml, 'utf8').toString('base64url') },
        },
      ],
    },
  });

  const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  const handleBatch = (body: string): Response => {
    const boundary = 'mock_reply';
    const items = [...body.matchAll(/GET \/gmail\/v1\/users\/me\/messages\/([^?\s]+)\?(\S+)/g)];
    const parts = items
      .map(([, id, query]) => {
        const message = messages.find((candidate) => candidate.id === id);
        const payload =
          message === undefined
            ? { status: 404, body: { error: { code: 404 } } }
            : {
                status: 200,
                body: query?.includes('format=full') ? fullJson(message) : metadataJson(message),
              };
        return [
          `--${boundary}`,
          'Content-Type: application/http',
          `Content-ID: <response-${id ?? ''}>`,
          '',
          `HTTP/1.1 ${payload.status} STATUS`,
          'Content-Type: application/json; charset=UTF-8',
          '',
          JSON.stringify(payload.body),
        ].join('\r\n');
      })
      .join('\r\n')
      .concat(`\r\n--${boundary}--`);
    return new Response(parts, {
      status: 200,
      headers: { 'content-type': `multipart/mixed; boundary=${boundary}` },
    });
  };

  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));

    if (url.hostname === 'oauth2.googleapis.com') {
      tokenRequests.push(1);
      return Promise.resolve(json(200, { access_token: 'minted-token', expires_in: 3600 }));
    }

    gmailRequests.push(`${url.pathname}${url.search}`);
    const injectedStatus = failNext.shift();
    if (injectedStatus !== undefined) {
      return Promise.resolve(json(injectedStatus, { error: { code: injectedStatus } }));
    }

    if (url.pathname === '/gmail/v1/users/me/profile') {
      return Promise.resolve(json(200, { historyId: String(currentHistoryId) }));
    }

    if (url.pathname === '/gmail/v1/users/me/messages') {
      const maxResults = Number(url.searchParams.get('maxResults') ?? '100');
      const start = Number(url.searchParams.get('pageToken') ?? '0');
      const end = start + maxResults;
      return Promise.resolve(
        json(200, {
          messages: messages.slice(start, end).map((message) => ({ id: message.id })),
          ...(end < messages.length ? { nextPageToken: String(end) } : {}),
        }),
      );
    }

    if (url.pathname === '/gmail/v1/users/me/history') {
      const start = Number(url.searchParams.get('startHistoryId'));
      if (start < oldestKnownHistoryId) {
        return Promise.resolve(json(404, { error: { code: 404 } }));
      }
      const added = historyEvents.filter((event) => event.historyId > start);
      return Promise.resolve(
        json(200, {
          historyId: String(currentHistoryId),
          ...(added.length > 0
            ? {
                history: added.map((event) => ({
                  messagesAdded: [{ message: { id: event.addedId } }],
                })),
              }
            : {}),
        }),
      );
    }

    if (url.pathname === '/batch/gmail/v1') {
      return Promise.resolve(handleBatch(typeof init?.body === 'string' ? init.body : ''));
    }

    throw new Error(`fake Gmail has no route for ${url.pathname}`);
  }) as typeof fetch;

  return {
    fetchImpl,
    gmailRequests,
    tokenRequests,
    sleeps,
    failNext,
    seed(seeded) {
      messages.push(...seeded);
    },
    deliver(message) {
      currentHistoryId += 1;
      messages.unshift(message);
      historyEvents.push({ historyId: currentHistoryId, addedId: message.id });
    },
  };
}

/** Just enough Secret Manager for the real refresh-token store to round-trip a token. */
function inMemorySecretManager(): SecretManagerLike {
  const secrets = new Map<string, string[]>();
  return {
    createSecret(secretId) {
      if (secrets.has(secretId)) {
        return Promise.reject(Object.assign(new Error('ALREADY_EXISTS'), { code: 6 }));
      }
      secrets.set(secretId, []);
      return Promise.resolve();
    },
    addSecretVersion(secretId, payload) {
      const versions = secrets.get(secretId);
      if (versions === undefined) {
        return Promise.reject(new Error('NOT_FOUND'));
      }
      versions.push(payload);
      return Promise.resolve(`${secretId}/versions/${versions.length}`);
    },
    accessSecretVersion(versionName) {
      const [secretId, version] = versionName.split('/versions/');
      const payload = secrets.get(secretId ?? '')?.[Number(version) - 1];
      return payload === undefined
        ? Promise.reject(new Error('NOT_FOUND'))
        : Promise.resolve(payload);
    },
    listEnabledSecretVersions: () => Promise.resolve([]),
    destroySecretVersion: () => Promise.resolve(),
  };
}

async function createHarness(server: FakeGmail, maxMessagesPerSync?: number) {
  const refreshTokenStore = createSecretManagerRefreshTokenStore(inMemorySecretManager());
  const refreshTokenRef = await refreshTokenStore.put(UID, 'stored-refresh-token');
  const tokens = createGmailAccessTokenProvider({
    refreshTokenStore,
    clientId: 'client-id',
    clientSecret: 'client-secret',
    fetch: server.fetchImpl,
    now: () => 0,
  });
  const mailbox = createGmailApiClient({
    getAccessToken: () => tokens.getAccessToken(refreshTokenRef),
    fetch: server.fetchImpl,
    sleep: (ms) => {
      server.sleeps.push(ms);
      return Promise.resolve();
    },
    random: () => 0.5,
  });
  const { firestore, documents } = createFakeFirestore();
  const syncState = createFirestoreGmailSyncStateStore(firestore, { now: NOW });
  const service = createGmailSyncService({
    mailbox,
    syncState,
    ...(maxMessagesPerSync === undefined ? {} : { maxMessagesPerSync }),
  });
  return { service, documents };
}

const message = (id: string): StoredMessage => ({
  id,
  from: `Sender <${id}@example.com>`,
  subject: `Subject of ${id}`,
  bodyHtml: `<html><body><p>Body of ${id} &amp; more</p></body></html>`,
});

describe('gmail ingestion (integration, against the Gmail API mock)', () => {
  it('runs a first full sync end to end: token minting, listing, batched metadata', async () => {
    const server = createFakeGmail();
    server.seed([message('m3'), message('m2'), message('m1')]);
    const { service, documents } = await createHarness(server);

    const result = await service.syncInbox(UID);

    expect(result.kind).toBe('full');
    expect(result.emails.map((email) => email.id)).toEqual(['m3', 'm2', 'm1']);
    expect(result.emails[0]).toMatchObject({
      threadId: 'thread-m3',
      from: 'Sender <m3@example.com>',
      subject: 'Subject of m3',
      snippet: 'snippet for m3',
      labels: ['INBOX'],
      bodyText: null,
    });
    // One access token exchange serves the whole sync.
    expect(server.tokenRequests).toHaveLength(1);
    expect(documents[`gmailSyncState/${UID}`]).toMatchObject({ historyId: '1000' });
  });

  it('makes at most 2 API calls on a second sync of an unchanged inbox', async () => {
    const server = createFakeGmail();
    server.seed([message('m2'), message('m1')]);
    const { service } = await createHarness(server);
    await service.syncInbox(UID);

    const callsBefore = server.gmailRequests.length;
    const result = await service.syncInbox(UID);
    const secondSyncCalls = server.gmailRequests.slice(callsBefore);

    expect(result).toMatchObject({ kind: 'incremental', emails: [] });
    expect(secondSyncCalls.length).toBeLessThanOrEqual(2);
    // It is in fact exactly one history.list from the stored watermark.
    expect(secondSyncCalls).toEqual([
      '/gmail/v1/users/me/history?startHistoryId=1000&historyTypes=messageAdded&labelId=INBOX',
    ]);
  });

  it('picks up only newly delivered mail on later syncs, via history', async () => {
    const server = createFakeGmail();
    server.seed([message('m1')]);
    const { service } = await createHarness(server);
    await service.syncInbox(UID);

    server.deliver(message('m2'));
    server.deliver(message('m3'));
    const result = await service.syncInbox(UID);

    expect(result.kind).toBe('incremental');
    expect(result.emails.map((email) => email.id)).toEqual(['m3', 'm2']);
  });

  it('fetches bodies only for the selected messages, stripped and token-truncated', async () => {
    const server = createFakeGmail();
    server.seed([message('m3'), message('m2'), message('m1')]);
    const { service } = await createHarness(server);
    const synced = await service.syncInbox(UID);
    const bodyFetchesBefore = server.gmailRequests.filter((path) =>
      path.includes('/batch'),
    ).length;

    const bodies = await service.fetchBodies(['m2'], 50);
    const emails = attachBodies(synced.emails, bodies);

    expect(bodies.get('m2')).toBe('Body of m2 & more');
    expect(emails.find((email) => email.id === 'm2')?.bodyText).toBe('Body of m2 & more');
    expect(emails.find((email) => email.id === 'm1')?.bodyText).toBeNull();
    // Exactly one more batch round trip, for the one selected message.
    const batchCalls = server.gmailRequests.filter((path) => path.includes('/batch'));
    expect(batchCalls).toHaveLength(bodyFetchesBefore + 1);
  });

  it('retries a rate-limited sync with backoff and still succeeds', async () => {
    const server = createFakeGmail();
    server.seed([message('m1')]);
    server.failNext.push(429, 503);
    const { service } = await createHarness(server);

    const result = await service.syncInbox(UID);

    expect(result.emails.map((email) => email.id)).toEqual(['m1']);
    expect(server.sleeps.length).toBeGreaterThanOrEqual(2);
  });

  it('pages through a 10k+ message inbox without holding it in memory at once', async () => {
    const server = createFakeGmail();
    server.seed(
      Array.from({ length: 10_500 }, (_, index) => message(`bulk-${10_500 - index}`)),
    );
    const { service } = await createHarness(server, 12_000);

    const result = await service.syncInbox(UID);

    expect(result.emails).toHaveLength(10_500);
    expect(result.emails[0]?.id).toBe('bulk-10500');
    expect(result.emails.at(-1)?.id).toBe('bulk-1');
    const listCalls = server.gmailRequests.filter((path) =>
      path.startsWith('/gmail/v1/users/me/messages?'),
    );
    const batchCalls = server.gmailRequests.filter((path) => path.includes('/batch'));
    // 100 ids per page, one metadata batch per page: the raw inbox is streamed, and no
    // request ever asks for more than one page's worth of data.
    expect(listCalls).toHaveLength(105);
    expect(batchCalls).toHaveLength(105);
    expect(listCalls.every((path) => path.includes('maxResults=100'))).toBe(true);
  });
});
