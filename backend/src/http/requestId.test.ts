import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { startTestServer, type TestServer } from '../testing/httpTestServer.js';
import { requestId } from './requestId.js';

const GENERATED = 'generated-request-id';

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

/** Serves a route that reports back the id the middleware settled on. */
async function serveEcho(): Promise<TestServer> {
  const app = express();
  app.use(requestId(() => GENERATED));
  app.get('/echo', (req, res) => {
    res.json({ requestId: req.requestId });
  });
  server = await startTestServer(app);
  return server;
}

async function settledId(suppliedId?: string): Promise<string> {
  const running = await serveEcho();
  const response = await running.fetch(
    '/echo',
    suppliedId === undefined ? undefined : { headers: { 'X-Request-Id': suppliedId } },
  );
  const body = (await response.json()) as { requestId: string };
  return body.requestId;
}

describe('requestId middleware', () => {
  it('assigns an id to the request', async () => {
    expect(await settledId()).toBe(GENERATED);
  });

  it('echoes the id back in the X-Request-Id response header', async () => {
    const running = await serveEcho();

    const response = await running.fetch('/echo');

    expect(response.headers.get('x-request-id')).toBe(GENERATED);
  });

  it('ignores an id supplied by the caller, so the audit trail stays server-owned', async () => {
    expect(await settledId('client-supplied-0001')).toBe(GENERATED);
  });

  it('cannot be made to echo caller-controlled text into the response header', async () => {
    const running = await serveEcho();

    const response = await running.fetch('/echo', {
      headers: { 'X-Request-Id': 'has spaces and <injected> markup' },
    });

    expect(response.headers.get('x-request-id')).toBe(GENERATED);
  });

  it('gives two requests distinct ids by default', async () => {
    const app = express();
    app.use(requestId());
    app.get('/echo', (req, res) => void res.json({ requestId: req.requestId }));
    server = await startTestServer(app);

    const first = (await (await server.fetch('/echo')).json()) as { requestId: string };
    const second = (await (await server.fetch('/echo')).json()) as { requestId: string };

    expect(first.requestId).not.toBe(second.requestId);
  });
});
