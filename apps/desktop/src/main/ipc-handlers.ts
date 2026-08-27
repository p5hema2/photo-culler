import { app, ipcMain, dialog } from 'electron';
import { writeFile, readFile, mkdir, rename, unlink, stat, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { IPC_CHANNELS } from '@photo-culler/types';
import type { FileOpResult, SessionConfig } from '@photo-culler/types';
import { scanFolder } from '@photo-culler/image-utils';
import { getSession, updateSession } from './store';
import { readDetailedMetadata, writeRating, type RatingWriteResult } from './exiftool';
import { withFileLock } from './file-lock';

const RESULTS_FILENAME = '.photo-culler-results.json';
/** Pre-1.2.0 name. Read once and migrated to RESULTS_FILENAME on first load. */
const LEGACY_RESULTS_FILENAME = 'photo-culler-results.json';
const THUMB_CACHE_DIR = '.photo-culler-thumbs';
/**
 * Suffix of a current-format thumbnail — and the only marker of that format.
 *
 * Change it whenever the pixel format changes. It is what makes an entry from
 * a past format *unfindable* to a new build rather than silently servable: the
 * loader asks for this exact name and nothing else, so a leftover cannot be
 * mistaken for a fresh thumbnail however new its mtime is. That replaces the
 * version subdirectory this cache used up to 1.5.1, and it is why there is no
 * fallback path to read one.
 *
 * Everything else in the cache directory is legacy by definition — see
 * `partitionCacheEntries`. Formats so far:
 *
 *   pre-1.3.0     256x256 centre-cropped JPEG, loose in THUMB_CACHE_DIR
 *   1.3.0-1.5.1   longest edge 256 JPEG, in a `v2/` subdirectory
 *   1.5.2+        longest edge 512 WebP, loose in THUMB_CACHE_DIR
 */
const THUMB_SUFFIX = '.thumb.webp';

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
    // their scores and rotations, so fall through and return the data anyway.
  }
  return legacyData;
}

/** `<imageDir>/.photo-culler-thumbs` — the cache root for one directory. */
export function getThumbCacheDir(imageDir: string): string {
  return path.join(imageDir, THUMB_CACHE_DIR);
}

/** `<imageDir>/.photo-culler-thumbs/<name>.thumb.webp` */
export function getThumbCachePath(filePath: string): string {
  const dir = path.dirname(filePath);
  const name = path.basename(filePath);
  return path.join(getThumbCacheDir(dir), `${name}${THUMB_SUFFIX}`);
}

/** The shape of a `readdir(…, { withFileTypes: true })` entry we depend on. */
interface CacheDirEntry {
  name: string;
  isDirectory: () => boolean;
}

/**
 * Split one cache directory listing into current-format thumbnails and the
 * remains of earlier ones.
 *
 * Legacy is defined by exclusion rather than by a list of past formats: a
 * subdirectory (the `v2/` layout) or a file without the current suffix (an
 * older `.thumb.jpg`). A future format change therefore needs no migration
 * code — only a new THUMB_SUFFIX.
 */
function partitionCacheEntries(entries: readonly CacheDirEntry[]): {
  thumbs: string[];
  legacy: string[];
} {
  const thumbs: string[] = [];
  const legacy: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() && entry.name.endsWith(THUMB_SUFFIX)) {
      thumbs.push(entry.name);
    } else {
      legacy.push(entry.name);
    }
  }

  return { thumbs, legacy };
}

/** Name of the image a current-format thumbnail describes. */
function sourceNameOfThumb(thumbName: string): string {
  return thumbName.slice(0, -THUMB_SUFFIX.length);
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
 * Delete cache entries that no longer correspond to an image, plus every entry
 * written by a different cache version.
 *
 * Driven entirely by directory listings in the main process — it has no idea
 * that renderer-side filters exist, so it can never delete a thumbnail merely
 * because its image is currently hidden.
 */
/**
 * Directories the scanner would visit, so the vacuum covers exactly the same
 * tree. Hidden directories are skipped, which keeps the cache dirs themselves
 * out of the walk.
 */
async function imageDirectories(rootPath: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dirPath: string): Promise<void> => {
    if (found.length >= 2000) return;
    found.push(dirPath);
    let entries;
    try {
      entries = await readdir(dirPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      await walk(path.join(dirPath, entry.name));
    }
  };
  await walk(rootPath);
  return found;
}

/** What a clean-up would remove. Computed first so the user can confirm it. */
export interface CleanUpPlan {
  /** Absolute paths of thumbnails whose source image is gone. */
  thumbs: string[];
  /**
   * Cache entries left by an older thumbnail format — a `v2/` directory, or a
   * loose file with a past suffix. Counted separately from `thumbs` because one
   * such directory can hold thousands of them.
   */
  legacyCacheEntries: string[];
  /** Results files and the entries in them that describe missing images. */
  results: Array<{ file: string; names: string[] }>;
  /** Directories inspected, for the summary. */
  directoriesScanned: number;
}

/**
 * Work out what is orphaned below `rootPath`, without deleting anything.
 *
 * Deliberately conservative at every step: a directory that cannot be listed is
 * skipped entirely, and only entries with no corresponding file are proposed.
 */
export async function planCleanUp(rootPath: string): Promise<CleanUpPlan> {
  const plan: CleanUpPlan = {
    thumbs: [],
    legacyCacheEntries: [],
    results: [],
    directoriesScanned: 0,
  };

  for (const imageDir of await imageDirectories(rootPath)) {
    plan.directoriesScanned++;

    // Thumbnails AND records are checked against this one listing: a directory's
    // results file describes exactly its own files. A second readdir used to
    // union in `picks/`, because Execute moved keeps there and the scanner filed
    // them back under the parent — both are gone with the keep feature.
    let ownNames: Set<string>;
    try {
      ownNames = new Set((await readdir(imageDir)).map((n) => n.toLowerCase()));
    } catch {
      continue;
    }

    const cacheDir = getThumbCacheDir(imageDir);
    let cacheEntries: CacheDirEntry[] | null;
    try {
      cacheEntries = await readdir(cacheDir, { withFileTypes: true });
    } catch {
      cacheEntries = null; // no cache in this directory
    }

    if (cacheEntries) {
      const { thumbs, legacy } = partitionCacheEntries(cacheEntries);

      for (const name of legacy) {
        plan.legacyCacheEntries.push(path.join(cacheDir, name));
      }

      for (const name of thumbs) {
        if (!ownNames.has(sourceNameOfThumb(name).toLowerCase())) {
          plan.thumbs.push(path.join(cacheDir, name));
        }
      }
    }

    for (const filename of [RESULTS_FILENAME, LEGACY_RESULTS_FILENAME]) {
      const file = path.join(imageDir, filename);
      let parsed: { images?: Record<string, unknown> };
      try {
        parsed = JSON.parse(await readFile(file, 'utf-8'));
      } catch {
        continue; // absent or unreadable — leave it alone
      }
      if (!parsed || typeof parsed.images !== 'object' || parsed.images === null) continue;

      const orphaned = Object.keys(parsed.images).filter(
        (name) => !ownNames.has(name.toLowerCase()),
      );
      if (orphaned.length > 0) plan.results.push({ file, names: orphaned });
    }
  }

  return plan;
}

/** Carry out a plan. Each step is best-effort; a failure never aborts the rest. */
export async function applyCleanUp(
  plan: CleanUpPlan,
): Promise<{ thumbsRemoved: number; legacyRemoved: number; entriesRemoved: number }> {
  let thumbsRemoved = 0;
  let legacyRemoved = 0;
  let entriesRemoved = 0;

  // `rm` rather than `unlink`: a legacy entry is a `v2/` directory as often as
  // it is a single file from an older format.
  for (const entry of plan.legacyCacheEntries) {
    try {
      await rm(entry, { recursive: true, force: true });
      legacyRemoved++;
    } catch {
      // ignored on purpose
    }
  }

  for (const thumb of plan.thumbs) {
    await unlinkQuiet(thumb);
    thumbsRemoved++;
  }

  for (const { file, names } of plan.results) {
    try {
      const parsed = JSON.parse(await readFile(file, 'utf-8'));
      // Re-read rather than trusting the plan's snapshot: the debounced save
      // may have rewritten the file since, and dropping only the named keys
      // preserves whatever else landed in the meantime.
      for (const name of names) {
        if (name in parsed.images) {
          delete parsed.images[name];
          entriesRemoved++;
        }
      }
      parsed.updatedAt = new Date().toISOString();
      await writeFile(file, `${JSON.stringify(parsed, null, 2)}\n`, 'utf-8');
    } catch {
      // ignored on purpose
    }
  }

  return { thumbsRemoved, legacyRemoved, entriesRemoved };
}

export async function vacuumThumbCache(folderPath: string): Promise<{ removed: number }> {
  let removed = 0;

  for (const imageDir of await imageDirectories(folderPath)) {
    const cacheDir = getThumbCacheDir(imageDir);

    let cacheEntries: CacheDirEntry[];
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

    const { thumbs, legacy } = partitionCacheEntries(cacheEntries);

    // Anything that is not a current-format thumbnail was written by a past
    // format and can never be served again — see THUMB_SUFFIX.
    for (const name of legacy) {
      try {
        await rm(path.join(cacheDir, name), { recursive: true, force: true });
        removed++;
      } catch {
        // ignored on purpose
      }
    }

    for (const name of thumbs) {
      if (present.has(sourceNameOfThumb(name).toLowerCase())) continue;
      await unlinkQuiet(path.join(cacheDir, name));
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
    // Rescan means "forget everything below here", so every folder in the tree
    // loses its file — not only the one the user picked.
    const directories = await imageDirectories(folderPath);
    for (const dir of directories.slice(1)) {
      for (const name of [RESULTS_FILENAME, LEGACY_RESULTS_FILENAME]) {
        await unlinkQuiet(path.join(dir, name));
      }
    }

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

  ipcMain.handle(IPC_CHANNELS.CLEAN_UP_FOLDER, async (_event, folderPath: string) => {
    const plan = await planCleanUp(folderPath);
    const thumbCount = plan.thumbs.length;
    const legacyCount = plan.legacyCacheEntries.length;
    const entryCount = plan.results.reduce((sum, r) => sum + r.names.length, 0);

    if (thumbCount === 0 && legacyCount === 0 && entryCount === 0) {
      await dialog.showMessageBox({
        type: 'info',
        title: 'Clean Up',
        message: 'Nothing to clean up',
        detail:
          `Scanned ${plan.directoriesScanned} folder(s). Every cached thumbnail and ` +
          'saved record still has its image.',
        buttons: ['OK'],
      });
      return { thumbsRemoved: 0, legacyRemoved: 0, entriesRemoved: 0, cancelled: false };
    }

    // Removing saved records discards quality scores and pending rotations for
    // those images. Show the count and let the user decide before touching disk.
    const detail = [
      `Scanned ${plan.directoriesScanned} folder(s).`,
      '',
      `${thumbCount} cached thumbnail(s) whose image is gone`,
      // A single legacy entry can be a whole `v2/` directory holding thousands
      // of thumbnails, so it gets its own line instead of inflating the count
      // above by one.
      ...(legacyCount > 0
        ? [`${legacyCount} cache item(s) left by an older thumbnail format`]
        : []),
      `${entryCount} saved record(s) whose image is gone`,
      '',
      'Records hold quality scores and pending rotations. Images themselves are never ' +
        'touched, and star ratings live in the image files rather than in a record.',
    ].join('\n');

    const { response } = await dialog.showMessageBox({
      type: 'warning',
      title: 'Clean Up',
      message: 'Remove orphaned thumbnails and records?',
      detail,
      buttons: ['Cancel', 'Remove'],
      defaultId: 0,
      cancelId: 0,
    });

    if (response !== 1) {
      return { thumbsRemoved: 0, legacyRemoved: 0, entriesRemoved: 0, cancelled: true };
    }

    const result = await applyCleanUp(plan);
    return { ...result, cancelled: false };
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

  ipcMain.handle(IPC_CHANNELS.READ_FILE, async (_event, filePath: string) => {
    // Under the per-path lock so a rating write cannot land while a thumbnail,
    // scoring or preview read holds this file open. exiftool writes by renaming
    // a temp over the original, and on Windows an open handle fails that rename.
    // Different files still read fully in parallel — only same-file work queues.
    return withFileLock(filePath, async () => {
      const buffer = await readFile(filePath);
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    });
  });

  ipcMain.handle(
    IPC_CHANNELS.WRITE_RATING,
    async (_event, filePath: string, rating: number): Promise<RatingWriteResult> => {
      return withFileLock(filePath, () => writeRating(filePath, rating));
    },
  );

  ipcMain.handle(IPC_CHANNELS.DELETE_FILES, async (_event, filePaths: string[]) => {
    const result: FileOpResult = { succeeded: [], failed: [] };

    for (const filePath of filePaths) {
      try {
        await unlink(filePath);
        result.succeeded.push(filePath);
        // Only after the delete succeeded — a failed unlink must not orphan the
        // thumbnail of a file that still exists.
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
    async (_event, filePath: string, thumbBuffer: ArrayBuffer) => {
      const thumbPath = getThumbCachePath(filePath);
      await mkdir(path.dirname(thumbPath), { recursive: true });
      await writeFile(thumbPath, Buffer.from(thumbBuffer));
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
