import { describe, expect, it } from 'vitest';
import { parseTraceId, traceResourceName } from './cloudTrace.js';

const TRACE_ID = '105445aa7843bc8bf206b12000100000';

describe('parseTraceId', () => {
  it('extracts the trace id from a full Cloud Run header', () => {
    expect(parseTraceId(`${TRACE_ID}/1234567890;o=1`)).toBe(TRACE_ID);
  });

  it('accepts a header carrying only the trace id', () => {
    expect(parseTraceId(TRACE_ID)).toBe(TRACE_ID);
  });

  it('returns undefined when the header is absent', () => {
    expect(parseTraceId(undefined)).toBeUndefined();
  });

  it('rejects a trace id that is not 32 hex characters', () => {
    expect(parseTraceId('not-a-trace/1;o=1')).toBeUndefined();
  });

  it('rejects an injected value that would corrupt the log field', () => {
    expect(parseTraceId('../../evil/1;o=1')).toBeUndefined();
  });
});

describe('traceResourceName', () => {
  it('builds the resource name Cloud Logging correlates on', () => {
    expect(traceResourceName('enat-staging', TRACE_ID)).toBe(
      `projects/enat-staging/traces/${TRACE_ID}`,
    );
  });
});
