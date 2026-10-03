import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { IdTokenRejectedError } from './adapters/idTokenVerifier.js';
import { pubSubPushDependencies } from './composition.js';
import { loadConfig } from './config.js';

/**
 * Wiring tests for the composition root (TICKET-306). `buildAppDependencies` constructs
 * real Firestore and Secret Manager clients, so it is not exercised here; the one piece of
 * wiring with a history of drifting — which JWKS the Pub/Sub push verifier is built on — is
 * exported and pinned on its own.
 */

const PUSH_AUDIENCE = 'https://enat-api-staging.example.run.app/internal/digest-generate';
const INVOKER_EMAIL = 'enat-scheduler@enat-staging.iam.gserviceaccount.com';
const INVOKER_CLAIMS = { sub: 'sa-1', email: INVOKER_EMAIL, email_verified: true };

interface SigningKey {
  readonly jwks: ReturnType<typeof createLocalJWKSet>;
  sign(claims: Record<string, unknown>, audience?: string): Promise<string>;
}

/** An RS256 key pair published as a local JWKS, standing in for one `createGoogleJwks()`. */
async function signingKey(): Promise<SigningKey> {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk: JWK = { ...(await exportJWK(publicKey)), alg: 'RS256', use: 'sig', kid: 'test-key' };
  return {
    jwks: createLocalJWKSet({ keys: [jwk] }),
    sign: (claims, audience = PUSH_AUDIENCE) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .setIssuer('https://accounts.google.com')
        .setAudience(audience)
        .sign(privateKey),
  };
}

function pushConfig(overrides: Record<string, string> = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    PUBSUB_PUSH_AUDIENCE: PUSH_AUDIENCE,
    PUBSUB_INVOKER_SERVICE_ACCOUNT_EMAIL: INVOKER_EMAIL,
    ...overrides,
  });
}

describe('pubSubPushDependencies', () => {
  let shared: SigningKey;
  let foreign: SigningKey;

  beforeAll(async () => {
    [shared, foreign] = await Promise.all([signingKey(), signingKey()]);
  });

  it('is undefined when the push subscription is not configured, so the route is not mounted', () => {
    expect(pubSubPushDependencies(loadConfig({ NODE_ENV: 'test' }), shared.jwks)).toBeUndefined();
  });

  it('is undefined when only one of the two push variables is set', () => {
    expect(
      pubSubPushDependencies(pushConfig({ PUBSUB_INVOKER_SERVICE_ACCOUNT_EMAIL: '' }), shared.jwks),
    ).toBeUndefined();
  });

  it('builds the push verifier on the JWKS the composition root hands it', async () => {
    const deps = pubSubPushDependencies(pushConfig(), shared.jwks);

    await expect(deps?.idTokenVerifier.verify(await shared.sign(INVOKER_CLAIMS))).resolves.toEqual({
      googleUserId: 'sa-1',
      email: INVOKER_EMAIL,
      emailVerified: true,
    });
  });

  it('rejects a push token signed by a key the shared JWKS does not hold', async () => {
    const deps = pubSubPushDependencies(pushConfig(), shared.jwks);

    await expect(
      deps?.idTokenVerifier.verify(await foreign.sign(INVOKER_CLAIMS)),
    ).rejects.toBeInstanceOf(IdTokenRejectedError);
  });

  it('pins the token audience to PUBSUB_PUSH_AUDIENCE', async () => {
    const deps = pubSubPushDependencies(pushConfig(), shared.jwks);

    await expect(
      deps?.idTokenVerifier.verify(
        await shared.sign(INVOKER_CLAIMS, 'android-client-id.apps.googleusercontent.com'),
      ),
    ).rejects.toBeInstanceOf(IdTokenRejectedError);
  });

  it('passes the configured invoker email through for verifyPubSubPush to compare against', () => {
    expect(pubSubPushDependencies(pushConfig(), shared.jwks)?.allowedInvokerEmail).toBe(
      INVOKER_EMAIL,
    );
  });
});
