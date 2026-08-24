import { createRemoteJWKSet, errors as joseErrors, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';

/** The claims the rest of the service is allowed to see once a token is verified. */
export interface VerifiedIdToken {
  readonly googleUserId: string;
  readonly email: string;
  readonly emailVerified: boolean;
}

export type IdTokenRejectionReason =
  | 'missing_token'
  | 'malformed_token'
  | 'expired_token'
  | 'wrong_audience'
  | 'invalid_signature'
  | 'invalid_claims'
  | 'unverified_email';

/**
 * Thrown for any token an `IdTokenVerifier` will not vouch for. `reason` exists for logs
 * only. The HTTP layer must reduce every instance of this to the same generic 401 — a
 * distinguishable response per reason is exactly the enumeration oracle CLAUDE.md forbids.
 */
export class IdTokenRejectedError extends Error {
  readonly reason: IdTokenRejectionReason;

  constructor(reason: IdTokenRejectionReason, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'IdTokenRejectedError';
    this.reason = reason;
  }
}

/**
 * Thrown when a token could not be *checked* at all — Google's JWKS endpoint unreachable,
 * a malformed key set, an unexpected jose failure. Distinct from `IdTokenRejectedError`
 * on purpose: this is our outage, not the caller's bad token, and the HTTP layer must
 * answer it with a 5xx so a valid client retries instead of discarding its session.
 */
export class IdTokenVerificationUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'IdTokenVerificationUnavailableError';
  }
}

export interface IdTokenVerifier {
  verify(idToken: string): Promise<VerifiedIdToken>;
}

/**
 * Google's ID token payload carries more than this, but the service only ever reads these
 * three fields — validating narrowly means an unrelated upstream change can't silently
 * widen what an attacker-controlled payload is trusted to contain.
 */
const GoogleIdTokenClaims = z.object({
  sub: z.string().min(1),
  email: z.string().email(),
  email_verified: z.boolean().optional().default(false),
});

const GOOGLE_JWKS_URL = new URL('https://www.googleapis.com/oauth2/v3/certs');

/** Google issues ID tokens under either form; both are accepted per Google's own docs. */
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

export interface GoogleIdTokenVerifierOptions {
  /** Accepted values of the token's `aud` claim — normally the Android app's OAuth client ID. */
  readonly audience: readonly string[];
  /** Overrides the key source. Tests point this at a local, in-memory key set. */
  readonly jwks?: JWTVerifyGetKey;
}

/**
 * Verifies a Google-issued ID token's signature, issuer, audience and expiry against
 * Google's JWKS. `createRemoteJWKSet` caches the fetched key set in-process and only
 * re-fetches on a key-id miss, so a steady stream of requests costs one JWKS fetch, not
 * one per request.
 */
export function createGoogleIdTokenVerifier(
  options: GoogleIdTokenVerifierOptions,
): IdTokenVerifier {
  const jwks = options.jwks ?? createRemoteJWKSet(GOOGLE_JWKS_URL);

  return {
    async verify(idToken) {
      const payload = await verifyClaims(idToken, jwks, options.audience);
      const claims = GoogleIdTokenClaims.safeParse(payload);
      if (!claims.success) {
        throw new IdTokenRejectedError(
          'invalid_claims',
          'ID token payload failed validation',
          { cause: claims.error },
        );
      }
      return {
        googleUserId: claims.data.sub,
        email: claims.data.email,
        emailVerified: claims.data.email_verified,
      };
    },
  };
}

async function verifyClaims(
  idToken: string,
  jwks: JWTVerifyGetKey,
  audience: readonly string[],
): Promise<Record<string, unknown>> {
  try {
    const { payload } = await jwtVerify(idToken, jwks, {
      issuer: GOOGLE_ISSUERS,
      audience: [...audience],
    });
    return payload;
  } catch (error) {
    throw toRejection(error);
  }
}

function toRejection(error: unknown): IdTokenRejectedError | IdTokenVerificationUnavailableError {
  if (error instanceof joseErrors.JWTExpired) {
    return new IdTokenRejectedError('expired_token', 'ID token is expired', { cause: error });
  }
  if (error instanceof joseErrors.JWTClaimValidationFailed && error.claim === 'aud') {
    return new IdTokenRejectedError('wrong_audience', 'ID token audience mismatch', {
      cause: error,
    });
  }
  if (
    error instanceof joseErrors.JWSSignatureVerificationFailed ||
    // A well-formed token whose `kid` names a key Google never published is a forgery
    // signal, not a JWKS problem on our side — the key set was fetched fine and simply
    // does not contain the claimed key.
    error instanceof joseErrors.JWKSNoMatchingKey
  ) {
    return new IdTokenRejectedError('invalid_signature', 'ID token signature invalid', {
      cause: error,
    });
  }
  if (
    error instanceof joseErrors.JWTInvalid ||
    error instanceof joseErrors.JWSInvalid ||
    error instanceof joseErrors.JWTClaimValidationFailed
  ) {
    return new IdTokenRejectedError('malformed_token', 'ID token malformed', { cause: error });
  }
  // Anything else — JWKS fetch failure or timeout, a malformed key set, an unexpected jose
  // error — means the token could not be checked at all. That is our outage, not the
  // caller's bad token: a 401 here would make a healthy client discard a valid session.
  return new IdTokenVerificationUnavailableError('ID token verification unavailable', {
    cause: error,
  });
}
