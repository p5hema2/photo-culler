import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

/**
 * Exercises the positioned-read side of thumbnail sourcing against real files on
 * disk. The byte parsing has its own tests in `packages/image-utils`; what is
 * only testable here is the part that opens a handle, converts an MPEntry offset
 * into a seek, and falls back — the fallback being the property that keeps a PNG,
 * a stripped JPEG and an unfamiliar camera working exactly as before.
 *
 * `node:fs/promises` is deliberately NOT mocked, unlike the sibling cache tests:
 * an off-by-N seek is precisely the bug this guards, and a mocked read cannot
 * have one.
 */

vi.mock('electron', () => ({
  app: { getVersion: () => '1.2.0' },
  ipcMain: { handle: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
}));
vi.mock('../store', () => ({ getSession: vi.fn(), updateSession: vi.fn() }));

const { readThumbSource } = await import('../ipc-handlers');

/** A marker segment: 0xFF, the marker, its 2-byte length, then the payload. */
function segment(marker: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt8(0xff, 0);
  header.writeUInt8(marker, 1);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

const APP1 = 0xe1;
const APP2 = 0xe2;

/** `MPF\0`, a TIFF header, an MP Index IFD with one MPEntry tag, its table. */
function mpfPayload(entries: Array<{ size: number; offset: number }>, little: boolean): Buffer {
  const tableAt = 26;
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
  u16(2, 42);
  u32(4, 8);
  u16(8, 1);
  u16(10, 0xb002);
  u16(12, 7);
  u32(14, entries.length * 16);
  u32(18, tableAt);
  u32(22, 0);

  entries.forEach((entry, index) => {
    const at = tableAt + index * 16;
    u32(at, 0);
    u32(at + 4, entry.size);
    u32(at + 8, entry.offset);
    u16(at + 12, 0);
    u16(at + 14, 0);
  });

  return Buffer.concat([Buffer.from('MPF\0', 'latin1'), tiff]);
}

/** Offset of the MPF TIFF header in the files built below: SOI, marker, `MPF\0`. */
const MPF_TIFF_BASE = 2 + 4 + 4;
/** Bytes of stand-in primary scan data between the header and the preview. */
const FILLER_BYTES = 300 * 1024;

let dir = '';
/** A genuine 1620x1080 JPEG — the size the measured camera embeds. */
let preview: Buffer;
/** A genuine JPEG below the 512 px thumbnail edge, and over the length floor. */
let undersized: Buffer;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'photo-culler-thumb-source-'));

  preview = await sharp({ create: { width: 1620, height: 1080, channels: 3, background: '#345' } })
    .jpeg()
    .toBuffer();

  // Noise, so it encodes to well over the plausibility floor and it is the size
  // check that rejects it rather than the length check.
  const noise = Buffer.alloc(400 * 300 * 3);
  for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) % 251;
  undersized = await sharp(noise, { raw: { width: 400, height: 300, channels: 3 } })
    .jpeg({ quality: 95 })
    .toBuffer();
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/**
 * Write a file shaped like a camera JPEG: SOI, an APP2 holding an MPF index,
 * filler standing in for the primary image's scan data, then `embedded` at the
 * offset the index declares.
 *
 * `offsetDelta` shifts the DECLARED offset away from where the bytes really are,
 * which is how a misparsed base or a corrupt index is simulated.
 */
async function buildFile(
  name: string,
  embedded: Buffer,
  options: { little?: boolean; offsetDelta?: number } = {},
): Promise<{ file: string; size: number }> {
  const little = options.little ?? true;
  const index = mpfPayload(
    [
      { size: 6_200_000, offset: 0 }, // primary
      { size: embedded.length, offset: 0 }, // patched below
    ],
    little,
  );
  const header = Buffer.concat([Buffer.from([0xff, 0xd8]), segment(APP2, index)]);
  const embeddedAt = header.length + FILLER_BYTES;

  // The index states offsets relative to the MPF TIFF header, so that is what
  // has to be written — the whole point of the conversion under test.
  const relative = embeddedAt - MPF_TIFF_BASE + (options.offsetDelta ?? 0);
  const patched = mpfPayload(
    [
      { size: 6_200_000, offset: 0 },
      { size: embedded.length, offset: relative },
    ],
    little,
  );

  const bytes = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment(APP2, patched),
    Buffer.alloc(FILLER_BYTES, 0x5a),
    embedded,
  ]);
  const file = path.join(dir, name);
  await writeFile(file, bytes);
  return { file, size: bytes.length };
}

describe('readThumbSource', () => {
  it('reads exactly the embedded preview, and less than the file', async () => {
    const { file, size } = await buildFile('preview.jpg', preview);

    const result = await readThumbSource(file, 512);

    expect(result.kind).toBe('mpf-preview');
    if (result.kind !== 'mpf-preview') return;
    // Byte equality is the assertion that pins the seek base: one byte out and
    // the buffer would still be preview-sized and still start plausibly.
    expect(Buffer.from(result.buffer).equals(preview)).toBe(true);
    expect(result.width).toBe(1620);
    expect(result.height).toBe(1080);
    expect(result.bytesRead).toBeLessThan(size);
  });

  it('reads a big-endian index as well as a little-endian one', async () => {
    const { file } = await buildFile('big-endian.jpg', preview, { little: false });

    const result = await readThumbSource(file, 512);

    expect(result.kind).toBe('mpf-preview');
    if (result.kind !== 'mpf-preview') return;
    expect(Buffer.from(result.buffer).equals(preview)).toBe(true);
  });

  it('hands back the whole PNG, read only once', async () => {
    const png = await sharp({
      create: { width: 600, height: 400, channels: 3, background: '#345' },
    })
      .png()
      .toBuffer();
    const file = path.join(dir, 'screenshot.png');
    await writeFile(file, png);

    const result = await readThumbSource(file, 512);

    expect(result).toMatchObject({ kind: 'full-file', fallback: 'no-mpf-preview' });
    if (result.kind !== 'full-file') return;
    expect(Buffer.from(result.buffer).equals(png)).toBe(true);
    // The header window already covered this file, so re-reading it would have
    // doubled the I/O of a folder of small images.
    expect(result.bytesRead).toBe(png.length);
  });

  it('falls back for a JPEG with no MPF index', async () => {
    const file = path.join(dir, 'stripped.jpg');
    await writeFile(file, Buffer.concat([preview, Buffer.alloc(200 * 1024, 0x5a)]));

    const result = await readThumbSource(file, 512);

    expect(result).toMatchObject({ kind: 'full-file', fallback: 'no-mpf-preview' });
  });

  it('falls back when the declared range runs past the end of the file', async () => {
    const { file } = await buildFile('past-end.jpg', preview, { offsetDelta: 50_000_000 });

    const result = await readThumbSource(file, 512);

    expect(result).toMatchObject({ kind: 'full-file', fallback: 'implausible-range' });
  });

  it('falls back when the offset is wrong and the bytes are not an image', async () => {
    // What using the file start as the offset base would produce: a readable
    // range of the right length that is not a JPEG.
    const { file } = await buildFile('shifted.jpg', preview, { offsetDelta: -1000 });

    const result = await readThumbSource(file, 512);

    expect(result).toMatchObject({ kind: 'full-file', fallback: 'not-a-jpeg' });
  });

  it('falls back when the preview is below the thumbnail edge', async () => {
    const { file } = await buildFile('undersized.jpg', undersized);

    const result = await readThumbSource(file, 512);

    expect(result).toMatchObject({ kind: 'full-file', fallback: 'too-small' });
  });

  it('falls back when the index sits beyond the header window', async () => {
    // Three 60 kB APP1 packets ahead of the APP2 push it past the window, which
    // is what a large XMP block does in a real file. Unreachable has to read the
    // same as absent.
    const { file } = await buildFile('deep.jpg', preview);
    const original = await readFile(file);
    const bloat = segment(APP1, Buffer.alloc(60_000, 0x20));
    const deep = path.join(dir, 'deep-index.jpg');
    await writeFile(
      deep,
      Buffer.concat([original.subarray(0, 2), bloat, bloat, bloat, original.subarray(2)]),
    );

    const result = await readThumbSource(deep, 512);

    expect(result).toMatchObject({ kind: 'full-file', fallback: 'no-mpf-preview' });
  });
});
