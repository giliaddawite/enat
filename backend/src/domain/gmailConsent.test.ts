import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../logging/logger.js';
import { captureLogs } from '../testing/httpTestServer.js';
import {
  createGmailConsentService,
  GmailConsentRejectedError,
  REQUIRED_GMAIL_SCOPES,
  type AuthCodeGrant,
} from './gmailConsent.js';

const GRANT: AuthCodeGrant = {
  refreshToken: 'refresh-token-secret',
  grantedScopes: [...REQUIRED_GMAIL_SCOPES],
  idToken: 'id-token-for-uid-1',
};

interface BuildOptions {
  readonly grant?: AuthCodeGrant | (() => Promise<AuthCodeGrant>);
  /** Defaults to asserting `uid-1` for the fixture id_token, `null` for anything else. */
  readonly verifyConsentIdToken?: (idToken: string) => Promise<string | null>;
  readonly setRefreshTokenRef?: () => Promise<void>;
  readonly logger?: Logger;
}

function buildService(options: BuildOptions = {}) {
  const grant = options.grant ?? GRANT;
  const put = vi.fn(() => Promise.resolve('secrets/gmail-refresh-token-uid-1/versions/2'));
  const setRefreshTokenRef = vi.fn(options.setRefreshTokenRef ?? (() => Promise.resolve()));
  const service = createGmailConsentService({
    exchangeAuthCode: typeof grant === 'function' ? grant : () => Promise.resolve(grant),
    verifyConsentIdToken:
      options.verifyConsentIdToken ??
      ((idToken) => Promise.resolve(idToken === 'id-token-for-uid-1' ? 'uid-1' : null)),
    refreshTokens: { put },
    users: { setRefreshTokenRef },
    ...(options.logger ? { logger: options.logger } : {}),
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
      grant: { ...GRANT, grantedScopes: [...REQUIRED_GMAIL_SCOPES, 'openid', 'email'] },
    });

    await service.connect('uid-1', 'auth-code');

    expect(put).toHaveBeenCalledOnce();
  });

  it("rejects with account_mismatch when the id_token asserts a different account's subject", async () => {
    const { service, put, setRefreshTokenRef } = buildService({
      verifyConsentIdToken: () => Promise.resolve('some-other-google-user'),
    });

    const error = await service.connect('uid-1', 'auth-code').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GmailConsentRejectedError);
    expect((error as GmailConsentRejectedError).reason).toBe('account_mismatch');
    expect(put).not.toHaveBeenCalled();
    expect(setRefreshTokenRef).not.toHaveBeenCalled();
  });

  it('rejects with account_mismatch when the exchange carried no id_token at all', async () => {
    const verify = vi.fn(() => Promise.resolve('uid-1'));
    const { service, put } = buildService({
      grant: { ...GRANT, idToken: null },
      verifyConsentIdToken: verify,
    });

    const error = await service.connect('uid-1', 'auth-code').catch((caught: unknown) => caught);

    expect((error as GmailConsentRejectedError).reason).toBe('account_mismatch');
    expect(verify).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it('rejects with account_mismatch when the id_token does not verify', async () => {
    const { service, put } = buildService({
      verifyConsentIdToken: () => Promise.resolve(null),
    });

    const error = await service.connect('uid-1', 'auth-code').catch((caught: unknown) => caught);

    expect((error as GmailConsentRejectedError).reason).toBe('account_mismatch');
    expect(put).not.toHaveBeenCalled();
  });

  it('checks the account binding before scopes — an unbound grant is rejected as such', async () => {
    const { service } = buildService({
      grant: { refreshToken: null, grantedScopes: [], idToken: null },
    });

    const error = await service.connect('uid-1', 'auth-code').catch((caught: unknown) => caught);

    expect((error as GmailConsentRejectedError).reason).toBe('account_mismatch');
  });

  it('rejects with insufficient_scope when a required scope was not granted', async () => {
    const { service, put, setRefreshTokenRef } = buildService({
      grant: { ...GRANT, grantedScopes: ['https://www.googleapis.com/auth/gmail.readonly'] },
    });

    const error = await service.connect('uid-1', 'auth-code').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GmailConsentRejectedError);
    expect((error as GmailConsentRejectedError).reason).toBe('insufficient_scope');
    expect(put).not.toHaveBeenCalled();
    expect(setRefreshTokenRef).not.toHaveBeenCalled();
  });

  it('rejects with no_refresh_token when the exchange returned none', async () => {
    const { service, put } = buildService({ grant: { ...GRANT, refreshToken: null } });

    const error = await service.connect('uid-1', 'auth-code').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GmailConsentRejectedError);
    expect((error as GmailConsentRejectedError).reason).toBe('no_refresh_token');
    expect(put).not.toHaveBeenCalled();
  });

  it('reports insufficient_scope, not no_refresh_token, when both are wrong — the scope choice is what the user must redo', async () => {
    const { service } = buildService({
      grant: { refreshToken: null, grantedScopes: [], idToken: 'id-token-for-uid-1' },
    });

    const error = await service.connect('uid-1', 'auth-code').catch((caught: unknown) => caught);

    expect((error as GmailConsentRejectedError).reason).toBe('insufficient_scope');
  });

  it('propagates an exchange failure without touching the token store', async () => {
    const { service, put } = buildService({
      grant: () => Promise.reject(new Error('endpoint down')),
    });

    await expect(service.connect('uid-1', 'auth-code')).rejects.toThrow('endpoint down');
    expect(put).not.toHaveBeenCalled();
  });

  it('logs a distinct warning when the token is stored but linking it fails', async () => {
    const logs = captureLogs();
    const { service, put } = buildService({
      setRefreshTokenRef: () => Promise.reject(new Error('firestore write failed')),
      logger: logs.logger,
    });

    await expect(service.connect('uid-1', 'auth-code')).rejects.toThrow('firestore write failed');

    expect(put).toHaveBeenCalledOnce();
    const orphanWarning = logs.entries.find((entry) => entry.message.includes('orphaned'));
    expect(orphanWarning).toMatchObject({ severity: 'WARNING', uid: 'uid-1' });
    // The warning names the uid and outcome only — never the token or its ref.
    const logged = JSON.stringify(logs.entries);
    expect(logged).not.toContain('refresh-token-secret');
    expect(logged).not.toContain('versions/2');
  });

  it('never includes the auth code or refresh token in a rejection message', async () => {
    const { service } = buildService({ grant: { ...GRANT, grantedScopes: [] } });

    const error = (await service
      .connect('uid-1', 'auth-code-secret')
      .catch((caught: unknown) => caught)) as Error;

    expect(error.message).not.toContain('auth-code-secret');
    expect(error.message).not.toContain('refresh-token-secret');
  });
});
