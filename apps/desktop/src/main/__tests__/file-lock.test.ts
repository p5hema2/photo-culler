import { describe, it, expect } from 'vitest';
import { settleFileLocks, withFileLock } from '../file-lock';

/** A promise plus the handle to settle it, so tests control the interleaving. */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('withFileLock', () => {
  it('serialises operations on the same path', async () => {
    const order: string[] = [];
    const first = deferred();

    const a = withFileLock('/photos/a.jpg', async () => {
      order.push('a:start');
      await first.promise;
      order.push('a:end');
    });
    const b = withFileLock('/photos/a.jpg', async () => {
      order.push('b:start');
    });

    // b must not have begun while a is still running.
    await Promise.resolve();
    expect(order).toEqual(['a:start']);

    first.resolve();
    await Promise.all([a, b]);
    expect(order).toEqual(['a:start', 'a:end', 'b:start']);
  });

  it('lets different paths run in parallel', async () => {
    // The whole point of keying by path: the thumbnail burst reads dozens of
    // different files at once and must not be turned into a queue.
    const order: string[] = [];
    const gate = deferred();

    const a = withFileLock('/photos/a.jpg', async () => {
      order.push('a');
      await gate.promise;
    });
    const b = withFileLock('/photos/b.jpg', async () => {
      order.push('b');
    });

    await b;
    expect(order).toEqual(['a', 'b']);
    gate.resolve();
    await a;
  });

  it('runs the next operation even after the previous one threw', async () => {
    // A failed read must not wedge every later write to that file.
    const ran: string[] = [];

    const failing = withFileLock('/photos/a.jpg', async () => {
      ran.push('boom');
      throw new Error('EPERM');
    });
    await expect(failing).rejects.toThrow('EPERM');

    await withFileLock('/photos/a.jpg', async () => {
      ran.push('after');
    });

    expect(ran).toEqual(['boom', 'after']);
  });

  it('propagates the result and the error to the caller', async () => {
    await expect(withFileLock('/x.jpg', async () => 42)).resolves.toBe(42);
    await expect(
      withFileLock('/x.jpg', async () => Promise.reject(new Error('no'))),
    ).rejects.toThrow('no');
  });

  it('settleFileLocks waits for queued work', async () => {
    let done = false;
    const gate = deferred();

    const task = withFileLock('/photos/slow.jpg', async () => {
      await gate.promise;
      done = true;
    });

    const settling = settleFileLocks();
    gate.resolve();
    await settling;

    expect(done).toBe(true);
    await task;
  });

  it('settleFileLocks resolves when nothing is queued', async () => {
    await expect(settleFileLocks()).resolves.toBeUndefined();
  });
});
