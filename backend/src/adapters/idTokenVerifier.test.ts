import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { createGoogleIdTokenVerifier, IdTokenRejectedError } from './idTokenVerifier.js';

const AUDIENCE = 'mom-android-app.apps.googleusercontent.com';
const OTHER_AUDIENCE = 'some-other-client.apps.googleusercontent.com';
const ISSUER = 'https://accounts.google.com';

interface KeySet {
  sign(claims: Record<string, unknown>, options?: SignOptions): Promise<string>;
  readonly jwks: ReturnType<typeof createLocalJWKSet>;
  wrongKeySign(claims: Record<string, unknown>): Promise<string>;
}

interface SignOptions {
  readonly issuer?: string;
  readonly audience?: string;
  readonly expiresInSeconds?: number;
  readonly issuedAtSecondsAgo?: number;
}

async function buildKeySet(): Promise<KeySet> {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const { privateKey: wrongPrivateKey } = await generateKeyPair('RS256');
  const jwk: JWK = { ...(await exportJWK(publicKey)), alg: 'RS256', use: 'sig', kid: 'test-key' };
  const jwks = createLocalJWKSet({ keys: [jwk] });

  const sign = (claims: Record<string, unknown>, options: SignOptions = {}): Promise<string> => {
    const now = Math.floor(Date.now() / 1000) - (options.issuedAtSecondsAgo ?? 0);
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuedAt(now)
      .setExpirationTime(now + (options.expiresInSeconds ?? 3600))
      .setIssuer(options.issuer ?? ISSUER)
      .setAudience(options.audience ?? AUDIENCE)
      .sign(privateKey);
  };

  // Signed by a key never published in `jwks`, simulating a forged token.
  const wrongKeySign = (claims: Record<string, unknown>): Promise<string> =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .sign(wrongPrivateKey);

  return { sign, jwks, wrongKeySign };
}

const VALID_CLAIMS = {
  sub: 'google-user-123',
  email: 'mom@example.com',
  email_verified: true,
};

describe('createGoogleIdTokenVerifier', () => {
  let keys: KeySet;

  beforeAll(async () => {
    keys = await buildKeySet();
  });

  function verifier() {
    return createGoogleIdTokenVerifier({ audience: [AUDIENCE], jwks: keys.jwks });
  }

  it('accepts a validly signed token for the configured audience and returns its claims', async () => {
    const token = await keys.sign(VALID_CLAIMS);

    await expect(verifier().verify(token)).resolves.toEqual({
      googleUserId: 'google-user-123',
      email: 'mom@example.com',
      emailVerified: true,
    });
  });

  it('defaults emailVerified to false when Google omits the claim', async () => {
    const token = await keys.sign({ sub: 'google-user-123', email: 'mom@example.com' });

    await expect(verifier().verify(token)).resolves.toMatchObject({ emailVerified: false });
  });

  it('accepts either form of the Google issuer', async () => {
    const token = await keys.sign(VALID_CLAIMS, { issuer: 'accounts.google.com' });

    await expect(verifier().verify(token)).resolves.toBeDefined();
  });

  it('rejects an expired token', async () => {
    const token = await keys.sign(VALID_CLAIMS, { expiresInSeconds: -10, issuedAtSecondsAgo: 20 });

    const error = await verifier()
      .verify(token)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(IdTokenRejectedError);
    expect((error as IdTokenRejectedError).reason).toBe('expired_token');
  });

  it('rejects a token issued for a different OAuth client', async () => {
    const token = await keys.sign(VALID_CLAIMS, { audience: OTHER_AUDIENCE });

    const error = await verifier()
      .verify(token)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(IdTokenRejectedError);
    expect((error as IdTokenRejectedError).reason).toBe('wrong_audience');
  });

  it('rejects a token from an unrecognized issuer', async () => {
    const token = await keys.sign(VALID_CLAIMS, { issuer: 'https://not-google.example' });

    const error = await verifier()
      .verify(token)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(IdTokenRejectedError);
    expect((error as IdTokenRejectedError).reason).toBe('malformed_token');
  });

  it('rejects a token signed by a key Google never published', async () => {
    const token = await keys.wrongKeySign(VALID_CLAIMS);

    const error = await verifier()
      .verify(token)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(IdTokenRejectedError);
    expect((error as IdTokenRejectedError).reason).toBe('invalid_signature');
  });

  it('rejects a malformed, non-JWT string without throwing an unhandled error', async () => {
    const error = await verifier()
      .verify('not-a-jwt-at-all')
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(IdTokenRejectedError);
    expect((error as IdTokenRejectedError).reason).toBe('malformed_token');
  });

  it('rejects an empty string', async () => {
    const error = await verifier()
      .verify('')
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(IdTokenRejectedError);
  });

  it('rejects a well-formed token whose claims fail the payload schema', async () => {
    const token = await keys.sign({ sub: 'google-user-123', email: 'not-an-email' });

    const error = await verifier()
      .verify(token)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(IdTokenRejectedError);
    expect((error as IdTokenRejectedError).reason).toBe('invalid_claims');
  });

  it('never puts the raw token in the rejection message', async () => {
    const token = await keys.sign(VALID_CLAIMS, { expiresInSeconds: -10, issuedAtSecondsAgo: 20 });

    const error = (await verifier()
      .verify(token)
      .catch((caught: unknown) => caught)) as IdTokenRejectedError;

    expect(error.message).not.toContain(token);
  });
});
