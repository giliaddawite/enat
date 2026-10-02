import { Timestamp } from '@google-cloud/firestore';
import { describe, expect, it } from 'vitest';
import type { Digest } from '../domain/digest.js';
import { createFakeFirestore } from '../testing/fakeFirestore.js';
import { createFirestoreDigestStore, DIGEST_RETENTION_DAYS } from './digestRepository.js';

const NOW = new Date('2026-08-17T06:30:00.000Z');
const EXPIRE_AT = Timestamp.fromDate(new Date('2026-09-16T06:30:00.000Z'));

const DIGEST: Digest = {
  date: '2026-08-17',
  userId: 'uid-1',
  sections: [
    {
      category: 'important',
      items: [
        {
          messageId: 'msg-1',
          from: 'church@example.org',
          subject: 'Sunday service',
          summary: 'የቤተ ክርስቲያን ማስታወቂያ',
          urgent: false,
          receivedAt: '2026-08-17T09:00:00.000Z',
        },
      ],
    },
  ],
  generatedAt: '2026-08-17T06:30:00.000Z',
  emailCount: 1,
};

/** What a well-formed document looks like in storage: the digest plus its TTL field. */
function storedDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...DIGEST, expireAt: EXPIRE_AT, ...overrides };
}

function storeWith(seed: Record<string, Record<string, unknown>> = {}) {
  const { firestore, documents } = createFakeFirestore(seed);
  const store = createFirestoreDigestStore(firestore, { now: () => NOW });
  return { store, documents };
}

describe('createFirestoreDigestStore', () => {
  it('returns null when no digest exists for the day', async () => {
    const { store } = storeWith();

    await expect(store.get('uid-1', '2026-08-17')).resolves.toBeNull();
  });

  it('round-trips a saved digest', async () => {
    const { store, documents } = storeWith();

    await store.save(DIGEST);

    expect(documents['digests/uid-1_2026-08-17']).toBeDefined();
    await expect(store.get('uid-1', '2026-08-17')).resolves.toEqual(DIGEST);
  });

  it(`stamps every saved digest with an expireAt ${DIGEST_RETENTION_DAYS} days out, from the injected clock`, async () => {
    const { store, documents } = storeWith();

    await store.save(DIGEST);

    expect(DIGEST_RETENTION_DAYS).toBe(30);
    expect(documents['digests/uid-1_2026-08-17']?.['expireAt']).toEqual(EXPIRE_AT);
  });

  it('updates rather than duplicates when saved again for the same day', async () => {
    const { store, documents } = storeWith();

    await store.save(DIGEST);
    const updated: Digest = { ...DIGEST, emailCount: 2, generatedAt: '2026-08-17T07:00:00.000Z' };
    await store.save(updated);

    expect(Object.keys(documents)).toEqual(['digests/uid-1_2026-08-17']);
    await expect(store.get('uid-1', '2026-08-17')).resolves.toEqual(updated);
  });

  it('keeps two users on the same day in separate documents', async () => {
    const { store } = storeWith();

    await store.save(DIGEST);
    await store.save({ ...DIGEST, userId: 'uid-2', emailCount: 9 });

    await expect(store.get('uid-1', '2026-08-17')).resolves.toMatchObject({ emailCount: 1 });
    await expect(store.get('uid-2', '2026-08-17')).resolves.toMatchObject({ emailCount: 9 });
  });

  it('treats a document that fails schema validation as absent', async () => {
    const { store } = storeWith({
      'digests/uid-1_2026-08-17': { date: '2026-08-17', userId: 'uid-1' },
    });

    await expect(store.get('uid-1', '2026-08-17')).resolves.toBeNull();
  });

  it('treats a document written without a retention stamp as absent, so it is regenerated with one', async () => {
    const { store } = storeWith({ 'digests/uid-1_2026-08-17': { ...DIGEST } });

    await expect(store.get('uid-1', '2026-08-17')).resolves.toBeNull();
  });

  it('treats a document whose key disagrees with its content as absent', async () => {
    const { store } = storeWith({
      'digests/uid-1_2026-08-17': storedDocument({ userId: 'someone-else' }),
    });

    await expect(store.get('uid-1', '2026-08-17')).resolves.toBeNull();
  });

  it('rejects a uid or date outside the safe-id shape rather than building a path from it', async () => {
    const { store } = storeWith();

    await expect(store.get('../escape', '2026-08-17')).resolves.toBeNull();
    await expect(store.save({ ...DIGEST, userId: '../escape' })).rejects.toThrow(
      /safe-id shape check/,
    );
  });
});
