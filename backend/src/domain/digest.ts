import { createHash } from 'node:crypto';
import type { Email } from './email.js';
import { EMAIL_CATEGORIES, type EmailCategory, type EmailSummary } from './summary.js';

/**
 * The daily digest document (TICKET-105): the digest pipeline's per-email output
 * (TICKET-104), assembled into the one document `GET /v1/digest` serves. Pure assembly,
 * staleness-decision and ETag logic live here; Firestore reads/writes are the adapter's
 * job (`adapters/digestRepository.ts`), and the HTTP layer is a thin wrapper around both.
 */

/** What one email's card needs (TICKET-204): sender, Amharic summary, urgency badge, and
 * enough to deep-link into Gmail. Never the email body — only pipeline output reaches here. */
export interface DigestEmailItem {
  readonly messageId: string;
  readonly from: string;
  readonly subject: string;
  /** `null` for a category-only (heuristic) result — the card shows no summary line. */
  readonly summary: string | null;
  readonly urgent: boolean;
  readonly receivedAt: string;
}

export interface DigestSection {
  readonly category: EmailCategory;
  readonly items: readonly DigestEmailItem[];
}

/** Matches the ticket's Firestore shape exactly: `{date, userId, sections[], generatedAt,
 * emailCount}`. This is also the `GET /v1/digest` response body verbatim. */
export interface Digest {
  /** `YYYY-MM-DD`, UTC (see `toDateKey`) — also half of the document's composite id. */
  readonly date: string;
  readonly userId: string;
  readonly sections: readonly DigestSection[];
  /** ISO 8601 instant of the run that produced the currently-stored content. Stable across
   * a re-run that changes nothing, so a client's cached copy stays valid — see `needsPersist`. */
  readonly generatedAt: string;
  readonly emailCount: number;
}

/** UTC calendar day, used consistently for the digest document id and the generation job's
 * "today". A user-facing local-timezone digest boundary is a reasonable follow-up once the
 * service is multi-user, but out of scope for one predominantly-US-Eastern mailbox: 6:30 AM
 * ET generation always lands on the same UTC date as ET's morning, so this never splits a
 * day's mail across two documents. The read path deliberately does *not* pin itself to this
 * key — see `findLatestDigest` for why. */
export function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * How far back `findLatestDigest` looks before treating the user as having no digest.
 * A digest older than this is stale enough that the right answer is the app's 404 fallback
 * (`POST /v1/digest/generate`, which builds today's) rather than serving week-old mail —
 * and the cap bounds the read path's worst case at this many point reads.
 */
export const LATEST_DIGEST_LOOKBACK_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The most recent digest with `date <= today` (UTC), or `null` if none exists within
 * `LATEST_DIGEST_LOOKBACK_DAYS`. Exists because the day boundary is UTC while the user is
 * in America/New_York: from ~8 PM ET to midnight ET a strict "today" lookup misses the full
 * digest generated for the previous UTC date (observed live — "no new mail today" at
 * 21:37 ET while a complete digest sat in Firestore).
 *
 * Deliberately a newest-first walk of point reads over an injected by-date getter, not a
 * Firestore query: `DigestStore` only exposes point reads, and an ordered query would need
 * a composite index plus adapter surface for one route. The common case (today's digest
 * exists) stays one read, the evening gap costs two, and the capped worst case only occurs
 * when the user has no recent digest — after which the app's on-demand generation restores
 * the one-read path.
 */
export async function findLatestDigest(
  getByDate: (date: string) => Promise<Digest | null>,
  today: Date,
): Promise<Digest | null> {
  for (let daysBack = 0; daysBack < LATEST_DIGEST_LOOKBACK_DAYS; daysBack += 1) {
    const digest = await getByDate(toDateKey(new Date(today.getTime() - daysBack * DAY_MS)));
    if (digest !== null) {
      return digest;
    }
  }
  return null;
}

/**
 * Builds a `Digest` from the digest pipeline's per-email output. `emails` and `summaries`
 * must correspond 1:1 by `messageId` (exactly what `DigestSummarizer.summarize` returns);
 * an email with no matching summary is dropped rather than guessed at. Sections are ordered
 * by category (the same important-first priority `categorizeByHeuristics` uses) and omit
 * categories with no mail; within a section, input order is kept — newest first, per Gmail
 * sync order.
 */
export function assembleDigest(params: {
  readonly userId: string;
  readonly date: string;
  readonly emails: readonly Email[];
  readonly summaries: readonly EmailSummary[];
  readonly generatedAt: string;
}): Digest {
  const { userId, date, emails, summaries, generatedAt } = params;
  const emailsById = new Map(emails.map((email) => [email.id, email]));

  const byCategory = new Map<EmailCategory, DigestEmailItem[]>();
  let emailCount = 0;
  for (const summary of summaries) {
    const email = emailsById.get(summary.messageId);
    if (email === undefined) {
      continue;
    }
    const item: DigestEmailItem = {
      messageId: email.id,
      from: email.from,
      subject: email.subject,
      summary: summary.summary,
      urgent: summary.urgent,
      receivedAt: email.receivedAt,
    };
    const bucket = byCategory.get(summary.category);
    if (bucket === undefined) {
      byCategory.set(summary.category, [item]);
    } else {
      bucket.push(item);
    }
    emailCount += 1;
  }

  const sections: DigestSection[] = [];
  for (const category of EMAIL_CATEGORIES) {
    const items = byCategory.get(category);
    if (items !== undefined && items.length > 0) {
      sections.push({ category, items });
    }
  }

  return { date, userId, sections, generatedAt, emailCount };
}

/** Content the ETag covers — everything a client would need to redraw the digest.
 * `generatedAt` is deliberately excluded: a re-run that changes nothing must produce the
 * same ETag as the run before it, or `If-None-Match` could never hit. */
function stableContent(digest: Digest): unknown {
  return {
    date: digest.date,
    userId: digest.userId,
    emailCount: digest.emailCount,
    sections: digest.sections,
  };
}

/**
 * A weak content hash for `ETag`/`If-None-Match`. Quoted per RFC 9110 so it can be compared
 * byte-for-byte against the header value a client sends back.
 */
export function computeDigestETag(digest: Digest): string {
  const hash = createHash('sha256')
    .update(JSON.stringify(stableContent(digest)))
    .digest('hex');
  return `"${hash}"`;
}

/**
 * Decides whether a freshly-assembled digest is worth persisting over what is already
 * stored. `false` when the content is identical to the existing document (a re-run that
 * found no new mail): skipping the write avoids bumping `generatedAt` and a Firestore write
 * for zero visible change, keeping the previous ETag valid for a client that already has it.
 */
export function needsPersist(existing: Digest | null, fresh: Digest): boolean {
  return existing === null || computeDigestETag(existing) !== computeDigestETag(fresh);
}
