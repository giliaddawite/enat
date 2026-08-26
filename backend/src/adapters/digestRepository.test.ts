import { describe, expect, it } from 'vitest';
import type { Digest } from '../domain/digest.js';
import { createFakeFirestore } from '../testing/fakeFirestore.js';
import { createFirestoreDigestStore } from './digestRepository.js';

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

describe('createFirestoreDigestStore', () => {
  it('returns null when no digest exists for the day', async () => {
    const { firestore } = createFakeFirestore();
    const store = createFirestoreDigestStore(firestore);

    await expect(store.get('uid-1', '2026-08-17')).resolves.toBeNull();
  });

  it('round-trips a saved digest', async () => {
    const { firestore, documents } = createFakeFirestore();
    const store = createFirestoreDigestStore(firestore);

    await store.save(DIGEST);

    expect(documents['digests/uid-1_2026-08-17']).toBeDefined();
    await expect(store.get('uid-1', '2026-08-17')).resolves.toEqual(DIGEST);
  });

  it('updates rather than duplicates when saved again for the same day', async () => {
    const { firestore, documents } = createFakeFirestore();
    const store = createFirestoreDigestStore(firestore);

    await store.save(DIGEST);
    const updated: Digest = { ...DIGEST, emailCount: 2, generatedAt: '2026-08-17T07:00:00.000Z' };
    await store.save(updated);

    expect(Object.keys(documents)).toEqual(['digests/uid-1_2026-08-17']);
    await expect(store.get('uid-1', '2026-08-17')).resolves.toEqual(updated);
  });

  it('keeps two users on the same day in separate documents', async () => {
    const { firestore } = createFakeFirestore();
    const store = createFirestoreDigestStore(firestore);

    await store.save(DIGEST);
    await store.save({ ...DIGEST, userId: 'uid-2', emailCount: 9 });

    await expect(store.get('uid-1', '2026-08-17')).resolves.toMatchObject({ emailCount: 1 });
    await expect(store.get('uid-2', '2026-08-17')).resolves.toMatchObject({ emailCount: 9 });
  });

  it('treats a document that fails schema validation as absent', async () => {
    const { firestore } = createFakeFirestore({
      'digests/uid-1_2026-08-17': { date: '2026-08-17', userId: 'uid-1' },
    });
    const store = createFirestoreDigestStore(firestore);

    await expect(store.get('uid-1', '2026-08-17')).resolves.toBeNull();
  });

  it('treats a document whose key disagrees with its content as absent', async () => {
    const { firestore } = createFakeFirestore({
      'digests/uid-1_2026-08-17': { ...DIGEST, userId: 'someone-else' },
    });
    const store = createFirestoreDigestStore(firestore);

    await expect(store.get('uid-1', '2026-08-17')).resolves.toBeNull();
  });

  it('rejects a uid or date outside the safe-id shape rather than building a path from it', async () => {
    const { firestore } = createFakeFirestore();
    const store = createFirestoreDigestStore(firestore);

    await expect(store.get('../escape', '2026-08-17')).resolves.toBeNull();
    await expect(store.save({ ...DIGEST, userId: '../escape' })).rejects.toThrow(
      /safe-id shape check/,
    );
  });
});
