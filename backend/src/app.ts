import express, { Router, type Express } from 'express';
import type { IdTokenVerifier } from './adapters/idTokenVerifier.js';
import type { UsersRepository } from './adapters/usersRepository.js';
import type { Config } from './config.js';
import type { DigestGenerationService, DigestStore } from './domain/digestGeneration.js';
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
   * The daily verse rotation (TICKET-106), bundled with the build — see
   * `adapters/verseDataset.ts`. Kept under the authenticated `v1` router deliberately:
   * CLAUDE.md's "auth on every request" beats shaving one JWKS check off a route that is
   * already client-cached for 24h, and `Cache-Control: public` still permits a future CDN
   * to cache the response despite the Authorization header (RFC 9111 §3.5).
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
