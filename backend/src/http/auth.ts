import type { Request, RequestHandler } from 'express';
import {
  IdTokenRejectedError,
  IdTokenVerificationUnavailableError,
  type IdTokenVerifier,
} from '../adapters/idTokenVerifier.js';
import type { UsersRepository } from '../adapters/usersRepository.js';
import type { User } from '../domain/user.js';
import { HttpError } from './httpError.js';

export interface AuthenticateDependencies {
  readonly idTokenVerifier: IdTokenVerifier;
  readonly usersRepository: UsersRepository;
}

const BEARER_PREFIX = 'Bearer ';

/**
 * Verifies the request's Google ID token (signature, issuer, audience, expiry) and resolves
 * it to an internal user, attaching the result to `req.user` for downstream handlers.
 *
 * Every rejection reason — missing header, malformed token, expired token, wrong audience,
 * bad signature, unverified email — collapses to the same generic 401. `HttpError`'s default
 * message is what reaches the client, so it is never overridden here: a distinguishable
 * response per reason is exactly the enumeration oracle a login endpoint must not offer.
 *
 * Failures that are *ours*, not the caller's, stay 5xx: an unreachable JWKS endpoint
 * becomes a 503 so a healthy client retries instead of discarding a valid session, and any
 * other error (e.g. Firestore unreachable) passes through unchanged so the global error
 * handler reports it as the 500 it is, rather than being misreported as a bad token.
 *
 * Known limitation, accepted for now: every authenticated request costs one Firestore
 * document read (no user cache). Revisit alongside the /v1/digest p95 budget work.
 */
export function authenticate({
  idTokenVerifier,
  usersRepository,
}: AuthenticateDependencies): RequestHandler {
  return (req, res, next) => {
    void resolveUser(req, idTokenVerifier, usersRepository).then(
      (user) => {
        req.user = user;
        next();
      },
      (error: unknown) => {
        if (error instanceof IdTokenRejectedError) {
          req.log?.warn('rejected id token', { reason: error.reason });
          next(new HttpError(401));
          return;
        }
        if (error instanceof IdTokenVerificationUnavailableError) {
          // The cause (JWKS fetch failure etc.) is logged here because the error handler
          // only describes the top-level error, and this one exists to wrap another.
          req.log?.error('id token verification unavailable', { error: describeCause(error) });
          next(new HttpError(503));
          return;
        }
        next(error);
      },
    );
  };
}

async function resolveUser(
  req: Request,
  idTokenVerifier: IdTokenVerifier,
  usersRepository: UsersRepository,
): Promise<User> {
  const token = extractBearerToken(req.get('Authorization'));
  const verified = await idTokenVerifier.verify(token);
  if (!verified.emailVerified) {
    // Google vouches for the signature but not for the email's ownership. Persisting an
    // unverified address as the canonical users.email would let a Google account with a
    // claimed-but-unproven email become that address's user record.
    throw new IdTokenRejectedError('unverified_email', 'ID token email is not verified');
  }
  return usersRepository.findOrCreateByGoogleId(verified);
}

function describeCause(error: Error): Record<string, unknown> {
  const { cause } = error;
  if (cause instanceof Error) {
    return { name: cause.name, message: cause.message };
  }
  return { name: 'NonError', type: typeof cause };
}

function extractBearerToken(header: string | undefined): string {
  if (header === undefined || !header.startsWith(BEARER_PREFIX)) {
    throw new IdTokenRejectedError('missing_token', 'Authorization header missing or malformed');
  }
  const token = header.slice(BEARER_PREFIX.length).trim();
  if (token === '') {
    throw new IdTokenRejectedError('missing_token', 'Authorization header carried no token');
  }
  return token;
}
