import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { ImageFileInfo, ResultsFile, QualitySubscores } from '@photo-culler/types';
import { sortImages } from '@photo-culler/image-utils/sorting';
import type { SortDirection } from '@photo-culler/image-utils/sorting';
import type { PhotoGroup } from '@photo-culler/image-utils/grouping';
import { groupByFolder, foldersOf } from '@photo-culler/image-utils/folders';
import type { FolderSection } from '@photo-culler/image-utils/folders';
import { MIN_RATING, clampRating, isInRatingRange } from '@photo-culler/image-utils/rating';
import {
  loadAllResults,
  saveResults,
  emptyResults,
  projectFolderResults,
  rebuildResults,
} from '../lib/results';
import { useThumbnailWorker } from './useThumbnailWorker';
import { FULL_RATING_RANGE, isFullRatingRange } from '../lib/filters';
import type { RatingRange } from '../lib/filters';

export interface PhotoState {
  folderPath: string | null;
  images: ImageFileInfo[];
  /**
   * Star rating per absolute image path, 0 = unrated.
   *
   * A mirror of what the image files hold, not a store of record: it is filled
   * from `ImageFileInfo.rating` at scan time and every change goes straight
   * back to the file. Nothing about it reaches the results file.
   */
  ratings: Record<string, number>;
  sortDirection: SortDirection;
  filterExtensions: Set<string>;
  filterRatingRange: RatingRange;
  searchQuery: string;
  thumbnailSize: 'small' | 'medium' | 'large';
  groupingThresholdMs: number;
  isLoading: boolean;
  focusedImageId: string | null;
  error: string | null;
  qualityScores: Record<string, number>;
  qualitySubscores: Record<string, QualitySubscores>;
  scoringProgress: { completed: number; total: number };
  rotations: Record<string, number>;
}

const initialState: PhotoState = {
  folderPath: null,
  images: [],
  ratings: {},
  sortDirection: 'asc',
  filterExtensions: new Set<string>(),
  filterRatingRange: FULL_RATING_RANGE,
  searchQuery: '',
  thumbnailSize: 'medium',
  groupingThresholdMs: 5000,
  isLoading: false,
  focusedImageId: null,
  error: null,
  qualityScores: {},
  qualitySubscores: {},
  scoringProgress: { completed: 0, total: 0 },
  rotations: {},
};

/** What Execute deletes unless the user widens it: one-star images only. */
export const DEFAULT_DELETE_RANGE: RatingRange = { min: 1, max: 1 };

export interface ExecuteOptions {
  /**
   * The inclusive rating window to delete.
   *
   * `min` is forced to at least 1 before it is used, which is the safety
   * property of the whole feature: an unrated image cannot be deleted, however
   * the panel is configured.
   */
  deleteRange: RatingRange;
  applyRotations: boolean;
}

export interface ExecuteResult {
  deletedCount: number;
  rotatedCount: number;
  failedPaths: Array<{ path: string; error: string }>;
}

/**
 * How long a rating sits in memory before it is written to the file.
 *
 * Hammering 1-3-5 on one image should cost one write, not three: the file is
 * rewritten in place by exiftool, and the last value is the only one that
 * matters.
 */
const RATING_WRITE_DEBOUNCE_MS = 300;

export interface PhotoStoreAPI {
  state: PhotoState;
  /** Folder sections, each with its own timestamp groups. */
  folders: FolderSection[];
  filteredImages: ImageFileInfo[];
  thumbnailWorker: ReturnType<typeof useThumbnailWorker>;
  openFolder: (folderPath: string) => Promise<void>;
  /** Rate one image, 0-5, where 0 clears the rating. Writes to the file. */
  setRating: (imagePath: string, rating: number) => void;
  setSortDirection: (direction: SortDirection) => void;
  setFilterExtensions: (extensions: Set<string>) => void;
  setFilterRatingRange: (range: RatingRange) => void;
  setSearchQuery: (query: string) => void;
  setThumbnailSize: (size: 'small' | 'medium' | 'large') => void;
  setGroupingThresholdMs: (ms: number) => void;
  setFocusedImage: (path: string | null) => void;
  clearError: () => void;
  executeActions: (options: ExecuteOptions) => Promise<ExecuteResult>;
  /** Permanently delete the given images. There is no trash step. */
  deleteImages: (paths: string[]) => Promise<void>;
  setQualityScore: (imagePath: string, score: number, subscores?: QualitySubscores) => void;
  setScoringProgress: (progress: { completed: number; total: number }) => void;
  rotateImage: (imagePath: string, direction: 'cw' | 'ccw') => void;
  cancelPendingSave: () => void;
  /**
   * Drop in-memory records for images that are no longer on disk, mirroring
   * what the main process just removed from the files.
   */
  pruneLoadedResults: () => void;
}

export function usePhotoStore(): PhotoStoreAPI {
  const [state, setState] = useState<PhotoState>(initialState);
  const thumbnailWorker = useThumbnailWorker();
  /**
   * One results file per directory, keyed by absolute directory path. Opening a
   * parent folder pulls in every shoot below it, and each keeps its own
   * `.photo-culler-results.json` beside its photos.
   */
  const resultsRef = useRef<Map<string, ResultsFile>>(new Map());
  /** Folders whose on-disk file no longer matches state. */
  const dirtyFoldersRef = useRef<Set<string>>(new Set());
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const stateRef = useRef(state);
  /**
   * Incremented on every openFolder. A save queued under an older epoch belongs
   * to the tree we have since left and must never be written.
   */
  const openEpochRef = useRef(0);
  const pendingEpochRef = useRef(0);
  /**
   * Rating writes waiting out the debounce, keyed by image path. `value` is the
   * rating to write; `revertTo` is what the file still holds, and so what state
   * has to fall back to if the write fails.
   */
  const ratingWritesRef = useRef<
    Map<string, { timer: ReturnType<typeof setTimeout>; value: number; revertTo: number }>
  >(new Map());

  // Keep stateRef in sync
  stateRef.current = state;

  // Track mounted state
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /**
   * Project current state onto one folder's file and write it.
   *
   * State is keyed by absolute path; the file on disk stays keyed by bare
   * filename, which is only unambiguous because there is one file per folder.
   */
  const writeFolder = useCallback((folderPath: string) => {
    const current = stateRef.current;
    const existing = resultsRef.current.get(folderPath) ?? emptyResults(folderPath);
    const folderImages = current.images.filter((img) => img.folder === folderPath);
    const updated = projectFolderResults(existing, folderPath, folderImages, current);
    resultsRef.current.set(folderPath, updated);
    void saveResults(folderPath, updated);
  }, []);

  /** Write every folder that has pending changes. */
  const writeDirtyFolders = useCallback(() => {
    const dirty = [...dirtyFoldersRef.current];
    dirtyFoldersRef.current.clear();
    for (const folderPath of dirty) writeFolder(folderPath);
  }, [writeFolder]);

  /**
   * Note that a folder changed and schedule a write.
   *
   * Folder-level rather than image-level: a burst of edits in one shoot
   * collapses into a single file write, and edits spread across shoots still
   * each land in the right file.
   */
  const markDirty = useCallback(
    (folderPath: string | undefined) => {
      if (!folderPath) return;
      dirtyFoldersRef.current.add(folderPath);
      pendingEpochRef.current = openEpochRef.current;

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        // The previous tree's scoring worker keeps delivering after a folder
        // switch. Writing its queued save now would target the new tree's files
        // with the old tree's data.
        if (pendingEpochRef.current !== openEpochRef.current) {
          dirtyFoldersRef.current.clear();
          return;
        }
        writeDirtyFolders();
      }, 500);
    },
    [writeDirtyFolders],
  );

  /**
   * Write queued changes immediately instead of waiting out the debounce.
   * Deliberately ignores the epoch: this runs while leaving a tree, to get its
   * last edits to disk before the epoch is retired.
   */
  const flushPendingSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    writeDirtyFolders();
  }, [writeDirtyFolders]);

  /**
   * Drop queued changes without writing them.
   * Rescan deletes the results files on purpose — a pending debounced write
   * would otherwise fire afterwards and restore the data we just discarded.
   */
  const cancelPendingSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    dirtyFoldersRef.current.clear();
  }, []);

  /**
   * Persist one rating to the image file, rolling state back if the write fails.
   *
   * The file is the only place a rating lives, so a star left on screen over a
   * failed write is a rating the user believes they have and does not.
   */
  const persistRating = useCallback(
    async (imagePath: string, value: number, revertTo: number): Promise<void> => {
      let result: { ok: boolean; error?: string };
      try {
        result = await window.api.writeRating(imagePath, value);
      } catch (err) {
        result = { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      if (result.ok || !mountedRef.current) return;

      const name = imagePath.split(/[\\/]/).pop() ?? imagePath;
      setState((prev) => ({
        ...prev,
        // Only roll back while nothing has moved on: a newer rating for the same
        // image is already on its way to the file and owns the value now.
        ratings:
          prev.ratings[imagePath] === value
            ? { ...prev.ratings, [imagePath]: revertTo }
            : prev.ratings,
        error: `Could not save the rating for ${name} -- ${result.error ?? 'unknown error'}`,
      }));
    },
    [],
  );

  /** Fire every queued rating write now, without waiting out the debounce. */
  const flushRatingWrites = useCallback(() => {
    const pending = [...ratingWritesRef.current];
    ratingWritesRef.current.clear();
    for (const [imagePath, entry] of pending) {
      clearTimeout(entry.timer);
      void persistRating(imagePath, entry.value, entry.revertTo);
    }
  }, [persistRating]);

  // Flush save on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  // Flush save on beforeunload
  useEffect(() => {
    const handleBeforeUnload = (): void => {
      // Best-effort — the IPC calls fire but the page may unload first.
      flushRatingWrites();
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        writeDirtyFolders();
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [writeDirtyFolders, flushRatingWrites]);

  const openFolder = useCallback(
    async (folderPath: string) => {
      // Get the outgoing folder's last edits to disk, then retire its epoch so
      // its still-running workers cannot write into the new folder's file.
      // resultsRef is nulled for the duration of the load: state below is reset
      // to empty and only repopulated after two awaited IPC round trips, and a
      // save landing in that window would persist images: {}.
      flushPendingSave();
      openEpochRef.current += 1;
      resultsRef.current = new Map();

      setState((prev) => ({
        ...prev,
        isLoading: true,
        error: null,
        folderPath,
        images: [],
        ratings: {},
        focusedImageId: null,
        qualityScores: {},
        qualitySubscores: {},
        filterRatingRange: FULL_RATING_RANGE,
        scoringProgress: { completed: 0, total: 0 },
      }));

      thumbnailWorker.clearAll();

      try {
        const images = await window.api.scanFolder(folderPath);

        // One results file per folder in the tree, loaded in parallel.
        const folders = foldersOf(images);
        const allResults = await loadAllResults(folders);

        // Keyed by absolute PATH, not filename: with subfolders in play the
        // same basename can occur in several shoots, and name keying would
        // silently merge two different photos.
        const ratings: Record<string, number> = {};
        const qualityScores: Record<string, number> = {};
        const qualitySubscores: Record<string, QualitySubscores> = {};
        const rotations: Record<string, number> = {};

        for (const img of images) {
          // From the file, never from the results file — the scan already read
          // xmp:Rating, and an image rated elsewhere has to show up rated here.
          ratings[img.path] = img.rating ?? MIN_RATING;

          const stored = allResults.get(img.folder)?.images[img.name];
          if (!stored) continue;
          if (stored.qualityScore != null) qualityScores[img.path] = stored.qualityScore;
          if (stored.qualitySubscores) qualitySubscores[img.path] = stored.qualitySubscores;
          if (stored.rotation) rotations[img.path] = stored.rotation;
        }

        // Every folder gets an entry, so a shoot that has never been culled
        // still has somewhere to record into.
        for (const folder of folders) {
          resultsRef.current.set(folder, allResults.get(folder) ?? emptyResults(folder));
        }

        if (!mountedRef.current) return;

        setState((prev) => ({
          ...prev,
          images,
          ratings,
          qualityScores,
          qualitySubscores,
          rotations,
          isLoading: false,
          focusedImageId: images.length > 0 ? images[0]!.path : null,
        }));

        // Save session
        window.api.setSession({ lastFolderPath: folderPath });
      } catch {
        if (!mountedRef.current) return;
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: `Cannot access ${folderPath} -- check permissions`,
        }));
      }
    },
    [thumbnailWorker, flushPendingSave],
  );

  /** Look up which folder an image belongs to, for dirty-marking. */
  const folderOf = useCallback((imagePath: string): string | undefined => {
    return stateRef.current.images.find((img) => img.path === imagePath)?.folder;
  }, []);

  const setRating = useCallback(
    (imagePath: string, rating: number) => {
      const value = clampRating(rating) ?? MIN_RATING;
      const pending = ratingWritesRef.current.get(imagePath);
      // What the file still holds, and so what a failed write must restore: the
      // value from before this burst of keypresses, not the one it replaced.
      const revertTo = pending?.revertTo ?? stateRef.current.ratings[imagePath] ?? MIN_RATING;
      if (pending) clearTimeout(pending.timer);

      setState((prev) => ({ ...prev, ratings: { ...prev.ratings, [imagePath]: value } }));

      const timer = setTimeout(() => {
        ratingWritesRef.current.delete(imagePath);
        void persistRating(imagePath, value, revertTo);
      }, RATING_WRITE_DEBOUNCE_MS);
      ratingWritesRef.current.set(imagePath, { timer, value, revertTo });
    },
    [persistRating],
  );

  const setSortDirection = useCallback((direction: SortDirection) => {
    setState((prev) => ({ ...prev, sortDirection: direction }));
  }, []);

  const setFilterExtensions = useCallback((extensions: Set<string>) => {
    setState((prev) => ({ ...prev, filterExtensions: extensions }));
  }, []);

  const setFilterRatingRange = useCallback((range: RatingRange) => {
    setState((prev) => ({ ...prev, filterRatingRange: range }));
  }, []);

  const setSearchQuery = useCallback((query: string) => {
    setState((prev) => ({ ...prev, searchQuery: query }));
  }, []);

  const setThumbnailSize = useCallback((size: 'small' | 'medium' | 'large') => {
    setState((prev) => ({ ...prev, thumbnailSize: size }));
    window.api.setSession({ thumbnailSize: size });
  }, []);

  const setGroupingThresholdMs = useCallback((ms: number) => {
    setState((prev) => ({ ...prev, groupingThresholdMs: ms }));
    window.api.setSession({ groupingThresholdMs: ms });
  }, []);

  const setFocusedImage = useCallback((path: string | null) => {
    setState((prev) => ({ ...prev, focusedImageId: path }));
  }, []);

  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  const executeActions = useCallback(
    async (options: ExecuteOptions): Promise<ExecuteResult> => {
      const current = stateRef.current;
      if (!current.folderPath) {
        return { deletedCount: 0, rotatedCount: 0, failedPaths: [] };
      }

      const executeResult: ExecuteResult = {
        deletedCount: 0,
        rotatedCount: 0,
        failedPaths: [],
      };

      // Only operate on currently visible (filtered) images
      const visibleImages = filteredImagesRef.current;

      // Apply rotations to files on disk if requested
      if (options.applyRotations) {
        const rotatedFiles = visibleImages
          .filter((img) => (current.rotations[img.path] ?? 0) !== 0)
          .map((img) => ({
            path: img.path,
            folder: img.folder,
            degrees: current.rotations[img.path]!,
          }));

        if (rotatedFiles.length > 0) {
          const rotateResult = await window.api.rotateFiles(
            rotatedFiles.map((f) => ({ path: f.path, degrees: f.degrees })),
          );
          executeResult.failedPaths.push(...rotateResult.failed);
          executeResult.rotatedCount = rotateResult.succeeded.length;

          // Clear rotation state for successfully rotated images
          const rotatedSet = new Set<string>(rotateResult.succeeded);
          setState((prev) => {
            const newRotations = { ...prev.rotations };
            for (const file of rotatedFiles) {
              if (rotatedSet.has(file.path)) {
                delete newRotations[file.path];
              }
            }
            return { ...prev, rotations: newRotations };
          });

          // The projection reads rotations from state, which we just cleared, so
          // marking the affected folders dirty is enough to drop them on disk.
          for (const file of rotatedFiles) {
            if (rotatedSet.has(file.path)) markDirty(file.folder);
          }

          // The file on disk changed, so its cached thumbnail is now wrong.
          // Deliberately after the rotation state is cleared: invalidating first
          // would let the cell redraw the freshly rotated file with the old
          // rotation still applied, double-rotating it.
          for (const filePath of rotatedSet) {
            thumbnailWorkerRef.current.invalidate(filePath);
          }
        }
      }

      // The window always starts at one star, whatever the panel passed: an
      // unrated image must not be deletable, and that is the only thing keeping
      // "select all, execute" from wiping a shoot nobody has rated yet.
      const deleteRange: RatingRange = {
        min: Math.max(1, options.deleteRange.min),
        max: options.deleteRange.max,
      };
      const deletePaths = visibleImages
        .filter((img) => isInRatingRange(current.ratings[img.path], deleteRange))
        .map((img) => img.path);

      if (deletePaths.length > 0) {
        const deleteResult = await window.api.deleteFiles(deletePaths);
        executeResult.deletedCount = deleteResult.succeeded.length;
        executeResult.failedPaths.push(...deleteResult.failed);
      }

      // Collect paths that were successfully processed (not in failedPaths)
      const failedPathSet = new Set(executeResult.failedPaths.map((f) => f.path));
      const succeededDeletePaths = new Set(deletePaths.filter((p) => !failedPathSet.has(p)));

      // Remove succeeded images from state
      setState((prev) => {
        const nextImages = prev.images.filter((img) => !succeededDeletePaths.has(img.path));
        const nextRatings = { ...prev.ratings };
        for (const path of succeededDeletePaths) delete nextRatings[path];
        return { ...prev, images: nextImages, ratings: nextRatings };
      });

      // Cancel any pending debounced save
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }

      // Rewrite each affected folder's file immediately (not debounced).
      const remaining = stateRef.current.images.filter(
        (img) => !succeededDeletePaths.has(img.path),
      );
      const touched = new Set<string>();
      for (const path of succeededDeletePaths) {
        const folder = current.images.find((img) => img.path === path)?.folder;
        if (folder) touched.add(folder);
      }

      for (const folderPath of touched) {
        const existing = resultsRef.current.get(folderPath);
        if (!existing) continue;
        const keepNames = remaining
          .filter((img) => img.folder === folderPath)
          .map((img) => img.name);
        const rebuilt = rebuildResults(existing, keepNames);
        resultsRef.current.set(folderPath, rebuilt);
        await saveResults(folderPath, rebuilt);
      }

      return executeResult;
      // markDirty is referentially stable (writeFolder has no deps), so naming it
      // here does not change this callback's identity.
    },
    [markDirty],
  );

  const deleteImages = useCallback(async (paths: string[]) => {
    if (paths.length === 0) return;

    const result = await window.api.deleteFiles(paths);
    const deletedSet = new Set(result.succeeded);

    if (result.failed.length > 0) {
      const first = result.failed[0]!;
      const name = first.path.split(/[\\/]/).pop() ?? first.path;
      setState((prev) => ({
        ...prev,
        error:
          result.failed.length === 1
            ? `Could not delete ${name} -- ${first.error}`
            : `Could not delete ${result.failed.length} images -- ${first.error}`,
      }));
    }
    if (deletedSet.size === 0) return;

    setState((prev) => {
      const nextImages = prev.images.filter((img) => !deletedSet.has(img.path));
      const nextRatings = { ...prev.ratings };
      for (const path of deletedSet) delete nextRatings[path];

      // Advance focus if the focused image was one of the deleted
      let nextFocused = prev.focusedImageId;
      if (prev.focusedImageId && deletedSet.has(prev.focusedImageId)) {
        const oldIndex = prev.images.findIndex((img) => img.path === prev.focusedImageId);
        const nextImg = nextImages[oldIndex] ?? nextImages[oldIndex - 1] ?? null;
        nextFocused = nextImg?.path ?? null;
      }

      return {
        ...prev,
        images: nextImages,
        ratings: nextRatings,
        focusedImageId: nextFocused,
      };
    });

    // Save results file immediately
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    const current = stateRef.current;
    const remaining = current.images.filter((img) => !deletedSet.has(img.path));
    const touched = new Set<string>();
    for (const img of current.images) {
      if (deletedSet.has(img.path)) touched.add(img.folder);
    }

    for (const folderPath of touched) {
      const existing = resultsRef.current.get(folderPath);
      if (!existing) continue;
      const keepNames = remaining.filter((img) => img.folder === folderPath).map((img) => img.name);
      const rebuilt = rebuildResults(existing, keepNames);
      resultsRef.current.set(folderPath, rebuilt);
      await saveResults(folderPath, rebuilt);
    }
  }, []);

  const pruneLoadedResults = useCallback(() => {
    const current = stateRef.current;
    // The renderer's own folder attribution already matches the main process's
    // rule, so a folder's images are exactly the entries its file may keep.
    const namesByFolder = new Map<string, Set<string>>();
    for (const img of current.images) {
      const set = namesByFolder.get(img.folder);
      if (set) set.add(img.name);
      else namesByFolder.set(img.folder, new Set([img.name]));
    }

    for (const [folderPath, results] of resultsRef.current) {
      const keep = namesByFolder.get(folderPath) ?? new Set<string>();
      const pruned: typeof results.images = {};
      for (const [name, entry] of Object.entries(results.images)) {
        if (keep.has(name)) pruned[name] = entry;
      }
      resultsRef.current.set(folderPath, { ...results, images: pruned });
    }
  }, []);

  const setQualityScore = useCallback(
    (imagePath: string, score: number, subscores?: QualitySubscores) => {
      setState((prev) => ({
        ...prev,
        qualityScores: { ...prev.qualityScores, [imagePath]: score },
        qualitySubscores: subscores
          ? { ...prev.qualitySubscores, [imagePath]: subscores }
          : prev.qualitySubscores,
      }));
      markDirty(folderOf(imagePath));
    },
    [folderOf, markDirty],
  );

  const setScoringProgress = useCallback((progress: { completed: number; total: number }) => {
    setState((prev) => {
      if (
        prev.scoringProgress.completed === progress.completed &&
        prev.scoringProgress.total === progress.total
      ) {
        return prev; // No change — skip re-render
      }
      return { ...prev, scoringProgress: progress };
    });
  }, []);

  const rotateImage = useCallback(
    (imagePath: string, direction: 'cw' | 'ccw') => {
      setState((prev) => {
        const current = prev.rotations[imagePath] ?? 0;
        const delta = direction === 'cw' ? 90 : -90;
        const next = (((current + delta) % 360) + 360) % 360;
        return { ...prev, rotations: { ...prev.rotations, [imagePath]: next } };
      });
      markDirty(folderOf(imagePath));
    },
    [folderOf, markDirty],
  );
  // Derived state
  const filteredImages = useMemo(() => {
    let result = state.images;

    // Extension filter
    if (state.filterExtensions.size > 0) {
      result = result.filter((img) => state.filterExtensions.has(img.extension.toLowerCase()));
    }

    // Rating filter — an inclusive window; the full 0-5 span is no filter at all
    if (!isFullRatingRange(state.filterRatingRange)) {
      result = result.filter((img) =>
        isInRatingRange(state.ratings[img.path], state.filterRatingRange),
      );
    }

    // Search query
    if (state.searchQuery.trim()) {
      const query = state.searchQuery.toLowerCase().trim();
      result = result.filter((img) => img.name.toLowerCase().includes(query));
    }

    return result;
  }, [
    state.images,
    state.filterExtensions,
    state.filterRatingRange,
    state.ratings,
    state.searchQuery,
  ]);

  // Keep a ref to filteredImages for use in callbacks (e.g., executeActions)
  const filteredImagesRef = useRef(filteredImages);
  filteredImagesRef.current = filteredImages;
  const thumbnailWorkerRef = useRef(thumbnailWorker);
  thumbnailWorkerRef.current = thumbnailWorker;

  const sortedImages = useMemo(
    () => sortImages(filteredImages, state.sortDirection),
    [filteredImages, state.sortDirection],
  );

  /**
   * Folder sections, each holding its own timestamp groups.
   *
   * Two levels rather than one: a shoot is the unit the user thinks in, but
   * burst detection is what makes a shoot reviewable, so folders wrap groups
   * instead of replacing them.
   */
  const folders = useMemo(
    () => groupByFolder(sortedImages, state.groupingThresholdMs, state.folderPath ?? ''),
    [sortedImages, state.folderPath, state.groupingThresholdMs],
  );

  const foldersRef = useRef(folders);
  foldersRef.current = folders;

  // Auto-open last folder on mount
  useEffect(() => {
    let cancelled = false;
    const init = async (): Promise<void> => {
      try {
        const session = await window.api.getSession();
        if (cancelled) return;
        if (session.thumbnailSize) {
          setState((prev) => ({
            ...prev,
            thumbnailSize: session.thumbnailSize,
            groupingThresholdMs: session.groupingThresholdMs ?? 5000,
          }));
        }
        // Disabled: always start blank. Kept rather than deleted because this
        // is where restoring would go, and the decision not to is deliberate.
        //
        // The `: boolean` annotation is load-bearing, not decoration. Without
        // it TS infers the literal type `false`, decides the branch cannot run,
        // and stops applying the `&& session.lastFolderPath` narrowing inside
        // it — which is exactly the TS2345 this replaced (`string | undefined`
        // passed to openFolder). Same reason the old `if (false && …)` failed.
        const restoreLastFolder: boolean = false;
        if (restoreLastFolder && session.lastFolderPath) {
          openFolder(session.lastFolderPath);
        }
      } catch {
        // Session not available, ignore
      }
    };
    init();
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    state,
    folders,
    filteredImages,
    thumbnailWorker,
    openFolder,
    setRating,
    setSortDirection,
    setFilterExtensions,
    setFilterRatingRange,
    setSearchQuery,
    setThumbnailSize,
    setGroupingThresholdMs,
    setFocusedImage,
    clearError,
    executeActions,
    deleteImages,
    setQualityScore,
    setScoringProgress,
    rotateImage,
    cancelPendingSave,
    pruneLoadedResults,
  };
}

export type { SortDirection, PhotoGroup };
