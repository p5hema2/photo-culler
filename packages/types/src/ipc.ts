import type { ImageFileInfo } from './image';
import type { DetailedMetadata } from './focus';
import type {
  FolderOpResult,
  FolderStats,
  RenameExecuteResult,
  RenamePlan,
  RenamePlanResult,
  RenameRequest,
} from './rename';

export const IPC_CHANNELS = {
  SELECT_FOLDER: 'dialog:select-folder',
  SCAN_FOLDER: 'fs:scan-folder',
  /** Main -> renderer push, not an invoke. See ScanProgress. */
  SCAN_PROGRESS: 'fs:scan-progress',
  SAVE_RESULTS: 'fs:save-results',
  LOAD_RESULTS: 'fs:load-results',
  GET_SESSION: 'store:get-session',
  SET_SESSION: 'store:set-session',
  DELETE_FILES: 'fs:delete-files',
  READ_FILE: 'fs:read-file',
  READ_THUMB_SOURCE: 'fs:read-thumb-source',
  LOAD_THUMB_CACHE: 'fs:load-thumb-cache',
  SAVE_THUMB_CACHE: 'fs:save-thumb-cache',
  ROTATE_IMAGE: 'fs:rotate-image',
  WRITE_RATING: 'fs:write-rating',
  REVEAL_IN_FOLDER: 'shell:reveal-in-folder',
  PRUNE_FOLDER: 'fs:prune-folder',
  READ_DETAILED_METADATA: 'meta:read-detailed',
  COUNT_THUMB_CACHE: 'fs:count-thumb-cache',
  GET_APP_VERSION: 'app:get-version',
  /** Compute a rename plan. Reads tags and directories; writes nothing. */
  PLAN_RENAME: 'fs:plan-rename',
  /** Carry out a plan the user has confirmed. */
  EXECUTE_RENAME: 'fs:execute-rename',
  /** Plan a move into another folder. Same plan shape, same executor. */
  PLAN_MOVE: 'fs:plan-move',
  /** Create one subfolder. */
  CREATE_FOLDER: 'fs:create-folder',
  /** Delete a folder and everything below it. */
  DELETE_FOLDER: 'fs:delete-folder',
  /** Count what a folder holds, for the delete confirmation. */
  STAT_FOLDER: 'fs:stat-folder',
} as const;

/**
 * Commands the native menu can dispatch to the renderer.
 * Kept as a closed union so the menu and the renderer handler cannot drift.
 */
export const MENU_COMMANDS = [
  'rescan',
  'execute',
  'layout:default',
  'layout:loupe',
  'layout:filmstrip',
  'thumbnail:small',
  'thumbnail:medium',
  'thumbnail:large',
  'toggle-info-panel',
  'show-shortcuts',
  // No 'clean-up-folder': Rescan prunes now, so there is nothing left for a
  // separate command to do — see PruneResult.
  'toggle-focus-peaking',
  'toggle-clipping',
  'toggle-af-point',
] as const;

export type MenuCommand = (typeof MENU_COMMANDS)[number];

export interface FileOpResult {
  /** Paths the operation succeeded on */
  succeeded: string[];
  /** Paths that failed with their error messages */
  failed: Array<{ path: string; error: string }>;
}

export interface SessionConfig {
  /** Last opened folder path */
  lastFolderPath?: string;
  /** Thumbnail size preset */
  thumbnailSize: 'small' | 'medium' | 'large';
  /** Grouping threshold in milliseconds */
  groupingThresholdMs: number;
  /** Focus-peaking overlay visible */
  showFocusPeaking: boolean;
  /** Exposure-clipping overlay visible */
  showClipping: boolean;
  /** AF-point overlay visible */
  showAfPoint: boolean;
  /**
   * Sobel gradient magnitude above which a pixel counts as in focus.
   * 8-bit input yields magnitudes up to ~1442, so the old hardcoded 30 marked
   * essentially every texture as sharp.
   */
  focusPeakingThreshold: number;
}

/**
 * Why a thumbnail had to be generated from the whole file rather than from the
 * preview the camera embedded.
 *
 * Every value is a normal outcome, not an error: the fallback produces exactly
 * the thumbnail the app produced before previews were used at all. They are
 * named individually because they are otherwise indistinguishable from the
 * renderer — a folder that mysteriously stopped being fast is diagnosed by which
 * of these it reports.
 */
export type ThumbSourceFallback =
  /** No MPF index in the leading bytes: a PNG, a stripped JPEG, an old camera. */
  | 'no-mpf-preview'
  /** The index named a byte range that is not in the file, or not a sane length. */
  | 'implausible-range'
  /** The positioned read came up short — the file changed under us. */
  | 'short-read'
  /** The read itself failed; the whole file is tried instead. */
  | 'read-failed'
  /** The extracted bytes do not start with a JPEG SOI marker. */
  | 'not-a-jpeg'
  /** The preview's longest edge is below the thumbnail's, so it would upscale. */
  | 'too-small'
  /** The preview disagrees with the original about which way is up. */
  | 'orientation-mismatch';

/**
 * Bytes to generate a thumbnail from, and which bytes they turned out to be.
 *
 * A discriminated union rather than a buffer plus flags: the caller has to pick
 * a MIME type for the decode, and 'mpf-preview' is JPEG by definition while
 * 'full-file' is whatever the file on disk is.
 */
export type ThumbSource =
  | {
      kind: 'mpf-preview';
      buffer: ArrayBuffer;
      /** Bytes actually read from disk, header window included. */
      bytesRead: number;
      width: number;
      height: number;
    }
  | {
      kind: 'full-file';
      buffer: ArrayBuffer;
      bytesRead: number;
      fallback: ThumbSourceFallback;
    };

/**
 * How far a folder scan has got, pushed from the main process while it runs.
 *
 * A scan reports rather than simply resolving because only its first phase is
 * awaited: `scanFolder` returns once the tree is walked and a bounded prefix of
 * EXIF headers is read, and the remaining headers arrive here in batches while
 * the grid is already on screen. Each header costs two seeking 64 kB reads, and
 * awaiting all of them — 3470 of them, in the folder that motivated this — is
 * what used to keep the window blank for the length of the whole scan.
 */
export interface ScanProgress {
  /**
   * The `scanId` the renderer passed to `scanFolder` — its own open epoch.
   *
   * The renderer chooses it so that it can drop a report belonging to a tree it
   * has since left without having to ask main anything. Same guard, and the
   * same reason, as the epoch on a queued results-file write.
   */
  scanId: number;
  /** 'walking' = building the file list; 'metadata' = reading EXIF headers. */
  phase: 'walking' | 'metadata';
  /**
   * Image files the walk has found. Once `phase` is 'metadata' the walk is
   * finished, so this is also the total the counts below are out of.
   */
  found: number;
  /** Images whose metadata has been read, the blocking prefix included. */
  completed: number;
  /**
   * The images this report delivers, metadata filled in.
   *
   * Empty while walking, and empty for the blocking prefix — those images
   * travel in `scanFolder`'s own result, and sending them twice would double
   * the cost of the phase that the user is actually waiting on.
   */
  images: ImageFileInfo[];
}

/**
 * What a scan hands back: the images, and every directory it entered.
 *
 * Was a bare `ImageFileInfo[]` until 1.8.1. The directory list is what lets the
 * grid draw a real tree — a folder with no photos anywhere below it still has
 * to be there, or a moved file would have nowhere to land and a freshly created
 * subfolder would disappear the moment it was made.
 */
export interface ScanResult {
  images: ImageFileInfo[];
  directories: string[];
}

export interface QualitySubscores {
  sharpness: number;
  exposure: number;
  contrast: number;
  noise: number;
}

/**
 * What the results file remembers about one image: quality scores, and nothing
 * else.
 *
 * Deliberately NOT the rating: the image file itself is the authority for that
 * (xmp:Rating and the EXIF tag), read at scan time and written on every change.
 * A second copy here would be a cache that can disagree with the file, and the
 * file is what other tools see.
 *
 * Deliberately NOT a rotation either, and for the same reason. It
 * used to hold a pending quarter-turn count that Execute applied by re-encoding
 * the file with sharp — measured on one 6102 kB camera JPEG: 6 226 940 bytes
 * rewritten, the file down to 1470 kB at sharp's default JPEG quality, and the
 * embedded MPF preview destroyed, which drops that photo off the fast thumbnail
 * path for good. Rotation is now a change to the file's EXIF Orientation tag,
 * applied immediately: 31 ms, one byte. The tag is the only place it lives.
 *
 * Every field is optional, so an image the app has merely seen needs no entry.
 */
export interface ImageResult {
  /** Quality score computed by the scoring worker (0-100) */
  qualityScore?: number;
  /** Individual metric scores (0-100 each) */
  qualitySubscores?: QualitySubscores;
}

/**
 * Which way a rotation turns the photo, as the user sees it.
 *
 * Structurally the same union as `RotateDirection` in
 * `@photo-culler/image-utils/orientation`, declared again here because that
 * module is deliberately import-free and this package cannot depend on
 * image-utils anyway — image-utils depends on it. Two members, so the
 * duplication is cheap, and structural typing keeps the two ends compatible
 * without a cast.
 */
export type RotateDirection = 'cw' | 'ccw';

/**
 * Outcome of a rotation. Reported rather than swallowed, like a rating write:
 * the tag on disk is the only place the rotation lives, so a failed write with
 * a turned photo on screen is a lie the app cannot recover from.
 */
export interface RotateResult {
  ok: boolean;
  /** The EXIF orientation now on disk, 1-8. Present only when `ok`. */
  orientation?: number;
  error?: string;
}

/**
 * What a prune actually removed.
 *
 * There is no `cancelled` and no dialog behind this: pruning is a step of Rescan
 * now rather than a menu command of its own, and every count below is of
 * something whose image is already gone from disk — so there is nothing for the
 * user to weigh up. The counts exist to be reported afterwards, in a line that
 * expires on its own.
 *
 * `legacyRemoved` stays apart from `thumbsRemoved` because one legacy entry can
 * be a whole `v2/` directory holding thousands of thumbnails, and averaging that
 * into a per-file count would understate it by three orders of magnitude.
 */
export interface PruneResult {
  thumbsRemoved: number;
  legacyRemoved: number;
  entriesRemoved: number;
  /** Directories walked, so a caller can say "nothing stale" and mean it. */
  directoriesScanned: number;
}

export interface ResultsFile {
  /** Schema version */
  version: 1;
  /** Absolute path to the scanned folder */
  folderPath: string;
  /** ISO timestamp of last update */
  updatedAt: string;
  /** Per-image results keyed by filename */
  images: Record<string, ImageResult>;
}

export interface ElectronAPI {
  selectFolder: () => Promise<string | null>;
  /**
   * Walk a folder tree and return every image in it, with the metadata of a
   * bounded prefix already read. The rest arrives over `onScanProgress`.
   *
   * `scanId` is optional because it is only a correlation token for those
   * pushes: a caller that does not listen has no use for one, and main defaults
   * it to 0.
   */
  scanFolder: (folderPath: string, scanId?: number) => Promise<ScanResult>;
  /**
   * Subscribe to scan progress. One subscriber by construction — the photo
   * store — which is why the unsubscribe below takes no handle.
   */
  onScanProgress: (listener: (progress: ScanProgress) => void) => void;
  removeScanProgressListener: () => void;
  saveResults: (folderPath: string, data: string) => Promise<void>;
  loadResults: (folderPath: string) => Promise<string | null>;
  getSession: () => Promise<SessionConfig>;
  setSession: (config: Partial<SessionConfig>) => Promise<void>;
  /** Permanently delete files. There is no trash path — deletion is final. */
  deleteFiles: (filePaths: string[]) => Promise<FileOpResult>;
  readFile: (filePath: string) => Promise<ArrayBuffer>;
  /**
   * Bytes to generate a thumbnail of `filePath` from — the camera's embedded
   * preview where there is a usable one, the whole file otherwise.
   *
   * Separate from `readFile` because that channel's other callers (scoring, the
   * detail viewer, its neighbour preload) all genuinely want full resolution.
   * `minEdge` is the thumbnail's longest edge, passed in so the size floor stays
   * single-sourced in the renderer rather than being duplicated in main.
   */
  readThumbSource: (filePath: string, minEdge: number) => Promise<ThumbSource>;
  /**
   * Cached thumbnail for a file, or null when absent or stale.
   * Freshness is decided in the main process against the source file's current
   * mtime — the renderer's scan-time value went stale after a rotation.
   */
  loadThumbCache: (filePath: string) => Promise<ArrayBuffer | null>;
  /**
   * Store an encoded thumbnail beside the image. The container is decided by
   * the renderer (THUMB_MIME) and reflected in the cache filename by the main
   * process (THUMB_SUFFIX) — the bytes travel opaquely.
   */
  saveThumbCache: (filePath: string, thumbBuffer: ArrayBuffer) => Promise<void>;
  /**
   * Turn one image a quarter turn, immediately, by rewriting its EXIF
   * Orientation tag.
   *
   * One image rather than the batch this replaced, because a tag change is
   * cheap enough to be interactive — so there is no pending state for Execute
   * to apply, and undo is just a turn the other way. The main process reads the
   * current tag itself; the renderer has nothing to keep in step.
   */
  rotateImage: (filePath: string, direction: RotateDirection) => Promise<RotateResult>;
  /**
   * Write a star rating (0-5, 0 = unrated) into the image file's XMP and EXIF.
   *
   * The file is the authority for a rating, so this is not a cache update — it
   * is the save. The result is reported rather than swallowed: a failed write
   * with a star still on screen is a lost rating, and there is nowhere else it
   * lives.
   */
  writeRating: (filePath: string, rating: number) => Promise<{ ok: boolean; error?: string }>;
  /**
   * Open the OS file manager with one image selected.
   *
   * ONE path, not a batch: the platform call selects a single item, and forty of
   * them would be forty Explorer windows.
   *
   * A result, even though `shell.showItemInFolder` returns nothing and does
   * nothing at all for a path that is not there — so from this side a success
   * and a vanished file are indistinguishable unless main checks first. It does,
   * and reports what it found.
   */
  revealInFolder: (filePath: string) => Promise<{ ok: boolean; error?: string }>;
  /**
   * Deep metadata for one image, read on demand via exiftool in the main
   * process. Resolves null when exiftool is unavailable or the file yields
   * nothing usable.
   */
  readDetailedMetadata: (filePath: string) => Promise<DetailedMetadata | null>;
  /**
   * Remove cached thumbnails and saved records whose image no longer exists,
   * anywhere below `folderPath`, plus anything left over from an older
   * thumbnail format.
   *
   * Silent by design. This used to be `Clean Up Folder…`, a menu command with a
   * confirmation dialog, because it was the only thing that ever deleted a
   * record and a record could hold the only copy of a quality score. It is now
   * a step of Rescan, and it deletes nothing whose image still exists — a
   * confirmation would be asking the user to approve tidying up after files
   * they themselves removed.
   *
   * Never touches an image, and never touches a record whose image is present:
   * quality scores and ratings survive a prune untouched, which is the whole
   * difference from the results-file deletion Rescan used to do.
   */
  pruneFolder: (folderPath: string) => Promise<PruneResult>;
  /** Version of the running app, stamped from the git tag at build time. */
  /**
   * How many images below `folderPath` already have a current-format thumbnail
   * on disk.
   *
   * Thumbnails are generated lazily, per visible cell, so this is the only way
   * to open a half-culled folder and report "1725 of 3470" instead of starting
   * the counter at zero. Counted from the cache directories, using the same
   * suffix rule the vacuum uses, so a past format never inflates it.
   *
   * Keyed BY DIRECTORY since 1.8.1: the counter lives on each folder header in
   * the tree now, and one total for the whole scan cannot be split back up.
   * Directories with no cache are absent rather than zero.
   */
  countThumbCache: (folderPath: string) => Promise<Record<string, number>>;
  getAppVersion: () => Promise<string>;
  /**
   * Work out what renaming would do, without doing any of it.
   *
   * Reads timestamp tags with exiftool and lists the directories involved, so
   * it is not free — but it writes nothing, and the plan it returns is exactly
   * what `executeRename` will carry out. The two are split for the same reason
   * Execute has a confirmation panel: a rename moves files the user did not
   * pick (the RAW, the sidecar) and there is no undo.
   */
  planRename: (request: RenameRequest) => Promise<RenamePlanResult>;
  /**
   * Carry out a plan. Reports every file individually.
   *
   * Never optimistic: on Windows any single rename can be refused by an open
   * handle the app does not own — Explorer's preview pane, the indexer, a virus
   * scanner — so "it did not throw" is not evidence that a file moved.
   */
  executeRename: (plan: RenamePlan) => Promise<RenameExecuteResult>;
  /**
   * Work out what moving `paths` into `targetFolder` would do.
   *
   * Returns the same shape as `planRename` and is carried out by the same
   * `executeRename`, because a move IS a rename that keeps the basename — and
   * the parts that make either safe (the namespace allocation, the collision
   * suffix, the companion pass, the results re-key) are worth having once.
   */
  planMove: (paths: string[], targetFolder: string) => Promise<RenamePlanResult>;
  createFolder: (parentPath: string, name: string) => Promise<FolderOpResult>;
  /**
   * Delete a folder and everything below it, permanently.
   *
   * `root` is the opened tree, and main refuses anything outside it or equal to
   * it. Defence in depth: this is the most destructive call in the app, and the
   * renderer already only offers it on a node below the root.
   */
  deleteFolder: (folderPath: string, root: string) => Promise<FolderOpResult>;
  statFolder: (folderPath: string) => Promise<FolderStats>;
}
