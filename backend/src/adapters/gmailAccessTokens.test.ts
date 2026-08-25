import { describe, expect, it } from 'vitest';
import { createGmailAccessTokenProvider } from './gmailAccessTokens.js';

const REF = 'projects/enat/secrets/gmail-refresh-token-uid/versions/1';

function fakeTokenEndpoint(
  responses: (() => Response)[],
): { fetchImpl: typeof fetch; requests: { url: string; body: string }[] } {
  const requests: { url: string; body: string }[] = [];
  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: input instanceof Request ? input.url : String(input),
      body: typeof init?.body === 'string' ? init.body : '',
    });
    const responder = responses.shift();
    if (responder === undefined) {
      throw new Error('unexpected token endpoint call');
    }
    return Promise.resolve(responder());
  }) as typeof fetch;
  return { fetchImpl, requests };
}

const tokenResponse = (token: string, expiresIn = 3600): Response =>
  new Response(JSON.stringify({ access_token: token, expires_in: expiresIn }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const refreshTokenStore = { get: () => Promise.resolve('refresh-token-secret') };

describe('createGmailAccessTokenProvider', () => {
  it('exchanges the stored refresh token for an access token', async () => {
    const { fetchImpl, requests } = fakeTokenEndpoint([() => tokenResponse('access-1')]);
    const provider = createGmailAccessTokenProvider({
      refreshTokenStore,
      clientId: 'client-id',
      clientSecret: 'client-secret',
      fetch: fetchImpl,
      now: () => 0,
    });

    const token = await provider.getAccessToken(REF);

    expect(token).toBe('access-1');
    expect(requests[0]?.url).toBe('https://oauth2.googleapis.com/token');
    const body = new URLSearchParams(requests[0]?.body);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('refresh-token-secret');
    expect(body.get('client_id')).toBe('client-id');
    expect(body.get('client_secret')).toBe('client-secret');
  });

  it('serves the cached token until shortly before expiry, then re-exchanges', async () => {
    let currentTime = 0;
    const { fetchImpl, requests } = fakeTokenEndpoint([
      () => tokenResponse('access-1', 3600),
      () => tokenResponse('access-2', 3600),
    ]);
    const provider = createGmailAccessTokenProvider({
      refreshTokenStore,
      clientId: 'client-id',
      clientSecret: 'client-secret',
      fetch: fetchImpl,
      now: () => currentTime,
    });

    await provider.getAccessToken(REF);
    currentTime = 3600_000 - 61_000; // still inside the safety margin's validity window
    expect(await provider.getAccessToken(REF)).toBe('access-1');
    expect(requests).toHaveLength(1);

    currentTime = 3600_000 - 59_000; // within one minute of expiry: token must be refreshed
    expect(await provider.getAccessToken(REF)).toBe('access-2');
    expect(requests).toHaveLength(2);
  });

  it('caches per refresh token reference, not globally', async () => {
    const { fetchImpl, requests } = fakeTokenEndpoint([
      () => tokenResponse('access-1'),
      () => tokenResponse('access-2'),
    ]);
    const provider = createGmailAccessTokenProvider({
      refreshTokenStore,
      clientId: 'client-id',
      clientSecret: 'client-secret',
      fetch: fetchImpl,
      now: () => 0,
    });

    expect(await provider.getAccessToken(REF)).toBe('access-1');
    expect(await provider.getAccessToken(`${REF}-rotated`)).toBe('access-2');
    expect(requests).toHaveLength(2);
  });

  it('fails on a non-2xx response without exposing token material', async () => {
    const { fetchImpl } = fakeTokenEndpoint([
      () => new Response('{"error":"invalid_grant"}', { status: 400 }),
    ]);
    const provider = createGmailAccessTokenProvider({
      refreshTokenStore,
      clientId: 'client-id',
      clientSecret: 'client-secret',
      fetch: fetchImpl,
      now: () => 0,
    });

    const error = (await provider
      .getAccessToken(REF)
      .catch((caught: unknown) => caught)) as Error;

    expect(error.message).toContain('status 400');
    expect(error.message).not.toContain('refresh-token-secret');
    expect(error.message).not.toContain('invalid_grant');
  });

  it('rejects a response that fails schema validation', async () => {
    const { fetchImpl } = fakeTokenEndpoint([
      () => new Response(JSON.stringify({ access_token: '' }), { status: 200 }),
    ]);
    const provider = createGmailAccessTokenProvider({
      refreshTokenStore,
      clientId: 'client-id',
      clientSecret: 'client-secret',
      fetch: fetchImpl,
      now: () => 0,
    });

    await expect(provider.getAccessToken(REF)).rejects.toThrow(/schema validation/);
  });
});
