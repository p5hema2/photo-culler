import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type {
  ImageFileInfo,
  ResultsFile,
  QualitySubscores,
  ScanProgress,
} from '@photo-culler/types';
import { sortImages } from '@photo-culler/image-utils/sorting';
import type { SortDirection } from '@photo-culler/image-utils/sorting';
import type { PhotoGroup } from '@photo-culler/image-utils/grouping';
import { groupByFolder, foldersOf } from '@photo-culler/image-utils/folders';
import type { FolderSection } from '@photo-culler/image-utils/folders';
import { MIN_RATING, clampRating, isInRatingRange } from '@photo-culler/image-utils/rating';
import {
  loadAllResults,
  loadResults,
  saveResults,
  emptyResults,
  projectFolderResults,
  rebuildResults,
} from '../lib/results';
import { useThumbnailWorker } from './useThumbnailWorker';
import { FULL_RATING_RANGE, isFullRatingRange } from '../lib/filters';
import type { RatingRange } from '../lib/filters';
import {
  EMPTY_SELECTION,
  reconcileSelection,
  resolveSelectionClick,
  selectionTargets as computeSelectionTargets,
} from '../lib/selection';
import type { SelectionClickModifier, SelectionState } from '../lib/selection';

/**
 * How far the open folder's scan has got.
 *
 * 'idle' means nothing is outstanding, which is also the state of a build whose
 * preload has no SCAN_PROGRESS channel: the counts stay at zero, the UI shows
 * nothing extra, and the app behaves as it did before the scan was split.
 */
export interface ScanProgressState {
  phase: 'idle' | 'walking' | 'metadata';
  /** Image files the walk has found — the total, once it has finished. */
  found: number;
  /** Images whose metadata has been read, the blocking prefix included. */
  completed: number;
}

const IDLE_SCAN: ScanProgressState = { phase: 'idle', found: 0, completed: 0 };

/** Whether the scan still owes metadata for images already on screen. */
export function isScanIncomplete(progress: ScanProgressState): boolean {
  return progress.phase !== 'idle' && progress.completed < progress.found;
}

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
  /**
   * Progress of the scan, which outlives `isLoading`.
   *
   * `isLoading` covers only the blocking phase now — the walk plus a screenful
   * of EXIF headers — and the remaining headers keep arriving after the grid has
   * painted. Something has to say so on screen, or dates and ratings filling
   * themselves in looks like a bug.
   */
  scanProgress: ScanProgressState;
  focusedImageId: string | null;
  /**
   * The images a batch action acts on. See lib/selection.ts — it is a separate
   * concept from `focusedImageId`, which is the single cursor.
   *
   * A ReadonlySet, always replaced rather than mutated: the grid tests
   * membership once per visible cell, and an immutable Set is still a usable
   * dependency for the memos that hang off it.
   */
  selection: ReadonlySet<string>;
  /** The image a Shift-click ranges from. Null when there is nothing to range from. */
  selectionAnchor: string | null;
  error: string | null;
  qualityScores: Record<string, number>;
  qualitySubscores: Record<string, QualitySubscores>;
  scoringProgress: { completed: number; total: number };
  /**
   * Thumbnail coverage of the open folder: how many of its images have one.
   *
   * Seeded from the on-disk count, because thumbnails are generated lazily per
   * visible cell — a counter starting at zero would claim a half-culled folder
   * had none. It therefore does NOT run to the total on its own: it reaches it
   * only once every image has been scrolled past at least once.
   */
  thumbnailProgress: { completed: number; total: number };
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
  scanProgress: IDLE_SCAN,
  focusedImageId: null,
  selection: EMPTY_SELECTION.selection,
  selectionAnchor: EMPTY_SELECTION.anchor,
  error: null,
  qualityScores: {},
  qualitySubscores: {},
  scoringProgress: { completed: 0, total: 0 },
  thumbnailProgress: { completed: 0, total: 0 },
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

/** Nothing on screen. Shared, so the empty case does not allocate or re-render. */
const EMPTY_PATH_SET: ReadonlySet<string> = new Set<string>();

/**
 * Where the cursor lands when the image under it has been deleted.
 *
 * The next SURVIVOR at or after its old position, falling back to the nearest
 * survivor before it. What a single-image delete used to do — index the shrunken
 * array at the old index — is only correct for one deletion: every further image
 * removed above the cursor shifts that index one photo too far, so deleting a
 * selection of twelve landed eleven images past the one the user was looking at.
 */
function focusAfterRemoval(
  images: readonly ImageFileInfo[],
  focused: string | null,
  removed: ReadonlySet<string>,
): string | null {
  if (focused === null || !removed.has(focused)) return focused;
  const oldIndex = images.findIndex((img) => img.path === focused);
  if (oldIndex === -1) return null;
  for (let i = oldIndex + 1; i < images.length; i += 1) {
    const path = images[i]!.path;
    if (!removed.has(path)) return path;
  }
  for (let i = oldIndex - 1; i >= 0; i -= 1) {
    const path = images[i]!.path;
    if (!removed.has(path)) return path;
  }
  return null;
}

/**
 * Selection fields for an update that takes images away.
 *
 * The one place the rule lives, because every removal path needs it and the two
 * that already existed had drifted apart once: drop what is gone, and land the
 * batch on wherever the cursor ended up rather than leaving it empty.
 */
function selectionAfterRemoval(
  prev: PhotoState,
  removed: ReadonlySet<string>,
  nextFocused: string | null,
): Pick<PhotoState, 'selection' | 'selectionAnchor'> {
  const selection = new Set<string>();
  for (const path of prev.selection) {
    if (!removed.has(path)) selection.add(path);
  }
  if (selection.size === 0 && nextFocused !== null) selection.add(nextFocused);

  const anchor =
    prev.selectionAnchor !== null && !removed.has(prev.selectionAnchor)
      ? prev.selectionAnchor
      : nextFocused;
  return { selection, selectionAnchor: anchor };
}

/**
 * Fold a batch of freshly read metadata into the image list.
 *
 * By absolute path, and only into images that are still there: a batch is read
 * off the disk while the user is already culling, so it can name an image that
 * has been deleted since — and, keyed by path rather than name, it cannot
 * deliver one shoot's EXIF to another shoot's `IMG_001.JPG`.
 *
 * The batch entry wins field by field rather than replacing the object, so a
 * field the renderer has put on an image cannot be dropped by a scan that never
 * knew about it.
 */
function mergeMetadata(images: ImageFileInfo[], batch: readonly ImageFileInfo[]): ImageFileInfo[] {
  if (batch.length === 0) return images;
  const byPath = new Map(batch.map((img) => [img.path, img]));
  return images.map((img) => {
    const fresh = byPath.get(img.path);
    return fresh ? { ...img, ...fresh } : img;
  });
}

/**
 * Ratings from a batch, refusing to overwrite one the user has set since the
 * folder opened.
 *
 * The image file is the authority for a rating, but a rating typed a moment ago
 * is not in the file yet — it is sitting out RATING_WRITE_DEBOUNCE_MS — so a
 * header read that started before it would hand back the old value and silently
 * undo the keypress on screen. `userRated` is what makes the in-memory value win
 * for exactly those images and nothing else.
 *
 * Returns the same object when nothing moved, so an all-unrated batch does not
 * invalidate every memo that hangs off `ratings`.
 */
function mergeRatings(
  ratings: Record<string, number>,
  batch: readonly ImageFileInfo[],
  userRated: ReadonlySet<string>,
): Record<string, number> {
  let next: Record<string, number> | null = null;
  for (const img of batch) {
    if (userRated.has(img.path)) continue;
    const value = img.rating ?? MIN_RATING;
    if (ratings[img.path] === value) continue;
    next ??= { ...ratings };
    next[img.path] = value;
  }
  return next ?? ratings;
}

export interface PhotoStoreAPI {
  state: PhotoState;
  /** Folder sections, each with its own timestamp groups. */
  folders: FolderSection[];
  filteredImages: ImageFileInfo[];
  /**
   * The images a batch action acts on: the selection — or, when nothing is
   * selected, the focused image on its own, and then only while it is on screen.
   * Every caller that rates or deletes must read this rather than the raw
   * selection or `focusedImageId`; it is the one value that cannot name a photo
   * the user is unable to see.
   */
  selectionTargets: string[];
  thumbnailWorker: ReturnType<typeof useThumbnailWorker>;
  openFolder: (folderPath: string) => Promise<void>;
  /** Rate one image, 0-5, where 0 clears the rating. Writes to the file. */
  setRating: (imagePath: string, rating: number) => void;
  /** Rate every image in `selectionTargets`, 0-5. One file write per image. */
  rateSelection: (rating: number) => void;
  setSortDirection: (direction: SortDirection) => void;
  setFilterExtensions: (extensions: Set<string>) => void;
  setFilterRatingRange: (range: RatingRange) => void;
  setSearchQuery: (query: string) => void;
  setThumbnailSize: (size: 'small' | 'medium' | 'large') => void;
  setGroupingThresholdMs: (ms: number) => void;
  /**
   * Move the cursor, collapsing the selection onto it.
   *
   * Every non-click way of moving — arrow keys, the loupe, the filmstrip — goes
   * through here, which is why it collapses: navigating away from a batch ends
   * that batch, and a selection left behind the cursor would be invisible.
   */
  setFocusedImage: (path: string | null) => void;
  /**
   * Apply a click to the selection, and move the cursor onto the clicked image.
   * The modifier decides what the click means — see SelectionClickModifier.
   */
  selectImage: (path: string, modifier: SelectionClickModifier) => void;
  /**
   * Tell the store the flat order the grid is currently rendering, and drop any
   * selected path that is no longer in it.
   *
   * The order is the view's to know, not the store's: it depends on which
   * folders the user has collapsed, which lives in App. One call from there on
   * every change covers the whole list of events that can hide an image —
   * filter, search, sort direction, collapse, rescan, open, delete.
   */
  syncVisibleOrder: (visiblePaths: readonly string[]) => void;
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
  /**
   * Paths whose thumbnail this session generated.
   *
   * A set rather than a counter because a rotation invalidates a thumbnail and
   * the next render regenerates it — counting that as new progress would walk
   * the readout past its own total.
   */
  const generatedThumbsRef = useRef<Set<string>>(new Set());

  const thumbnailWorker = useThumbnailWorker({
    onThumbnailGenerated: (imagePath) => {
      if (generatedThumbsRef.current.has(imagePath)) return;
      generatedThumbsRef.current.add(imagePath);
      setState((prev) => {
        const { completed, total } = prev.thumbnailProgress;
        if (total === 0 || completed >= total) return prev;
        return { ...prev, thumbnailProgress: { completed: completed + 1, total } };
      });
    },
  });
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
  /**
   * Paths the user has rated since the folder opened.
   *
   * Not the same set as `ratingWritesRef`, which empties when the debounce
   * fires: this one has to remember for the whole session, because a header read
   * queued behind 3000 others can land minutes after the write it would undo.
   */
  const userRatedRef = useRef<Set<string>>(new Set());
  /**
   * Metadata batches that arrived before openFolder had put the image list in
   * state.
   *
   * The reply to scanFolder and the batches that follow it travel the same
   * channel in order, but openFolder still awaits the results files between
   * receiving one and setting the other — and a batch landing in that window
   * would have nothing to merge into and be dropped silently, which is a
   * rating and a group boundary quietly missing. Buffered here, folded in by
   * openFolder itself, and reset by it.
   */
  const metadataBufferRef = useRef<ImageFileInfo[]>([]);
  /**
   * The scan whose image list is in state. Until it matches, batches buffer.
   */
  const scanAppliedRef = useRef<number | null>(null);
  /**
   * The flat order the grid is rendering, as absolute paths. Fed by
   * syncVisibleOrder; a Shift-click range is defined over exactly this.
   */
  const visibleOrderRef = useRef<readonly string[]>([]);
  /**
   * The same paths as a membership Set.
   *
   * State and not a ref, unlike its sibling above, because `selectionTargets`
   * reads it: the fallback to the focused image is only allowed while that image
   * is on screen, and a ref would leave the memo answering with the *previous*
   * order — which is precisely the order in which the hidden image was still
   * visible. Costs one extra render per order change; the alternative was a
   * derived flag that every focus mutation would have to remember to mirror.
   */
  const [visiblePathSet, setVisiblePathSet] = useState<ReadonlySet<string>>(EMPTY_PATH_SET);
  /** The current batch, for callbacks that must read it without re-subscribing. */
  const selectionTargetsRef = useRef<string[]>([]);

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
   * Metadata that the scan is still delivering after the grid has painted.
   *
   * Subscribed once for the life of the hook rather than per folder: the
   * `scanId` on every report is the open epoch this store handed to
   * `scanFolder`, so a report from a tree we have left is dropped here without
   * having to unsubscribe in a race with it. That is the same guard, for the
   * same reason, as the epoch on a queued results-file write.
   */
  useEffect(() => {
    if (!window.api.onScanProgress) return;

    window.api.onScanProgress((progress: ScanProgress) => {
      if (progress.scanId !== openEpochRef.current) return;

      // Not yet in state: openFolder is still between the scan reply and its
      // setState. Buffered rather than merged, and deliberately outside the
      // updater below, which has to stay pure.
      const buffer = progress.images.length > 0 && scanAppliedRef.current !== progress.scanId;
      if (buffer) metadataBufferRef.current.push(...progress.images);

      setState((prev) => {
        const scanProgress: ScanProgressState = {
          phase: progress.phase,
          found: progress.found,
          completed: progress.completed,
        };
        if (buffer || progress.images.length === 0) return { ...prev, scanProgress };
        return {
          ...prev,
          scanProgress,
          // One re-sort and one re-group per batch, not per image. Focus,
          // selection and anchor are untouched on purpose: a batch changes
          // where group boundaries fall, and nothing about where the user is.
          images: mergeMetadata(prev.images, progress.images),
          ratings: mergeRatings(prev.ratings, progress.images, userRatedRef.current),
        };
      });
    });

    return () => window.api.removeScanProgressListener?.();
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
      const scanId = openEpochRef.current;
      resultsRef.current = new Map();
      // Nothing is on screen until the scan comes back, so the range a
      // Shift-click could span is empty until App reports the new order — and
      // so is the set that permits the fallback to the focused image.
      visibleOrderRef.current = [];
      setVisiblePathSet(EMPTY_PATH_SET);
      // Both belong to the tree we are leaving: its ratings are gone from state
      // and its buffered batches name images we no longer hold.
      userRatedRef.current = new Set();
      metadataBufferRef.current = [];
      scanAppliedRef.current = null;

      setState((prev) => ({
        ...prev,
        isLoading: true,
        error: null,
        folderPath,
        images: [],
        ratings: {},
        focusedImageId: null,
        selection: EMPTY_SELECTION.selection,
        selectionAnchor: EMPTY_SELECTION.anchor,
        qualityScores: {},
        qualitySubscores: {},
        filterRatingRange: FULL_RATING_RANGE,
        scoringProgress: { completed: 0, total: 0 },
        thumbnailProgress: { completed: 0, total: 0 },
        scanProgress: { phase: 'walking', found: 0, completed: 0 },
      }));

      thumbnailWorker.clearAll();
      generatedThumbsRef.current = new Set();

      try {
        // The root's results file is the one file we can read before the walk,
        // and reading it here overlaps it with the scan instead of adding it to
        // the window the user is waiting on — 2.83 MB, and a serial read of it
        // used to sit after the whole metadata pass. The subfolders' files
        // cannot start early: their paths ARE the walk's output.
        const rootResults = loadResults(folderPath).catch(() => null);

        const scanned = await window.api.scanFolder(folderPath, scanId);

        // One results file per folder in the tree, loaded in parallel.
        const folders = foldersOf(scanned);
        const [root, allResults] = await Promise.all([
          rootResults,
          loadAllResults(folders.filter((folder) => folder !== folderPath)),
        ]);
        if (root) allResults.set(folderPath, root);

        // A second openFolder has overtaken this one — the user picked another
        // folder while this tree was still being walked. Its epoch is the live
        // one now, so everything below, the drained batches included, would be
        // the wrong tree's: bail before touching any of it.
        if (!mountedRef.current || openEpochRef.current !== scanId) return;

        // Batches that overtook the reply above; see metadataBufferRef. From
        // the mark below onwards they merge straight into state, and there is
        // no await between the two, so none can be lost in between.
        const images = mergeMetadata(scanned, metadataBufferRef.current);
        metadataBufferRef.current = [];
        scanAppliedRef.current = scanId;

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
          //
          // Past the blocking prefix the header has not been read yet, so this
          // shows unrated for a few seconds and the image's batch corrects it.
          // Rating one in that window is not lost: mergeRatings lets the value
          // the user typed win over the one the batch brings back.
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

        const first = images.length > 0 ? images[0]!.path : null;
        setState((prev) => ({
          ...prev,
          images,
          ratings,
          qualityScores,
          qualitySubscores,
          rotations,
          isLoading: false,
          focusedImageId: first,
          // The cursor landing on the first image selects it, same as it does
          // when an arrow key moves there.
          selection: first === null ? EMPTY_SELECTION.selection : new Set([first]),
          selectionAnchor: first,
          thumbnailProgress: { completed: 0, total: images.length },
        }));

        // Deliberately NOT awaited. It is one readdir per cache directory, but
        // putting it in front of first paint is the mistake this release just
        // finished undoing — a progress readout must never be the reason the
        // grid waits. The epoch check keeps a slow count from landing in a
        // folder the user has already left.
        const countEpoch = openEpochRef.current;
        void window.api
          .countThumbCache(folderPath)
          .then((onDisk) => {
            if (!mountedRef.current || openEpochRef.current !== countEpoch) return;
            setState((prev) => ({
              ...prev,
              thumbnailProgress: {
                // Clamped: the count is folder-wide while `total` is the images
                // actually scanned, and a filter or an unsupported extension can
                // leave a thumbnail behind whose image is not in the list.
                completed: Math.min(onDisk, prev.thumbnailProgress.total),
                total: prev.thumbnailProgress.total,
              },
            }));
          })
          .catch(() => {
            // A missing count is a missing readout, nothing more.
          });

        // Save session
        window.api.setSession({ lastFolderPath: folderPath });
      } catch {
        if (!mountedRef.current) return;
        setState((prev) => ({
          ...prev,
          isLoading: false,
          // The scan never got as far as reporting, and nothing is outstanding.
          scanProgress: IDLE_SCAN,
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

      // From here on this image's rating is the user's, not the scan's: a
      // metadata batch still in flight read the file before this keypress and
      // must not put the old value back. See mergeRatings.
      userRatedRef.current.add(imagePath);

      setState((prev) => ({ ...prev, ratings: { ...prev.ratings, [imagePath]: value } }));

      const timer = setTimeout(() => {
        ratingWritesRef.current.delete(imagePath);
        void persistRating(imagePath, value, revertTo);
      }, RATING_WRITE_DEBOUNCE_MS);
      ratingWritesRef.current.set(imagePath, { timer, value, revertTo });
    },
    [persistRating],
  );

  const rateSelection = useCallback(
    (rating: number) => {
      // One setRating per image rather than a batch IPC call: each one owns its
      // own debounce and its own rollback, and a batch would have to reinvent
      // both to report which file refused the write.
      for (const path of selectionTargetsRef.current) setRating(path, rating);
    },
    [setRating],
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
    setState((prev) => ({
      ...prev,
      focusedImageId: path,
      // Moving the cursor collapses the batch onto it. Anything else would let a
      // selection the user has navigated away from swallow the next 0-5 key.
      selection: path === null ? EMPTY_SELECTION.selection : new Set([path]),
      selectionAnchor: path,
    }));
  }, []);

  const selectImage = useCallback((path: string, modifier: SelectionClickModifier) => {
    setState((prev) => {
      const next = resolveSelectionClick(
        { selection: prev.selection, anchor: prev.selectionAnchor },
        path,
        modifier,
        visibleOrderRef.current,
      );
      return {
        ...prev,
        // The cursor follows the pointer for every modifier: the click is also
        // how the user says "show me this one".
        focusedImageId: path,
        selection: next.selection,
        selectionAnchor: next.anchor,
      };
    });
  }, []);

  const syncVisibleOrder = useCallback((visiblePaths: readonly string[]) => {
    visibleOrderRef.current = visiblePaths;
    setVisiblePathSet(visiblePaths.length === 0 ? EMPTY_PATH_SET : new Set(visiblePaths));
    setState((prev) => {
      const current: SelectionState = { selection: prev.selection, anchor: prev.selectionAnchor };
      const next = reconcileSelection(current, visiblePaths);
      // Called from an effect on every render where the order changed, so the
      // no-change case has to be a genuine no-op or it loops.
      if (next.selection === prev.selection && next.anchor === prev.selectionAnchor) return prev;
      return { ...prev, selection: next.selection, selectionAnchor: next.anchor };
    });
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
        // Execute can delete the cursor along with everything else it sweeps
        // up — often hundreds of images at once, which is exactly where landing
        // by old index goes wrong. Same helper as deleteImages.
        const nextFocused = focusAfterRemoval(
          prev.images,
          prev.focusedImageId,
          succeededDeletePaths,
        );
        return {
          ...prev,
          images: nextImages,
          ratings: nextRatings,
          focusedImageId: nextFocused,
          ...selectionAfterRemoval(prev, succeededDeletePaths, nextFocused),
        };
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
      const nextFocused = focusAfterRemoval(prev.images, prev.focusedImageId, deletedSet);

      return {
        ...prev,
        images: nextImages,
        ratings: nextRatings,
        focusedImageId: nextFocused,
        ...selectionAfterRemoval(prev, deletedSet, nextFocused),
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

  /**
   * Nothing here touches the selection, deliberately: clean-up removes stale
   * *records* from the results files, never photos, so the visible set — and
   * therefore what may be selected — is exactly as it was.
   */
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

  const selectionTargets = useMemo(
    () =>
      computeSelectionTargets(
        { selection: state.selection, anchor: state.selectionAnchor },
        state.focusedImageId,
        visiblePathSet,
      ),
    [state.selection, state.selectionAnchor, state.focusedImageId, visiblePathSet],
  );
  selectionTargetsRef.current = selectionTargets;

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
    selectionTargets,
    thumbnailWorker,
    openFolder,
    setRating,
    rateSelection,
    setSortDirection,
    setFilterExtensions,
    setFilterRatingRange,
    setSearchQuery,
    setThumbnailSize,
    setGroupingThresholdMs,
    setFocusedImage,
    selectImage,
    syncVisibleOrder,
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
