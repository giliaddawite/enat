export interface RateLimiter {
  /**
   * Attempts to consume one unit of `key`'s budget for the current window. Returns whether
   * the request may proceed.
   */
  tryConsume(key: string): boolean;
  /** Number of keys currently tracked, so eviction is observable without reaching inside. */
  trackedKeys(): number;
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
 * household's traffic never approaches a boundary-doubling edge case in practice.
 *
 * Known limitations, accepted for now and worth a follow-up ticket if the user base grows:
 * - State is per-process. Multiple Cloud Run instances each grant a full budget, and a
 *   cold start resets it — under-enforcement, never over-enforcement. The real fix is a
 *   shared store (e.g. Firestore counter), which costs a write per request; not worth it
 *   to protect one household's Claude budget.
 */
export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const now = options.now ?? Date.now;
  const windows = new Map<string, Window>();

  const isExpired = (window: Window, currentTime: number): boolean =>
    currentTime - window.startedAt >= options.windowMs;

  // Without this, every uid ever seen would stay in the map for the process lifetime —
  // an unbounded leak once this serves more than one household. Swept on each call rather
  // than on a timer, because a timer would keep an otherwise-idle instance from scaling
  // to zero. O(tracked keys) per request, which is O(active users) — fine at this scale.
  const evictExpired = (currentTime: number): void => {
    for (const [key, window] of windows) {
      if (isExpired(window, currentTime)) {
        windows.delete(key);
      }
    }
  };

  return {
    tryConsume(key) {
      const currentTime = now();
      evictExpired(currentTime);
      const window = windows.get(key);

      if (window === undefined) {
        windows.set(key, { startedAt: currentTime, count: 1 });
        return true;
      }

      if (window.count >= options.limit) {
        return false;
      }

      window.count += 1;
      return true;
    },
    trackedKeys() {
      return windows.size;
    },
  };
}
