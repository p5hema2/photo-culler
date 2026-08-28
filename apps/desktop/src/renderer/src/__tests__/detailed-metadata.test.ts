import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { DetailedMetadata } from '@photo-culler/types';
import { useDetailedMetadata } from '../hooks/useDetailedMetadata';

/**
 * The cache in `useDetailedMetadata` is module-level and keyed by PATH, which is
 * the whole reason these tests exist: a rotation rewrites a file's EXIF
 * Orientation without changing its path, and `focusInfo.exifOrientation` is read
 * back out of here to map the AF box into the displayed frame. A stale entry
 * puts that box 90 degrees out on a photo the user has just turned.
 *
 * Every test therefore uses its own path — the cache survives across tests in
 * this file, exactly as it survives across mounts in the app.
 */

let read = vi.fn<(path: string) => Promise<DetailedMetadata | null>>();
let orientation = 1;

function meta(path: string, exifOrientation: number): DetailedMetadata {
  return {
    path,
    sourceMtimeMs: 0,
    vendor: 'panasonic',
    focus: {
      frame: 'sensor',
      exifOrientation,
      mode: 'af-s',
      modeLabel: 'AF-S',
      areaMode: null,
      subjectDetection: null,
      assistLamp: null,
      facesDetected: null,
      regions: [],
    },
    lens: null,
    tags: [],
  };
}

/** Run past the hook's 200 ms debounce and settle the read it starts. */
async function flush(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  orientation = 1;
  read = vi.fn((path: string) => Promise.resolve(meta(path, orientation)));
  Object.assign(window, { api: { readDetailedMetadata: read } });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useDetailedMetadata', () => {
  it('reads once and serves the cached value to a later mount', async () => {
    const path = '/shoot/cached.jpg';
    const first = renderHook(() => useDetailedMetadata(path, true, 0));
    await flush();
    expect(first.result.current.status).toBe('ready');
    first.unmount();

    // No loading flash and no second exiftool read: that is what the cache buys.
    const second = renderHook(() => useDetailedMetadata(path, true, 0));
    expect(second.result.current.status).toBe('ready');
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('re-reads the same path when the reload token moves', async () => {
    const path = '/shoot/rotated.jpg';
    const { result, rerender } = renderHook(
      ({ token }: { token: number }) => useDetailedMetadata(path, true, token),
      { initialProps: { token: 0 } },
    );
    await flush();
    expect(result.current).toEqual({ status: 'ready', data: meta(path, 1) });

    // What a rotation does: the file's orientation tag changes, the path does
    // not, and usePhotoStore bumps fileRevision.
    orientation = 6;
    rerender({ token: 1 });
    await flush();

    expect(read).toHaveBeenCalledTimes(2);
    expect(result.current).toEqual({ status: 'ready', data: meta(path, 6) });
  });

  it('does not re-read while the reload token stands still', async () => {
    const path = '/shoot/still.jpg';
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useDetailedMetadata(path, enabled, 7),
      { initialProps: { enabled: true } },
    );
    await flush();
    expect(read).toHaveBeenCalledTimes(1);

    rerender({ enabled: false });
    rerender({ enabled: true });
    await flush();

    expect(read).toHaveBeenCalledTimes(1);
  });
});
