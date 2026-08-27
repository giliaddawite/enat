import { assembleDigest, needsPersist, toDateKey, type Digest } from './digest.js';
import type { DigestSummarizer } from './digestPipeline.js';
import type { GmailSyncService } from './gmailSync.js';
import type { Logger } from '../logging/logger.js';
import type { User } from './user.js';

/**
 * Orchestrates one digest generation run (TICKET-105): sync → summarize → assemble →
 * persist-if-changed. The expensive steps (Gmail sync, the Claude batch call) are never
 * skipped just because a digest document already exists for today — `digest-cost.md`
 * depends on that: a scheduler retry or an app-triggered on-demand refresh must pick up
 * mail that arrived since the last run. What stays idempotent is cost and storage: Gmail
 * sync is incremental (≤ 2 calls when nothing changed), the summarizer's own cache means an
 * already-summarized email is never billed twice, and `needsPersist` skips the Firestore
 * write (and the `generatedAt` bump) when nothing actually changed.
 */

/** Thrown when generation is attempted for a user who has not completed the Gmail consent
 * flow (TICKET-202) — `refreshTokenRef` is `null`. The caller maps this to a client-facing
 * "reconnect Gmail" response, not a server error. */
export class GmailNotConnectedError extends Error {
  constructor(uid: string) {
    super('user has not connected Gmail');
    this.name = 'GmailNotConnectedError';
    // The uid is an opaque Google subject id, not personal content, and is already the key
    // every other log line in this service carries.
    this.uid = uid;
  }
  readonly uid: string;
}

/** Thrown when Google answers a refresh-token exchange with `invalid_grant` — the stored
 * grant was revoked (or has expired) and no retry can fix it. The sibling of
 * `GmailNotConnectedError`: that one means consent never happened, this one means consent
 * happened and was withdrawn. Callers map it to the stable `gmail_reconnect_required`
 * client code so the app shows its "reconnect Gmail" card (TICKET-202) instead of treating
 * the failure as transient. */
export class GmailReconnectRequiredError extends Error {
  constructor() {
    super('stored Gmail refresh token was rejected; the user must reconnect Gmail');
    this.name = 'GmailReconnectRequiredError';
  }
}

/** One user's Gmail sync + summarizer, bound to their stored refresh token. Building this
 * is the composition root's job (real adapters in `index.ts`, fakes in tests) — this module
 * only calls the two methods it needs. */
export interface DigestUserPipeline {
  readonly gmailSync: GmailSyncService;
  readonly summarizer: DigestSummarizer;
}

export interface DigestStore {
  get(uid: string, date: string): Promise<Digest | null>;
  /** Idempotent: safe to call repeatedly for the same `date` (see `adapters/digestRepository.ts`). */
  save(digest: Digest): Promise<void>;
}

export interface DigestGenerationDependencies {
  readonly digests: DigestStore;
  /** Throws `GmailNotConnectedError` for a user with no stored refresh token; may also
   * throw a configuration error if the Gmail/Claude adapters cannot be constructed (e.g. an
   * OAuth client secret not yet provisioned) — either way this function decides nothing
   * about that failure, it only reports it. */
  readonly buildPipeline: (user: User) => DigestUserPipeline;
  readonly now: () => Date;
  /** Counts and ids only — never email content. */
  readonly logger?: Logger;
}

export interface DigestGenerationResult {
  readonly digest: Digest;
  /** `false` when today's digest already existed and nothing changed — the scheduled job
   * and the on-demand endpoint both report this so callers can distinguish a fresh run from
   * a no-op one without inspecting `generatedAt` themselves. */
  readonly persisted: boolean;
}

export interface DigestGenerationService {
  generate(user: User): Promise<DigestGenerationResult>;
}

export function createDigestGenerationService(
  deps: DigestGenerationDependencies,
): DigestGenerationService {
  return {
    async generate(user) {
      const date = toDateKey(deps.now());
      const { gmailSync, summarizer } = deps.buildPipeline(user);

      const [existing, syncResult] = await Promise.all([
        deps.digests.get(user.uid, date),
        gmailSync.syncInbox(user.uid),
      ]);
      const { summaries } = await summarizer.summarize(user.uid, syncResult.emails);

      const fresh = assembleDigest({
        userId: user.uid,
        date,
        emails: syncResult.emails,
        summaries,
        generatedAt: deps.now().toISOString(),
      });

      if (!needsPersist(existing, fresh)) {
        deps.logger?.info('digest generation found no change; skipped write', {
          uid: user.uid,
          date,
        });
        // existing is non-null whenever needsPersist is false.
        return { digest: existing as Digest, persisted: false };
      }

      await deps.digests.save(fresh);
      deps.logger?.info('digest generated', {
        uid: user.uid,
        date,
        emailCount: fresh.emailCount,
      });
      return { digest: fresh, persisted: true };
    },
  };
}
