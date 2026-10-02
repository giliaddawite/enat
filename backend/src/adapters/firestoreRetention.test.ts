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
  it('parses a stored ISO-8601 instant', () => {
    expect(storedInstantOr('2026-08-17T06:30:00.000Z', new Date(0))).toEqual(WRITTEN_AT);
  });

  it('falls back when the stored value is not a date', () => {
    expect(storedInstantOr('not-a-date', WRITTEN_AT)).toEqual(WRITTEN_AT);
  });
});
