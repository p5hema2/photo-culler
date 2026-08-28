import { useEffect, useRef, useCallback } from 'react';
import type { ImageFileInfo, ImageResult, ResultsFile } from '@photo-culler/types';

/**
 * Results files are per DIRECTORY, one `.photo-culler-results.json` beside the
 * photos it describes, keyed by bare filename.
 *
 * That on-disk shape is unchanged from when the app could only open a single
 * folder, so every existing file keeps working. What changed is that the app
 * now holds several of them at once, because opening a parent folder pulls in
 * every shoot below it.
 *
 * In memory the app keys by ABSOLUTE PATH instead: with subfolders in play,
 * `IMG_001.JPG` is no longer unique, and basename keying would silently merge
 * two different photos.
 */

/**
 * Load results file from disk via IPC.
 * Returns null if no results file exists or if the file is invalid.
 */
export async function loadResults(folderPath: string): Promise<ResultsFile | null> {
  const raw = await window.api.loadResults(folderPath);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as ResultsFile;
    // Deliberately a lower bound, not an equality check: bumping the version
    // used to make loadResults return null, whereupon openFolder treated the
    // folder as unculled and overwrote the file.
    if (typeof parsed.version !== 'number' || parsed.version < 1) return null;
    if (typeof parsed.folderPath !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Load every folder's results in parallel. Missing files simply do not appear. */
export async function loadAllResults(
  folderPaths: readonly string[],
): Promise<Map<string, ResultsFile>> {
  const entries = await Promise.all(
    folderPaths.map(async (folderPath): Promise<[string, ResultsFile | null]> => {
      try {
        return [folderPath, await loadResults(folderPath)];
      } catch {
        return [folderPath, null];
      }
    }),
  );

  const map = new Map<string, ResultsFile>();
  for (const [folderPath, results] of entries) {
    if (results) map.set(folderPath, results);
  }
  return map;
}

/** An empty results file for a folder that has never been culled. */
export function emptyResults(folderPath: string): ResultsFile {
  return {
    version: 1,
    folderPath,
    updatedAt: new Date().toISOString(),
    images: {},
  };
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
 * Rebuild the results map, keeping only `keepNames` and carrying every
 * per-image field forward.
 *
 * This exists because the projection used to be hand-rolled in two places that
 * drifted: the copy in the delete path listed four of the six fields, so a
 * single Delete keypress silently stripped `qualitySubscores` and the rotation
 * from every remaining image in the folder. Spreading the existing entry means a
 * field added to `ImageResult` later cannot be dropped here by omission.
 */
export function rebuildResults(results: ResultsFile, keepNames: Iterable<string>): ResultsFile {
  const images: Record<string, ImageResult> = {};

  for (const name of keepNames) {
    const existing = results.images[name];
    if (existing) images[name] = { ...existing };
  }

  return { ...results, images };
}

/** Path-keyed slices of renderer state, as they are held in the photo store. */
export interface ResultsProjection {
  qualityScores: Record<string, number | undefined>;
  qualitySubscores: Record<string, ImageResult['qualitySubscores']>;
}

/**
 * Project path-keyed renderer state onto one folder's basename-keyed file.
 *
 * Entries already on disk are preserved even when the image is not in `images`
 * — a filter narrowing the view must never erase somebody's scores.
 *
 * Ratings are absent on purpose: they live in the image files themselves, and so
 * does the rotation — it is the file's EXIF Orientation tag now, which leaves
 * `qualityScore` and `qualitySubscores` as the whole of what this file holds.
 */
export function projectFolderResults(
  existing: ResultsFile,
  folderPath: string,
  images: readonly ImageFileInfo[],
  state: ResultsProjection,
): ResultsFile {
  const next: Record<string, ImageResult> = { ...existing.images };

  for (const image of images) {
    const prior = existing.images[image.name];
    next[image.name] = {
      ...prior,
      qualityScore: state.qualityScores[image.path] ?? prior?.qualityScore,
      qualitySubscores: state.qualitySubscores[image.path] ?? prior?.qualitySubscores,
      // No `rotation` field: a rotation is a change to the image's own EXIF
      // Orientation tag, applied on the keypress, so there is nothing pending
      // for this file to remember. (It used to need a comment three times this
      // length explaining why absence in state had to mean "cleared" rather
      // than "look it up on disk" — that whole class of bug is now unreachable.)
    };
  }

  return { ...existing, folderPath, images: next };
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
