import type { Logger } from '../logging/logger.js';

/**
 * The server half of the Gmail consent flow (TICKET-202). The Android app runs the server
 * auth-code flow — sign in with Google, grant the Gmail scopes, receive a one-time server
 * auth code — and hands that code to `POST /v1/auth/gmail-consent`. This service exchanges
 * it, verifies the grant is actually usable for digest generation, and stores the refresh
 * token server-side (encrypted at rest via `RefreshTokenStore`); the token itself never
 * returns to the device and never appears in a log line.
 */

/** The least-privilege scopes this product is allowed to hold (CLAUDE.md: never full
 * mail). A grant missing either one cannot run the digest pipeline, so it is rejected at
 * consent time — before anything is stored — rather than failing at 6am generation. */
export const REQUIRED_GMAIL_SCOPES: readonly string[] = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
];

export type GmailConsentRejectionReason =
  /** Google refused the auth code itself — expired, already redeemed, or forged. */
  | 'invalid_grant'
  /** The exchange succeeded but carried no refresh token; the app must re-prompt with
   * forced consent (`access_type=offline` + `prompt=consent`). */
  | 'no_refresh_token'
  /** The user unchecked a required Gmail scope on the consent screen. */
  | 'insufficient_scope'
  /** The grant is not provably bound to the signed-in account: the exchange carried no
   * id_token, the id_token did not verify, or its subject is a different Google account.
   * Without this check, a valid session for account A could submit an auth code harvested
   * for account B and link B's mailbox to A's record. One reason for all three cases on
   * purpose — distinguishing them would tell an attacker which part of a forgery failed. */
  | 'account_mismatch';

/** A consent attempt the client can fix by re-running the flow. `reason` doubles as the
 * stable machine-readable error code the route returns, so the Android side branches on it
 * directly. The message is client-safe: reasons only, never token material. */
export class GmailConsentRejectedError extends Error {
  readonly reason: GmailConsentRejectionReason;

  constructor(reason: GmailConsentRejectionReason, message: string) {
    super(message);
    this.name = 'GmailConsentRejectedError';
    this.reason = reason;
  }
}

/** The exchange could not be completed for reasons that are not the client's fault — the
 * token endpoint was unreachable, answered 5xx, or returned a malformed body. The route
 * maps this to a 502 so the app retries later instead of restarting consent. */
export class AuthCodeExchangeUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AuthCodeExchangeUnavailableError';
  }
}

/** What a successful code exchange granted, reduced to the facts consent needs. The
 * access token Google also returns is deliberately absent: this flow stores the refresh
 * token and nothing else. */
export interface AuthCodeGrant {
  /** `null` when Google's response carried none — see `no_refresh_token` above. */
  readonly refreshToken: string | null;
  readonly grantedScopes: readonly string[];
  /** The `id_token` asserting which Google account granted this code — the proof that
   * binds the grant to the signed-in user. `null` when the response carried none. */
  readonly idToken: string | null;
}

export interface GmailConsentDependencies {
  /** Exchanges the code at Google's token endpoint (`adapters/googleAuthCodeExchange.ts`
   * in production). Throws `GmailConsentRejectedError('invalid_grant', ...)` when Google
   * refuses the code and `AuthCodeExchangeUnavailableError` for everything else. */
  readonly exchangeAuthCode: (authCode: string) => Promise<AuthCodeGrant>;
  /** Verifies the exchange's id_token (signature, audience, expiry) and returns the Google
   * subject (`sub`) it asserts, or `null` for a token that does not verify. Throws only
   * for infrastructure failures (e.g. JWKS unreachable), which are ours, not the client's.
   * Production binds this to the same OAuth client the exchange used — see `index.ts`. */
  readonly verifyConsentIdToken: (idToken: string) => Promise<string | null>;
  /** `RefreshTokenStore.put` — encrypts, stores, returns the ref to persist. */
  readonly refreshTokens: { put(uid: string, refreshToken: string): Promise<string> };
  /** `UsersRepository.setRefreshTokenRef` — links the ref to the user's record. */
  readonly users: { setRefreshTokenRef(uid: string, refreshTokenRef: string): Promise<void> };
  /** Receives uids and outcome codes only — never the auth code or any token. */
  readonly logger?: Logger;
}

export interface GmailConsentService {
  /** Completes consent for the authenticated user, or throws one of the errors above. */
  connect(uid: string, authCode: string): Promise<void>;
}

export function createGmailConsentService(deps: GmailConsentDependencies): GmailConsentService {
  return {
    async connect(uid, authCode) {
      const grant = await deps.exchangeAuthCode(authCode);

      // Identity comes first: nothing about a grant matters until it provably belongs to
      // the authenticated user. The log line carries the uid and outcome only — never
      // which check failed in a way that names the other account.
      const grantSubject =
        grant.idToken === null ? null : await deps.verifyConsentIdToken(grant.idToken);
      if (grantSubject === null || grantSubject !== uid) {
        deps.logger?.warn('gmail consent rejected: grant is not bound to the signed-in account', {
          uid,
        });
        throw new GmailConsentRejectedError(
          'account_mismatch',
          'The Gmail grant does not belong to the signed-in Google account. Re-run consent with the same account.',
        );
      }

      // Scopes are checked before the refresh token: a grant missing scopes is useless
      // even when a refresh token came with it, and nothing unusable may be stored.
      const missing = REQUIRED_GMAIL_SCOPES.filter((scope) => !grant.grantedScopes.includes(scope));
      if (missing.length > 0) {
        deps.logger?.warn('gmail consent rejected: required scopes were not granted', {
          uid,
          missingScopeCount: missing.length,
        });
        throw new GmailConsentRejectedError(
          'insufficient_scope',
          'The Gmail permissions this app requires were not granted. Re-run consent and keep both Gmail permissions checked.',
        );
      }

      if (grant.refreshToken === null) {
        deps.logger?.warn('gmail consent rejected: exchange returned no refresh token', { uid });
        throw new GmailConsentRejectedError(
          'no_refresh_token',
          'Google returned no refresh token for this grant. Re-run consent with consent forced.',
        );
      }

      const refreshTokenRef = await deps.refreshTokens.put(uid, grant.refreshToken);
      try {
        await deps.users.setRefreshTokenRef(uid, refreshTokenRef);
      } catch (error) {
        // The token version is now live in Secret Manager with no record pointing at it.
        // Logged distinctly so the orphan is discoverable; it is also self-healing — the
        // user retries consent, and the next `put` destroys every superseded version.
        deps.logger?.warn(
          'gmail consent stored a refresh token but failed to link it; version orphaned until the next consent',
          { uid },
        );
        throw error;
      }
      deps.logger?.info('gmail consent stored', { uid });
    },
  };
}
