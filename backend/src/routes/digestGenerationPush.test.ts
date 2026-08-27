import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Digest } from '../domain/digest.js';
import {
  GmailNotConnectedError,
  GmailReconnectRequiredError,
  type DigestGenerationService,
} from '../domain/digestGeneration.js';
import type { User } from '../domain/user.js';
import { errorHandler } from '../http/errorHandler.js';
import { notFound } from '../http/notFound.js';
import { requestId } from '../http/requestId.js';
import { requestLogging } from '../http/requestLogging.js';
import { captureLogs, startTestServer, type TestServer } from '../testing/httpTestServer.js';
import { createDigestGenerationPushHandler } from './digestGenerationPush.js';

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

const USER: User = {
  uid: 'uid-1',
  email: 'mom@example.com',
  createdAt: '2020-01-01T00:00:00.000Z',
  locale: 'am',
  refreshTokenRef: 'secret-ref',
};

const DIGEST: Digest = {
  date: '2026-08-17',
  userId: 'uid-1',
  sections: [],
  generatedAt: '2026-08-17T06:30:00.000Z',
  emailCount: 0,
};

function pushEnvelope(payload: unknown): unknown {
  return {
    message: { data: Buffer.from(JSON.stringify(payload)).toString('base64') },
  };
}

function fakeGeneration(behavior: () => Promise<{ digest: Digest; persisted: boolean }>): DigestGenerationService {
  return { generate: behavior };
}

async function serve(deps: {
  getUser: (uid: string) => Promise<User | null>;
  generation: DigestGenerationService;
}) {
  const logs = captureLogs();
  const app = express();
  app.use(requestId(() => 'fixed-request-id'));
  app.use(requestLogging({ logger: logs.logger, monotonicNow: () => 0 }));
  app.post(
    '/internal/digest-generate',
    express.json(),
    createDigestGenerationPushHandler({ ...deps, logger: logs.logger }),
  );
  app.use(notFound);
  app.use(errorHandler(logs.logger));
  server = await startTestServer(app);
  return server;
}

describe('createDigestGenerationPushHandler', () => {
  it('generates for the named user and acks with 204', async () => {
    const generate = vi.fn(() => Promise.resolve({ digest: DIGEST, persisted: true }));
    const running = await serve({
      getUser: () => Promise.resolve(USER),
      generation: fakeGeneration(generate),
    });

    const response = await running.fetch('/internal/digest-generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(pushEnvelope({ uid: 'uid-1' })),
    });

    expect(response.status).toBe(204);
    expect(generate).toHaveBeenCalledWith(USER);
  });

  it('acks (does not ask for retry) when the envelope fails validation', async () => {
    const generate = vi.fn(() => Promise.resolve({ digest: DIGEST, persisted: true }));
    const running = await serve({
      getUser: () => Promise.resolve(USER),
      generation: fakeGeneration(generate),
    });

    const response = await running.fetch('/internal/digest-generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ not: 'a pubsub envelope' }),
    });

    expect(response.status).toBe(200);
    expect(generate).not.toHaveBeenCalled();
  });

  it('acks when the message payload is not valid JSON', async () => {
    const running = await serve({
      getUser: () => Promise.resolve(USER),
      generation: fakeGeneration(() => Promise.resolve({ digest: DIGEST, persisted: true })),
    });

    const response = await running.fetch('/internal/digest-generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: { data: Buffer.from('not json').toString('base64') } }),
    });

    expect(response.status).toBe(200);
  });

  it('acks when the uid names no known user', async () => {
    const generate = vi.fn(() => Promise.resolve({ digest: DIGEST, persisted: true }));
    const running = await serve({
      getUser: () => Promise.resolve(null),
      generation: fakeGeneration(generate),
    });

    const response = await running.fetch('/internal/digest-generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(pushEnvelope({ uid: 'no-such-uid' })),
    });

    expect(response.status).toBe(200);
    expect(generate).not.toHaveBeenCalled();
  });

  it('acks when the user has not connected Gmail — retrying will not help', async () => {
    const running = await serve({
      getUser: () => Promise.resolve(USER),
      generation: fakeGeneration(() => Promise.reject(new GmailNotConnectedError(USER.uid))),
    });

    const response = await running.fetch('/internal/digest-generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(pushEnvelope({ uid: 'uid-1' })),
    });

    expect(response.status).toBe(200);
  });

  it('acks when the Gmail grant was revoked — only re-consent on the device fixes that', async () => {
    const running = await serve({
      getUser: () => Promise.resolve(USER),
      generation: fakeGeneration(() => Promise.reject(new GmailReconnectRequiredError())),
    });

    const response = await running.fetch('/internal/digest-generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(pushEnvelope({ uid: 'uid-1' })),
    });

    expect(response.status).toBe(200);
  });

  it('answers 5xx (asking Pub/Sub to retry) on an unexpected generation failure', async () => {
    const running = await serve({
      getUser: () => Promise.resolve(USER),
      generation: fakeGeneration(() => Promise.reject(new Error('gmail api down'))),
    });

    const response = await running.fetch('/internal/digest-generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(pushEnvelope({ uid: 'uid-1' })),
    });

    expect(response.status).toBe(500);
  });
});
