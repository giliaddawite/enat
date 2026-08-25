import { z } from 'zod';
import type { SummaryCacheStore } from '../domain/digestPipeline.js';
import { EMAIL_CATEGORIES, type EmailSummary } from '../domain/summary.js';
import type { Logger } from '../logging/logger.js';
import type { FirestoreLike } from './usersRepository.js';

/**
 * Firestore-backed summary cache (TICKET-104): the same email is never summarized twice.
 * Documents hold only what the digest shows — category, the Amharic summary, urgency and
 * prompt version. Never email bodies: those pass through the pipeline in memory and are
 * gone when the request ends.
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

export interface SummaryCacheRepositoryOptions {
  readonly now?: () => Date;
  /** Receives a warning with the message id when a stored document is invalid —
   * never document contents. */
  readonly logger?: Logger;
}

/** Message ids are only unique within one mailbox, so documents are keyed per user. */
function documentId(uid: string, messageId: string): string {
  return `${uid}_${messageId}`;
}

export function createFirestoreSummaryCacheStore(
  firestore: FirestoreLike,
  options: SummaryCacheRepositoryOptions = {},
): SummaryCacheStore {
  const now = options.now ?? (() => new Date());
  const collection = firestore.collection(SUMMARY_COLLECTION);

  return {
    async getMany(uid, messageIds) {
      const hits = new Map<string, EmailSummary>();
      const snapshots = await Promise.all(
        messageIds.map((messageId) => collection.doc(documentId(uid, messageId)).get()),
      );
      snapshots.forEach((snapshot, index) => {
        if (!snapshot.exists) {
          return;
        }
        const parsed = SummaryDocument.safeParse(snapshot.data());
        if (!parsed.success) {
          // A corrupt cache entry must not wedge the digest; treating it as a miss
          // re-summarizes the email, and the fresh write repairs the document.
          options.logger?.warn('cached summary document invalid; re-summarizing', {
            messageId: messageIds[index],
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
      return hits;
    },

    async setMany(uid, summaries) {
      const createdAt = now().toISOString();
      await Promise.all(
        summaries.map(async (summary) => {
          const document = collection.doc(documentId(uid, summary.messageId));
          try {
            await document.create({
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
