import express, { Router, type Express } from 'express';
import type { IdTokenVerifier } from './adapters/idTokenVerifier.js';
import type { UsersRepository } from './adapters/usersRepository.js';
import type { Config } from './config.js';
import type { DigestGenerationService, DigestStore } from './domain/digestGeneration.js';
import type { GmailConsentService } from './domain/gmailConsent.js';
import type { RateLimiter } from './domain/rateLimiter.js';
import type { DailyVerseSource } from './domain/verse.js';
import type { Logger } from './logging/logger.js';
import { authenticate } from './http/auth.js';
import { errorHandler } from './http/errorHandler.js';
import { notFound } from './http/notFound.js';
import { verifyPubSubPush } from './http/pubsubPush.js';
import { rateLimit } from './http/rateLimit.js';
import { requestId } from './http/requestId.js';
import { requestLogging } from './http/requestLogging.js';
import { generateDigest, getDigest } from './routes/digest.js';
import { createDigestGenerationPushHandler } from './routes/digestGenerationPush.js';
import { connectGmail } from './routes/gmailConsent.js';
import { healthz } from './routes/health.js';
import { getVerseToday } from './routes/verse.js';

export interface AppDependencies {
  readonly config: Config;
  readonly logger: Logger;
  readonly idTokenVerifier: IdTokenVerifier;
  readonly usersRepository: UsersRepository;
  readonly rateLimiter: RateLimiter;
  readonly digests: DigestStore;
  readonly digestGeneration: DigestGenerationService;
  /**
   * The Gmail consent flow's server half (TICKET-202). Like `digestGeneration`, always
   * mounted: a deployment missing the Gmail OAuth secrets gets a service whose `connect`
   * rejects (see `index.ts`), so the route answers a clear 5xx rather than a misleading 404.
   */
  readonly gmailConsent: GmailConsentService;
  /**
   * The daily verse rotation (TICKET-106), bundled with the build and filtered to
   * maintainer-verified entries in production — see `buildVerseSource` in `index.ts`.
   * Kept under the authenticated `v1` router: auth holds for every request that reaches
   * this service. Know what that does NOT promise: a CDN's default cache key excludes the
   * Authorization header, so once a CDN fronts this service, cache hits on `/v1/verse/
   * today` are served to anyone without an auth check. That is a deliberate, recorded
   * decision — the response is public-domain scripture, identical for every caller, and
   * nothing per-user may ever enter it (`routes/verse.test.ts` pins the exact shape).
   */
  readonly verses: DailyVerseSource;
  /** Injected clock; only the calendar date reaches the digest routes. Defaults to the
   * real clock so production wiring never has to pass it explicitly. */
  readonly now?: () => Date;
  /**
   * Verifies the Pub/Sub push OIDC token for `/internal/digest-generate` (TICKET-105's
   * scheduled generation job). Omitted wherever the push subscription has not been
   * provisioned (local dev, and staging/prod before TICKET-003's infra lands) — the route
   * is then not mounted at all, rather than mounted and permanently rejecting.
   */
  readonly digestGenerationPush?: {
    readonly idTokenVerifier: IdTokenVerifier;
    readonly allowedInvokerEmail: string;
  };
}

/**
 * Assembles the middleware chain. Order matters: an id exists before anything logs, and
 * every response — including unmatched routes — leaves through errorHandler.
 *
 * Every `/v1/` route is registered on a router that already carries `authenticate` and
 * `rateLimit`, so future tickets inherit auth by construction — an unauthenticated request
 * to any `/v1/*` path is answered 401 before routing, and a route that skipped auth would
 * have to be mounted outside `/v1/` on purpose. Only `/healthz` stays open: Cloud Run's
 * probes carry no ID token.
 */
export function createApp(dependencies: AppDependencies): Express {
  const {
    config,
    logger,
    idTokenVerifier,
    usersRepository,
    rateLimiter,
    digests,
    digestGeneration,
    gmailConsent,
    verses,
    digestGenerationPush,
  } = dependencies;
  const now = dependencies.now ?? (() => new Date());
  const app = express();

  app.disable('x-powered-by');

  app.use(requestId());
  app.use(
    requestLogging({
      logger,
      ...(config.gcpProjectId ? { projectId: config.gcpProjectId } : {}),
    }),
  );

  app.get('/healthz', healthz);

  const v1 = Router();
  v1.use(authenticate({ idTokenVerifier, usersRepository }));
  v1.use(rateLimit({ rateLimiter }));
  const digestRouteDependencies = { digests, generation: digestGeneration, now, logger };
  v1.get('/digest', getDigest(digestRouteDependencies));
  v1.post('/digest/generate', generateDigest(digestRouteDependencies));
  // Body parsing only on the one route that takes a body. The limit is deliberately tiny:
  // the body is a single OAuth auth code, so anything larger is not a consent request.
  v1.post(
    '/auth/gmail-consent',
    express.json({ limit: '8kb' }),
    connectGmail({ consent: gmailConsent }),
  );
  v1.get('/verse/today', getVerseToday({ verses, now }));
  app.use('/v1', v1);

  // Not behind /v1's Google end-user auth: the caller is Pub/Sub, not the app, and its own
  // OIDC token is verified by verifyPubSubPush. See the AppDependencies doc comment above.
  if (digestGenerationPush !== undefined) {
    app.post(
      '/internal/digest-generate',
      express.json(),
      verifyPubSubPush(digestGenerationPush),
      createDigestGenerationPushHandler({
        getUser: (uid) => usersRepository.getById(uid),
        generation: digestGeneration,
        logger,
      }),
    );
  }

  app.use(notFound);
  app.use(errorHandler(logger));

  return app;
}
