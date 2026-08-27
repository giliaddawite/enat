import type { Request, RequestHandler, Response } from 'express';
import { toDateKey } from '../domain/digest.js';
import {
  computeVerseETag,
  FALLBACK_VERSE,
  secondsUntilVerseRotation,
  type DailyVerse,
  type DailyVerseSource,
} from '../domain/verse.js';

/**
 * `GET /v1/verse/today` (TICKET-106). Thin like the digest routes: which verse "today"
 * gets is `domain/verse.ts`'s decision; this layer only picks headers and the fallback.
 * Mounted on the `v1` router in `app.ts`, behind `authenticate` — see the Cache-Control
 * note below for what that does and does not mean once a shared cache is involved.
 */
export interface VerseRouteDependencies {
  readonly verses: DailyVerseSource;
  readonly now: () => Date;
}

/**
 * Cache lifetime, aligned to the rotation boundary: max-age counts down to the coming UTC
 * midnight, when the verse changes — a flat 24h counted from response time would let a
 * copy fetched at 23:00Z serve yesterday's verse as "fresh" deep into the next day.
 *
 * `public` is what lets a shared cache store a response to a request that carried an
 * Authorization header at all (RFC 9110/9111 §3.5). Be clear about the consequence: a
 * CDN's default cache key does not include Authorization, so once a CDN fronts this
 * service, cache hits on this route are served without any authentication check. That is
 * a deliberate, recorded decision — the body is public-domain scripture, identical for
 * every caller, and nothing per-user may ever enter this response (the route tests pin
 * the exact response shape for that reason).
 */
function cacheableUntilRotation(now: Date): string {
  return `public, max-age=${secondsUntilVerseRotation(now)}`;
}

/** The fallback path is unreachable in normal operation — the bundled dataset is
 * validated at boot, so `verseFor` cannot fail today. The guard is cheap insurance
 * against a future rotation source that can fail per-request, and its short TTL keeps a
 * shared cache from holding onto the degraded card once such a source recovers. */
const CACHEABLE_WHILE_DEGRADED = 'public, max-age=300';

export function getVerseToday(deps: VerseRouteDependencies): RequestHandler {
  // Memoized per UTC day: verse and ETag are identical for every request until midnight,
  // so the selection and hash run once a day, not once per request. max-age is *not*
  // memoized — it counts down. The fallback path is never cached, so a repaired source
  // is picked up on the very next request.
  let today:
    { readonly date: string; readonly verse: DailyVerse; readonly etag: string } | undefined;

  return (req, res) => {
    const now = deps.now();
    const date = toDateKey(now);

    try {
      if (today === undefined || today.date !== date) {
        const verse: DailyVerse = { date, ...deps.verses.verseFor(now) };
        today = { date, verse, etag: computeVerseETag(verse) };
      }
      respondWithVerse(req, res, today.verse, today.etag, cacheableUntilRotation(now));
    } catch (error) {
      // Never an empty card (TICKET-106): any selection failure degrades to the bundled
      // fallback verse, as a 200 — the app should not treat a bad day's lookup as an error.
      req.log?.warn('verse selection failed; serving fallback verse', {
        date,
        reason: error instanceof Error ? error.message : 'unknown',
      });
      const verse: DailyVerse = { date, ...FALLBACK_VERSE };
      respondWithVerse(req, res, verse, computeVerseETag(verse), CACHEABLE_WHILE_DEGRADED);
    }
  };
}

/** Headers are set before the 304 decision so revalidations refresh their lifetime too. */
function respondWithVerse(
  req: Request,
  res: Response,
  verse: DailyVerse,
  etag: string,
  cacheControl: string,
): void {
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', cacheControl);
  if (req.get('If-None-Match') === etag) {
    res.status(304).end();
    return;
  }
  res.status(200).json(verse);
}
