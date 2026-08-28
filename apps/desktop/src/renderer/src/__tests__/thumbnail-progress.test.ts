import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useThumbnailWorker } from '../hooks/useThumbnailWorker';

/**
 * The thumbnail counter is only honest if it counts the right events. Three
 * rules hold it up, and each is easy to break by accident:
 *
 *  - a cache HIT must not count, because the readout starts from the on-disk
 *    count and a hit is already inside it;
 *  - a MISS must count, once;
 *  - a regenerated thumbnail (a rotation invalidates one) must not count twice.
 */

class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  simulateMessage(data: unknown): void {
    this.onmessage?.(new MessageEvent('message', { data }));
  }
}

const mockWorkers: MockWorker[] = [];
const mockArrayBuffer = new ArrayBuffer(16);

Object.defineProperty(globalThis.navigator, 'hardwareConcurrency', {
  value: 4,
  configurable: true,
});

/** Wait until at least one worker has been handed a job. */
async function untilDispatched(): Promise<MockWorker> {
  for (let i = 0; i < 50; i++) {
    const worker = mockWorkers.find((w) => w.postMessage.mock.calls.length > 0);
    if (worker) return worker;
    await act(async () => {
      await Promise.resolve();
    });
  }
  throw new Error('no worker was given a job');
}

beforeEach(() => {
  mockWorkers.length = 0;

  vi.stubGlobal(
    'Worker',
    class extends MockWorker {
      constructor() {
        super();
        mockWorkers.push(this);
      }
    },
  );
  vi.stubGlobal('createImageBitmap', async () => ({ close: vi.fn() }) as unknown as ImageBitmap);

  Object.assign(window, {
    api: {
      readFile: vi.fn().mockResolvedValue(mockArrayBuffer),
      loadThumbCache: vi.fn().mockResolvedValue(null),
      saveThumbCache: vi.fn().mockResolvedValue(undefined),
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('onThumbnailGenerated', () => {
  it('reports a generated thumbnail once', async () => {
    const generated: string[] = [];
    const { result } = renderHook(() =>
      useThumbnailWorker({ onThumbnailGenerated: (p) => generated.push(p) }),
    );

    act(() => {
      result.current.requestThumbnail('/photos/a.jpg', 'unused', 512);
    });
    const worker = await untilDispatched();

    act(() => {
      worker.simulateMessage({
        id: '/photos/a.jpg',
        bitmap: { close: vi.fn() } as unknown as ImageBitmap,
        thumbBuffer: new ArrayBuffer(8),
      });
    });

    expect(generated).toEqual(['/photos/a.jpg']);
  });

  it('does NOT report a cache hit', async () => {
    // The on-disk count already includes it. Counting hits as well is how the
    // readout would sail past its own total on a folder that is already done.
    (window.api.loadThumbCache as ReturnType<typeof vi.fn>).mockResolvedValue(new ArrayBuffer(8));
    const generated: string[] = [];

    const { result } = renderHook(() =>
      useThumbnailWorker({ onThumbnailGenerated: (p) => generated.push(p) }),
    );

    act(() => {
      result.current.requestThumbnail('/photos/hit.jpg', 'unused', 512);
    });
    for (let i = 0; i < 20; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }

    expect(generated).toEqual([]);
    expect(window.api.readFile).not.toHaveBeenCalled();
  });

  it('does not report an error response', async () => {
    const generated: string[] = [];
    const { result } = renderHook(() =>
      useThumbnailWorker({ onThumbnailGenerated: (p) => generated.push(p) }),
    );

    act(() => {
      result.current.requestThumbnail('/photos/bad.jpg', 'unused', 512);
    });
    const worker = await untilDispatched();

    act(() => {
      worker.simulateMessage({ id: '/photos/bad.jpg', error: true });
    });

    expect(generated).toEqual([]);
  });

  it('survives a caller that passes no callback', async () => {
    const { result } = renderHook(() => useThumbnailWorker());

    act(() => {
      result.current.requestThumbnail('/photos/a.jpg', 'unused', 512);
    });
    const worker = await untilDispatched();

    expect(() => {
      act(() => {
        worker.simulateMessage({
          id: '/photos/a.jpg',
          bitmap: { close: vi.fn() } as unknown as ImageBitmap,
          thumbBuffer: new ArrayBuffer(8),
        });
      });
    }).not.toThrow();
  });
});

describe('sweepAll', () => {
  it('never takes a worker while a visible cell is waiting', async () => {
    const { result } = renderHook(() => useThumbnailWorker());

    // Fill every worker with foreground work, then queue more foreground work
    // than there are workers, so the queue is non-empty when the sweep starts.
    act(() => {
      for (let i = 0; i < 8; i++) {
        result.current.requestThumbnail(`/photos/fg-${i}.jpg`, 'unused', 512);
      }
    });
    await untilDispatched();

    act(() => {
      result.current.sweepAll(['/photos/sweep-a.jpg', '/photos/sweep-b.jpg'], 512);
    });
    for (let i = 0; i < 20; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }

    // Every job handed out so far must be a foreground one.
    const dispatched = mockWorkers.flatMap((w) =>
      w.postMessage.mock.calls.map((c) => (c[0] as { id: string }).id),
    );
    expect(dispatched.every((id) => id.includes('fg-'))).toBe(true);
  });

  it('generates a swept thumbnail without caching its bitmap', async () => {
    // The file on disk is the point; caching the bitmap would let work nobody
    // looked at evict thumbnails that are on screen.
    const generated: string[] = [];
    const closed: string[] = [];
    const { result } = renderHook(() =>
      useThumbnailWorker({ onThumbnailGenerated: (p) => generated.push(p) }),
    );

    act(() => {
      result.current.sweepAll(['/photos/swept.jpg'], 512);
    });
    const worker = await untilDispatched();

    act(() => {
      worker.simulateMessage({
        id: '/photos/swept.jpg',
        bitmap: { close: () => closed.push('swept') } as unknown as ImageBitmap,
        thumbBuffer: new ArrayBuffer(8),
      });
    });

    expect(generated).toEqual(['/photos/swept.jpg']);
    expect(closed).toEqual(['swept']);
    expect(window.api.saveThumbCache).toHaveBeenCalledWith('/photos/swept.jpg', expect.anything());
    // Not in memory: a later scroll re-requests it and gets a disk-cache hit.
    expect(result.current.getThumbnail('/photos/swept.jpg')).toBe('loading');
  });

  it('a second sweep replaces the pending list of the first', async () => {
    // The QUEUE is replaced, not the work already in flight: sweepAll wakes idle
    // workers synchronously, and a read that has been issued cannot be recalled.
    // A folder change does not rely on this anyway — openFolder calls clearAll
    // first, which terminates the workers outright.
    const { result } = renderHook(() => useThumbnailWorker());

    act(() => {
      result.current.sweepAll(
        ['/old/a.jpg', '/old/b.jpg', '/old/c.jpg', '/old/d.jpg', '/old/e.jpg'],
        512,
      );
      result.current.sweepAll(['/new/a.jpg'], 512);
    });
    for (let i = 0; i < 20; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }

    // Let whatever got away finish, which is what frees a worker to take the
    // replacement list.
    for (const worker of mockWorkers) {
      for (const call of [...worker.postMessage.mock.calls]) {
        act(() => {
          worker.simulateMessage({
            id: (call[0] as { id: string }).id,
            bitmap: { close: vi.fn() } as unknown as ImageBitmap,
            thumbBuffer: new ArrayBuffer(8),
          });
        });
      }
    }
    for (let i = 0; i < 20; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }

    const dispatched = mockWorkers.flatMap((w) =>
      w.postMessage.mock.calls.map((c) => (c[0] as { id: string }).id),
    );
    const old = dispatched.filter((id) => id.startsWith('/old/'));

    // At most one per sweep-capable worker got away; c, d and e never start.
    expect(old.length).toBeLessThanOrEqual(2);
    expect(old).not.toContain('/old/c.jpg');
    expect(dispatched).toContain('/new/a.jpg');
  });

  it('clearAll cancels the sweep, which is what a folder change relies on', async () => {
    const { result } = renderHook(() => useThumbnailWorker());

    act(() => {
      result.current.sweepAll(['/old/a.jpg', '/old/b.jpg', '/old/c.jpg'], 512);
    });
    await untilDispatched();

    const before = mockWorkers.length;
    act(() => {
      result.current.clearAll();
    });
    // Fresh pool, and nothing left to hand it.
    const fresh = mockWorkers.slice(before);
    for (let i = 0; i < 20; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }

    expect(fresh.length).toBeGreaterThan(0);
    expect(fresh.every((w) => w.postMessage.mock.calls.length === 0)).toBe(true);
  });
});
