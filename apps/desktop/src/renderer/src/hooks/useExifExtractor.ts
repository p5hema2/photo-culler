import { useRef, useState, useCallback } from 'react';
import type { ExifResponse } from '../workers/exif.worker';

interface ExifExtractorAPI {
  extractAll: (
    files: Array<{ path: string }>,
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
      files: Array<{ path: string }>,
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
      let fileIndex = 0;

      // Send files one at a time: read via IPC, send buffer to worker
      const sendNext = async (): Promise<void> => {
        if (fileIndex >= files.length) return;
        const file = files[fileIndex++];
        try {
          const buffer = await window.api.readFile(file.path);
          worker.postMessage({ file: { path: file.path, buffer } }, [buffer]);
        } catch {
          // File read failed, report null values
          onResult(file.path, null, null, null);
          completed++;
          setProgress({ completed, total: files.length });
          if (completed >= files.length) {
            setIsExtracting(false);
            worker.terminate();
            workerRef.current = null;
          } else {
            sendNext();
          }
        }
      };

      worker.onmessage = (event: MessageEvent<ExifResponse>) => {
        const data = event.data;

        if ('path' in data) {
          completed++;
          setProgress({ completed, total: files.length });
          onResult(data.path, data.dateTaken, data.width, data.height);

          if (completed >= files.length) {
            setIsExtracting(false);
            worker.terminate();
            workerRef.current = null;
          } else {
            // Send next file
            sendNext();
          }
        }
      };

      worker.onerror = () => {
        setIsExtracting(false);
        worker.terminate();
        workerRef.current = null;
      };

      // Start processing — send first few files in parallel
      const concurrency = Math.min(files.length, 4);
      for (let i = 0; i < concurrency; i++) {
        sendNext();
      }
    },
    [],
  );

  return { extractAll, isExtracting, progress };
}
