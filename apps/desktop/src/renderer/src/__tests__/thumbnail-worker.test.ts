import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useThumbnailWorker, storeBitmap, MAX_CACHED_BITMAPS } from '../hooks/useThumbnailWorker';
import { THUMB_MAX_EDGE, THUMB_MIME } from '../lib/thumbnail-geometry';

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

  // Mock window.api — used by useThumbnailWorker to read image files and cache thumbnails via IPC
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
  // Also drops the Worker stub, which beforeEach reinstalls — without this the
  // createImageBitmap stub from the cache-hit test leaks into later ones.
  vi.unstubAllGlobals();
});

interface DecodeStub {
  /** The bitmap `getThumbnail` must hand back for an id — identity matters. */
  bitmapFor: (id: string) => ImageBitmap;
  /** That bitmap's `close` spy, which is how eviction is observed. */
  closeSpy: (id: string) => ReturnType<typeof vi.fn>;
  /** The bytes the disk cache should return for an id, or null for a miss. */
  bufferFor: (id: string) => ArrayBuffer | null;
}

/**
 * Route a set of ids through the disk-cache path, each with its own decoded
 * bitmap. That path needs no worker message to complete, so a test can fill the
 * cache with hundreds of entries by awaiting instead of simulating.
 *
 * `createImageBitmap` receives a Blob, which carries no id, so each id is given
 * a buffer of a unique byte length and recognised by that length on the way
 * back.
 */
function stubDecodedThumbnails(ids: string[]): DecodeStub {
  const bitmaps = new Map<string, { close: ReturnType<typeof vi.fn> }>();
  const lengths = new Map<string, number>();
  const byLength = new Map<number, string>();

  ids.forEach((id, index) => {
    bitmaps.set(id, { close: vi.fn() });
    lengths.set(id, index + 1);
    byLength.set(index + 1, id);
  });

  const bufferFor = (id: string): ArrayBuffer | null => {
    const length = lengths.get(id);
    return length === undefined ? null : new ArrayBuffer(length);
  };

  (window.api.loadThumbCache as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) =>
    bufferFor(id),
  );

  vi.stubGlobal('createImageBitmap', async (blob: Blob) => {
    const id = byLength.get(blob.size);
    const bitmap = id === undefined ? undefined : bitmaps.get(id);
    if (!bitmap) throw new Error(`unexpected decode of a ${blob.size}-byte blob`);
    return bitmap as unknown as ImageBitmap;
  });

  return {
    bitmapFor: (id) => bitmaps.get(id)! as unknown as ImageBitmap,
    closeSpy: (id) => bitmaps.get(id)!.close,
    bufferFor,
  };
}

/**
 * Request every id and wait until all of them are decoded.
 *
 * Reading them in order also leaves recency in `ids` order — `getThumbnail` is
 * what refreshes it — which is the order the eviction assertions are stated
 * against. Never call this with more ids than the bound: past it, one is always
 * evicted and the wait could not settle.
 */
async function fillCache(
  result: { current: ReturnType<typeof useThumbnailWorker> },
  ids: string[],
): Promise<void> {
  act(() => {
    for (const id of ids) {
      result.current.requestThumbnail(id, 'unused', THUMB_MAX_EDGE);
    }
  });

  await waitFor(
    () => {
      const loading = ids.filter((id) => result.current.getThumbnail(id) === 'loading');
      expect(loading).toHaveLength(0);
    },
    { timeout: 5000 },
  );
}

/** How many of `ids` are cached. Counts through `getThumbnail`, so it refreshes recency. */
function decodedCount(api: ReturnType<typeof useThumbnailWorker>, ids: string[]): number {
  return ids.filter((id) => api.getThumbnail(id) !== 'loading').length;
}

describe('useThumbnailWorker', () => {
  it('creates navigator.hardwareConcurrency workers', () => {
    renderHook(() => useThumbnailWorker());
    expect(mockWorkers).toHaveLength(4);
  });

  it('requestThumbnail reads file via IPC and sends buffer to worker', async () => {
    const { result } = renderHook(() => useThumbnailWorker());

    act(() => {
      result.current.requestThumbnail('/test/img.jpg', 'unused-url', THUMB_MAX_EDGE);
    });

    await waitFor(() => {
      const posted = mockWorkers.some((w) => w.postMessage.mock.calls.length > 0);
      expect(posted).toBe(true);
    });

    expect(window.api.readFile).toHaveBeenCalledWith('/test/img.jpg');

    const calledWorker = mockWorkers.find((w) => w.postMessage.mock.calls.length > 0)!;
    const call = calledWorker.postMessage.mock.calls[0]!;
    expect(call[0]).toMatchObject({
      id: '/test/img.jpg',
      mimeType: 'image/jpeg',
      size: THUMB_MAX_EDGE,
    });
    expect(call[0].buffer).toBe(mockArrayBuffer);
    expect(call[1]).toEqual([mockArrayBuffer]);
  });

  it('saves the encoded thumbnail the worker returns to the disk cache', async () => {
    const { result } = renderHook(() => useThumbnailWorker());

    act(() => {
      result.current.requestThumbnail('/test/img.jpg', 'unused', THUMB_MAX_EDGE);
    });

    await waitFor(() => {
      expect(mockWorkers.some((w) => w.postMessage.mock.calls.length > 0)).toBe(true);
    });

    const encoded = new ArrayBuffer(4);
    const mockBitmap = { close: vi.fn() } as unknown as ImageBitmap;

    act(() => {
      const calledWorker = mockWorkers.find((w) => w.postMessage.mock.calls.length > 0)!;
      calledWorker.simulateMessage({
        id: '/test/img.jpg',
        bitmap: mockBitmap,
        thumbBuffer: encoded,
      });
    });

    // The field name is the whole contract between worker and host here — a
    // mismatch leaves the disk cache silently empty and every folder slow.
    expect(window.api.saveThumbCache).toHaveBeenCalledWith('/test/img.jpg', encoded);
  });

  it('decodes a cache hit as the stored container and never touches a worker', async () => {
    const cached = new ArrayBuffer(8);
    const mockBitmap = { close: vi.fn() } as unknown as ImageBitmap;
    (window.api.loadThumbCache as ReturnType<typeof vi.fn>).mockResolvedValue(cached);

    const decoded: Blob[] = [];
    vi.stubGlobal('createImageBitmap', async (blob: Blob) => {
      decoded.push(blob);
      return mockBitmap;
    });

    const { result } = renderHook(() => useThumbnailWorker());

    act(() => {
      result.current.requestThumbnail('/test/img.jpg', 'unused', THUMB_MAX_EDGE);
    });

    await waitFor(() => {
      expect(result.current.getThumbnail('/test/img.jpg')).toBe(mockBitmap);
    });

    // The container is declared rather than sniffed, so a stale 'image/jpeg'
    // here is exactly how a WebP cache would stop decoding.
    expect(decoded[0]!.type).toBe(THUMB_MIME);
    expect(window.api.readFile).not.toHaveBeenCalled();
  });

  it('getThumbnail returns loading for pending requests', async () => {
    const { result } = renderHook(() => useThumbnailWorker());

    act(() => {
      result.current.requestThumbnail('/test/img.jpg', 'unused', THUMB_MAX_EDGE);
    });

    expect(result.current.getThumbnail('/test/img.jpg')).toBe('loading');
  });

  it('getThumbnail returns bitmap after worker responds', async () => {
    const { result } = renderHook(() => useThumbnailWorker());

    act(() => {
      result.current.requestThumbnail('/test/img.jpg', 'unused', THUMB_MAX_EDGE);
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
      result.current.requestThumbnail('/test/img.jpg', 'unused', THUMB_MAX_EDGE);
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
        result.current.requestThumbnail(`/test/img-${i}.jpg`, 'unused', THUMB_MAX_EDGE);
      }
    });

    await waitFor(() => {
      for (const worker of mockWorkers) {
        expect(worker.postMessage).toHaveBeenCalledTimes(1);
      }
    });

    act(() => {
      result.current.requestThumbnail('/test/img-4.jpg', 'unused', THUMB_MAX_EDGE, 5);
    });

    const mockBitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const firstWorker = mockWorkers[0]!;
    act(() => {
      firstWorker.simulateMessage({ id: '/test/img-0.jpg', bitmap: mockBitmap });
    });

    await waitFor(() => {
      expect(firstWorker.postMessage).toHaveBeenCalledTimes(2);
    });
  });

  it('updateVisibleRange reprioritizes pending queue', async () => {
    const { result } = renderHook(() => useThumbnailWorker());

    act(() => {
      for (let i = 0; i < 4; i++) {
        result.current.requestThumbnail(`/test/busy-${i}.jpg`, 'unused', THUMB_MAX_EDGE);
      }
    });

    await waitFor(() => {
      for (const worker of mockWorkers) {
        expect(worker.postMessage).toHaveBeenCalledTimes(1);
      }
    });

    act(() => {
      result.current.requestThumbnail('/test/far.jpg', 'unused', THUMB_MAX_EDGE, 100);
      result.current.requestThumbnail('/test/near.jpg', 'unused', THUMB_MAX_EDGE, 2);
    });

    act(() => {
      result.current.updateVisibleRange(0, 5);
    });

    const mockBitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const firstWorker = mockWorkers[0]!;
    act(() => {
      firstWorker.simulateMessage({ id: '/test/busy-0.jpg', bitmap: mockBitmap });
    });

    await waitFor(() => {
      expect(firstWorker.postMessage).toHaveBeenCalledTimes(2);
    });

    const lastCall = firstWorker.postMessage.mock.calls[1]!;
    expect(lastCall[0].id).toBe('/test/near.jpg');
  });

  it('does not re-request already cached thumbnails', async () => {
    const { result } = renderHook(() => useThumbnailWorker());

    act(() => {
      result.current.requestThumbnail('/test/img.jpg', 'unused', THUMB_MAX_EDGE);
    });

    await waitFor(() => {
      const posted = mockWorkers.some((w) => w.postMessage.mock.calls.length > 0);
      expect(posted).toBe(true);
    });

    const mockBitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const firstWorker = mockWorkers[0]!;
    act(() => {
      firstWorker.simulateMessage({ id: '/test/img.jpg', bitmap: mockBitmap });
    });

    act(() => {
      result.current.requestThumbnail('/test/img.jpg', 'unused', THUMB_MAX_EDGE);
    });

    expect(firstWorker.postMessage).toHaveBeenCalledTimes(1);
  });

  it('holds at most MAX_CACHED_BITMAPS decoded thumbnails', async () => {
    const ids = Array.from({ length: MAX_CACHED_BITMAPS + 1 }, (_, i) => `/test/img-${i}.jpg`);
    const stub = stubDecodedThumbnails(ids);
    const { result } = renderHook(() => useThumbnailWorker());

    const extra = ids[MAX_CACHED_BITMAPS]!;
    await fillCache(result, ids.slice(0, MAX_CACHED_BITMAPS));
    expect(decodedCount(result.current, ids)).toBe(MAX_CACHED_BITMAPS);

    act(() => {
      result.current.requestThumbnail(extra, 'unused', THUMB_MAX_EDGE);
    });
    await waitFor(() => {
      expect(result.current.getThumbnail(extra)).toBe(stub.bitmapFor(extra));
    });

    // One in, one out. Unbounded, this is where the 3470-image folder headed.
    expect(decodedCount(result.current, ids)).toBe(MAX_CACHED_BITMAPS);
  });

  it('evicts the least recently used thumbnail and closes its bitmap', async () => {
    const ids = Array.from({ length: MAX_CACHED_BITMAPS + 1 }, (_, i) => `/test/img-${i}.jpg`);
    const stub = stubDecodedThumbnails(ids);
    const { result } = renderHook(() => useThumbnailWorker());

    const filling = ids.slice(0, MAX_CACHED_BITMAPS);
    await fillCache(result, filling);

    const oldest = filling[0]!;
    const nextOldest = filling[1]!;
    const extra = ids[MAX_CACHED_BITMAPS]!;

    // Reading the coldest entry must make it the newest, so the eviction takes
    // the one behind it. Without the re-insert in getThumbnail this is the id
    // that would be closed while a cell was still drawing it.
    expect(result.current.getThumbnail(oldest)).toBe(stub.bitmapFor(oldest));

    act(() => {
      result.current.requestThumbnail(extra, 'unused', THUMB_MAX_EDGE);
    });
    await waitFor(() => {
      expect(result.current.getThumbnail(extra)).toBe(stub.bitmapFor(extra));
    });

    expect(result.current.getThumbnail(nextOldest)).toBe('loading');
    expect(stub.closeSpy(nextOldest)).toHaveBeenCalledTimes(1);

    expect(result.current.getThumbnail(oldest)).toBe(stub.bitmapFor(oldest));
    expect(stub.closeSpy(oldest)).not.toHaveBeenCalled();
    expect(stub.closeSpy(extra)).not.toHaveBeenCalled();
  });

  it('re-fetches a thumbnail that was evicted', async () => {
    const ids = Array.from({ length: MAX_CACHED_BITMAPS + 1 }, (_, i) => `/test/img-${i}.jpg`);
    const stub = stubDecodedThumbnails(ids);
    const { result } = renderHook(() => useThumbnailWorker());

    const evicted = ids[0]!;
    const extra = ids[MAX_CACHED_BITMAPS]!;
    await fillCache(result, ids.slice(0, MAX_CACHED_BITMAPS));

    act(() => {
      result.current.requestThumbnail(extra, 'unused', THUMB_MAX_EDGE);
    });
    // Wait on `extra`, not on `evicted`: polling `getThumbnail(evicted)` would
    // refresh its recency and move the eviction to another id.
    await waitFor(() => {
      expect(result.current.getThumbnail(extra)).toBe(stub.bitmapFor(extra));
    });
    expect(result.current.getThumbnail(evicted)).toBe('loading');

    const loadThumbCache = window.api.loadThumbCache as ReturnType<typeof vi.fn>;
    loadThumbCache.mockClear();

    // The request guard checks cache-or-pending; eviction has to leave the id
    // out of both, or a cell scrolled back into view would sit on 'loading'.
    act(() => {
      result.current.requestThumbnail(evicted, 'unused', THUMB_MAX_EDGE);
    });
    await waitFor(() => {
      expect(result.current.getThumbnail(evicted)).toBe(stub.bitmapFor(evicted));
    });

    expect(loadThumbCache).toHaveBeenCalledWith(evicted);
  });

  it('never evicts a request whose read is still in flight', async () => {
    const held = '/test/held.jpg';
    const ids = [
      held,
      ...Array.from({ length: MAX_CACHED_BITMAPS + 1 }, (_, i) => `/test/img-${i}.jpg`),
    ];
    const stub = stubDecodedThumbnails(ids);

    let release: (() => void) | undefined;
    const heldRead = new Promise<ArrayBuffer | null>((resolve) => {
      release = () => resolve(stub.bufferFor(held));
    });
    (window.api.loadThumbCache as ReturnType<typeof vi.fn>).mockImplementation(
      async (id: string) => (id === held ? heldRead : stub.bufferFor(id)),
    );

    const { result } = renderHook(() => useThumbnailWorker());

    // This read occupies one worker slot and never finishes, so `held` stays
    // pending across the fill and the eviction that follows it.
    act(() => {
      result.current.requestThumbnail(held, 'unused', THUMB_MAX_EDGE);
    });

    const filling = ids.slice(1, MAX_CACHED_BITMAPS + 1);
    const extra = ids[MAX_CACHED_BITMAPS + 1]!;
    await fillCache(result, filling);

    act(() => {
      result.current.requestThumbnail(extra, 'unused', THUMB_MAX_EDGE);
    });
    await waitFor(() => {
      expect(result.current.getThumbnail(extra)).toBe(stub.bitmapFor(extra));
    });

    // Eviction has run at least once while `held` was pending.
    expect(result.current.getThumbnail(held)).toBe('loading');
    expect(stub.closeSpy(held)).not.toHaveBeenCalled();

    await act(async () => {
      release!();
      await heldRead;
    });

    await waitFor(() => {
      expect(result.current.getThumbnail(held)).toBe(stub.bitmapFor(held));
    });
    expect(stub.closeSpy(held)).not.toHaveBeenCalled();
    expect(decodedCount(result.current, ids)).toBe(MAX_CACHED_BITMAPS);
  });
});

describe('storeBitmap', () => {
  const closes = new Map<string, ReturnType<typeof vi.fn>>();

  /** A stand-in bitmap whose `close` can be asserted on by id. */
  function fakeBitmap(id: string): ImageBitmap {
    const close = vi.fn();
    closes.set(id, close);
    return { close } as unknown as ImageBitmap;
  }

  function fullCache(): Map<string, ImageBitmap | 'error'> {
    const cache = new Map<string, ImageBitmap | 'error'>();
    for (let i = 0; i < MAX_CACHED_BITMAPS; i++) {
      const id = `/cold-${i}.jpg`;
      cache.set(id, fakeBitmap(id));
    }
    return cache;
  }

  beforeEach(() => {
    closes.clear();
  });

  it('skips a pending entry and takes the next coldest instead', () => {
    const cache = fullCache();
    // The coldest entry is also the one being read again — evicting it would
    // close a bitmap the in-flight response is about to hand out.
    const pending = new Set(['/cold-0.jpg']);

    storeBitmap(cache, pending, '/new.jpg', fakeBitmap('/new.jpg'));

    expect(cache.has('/cold-0.jpg')).toBe(true);
    expect(closes.get('/cold-0.jpg')!).not.toHaveBeenCalled();
    expect(cache.has('/cold-1.jpg')).toBe(false);
    expect(closes.get('/cold-1.jpg')!).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(MAX_CACHED_BITMAPS);
  });

  it('re-inserts an overwritten key as the most recent entry', () => {
    const cache = fullCache();
    const reused = '/cold-0.jpg';
    const fresh = fakeBitmap(reused);

    // Map.set on an existing key keeps its position, so without the delete the
    // fresh bitmap would inherit the coldest slot and the very next store would
    // close it.
    storeBitmap(cache, new Set(), reused, fresh);
    storeBitmap(cache, new Set(), '/new.jpg', fakeBitmap('/new.jpg'));

    expect(cache.get(reused)).toBe(fresh);
    expect(closes.get(reused)!).not.toHaveBeenCalled();
    expect(cache.has('/cold-1.jpg')).toBe(false);
    expect(cache.size).toBe(MAX_CACHED_BITMAPS);
  });

  it('counts only bitmaps toward the bound, never error entries', () => {
    const cache = fullCache();
    for (let i = 0; i < 50; i++) cache.set(`/broken-${i}.jpg`, 'error');

    storeBitmap(cache, new Set(), '/new.jpg', fakeBitmap('/new.jpg'));

    // 'error' holds no pixels, so the 50 of them neither pay for the eviction
    // nor get swept: exactly one bitmap goes.
    expect(cache.has('/cold-0.jpg')).toBe(false);
    expect(cache.has('/cold-1.jpg')).toBe(true);
    for (let i = 0; i < 50; i++) expect(cache.get(`/broken-${i}.jpg`)).toBe('error');
    expect(cache.size).toBe(MAX_CACHED_BITMAPS + 50);
  });
});
