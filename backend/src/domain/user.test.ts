import { describe, expect, it } from 'vitest';
import { newUserRecord } from './user.js';

describe('newUserRecord', () => {
  it('builds a new record from a Google identity using the injected clock', () => {
    const now = () => new Date('2026-08-17T12:00:00.000Z');

    expect(newUserRecord({ googleUserId: 'google-user-123', email: 'mom@example.com' }, now)).toEqual({
      uid: 'google-user-123',
      email: 'mom@example.com',
      createdAt: '2026-08-17T12:00:00.000Z',
      locale: 'am',
      refreshTokenRef: null,
    });
  });

  it('defaults new users to the Amharic locale', () => {
    const record = newUserRecord(
      { googleUserId: 'google-user-456', email: 'someone@example.com' },
      () => new Date(),
    );

    expect(record.locale).toBe('am');
  });

  it('has no refresh token reference until Gmail consent is completed', () => {
    const record = newUserRecord(
      { googleUserId: 'google-user-456', email: 'someone@example.com' },
      () => new Date(),
    );

    expect(record.refreshTokenRef).toBeNull();
  });
});
