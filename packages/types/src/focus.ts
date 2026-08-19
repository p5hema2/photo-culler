/** Maker-note dialect the focus mapper recognised. */
export type FocusVendor = 'panasonic' | 'canon' | 'nikon' | 'sony' | 'unknown';

/** Focus mode collapsed from each vendor's own enumeration. */
export type FocusModeKind = 'af-s' | 'af-c' | 'af-f' | 'manual' | 'auto' | 'unknown';

/**
 * Which pixel frame a FocusInfo's rectangles are expressed in.
 *
 * 'sensor'    — the raw, unrotated capture frame, exactly as the camera wrote it
 * 'displayed' — after EXIF orientation, i.e. the frame the browser renders
 */
export type FocusFrame = 'sensor' | 'displayed';

export type FocusRegionKind = 'af-point' | 'face' | 'eye' | 'subject';

/**
 * Rectangle in normalized coordinates: centre plus size, each 0..1, relative to
 * the frame named by the owning FocusInfo.frame.
 */
export interface NormRect {
  /** Centre X, 0..1 */
  cx: number;
  /** Centre Y, 0..1 */
  cy: number;
  /** Width, 0..1. Zero when the camera reported only a point. */
  w: number;
  /** Height, 0..1. Zero when the camera reported only a point. */
  h: number;
}

export interface FocusRegion {
  kind: FocusRegionKind;
  rect: NormRect;
  /** True for the region the camera actually focused on, when known. */
  primary: boolean;
  /** Free-text vendor label, e.g. "Human Eye/Face/Body". */
  label?: string;
  /**
   * 'exact'  — the vendor supplied normalized coordinates
   * 'approx' — derived from a fixed reference frame (Panasonic face boxes are
   *            relative to a 320px-wide image, so the mapping depends on the
   *            sensor aspect ratio)
   */
  precision: 'exact' | 'approx';
}

export interface FocusInfo {
  /**
   * Coordinate frame of every rect below. Run orientFocusInfo() before drawing
   * over an EXIF-oriented <img>. Carried as a field rather than a comment so
   * the transform can refuse to run twice.
   */
  frame: FocusFrame;
  /** EXIF Orientation 1-8 of the source file, or null when absent. */
  exifOrientation: number | null;
  mode: FocusModeKind;
  /** Raw vendor focus-mode string for display, e.g. "AF-S". */
  modeLabel: string | null;
  /** Vendor AF-area mode, e.g. "1-area", "Face Detect", "Tracking". */
  areaMode: string | null;
  /** Vendor subject-detection mode, e.g. "Human Eye/Face/Body". */
  subjectDetection: string | null;
  /** AF assist lamp state, e.g. "Fired". */
  assistLamp: string | null;
  /** Face count the camera reported. */
  facesDetected: number | null;
  /** Most significant region first (primary AF point, then faces). May be empty. */
  regions: FocusRegion[];
}

export interface LensInfo {
  /** Maker-note lens id, e.g. "LUMIX S 18/F1.8". */
  id: string | null;
  serial: string | null;
  /** EXIF LensModel — often the only populated one. */
  model: string | null;
}

/** One decoded metadata tag, for the raw tag list in the info panel. */
export interface MetadataTag {
  group: string;
  name: string;
  value: string;
}

/** Payload of the READ_DETAILED_METADATA channel. */
export interface DetailedMetadata {
  /** Echoed back so a late response for a previous image can be discarded. */
  path: string;
  /** Source file mtime at read time — cache-invalidation key. */
  sourceMtimeMs: number;
  vendor: FocusVendor;
  focus: FocusInfo | null;
  lens: LensInfo | null;
  /** Everything else exiftool returned, for the collapsible tag list. */
  tags: MetadataTag[];
}
