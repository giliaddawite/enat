import type { Request, RequestHandler, Response } from 'express';
import { toDateKey } from '../domain/digest.js';
import {
  computeVerseETag,
  FALLBACK_VERSE,
  type DailyVerse,
  type DailyVerseSource,
} from '../domain/verse.js';
/**
 * `GET /v1/verse/today` (TICKET-106). Thin like the digest routes: which verse "today"
 * gets is `domain/verse.ts`'s decision; this layer only picks headers and the fallback.
 * Mounted on the `v1` router in `app.ts`, behind `authenticate` — see the Cache-Control
 * note below for why the 24h cache still works from there.
 */
export interface VerseRouteDependencies {
  readonly verses: DailyVerseSource;
  readonly now: () => Date;
}

/** Same verse all (UTC) day for every caller, so a full day of caching is safe. `public`
 * matters: responses to requests with an Authorization header may only be stored by shared
 * caches (the CDN this endpoint is meant to live behind) when it is stated explicitly
 * (RFC 9111 §3.5) — without it the edge cache the ticket asks for could never engage. */
const CACHEABLE_FOR_A_DAY = 'public, max-age=86400';

/** The fallback is served on failure, so it must not be pinned at the edge for a full
 * day — five minutes shields the origin while letting recovery become visible quickly. */
const CACHEABLE_WHILE_DEGRADED = 'public, max-age=300';

export function getVerseToday(deps: VerseRouteDependencies): RequestHandler {
  return (req, res) => {
    const now = deps.now();
    const date = toDateKey(now);

    let verse: DailyVerse;
    let cacheControl: string;
    try {
      verse = { date, ...deps.verses.verseFor(now) };
      cacheControl = CACHEABLE_FOR_A_DAY;
    } catch (error) {
      // Never an empty card (TICKET-106): any selection failure degrades to the bundled
      // fallback verse, as a 200 — the app should not treat a bad day's lookup as an error.
      req.log?.warn('verse selection failed; serving fallback verse', {
        date,
        reason: error instanceof Error ? error.message : 'unknown',
      });
      verse = { date, ...FALLBACK_VERSE };
      cacheControl = CACHEABLE_WHILE_DEGRADED;
    }

    respondWithVerse(req, res, verse, cacheControl);
  };
}

function respondWithVerse(
  req: Request,
  res: Response,
  verse: DailyVerse,
  cacheControl: string,
): void {
  const etag = computeVerseETag(verse);
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', cacheControl);
  if (req.get('If-None-Match') === etag) {
    res.status(304).end();
    return;
  }
  res.status(200).json(verse);
}
