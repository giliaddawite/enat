import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { createRateLimiter } from '../domain/rateLimiter.js';
import type { User } from '../domain/user.js';
import { captureLogs, startTestServer, type TestServer } from '../testing/httpTestServer.js';
import { errorHandler } from './errorHandler.js';
import { notFound } from './notFound.js';
import { rateLimit } from './rateLimit.js';
import { requestId } from './requestId.js';
import { requestLogging } from './requestLogging.js';

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

function userRecord(uid: string): User {
  return { uid, email: `${uid}@example.com`, createdAt: '2026-08-17T12:00:00.000Z', locale: 'am', refreshTokenRef: null };
}

/** Stands in for `authenticate`: reads the requested uid from a header instead of a token,
 * so tests can drive per-user rate-limit behaviour without a real ID token round trip. */
function stubAuthenticatedAs(): express.RequestHandler {
  return (req, res, next) => {
    const uid = req.get('X-Test-Uid') ?? 'mom-uid';
    req.user = userRecord(uid);
    next();
  };
}

async function serve(options: { limit: number; windowMs: number; now: () => number }) {
  const logs = captureLogs();
  const app = express();
  app.use(requestId(() => 'fixed-request-id'));
  app.use(requestLogging({ logger: logs.logger, monotonicNow: () => 0 }));
  const rateLimiter = createRateLimiter(options);
  app.get('/budgeted', stubAuthenticatedAs(), rateLimit({ rateLimiter }), (req, res) => {
    res.json({ ok: true });
  });
  app.get('/unauthenticated', rateLimit({ rateLimiter }), (req, res) => {
    res.json({ ok: true });
  });
  app.use(notFound);
  app.use(errorHandler(logs.logger));
  server = await startTestServer(app);
  return { server, logs };
}

describe('rateLimit', () => {
  it('allows requests up to the configured limit', async () => {
    const { server: running } = await serve({ limit: 2, windowMs: 60_000, now: () => 0 });

    expect((await running.fetch('/budgeted')).status).toBe(200);
    expect((await running.fetch('/budgeted')).status).toBe(200);
  });

  it('returns 429 once a user exceeds the limit', async () => {
    const { server: running } = await serve({ limit: 2, windowMs: 60_000, now: () => 0 });

    await running.fetch('/budgeted');
    await running.fetch('/budgeted');
    const response = await running.fetch('/budgeted');

    expect(response.status).toBe(429);
  });

  it('never leaks the limit or remaining count in the 429 body', async () => {
    const { server: running } = await serve({ limit: 1, windowMs: 60_000, now: () => 0 });

    await running.fetch('/budgeted');
    const body = await (await running.fetch('/budgeted')).text();

    expect(body).not.toContain('1');
    expect(JSON.parse(body)).toEqual({
      error: {
        code: 'too_many_requests',
        message: 'Too Many Requests',
        requestId: 'fixed-request-id',
      },
    });
  });

  it('tracks separate budgets for different users', async () => {
    const { server: running } = await serve({ limit: 1, windowMs: 60_000, now: () => 0 });

    const mom = await running.fetch('/budgeted', { headers: { 'X-Test-Uid': 'mom-uid' } });
    const other = await running.fetch('/budgeted', { headers: { 'X-Test-Uid': 'other-uid' } });

    expect(mom.status).toBe(200);
    expect(other.status).toBe(200);
  });

  it('resets a user budget once the window elapses', async () => {
    let now = 0;
    const { server: running } = await serve({ limit: 1, windowMs: 60_000, now: () => now });

    expect((await running.fetch('/budgeted')).status).toBe(200);
    expect((await running.fetch('/budgeted')).status).toBe(429);

    now = 60_000;
    expect((await running.fetch('/budgeted')).status).toBe(200);
  });

  it('fails safe with a 500 if mounted before authenticate populates req.user', async () => {
    const { server: running } = await serve({ limit: 60, windowMs: 60_000, now: () => 0 });

    const response = await running.fetch('/unauthenticated');

    expect(response.status).toBe(500);
  });
});
