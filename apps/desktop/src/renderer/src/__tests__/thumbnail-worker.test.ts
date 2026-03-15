import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useThumbnailWorker } from '../hooks/useThumbnailWorker';

// Mock Worker
class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  simulateMessage(data: unknown): void {
    if (this.onmessage) {
      this.onmessage(new MessageEvent('message', { data }));
    }
  }
}

const mockWorkers: MockWorker[] = [];
const mockArrayBuffer = new ArrayBuffer(16);

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

  // Mock window.api.readFile — used by useThumbnailWorker to read image files via IPC
  (window as any).api = {
    readFile: vi.fn().mockResolvedValue(mockArrayBuffer),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useThumbnailWorker', () => {
  it('creates navigator.hardwareConcurrency workers', () => {
    renderHook(() => useThumbnailWorker());
    expect(mockWorkers).toHaveLength(4);
  });

  it('requestThumbnail reads file via IPC and sends buffer to worker', async () => {
    const { result } = renderHook(() => useThumbnailWorker());

    act(() => {
      result.current.requestThumbnail('/test/img.jpg', 'unused-url', 256);
    });

    await waitFor(() => {
      const posted = mockWorkers.some((w) => w.postMessage.mock.calls.length > 0);
      expect(posted).toBe(true);
    });

    expect(window.api.readFile).toHaveBeenCalledWith('/test/img.jpg');

    const calledWorker = mockWorkers.find((w) => w.postMessage.mock.calls.length > 0)!;
    const call = calledWorker.postMessage.mock.calls[0];
    expect(call[0]).toMatchObject({
      id: '/test/img.jpg',
      mimeType: 'image/jpeg',
      size: 256,
    });
    expect(call[0].buffer).toBe(mockArrayBuffer);
    expect(call[1]).toEqual([mockArrayBuffer]);
  });

  it('getThumbnail returns loading for pending requests', async () => {
    const { result } = renderHook(() => useThumbnailWorker());

    act(() => {
      result.current.requestThumbnail('/test/img.jpg', 'unused', 256);
    });

    expect(result.current.getThumbnail('/test/img.jpg')).toBe('loading');
  });

  it('getThumbnail returns bitmap after worker responds', async () => {
    const { result } = renderHook(() => useThumbnailWorker());

    act(() => {
      result.current.requestThumbnail('/test/img.jpg', 'unused', 256);
    });

    await waitFor(() => {
      const posted = mockWorkers.some((w) => w.postMessage.mock.calls.length > 0);
      expect(posted).toBe(true);
    });

    const mockBitmap = { close: vi.fn() } as unknown as ImageBitmap;

    act(() => {
      const calledWorker = mockWorkers.find((w) => w.postMessage.mock.calls.length > 0)!;
      calledWorker.simulateMessage({ id: '/test/img.jpg', bitmap: mockBitmap });
    });

    expect(result.current.getThumbnail('/test/img.jpg')).toBe(mockBitmap);
  });

  it('getThumbnail returns error after worker error response', async () => {
    const { result } = renderHook(() => useThumbnailWorker());

    act(() => {
      result.current.requestThumbnail('/test/img.jpg', 'unused', 256);
    });

    await waitFor(() => {
      const posted = mockWorkers.some((w) => w.postMessage.mock.calls.length > 0);
      expect(posted).toBe(true);
    });

    act(() => {
      const calledWorker = mockWorkers.find((w) => w.postMessage.mock.calls.length > 0)!;
      calledWorker.simulateMessage({ id: '/test/img.jpg', error: true });
    });

    expect(result.current.getThumbnail('/test/img.jpg')).toBe('error');
  });

  it('clearAll terminates workers and clears cache', () => {
    const { result } = renderHook(() => useThumbnailWorker());

    const initialWorkers = [...mockWorkers];
    expect(initialWorkers).toHaveLength(4);

    act(() => {
      result.current.clearAll();
    });

    for (const worker of initialWorkers) {
      expect(worker.terminate).toHaveBeenCalled();
    }

    expect(mockWorkers).toHaveLength(8);
  });

  it('queues requests when all workers are busy', async () => {
    const { result } = renderHook(() => useThumbnailWorker());

    act(() => {
      for (let i = 0; i < 4; i++) {
        result.current.requestThumbnail(`/test/img-${i}.jpg`, 'unused', 256);
      }
    });

    await waitFor(() => {
      for (const worker of mockWorkers) {
        expect(worker.postMessage).toHaveBeenCalledTimes(1);
      }
    });

    act(() => {
      result.current.requestThumbnail('/test/img-4.jpg', 'unused', 256, 5);
    });

    const mockBitmap = { close: vi.fn() } as unknown as ImageBitmap;
    act(() => {
      mockWorkers[0].simulateMessage({ id: '/test/img-0.jpg', bitmap: mockBitmap });
    });

    await waitFor(() => {
      expect(mockWorkers[0].postMessage).toHaveBeenCalledTimes(2);
    });
  });

  it('updateVisibleRange reprioritizes pending queue', async () => {
    const { result } = renderHook(() => useThumbnailWorker());

    act(() => {
      for (let i = 0; i < 4; i++) {
        result.current.requestThumbnail(`/test/busy-${i}.jpg`, 'unused', 256);
      }
    });

    await waitFor(() => {
      for (const worker of mockWorkers) {
        expect(worker.postMessage).toHaveBeenCalledTimes(1);
      }
    });

    act(() => {
      result.current.requestThumbnail('/test/far.jpg', 'unused', 256, 100);
      result.current.requestThumbnail('/test/near.jpg', 'unused', 256, 2);
    });

    act(() => {
      result.current.updateVisibleRange(0, 5);
    });

    const mockBitmap = { close: vi.fn() } as unknown as ImageBitmap;
    act(() => {
      mockWorkers[0].simulateMessage({ id: '/test/busy-0.jpg', bitmap: mockBitmap });
    });

    await waitFor(() => {
      expect(mockWorkers[0].postMessage).toHaveBeenCalledTimes(2);
    });

    const lastCall = mockWorkers[0].postMessage.mock.calls[1];
    expect(lastCall[0].id).toBe('/test/near.jpg');
  });

  it('does not re-request already cached thumbnails', async () => {
    const { result } = renderHook(() => useThumbnailWorker());

    act(() => {
      result.current.requestThumbnail('/test/img.jpg', 'unused', 256);
    });

    await waitFor(() => {
      const posted = mockWorkers.some((w) => w.postMessage.mock.calls.length > 0);
      expect(posted).toBe(true);
    });

    const mockBitmap = { close: vi.fn() } as unknown as ImageBitmap;
    act(() => {
      mockWorkers[0].simulateMessage({ id: '/test/img.jpg', bitmap: mockBitmap });
    });

    act(() => {
      result.current.requestThumbnail('/test/img.jpg', 'unused', 256);
    });

    expect(mockWorkers[0].postMessage).toHaveBeenCalledTimes(1);
  });
});
