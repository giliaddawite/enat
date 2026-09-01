import { describe, expect, it } from 'vitest';
import type { Email } from './email.js';
import {
  assembleDigest,
  computeDigestETag,
  findLatestDigest,
  needsPersist,
  toDateKey,
  type Digest,
} from './digest.js';
import type { EmailSummary } from './summary.js';

function email(overrides: Partial<Email> & { id: string }): Email {
  return {
    threadId: `thread-${overrides.id}`,
    from: 'someone@example.com',
    subject: 'Subject',
    snippet: '',
    receivedAt: '2026-08-17T09:00:00.000Z',
    labels: [],
    bodyText: null,
    ...overrides,
  };
}

function summary(overrides: Partial<EmailSummary> & { messageId: string }): EmailSummary {
  return {
    category: 'important',
    summary: 'Amharic summary',
    urgent: false,
    source: 'llm',
    promptVersion: 'digest-v1',
    ...overrides,
  };
}

describe('toDateKey', () => {
  it('formats the UTC calendar date', () => {
    expect(toDateKey(new Date('2026-08-17T23:59:59.000Z'))).toBe('2026-08-17');
    expect(toDateKey(new Date('2026-08-17T00:00:00.000Z'))).toBe('2026-08-17');
  });
});

describe('findLatestDigest', () => {
  const NOON_UTC = new Date('2026-08-17T12:00:00.000Z');

  function digestFor(date: string): Digest {
    return {
      date,
      userId: 'uid-1',
      sections: [],
      generatedAt: `${date}T06:30:00.000Z`,
      emailCount: 0,
    };
  }

  function storeWith(...dates: string[]) {
    const requested: string[] = [];
    const getByDate = (date: string): Promise<Digest | null> => {
      requested.push(date);
      return Promise.resolve(dates.includes(date) ? digestFor(date) : null);
    };
    return { getByDate, requested };
  }

  it("returns today's digest with a single read when it exists", async () => {
    const { getByDate, requested } = storeWith('2026-08-17', '2026-08-16');

    const digest = await findLatestDigest(getByDate, NOON_UTC);

    expect(digest?.date).toBe('2026-08-17');
    expect(requested).toEqual(['2026-08-17']);
  });

  it("falls back to yesterday's digest in two reads when today's is absent", async () => {
    const { getByDate, requested } = storeWith('2026-08-16');

    const digest = await findLatestDigest(getByDate, NOON_UTC);

    expect(digest?.date).toBe('2026-08-16');
    expect(requested).toEqual(['2026-08-17', '2026-08-16']);
  });

  it('returns the newest digest within the lookback window', async () => {
    const { getByDate } = storeWith('2026-08-12', '2026-08-14');

    const digest = await findLatestDigest(getByDate, NOON_UTC);

    expect(digest?.date).toBe('2026-08-14');
  });

  it('returns null after exactly seven daily reads when no digest exists', async () => {
    const { getByDate, requested } = storeWith();

    const digest = await findLatestDigest(getByDate, NOON_UTC);

    expect(digest).toBeNull();
    expect(requested).toEqual([
      '2026-08-17',
      '2026-08-16',
      '2026-08-15',
      '2026-08-14',
      '2026-08-13',
      '2026-08-12',
      '2026-08-11',
    ]);
  });

  it('treats a digest older than the lookback window as absent', async () => {
    const { getByDate } = storeWith('2026-08-10');

    const digest = await findLatestDigest(getByDate, NOON_UTC);

    expect(digest).toBeNull();
  });

  it('walks UTC calendar days across a month boundary', async () => {
    const { getByDate } = storeWith('2026-07-31');

    const digest = await findLatestDigest(getByDate, new Date('2026-08-01T02:00:00.000Z'));

    expect(digest?.date).toBe('2026-07-31');
  });
});

describe('assembleDigest', () => {
  it('groups emails into sections ordered important, bills, family, promotions', () => {
    const emails = [
      email({ id: 'promo', from: 'ads@shop.com' }),
      email({ id: 'bill', from: 'billing@bank.com' }),
      email({ id: 'imp', from: 'church@example.org' }),
      email({ id: 'fam', from: 'sister@gmail.com' }),
    ];
    const summaries = [
      summary({ messageId: 'promo', category: 'promotions_other' }),
      summary({ messageId: 'bill', category: 'bills_accounts' }),
      summary({ messageId: 'imp', category: 'important' }),
      summary({ messageId: 'fam', category: 'family_personal' }),
    ];

    const digest = assembleDigest({
      userId: 'uid-1',
      date: '2026-08-17',
      emails,
      summaries,
      generatedAt: '2026-08-17T10:00:00.000Z',
    });

    expect(digest.sections.map((section) => section.category)).toEqual([
      'important',
      'bills_accounts',
      'family_personal',
      'promotions_other',
    ]);
    expect(digest.emailCount).toBe(4);
  });

  it('omits categories with no mail', () => {
    const emails = [email({ id: 'a' })];
    const summaries = [summary({ messageId: 'a', category: 'important' })];

    const digest = assembleDigest({
      userId: 'uid-1',
      date: '2026-08-17',
      emails,
      summaries,
      generatedAt: '2026-08-17T10:00:00.000Z',
    });

    expect(digest.sections).toHaveLength(1);
    expect(digest.sections[0]?.category).toBe('important');
  });

  it('keeps input order within a section', () => {
    const emails = [
      email({ id: 'newer', receivedAt: '2026-08-17T09:00:00.000Z' }),
      email({ id: 'older', receivedAt: '2026-08-16T09:00:00.000Z' }),
    ];
    const summaries = [
      summary({ messageId: 'newer', category: 'important' }),
      summary({ messageId: 'older', category: 'important' }),
    ];

    const digest = assembleDigest({
      userId: 'uid-1',
      date: '2026-08-17',
      emails,
      summaries,
      generatedAt: '2026-08-17T10:00:00.000Z',
    });

    expect(digest.sections[0]?.items.map((item) => item.messageId)).toEqual(['newer', 'older']);
  });

  it('carries sender, subject, summary, urgency and receivedAt onto the item', () => {
    const emails = [
      email({
        id: 'a',
        from: 'billing@bank.com',
        subject: 'Your statement',
        receivedAt: '2026-08-17T09:00:00.000Z',
      }),
    ];
    const summaries = [
      summary({
        messageId: 'a',
        category: 'bills_accounts',
        summary: 'ክፍያ ደርሷል',
        urgent: true,
      }),
    ];

    const digest = assembleDigest({
      userId: 'uid-1',
      date: '2026-08-17',
      emails,
      summaries,
      generatedAt: '2026-08-17T10:00:00.000Z',
    });

    expect(digest.sections[0]?.items[0]).toEqual({
      messageId: 'a',
      from: 'billing@bank.com',
      subject: 'Your statement',
      summary: 'ክፍያ ደርሷል',
      urgent: true,
      receivedAt: '2026-08-17T09:00:00.000Z',
    });
  });

  it('drops a summary whose messageId has no matching email rather than guessing', () => {
    const digest = assembleDigest({
      userId: 'uid-1',
      date: '2026-08-17',
      emails: [],
      summaries: [summary({ messageId: 'ghost', category: 'important' })],
      generatedAt: '2026-08-17T10:00:00.000Z',
    });

    expect(digest.sections).toEqual([]);
    expect(digest.emailCount).toBe(0);
  });

  it('produces an empty digest for an empty inbox', () => {
    const digest = assembleDigest({
      userId: 'uid-1',
      date: '2026-08-17',
      emails: [],
      summaries: [],
      generatedAt: '2026-08-17T10:00:00.000Z',
    });

    expect(digest).toEqual<Digest>({
      date: '2026-08-17',
      userId: 'uid-1',
      sections: [],
      generatedAt: '2026-08-17T10:00:00.000Z',
      emailCount: 0,
    });
  });
});

describe('computeDigestETag', () => {
  const base: Digest = {
    date: '2026-08-17',
    userId: 'uid-1',
    sections: [
      {
        category: 'important',
        items: [
          {
            messageId: 'a',
            from: 'x@example.com',
            subject: 'S',
            summary: 'text',
            urgent: false,
            receivedAt: '2026-08-17T09:00:00.000Z',
          },
        ],
      },
    ],
    generatedAt: '2026-08-17T10:00:00.000Z',
    emailCount: 1,
  };

  it('is a quoted string, per RFC 9110', () => {
    expect(computeDigestETag(base)).toMatch(/^".+"$/);
  });

  it('is stable for identical content generated at different times', () => {
    const rerun: Digest = { ...base, generatedAt: '2026-08-18T06:30:00.000Z' };

    expect(computeDigestETag(rerun)).toBe(computeDigestETag(base));
  });

  it('changes when the content changes', () => {
    const changed: Digest = { ...base, emailCount: 2 };

    expect(computeDigestETag(changed)).not.toBe(computeDigestETag(base));
  });
});

describe('needsPersist', () => {
  const fresh: Digest = {
    date: '2026-08-17',
    userId: 'uid-1',
    sections: [],
    generatedAt: '2026-08-17T10:00:00.000Z',
    emailCount: 0,
  };

  it('is true when nothing exists yet', () => {
    expect(needsPersist(null, fresh)).toBe(true);
  });

  it('is false when the existing document has identical content', () => {
    const existing: Digest = { ...fresh, generatedAt: '2026-08-17T06:30:00.000Z' };

    expect(needsPersist(existing, fresh)).toBe(false);
  });

  it('is true when the content differs, even with the same generatedAt', () => {
    const existing: Digest = { ...fresh, emailCount: 5 };

    expect(needsPersist(existing, fresh)).toBe(true);
  });
});
