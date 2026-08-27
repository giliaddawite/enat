import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import {
  IdTokenRejectedError,
  IdTokenVerificationUnavailableError,
  type IdTokenRejectionReason,
  type IdTokenVerifier,
  type VerifiedIdToken,
} from '../adapters/idTokenVerifier.js';
import type { UsersRepository } from '../adapters/usersRepository.js';
import type { User } from '../domain/user.js';
import {
  captureLogs,
  startTestServer,
  type LogEntry,
  type TestServer,
} from '../testing/httpTestServer.js';
import { authenticate } from './auth.js';
import { errorHandler } from './errorHandler.js';
import { notFound } from './notFound.js';
import { requestId } from './requestId.js';
import { requestLogging } from './requestLogging.js';

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

const VALID_TOKEN = 'valid-id-token';
const MOM: VerifiedIdToken = {
  googleUserId: 'google-user-123',
  email: 'mom@example.com',
  emailVerified: true,
};
const MOM_RECORD: User = {
  uid: 'google-user-123',
  email: 'mom@example.com',
  createdAt: '2026-08-17T12:00:00.000Z',
  locale: 'am',
  refreshTokenRef: null,
};

/** A verifier scripted by token string, so each test names the outcome it wants. */
function scriptedVerifier(
  outcomes: Record<string, VerifiedIdToken | IdTokenRejectionReason>,
): IdTokenVerifier {
  return {
    verify(token) {
      const outcome = outcomes[token];
      if (outcome === undefined) {
        return Promise.reject(new IdTokenRejectedError('malformed_token', 'unscripted token'));
      }
      if (typeof outcome === 'string') {
        return Promise.reject(new IdTokenRejectedError(outcome, `rejected: ${outcome}`));
      }
      return Promise.resolve(outcome);
    },
  };
}

function fixedUsersRepository(user: User = MOM_RECORD): UsersRepository {
  return {
    findOrCreateByGoogleId: () => Promise.resolve(user),
    getById: () => Promise.resolve(user),
    setRefreshTokenRef: () => Promise.resolve(),
  };
}

function failingUsersRepository(error: Error): UsersRepository {
  return {
    findOrCreateByGoogleId: () => Promise.reject(error),
    getById: () => Promise.reject(error),
    setRefreshTokenRef: () => Promise.reject(error),
  };
}

async function serve(idTokenVerifier: IdTokenVerifier, usersRepository: UsersRepository) {
  const logs = captureLogs();
  const app = express();
  app.use(requestId(() => 'fixed-request-id'));
  app.use(requestLogging({ logger: logs.logger, monotonicNow: () => 0 }));
  app.get('/protected', authenticate({ idTokenVerifier, usersRepository }), (req, res) => {
    res.json({ uid: req.user?.uid, email: req.user?.email });
  });
  app.use(notFound);
  app.use(errorHandler(logs.logger));
  server = await startTestServer(app);
  return { server, logs };
}

const isRejectionLog = (entry: LogEntry): boolean => entry.message === 'rejected id token';
const authHeader = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

describe('authenticate', () => {
  it('resolves a valid token to the internal user and lets the request through', async () => {
    const { server: running } = await serve(
      scriptedVerifier({ [VALID_TOKEN]: MOM }),
      fixedUsersRepository(),
    );

    const response = await running.fetch('/protected', { headers: authHeader(VALID_TOKEN) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ uid: 'google-user-123', email: 'mom@example.com' });
  });

  it('rejects a request with no Authorization header', async () => {
    const { server: running } = await serve(scriptedVerifier({}), fixedUsersRepository());

    const response = await running.fetch('/protected');

    expect(response.status).toBe(401);
  });

  it('rejects a header that is not in Bearer form', async () => {
    const { server: running } = await serve(scriptedVerifier({}), fixedUsersRepository());

    const response = await running.fetch('/protected', {
      headers: { Authorization: 'Basic dGVzdA==' },
    });

    expect(response.status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const { server: running } = await serve(
      scriptedVerifier({ [VALID_TOKEN]: 'expired_token' }),
      fixedUsersRepository(),
    );

    const response = await running.fetch('/protected', { headers: authHeader(VALID_TOKEN) });

    expect(response.status).toBe(401);
  });

  it('rejects a token issued for the wrong audience', async () => {
    const { server: running } = await serve(
      scriptedVerifier({ [VALID_TOKEN]: 'wrong_audience' }),
      fixedUsersRepository(),
    );

    const response = await running.fetch('/protected', { headers: authHeader(VALID_TOKEN) });

    expect(response.status).toBe(401);
  });

  it('rejects a malformed token', async () => {
    const { server: running } = await serve(
      scriptedVerifier({ [VALID_TOKEN]: 'malformed_token' }),
      fixedUsersRepository(),
    );

    const response = await running.fetch('/protected', { headers: authHeader(VALID_TOKEN) });

    expect(response.status).toBe(401);
  });

  it('returns the exact same body for every rejection reason, leaking no detail', async () => {
    const reasons: IdTokenRejectionReason[] = [
      'expired_token',
      'wrong_audience',
      'malformed_token',
      'invalid_signature',
      'invalid_claims',
      'unverified_email',
    ];

    // Sequential, each server closed (and the shared `server` cleared) before the next is
    // started, so `afterEach` never double-closes an already-closed server.
    for (const reason of reasons) {
      const { server: running } = await serve(
        scriptedVerifier({ [VALID_TOKEN]: reason }),
        fixedUsersRepository(),
      );
      const response = await running.fetch('/protected', { headers: authHeader(VALID_TOKEN) });
      const body = await response.json();
      await running.close();
      server = undefined;

      expect(response.status).toBe(401);
      expect(body).toEqual({
        error: { code: 'unauthorized', message: 'Unauthorized', requestId: 'fixed-request-id' },
      });
    }
  });

  it('never puts a stack trace or internal reason in the 401 response body', async () => {
    const { server: running } = await serve(
      scriptedVerifier({ [VALID_TOKEN]: 'wrong_audience' }),
      fixedUsersRepository(),
    );

    const body = await (await running.fetch('/protected', { headers: authHeader(VALID_TOKEN) })).text();

    expect(body).not.toContain('wrong_audience');
    expect(body).not.toContain('at ');
  });

  it('logs the specific rejection reason server-side for operators', async () => {
    const { server: running, logs } = await serve(
      scriptedVerifier({ [VALID_TOKEN]: 'wrong_audience' }),
      fixedUsersRepository(),
    );

    await running.fetch('/protected', { headers: authHeader(VALID_TOKEN) });
    const entry = await logs.waitFor(isRejectionLog);

    expect(entry).toMatchObject({ reason: 'wrong_audience', requestId: 'fixed-request-id' });
  });

  it('never logs the raw token', async () => {
    const { server: running, logs } = await serve(
      scriptedVerifier({ [VALID_TOKEN]: 'wrong_audience' }),
      fixedUsersRepository(),
    );

    await running.fetch('/protected', { headers: authHeader(VALID_TOKEN) });
    await logs.waitFor(isRejectionLog);

    expect(JSON.stringify(logs.entries)).not.toContain(VALID_TOKEN);
  });

  it('rejects a valid token whose email Google has not verified, with the same opaque 401', async () => {
    const { server: running } = await serve(
      scriptedVerifier({ [VALID_TOKEN]: { ...MOM, emailVerified: false } }),
      fixedUsersRepository(),
    );

    const response = await running.fetch('/protected', { headers: authHeader(VALID_TOKEN) });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: 'unauthorized', message: 'Unauthorized', requestId: 'fixed-request-id' },
    });
  });

  it('never creates a user record for a token with an unverified email', async () => {
    let created = false;
    const spyingRepository: UsersRepository = {
      findOrCreateByGoogleId: () => {
        created = true;
        return Promise.resolve(MOM_RECORD);
      },
      getById: () => Promise.resolve(MOM_RECORD),
      setRefreshTokenRef: () => Promise.resolve(),
    };
    const { server: running } = await serve(
      scriptedVerifier({ [VALID_TOKEN]: { ...MOM, emailVerified: false } }),
      spyingRepository,
    );

    await running.fetch('/protected', { headers: authHeader(VALID_TOKEN) });

    expect(created).toBe(false);
  });

  it('answers 503 when token verification itself is unavailable, so clients retry', async () => {
    const unavailableVerifier: IdTokenVerifier = {
      verify: () =>
        Promise.reject(
          new IdTokenVerificationUnavailableError('ID token verification unavailable', {
            cause: new Error('JWKS fetch timed out'),
          }),
        ),
    };
    const { server: running } = await serve(unavailableVerifier, fixedUsersRepository());

    const response = await running.fetch('/protected', { headers: authHeader(VALID_TOKEN) });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: 'service_unavailable',
        message: 'Service Unavailable',
        requestId: 'fixed-request-id',
      },
    });
  });

  it('logs the cause of a verification outage without exposing it to the client', async () => {
    const unavailableVerifier: IdTokenVerifier = {
      verify: () =>
        Promise.reject(
          new IdTokenVerificationUnavailableError('ID token verification unavailable', {
            cause: new Error('getaddrinfo ENOTFOUND www.googleapis.com'),
          }),
        ),
    };
    const { server: running, logs } = await serve(unavailableVerifier, fixedUsersRepository());

    const body = await (
      await running.fetch('/protected', { headers: authHeader(VALID_TOKEN) })
    ).text();
    const entry = await logs.waitFor(
      (candidate) => candidate.message === 'id token verification unavailable',
    );

    expect(body).not.toContain('ENOTFOUND');
    expect(entry).toMatchObject({
      severity: 'ERROR',
      error: { name: 'Error', message: 'getaddrinfo ENOTFOUND www.googleapis.com' },
    });
  });

  it('reports a users-repository failure as a 500, not a 401', async () => {
    const { server: running } = await serve(
      scriptedVerifier({ [VALID_TOKEN]: MOM }),
      failingUsersRepository(new Error('Firestore unavailable')),
    );

    const response = await running.fetch('/protected', { headers: authHeader(VALID_TOKEN) });

    expect(response.status).toBe(500);
  });
});
