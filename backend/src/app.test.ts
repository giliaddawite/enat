import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { captureLogs, startTestServer, type TestServer } from './testing/httpTestServer.js';

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function serve() {
  const logs = captureLogs();
  const config = loadConfig({ NODE_ENV: 'test' });
  server = await startTestServer(createApp({ config, logger: logs.logger }));
  return { server, logs };
}

describe('the assembled app', () => {
  it('reports healthy on GET /healthz', async () => {
    const { server: running } = await serve();

    const response = await running.fetch('/healthz');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('keeps the health response out of caches so probes see live state', async () => {
    const { server: running } = await serve();

    expect((await running.fetch('/healthz')).headers.get('cache-control')).toBe('no-store');
  });

  it('assigns a request id to every response', async () => {
    const { server: running } = await serve();

    const id = (await running.fetch('/healthz')).headers.get('x-request-id');

    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('does not advertise the server implementation', async () => {
    const { server: running } = await serve();

    expect((await running.fetch('/healthz')).headers.get('x-powered-by')).toBeNull();
  });

  it('answers an unknown route with the standard error envelope', async () => {
    const { server: running } = await serve();

    const response = await running.fetch('/nope');

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'not_found' } });
  });

  it('logs the health check with a request id and a latency', async () => {
    const { server: running, logs } = await serve();

    await running.fetch('/healthz');
    const entry = await logs.waitFor((candidate) => candidate['httpRequest'] !== undefined);

    expect(entry.severity).toBe('INFO');
    expect(entry['requestId']).toEqual(expect.any(String));
    expect(entry['httpRequest']).toMatchObject({ requestUrl: '/healthz', status: 200 });
    expect((entry['httpRequest'] as { latency: string }).latency).toMatch(/^\d+\.\d{3}s$/);
  });
});
