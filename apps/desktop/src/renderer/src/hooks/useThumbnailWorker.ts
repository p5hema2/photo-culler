import { useRef, useState, useCallback, useEffect } from 'react';
import { THUMB_MIME } from '../lib/thumbnail-geometry';
import type { ThumbnailResponse } from '../workers/thumbnail.worker';

interface PendingRequest {
  id: string;
  url: string;
  size: number;
  groupIndex: number;
}

type ThumbnailStatus = ImageBitmap | 'loading' | 'error';

/**
 * How many decoded thumbnails to keep in memory at once.
 *
 * A 512x341 thumbnail is ~0.7 MB once it is an ImageBitmap (512 * 341 * 4 B),
 * so 700 of them is a ceiling of roughly 470 MB — that is the number being
 * chosen here: keep the decoded cache under half a gigabyte whatever the folder
 * holds. Unbounded, the cache grew with the folder rather than with the screen,
 * because both strips mount every cell: the measured 3470-image shoot decoded
 * and held all 3470, about 2.4 GB for the session.
 *
 * The bound has to stay above a screenful or visible cells thrash — the worst
 * case is the 120px preset on a 4K display, ~32 columns x ~17 rows = ~550 cells
 * — so 700 leaves the virtualizer's overscan on top of that and no more. It is
 * generous because one 512px thumbnail serves all three presets; a per-preset
 * size is what would buy a lower ceiling.
 *
 * Evicting a visible thumbnail is not fatal in any case: the eviction bumps the
 * render version, the cell re-renders as 'loading', keeps the pixels already on
 * its canvas and re-requests — the same path `invalidate` uses.
 */
export const MAX_CACHED_BITMAPS = 700;

/**
 * How many of the worker pool may take background sweep work.
 *
 * The pool is sized by hardwareConcurrency because it was sized for DECODE, but
 * on a spinning disk the real limit is the platter: the measured folder read at
 * ~7 files/s whole-file, and the sweep now reads ~500 kB embedded previews
 * instead of 6.2 MB originals. Two workers is enough to saturate that while
 * leaving the rest of the pool — and most of the bandwidth — for cells the user
 * is looking at and for the InfoPanel's full-file read.
 */
const SWEEP_WORKERS = 2;

/**
 * Cache a decoded thumbnail as the most recent entry, then close and drop
 * least-recently-used bitmaps until the cache is back inside the bound. Map
 * iteration is insertion order, and `getThumbnail` re-inserts on read, so the
 * head of the map is the coldest entry.
 *
 * `'error'` entries are exempt: they hold no pixels, only a key, and keeping
 * them is what stops an unreadable file from being re-read on every scroll
 * pass. They neither count toward the bound nor get evicted by it.
 *
 * Exported for its own tests: the pending and just-stored skips below are not
 * reachable through the hook's API, so nothing else would pin them.
 */
export function storeBitmap(
  cache: Map<string, ImageBitmap | 'error'>,
  pending: Set<string>,
  id: string,
  bitmap: ImageBitmap,
): void {
  // Delete first: `Map.set` on a key that is already present keeps its original
  // position, so an overwrite would inherit the recency of the entry it
  // replaced and could be evicted moments after being handed out.
  cache.delete(id);
  cache.set(id, bitmap);

  let bitmaps = 0;
  for (const value of cache.values()) {
    if (value !== 'error') bitmaps++;
  }

  for (const [key, value] of cache) {
    if (bitmaps <= MAX_CACHED_BITMAPS) return;
    // 'error' holds no pixels. The other two are the entries eviction must
    // never touch: the one just stored — the delete-then-set above already put
    // it at the tail, so this is belt and braces — and one whose read is in
    // flight, which is absent from the cache today and stays correct here if
    // that ever changes.
    if (value === 'error' || key === id || pending.has(key)) continue;
    value.close();
    cache.delete(key);
    bitmaps--;
  }
}

/** MIME by extension, for bytes that are a whole original file. */
const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  tiff: 'image/tiff',
  tif: 'image/tiff',
};

function mimeForFile(id: string): string {
  const ext = id.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? 'image/jpeg';
}

/**
 * Fallback reasons already logged. Module scope on purpose: the point is one
 * line per session, not one per file — a folder of PNGs would otherwise say the
 * same thing 3470 times.
 */
const reportedFallbacks = new Set<string>();

interface DecodeSource {
  buffer: ArrayBuffer;
  mimeType: string;
  /** True for embedded-preview bytes, whose decode may still turn out to fail. */
  fromPreview: boolean;
}

/**
 * Read the bytes one thumbnail is generated from.
 *
 * Prefers the preview the camera embedded: measured on the folder this was
 * written for, 417-544 kB and 11.6 ms of decode against 6.2 MB and 94 ms for the
 * original. The main process decides whether there is a usable one — see
 * `readThumbSource` — and says which it handed back, because the two differ in
 * MIME type and in whether a failed decode is worth retrying.
 *
 * `allowPreview` is false on that retry, and the `window.api` guard mirrors
 * `loadThumbCache`'s: a preload without the channel must still make thumbnails,
 * only the slow way.
 */
async function readDecodeSource(
  id: string,
  minEdge: number,
  allowPreview: boolean,
): Promise<DecodeSource> {
  if (allowPreview && window.api.readThumbSource) {
    const source = await window.api.readThumbSource(id, minEdge);
    if (source.kind === 'mpf-preview') {
      return { buffer: source.buffer, mimeType: 'image/jpeg', fromPreview: true };
    }
    if (!reportedFallbacks.has(source.fallback)) {
      reportedFallbacks.add(source.fallback);
      console.log(`[thumb] generating from whole files (${source.fallback}), first seen on ${id}`);
    }
    return { buffer: source.buffer, mimeType: mimeForFile(id), fromPreview: false };
  }

  return { buffer: await window.api.readFile(id), mimeType: mimeForFile(id), fromPreview: false };
}

interface ThumbnailWorkerAPI {
  requestThumbnail: (id: string, url: string, size: number, groupIndex?: number) => void;
  getThumbnail: (id: string) => ThumbnailStatus;
  updateVisibleRange: (first: number, last: number) => void;
  clearAll: () => void;
  /** Drop a cached thumbnail so the next render re-requests it. */
  invalidate: (id: string) => void;
  /**
   * Generate a thumbnail for every listed image that has none yet, at strictly
   * lower priority than anything on screen. Replaces any previous sweep.
   */
  sweepAll: (paths: readonly string[], size: number) => void;
}

function createWorker(): Worker {
  return new Worker(new URL('../workers/thumbnail.worker.ts', import.meta.url), {
    type: 'module',
  });
}

/**
 * Options for the thumbnail worker pool.
 */
export interface ThumbnailWorkerOptions {
  /**
   * Called with the image path each time a thumbnail is generated and queued for
   * the disk cache. Fires only for a MISS: hits never reach it, because the
   * progress readout seeds from the on-disk count and would otherwise
   * double-count them.
   */
  onThumbnailGenerated?: (imagePath: string) => void;
}

export function useThumbnailWorker(options: ThumbnailWorkerOptions = {}): ThumbnailWorkerAPI {
  // Read through a ref so a caller may pass an inline callback without
  // rebuilding the worker pool on every render.
  const onGeneratedRef = useRef(options.onThumbnailGenerated);
  onGeneratedRef.current = options.onThumbnailGenerated;
  const onThumbnailGenerated = useCallback((imagePath: string) => {
    onGeneratedRef.current?.(imagePath);
  }, []);
  const workersRef = useRef<Worker[]>([]);
  const cacheRef = useRef<Map<string, ImageBitmap | 'error'>>(new Map());
  const pendingRef = useRef<Set<string>>(new Set());
  const queueRef = useRef<PendingRequest[]>([]);
  /**
   * The background sweep: every image in the folder that has no thumbnail yet.
   *
   * A SEPARATE queue rather than entries in the one above, for two reasons.
   * Picking work becomes O(1) — folding 3470 items into the foreground queue
   * would re-sort all of them after every finished thumbnail. And a visible cell
   * can never end up behind the sweep, whatever the sort comparator does.
   *
   * An index rather than shift(), so walking 3470 entries does not copy the
   * array 3470 times.
   */
  const sweepRef = useRef<{ items: PendingRequest[]; next: number }>({ items: [], next: 0 });
  /** Ids currently in flight FOR the sweep, so their bitmaps are not cached. */
  const sweepInFlightRef = useRef<Set<string>>(new Set());
  const busyRef = useRef<Set<number>>(new Set());
  const visibleRangeRef = useRef<{ first: number; last: number }>({ first: 0, last: 10 });
  /**
   * Per-id generation counter. A worker response stamped with an older epoch
   * belongs to a thumbnail we have since invalidated (e.g. by rotating the file)
   * and must not overwrite the fresh one.
   */
  const epochRef = useRef<Map<string, number>>(new Map());
  /**
   * Ids whose bytes in flight are an embedded preview, with the edge they were
   * requested at.
   *
   * MPEntry names a byte range and guarantees nothing about its contents, so the
   * decoder is the last of the preview's validity checks — and a decode it
   * rejects has to cost one re-read of the whole file, not an error cell.
   */
  const previewDecodesRef = useRef<Map<string, number>>(new Map());
  /** Ids whose preview the decoder already rejected once. */
  const fullFileOnlyRef = useRef<Set<string>>(new Set());
  const [, setVersion] = useState(0);

  const dispatchNext = useCallback((workerIndex: number) => {
    const queue = queueRef.current;
    if (queue.length === 0) {
      // Nothing visible is waiting, so take sweep work — but only on the first
      // SWEEP_WORKERS workers. The rest of the pool, and with it most of the
      // disk bandwidth, stays free for cells the user is actually looking at
      // and for the InfoPanel's full-file read. Saturating the platter with
      // work nobody is waiting for is exactly what v1.6.2 removed.
      if (workerIndex < SWEEP_WORKERS) {
        const sweep = sweepRef.current;
        while (sweep.next < sweep.items.length) {
          const candidate = sweep.items[sweep.next++]!;
          if (cacheRef.current.has(candidate.id) || pendingRef.current.has(candidate.id)) continue;
          pendingRef.current.add(candidate.id);
          sweepInFlightRef.current.add(candidate.id);
          busyRef.current.add(workerIndex);
          loadThumbnail(workerIndex, candidate.id, candidate.size);
          return;
        }
      }
      busyRef.current.delete(workerIndex);
      return;
    }

    // Sort queue: visible items first
    const { first, last } = visibleRangeRef.current;
    queue.sort((a, b) => {
      const aVisible = a.groupIndex >= first && a.groupIndex <= last;
      const bVisible = b.groupIndex >= first && b.groupIndex <= last;
      if (aVisible && !bVisible) return -1;
      if (!aVisible && bVisible) return 1;
      return a.groupIndex - b.groupIndex;
    });

    const item = queue.shift()!;
    busyRef.current.add(workerIndex);
    loadThumbnail(workerIndex, item.id, item.size);
  }, []);

  /**
   * Try loading from disk cache first, then fall back to reading source bytes —
   * the embedded preview where there is one — and dispatching to a worker for
   * thumbnail generation.
   */
  const loadThumbnail = useCallback(
    async (workerIndex: number, id: string, size: number) => {
      try {
        // Try disk cache first. Freshness is decided in the main process, so
        // this no longer depends on the caller having registered an mtime —
        // which is why loupe and filmstrip used to skip the cache entirely.
        if (window.api.loadThumbCache) {
          const cached = await window.api.loadThumbCache(id);
          if (cached) {
            // Cache hit — decode the stored container back into a bitmap
            const blob = new Blob([cached], { type: THUMB_MIME });
            const bitmap = await createImageBitmap(blob);
            pendingRef.current.delete(id);
            storeBitmap(cacheRef.current, pendingRef.current, id, bitmap);
            setVersion((v) => v + 1);
            dispatchNext(workerIndex);
            return;
          }
        }

        // Cache miss — read source bytes and send them to a worker.
        const source = await readDecodeSource(id, size, !fullFileOnlyRef.current.has(id));
        const worker = workersRef.current[workerIndex];
        if (worker) {
          const epoch = epochRef.current.get(id) ?? 0;
          if (source.fromPreview) previewDecodesRef.current.set(id, size);
          else previewDecodesRef.current.delete(id);
          const { buffer, mimeType } = source;
          worker.postMessage({ id, buffer, mimeType, size, epoch }, [buffer]);
        }
      } catch {
        // IPC read failed — report error directly
        pendingRef.current.delete(id);
        cacheRef.current.set(id, 'error');
        setVersion((v) => v + 1);
        busyRef.current.delete(workerIndex);
        dispatchNext(workerIndex);
      }
    },
    [dispatchNext],
  );

  const handleWorkerMessage = useCallback(
    (workerIndex: number, event: MessageEvent<ThumbnailResponse>) => {
      const { id, bitmap, thumbBuffer, error, epoch } = event.data;

      // Discard a response for a generation we have already invalidated.
      if (epoch !== undefined && epoch < (epochRef.current.get(id) ?? 0)) {
        if (bitmap) bitmap.close();
        dispatchNext(workerIndex);
        return;
      }

      pendingRef.current.delete(id);
      const previewEdge = previewDecodesRef.current.get(id);
      previewDecodesRef.current.delete(id);

      if (error || !bitmap) {
        // The decoder is the preview's last validity check — MPEntry promises a
        // byte range and nothing about what is in it. Spend one re-read of the
        // whole file before calling the image unreadable, on the same worker,
        // which is still marked busy. Remembering the id keeps the next request
        // for it off the preview path rather than paying for this twice.
        if (previewEdge !== undefined) {
          fullFileOnlyRef.current.add(id);
          pendingRef.current.add(id);
          loadThumbnail(workerIndex, id, previewEdge);
          return;
        }
        cacheRef.current.set(id, 'error');
      } else if (sweepInFlightRef.current.has(id)) {
        // Sweep result: the file on disk is the whole point, the bitmap is a
        // by-product nobody asked to look at. Caching it would let work the user
        // cannot see evict thumbnails they can, and 3470 of them would churn the
        // LRU from end to end. Closed here; a later scroll to this cell is then a
        // 19 kB disk-cache hit.
        sweepInFlightRef.current.delete(id);
        pendingRef.current.delete(id);
        bitmap.close();

        if (thumbBuffer && window.api.saveThumbCache) {
          window.api.saveThumbCache(id, thumbBuffer).catch(() => {
            // Ignore cache save errors
          });
          onThumbnailGenerated?.(id);
        }
        // No setVersion: nothing on screen changed.
        dispatchNext(workerIndex);
        return;
      } else {
        storeBitmap(cacheRef.current, pendingRef.current, id, bitmap);

        // Save to disk cache in the background (fire-and-forget)
        if (thumbBuffer && window.api.saveThumbCache) {
          window.api.saveThumbCache(id, thumbBuffer).catch(() => {
            // Ignore cache save errors
          });
          // Report only a NEWLY generated thumbnail. A cache hit returns above
          // without reaching this branch, and hits are already inside the
          // on-disk count the progress readout starts from — counting them
          // again would run the readout past its own total.
          onThumbnailGenerated?.(id);
        }
      }

      setVersion((v) => v + 1);
      dispatchNext(workerIndex);
    },
    [dispatchNext, loadThumbnail, onThumbnailGenerated],
  );

  const initWorkers = useCallback(() => {
    const count = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
    const workers: Worker[] = [];

    for (let i = 0; i < count; i++) {
      const worker = createWorker();
      const idx = i;
      worker.onmessage = (event) => handleWorkerMessage(idx, event);
      workers.push(worker);
    }

    workersRef.current = workers;
  }, [handleWorkerMessage]);

  // Initialize workers on mount
  useEffect(() => {
    initWorkers();
    return () => {
      for (const worker of workersRef.current) {
        worker.terminate();
      }
      for (const [, value] of cacheRef.current) {
        if (value !== 'error' && typeof (value as ImageBitmap).close === 'function') {
          (value as ImageBitmap).close();
        }
      }
    };
  }, [initWorkers]);

  const requestThumbnail = useCallback(
    (id: string, url: string, size: number, groupIndex: number = 0) => {
      // Already cached or pending. An entry evicted for the memory bound is
      // absent from both, so this guard lets a re-request through rather than
      // stranding the cell on 'loading'.
      if (cacheRef.current.has(id) || pendingRef.current.has(id)) {
        return;
      }

      pendingRef.current.add(id);

      // Find a free worker
      const workers = workersRef.current;
      for (let i = 0; i < workers.length; i++) {
        if (!busyRef.current.has(i)) {
          busyRef.current.add(i);
          loadThumbnail(i, id, size);
          return;
        }
      }

      // All workers busy -- add to queue
      queueRef.current.push({ id, url, size, groupIndex });
    },
    [loadThumbnail],
  );

  const getThumbnail = useCallback((id: string): ThumbnailStatus => {
    const cached = cacheRef.current.get(id);
    if (cached === 'error') return 'error';
    if (cached === undefined) return 'loading';

    // Reading is what makes an entry recent. Delete-then-set moves it to the
    // tail of the map's insertion order, which is the order storeBitmap sweeps.
    // Cells call this on every render, so whatever is on screen stays hot;
    // nothing else in the hook depends on the cache's order.
    cacheRef.current.delete(id);
    cacheRef.current.set(id, cached);
    return cached;
  }, []);

  const updateVisibleRange = useCallback((first: number, last: number) => {
    visibleRangeRef.current = { first, last };
  }, []);

  /**
   * Forget a thumbnail so it is regenerated. Bumping the epoch first means an
   * in-flight worker response for the old bitmap is dropped on arrival.
   */
  const invalidate = useCallback((id: string) => {
    epochRef.current.set(id, (epochRef.current.get(id) ?? 0) + 1);
    const existing = cacheRef.current.get(id);
    if (existing && existing !== 'error') existing.close();
    cacheRef.current.delete(id);
    pendingRef.current.delete(id);
    setVersion((v) => v + 1);
  }, []);

  const clearAll = useCallback(() => {
    // Terminate existing workers
    for (const worker of workersRef.current) {
      worker.terminate();
    }

    // Close all cached ImageBitmaps
    for (const [, value] of cacheRef.current) {
      if (value instanceof ImageBitmap) {
        value.close();
      }
    }

    cacheRef.current.clear();
    pendingRef.current.clear();
    sweepRef.current = { items: [], next: 0 };
    sweepInFlightRef.current.clear();
    queueRef.current = [];
    busyRef.current.clear();
    epochRef.current.clear();
    previewDecodesRef.current.clear();
    fullFileOnlyRef.current.clear();

    // Create fresh workers
    initWorkers();
    setVersion((v) => v + 1);
  }, [initWorkers]);

  /**
   * Queue the whole folder. Idle workers pick these up only once nothing visible
   * is waiting — see dispatchNext — so calling it right after a scan does not
   * delay first paint.
   *
   * Nothing here checks the disk cache: loadThumbnail does that per item, and a
   * hit costs one stat pair plus a 19 kB read. Filtering up front would mean
   * 3470 IPC round trips before the sweep could even start.
   */
  const sweepAll = useCallback(
    (paths: readonly string[], size: number) => {
      sweepRef.current = {
        items: paths.map((id) => ({ id, url: '', size, groupIndex: 0 })),
        next: 0,
      };
      // Wake every idle worker allowed to sweep. Busy ones pick it up when they
      // next call dispatchNext.
      for (let i = 0; i < Math.min(SWEEP_WORKERS, workersRef.current.length); i++) {
        if (!busyRef.current.has(i)) dispatchNext(i);
      }
    },
    [dispatchNext],
  );

  return { requestThumbnail, getThumbnail, updateVisibleRange, clearAll, invalidate, sweepAll };
}
