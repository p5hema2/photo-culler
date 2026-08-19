import { app, ipcMain, dialog, shell } from 'electron';
import { writeFile, readFile, mkdir, rename, unlink, stat, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { IPC_CHANNELS } from '@photo-culler/types';
import type { SessionConfig, TrashResult } from '@photo-culler/types';
import { scanFolder } from '@photo-culler/image-utils';
import { getSession, updateSession } from './store';
import { readDetailedMetadata } from './exiftool';

const RESULTS_FILENAME = '.photo-culler-results.json';
/** Pre-1.2.0 name. Read once and migrated to RESULTS_FILENAME on first load. */
const LEGACY_RESULTS_FILENAME = 'photo-culler-results.json';
const THUMB_CACHE_DIR = '.photo-culler-thumbs';
/**
 * Bump when the thumbnail PIXEL FORMAT changes. Thumbnails live in a version
 * subdirectory so an old build's output can never be served by a new one, and
 * so the vacuum can delete every non-current entry without knowing anything
 * about past formats.
 *
 *   (implicit v1) 256x256 centre-cropped, written loose in THUMB_CACHE_DIR
 *   v2            longest edge 256, aspect ratio preserved
 */
const THUMB_CACHE_VERSION = 'v2';
const THUMB_SUFFIX = '.thumb.jpg';

function isEnoent(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === 'ENOENT';
}

/**
 * Read the results file, transparently migrating the pre-1.2.0 filename.
 *
 * Folders culled with an earlier version hold `photo-culler-results.json`.
 * Renaming it on first read means existing work is never lost and the
 * migration happens exactly once per folder.
 */
export async function readResultsFile(folderPath: string): Promise<string | null> {
  const currentPath = path.join(folderPath, RESULTS_FILENAME);
  try {
    return await readFile(currentPath, 'utf-8');
  } catch (err) {
    if (!isEnoent(err)) throw err;
  }

  const legacyPath = path.join(folderPath, LEGACY_RESULTS_FILENAME);
  let legacyData: string;
  try {
    legacyData = await readFile(legacyPath, 'utf-8');
  } catch (err) {
    if (isEnoent(err)) return null;
    throw err;
  }

  try {
    await rename(legacyPath, currentPath);
  } catch {
    // Migration is best-effort — a failed rename must not cost the user
    // their classifications, so fall through and return the data anyway.
  }
  return legacyData;
}

/** `<imageDir>/.photo-culler-thumbs` — the cache root for one directory. */
export function getThumbCacheDir(imageDir: string): string {
  return path.join(imageDir, THUMB_CACHE_DIR);
}

/** `<imageDir>/.photo-culler-thumbs/v2/<name>.thumb.jpg` */
export function getThumbCachePath(filePath: string): string {
  const dir = path.dirname(filePath);
  const name = path.basename(filePath);
  return path.join(getThumbCacheDir(dir), THUMB_CACHE_VERSION, `${name}${THUMB_SUFFIX}`);
}

/** Best-effort removal — a cache problem must never fail the caller's operation. */
async function unlinkQuiet(target: string): Promise<void> {
  try {
    await unlink(target);
  } catch {
    // ignored on purpose
  }
}

/** Drop the cached thumbnail of an image that no longer exists at this path. */
async function removeThumbCache(filePath: string): Promise<void> {
  await unlinkQuiet(getThumbCachePath(filePath));
}

/**
 * Follow a thumbnail to its image's new location.
 *
 * Both directories sit on the same volume (picks/ is a subdirectory), so the
 * rename is O(1). On any failure the source is dropped instead: the worst case
 * is one regenerated thumbnail, never a stale or orphaned one.
 */
async function relocateThumbCache(fromPath: string, toPath: string): Promise<void> {
  const from = getThumbCachePath(fromPath);
  const to = getThumbCachePath(toPath);
  try {
    await mkdir(path.dirname(to), { recursive: true });
    await rename(from, to);
  } catch {
    await unlinkQuiet(from);
  }
}

/**
 * Delete cache entries that no longer correspond to an image, plus every entry
 * written by a different cache version.
 *
 * Driven entirely by directory listings in the main process — it has no idea
 * that renderer-side filters exist, so it can never delete a thumbnail merely
 * because its image is currently hidden.
 */
export async function vacuumThumbCache(folderPath: string): Promise<{ removed: number }> {
  let removed = 0;

  for (const imageDir of [folderPath, path.join(folderPath, 'picks')]) {
    const cacheDir = getThumbCacheDir(imageDir);

    let cacheEntries;
    try {
      cacheEntries = await readdir(cacheDir, { withFileTypes: true });
    } catch {
      continue; // no cache in this directory
    }

    // CRITICAL: if the image directory cannot be listed, delete nothing. A
    // transient EPERM or a disconnected network drive must never be read as
    // "no source images exist" — that would wipe the whole cache. A successful
    // listing that returns zero images is a legitimate "all orphaned" signal.
    let present: Set<string>;
    try {
      present = new Set((await readdir(imageDir)).map((n) => n.toLowerCase()));
    } catch {
      continue;
    }

    // Anything that is not the current version directory is from a past format.
    for (const entry of cacheEntries) {
      if (entry.name === THUMB_CACHE_VERSION) continue;
      try {
        await rm(path.join(cacheDir, entry.name), { recursive: true, force: true });
        removed++;
      } catch {
        // ignored on purpose
      }
    }

    const versionDir = path.join(cacheDir, THUMB_CACHE_VERSION);
    let thumbs: string[];
    try {
      thumbs = await readdir(versionDir);
    } catch {
      continue;
    }

    for (const thumb of thumbs) {
      if (!thumb.endsWith(THUMB_SUFFIX)) continue;
      const source = thumb.slice(0, -THUMB_SUFFIX.length);
      if (present.has(source.toLowerCase())) continue;
      await unlinkQuiet(path.join(versionDir, thumb));
      removed++;
    }
  }

  return { removed };
}

/**
 * Run the vacuum a little after a scan rather than during it.
 *
 * On the first open after an upgrade there can be tens of thousands of stale
 * entries; competing with the initial burst of thumbnail generation would make
 * for a bad first impression. Steady state this is two readdirs and no unlinks.
 */
const vacuumTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleVacuum(folderPath: string): void {
  const existing = vacuumTimers.get(folderPath);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    vacuumTimers.delete(folderPath);
    void vacuumThumbCache(folderPath).catch(() => {
      // best-effort housekeeping
    });
  }, 5000);
  timer.unref?.();
  vacuumTimers.set(folderPath, timer);
}

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
    const images = await scanFolder(folderPath);
    scheduleVacuum(folderPath);
    return images;
  });

  ipcMain.handle(IPC_CHANNELS.SAVE_RESULTS, async (_event, folderPath: string, data: string) => {
    await writeResultsFile(folderPath, data);
  });

  ipcMain.handle(IPC_CHANNELS.LOAD_RESULTS, async (_event, folderPath: string) => {
    return readResultsFile(folderPath);
  });

  ipcMain.handle(IPC_CHANNELS.CLEAR_RESULTS, async (_event, folderPath: string) => {
    // Drop a queued write before unlinking, otherwise the queue drains after
    // the delete and writes the data straight back. Deleting the map entry
    // would not help — an in-flight write holds the queue object directly.
    const queue = writeQueues.get(path.join(folderPath, RESULTS_FILENAME));
    if (queue) queue.pending = null;

    // Remove both names so a rescan cannot be undone by a lingering legacy file
    for (const name of [RESULTS_FILENAME, LEGACY_RESULTS_FILENAME]) {
      try {
        await unlink(path.join(folderPath, name));
      } catch (err) {
        if (!isEnoent(err)) throw err;
      }
    }
  });

  ipcMain.handle(IPC_CHANNELS.READ_DETAILED_METADATA, async (_event, filePath: string) => {
    return readDetailedMetadata(filePath);
  });

  ipcMain.handle(IPC_CHANNELS.VACUUM_THUMB_CACHE, async (_event, folderPath: string) => {
    return vacuumThumbCache(folderPath);
  });

  ipcMain.handle(IPC_CHANNELS.GET_APP_VERSION, async () => {
    return app.getVersion();
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
          // The only place that knows both paths — the renderer never learns
          // the destination, so without this the old thumbnail is orphaned and
          // a duplicate is regenerated under picks/.
          await relocateThumbCache(filePath, destPath);
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
        // Only after the source op succeeded — a failed trash must not orphan
        // the thumbnail of a file that still exists. Thumbnails are unlinked
        // rather than trashed: derived data does not belong in the user's
        // Recycle Bin next to their photos.
        await removeThumbCache(filePath);
      } catch (err) {
        result.failed.push({
          path: filePath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return result;
  });

  ipcMain.handle(IPC_CHANNELS.READ_FILE, async (_event, filePath: string) => {
    const buffer = await readFile(filePath);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  });

  ipcMain.handle(IPC_CHANNELS.DELETE_FILES, async (_event, filePaths: string[]) => {
    const result: TrashResult = { succeeded: [], failed: [] };

    for (const filePath of filePaths) {
      try {
        await unlink(filePath);
        result.succeeded.push(filePath);
        await removeThumbCache(filePath);
      } catch (err) {
        result.failed.push({
          path: filePath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return result;
  });

  ipcMain.handle(IPC_CHANNELS.LOAD_THUMB_CACHE, async (_event, filePath: string) => {
    const thumbPath = getThumbCachePath(filePath);
    try {
      // Compare against the source's CURRENT mtime rather than a value the
      // renderer captured at scan time. ROTATE_FILES rewrites the file after
      // the scan, so the old comparison kept validating the pre-rotation
      // thumbnail forever. This also covers edits made outside the app.
      const [thumbStat, sourceStat] = await Promise.all([stat(thumbPath), stat(filePath)]);
      if (thumbStat.mtimeMs < sourceStat.mtimeMs) return null;
      const buffer = await readFile(thumbPath);
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    } catch {
      return null;
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.SAVE_THUMB_CACHE,
    async (_event, filePath: string, jpegBuffer: ArrayBuffer) => {
      const thumbPath = getThumbCachePath(filePath);
      await mkdir(path.dirname(thumbPath), { recursive: true });
      await writeFile(thumbPath, Buffer.from(jpegBuffer));
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.ROTATE_FILES,
    async (_event, files: Array<{ path: string; degrees: number }>) => {
      const succeeded: string[] = [];
      const failed: Array<{ path: string; error: string }> = [];

      for (const file of files) {
        if (file.degrees === 0) {
          succeeded.push(file.path);
          continue;
        }
        try {
          const buffer = await readFile(file.path);
          const rotated = await sharp(buffer).rotate(file.degrees).withMetadata().toBuffer();
          await writeFile(file.path, rotated);
          succeeded.push(file.path);
          await removeThumbCache(file.path);
        } catch (err) {
          failed.push({
            path: file.path,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return { succeeded, failed };
    },
  );
}
