import { useRef, useState, useCallback } from 'react';
import type { ScoringResult } from '../workers/scoring.worker';
import type { QualitySubscores } from '@photo-culler/types';

export interface ScoringWorkerAPI {
  scoreAll: (
    files: Array<{ path: string; name: string }>,
    onResult: (imagePath: string, score: number, subscores: QualitySubscores) => void,
  ) => void;
  /** Stop an in-progress run. Required on folder change — see cancel(). */
  cancel: () => void;
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
      onResult: (imagePath: string, score: number, subscores: QualitySubscores) => void,
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

      const worker = new Worker(new URL('../workers/scoring.worker.ts', import.meta.url), {
        type: 'module',
      });
      workerRef.current = worker;

      let completed = 0;
      let fileIndex = 0;

      const sendNext = async (): Promise<void> => {
        if (fileIndex >= files.length) return;
        const file = files[fileIndex++]!;
        try {
          const buffer = await window.api.readFile(file.path);
          worker.postMessage({ path: file.path, buffer }, [buffer]);
        } catch {
          // A read failure means the score is UNKNOWN, so deliberately report
          // nothing. Reporting a placeholder would now be persisted, and
          // App.tsx skips any image that already has a score — so a transient
          // lock (antivirus, network drive, another app) would permanently
          // prevent that image from ever being scored. Leaving it unscored
          // lets the next open retry it.
          console.warn(`[scoring] could not read ${file.name} — left unscored for retry`);
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
          onResult(file.path, data.qualityScore, {
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

  /**
   * Terminate any run in progress.
   *
   * scoreAll only terminates the *previous* worker when a new run starts, and
   * App.tsx returns early when a folder needs no scoring. Without this, opening
   * an already-analyzed folder left the old folder's worker delivering results
   * that were then attributed to — and persisted into — the new folder.
   */
  const cancel = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    setIsScoring(false);
    setProgress({ completed: 0, total: 0 });
  }, []);

  return { scoreAll, cancel, isScoring, progress };
}
