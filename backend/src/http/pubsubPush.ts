import type { RequestHandler } from 'express';
import {
  IdTokenRejectedError,
  IdTokenVerificationUnavailableError,
  type IdTokenVerifier,
  type VerifiedIdToken,
} from '../adapters/idTokenVerifier.js';
import { HttpError } from './httpError.js';

/**
 * Verifies the Google-signed OIDC token Pub/Sub attaches to every push request
 * (`Authorization: Bearer <token>`, minted for the push subscription's configured invoker
 * service account). This is defense in depth, not the primary gate: Cloud Run's own IAM —
 * only that service account may invoke this URL — is what actually keeps the endpoint from
 * being called by an arbitrary caller (see infra/README.md). A Pub/Sub push token is an
 * ordinary Google ID token, just minted for a service account rather than an end user, so
 * this reuses the same `IdTokenVerifier` port `authenticate` (TICKET-102) verifies against.
 */
export interface VerifyPubSubPushDependencies {
  readonly idTokenVerifier: IdTokenVerifier;
  /** The only service account this endpoint accepts pushes from. */
  readonly allowedInvokerEmail: string;
}

const BEARER_PREFIX = 'Bearer ';

export function verifyPubSubPush(deps: VerifyPubSubPushDependencies): RequestHandler {
  return (req, res, next) => {
    const token = extractBearerToken(req.get('Authorization'));
    if (token === null) {
      next(new HttpError(401));
      return;
    }
    void verify(token, deps).then(next, next);
  };
}

async function verify(token: string, deps: VerifyPubSubPushDependencies): Promise<void> {
  const verified = await verifySafely(token, deps.idTokenVerifier);
  if (!verified.emailVerified || verified.email !== deps.allowedInvokerEmail) {
    throw new HttpError(403);
  }
}

async function verifySafely(
  token: string,
  idTokenVerifier: IdTokenVerifier,
): Promise<VerifiedIdToken> {
  try {
    return await idTokenVerifier.verify(token);
  } catch (error) {
    if (error instanceof IdTokenVerificationUnavailableError) {
      // Our outage (JWKS unreachable), not the caller's bad token — 503 so Pub/Sub retries
      // the push instead of the message being treated as permanently undeliverable.
      throw new HttpError(503);
    }
    if (error instanceof IdTokenRejectedError) {
      throw new HttpError(401);
    }
    throw error;
  }
}

function extractBearerToken(header: string | undefined): string | null {
  if (header === undefined || !header.startsWith(BEARER_PREFIX)) {
    return null;
  }
  const token = header.slice(BEARER_PREFIX.length).trim();
  return token === '' ? null : token;
}
