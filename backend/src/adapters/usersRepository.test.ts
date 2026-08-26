import { describe, expect, it } from 'vitest';
import type { User } from '../domain/user.js';
import {
  createFirestoreUsersRepository,
  type FirestoreLike,
  type FirestoreDocumentLike,
} from './usersRepository.js';

/** An in-memory Firestore fake — just enough surface for the adapter under test. */
function fakeFirestore(seed: Record<string, Record<string, unknown>> = {}): {
  firestore: FirestoreLike;
  documents: Record<string, Record<string, unknown>>;
} {
  const documents: Record<string, Record<string, unknown>> = { ...seed };
  // Cached per name (as a real Firestore client effectively is) so a test can mutate a
  // collection's `doc` behavior and have the repository, constructed afterwards, see it.
  const collections: Record<string, ReturnType<FirestoreLike['collection']>> = {};

  const firestore: FirestoreLike = {
    collection(name) {
      collections[name] ??= {
        doc(id): FirestoreDocumentLike {
          const key = `${name}/${id}`;
          return {
            get: () =>
              Promise.resolve({
                exists: key in documents,
                data: () => documents[key],
              }),
            create: (data) => {
              if (key in documents) {
                return Promise.reject(
                  Object.assign(new Error('ALREADY_EXISTS'), { code: 6 }),
                );
              }
              documents[key] = data;
              return Promise.resolve(undefined);
            },
            update: (data) => {
              const current = documents[key];
              if (current === undefined) {
                return Promise.reject(Object.assign(new Error('NOT_FOUND'), { code: 5 }));
              }
              documents[key] = { ...current, ...data };
              return Promise.resolve(undefined);
            },
          };
        },
      };
      return collections[name];
    },
  };

  return { firestore, documents };
}

const NOW = () => new Date('2026-08-17T12:00:00.000Z');
const IDENTITY = { googleUserId: 'google-user-123', email: 'mom@example.com' };

describe('createFirestoreUsersRepository', () => {
  it('creates a new user record on first sign-in', async () => {
    const { firestore, documents } = fakeFirestore();
    const repository = createFirestoreUsersRepository(firestore, NOW);

    const user = await repository.findOrCreateByGoogleId(IDENTITY);

    expect(user).toEqual<User>({
      uid: 'google-user-123',
      email: 'mom@example.com',
      createdAt: '2026-08-17T12:00:00.000Z',
      locale: 'am',
      refreshTokenRef: null,
    });
    expect(documents['users/google-user-123']).toEqual(user);
  });

  it('returns the existing record on a later sign-in without overwriting it', async () => {
    const existing = {
      uid: 'google-user-123',
      email: 'mom@example.com',
      createdAt: '2020-01-01T00:00:00.000Z',
      locale: 'en',
      refreshTokenRef: 'projects/enat/secrets/gmail-refresh-token-google-user-123/versions/2',
    };
    const { firestore, documents } = fakeFirestore({ 'users/google-user-123': existing });
    const repository = createFirestoreUsersRepository(firestore, NOW);

    const user = await repository.findOrCreateByGoogleId(IDENTITY);

    expect(user).toEqual(existing);
    expect(documents['users/google-user-123']).toEqual(existing);
  });

  it('resolves a concurrent first-sign-in race to the winner\'s record', async () => {
    const { firestore, documents } = fakeFirestore();
    const collection = firestore.collection('users');
    const original = collection.doc.bind(collection);
    // Simulate another request creating the document between our get() and create().
    collection.doc = (id) => {
      const doc = original(id);
      return {
        get: () => doc.get(),
        create: (data) => {
          documents[`users/${id}`] = { ...data, createdAt: '2019-01-01T00:00:00.000Z' };
          return Promise.reject(Object.assign(new Error('ALREADY_EXISTS'), { code: 6 }));
        },
        update: (data) => doc.update(data),
      };
    };
    const repository = createFirestoreUsersRepository(firestore, NOW);

    const user = await repository.findOrCreateByGoogleId(IDENTITY);

    expect(user.createdAt).toBe('2019-01-01T00:00:00.000Z');
  });

  it('updates the stored email when the verified token carries a different one', async () => {
    const existing = {
      uid: 'google-user-123',
      email: 'old-address@example.com',
      createdAt: '2020-01-01T00:00:00.000Z',
      locale: 'am',
      refreshTokenRef: null,
    };
    const { firestore, documents } = fakeFirestore({ 'users/google-user-123': existing });
    const repository = createFirestoreUsersRepository(firestore, NOW);

    const user = await repository.findOrCreateByGoogleId(IDENTITY);

    expect(user.email).toBe('mom@example.com');
    expect(documents['users/google-user-123']).toEqual({ ...existing, email: 'mom@example.com' });
  });

  it('leaves createdAt, locale and refreshTokenRef untouched when reconciling the email', async () => {
    const existing = {
      uid: 'google-user-123',
      email: 'old-address@example.com',
      createdAt: '2020-01-01T00:00:00.000Z',
      locale: 'en',
      refreshTokenRef: 'projects/enat/secrets/gmail-refresh-token-google-user-123/versions/7',
    };
    const { firestore } = fakeFirestore({ 'users/google-user-123': existing });
    const repository = createFirestoreUsersRepository(firestore, NOW);

    const user = await repository.findOrCreateByGoogleId(IDENTITY);

    expect(user).toEqual({ ...existing, email: 'mom@example.com' });
  });

  it('rejects a stored document that does not match the user schema', async () => {
    const { firestore } = fakeFirestore({
      'users/google-user-123': { uid: 'google-user-123', email: 'not-an-email' },
    });
    const repository = createFirestoreUsersRepository(firestore, NOW);

    await expect(repository.findOrCreateByGoogleId(IDENTITY)).rejects.toThrow(
      /schema validation/,
    );
  });

  it('getById returns null for a uid with no stored record', async () => {
    const { firestore } = fakeFirestore();
    const repository = createFirestoreUsersRepository(firestore, NOW);

    await expect(repository.getById('no-such-uid')).resolves.toBeNull();
  });

  it('getById returns the stored record without creating one', async () => {
    const existing = {
      uid: 'google-user-123',
      email: 'mom@example.com',
      createdAt: '2020-01-01T00:00:00.000Z',
      locale: 'am',
      refreshTokenRef: 'projects/enat/secrets/gmail-refresh-token-google-user-123/versions/2',
    };
    const { firestore, documents } = fakeFirestore({ 'users/google-user-123': existing });
    const repository = createFirestoreUsersRepository(firestore, NOW);

    await expect(repository.getById('google-user-123')).resolves.toEqual(existing);
    expect(documents['users/google-user-123']).toEqual(existing);
  });

  it('never includes stored field values in a schema-validation error message', async () => {
    const { firestore } = fakeFirestore({
      'users/google-user-123': { uid: 'google-user-123', email: 'super-secret@example.com' },
    });
    const repository = createFirestoreUsersRepository(firestore, NOW);

    const error = await repository
      .findOrCreateByGoogleId(IDENTITY)
      .catch((caught: unknown) => caught);

    expect((error as Error).message).not.toContain('super-secret');
  });
});
