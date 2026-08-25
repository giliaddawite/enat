import { z } from 'zod';
import type { SummaryCacheStore } from '../domain/digestPipeline.js';
import { EMAIL_CATEGORIES, type EmailSummary } from '../domain/summary.js';
import type { Logger } from '../logging/logger.js';
import type { FirestoreLike } from './usersRepository.js';

/**
 * Firestore-backed summary cache (TICKET-104): the same email is never summarized twice
 * by the same prompt version. Documents hold only what the digest shows — category, the
 * Amharic summary, urgency and prompt version. Never email bodies: those pass through
 * the pipeline in memory and are gone when the request ends.
 */
const SUMMARY_COLLECTION = 'emailSummaries';

const SummaryDocument = z.object({
  messageId: z.string().min(1),
  category: z.enum(EMAIL_CATEGORIES),
  summary: z.string().min(1),
  urgent: z.boolean(),
  promptVersion: z.string().min(1),
  createdAt: z.string().min(1),
});

/** The gRPC status code Firestore raises from `create()` on a conflicting document. */
const FIRESTORE_ALREADY_EXISTS_CODE = 6;

/** Concurrent reads per round — a digest is ≤ 500 ids, so this bounds socket fan-out
 * without needing a batched `getAll` on the narrow FirestoreLike interface. */
const READ_CONCURRENCY = 100;

/**
 * Ids are interpolated into a document path, so their shape is enforced at this
 * boundary: Gmail message ids and Google user ids are URL-safe tokens, and anything
 * else (a `/`, a stray `_`-ambiguity attack) must not be able to address another
 * user's — or a nested — document.
 */
const SAFE_ID = /^[A-Za-z0-9-]+$/;

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
  const now = options.now ?? (() => new Date());
  const collection = firestore.collection(SUMMARY_COLLECTION);

  function documentId(uid: string, messageId: string): string | null {
    if (!SAFE_ID.test(uid) || !SAFE_ID.test(messageId)) {
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
      for (let start = 0; start < messageIds.length; start += READ_CONCURRENCY) {
        const chunk = messageIds.slice(start, start + READ_CONCURRENCY);
        const snapshots = await Promise.all(
          chunk.map((messageId) => {
            const id = documentId(uid, messageId);
            return id === null ? Promise.resolve(null) : collection.doc(id).get();
          }),
        );
        snapshots.forEach((snapshot, index) => {
          if (snapshot === null || !snapshot.exists) {
            return;
          }
          const parsed = SummaryDocument.safeParse(snapshot.data());
          if (!parsed.success) {
            // A corrupt cache entry must not wedge the digest; treating it as a miss
            // re-summarizes the email, and the fresh write repairs the document.
            options.logger?.warn('cached summary document invalid; re-summarizing', {
              messageId: chunk[index],
            });
            return;
          }
          hits.set(parsed.data.messageId, {
            messageId: parsed.data.messageId,
            category: parsed.data.category,
            summary: parsed.data.summary,
            urgent: parsed.data.urgent,
            source: 'cache',
            promptVersion: parsed.data.promptVersion,
          });
        });
      }
      return hits;
    },

    async setMany(uid, summaries) {
      const createdAt = now().toISOString();
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
            });
          } catch (error) {
            if (!isAlreadyExists(error)) {
              throw error;
            }
            // A concurrent run summarized the same email first; its result stands —
            // overwriting would only spend a write on identical content.
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
}

function isAlreadyExists(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const { code } = error as { code?: unknown };
  return code === FIRESTORE_ALREADY_EXISTS_CODE;
}
