import type { ImageFileInfo } from './image';
import type { DetailedMetadata } from './focus';

export const IPC_CHANNELS = {
  SELECT_FOLDER: 'dialog:select-folder',
  SCAN_FOLDER: 'fs:scan-folder',
  /** Main -> renderer push, not an invoke. See ScanProgress. */
  SCAN_PROGRESS: 'fs:scan-progress',
  SAVE_RESULTS: 'fs:save-results',
  LOAD_RESULTS: 'fs:load-results',
  CLEAR_RESULTS: 'fs:clear-results',
  GET_SESSION: 'store:get-session',
  SET_SESSION: 'store:set-session',
  DELETE_FILES: 'fs:delete-files',
  READ_FILE: 'fs:read-file',
  READ_THUMB_SOURCE: 'fs:read-thumb-source',
  LOAD_THUMB_CACHE: 'fs:load-thumb-cache',
  SAVE_THUMB_CACHE: 'fs:save-thumb-cache',
  ROTATE_FILES: 'fs:rotate-files',
  WRITE_RATING: 'fs:write-rating',
  CLEAN_UP_FOLDER: 'fs:clean-up-folder',
  READ_DETAILED_METADATA: 'meta:read-detailed',
  COUNT_THUMB_CACHE: 'fs:count-thumb-cache',
  GET_APP_VERSION: 'app:get-version',
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
  'clean-up-folder',
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

export interface QualitySubscores {
  sharpness: number;
  exposure: number;
  contrast: number;
  noise: number;
}

/**
 * What the results file remembers about one image.
 *
 * Deliberately NOT the rating: the image file itself is the authority for that
 * (xmp:Rating and the EXIF tag), read at scan time and written on every change.
 * A second copy here would be a cache that can disagree with the file, and the
 * file is what other tools see.
 *
 * Every field is optional, so an image the app has merely seen needs no entry.
 */
export interface ImageResult {
  /** Quality score computed by the scoring worker (0-100) */
  qualityScore?: number;
  /** Individual metric scores (0-100 each) */
  qualitySubscores?: QualitySubscores;
  /** Visual rotation in degrees (0, 90, 180, 270) */
  rotation?: number;
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
  scanFolder: (folderPath: string, scanId?: number) => Promise<ImageFileInfo[]>;
  /**
   * Subscribe to scan progress. One subscriber by construction — the photo
   * store — which is why the unsubscribe below takes no handle.
   */
  onScanProgress: (listener: (progress: ScanProgress) => void) => void;
  removeScanProgressListener: () => void;
  saveResults: (folderPath: string, data: string) => Promise<void>;
  loadResults: (folderPath: string) => Promise<string | null>;
  /** Delete the results file for a folder (used by Rescan). */
  clearResults: (folderPath: string) => Promise<void>;
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
  rotateFiles: (
    files: Array<{ path: string; degrees: number }>,
  ) => Promise<{ succeeded: string[]; failed: Array<{ path: string; error: string }> }>;
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
   * Deep metadata for one image, read on demand via exiftool in the main
   * process. Resolves null when exiftool is unavailable or the file yields
   * nothing usable.
   */
  readDetailedMetadata: (filePath: string) => Promise<DetailedMetadata | null>;
  /**
   * Remove cached thumbnails and saved records whose image no longer exists,
   * anywhere below `folderPath`, plus anything left over from an older
   * thumbnail format. Asks the user to confirm first, because records carry
   * scores and rotations.
   *
   * `legacyRemoved` counts old-format cache items, which are reported apart
   * from `thumbsRemoved` because one of them can be a directory holding
   * thousands of thumbnails.
   */
  cleanUpFolder: (folderPath: string) => Promise<{
    thumbsRemoved: number;
    legacyRemoved: number;
    entriesRemoved: number;
    cancelled: boolean;
  }>;
  /** Version of the running app, stamped from the git tag at build time. */
  /**
   * How many images below `folderPath` already have a current-format thumbnail
   * on disk.
   *
   * Thumbnails are generated lazily, per visible cell, so this is the only way
   * to open a half-culled folder and report "1725 of 3470" instead of starting
   * the counter at zero. Counted from the cache directories, using the same
   * suffix rule the vacuum uses, so a past format never inflates it.
   */
  countThumbCache: (folderPath: string) => Promise<number>;
  getAppVersion: () => Promise<string>;
}
