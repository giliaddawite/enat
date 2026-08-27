import { describe, expect, it } from 'vitest';
import { loadBundledVerses } from '../adapters/verseDataset.js';
import {
  computeVerseETag,
  createVerseRotation,
  FALLBACK_VERSE,
  parseVerseDataset,
  secondsUntilVerseRotation,
  servableVerses,
  VerseDatasetError,
  type Verse,
  type VerseDatasetEntry,
} from './verse.js';

function verse(overrides: Partial<Verse> = {}): Verse {
  return {
    reference: 'Psalm 23:1',
    referenceAm: 'መዝሙር 23፥1',
    textEn: 'The LORD is my shepherd; I shall not want.',
    textAm: 'እግዚአብሔር እረኛዬ ነው፤ የሚያሳጣኝም የለም።',
    ...overrides,
  };
}

function datasetEntry(overrides: Partial<VerseDatasetEntry> = {}): VerseDatasetEntry {
  return { ...verse(), verified: false, ...overrides };
}

describe('parseVerseDataset', () => {
  it('accepts a valid dataset and keeps each entry’s review flag', () => {
    const verses = parseVerseDataset({ verses: [datasetEntry({ verified: true })] });

    expect(verses).toEqual([{ ...verse(), verified: true }]);
  });

  it('rejects a dataset with no verses', () => {
    expect(() => parseVerseDataset({ verses: [] })).toThrow(VerseDatasetError);
  });

  it('rejects an entry with blank verse text', () => {
    expect(() => parseVerseDataset({ verses: [datasetEntry({ textEn: '  ' })] })).toThrow(
      VerseDatasetError,
    );
  });

  it('rejects an entry whose Amharic field carries no Ethiopic script', () => {
    expect(() =>
      parseVerseDataset({ verses: [datasetEntry({ textAm: 'The LORD is my shepherd' })] }),
    ).toThrow(VerseDatasetError);
  });

  it('rejects an entry missing the verified flag the maintainer review relies on', () => {
    const { reference, referenceAm, textEn, textAm } = verse();

    expect(() =>
      parseVerseDataset({ verses: [{ reference, referenceAm, textEn, textAm }] }),
    ).toThrow(VerseDatasetError);
  });

  it('rejects a payload that is not a dataset at all', () => {
    expect(() => parseVerseDataset('nonsense')).toThrow(VerseDatasetError);
  });
});

describe('the bundled dataset', () => {
  it('passes boundary validation, so a bad checked-in entry fails this suite before boot', () => {
    expect(loadBundledVerses().length).toBeGreaterThanOrEqual(30);
  });
});

describe('servableVerses', () => {
  const draft = datasetEntry({ reference: 'Draft 1' });
  const verified = datasetEntry({ reference: 'Verified 1', verified: true });

  it('serves only maintainer-verified entries when verification is required (production)', () => {
    const verses = servableVerses([draft, verified], { requireVerified: true });

    expect(verses.map((entry) => entry.reference)).toEqual(['Verified 1']);
  });

  it('yields no verses — the fallback-only state — when nothing is verified yet', () => {
    expect(servableVerses([draft], { requireVerified: true })).toEqual([]);
  });

  it('keeps draft entries outside production so dev and tests exercise the rotation', () => {
    expect(servableVerses([draft, verified], { requireVerified: false })).toHaveLength(2);
  });

  it('strips the review-only verified flag, which must never reach the API response', () => {
    const [entry] = servableVerses([verified], { requireVerified: true });

    expect(entry).toEqual(verse({ reference: 'Verified 1' }));
  });
});

describe('createVerseRotation', () => {
  const first = verse({ reference: 'Day 1' });
  const second = verse({ reference: 'Day 2' });
  const third = verse({ reference: 'Day 3' });
  const rotation = createVerseRotation([first, second, third]);

  it('selects the same verse for every instant of the same UTC day', () => {
    expect(rotation.verseFor(new Date('2026-08-27T00:00:00.000Z'))).toEqual(
      rotation.verseFor(new Date('2026-08-27T23:59:59.999Z')),
    );
  });

  it('advances to the next verse when the UTC day rolls over', () => {
    const beforeMidnight = rotation.verseFor(new Date('2026-08-27T23:59:59.999Z'));
    const afterMidnight = rotation.verseFor(new Date('2026-08-28T00:00:00.000Z'));

    expect(afterMidnight).not.toEqual(beforeMidnight);
  });

  it('maps January 1st to the first verse in the list', () => {
    expect(rotation.verseFor(new Date('2026-01-01T09:00:00.000Z'))).toEqual(first);
  });

  it('cycles through a list shorter than the year instead of running out', () => {
    // Day 4 of the year wraps back to the first entry of this 3-verse list.
    expect(rotation.verseFor(new Date('2026-01-04T09:00:00.000Z'))).toEqual(first);
  });

  it('serves a leap day from the rotation like any other day', () => {
    expect(() => rotation.verseFor(new Date('2028-02-29T12:00:00.000Z'))).not.toThrow();
    // Dec 31 of a leap year is day 366; a 366th request must still land in the list.
    expect(() => rotation.verseFor(new Date('2028-12-31T12:00:00.000Z'))).not.toThrow();
  });

  it('refuses an empty rotation, which could otherwise serve nothing all year', () => {
    expect(() => createVerseRotation([])).toThrow(VerseDatasetError);
  });
});

describe('secondsUntilVerseRotation', () => {
  it('counts down to the coming UTC midnight, when the rotation advances', () => {
    expect(secondsUntilVerseRotation(new Date('2026-08-27T23:00:00.000Z'))).toBe(3600);
  });

  it('grants the full day at midnight exactly', () => {
    expect(secondsUntilVerseRotation(new Date('2026-08-27T00:00:00.000Z'))).toBe(86_400);
  });

  it('never reaches zero, even in the last moment of the day', () => {
    expect(secondsUntilVerseRotation(new Date('2026-08-27T23:59:59.999Z'))).toBe(1);
  });
});

describe('FALLBACK_VERSE', () => {
  it('is bilingual, so even the degraded card is never English-only', () => {
    expect(FALLBACK_VERSE.textAm).toMatch(/[ሀ-፿]/);
    expect(FALLBACK_VERSE.referenceAm).toMatch(/[ሀ-፿]/);
    expect(FALLBACK_VERSE.textEn.length).toBeGreaterThan(0);
  });
});

describe('computeVerseETag', () => {
  it('is stable for identical content', () => {
    expect(computeVerseETag({ date: '2026-08-27', ...verse() })).toBe(
      computeVerseETag({ date: '2026-08-27', ...verse() }),
    );
  });

  it('changes when the date changes, so yesterday’s cached copy revalidates to a fresh 200', () => {
    expect(computeVerseETag({ date: '2026-08-27', ...verse() })).not.toBe(
      computeVerseETag({ date: '2026-08-28', ...verse() }),
    );
  });

  it('is quoted per RFC 9110 so it can be compared byte-for-byte with If-None-Match', () => {
    expect(computeVerseETag({ date: '2026-08-27', ...verse() })).toMatch(/^"[0-9a-f]{64}"$/);
  });
});
