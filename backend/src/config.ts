import type { LogLevel } from './logging/logger.js';

export type Environment = 'development' | 'test' | 'production';

export interface Config {
  readonly port: number;
  readonly environment: Environment;
  readonly logLevel: LogLevel;
  /** Absent outside production, where it is only used for Cloud Trace log correlation. */
  readonly gcpProjectId?: string;
}

/**
 * Thrown when the process environment cannot produce a valid Config. Carries every
 * problem found, not just the first, so a misconfigured deploy is fixed in one pass.
 *
 * Problems name the variable and the constraint it violated, never the offending value:
 * this message is written to stderr and lands in Cloud Logging, and configuration is
 * where secret references live. A partially-correct secret is still a secret.
 */
export class ConfigError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`invalid configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

const ENVIRONMENTS: readonly Environment[] = ['development', 'test', 'production'];
const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

/** https://cloud.google.com/resource-manager/docs/creating-managing-projects — it is
 * interpolated into a Cloud Logging resource name, so its shape is checked at boot. */
const GCP_PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

const INTEGER = /^\d+$/;

const DEFAULT_PORT = 8080;
const DEFAULT_ENVIRONMENT: Environment = 'development';
const DEFAULT_LOG_LEVEL: LogLevel = 'info';

/**
 * Builds the Config from a raw environment. Pure: the caller owns reading process.env
 * and deciding what to do with a ConfigError, which lets boot-time validation be tested
 * without spawning a process.
 */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const problems: string[] = [];

  const port = parsePort(env.PORT, problems);
  const environment = parseEnum(
    'NODE_ENV',
    env.NODE_ENV,
    ENVIRONMENTS,
    DEFAULT_ENVIRONMENT,
    problems,
  );
  const logLevel = parseEnum('LOG_LEVEL', env.LOG_LEVEL, LOG_LEVELS, DEFAULT_LOG_LEVEL, problems);

  const gcpProjectId = env.GCP_PROJECT_ID?.trim();
  if (environment === 'production' && !gcpProjectId) {
    problems.push('GCP_PROJECT_ID is required when NODE_ENV=production');
  } else if (gcpProjectId && !GCP_PROJECT_ID.test(gcpProjectId)) {
    problems.push(
      'GCP_PROJECT_ID must be a valid Google Cloud project id (6-30 characters, starting ' +
        'with a lowercase letter, containing only lowercase letters, digits and hyphens, ' +
        'and not ending in a hyphen)',
    );
  }

  if (problems.length > 0) {
    throw new ConfigError(problems);
  }

  return {
    port,
    environment,
    logLevel,
    ...(gcpProjectId ? { gcpProjectId } : {}),
  };
}

function parsePort(raw: string | undefined, problems: string[]): number {
  if (raw === undefined || raw === '') {
    return DEFAULT_PORT;
  }
  // Number() would accept '0x1F50' and '8e3' as ports, which the stated contract does not.
  const port = INTEGER.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    problems.push('PORT must be an integer between 1 and 65535');
    return DEFAULT_PORT;
  }
  return port;
}

function parseEnum<T extends string>(
  name: string,
  raw: string | undefined,
  allowed: readonly T[],
  fallback: T,
  problems: string[],
): T {
  if (raw === undefined || raw === '') {
    return fallback;
  }
  if (!allowed.includes(raw as T)) {
    problems.push(`${name} must be one of ${allowed.join(', ')}`);
    return fallback;
  }
  return raw as T;
}
