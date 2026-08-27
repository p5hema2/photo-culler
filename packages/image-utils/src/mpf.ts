/**
 * Finding the preview image a camera already embedded in a JPEG, by parsing the
 * Multi-Picture Format index out of the file's leading bytes.
 *
 * Why it exists: a thumbnail used to be generated from the original, which on
 * the folder that motivated this meant reading 6.2 MB and decoding 6000x4000
 * (94 ms) to produce a 19 kB image. The first open of that folder spent 235 s
 * generating 1725 thumbnails, disk-bound at ~45 MB/s. Every file in it carries a
 * 1620x1080 MPF preview of 417-544 kB that decodes in 11.6 ms, so using it is
 * ~11x less I/O and ~8x less decode. exiftool can extract the same bytes, but at
 * a measured 41-866 ms per file that costs more than it saves — hence a parser.
 *
 * Everything here is pure byte inspection over a Buffer: no fs, no decoding, and
 * nothing throws. An unparseable file is a NORMAL outcome and yields null,
 * because the caller's fallback — read the whole file, exactly as before — is
 * what keeps a PNG, a TIFF, a stripped JPEG and an unfamiliar camera working.
 */

/** Markers, without their 0xFF prefix. */
const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const TEM = 0x01;
const RST0 = 0xd0;
const RST7 = 0xd7;
const APP1 = 0xe1;
const APP2 = 0xe2;

const MPF_SIGNATURE = Buffer.from('MPF\0', 'latin1');
const EXIF_SIGNATURE = Buffer.from('Exif\0\0', 'latin1');

/** MP Index IFD tag holding the per-image entry table. */
const TAG_MP_ENTRY = 0xb002;
/** IFD0 tag holding the EXIF orientation. */
const TAG_ORIENTATION = 0x0112;

/** One MPEntry: 4 bytes attributes, 4 size, 4 offset, 2 + 2 dependency. */
const MP_ENTRY_BYTES = 16;

/** TIFF field types, and the byte width of one element of each. */
const TYPE_BYTE = 1;
const TYPE_UNDEFINED = 7;
const TYPE_SIZES: Record<number, number> = {
  1: 1, // BYTE
  2: 1, // ASCII
  3: 2, // SHORT
  4: 4, // LONG
  5: 8, // RATIONAL
  6: 1, // SBYTE
  7: 1, // UNDEFINED
  8: 2, // SSHORT
  9: 4, // SLONG
  10: 8, // SRATIONAL
  11: 4, // FLOAT
  12: 8, // DOUBLE
};

interface Segment {
  /** Marker byte, without its 0xFF prefix. */
  marker: number;
  /** Offset of the payload — past the marker and its 2-byte length. */
  dataStart: number;
  /** Offset one past the payload. */
  dataEnd: number;
}

/**
 * The marker segments of a JPEG in `bytes`, in file order.
 *
 * Stops — returning what it found so far — at SOS, which begins the
 * entropy-coded scan and has no length field to skip past, and at anything that
 * does not parse: a marker without its 0xFF prefix, a length below the two bytes
 * it counts itself, or a segment running off the end of the buffer.
 *
 * That last case is the interesting one, because callers pass only a file's
 * leading bytes: a large ICC profile or XMP packet genuinely can be cut off
 * there. Stopping is the right answer — the segment after it cannot be located
 * without its length — and it is why an unreachable MPF index is
 * indistinguishable from an absent one.
 */
function parseJpegSegments(bytes: Buffer): Segment[] {
  const segments: Segment[] = [];
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== SOI) return segments;

  let pos = 2;
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) break;
    // Any number of 0xFF fill bytes may pad before a marker.
    while (pos + 4 <= bytes.length && bytes[pos + 1] === 0xff) pos++;
    if (pos + 4 > bytes.length) break;

    const marker = bytes[pos + 1]!;
    if (marker === SOS || marker === EOI) break;
    // Standalone markers carry no length field.
    if (marker === TEM || (marker >= RST0 && marker <= RST7)) {
      pos += 2;
      continue;
    }

    const length = bytes.readUInt16BE(pos + 2);
    if (length < 2) break;
    const dataEnd = pos + 2 + length;
    if (dataEnd > bytes.length) break;

    segments.push({ marker, dataStart: pos + 4, dataEnd });
    pos = dataEnd;
  }

  return segments;
}

function hasSignature(bytes: Buffer, segment: Segment, signature: Buffer): boolean {
  if (segment.dataStart + signature.length > segment.dataEnd) return false;
  return (
    bytes.compare(
      signature,
      0,
      signature.length,
      segment.dataStart,
      segment.dataStart + signature.length,
    ) === 0
  );
}

/**
 * Byte-order-aware reads over one TIFF block, with every offset relative to the
 * block's own base — which is what TIFF offsets are relative to.
 */
interface TiffReader {
  u16(offset: number): number;
  u32(offset: number): number;
  /** Whether `size` bytes at `offset` lie inside the block. */
  has(offset: number, size: number): boolean;
  /** Offset of the first IFD. */
  firstIfd: number;
}

/**
 * Open the TIFF block starting at `base`, honouring its byte order marker.
 *
 * Both endiannesses occur in the wild — Canon writes little-endian, Nikon and
 * Fujifilm big-endian — and the MPF block's order is independent of the EXIF
 * block's in the same file, so neither may be assumed from the other.
 */
function openTiff(bytes: Buffer, base: number, limit: number): TiffReader | null {
  const end = Math.min(limit, bytes.length);
  if (base < 0 || base + 8 > end) return null;

  const byteOrder = bytes.readUInt16BE(base);
  const little = byteOrder === 0x4949; // 'II'
  if (!little && byteOrder !== 0x4d4d) return null; // 'MM'

  const has = (offset: number, size: number): boolean =>
    offset >= 0 && size >= 0 && base + offset + size <= end;
  const u16 = (offset: number): number =>
    little ? bytes.readUInt16LE(base + offset) : bytes.readUInt16BE(base + offset);
  const u32 = (offset: number): number =>
    little ? bytes.readUInt32LE(base + offset) : bytes.readUInt32BE(base + offset);

  if (u16(2) !== 42) return null; // TIFF magic
  return { u16, u32, has, firstIfd: u32(4) };
}

interface IfdEntry {
  tag: number;
  type: number;
  /** Element count, in units of the type — not bytes, unless the type is 1 byte wide. */
  count: number;
  /** Offset of the value, relative to the TIFF base. */
  valueOffset: number;
}

function readIfd(tiff: TiffReader, ifdOffset: number): IfdEntry[] {
  if (!tiff.has(ifdOffset, 2)) return [];

  const entries: IfdEntry[] = [];
  const count = tiff.u16(ifdOffset);
  for (let i = 0; i < count; i++) {
    const at = ifdOffset + 2 + i * 12;
    if (!tiff.has(at, 12)) break;

    const type = tiff.u16(at + 2);
    const elements = tiff.u32(at + 4);
    const size = (TYPE_SIZES[type] ?? 0) * elements;
    // A value of four bytes or fewer is stored in the entry itself; anything
    // larger lives elsewhere in the block and the field holds its offset.
    const valueOffset = size > 0 && size <= 4 ? at + 8 : tiff.u32(at + 8);

    entries.push({ tag: tiff.u16(at), type, count: elements, valueOffset });
  }
  return entries;
}

/** Where an embedded preview sits in the file, and how long it is. */
export interface MpfPreview {
  /**
   * Absolute offset in the FILE of the preview's own SOI marker.
   *
   * MPEntry offsets are relative to the start of the MPF TIFF header — the byte
   * after `MPF\0` in the APP2 payload — and NOT to the start of the file. That
   * conversion is done here, once, because getting it wrong yields
   * plausible-looking garbage rather than an error.
   */
  offset: number;
  /** Length in bytes, as MPEntry declares it. */
  length: number;
}

/**
 * The largest non-primary MPF image in a JPEG's leading bytes, or null.
 *
 * `head` need only reach the APP2 segment; an index beyond the bytes supplied
 * reads as absent, and the caller falls back.
 *
 * The first MPEntry is the primary image: its offset field is 0 and its declared
 * size is the whole file, so reading it back would be exactly the amplification
 * this avoids. It is skipped by that offset of 0, which is what the format
 * specifies for it.
 */
export function findMpfPreview(head: Buffer): MpfPreview | null {
  const segment = parseJpegSegments(head).find(
    (s) => s.marker === APP2 && hasSignature(head, s, MPF_SIGNATURE),
  );
  if (!segment) return null;

  const tiffBase = segment.dataStart + MPF_SIGNATURE.length;
  const tiff = openTiff(head, tiffBase, segment.dataEnd);
  if (!tiff) return null;

  const entryTable = readIfd(tiff, tiff.firstIfd).find((e) => e.tag === TAG_MP_ENTRY);
  if (!entryTable) return null;
  // MPEntry is UNDEFINED, so its count is a byte count. Refusing anything else
  // keeps the division below honest rather than guessing at a novel encoding.
  if (entryTable.type !== TYPE_UNDEFINED && entryTable.type !== TYPE_BYTE) return null;

  let best: MpfPreview | null = null;
  const images = Math.floor(entryTable.count / MP_ENTRY_BYTES);
  for (let i = 0; i < images; i++) {
    const at = entryTable.valueOffset + i * MP_ENTRY_BYTES;
    if (!tiff.has(at, MP_ENTRY_BYTES)) break;

    const length = tiff.u32(at + 4);
    const offset = tiff.u32(at + 8);
    if (offset === 0 || length === 0) continue; // the primary image, or nothing

    if (best === null || length > best.length) best = { offset: tiffBase + offset, length };
  }

  return best;
}

/**
 * Bounds a declared preview length has to fall inside.
 *
 * The floor: the measured previews are 417-544 kB, and even a 512 px JPEG cannot
 * be a few hundred bytes. The ceiling is a memory guard — the length is data read
 * out of the file and nothing else validates it.
 */
const MIN_PREVIEW_BYTES = 1024;
const MAX_PREVIEW_BYTES = 16 * 1024 * 1024;

/**
 * Whether a located preview names a byte range that could really lie in a file
 * of `fileSize` bytes.
 *
 * Kept apart from `findMpfPreview` because only the caller knows the file's
 * size, and kept out of the caller because it is format knowledge rather than
 * policy. An offset past the end, a length of six bytes and a length of a
 * gigabyte are all things a corrupt or unfamiliar index can say, and each has to
 * end in the fallback rather than in a read.
 */
export function isPlausiblePreviewRange(preview: MpfPreview, fileSize: number): boolean {
  if (preview.length < MIN_PREVIEW_BYTES || preview.length > MAX_PREVIEW_BYTES) return false;
  // Offset 2 is the earliest a second image could begin: past the file's own SOI.
  return preview.offset >= 2 && preview.offset + preview.length <= fileSize;
}

/**
 * EXIF orientation from a JPEG's leading bytes; 1 — no rotation — when the file
 * does not say, which is also what a file with no EXIF at all means.
 */
export function readJpegOrientation(bytes: Buffer): number {
  const segment = parseJpegSegments(bytes).find(
    (s) => s.marker === APP1 && hasSignature(bytes, s, EXIF_SIGNATURE),
  );
  if (!segment) return 1;

  const tiff = openTiff(bytes, segment.dataStart + EXIF_SIGNATURE.length, segment.dataEnd);
  if (!tiff) return 1;

  const entry = readIfd(tiff, tiff.firstIfd).find((e) => e.tag === TAG_ORIENTATION);
  if (!entry || !tiff.has(entry.valueOffset, 2)) return 1;

  const value = tiff.u16(entry.valueOffset);
  return value >= 1 && value <= 8 ? value : 1;
}

export interface JpegSize {
  width: number;
  height: number;
}

function isStartOfFrame(marker: number): boolean {
  // 0xC0-0xCF are frame headers except for these three: DHT, JPG and DAC.
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

/**
 * Pixel dimensions from a JPEG's frame header, or null when `bytes` holds none.
 *
 * MPEntry says how many BYTES an image is, never how many pixels, and a preview
 * shorter than the thumbnail's own longest edge would only be upscaled. The
 * frame header is the cheapest place to settle that: it sits in the extracted
 * bytes the caller already holds, so it costs no I/O and no decode.
 */
export function readJpegSize(bytes: Buffer): JpegSize | null {
  for (const segment of parseJpegSegments(bytes)) {
    if (!isStartOfFrame(segment.marker)) continue;
    // Payload: 1 byte sample precision, then height, then width, 2 bytes each.
    if (segment.dataStart + 5 > segment.dataEnd) return null;
    const height = bytes.readUInt16BE(segment.dataStart + 1);
    const width = bytes.readUInt16BE(segment.dataStart + 3);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  return null;
}

/** Why extracted preview bytes cannot stand in for the original. */
export type MpfPreviewRejection = 'not-a-jpeg' | 'too-small' | 'orientation-mismatch';

export type MpfPreviewCheck =
  | ({ usable: true } & JpegSize)
  | { usable: false; reason: MpfPreviewRejection };

/**
 * Decide whether extracted bytes really are a usable preview of `head`'s file.
 *
 * MPEntry is trusted for nothing beyond where to read: it carries no pixel
 * count, no format and no checksum. So the bytes are checked for a JPEG SOI, for
 * being at least `minEdge` on their longest side, and for agreeing with the
 * original about which way is up.
 *
 * That last check is not paranoia. The thumbnail worker decodes with
 * `imageOrientation: 'from-image'` while the detail view honours EXIF
 * orientation too, so a preview whose orientation differs from the original's —
 * a camera that stores no orientation in the preview of a portrait frame, say —
 * would put the thumbnail on its side and nothing else in the app with it.
 * Cheaper to read the whole file for those than to ship a sideways grid.
 *
 * Anything this cannot see — a truncated preview, a format the decoder rejects —
 * is left to the decoder, whose failure must also fall back to the full file
 * rather than produce a broken cell.
 */
export function checkMpfPreview(head: Buffer, preview: Buffer, minEdge: number): MpfPreviewCheck {
  if (preview.length < 4 || preview[0] !== 0xff || preview[1] !== SOI) {
    return { usable: false, reason: 'not-a-jpeg' };
  }

  const size = readJpegSize(preview);
  if (!size || Math.max(size.width, size.height) < minEdge) {
    return { usable: false, reason: 'too-small' };
  }

  if (readJpegOrientation(preview) !== readJpegOrientation(head)) {
    return { usable: false, reason: 'orientation-mismatch' };
  }

  return { usable: true, ...size };
}
