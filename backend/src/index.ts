import type { Server } from 'node:http';
import { createClaudeSummarizer } from './adapters/claudeClient.js';
import { createFirestoreDigestStore } from './adapters/digestRepository.js';
import { createFirestoreClient } from './adapters/firestoreClient.js';
import {
  createGmailAccessTokenProvider,
  type GmailAccessTokenProvider,
} from './adapters/gmailAccessTokens.js';
import { createGmailApiClient } from './adapters/gmailApiClient.js';
import { createGoogleAuthCodeExchanger } from './adapters/googleAuthCodeExchange.js';
import { createFirestoreGmailSyncStateStore } from './adapters/gmailSyncStateRepository.js';
import { createGoogleIdTokenVerifier, type IdTokenVerifier } from './adapters/idTokenVerifier.js';
import { createGoogleSecretManagerClient } from './adapters/secretManagerClient.js';
import {
  createSecretManagerRefreshTokenStore,
  type RefreshTokenStore,
} from './adapters/refreshTokenStore.js';
import { createFirestoreSummaryCacheStore } from './adapters/summaryCacheRepository.js';
import { createFirestoreUsersRepository } from './adapters/usersRepository.js';
import { loadBundledVerses } from './adapters/verseDataset.js';
import { createApp, type AppDependencies } from './app.js';
import { loadConfig, type Config } from './config.js';
import { toDateKey } from './domain/digest.js';
import {
  createDigestGenerationService,
  GmailNotConnectedError,
  type DigestUserPipeline,
} from './domain/digestGeneration.js';
import { createDigestSummarizer } from './domain/digestPipeline.js';
import {
  createGmailConsentService,
  type AuthCodeGrant,
  type GmailConsentService,
} from './domain/gmailConsent.js';
import { createGmailSyncService } from './domain/gmailSync.js';
import { createRateLimiter } from './domain/rateLimiter.js';
import { PROMPT_VERSION } from './domain/summarizationPrompt.js';
import {
  createVerseRotation,
  FALLBACK_VERSE,
  servableVerses,
  type DailyVerseSource,
} from './domain/verse.js';
import type { User } from './domain/user.js';
import { createLogger, type Logger } from './logging/logger.js';

const RATE_LIMIT_WINDOW_MS = 60_000;

function main(): void {
  const config = loadConfigOrExit();
  const logger = createLogger({ level: config.logLevel });

  const app = createApp(buildAppDependencies(config, logger));

  const server = app.listen(config.port, () => {
    logger.info('server listening', { port: config.port, environment: config.environment });
  });

  installShutdownHandlers(server, logger);
}

function buildAppDependencies(config: Config, logger: Logger): AppDependencies {
  const firestore = createFirestoreClient(config.gcpProjectId);
  const usersRepository = createFirestoreUsersRepository(firestore);
  const digests = createFirestoreDigestStore(firestore, { logger });
  const gmailOAuth = buildGmailOAuthAdapters(config, logger);
  const digestGeneration = createDigestGenerationService({
    digests,
    buildPipeline: buildDigestUserPipeline(config, firestore, logger, gmailOAuth),
    now: () => new Date(),
    logger,
  });

  const digestGenerationPush = pubSubPushDependencies(config);

  return {
    config,
    logger,
    // An empty audience list (possible only outside production, where the variable is
    // optional) rejects every token — /v1/ fails closed rather than open until the local
    // environment sets GOOGLE_OAUTH_AUDIENCE.
    idTokenVerifier: createGoogleIdTokenVerifier({ audience: config.googleOAuthAudience ?? [] }),
    usersRepository,
    rateLimiter: createRateLimiter({
      limit: config.rateLimitPerMinute,
      windowMs: RATE_LIMIT_WINDOW_MS,
    }),
    digests,
    digestGeneration,
    gmailConsent: buildGmailConsentService(gmailOAuth, usersRepository, logger),
    verses: buildVerseSource(config, logger),
    ...(digestGenerationPush ? { digestGenerationPush } : {}),
  };
}

/**
 * The adapters shared by both faces of the Gmail OAuth grant (TICKET-202): the consent
 * flow that stores the refresh token and the access-token minting that redeems it.
 * `null` when this deployment is missing the OAuth client secrets or a GCP project to
 * keep tokens in — the dependent features then answer a clear 5xx at request time (see
 * the pipeline factory below and `buildGmailConsentService`) rather than failing boot.
 */
interface GmailOAuthAdapters {
  readonly refreshTokenStore: RefreshTokenStore;
  readonly accessTokens: GmailAccessTokenProvider;
  readonly exchangeAuthCode: (authCode: string) => Promise<AuthCodeGrant>;
}

function buildGmailOAuthAdapters(config: Config, logger: Logger): GmailOAuthAdapters | null {
  if (
    config.googleOAuthClientId === undefined ||
    config.googleOAuthClientSecret === undefined ||
    // A Gmail OAuth client without a GCP project to keep its refresh tokens in is unusable.
    config.gcpProjectId === undefined
  ) {
    return null;
  }
  const refreshTokenStore = createSecretManagerRefreshTokenStore(
    createGoogleSecretManagerClient(config.gcpProjectId),
    { logger },
  );
  return {
    refreshTokenStore,
    accessTokens: createGmailAccessTokenProvider({
      refreshTokenStore,
      clientId: config.googleOAuthClientId,
      clientSecret: config.googleOAuthClientSecret,
    }),
    exchangeAuthCode: createGoogleAuthCodeExchanger({
      clientId: config.googleOAuthClientId,
      clientSecret: config.googleOAuthClientSecret,
    }),
  };
}

function buildGmailConsentService(
  gmailOAuth: GmailOAuthAdapters | null,
  usersRepository: ReturnType<typeof createFirestoreUsersRepository>,
  logger: Logger,
): GmailConsentService {
  if (gmailOAuth === null) {
    return {
      // Ours to report, not the caller's fault — same pattern as digest generation: the
      // route answers a clear 5xx until this deployment's config is completed.
      connect: () =>
        Promise.reject(new Error('gmail consent is not configured on this deployment')),
    };
  }
  return createGmailConsentService({
    exchangeAuthCode: gmailOAuth.exchangeAuthCode,
    refreshTokens: gmailOAuth.refreshTokenStore,
    users: usersRepository,
    logger,
  });
}

/**
 * The daily verse rotation (TICKET-106). Validated here, at boot: a malformed dataset
 * entry fails the deploy's health check loudly rather than surfacing as a broken verse
 * card at some point mid-year.
 *
 * Production serves only entries the maintainer has marked `verified: true` — unreviewed
 * Amharic scripture must never reach the user (CLAUDE.md: Amharic text changes get human
 * review). Until at least one entry is verified, that means production serves the
 * hardcoded fallback verse every day; the warning below fires once at boot, not per
 * request, so the state is visible without being noisy. Non-production keeps every entry
 * so dev and tests exercise the real rotation.
 */
function buildVerseSource(config: Config, logger: Logger): DailyVerseSource {
  const verses = servableVerses(loadBundledVerses(), {
    requireVerified: config.environment === 'production',
  });
  if (verses.length === 0) {
    logger.warn('verse dataset has no verified entries; serving only the fallback verse', {
      environment: config.environment,
    });
    return { verseFor: () => FALLBACK_VERSE };
  }
  return createVerseRotation(verses);
}

/**
 * Returns a factory that builds one user's Gmail sync + summarizer pipeline (TICKET-105),
 * bound to their stored refresh token. The shared, user-independent pieces (the summary
 * cache, the sync-state store, the Claude adapter, the Secret Manager-backed token
 * provider) are built once here, at boot; only the per-user mailbox — bound to that one
 * user's `refreshTokenRef` — and the summarizer that closes over it are built inside the
 * returned factory, once per `generate()` call.
 *
 * The factory throws `GmailNotConnectedError` for a user who has not completed the Gmail
 * consent flow (TICKET-202) yet, and a plain configuration error when this Cloud Run
 * revision has not been given the Claude/Gmail OAuth secrets it needs — both are ours to
 * report, not the caller's fault, and the route layer maps them to the right status.
 */
function buildDigestUserPipeline(
  config: Config,
  firestore: ReturnType<typeof createFirestoreClient>,
  logger: Logger,
  gmailOAuth: GmailOAuthAdapters | null,
): (user: User) => DigestUserPipeline {
  const summaryCache = createFirestoreSummaryCacheStore(firestore, {
    promptVersion: PROMPT_VERSION,
    logger,
  });
  const syncState = createFirestoreGmailSyncStateStore(firestore, { logger });

  // Built once at boot, not per generation: it does not depend on which user is being
  // generated for. `null` when CLAUDE_API_KEY is unset — every `generate()` call for any
  // user then fails with the same clear error until this deployment's config is
  // completed, rather than failing to boot at all. `gmailOAuth` follows the same rule.
  const claudeSummarizerPort =
    config.claudeApiKey === undefined
      ? null
      : createClaudeSummarizer({ apiKey: config.claudeApiKey, logger });

  return (user) => {
    if (user.refreshTokenRef === null) {
      throw new GmailNotConnectedError(user.uid);
    }
    if (gmailOAuth === null || claudeSummarizerPort === null) {
      // Ours to report, not the caller's fault — see the AppDependencies doc comment on
      // why this is a 5xx at generation time rather than a boot failure.
      throw new Error('digest generation is not configured on this deployment');
    }

    const refreshTokenRef = user.refreshTokenRef;
    const mailbox = createGmailApiClient({
      getAccessToken: () => gmailOAuth.accessTokens.getAccessToken(refreshTokenRef),
      logger,
    });
    const gmailSync = createGmailSyncService({ mailbox, syncState });
    const summarizer = createDigestSummarizer({
      summarizer: claudeSummarizerPort,
      cache: summaryCache,
      fetchBodies: (messageIds, maxTokensPerBody) =>
        gmailSync.fetchBodies(messageIds, maxTokensPerBody),
      today: () => toDateKey(new Date()),
      logger,
    });
    return { gmailSync, summarizer };
  };
}

function pubSubPushDependencies(
  config: Config,
): { idTokenVerifier: IdTokenVerifier; allowedInvokerEmail: string } | undefined {
  if (
    config.pubSubPushAudience === undefined ||
    config.pubSubInvokerServiceAccountEmail === undefined
  ) {
    return undefined;
  }
  return {
    idTokenVerifier: createGoogleIdTokenVerifier({ audience: [config.pubSubPushAudience] }),
    allowedInvokerEmail: config.pubSubInvokerServiceAccountEmail,
  };
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
