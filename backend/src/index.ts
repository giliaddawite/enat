import type { Server } from 'node:http';
import { createApp } from './app.js';
import { loadConfig, type Config } from './config.js';
import { createLogger, type Logger } from './logging/logger.js';

function main(): void {
  const config = loadConfigOrExit();
  const logger = createLogger({ level: config.logLevel });

  const server = createApp({ config, logger }).listen(config.port, () => {
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
