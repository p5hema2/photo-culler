import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePhotoStore, isScanIncomplete } from '../hooks/usePhotoStore';
import type { ImageFileInfo, ScanProgress } from '@photo-culler/types';

/**
 * The half of the scan that arrives after the grid has painted.
 *
 * `scanFolder` blocks only on the tree walk plus a screenful of EXIF headers;
 * the rest of the headers are pushed over SCAN_PROGRESS and merged here. Three
 * things about that merge are load-bearing and all three fail silently — a
 * rating quietly reverting, a date never arriving, a batch merged into the wrong
 * tree — so they are pinned rather than eyeballed.
 */

class FakeWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event?: unknown) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
}

const NAMES = ['1.jpg', '2.jpg', '3.jpg', '4.jpg'];

function img(name: string, extra: Partial<ImageFileInfo> = {}): ImageFileInfo {
  return {
    name,
    path: `/A/${name}`,
    folder: '/A',
    extension: 'jpg',
    size: 100,
    lastModified: 1,
    ...extra,
  };
}

/** The blocking prefix: the first two images come back with their metadata. */
const SCANNED = [
  img('1.jpg', { dateTaken: 1000, rating: 1 }),
  img('2.jpg', { dateTaken: 2000, rating: 0 }),
  img('3.jpg'),
  img('4.jpg'),
];

let listener: ((progress: ScanProgress) => void) | null;
let loadResults: ReturnType<typeof vi.fn>;
let scanFolder: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  listener = null;
  loadResults = vi.fn(async () => null);
  scanFolder = vi.fn(async () => SCANNED.map((i) => ({ ...i })));
  (globalThis as unknown as { Worker: unknown }).Worker = FakeWorker;
  (globalThis as unknown as { window: { api: unknown } }).window.api = {
    scanFolder,
    loadResults,
    saveResults: vi.fn(async () => undefined),
    getSession: vi.fn(async () => ({})),
    setSession: vi.fn(async () => undefined),
    loadThumbCache: vi.fn(async () => null),
    saveThumbCache: vi.fn(async () => undefined),
    readFile: vi.fn(async () => new ArrayBuffer(8)),
    writeRating: vi.fn(async () => ({ ok: true })),
    deleteFiles: vi.fn(async (paths: string[]) => ({ succeeded: paths, failed: [] })),
    getAppVersion: vi.fn(async () => '1.6.1'),
    onScanProgress: vi.fn((l: (progress: ScanProgress) => void) => {
      listener = l;
    }),
    removeScanProgressListener: vi.fn(() => {
      listener = null;
    }),
  };
});

afterEach(() => {
  vi.useRealTimers();
});

/** The scanId the store handed to main — its open epoch, not a literal. */
function scanId(): number {
  return scanFolder.mock.calls[0]![1] as number;
}

type Report = Partial<ScanProgress> & Pick<ScanProgress, 'scanId'>;

async function emit(report: Report): Promise<void> {
  await act(async () => {
    listener?.({
      phase: 'metadata',
      found: SCANNED.length,
      completed: SCANNED.length,
      images: [],
      ...report,
    });
  });
}

async function open() {
  const { result } = renderHook(() => usePhotoStore());
  await act(async () => {
    await result.current.openFolder('/A');
  });
  return result;
}

const dateOf = (state: { images: ImageFileInfo[] }, name: string): number | undefined =>
  state.images.find((i) => i.name === name)?.dateTaken;

describe('metadata arriving after the grid has painted', () => {
  it('subscribes once, and asks main to stamp reports with its own epoch', async () => {
    const result = await open();

    expect(listener).not.toBeNull();
    expect(scanFolder).toHaveBeenCalledWith('/A', expect.any(Number));
    // Nothing past the prefix has a date yet — that is the whole premise.
    expect(dateOf(result.current.state, '3.jpg')).toBeUndefined();
  });

  it('fills in dates and ratings from a batch', async () => {
    const result = await open();

    await emit({
      scanId: scanId(),
      completed: 4,
      images: [img('3.jpg', { dateTaken: 3000, rating: 4 })],
    });

    expect(dateOf(result.current.state, '3.jpg')).toBe(3000);
    expect(result.current.state.ratings['/A/3.jpg']).toBe(4);
    // Untouched by a batch that does not name them.
    expect(dateOf(result.current.state, '1.jpg')).toBe(1000);
    expect(dateOf(result.current.state, '4.jpg')).toBeUndefined();
  });

  it('does not move the cursor, the selection or the anchor', async () => {
    const result = await open();
    await act(async () => {
      result.current.syncVisibleOrder(NAMES.map((n) => `/A/${n}`));
    });
    await act(async () => {
      result.current.setFocusedImage('/A/3.jpg');
    });

    await emit({
      scanId: scanId(),
      completed: 4,
      // A date that puts 3.jpg in a different timestamp group re-flows the rows;
      // where the user is looking is not the scan's business.
      images: [img('3.jpg', { dateTaken: 9_000_000 })],
    });

    expect(result.current.state.focusedImageId).toBe('/A/3.jpg');
    expect(result.current.state.selectionAnchor).toBe('/A/3.jpg');
    expect([...result.current.state.selection]).toEqual(['/A/3.jpg']);
  });

  it('lets a rating the user set beat the one the batch read', async () => {
    const result = await open();

    act(() => {
      result.current.setRating('/A/3.jpg', 5);
    });
    // The header read started before that keypress, so it still carries the old
    // value — and the write it would undo is still sitting out its debounce.
    await emit({
      scanId: scanId(),
      completed: 4,
      images: [img('3.jpg', { dateTaken: 3000, rating: 2 }), img('4.jpg', { rating: 3 })],
    });

    expect(result.current.state.ratings['/A/3.jpg']).toBe(5);
    // The date still lands: only the rating is contested.
    expect(dateOf(result.current.state, '3.jpg')).toBe(3000);
    // An image the user did not touch takes the file's value, which is the
    // reason the pass exists.
    expect(result.current.state.ratings['/A/4.jpg']).toBe(3);
  });

  it('ignores a report from a scan it has left, counter included', async () => {
    const result = await open();
    await emit({ scanId: scanId(), phase: 'metadata', found: 4, completed: 2, images: [] });
    const before = result.current.state.scanProgress;

    await emit({
      scanId: scanId() + 1,
      found: 999,
      completed: 111,
      images: [img('3.jpg', { dateTaken: 3000, rating: 4 })],
    });

    expect(dateOf(result.current.state, '3.jpg')).toBeUndefined();
    expect(result.current.state.ratings['/A/3.jpg']).toBe(0);
    // The counter is the part a stale report reaches even when its images are
    // buffered rather than merged, so it is what pins the epoch guard.
    expect(result.current.state.scanProgress).toEqual(before);
  });

  it('reports progress, and stops reporting it when the counts meet', async () => {
    const result = await open();

    await emit({ scanId: scanId(), phase: 'metadata', found: 4, completed: 2, images: [] });
    expect(result.current.state.scanProgress).toEqual({
      phase: 'metadata',
      found: 4,
      completed: 2,
    });
    expect(isScanIncomplete(result.current.state.scanProgress)).toBe(true);

    await emit({ scanId: scanId(), phase: 'metadata', found: 4, completed: 4, images: [] });
    expect(isScanIncomplete(result.current.state.scanProgress)).toBe(false);
  });

  it('keeps a batch that overtakes the scan reply', async () => {
    // openFolder awaits the results files between receiving the image list and
    // putting it in state. A batch landing in that window has nothing to merge
    // into; it must be buffered, not dropped.
    let releaseResults: (() => void) | null = null;
    loadResults.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseResults = () => resolve(null);
        }),
    );

    const { result } = renderHook(() => usePhotoStore());
    let opened: Promise<void> | null = null;
    await act(async () => {
      opened = result.current.openFolder('/A');
      // Let the scan reply land, so openFolder is parked on the results read.
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(releaseResults).not.toBeNull();
    expect(result.current.state.images).toHaveLength(0);

    await emit({
      scanId: scanId(),
      completed: 4,
      images: [img('3.jpg', { dateTaken: 3000, rating: 4 })],
    });

    await act(async () => {
      releaseResults!();
      await opened;
    });

    expect(result.current.state.images).toHaveLength(4);
    expect(dateOf(result.current.state, '3.jpg')).toBe(3000);
    expect(result.current.state.ratings['/A/3.jpg']).toBe(4);
  });
});
