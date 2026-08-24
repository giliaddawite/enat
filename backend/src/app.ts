import express, { Router, type Express } from 'express';
import type { IdTokenVerifier } from './adapters/idTokenVerifier.js';
import type { UsersRepository } from './adapters/usersRepository.js';
import type { Config } from './config.js';
import type { RateLimiter } from './domain/rateLimiter.js';
import type { Logger } from './logging/logger.js';
import { authenticate } from './http/auth.js';
import { errorHandler } from './http/errorHandler.js';
import { notFound } from './http/notFound.js';
import { rateLimit } from './http/rateLimit.js';
import { requestId } from './http/requestId.js';
import { requestLogging } from './http/requestLogging.js';
import { healthz } from './routes/health.js';

export interface AppDependencies {
  readonly config: Config;
  readonly logger: Logger;
  readonly idTokenVerifier: IdTokenVerifier;
  readonly usersRepository: UsersRepository;
  readonly rateLimiter: RateLimiter;
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
  const { config, logger, idTokenVerifier, usersRepository, rateLimiter } = dependencies;
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
  app.use('/v1', v1);

  app.use(notFound);
  app.use(errorHandler(logger));

  return app;
}
