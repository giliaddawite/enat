import { describe, expect, it } from 'vitest';
import {
  backoffDelayMs,
  isRetryableStatus,
  retryWithBackoff,
  type BackoffPolicy,
} from './backoff.js';

const POLICY: BackoffPolicy = { maxAttempts: 4, baseDelayMs: 100, maxDelayMs: 400 };

describe('backoffDelayMs', () => {
  it('doubles the jitter ceiling per attempt up to the cap', () => {
    const atCeiling = () => 0.999999;

    expect(backoffDelayMs(0, POLICY, atCeiling)).toBe(99);
    expect(backoffDelayMs(1, POLICY, atCeiling)).toBe(199);
    expect(backoffDelayMs(2, POLICY, atCeiling)).toBe(399);
    // Capped: 100 * 2^3 = 800 would exceed maxDelayMs.
    expect(backoffDelayMs(3, POLICY, atCeiling)).toBe(399);
  });

  it('applies full jitter — the delay is a uniform draw below the ceiling', () => {
    expect(backoffDelayMs(1, POLICY, () => 0.5)).toBe(100);
    expect(backoffDelayMs(1, POLICY, () => 0)).toBe(0);
  });
});

describe('isRetryableStatus', () => {
  it('retries 429 and every 5xx', () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
  });

  it('does not retry other 4xx or success statuses', () => {
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
    expect(isRetryableStatus(200)).toBe(false);
  });
});

describe('retryWithBackoff', () => {
  const recordingSchedule = () => {
    const sleeps: number[] = [];
    return {
      sleeps,
      schedule: {
        sleep: (ms: number) => {
          sleeps.push(ms);
          return Promise.resolve();
        },
        random: () => 0.5,
      },
    };
  };

  it('returns the first successful result without sleeping', async () => {
    const { sleeps, schedule } = recordingSchedule();

    const result = await retryWithBackoff(() => Promise.resolve('ok'), () => true, POLICY, schedule);

    expect(result).toBe('ok');
    expect(sleeps).toEqual([]);
  });

  it('retries a retryable failure with exponentially growing jittered sleeps', async () => {
    const { sleeps, schedule } = recordingSchedule();
    let attempts = 0;

    const result = await retryWithBackoff(
      () => {
        attempts += 1;
        return attempts < 3 ? Promise.reject(new Error('flaky')) : Promise.resolve('ok');
      },
      () => true,
      POLICY,
      schedule,
    );

    expect(result).toBe('ok');
    // random=0.5 over ceilings 100 then 200.
    expect(sleeps).toEqual([50, 100]);
  });

  it('rethrows immediately on a non-retryable error', async () => {
    const { sleeps, schedule } = recordingSchedule();
    let attempts = 0;

    await expect(
      retryWithBackoff(
        () => {
          attempts += 1;
          return Promise.reject(new Error('bad request'));
        },
        () => false,
        POLICY,
        schedule,
      ),
    ).rejects.toThrow('bad request');

    expect(attempts).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it('rethrows the last error once attempts are exhausted', async () => {
    const { sleeps, schedule } = recordingSchedule();
    let attempts = 0;

    await expect(
      retryWithBackoff(
        () => {
          attempts += 1;
          return Promise.reject(new Error(`failure ${attempts}`));
        },
        () => true,
        POLICY,
        schedule,
      ),
    ).rejects.toThrow('failure 4');

    expect(attempts).toBe(POLICY.maxAttempts);
    expect(sleeps).toHaveLength(POLICY.maxAttempts - 1);
  });
});
