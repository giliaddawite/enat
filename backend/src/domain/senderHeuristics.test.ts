import { describe, expect, it } from 'vitest';
import type { Email } from './email.js';
import { categorizeByHeuristics, senderAddress } from './senderHeuristics.js';

function emailFrom(from: string, labels: readonly string[] = ['INBOX']): Email {
  return {
    id: 'msg-1',
    threadId: 'thread-1',
    from,
    subject: 'subject',
    snippet: 'snippet',
    receivedAt: '2026-08-20T12:00:00.000Z',
    labels,
    bodyText: null,
  };
}

describe('senderAddress', () => {
  it('extracts the address from a display-name header', () => {
    expect(senderAddress('Chase <no.reply@alerts.chase.com>')).toBe('no.reply@alerts.chase.com');
  });

  it('accepts a bare address', () => {
    expect(senderAddress('mom@gmail.com')).toBe('mom@gmail.com');
  });

  it('lowercases the address', () => {
    expect(senderAddress('Aunt Selam <Selam@Yahoo.com>')).toBe('selam@yahoo.com');
  });

  it('returns empty for a header with no address', () => {
    expect(senderAddress('undisclosed recipients')).toBe('');
  });
});

describe('categorizeByHeuristics', () => {
  it('buckets a bank sender under bills, including subdomains', () => {
    const email = emailFrom('Chase <no.reply@alerts.chase.com>');
    expect(categorizeByHeuristics(email)).toBe('bills_accounts');
  });

  it('does not treat a lookalike domain suffix as a bills domain', () => {
    const email = emailFrom('promo@notchase.com');
    expect(categorizeByHeuristics(email)).toBe('important');
  });

  it('buckets billing machinery localparts under bills regardless of domain', () => {
    const email = emailFrom('billing@some-clinic.example');
    expect(categorizeByHeuristics(email)).toBe('bills_accounts');
  });

  it('buckets government senders under important', () => {
    const email = emailFrom('Social Security <no-reply@ssa.gov>');
    // ssa.gov is also on the bills list; either way it must not land in promotions.
    expect(['important', 'bills_accounts']).toContain(categorizeByHeuristics(email));
    expect(categorizeByHeuristics(emailFrom('alerts@dmv.ny.gov'))).toBe('important');
  });

  it('buckets Gmail promotional tabs under promotions', () => {
    const email = emailFrom('Deals <deals@shop.example>', ['INBOX', 'CATEGORY_PROMOTIONS']);
    expect(categorizeByHeuristics(email)).toBe('promotions_other');
  });

  it('keeps a bank alert filed under Updates in bills, not promotions', () => {
    const email = emailFrom('alerts@chase.com', ['INBOX', 'CATEGORY_UPDATES']);
    expect(categorizeByHeuristics(email)).toBe('bills_accounts');
  });

  it('buckets other Updates mail under promotions', () => {
    const email = emailFrom('tracking@shipping.example', ['INBOX', 'CATEGORY_UPDATES']);
    expect(categorizeByHeuristics(email)).toBe('promotions_other');
  });

  it('buckets freemail senders under family and personal', () => {
    expect(categorizeByHeuristics(emailFrom('Selam <selam@yahoo.com>'))).toBe('family_personal');
  });

  it('defaults an unknown organizational sender to important', () => {
    expect(categorizeByHeuristics(emailFrom('office@stmarychurch.example'))).toBe('important');
  });

  it('defaults an unparseable From header to important', () => {
    expect(categorizeByHeuristics(emailFrom(''))).toBe('important');
  });
});
