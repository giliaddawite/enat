import { Firestore } from '@google-cloud/firestore';

/**
 * Constructs the real Firestore client for `createFirestoreUsersRepository`. Kept to one
 * line so the only thing worth testing about it — that it is never called at import time,
 * which would slow boot — is enforced by nothing in this file doing work at module scope.
 *
 * `projectId` is optional outside production (mirroring `Config.gcpProjectId`); the SDK
 * then resolves the project from Application Default Credentials or the emulator env.
 */
export function createFirestoreClient(projectId?: string): Firestore {
  return new Firestore(projectId ? { projectId } : {});
}
