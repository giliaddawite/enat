import { Timestamp } from '@google-cloud/firestore';

/**
 * Retention arithmetic shared by the repositories that stamp `expireAt` (TICKET-303):
 * the Firestore TTL field is always "when the document was written, plus the collection's
 * retention". Kept in one place so a write and a later backfill of an older document
 * cannot compute the deadline two different ways.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

export function retentionExpireAt(writtenAt: Date, retentionDays: number): Timestamp {
  return Timestamp.fromMillis(writtenAt.getTime() + retentionDays * DAY_MS);
}

/**
 * The instant a stored ISO-8601 field records, or `fallback` when the field does not parse.
 * Used to backfill `expireAt` on documents written before the field existed: their own
 * `createdAt`/`generatedAt` is the honest anchor, and a corrupt one falls back to now so
 * the document still gets a deadline rather than living forever.
 */
export function storedInstantOr(iso: string, fallback: Date): Date {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}
