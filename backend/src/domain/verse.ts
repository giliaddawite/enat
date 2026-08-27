import { createHash } from 'node:crypto';
import { z } from 'zod';

/**
 * Daily verse rotation (TICKET-106): the bilingual scripture verse behind
 * `GET /v1/verse/today`. Pure logic only — the dataset file itself is read by
 * `adapters/verseDataset.ts` and validated here at the trust boundary, because the data is
 * hand-curated and human-edited, which makes it external input like any other.
 */

/** One verse as the app renders it: Amharic primary, English secondary (TICKET-205). */
export interface Verse {
  /** English reference, e.g. `"John 3:16"`. */
  readonly reference: string;
  /** Amharic reference, e.g. `"ዮሐንስ 3፥16"`. */
  readonly referenceAm: string;
  readonly textEn: string;
  readonly textAm: string;
}

/** The `GET /v1/verse/today` response body: today's verse stamped with its UTC date key. */
export interface DailyVerse extends Verse {
  readonly date: string;
}

/** Any Ethiopic-script character — catches an entry whose English and Amharic fields were
 * swapped or left untranslated, which no length/format check would notice. */
const ETHIOPIC = /[ሀ-፿]/;

const verseEntrySchema = z.object({
  reference: z.string().trim().min(1),
  referenceAm: z.string().trim().min(1).regex(ETHIOPIC, 'must contain Ethiopic script'),
  textEn: z.string().trim().min(1),
  textAm: z.string().trim().min(1).regex(ETHIOPIC, 'must contain Ethiopic script'),
  /** Flipped to `true` by the maintainer once the Amharic is checked against a licensed
   * source — see docs/verse-licensing.md. Serving unverified drafts is acceptable in
   * staging; the launch gate is TICKET-106's 10-entry spot check. */
  verified: z.boolean(),
});

const verseDatasetSchema = z.object({
  note: z.string().optional(),
  verses: z.array(verseEntrySchema).min(1),
});

export class VerseDatasetError extends Error {
  constructor(detail: string, options?: ErrorOptions) {
    super(`invalid verse dataset: ${detail}`, options);
    this.name = 'VerseDatasetError';
  }
}

/**
 * Validates the checked-in dataset (`data/verses.json`) at boot — a malformed entry fails
 * the deploy loudly instead of surfacing as a broken card on the phone. The review-only
 * `verified` flag is deliberately dropped: it must never reach the API response.
 */
export function parseVerseDataset(data: unknown): readonly Verse[] {
  const result = verseDatasetSchema.safeParse(data);
  if (!result.success) {
    // Unlike Gmail/Claude responses, this file holds no private data, so the full
    // validation detail can go in the message — it is what the maintainer fixes the file by.
    throw new VerseDatasetError(z.prettifyError(result.error), { cause: result.error });
  }
  return result.data.verses.map(({ reference, referenceAm, textEn, textAm }) => ({
    reference,
    referenceAm,
    textEn,
    textAm,
  }));
}

/** Where a day's verse comes from. Substitutable in tests, which is also how the route's
 * fallback path is exercised — production wiring uses `createVerseRotation`. */
export interface DailyVerseSource {
  verseFor(date: Date): Verse;
}

/**
 * Deterministic rotation: the UTC day of the year indexes into the list, modulo its
 * length. Every request on the same UTC day picks the same verse — which is what lets the
 * response carry a 24h cache lifetime — and a list shorter than 366 entries (the starter
 * dataset, until the full 365 are curated) simply cycles rather than running out.
 */
export function createVerseRotation(verses: readonly Verse[]): DailyVerseSource {
  if (verses.length === 0) {
    throw new VerseDatasetError('rotation requires at least one verse');
  }
  return {
    verseFor(date: Date): Verse {
      const verse = verses[(dayOfYearUtc(date) - 1) % verses.length];
      if (verse === undefined) {
        throw new VerseDatasetError('rotation index out of range');
      }
      return verse;
    },
  };
}

/** 1-based day of the year in UTC — the same calendar `toDateKey` (domain/digest.ts) uses,
 * so the verse changes at the same instant as the digest's "today". */
function dayOfYearUtc(date: Date): number {
  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 1);
  const startOfDay = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return (startOfDay - startOfYear) / 86_400_000 + 1;
}

/**
 * Served whenever selecting today's verse fails (TICKET-106: never show an empty card).
 * Hardcoded so no data file, storage, or lookup failure can take it away.
 *
 * DRAFT AMHARIC — unverified against a licensed source; see docs/verse-licensing.md.
 */
export const FALLBACK_VERSE: Verse = {
  reference: 'Psalm 23:1',
  referenceAm: 'መዝሙር 23፥1',
  textEn: 'The LORD is my shepherd; I shall not want.',
  textAm: 'እግዚአብሔር እረኛዬ ነው፤ የሚያሳጣኝም የለም።',
};

/**
 * A content hash for `ETag`/`If-None-Match`, quoted per RFC 9110 (same scheme as
 * `computeDigestETag`; a shared helper waits for a third use). Includes the date, so a
 * client revalidating yesterday's cached response gets a fresh 200 rather than a 304.
 */
export function computeVerseETag(verse: DailyVerse): string {
  const hash = createHash('sha256').update(JSON.stringify(verse)).digest('hex');
  return `"${hash}"`;
}
