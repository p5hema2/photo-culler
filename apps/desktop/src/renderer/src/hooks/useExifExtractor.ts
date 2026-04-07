import { useRef, useState, useCallback } from 'react';
import type { ExifResponse, ExifResult } from '../workers/exif.worker';

/** Partial image metadata returned by EXIF extraction */
export type ExifMetadata = Omit<ExifResult, 'path'>;

interface ExifExtractorAPI {
  extractAll: (
    files: Array<{ path: string }>,
    onResult: (path: string, metadata: ExifMetadata) => void,
  ) => void;
  isExtracting: boolean;
  progress: { completed: number; total: number };
}

const NULL_METADATA: ExifMetadata = {
  dateTaken: null,
  dateTakenLocal: null,
  timezoneOffset: null,
  width: null,
  height: null,
  cameraMake: null,
  cameraModel: null,
  lensModel: null,
  focalLength: null,
  aperture: null,
  shutterSpeed: null,
  iso: null,
  exposureCompensation: null,
  flash: null,
  whiteBalance: null,
  meteringMode: null,
  exposureProgram: null,
  colorSpace: null,
};

export function useExifExtractor(): ExifExtractorAPI {
  const workerRef = useRef<Worker | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });

  const extractAll = useCallback(
    (files: Array<{ path: string }>, onResult: (path: string, metadata: ExifMetadata) => void) => {
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

      const sendNext = async (): Promise<void> => {
        if (fileIndex >= files.length) return;
        const file = files[fileIndex++];
        try {
          const buffer = await window.api.readFile(file.path);
          worker.postMessage({ file: { path: file.path, buffer } }, [buffer]);
        } catch {
          onResult(file.path, NULL_METADATA);
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
          const { path, ...metadata } = data;
          onResult(path, metadata);

          if (completed >= files.length) {
            setIsExtracting(false);
            worker.terminate();
            workerRef.current = null;
          } else {
            sendNext();
          }
        }
      };

      worker.onerror = () => {
        setIsExtracting(false);
        worker.terminate();
        workerRef.current = null;
      };

      const concurrency = Math.min(files.length, 4);
      for (let i = 0; i < concurrency; i++) {
        sendNext();
      }
    },
    [],
  );

  return { extractAll, isExtracting, progress };
}
