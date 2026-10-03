import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { IdTokenRejectedError, type IdTokenVerifier } from '../adapters/idTokenVerifier.js';
import type { UsersRepository } from '../adapters/usersRepository.js';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { Digest, DigestEmailItem } from '../domain/digest.js';
import {
  GmailNotConnectedError,
  GmailReconnectRequiredError,
  type DigestGenerationService,
  type DigestStore,
} from '../domain/digestGeneration.js';
import {
  AuthCodeExchangeUnavailableError,
  GmailConsentRejectedError,
  type GmailConsentService,
} from '../domain/gmailConsent.js';
import { createRateLimiter } from '../domain/rateLimiter.js';
import type { User } from '../domain/user.js';
import { FALLBACK_VERSE } from '../domain/verse.js';
import {
  DigestResponse,
  ErrorResponse,
  HealthResponse,
  VerseResponse,
} from '../http/apiSchemas.js';
import { captureLogs, startTestServer, type TestServer } from '../testing/httpTestServer.js';

/**
 * Contract tests (TICKET-301): every route this service mounts, over a real HTTP server,
 * with each response body parsed against its schema in `http/apiSchemas.ts`. The
 * route-specific test files pin semantics (ETags, fallbacks, error mapping); this file pins
 * the wire shapes — a field added, removed or renamed on any response, or a malformed
 * request answered with anything but the standard error envelope, fails here.
 */

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

const NOW = () => new Date('2026-08-17T12:00:00.000Z');
const INVOKER_EMAIL = 'enat-scheduler@enat-staging.iam.gserviceaccount.com';

const USER: User = {
  uid: 'uid-1',
  email: 'mom@example.com',
  createdAt: '2020-01-01T00:00:00.000Z',
  locale: 'am',
  refreshTokenRef: 'secret-ref',
};

/** Accepts the app's token as the user and the scheduler's token as the Pub/Sub invoker. */
const idTokenVerifier: IdTokenVerifier = {
  verify: (token) => {
    if (token === 'accepted-token') {
      return Promise.resolve({ googleUserId: USER.uid, email: USER.email, emailVerified: true });
    }
    if (token === 'scheduler-token') {
      return Promise.resolve({ googleUserId: 'sa-1', email: INVOKER_EMAIL, emailVerified: true });
    }
    return Promise.reject(new IdTokenRejectedError('malformed_token', 'not accepted'));
  },
};

const usersRepository: UsersRepository = {
  findOrCreateByGoogleId: () => Promise.resolve(USER),
  getById: (uid) => Promise.resolve(uid === USER.uid ? USER : null),
  setRefreshTokenRef: () => Promise.resolve(),
};

function item(
  messageId: string,
  from: string,
  subject: string,
  summary: string | null,
  urgent: boolean,
): DigestEmailItem {
  return { messageId, from, subject, summary, urgent, receivedAt: '2026-08-17T09:00:00.000Z' };
}

/** Every category, a multi-item section and a heuristic-only item (null summary), so the
 * schema is exercised over the whole shape rather than the single-card happy path. */
const DIGEST: Digest = {
  date: '2026-08-17',
  userId: USER.uid,
  sections: [
    {
      category: 'important',
      items: [
        item('msg-1', 'clinic@example.org', 'Appointment', 'የሐኪም ቀጠሮ አለዎት።', true),
        item('msg-2', 'church@example.org', 'Sunday service', 'የቤተ ክርስቲያን ማስታወቂያ', false),
      ],
    },
    {
      category: 'bills_accounts',
      items: [item('msg-3', 'billing@bank.example', 'Statement', 'የባንክ መግለጫ ደርሷል', false)],
    },
    {
      category: 'family_personal',
      items: [item('msg-4', 'Selam <selam@example.com>', 'Hi', 'ሰላም ትላለች', false)],
    },
    {
      category: 'promotions_other',
      items: [item('msg-5', 'deals@shop.example', 'Sale', null, false)],
    },
  ],
  generatedAt: '2026-08-17T06:30:00.000Z',
  emailCount: 5,
};

function storeWith(digests: readonly Digest[]): DigestStore {
  return {
    get: (uid, date) =>
      Promise.resolve(digests.find((d) => d.userId === uid && d.date === date) ?? null),
    save: () => Promise.resolve(),
  };
}

function generation(outcome: Digest | Error): DigestGenerationService {
  return {
    generate: () =>
      outcome instanceof Error
        ? Promise.reject(outcome)
        : Promise.resolve({ digest: outcome, persisted: true }),
  };
}

function consent(outcome: Error | undefined): GmailConsentService {
  return {
    connect: () => (outcome === undefined ? Promise.resolve() : Promise.reject(outcome)),
  };
}

interface Overrides {
  readonly digests?: DigestStore;
  readonly digestGeneration?: DigestGenerationService;
  readonly gmailConsent?: GmailConsentService;
  readonly requestsPerMinute?: number;
  readonly usersRepository?: UsersRepository;
}

async function serve(overrides: Overrides = {}): Promise<TestServer> {
  const logs = captureLogs();
  server = await startTestServer(
    createApp({
      config: loadConfig({ NODE_ENV: 'test' }),
      logger: logs.logger,
      idTokenVerifier,
      usersRepository: overrides.usersRepository ?? usersRepository,
      rateLimiter: createRateLimiter({
        limit: overrides.requestsPerMinute ?? 60,
        windowMs: 60_000,
        now: () => 0,
      }),
      digestGenerateRateLimiter: createRateLimiter({ limit: 2, windowMs: 60_000, now: () => 0 }),
      digests: overrides.digests ?? storeWith([]),
      digestGeneration: overrides.digestGeneration ?? generation(DIGEST),
      gmailConsent: overrides.gmailConsent ?? consent(undefined),
      verses: { verseFor: () => FALLBACK_VERSE },
      now: NOW,
      digestGenerationPush: { idTokenVerifier, allowedInvokerEmail: INVOKER_EMAIL },
    }),
  );
  return server;
}

const AUTH = { headers: { Authorization: 'Bearer accepted-token' } };

function jsonPost(body: string, token: string) {
  return {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body,
  };
}

/** Parses a response body against its schema; a violation names the offending field. */
async function bodyOf<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  const result = schema.safeParse(await response.json());
  if (!result.success) {
    throw new Error(`response body violates the contract: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}

describe('GET /healthz', () => {
  it('answers 200 with the health shape', async () => {
    const running = await serve();

    const response = await running.fetch('/healthz');

    expect(response.status).toBe(200);
    expect(await bodyOf(response, HealthResponse)).toEqual({ status: 'ok' });
  });
});

describe('the error envelope', () => {
  it('is what an unknown route answers with', async () => {
    const running = await serve();

    const response = await running.fetch('/no-such-route');

    expect(response.status).toBe(404);
    expect((await bodyOf(response, ErrorResponse)).error.code).toBe('not_found');
  });

  it('is what an unauthenticated /v1/ request answers with', async () => {
    const running = await serve();

    const response = await running.fetch('/v1/digest');

    expect(response.status).toBe(401);
    expect((await bodyOf(response, ErrorResponse)).error.code).toBe('unauthorized');
  });

  it('is what a rate-limited request answers with', async () => {
    const running = await serve({ requestsPerMinute: 1 });
    await running.fetch('/v1/verse/today', AUTH);

    const response = await running.fetch('/v1/verse/today', AUTH);

    expect(response.status).toBe(429);
    expect((await bodyOf(response, ErrorResponse)).error.code).toBe('too_many_requests');
  });

  it('carries the request id the response header carries', async () => {
    const running = await serve();

    const response = await running.fetch('/no-such-route');

    const body = await bodyOf(response, ErrorResponse);
    expect(body.error.requestId).toBe(response.headers.get('x-request-id'));
  });
});

describe('GET /v1/digest', () => {
  it('answers 200 with the digest shape', async () => {
    const running = await serve({ digests: storeWith([DIGEST]) });

    const response = await running.fetch('/v1/digest', AUTH);

    expect(response.status).toBe(200);
    expect(await bodyOf(response, DigestResponse)).toEqual(DIGEST);
  });

  it('answers 404 digest_not_found in the error envelope when nothing is stored', async () => {
    const running = await serve();

    const response = await running.fetch('/v1/digest', AUTH);

    expect(response.status).toBe(404);
    expect((await bodyOf(response, ErrorResponse)).error.code).toBe('digest_not_found');
  });

  it('answers a matching If-None-Match with 304 and no body', async () => {
    const running = await serve({ digests: storeWith([DIGEST]) });
    const etag = (await running.fetch('/v1/digest', AUTH)).headers.get('etag') ?? '';

    const response = await running.fetch('/v1/digest', {
      headers: { ...AUTH.headers, 'If-None-Match': etag },
    });

    expect(response.status).toBe(304);
    expect(await response.text()).toBe('');
  });
});

describe('POST /v1/digest/generate', () => {
  it('answers 200 with the digest shape', async () => {
    const running = await serve();

    const response = await running.fetch('/v1/digest/generate', { ...AUTH, method: 'POST' });

    expect(response.status).toBe(200);
    expect(await bodyOf(response, DigestResponse)).toEqual(DIGEST);
  });

  it('answers 409 gmail_not_connected in the error envelope', async () => {
    const running = await serve({
      digestGeneration: generation(new GmailNotConnectedError(USER.uid)),
    });

    const response = await running.fetch('/v1/digest/generate', { ...AUTH, method: 'POST' });

    expect(response.status).toBe(409);
    expect((await bodyOf(response, ErrorResponse)).error.code).toBe('gmail_not_connected');
  });

  it('answers 409 gmail_reconnect_required in the error envelope', async () => {
    const running = await serve({
      digestGeneration: generation(new GmailReconnectRequiredError()),
    });

    const response = await running.fetch('/v1/digest/generate', { ...AUTH, method: 'POST' });

    expect(response.status).toBe(409);
    expect((await bodyOf(response, ErrorResponse)).error.code).toBe('gmail_reconnect_required');
  });

  it('answers an unexpected failure with a generic 500 in the error envelope', async () => {
    const running = await serve({ digestGeneration: generation(new Error('claude quota')) });

    const response = await running.fetch('/v1/digest/generate', { ...AUTH, method: 'POST' });

    expect(response.status).toBe(500);
    const body = await bodyOf(response, ErrorResponse);
    expect(body.error.code).toBe('internal_server_error');
    expect(body.error.message).not.toContain('claude quota');
  });
});

describe('POST /v1/auth/gmail-consent', () => {
  it('answers 204 with no body on success', async () => {
    const running = await serve();

    const response = await running.fetch(
      '/v1/auth/gmail-consent',
      jsonPost(JSON.stringify({ authCode: 'one-time-code' }), 'accepted-token'),
    );

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
  });

  it('answers a body with the wrong authCode type with 400 bad_request, not echoing it', async () => {
    const running = await serve();

    const response = await running.fetch(
      '/v1/auth/gmail-consent',
      jsonPost(JSON.stringify({ authCode: 4242 }), 'accepted-token'),
    );

    expect(response.status).toBe(400);
    const body = await bodyOf(response, ErrorResponse);
    expect(body.error.code).toBe('bad_request');
    expect(body.error.message).not.toContain('4242');
  });

  it('answers a missing authCode with 400 bad_request', async () => {
    const running = await serve();

    const response = await running.fetch(
      '/v1/auth/gmail-consent',
      jsonPost(JSON.stringify({}), 'accepted-token'),
    );

    expect(response.status).toBe(400);
    expect((await bodyOf(response, ErrorResponse)).error.code).toBe('bad_request');
  });

  it('answers a body that is not JSON with 400 in the error envelope', async () => {
    const running = await serve();

    const response = await running.fetch(
      '/v1/auth/gmail-consent',
      jsonPost('authCode=code', 'accepted-token'),
    );

    expect(response.status).toBe(400);
    expect((await bodyOf(response, ErrorResponse)).error.code).toBe('bad_request');
  });

  it('answers a body over the 8kb limit with 413 in the error envelope', async () => {
    const running = await serve();

    const response = await running.fetch(
      '/v1/auth/gmail-consent',
      jsonPost(JSON.stringify({ authCode: 'x'.repeat(9_000) }), 'accepted-token'),
    );

    expect(response.status).toBe(413);
    await bodyOf(response, ErrorResponse);
  });

  it('answers a rejected consent with 400 and the rejection reason as the code', async () => {
    const running = await serve({
      gmailConsent: consent(
        new GmailConsentRejectedError('invalid_grant', 'Google rejected the auth code'),
      ),
    });

    const response = await running.fetch(
      '/v1/auth/gmail-consent',
      jsonPost(JSON.stringify({ authCode: 'stale-code' }), 'accepted-token'),
    );

    expect(response.status).toBe(400);
    expect((await bodyOf(response, ErrorResponse)).error.code).toBe('invalid_grant');
  });

  it('answers an unavailable exchange with 502 bad_gateway in the error envelope', async () => {
    const running = await serve({
      gmailConsent: consent(new AuthCodeExchangeUnavailableError('token endpoint 500')),
    });

    const response = await running.fetch(
      '/v1/auth/gmail-consent',
      jsonPost(JSON.stringify({ authCode: 'code' }), 'accepted-token'),
    );

    expect(response.status).toBe(502);
    expect((await bodyOf(response, ErrorResponse)).error.code).toBe('bad_gateway');
  });
});

describe('GET /v1/verse/today', () => {
  it('answers 200 with the verse shape', async () => {
    const running = await serve();

    const response = await running.fetch('/v1/verse/today', AUTH);

    expect(response.status).toBe(200);
    expect(await bodyOf(response, VerseResponse)).toEqual({
      date: '2026-08-17',
      ...FALLBACK_VERSE,
    });
  });

  it('answers a matching If-None-Match with 304 and no body', async () => {
    const running = await serve();
    const etag = (await running.fetch('/v1/verse/today', AUTH)).headers.get('etag') ?? '';

    const response = await running.fetch('/v1/verse/today', {
      headers: { ...AUTH.headers, 'If-None-Match': etag },
    });

    expect(response.status).toBe(304);
    expect(await response.text()).toBe('');
  });
});

describe('POST /internal/digest-generate', () => {
  const envelope = JSON.stringify({
    message: { data: Buffer.from(JSON.stringify({ uid: USER.uid })).toString('base64') },
  });

  it('acks a delivered push with 204 and no body', async () => {
    const running = await serve();

    const response = await running.fetch(
      '/internal/digest-generate',
      jsonPost(envelope, 'scheduler-token'),
    );

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
  });

  it('acks a malformed envelope with 200 and no body, so Pub/Sub never retries it', async () => {
    const running = await serve();

    const response = await running.fetch(
      '/internal/digest-generate',
      jsonPost(JSON.stringify({ not: 'an envelope' }), 'scheduler-token'),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
  });

  it('answers a push without a token with 401 in the error envelope', async () => {
    const running = await serve();

    const response = await running.fetch('/internal/digest-generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: envelope,
    });

    expect(response.status).toBe(401);
    expect((await bodyOf(response, ErrorResponse)).error.code).toBe('unauthorized');
  });

  it('rejects an unauthenticated push before reading its body — malformed JSON still gets the 401, not a 400', async () => {
    const running = await serve();

    const response = await running.fetch('/internal/digest-generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"message": not json at all',
    });

    expect(response.status).toBe(401);
    expect((await bodyOf(response, ErrorResponse)).error.code).toBe('unauthorized');
  });

  it('answers an authenticated push whose body exceeds the 16kb limit with 413 in the error envelope', async () => {
    const running = await serve();
    const oversized = JSON.stringify({ message: { data: 'A'.repeat(17_000) } });

    const response = await running.fetch(
      '/internal/digest-generate',
      jsonPost(oversized, 'scheduler-token'),
    );

    expect(response.status).toBe(413);
    await bodyOf(response, ErrorResponse);
  });

  it('shares one in-flight guard with POST /v1/digest/generate: a push during an app-triggered run joins it', async () => {
    // The app's generate is held open until the push is inside the server. The push
    // handler's getById is its last awaited step before calling generate, so releasing
    // behind that call (after the microtasks that carry the push into generate) makes the
    // collision deterministic rather than a race on loopback timing.
    let release: () => void = () => undefined;
    const pushInside = new Promise<void>((resolve) => {
      release = resolve;
    });
    let generateStarted: () => void = () => undefined;
    const appRunStarted = new Promise<void>((resolve) => {
      generateStarted = resolve;
    });
    const generate = vi.fn(async () => {
      generateStarted();
      await pushInside;
      return { digest: DIGEST, persisted: true };
    });
    const running = await serve({
      digestGeneration: { generate },
      usersRepository: {
        ...usersRepository,
        getById: (uid) => {
          setImmediate(release);
          return usersRepository.getById(uid);
        },
      },
    });

    const appCall = running.fetch('/v1/digest/generate', { ...AUTH, method: 'POST' });
    await appRunStarted;
    const push = running.fetch('/internal/digest-generate', jsonPost(envelope, 'scheduler-token'));
    const [appResponse, pushResponse] = await Promise.all([appCall, push]);

    expect(appResponse.status).toBe(200);
    expect(await bodyOf(appResponse, DigestResponse)).toEqual(DIGEST);
    expect(pushResponse.status).toBe(204);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('acks a verified push whose body is not JSON with 200 and no body, without running the pipeline', async () => {
    const generate = vi.fn(() => Promise.resolve({ digest: DIGEST, persisted: true }));
    const running = await serve({ digestGeneration: { generate } });

    const response = await running.fetch(
      '/internal/digest-generate',
      jsonPost('{"message": not json at all', 'scheduler-token'),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
    expect(generate).not.toHaveBeenCalled();
  });

  it("answers a push carrying the app user's token with 403 in the error envelope", async () => {
    const running = await serve();

    const response = await running.fetch(
      '/internal/digest-generate',
      jsonPost(envelope, 'accepted-token'),
    );

    expect(response.status).toBe(403);
    expect((await bodyOf(response, ErrorResponse)).error.code).toBe('forbidden');
  });
});

describe('the response schemas are strict', () => {
  it('rejects a digest item carrying pipeline-internal fields', () => {
    const leaked = {
      ...DIGEST,
      sections: [
        {
          category: 'important',
          items: [{ ...item('msg-1', 'a@b.example', 'x', 'y', false), source: 'llm' }],
        },
      ],
    };

    expect(DigestResponse.safeParse(leaked).success).toBe(false);
  });

  it('rejects a verse carrying the review-only verified flag', () => {
    const leaked = { date: '2026-08-17', ...FALLBACK_VERSE, verified: true };

    expect(VerseResponse.safeParse(leaked).success).toBe(false);
  });
});
