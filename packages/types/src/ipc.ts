import type { ImageFileInfo } from './image';
import type { DetailedMetadata } from './focus';

export const IPC_CHANNELS = {
  SELECT_FOLDER: 'dialog:select-folder',
  SCAN_FOLDER: 'fs:scan-folder',
  SAVE_RESULTS: 'fs:save-results',
  LOAD_RESULTS: 'fs:load-results',
  CLEAR_RESULTS: 'fs:clear-results',
  GET_SESSION: 'store:get-session',
  SET_SESSION: 'store:set-session',
  DELETE_FILES: 'fs:delete-files',
  READ_FILE: 'fs:read-file',
  LOAD_THUMB_CACHE: 'fs:load-thumb-cache',
  SAVE_THUMB_CACHE: 'fs:save-thumb-cache',
  ROTATE_FILES: 'fs:rotate-files',
  WRITE_RATING: 'fs:write-rating',
  CLEAN_UP_FOLDER: 'fs:clean-up-folder',
  READ_DETAILED_METADATA: 'meta:read-detailed',
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
  scanFolder: (folderPath: string) => Promise<ImageFileInfo[]>;
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
  getAppVersion: () => Promise<string>;
}
