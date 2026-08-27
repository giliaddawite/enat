import rawVerseDataset from '../data/verses.json' with { type: 'json' };
import { parseVerseDataset, type VerseDatasetEntry } from '../domain/verse.js';

/**
 * The checked-in verse rotation (TICKET-106), bundled into the image at build time — no
 * Firestore collection, no network. 365 short bilingual entries are a few hundred KB that
 * live for the instance's lifetime, so serving them from memory is both the cheapest and
 * the simplest option on a scale-to-zero service: the read path costs zero I/O, and there
 * is no second copy of the data to drift out of review.
 *
 * Validated at import time: a malformed entry fails boot (the deploy's health check),
 * never a request.
 */
export function loadBundledVerses(): readonly VerseDatasetEntry[] {
  return parseVerseDataset(rawVerseDataset);
}
