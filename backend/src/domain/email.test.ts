import { describe, expect, it } from 'vitest';
import { normalizeGmailMessage, type GmailMessageMetadata } from './email.js';

const METADATA: GmailMessageMetadata = {
  id: 'msg-1',
  threadId: 'thread-1',
  headers: {
    from: 'Selam Market <news@selammarket.example>',
    subject: 'Weekly specials',
  },
  snippet: 'Fresh injera &amp; berbere &#39;on sale&#39;',
  internalDate: Date.UTC(2026, 7, 20, 9, 30, 0),
  labelIds: ['INBOX', 'CATEGORY_PROMOTIONS'],
};

describe('normalizeGmailMessage', () => {
  it('maps a metadata message onto the internal Email model', () => {
    expect(normalizeGmailMessage(METADATA)).toEqual({
      id: 'msg-1',
      threadId: 'thread-1',
      from: 'Selam Market <news@selammarket.example>',
      subject: 'Weekly specials',
      snippet: "Fresh injera & berbere 'on sale'",
      receivedAt: '2026-08-20T09:30:00.000Z',
      labels: ['INBOX', 'CATEGORY_PROMOTIONS'],
      bodyText: null,
    });
  });

  it('normalizes missing From and Subject headers to empty strings', () => {
    const email = normalizeGmailMessage({ ...METADATA, headers: {} });

    expect(email.from).toBe('');
    expect(email.subject).toBe('');
  });

  it('leaves bodyText null until a body is deliberately fetched', () => {
    expect(normalizeGmailMessage(METADATA).bodyText).toBeNull();
  });
});
