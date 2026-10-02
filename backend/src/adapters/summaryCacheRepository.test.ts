import { Timestamp } from '@google-cloud/firestore';
import { describe, expect, it, vi } from 'vitest';
import type { CacheableEmailSummary } from '../domain/summary.js';
import { createFakeFirestore } from '../testing/fakeFirestore.js';
import { captureLogs } from '../testing/httpTestServer.js';
import {
  createFirestoreSummaryCacheStore,
  SUMMARY_RETENTION_DAYS,
} from './summaryCacheRepository.js';

const UID = 'google-user-123';
const NOW = new Date('2026-08-25T12:00:00.000Z');
const EXPIRE_AT = Timestamp.fromDate(new Date('2026-11-23T12:00:00.000Z'));
const VERSION = 'digest-v1';

/** A well-formed stored summary for `messageId`, as an older run would have written it. */
function storedDocument(
  messageId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    messageId,
    category: 'important',
    summary: 'ማጠቃለያ',
    urgent: false,
    promptVersion: VERSION,
    createdAt: NOW.toISOString(),
    expireAt: EXPIRE_AT,
    ...overrides,
  };
}

function cacheable(messageId: string): CacheableEmailSummary {
  return {
    messageId,
    category: 'bills_accounts',
    summary: 'የባንክ መግለጫዎ ደርሷል።',
    urgent: false,
    source: 'llm',
    promptVersion: VERSION,
  };
}

function storeWith(seed: Record<string, Record<string, unknown>> = {}) {
  const { firestore, documents } = createFakeFirestore(seed);
  const store = createFirestoreSummaryCacheStore(firestore, {
    promptVersion: VERSION,
    now: () => NOW,
  });
  return { store, documents };
}

describe('createFirestoreSummaryCacheStore', () => {
  it('round-trips a stored summary, marked as a cache hit', async () => {
    const { store } = storeWith();

    await store.setMany(UID, [cacheable('msg-1')]);
    const hits = await store.getMany(UID, ['msg-1', 'msg-2']);

    expect(hits.size).toBe(1);
    expect(hits.get('msg-1')).toEqual({ ...cacheable('msg-1'), source: 'cache' });
  });

  it('keys documents by user and prompt version', async () => {
    const { store, documents } = storeWith();

    await store.setMany(UID, [cacheable('msg-1')]);

    expect(documents[`emailSummaries/${UID}_${VERSION}_msg-1`]).toMatchObject({
      messageId: 'msg-1',
      createdAt: NOW.toISOString(),
    });
    const otherUser = await store.getMany('someone-else', ['msg-1']);
    expect(otherUser.size).toBe(0);
  });

  it(`stamps every cached summary with an expireAt ${SUMMARY_RETENTION_DAYS} days out, from the injected clock`, async () => {
    const { store, documents } = storeWith();

    await store.setMany(UID, [cacheable('msg-1')]);

    expect(SUMMARY_RETENTION_DAYS).toBe(90);
    expect(documents[`emailSummaries/${UID}_${VERSION}_msg-1`]?.['expireAt']).toEqual(EXPIRE_AT);
  });

  describe('documents written before expireAt existed', () => {
    const OLD_CREATED_AT = '2026-06-01T09:00:00.000Z';
    const OLD_KEY = `emailSummaries/${UID}_${VERSION}_msg-old`;

    function oldDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
      const withoutStamp = storedDocument('msg-old', { createdAt: OLD_CREATED_AT });
      delete withoutStamp['expireAt'];
      return { ...withoutStamp, ...overrides };
    }

    it('serves the cached summary as a hit rather than re-summarizing', async () => {
      const { store } = storeWith({ [OLD_KEY]: oldDocument() });

      const hits = await store.getMany(UID, ['msg-old']);

      expect(hits.get('msg-old')).toMatchObject({ summary: 'ማጠቃለያ', source: 'cache' });
    });

    it('backfills expireAt from the stored createdAt on first read', async () => {
      const { store, documents } = storeWith({ [OLD_KEY]: oldDocument() });

      await store.getMany(UID, ['msg-old']);

      expect(documents[OLD_KEY]).toEqual({
        ...oldDocument(),
        expireAt: Timestamp.fromDate(new Date('2026-08-30T09:00:00.000Z')),
      });
    });

    it('anchors the backfill on the clock when createdAt does not parse', async () => {
      const { store, documents } = storeWith({ [OLD_KEY]: oldDocument({ createdAt: 'garbage' }) });

      await store.getMany(UID, ['msg-old']);

      expect(documents[OLD_KEY]?.['expireAt']).toEqual(EXPIRE_AT);
    });

    it('still returns the hit when the backfill write fails, and logs a count', async () => {
      const { firestore } = createFakeFirestore({ [OLD_KEY]: oldDocument() });
      const readOnly = {
        collection: (name: string) => ({
          doc: (id: string) => ({
            ...firestore.collection(name).doc(id),
            update: () => Promise.reject(Object.assign(new Error('UNAVAILABLE'), { code: 14 })),
          }),
        }),
      };
      const { logger, entries } = captureLogs();
      const store = createFirestoreSummaryCacheStore(readOnly, {
        promptVersion: VERSION,
        now: () => NOW,
        logger,
      });

      const hits = await store.getMany(UID, ['msg-old']);

      expect(hits.size).toBe(1);
      expect(
        entries.some((entry) => entry.message.includes('backfill failed') && entry['count'] === 1),
      ).toBe(true);
    });

    it('stamps an unstamped document that wins the write race, anchored on its own createdAt', async () => {
      const { store, documents } = storeWith({ [OLD_KEY]: oldDocument() });

      await store.setMany(UID, [{ ...cacheable('msg-old'), summary: 'ሌላ ማጠቃለያ' }]);

      expect(documents[OLD_KEY]).toEqual({
        ...oldDocument(),
        expireAt: Timestamp.fromDate(new Date('2026-08-30T09:00:00.000Z')),
      });
    });

    it('leaves an already-stamped document alone when it wins the write race', async () => {
      const earlierStamp = Timestamp.fromDate(new Date('2026-09-01T00:00:00.000Z'));
      const { store, documents } = storeWith({
        [OLD_KEY]: oldDocument({ expireAt: earlierStamp }),
      });

      await store.setMany(UID, [cacheable('msg-old')]);

      expect(documents[OLD_KEY]?.['expireAt']).toEqual(earlierStamp);
    });

    it('stamps a corrupt old document that wins the write race, so it still ages out', async () => {
      const { store, documents } = storeWith({
        [OLD_KEY]: { messageId: 'msg-old', category: 'not-a-category', createdAt: OLD_CREATED_AT },
      });

      await store.setMany(UID, [cacheable('msg-old')]);

      expect(documents[OLD_KEY]?.['expireAt']).toEqual(
        Timestamp.fromDate(new Date('2026-08-30T09:00:00.000Z')),
      );
    });

    it('clamps a future createdAt to the clock so the backfill cannot grant endless retention', async () => {
      const { store, documents } = storeWith({
        [OLD_KEY]: oldDocument({ createdAt: '2031-01-01T00:00:00.000Z' }),
      });

      await store.getMany(UID, ['msg-old']);

      expect(documents[OLD_KEY]?.['expireAt']).toEqual(EXPIRE_AT);
    });

    it('still returns the hit when computing the deadline throws, counting it as a failed backfill', async () => {
      const { firestore } = createFakeFirestore({
        [OLD_KEY]: oldDocument({ createdAt: 'garbage' }),
      });
      const { logger, entries } = captureLogs();
      // An invalid clock makes Timestamp.fromMillis throw a RangeError synchronously.
      const store = createFirestoreSummaryCacheStore(firestore, {
        promptVersion: VERSION,
        now: () => new Date(Number.NaN),
        logger,
      });

      const hits = await store.getMany(UID, ['msg-old']);

      expect(hits.size).toBe(1);
      expect(
        entries.some((entry) => entry.message.includes('backfill failed') && entry['count'] === 1),
      ).toBe(true);
    });

    it('never leaves a backfill rejection unhandled while later chunks are still being read', async () => {
      // 101 ids: the old document is in chunk 1, and chunk 2 (the 101st id) is still being
      // read when chunk 1's backfill rejects. Before the fix that rejection had no handler
      // yet, which Node reports as an unhandled rejection and exits on.
      const ids = ['msg-old', ...Array.from({ length: 100 }, (_, index) => `msg-${index}`)];
      const { firestore } = createFakeFirestore({ [OLD_KEY]: oldDocument() });
      const laggy = {
        collection: (name: string) => ({
          doc: (id: string) => {
            const real = firestore.collection(name).doc(id);
            if (id.endsWith('_msg-old')) {
              return {
                ...real,
                update: () =>
                  new Promise<never>((_, reject) => {
                    setImmediate(() =>
                      reject(Object.assign(new Error('UNAVAILABLE'), { code: 14 })),
                    );
                  }),
              };
            }
            if (id.endsWith('_msg-99')) {
              return {
                ...real,
                get: () =>
                  new Promise<Awaited<ReturnType<typeof real.get>>>((resolve) => {
                    setImmediate(() => setImmediate(() => void real.get().then(resolve)));
                  }),
              };
            }
            return real;
          },
        }),
      };
      const unhandled = vi.fn();
      process.on('unhandledRejection', unhandled);
      const { logger, entries } = captureLogs();
      const store = createFirestoreSummaryCacheStore(laggy, {
        promptVersion: VERSION,
        now: () => NOW,
        logger,
      });

      try {
        const hits = await store.getMany(UID, ids);
        await new Promise((resolve) => setImmediate(resolve));

        expect(hits.size).toBe(1);
        expect(unhandled).not.toHaveBeenCalled();
        expect(entries.some((entry) => entry.message.includes('backfill failed'))).toBe(true);
      } finally {
        process.off('unhandledRejection', unhandled);
      }
    });
  });

  it('does not serve results cached under an older prompt version', async () => {
    const { firestore } = createFakeFirestore();
    const oldStore = createFirestoreSummaryCacheStore(firestore, { promptVersion: 'digest-v0' });
    await oldStore.setMany(UID, [{ ...cacheable('msg-1'), promptVersion: 'digest-v0' }]);
    const newStore = createFirestoreSummaryCacheStore(firestore, { promptVersion: VERSION });

    const hits = await newStore.getMany(UID, ['msg-1']);

    expect(hits.size).toBe(0);
  });

  it('treats an invalid stored document as a miss and reports the message id', async () => {
    const warned: Record<string, unknown>[] = [];
    const logger = {
      debug: () => undefined,
      info: () => undefined,
      warn: (_message: string, fields?: Record<string, unknown>) => void warned.push(fields ?? {}),
      error: () => undefined,
      child: () => logger,
    };
    const { firestore } = createFakeFirestore({
      [`emailSummaries/${UID}_${VERSION}_msg-1`]: {
        messageId: 'msg-1',
        category: 'not-a-category',
      },
    });
    const store = createFirestoreSummaryCacheStore(firestore, {
      promptVersion: VERSION,
      logger,
    });

    const hits = await store.getMany(UID, ['msg-1']);

    expect(hits.size).toBe(0);
    expect(warned).toEqual([{ messageId: 'msg-1' }]);
  });

  it('treats a document whose stored messageId disagrees with its key as a miss', async () => {
    const { store } = storeWith({
      [`emailSummaries/${UID}_${VERSION}_msg-1`]: storedDocument('msg-other'),
    });

    const hits = await store.getMany(UID, ['msg-1']);

    expect(hits.size).toBe(0);
  });

  it('strips directional format controls from summaries read back from storage', async () => {
    const { store } = storeWith({
      [`emailSummaries/${UID}_${VERSION}_msg-1`]: storedDocument('msg-1', {
        summary: '‮ማጠቃለያ‬',
      }),
    });

    const hits = await store.getMany(UID, ['msg-1']);

    expect(hits.get('msg-1')?.summary).toBe('ማጠቃለያ');
  });

  it('rejects a prompt version outside the safe document-id charset at construction', () => {
    const { firestore } = createFakeFirestore();
    expect(() =>
      createFirestoreSummaryCacheStore(firestore, { promptVersion: 'digest/v1' }),
    ).toThrow('promptVersion');
  });

  it('refuses ids that could escape the per-user document keying', async () => {
    const { store, documents } = storeWith();

    await store.setMany(UID, [cacheable('msg/../other')]);
    const hits = await store.getMany(UID, ['msg/../other']);

    expect(Object.keys(documents)).toHaveLength(0);
    expect(hits.size).toBe(0);
  });

  it('keeps the first write when a concurrent run already cached the summary', async () => {
    const { store, documents } = storeWith();

    await store.setMany(UID, [cacheable('msg-1')]);
    await store.setMany(UID, [{ ...cacheable('msg-1'), summary: 'ሌላ ማጠቃለያ' }]);

    expect(documents[`emailSummaries/${UID}_${VERSION}_msg-1`]).toMatchObject({
      summary: 'የባንክ መግለጫዎ ደርሷል።',
    });
  });

  it('attempts every write before surfacing a storage failure', async () => {
    const { firestore, documents } = createFakeFirestore();
    const failing = {
      collection: (name: string) => ({
        doc: (id: string) => {
          const real = firestore.collection(name).doc(id);
          return id.endsWith('msg-bad')
            ? {
                ...real,
                create: () => Promise.reject(Object.assign(new Error('UNAVAILABLE'), { code: 14 })),
              }
            : real;
        },
      }),
    };
    const store = createFirestoreSummaryCacheStore(failing, { promptVersion: VERSION });

    await expect(store.setMany(UID, [cacheable('msg-bad'), cacheable('msg-good')])).rejects.toThrow(
      'UNAVAILABLE',
    );
    expect(documents[`emailSummaries/${UID}_${VERSION}_msg-good`]).toBeDefined();
  });
});
