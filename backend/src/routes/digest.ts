import type { Request, RequestHandler, Response } from 'express';
import { computeDigestETag, toDateKey, type Digest } from '../domain/digest.js';
import {
  GmailNotConnectedError,
  type DigestGenerationService,
  type DigestStore,
} from '../domain/digestGeneration.js';
import type { User } from '../domain/user.js';
import { HttpError } from '../http/httpError.js';
import type { Logger } from '../logging/logger.js';

/**
 * `/v1/digest` (TICKET-105). Both handlers are thin: all decisions (what "today" is, the
 * ETag, whether to regenerate) live in `domain/digest.ts` and `domain/digestGeneration.ts`.
 * Mounted on the `v1` router in `app.ts`, so `authenticate` has already resolved `req.user`.
 */
export interface DigestRouteDependencies {
  readonly digests: DigestStore;
  readonly generation: DigestGenerationService;
  readonly now: () => Date;
  readonly logger?: Logger;
}

/**
 * The read path (TICKET-105's <300ms p95 criterion): one Firestore fetch of today's
 * document, nothing else. Never triggers generation — a missing digest is a 404 telling the
 * app to fall back to `POST /v1/digest/generate` (the missed-schedule fallback), not a slow
 * request that silently starts a Gmail sync and a Claude call inline.
 */
export function getDigest(deps: DigestRouteDependencies): RequestHandler {
  return (req, res, next) => {
    void handleGet(req, res, deps).then(() => undefined, next);
  };
}

async function handleGet(req: Request, res: Response, deps: DigestRouteDependencies): Promise<void> {
  const user = requireUser(req);
  const date = toDateKey(deps.now());
  const digest = await deps.digests.get(user.uid, date);
  if (digest === null) {
    throw new HttpError(404, 'No digest has been generated for today yet.', {
      code: 'digest_not_found',
    });
  }
  respondWithDigest(req, res, digest);
}

/**
 * On-demand generation (TICKET-105's missed-schedule fallback): the Android app calls this
 * on pull-to-refresh, or after a `digest_not_found` from the read path. Runs the same
 * generation the scheduled job runs, so it is subject to the same idempotency and caching —
 * a refresh that finds no new mail costs nothing beyond one incremental Gmail sync.
 */
export function generateDigest(deps: DigestRouteDependencies): RequestHandler {
  return (req, res, next) => {
    void handleGenerate(req, res, deps).then(() => undefined, next);
  };
}

async function handleGenerate(
  req: Request,
  res: Response,
  deps: DigestRouteDependencies,
): Promise<void> {
  const user = requireUser(req);
  try {
    const { digest } = await deps.generation.generate(user);
    respondWithDigest(req, res, digest);
  } catch (error) {
    if (error instanceof GmailNotConnectedError) {
      throw new HttpError(409, 'Connect Gmail before generating a digest.', {
        code: 'gmail_not_connected',
      });
    }
    throw error;
  }
}

function respondWithDigest(req: Request, res: Response, digest: Digest): void {
  const etag = computeDigestETag(digest);
  res.setHeader('ETag', etag);
  // Per-user data behind auth: revalidate on every request (via ETag) rather than letting a
  // shared cache serve it, but still let a client skip the download when nothing changed.
  res.setHeader('Cache-Control', 'private, no-cache');
  if (req.get('If-None-Match') === etag) {
    res.status(304).end();
    return;
  }
  res.status(200).json(digest);
}

function requireUser(req: Request): User {
  // Unreachable in practice: this route is only mounted behind `authenticate` on the `v1`
  // router (see app.ts). Guarded rather than asserted so a future mounting mistake fails
  // loudly as a 401, not a crash.
  if (req.user === undefined) {
    throw new HttpError(401);
  }
  return req.user;
}
