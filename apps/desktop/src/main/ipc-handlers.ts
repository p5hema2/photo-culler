import { ipcMain, dialog } from 'electron';
import { IPC_CHANNELS } from '@photo-culler/types';

/**
 * Register all IPC handlers for the main process.
 * Each handler corresponds to a channel defined in @photo-culler/types.
 */
export function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.SELECT_FOLDER, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0] ?? null;
  });

  // Placeholder -- implemented in Phase 2
  ipcMain.handle(IPC_CHANNELS.SCAN_FOLDER, async (_event, _folderPath: string) => {
    return [];
  });

  // Placeholder -- implemented in Phase 3
  ipcMain.handle(IPC_CHANNELS.TRASH_FILES, async (_event, _filePaths: string[]) => {
    return { succeeded: [], failed: [] };
  });
}
