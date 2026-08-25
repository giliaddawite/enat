import { describe, expect, it } from 'vitest';
import type { CacheableEmailSummary } from '../domain/summary.js';
import { createFakeFirestore } from '../testing/fakeFirestore.js';
import { createFirestoreSummaryCacheStore } from './summaryCacheRepository.js';

const UID = 'google-user-123';
const NOW = new Date('2026-08-25T12:00:00.000Z');
const VERSION = 'digest-v1';

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
      [`emailSummaries/${UID}_${VERSION}_msg-1`]: { messageId: 'msg-1', category: 'not-a-category' },
    });
    const store = createFirestoreSummaryCacheStore(firestore, {
      promptVersion: VERSION,
      logger,
    });

    const hits = await store.getMany(UID, ['msg-1']);

    expect(hits.size).toBe(0);
    expect(warned).toEqual([{ messageId: 'msg-1' }]);
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
                create: () =>
                  Promise.reject(Object.assign(new Error('UNAVAILABLE'), { code: 14 })),
              }
            : real;
        },
      }),
    };
    const store = createFirestoreSummaryCacheStore(failing, { promptVersion: VERSION });

    await expect(
      store.setMany(UID, [cacheable('msg-bad'), cacheable('msg-good')]),
    ).rejects.toThrow('UNAVAILABLE');
    expect(documents[`emailSummaries/${UID}_${VERSION}_msg-good`]).toBeDefined();
  });
});
