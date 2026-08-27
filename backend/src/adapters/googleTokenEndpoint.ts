/**
 * The Google OAuth token endpoint both Gmail OAuth adapters talk to: the consent flow's
 * auth-code exchange (`googleAuthCodeExchange.ts`) and access-token minting
 * (`gmailAccessTokens.ts`).
 */
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/** The RFC 6749 error-code shape (`invalid_grant`, `invalid_client`, ...). Nothing that
 * fails this check leaves `readOAuthErrorCode`, so free-form body text — which can echo
 * request parameters, including token material — never reaches a caller's error message. */
const OAUTH_ERROR_CODE = /^[a-z0-9_]{1,64}$/;

/**
 * Extracts the machine-readable `error` code from an OAuth error response, or `undefined`
 * when the body has none. Never throws: a caller branching on `invalid_grant` must not be
 * derailed by a non-JSON error body. Consumes the response body.
 */
export async function readOAuthErrorCode(response: Response): Promise<string | undefined> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return undefined;
  }
  if (typeof body !== 'object' || body === null) {
    return undefined;
  }
  const { error } = body as { error?: unknown };
  return typeof error === 'string' && OAUTH_ERROR_CODE.test(error) ? error : undefined;
}
