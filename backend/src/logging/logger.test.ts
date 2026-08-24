import { describe, expect, it } from 'vitest';
import { createLogger, type LogLevel } from './logger.js';

const FIXED_TIME = new Date('2026-08-17T12:00:00.000Z');

function loggerWritingTo(lines: string[], level: LogLevel = 'debug') {
  return createLogger({ level, now: () => FIXED_TIME, write: (line) => void lines.push(line) });
}

describe('createLogger', () => {
  it('writes one JSON object per line', () => {
    const lines: string[] = [];
    loggerWritingTo(lines).info('server listening');

    expect(lines).toHaveLength(1);
    expect(lines[0]?.endsWith('\n')).toBe(true);
  });

  it('emits the severity, message and time keys Cloud Logging promotes', () => {
    const lines: string[] = [];
    loggerWritingTo(lines).info('server listening', { port: 8080 });

    expect(JSON.parse(lines[0] ?? '')).toEqual({
      severity: 'INFO',
      message: 'server listening',
      time: '2026-08-17T12:00:00.000Z',
      port: 8080,
    });
  });

  it('maps warn to the WARNING severity Cloud Logging expects', () => {
    const lines: string[] = [];
    loggerWritingTo(lines).warn('slow response');

    expect(JSON.parse(lines[0] ?? '')).toMatchObject({ severity: 'WARNING' });
  });

  it('drops entries below the configured level', () => {
    const lines: string[] = [];
    const logger = loggerWritingTo(lines, 'warn');

    logger.debug('noise');
    logger.info('noise');
    logger.warn('kept');
    logger.error('kept');

    expect(lines).toHaveLength(2);
  });

  it('stamps child fields onto every entry', () => {
    const lines: string[] = [];
    loggerWritingTo(lines).child({ requestId: 'abc' }).error('request failed');

    expect(JSON.parse(lines[0] ?? '')).toMatchObject({ requestId: 'abc', severity: 'ERROR' });
  });

  it('lets per-call fields override inherited ones', () => {
    const lines: string[] = [];
    loggerWritingTo(lines).child({ scope: 'parent' }).info('hello', { scope: 'call' });

    expect(JSON.parse(lines[0] ?? '')).toMatchObject({ scope: 'call' });
  });

  it('still logs the message when a field cannot be serialized', () => {
    const lines: string[] = [];
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;

    loggerWritingTo(lines).error('request failed', { circular });

    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      severity: 'ERROR',
      message: 'request failed',
      loggingError: 'fields were not serializable and were dropped',
    });
  });
});
