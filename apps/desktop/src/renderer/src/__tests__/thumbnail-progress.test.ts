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
