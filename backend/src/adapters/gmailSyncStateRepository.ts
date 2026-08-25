import { z } from 'zod';
import type { GmailSyncStateStore } from '../domain/gmailSync.js';
import type { Logger } from '../logging/logger.js';
import type { FirestoreLike } from './usersRepository.js';

/**
 * Persists the per-user Gmail `historyId` watermark between syncs. Its own collection,
 * keyed by uid, rather than a field on the users document: sync state is written on every
 * sync and owned by ingestion, while the users document is owned by auth — keeping them
 * apart means neither write path can clobber the other's fields.
 */
const SYNC_STATE_COLLECTION = 'gmailSyncState';

const SyncStateDocument = z.object({
  historyId: z.string().min(1),
  updatedAt: z.string().min(1),
});

/** The gRPC status code Firestore raises from `create()` on a conflicting document. */
const FIRESTORE_ALREADY_EXISTS_CODE = 6;

export interface GmailSyncStateRepositoryOptions {
  readonly now?: () => Date;
  /** Receives a warning when a stored document is invalid; never document contents. */
  readonly logger?: Logger;
}

export function createFirestoreGmailSyncStateStore(
  firestore: FirestoreLike,
  options: GmailSyncStateRepositoryOptions = {},
): GmailSyncStateStore {
  const now = options.now ?? (() => new Date());
  const collection = firestore.collection(SYNC_STATE_COLLECTION);

  return {
    async getHistoryId(uid) {
      const snapshot = await collection.doc(uid).get();
      if (!snapshot.exists) {
        return null;
      }
      const parsed = SyncStateDocument.safeParse(snapshot.data());
      if (!parsed.success) {
        // A corrupt watermark must not wedge sync forever; treating it as absent forces a
        // full sync, which rewrites the document — self-healing rather than fatal.
        options.logger?.warn('gmail sync state document invalid; forcing a full sync', { uid });
        return null;
      }
      return parsed.data.historyId;
    },

    async setHistoryId(uid, historyId) {
      const document = collection.doc(uid);
      const data = { historyId, updatedAt: now().toISOString() };
      try {
        await document.create(data);
      } catch (error) {
        if (!isAlreadyExists(error)) {
          throw error;
        }
        await document.update(data);
      }
    },
  };
}

function isAlreadyExists(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const { code } = error as { code?: unknown };
  return code === FIRESTORE_ALREADY_EXISTS_CODE;
}
