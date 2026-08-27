import { z } from 'zod';
import {
  AuthCodeExchangeUnavailableError,
  GmailConsentRejectedError,
  type AuthCodeGrant,
} from '../domain/gmailConsent.js';
import { GOOGLE_TOKEN_ENDPOINT, readOAuthErrorCode } from './googleTokenEndpoint.js';

/**
 * Exchanges the one-time server auth code from the Android consent flow (TICKET-202) for
 * tokens at Google's token endpoint. Exactly one attempt, no backoff: a person is sitting
 * on the setup screen waiting, and the code is single-use anyway — a retry after an
 * ambiguous failure could only ever earn a confusing second `invalid_grant`. Errors carry
 * the HTTP status and a validated RFC 6749 code at most, never the response body or any
 * request material, because their messages reach logs.
 */

/** Only the fields consent consumes. `refresh_token` is absent unless the app requested
 * `access_type=offline` (or on a repeat consent without `prompt=consent`); `scope` is the
 * space-delimited list of scopes the user actually granted. */
const CodeExchangeResponse = z.object({
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
});

export interface GoogleAuthCodeExchangerOptions {
  /** The OAuth client the Android app requested the server auth code for. */
  readonly clientId: string;
  readonly clientSecret: string;
  readonly fetch?: typeof fetch;
}

export function createGoogleAuthCodeExchanger(
  options: GoogleAuthCodeExchangerOptions,
): (authCode: string) => Promise<AuthCodeGrant> {
  const fetchImpl = options.fetch ?? fetch;

  return async function exchangeAuthCode(authCode) {
    let response: Response;
    try {
      response = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: options.clientId,
          client_secret: options.clientSecret,
          grant_type: 'authorization_code',
          code: authCode,
          // No redirect_uri: a server auth code minted on Android (Credential Manager /
          // Identity Services) is issued without one.
        }).toString(),
      });
    } catch (error) {
      // The cause is kept for the log entry; the message stays free of request material.
      throw new AuthCodeExchangeUnavailableError('Google token endpoint was unreachable', {
        cause: error,
      });
    }

    if (!response.ok) {
      if ((await readOAuthErrorCode(response)) === 'invalid_grant') {
        throw new GmailConsentRejectedError(
          'invalid_grant',
          'Google rejected the authorization code. Restart the consent flow for a fresh one.',
        );
      }
      throw new AuthCodeExchangeUnavailableError(
        `Google token endpoint returned status ${response.status}`,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new AuthCodeExchangeUnavailableError(
        'Google token endpoint returned a non-JSON response',
        { cause: error },
      );
    }
    const parsed = CodeExchangeResponse.safeParse(body);
    if (!parsed.success) {
      // No field values in the message — a partially valid response may hold a token.
      throw new AuthCodeExchangeUnavailableError(
        'Google token endpoint response failed schema validation',
        { cause: parsed.error },
      );
    }

    return {
      refreshToken: parsed.data.refresh_token ?? null,
      grantedScopes: parsed.data.scope?.split(' ').filter((scope) => scope.length > 0) ?? [],
    };
  };
}
