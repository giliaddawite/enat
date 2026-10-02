import { Timestamp } from '@google-cloud/firestore';
import { z } from 'zod';
import { stripSummaryFormatControls, type SummaryCacheStore } from '../domain/digestPipeline.js';
import { isSafeId } from '../domain/safeId.js';
import { EMAIL_CATEGORIES, type EmailSummary } from '../domain/summary.js';
import type { Logger } from '../logging/logger.js';
import { retentionExpireAt, storedInstantOr } from './firestoreRetention.js';
import type { FirestoreLike } from './usersRepository.js';

/**
 * Firestore-backed summary cache (TICKET-104): the same email is never summarized twice
 * by the same prompt version. Documents hold only what the digest shows — category, the
 * Amharic summary, urgency and prompt version. Never email bodies: those pass through
 * the pipeline in memory and are gone when the request ends.
 */
const SUMMARY_COLLECTION = 'emailSummaries';

/**
 * Retention (TICKET-303, docs/privacy.md). A summary is derived from one email's content,
 * so it expires too — long after the digest that showed it (30 days), because its whole
 * purpose is to keep the same email from being billed twice: an email still in the inbox
 * three months on is one no digest window will reach again. `expireAt` is the Firestore
 * TTL field; infra/README.md has the policy command.
 */
export const SUMMARY_RETENTION_DAYS = 90;

const SummaryDocument = z.object({
  messageId: z.string().min(1),
  category: z.enum(EMAIL_CATEGORIES),
  // Stripped again on the way out, not just on the way in: a document written by an
  // older build (or altered out-of-band) must not re-introduce directional controls.
  summary: z.string().transform(stripSummaryFormatControls).pipe(z.string().min(1)),
  urgent: z.boolean(),
  promptVersion: z.string().min(1),
  createdAt: z.string().min(1),
  // Optional on read: documents written before TICKET-303 carry no stamp. They are still
  // hits — re-summarizing would pay Claude again for content already in hand — and are
  // backfilled in place by `getMany` so they age out like every other document.
  expireAt: z.instanceof(Timestamp).optional(),
});

/** The gRPC status code Firestore raises from `create()` on a conflicting document. */
const FIRESTORE_ALREADY_EXISTS_CODE = 6;

/** Concurrent reads per round — a digest is ≤ 500 ids, so this bounds socket fan-out
 * without needing a batched `getAll` on the narrow FirestoreLike interface. */
const READ_CONCURRENCY = 100;

export interface SummaryCacheRepositoryOptions {
  /** The prompt version results are cached under. Part of every document key: bumping
   * the prompt re-summarizes mail under the new version instead of serving stale — or
   * poisoned — output forever, and old-version documents simply stop being read. */
  readonly promptVersion: string;
  readonly now?: () => Date;
  /** Receives a warning with the message id when a stored document is invalid —
   * never document contents. */
  readonly logger?: Logger;
}

export function createFirestoreSummaryCacheStore(
  firestore: FirestoreLike,
  options: SummaryCacheRepositoryOptions,
): SummaryCacheStore {
  if (!isSafeId(options.promptVersion)) {
    // The version is a repo-owned constant, but it shares the document path with the
    // shape-checked ids (see `domain/safeId.ts`) — enforce the invariant where it is
    // stated, and fail at boot.
    throw new Error('promptVersion must match the safe document-id charset');
  }
  const now = options.now ?? (() => new Date());
  const collection = firestore.collection(SUMMARY_COLLECTION);

  function documentId(uid: string, messageId: string): string | null {
    if (!isSafeId(uid) || !isSafeId(messageId)) {
      options.logger?.warn('summary cache id rejected by shape check', {
        uidLength: uid.length,
        messageIdLength: messageId.length,
      });
      return null;
    }
    return `${uid}_${options.promptVersion}_${messageId}`;
  }

  return {
    async getMany(uid, messageIds) {
      const hits = new Map<string, EmailSummary>();
      const backfills: Promise<boolean>[] = [];
      for (let start = 0; start < messageIds.length; start += READ_CONCURRENCY) {
        const chunk = messageIds.slice(start, start + READ_CONCURRENCY);
        const snapshots = await Promise.all(
          chunk.map((messageId) => {
            const id = documentId(uid, messageId);
            return id === null ? Promise.resolve(null) : collection.doc(id).get();
          }),
        );
        snapshots.forEach((snapshot, index) => {
          const requestedId = chunk[index];
          if (snapshot === null || !snapshot.exists || requestedId === undefined) {
            return;
          }
          const parsed = SummaryDocument.safeParse(snapshot.data());
          // The stored messageId must equal the id the document was fetched under: a
          // document whose content disagrees with its key must never hand one email's
          // summary to another. Either defect is a miss — re-summarizing repairs it.
          if (!parsed.success || parsed.data.messageId !== requestedId) {
            options.logger?.warn('cached summary document invalid; re-summarizing', {
              messageId: requestedId,
            });
            return;
          }
          hits.set(requestedId, {
            messageId: requestedId,
            category: parsed.data.category,
            summary: parsed.data.summary,
            urgent: parsed.data.urgent,
            source: 'cache',
            promptVersion: parsed.data.promptVersion,
          });
          if (parsed.data.expireAt === undefined) {
            const id = documentId(uid, requestedId);
            if (id !== null) {
              backfills.push(backfillExpireAt(id, parsed.data.createdAt));
            }
          }
        });
      }
      // Backfills are tolerated failures: the hits above are already correct, and an
      // unstamped document is simply retried on the next read.
      const failed = (await Promise.all(backfills)).filter((succeeded) => !succeeded).length;
      if (failed > 0) {
        options.logger?.warn('summary cache expireAt backfill failed; will retry on next read', {
          count: failed,
        });
      }
      return hits;
    },

    async setMany(uid, summaries) {
      const writtenAt = now();
      const createdAt = writtenAt.toISOString();
      const expireAt = retentionExpireAt(writtenAt, SUMMARY_RETENTION_DAYS);
      // Every write is attempted before any failure surfaces: one Firestore hiccup must
      // not forfeit the other already-paid-for summaries in the batch.
      const outcomes = await Promise.allSettled(
        summaries.map(async (summary) => {
          const id = documentId(uid, summary.messageId);
          if (id === null) {
            return;
          }
          try {
            await collection.doc(id).create({
              messageId: summary.messageId,
              category: summary.category,
              summary: summary.summary,
              urgent: summary.urgent,
              promptVersion: summary.promptVersion,
              createdAt,
              expireAt,
            });
          } catch (error) {
            if (!isAlreadyExists(error)) {
              throw error;
            }
            // Another run cached this email first; its content stands. Only a missing
            // retention stamp is added — a document that reached this path without one
            // (written before TICKET-303, and not seen by `getMany`) must not live forever,
            // but a stamped one must not have its deadline pushed back on every run.
            await stampIfUnstamped(id, writtenAt);
          }
        }),
      );
      const failures = outcomes.filter(
        (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
      );
      const firstFailure = failures[0];
      if (firstFailure !== undefined) {
        options.logger?.warn('summary cache writes failed', { count: failures.length });
        throw firstFailure.reason instanceof Error
          ? firstFailure.reason
          : new Error('summary cache write failed');
      }
    },
  };

  /**
   * Stamps a pre-TTL document with the deadline it would have had. Resolves to whether it
   * succeeded and never rejects: the rejection handler is attached here, at creation, because
   * `getMany` keeps reading further chunks before it looks at these — a backfill that failed
   * during that wait would otherwise be an unhandled rejection, which takes the process
   * down and prints the raw Firestore error (document path, uid and message id included) to
   * stderr. The deadline is computed inside the promise for the same reason: a throw from
   * `Timestamp` must become a `false`, never fail the read.
   */
  function backfillExpireAt(id: string, createdAt: string): Promise<boolean> {
    return Promise.resolve()
      .then(() =>
        collection.doc(id).update({
          expireAt: retentionExpireAt(storedInstantOr(createdAt, now()), SUMMARY_RETENTION_DAYS),
        }),
      )
      .then(
        () => true,
        () => false,
      );
  }

  /** The write-race path's backfill: anchored on the document's own `createdAt` when it is
   * one, otherwise on this write's clock. A document deleted between the conflict and this
   * read (TTL, an operator) has nothing left to stamp. */
  async function stampIfUnstamped(id: string, writtenAt: Date): Promise<void> {
    const document = collection.doc(id);
    const snapshot = await document.get();
    const stored = snapshot.data();
    if (!snapshot.exists || stored === undefined || stored['expireAt'] !== undefined) {
      return;
    }
    const createdAt = typeof stored['createdAt'] === 'string' ? stored['createdAt'] : '';
    await document.update({
      expireAt: retentionExpireAt(storedInstantOr(createdAt, writtenAt), SUMMARY_RETENTION_DAYS),
    });
  }
}

function isAlreadyExists(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const { code } = error as { code?: unknown };
  return code === FIRESTORE_ALREADY_EXISTS_CODE;
}
