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
  };
}
