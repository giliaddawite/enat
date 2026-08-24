import express, { type Express } from 'express';
import type { Config } from './config.js';
import type { Logger } from './logging/logger.js';
import { errorHandler } from './http/errorHandler.js';
import { notFound } from './http/notFound.js';
import { requestId } from './http/requestId.js';
import { requestLogging } from './http/requestLogging.js';
import { healthz } from './routes/health.js';

export interface AppDependencies {
  readonly config: Config;
  readonly logger: Logger;
}

/**
 * Assembles the middleware chain. Order matters: an id exists before anything logs, and
 * every response — including unmatched routes — leaves through errorHandler.
 */
export function createApp({ config, logger }: AppDependencies): Express {
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

  app.use(notFound);
  app.use(errorHandler(logger));

  return app;
}
