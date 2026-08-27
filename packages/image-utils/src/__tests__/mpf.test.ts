import { describe, it, expect } from 'vitest';
import {
  findMpfPreview,
  isPlausiblePreviewRange,
  checkMpfPreview,
  readJpegOrientation,
  readJpegSize,
} from '../mpf';

/**
 * Every fixture here is assembled byte by byte. No real photo is involved on
 * purpose: the interesting inputs are the malformed ones, and a camera file
 * cannot be asked for a truncated APP2 segment or a byte order marker of
 * nonsense.
 */

/** A marker segment: 0xFF, the marker, its 2-byte length, then the payload. */
function segment(marker: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt8(0xff, 0);
  header.writeUInt8(marker, 1);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

/** SOI, the given segments, then SOS — where a real file's scan data begins. */
function jpeg(...segments: Buffer[]): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xd8]), ...segments, Buffer.from([0xff, 0xda])]);
}

const APP1 = 0xe1;
const APP2 = 0xe2;
const SOF0 = 0xc0;
const DHT = 0xc4;

/**
 * Where the MPF TIFF header lands in a file whose first segment is the APP2:
 * 2 bytes of SOI, 4 of marker and length, 4 of `MPF\0`. Every MPEntry offset is
 * relative to THAT, which is the one thing about this format worth pinning.
 */
const MPF_TIFF_BASE = 2 + 4 + 4;

interface FakeEntry {
  size: number;
  offset: number;
}

/**
 * An APP2 payload: `MPF\0`, a TIFF header, an MP Index IFD holding one MPEntry
 * tag, and the entry table it points at.
 *
 * `little` picks the byte order, which real files disagree about — Canon writes
 * little-endian, Nikon big-endian — and which the parser has to read off the
 * block rather than assume.
 */
function mpfPayload(
  entries: FakeEntry[],
  little: boolean,
  options: { tablePointer?: number } = {},
) {
  const tableAt = 26; // 8 header + 2 count + 12 entry + 4 next
  const tiff = Buffer.alloc(tableAt + entries.length * 16);
  const u16 = (at: number, value: number): void => {
    if (little) tiff.writeUInt16LE(value, at);
    else tiff.writeUInt16BE(value, at);
  };
  const u32 = (at: number, value: number): void => {
    if (little) tiff.writeUInt32LE(value, at);
    else tiff.writeUInt32BE(value, at);
  };

  tiff.write(little ? 'II' : 'MM', 0, 'latin1');
  u16(2, 42); // TIFF magic
  u32(4, 8); // first IFD sits right after the header

  u16(8, 1); // one IFD entry
  u16(10, 0xb002); // MPEntry
  u16(12, 7); // UNDEFINED, so the count below is a byte count
  u32(14, entries.length * 16);
  u32(18, options.tablePointer ?? tableAt);
  u32(22, 0); // no next IFD

  entries.forEach((entry, index) => {
    const at = tableAt + index * 16;
    u32(at, 0); // individual image attributes
    u32(at + 4, entry.size);
    u32(at + 8, entry.offset);
    u16(at + 12, 0); // dependent image 1
    u16(at + 14, 0); // dependent image 2
  });

  return Buffer.concat([Buffer.from('MPF\0', 'latin1'), tiff]);
}

/** An APP1 payload carrying nothing but IFD0's Orientation tag. */
function exifPayload(orientation: number, little = false): Buffer {
  const tiff = Buffer.alloc(26);
  const u16 = (at: number, value: number): void => {
    if (little) tiff.writeUInt16LE(value, at);
    else tiff.writeUInt16BE(value, at);
  };
  const u32 = (at: number, value: number): void => {
    if (little) tiff.writeUInt32LE(value, at);
    else tiff.writeUInt32BE(value, at);
  };

  tiff.write(little ? 'II' : 'MM', 0, 'latin1');
  u16(2, 42);
  u32(4, 8);
  u16(8, 1);
  u16(10, 0x0112); // Orientation
  u16(12, 3); // SHORT
  u32(14, 1);
  u16(18, orientation); // two bytes fit in the entry, so this IS the value
  u32(22, 0);

  return Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
}

/** A frame header: sample precision, height, width, component count. */
function sofPayload(width: number, height: number): Buffer {
  const payload = Buffer.alloc(6);
  payload.writeUInt8(8, 0);
  payload.writeUInt16BE(height, 1);
  payload.writeUInt16BE(width, 3);
  payload.writeUInt8(3, 5);
  return payload;
}

/** Bytes that pass every check `checkMpfPreview` makes. */
function previewBytes(width: number, height: number, orientation?: number): Buffer {
  const segments = [segment(SOF0, sofPayload(width, height))];
  if (orientation !== undefined) segments.unshift(segment(APP1, exifPayload(orientation)));
  return jpeg(...segments);
}

describe('findMpfPreview', () => {
  it('reads a little-endian index', () => {
    const file = jpeg(
      segment(
        APP2,
        mpfPayload(
          [
            { size: 0, offset: 0 },
            { size: 500_000, offset: 5_000_000 },
          ],
          true,
        ),
      ),
    );

    expect(findMpfPreview(file)).toEqual({
      offset: MPF_TIFF_BASE + 5_000_000,
      length: 500_000,
    });
  });

  it('reads a big-endian index', () => {
    const file = jpeg(
      segment(
        APP2,
        mpfPayload(
          [
            { size: 0, offset: 0 },
            { size: 500_000, offset: 5_000_000 },
          ],
          false,
        ),
      ),
    );

    expect(findMpfPreview(file)).toEqual({
      offset: MPF_TIFF_BASE + 5_000_000,
      length: 500_000,
    });
  });

  it('states the offset relative to the file, not to the MPF header', () => {
    // The base is the byte after `MPF\0`, and a reader that used the file start
    // instead would be MPF_TIFF_BASE bytes early — enough to hand back garbage
    // that still looks like data. This is the assertion that pins it.
    const file = jpeg(
      segment(
        APP2,
        mpfPayload(
          [
            { size: 0, offset: 0 },
            { size: 400_000, offset: 1000 },
          ],
          false,
        ),
      ),
    );

    const preview = findMpfPreview(file);
    expect(preview?.offset).toBe(1010);
    expect(preview?.offset).not.toBe(1000);
  });

  it('skips the primary image, whose offset is 0 and whose size is the whole file', () => {
    // A file listing only its primary image has no preview to offer, and the
    // 6.2 MB that entry describes is precisely what must not be read back.
    const file = jpeg(segment(APP2, mpfPayload([{ size: 6_200_000, offset: 0 }], false)));

    expect(findMpfPreview(file)).toBeNull();
  });

  it('picks the largest non-primary entry of a multi-image index', () => {
    const file = jpeg(
      segment(
        APP2,
        mpfPayload(
          [
            { size: 6_200_000, offset: 0 }, // primary
            { size: 30_000, offset: 5_000_000 }, // small thumbnail
            { size: 544_000, offset: 5_100_000 }, // the preview we want
            { size: 90_000, offset: 6_000_000 },
          ],
          true,
        ),
      ),
    );

    expect(findMpfPreview(file)).toEqual({
      offset: MPF_TIFF_BASE + 5_100_000,
      length: 544_000,
    });
  });

  it('finds the index behind other segments', () => {
    const file = jpeg(
      segment(APP1, exifPayload(1)),
      segment(
        APP2,
        mpfPayload(
          [
            { size: 0, offset: 0 },
            { size: 500_000, offset: 5_000_000 },
          ],
          true,
        ),
      ),
    );

    // The base moves with the APP2 segment, so the assertion is stated against
    // where the payload actually landed rather than against MPF_TIFF_BASE.
    const app1Length = 4 + exifPayload(1).length;
    expect(findMpfPreview(file)?.offset).toBe(MPF_TIFF_BASE + app1Length + 5_000_000);
  });

  it('returns null for a truncated segment', () => {
    const file = jpeg(
      segment(
        APP2,
        mpfPayload(
          [
            { size: 0, offset: 0 },
            { size: 500_000, offset: 5_000_000 },
          ],
          true,
        ),
      ),
    );

    // Cut the buffer mid-APP2: the segment's declared length now runs past the
    // end, which is exactly what a header window too small to reach the index
    // looks like. Guessing at the remainder is not on the table.
    expect(findMpfPreview(file.subarray(0, 12))).toBeNull();
  });

  it('returns null when there is no APP2 segment', () => {
    expect(findMpfPreview(jpeg(segment(APP1, exifPayload(1))))).toBeNull();
  });

  it('returns null for an APP2 segment that is not MPF', () => {
    // ICC profiles also live in APP2, and there is usually one in a camera JPEG.
    const icc = Buffer.concat([Buffer.from('ICC_PROFILE\0', 'latin1'), Buffer.alloc(40)]);
    expect(findMpfPreview(jpeg(segment(APP2, icc)))).toBeNull();
  });

  it('returns null for a file that is not a JPEG', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
    expect(findMpfPreview(png)).toBeNull();
  });

  it('returns null for an unknown byte order marker', () => {
    const payload = mpfPayload(
      [
        { size: 0, offset: 0 },
        { size: 500_000, offset: 5_000_000 },
      ],
      true,
    );
    payload.write('XX', 'MPF\0'.length, 'latin1');

    expect(findMpfPreview(jpeg(segment(APP2, payload)))).toBeNull();
  });

  it('returns null when the entry table points outside the segment', () => {
    const file = jpeg(
      segment(
        APP2,
        mpfPayload(
          [
            { size: 0, offset: 0 },
            { size: 500_000, offset: 5_000_000 },
          ],
          true,
          {
            tablePointer: 900_000,
          },
        ),
      ),
    );

    expect(findMpfPreview(file)).toBeNull();
  });

  it('returns null on an empty buffer', () => {
    expect(findMpfPreview(Buffer.alloc(0))).toBeNull();
  });

  it('never throws, whatever prefix of a file it is given', () => {
    // The header window can end anywhere, including partway through the APP2
    // marker or its `MPF ` signature. Nothing here may raise: the caller treats
    // null as "no preview" and reads the whole file, and it has no catch for a
    // RangeError out of a bounds slip.
    const file = jpeg(
      segment(APP1, exifPayload(1)),
      segment(
        APP2,
        mpfPayload(
          [
            { size: 0, offset: 0 },
            { size: 500_000, offset: 5_000_000 },
          ],
          true,
        ),
      ),
    );

    for (let cut = 0; cut < file.length; cut++) {
      const prefix = file.subarray(0, cut);
      expect(() => findMpfPreview(prefix)).not.toThrow();
      expect(() => readJpegOrientation(prefix)).not.toThrow();
      expect(() => readJpegSize(prefix)).not.toThrow();
    }
  });
});

describe('isPlausiblePreviewRange', () => {
  it('accepts a range inside the file', () => {
    expect(isPlausiblePreviewRange({ offset: 5_000_000, length: 500_000 }, 6_200_000)).toBe(true);
  });

  it('rejects an offset past the end of the file', () => {
    expect(isPlausiblePreviewRange({ offset: 9_000_000, length: 500_000 }, 6_200_000)).toBe(false);
  });

  it('rejects a range that starts inside the file and runs off the end', () => {
    expect(isPlausiblePreviewRange({ offset: 6_000_000, length: 500_000 }, 6_200_000)).toBe(false);
  });

  it('rejects a length no JPEG of this size could have', () => {
    expect(isPlausiblePreviewRange({ offset: 1000, length: 12 }, 6_200_000)).toBe(false);
    expect(isPlausiblePreviewRange({ offset: 1000, length: 900_000_000 }, 1_000_000_000)).toBe(
      false,
    );
  });

  it('rejects an offset inside the file header', () => {
    expect(isPlausiblePreviewRange({ offset: 0, length: 500_000 }, 6_200_000)).toBe(false);
  });
});

describe('readJpegOrientation', () => {
  it('reads a big-endian orientation', () => {
    expect(readJpegOrientation(jpeg(segment(APP1, exifPayload(6))))).toBe(6);
  });

  it('reads a little-endian orientation', () => {
    expect(readJpegOrientation(jpeg(segment(APP1, exifPayload(8, true))))).toBe(8);
  });

  it('reports 1 when the file has no EXIF at all', () => {
    expect(readJpegOrientation(jpeg(segment(SOF0, sofPayload(1620, 1080))))).toBe(1);
  });

  it('reports 1 for a value outside the EXIF range', () => {
    expect(readJpegOrientation(jpeg(segment(APP1, exifPayload(99))))).toBe(1);
  });
});

describe('readJpegSize', () => {
  it('reads the frame header', () => {
    expect(readJpegSize(jpeg(segment(SOF0, sofPayload(1620, 1080))))).toEqual({
      width: 1620,
      height: 1080,
    });
  });

  it('is not fooled by a Huffman table, which shares the SOF marker range', () => {
    const file = jpeg(segment(DHT, Buffer.alloc(30)), segment(SOF0, sofPayload(1620, 1080)));

    expect(readJpegSize(file)).toEqual({ width: 1620, height: 1080 });
  });

  it('returns null when there is no frame header in the bytes', () => {
    expect(readJpegSize(jpeg(segment(APP1, exifPayload(1))))).toBeNull();
  });
});

describe('checkMpfPreview', () => {
  const original = jpeg(segment(APP1, exifPayload(1)));

  it('accepts a preview large enough and the same way up', () => {
    expect(checkMpfPreview(original, previewBytes(1620, 1080, 1), 512)).toEqual({
      usable: true,
      width: 1620,
      height: 1080,
    });
  });

  it('treats an absent orientation as agreeing with an upright original', () => {
    expect(checkMpfPreview(original, previewBytes(1620, 1080), 512).usable).toBe(true);
  });

  it('rejects bytes that do not start with an SOI marker', () => {
    // What reading the wrong offset produces: plausible bytes that are not an
    // image. Nothing else in the pipeline would notice until the decode.
    expect(checkMpfPreview(original, Buffer.alloc(4096, 0x42), 512)).toEqual({
      usable: false,
      reason: 'not-a-jpeg',
    });
  });

  it('rejects a preview whose longest edge is below the thumbnail edge', () => {
    // The 160x120 IFD1 thumbnail is what exifr's thumbnail() hands back, and it
    // would only be upscaled into a 512 px cache entry.
    expect(checkMpfPreview(original, previewBytes(160, 120, 1), 512)).toEqual({
      usable: false,
      reason: 'too-small',
    });
  });

  it('accepts a preview that is exactly the thumbnail edge', () => {
    expect(checkMpfPreview(original, previewBytes(512, 341, 1), 512).usable).toBe(true);
  });

  it('rejects a preview that disagrees with the original about which way is up', () => {
    // The worker decodes with imageOrientation: 'from-image', so this preview
    // would land sideways in the grid while the detail view stayed upright.
    const rotated = jpeg(segment(APP1, exifPayload(6)));

    expect(checkMpfPreview(rotated, previewBytes(1620, 1080, 1), 512)).toEqual({
      usable: false,
      reason: 'orientation-mismatch',
    });
  });

  it('accepts a preview that carries the original rotation', () => {
    const rotated = jpeg(segment(APP1, exifPayload(6)));

    expect(checkMpfPreview(rotated, previewBytes(1620, 1080, 6), 512).usable).toBe(true);
  });

  it('rejects bytes with no readable frame header', () => {
    expect(checkMpfPreview(original, jpeg(segment(APP1, exifPayload(1))), 512)).toEqual({
      usable: false,
      reason: 'too-small',
    });
  });
});
