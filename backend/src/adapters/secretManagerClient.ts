import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import type { SecretManagerLike } from './refreshTokenStore.js';

/**
 * Adapts the real Secret Manager gRPC client to the narrow `SecretManagerLike` shape
 * `createSecretManagerRefreshTokenStore` needs — unwrapping gax's `[response]` tuples and
 * the payload `Buffer` into plain values, so nothing above this file ever handles the SDK's
 * wire types directly.
 */
export function createGoogleSecretManagerClient(projectId: string): SecretManagerLike {
  const client = new SecretManagerServiceClient();
  const parent = `projects/${projectId}`;

  return {
    async createSecret(secretId) {
      await client.createSecret({
        parent,
        secretId,
        secret: { replication: { automatic: {} } },
      });
    },

    async addSecretVersion(secretId, payload) {
      const [version] = await client.addSecretVersion({
        parent: `${parent}/secrets/${secretId}`,
        payload: { data: Buffer.from(payload, 'utf8') },
      });
      if (!version.name) {
        throw new Error('Secret Manager did not return a version name');
      }
      return version.name;
    },

    async accessSecretVersion(versionName) {
      const [response] = await client.accessSecretVersion({ name: versionName });
      const data = response.payload?.data;
      if (data === null || data === undefined) {
        throw new Error('Secret Manager returned an empty payload');
      }
      return Buffer.from(data).toString('utf8');
    },

    async listEnabledSecretVersions(secretId) {
      const [versions] = await client.listSecretVersions({
        parent: `${parent}/secrets/${secretId}`,
      });
      // Filtered client-side: `state` arrives as the enum name over JSON and the enum
      // number over gRPC, and a server-side filter string would tie this to API details a
      // test fake cannot honestly reproduce.
      return versions
        .filter((version) => isEnabledState(version.state))
        .map((version) => version.name)
        .filter((name): name is string => typeof name === 'string' && name.length > 0);
    },

    async destroySecretVersion(versionName) {
      await client.destroySecretVersion({ name: versionName });
    },
  };
}

/** The proto enum serializes as `'ENABLED'` over JSON and `1` over gRPC; accept either. */
function isEnabledState(state: unknown): boolean {
  return state === 'ENABLED' || state === 1;
}
