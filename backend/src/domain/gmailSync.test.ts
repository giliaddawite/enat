import { describe, expect, it } from 'vitest';
import type { GmailMessageMetadata } from './email.js';
import {
  attachBodies,
  createGmailSyncService,
  GMAIL_BATCH_LIMIT,
  type GmailMailboxPort,
  type GmailSyncStateStore,
  type HistoryResult,
  type MessageBodyParts,
} from './gmailSync.js';

const UID = 'google-user-123';

function metadataFor(id: string): GmailMessageMetadata {
  return {
    id,
    threadId: `thread-${id}`,
    headers: { from: `${id}@example.com`, subject: `subject ${id}` },
    snippet: `snippet ${id}`,
    internalDate: Date.UTC(2026, 7, 20),
    labelIds: ['INBOX'],
  };
}

interface FakeMailboxOptions {
  /** Newest first, as Gmail lists them. */
  readonly inboxIds?: readonly string[];
  /** Sequential pages for listHistorySince; `expired` short-circuits every call. */
  readonly historyPages?: readonly HistoryResult[];
  readonly historyExpired?: boolean;
  readonly profileHistoryId?: string;
  readonly bodies?: Readonly<Record<string, MessageBodyParts['parts']>>;
}

/** An in-memory Gmail mailbox recording every port call, so tests can count API calls
 * and assert page-at-a-time interleaving. */
function fakeMailbox(options: FakeMailboxOptions = {}) {
  const inboxIds = options.inboxIds ?? [];
  const calls: string[] = [];

  const mailbox: GmailMailboxPort = {
    getProfile() {
      calls.push('profile');
      return Promise.resolve({ historyId: options.profileHistoryId ?? 'history-100' });
    },
    listInboxMessageIds({ maxResults, pageToken }) {
      calls.push('list');
      const start = pageToken === undefined ? 0 : Number(pageToken);
      const end = start + maxResults;
      return Promise.resolve({
        messageIds: inboxIds.slice(start, end),
        ...(end < inboxIds.length ? { nextPageToken: String(end) } : {}),
      });
    },
    listHistorySince({ pageToken }) {
      calls.push('history');
      if (options.historyExpired === true) {
        return Promise.resolve({ kind: 'expired' } as const);
      }
      const pages = options.historyPages ?? [];
      const index = pageToken === undefined ? 0 : Number(pageToken);
      const page = pages[index];
      if (page === undefined) {
        throw new Error(`test misconfiguration: no history page ${index}`);
      }
      return Promise.resolve(page);
    },
    getMessagesMetadata(ids) {
      calls.push(`metadata:${ids.length}`);
      return Promise.resolve(ids.map(metadataFor));
    },
    getMessageBodies(ids) {
      calls.push(`bodies:${ids.length}`);
      return Promise.resolve(
        ids.map((id) => ({ id, parts: options.bodies?.[id] ?? [] })),
      );
    },
  };

  return { mailbox, calls };
}

function fakeSyncState(initial: Record<string, string> = {}) {
  const historyIds = new Map(Object.entries(initial));
  const store: GmailSyncStateStore = {
    getHistoryId: (uid) => Promise.resolve(historyIds.get(uid) ?? null),
    setHistoryId: (uid, historyId) => {
      historyIds.set(uid, historyId);
      return Promise.resolve();
    },
  };
  return { store, historyIds };
}

function historyPage(
  addedMessageIds: readonly string[],
  historyId: string,
  nextPageToken?: string,
): HistoryResult {
  return {
    kind: 'page',
    page: {
      addedMessageIds,
      historyId,
      ...(nextPageToken === undefined ? {} : { nextPageToken }),
    },
  };
}

describe('syncInbox — first run (full sync)', () => {
  it('normalizes the inbox and persists the profile historyId as the watermark', async () => {
    const { mailbox } = fakeMailbox({
      inboxIds: ['m3', 'm2', 'm1'],
      profileHistoryId: 'history-42',
    });
    const { store, historyIds } = fakeSyncState();
    const service = createGmailSyncService({ mailbox, syncState: store });

    const result = await service.syncInbox(UID);

    expect(result.kind).toBe('full');
    expect(result.historyId).toBe('history-42');
    expect(result.emails.map((email) => email.id)).toEqual(['m3', 'm2', 'm1']);
    expect(result.emails[0]).toMatchObject({
      threadId: 'thread-m3',
      from: 'm3@example.com',
      subject: 'subject m3',
      labels: ['INBOX'],
      bodyText: null,
    });
    expect(historyIds.get(UID)).toBe('history-42');
  });

  it('handles a 10k+ message inbox page by page, never fetching more than one page at once', async () => {
    const inboxIds = Array.from({ length: 10_500 }, (_, index) => `m${10_500 - index}`);
    const { mailbox, calls } = fakeMailbox({ inboxIds });
    const service = createGmailSyncService({
      mailbox,
      syncState: fakeSyncState().store,
      maxMessagesPerSync: 12_000,
    });

    const result = await service.syncInbox(UID);

    expect(result.emails).toHaveLength(10_500);
    // 10,500 ids at 100 per page: 105 list pages, each followed by its own metadata batch.
    expect(calls.filter((call) => call === 'list')).toHaveLength(105);
    expect(calls.filter((call) => call.startsWith('metadata'))).toHaveLength(105);
    // Strict interleaving is what bounds memory: every page's metadata is fetched and
    // normalized before the next page of ids is requested.
    expect(calls.slice(1)).toEqual(
      Array.from({ length: 105 }, () => ['list', 'metadata:100']).flat(),
    );
  });

  it('stops paging a huge inbox at the per-sync cap instead of walking all of it', async () => {
    const inboxIds = Array.from({ length: 10_500 }, (_, index) => `m${10_500 - index}`);
    const { mailbox, calls } = fakeMailbox({ inboxIds });
    const service = createGmailSyncService({ mailbox, syncState: fakeSyncState().store });

    const result = await service.syncInbox(UID);

    // Default cap is 500: five pages of 100, then the sync stops — the other 10,000
    // messages are never listed, let alone fetched.
    expect(result.emails).toHaveLength(500);
    expect(calls.filter((call) => call === 'list')).toHaveLength(5);
    expect(calls.filter((call) => call.startsWith('metadata'))).toHaveLength(5);
  });
});

describe('syncInbox — incremental sync', () => {
  it('makes exactly one API call when the inbox is unchanged', async () => {
    const { mailbox, calls } = fakeMailbox({ historyPages: [historyPage([], 'history-43')] });
    const { store, historyIds } = fakeSyncState({ [UID]: 'history-42' });
    const service = createGmailSyncService({ mailbox, syncState: store });

    const result = await service.syncInbox(UID);

    expect(calls).toEqual(['history']);
    expect(result).toEqual({ kind: 'incremental', emails: [], historyId: 'history-43' });
    expect(historyIds.get(UID)).toBe('history-43');
  });

  it('fetches only the added messages, deduplicated, newest first', async () => {
    const { mailbox, calls } = fakeMailbox({
      historyPages: [
        historyPage(['m1', 'm2'], 'history-50', '1'),
        // m2 appears again (added then relabeled) and must be fetched once.
        historyPage(['m2', 'm3'], 'history-51'),
      ],
    });
    const { store, historyIds } = fakeSyncState({ [UID]: 'history-42' });
    const service = createGmailSyncService({ mailbox, syncState: store });

    const result = await service.syncInbox(UID);

    expect(result.kind).toBe('incremental');
    expect(result.emails.map((email) => email.id)).toEqual(['m3', 'm2', 'm1']);
    expect(calls).toEqual(['history', 'history', 'metadata:3']);
    expect(historyIds.get(UID)).toBe('history-51');
  });

  it('keeps only the newest messages when a backlog exceeds the per-sync cap', async () => {
    const backlog = Array.from({ length: 250 }, (_, index) => `m${index + 1}`);
    const { mailbox } = fakeMailbox({ historyPages: [historyPage(backlog, 'history-99')] });
    const service = createGmailSyncService({
      mailbox,
      syncState: fakeSyncState({ [UID]: 'history-42' }).store,
      maxMessagesPerSync: 100,
    });

    const result = await service.syncInbox(UID);

    expect(result.emails).toHaveLength(100);
    expect(result.emails[0]?.id).toBe('m250');
    expect(result.emails.at(-1)?.id).toBe('m151');
  });

  it('splits metadata fetches at the Gmail batch limit', async () => {
    const backlog = Array.from({ length: 150 }, (_, index) => `m${index + 1}`);
    const { mailbox, calls } = fakeMailbox({
      historyPages: [historyPage(backlog, 'history-99')],
    });
    const service = createGmailSyncService({
      mailbox,
      syncState: fakeSyncState({ [UID]: 'history-42' }).store,
    });

    await service.syncInbox(UID);

    expect(calls).toEqual(['history', `metadata:${GMAIL_BATCH_LIMIT}`, 'metadata:50']);
  });

  it('falls back to a full sync when Gmail reports the watermark expired', async () => {
    const { mailbox, calls } = fakeMailbox({
      historyExpired: true,
      inboxIds: ['m2', 'm1'],
      profileHistoryId: 'history-77',
    });
    const { store, historyIds } = fakeSyncState({ [UID]: 'history-long-gone' });
    const service = createGmailSyncService({ mailbox, syncState: store });

    const result = await service.syncInbox(UID);

    expect(result.kind).toBe('full');
    expect(result.emails.map((email) => email.id)).toEqual(['m2', 'm1']);
    expect(calls).toEqual(['history', 'profile', 'list', 'metadata:2']);
    expect(historyIds.get(UID)).toBe('history-77');
  });

  it('does not advance the watermark when the sync fails', async () => {
    const { mailbox } = fakeMailbox();
    mailbox.listHistorySince = () => Promise.reject(new Error('gmail unavailable'));
    const { store, historyIds } = fakeSyncState({ [UID]: 'history-42' });
    const service = createGmailSyncService({ mailbox, syncState: store });

    await expect(service.syncInbox(UID)).rejects.toThrow('gmail unavailable');

    expect(historyIds.get(UID)).toBe('history-42');
  });
});

describe('fetchBodies', () => {
  it('extracts plain text and truncates each body to the token budget', async () => {
    const { mailbox } = fakeMailbox({
      bodies: {
        short: [{ mimeType: 'text/plain', text: 'A short body.' }],
        long: [{ mimeType: 'text/html', text: `<p>${'word '.repeat(400)}</p>` }],
      },
    });
    const service = createGmailSyncService({ mailbox, syncState: fakeSyncState().store });

    const bodies = await service.fetchBodies(['short', 'long'], 20);

    expect(bodies.get('short')).toBe('A short body.');
    const long = bodies.get('long') ?? '';
    expect(long.startsWith('word word')).toBe(true);
    expect(long.length).toBeLessThanOrEqual(20 * 4);
  });

  it('deduplicates ids and splits fetches at the Gmail batch limit', async () => {
    const ids = Array.from({ length: 150 }, (_, index) => `m${index + 1}`);
    const { mailbox, calls } = fakeMailbox();
    const service = createGmailSyncService({ mailbox, syncState: fakeSyncState().store });

    const bodies = await service.fetchBodies([...ids, ...ids], 100);

    expect(bodies.size).toBe(150);
    expect(calls).toEqual([`bodies:${GMAIL_BATCH_LIMIT}`, 'bodies:50']);
  });
});

describe('attachBodies', () => {
  it('merges fetched bodies and leaves unfetched emails with bodyText null', () => {
    const emails = [metadataFor('m1'), metadataFor('m2')].map((metadata) => ({
      id: metadata.id,
      threadId: metadata.threadId,
      from: '',
      subject: '',
      snippet: '',
      receivedAt: '2026-08-20T00:00:00.000Z',
      labels: [],
      bodyText: null,
    }));

    const merged = attachBodies(emails, new Map([['m1', 'body one']]));

    expect(merged[0]?.bodyText).toBe('body one');
    expect(merged[1]?.bodyText).toBeNull();
  });
});
