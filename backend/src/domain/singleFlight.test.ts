import { describe, expect, it, vi } from 'vitest';
import {
  createSingleFlight,
  DEFAULT_SINGLE_FLIGHT_TIMEOUT_MS,
  SingleFlightTimeoutError,
} from './singleFlight.js';

/** A task whose completion the test controls, so two calls are provably concurrent. */
function gatedTask<T>(result: T) {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const task = vi.fn(async () => {
    await gate;
    return result;
  });
  return { task, release: () => release() };
}

/** Injected timers: the test fires a deadline by hand instead of waiting on a real clock. */
function fakeTimers() {
  const armed = new Map<number, { callback: () => void; ms: number }>();
  let nextHandle = 1;
  return {
    setTimer: vi.fn((callback: () => void, ms: number): unknown => {
      const handle = nextHandle;
      nextHandle += 1;
      armed.set(handle, { callback, ms });
      return handle;
    }),
    clearTimer: vi.fn((handle: unknown) => {
      armed.delete(handle as number);
    }),
    /** Fires every armed timer, the way the clock would once they all elapsed. */
    elapse() {
      for (const [handle, { callback }] of [...armed]) {
        armed.delete(handle);
        callback();
      }
    },
    armedCount: () => armed.size,
    armedDelays: () => [...armed.values()].map((entry) => entry.ms),
  };
}

describe('createSingleFlight', () => {
  it('runs the task once for two concurrent calls on one key and gives both callers its result', async () => {
    const flight = createSingleFlight<string>(fakeTimers());
    const { task, release } = gatedTask('digest');

    const first = flight.run('mom', task);
    const second = flight.run('mom', task);
    release();

    await expect(Promise.all([first, second])).resolves.toEqual(['digest', 'digest']);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('runs different keys independently', async () => {
    const flight = createSingleFlight<string>(fakeTimers());
    const mom = gatedTask('mom-digest');
    const other = gatedTask('other-digest');

    const first = flight.run('mom', mom.task);
    const second = flight.run('other', other.task);
    mom.release();
    other.release();

    await expect(Promise.all([first, second])).resolves.toEqual(['mom-digest', 'other-digest']);
    expect(mom.task).toHaveBeenCalledTimes(1);
    expect(other.task).toHaveBeenCalledTimes(1);
  });

  it('propagates the failure of the shared run to every waiter', async () => {
    const flight = createSingleFlight<string>(fakeTimers());
    const failure = new Error('claude api on fire');
    const task = () => Promise.reject(failure);

    const first = flight.run('mom', task);
    const second = flight.run('mom', task);

    await expect(first).rejects.toBe(failure);
    await expect(second).rejects.toBe(failure);
  });

  it('clears the key after a failure so the next call runs the task again', async () => {
    const flight = createSingleFlight<string>(fakeTimers());
    const task = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce('digest');

    await expect(flight.run('mom', task)).rejects.toThrow('transient');

    expect(flight.isInFlight('mom')).toBe(false);
    await expect(flight.run('mom', task)).resolves.toBe('digest');
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('clears the key after success so a later call is a fresh run, not a cached result', async () => {
    const flight = createSingleFlight<string>(fakeTimers());
    const task = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce('morning')
      .mockResolvedValueOnce('evening');

    await expect(flight.run('mom', task)).resolves.toBe('morning');

    expect(flight.isInFlight('mom')).toBe(false);
    await expect(flight.run('mom', task)).resolves.toBe('evening');
  });

  it('reports a key as in flight only while its run is pending', async () => {
    const flight = createSingleFlight<string>(fakeTimers());
    const { task, release } = gatedTask('digest');

    const pending = flight.run('mom', task);
    expect(flight.isInFlight('mom')).toBe(true);

    release();
    await pending;
    expect(flight.isInFlight('mom')).toBe(false);
  });

  it('turns a task that throws synchronously into a rejection and still clears the key', async () => {
    const flight = createSingleFlight<string>(fakeTimers());
    const task = () => {
      throw new Error('sync failure');
    };

    await expect(flight.run('mom', task)).rejects.toThrow('sync failure');
    expect(flight.isInFlight('mom')).toBe(false);
  });

  describe('the deadline', () => {
    it('releases every waiter of a never-settling run with a typed timeout error and clears the key', async () => {
      const timers = fakeTimers();
      const flight = createSingleFlight<string>({ ...timers, timeoutMs: 50_000 });
      const neverSettles = () => new Promise<string>(() => undefined);

      const first = flight.run('mom', neverSettles);
      const second = flight.run('mom', neverSettles);
      timers.elapse();

      const error = await first.catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(SingleFlightTimeoutError);
      expect(error).toMatchObject({ key: 'mom', timeoutMs: 50_000 });
      await expect(second).rejects.toBe(error);
      expect(flight.isInFlight('mom')).toBe(false);
    });

    it('lets the next call start a fresh run after a timeout instead of joining the stuck one', async () => {
      const timers = fakeTimers();
      const flight = createSingleFlight<string>({ ...timers, timeoutMs: 50_000 });
      const task = vi
        .fn<() => Promise<string>>()
        .mockImplementationOnce(() => new Promise<string>(() => undefined))
        .mockResolvedValueOnce('fresh digest');

      const stuck = flight.run('mom', task);
      timers.elapse();
      await expect(stuck).rejects.toBeInstanceOf(SingleFlightTimeoutError);

      await expect(flight.run('mom', task)).resolves.toBe('fresh digest');
      expect(task).toHaveBeenCalledTimes(2);
    });

    it('arms one timer for the configured deadline and cancels it when the run settles first', async () => {
      const timers = fakeTimers();
      const flight = createSingleFlight<string>({ ...timers, timeoutMs: 50_000 });
      const { task, release } = gatedTask('digest');

      const pending = flight.run('mom', task);
      expect(timers.armedDelays()).toEqual([50_000]);

      release();
      await pending;
      expect(timers.clearTimer).toHaveBeenCalledWith(timers.setTimer.mock.results[0]?.value);
      expect(timers.armedCount()).toBe(0);
    });

    it('cancels the timer when the run fails before the deadline too', async () => {
      const timers = fakeTimers();
      const flight = createSingleFlight<string>(timers);

      await expect(flight.run('mom', () => Promise.reject(new Error('boom')))).rejects.toThrow(
        'boom',
      );

      expect(timers.armedCount()).toBe(0);
    });

    it('defaults the deadline to a value under the Cloud Run request timeout', () => {
      const timers = fakeTimers();
      const flight = createSingleFlight<string>(timers);

      void flight.run('mom', () => new Promise<string>(() => undefined));

      expect(DEFAULT_SINGLE_FLIGHT_TIMEOUT_MS).toBeLessThan(60_000);
      expect(timers.armedDelays()).toEqual([DEFAULT_SINGLE_FLIGHT_TIMEOUT_MS]);
    });
  });
});
