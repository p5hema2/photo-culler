import { useRef, useState, useCallback } from 'react';
import type { ExifResponse } from '../workers/exif.worker';

interface ExifExtractorAPI {
  extractAll: (
    files: Array<{ path: string; url: string }>,
    onResult: (path: string, dateTaken: number | null, width: number | null, height: number | null) => void,
  ) => void;
  isExtracting: boolean;
  progress: { completed: number; total: number };
}

export function useExifExtractor(): ExifExtractorAPI {
  const workerRef = useRef<Worker | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });

  const extractAll = useCallback(
    (
      files: Array<{ path: string; url: string }>,
      onResult: (
        path: string,
        dateTaken: number | null,
        width: number | null,
        height: number | null,
      ) => void,
    ) => {
      // Terminate any existing worker
      if (workerRef.current) {
        workerRef.current.terminate();
      }

      if (files.length === 0) {
        return;
      }

      setIsExtracting(true);
      setProgress({ completed: 0, total: files.length });

      const worker = new Worker(new URL('../workers/exif.worker.ts', import.meta.url), {
        type: 'module',
      });
      workerRef.current = worker;

      let completed = 0;

      worker.onmessage = (event: MessageEvent<ExifResponse>) => {
        const data = event.data;

        if ('done' in data && data.done) {
          setIsExtracting(false);
          worker.terminate();
          workerRef.current = null;
          return;
        }

        if ('path' in data) {
          completed++;
          setProgress({ completed, total: files.length });
          onResult(data.path, data.dateTaken, data.width, data.height);
        }
      };

      worker.onerror = () => {
        setIsExtracting(false);
        worker.terminate();
        workerRef.current = null;
      };

      worker.postMessage({ files });
    },
    [],
  );

  return { extractAll, isExtracting, progress };
}
