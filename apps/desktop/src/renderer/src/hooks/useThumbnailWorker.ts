import { useRef, useState, useCallback, useEffect } from 'react';
import type { ThumbnailResponse } from '../workers/thumbnail.worker';

interface PendingRequest {
  id: string;
  url: string;
  size: number;
  groupIndex: number;
}

type ThumbnailStatus = ImageBitmap | 'loading' | 'error';

interface ThumbnailWorkerAPI {
  requestThumbnail: (id: string, url: string, size: number, groupIndex?: number) => void;
  getThumbnail: (id: string) => ThumbnailStatus;
  updateVisibleRange: (first: number, last: number) => void;
  clearAll: () => void;
}

function createWorker(): Worker {
  return new Worker(new URL('../workers/thumbnail.worker.ts', import.meta.url), {
    type: 'module',
  });
}

export function useThumbnailWorker(): ThumbnailWorkerAPI {
  const workersRef = useRef<Worker[]>([]);
  const cacheRef = useRef<Map<string, ImageBitmap | 'error'>>(new Map());
  const pendingRef = useRef<Set<string>>(new Set());
  const queueRef = useRef<PendingRequest[]>([]);
  const busyRef = useRef<Set<number>>(new Set());
  const visibleRangeRef = useRef<{ first: number; last: number }>({ first: 0, last: 10 });
  const [, setVersion] = useState(0);

  const dispatchNext = useCallback((workerIndex: number) => {
    const queue = queueRef.current;
    if (queue.length === 0) {
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
    fetchAndSendToWorker(workerIndex, item.id, item.url, item.size);
  }, []);

  /**
   * Read image file via IPC (main process has direct filesystem access),
   * then transfer the ArrayBuffer to the worker for heavy processing.
   * This bypasses all app:// protocol and CORS issues.
   */
  const fetchAndSendToWorker = useCallback(
    async (workerIndex: number, id: string, _url: string, size: number) => {
      try {
        // Read file via IPC — main process reads from disk, returns ArrayBuffer
        const buffer = await window.api.readFile(id); // id is the file path
        const ext = id.split('.').pop()?.toLowerCase() ?? '';
        const mimeMap: Record<string, string> = {
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          png: 'image/png',
          webp: 'image/webp',
          tiff: 'image/tiff',
          tif: 'image/tiff',
        };
        const mimeType = mimeMap[ext] ?? 'image/jpeg';
        const worker = workersRef.current[workerIndex];
        if (worker) {
          worker.postMessage({ id, buffer, mimeType, size }, [buffer]);
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
      const { id, bitmap, error } = event.data;
      pendingRef.current.delete(id);

      if (error || !bitmap) {
        cacheRef.current.set(id, 'error');
      } else {
        cacheRef.current.set(id, bitmap);
      }

      setVersion((v) => v + 1);
      dispatchNext(workerIndex);
    },
    [dispatchNext],
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
      // Already cached or pending
      if (cacheRef.current.has(id) || pendingRef.current.has(id)) {
        return;
      }

      pendingRef.current.add(id);

      // Find a free worker
      const workers = workersRef.current;
      for (let i = 0; i < workers.length; i++) {
        if (!busyRef.current.has(i)) {
          busyRef.current.add(i);
          fetchAndSendToWorker(i, id, url, size);
          return;
        }
      }

      // All workers busy -- add to queue
      queueRef.current.push({ id, url, size, groupIndex });
    },
    [fetchAndSendToWorker],
  );

  const getThumbnail = useCallback((id: string): ThumbnailStatus => {
    const cached = cacheRef.current.get(id);
    if (cached === 'error') return 'error';
    if (cached !== undefined) return cached as ImageBitmap;
    return 'loading';
  }, []);

  const updateVisibleRange = useCallback((first: number, last: number) => {
    visibleRangeRef.current = { first, last };
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
    queueRef.current = [];
    busyRef.current.clear();

    // Create fresh workers
    initWorkers();
    setVersion((v) => v + 1);
  }, [initWorkers]);

  return { requestThumbnail, getThumbnail, updateVisibleRange, clearAll };
}
