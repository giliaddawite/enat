import { describe, expect, it, vi } from 'vitest';
import { createSingleFlight } from './singleFlight.js';

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

describe('createSingleFlight', () => {
  it('runs the task once for two concurrent calls on one key and gives both callers its result', async () => {
    const flight = createSingleFlight<string>();
    const { task, release } = gatedTask('digest');

    const first = flight.run('mom', task);
    const second = flight.run('mom', task);
    release();

    await expect(Promise.all([first, second])).resolves.toEqual(['digest', 'digest']);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('runs different keys independently', async () => {
    const flight = createSingleFlight<string>();
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
    const flight = createSingleFlight<string>();
    const failure = new Error('claude api on fire');
    const task = () => Promise.reject(failure);

    const first = flight.run('mom', task);
    const second = flight.run('mom', task);

    await expect(first).rejects.toBe(failure);
    await expect(second).rejects.toBe(failure);
  });

  it('clears the key after a failure so the next call runs the task again', async () => {
    const flight = createSingleFlight<string>();
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
    const flight = createSingleFlight<string>();
    const task = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce('morning')
      .mockResolvedValueOnce('evening');

    await expect(flight.run('mom', task)).resolves.toBe('morning');

    expect(flight.isInFlight('mom')).toBe(false);
    await expect(flight.run('mom', task)).resolves.toBe('evening');
  });

  it('reports a key as in flight only while its run is pending', async () => {
    const flight = createSingleFlight<string>();
    const { task, release } = gatedTask('digest');

    const pending = flight.run('mom', task);
    expect(flight.isInFlight('mom')).toBe(true);

    release();
    await pending;
    expect(flight.isInFlight('mom')).toBe(false);
  });

  it('turns a task that throws synchronously into a rejection and still clears the key', async () => {
    const flight = createSingleFlight<string>();
    const task = () => {
      throw new Error('sync failure');
    };

    await expect(flight.run('mom', task)).rejects.toThrow('sync failure');
    expect(flight.isInFlight('mom')).toBe(false);
  });
});
