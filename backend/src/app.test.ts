import { afterEach, describe, expect, it } from 'vitest';
import { IdTokenRejectedError, type IdTokenVerifier } from './adapters/idTokenVerifier.js';
import type { UsersRepository } from './adapters/usersRepository.js';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import type { DigestGenerationService, DigestStore } from './domain/digestGeneration.js';
import { createRateLimiter } from './domain/rateLimiter.js';
import { captureLogs, startTestServer, type TestServer } from './testing/httpTestServer.js';

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

/** Accepts exactly one token, standing in for real Google JWKS verification. */
const stubVerifier: IdTokenVerifier = {
  verify: (token) =>
    token === 'accepted-token'
      ? Promise.resolve({
          googleUserId: 'google-user-123',
          email: 'mom@example.com',
          emailVerified: true,
        })
      : Promise.reject(new IdTokenRejectedError('malformed_token', 'not the accepted token')),
};

const stubUsersRepository: UsersRepository = {
  findOrCreateByGoogleId: (identity) =>
    Promise.resolve({
      uid: identity.googleUserId,
      email: identity.email,
      createdAt: '2026-08-17T12:00:00.000Z',
      locale: 'am',
      refreshTokenRef: null,
    }),
  getById: () => Promise.resolve(null),
};

const stubDigests: DigestStore = {
  get: () => Promise.resolve(null),
  save: () => Promise.resolve(),
};

const stubDigestGeneration: DigestGenerationService = {
  generate: () => Promise.reject(new Error('not exercised by these tests')),
};

async function serve() {
  const logs = captureLogs();
  const config = loadConfig({ NODE_ENV: 'test' });
  server = await startTestServer(
    createApp({
      config,
      logger: logs.logger,
      idTokenVerifier: stubVerifier,
      usersRepository: stubUsersRepository,
      rateLimiter: createRateLimiter({ limit: 60, windowMs: 60_000, now: () => 0 }),
      digests: stubDigests,
      digestGeneration: stubDigestGeneration,
    }),
  );
  return { server, logs };
}

describe('the assembled app', () => {
  it('reports healthy on GET /healthz', async () => {
    const { server: running } = await serve();

    const response = await running.fetch('/healthz');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('keeps the health response out of caches so probes see live state', async () => {
    const { server: running } = await serve();

    expect((await running.fetch('/healthz')).headers.get('cache-control')).toBe('no-store');
  });

  it('assigns a request id to every response', async () => {
    const { server: running } = await serve();

    const id = (await running.fetch('/healthz')).headers.get('x-request-id');

    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('does not advertise the server implementation', async () => {
    const { server: running } = await serve();

    expect((await running.fetch('/healthz')).headers.get('x-powered-by')).toBeNull();
  });

  it('answers an unknown route with the standard error envelope', async () => {
    const { server: running } = await serve();

    const response = await running.fetch('/nope');

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'not_found' } });
  });

  it('answers any /v1/ path without a token with 401, before routing', async () => {
    const { server: running } = await serve();

    const response = await running.fetch('/v1/digest');

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'unauthorized' } });
  });

  it('rejects an invalid token on /v1/ with 401, not 404', async () => {
    const { server: running } = await serve();

    const response = await running.fetch('/v1/anything-at-all', {
      headers: { Authorization: 'Bearer forged-token' },
    });

    expect(response.status).toBe(401);
  });

  it('routes an authenticated /v1/ request past auth to the 404 of a not-yet-built route', async () => {
    const { server: running } = await serve();

    const response = await running.fetch('/v1/verse/today', {
      headers: { Authorization: 'Bearer accepted-token' },
    });

    // No /v1/verse route exists yet (TICKET-106); the point is auth passed and routing ran.
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'not_found' } });
  });

  it('serves GET /v1/digest once authenticated (see routes/digest.test.ts for the full contract)', async () => {
    const { server: running } = await serve();

    const response = await running.fetch('/v1/digest', {
      headers: { Authorization: 'Bearer accepted-token' },
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'digest_not_found' } });
  });

  it('leaves /healthz reachable without a token for Cloud Run probes', async () => {
    const { server: running } = await serve();

    expect((await running.fetch('/healthz')).status).toBe(200);
  });

  it('logs the health check with a request id and a latency', async () => {
    const { server: running, logs } = await serve();

    await running.fetch('/healthz');
    const entry = await logs.waitFor((candidate) => candidate['httpRequest'] !== undefined);

    expect(entry.severity).toBe('INFO');
    expect(entry['requestId']).toEqual(expect.any(String));
    expect(entry['httpRequest']).toMatchObject({ requestUrl: '/healthz', status: 200 });
    expect((entry['httpRequest'] as { latency: string }).latency).toMatch(/^\d+\.\d{3}s$/);
  });
});
