import { describe, expect, it } from 'vitest';
import type { CacheableEmailSummary } from '../domain/summary.js';
import { createFakeFirestore } from '../testing/fakeFirestore.js';
import { createFirestoreSummaryCacheStore } from './summaryCacheRepository.js';

const UID = 'google-user-123';
const NOW = new Date('2026-08-25T12:00:00.000Z');

function cacheable(messageId: string): CacheableEmailSummary {
  return {
    messageId,
    category: 'bills_accounts',
    summary: 'የባንክ መግለጫዎ ደርሷል።',
    urgent: false,
    source: 'llm',
    promptVersion: 'digest-v1',
  };
}

describe('createFirestoreSummaryCacheStore', () => {
  it('round-trips a stored summary, marked as a cache hit', async () => {
    const { firestore } = createFakeFirestore();
    const store = createFirestoreSummaryCacheStore(firestore, { now: () => NOW });

    await store.setMany(UID, [cacheable('msg-1')]);
    const hits = await store.getMany(UID, ['msg-1', 'msg-2']);

    expect(hits.size).toBe(1);
    expect(hits.get('msg-1')).toEqual({ ...cacheable('msg-1'), source: 'cache' });
  });

  it('keys documents per user, so another user never sees the summary', async () => {
    const { firestore, documents } = createFakeFirestore();
    const store = createFirestoreSummaryCacheStore(firestore, { now: () => NOW });

    await store.setMany(UID, [cacheable('msg-1')]);

    expect(documents[`emailSummaries/${UID}_msg-1`]).toMatchObject({
      messageId: 'msg-1',
      createdAt: NOW.toISOString(),
    });
    const otherUser = await store.getMany('someone-else', ['msg-1']);
    expect(otherUser.size).toBe(0);
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
      [`emailSummaries/${UID}_msg-1`]: { messageId: 'msg-1', category: 'not-a-category' },
    });
    const store = createFirestoreSummaryCacheStore(firestore, { logger });

    const hits = await store.getMany(UID, ['msg-1']);

    expect(hits.size).toBe(0);
    expect(warned).toEqual([{ messageId: 'msg-1' }]);
  });

  it('keeps the first write when a concurrent run already cached the summary', async () => {
    const { firestore, documents } = createFakeFirestore();
    const store = createFirestoreSummaryCacheStore(firestore, { now: () => NOW });

    await store.setMany(UID, [cacheable('msg-1')]);
    await store.setMany(UID, [{ ...cacheable('msg-1'), summary: 'ሌላ ማጠቃለያ' }]);

    expect(documents[`emailSummaries/${UID}_msg-1`]).toMatchObject({
      summary: 'የባንክ መግለጫዎ ደርሷል።',
    });
  });

  it('rethrows storage failures other than the already-exists conflict', async () => {
    const { firestore } = createFakeFirestore();
    const failing = {
      collection: (name: string) => ({
        doc: (id: string) => ({
          ...firestore.collection(name).doc(id),
          create: () => Promise.reject(Object.assign(new Error('UNAVAILABLE'), { code: 14 })),
        }),
      }),
    };
    const store = createFirestoreSummaryCacheStore(failing);

    await expect(store.setMany(UID, [cacheable('msg-1')])).rejects.toThrow('UNAVAILABLE');
  });
});
