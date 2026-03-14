import { ipcMain, dialog, shell } from 'electron';
import { writeFile, readFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { IPC_CHANNELS } from '@photo-culler/types';
import type { SessionConfig, TrashResult } from '@photo-culler/types';
import { scanFolder } from '@photo-culler/image-utils';
import { getSession, updateSession } from './store';

const RESULTS_FILENAME = 'photo-culler-results.json';

/**
 * Simple write queue to avoid concurrent writes to the same results file.
 */
const writeQueues = new Map<string, { inFlight: boolean; pending: string | null }>();

async function writeResultsFile(folderPath: string, data: string): Promise<void> {
  const filePath = path.join(folderPath, RESULTS_FILENAME);
  let queue = writeQueues.get(filePath);
  if (!queue) {
    queue = { inFlight: false, pending: null };
    writeQueues.set(filePath, queue);
  }

  if (queue.inFlight) {
    queue.pending = data;
    return;
  }

  queue.inFlight = true;
  try {
    await writeFile(filePath, data, 'utf-8');
  } finally {
    queue.inFlight = false;
    const pendingData = queue.pending;
    if (pendingData !== null) {
      queue.pending = null;
      await writeResultsFile(folderPath, pendingData);
    }
  }
}

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

  ipcMain.handle(IPC_CHANNELS.SCAN_FOLDER, async (_event, folderPath: string) => {
    return scanFolder(folderPath);
  });

  ipcMain.handle(IPC_CHANNELS.SAVE_RESULTS, async (_event, folderPath: string, data: string) => {
    await writeResultsFile(folderPath, data);
  });

  ipcMain.handle(IPC_CHANNELS.LOAD_RESULTS, async (_event, folderPath: string) => {
    const filePath = path.join(folderPath, RESULTS_FILENAME);
    try {
      return await readFile(filePath, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  });

  ipcMain.handle(IPC_CHANNELS.GET_SESSION, async () => {
    return getSession();
  });

  ipcMain.handle(IPC_CHANNELS.SET_SESSION, async (_event, partial: Partial<SessionConfig>) => {
    updateSession(partial);
  });

  ipcMain.handle(
    IPC_CHANNELS.MOVE_TO_PICKS,
    async (_event, folderPath: string, filePaths: string[]) => {
      const picksDir = path.join(folderPath, 'picks');
      await mkdir(picksDir, { recursive: true });

      const succeeded: string[] = [];
      const failed: Array<{ path: string; error: string }> = [];

      for (const filePath of filePaths) {
        const destPath = path.join(picksDir, path.basename(filePath));
        try {
          await rename(filePath, destPath);
          succeeded.push(filePath);
        } catch (err) {
          failed.push({
            path: filePath,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return { succeeded, failed };
    },
  );

  ipcMain.handle(IPC_CHANNELS.TRASH_FILES, async (_event, filePaths: string[]) => {
    const result: TrashResult = { succeeded: [], failed: [] };

    for (const filePath of filePaths) {
      try {
        await shell.trashItem(filePath);
        result.succeeded.push(filePath);
      } catch (err) {
        result.failed.push({
          path: filePath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return result;
  });
}
