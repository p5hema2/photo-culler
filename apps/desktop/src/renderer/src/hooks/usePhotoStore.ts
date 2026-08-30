import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type {
  ImageFileInfo,
  PruneResult,
  RenameExecuteResult,
  RenamePlan,
  RenamePlanResult,
  RenameRequest,
  ResultsFile,
  QualitySubscores,
  RotateDirection,
  RotateResult,
  ScanProgress,
} from '@photo-culler/types';
import { sortImages } from '@photo-culler/image-utils/sorting';
import type { SortDirection } from '@photo-culler/image-utils/sorting';
import type { PhotoGroup } from '@photo-culler/image-utils/grouping';
import { groupByFolder, foldersOf } from '@photo-culler/image-utils/folders';
import { buildFolderTree, rollUpCounts } from '@photo-culler/image-utils/tree';
import type { FolderCounts, FolderNode, FolderOwnCounts } from '@photo-culler/image-utils/tree';
import { isPlayableVideo, isVideoFile } from '@photo-culler/image-utils/media';
import type { FolderSection } from '@photo-culler/image-utils/folders';
import { MIN_RATING, clampRating, isInRatingRange } from '@photo-culler/image-utils/rating';
import { THUMB_MAX_EDGE } from '../lib/thumbnail-geometry';
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
   * Cached thumbnails found on disk per directory, as they were when the folder
   * opened.
   *
   * The floor each folder header's counter starts from. Thumbnails are made
   * lazily, per visible cell, so a counter starting at zero would claim a
   * half-culled shoot had none — and since 1.8.1 that claim would be made once
   * per folder rather than once per scan.
   */
  thumbsOnDisk: Record<string, number>;
  /**
   * Every directory the last walk entered, the root included.
   *
   * Held apart from `images` because it is not derivable from them: an empty
   * folder has no image to point at it, and the tree still has to show it.
   * Purely structural — nothing here says anything about a file.
   */
  directories: string[];
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
  /**
   * A one-line note for the toolbar — what the last Rescan did — or null.
   *
   * It sits beside `scoringProgress` and `thumbnailProgress` and reads like
   * them, but it is a RESULT rather than a pair of counters, so nothing about it
   * says when it has stopped being interesting: hence `showStatus`' timer. A
   * line that stayed would be read as a condition rather than as news.
   */
  status: string | null;
  /**
   * Bumped once per rotation that has landed on disk.
   *
   * A rotation is not renderer state any more — it is the image file's EXIF
   * Orientation tag — but the views holding DECODED copies of those bytes cannot
   * see that the file moved: `useFullImage` caches an object URL per path, and
   * the path is what a rotation does not change. This is the signal that says
   * "re-read what you are showing"; the thumbnail cache is told directly, by
   * `invalidate`.
   *
   * One counter for the whole session rather than a version per path: a rotation
   * is roughly one keypress in 3000, so dropping the two or three originals the
   * loupe has read ahead is cheaper than the bookkeeping to be precise about it.
   */
  fileRevision: number;
}

const initialState: PhotoState = {
  folderPath: null,
  images: [],
  thumbsOnDisk: {},
  directories: [],
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
  status: null,
  fileRevision: 0,
};

/** How long the Rescan summary stays in the toolbar before clearing itself. */
const STATUS_TTL_MS = 6000;

/** Everything one Rescan changed, for the single line it reports afterwards. */
export interface RescanCounts {
  /** Images the walk found that were not in the list before. */
  added: number;
  /** Images that were in the list and are no longer on disk. */
  removed: number;
  /** Saved records dropped because their image is gone. */
  recordsRemoved: number;
  /** Cached thumbnails dropped, past-format cache leftovers included. */
  thumbsRemoved: number;
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}

/**
 * The line the toolbar shows after a rename.
 *
 * Failures are never folded into the success count and never left out, however
 * few there are: on Windows any single rename can be refused by a handle the
 * app does not own — Explorer's preview pane, the indexer, a virus scanner —
 * and a run that silently moved 199 of 200 files would be indistinguishable
 * from one that moved all of them.
 */
export function formatRenameStatus(result: RenameExecuteResult): string {
  const renamed = `${result.renamed} ${plural(result.renamed, 'file')} renamed`;
  return result.failed > 0 ? `${renamed}, ${result.failed} failed` : renamed;
}

/**
 * The Rescan summary, phrased for the toolbar's row of readouts.
 *
 * Zero counts are left out rather than printed as zero — the line is news, and
 * "0 new, 0 gone" is not. When there is no news it still says so once, because
 * an F5 that reported nothing would be indistinguishable from an F5 that did
 * nothing.
 */
export function formatRescanStatus(counts: RescanCounts): string {
  const parts: string[] = [];
  if (counts.added > 0) parts.push(`${counts.added} new`);
  if (counts.removed > 0) parts.push(`${counts.removed} gone`);
  if (counts.recordsRemoved > 0) {
    parts.push(`${counts.recordsRemoved} stale ${plural(counts.recordsRemoved, 'record')} removed`);
  }
  if (counts.thumbsRemoved > 0) {
    parts.push(
      `${counts.thumbsRemoved} stale ${plural(counts.thumbsRemoved, 'thumbnail')} removed`,
    );
  }
  return parts.length === 0 ? 'Rescan: nothing to update' : `Rescan: ${parts.join(', ')}`;
}

/**
 * What a folder load keeps from the session it replaces.
 *
 * 'open' is a different tree, or the same one opened afresh: nothing carries
 * over and the cursor lands on the first image. 'rescan' re-walks the tree the
 * user is already in, so the cursor, the batch and the rating filter have to
 * survive it — the point of F5 is to take up new files, not to send somebody
 * back to image 1 of 21 851.
 */
type LoadMode = 'open' | 'rescan';

/** What a re-walk changed about the image list. */
interface LoadOutcome {
  added: number;
  removed: number;
}

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
}

export interface ExecuteResult {
  deletedCount: number;
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
  /**
   * Re-walk the open folder: take up new images, drop ones that are gone, prune
   * what is orphaned, and keep everything else. Reports what it did through
   * `state.status`.
   */
  /** The folder tree the grid renders, in sibling order. */
  folderTree: FolderNode[];
  /** Per-folder subtree tallies for the header counters, keyed by folder path. */
  folderCounts: Map<string, FolderCounts>;
  rescanFolder: () => Promise<void>;
  /** Work out what a rename would do. Writes nothing; safe to call for a preview. */
  planRename: (request: RenameRequest) => Promise<RenamePlanResult>;
  /** Work out what moving `paths` into `targetFolder` would do. Writes nothing. */
  planMove: (paths: string[], targetFolder: string) => Promise<RenamePlanResult>;
  /**
   * Carry out a plan the user has confirmed, and re-key everything that names a
   * path. Takes a move plan and a rename plan alike — they are the same shape,
   * produced by the same allocator and executed by the same loop.
   */
  applyRename: (plan: RenamePlan) => Promise<RenameExecuteResult | null>;
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
  /**
   * Turn one image a quarter turn on disk, now. Fire-and-forget: a failure
   * surfaces in `state.error`, it cannot leave state and the file disagreeing.
   */
  rotateImage: (imagePath: string, direction: RotateDirection) => void;
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
  /**
   * How many thumbnails this session generated, per directory.
   *
   * State rather than a ref because a folder header renders it: `generatedThumbs`
   * is a Set of paths, which is the right shape for "have I already counted
   * this one" and the wrong shape for a counter that has to re-render. Both are
   * kept, and `onThumbnailGenerated` is the only writer of either.
   */
  const [generatedByFolder, setGeneratedByFolder] = useState<Record<string, number>>({});

  const thumbnailWorker = useThumbnailWorker({
    onThumbnailGenerated: (imagePath) => {
      if (generatedThumbsRef.current.has(imagePath)) return;
      generatedThumbsRef.current.add(imagePath);
      const cut = Math.max(imagePath.lastIndexOf('/'), imagePath.lastIndexOf('\\'));
      const folder = imagePath.slice(0, cut);
      setGeneratedByFolder((prev) => ({ ...prev, [folder]: (prev[folder] ?? 0) + 1 }));
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
  /**
   * True from the start of a Rescan until its re-walk has finished.
   *
   * Rescan is now the only thing that deletes records, which makes a debounced
   * write landing inside it dangerous: `writeFolder` projects state over
   * `resultsRef`, and until the re-walk has reloaded the files from disk that
   * still holds the entries the prune has just removed — so the write would put
   * every one of them straight back.
   *
   * Held rather than dropped: `releaseHeldSave` schedules the folders again
   * afterwards, projected over the RELOADED results, which covers the window
   * between the re-walk finishing and the hold coming off. Earlier than that a
   * score is lost anyway, because the re-walk rebuilds `qualityScores` from what
   * is on disk — the same trade `cancelPendingSave` documents, and the reason
   * the scoring pass simply recomputes it.
   *
   * A COUNT rather than a flag: two F5s inside one prune window are enough to
   * overlap, and the first to give up would otherwise take the hold off while the
   * second is still mid-prune.
   */
  const rescanHoldsRef = useRef(0);
  /** Clears the toolbar status line. See showStatus. */
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  /** Start (or restart) the debounce that writes the dirty folders. */
  const scheduleSave = useCallback(() => {
    // A rescan is deleting records right now; see rescanHoldsRef. Checked here,
    // at schedule time, and that is enough only because `rescanFolder` raises the
    // hold before its first await and `cancelPendingSave` clears any timer
    // already running — so no timer can outlive the moment the hold goes up.
    if (rescanHoldsRef.current > 0) return;

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
  }, [writeDirtyFolders]);

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
      scheduleSave();
    },
    [scheduleSave],
  );

  /**
   * Let held writes through again after a rescan.
   *
   * `keep` is false when the rescan did NOT finish in the tree it started in —
   * another folder was opened over it, or its walk failed. The marks then name
   * folders this store no longer holds results for, so writing them would
   * project an empty map over real files: precisely what the epoch check exists
   * to prevent, and precisely what re-stamping the epoch below would defeat.
   */
  const releaseHeldSave = useCallback(
    (keep: boolean) => {
      rescanHoldsRef.current = Math.max(0, rescanHoldsRef.current - 1);
      // An overlapping rescan is still deleting records; it owns the release.
      if (rescanHoldsRef.current > 0) return;

      if (!keep) {
        dirtyFoldersRef.current.clear();
        return;
      }
      if (dirtyFoldersRef.current.size === 0) return;
      // Re-stamped deliberately: those folders were marked dirty before the
      // rescan bumped the epoch, and the check it feeds exists to stop one
      // TREE's data landing in another's file. A rescan that got this far stayed
      // in its own tree, so its own bump must not be read as a folder switch.
      pendingEpochRef.current = openEpochRef.current;
      scheduleSave();
    },
    [scheduleSave],
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
   *
   * Rescan's opening move. What is queued was projected over the results as they
   * stood BEFORE the prune, orphaned entries and all, so it cannot be allowed to
   * land after it — and flushing instead would not help, because
   * `flushPendingSave` is fire-and-forget and would merely race the prune. The
   * cost is at most one debounce window of quality scores, which the scoring pass
   * recomputes precisely because they are then absent from the file.
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

  /**
   * Fire every queued rating write now, without waiting out the debounce.
   *
   * Awaitable, and Rescan is why: the image file is the authority for a rating
   * and the re-walk reads it, so a rating still sitting out its debounce has to
   * reach disk first. Otherwise the walk reads the old value, the write lands
   * after it, and the screen and the file disagree with nothing able to say
   * which is right. Callers that are merely tidying up (beforeunload) ignore the
   * promise.
   */
  const flushRatingWrites = useCallback(async (): Promise<void> => {
    const pending = [...ratingWritesRef.current];
    ratingWritesRef.current.clear();
    await Promise.all(
      pending.map(([imagePath, entry]) => {
        clearTimeout(entry.timer);
        return persistRating(imagePath, entry.value, entry.revertTo);
      }),
    );
  }, [persistRating]);

  /**
   * Show a line in the toolbar, and take it away again.
   *
   * The timer is what makes it a status rather than a condition: the readouts it
   * sits next to are progress pairs that stop being shown when `completed`
   * reaches `total`, and a summary has no such moment of its own.
   */
  const showStatus = useCallback((text: string) => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    setState((prev) => ({ ...prev, status: text }));
    statusTimerRef.current = setTimeout(() => {
      statusTimerRef.current = null;
      if (!mountedRef.current) return;
      setState((prev) => ({ ...prev, status: null }));
    }, STATUS_TTL_MS);
  }, []);

  // Flush save on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
      if (statusTimerRef.current) {
        clearTimeout(statusTimerRef.current);
      }
    };
  }, []);

  // Flush save on beforeunload
  useEffect(() => {
    const handleBeforeUnload = (): void => {
      // Best-effort — the IPC calls fire but the page may unload first.
      void flushRatingWrites();
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        writeDirtyFolders();
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [writeDirtyFolders, flushRatingWrites]);

  /**
   * Load a folder tree into state — the shared body of Open and Rescan.
   *
   * The two differ only in what survives, which `mode` decides; everything
   * expensive about them (the walk, the results files, the thumbnail sweep) is
   * identical, and the one release in which they were separate implementations is
   * the one where Rescan drifted into deleting every results file in the tree.
   *
   * Resolves to what the walk changed, or null when it bailed — either a second
   * load overtook this one, or the folder could not be read.
   */
  const loadFolder = useCallback(
    async (folderPath: string, mode: LoadMode): Promise<LoadOutcome | null> => {
      const rescan = mode === 'rescan';

      // Opening a tree means leaving one: get its last edits to disk, then retire
      // its epoch so its still-running workers cannot write into the new folder's
      // file. A rescan stays where it is and has deliberately DROPPED its queued
      // writes — flushing here would write the records the prune just removed
      // straight back.
      if (!rescan) flushPendingSave();
      openEpochRef.current += 1;
      const scanId = openEpochRef.current;
      if (!rescan) {
        // resultsRef is nulled for the duration of an open: state below is reset
        // to empty and only repopulated after two awaited IPC round trips, and a
        // save landing in that window would persist images: {}.
        //
        // A rescan must NOT do this, and the reason is subtle: its state keeps
        // the image list, so `folderOf` still resolves and `markDirty` still
        // fires, and a write inside that window would find an empty map and
        // project images: {} over a real file. It keeps the loaded results
        // instead, until the freshly read ones replace them below.
        resultsRef.current = new Map();
        // Nothing is on screen until the scan comes back, so the range a
        // Shift-click could span is empty until App reports the new order — and
        // so is the set that permits the fallback to the focused image.
        visibleOrderRef.current = [];
        setVisiblePathSet(EMPTY_PATH_SET);
      }
      // Ratings are back in the files' hands either way: a rescan awaited every
      // queued write before getting here, and an open is leaving the tree those
      // writes belonged to. Buffered batches name images of the scan being
      // replaced.
      userRatedRef.current = new Set();
      metadataBufferRef.current = [];
      scanAppliedRef.current = null;

      setState((prev) => {
        const next: PhotoState = {
          ...prev,
          isLoading: true,
          error: null,
          folderPath,
          scoringProgress: { completed: 0, total: 0 },
          thumbnailProgress: { completed: 0, total: 0 },
          scanProgress: { phase: 'walking', found: 0, completed: 0 },
        };
        // A rescan keeps the list, the ratings, the scores and the user's place on
        // the way in. Keeping the images is not cosmetic: they ARE the visible
        // order, and clearing them would have App report an empty order back,
        // which reconciles the selection to nothing — the one thing a rescan has
        // to preserve.
        if (rescan) return next;
        return {
          ...next,
          images: [],
          ratings: {},
          focusedImageId: null,
          selection: EMPTY_SELECTION.selection,
          selectionAnchor: EMPTY_SELECTION.anchor,
          qualityScores: {},
          qualitySubscores: {},
          filterRatingRange: FULL_RATING_RANGE,
          status: null,
        };
      });

      thumbnailWorker.clearAll();
      generatedThumbsRef.current = new Set();
      setGeneratedByFolder({});

      try {
        // The root's results file is the one file we can read before the walk,
        // and reading it here overlaps it with the scan instead of adding it to
        // the window the user is waiting on — 2.83 MB, and a serial read of it
        // used to sit after the whole metadata pass. The subfolders' files
        // cannot start early: their paths ARE the walk's output.
        const rootResults = loadResults(folderPath).catch(() => null);

        // A scan hands back directories as well as images since 1.8.1 — the
        // tree needs the ones that hold no photos, or a moved file would have
        // nowhere to land and a new subfolder would vanish the moment it was
        // made.
        const { images: scanned, directories } = await window.api.scanFolder(folderPath, scanId);

        // One results file per folder in the tree, loaded in parallel. Derived
        // from the IMAGES, not from `directories`: a folder with no photos has
        // no records to load and no records to write.
        const folders = foldersOf(scanned);
        const [root, allResults] = await Promise.all([
          rootResults,
          loadAllResults(folders.filter((folder) => folder !== folderPath)),
        ]);
        if (root) allResults.set(folderPath, root);

        // A second load has overtaken this one — the user picked another folder
        // while this tree was still being walked. Its epoch is the live one now,
        // so everything below, the drained batches included, would be the wrong
        // tree's: bail before touching any of it.
        if (!mountedRef.current || openEpochRef.current !== scanId) return null;

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
        }

        // Every folder gets an entry, so a shoot that has never been culled still
        // has somewhere to record into. A fresh map rather than writes into the
        // existing one: a rescan kept the previous results, and a folder that has
        // disappeared from the tree must not be left holding a live entry that a
        // later projection could write back out.
        const nextResults = new Map<string, ResultsFile>();
        for (const folder of folders) {
          nextResults.set(folder, allResults.get(folder) ?? emptyResults(folder));
        }
        resultsRef.current = nextResults;

        // What the walk changed, against the list that was on screen. Taken from
        // stateRef rather than computed inside the updater below, which has to
        // stay pure — and it is the same list either way, because a rescan's
        // metadata batches buffer until the mark set just above.
        const previousPaths = new Set(stateRef.current.images.map((img) => img.path));
        const currentPaths = new Set(images.map((img) => img.path));
        const removedPaths = new Set<string>();
        for (const imagePath of previousPaths) {
          if (!currentPaths.has(imagePath)) removedPaths.add(imagePath);
        }
        let added = 0;
        for (const imagePath of currentPaths) {
          if (!previousPaths.has(imagePath)) added += 1;
        }

        const first = images.length > 0 ? images[0]!.path : null;
        setState((prev) => {
          const next: PhotoState = {
            ...prev,
            images,
            directories,
            ratings,
            qualityScores,
            qualitySubscores,
            isLoading: false,
            thumbnailProgress: { completed: 0, total: images.length },
          };
          if (!rescan) {
            return {
              ...next,
              focusedImageId: first,
              // The cursor landing on the first image selects it, same as it does
              // when an arrow key moves there.
              selection: first === null ? EMPTY_SELECTION.selection : new Set([first]),
              selectionAnchor: first,
            };
          }
          // A rescan keeps the user's place: the cursor moves only when its own
          // image is gone, and then onto the next SURVIVOR — the same rule, and
          // the same helper, as a deletion. The batch is reconciled here rather
          // than left to App's syncVisibleOrder, so that no render in between can
          // hold a selection naming a file that is no longer on disk.
          const nextFocused =
            focusAfterRemoval(prev.images, prev.focusedImageId, removedPaths) ?? first;
          return {
            ...next,
            focusedImageId: nextFocused,
            ...selectionAfterRemoval(prev, removedPaths, nextFocused),
          };
        });

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
            const total = Object.values(onDisk).reduce((sum, n) => sum + n, 0);
            setState((prev) => ({
              ...prev,
              thumbsOnDisk: onDisk,
              thumbnailProgress: {
                // Clamped: the count is folder-wide while `total` is the images
                // actually scanned, and a filter or an unsupported extension can
                // leave a thumbnail behind whose image is not in the list.
                completed: Math.min(total, prev.thumbnailProgress.total),
                total: prev.thumbnailProgress.total,
              },
            }));
          })
          .catch(() => {
            // A missing count is a missing readout, nothing more.
          });

        // Fill in every thumbnail the folder is missing, at strictly lower
        // priority than anything on screen. Safe to start immediately: the
        // sweep only reaches a worker once the visible queue is empty, and it
        // is limited to a slice of the pool so it cannot take the platter away
        // from a visible cell or from the InfoPanel's full-file read.
        //
        // Worth doing at all only since the embedded preview landed: 3470
        // images at ~500 kB is ~1.7 GB, where reading the originals would have
        // been 20.9 GB.
        thumbnailWorker.sweepAll(
          images.map((img) => img.path),
          THUMB_MAX_EDGE,
        );

        // Save session
        window.api.setSession({ lastFolderPath: folderPath });

        return { added, removed: removedPaths.size };
      } catch {
        if (!mountedRef.current) return null;
        setState((prev) => ({
          ...prev,
          isLoading: false,
          // The scan never got as far as reporting, and nothing is outstanding.
          scanProgress: IDLE_SCAN,
          error: `Cannot access ${folderPath} -- check permissions`,
        }));
        return null;
      }
    },
    [thumbnailWorker, flushPendingSave],
  );

  const openFolder = useCallback(
    async (folderPath: string) => {
      await loadFolder(folderPath, 'open');
    },
    [loadFolder],
  );

  /**
   * Re-walk the open folder: take up new images, drop the ones that are gone, and
   * remove what is orphaned — without throwing away anything the app cannot
   * recompute for free.
   *
   * Up to 1.6.4 this deleted every results file below the root ("forget
   * everything below here"), which on a 21 851-image library discarded every
   * quality score and cost ~128 GB of re-reading to rebuild. It now removes
   * exactly what the disk says is orphaned — records and thumbnails whose image
   * is gone, plus leftovers from a past cache format — and keeps the rest.
   * Quality scores and ratings survive.
   *
   * No confirmation, because nothing it removes describes a file that still
   * exists. The capability given up in exchange: nothing in the UI can force a
   * quality-score recompute any more. Deleting `.photo-culler-results.json` by
   * hand is the escape hatch, and it is deliberately not a menu item.
   */
  const rescanFolder = useCallback(async () => {
    const folderPath = stateRef.current.folderPath;
    if (!folderPath) return;
    // Nothing here bumps the epoch — only `loadFolder` does — so this stays the
    // epoch of the tree the user pressed F5 in for as long as the prune runs.
    const startEpoch = openEpochRef.current;

    // Said before the first await, because the prune walks the whole tree and can
    // take seconds on a large library: without this, F5 would appear to do
    // nothing at all until the walk that follows it starts reporting.
    setState((prev) => ({
      ...prev,
      isLoading: true,
      error: null,
      status: null,
      scanProgress: { phase: 'walking', found: 0, completed: 0 },
    }));

    // Held BEFORE the first await, not after the flush: `flushRatingWrites`
    // awaits real IPC, and a scoring result arriving inside that window would
    // schedule its debounce while the hold was still off — a timer that then
    // fires mid-prune. Held rather than merely cancelled because the prune and
    // the re-walk both take real time on a large tree and the scoring worker goes
    // on delivering throughout. See rescanHoldsRef.
    rescanHoldsRef.current += 1;
    let prune: PruneResult | null = null;
    let finished = false;
    try {
      cancelPendingSave();
      await flushRatingWrites();

      try {
        prune = await window.api.pruneFolder(folderPath);
      } catch {
        // Housekeeping. A prune that failed must not stop the re-walk, which is
        // the half of Rescan the user actually asked for.
      }

      // A load has happened while the prune ran: the user opened another folder,
      // or pressed F5 again. That tree is on screen now, and re-walking this one
      // would replace it with the wrong photos — the prune itself was still
      // worth doing, so it is not undone, only not followed up.
      if (!mountedRef.current || openEpochRef.current !== startEpoch) return;

      const outcome = await loadFolder(folderPath, 'rescan');
      if (!mountedRef.current || outcome === null) return;
      finished = true;

      showStatus(
        formatRescanStatus({
          added: outcome.added,
          removed: outcome.removed,
          recordsRemoved: prune?.entriesRemoved ?? 0,
          // Legacy cache entries are folded in here rather than given a clause of
          // their own. One of them can be a whole `v2/` directory holding
          // thousands of thumbnails, so on the first rescan after an upgrade this
          // undercounts — a more honest line would be a less readable one.
          thumbsRemoved: (prune?.thumbsRemoved ?? 0) + (prune?.legacyRemoved ?? 0),
        }),
      );
    } finally {
      releaseHeldSave(finished);
    }
  }, [cancelPendingSave, flushRatingWrites, loadFolder, releaseHeldSave, showStatus]);

  const planRename = useCallback(async (request: RenameRequest): Promise<RenamePlanResult> => {
    // No scan guard since 1.8.1. The deferred metadata pass reads BY PATH, so a
    // rename underneath it used to make every one of those reads miss —
    // silently, because `readImageMetadata` returns {} rather than throwing —
    // and the affected images lost their date, their dimensions and their
    // RATING for the rest of the session. Refusing to plan was the only defence
    // the renderer had, and it made renaming impossible for the minutes a large
    // library takes to scan.
    //
    // The pass and the rename both live in the MAIN process, so the rename now
    // tells the pass where the files went instead: `remapScanPass` redirects
    // every unread entry, and `executeRename` re-reads the handful that were
    // mid-read anyway. See `main/scan-pass.ts`.
    try {
      return await window.api.planRename(request);
    } catch (err) {
      return { plan: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, []);

  const planMove = useCallback(
    async (paths: string[], targetFolder: string): Promise<RenamePlanResult> => {
      try {
        return await window.api.planMove(paths, targetFolder);
      } catch (err) {
        return { plan: null, error: err instanceof Error ? err.message : String(err) };
      }
    },
    [],
  );

  /**
   * Carry out a rename plan, then re-key everything in the renderer that names
   * a path.
   *
   * The quiesce order is `rescanFolder`'s, for the same reasons plus one:
   *
   * - the hold goes up BEFORE the first await, because `flushRatingWrites`
   *   awaits real IPC and a scoring result arriving in that window would
   *   schedule a debounce while the hold was still off;
   * - **rating writes are flushed and not merely cancelled**, and here that is
   *   not housekeeping. A `setRating` debounce is keyed by the OLD path; left
   *   to fire after the rename it calls `writeRating` on a file that no longer
   *   exists, the write fails, `persistRating` rolls the star back, and the
   *   rating is gone from the only place it lived;
   * - the thumbnail cache is re-keyed BEFORE the rename, so a worker response
   *   already in flight cannot re-create the cache file main just moved.
   *
   * The results FILES are re-keyed in the main process, inside the same pass as
   * the rename — see `executeRename`. What happens here is the in-memory half.
   */
  const applyRename = useCallback(
    async (plan: RenamePlan): Promise<RenameExecuteResult | null> => {
      const moving = plan.entries.filter((e) => e.action === 'rename');
      if (moving.length === 0) return null;

      const startEpoch = openEpochRef.current;
      setState((prev) => ({ ...prev, error: null, status: null }));

      rescanHoldsRef.current += 1;
      let finished = false;
      try {
        cancelPendingSave();
        await flushRatingWrites();

        // Before the rename, deliberately. See the doc comment.
        for (const entry of moving) thumbnailWorker.rekey(entry.src, entry.targetPath);

        const result = await window.api.executeRename(plan);

        // Put back what did not move. A rename can be refused per file on
        // Windows by a handle the app does not own.
        for (const outcome of result.outcomes) {
          if (!outcome.ok) thumbnailWorker.rekey(outcome.targetPath, outcome.src);
        }

        if (!mountedRef.current || openEpochRef.current !== startEpoch) return result;

        const renamed = new Map<string, { path: string; name: string; folder: string }>();
        for (const entry of moving) {
          const outcome = result.outcomes.find((o) => o.src === entry.src);
          if (!outcome?.ok) continue;
          renamed.set(entry.src, {
            path: entry.targetPath,
            name: entry.targetName,
            folder: entry.targetFolder,
          });
        }
        if (renamed.size === 0) {
          finished = true;
          return result;
        }

        /**
         * Metadata main re-read for the files that moved.
         *
         * Present only when the deferred scan pass was still running, which is
         * exactly when an image could otherwise come out of a rename with no
         * date and — worse — no rating, because the pass read it at its old path
         * and `readImageMetadata` answers a miss with `{}`. Merged through the
         * same two helpers a SCAN_PROGRESS batch goes through, so the "a rating
         * the user just typed beats the one the file still holds" rule applies
         * here too.
         */
        const refreshed = result.refreshed ?? [];

        // Re-keyed BEFORE the updater, not with the other refs afterwards.
        // `mergeRatings` below asks `userRated` about the NEW paths, and this is
        // the set that tells it which ratings are the user's rather than the
        // file's — left until after, every refreshed rating would win and a star
        // typed a moment ago would be silently rolled back to what the file
        // still holds.
        for (const [from, to] of renamed) {
          if (userRatedRef.current.delete(from)) userRatedRef.current.add(to.path);
        }

        // One updater. Anything left keyed by the old path is not merely a
        // blank badge: `projectFolderResults` reads `qualityScores[image.path]`
        // and writes `next[image.name]`, so a missing entry OVERWRITES the disk
        // record with an empty one on the next save.
        setState((prev) => {
          const move = <T>(map: Record<string, T>): Record<string, T> => {
            const next: Record<string, T> = {};
            for (const [key, value] of Object.entries(map)) {
              next[renamed.get(key)?.path ?? key] = value;
            }
            return next;
          };
          const moveSet = (set: ReadonlySet<string>): ReadonlySet<string> =>
            new Set([...set].map((path) => renamed.get(path)?.path ?? path));

          const moved = prev.images.map((img) => {
            const to = renamed.get(img.path);
            // `folder` too, not just `path` and `name`: DCIM consolidation
            // moves a file to a DIFFERENT directory, and `ImageFileInfo.folder`
            // is `dirname(path)` by contract — it is what the folder tree
            // sections by, so leaving it behind puts the renamed photo under a
            // header naming the folder it just left.
            return to ? { ...img, path: to.path, name: to.name, folder: to.folder } : img;
          });

          return {
            ...prev,
            // Re-keyed FIRST, then refreshed: the fresh entries are keyed by the
            // NEW paths, so merging them into the old list would match nothing.
            images: mergeMetadata(moved, refreshed),
            ratings: mergeRatings(move(prev.ratings), refreshed, userRatedRef.current),
            qualityScores: move(prev.qualityScores),
            qualitySubscores: move(prev.qualitySubscores),
            focusedImageId: prev.focusedImageId
              ? (renamed.get(prev.focusedImageId)?.path ?? prev.focusedImageId)
              : null,
            selection: moveSet(prev.selection),
            selectionAnchor: prev.selectionAnchor
              ? (renamed.get(prev.selectionAnchor)?.path ?? prev.selectionAnchor)
              : null,
            // Cache-busting for useFullImage and useDetailedMetadata, which are
            // keyed by path alone and cannot see that the bytes behind one moved.
            fileRevision: prev.fileRevision + 1,
          };
        });

        // Refs, outside the updater. `userRatedRef` is what stops a late
        // metadata batch putting a file's older rating back on screen, and
        // `resultsRef` is what the next `projectFolderResults` spreads `prior`
        // from — main has already rewritten those files, so the in-memory copy
        // has to follow or the next save undoes it.
        for (const entry of moving) {
          if (!renamed.has(entry.src)) continue;
          const from = resultsRef.current.get(entry.srcFolder);
          const record = from?.images[entry.srcName];
          if (from) delete from.images[entry.srcName];
          if (record === undefined) continue;
          const to = resultsRef.current.get(entry.targetFolder);
          if (to) to.images[entry.targetName] = record;
        }

        finished = true;
        showStatus(formatRenameStatus(result));
        return result;
      } catch (err) {
        setState((prev) => ({
          ...prev,
          error: err instanceof Error ? err.message : String(err),
        }));
        return null;
      } finally {
        releaseHeldSave(finished);
      }
    },
    [cancelPendingSave, flushRatingWrites, releaseHeldSave, showStatus, thumbnailWorker],
  );

  /** Look up which folder an image belongs to, for dirty-marking. */
  const folderOf = useCallback((imagePath: string): string | undefined => {
    return stateRef.current.images.find((img) => img.path === imagePath)?.folder;
  }, []);

  const setRating = useCallback(
    (imagePath: string, rating: number) => {
      // Videos are not ratable, and the check belongs HERE rather than only in
      // the cell that hides the stars: the 0-5 keys act on the whole selection,
      // which routinely mixes photos and clips. A rating lives in the file, and
      // ExifTool writes XMP into an MP4 by rewriting the entire container —
      // seconds and gigabytes per keypress. Silently skipping is the right
      // outcome: rating four photos and one video must rate the four.
      if (isVideoFile(imagePath)) return;

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

  const executeActions = useCallback(async (options: ExecuteOptions): Promise<ExecuteResult> => {
    const current = stateRef.current;
    if (!current.folderPath) {
      return { deletedCount: 0, failedPaths: [] };
    }

    const executeResult: ExecuteResult = {
      deletedCount: 0,
      failedPaths: [],
    };

    // Only operate on currently visible (filtered) images
    const visibleImages = filteredImagesRef.current;

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
      const nextFocused = focusAfterRemoval(prev.images, prev.focusedImageId, succeededDeletePaths);
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
    const remaining = stateRef.current.images.filter((img) => !succeededDeletePaths.has(img.path));
    const touched = new Set<string>();
    for (const path of succeededDeletePaths) {
      const folder = current.images.find((img) => img.path === path)?.folder;
      if (folder) touched.add(folder);
    }

    for (const folderPath of touched) {
      const existing = resultsRef.current.get(folderPath);
      if (!existing) continue;
      const keepNames = remaining.filter((img) => img.folder === folderPath).map((img) => img.name);
      const rebuilt = rebuildResults(existing, keepNames);
      resultsRef.current.set(folderPath, rebuilt);
      await saveResults(folderPath, rebuilt);
    }

    return executeResult;
  }, []);

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

  // `pruneLoadedResults` used to live here: it mirrored the main process's
  // clean-up into `resultsRef`, so a later projection could not write the pruned
  // records back. Rescan prunes BEFORE its re-walk now, and the re-walk reloads
  // every results file from disk, so the in-memory copies come back already
  // pruned and there is nothing left to mirror.

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

  /**
   * Turn one image a quarter turn, on disk, on the keypress.
   *
   * There is no optimistic update and nothing to roll back, because there is no
   * renderer-side rotation left to hold: the main process changes the file's EXIF
   * Orientation tag, and `createImageBitmap(…, { imageOrientation: 'from-image' })`
   * means the new orientation appears as soon as the pixels are decoded again.
   * Which is the one thing left to do here — main has already moved the source's
   * mtime and deleted the on-disk cache entry, but the decoded bitmap in this
   * process is a third copy, and it is the one on screen.
   *
   * Reported like a rating write, and for the same reason: the tag is the only
   * place the rotation lives, so a failure that said nothing (a PNG, which has
   * no orientation path this app can honour, or a file another process is
   * holding) would leave the user believing they had turned the photo.
   */
  const rotateImage = useCallback((imagePath: string, direction: RotateDirection) => {
    void (async () => {
      let result: RotateResult;
      try {
        result = await window.api.rotateImage(imagePath, direction);
      } catch (err) {
        result = { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      if (!mountedRef.current) return;

      if (result.ok) {
        // Three copies of the old pixels exist, and each has its own owner: the
        // file (main has rewritten it), the thumbnail cache (main deleted the
        // disk entry; this drops the decoded one) and whatever full-resolution
        // original the loupe or the info panel is holding, which is what
        // fileRevision tells them to re-read.
        thumbnailWorkerRef.current.invalidate(imagePath);
        setState((prev) => ({ ...prev, fileRevision: prev.fileRevision + 1 }));
        return;
      }

      const name = imagePath.split(/[\\/]/).pop() ?? imagePath;
      setState((prev) => ({
        ...prev,
        error: `Could not rotate ${name} -- ${result.error ?? 'unknown error'}`,
      }));
    })();
  }, []);

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
    () =>
      groupByFolder(
        sortedImages,
        state.groupingThresholdMs,
        state.folderPath ?? '',
        state.sortDirection,
      ),
    [sortedImages, state.folderPath, state.groupingThresholdMs, state.sortDirection],
  );

  /**
   * The same sections, arranged as the tree the grid draws.
   *
   * Built from the sections AND the walk's directory list, because a folder
   * with no images anywhere below it has no section to derive it from — and it
   * still has to be there, as somewhere to drop a moved file and as the place a
   * newly created subfolder appears.
   */
  const folderTree = useMemo(
    () => buildFolderTree(folders, state.directories, state.folderPath ?? '', state.sortDirection),
    [folders, state.directories, state.folderPath, state.sortDirection],
  );

  /**
   * What each folder header reports, summed over its whole subtree.
   *
   * Bucketed here rather than in the tree because both inputs are renderer
   * state keyed by image PATH: a quality score, and a thumbnail this session
   * generated. The on-disk floor arrives per directory from the main process.
   */
  const folderCounts = useMemo(() => {
    const own: Record<string, Partial<FolderOwnCounts>> = {};
    const bump = (folder: string, key: keyof FolderOwnCounts): void => {
      const entry = (own[folder] ??= {});
      entry[key] = (entry[key] ?? 0) + 1;
    };

    for (const image of state.images) {
      const video = isVideoFile(image.extension);
      // Each counter measures against what is POSSIBLE, not against the image
      // count. A video is never scored, and a container Chromium cannot demux
      // never gets a poster — measured against the plain total, a finished
      // folder would read 25/28 for ever.
      if (!video) bump(image.folder, 'scoreable');
      if (!video || isPlayableVideo(image.extension)) bump(image.folder, 'thumbable');
      if (state.qualityScores[image.path] != null) bump(image.folder, 'scored');
    }

    for (const [folder, count] of Object.entries(state.thumbsOnDisk)) {
      (own[folder] ??= {}).thumbs = count;
    }
    for (const [folder, count] of Object.entries(generatedByFolder)) {
      // Not summed with the on-disk figure: a thumbnail generated this session
      // is ON DISK by the time it is counted, and the two would double it. The
      // larger of the pair is the honest answer — the on-disk count is a
      // snapshot from when the folder opened.
      const entry = (own[folder] ??= {});
      entry.thumbs = Math.max(entry.thumbs ?? 0, count);
    }

    return rollUpCounts(folderTree, own);
  }, [folderTree, state.images, state.qualityScores, state.thumbsOnDisk, generatedByFolder]);

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
    folderTree,
    folderCounts,
    rescanFolder,
    planRename,
    planMove,
    applyRename,
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
  };
}

export type { SortDirection, PhotoGroup };
