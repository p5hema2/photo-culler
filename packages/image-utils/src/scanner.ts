import { readdir, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import type { ImageFileInfo, ScanProgress } from '@photo-culler/types';
import { readImageMetadata } from './metadata';
import { isMediaFile, isVideoFile } from './media';
import { sortImages } from './sorting';

/**
 * What the walk lists.
 *
 * Was a literal set of six still formats; videos joined it in 1.8.0, and the
 * membership test moved to `media.ts` so the renderer, the rename planner and
 * this walk cannot disagree about what a video is.
 */

// Pre-1.2.0 results filename. The current name is a dotfile and so is already
// covered by the hidden-file skip below; this entry only shields folders that
// have not been migrated yet.
const EXCLUDED_FILES = new Set(['photo-culler-results.json']);

/** Safety net against opening a whole drive by accident. */
const MAX_DIRECTORIES = 2000;

/**
 * Concurrent metadata reads.
 *
 * Each read is ~0.3 ms of CPU and one seeking file open, so the limit is about
 * not queueing thousands of file handles at once rather than about throughput.
 * Modest on purpose: a network drive punishes a wide fan-out far more than a
 * local SSD rewards it.
 */
const METADATA_CONCURRENCY = 8;

/**
 * Images whose metadata is read BEFORE scanFolder returns.
 *
 * Derived from the grid's geometry rather than picked, because the prefix only
 * has to cover what the first frame paints: everything past it arrives over the
 * progress channel while the user is already looking at photos.
 *
 * The binding case is the DENSEST grid, which is the SMALLEST thumbnail preset —
 * the largest one puts 300 px cells on screen and so asks for the fewest
 * headers, roughly a fifth of these. With PhotoGrid's own numbers
 * (`THUMBNAIL_SIZE_MAP.small` = 120 px, `GRID_GAP` = 8 px, so a 128 px pitch)
 * and a generous 2560x1440 CSS viewport:
 *
 *   per row  = floor((2560 + 8) / 128)                   = 20
 *   on screen= ceil(1440 / 128) rows x 20                = 240
 *   overscan = 3 rows (useVirtualizer's `overscan`) x 20  =  60
 *                                                          ---
 *                                                          300
 *
 * Being somewhat off is cosmetic rather than a bug in either direction: a short
 * prefix means the first screen re-groups once more when the next batch lands,
 * and a long one only widens the blocking window this exists to bound.
 */
const METADATA_PREFIX = 300;

/**
 * Images per pushed batch, and how long one waits for company.
 *
 * The size is the prefix again, and for the same reason: a batch costs the
 * renderer one re-sort, one re-group and one render, so it should carry at most
 * a screenful of new grouping information. The interval is what keeps the
 * progress counter moving — it makes a slow disk report several times a second
 * instead of once per full batch.
 */
const METADATA_BATCH_SIZE = METADATA_PREFIX;
const METADATA_BATCH_INTERVAL_MS = 400;

/** How often the walk reports its running count. */
const WALK_PROGRESS_EVERY = 100;

/** Shared, so a count-only progress report allocates nothing. */
const NO_IMAGES: ImageFileInfo[] = [];

/**
 * A progress report as the scanner knows it.
 *
 * The caller stamps `scanId` on its way out — that is the renderer's own open
 * epoch, and the scanner has no business inventing one.
 */
export type ScanProgressUpdate = Omit<ScanProgress, 'scanId'>;

export interface ScanFolderOptions {
  /**
   * Called as the walk runs and as metadata batches complete. Never called
   * after `signal` aborts.
   */
  onProgress?: (update: ScanProgressUpdate) => void;
  /**
   * Stops the deferred metadata pass early — another scan has started, or the
   * window it was reading for has gone. Abort is a normal outcome: the pass
   * resolves, it does not reject.
   */
  signal?: AbortSignal;
  /** Metadata reads to finish before returning. Defaults to METADATA_PREFIX. */
  prefix?: number;
}

export interface FolderScan {
  /** Every image found, in walk order. */
  images: ImageFileInfo[];
  /** How many of `images`, from the front, already carry their metadata. */
  metadataReady: number;
  /**
   * Read the metadata for everything past `metadataReady`, delivering each
   * batch through `onProgress`.
   *
   * Separate from scanFolder, and not started by it, so that the caller can
   * hand the file list on BEFORE the reading begins. Awaiting this pass inside
   * scanFolder is exactly what used to keep the grid blank for 3470 headers.
   * Calling it twice is a no-op.
   */
  readRemainingMetadata: () => Promise<void>;
}

interface MetadataPassOptions {
  /**
   * The images to read, in the order the grid will display them — NOT the walk
   * order. Reading in display order is what puts the prefix on the first screen
   * and keeps the deferred batches ahead of the user; see scanFolder.
   */
  order: ImageFileInfo[];
  /** Half-open range of `order` to read. */
  start: number;
  end: number;
  /**
   * Whether the completed images travel with the progress report. False for the
   * blocking prefix, whose images reach the caller in `FolderScan.images`.
   */
  deliver: boolean;
  onProgress?: (update: ScanProgressUpdate) => void;
  signal?: AbortSignal;
}

/**
 * Fill in metadata for one range of images, in place, with a bounded number of
 * concurrent reads, reporting as it goes.
 *
 * A pass over the finished list rather than part of the walk: the walk is
 * depth-first and sequential by design (MAX_DIRECTORIES has to stay
 * meaningful), while these reads have no ordering constraint at all.
 */
async function readMetadataPass({
  order,
  start,
  end,
  deliver,
  onProgress,
  signal,
}: MetadataPassOptions): Promise<void> {
  let next = start;
  let completed = start;
  let batch: ImageFileInfo[] = [];
  let lastFlush = Date.now();

  const flush = (): void => {
    lastFlush = Date.now();
    const delivered = deliver ? batch : NO_IMAGES;
    batch = [];
    onProgress?.({ phase: 'metadata', found: order.length, completed, images: delivered });
  };

  const worker = async (): Promise<void> => {
    while (next < end) {
      if (signal?.aborted) return;
      const image = order[next++]!;
      // exifr reads stills. Handed an MP4 or a MOV it walks the file looking
      // for a signature it will never find, then returns {} — two seeking
      // reads and a parse attempt for a guaranteed miss, and on a 2 GB clip
      // that is not free. A video's capture time lives in the `moov` atom,
      // which only exiftool reads, and the one place that needs it is the
      // rename planner, which asks exiftool directly and in bulk. Until then
      // grouping falls back to `lastModified` — which for a file straight off
      // a card IS the capture time, because the camera wrote it.
      if (!isVideoFile(image.extension)) {
        Object.assign(image, await readImageMetadata(image.path));
      }
      completed += 1;
      batch.push(image);
      if (
        batch.length >= METADATA_BATCH_SIZE ||
        Date.now() - lastFlush >= METADATA_BATCH_INTERVAL_MS
      ) {
        flush();
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(METADATA_CONCURRENCY, end - start) }, worker));
  // An aborted pass reports nothing: the batch it holds is complete and
  // correct, but it belongs to a tree the caller has stopped caring about.
  if (signal?.aborted) return;
  flush();
}

/**
 * Recursively scan a folder tree for supported image files, in two phases.
 *
 * Every directory below `folderPath` is visited, so a user can open the parent
 * of several shoots instead of culling one folder at a time. Hidden directories
 * are skipped, which also excludes the thumbnail cache, and `folder` is simply
 * the directory the image sits in.
 *
 * There used to be one exception: a `picks/` directory was scanned but its
 * images were attributed to the PARENT folder, so a shot Execute had moved
 * stayed in the section it was culled in. Execute no longer moves anything —
 * the keep classification it served is gone — so there is nothing left to fold
 * up. Do not restore it: the main process's clean-up had to mirror the same
 * union to avoid pruning a moved pick's record, and a `picks/` directory is now
 * an ordinary shoot subfolder like any other.
 *
 * Each image's metadata — including its star rating — is read here rather than
 * cached in the results file, because the file on disk is the authority for the
 * rating. It costs ~0.3 ms of CPU per image (see readImageMetadata) but two
 * seeking 64 kB reads of the file, and THAT is what made reading all of them up
 * front untenable: 3470 images on a spinning disk kept the grid blank for the
 * whole pass. So only `options.prefix` images are read before returning, and
 * the rest are left to `readRemainingMetadata`.
 *
 * **Which images the prefix is, and the precondition behind it.** The reads run
 * in DISPLAY order, not walk order: `sortImages` is the only order the app
 * offers, so the same call decides here which images the first screen will
 * want. That is deliberate rather than incidental — `readdir` order is the
 * filesystem's, name-ordered on NTFS but hash-ordered on ext4, and a prefix
 * that trusted it would read the wrong 300 files on the wrong disk. The
 * returned array stays in walk order; only the reading order is sorted, and
 * both views hold the same objects, so the metadata lands in either.
 *
 * The precondition that remains is the one sorting.ts already relies on:
 * filename order is capture order for one camera's card. Given that, the
 * prefix IS the first screenful the grid paints, and the deferred batches then
 * refine group boundaries downwards, ahead of where the user is looking — which
 * is what keeps a re-flow from moving the image under the cursor. A folder
 * holding two cards interleaves the names, so its groups visibly settle once as
 * the batches land. That is the accepted trade for a grid that appears at once.
 */
export async function scanFolder(
  folderPath: string,
  options: ScanFolderOptions = {},
): Promise<FolderScan> {
  const { onProgress, signal } = options;
  const images: ImageFileInfo[] = [];
  let directoriesVisited = 0;

  const walk = async (dirPath: string): Promise<void> => {
    if (directoriesVisited >= MAX_DIRECTORIES) return;
    directoriesVisited++;

    let entries;
    try {
      entries = await readdir(dirPath, { withFileTypes: true });
    } catch (err) {
      // A folder we cannot read is not a reason to abandon the whole tree;
      // only a failure on the root itself should surface to the caller.
      if (dirPath === folderPath) throw err;
      return;
    }

    const subdirectories: string[] = [];

    for (const entry of entries) {
      // Skip hidden entries — covers .photo-culler-thumbs and the results file
      if (entry.name.startsWith('.')) continue;

      if (entry.isDirectory()) {
        subdirectories.push(join(dirPath, entry.name));
        continue;
      }

      if (!entry.isFile()) continue;
      if (EXCLUDED_FILES.has(entry.name)) continue;

      const ext = extname(entry.name).toLowerCase();
      if (!isMediaFile(entry.name)) continue;

      const filePath = join(dirPath, entry.name);
      let stats;
      try {
        stats = await stat(filePath);
      } catch {
        continue; // vanished between readdir and stat
      }

      images.push({
        path: filePath,
        name: entry.name,
        folder: dirPath,
        extension: ext.slice(1),
        size: stats.size,
        lastModified: stats.mtimeMs,
      });

      // A running count, because the walk is itself seconds of work on a
      // spinning disk and a spinner that says nothing looks the same after two
      // seconds as after twenty.
      if (images.length % WALK_PROGRESS_EVERY === 0) {
        onProgress?.({
          phase: 'walking',
          found: images.length,
          completed: 0,
          images: NO_IMAGES,
        });
      }
    }

    for (const sub of subdirectories) {
      await walk(sub);
    }
  };

  await walk(folderPath);

  // Ascending: it is the store's default direction, and it is the one where the
  // batches move down the grid rather than up through it. A folder reviewed
  // descending settles from the bottom instead — still correct, just visible.
  const order = sortImages(images, 'asc');
  const prefix = Math.min(Math.max(0, options.prefix ?? METADATA_PREFIX), order.length);
  await readMetadataPass({ order, start: 0, end: prefix, deliver: false, onProgress, signal });

  let started = false;
  return {
    images,
    metadataReady: prefix,
    readRemainingMetadata: async () => {
      if (started) return;
      started = true;
      await readMetadataPass({
        order,
        start: prefix,
        end: order.length,
        deliver: true,
        onProgress,
        signal,
      });
    },
  };
}
