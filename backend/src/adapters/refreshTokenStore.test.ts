import { describe, expect, it, vi } from 'vitest';
import { captureLogs } from '../testing/httpTestServer.js';
import {
  createSecretManagerRefreshTokenStore,
  type SecretManagerLike,
} from './refreshTokenStore.js';

interface StoredVersion {
  payload: string;
  destroyed: boolean;
}

interface FakeSecretManager {
  secretManager: SecretManagerLike;
  secrets: Map<string, StoredVersion[]>;
  createSecret: ReturnType<typeof vi.fn>;
  destroySecretVersion: ReturnType<typeof vi.fn>;
}

function fakeSecretManager(): FakeSecretManager {
  const secrets = new Map<string, StoredVersion[]>();

  const versionName = (secretId: string, index: number): string =>
    `projects/enat/secrets/${secretId}/versions/${index + 1}`;

  const locate = (name: string): StoredVersion | undefined => {
    const match = /secrets\/(.+)\/versions\/(\d+)$/.exec(name);
    if (!match) {
      return undefined;
    }
    const [, secretId, versionNumber] = match as unknown as [string, string, string];
    return secrets.get(secretId)?.[Number(versionNumber) - 1];
  };

  // Kept as plain local consts (not object members) so a test can assert on the mocks
  // directly without triggering @typescript-eslint/unbound-method on a detached reference.
  const createSecret = vi.fn((secretId: string) => {
    if (secrets.has(secretId)) {
      return Promise.reject(Object.assign(new Error('ALREADY_EXISTS'), { code: 6 }));
    }
    secrets.set(secretId, []);
    return Promise.resolve();
  });
  const addSecretVersion = vi.fn((secretId: string, payload: string) => {
    const versions = secrets.get(secretId);
    if (versions === undefined) {
      return Promise.reject(Object.assign(new Error('NOT_FOUND'), { code: 5 }));
    }
    versions.push({ payload, destroyed: false });
    return Promise.resolve(versionName(secretId, versions.length - 1));
  });
  const accessSecretVersion = vi.fn((name: string) => {
    const version = locate(name);
    if (version === undefined || version.destroyed) {
      return Promise.reject(Object.assign(new Error('NOT_FOUND'), { code: 5 }));
    }
    return Promise.resolve(version.payload);
  });
  const listEnabledSecretVersions = vi.fn((secretId: string) => {
    const versions = secrets.get(secretId) ?? [];
    return Promise.resolve(
      versions.flatMap((version, index) =>
        version.destroyed ? [] : [versionName(secretId, index)],
      ),
    );
  });
  const destroySecretVersion = vi.fn((name: string) => {
    const version = locate(name);
    if (version === undefined) {
      return Promise.reject(Object.assign(new Error('NOT_FOUND'), { code: 5 }));
    }
    version.destroyed = true;
    version.payload = '';
    return Promise.resolve();
  });

  return {
    secretManager: {
      createSecret,
      addSecretVersion,
      accessSecretVersion,
      listEnabledSecretVersions,
      destroySecretVersion,
    },
    secrets,
    createSecret,
    destroySecretVersion,
  };
}

describe('createSecretManagerRefreshTokenStore', () => {
  it('stores a refresh token and returns a ref that resolves back to it', async () => {
    const { secretManager } = fakeSecretManager();
    const store = createSecretManagerRefreshTokenStore(secretManager);

    const ref = await store.put('google-user-123', 'refresh-token-abc');

    await expect(store.get(ref)).resolves.toBe('refresh-token-abc');
  });

  it('never returns the plaintext token as the ref', async () => {
    const { secretManager } = fakeSecretManager();
    const store = createSecretManagerRefreshTokenStore(secretManager);

    const ref = await store.put('google-user-123', 'refresh-token-abc');

    expect(ref).not.toContain('refresh-token-abc');
  });

  it('rotates by adding a new version when a token is stored again for the same user', async () => {
    const { secretManager, createSecret } = fakeSecretManager();
    const store = createSecretManagerRefreshTokenStore(secretManager);

    const firstRef = await store.put('google-user-123', 'first-token');
    const secondRef = await store.put('google-user-123', 'second-token-after-reconsent');

    expect(secondRef).not.toBe(firstRef);
    await expect(store.get(secondRef)).resolves.toBe('second-token-after-reconsent');
    expect(createSecret).toHaveBeenCalledTimes(2);
  });

  it('destroys the superseded version so an old token stops being redeemable', async () => {
    const { secretManager } = fakeSecretManager();
    const store = createSecretManagerRefreshTokenStore(secretManager);

    const firstRef = await store.put('google-user-123', 'first-token');
    const secondRef = await store.put('google-user-123', 'second-token');

    await expect(store.get(firstRef)).rejects.toThrow();
    await expect(store.get(secondRef)).resolves.toBe('second-token');
  });

  it('sweeps up versions an earlier failed cleanup left behind', async () => {
    const { secretManager, destroySecretVersion } = fakeSecretManager();
    const store = createSecretManagerRefreshTokenStore(secretManager);
    const firstRef = await store.put('google-user-123', 'first-token');
    destroySecretVersion.mockRejectedValueOnce(
      Object.assign(new Error('PERMISSION_DENIED'), { code: 7 }),
    );
    const secondRef = await store.put('google-user-123', 'second-token'); // cleanup fails

    const thirdRef = await store.put('google-user-123', 'third-token');

    await expect(store.get(firstRef)).rejects.toThrow();
    await expect(store.get(secondRef)).rejects.toThrow();
    await expect(store.get(thirdRef)).resolves.toBe('third-token');
  });

  it('still returns the new ref when destroying the old version fails, and logs a warning', async () => {
    const { secretManager, destroySecretVersion } = fakeSecretManager();
    const logs = captureLogs();
    const store = createSecretManagerRefreshTokenStore(secretManager, { logger: logs.logger });
    await store.put('google-user-123', 'first-token');
    destroySecretVersion.mockRejectedValueOnce(
      Object.assign(new Error('DEADLINE_EXCEEDED'), { code: 4 }),
    );

    const ref = await store.put('google-user-123', 'second-token');

    await expect(store.get(ref)).resolves.toBe('second-token');
    expect(logs.entries).toContainEqual(
      expect.objectContaining({
        severity: 'WARNING',
        message: 'failed to destroy a superseded refresh token version',
        error: { name: 'Error', code: 4 },
      }),
    );
  });

  it('never logs a version resource name, which embeds the uid', async () => {
    const { secretManager, destroySecretVersion } = fakeSecretManager();
    const logs = captureLogs();
    const store = createSecretManagerRefreshTokenStore(secretManager, { logger: logs.logger });
    await store.put('google-user-123', 'first-token');
    destroySecretVersion.mockRejectedValueOnce(
      Object.assign(
        new Error('5 NOT_FOUND: projects/enat/secrets/gmail-refresh-token-google-user-123'),
        { code: 5 },
      ),
    );

    await store.put('google-user-123', 'second-token');

    expect(JSON.stringify(logs.entries)).not.toContain('google-user-123');
  });

  it('keeps different users in separate secrets', async () => {
    const { secretManager } = fakeSecretManager();
    const store = createSecretManagerRefreshTokenStore(secretManager);

    const momRef = await store.put('mom-uid', 'mom-token');
    const otherRef = await store.put('other-uid', 'other-token');

    await expect(store.get(momRef)).resolves.toBe('mom-token');
    await expect(store.get(otherRef)).resolves.toBe('other-token');
  });
});
