import { useRef, useState, useCallback } from 'react';
import type { ScoringResult } from '../workers/scoring.worker';
import type { QualitySubscores } from '@photo-culler/types';

export interface ScoringWorkerAPI {
  scoreAll: (
    files: Array<{ path: string; name: string }>,
    onResult: (filename: string, score: number, subscores: QualitySubscores) => void,
  ) => void;
  isScoring: boolean;
  progress: { completed: number; total: number };
}

export function useScoringWorker(): ScoringWorkerAPI {
  const workerRef = useRef<Worker | null>(null);
  const [isScoring, setIsScoring] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });

  const scoreAll = useCallback(
    (
      files: Array<{ path: string; name: string }>,
      onResult: (filename: string, score: number, subscores: QualitySubscores) => void,
    ) => {
      // Terminate previous worker if re-scoring (folder change)
      if (workerRef.current) {
        workerRef.current.terminate();
      }

      if (files.length === 0) {
        return;
      }

      setIsScoring(true);
      setProgress({ completed: 0, total: files.length });

      const worker = new Worker(
        new URL('../workers/scoring.worker.ts', import.meta.url),
        { type: 'module' },
      );
      workerRef.current = worker;

      let completed = 0;
      let fileIndex = 0;

      const sendNext = async (): Promise<void> => {
        if (fileIndex >= files.length) return;
        const file = files[fileIndex++];
        try {
          const buffer = await window.api.readFile(file.path);
          worker.postMessage({ path: file.path, buffer }, [buffer]);
        } catch {
          // On IPC read error, report neutral score and continue
          onResult(file.name, 50, { sharpness: 50, exposure: 50, contrast: 50, noise: 50 });
          completed++;
          setProgress({ completed, total: files.length });
          if (completed >= files.length) {
            setIsScoring(false);
            worker.terminate();
            workerRef.current = null;
          } else {
            sendNext();
          }
        }
      };

      worker.onmessage = (event: MessageEvent<ScoringResult>) => {
        const data = event.data;
        // Find the filename from the path
        const file = files.find((f) => f.path === data.path);
        if (file) {
          onResult(file.name, data.qualityScore, {
            sharpness: data.sharpness,
            exposure: data.exposure,
            contrast: data.contrast,
            noise: data.noise,
          });
        }

        completed++;
        setProgress({ completed, total: files.length });

        if (completed >= files.length) {
          setIsScoring(false);
          worker.terminate();
          workerRef.current = null;
        } else {
          sendNext();
        }
      };

      worker.onerror = () => {
        setIsScoring(false);
        worker.terminate();
        workerRef.current = null;
      };

      // Concurrency of 2 -- keeps background gentle
      const concurrency = Math.min(files.length, 2);
      for (let i = 0; i < concurrency; i++) {
        sendNext();
      }
    },
    [],
  );

  return { scoreAll, isScoring, progress };
}
