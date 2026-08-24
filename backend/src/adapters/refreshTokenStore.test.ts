import { describe, expect, it, vi } from 'vitest';
import { createSecretManagerRefreshTokenStore, type SecretManagerLike } from './refreshTokenStore.js';

function fakeSecretManager(): {
  secretManager: SecretManagerLike;
  secrets: Map<string, string[]>;
  createSecret: ReturnType<typeof vi.fn>;
} {
  const secrets = new Map<string, string[]>();

  // Kept as plain local consts (not object members) so a test can assert on `createSecret`
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
    versions.push(payload);
    return Promise.resolve(`projects/enat/secrets/${secretId}/versions/${versions.length}`);
  });
  const accessSecretVersion = vi.fn((versionName: string) => {
    const match = /secrets\/(.+)\/versions\/(\d+)$/.exec(versionName);
    if (!match) {
      return Promise.reject(new Error('malformed version name'));
    }
    const [, secretId, versionNumber] = match as unknown as [string, string, string];
    const versions = secrets.get(secretId);
    const payload = versions?.[Number(versionNumber) - 1];
    if (payload === undefined) {
      return Promise.reject(Object.assign(new Error('NOT_FOUND'), { code: 5 }));
    }
    return Promise.resolve(payload);
  });

  return {
    secretManager: { createSecret, addSecretVersion, accessSecretVersion },
    secrets,
    createSecret,
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
    await expect(store.get(firstRef)).resolves.toBe('first-token');
    await expect(store.get(secondRef)).resolves.toBe('second-token-after-reconsent');
    expect(createSecret).toHaveBeenCalledTimes(2);
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
