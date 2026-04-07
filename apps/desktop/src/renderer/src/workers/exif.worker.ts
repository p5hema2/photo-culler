/**
 * EXIF extraction Web Worker.
 * Receives image data as ArrayBuffers, extracts full camera metadata using exifr,
 * and streams results back one at a time.
 */
import * as exifr from 'exifr';

export interface ExifFileData {
  path: string;
  buffer: ArrayBuffer;
}

export interface ExifRequest {
  file: ExifFileData;
}

export interface ExifResult {
  path: string;
  /** True UTC timestamp for sorting (local time minus offset) */
  dateTaken: number | null;
  /** Camera wall-clock time encoded as UTC for display */
  dateTakenLocal: number | null;
  /** UTC offset at capture, e.g. "+01:00" */
  timezoneOffset: string | null;
  width: number | null;
  height: number | null;
  cameraMake: string | null;
  cameraModel: string | null;
  lensModel: string | null;
  focalLength: number | null;
  aperture: number | null;
  shutterSpeed: string | null;
  iso: number | null;
  exposureCompensation: number | null;
  flash: string | null;
  whiteBalance: string | null;
  meteringMode: string | null;
  exposureProgram: string | null;
  colorSpace: string | null;
}

export interface ExifDone {
  done: true;
}

export type ExifResponse = ExifResult | ExifDone;

const EXIF_TAGS = [
  'DateTimeOriginal',
  'OffsetTimeOriginal',
  'ImageWidth',
  'ImageHeight',
  'Make',
  'Model',
  'LensModel',
  'LensInfo',
  'FocalLength',
  'FocalLengthIn35mmFormat',
  'FNumber',
  'ExposureTime',
  'ISO',
  'ISOSpeedRatings',
  'ExposureCompensation',
  'ExposureBiasValue',
  'Flash',
  'WhiteBalance',
  'MeteringMode',
  'ExposureProgram',
  'ColorSpace',
];

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
  const denom = Math.round(1 / seconds);
  return `1/${denom}`;
}

function formatFlash(value: number | string | undefined): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  // Flash is a bitmask — bit 0 indicates whether flash fired
  return value & 1 ? 'Fired' : 'No flash';
}

self.onmessage = async (event: MessageEvent<ExifRequest>) => {
  const { file } = event.data;

  try {
    const parsed = await exifr.parse(file.buffer, {
      pick: EXIF_TAGS,
      translateValues: false,
      reviveValues: false,
    });

    // Parse the raw EXIF date string ("YYYY:MM:DD HH:MM:SS") via Date.UTC
    // to avoid system-timezone DST corruption (e.g. camera's 02:44 becomes 03:44).
    //
    // dateTakenLocal = camera wall-clock time encoded as UTC (for display)
    // dateTaken      = true UTC for sorting (local minus offset, or same as local if no offset)
    let dateTaken: number | null = null;
    let dateTakenLocal: number | null = null;
    let timezoneOffset: string | null = null;

    if (parsed?.DateTimeOriginal) {
      const dt = parsed.DateTimeOriginal;
      if (typeof dt === 'string') {
        const m = dt.match(/^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
        if (m) {
          dateTakenLocal = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!);
          if (isNaN(dateTakenLocal)) dateTakenLocal = null;
        }
      }
    }

    // Extract offset and compute true UTC
    if (dateTakenLocal != null) {
      const offsetRaw = parsed?.OffsetTimeOriginal;
      if (typeof offsetRaw === 'string') {
        const om = offsetRaw.match(/^([+-])(\d{2}):(\d{2})$/);
        if (om) {
          timezoneOffset = offsetRaw;
          const sign = om[1] === '+' ? 1 : -1;
          const offsetMs = sign * (+om[2]! * 60 + +om[3]!) * 60_000;
          dateTaken = dateTakenLocal - offsetMs;
        }
      }
      // No offset available — use local time as sort key (best we can do)
      if (dateTaken == null) dateTaken = dateTakenLocal;
    }

    const width: number | null = parsed?.ImageWidth ?? null;
    const height: number | null = parsed?.ImageHeight ?? null;

    const cameraMake: string | null = parsed?.Make?.trim() ?? null;
    const cameraModel: string | null = parsed?.Model?.trim() ?? null;
    const lensModel: string | null = parsed?.LensModel?.trim() ?? null;

    const focalLength: number | null =
      parsed?.FocalLength ?? parsed?.FocalLengthIn35mmFormat ?? null;
    const aperture: number | null = parsed?.FNumber ?? null;

    let shutterSpeed: string | null = null;
    if (parsed?.ExposureTime != null) {
      shutterSpeed = formatShutterSpeed(parsed.ExposureTime);
    }

    const iso: number | null = parsed?.ISO ?? parsed?.ISOSpeedRatings ?? null;
    const exposureCompensation: number | null =
      parsed?.ExposureCompensation ?? parsed?.ExposureBiasValue ?? null;

    const flash: string | null = formatFlash(parsed?.Flash);

    let whiteBalance: string | null = null;
    if (parsed?.WhiteBalance != null) {
      whiteBalance = parsed.WhiteBalance === 0 ? 'Auto' : 'Manual';
    }

    const meteringMode: string | null =
      parsed?.MeteringMode != null
        ? (METERING_MODES[parsed.MeteringMode] ?? `Mode ${parsed.MeteringMode}`)
        : null;

    const exposureProgram: string | null =
      parsed?.ExposureProgram != null
        ? (EXPOSURE_PROGRAMS[parsed.ExposureProgram] ?? `Program ${parsed.ExposureProgram}`)
        : null;

    const colorSpace: string | null =
      parsed?.ColorSpace != null
        ? (COLOR_SPACES[parsed.ColorSpace] ?? `Space ${parsed.ColorSpace}`)
        : null;

    self.postMessage({
      path: file.path,
      dateTaken,
      dateTakenLocal,
      timezoneOffset,
      width,
      height,
      cameraMake,
      cameraModel,
      lensModel,
      focalLength,
      aperture,
      shutterSpeed,
      iso,
      exposureCompensation,
      flash,
      whiteBalance,
      meteringMode,
      exposureProgram,
      colorSpace,
    } as ExifResult);
  } catch {
    self.postMessage({
      path: file.path,
      dateTaken: null,
      dateTakenLocal: null,
      timezoneOffset: null,
      width: null,
      height: null,
      cameraMake: null,
      cameraModel: null,
      lensModel: null,
      focalLength: null,
      aperture: null,
      shutterSpeed: null,
      iso: null,
      exposureCompensation: null,
      flash: null,
      whiteBalance: null,
      meteringMode: null,
      exposureProgram: null,
      colorSpace: null,
    } as ExifResult);
  }
};
