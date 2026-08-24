/**
 * Exponential backoff with jitter — the retry policy CLAUDE.md mandates for Gmail 429/5xx.
 * Pure policy: the caller injects sleep and randomness, so tests are deterministic and no
 * domain code ever touches a real timer.
 */

export interface BackoffPolicy {
  /** Total attempts, including the first one. */
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

/** Defaults sized for Gmail API quota errors: 4 tries over roughly 0–7s of sleep. */
export const DEFAULT_BACKOFF_POLICY: BackoffPolicy = {
  maxAttempts: 4,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
};

/**
 * Delay before retry number `attempt` (0-based), using "full jitter": a uniform draw from
 * [0, min(maxDelay, base·2^attempt)). Full jitter over equal-step jitter because it
 * decorrelates concurrent callers fastest — the failure mode that matters against a
 * quota-limited API.
 */
export function backoffDelayMs(
  attempt: number,
  policy: BackoffPolicy,
  random: () => number,
): number {
  const ceiling = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** attempt);
  return Math.floor(random() * ceiling);
}

/** The statuses worth retrying: rate limiting and server-side failures. A 4xx other than
 * 429 means the request itself is wrong and will be wrong again. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

export interface RetrySchedule {
  /** Injected so tests control time instead of waiting on real timers. */
  readonly sleep: (ms: number) => Promise<void>;
  /** Uniform in [0, 1). Injected so jitter is deterministic under test. */
  readonly random: () => number;
}

/**
 * Runs `operation` until it succeeds, throws a non-retryable error, or exhausts
 * `policy.maxAttempts`. The last failure is rethrown as-is so callers keep the real error,
 * not a wrapper.
 */
export async function retryWithBackoff<T>(
  operation: (attempt: number) => Promise<T>,
  isRetryable: (error: unknown) => boolean,
  policy: BackoffPolicy,
  schedule: RetrySchedule,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt + 1 >= policy.maxAttempts || !isRetryable(error)) {
        throw error;
      }
      await schedule.sleep(backoffDelayMs(attempt, policy, schedule.random));
    }
  }
}
