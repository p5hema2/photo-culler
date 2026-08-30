import { app } from 'electron';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { ExifTool } from 'exiftool-vendored';
import { mapFocusTags } from '@photo-culler/image-utils';
// Deep import: `orientation.ts` is import-free on purpose, so pulling it in
// costs nothing. Needs an `./orientation` entry in the package's `exports` map.
import { ROTATE_DIRECTIONS, nextOrientation } from '@photo-culler/image-utils/orientation';
import type {
  DetailedMetadata,
  MetadataTag,
  RotateDirection,
  RotateResult,
} from '@photo-culler/types';

/**
 * On-demand deep metadata reads via a long-lived exiftool child process.
 *
 * The bulk EXIF pass still runs through `exifr` in a renderer worker — that one
 * has to touch every image in the folder and only needs the handful of fields
 * used for sorting and grouping. This path is for the ONE image the user is
 * looking at, where the interesting data (autofocus point, face detection,
 * subject detection) lives in the proprietary maker note that exifr returns as
 * an undecoded binary blob.
 */

const VENDOR_PKG = process.platform === 'win32' ? 'exiftool-vendored.exe' : 'exiftool-vendored.pl';
const BIN_NAME = process.platform === 'win32' ? 'exiftool.exe' : 'exiftool';

/**
 * In the packaged app `asar: false` puts the tree at `resources/app`, on both
 * Windows and macOS. Resolving explicitly keeps a bare-specifier dynamic
 * import() off the main process's critical path and makes failures diagnosable.
 * In dev we let the library resolve through the pnpm store itself.
 */
function packagedExiftoolPath(): string | null {
  if (!app.isPackaged) return null;
  const p = path.join(process.resourcesPath, 'app', 'node_modules', VENDOR_PKG, 'bin', BIN_NAME);
  return existsSync(p) ? p : null;
}

/**
 * Tags to read. `-fast` stops after the header, which is where maker notes
 * live. NOT `-fast2`, which would skip the SOF segment and with it the
 * dimensions the Panasonic face-box mapping needs.
 *
 * The `#` suffix requests the NUMERIC value for that tag only. This matters:
 * ExifTool's default PrintConv for AFPointPosition is `sprintf("%.2g")`, so
 * 0.4567 would arrive as "0.46" — up to ~5% of frame width of error in an
 * overlay. AFAreaSize is not rounded, so the inconsistency is easy to miss.
 * Per-tag rather than a global `-n` so FocusMode and AFAreaMode keep their
 * human-readable strings.
 */
const READ_ARGS = [
  '-fast',
  '-a',
  '-G1',
  '-Make',
  '-Model',
  '-Orientation#',
  '-ImageWidth',
  '-ImageHeight',
  '-PanasonicImageWidth',
  '-PanasonicImageHeight',
  '-FocusMode',
  '-AFAreaMode',
  '-AFAssistLamp',
  '-AFSubjectDetection',
  '-AFPointPosition#',
  '-AFAreaSize#',
  '-FacesDetected',
  '-NumFacePositions',
  '-Face1Position',
  '-Face2Position',
  '-Face3Position',
  '-Face4Position',
  '-Face5Position',
  '-LensType',
  '-LensSerialNumber',
  '-LensModel',
];

let instance: ExifTool | null = null;
/** Sticky: one spawn failure disables the feature for the session. */
let unavailable = false;

function getExifTool(): ExifTool | null {
  if (unavailable) return null;
  if (instance === null) {
    const explicitPath = packagedExiftoolPath();
    instance = new ExifTool({
      // Interactive, one-image-at-a-time path — a pool would just hold memory.
      maxProcs: 1,
      taskTimeoutMillis: 10_000,
      // Windows virus scanners can be slow to let a fresh binary start.
      spawnTimeoutMillis: 30_000,
      // We read raw maker-note tags; MWG composites add nothing here.
      useMWG: false,
      ...(explicitPath ? { exiftoolPath: explicitPath } : {}),
    });
  }
  return instance;
}

function isSpawnFailure(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /ENOENT|EACCES|spawn|Failed to find ExifTool|BatchCluster/i.test(message);
}

/**
 * Shut the child process down.
 *
 * `end(true)` matters most on Windows, where a `-stay_open` exiftool.exe that
 * is never told to exit survives the app as an orphan process. The race caps
 * how long a wedged child can delay quitting.
 */
export async function endExifTool(): Promise<void> {
  const running = instance;
  instance = null;
  if (!running) return;
  await Promise.race([
    running.end(true).catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, 2000)),
  ]);
}

const MAX_CACHE = 512;
/**
 * Separator inside a cache key, chosen because a path cannot contain it.
 *
 * Named rather than inlined because the key was built with a literal NUL while
 * `dropCachedMetadata` matched on a literal SPACE, so the invalidation after a
 * rating write never matched anything — and, `-P` holding the mtime steady, the
 * stale entry was then served for the rest of the session. Two ends of one
 * format have to share a constant. It also keeps this file plain text: the two
 * raw NULs made git treat it as binary and refuse to diff it.
 */
const CACHE_KEY_SEP = '\u0000';
const cache = new Map<string, DetailedMetadata | null>();
const inFlight = new Map<string, Promise<DetailedMetadata | null>>();

const SKIP_TAG_PREFIXES = ['SourceFile', 'errors', 'warnings'];

function toTags(raw: Record<string, unknown>): MetadataTag[] {
  const tags: MetadataTag[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined || value === null) continue;
    if (SKIP_TAG_PREFIXES.some((p) => key.startsWith(p))) continue;
    const idx = key.indexOf(':');
    const group = idx > 0 ? key.slice(0, idx) : 'EXIF';
    const name = idx > 0 ? key.slice(idx + 1) : key;
    tags.push({ group, name, value: String(value) });
  }
  return tags;
}

export async function readDetailedMetadata(filePath: string): Promise<DetailedMetadata | null> {
  // batch-cluster feeds -stay_open one argument per line, so a newline in the
  // path would inject an ExifTool argument. No shell is involved, so that is
  // the entire attack surface and one check closes it.
  if (!path.isAbsolute(filePath) || /[\r\n]/.test(filePath)) return null;

  let sourceStat;
  try {
    sourceStat = await stat(filePath);
  } catch {
    return null;
  }

  const key = [filePath, sourceStat.mtimeMs, sourceStat.size].join(CACHE_KEY_SEP);

  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const exiftool = getExifTool();
  if (!exiftool) return null;

  const task = (async (): Promise<DetailedMetadata | null> => {
    try {
      const raw = await exiftool.readRaw<Record<string, unknown>>(filePath, {
        readArgs: READ_ARGS,
      });
      const { vendor, focus, lens } = mapFocusTags(raw);
      return {
        path: filePath,
        sourceMtimeMs: sourceStat.mtimeMs,
        vendor,
        focus,
        lens,
        tags: toTags(raw),
      };
    } catch (err) {
      // A per-file failure is ordinary (unsupported format). A spawn failure is
      // not: on a system without a usable interpreter, retrying on every focus
      // change would be a retry storm, so disable the feature for the session.
      if (isSpawnFailure(err)) {
        unavailable = true;
        void endExifTool();
      }
      return null;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, task);
  const result = await task;

  cache.set(key, result);
  if (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return result;
}

/**
 * Forget every cached deep-metadata entry for a file we have just modified.
 *
 * The cache key is path plus mtime plus size, so a write that moves any of
 * those already makes the old entry unreachable — but the rating write
 * deliberately holds the mtime steady with `-P`, and there the stale entry
 * would otherwise be served for the rest of the session.
 */
function dropCachedMetadata(filePath: string): void {
  const prefix = `${filePath}${CACHE_KEY_SEP}`;
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

/** Outcome of a rating write. Failures are reported, never swallowed. */
export interface RatingWriteResult {
  ok: boolean;
  error?: string;
}

/**
 * Write a star rating into the image file itself.
 *
 * Two groups, because two families of reader look in two different places:
 * `xmp:Rating` is what Lightroom, Bridge, Capture One and darktable read;
 * `EXIF:Rating` (0x4746) in IFD0 is what Windows Explorer reads, with
 * `RatingPercent` as its companion — leaving that stale would make Explorer
 * disagree with itself. Verified round-tripping through both exiftool and
 * exifr, on JPEG, PNG, TIFF and WebP.
 *
 * Two flags carry the whole design:
 *
 * `-P` preserves FileModifyDate. Without it every rating keypress would bump
 * the file's mtime, and LOAD_THUMB_CACHE discards any thumbnail older than its
 * source — so rating 2000 photos would destroy 2000 cache entries and force
 * 2000 full-size decodes. It would also corrupt burst grouping, which falls
 * back to lastModified when a file has no DateTimeOriginal, and invalidate the
 * detail-metadata cache, which is keyed on mtime. See the trap in CLAUDE.md:
 * this deliberately defeats a freshness check that exists for good reasons, and
 * it is only safe because a rating write changes no pixels.
 *
 * Measured across five consecutive writes to one file, starting from an mtime
 * with a fractional millisecond: drift 0 every time, and no slower than writing
 * without it (31 ms against 41.8 ms warm). Should a future exiftool restore the
 * timestamp less exactly, the cost is one regenerated thumbnail — a wasted
 * decode, not a wrong result.
 *
 * `-overwrite_original` stops exiftool leaving a `<name>_original` twin beside
 * every photo. Those twins carry an extension the scanner does not recognise
 * and the clean-up planner has no notion of, so they would accumulate silently
 * and invisibly.
 *
 * Unlike readDetailedMetadata this does NOT swallow errors. A silently failed
 * write is a lost rating with a star still showing on screen, and the file is
 * the only place the rating lives.
 */
export async function writeRating(filePath: string, rating: number): Promise<RatingWriteResult> {
  // Same argument-injection guard as the read path: batch-cluster feeds
  // -stay_open one argument per line.
  if (!path.isAbsolute(filePath) || /[\r\n]/.test(filePath)) {
    return { ok: false, error: 'Unsupported file path' };
  }
  if (!Number.isInteger(rating) || rating < 0 || rating > 5) {
    return { ok: false, error: `Rating out of range: ${rating}` };
  }

  const exiftool = getExifTool();
  if (!exiftool) return { ok: false, error: 'ExifTool is unavailable' };

  // Explorer's percentage scale is not linear — these are the values Windows
  // itself writes, and anything else makes it show a different star count.
  const percent = [0, 1, 25, 50, 75, 99][rating]!;

  try {
    // Split across `tags` and `writeArgs`, which looks odd and is measured:
    //
    //  - A plain `Rating` in `tags` lands in XMP (`XMP-xmp:Rating`) but NOT in
    //    IFD0, so Windows Explorer would never see it.
    //  - Passing every assignment through writeArgs with an EMPTY tags object
    //    does write both groups — but loses the mtime, because the library
    //    takes a different path and -P stops taking effect.
    //
    // Non-empty tags plus the EXIF group as explicit args gives all of
    // IFD0:Rating, IFD0:RatingPercent and XMP-xmp:Rating with drift 0.
    // `rating` is a validated 0-5 integer above, so interpolating it is safe.
    await exiftool.write(filePath, { Rating: rating }, [
      '-overwrite_original',
      '-P',
      `-EXIF:Rating=${rating}`,
      `-EXIF:RatingPercent=${percent}`,
    ]);
    // The file changed, so any cached deep-metadata entry for it is stale.
    dropCachedMetadata(filePath);
    return { ok: true };
  } catch (err) {
    if (isSpawnFailure(err)) {
      unavailable = true;
      void endExifTool();
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Formats whose EXIF orientation this app will change.
 *
 * An allow-list, so a new extension in the scanner's SUPPORTED_EXTENSIONS is
 * refused loudly rather than rotated on a guess.
 *
 * JPEG only, and the reason is the *display* end rather than the write end.
 * Measured: ExifTool puts an orientation tag into a PNG (an eXIf chunk), a WebP
 * (an EXIF chunk) and a TIFF (its own IFD0) exactly as losslessly as into a
 * JPEG — one byte changes, the stored pixels decode bit-identically. But the
 * renderer applies orientation at decode time with
 * `createImageBitmap(…, { imageOrientation: 'from-image' })`, and that is only
 * known to honour the tag for JPEG: Chromium cannot decode TIFF at all, and its
 * PNG/WebP orientation support is unverified here. A tag change the display path
 * ignores is a rotation that silently does nothing, which is worse than a
 * refusal the user can read. The other option — re-encoding those formats with
 * sharp — is the data loss this whole path replaced, and lossy for WebP.
 *
 * Adding a format means verifying the decode side first, not just the write.
 */
const ROTATABLE_EXTENSIONS = new Set(['.jpg', '.jpeg']);

/**
 * Turn one image a quarter turn by rewriting its EXIF Orientation tag.
 *
 * This is the whole of rotation in this app. It replaced
 * `sharp(buffer).rotate(degrees).withMetadata()`, which on one 6102 kB camera
 * JPEG took 225 ms, rewrote 6 226 940 bytes, shrank the file to 1470 kB at
 * sharp's default JPEG quality and destroyed the embedded MPF preview — which
 * permanently drops that photo off the fast thumbnail path. The tag change
 * takes 31 ms and changes one byte, and rotating back is another one-byte
 * write, so undo is lossless by construction.
 *
 * The current value is read HERE rather than passed in by the renderer, so that
 * the read and the write are one step inside the caller's per-path file lock.
 * The renderer's copy comes from the scan and is stale the moment anything has
 * touched the file — an earlier rotation, Lightroom, Explorer — and computing
 * the next value from a stale one would silently undo that change. The read is
 * `-fast` over IFD0, the same header the scan already walks.
 *
 * Like writeRating and unlike readDetailedMetadata, this does NOT swallow
 * errors: the tag is the only place the rotation lives.
 */
export async function rotateImage(
  filePath: string,
  direction: RotateDirection,
): Promise<RotateResult> {
  // Same argument-injection guard as every other exiftool path here:
  // batch-cluster feeds -stay_open one argument per line, so a newline in the
  // path would inject an ExifTool argument.
  if (!path.isAbsolute(filePath) || /[\r\n]/.test(filePath)) {
    return { ok: false, error: 'Unsupported file path' };
  }
  // Validated even though the type says it cannot happen, because the value
  // crosses IPC: `nextOrientation` reads anything that is not 'cw' as 'ccw', and
  // a rotation quietly going the wrong way is the class of bug the
  // reported-failure contract exists to prevent.
  if (!ROTATE_DIRECTIONS.includes(direction)) {
    return { ok: false, error: `Unknown rotation direction: ${direction}` };
  }
  const ext = path.extname(filePath).toLowerCase();
  if (!ROTATABLE_EXTENSIONS.has(ext)) {
    return {
      ok: false,
      error:
        `Cannot rotate ${ext || 'this file'}: rotation is a change to the EXIF ` +
        'orientation tag, which only JPEG honours end to end here.',
    };
  }

  const exiftool = getExifTool();
  if (!exiftool) return { ok: false, error: 'ExifTool is unavailable' };

  try {
    const raw = await exiftool.readRaw<Record<string, unknown>>(filePath, {
      // `-n` so the PrintConv cannot hand back "Rotate 90 CW" instead of 6.
      readArgs: ['-fast', '-n', '-Orientation'],
    });
    const next = nextOrientation(raw.Orientation, direction);

    // NO `-P` here, and that is the point. The rating write passes it to hold
    // FileModifyDate steady, because a rating changes no pixels and bumping the
    // mtime would evict 2000 valid thumbnails over 2000 keypresses. A rotation
    // changes which way up the photo is, so the cached thumbnail MUST be seen
    // as stale — and the moving mtime is precisely the signal LOAD_THUMB_CACHE
    // checks. The caller deletes the cache file as well; here invalidation is
    // the goal rather than the cost.
    //
    // `-n` writes the value numerically. Without it ExifTool runs the tag's
    // PrintConv in reverse and looks for a rotation *named* "6".
    //
    // The assignment travels in `tags` rather than in the args array so that
    // array is non-empty: with nothing to set, exiftool-vendored appends a
    // `-FileName<FileName` self-rename to keep ExifTool in write mode, and
    // there is no reason to rename a photo to itself. `next` is one of eight
    // integers from a closed table, so there is nothing to escape.
    await exiftool.write(filePath, { Orientation: next }, ['-overwrite_original', '-n']);
    dropCachedMetadata(filePath);
    return { ok: true, orientation: next };
  } catch (err) {
    if (isSpawnFailure(err)) {
      unavailable = true;
      void endExifTool();
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/* ------------------------------------------------- capture times, in bulk -- */

/**
 * The tag ladder, as ExifTool arguments.
 *
 * `-fast2` stops before the image data, which is where none of these live, and
 * on a 2 GB video that is the difference between milliseconds and seconds.
 *
 * NOT `-api QuickTimeUTC`. QuickTime stores its dates in UTC per the spec, and
 * that option would convert them to local time on the way out — but
 * H:\rename-by-date does not pass it either, and the whole point of this read
 * is that both tools name a file identically. Cameras write local time into
 * that field in practice, so the default is also the right answer.
 *
 * NOT `-m` either, for the reason the Perl records at rename-by-date.pl:194:
 * `-m` demotes "Tag not defined" to ignorable, and an undefined tag then
 * interpolates as empty rather than being reported missing.
 */
const TIMESTAMP_READ_ARGS = [
  '-fast2',
  '-SubSecDateTimeOriginal',
  '-DateTimeOriginal',
  '-SubSecCreateDate',
  '-CreateDate',
  '-SubSecMediaCreateDate',
  '-MediaCreateDate',
  '-FileModifyDate',
];

/** Raw tag strings for one file, exactly as ExifTool prints them. */
export type TimestampTagValues = Record<string, string>;

/**
 * Read the capture-time ladder for many files.
 *
 * Goes through the same `-stay_open` child every rating and rotation write
 * uses, and that is deliberate rather than incidental: `maxProcs: 1` means a
 * read here cannot interleave with a write to the same file. It costs a
 * round trip per file — a few milliseconds — so `onProgress` exists to keep a
 * folder of several thousand from looking hung.
 *
 * `readRaw` rather than `read`: exiftool-vendored's `read` parses dates into
 * `ExifDateTime` objects, and re-serialising one back into ExifTool's own
 * `YYYY:MM:DD HH:MM:SS.fff` is a lossy round trip through a timezone the
 * naming rules deliberately discard. The raw strings are what `parseStamp`
 * was written against.
 */
export async function readTimestampTags(
  filePaths: readonly string[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, TimestampTagValues>> {
  const out = new Map<string, TimestampTagValues>();
  const exiftool = getExifTool();
  if (!exiftool) return out;

  let done = 0;
  for (const filePath of filePaths) {
    // Same guard as readDetailedMetadata: batch-cluster feeds -stay_open one
    // argument per line, so a newline in a path would inject an argument.
    if (path.isAbsolute(filePath) && !/[\r\n]/.test(filePath)) {
      try {
        const raw = await exiftool.readRaw<Record<string, unknown>>(filePath, {
          readArgs: TIMESTAMP_READ_ARGS,
        });
        const values: TimestampTagValues = {};
        for (const [key, value] of Object.entries(raw)) {
          if (typeof value === 'string') values[key] = value;
        }
        out.set(filePath, values);
      } catch (err) {
        // A file ExifTool cannot read is not a reason to abandon the folder;
        // it simply has no date and the planner will leave it alone.
        if (isSpawnFailure(err)) {
          unavailable = true;
          void endExifTool();
          return out;
        }
        out.set(filePath, {});
      }
    }
    done += 1;
    onProgress?.(done, filePaths.length);
  }
  return out;
}

/**
 * Forget the deep-metadata cache entry for a file that has just moved.
 *
 * Exported for the rename path. The cache key is path plus mtime plus size, so
 * a rename already makes the entry unreachable — but unreachable is not the
 * same as evicted, and leaving it there means a dead path occupying one of the
 * 512 slots for the rest of the session.
 */
export function forgetCachedMetadata(filePath: string): void {
  dropCachedMetadata(filePath);
}
