import type {
  FocusInfo,
  FocusModeKind,
  FocusRegion,
  FocusVendor,
  LensInfo,
  NormRect,
} from '@photo-culler/types';

export type RawTags = Readonly<Record<string, unknown>>;

/**
 * Maps exiftool output onto a vendor-neutral focus description.
 *
 * Maker-note layouts are proprietary and differ per manufacturer, so every
 * vendor needs its own mapper. Panasonic is implemented (verified against ~960
 * real DC-S5D frames); the others are stubs that return null, which the UI
 * renders as "no focus data" rather than as an error.
 */

// ─── helpers ─────────────────────────────────────────────────────────

/** Read a tag by bare name, ignoring any `Group:` prefix exiftool's -G1 adds. */
function tag(raw: RawTags, name: string): unknown {
  if (name in raw) return raw[name];
  const suffix = `:${name}`;
  for (const key of Object.keys(raw)) {
    if (key.endsWith(suffix)) return raw[key];
  }
  return undefined;
}

function str(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

function num(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Parse a two-value tag. With -json a `Count: 2` rational serialises as the
 * space-joined string "0.503906 0.421875"; arrays and single numbers also occur.
 */
function parsePair(value: unknown): [number, number] | null {
  if (Array.isArray(value) && value.length >= 2) {
    const a = num(value[0]);
    const b = num(value[1]);
    return a !== null && b !== null ? [a, b] : null;
  }
  if (typeof value === 'string') {
    const parts = value.trim().split(/[\s,]+/);
    if (parts.length < 2) return null;
    const a = num(parts[0]);
    const b = num(parts[1]);
    return a !== null && b !== null ? [a, b] : null;
  }
  return null;
}

/**
 * Panasonic writes two "unavailable" sentinels: 4294967295/1024 (= 4194303.999,
 * printed as "n/a") and 16777216 ("none"). Both sit far outside the documented
 * 0.0–1.0 range, so one range check subsumes them and any future sentinel.
 * Verified: this coincides exactly with FocusMode = Manual.
 */
function inUnitRange(pair: [number, number] | null): pair is [number, number] {
  return pair !== null && pair.every((v) => Number.isFinite(v) && v >= 0 && v <= 1);
}

// ─── vendor detection ────────────────────────────────────────────────

const MAKE_TO_VENDOR: Array<[RegExp, FocusVendor]> = [
  [/panasonic|lumix/i, 'panasonic'],
  // Leica-badged Lumix bodies write Panasonic maker notes.
  [/leica/i, 'panasonic'],
  [/canon/i, 'canon'],
  [/nikon/i, 'nikon'],
  [/sony/i, 'sony'],
];

export function detectVendor(raw: RawTags): FocusVendor {
  // exiftool's -G1 prefixes maker-note tags with the vendor group name, which
  // is more reliable than guessing from Make.
  for (const key of Object.keys(raw)) {
    const group = key.split(':')[0]?.toLowerCase();
    if (group === 'panasonic') return 'panasonic';
    if (group === 'canon') return 'canon';
    if (group === 'nikon') return 'nikon';
    if (group === 'sony') return 'sony';
  }

  const make = str(tag(raw, 'Make'));
  if (make) {
    for (const [re, vendor] of MAKE_TO_VENDOR) {
      if (re.test(make)) return vendor;
    }
  }
  return 'unknown';
}

// ─── Panasonic ───────────────────────────────────────────────────────

const PANASONIC_FOCUS_MODE: Array<[RegExp, FocusModeKind]> = [
  [/^AF-S$/i, 'af-s'],
  [/^AF-C$/i, 'af-c'],
  [/^AF-F$/i, 'af-f'],
  [/^Manual$/i, 'manual'],
  [/^Auto/i, 'auto'],
];

function panasonicFocus(raw: RawTags, exifOrientation: number | null): FocusInfo | null {
  const modeLabel = str(tag(raw, 'FocusMode'));
  const areaMode = str(tag(raw, 'AFAreaMode'));
  const subjectDetection = str(tag(raw, 'AFSubjectDetection'));
  const assistLamp = str(tag(raw, 'AFAssistLamp'));
  const facesDetected = num(tag(raw, 'FacesDetected')) ?? num(tag(raw, 'NumFacePositions'));

  let mode: FocusModeKind = 'unknown';
  if (modeLabel) {
    for (const [re, kind] of PANASONIC_FOCUS_MODE) {
      if (re.test(modeLabel)) {
        mode = kind;
        break;
      }
    }
  }

  const regions: FocusRegion[] = [];

  // AFPointPosition is the centre, AFAreaSize the extent — both already
  // normalized 0..1 by the camera, so no calibration is needed.
  const point = parsePair(tag(raw, 'AFPointPosition'));
  if (inUnitRange(point)) {
    const size = parsePair(tag(raw, 'AFAreaSize'));
    const [w, h] = inUnitRange(size) ? size : [0, 0];
    regions.push({
      kind: 'af-point',
      rect: { cx: point[0], cy: point[1], w, h },
      primary: true,
      precision: 'exact',
    });
  }

  regions.push(...panasonicFaces(raw));

  const anyField =
    modeLabel !== null ||
    areaMode !== null ||
    subjectDetection !== null ||
    assistLamp !== null ||
    facesDetected !== null ||
    regions.length > 0;

  if (!anyField) return null;

  return {
    frame: 'sensor',
    exifOrientation,
    mode,
    modeLabel,
    areaMode,
    subjectDetection,
    assistLamp,
    facesDetected,
    regions,
  };
}

/**
 * Panasonic face boxes are NOT normalized. ExifTool documents them as
 * "relative to an image twice the size of the thumbnail, or 320 pixels wide",
 * so X and width divide by 320 and Y and height by 320 * (sensorH / sensorW).
 *
 * Without the sensor dimensions the mapping is unknowable, so we emit no face
 * regions rather than guess at a position that would be drawn on the photo.
 */
const PANASONIC_FACE_REF_WIDTH = 320;

function panasonicFaces(raw: RawTags): FocusRegion[] {
  const sensorW =
    num(tag(raw, 'PanasonicImageWidth')) ??
    num(tag(raw, 'ImageWidth')) ??
    num(tag(raw, 'ExifImageWidth'));
  const sensorH =
    num(tag(raw, 'PanasonicImageHeight')) ??
    num(tag(raw, 'ImageHeight')) ??
    num(tag(raw, 'ExifImageHeight'));

  if (!sensorW || !sensorH || sensorW <= 0 || sensorH <= 0) return [];

  const refW = PANASONIC_FACE_REF_WIDTH;
  const refH = PANASONIC_FACE_REF_WIDTH * (sensorH / sensorW);

  const count = num(tag(raw, 'NumFacePositions')) ?? num(tag(raw, 'FacesDetected')) ?? 0;
  const regions: FocusRegion[] = [];

  for (let i = 1; i <= Math.min(5, count); i++) {
    const value = tag(raw, `Face${i}Position`);
    const parts = Array.isArray(value)
      ? value.map(num)
      : typeof value === 'string'
        ? value
            .trim()
            .split(/[\s,]+/)
            .map(num)
        : null;
    if (!parts || parts.length < 4) continue;
    const [x, y, w, h] = parts;
    if (x === null || y === null || w === null || h === null) continue;

    const rect: NormRect = { cx: x / refW, cy: y / refH, w: w / refW, h: h / refH };
    if (![rect.cx, rect.cy, rect.w, rect.h].every((v) => Number.isFinite(v))) continue;

    regions.push({ kind: 'face', rect, primary: false, precision: 'approx' });
  }

  return regions;
}

function panasonicLens(raw: RawTags): LensInfo {
  return {
    id: str(tag(raw, 'LensType')),
    serial: str(tag(raw, 'LensSerialNumber')),
    model: str(tag(raw, 'LensModel')),
  };
}

// ─── dispatch ────────────────────────────────────────────────────────

type VendorMapper = (
  raw: RawTags,
  exifOrientation: number | null,
) => { focus: FocusInfo | null; lens: LensInfo | null };

const MAPPERS: Record<FocusVendor, VendorMapper> = {
  panasonic: (raw, o) => ({ focus: panasonicFocus(raw, o), lens: panasonicLens(raw) }),
  // Adding a vendor is one table entry — no call site changes.
  canon: () => ({ focus: null, lens: null }),
  nikon: () => ({ focus: null, lens: null }),
  sony: () => ({ focus: null, lens: null }),
  unknown: () => ({ focus: null, lens: null }),
};

export function mapFocusTags(raw: RawTags): {
  vendor: FocusVendor;
  focus: FocusInfo | null;
  lens: LensInfo | null;
} {
  const vendor = detectVendor(raw);
  const exifOrientation = num(tag(raw, 'Orientation'));
  const { focus, lens } = MAPPERS[vendor](raw, exifOrientation);

  // Even for an unmapped vendor the plain EXIF lens name is worth surfacing.
  const fallbackLens: LensInfo = { id: null, serial: null, model: str(tag(raw, 'LensModel')) };
  const resolvedLens = lens ?? (fallbackLens.model ? fallbackLens : null);

  return { vendor, focus, lens: resolvedLens };
}

// ─── orientation ─────────────────────────────────────────────────────

/**
 * EXIF Orientation on a point in [0,1]^2. For 5-8 the display frame is
 * transposed, so width and height swap as well.
 *
 * Derivation, so the table is auditable: orientation 6 means "rotate 90 CW to
 * display", which sends the stored top-left corner to the display top-right,
 * i.e. (u,v) -> (1-v, u). Check: (0,0) -> (1,0) and (1,0) -> (1,1). Cases 5 and
 * 7 are "mirror horizontally, then rotate", composed in that order.
 */
function orientRect(r: NormRect, orientation: number): NormRect {
  switch (orientation) {
    case 2:
      return { cx: 1 - r.cx, cy: r.cy, w: r.w, h: r.h };
    case 3:
      return { cx: 1 - r.cx, cy: 1 - r.cy, w: r.w, h: r.h };
    case 4:
      return { cx: r.cx, cy: 1 - r.cy, w: r.w, h: r.h };
    case 5:
      return { cx: r.cy, cy: r.cx, w: r.h, h: r.w };
    case 6:
      return { cx: 1 - r.cy, cy: r.cx, w: r.h, h: r.w };
    case 7:
      return { cx: 1 - r.cy, cy: 1 - r.cx, w: r.h, h: r.w };
    case 8:
      return { cx: r.cy, cy: 1 - r.cx, w: r.h, h: r.w };
    case 1:
    default:
      return r;
  }
}

/**
 * Move every rect from the raw sensor frame into the frame the browser renders.
 *
 * Idempotent by design: a FocusInfo already marked 'displayed' is returned
 * unchanged, so caching a transformed value cannot double-apply the rotation.
 *
 * User rotation is NOT handled here — that is a CSS transform on the shared
 * wrapper the image and all overlays live in, so it applies to them together.
 */
export function orientFocusInfo(info: FocusInfo): FocusInfo {
  if (info.frame === 'displayed') return info;

  const orientation = info.exifOrientation ?? 1;
  if (orientation === 1) return { ...info, frame: 'displayed' };

  return {
    ...info,
    frame: 'displayed',
    regions: info.regions.map((region) => ({
      ...region,
      rect: orientRect(region.rect, orientation),
    })),
  };
}
