import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import {
  IdTokenRejectedError,
  IdTokenVerificationUnavailableError,
  type IdTokenVerifier,
} from '../adapters/idTokenVerifier.js';
import { captureLogs, startTestServer, type TestServer } from '../testing/httpTestServer.js';
import { errorHandler } from './errorHandler.js';
import { notFound } from './notFound.js';
import { verifyPubSubPush } from './pubsubPush.js';
import { requestId } from './requestId.js';
import { requestLogging } from './requestLogging.js';

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

const INVOKER_EMAIL = 'enat-scheduler@enat-staging.iam.gserviceaccount.com';

function scriptedVerifier(outcome: 'ok' | 'wrong-email' | 'rejected' | 'unavailable'): IdTokenVerifier {
  return {
    verify() {
      switch (outcome) {
        case 'ok':
          return Promise.resolve({
            googleUserId: '12345',
            email: INVOKER_EMAIL,
            emailVerified: true,
          });
        case 'wrong-email':
          return Promise.resolve({
            googleUserId: '99999',
            email: 'someone-else@example.com',
            emailVerified: true,
          });
        case 'rejected':
          return Promise.reject(new IdTokenRejectedError('invalid_signature', 'bad signature'));
        case 'unavailable':
          return Promise.reject(
            new IdTokenVerificationUnavailableError('JWKS endpoint unreachable'),
          );
      }
    },
  };
}

async function serve(idTokenVerifier: IdTokenVerifier) {
  const logs = captureLogs();
  const app = express();
  app.use(requestId(() => 'fixed-request-id'));
  app.use(requestLogging({ logger: logs.logger, monotonicNow: () => 0 }));
  app.post(
    '/internal/digest-generate',
    verifyPubSubPush({ idTokenVerifier, allowedInvokerEmail: INVOKER_EMAIL }),
    (_req, res) => res.status(204).end(),
  );
  app.use(notFound);
  app.use(errorHandler(logs.logger));
  server = await startTestServer(app);
  return server;
}

describe('verifyPubSubPush', () => {
  it('accepts a token from the configured invoker service account', async () => {
    const running = await serve(scriptedVerifier('ok'));

    const response = await running.fetch('/internal/digest-generate', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-token' },
    });

    expect(response.status).toBe(204);
  });

  it('rejects a request with no Authorization header', async () => {
    const running = await serve(scriptedVerifier('ok'));

    const response = await running.fetch('/internal/digest-generate', { method: 'POST' });

    expect(response.status).toBe(401);
  });

  it('rejects a validly-signed token from a different service account', async () => {
    const running = await serve(scriptedVerifier('wrong-email'));

    const response = await running.fetch('/internal/digest-generate', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-token' },
    });

    expect(response.status).toBe(403);
  });

  it('rejects a token the verifier rejects', async () => {
    const running = await serve(scriptedVerifier('rejected'));

    const response = await running.fetch('/internal/digest-generate', {
      method: 'POST',
      headers: { Authorization: 'Bearer forged' },
    });

    expect(response.status).toBe(401);
  });

  it('answers 503, not 401, when verification itself is unavailable', async () => {
    const running = await serve(scriptedVerifier('unavailable'));

    const response = await running.fetch('/internal/digest-generate', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-token' },
    });

    expect(response.status).toBe(503);
  });
});
