import { afterEach, describe, expect, it } from 'vitest';
import { IdTokenRejectedError, type IdTokenVerifier } from '../adapters/idTokenVerifier.js';
import type { UsersRepository } from '../adapters/usersRepository.js';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { Digest } from '../domain/digest.js';
import {
  GmailNotConnectedError,
  GmailReconnectRequiredError,
  type DigestGenerationResult,
  type DigestGenerationService,
  type DigestStore,
} from '../domain/digestGeneration.js';
import { createRateLimiter } from '../domain/rateLimiter.js';
import { FALLBACK_VERSE } from '../domain/verse.js';
import { captureLogs, startTestServer, type TestServer } from '../testing/httpTestServer.js';

/**
 * Contract tests for `/v1/digest` (TICKET-105, read semantics revised to latest-available):
 * status codes, the fall-back to the newest stored digest across the UTC day boundary, the
 * ETag/`If-None-Match` cycle, and the on-demand generation fallback, exercised over a real
 * HTTP server so a schema or status regression is caught the way a client would see it.
 */

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

const NOW = () => new Date('2026-08-17T12:00:00.000Z');

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

const DIGEST: Digest = {
  date: '2026-08-17',
  userId: 'uid-1',
  sections: [
    {
      category: 'important',
      items: [
        {
          messageId: 'msg-1',
          from: 'church@example.org',
          subject: 'Sunday service',
          summary: 'የቤተ ክርስቲያን ማስታወቂያ',
          urgent: false,
          receivedAt: '2026-08-17T09:00:00.000Z',
        },
      ],
    },
  ],
  generatedAt: '2026-08-17T06:30:00.000Z',
  emailCount: 1,
};

/** Date-aware in-memory store: `get` honors uid and date the way the Firestore adapter
 * does, and `stored` can be mutated mid-test to model a new digest landing. */
function fakeDigests(seed: readonly Digest[] = []): DigestStore & { stored: Digest[] } {
  const stored = [...seed];
  return {
    stored,
    get: (uid, date) =>
      Promise.resolve(stored.find((d) => d.userId === uid && d.date === date) ?? null),
    save: (digest) => {
      stored.push(digest);
      return Promise.resolve();
    },
  };
}

function fakeGeneration(
  result: DigestGenerationResult | (() => Promise<DigestGenerationResult>),
): DigestGenerationService {
  return {
    generate: () => (typeof result === 'function' ? result() : Promise.resolve(result)),
  };
}

async function serve(deps: { digests: DigestStore; digestGeneration: DigestGenerationService }) {
  const logs = captureLogs();
  const config = loadConfig({ NODE_ENV: 'test' });
  server = await startTestServer(
    createApp({
      config,
      logger: logs.logger,
      idTokenVerifier,
      usersRepository,
      rateLimiter: createRateLimiter({ limit: 60, windowMs: 60_000, now: () => 0 }),
      now: NOW,
      verses: { verseFor: () => FALLBACK_VERSE },
      gmailConsent: { connect: () => Promise.reject(new Error('not exercised by these tests')) },
      ...deps,
    }),
  );
  return server;
}

const AUTH = { headers: { Authorization: 'Bearer accepted-token' } };

// The evening-gap case (TICKET-105 revision): generation keys documents to the UTC day, so
// after ~8 PM ET only the previous UTC date's digest exists. NOW is 2026-08-17 UTC, making
// this "yesterday's" digest from the read path's point of view.
const YESTERDAY_DIGEST: Digest = {
  date: '2026-08-16',
  userId: 'uid-1',
  sections: [
    {
      category: 'bills_accounts',
      items: [
        {
          messageId: 'msg-0',
          from: 'billing@bank.com',
          subject: 'Statement ready',
          summary: 'የባንክ መግለጫ ደርሷል',
          urgent: false,
          receivedAt: '2026-08-16T15:00:00.000Z',
        },
      ],
    },
  ],
  generatedAt: '2026-08-16T06:30:00.000Z',
  emailCount: 1,
};

describe('GET /v1/digest', () => {
  it('returns 404 with a distinguishable code when the user has no digest at all', async () => {
    const running = await serve({
      digests: fakeDigests(),
      digestGeneration: fakeGeneration({ digest: DIGEST, persisted: false }),
    });

    const response = await running.fetch('/v1/digest', AUTH);

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'digest_not_found' } });
  });

  it('returns the pre-generated digest verbatim, matching the ticket-documented shape', async () => {
    const running = await serve({
      digests: fakeDigests([DIGEST]),
      digestGeneration: fakeGeneration({ digest: DIGEST, persisted: false }),
    });

    const response = await running.fetch('/v1/digest', AUTH);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(DIGEST);
    expect(response.headers.get('etag')).toMatch(/^".+"$/);
  });

  it("serves yesterday's digest, with its own date, when today's does not exist yet", async () => {
    const running = await serve({
      digests: fakeDigests([YESTERDAY_DIGEST]),
      digestGeneration: fakeGeneration({ digest: YESTERDAY_DIGEST, persisted: false }),
    });

    const response = await running.fetch('/v1/digest', AUTH);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(YESTERDAY_DIGEST);
  });

  it("prefers today's digest over yesterday's when both exist", async () => {
    const running = await serve({
      digests: fakeDigests([YESTERDAY_DIGEST, DIGEST]),
      digestGeneration: fakeGeneration({ digest: DIGEST, persisted: false }),
    });

    const response = await running.fetch('/v1/digest', AUTH);

    expect(await response.json()).toEqual(DIGEST);
  });

  it('keeps a cached yesterday-digest 304ing until a newer digest lands, then serves the new one', async () => {
    const digests = fakeDigests([YESTERDAY_DIGEST]);
    const running = await serve({
      digests,
      digestGeneration: fakeGeneration({ digest: DIGEST, persisted: true }),
    });
    const first = await running.fetch('/v1/digest', AUTH);
    const cachedEtag = first.headers.get('etag') ?? '';

    const beforeNewDigest = await running.fetch('/v1/digest', {
      headers: { ...AUTH.headers, 'If-None-Match': cachedEtag },
    });
    digests.stored.push(DIGEST);
    const afterNewDigest = await running.fetch('/v1/digest', {
      headers: { ...AUTH.headers, 'If-None-Match': cachedEtag },
    });

    expect(beforeNewDigest.status).toBe(304);
    expect(afterNewDigest.status).toBe(200);
    expect(await afterNewDigest.json()).toEqual(DIGEST);
  });

  it('answers 304 with no body when If-None-Match matches the current ETag', async () => {
    const running = await serve({
      digests: fakeDigests([DIGEST]),
      digestGeneration: fakeGeneration({ digest: DIGEST, persisted: false }),
    });
    const first = await running.fetch('/v1/digest', AUTH);
    const etag = first.headers.get('etag');

    const second = await running.fetch('/v1/digest', {
      headers: { ...AUTH.headers, 'If-None-Match': etag ?? '' },
    });

    expect(second.status).toBe(304);
    expect(await second.text()).toBe('');
  });

  it('answers 200 with a fresh body when If-None-Match is stale', async () => {
    const running = await serve({
      digests: fakeDigests([DIGEST]),
      digestGeneration: fakeGeneration({ digest: DIGEST, persisted: false }),
    });

    const response = await running.fetch('/v1/digest', {
      headers: { ...AUTH.headers, 'If-None-Match': '"stale-etag"' },
    });

    expect(response.status).toBe(200);
  });

  it('requires authentication like every other /v1/ route', async () => {
    const running = await serve({
      digests: fakeDigests([DIGEST]),
      digestGeneration: fakeGeneration({ digest: DIGEST, persisted: false }),
    });

    const response = await running.fetch('/v1/digest');

    expect(response.status).toBe(401);
  });
});

describe('POST /v1/digest/generate', () => {
  it('runs generation and returns the resulting digest', async () => {
    const running = await serve({
      digests: fakeDigests(),
      digestGeneration: fakeGeneration({ digest: DIGEST, persisted: true }),
    });

    const response = await running.fetch('/v1/digest/generate', { ...AUTH, method: 'POST' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(DIGEST);
  });

  it('answers 409 with a distinguishable code when Gmail is not connected', async () => {
    const running = await serve({
      digests: fakeDigests(),
      digestGeneration: fakeGeneration(() => Promise.reject(new GmailNotConnectedError('uid-1'))),
    });

    const response = await running.fetch('/v1/digest/generate', { ...AUTH, method: 'POST' });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'gmail_not_connected' } });
  });

  it('answers 409 gmail_reconnect_required when the stored Gmail grant was revoked', async () => {
    const running = await serve({
      digests: fakeDigests(),
      digestGeneration: fakeGeneration(() => Promise.reject(new GmailReconnectRequiredError())),
    });

    const response = await running.fetch('/v1/digest/generate', { ...AUTH, method: 'POST' });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'gmail_reconnect_required' } });
  });

  it('answers 500 without leaking detail when generation fails unexpectedly', async () => {
    const running = await serve({
      digests: fakeDigests(),
      digestGeneration: fakeGeneration(() => Promise.reject(new Error('claude api on fire'))),
    });

    const response = await running.fetch('/v1/digest/generate', { ...AUTH, method: 'POST' });

    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).not.toContain('claude api on fire');
  });
});
