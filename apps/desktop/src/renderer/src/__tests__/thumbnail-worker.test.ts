import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useThumbnailWorker } from '../hooks/useThumbnailWorker';

// Mock Worker
class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  // Helper to simulate a response
  simulateMessage(data: unknown): void {
    if (this.onmessage) {
      this.onmessage(new MessageEvent('message', { data }));
    }
  }
}

const mockWorkers: MockWorker[] = [];

// Mock navigator.hardwareConcurrency
Object.defineProperty(globalThis.navigator, 'hardwareConcurrency', {
  value: 4,
  configurable: true,
});

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
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useThumbnailWorker', () => {
  it('creates navigator.hardwareConcurrency workers', () => {
    renderHook(() => useThumbnailWorker());
    expect(mockWorkers).toHaveLength(4);
  });

  it('requestThumbnail sends message to a free worker', () => {
    const { result } = renderHook(() => useThumbnailWorker());

    act(() => {
      result.current.requestThumbnail('img-1', 'app://local/test.jpg', 256);
    });

    // Should have posted to one of the workers
    const posted = mockWorkers.some((w) => w.postMessage.mock.calls.length > 0);
    expect(posted).toBe(true);

    const calledWorker = mockWorkers.find((w) => w.postMessage.mock.calls.length > 0)!;
    expect(calledWorker.postMessage).toHaveBeenCalledWith({
      id: 'img-1',
      url: 'app://local/test.jpg',
      size: 256,
    });
  });

  it('getThumbnail returns loading for pending requests', () => {
    const { result } = renderHook(() => useThumbnailWorker());

    act(() => {
      result.current.requestThumbnail('img-1', 'app://local/test.jpg', 256);
    });

    expect(result.current.getThumbnail('img-1')).toBe('loading');
  });

  it('getThumbnail returns bitmap after worker responds', () => {
    const { result } = renderHook(() => useThumbnailWorker());

    act(() => {
      result.current.requestThumbnail('img-1', 'app://local/test.jpg', 256);
    });

    const mockBitmap = { close: vi.fn() } as unknown as ImageBitmap;

    act(() => {
      const calledWorker = mockWorkers.find((w) => w.postMessage.mock.calls.length > 0)!;
      calledWorker.simulateMessage({ id: 'img-1', bitmap: mockBitmap });
    });

    expect(result.current.getThumbnail('img-1')).toBe(mockBitmap);
  });

  it('getThumbnail returns error after worker error response', () => {
    const { result } = renderHook(() => useThumbnailWorker());

    act(() => {
      result.current.requestThumbnail('img-1', 'app://local/test.jpg', 256);
    });

    act(() => {
      const calledWorker = mockWorkers.find((w) => w.postMessage.mock.calls.length > 0)!;
      calledWorker.simulateMessage({ id: 'img-1', error: true });
    });

    expect(result.current.getThumbnail('img-1')).toBe('error');
  });

  it('clearAll terminates workers and clears cache', () => {
    const { result } = renderHook(() => useThumbnailWorker());

    const initialWorkers = [...mockWorkers];
    expect(initialWorkers).toHaveLength(4);

    act(() => {
      result.current.clearAll();
    });

    // Old workers should be terminated
    for (const worker of initialWorkers) {
      expect(worker.terminate).toHaveBeenCalled();
    }

    // New workers should be created (4 initial + 4 new = 8 total)
    expect(mockWorkers).toHaveLength(8);
  });

  it('queues requests when all workers are busy', () => {
    const { result } = renderHook(() => useThumbnailWorker());

    // Fill all 4 workers
    act(() => {
      for (let i = 0; i < 4; i++) {
        result.current.requestThumbnail(`img-${i}`, `app://local/test${i}.jpg`, 256);
      }
    });

    // All workers should have received a message
    for (const worker of mockWorkers) {
      expect(worker.postMessage).toHaveBeenCalledTimes(1);
    }

    // This should go to queue
    act(() => {
      result.current.requestThumbnail('img-4', 'app://local/test4.jpg', 256, 5);
    });

    // Still only 1 message per worker
    for (const worker of mockWorkers) {
      expect(worker.postMessage).toHaveBeenCalledTimes(1);
    }

    // Complete first worker's task -- should dispatch queued item
    const mockBitmap = { close: vi.fn() } as unknown as ImageBitmap;
    act(() => {
      mockWorkers[0].simulateMessage({ id: 'img-0', bitmap: mockBitmap });
    });

    // First worker should now have 2 messages (original + queued)
    expect(mockWorkers[0].postMessage).toHaveBeenCalledTimes(2);
  });

  it('updateVisibleRange reprioritizes pending queue', () => {
    const { result } = renderHook(() => useThumbnailWorker());

    // Fill all workers
    act(() => {
      for (let i = 0; i < 4; i++) {
        result.current.requestThumbnail(`busy-${i}`, `app://local/busy${i}.jpg`, 256);
      }
    });

    // Queue items with different group indices
    act(() => {
      result.current.requestThumbnail('far-item', 'app://local/far.jpg', 256, 100);
      result.current.requestThumbnail('near-item', 'app://local/near.jpg', 256, 2);
    });

    // Update visible range to include near-item's group
    act(() => {
      result.current.updateVisibleRange(0, 5);
    });

    // Complete a worker -- should dispatch near-item first (visible range)
    const mockBitmap = { close: vi.fn() } as unknown as ImageBitmap;
    act(() => {
      mockWorkers[0].simulateMessage({ id: 'busy-0', bitmap: mockBitmap });
    });

    // The dispatched item should be near-item (group 2, in visible range 0-5)
    const lastCall = mockWorkers[0].postMessage.mock.calls[1];
    expect(lastCall[0].id).toBe('near-item');
  });

  it('does not re-request already cached thumbnails', () => {
    const { result } = renderHook(() => useThumbnailWorker());

    act(() => {
      result.current.requestThumbnail('img-1', 'app://local/test.jpg', 256);
    });

    const mockBitmap = { close: vi.fn() } as unknown as ImageBitmap;
    act(() => {
      mockWorkers[0].simulateMessage({ id: 'img-1', bitmap: mockBitmap });
    });

    // Try requesting same thumbnail again
    act(() => {
      result.current.requestThumbnail('img-1', 'app://local/test.jpg', 256);
    });

    // Should only have been posted once
    expect(mockWorkers[0].postMessage).toHaveBeenCalledTimes(1);
  });
});
