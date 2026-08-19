import { useEffect, useRef, useCallback } from 'react';
import type { ImageResult, ResultsFile } from '@photo-culler/types';

/**
 * Rebuild the results map, keeping only `keepNames` and carrying every
 * per-image field forward.
 *
 * This exists because the projection used to be hand-rolled in two places that
 * drifted: the copy in `trashImages` listed four of the six fields, so a single
 * Delete keypress silently stripped `qualitySubscores` and `rotation` from every
 * remaining image in the folder. Spreading the existing entry means a field
 * added to `ImageResult` later cannot be dropped here by omission.
 */
export function rebuildResults(
  results: ResultsFile,
  keepNames: Iterable<string>,
  classifications: Record<string, ImageResult['classification'] | undefined>,
): ResultsFile {
  const images: Record<string, ImageResult> = {};

  for (const name of keepNames) {
    const existing = results.images[name];
    images[name] = {
      ...existing,
      classification: classifications[name] ?? existing?.classification ?? null,
      userOverride: existing?.userOverride ?? false,
    };
  }

  return { ...results, images };
}

/**
 * Load results file from disk via IPC.
 * Returns null if no results file exists or if the file is invalid.
 */
export async function loadResults(folderPath: string): Promise<ResultsFile | null> {
  const raw = await window.api.loadResults(folderPath);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as ResultsFile;
    if (parsed.version !== 1 || typeof parsed.folderPath !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Save results file to disk via IPC.
 * Updates the timestamp before saving.
 */
export async function saveResults(folderPath: string, results: ResultsFile): Promise<void> {
  const updated: ResultsFile = {
    ...results,
    updatedAt: new Date().toISOString(),
  };
  await window.api.saveResults(folderPath, JSON.stringify(updated, null, 2));
}

/**
 * Hook that debounces auto-saving of results to disk.
 * Saves after `delayMs` of inactivity. Flushes on unmount.
 */
export function useDebouncedSave(
  folderPath: string | null,
  results: ResultsFile | null,
  delayMs: number = 500,
): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestResultsRef = useRef<ResultsFile | null>(results);
  const folderRef = useRef<string | null>(folderPath);
  const hasPendingRef = useRef(false);

  latestResultsRef.current = results;
  folderRef.current = folderPath;

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (hasPendingRef.current && folderRef.current && latestResultsRef.current) {
      hasPendingRef.current = false;
      saveResults(folderRef.current, latestResultsRef.current);
    }
  }, []);

  useEffect(() => {
    if (!folderPath || !results) return;

    hasPendingRef.current = true;

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (folderRef.current && latestResultsRef.current) {
        hasPendingRef.current = false;
        saveResults(folderRef.current, latestResultsRef.current);
      }
    }, delayMs);
  }, [folderPath, results, delayMs]);

  // Flush on unmount
  useEffect(() => {
    return () => {
      flush();
    };
  }, [flush]);
}

/**
 * Combined results hook for convenience.
 */
export function useResults() {
  return { loadResults, saveResults, useDebouncedSave };
}
