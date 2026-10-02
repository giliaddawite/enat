import { Timestamp } from '@google-cloud/firestore';
import { describe, expect, it } from 'vitest';
import { retentionExpireAt, storedInstantOr } from './firestoreRetention.js';

const WRITTEN_AT = new Date('2026-08-17T06:30:00.000Z');

describe('retentionExpireAt', () => {
  it('adds whole days to the write instant as a Firestore Timestamp', () => {
    expect(retentionExpireAt(WRITTEN_AT, 30)).toEqual(
      Timestamp.fromDate(new Date('2026-09-16T06:30:00.000Z')),
    );
  });
});

describe('storedInstantOr', () => {
  it('parses a stored ISO-8601 instant that lies in the past', () => {
    const later = new Date('2026-09-01T00:00:00.000Z');

    expect(storedInstantOr('2026-08-17T06:30:00.000Z', later)).toEqual(WRITTEN_AT);
  });

  it('falls back when the stored value is not a date', () => {
    expect(storedInstantOr('not-a-date', WRITTEN_AT)).toEqual(WRITTEN_AT);
  });

  it('clamps a stored instant in the future to now, so it cannot buy endless retention', () => {
    expect(storedInstantOr('2031-01-01T00:00:00.000Z', WRITTEN_AT)).toEqual(WRITTEN_AT);
    expect(storedInstantOr('+275760-09-13T00:00:00.000Z', WRITTEN_AT)).toEqual(WRITTEN_AT);
  });
});
