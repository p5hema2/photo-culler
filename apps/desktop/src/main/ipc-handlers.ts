import { app, ipcMain, dialog, shell } from 'electron';
import {
  writeFile,
  readFile,
  mkdir,
  open,
  rename,
  unlink,
  stat,
  readdir,
  rm,
  type FileHandle,
} from 'node:fs/promises';
import path from 'node:path';
import { IPC_CHANNELS } from '@photo-culler/types';
import type {
  FileOpResult,
  PruneResult,
  RotateDirection,
  RotateResult,
  ScanProgress,
  SessionConfig,
  ThumbSource,
  ThumbSourceFallback,
} from '@photo-culler/types';
import { scanFolder } from '@photo-culler/image-utils';
// Deep import: `mpf.ts` holds the parsing, and `./metadata` is the entry point
// this package's `exports` map publishes for it. See the note there.
import {
  findMpfPreview,
  isPlausiblePreviewRange,
  checkMpfPreview,
} from '@photo-culler/image-utils/metadata';
import { getSession, updateSession } from './store';
import { readDetailedMetadata, rotateImage, writeRating, type RatingWriteResult } from './exiftool';
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
 *
 * Sourcing thumbnail pixels from the camera's embedded preview rather than from
 * the original — see `readThumbSource` — deliberately did NOT change it, and the
 * reason is worth recording. `fitWithin` decides geometry from the source's
 * aspect ratio alone, so a 1620x1080 preview and the 6000x4000 original it came
 * from both yield exactly 512x341; same for 4000x3000/1600x1200 and
 * 5472x3648/1824x1216. Container and quality are untouched. What does differ is
 * resampling detail, because the reduction is 3.2x instead of 11.7x, so the
 * encoded bytes are not identical — but an entry written either way is a valid
 * current-format thumbnail, and bumping the suffix would discard every user's
 * cache (235 s of generation on the folder that motivated all this) to gain an
 * imperceptible difference. Only a change to the geometry, container or quality
 * belongs here.
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
    // their quality scores, so fall through and return the data anyway.
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

/**
 * Drop the cached thumbnail of one image.
 *
 * Two callers, for two reasons: the image is gone (delete), or the image still
 * exists but no longer looks like its thumbnail (rotate).
 */
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

/**
 * The deferred metadata pass of the most recent scan, so the next scan can stop
 * it. One at a time by construction: there is one window and it shows one tree.
 */
let activeScanPass: AbortController | null = null;

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
 * Forget a write queued for one results file, by absolute file path.
 *
 * Deleting the map entry would not do it: a write already in flight holds the
 * queue object directly and would go on to drain whatever `pending` still held.
 */
function dropQueuedWrite(resultsFilePath: string): void {
  const queue = writeQueues.get(resultsFilePath);
  if (queue) queue.pending = null;
}

/**
 * Leading bytes read while looking for an embedded preview.
 *
 * The MPF index lives in an APP2 segment near the front of a camera JPEG —
 * normally only APP1 (EXIF plus its 160x120 IFD1 thumbnail) is ahead of it — so
 * this window is deliberately generous. It is pure overhead on a file that has
 * no preview, but 128 kB against the measured 6.2 MB average is ~2%, whereas a
 * window too small to reach the index would cost the whole optimisation
 * silently: an unreachable index is indistinguishable from an absent one.
 */
const THUMB_SOURCE_HEAD_BYTES = 128 * 1024;

/**
 * Copy out to a plain ArrayBuffer for the structured clone across IPC. A copy
 * either way — `Buffer.prototype.buffer` is an ArrayBufferLike over a possibly
 * pooled allocation, so it cannot be handed over as it stands.
 */
function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const copy = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(copy).set(buffer);
  return copy;
}

/**
 * Read up to `length` bytes from `position`, looping because a short read is
 * legal even on a regular file. Returns whatever it actually got.
 */
async function readRange(handle: FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.allocUnsafe(length);
  let filled = 0;
  while (filled < length) {
    const { bytesRead } = await handle.read(buffer, filled, length - filled, position + filled);
    if (bytesRead === 0) break;
    filled += bytesRead;
  }
  return buffer.subarray(0, filled);
}

/**
 * Read the bytes a thumbnail should be generated from.
 *
 * Generating from the original meant reading 6.2 MB and decoding 6000x4000
 * (measured 94 ms) for a 19 kB result — a 270:1 read amplification, and why the
 * first open of the folder that motivated this spent 235 s disk-bound at
 * ~45 MB/s. Where the camera embedded a 1620x1080 MPF preview (417-544 kB,
 * 11.6 ms to decode) this reads that byte range instead.
 *
 * The fallback is not optional and not an error path: a PNG, a TIFF, a stripped
 * JPEG or an unfamiliar camera must keep behaving exactly as before, so every
 * way of not getting a preview ends in the whole file plus a named reason. The
 * decoder is the last of those checks — the renderer treats a failed decode of
 * preview bytes as one more fallback rather than as a broken cell.
 */
export async function readThumbSource(filePath: string, minEdge: number): Promise<ThumbSource> {
  const handle = await open(filePath, 'r');
  try {
    const { size } = await handle.stat();
    const head = await readRange(handle, 0, Math.min(size, THUMB_SOURCE_HEAD_BYTES));

    const wholeFile = async (fallback: ThumbSourceFallback): Promise<ThumbSource> => {
      // The header window already covered the whole file when the file is small
      // enough — re-reading it would double the I/O on a folder of small images.
      const covered = head.length >= size;
      const bytes = covered ? head : await readRange(handle, 0, size);
      return {
        kind: 'full-file',
        buffer: toArrayBuffer(bytes),
        bytesRead: covered ? head.length : head.length + bytes.length,
        fallback,
      };
    };

    let preview: Buffer;
    let entryLength: number;
    try {
      const entry = findMpfPreview(head);
      if (!entry) return await wholeFile('no-mpf-preview');
      if (!isPlausiblePreviewRange(entry, size)) return await wholeFile('implausible-range');
      entryLength = entry.length;
      preview = await readRange(handle, entry.offset, entry.length);
    } catch {
      return await wholeFile('read-failed');
    }

    if (preview.length < entryLength) return await wholeFile('short-read');

    const check = checkMpfPreview(head, preview, minEdge);
    if (!check.usable) return await wholeFile(check.reason);

    return {
      kind: 'mpf-preview',
      buffer: toArrayBuffer(preview),
      bytesRead: head.length + preview.length,
      width: check.width,
      height: check.height,
    };
  } finally {
    await handle.close();
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

  ipcMain.handle(IPC_CHANNELS.SCAN_FOLDER, async (event, folderPath: string, scanId = 0) => {
    // Stop the previous scan's deferred pass before starting this one. Two
    // reasons: it reads EXIF headers off the same platter the new folder's
    // blocking prefix is queued behind, and a batch for a tree the user has
    // left has nowhere useful to land anyway.
    activeScanPass?.abort();
    const pass = new AbortController();
    activeScanPass = pass;

    const sender = event.sender;
    const scan = await scanFolder(folderPath, {
      signal: pass.signal,
      onProgress: (update) => {
        if (pass.signal.aborted) return;
        // Nobody left to tell. Stop reading too: on macOS the app outlives its
        // window, and a folder's worth of header reads would carry on for it.
        if (sender.isDestroyed()) {
          pass.abort();
          return;
        }
        sender.send(IPC_CHANNELS.SCAN_PROGRESS, { scanId, ...update } satisfies ScanProgress);
      },
    });
    scheduleVacuum(folderPath);

    // Deliberately not awaited: handing the file list back now, with only a
    // screenful of headers read, is the entire point — the rest arrive over
    // SCAN_PROGRESS. The renderer buffers a batch that overtakes this reply, so
    // nothing here depends on which of the two messages lands first.
    void scan.readRemainingMetadata();

    return scan.images;
  });

  ipcMain.handle(IPC_CHANNELS.SAVE_RESULTS, async (_event, folderPath: string, data: string) => {
    await writeResultsFile(folderPath, data);
  });

  ipcMain.handle(IPC_CHANNELS.LOAD_RESULTS, async (_event, folderPath: string) => {
    return readResultsFile(folderPath);
  });

  ipcMain.handle(IPC_CHANNELS.READ_DETAILED_METADATA, async (_event, filePath: string) => {
    return readDetailedMetadata(filePath);
  });

  /**
   * Count the current-format thumbnails already on disk below `folderPath`.
   *
   * One readdir per image directory, and only of the cache directory — the
   * images themselves are never listed here, so this stays cheap even on a
   * spinning disk with thousands of files. `partitionCacheEntries` decides what
   * counts, which means the suffix rule is shared with the vacuum and a
   * leftover from a past format can never inflate the number.
   *
   * It is an upper bound on coverage, not a per-image check: a thumbnail whose
   * source has since been rotated is stale and will be regenerated, and it is
   * counted here anyway. Close enough for a progress readout, and far cheaper
   * than stat-ing 3470 pairs of files to be exact.
   */
  ipcMain.handle(IPC_CHANNELS.COUNT_THUMB_CACHE, async (_event, folderPath: string) => {
    let total = 0;
    for (const imageDir of await imageDirectories(folderPath)) {
      let entries: CacheDirEntry[];
      try {
        entries = await readdir(getThumbCacheDir(imageDir), { withFileTypes: true });
      } catch {
        continue; // no cache in this directory yet
      }
      total += partitionCacheEntries(entries).thumbs.length;
    }
    return total;
  });

  /**
   * Remove what is orphaned below `folderPath` — nothing more.
   *
   * The step of Rescan that replaced both `Clean Up Folder…` and the wholesale
   * results-file deletion Rescan used to do. No dialog: every entry it touches
   * describes an image that is no longer on disk, so there is nothing to weigh
   * up, and a folder of 21 851 photos should not have its quality scores thrown
   * away for the sake of picking up a handful of new files.
   */
  ipcMain.handle(
    IPC_CHANNELS.PRUNE_FOLDER,
    async (_event, folderPath: string): Promise<PruneResult> => {
      const plan = await planCleanUp(folderPath);

      // Pruning used to be its own menu command; it is on F5 now, which is what
      // makes this load-bearing. A debounced write queued for ANY folder in the
      // tree drains after `applyCleanUp` and writes back the records it just
      // removed — and the old code looked up exactly one queue key, the root's,
      // so every subfolder's orphans came straight back.
      //
      // Only the files the plan actually names, though: a queued write for a
      // folder with no orphans is somebody's fresh quality score, and dropping
      // it to be thorough would lose real work.
      for (const { file } of plan.results) dropQueuedWrite(file);

      const removed = await applyCleanUp(plan);
      return { ...removed, directoriesScanned: plan.directoriesScanned };
    },
  );

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
    IPC_CHANNELS.READ_THUMB_SOURCE,
    async (_event, filePath: string, minEdge: number): Promise<ThumbSource> => {
      // Under the same per-path lock as READ_FILE, for the same reason: this
      // holds a handle open, and a rating write renames a temp file over the
      // original, which Windows refuses while any handle is open.
      return withFileLock(filePath, () => readThumbSource(filePath, minEdge));
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.WRITE_RATING,
    async (_event, filePath: string, rating: number): Promise<RatingWriteResult> => {
      return withFileLock(filePath, () => writeRating(filePath, rating));
    },
  );

  /**
   * Show one image in the OS file manager.
   *
   * Not under `withFileLock`: nothing here opens the file, and the file manager
   * outlives the call — holding the lock for it would queue the next thumbnail
   * read behind an Explorer window the user may leave open all day.
   *
   * `shell.showItemInFolder` returns nothing and is a silent no-op for a path
   * that does not exist, so the `stat` is the only way this can answer "the file
   * is gone" rather than looking exactly like a success. The absolute-path check
   * is the same guard the rating write has: a path from the renderer is input,
   * and this one is handed to the shell.
   */
  ipcMain.handle(
    IPC_CHANNELS.REVEAL_IN_FOLDER,
    async (_event, filePath: string): Promise<{ ok: boolean; error?: string }> => {
      if (!path.isAbsolute(filePath)) {
        return { ok: false, error: 'Unsupported file path' };
      }
      try {
        await stat(filePath);
      } catch {
        return { ok: false, error: 'File no longer exists' };
      }
      shell.showItemInFolder(filePath);
      return { ok: true };
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
      // renderer captured at scan time. ROTATE_IMAGE rewrites the file after
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

  /**
   * Turn one image a quarter turn, now.
   *
   * One image rather than the batch this replaced. That batch existed because
   * applying a rotation meant re-encoding the whole file — 225 ms and 6 226 940
   * bytes on one 6102 kB camera JPEG, at sharp's default JPEG quality and
   * without the embedded preview afterwards — so rotations were parked in the
   * results file and applied by Execute. A tag change is 31 ms and one byte,
   * which is cheap enough to do on the keypress, so there is no pending state
   * left to batch and no Execute step to get wrong.
   */
  ipcMain.handle(
    IPC_CHANNELS.ROTATE_IMAGE,
    async (_event, filePath: string, direction: RotateDirection): Promise<RotateResult> => {
      // Under the same per-path lock as READ_FILE and the rating write, for the
      // same reason: exiftool writes by renaming a temp file over the original,
      // and Windows refuses that while a thumbnail, scoring or preview read
      // holds a handle open.
      return withFileLock(filePath, async () => {
        const result = await rotateImage(filePath, direction);
        if (!result.ok) return result;
        // The cached thumbnail now has the wrong side up. Its source's mtime has
        // moved, so LOAD_THUMB_CACHE would already reject it — deleting the file
        // costs one unlink, closes the same-millisecond tie, and stops a
        // thumbnail nobody can serve sitting on disk until the next vacuum.
        await removeThumbCache(filePath);
        return result;
      });
    },
  );
}
