import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import {
  captureLogs,
  startTestServer,
  type LogEntry,
  type TestServer,
} from '../testing/httpTestServer.js';
import { errorHandler } from './errorHandler.js';
import { HttpError } from './httpError.js';
import { notFound } from './notFound.js';
import { requestId } from './requestId.js';
import { requestLogging } from './requestLogging.js';

const SECRET = 'connection string postgres://user:hunter2@db.internal/enat';

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function serve() {
  const logs = captureLogs();
  const app = express();
  app.use(requestId(() => 'fixed-request-id'));
  app.use(requestLogging({ logger: logs.logger, monotonicNow: () => 0 }));
  app.get('/throws', () => {
    throw new Error(SECRET);
  });
  app.get('/rejects', async () => {
    await Promise.resolve();
    throw new Error(SECRET);
  });
  // Rejecting with a non-Error is exactly the misbehaviour the handler has to survive.
  // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
  app.get('/rejects-a-string', () => Promise.reject('a bare string'));
  app.get('/forbidden', () => {
    throw new HttpError(403, 'You do not have access to this mailbox');
  });
  app.get('/teapot', () => {
    throw new HttpError(418);
  });
  app.get('/upstream-unavailable', () => {
    throw new HttpError(503, SECRET);
  });
  app.get('/parser-style-error', () => {
    throw Object.assign(new Error('Unexpected token in JSON'), { status: 400 });
  });
  app.use(notFound);
  app.use(errorHandler(logs.logger));
  server = await startTestServer(app);
  return { server, logs };
}

const isFailureLog = (entry: LogEntry): boolean => entry.message === 'request failed';

describe('errorHandler', () => {
  it('turns an unexpected throw into a 500', async () => {
    const { server: running } = await serve();

    expect((await running.fetch('/throws')).status).toBe(500);
  });

  it('never puts a stack trace in the response body', async () => {
    const { server: running } = await serve();

    const body = await (await running.fetch('/throws')).text();

    expect(body).not.toContain('at ');
    expect(body).not.toContain('errorHandler.test');
  });

  it('never leaks the original error message of a 500', async () => {
    const { server: running } = await serve();

    const body = await (await running.fetch('/throws')).text();

    expect(body).not.toContain('hunter2');
    expect(JSON.parse(body)).toEqual({
      error: {
        code: 'internal_server_error',
        message: 'Internal Server Error',
        requestId: 'fixed-request-id',
      },
    });
  });

  it('handles a rejected promise from an async route', async () => {
    const { server: running } = await serve();

    const response = await running.fetch('/rejects');

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('hunter2');
  });

  it('handles a rejection that is not an Error at all', async () => {
    const { server: running } = await serve();

    expect((await running.fetch('/rejects-a-string')).status).toBe(500);
  });

  it('strips the message from a 5xx HttpError as well', async () => {
    const { server: running } = await serve();

    const response = await running.fetch('/upstream-unavailable');

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: 'service_unavailable', message: 'Service Unavailable' },
    });
  });

  it('returns the client-safe message of a 4xx HttpError', async () => {
    const { server: running } = await serve();

    const response = await running.fetch('/forbidden');

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: {
        code: 'forbidden',
        message: 'You do not have access to this mailbox',
        requestId: 'fixed-request-id',
      },
    });
  });

  it('defaults an HttpError message to the standard status text', async () => {
    const { server: running } = await serve();

    expect(await (await running.fetch('/teapot')).json()).toMatchObject({
      error: { message: "I'm a Teapot" },
    });
  });

  it('honours a 4xx status declared by a third-party error', async () => {
    const { server: running } = await serve();

    const response = await running.fetch('/parser-style-error');

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'bad_request' } });
  });

  it('answers an unmatched route with 404', async () => {
    const { server: running } = await serve();

    const response = await running.fetch('/no-such-route');

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'not_found' } });
  });

  it('logs a 5xx at ERROR with the request id and the stack', async () => {
    const { server: running, logs } = await serve();

    await running.fetch('/throws');
    const entry = await logs.waitFor(isFailureLog);

    expect(entry).toMatchObject({
      severity: 'ERROR',
      requestId: 'fixed-request-id',
      status: 500,
      error: { name: 'Error', message: SECRET },
    });
    expect((entry['error'] as { stack: string }).stack).toContain('at ');
  });

  it('describes a non-Error rejection by shape only, never by value', async () => {
    const { server: running, logs } = await serve();

    await running.fetch('/rejects-a-string');
    const entry = await logs.waitFor(isFailureLog);

    expect(entry['error']).toEqual({ name: 'NonError', type: 'string' });
  });

  it('logs a 4xx at WARNING without a stack', async () => {
    const { server: running, logs } = await serve();

    await running.fetch('/forbidden');
    const entry = await logs.waitFor((candidate) => candidate.message === 'request rejected');

    expect(entry).toMatchObject({ severity: 'WARNING', status: 403, code: 'forbidden' });
    expect(entry['error']).toBeUndefined();
  });
});
