import type { Server } from 'node:http';
import { createFirestoreClient } from './adapters/firestoreClient.js';
import { createGoogleIdTokenVerifier } from './adapters/idTokenVerifier.js';
import { createFirestoreUsersRepository } from './adapters/usersRepository.js';
import { createApp } from './app.js';
import { loadConfig, type Config } from './config.js';
import { createRateLimiter } from './domain/rateLimiter.js';
import { createLogger, type Logger } from './logging/logger.js';

const RATE_LIMIT_WINDOW_MS = 60_000;

function main(): void {
  const config = loadConfigOrExit();
  const logger = createLogger({ level: config.logLevel });

  const app = createApp({
    config,
    logger,
    // An empty audience list (possible only outside production, where the variable is
    // optional) rejects every token — /v1/ fails closed rather than open until the local
    // environment sets GOOGLE_OAUTH_AUDIENCE.
    idTokenVerifier: createGoogleIdTokenVerifier({ audience: config.googleOAuthAudience ?? [] }),
    usersRepository: createFirestoreUsersRepository(createFirestoreClient(config.gcpProjectId)),
    rateLimiter: createRateLimiter({
      limit: config.rateLimitPerMinute,
      windowMs: RATE_LIMIT_WINDOW_MS,
    }),
  });

  const server = app.listen(config.port, () => {
    logger.info('server listening', { port: config.port, environment: config.environment });
  });

  installShutdownHandlers(server, logger);
}

function loadConfigOrExit(): Config {
  try {
    return loadConfig(process.env);
  } catch (error) {
    // The logger is configured from the config that just failed, so this one entry is
    // hand-rolled. CRITICAL because the container cannot serve.
    process.stderr.write(
      `${JSON.stringify({
        severity: 'CRITICAL',
        message: error instanceof Error ? error.message : 'failed to load configuration',
        time: new Date().toISOString(),
      })}\n`,
    );
    process.exit(1);
  }
}

/**
 * Cloud Run sends SIGTERM before reclaiming an idle instance. Draining in-flight requests
 * here is what makes scaling to zero invisible to clients rather than a burst of resets.
 */
function installShutdownHandlers(server: Server, logger: Logger): void {
  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info('shutting down', { signal });
    server.close(() => {
      process.exit(0);
    });
    server.closeIdleConnections();
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main();
