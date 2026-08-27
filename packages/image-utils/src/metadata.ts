import exifr from 'exifr';
import { clampRating } from './rating';

/**
 * The embedded-preview parser, re-exported so the main process can reach it.
 *
 * `mpf.ts` is where the byte parsing lives — it has no business next to exifr —
 * but a consumer resolves a deep import through this package's `exports` map,
 * which lists `./metadata` and not `./mpf`. This is the metadata entry point the
 * main process already uses, and where a preview sits in a file is metadata, so
 * it forwards rather than adding a fifth copy of the alias table. Whoever next
 * edits the manifest may promote `./mpf` to its own entry and drop this.
 */
export {
  findMpfPreview,
  isPlausiblePreviewRange,
  checkMpfPreview,
  readJpegOrientation,
  readJpegSize,
  type MpfPreview,
  type MpfPreviewCheck,
  type MpfPreviewRejection,
  type JpegSize,
} from './mpf';

/**
 * Metadata lifted off an image file at scan time.
 *
 * Every field is optional: a stripped JPEG, a PNG straight out of a screenshot
 * tool, or an unreadable file all produce an empty object rather than an error.
 * Absent is a normal outcome here, never a failure.
 */
export interface ImageMetadata {
  dateTaken?: number;
  dateTakenLocal?: number;
  timezoneOffset?: string;
  width?: number;
  height?: number;
  cameraMake?: string;
  cameraModel?: string;
  lensModel?: string;
  focalLength?: number;
  aperture?: number;
  shutterSpeed?: string;
  iso?: number;
  exposureCompensation?: number;
  flash?: string;
  whiteBalance?: string;
  meteringMode?: string;
  exposureProgram?: string;
  colorSpace?: string;
  /** Star rating, 0-5, where 0 means unrated. See clampRating. */
  rating?: number;
}

/**
 * exifr options.
 *
 * `xmp: true` and NO `pick` list, both deliberately. `pick` filters the XMP
 * block out: measured against 20 files carrying only `xmp:Rating`, a pick list
 * containing 'Rating' found 0 of 20 while these options found 20 of 20 — and
 * cost the same 0.2-0.5 ms per file. A rating written by Lightroom lives in the
 * XMP packet alone, so a pick list would make exactly the interoperability case
 * invisible.
 *
 * `translateValues` and `reviveValues` stay off because the maps below expect
 * the raw numeric enum values, and dates are parsed by hand — see mapExifTags.
 */
const PARSE_OPTIONS = {
  xmp: true,
  translateValues: false,
  reviveValues: false,
} as const;

const METERING_MODES: Record<number, string> = {
  0: 'Unknown',
  1: 'Average',
  2: 'Center-weighted',
  3: 'Spot',
  4: 'Multi-spot',
  5: 'Multi-segment',
  6: 'Partial',
};

const EXPOSURE_PROGRAMS: Record<number, string> = {
  0: 'Not defined',
  1: 'Manual',
  2: 'Program AE',
  3: 'Aperture Priority',
  4: 'Shutter Priority',
  5: 'Creative',
  6: 'Action',
  7: 'Portrait',
  8: 'Landscape',
};

const COLOR_SPACES: Record<number, string> = {
  1: 'sRGB',
  2: 'Adobe RGB',
  0xffff: 'Uncalibrated',
};

function formatShutterSpeed(seconds: number): string {
  if (seconds >= 1) {
    return seconds % 1 === 0 ? `${seconds}s` : `${seconds.toFixed(1)}s`;
  }
  return `1/${Math.round(1 / seconds)}`;
}

function formatFlash(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value !== 'number') return undefined;
  // Flash is a bitmask — bit 0 says whether it fired.
  return value & 1 ? 'Fired' : 'No flash';
}

function trimmed(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function numeric(...values: unknown[]): number | undefined {
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return undefined;
}

function named(map: Record<number, string>, value: unknown, prefix: string): string | undefined {
  if (typeof value !== 'number') return undefined;
  return map[value] ?? `${prefix} ${value}`;
}

/**
 * Turn a raw exifr result into the fields the app displays, sorts and groups by.
 *
 * Kept pure and free of fs so the date arithmetic — the part that has actually
 * been wrong before — is unit-testable.
 */
export function mapExifTags(parsed: Record<string, unknown> | undefined | null): ImageMetadata {
  if (!parsed) return {};
  const meta: ImageMetadata = {};

  // Parse "YYYY:MM:DD HH:MM:SS" through Date.UTC rather than `new Date(...)`:
  // the latter reads it in the system timezone, and a DST boundary then shifts
  // the camera's 02:44 to 03:44.
  //
  //   dateTakenLocal = camera wall-clock time encoded as UTC, for display
  //   dateTaken      = true UTC, for sorting and burst grouping
  const raw = parsed.DateTimeOriginal;
  if (typeof raw === 'string') {
    const m = /^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/.exec(raw);
    if (m) {
      const local = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!);
      if (!Number.isNaN(local)) meta.dateTakenLocal = local;
    }
  }

  if (meta.dateTakenLocal != null) {
    const offsetRaw = parsed.OffsetTimeOriginal;
    if (typeof offsetRaw === 'string') {
      const om = /^([+-])(\d{2}):(\d{2})$/.exec(offsetRaw);
      if (om) {
        meta.timezoneOffset = offsetRaw;
        const sign = om[1] === '+' ? 1 : -1;
        meta.dateTaken = meta.dateTakenLocal - sign * (+om[2]! * 60 + +om[3]!) * 60_000;
      }
    }
    // No offset recorded — local time is the best sort key available.
    meta.dateTaken ??= meta.dateTakenLocal;
  }

  meta.width = numeric(parsed.ImageWidth);
  meta.height = numeric(parsed.ImageHeight);
  meta.cameraMake = trimmed(parsed.Make);
  meta.cameraModel = trimmed(parsed.Model);
  meta.lensModel = trimmed(parsed.LensModel);
  meta.focalLength = numeric(parsed.FocalLength, parsed.FocalLengthIn35mmFormat);
  meta.aperture = numeric(parsed.FNumber);

  const exposureTime = numeric(parsed.ExposureTime);
  if (exposureTime != null && exposureTime > 0)
    meta.shutterSpeed = formatShutterSpeed(exposureTime);

  meta.iso = numeric(parsed.ISO, parsed.ISOSpeedRatings);
  meta.exposureCompensation = numeric(parsed.ExposureCompensation, parsed.ExposureBiasValue);
  meta.flash = formatFlash(parsed.Flash);

  if (typeof parsed.WhiteBalance === 'number') {
    meta.whiteBalance = parsed.WhiteBalance === 0 ? 'Auto' : 'Manual';
  }
  meta.meteringMode = named(METERING_MODES, parsed.MeteringMode, 'Mode');
  meta.exposureProgram = named(EXPOSURE_PROGRAMS, parsed.ExposureProgram, 'Program');
  meta.colorSpace = named(COLOR_SPACES, parsed.ColorSpace, 'Space');

  // Rating: xmp:Rating and the Microsoft EXIF tag (0x4746) both surface as
  // `Rating`. Whichever the file carries, the app writes both, so they agree
  // for anything it produced itself.
  meta.rating = clampRating(parsed.Rating);

  return meta;
}

/**
 * Read one image's metadata from disk.
 *
 * exifr's own file API seeks rather than slurping: measured 0.44 ms per 24 MP
 * JPEG against 6.7 ms to read the whole 12.9 MB file. That difference is the
 * entire reason this can run over every image at scan time instead of being
 * cached in the results file.
 *
 * Never throws. An unreadable or metadata-free file yields {}, which is
 * indistinguishable from a file that simply has no EXIF — and both are normal.
 */
export async function readImageMetadata(filePath: string): Promise<ImageMetadata> {
  try {
    return mapExifTags(await exifr.parse(filePath, PARSE_OPTIONS));
  } catch {
    return {};
  }
}
