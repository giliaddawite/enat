import { z } from 'zod';
import type { RefreshTokenStore } from './refreshTokenStore.js';

/**
 * Mints Gmail OAuth access tokens from the encrypted refresh token the consent flow
 * (TICKET-202) stores via `RefreshTokenStore`. Tokens are cached in-process until shortly
 * before expiry, so one sync run costs one Secret Manager read and one token exchange, not
 * one per API call. The cache dies with the instance — nothing here keeps the service from
 * scaling to zero, and no token is ever persisted or logged.
 */
export interface GmailAccessTokenProvider {
  getAccessToken(refreshTokenRef: string): Promise<string>;
}

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/** Refreshed a minute early so a token never expires mid-sync. */
const EXPIRY_SAFETY_MARGIN_MS = 60_000;

const TokenResponse = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
});

export interface GmailAccessTokenProviderOptions {
  readonly refreshTokenStore: Pick<RefreshTokenStore, 'get'>;
  /** The OAuth client the refresh token was issued to — same client the consent flow uses. */
  readonly clientId: string;
  readonly clientSecret: string;
  readonly fetch?: typeof fetch;
  /** Injected clock (epoch ms) so expiry behavior is deterministic under test. */
  readonly now?: () => number;
}

export function createGmailAccessTokenProvider(
  options: GmailAccessTokenProviderOptions,
): GmailAccessTokenProvider {
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  // Keyed by refreshTokenRef: a consent re-grant issues a new ref, so entries for retired
  // refs simply age out instead of ever serving a token for the wrong grant.
  const cache = new Map<string, { token: string; expiresAt: number }>();

  return {
    async getAccessToken(refreshTokenRef) {
      const cached = cache.get(refreshTokenRef);
      if (cached !== undefined && cached.expiresAt > now()) {
        return cached.token;
      }

      const refreshToken = await options.refreshTokenStore.get(refreshTokenRef);
      const response = await fetchImpl(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: options.clientId,
          client_secret: options.clientSecret,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }).toString(),
      });
      if (!response.ok) {
        // The response body is deliberately never read into the error: OAuth error bodies
        // can echo request parameters, and this message will reach logs.
        throw new Error(`Google token endpoint returned status ${response.status}`);
      }

      const parsed = TokenResponse.safeParse(await response.json());
      if (!parsed.success) {
        // No field values in the message — a partially valid response may hold a token.
        throw new Error('Google token endpoint response failed schema validation', {
          cause: parsed.error,
        });
      }

      cache.set(refreshTokenRef, {
        token: parsed.data.access_token,
        expiresAt: now() + parsed.data.expires_in * 1000 - EXPIRY_SAFETY_MARGIN_MS,
      });
      return parsed.data.access_token;
    },
  };
}
