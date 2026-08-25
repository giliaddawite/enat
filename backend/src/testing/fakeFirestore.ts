import type { FirestoreDocumentLike, FirestoreLike } from '../adapters/usersRepository.js';

/**
 * An in-memory `FirestoreLike` with real create/update semantics (create rejects on
 * conflict with code 6, update on a missing document with code 5), for tests that only
 * need honest storage behavior. Tests that script per-call failures keep their own fakes.
 */
export function createFakeFirestore(seed: Record<string, Record<string, unknown>> = {}): {
  firestore: FirestoreLike;
  documents: Record<string, Record<string, unknown>>;
} {
  const documents: Record<string, Record<string, unknown>> = { ...seed };

  const firestore: FirestoreLike = {
    collection(name) {
      return {
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
                return Promise.reject(Object.assign(new Error('ALREADY_EXISTS'), { code: 6 }));
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
    },
  };

  return { firestore, documents };
}
