import { z } from 'zod';
import { newUserRecord, type User } from '../domain/user.js';

export interface UsersRepository {
  /** Returns the user for this Google identity, creating a record on first sign-in. */
  findOrCreateByGoogleId(identity: {
    readonly googleUserId: string;
    readonly email: string;
  }): Promise<User>;
  /** Looks up a user by uid without creating one — for callers that already have a uid
   * from somewhere other than a freshly-verified ID token (TICKET-105's Pub/Sub push
   * handler, given a uid in the scheduled message rather than a bearer token). */
  getById(uid: string): Promise<User | null>;
}

/**
 * The slice of the Firestore client SDK this adapter needs, named narrowly so a test can
 * satisfy it with an in-memory fake instead of a real Firestore connection. A real
 * `@google-cloud/firestore` `Firestore` instance satisfies this structurally.
 */
export interface FirestoreLike {
  collection(name: string): FirestoreCollectionLike;
}

export interface FirestoreCollectionLike {
  doc(id: string): FirestoreDocumentLike;
}

export interface FirestoreDocumentLike {
  get(): Promise<FirestoreSnapshotLike>;
  /** Must reject if a document already exists at this path — used to resolve the race
   * between two concurrent first-sign-in requests without a transaction. */
  create(data: Record<string, unknown>): Promise<unknown>;
  /** Merges `data` into an existing document. */
  update(data: Record<string, unknown>): Promise<unknown>;
}

export interface FirestoreSnapshotLike {
  readonly exists: boolean;
  data(): Record<string, unknown> | undefined;
}

const UserDocument = z.object({
  uid: z.string().min(1),
  email: z.string().email(),
  createdAt: z.string().min(1),
  locale: z.string().min(1),
  refreshTokenRef: z.string().nullable(),
});

const USERS_COLLECTION = 'users';

/** The gRPC status code Firestore raises from `create()` on a conflicting document. */
const FIRESTORE_ALREADY_EXISTS_CODE = 6;

export function createFirestoreUsersRepository(
  firestore: FirestoreLike,
  now: () => Date = () => new Date(),
): UsersRepository {
  const users = firestore.collection(USERS_COLLECTION);

  return {
    async findOrCreateByGoogleId(identity) {
      const ref = users.doc(identity.googleUserId);
      const existing = await ref.get();
      if (existing.exists) {
        return reconcileEmail(ref, parseUserDocument(existing.data()), identity.email);
      }

      const user = newUserRecord(identity, now);
      try {
        // `User` has no index signature, but every field is a plain writable value; this
        // reflects that shape difference, not an escape from the domain type.
        await ref.create(user as unknown as Record<string, unknown>);
        return user;
      } catch (error) {
        if (!isAlreadyExists(error)) {
          throw error;
        }
        // Lost the race to a concurrent first sign-in; the winner's record is authoritative.
        const created = await ref.get();
        return reconcileEmail(ref, parseUserDocument(created.data()), identity.email);
      }
    },

    async getById(uid) {
      const snapshot = await users.doc(uid).get();
      if (!snapshot.exists) {
        return null;
      }
      return parseUserDocument(snapshot.data());
    },
  };
}

/**
 * The Google account's email can change; the verified token is the source of truth for it,
 * not the document written at first sign-in. Only `email` is reconciled — `locale` and
 * `createdAt` belong to us, and `refreshTokenRef` to the consent flow.
 */
async function reconcileEmail(
  ref: FirestoreDocumentLike,
  stored: User,
  verifiedEmail: string,
): Promise<User> {
  if (stored.email === verifiedEmail) {
    return stored;
  }
  await ref.update({ email: verifiedEmail });
  return { ...stored, email: verifiedEmail };
}

function parseUserDocument(data: Record<string, unknown> | undefined): User {
  const result = UserDocument.safeParse(data);
  if (!result.success) {
    // Deliberately no field values in the message — a corrupt document may hold a partial
    // email address or other user data that must not reach a log line.
    throw new Error('users document failed schema validation', { cause: result.error });
  }
  return result.data;
}

function isAlreadyExists(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const { code } = error as { code?: unknown };
  return code === FIRESTORE_ALREADY_EXISTS_CODE;
}
