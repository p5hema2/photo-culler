import type { ImageFileInfo } from './image';
import type { DetailedMetadata } from './focus';

export const IPC_CHANNELS = {
  SELECT_FOLDER: 'dialog:select-folder',
  SCAN_FOLDER: 'fs:scan-folder',
  TRASH_FILES: 'fs:trash-files',
  SAVE_RESULTS: 'fs:save-results',
  LOAD_RESULTS: 'fs:load-results',
  CLEAR_RESULTS: 'fs:clear-results',
  GET_SESSION: 'store:get-session',
  SET_SESSION: 'store:set-session',
  MOVE_TO_PICKS: 'fs:move-to-picks',
  DELETE_FILES: 'fs:delete-files',
  READ_FILE: 'fs:read-file',
  LOAD_THUMB_CACHE: 'fs:load-thumb-cache',
  SAVE_THUMB_CACHE: 'fs:save-thumb-cache',
  ROTATE_FILES: 'fs:rotate-files',
  VACUUM_THUMB_CACHE: 'fs:vacuum-thumb-cache',
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
  'vacuum-thumbs',
  'toggle-focus-peaking',
  'toggle-clipping',
  'toggle-af-point',
] as const;

export type MenuCommand = (typeof MENU_COMMANDS)[number];

export interface TrashResult {
  /** Paths that were successfully trashed */
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

export interface ImageResult {
  /** Classification assigned to the image (null = unclassified) */
  classification: 'keep' | 'review' | 'delete' | null;
  /** Whether the user manually overrode the auto-classification */
  userOverride: boolean;
  /** Quality score from auto-classification (0-100) */
  qualityScore?: number;
  /** Individual metric scores (0-100 each) */
  qualitySubscores?: QualitySubscores;
  /** Visual rotation in degrees (0, 90, 180, 270) */
  rotation?: number;
  /** Star rating (1-5), auto-assigned from quality score or manually overridden */
  starRating?: number;
  /** Cached EXIF metadata extracted from the image */
  exif?: {
    dateTaken?: number;
    dateTakenLocal?: number;
    timezoneOffset?: string;
    width?: number;
    height?: number;
    cameraMake?: string;
    cameraModel?: string;
    lensModel?: string;
    focalLength?: number;
    aperture?: number;
    shutterSpeed?: string;
    iso?: number;
    exposureCompensation?: number;
    flash?: string;
    whiteBalance?: string;
    meteringMode?: string;
    exposureProgram?: string;
    colorSpace?: string;
  };
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
  trashFiles: (filePaths: string[]) => Promise<TrashResult>;
  saveResults: (folderPath: string, data: string) => Promise<void>;
  loadResults: (folderPath: string) => Promise<string | null>;
  /** Delete the results file for a folder (used by Rescan). */
  clearResults: (folderPath: string) => Promise<void>;
  getSession: () => Promise<SessionConfig>;
  setSession: (config: Partial<SessionConfig>) => Promise<void>;
  moveToPicks: (
    folderPath: string,
    filePaths: string[],
  ) => Promise<{ succeeded: string[]; failed: Array<{ path: string; error: string }> }>;
  deleteFiles: (filePaths: string[]) => Promise<TrashResult>;
  readFile: (filePath: string) => Promise<ArrayBuffer>;
  /**
   * Cached thumbnail for a file, or null when absent or stale.
   * Freshness is decided in the main process against the source file's current
   * mtime — the renderer's scan-time value went stale after a rotation.
   */
  loadThumbCache: (filePath: string) => Promise<ArrayBuffer | null>;
  saveThumbCache: (filePath: string, jpegBuffer: ArrayBuffer) => Promise<void>;
  rotateFiles: (
    files: Array<{ path: string; degrees: number }>,
  ) => Promise<{ succeeded: string[]; failed: Array<{ path: string; error: string }> }>;
  /**
   * Deep metadata for one image, read on demand via exiftool in the main
   * process. Resolves null when exiftool is unavailable or the file yields
   * nothing usable.
   */
  readDetailedMetadata: (filePath: string) => Promise<DetailedMetadata | null>;
  /** Delete orphaned and outdated cached thumbnails for a folder. */
  vacuumThumbCache: (folderPath: string) => Promise<{ removed: number }>;
  /** Version of the running app, stamped from the git tag at build time. */
  getAppVersion: () => Promise<string>;
}
