import { once } from 'node:events';
import net, { type AddressInfo } from 'node:net';
import type { Express } from 'express';
import { createLogger, type LogFields, type Logger } from '../logging/logger.js';

export interface TestServer {
  readonly url: string;
  fetch(path: string, init?: RequestInit): Promise<Response>;
  /**
   * Sends a raw request line so tests can use request targets fetch() will not emit —
   * absolute-form targets and fragments, which is where URL handling tends to be wrong.
   */
  sendRawRequestTarget(target: string): Promise<void>;
  close(): Promise<void>;
}

/** Binds `app` to an ephemeral loopback port so tests exercise the real HTTP stack. */
export async function startTestServer(app: Express): Promise<TestServer> {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}`;

  return {
    url,
    fetch: (path, init) => fetch(`${url}${path}`, init),
    sendRawRequestTarget: (target) =>
      new Promise<void>((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1', () => {
          socket.write(
            `GET ${target} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`,
          );
        });
        socket.on('end', () => resolve());
        socket.on('error', reject);
        socket.resume();
      }),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

export interface LogEntry extends LogFields {
  severity: string;
  message: string;
  time: string;
}

export interface CapturedLog {
  readonly entries: LogEntry[];
  readonly logger: Logger;
  /**
   * Resolves with the first entry matching `predicate`, past or future. Access log entries
   * are written from the response 'close' event, which can land after fetch() resolves.
   */
  waitFor(predicate: (entry: LogEntry) => boolean): Promise<LogEntry>;
}

/** A logger writing to an array, with a fixed clock so entries are byte-for-byte stable. */
export function captureLogs(time = new Date('2026-08-17T12:00:00.000Z')): CapturedLog {
  const entries: LogEntry[] = [];
  const pending: ((entry: LogEntry) => void)[] = [];

  const logger = createLogger({
    level: 'debug',
    now: () => time,
    write: (line) => {
      const entry = JSON.parse(line) as LogEntry;
      entries.push(entry);
      for (const notify of pending.splice(0)) {
        notify(entry);
      }
    },
  });

  const waitFor = (predicate: (entry: LogEntry) => boolean): Promise<LogEntry> => {
    const existing = entries.find(predicate);
    if (existing !== undefined) {
      return Promise.resolve(existing);
    }
    return new Promise<LogEntry>((resolve) => {
      const onEntry = (entry: LogEntry): void => {
        if (predicate(entry)) {
          resolve(entry);
        } else {
          pending.push(onEntry);
        }
      };
      pending.push(onEntry);
    });
  };

  return { entries, logger, waitFor };
}
