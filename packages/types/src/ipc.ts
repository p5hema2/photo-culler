import type { ImageFileInfo } from './image';

export const IPC_CHANNELS = {
  SELECT_FOLDER: 'dialog:select-folder',
  SCAN_FOLDER: 'fs:scan-folder',
  TRASH_FILES: 'fs:trash-files',
  SAVE_RESULTS: 'fs:save-results',
  LOAD_RESULTS: 'fs:load-results',
  GET_SESSION: 'store:get-session',
  SET_SESSION: 'store:set-session',
  MOVE_TO_PICKS: 'fs:move-to-picks',
} as const;

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
}

export interface ImageResult {
  /** Classification assigned to the image */
  classification: 'keep' | 'review' | 'delete';
  /** Whether the user manually overrode the auto-classification */
  userOverride: boolean;
  /** Quality score from auto-classification (0-1) */
  qualityScore?: number;
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
  getSession: () => Promise<SessionConfig>;
  setSession: (config: Partial<SessionConfig>) => Promise<void>;
  moveToPicks: (
    folderPath: string,
    filePaths: string[],
  ) => Promise<{ succeeded: string[]; failed: Array<{ path: string; error: string }> }>;
}
