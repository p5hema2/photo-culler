import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFullImage, mimeForPath } from '../hooks/useFullImage';

/**
 * Object-URL bookkeeping. `live` is every URL created and not yet revoked, and
 * `doubleRevoked` catches the other half of the leak: a URL revoked twice means
 * two owners think they hold it, so the next one will be dropped unrevoked —
 * 6 MB of original per keypress.
 */
let created = 0;
const live = new Set<string>();
const doubleRevoked: string[] = [];

interface PendingRead {
  path: string;
  resolve: (buffer: ArrayBuffer) => void;
  reject: (error: unknown) => void;
}

/** Reads awaiting `settle`/`fail`, when a test needs to inspect the wait. */
let pendingReads: PendingRead[] = [];
let manualReads = false;
let readFile = vi.fn<(path: string) => Promise<ArrayBuffer>>();

const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;

/** Let every scheduled timer and the promises it starts run to completion. */
async function flush(ms = 1): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function settle(path: string): void {
  const idx = pendingReads.findIndex((read) => read.path === path);
  if (idx === -1) throw new Error(`no read in flight for ${path}`);
  pendingReads.splice(idx, 1)[0]!.resolve(new ArrayBuffer(8));
}

function fail(path: string): void {
  const idx = pendingReads.findIndex((read) => read.path === path);
  if (idx === -1) throw new Error(`no read in flight for ${path}`);
  pendingReads.splice(idx, 1)[0]!.reject(new Error('ENOENT'));
}

function readPaths(): string[] {
  return readFile.mock.calls.map((call) => call[0]);
}

beforeEach(() => {
  vi.useFakeTimers();
  created = 0;
  live.clear();
  doubleRevoked.length = 0;
  pendingReads = [];
  manualReads = false;

  URL.createObjectURL = vi.fn(() => {
    const url = `blob:original-${++created}`;
    live.add(url);
    return url;
  });
  URL.revokeObjectURL = vi.fn((url: string) => {
    if (!live.delete(url)) doubleRevoked.push(url);
  });

  readFile = vi.fn(
    (path: string) =>
      new Promise<ArrayBuffer>((resolve, reject) => {
        if (manualReads) pendingReads.push({ path, resolve, reject });
        else resolve(new ArrayBuffer(8));
      }),
  );
  Object.assign(window, { api: { readFile } });
});

afterEach(() => {
  vi.useRealTimers();
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
});

describe('mimeForPath', () => {
  it('maps the extensions the app opens', () => {
    expect(mimeForPath('/a/b.JPG')).toBe('image/jpeg');
    expect(mimeForPath('/a/b.png')).toBe('image/png');
    expect(mimeForPath('/a/b.tif')).toBe('image/tiff');
  });

  it('falls back to JPEG for anything else', () => {
    expect(mimeForPath('/a/b.raf')).toBe('image/jpeg');
    expect(mimeForPath('/a/noextension')).toBe('image/jpeg');
  });
});

describe('useFullImage', () => {
  it('reads the focused original and hands back its object URL', async () => {
    const { result } = renderHook(() => useFullImage('/shoot/a.jpg'));

    expect(result.current.isLoading).toBe(true);
    await flush();

    expect(readPaths()).toEqual(['/shoot/a.jpg']);
    expect(result.current.url).toBe('blob:original-1');
    expect(result.current.urlPath).toBe('/shoot/a.jpg');
    expect(result.current.isLoading).toBe(false);
  });

  it('debounces the read, so key repeat costs one file instead of three', async () => {
    const { rerender } = renderHook(
      (props: { path: string }) => useFullImage(props.path, { debounceMs: 180 }),
      { initialProps: { path: '/shoot/1.jpg' } },
    );

    await flush(50);
    rerender({ path: '/shoot/2.jpg' });
    await flush(50);
    rerender({ path: '/shoot/3.jpg' });
    expect(readFile).not.toHaveBeenCalled();

    await flush(200);
    expect(readPaths()).toEqual(['/shoot/3.jpg']);
  });

  it('keeps the previous original on screen while the next one is read', async () => {
    manualReads = true;
    const { result, rerender } = renderHook((props: { path: string }) => useFullImage(props.path), {
      initialProps: { path: '/shoot/1.jpg' },
    });

    await flush();
    settle('/shoot/1.jpg');
    await flush();
    expect(result.current.urlPath).toBe('/shoot/1.jpg');

    rerender({ path: '/shoot/2.jpg' });
    await flush();

    // The panel is not blanked: the previous photo holds the frame, and
    // `urlPath` is what tells the caller it is the previous one.
    expect(result.current.url).toBe('blob:original-1');
    expect(result.current.urlPath).toBe('/shoot/1.jpg');
    expect(result.current.isLoading).toBe(true);

    settle('/shoot/2.jpg');
    await flush();
    expect(result.current.url).toBe('blob:original-2');
    expect(result.current.urlPath).toBe('/shoot/2.jpg');
  });

  it('reads the neighbours ahead, but never ahead of the visible image', async () => {
    manualReads = true;
    renderHook(() =>
      useFullImage('/shoot/2.jpg', { neighbours: ['/shoot/1.jpg', '/shoot/3.jpg'] }),
    );

    await flush();
    expect(readPaths()).toEqual(['/shoot/2.jpg']);

    settle('/shoot/2.jpg');
    await flush();
    expect(readPaths().sort()).toEqual(['/shoot/1.jpg', '/shoot/2.jpg', '/shoot/3.jpg']);
  });

  it('serves a prefetched neighbour with no read and no wait', async () => {
    const { result, rerender } = renderHook(
      (props: { path: string; neighbours: string[] }) =>
        useFullImage(props.path, { neighbours: props.neighbours }),
      { initialProps: { path: '/shoot/1.jpg', neighbours: ['/shoot/2.jpg'] } },
    );

    await flush();
    expect(readPaths().sort()).toEqual(['/shoot/1.jpg', '/shoot/2.jpg']);

    rerender({ path: '/shoot/2.jpg', neighbours: ['/shoot/1.jpg'] });

    // Synchronous: no timer advanced, so no debounce was waited on either.
    expect(result.current.urlPath).toBe('/shoot/2.jpg');
    expect(result.current.url).toBe('blob:original-2');
    expect(result.current.isLoading).toBe(false);

    // Both files are accounted for — the one left behind went into the cache
    // rather than being re-read as the new neighbour.
    await flush();
    expect(readFile).toHaveBeenCalledTimes(2);
    expect(doubleRevoked).toEqual([]);
  });

  it('revokes the old folder URLs once focus lands in a new one', async () => {
    const { rerender } = renderHook(
      (props: { path: string; neighbours: string[] }) =>
        useFullImage(props.path, { neighbours: props.neighbours }),
      { initialProps: { path: '/shootA/1.jpg', neighbours: ['/shootA/2.jpg'] } },
    );

    await flush();
    expect(live.size).toBe(2);

    rerender({ path: '/shootB/1.jpg', neighbours: ['/shootB/2.jpg'] });
    await flush();

    expect(created).toBe(4);
    expect(live.size).toBe(2);
    expect(doubleRevoked).toEqual([]);
  });

  it('revokes every URL on unmount, each exactly once', async () => {
    const { unmount } = renderHook(() =>
      useFullImage('/shoot/1.jpg', { neighbours: ['/shoot/2.jpg'] }),
    );

    await flush();
    expect(live.size).toBe(2);

    unmount();
    expect(live.size).toBe(0);
    expect(doubleRevoked).toEqual([]);
  });

  it('drops a read that lands after the folder was closed', async () => {
    manualReads = true;
    const { result, rerender } = renderHook(
      (props: { path: string | null }) => useFullImage(props.path),
      { initialProps: { path: '/shoot/1.jpg' as string | null } },
    );

    await flush();
    rerender({ path: null });
    settle('/shoot/1.jpg');
    await flush();

    expect(result.current.url).toBeNull();
    expect(live.size).toBe(0);
    expect(doubleRevoked).toEqual([]);
  });

  it('clears the frame when an original cannot be read', async () => {
    manualReads = true;
    const { result, rerender } = renderHook((props: { path: string }) => useFullImage(props.path), {
      initialProps: { path: '/shoot/1.jpg' },
    });

    await flush();
    settle('/shoot/1.jpg');
    await flush();

    rerender({ path: '/shoot/2.jpg' });
    await flush();
    fail('/shoot/2.jpg');
    await flush();

    // Leaving the previous photo up would show it under the new filename.
    expect(result.current.url).toBeNull();
    expect(result.current.urlPath).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(live.size).toBe(0);
  });
});
