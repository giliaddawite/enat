import { describe, expect, it } from 'vitest';
import { createRateLimiter } from './rateLimiter.js';

describe('createRateLimiter', () => {
  it('allows requests up to the limit within a window', () => {
    const now = 0;
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000, now: () => now });

    expect(limiter.tryConsume('mom')).toBe(true);
    expect(limiter.tryConsume('mom')).toBe(true);
    expect(limiter.tryConsume('mom')).toBe(true);
  });

  it('rejects a request once the limit is exhausted', () => {
    const now = 0;
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000, now: () => now });

    expect(limiter.tryConsume('mom')).toBe(true);
    expect(limiter.tryConsume('mom')).toBe(true);
    expect(limiter.tryConsume('mom')).toBe(false);
  });

  it('resets the budget once the window elapses', () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => now });

    expect(limiter.tryConsume('mom')).toBe(true);
    expect(limiter.tryConsume('mom')).toBe(false);

    now = 60_000;
    expect(limiter.tryConsume('mom')).toBe(true);
  });

  it('tracks separate budgets per key', () => {
    const now = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => now });

    expect(limiter.tryConsume('mom')).toBe(true);
    expect(limiter.tryConsume('mom')).toBe(false);
    expect(limiter.tryConsume('someone-else')).toBe(true);
  });

  it('defaults to the real clock when none is injected', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });

    expect(limiter.tryConsume('mom')).toBe(true);
  });
});
