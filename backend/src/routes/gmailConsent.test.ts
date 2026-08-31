import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createGoogleIdTokenSubjectVerifier,
  IdTokenRejectedError,
  type IdTokenVerifier,
} from '../adapters/idTokenVerifier.js';
import { createGoogleAuthCodeExchanger } from '../adapters/googleAuthCodeExchange.js';
import type { UsersRepository } from '../adapters/usersRepository.js';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { DigestGenerationService, DigestStore } from '../domain/digestGeneration.js';
import { createGmailConsentService, type GmailConsentService } from '../domain/gmailConsent.js';
import { createRateLimiter } from '../domain/rateLimiter.js';
import { FALLBACK_VERSE } from '../domain/verse.js';
import {
  captureLogs,
  startTestServer,
  type CapturedLog,
  type TestServer,
} from '../testing/httpTestServer.js';

/**
 * Contract tests for `POST /v1/auth/gmail-consent` (TICKET-202), exercised over a real
 * HTTP server with the real consent service and code-exchange adapter — only Google's
 * token endpoint is faked — so the Android team's contract (204, and the stable codes
 * `invalid_grant` / `no_refresh_token` / `insufficient_scope` / `bad_gateway`) is pinned
 * end to end.
 */

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

const REQUIRED_SCOPES =
  'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify';

const idTokenVerifier: IdTokenVerifier = {
  verify: (token) =>
    token === 'accepted-token'
      ? Promise.resolve({ googleUserId: 'uid-1', email: 'mom@example.com', emailVerified: true })
      : Promise.reject(new IdTokenRejectedError('malformed_token', 'not accepted')),
};

const usersRepositoryBase = {
  findOrCreateByGoogleId: (identity: { googleUserId: string; email: string }) =>
    Promise.resolve({
      uid: identity.googleUserId,
      email: identity.email,
      createdAt: '2020-01-01T00:00:00.000Z',
      locale: 'am',
      refreshTokenRef: null,
    }),
  getById: () => Promise.resolve(null),
};

const digests: DigestStore = {
  get: () => Promise.resolve(null),
  save: () => Promise.resolve(),
};

const digestGeneration: DigestGenerationService = {
  generate: () => Promise.reject(new Error('not exercised by these tests')),
};

function tokenEndpointReturning(responder: () => Response): typeof fetch {
  return () => Promise.resolve(responder());
}

const successExchange = (payload: Record<string, unknown>): typeof fetch =>
  tokenEndpointReturning(
    () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );

interface Harness {
  readonly server: TestServer;
  readonly logs: CapturedLog;
  readonly put: ReturnType<typeof vi.fn>;
  readonly setRefreshTokenRef: ReturnType<typeof vi.fn>;
}

async function serve(tokenEndpoint: typeof fetch): Promise<Harness> {
  const logs = captureLogs();
  const put = vi.fn(() => Promise.resolve('secrets/gmail-refresh-token-uid-1/versions/1'));
  const setRefreshTokenRef = vi.fn(() => Promise.resolve());
  const consent = createGmailConsentService({
    exchangeAuthCode: createGoogleAuthCodeExchanger({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      fetch: tokenEndpoint,
    }),
    // Stands in for real JWT verification: asserts uid-1 for the fixture id_token, null
    // (does not verify) for anything else — the shape index.ts's wiring produces.
    verifyConsentIdToken: (idToken) =>
      Promise.resolve(idToken === 'id-token-for-uid-1' ? 'uid-1' : null),
    refreshTokens: { put },
    users: { setRefreshTokenRef },
    logger: logs.logger,
  });
  return serveWithService(consent, { put, setRefreshTokenRef, logs });
}

async function serveWithService(
  consent: GmailConsentService,
  harness?: Pick<Harness, 'put' | 'setRefreshTokenRef' | 'logs'>,
): Promise<Harness> {
  const put = harness?.put ?? vi.fn();
  const setRefreshTokenRef = harness?.setRefreshTokenRef ?? vi.fn();
  const usersRepository: UsersRepository = { ...usersRepositoryBase, setRefreshTokenRef };
  const logs = harness?.logs ?? captureLogs();
  server = await startTestServer(
    createApp({
      config: loadConfig({ NODE_ENV: 'test' }),
      logger: logs.logger,
      idTokenVerifier,
      usersRepository,
      rateLimiter: createRateLimiter({ limit: 60, windowMs: 60_000, now: () => 0 }),
      digests,
      digestGeneration,
      gmailConsent: consent,
      verses: { verseFor: () => FALLBACK_VERSE },
    }),
  );
  return { server, logs, put, setRefreshTokenRef };
}

function post(running: TestServer, body: string | undefined, token = 'accepted-token') {
  return running.fetch('/v1/auth/gmail-consent', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body }),
  });
}

describe('POST /v1/auth/gmail-consent', () => {
  it('exchanges the code, stores the refresh token, links the ref, answers 204 with no body', async () => {
    const harness = await serve(
      successExchange({
        refresh_token: 'refresh-token-secret',
        scope: REQUIRED_SCOPES,
        id_token: 'id-token-for-uid-1',
      }),
    );

    const response = await post(harness.server, JSON.stringify({ authCode: 'one-time-code' }));

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(harness.put).toHaveBeenCalledWith('uid-1', 'refresh-token-secret');
    expect(harness.setRefreshTokenRef).toHaveBeenCalledWith(
      'uid-1',
      'secrets/gmail-refresh-token-uid-1/versions/1',
    );
  });

  it('accepts an id_token that omits the email claim — real JWT through the real subject verifier', async () => {
    // Regression for the on-device failure: the Android authorization requests only
    // `openid` + the Gmail scopes (no `email` scope), so the exchange id_token may carry
    // a subject and no email. Verification must bind on `sub` alone. This test runs a
    // really signed JWT through `createGoogleIdTokenSubjectVerifier`, wired the way
    // index.ts wires it, instead of the string-compare fake the other tests use.
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const jwk: JWK = { ...(await exportJWK(publicKey)), alg: 'RS256', use: 'sig', kid: 'k1' };
    const subjectVerifier = createGoogleIdTokenSubjectVerifier({
      audience: ['client-id'],
      jwks: createLocalJWKSet({ keys: [jwk] }),
    });
    const idToken = await new SignJWT({ sub: 'uid-1' }) // deliberately no email claim
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .setIssuer('https://accounts.google.com')
      .setAudience('client-id')
      .sign(privateKey);

    const logs = captureLogs();
    const put = vi.fn(() => Promise.resolve('secrets/gmail-refresh-token-uid-1/versions/1'));
    const setRefreshTokenRef = vi.fn(() => Promise.resolve());
    const consent = createGmailConsentService({
      exchangeAuthCode: createGoogleAuthCodeExchanger({
        clientId: 'client-id',
        clientSecret: 'client-secret',
        fetch: successExchange({
          refresh_token: 'refresh-token-secret',
          scope: REQUIRED_SCOPES,
          id_token: idToken,
        }),
      }),
      // Mirrors index.ts: rejected tokens become null (account_mismatch), outages throw.
      verifyConsentIdToken: async (token) => {
        try {
          return (await subjectVerifier.verifySubject(token)).googleUserId;
        } catch (error) {
          if (error instanceof IdTokenRejectedError) {
            return null;
          }
          throw error;
        }
      },
      refreshTokens: { put },
      users: { setRefreshTokenRef },
      logger: logs.logger,
    });
    const harness = await serveWithService(consent, { put, setRefreshTokenRef, logs });

    const response = await post(harness.server, JSON.stringify({ authCode: 'one-time-code' }));

    expect(response.status).toBe(204);
    expect(put).toHaveBeenCalledWith('uid-1', 'refresh-token-secret');
  });

  it('rejects an unauthenticated request with 401 before touching Google', async () => {
    const exchange = vi.fn(() => Promise.reject(new Error('must not be called')));
    const harness = await serve(exchange);

    const response = await post(
      harness.server,
      JSON.stringify({ authCode: 'code' }),
      'forged-token',
    );

    expect(response.status).toBe(401);
    expect(exchange).not.toHaveBeenCalled();
  });

  it('answers 400 for a body without an authCode string', async () => {
    const harness = await serve(successExchange({}));

    const response = await post(harness.server, JSON.stringify({ authCode: 42 }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'bad_request' } });
  });

  it('answers 400 for an empty authCode', async () => {
    const harness = await serve(successExchange({}));

    const response = await post(harness.server, JSON.stringify({ authCode: '' }));

    expect(response.status).toBe(400);
  });

  it('answers 400 for a body that is not JSON at all', async () => {
    const harness = await serve(successExchange({}));

    const response = await post(harness.server, 'authCode=code');

    expect(response.status).toBe(400);
  });

  it('answers 400 invalid_grant when Google rejects the code, storing nothing', async () => {
    const harness = await serve(
      tokenEndpointReturning(() => new Response('{"error":"invalid_grant"}', { status: 400 })),
    );

    const response = await post(harness.server, JSON.stringify({ authCode: 'stale-code' }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_grant' } });
    expect(harness.put).not.toHaveBeenCalled();
  });

  it("answers 400 account_mismatch when the grant's id_token belongs to another account", async () => {
    const harness = await serve(
      successExchange({
        refresh_token: 'refresh-token-secret',
        scope: REQUIRED_SCOPES,
        id_token: 'id-token-for-someone-else',
      }),
    );

    const response = await post(harness.server, JSON.stringify({ authCode: 'code' }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'account_mismatch' } });
    expect(harness.put).not.toHaveBeenCalled();
    expect(harness.setRefreshTokenRef).not.toHaveBeenCalled();
  });

  it('answers 400 account_mismatch when the exchange carries no id_token at all', async () => {
    const harness = await serve(
      successExchange({ refresh_token: 'refresh-token-secret', scope: REQUIRED_SCOPES }),
    );

    const response = await post(harness.server, JSON.stringify({ authCode: 'code' }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'account_mismatch' } });
    expect(harness.put).not.toHaveBeenCalled();
  });

  it('answers 400 no_refresh_token when the exchange carries no refresh token', async () => {
    const harness = await serve(
      successExchange({ scope: REQUIRED_SCOPES, id_token: 'id-token-for-uid-1' }),
    );

    const response = await post(harness.server, JSON.stringify({ authCode: 'code' }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'no_refresh_token' } });
    expect(harness.put).not.toHaveBeenCalled();
  });

  it('answers 400 insufficient_scope when a required Gmail scope was unchecked', async () => {
    const harness = await serve(
      successExchange({
        refresh_token: 'refresh-token-secret',
        scope: 'https://www.googleapis.com/auth/gmail.readonly',
        id_token: 'id-token-for-uid-1',
      }),
    );

    const response = await post(harness.server, JSON.stringify({ authCode: 'code' }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'insufficient_scope' } });
    expect(harness.put).not.toHaveBeenCalled();
    expect(harness.setRefreshTokenRef).not.toHaveBeenCalled();
  });

  it('answers 502 when Google itself fails, without leaking its response', async () => {
    const harness = await serve(
      tokenEndpointReturning(() => new Response('upstream secret detail', { status: 500 })),
    );

    const response = await post(harness.server, JSON.stringify({ authCode: 'code' }));

    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('bad_gateway');
    expect(body.error.message).not.toContain('upstream secret detail');
  });

  it('answers 500 on a deployment missing the Gmail OAuth config, like digest generation does', async () => {
    const harness = await serveWithService({
      connect: () =>
        Promise.reject(new Error('gmail consent is not configured on this deployment')),
    });

    const response = await post(harness.server, JSON.stringify({ authCode: 'code' }));

    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).not.toContain('not configured');
  });

  it('never writes the auth code or any token into a log entry', async () => {
    const harness = await serve(
      successExchange({
        refresh_token: 'refresh-token-secret',
        scope: REQUIRED_SCOPES,
        id_token: 'id-token-for-uid-1',
      }),
    );

    await post(harness.server, JSON.stringify({ authCode: 'auth-code-secret' }));
    await harness.logs.waitFor((entry) => entry.message === 'gmail consent stored');

    const logged = JSON.stringify(harness.logs.entries);
    expect(logged).not.toContain('auth-code-secret');
    expect(logged).not.toContain('refresh-token-secret');
    // The id_token is a JWT carrying the account's email — it must not reach logs either.
    expect(logged).not.toContain('id-token-for-uid-1');
  });
});
