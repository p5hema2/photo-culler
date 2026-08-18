import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePhotoStore } from '../hooks/usePhotoStore';

class FakeWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event?: unknown) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
}

function img(folder: string, name: string) {
  return { name, path: `${folder}/${name}`, extension: 'jpg', size: 100, lastModified: 1 };
}

/** Folder B is fully analysed: cached EXIF, a score, and a user classification. */
const B_RESULTS = JSON.stringify({
  version: 1,
  folderPath: '/B',
  updatedAt: 'x',
  images: {
    'b1.jpg': {
      classification: 'keep',
      userOverride: true,
      qualityScore: 88,
      exif: { dateTaken: 999, cameraModel: 'CamB' },
    },
  },
});

let disk: Record<string, string | null>;
let deferredB: { promise: Promise<string | null>; resolve: (v: string | null) => void } | null;

function makeDeferred() {
  let resolve!: (v: string | null) => void;
  const promise = new Promise<string | null>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  deferredB = null;
  disk = { '/A': null, '/B': B_RESULTS };
  (globalThis as unknown as { Worker: unknown }).Worker = FakeWorker;
  (globalThis as unknown as { window: { api: unknown } }).window.api = {
    scanFolder: vi.fn(async (folder: string) => [
      img(folder, folder === '/B' ? 'b1.jpg' : 'a1.jpg'),
    ]),
    loadResults: vi.fn(async (folder: string) => {
      // Let a test hold folder B's load open to exercise the in-flight window
      if (folder === '/B' && deferredB) return deferredB.promise;
      return disk[folder] ?? null;
    }),
    saveResults: vi.fn(async (folder: string, data: string) => {
      disk[folder] = data;
    }),
    clearResults: vi.fn(async (folder: string) => {
      disk[folder] = null;
    }),
    getSession: vi.fn(async () => ({})),
    setSession: vi.fn(async () => undefined),
    loadThumbCache: vi.fn(async () => null),
    saveThumbCache: vi.fn(async () => undefined),
    readFile: vi.fn(async () => new ArrayBuffer(8)),
    getAppVersion: vi.fn(async () => '1.2.0'),
  };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('results persistence', () => {
  it('persists a quality score without any other user action', async () => {
    // The original bug: setQualityScore updated memory only, so scores never
    // reached disk and the whole analysis re-ran on the next open.
    const { result } = renderHook(() => usePhotoStore());

    await act(async () => {
      await result.current.openFolder('/B');
    });
    await act(async () => {
      result.current.setQualityScore('b1.jpg', 42, {
        sharpness: 42,
        exposure: 42,
        contrast: 42,
        noise: 42,
      });
    });
    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    const onDisk = JSON.parse(disk['/B']!);
    expect(onDisk.images['b1.jpg'].qualityScore).toBe(42);
  });

  it('does not wipe the incoming folder when the previous folder still reports scores', async () => {
    // Regression guard for the epoch check. openFolder resets classifications to
    // {} and only repopulates after two awaited IPC round trips. A stale score
    // landing in that window used to persist `images: {}` over the new folder's
    // real results file, destroying classifications, scores and cached EXIF.
    const { result } = renderHook(() => usePhotoStore());

    await act(async () => {
      await result.current.openFolder('/A');
    });

    // Hold B's load open, then start opening it
    deferredB = makeDeferred();
    let openB!: Promise<void>;
    await act(async () => {
      openB = result.current.openFolder('/B');
    });

    // Folder A's still-running worker delivers a score mid-flight
    await act(async () => {
      result.current.setQualityScore('a1.jpg', 7, {
        sharpness: 7,
        exposure: 7,
        contrast: 7,
        noise: 7,
      });
      vi.advanceTimersByTime(600);
    });

    // Let B finish loading
    await act(async () => {
      deferredB!.resolve(B_RESULTS);
      await openB;
      vi.advanceTimersByTime(600);
    });

    const onDisk = JSON.parse(disk['/B']!);
    expect(Object.keys(onDisk.images)).toContain('b1.jpg');
    expect(onDisk.images['b1.jpg'].classification).toBe('keep');
    expect(onDisk.images['b1.jpg'].qualityScore).toBe(88);
    expect(onDisk.images['b1.jpg'].exif?.cameraModel).toBe('CamB');
  });
});
