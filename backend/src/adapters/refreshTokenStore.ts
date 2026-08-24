import type { Logger } from '../logging/logger.js';

/**
 * Stores and retrieves Gmail OAuth refresh tokens encrypted at rest via Secret Manager —
 * never as plaintext in Firestore or anywhere else. See `docs/privacy.md` for the key
 * rotation policy this adapter implements (a new secret version per token rotation, prior
 * versions destroyed; the encryption key itself is Google-managed and rotates
 * transparently).
 */
export interface RefreshTokenStore {
  /**
   * Encrypts and stores `refreshToken`, returning the reference to persist on the user's
   * Firestore record (`refreshTokenRef`). Calling this again for the same `uid` (e.g. after
   * the user re-runs Gmail consent) adds a new secret version and then destroys the
   * superseded ones, so an old plaintext token does not stay redeemable — or billed —
   * indefinitely. Destruction failures are logged and tolerated: the new token is already
   * safely stored, and the next `put` retries the cleanup because it destroys everything
   * but the version it just wrote.
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
  /** Version resource names of the secret's versions that are still ENABLED. */
  listEnabledSecretVersions(secretId: string): Promise<string[]>;
  /** Irreversibly destroys one version's secret material. */
  destroySecretVersion(versionName: string): Promise<void>;
}

const REFRESH_TOKEN_SECRET_ID_PREFIX = 'gmail-refresh-token-';

/** The gRPC status code Secret Manager raises from `createSecret` on a conflicting id. */
const ALREADY_EXISTS_CODE = 6;

export interface RefreshTokenStoreOptions {
  /** Receives a warning when a superseded version could not be destroyed. */
  readonly logger?: Logger;
}

export function createSecretManagerRefreshTokenStore(
  secretManager: SecretManagerLike,
  options: RefreshTokenStoreOptions = {},
): RefreshTokenStore {
  return {
    async put(uid, refreshToken) {
      const secretId = secretIdForUser(uid);
      await ensureSecretExists(secretManager, secretId);
      const ref = await secretManager.addSecretVersion(secretId, refreshToken);
      await destroySupersededVersions(secretManager, secretId, ref, options.logger);
      return ref;
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
    // rotates its content by adding a version rather than recreating the container.
  }
}

/**
 * Destroys every still-enabled version except the one just written. Listing after the add
 * (rather than remembering one previous ref) also sweeps up versions an earlier failed
 * cleanup left behind. A failure here must not fail the `put`: the new token is stored and
 * its ref is what the caller persists — losing that over a cleanup error would strand the
 * user with a working token no record points to.
 */
async function destroySupersededVersions(
  secretManager: SecretManagerLike,
  secretId: string,
  currentRef: string,
  logger: Logger | undefined,
): Promise<void> {
  let superseded: string[];
  try {
    superseded = (await secretManager.listEnabledSecretVersions(secretId)).filter(
      (version) => version !== currentRef,
    );
  } catch (error) {
    logRetirementFailure(logger, error);
    return;
  }
  for (const version of superseded) {
    try {
      await secretManager.destroySecretVersion(version);
    } catch (error) {
      logRetirementFailure(logger, error);
    }
  }
}

/**
 * Deliberately logs only the error's name and status code, not its message: Google API
 * error messages embed the resource name, which for these secrets contains the uid.
 */
function logRetirementFailure(logger: Logger | undefined, error: unknown): void {
  const name = error instanceof Error ? error.name : 'NonError';
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  logger?.warn('failed to destroy a superseded refresh token version', {
    error: { name, ...(code !== undefined ? { code } : {}) },
  });
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
