import type { Request, RequestHandler } from 'express';
import { IdTokenRejectedError, type IdTokenVerifier } from '../adapters/idTokenVerifier.js';
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
 * bad signature — collapses to the same generic 401. `HttpError`'s default message is what
 * reaches the client, so it is never overridden here: a distinguishable response per reason
 * is exactly the enumeration oracle a login endpoint must not offer. A failure that is *not*
 * a token rejection (e.g. Firestore unreachable) is passed through unchanged so the global
 * error handler reports it as the 500 it is, rather than being misreported as a bad token.
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
  return usersRepository.findOrCreateByGoogleId(verified);
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
