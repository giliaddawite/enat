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
  | 'insufficient_scope';

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

/** What a successful code exchange granted, reduced to the two facts consent needs. The
 * access token Google also returns is deliberately absent: this flow stores the refresh
 * token and nothing else. */
export interface AuthCodeGrant {
  /** `null` when Google's response carried none — see `no_refresh_token` above. */
  readonly refreshToken: string | null;
  readonly grantedScopes: readonly string[];
}

export interface GmailConsentDependencies {
  /** Exchanges the code at Google's token endpoint (`adapters/googleAuthCodeExchange.ts`
   * in production). Throws `GmailConsentRejectedError('invalid_grant', ...)` when Google
   * refuses the code and `AuthCodeExchangeUnavailableError` for everything else. */
  readonly exchangeAuthCode: (authCode: string) => Promise<AuthCodeGrant>;
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
      await deps.users.setRefreshTokenRef(uid, refreshTokenRef);
      deps.logger?.info('gmail consent stored', { uid });
    },
  };
}
