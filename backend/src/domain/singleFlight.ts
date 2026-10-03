/**
 * Coalesces concurrent calls for one key into a single run (TICKET-306). While a run for
 * `key` is in flight, every further `run(key, …)` returns that run's promise instead of
 * starting another: all callers settle together, with the same result or the same
 * failure — a rejection reaches every waiter, nothing is swallowed. Once the run settles
 * the key is cleared, so the next call starts a fresh run.
 *
 * In-memory, so it only coalesces within one process. Like the rate limiter, that is
 * exactly right while the service runs one instance by design (infra/README.md).
 */
export interface SingleFlight<T> {
  run(key: string, task: () => Promise<T>): Promise<T>;
  /** Whether a run for `key` is in progress — so a caller can log that it joined one, and
   * tests can assert the entry was cleared, without reaching inside. */
  isInFlight(key: string): boolean;
}

export function createSingleFlight<T>(): SingleFlight<T> {
  const inFlight = new Map<string, Promise<T>>();

  return {
    run(key, task) {
      const existing = inFlight.get(key);
      if (existing !== undefined) {
        return existing;
      }
      // Started from a resolved promise so a task that throws synchronously still becomes a
      // rejection every waiter sees, and `finally` still clears the key.
      const pending = Promise.resolve()
        .then(task)
        .finally(() => {
          inFlight.delete(key);
        });
      inFlight.set(key, pending);
      return pending;
    },
    isInFlight(key) {
      return inFlight.has(key);
    },
  };
}
