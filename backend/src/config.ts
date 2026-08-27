import type { LogLevel } from './logging/logger.js';

export type Environment = 'development' | 'test' | 'production';

export interface Config {
  readonly port: number;
  readonly environment: Environment;
  readonly logLevel: LogLevel;
  /** Absent outside production, where it is only used for Cloud Trace log correlation. */
  readonly gcpProjectId?: string;
  /**
   * OAuth client ID(s) an inbound Google ID token's `aud` claim must match — required in
   * production, where it gates every authenticated request. Optional elsewhere so a bare
   * checkout can still run `npm run dev` before auth is wired into any route. A comma
   * separated list supports rotating in a new client ID (e.g. a Play Store release build)
   * without a window where the old one is rejected.
   */
  readonly googleOAuthAudience?: readonly string[];
  /** Requests per user per 60s window before `429`. Defaults to the ticket's 60 req/min. */
  readonly rateLimitPerMinute: number;
  /**
   * Claude API key for the digest summarizer (TICKET-104/105). Optional even in production:
   * generation is one feature of this service, not a boot-time requirement, so a service
   * deployed before this secret is provisioned still serves `/healthz` and reads of
   * already-generated digests — `POST /v1/digest/generate` and the scheduled job answer a
   * clear 5xx instead.
   */
  readonly claudeApiKey?: string;
  /**
   * The Gmail OAuth client Google issued the user's refresh token to (TICKET-202) — needed
   * to mint access tokens from it. Optional for the same reason as `claudeApiKey`: not
   * required to boot, only to generate a digest.
   */
  readonly googleOAuthClientId?: string;
  readonly googleOAuthClientSecret?: string;
  /**
   * Expected `aud` claim on the OIDC token Pub/Sub attaches to a push request (its own push
   * subscription's configured audience, normally the push endpoint's URL) — see
   * `http/pubsubPush.ts`. Optional: absent wherever the push subscription has not been
   * provisioned, in which case `/internal/digest-generate` is not mounted at all.
   */
  readonly pubSubPushAudience?: string;
  /** Expected `email` claim on that same token — the one service account Pub/Sub pushes
   * are trusted from. Required alongside `pubSubPushAudience`; either without the other
   * leaves the push endpoint unable to verify anything, so both are treated as unset. */
  readonly pubSubInvokerServiceAccountEmail?: string;
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
const DEFAULT_RATE_LIMIT_PER_MINUTE = 60;

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

  const googleOAuthAudience = parseAudience(env.GOOGLE_OAUTH_AUDIENCE, problems);
  if (environment === 'production' && googleOAuthAudience === undefined) {
    problems.push('GOOGLE_OAUTH_AUDIENCE is required when NODE_ENV=production');
  }

  const rateLimitPerMinute = parsePositiveInteger(
    'RATE_LIMIT_PER_MINUTE',
    env.RATE_LIMIT_PER_MINUTE,
    DEFAULT_RATE_LIMIT_PER_MINUTE,
    problems,
  );

  const claudeApiKey = nonBlank(env.CLAUDE_API_KEY);
  const googleOAuthClientId = nonBlank(env.GOOGLE_OAUTH_CLIENT_ID);
  const googleOAuthClientSecret = nonBlank(env.GOOGLE_OAUTH_CLIENT_SECRET);
  const pubSubPushAudience = nonBlank(env.PUBSUB_PUSH_AUDIENCE);
  const pubSubInvokerServiceAccountEmail = nonBlank(env.PUBSUB_INVOKER_SERVICE_ACCOUNT_EMAIL);

  if (problems.length > 0) {
    throw new ConfigError(problems);
  }

  return {
    port,
    environment,
    logLevel,
    rateLimitPerMinute,
    ...(gcpProjectId ? { gcpProjectId } : {}),
    ...(googleOAuthAudience ? { googleOAuthAudience } : {}),
    ...(claudeApiKey ? { claudeApiKey } : {}),
    ...(googleOAuthClientId ? { googleOAuthClientId } : {}),
    ...(googleOAuthClientSecret ? { googleOAuthClientSecret } : {}),
    ...(pubSubPushAudience ? { pubSubPushAudience } : {}),
    ...(pubSubInvokerServiceAccountEmail ? { pubSubInvokerServiceAccountEmail } : {}),
  };
}

/** `undefined` for an unset or whitespace-only variable — the shared shape every optional
 * string-valued config field in this file uses. */
function nonBlank(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

/** Comma separated so a client ID rotation can add the new value before removing the old. */
function parseAudience(
  raw: string | undefined,
  problems: string[],
): readonly string[] | undefined {
  if (raw === undefined || raw.trim() === '') {
    return undefined;
  }
  const audience = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (audience.length === 0) {
    problems.push('GOOGLE_OAUTH_AUDIENCE must not be blank');
    return undefined;
  }
  return audience;
}

function parsePositiveInteger(
  name: string,
  raw: string | undefined,
  fallback: number,
  problems: string[],
): number {
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const value = INTEGER.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isInteger(value) || value < 1) {
    problems.push(`${name} must be a positive integer`);
    return fallback;
  }
  return value;
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
