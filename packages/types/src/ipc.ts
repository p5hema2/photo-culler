import type { ImageFileInfo } from './image';

export const IPC_CHANNELS = {
  SELECT_FOLDER: 'dialog:select-folder',
  SCAN_FOLDER: 'fs:scan-folder',
  TRASH_FILES: 'fs:trash-files',
} as const;

export interface TrashResult {
  /** Paths that were successfully trashed */
  succeeded: string[];
  /** Paths that failed with their error messages */
  failed: Array<{ path: string; error: string }>;
}

export interface ElectronAPI {
  selectFolder: () => Promise<string | null>;
  scanFolder: (folderPath: string) => Promise<ImageFileInfo[]>;
  trashFiles: (filePaths: string[]) => Promise<TrashResult>;
}
