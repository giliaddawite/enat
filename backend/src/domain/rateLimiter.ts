export interface RateLimiter {
  /**
   * Attempts to consume one unit of `key`'s budget for the current window. Returns whether
   * the request may proceed.
   */
  tryConsume(key: string): boolean;
}

export interface RateLimiterOptions {
  /** Requests allowed per key per window. */
  readonly limit: number;
  readonly windowMs: number;
  /** Injected so tests control the passage of time instead of racing a real clock. */
  readonly now?: () => number;
}

interface Window {
  readonly startedAt: number;
  count: number;
}

/**
 * A fixed-window limiter, keyed per caller (per-user id once mounted behind auth). Simpler
 * than a sliding window or token bucket, and sufficient at Enat's current scale — a single
 * household's traffic never approaches a boundary-doubling edge case in practice. Revisit
 * if this backend grows to serve many concurrent users protecting a shared LLM budget.
 */
export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const now = options.now ?? Date.now;
  const windows = new Map<string, Window>();

  return {
    tryConsume(key) {
      const currentTime = now();
      const window = windows.get(key);

      if (window === undefined || currentTime - window.startedAt >= options.windowMs) {
        windows.set(key, { startedAt: currentTime, count: 1 });
        return true;
      }

      if (window.count >= options.limit) {
        return false;
      }

      window.count += 1;
      return true;
    },
  };
}
