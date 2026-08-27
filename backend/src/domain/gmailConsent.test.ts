import { describe, expect, it, vi } from 'vitest';
import {
  createGmailConsentService,
  GmailConsentRejectedError,
  REQUIRED_GMAIL_SCOPES,
  type AuthCodeGrant,
} from './gmailConsent.js';

const GRANT: AuthCodeGrant = {
  refreshToken: 'refresh-token-secret',
  grantedScopes: [...REQUIRED_GMAIL_SCOPES],
};

function buildService(grant: AuthCodeGrant | (() => Promise<AuthCodeGrant>) = GRANT) {
  const put = vi.fn(() => Promise.resolve('secrets/gmail-refresh-token-uid-1/versions/2'));
  const setRefreshTokenRef = vi.fn(() => Promise.resolve());
  const service = createGmailConsentService({
    exchangeAuthCode: typeof grant === 'function' ? grant : () => Promise.resolve(grant),
    refreshTokens: { put },
    users: { setRefreshTokenRef },
  });
  return { service, put, setRefreshTokenRef };
}

describe('createGmailConsentService', () => {
  it('stores the refresh token and links its ref to the user record', async () => {
    const { service, put, setRefreshTokenRef } = buildService();

    await service.connect('uid-1', 'auth-code');

    expect(put).toHaveBeenCalledWith('uid-1', 'refresh-token-secret');
    expect(setRefreshTokenRef).toHaveBeenCalledWith(
      'uid-1',
      'secrets/gmail-refresh-token-uid-1/versions/2',
    );
  });

  it('accepts a grant carrying extra scopes beyond the required two', async () => {
    const { service, put } = buildService({
      ...GRANT,
      grantedScopes: [...REQUIRED_GMAIL_SCOPES, 'openid', 'email'],
    });

    await service.connect('uid-1', 'auth-code');

    expect(put).toHaveBeenCalledOnce();
  });

  it('rejects with insufficient_scope when a required scope was not granted', async () => {
    const { service, put, setRefreshTokenRef } = buildService({
      ...GRANT,
      grantedScopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    });

    const error = await service.connect('uid-1', 'auth-code').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GmailConsentRejectedError);
    expect((error as GmailConsentRejectedError).reason).toBe('insufficient_scope');
    expect(put).not.toHaveBeenCalled();
    expect(setRefreshTokenRef).not.toHaveBeenCalled();
  });

  it('rejects with no_refresh_token when the exchange returned none', async () => {
    const { service, put } = buildService({ ...GRANT, refreshToken: null });

    const error = await service.connect('uid-1', 'auth-code').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GmailConsentRejectedError);
    expect((error as GmailConsentRejectedError).reason).toBe('no_refresh_token');
    expect(put).not.toHaveBeenCalled();
  });

  it('reports insufficient_scope, not no_refresh_token, when both are wrong — the scope choice is what the user must redo', async () => {
    const { service } = buildService({ refreshToken: null, grantedScopes: [] });

    const error = await service.connect('uid-1', 'auth-code').catch((caught: unknown) => caught);

    expect((error as GmailConsentRejectedError).reason).toBe('insufficient_scope');
  });

  it('propagates an exchange failure without touching the token store', async () => {
    const { service, put } = buildService(() => Promise.reject(new Error('endpoint down')));

    await expect(service.connect('uid-1', 'auth-code')).rejects.toThrow('endpoint down');
    expect(put).not.toHaveBeenCalled();
  });

  it('never includes the auth code or refresh token in a rejection message', async () => {
    const { service } = buildService({ ...GRANT, grantedScopes: [] });

    const error = (await service
      .connect('uid-1', 'auth-code-secret')
      .catch((caught: unknown) => caught)) as Error;

    expect(error.message).not.toContain('auth-code-secret');
    expect(error.message).not.toContain('refresh-token-secret');
  });
});
