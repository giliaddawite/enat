/**
 * Coalesces concurrent calls for one key into a single run (TICKET-306). While a run for
 * `key` is in flight, every further `run(key, …)` returns that run's promise instead of
 * starting another: all callers settle together, with the same result or the same
 * failure — a rejection reaches every waiter, nothing is swallowed. Once the run settles
 * the key is cleared, so the next call starts a fresh run.
 *
 * Every entry has a deadline. A run that never settles — a stalled upstream fetch with no
 * timeout of its own — would otherwise hold the key forever: after the first caller's
 * request timed out, every later caller for that key would join the stuck promise and time
 * out too. At the deadline the waiters are rejected with `SingleFlightTimeoutError` and
 * the key is cleared, so the next caller starts a fresh run; the stuck task itself keeps
 * running (nothing here can cancel it) but nobody new joins it.
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

export interface SingleFlightOptions {
  /** How long a run may stay joinable before its waiters are released. Defaults to
   * `DEFAULT_SINGLE_FLIGHT_TIMEOUT_MS`, chosen to sit under Cloud Run's request timeout. */
  readonly timeoutMs?: number;
  /** Timer injection, so tests drive the deadline instead of waiting on a real clock. The
   * handle type is opaque on purpose: real timers return a `Timeout`, fakes return anything. */
  readonly setTimer?: (callback: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

/** Below Cloud Run's `timeoutSeconds: 60` (infra/cloudrun/service.staging.yaml), so waiters
 * are released by this deadline rather than by the platform cutting the request. */
export const DEFAULT_SINGLE_FLIGHT_TIMEOUT_MS = 50_000;

/** The shared run outlived its deadline. Carries no content: the key is an opaque uid. */
export class SingleFlightTimeoutError extends Error {
  readonly key: string;
  readonly timeoutMs: number;

  constructor(key: string, timeoutMs: number) {
    super(`single-flight run did not settle within ${timeoutMs}ms`);
    this.name = 'SingleFlightTimeoutError';
    this.key = key;
    this.timeoutMs = timeoutMs;
  }
}

export function createSingleFlight<T>(options: SingleFlightOptions = {}): SingleFlight<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_SINGLE_FLIGHT_TIMEOUT_MS;
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer =
    options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const inFlight = new Map<string, Promise<T>>();

  return {
    run(key, task) {
      const existing = inFlight.get(key);
      if (existing !== undefined) {
        return existing;
      }
      let timer: unknown;
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimer(() => reject(new SingleFlightTimeoutError(key, timeoutMs)), timeoutMs);
      });
      // The task is started from a resolved promise so a synchronous throw still becomes a
      // rejection every waiter sees. `finally` clears both the key and the timer, whichever
      // side of the race settled first.
      const pending = Promise.race([Promise.resolve().then(task), deadline]).finally(() => {
        clearTimer(timer);
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
