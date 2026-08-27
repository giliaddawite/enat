import { afterEach, describe, expect, it } from 'vitest';
import { IdTokenRejectedError, type IdTokenVerifier } from '../adapters/idTokenVerifier.js';
import type { UsersRepository } from '../adapters/usersRepository.js';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { DigestGenerationService, DigestStore } from '../domain/digestGeneration.js';
import { createRateLimiter } from '../domain/rateLimiter.js';
import { FALLBACK_VERSE, VerseDatasetError, type DailyVerseSource } from '../domain/verse.js';
import { captureLogs, startTestServer, type TestServer } from '../testing/httpTestServer.js';

/**
 * Contract tests for `GET /v1/verse/today` (TICKET-106): the bilingual response shape, the
 * 24h cache headers, the ETag/`If-None-Match` cycle, and the never-an-empty-card fallback,
 * exercised over a real HTTP server the way a client would see them.
 */

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

const NOW = () => new Date('2026-08-27T12:00:00.000Z');

const idTokenVerifier: IdTokenVerifier = {
  verify: (token) =>
    token === 'accepted-token'
      ? Promise.resolve({ googleUserId: 'uid-1', email: 'mom@example.com', emailVerified: true })
      : Promise.reject(new IdTokenRejectedError('malformed_token', 'not accepted')),
};

const usersRepository: UsersRepository = {
  findOrCreateByGoogleId: (identity) =>
    Promise.resolve({
      uid: identity.googleUserId,
      email: identity.email,
      createdAt: '2020-01-01T00:00:00.000Z',
      locale: 'am',
      refreshTokenRef: null,
    }),
  getById: () => Promise.resolve(null),
  setRefreshTokenRef: () => Promise.resolve(),
};

const digests: DigestStore = {
  get: () => Promise.resolve(null),
  save: () => Promise.resolve(),
};

const digestGeneration: DigestGenerationService = {
  generate: () => Promise.reject(new Error('not exercised by these tests')),
};

const TODAYS_VERSE = {
  reference: 'John 3:16',
  referenceAm: 'ዮሐንስ 3፥16',
  textEn: 'For God so loved the world…',
  textAm: 'እግዚአብሔር ዓለሙን እንዲሁ ወዶአልና…',
};

const workingSource: DailyVerseSource = { verseFor: () => TODAYS_VERSE };

const failingSource: DailyVerseSource = {
  verseFor: () => {
    throw new VerseDatasetError('injected failure');
  },
};

async function serve(verses: DailyVerseSource, now: () => Date = NOW) {
  const logs = captureLogs();
  const config = loadConfig({ NODE_ENV: 'test' });
  server = await startTestServer(
    createApp({
      config,
      logger: logs.logger,
      idTokenVerifier,
      usersRepository,
      rateLimiter: createRateLimiter({ limit: 60, windowMs: 60_000, now: () => 0 }),
      digests,
      digestGeneration,
      gmailConsent: { connect: () => Promise.reject(new Error('not exercised by these tests')) },
      verses,
      now,
    }),
  );
  return { server, logs };
}

const AUTH = { headers: { Authorization: 'Bearer accepted-token' } };

describe('GET /v1/verse/today', () => {
  it('returns today’s verse in both languages, stamped with the UTC date', async () => {
    const { server: running } = await serve(workingSource);

    const response = await running.fetch('/v1/verse/today', AUTH);

    expect(response.status).toBe(200);
    // Exact equality on purpose: this response is stored by shared caches (`public`) and,
    // behind a CDN, served without an auth check — nothing per-user, and nothing beyond
    // these five public fields (the review-only `verified` flag included), may ever
    // appear in it.
    expect(await response.json()).toEqual({ date: '2026-08-27', ...TODAYS_VERSE });
  });

  it('requires authentication like every /v1/ route', async () => {
    const { server: running } = await serve(workingSource);

    expect((await running.fetch('/v1/verse/today')).status).toBe(401);
  });

  it('marks the response cacheable by shared caches until the verse rotates at UTC midnight', async () => {
    const { server: running } = await serve(workingSource); // noon UTC: half a day left

    const response = await running.fetch('/v1/verse/today', AUTH);

    expect(response.headers.get('cache-control')).toBe('public, max-age=43200');
  });

  it('near the rotation boundary, expires the cached copy at midnight — not 24h later', async () => {
    const { server: running } = await serve(
      workingSource,
      () => new Date('2026-08-27T23:00:00.000Z'),
    );

    const response = await running.fetch('/v1/verse/today', AUTH);

    expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
  });

  it('carries an ETag and answers a matching If-None-Match with 304 and no body', async () => {
    const { server: running } = await serve(workingSource);

    const first = await running.fetch('/v1/verse/today', AUTH);
    const etag = first.headers.get('etag');
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);

    const revalidation = await running.fetch('/v1/verse/today', {
      headers: { ...AUTH.headers, 'If-None-Match': etag ?? '' },
    });

    expect(revalidation.status).toBe(304);
    expect(await revalidation.text()).toBe('');
    // The 304 carries the countdown too, so a revalidated copy also expires at midnight.
    expect(revalidation.headers.get('cache-control')).toBe('public, max-age=43200');
  });

  it('serves the same ETag across requests on the same day, so revalidation can hit', async () => {
    const { server: running } = await serve(workingSource);

    const first = await running.fetch('/v1/verse/today', AUTH);
    const second = await running.fetch('/v1/verse/today', AUTH);

    expect(second.headers.get('etag')).toBe(first.headers.get('etag'));
  });

  it('answers a stale If-None-Match with a full 200', async () => {
    const { server: running } = await serve(workingSource);

    const response = await running.fetch('/v1/verse/today', {
      headers: { ...AUTH.headers, 'If-None-Match': '"an-etag-from-yesterday"' },
    });

    expect(response.status).toBe(200);
  });

  it('serves the bundled fallback verse as a 200 when selection fails — never an empty card', async () => {
    const { server: running } = await serve(failingSource);

    const response = await running.fetch('/v1/verse/today', AUTH);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ date: '2026-08-27', ...FALLBACK_VERSE });
  });

  it('shortens the cache lifetime on the fallback path so recovery is not pinned out for a day', async () => {
    const { server: running } = await serve(failingSource);

    const response = await running.fetch('/v1/verse/today', AUTH);

    expect(response.headers.get('cache-control')).toBe('public, max-age=300');
  });

  it('logs the fallback without leaking verse content beyond the failure reason', async () => {
    const { server: running, logs } = await serve(failingSource);

    await running.fetch('/v1/verse/today', AUTH);
    const entry = await logs.waitFor((candidate) =>
      candidate.message.includes('serving fallback verse'),
    );

    expect(entry.severity).toBe('WARNING');
    expect(entry['reason']).toContain('injected failure');
  });
});
