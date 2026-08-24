/**
 * Stores and retrieves Gmail OAuth refresh tokens encrypted at rest via Secret Manager —
 * never as plaintext in Firestore or anywhere else. See `docs/privacy.md` for the key
 * rotation policy this adapter implements (a new secret version per token rotation; the
 * encryption key itself is Google-managed and rotates transparently).
 */
export interface RefreshTokenStore {
  /**
   * Encrypts and stores `refreshToken`, returning the reference to persist on the user's
   * Firestore record (`refreshTokenRef`). Calling this again for the same `uid` (e.g. after
   * the user re-runs Gmail consent) adds a new secret version rather than overwriting one,
   * so a `refreshTokenRef` captured earlier keeps resolving to the token it was issued for.
   */
  put(uid: string, refreshToken: string): Promise<string>;
  /** Decrypts and returns the token a previously issued `refreshTokenRef` points to. */
  get(refreshTokenRef: string): Promise<string>;
}

/**
 * The slice of the Secret Manager client SDK this adapter needs, named narrowly so a test
 * can satisfy it with an in-memory fake instead of a real Secret Manager connection.
 */
export interface SecretManagerLike {
  /** Must reject with `{ code: 6 }` (ALREADY_EXISTS) if the secret container already exists. */
  createSecret(secretId: string): Promise<void>;
  /** Adds a new version to an existing secret container and returns its resource name. */
  addSecretVersion(secretId: string, payload: string): Promise<string>;
  accessSecretVersion(versionName: string): Promise<string>;
}

const REFRESH_TOKEN_SECRET_ID_PREFIX = 'gmail-refresh-token-';

/** The gRPC status code Secret Manager raises from `createSecret` on a conflicting id. */
const ALREADY_EXISTS_CODE = 6;

export function createSecretManagerRefreshTokenStore(
  secretManager: SecretManagerLike,
): RefreshTokenStore {
  return {
    async put(uid, refreshToken) {
      const secretId = secretIdForUser(uid);
      await ensureSecretExists(secretManager, secretId);
      return secretManager.addSecretVersion(secretId, refreshToken);
    },
    get(refreshTokenRef) {
      return secretManager.accessSecretVersion(refreshTokenRef);
    },
  };
}

async function ensureSecretExists(
  secretManager: SecretManagerLike,
  secretId: string,
): Promise<void> {
  try {
    await secretManager.createSecret(secretId);
  } catch (error) {
    if (!isAlreadyExists(error)) {
      throw error;
    }
    // The secret container already exists from an earlier consent grant; addSecretVersion
    // below rotates its content by adding a version rather than recreating the container.
  }
}

function secretIdForUser(uid: string): string {
  return `${REFRESH_TOKEN_SECRET_ID_PREFIX}${uid}`;
}

function isAlreadyExists(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const { code } = error as { code?: unknown };
  return code === ALREADY_EXISTS_CODE;
}
