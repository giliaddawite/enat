import { describe, expect, it } from 'vitest';
import {
  AuthCodeExchangeUnavailableError,
  GmailConsentRejectedError,
} from '../domain/gmailConsent.js';
import { createGoogleAuthCodeExchanger } from './googleAuthCodeExchange.js';

const SCOPES =
  'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify';

function fakeTokenEndpoint(responses: (() => Response)[]): {
  fetchImpl: typeof fetch;
  requests: { url: string; body: string }[];
} {
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

const successResponse = (payload: Record<string, unknown>): Response =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

function buildExchanger(responses: (() => Response)[]) {
  const { fetchImpl, requests } = fakeTokenEndpoint(responses);
  const exchange = createGoogleAuthCodeExchanger({
    clientId: 'client-id',
    clientSecret: 'client-secret-value',
    fetch: fetchImpl,
  });
  return { exchange, requests };
}

describe('createGoogleAuthCodeExchanger', () => {
  it('posts an authorization_code grant with the code and client credentials', async () => {
    const { exchange, requests } = buildExchanger([
      () => successResponse({ refresh_token: 'refresh-1', scope: SCOPES }),
    ]);

    await exchange('one-time-code');

    expect(requests[0]?.url).toBe('https://oauth2.googleapis.com/token');
    const body = new URLSearchParams(requests[0]?.body);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('one-time-code');
    expect(body.get('client_id')).toBe('client-id');
    expect(body.get('client_secret')).toBe('client-secret-value');
    // A server auth code minted on Android is issued without a redirect URI.
    expect(body.has('redirect_uri')).toBe(false);
  });

  it('returns the refresh token, granted scopes, and the id_token binding the grant', async () => {
    const { exchange } = buildExchanger([
      () =>
        successResponse({ refresh_token: 'refresh-1', scope: SCOPES, id_token: 'jwt-id-token' }),
    ]);

    await expect(exchange('code')).resolves.toEqual({
      refreshToken: 'refresh-1',
      grantedScopes: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.modify',
      ],
      idToken: 'jwt-id-token',
    });
  });

  it('reports missing refresh_token, scope, and id_token as null/empty rather than failing', async () => {
    const { exchange } = buildExchanger([() => successResponse({ access_token: 'unused' })]);

    await expect(exchange('code')).resolves.toEqual({
      refreshToken: null,
      grantedScopes: [],
      idToken: null,
    });
  });

  it('maps invalid_grant to a GmailConsentRejectedError the route can answer 400 with', async () => {
    const { exchange } = buildExchanger([
      () =>
        new Response('{"error":"invalid_grant","error_description":"Malformed auth code."}', {
          status: 400,
        }),
    ]);

    const error = await exchange('bad-code').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GmailConsentRejectedError);
    expect((error as GmailConsentRejectedError).reason).toBe('invalid_grant');
  });

  it('treats any other rejection as unavailable, exposing only the status', async () => {
    const { exchange } = buildExchanger([
      () => new Response('{"error":"invalid_client"}', { status: 401 }),
    ]);

    const error = (await exchange('code').catch((caught: unknown) => caught)) as Error;

    expect(error).toBeInstanceOf(AuthCodeExchangeUnavailableError);
    expect(error.message).toContain('status 401');
    expect(error.message).not.toContain('invalid_client');
  });

  it('treats a 5xx as unavailable without retrying — the user is waiting', async () => {
    const { exchange, requests } = buildExchanger([
      () => new Response('upstream exploded', { status: 502 }),
    ]);

    await expect(exchange('code')).rejects.toBeInstanceOf(AuthCodeExchangeUnavailableError);
    expect(requests).toHaveLength(1);
  });

  it('treats a network failure as unavailable', async () => {
    const exchange = createGoogleAuthCodeExchanger({
      clientId: 'client-id',
      clientSecret: 'client-secret-value',
      fetch: () => Promise.reject(new TypeError('fetch failed')),
    });

    await expect(exchange('code')).rejects.toBeInstanceOf(AuthCodeExchangeUnavailableError);
  });

  it('rejects a 200 whose body is not JSON or fails the schema', async () => {
    const { exchange } = buildExchanger([
      () => new Response('<html>proxy page</html>', { status: 200 }),
      () => successResponse({ refresh_token: 42 }),
    ]);

    await expect(exchange('code')).rejects.toBeInstanceOf(AuthCodeExchangeUnavailableError);
    await expect(exchange('code')).rejects.toThrow(/schema validation/);
  });

  it('never includes the auth code or client secret in an error message', async () => {
    const { exchange } = buildExchanger([
      () => new Response('{"error":"invalid_grant"}', { status: 400 }),
    ]);

    const error = (await exchange('auth-code-secret').catch((caught: unknown) => caught)) as Error;

    expect(error.message).not.toContain('auth-code-secret');
    expect(error.message).not.toContain('client-secret-value');
  });
});
