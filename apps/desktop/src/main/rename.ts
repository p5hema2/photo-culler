/**
 * Renaming media files to their capture time, in place.
 *
 * Two halves that must stay apart. `planRename` reads and computes and writes
 * NOTHING; `executeRename` carries out a plan the user has confirmed. The split
 * is not ceremony: a rename moves files the user never picked — the RAW beside
 * the JPEG, the XMP sidecar holding somebody's Lightroom edits, the AppleDouble
 * twin every exFAT card collects — and this app has no undo stack at all.
 *
 * ## The three things that make this dangerous, and what answers each
 *
 * 1. **`fs.rename` overwrites its destination silently** on POSIX and on
 *    Windows alike, and Node exposes no no-replace flag. A naive batch would be
 *    an unconfirmed, unrecoverable delete. Answered twice over: the planner
 *    guarantees no target collides with anything (see `planRenames`), and
 *    `renameNoReplace` below still reserves the name with `open(dest, 'wx')`
 *    first, because the plan was computed against a listing that is a moment
 *    old.
 *
 * 2. **The results file is keyed by BASENAME**, and it holds the one thing that
 *    exists nowhere else — the quality scores. Left un-rekeyed, the very next
 *    F5 prunes those records as orphans (`planCleanUp` cannot tell a rename
 *    from a deletion) and one Delete anywhere in the folder drops all of them
 *    at once via `rebuildResults`. So the re-key happens HERE, in the main
 *    process, inside the same pass as the rename — not in the renderer, where a
 *    crash between the two would lose the scores.
 *
 * 3. **The thumbnail cache is keyed by basename too**, and a rename does NOT
 *    move the source's mtime, so a renamed thumbnail stays fresh. Moving it
 *    costs one `rename` per file and saves one full decode per file; skipping
 *    it is pure waste.
 */

import { createHash } from 'node:crypto';
import { open, readdir, rename, stat, unlink, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type {
  ImageFileInfo,
  RenameExecuteResult,
  RenameOutcome,
  RenamePlan,
  RenamePlanEntry,
  RenamePlanResult,
  RenameRequest,
  ResultsFile,
} from '@photo-culler/types';
import { planMoves, planRenames, type RenameSource } from '@photo-culler/image-utils/rename';
import { isMediaFile, isVideoFile } from '@photo-culler/image-utils/media';
import {
  readImageMetadata,
  readCaptureLadder,
  fileModifyDateTag,
} from '@photo-culler/image-utils/metadata';
import { readTimestampTags, forgetCachedMetadata } from './exiftool';
import { isScanPassRunning, remapScanPass } from './scan-pass';
import { withFileLock } from './file-lock';

/**
 * What this module needs from the results/thumbnail machinery in
 * `ipc-handlers.ts`, injected rather than imported.
 *
 * One-way dependency: `ipc-handlers` imports this file to register the
 * handlers, so importing back would be a cycle. It also makes the whole
 * executor testable without a real cache directory.
 */
export interface RenameHooks {
  /** `<dir>/.photo-culler-thumbs/<basename>.thumb.webp` for a media file. */
  thumbCachePathOf: (filePath: string) => string;
  /** Absolute path of a folder's results file — the current name, not legacy. */
  resultsFilePathOf: (folder: string) => string;
  /** Raw JSON of a folder's results file, migrating the legacy name on the way. */
  readResults: (folder: string) => Promise<string | null>;
  /** Queue a results-file write, same queue every other writer uses. */
  writeResults: (folder: string, data: string) => Promise<void>;
  /** Forget a write already queued for one results file. */
  dropQueuedWrite: (resultsFilePath: string) => void;
}

/** Safety net against walking a whole drive, same value the scanner uses. */
const MAX_DIRECTORIES = 2000;

/** First bytes hashed to tell two same-second photos apart. Matches the Perl. */
const HASH_BYTES = 65536;

/**
 * Longest target path we will produce on Windows.
 *
 * MAX_PATH is 260 including the terminating NUL, so 259 characters of path.
 * The 32 subtracted here is what the thumbnail cache adds on top —
 * `\.photo-culler-thumbs\` (22) plus `.thumb.webp` (11), less the separator
 * already counted. Without that headroom a rename succeeds and then thumbnails
 * quietly stop working for those files, which is a far worse failure than
 * refusing the name.
 */
const WINDOWS_MAX_TARGET_PATH = 259 - 32;

/**
 * Identity digest: file size plus the first 64 kB.
 *
 * Straight from `content_key` in rename-by-date.pl:339. Deliberately not a full
 * hash — it exists to tell two photos apart, and reading 2.6 GB of video to
 * decide a filename suffix would be absurd. It is not an integrity check.
 */
/**
 * Memoised for the duration of ONE plan, and cleared at the start of each.
 *
 * The planner asks for BOTH sides of every name collision, and a file already
 * sitting on a target name can be the holder for several groups — so without
 * this it is re-read once per collision it takes part in. Each answer is 64 kB
 * and a seek: measured on a real DCIM holding 3044 duplicate names, the hashing
 * was 79 of the 90 seconds the whole plan took.
 *
 * Cleared per plan rather than kept for the session, because a path is not a
 * stable identity for CONTENT here — `rotateImage` rewrites a file's bytes
 * under an unchanged path. Within one plan nothing writes, so the cache cannot
 * go stale; across two, it could say "byte-identical" about a photo somebody
 * has since turned. The saving is entirely within a single plan anyway.
 */
const contentKeyCache = new Map<string, string>();

async function contentKey(filePath: string): Promise<string> {
  const cached = contentKeyCache.get(filePath);
  if (cached !== undefined) return cached;
  const computed = await computeContentKey(filePath);
  contentKeyCache.set(filePath, computed);
  return computed;
}

async function computeContentKey(filePath: string): Promise<string> {
  try {
    const info = await stat(filePath);
    const handle = await open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(HASH_BYTES);
      const { bytesRead } = await handle.read(buffer, 0, HASH_BYTES, 0);
      return createHash('md5')
        .update(String(info.size))
        .update(buffer.subarray(0, bytesRead))
        .digest('hex')
        .slice(0, 8);
    } finally {
      await handle.close();
    }
  } catch {
    // A file we cannot read still needs a stable key, and one derived from the
    // path keeps two unreadable files from colliding with each other.
    return createHash('md5').update(filePath).digest('hex').slice(0, 8);
  }
}

/** Every media file the request names, with the directory each sits in. */
async function collectSources(request: RenameRequest): Promise<string[]> {
  if (request.target.kind === 'files') {
    return request.target.paths.filter((p) => isMediaFile(p));
  }

  const { folder, recursive } = request.target;
  const found: string[] = [];
  let visited = 0;

  const walk = async (dir: string): Promise<void> => {
    if (visited >= MAX_DIRECTORIES) return;
    visited += 1;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const subdirectories: string[] = [];
    for (const entry of entries) {
      // Same rule as the scanner: hidden entries cover the results file and
      // the thumbnail cache directory in one stroke.
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) {
        subdirectories.push(path.join(dir, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      if (!isMediaFile(entry.name)) continue;
      found.push(path.join(dir, entry.name));
    }

    if (recursive) {
      for (const sub of subdirectories) await walk(sub);
    }
  };

  await walk(folder);
  return found;
}

/**
 * Full listings of every directory involved, keyed the way the planner wants.
 *
 * FULL, not filtered to media: a `.DS_Store`, a text note or a sidecar occupies
 * a target name just as effectively as a photo, and the planner's companion
 * pass reads this same listing to find the RAW and the XMP.
 */
async function listDirectories(
  folders: Iterable<string>,
): Promise<Map<string, Map<string, string>>> {
  const listings = new Map<string, Map<string, string>>();
  for (const folder of new Set(folders)) {
    const names = new Map<string, string>();
    try {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        if (entry.isDirectory()) continue;
        names.set(entry.name.toLowerCase(), path.join(folder, entry.name));
      }
    } catch {
      // A directory that does not exist yet is legitimately empty.
    }
    listings.set(folder, names);
  }
  return listings;
}

/**
 * Reads the capture-time ladder in flight, per file.
 *
 * Deliberately more than `METADATA_CONCURRENCY`'s reasoning would suggest,
 * because these reads are 0.63 ms of parse against one seeking 64 kB read: the
 * limit is about not queueing thousands of handles at once, and 16 is enough to
 * keep a fast disk busy without punishing a network share.
 */
const LADDER_CONCURRENCY = 16;

/**
 * The capture-time ladder for every file, from the cheapest reader that can
 * answer for it.
 *
 * **exifr for stills, exiftool for videos.** Measured on the user's archive,
 * exiftool costs 28.55 ms per file — and batching it 200-per-invocation the way
 * H:\rename-by-date does measured 28.5 ms too, so the cost is exiftool itself
 * rather than the round trip. exifr reads the same EXIF block in 0.63 ms cold.
 * That is the difference between six seconds and four and a half minutes on a
 * 9354-file folder, which is what made the preview unusable.
 *
 * A video has to go the slow way: its date lives in the `moov` atom and exifr
 * does not read one. There are 274 of those against 21 747 stills in the
 * archive this was measured on, so the slow path is 1.2% of the work.
 *
 * `FileModifyDate` is spliced in from the mtime for BOTH paths — it is not an
 * EXIF tag, and it is the rung that names a file with no metadata at all.
 */
async function readCaptureTags(
  paths: readonly string[],
): Promise<Map<string, Record<string, string>>> {
  const out = new Map<string, Record<string, string>>();

  const videos = paths.filter((p) => isVideoFile(p));
  const stills = paths.filter((p) => !isVideoFile(p));

  if (videos.length > 0) {
    for (const [filePath, tags] of await readTimestampTags(videos)) {
      out.set(filePath, { ...tags });
    }
  }

  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < stills.length) {
      const filePath = stills[next++]!;
      out.set(filePath, await readCaptureLadder(filePath));
    }
  };
  await Promise.all(Array.from({ length: Math.min(LADDER_CONCURRENCY, stills.length) }, worker));

  // The bottom rung, for every file, from a stat rather than a read.
  await Promise.all(
    paths.map(async (filePath) => {
      const tags = out.get(filePath) ?? {};
      if (tags.FileModifyDate === undefined) {
        try {
          tags.FileModifyDate = fileModifyDateTag((await stat(filePath)).mtimeMs);
        } catch {
          // Gone. It has no date and the planner will leave it alone.
        }
      }
      out.set(filePath, tags);
    }),
  );

  return out;
}

export async function planRename(request: RenameRequest): Promise<RenamePlanResult> {
  try {
    contentKeyCache.clear();
    const paths = await collectSources(request);
    if (paths.length === 0) {
      return { plan: { entries: [], counts: emptyCounts(), touchedFolders: [] } };
    }

    const tagsByPath = await readCaptureTags(paths);

    const sources: RenameSource[] = paths.map((filePath) => ({
      path: filePath,
      folder: path.dirname(filePath),
      name: path.basename(filePath),
      tags: tagsByPath.get(filePath) ?? {},
    }));

    // Both ends: a file's own directory, and the DCIM folder it may move into.
    const folders = new Set<string>();
    for (const source of sources) {
      folders.add(source.folder);
      folders.add(consolidationTargetOf(source.folder, request.consolidateDcim));
    }

    const plan = await planRenames(sources, {
      consolidateDcim: request.consolidateDcim,
      listing: await listDirectories(folders),
      contentKey,
      maxTargetPathLength: process.platform === 'win32' ? WINDOWS_MAX_TARGET_PATH : undefined,
    });

    return { plan };
  } catch (err) {
    return { plan: null, error: err instanceof Error ? err.message : String(err) };
  }
}

function consolidationTargetOf(folder: string, enabled: boolean): string {
  if (!enabled) return folder;
  const m = /^(.*?[\\/]dcim)(?=[\\/]|$)/i.exec(folder);
  return m ? m[1]! : folder;
}

function emptyCounts(): RenamePlan['counts'] {
  return { rename: 0, unchanged: 0, 'no-date': 0, duplicate: 0, blocked: 0 };
}

/**
 * Rename without ever replacing anything.
 *
 * Reserving the name with `open(dest, 'wx')` is the portable way to get an
 * atomic "fail if it exists" — `link()` would also give it, but SD cards are
 * exFAT or FAT32 and have no hard links, and a card is the normal case here.
 *
 * The retry is for Windows specifically: `MoveFileExW` fails with a sharing
 * violation while ANY handle is open, and the app does not own every handle —
 * Explorer's preview pane (which the app's own "Reveal in Explorer" invites the
 * user to open), the search indexer and virus scanners all take one. A short
 * backoff turns most of those from a reported failure into a pause.
 */
async function renameNoReplace(src: string, dest: string): Promise<void> {
  // A pure case change is not a collision and is not a no-op: NTFS and APFS are
  // case-insensitive but case-PRESERVING, so `IMG.JPG` -> `img.jpg` must go
  // through — and the reservation reports the destination as taken, because it
  // IS the source. Since the extension is lower-cased, that is not an edge case
  // any more: it is every file on every run after the first.
  //
  // Which is why the question is asked of the FILESYSTEM and not of the two
  // strings. A name comparison cannot tell "the occupant is my own source" from
  // "a different file happens to differ only in case" — and on a case-SENSITIVE
  // volume (case-sensitive APFS, an SMB share from Linux) the second is real,
  // and treating it as benign would let `fs.rename` overwrite a photo silently.
  // That is the one thing this function exists to prevent.
  let reserved = false;
  try {
    const handle = await open(dest, 'wx');
    await handle.close();
    reserved = true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    if (!(await isSameFile(src, dest))) {
      throw new Error(`Ziel existiert bereits: ${path.basename(dest)}`);
    }
  }

  const delays = [0, 120, 400];
  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt]! > 0) await sleep(delays[attempt]!);
    try {
      await rename(src, dest);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      const transient = code === 'EBUSY' || code === 'EPERM' || code === 'EACCES';
      if (!transient || attempt === delays.length - 1) {
        // Drop our own reservation, or the next attempt sees a 0-byte file
        // sitting on the name and reports "already exists". Only OUR
        // reservation: for a case-only rename there is none, and the file
        // sitting on that name is the user's photo.
        if (reserved) await unlink(dest).catch(() => undefined);
        throw err;
      }
    }
  }
}

/**
 * Are these two paths the same file on disk?
 *
 * `ino` + `dev`, which is the only portable answer. Measured on this NTFS:
 * `X.JPG` and `x.jpg` report an identical, non-zero `ino` and `dev`, so the
 * case-insensitive-but-case-preserving case is answered correctly; on a
 * case-sensitive volume two different files report different `ino`s and the
 * caller refuses, which is the whole point of asking.
 *
 * Answers false when either side cannot be stat'ed. A missing destination means
 * the reservation should have succeeded, and the caller's next `rename` reports
 * whatever is really wrong far better than a guess here would.
 */
async function isSameFile(a: string, b: string): Promise<boolean> {
  try {
    const [sa, sb] = await Promise.all([stat(a), stat(b)]);
    return sa.ino !== 0 && sa.ino === sb.ino && sa.dev === sb.dev;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Move a cached thumbnail alongside its image. Best effort by design. */
async function moveThumbCache(
  srcImage: string,
  destImage: string,
  hooks: RenameHooks,
): Promise<void> {
  const from = hooks.thumbCachePathOf(srcImage);
  const to = hooks.thumbCachePathOf(destImage);
  if (from === to) return;
  try {
    // Check FIRST. Creating the destination cache directory unconditionally
    // leaves an empty `.photo-culler-thumbs/` behind in every folder a rename
    // touches, including folders that have never had a thumbnail — and the
    // vacuum has no reason to remove a directory it did not create.
    await stat(from);
    await mkdir(path.dirname(to), { recursive: true });
    await rename(from, to);
  } catch {
    // No cached thumbnail, or the move lost a race. Costs one decode, not data
    // — and the vacuum removes whatever is left behind.
  }
}

export async function executeRename(
  plan: RenamePlan,
  hooks: RenameHooks,
): Promise<RenameExecuteResult> {
  const moving = plan.entries.filter((e) => e.action === 'rename');
  if (moving.length === 0) {
    return { outcomes: [], renamed: 0, failed: 0, resultsFilesTouched: [] };
  }

  // Drop every queued write for every results file involved BEFORE the first
  // rename. A write scheduled a moment ago and draining afterwards would put
  // the old basenames straight back over the re-keyed file — the same trap the
  // rescan prune has, and for the same reason it needs every affected folder
  // rather than only the root.
  const folders = new Set<string>();
  for (const entry of moving) {
    folders.add(entry.srcFolder);
    folders.add(entry.targetFolder);
  }
  for (const folder of folders) hooks.dropQueuedWrite(hooks.resultsFilePathOf(folder));

  /**
   * Tell the deferred metadata pass where these files are going, BEFORE moving
   * them.
   *
   * The pass reads `image.path` at the moment it reaches that image, so
   * rewriting an entry it has not reached simply redirects it. Doing this
   * first, rather than forbidding the rename while a scan runs, is what makes
   * renaming possible during one at all — see `scan-pass.ts`.
   *
   * Remapped for every planned entry, not only the ones that end up succeeding:
   * a file whose rename is refused keeps its old path, and the pass would then
   * read a path that does not exist. That costs one image's metadata in a case
   * that is already an error; the reverse — moving a file the pass still thinks
   * is elsewhere — costs it silently in the common case.
   */
  const passWasRunning = isScanPassRunning();
  if (passWasRunning) {
    remapScanPass(new Map(moving.map((e) => [e.src, e.targetPath])));
  }

  const outcomes: RenameOutcome[] = [];

  for (const entry of moving) {
    // Only the source is locked. The destination provably does not exist —
    // the planner guarantees it and `renameNoReplace` re-checks — so there is
    // nothing on that key to serialise against, and locking both would open
    // the door to a lock-ordering deadlock for no gain.
    const outcome = await withFileLock(entry.src, async (): Promise<RenameOutcome> => {
      try {
        await renameNoReplace(entry.src, entry.targetPath);
        return { src: entry.src, targetPath: entry.targetPath, ok: true };
      } catch (err) {
        return {
          src: entry.src,
          targetPath: entry.targetPath,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });

    if (outcome.ok) {
      await moveThumbCache(entry.src, entry.targetPath, hooks);
      // The deep-metadata cache is keyed on path plus mtime plus size, so the
      // old entry is already unreachable — evicting it stops a dead path
      // occupying one of the 512 slots for the rest of the session.
      forgetCachedMetadata(entry.src);
    }

    outcomes.push(outcome);
  }

  const succeeded = new Set(outcomes.filter((o) => o.ok).map((o) => o.src));
  const landed = moving.filter((e) => succeeded.has(e.src));
  const resultsFilesTouched = await rekeyResults(landed, hooks);

  return {
    outcomes,
    renamed: outcomes.filter((o) => o.ok).length,
    failed: outcomes.filter((o) => !o.ok).length,
    resultsFilesTouched,
    refreshed: passWasRunning ? await rereadMetadata(landed) : undefined,
  };
}

/**
 * Re-read metadata for files that have just moved, under their new paths.
 *
 * Only called when the deferred scan pass was running. `remapScanPass` redirects
 * every entry the pass has not REACHED, which covers almost everything — but a
 * file being read at the instant it moved comes back empty, and
 * `METADATA_CONCURRENCY` is 8, so up to eight images could be in that state.
 * Rather than work out which, re-read them all: the set is the plan, which the
 * user just waited for anyway.
 *
 * Companions are skipped — the app does not display a RAW or a sidecar, so
 * nothing reads metadata for one.
 */
async function rereadMetadata(entries: readonly RenamePlanEntry[]): Promise<ImageFileInfo[]> {
  const out: ImageFileInfo[] = [];
  for (const entry of entries) {
    if (entry.companionOf !== undefined) continue;
    if (!isMediaFile(entry.targetName)) continue;
    try {
      const info = await stat(entry.targetPath);
      const dot = entry.targetName.lastIndexOf('.');
      out.push({
        path: entry.targetPath,
        name: entry.targetName,
        folder: entry.targetFolder,
        extension: dot === -1 ? '' : entry.targetName.slice(dot + 1).toLowerCase(),
        size: info.size,
        lastModified: info.mtimeMs,
        ...(await readImageMetadata(entry.targetPath)),
      });
    } catch {
      // Gone again, or unreadable. The renderer keeps what it has.
    }
  }
  return out;
}

/**
 * Move each renamed file's quality-score record to its new basename.
 *
 * Cross-folder, because DCIM consolidation moves a file into a directory with
 * its own results file. Records that do not exist are simply absent — a
 * companion RAW never had one, and neither did a photo nobody scored.
 *
 * Written through the same queue every other writer uses rather than straight
 * to disk, so a concurrent save cannot lose this update.
 */
async function rekeyResults(
  moved: readonly RenamePlanEntry[],
  hooks: RenameHooks,
): Promise<string[]> {
  const loaded = new Map<string, ResultsFile>();
  const dirty = new Set<string>();

  const load = async (folder: string): Promise<ResultsFile> => {
    const cached = loaded.get(folder);
    if (cached) return cached;
    let parsed: ResultsFile = {
      version: 1,
      folderPath: folder,
      updatedAt: new Date().toISOString(),
      images: {},
    };
    try {
      const raw = await hooks.readResults(folder);
      if (raw) {
        const candidate = JSON.parse(raw) as ResultsFile;
        if (candidate && typeof candidate === 'object' && candidate.images) parsed = candidate;
      }
    } catch {
      // A corrupt results file must not stop the rename it describes. Starting
      // from an empty one loses scores that were already unreadable.
    }
    loaded.set(folder, parsed);
    return parsed;
  };

  for (const entry of moved) {
    const from = await load(entry.srcFolder);
    const record = from.images[entry.srcName];
    if (record === undefined) continue;

    delete from.images[entry.srcName];
    dirty.add(entry.srcFolder);

    const to = entry.srcFolder === entry.targetFolder ? from : await load(entry.targetFolder);
    to.images[entry.targetName] = record;
    dirty.add(entry.targetFolder);
  }

  const written: string[] = [];
  for (const folder of dirty) {
    const file = loaded.get(folder)!;
    file.updatedAt = new Date().toISOString();
    file.folderPath = folder;
    await hooks.writeResults(folder, JSON.stringify(file, null, 2));
    written.push(hooks.resultsFilePathOf(folder));
  }
  return written;
}

/**
 * Work out what moving `paths` into `targetFolder` would do.
 *
 * Deliberately does NOT read timestamp tags: a move keeps every basename, so
 * there is nothing to read, and skipping that is what makes dropping a hundred
 * files onto a folder feel instant where renaming the same hundred takes
 * seconds. Everything after the name — the namespace allocation, the collision
 * suffix, the companion pass — is the rename planner's, unchanged.
 */
export async function planMove(
  paths: readonly string[],
  targetFolder: string,
): Promise<RenamePlanResult> {
  try {
    contentKeyCache.clear();
    const media = paths.filter((p) => isMediaFile(p));
    if (media.length === 0) {
      return { plan: { entries: [], counts: emptyCounts(), touchedFolders: [] } };
    }

    const sources: RenameSource[] = media.map((filePath) => ({
      path: filePath,
      folder: path.dirname(filePath),
      name: path.basename(filePath),
      tags: {},
    }));

    const folders = new Set<string>([targetFolder]);
    for (const source of sources) folders.add(source.folder);

    const plan = await planMoves(sources, targetFolder, {
      listing: await listDirectories(folders),
      contentKey,
      maxTargetPathLength: process.platform === 'win32' ? WINDOWS_MAX_TARGET_PATH : undefined,
    });

    return { plan };
  } catch (err) {
    return { plan: null, error: err instanceof Error ? err.message : String(err) };
  }
}
