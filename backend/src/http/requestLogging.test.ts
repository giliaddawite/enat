import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import {
  captureLogs,
  startTestServer,
  type LogEntry,
  type TestServer,
} from '../testing/httpTestServer.js';
import { requestId } from './requestId.js';
import { requestLogging } from './requestLogging.js';

const TRACE_ID = '105445aa7843bc8bf206b12000100000';

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

/** Advances the injected clock by exactly 150ms across a request, so latency is exact. */
function fixedLatencyClock(): () => number {
  const readings = [0, 150];
  return () => readings.shift() ?? 150;
}

async function serve(options: { projectId?: string } = {}) {
  const logs = captureLogs();
  const app = express();
  app.use(requestId(() => 'fixed-request-id'));
  app.use(
    requestLogging({
      logger: logs.logger,
      monotonicNow: fixedLatencyClock(),
      ...(options.projectId ? { projectId: options.projectId } : {}),
    }),
  );
  app.get('/ok', (_req, res) => void res.json({ ok: true }));
  app.get('/missing', (_req, res) => void res.status(404).json({ ok: false }));
  app.get('/broken', (_req, res) => void res.status(500).json({ ok: false }));
  server = await startTestServer(app);
  return { server, logs };
}

const isAccessLog = (entry: LogEntry): boolean => entry['httpRequest'] !== undefined;

describe('requestLogging middleware', () => {
  it('logs one access entry carrying method, status and latency', async () => {
    const { server: running, logs } = await serve();

    await running.fetch('/ok');
    const entry = await logs.waitFor(isAccessLog);

    expect(entry).toMatchObject({
      severity: 'INFO',
      requestId: 'fixed-request-id',
      httpRequest: {
        requestMethod: 'GET',
        requestUrl: '/ok',
        status: 200,
        latency: '0.150s',
      },
    });
  });

  it('keeps query strings out of the logged URL because they can carry user data', async () => {
    const { server: running, logs } = await serve();

    await running.fetch('/ok?email=mom%40example.com');
    const entry = await logs.waitFor(isAccessLog);

    expect(entry['httpRequest']).toMatchObject({ requestUrl: '/ok' });
  });

  it('never logs the credentials in an absolute-form request target', async () => {
    const { server: running, logs } = await serve();

    await running.sendRawRequestTarget('http://user:hunter2@evil.example.com/ok?token=abc');
    const entry = await logs.waitFor(isAccessLog);

    expect(entry['httpRequest']).toMatchObject({ requestUrl: '/ok' });
    expect(JSON.stringify(entry)).not.toContain('hunter2');
    expect(JSON.stringify(entry)).not.toContain('evil.example.com');
  });

  it('keeps a caller-invented fragment out of the logged URL', async () => {
    const { server: running, logs } = await serve();

    await running.sendRawRequestTarget('/ok#injected?token=abc');
    const entry = await logs.waitFor(isAccessLog);

    expect(entry['httpRequest']).toMatchObject({ requestUrl: '/ok' });
  });

  it('truncates a caller-controlled path so one request cannot flood the log', async () => {
    const { server: running, logs } = await serve();

    await running.fetch(`/${'a'.repeat(4000)}`);
    const entry = await logs.waitFor(isAccessLog);

    expect((entry['httpRequest'] as { requestUrl: string }).requestUrl).toHaveLength(256);
  });

  it('logs a 4xx response at WARNING', async () => {
    const { server: running, logs } = await serve();

    await running.fetch('/missing');
    const entry = await logs.waitFor(isAccessLog);

    expect(entry.severity).toBe('WARNING');
  });

  it('logs a 5xx response at ERROR', async () => {
    const { server: running, logs } = await serve();

    await running.fetch('/broken');
    const entry = await logs.waitFor(isAccessLog);

    expect(entry.severity).toBe('ERROR');
  });

  it('correlates entries with Cloud Trace when a project id is configured', async () => {
    const { server: running, logs } = await serve({ projectId: 'enat-staging' });

    await running.fetch('/ok', { headers: { 'X-Cloud-Trace-Context': `${TRACE_ID}/1;o=1` } });
    const entry = await logs.waitFor(isAccessLog);

    expect(entry['logging.googleapis.com/trace']).toBe(`projects/enat-staging/traces/${TRACE_ID}`);
  });

  it('omits the trace field when no project id is configured', async () => {
    const { server: running, logs } = await serve();

    await running.fetch('/ok', { headers: { 'X-Cloud-Trace-Context': `${TRACE_ID}/1;o=1` } });
    const entry = await logs.waitFor(isAccessLog);

    expect(entry['logging.googleapis.com/trace']).toBeUndefined();
  });
});
