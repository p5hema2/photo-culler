import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtemp, rm, readFile, readdir, stat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import exifr from 'exifr';
import type { RotateDirection } from '@photo-culler/types';

/**
 * Integration test for the second code path in this app that MODIFIES a user's
 * photo — and the one that used to lose most of it. Real exiftool, real files.
 *
 * Measured on one 6102 kB camera JPEG before this changed:
 * `sharp(buffer).rotate(90).withMetadata()` took 225 ms, rewrote 6 226 940
 * bytes, left a 1470 kB file (sharp's default JPEG quality) and destroyed the
 * embedded MPF preview, which drops that photo off the fast thumbnail path for
 * good. Changing the orientation tag took 31 ms and changed ONE byte.
 *
 * Which is why the assertions here are on bytes. A re-encode would satisfy every
 * "is it rotated now?" check in the suite, so only the byte counts can tell the
 * two implementations apart.
 */

vi.mock('electron', () => ({ app: { isPackaged: false } }));

const { rotateImage, endExifTool } = await import('../exiftool');

let dir: string;

/**
 * A small but real JPEG that already carries an orientation tag, backdated so a
 * moved mtime is unmistakable.
 */
async function makeJpeg(name: string, orientation = 1): Promise<string> {
  const file = path.join(dir, name);
  await sharp({ create: { width: 640, height: 480, channels: 3, background: '#345678' } })
    .withMetadata({ orientation })
    .jpeg()
    .toFile(file);
  const past = Date.now() / 1000 - 3600;
  await utimes(file, past, past);
  return file;
}

async function readOrientation(file: string): Promise<unknown> {
  const parsed = await exifr.parse(file, { translateValues: false, reviveValues: false });
  return parsed?.Orientation;
}

/** How many bytes of two equal-length buffers differ. */
function countDifferingBytes(a: Buffer, b: Buffer): number {
  let changed = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) changed++;
  }
  return changed;
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'pc-rotate-'));
}, 30_000);

afterAll(async () => {
  await endExifTool();
  await rm(dir, { recursive: true, force: true });
}, 30_000);

describe('rotateImage', () => {
  it('walks the clockwise cycle and comes back after four turns', async () => {
    const file = await makeJpeg('cw.jpg');

    for (const expected of [6, 3, 8, 1]) {
      await expect(rotateImage(file, 'cw')).resolves.toEqual({ ok: true, orientation: expected });
      expect(await readOrientation(file)).toBe(expected);
    }
  }, 120_000);

  it('walks the counter-clockwise cycle and comes back after four turns', async () => {
    const file = await makeJpeg('ccw.jpg');

    for (const expected of [8, 3, 6, 1]) {
      await expect(rotateImage(file, 'ccw')).resolves.toEqual({ ok: true, orientation: expected });
      expect(await readOrientation(file)).toBe(expected);
    }
  }, 120_000);

  it('keeps a mirrored file mirrored', async () => {
    // 2 is "mirror horizontal", which only another tool writes. Falling back to
    // the un-mirrored cycle would write 6 and silently un-flip a photo somebody
    // deliberately flipped — an edit with no visible cause and no undo.
    const file = await makeJpeg('mirrored.jpg', 2);

    await expect(rotateImage(file, 'cw')).resolves.toEqual({ ok: true, orientation: 7 });
    expect(await readOrientation(file)).toBe(7);
  }, 90_000);

  it('changes one byte and no pixels at all', async () => {
    // THE test. Everything else here would still pass if rotation went back to
    // re-encoding the file.
    const file = await makeJpeg('lossless.jpg');

    // One priming turn first: sharp's EXIF block and exiftool's rewrite of it
    // are not byte-identical, so the first write can move the file size. It is
    // the steady state — every turn after the first, which is every turn a user
    // makes on a camera JPEG that already has an orientation tag — that has to
    // be free.
    await rotateImage(file, 'cw');

    const before = await readFile(file);
    // sharp does not auto-orient, so this is the STORED pixel data.
    const pixelsBefore = await sharp(before).raw().toBuffer();

    await expect(rotateImage(file, 'cw')).resolves.toEqual({ ok: true, orientation: 3 });

    const after = await readFile(file);
    expect(after.length).toBe(before.length);
    // Measured: exactly 1. Bounded rather than pinned in case a future exiftool
    // also touches a padding byte — 4 bytes is still a tag edit, and 6 226 940
    // is what the re-encode it replaced changed.
    const changed = countDifferingBytes(before, after);
    expect(changed).toBeGreaterThan(0);
    expect(changed).toBeLessThanOrEqual(4);

    expect(Buffer.compare(await sharp(after).raw().toBuffer(), pixelsBefore)).toBe(0);
  }, 120_000);

  it('moves the mtime forward, unlike the rating write', async () => {
    // Exactly the opposite contract to writeRating, and deliberately so. `-P` is
    // right there — a rating changes no pixels, and holding FileModifyDate is
    // what stops 2000 keypresses evicting 2000 valid thumbnails. It is wrong
    // here: LOAD_THUMB_CACHE decides freshness on mtime, and a rotated photo's
    // cached thumbnail has the wrong side up. The handler deletes the cache file
    // too; this asserts the signal the loader actually reads.
    const file = await makeJpeg('mtime.jpg');
    const before = (await stat(file)).mtimeMs;

    await rotateImage(file, 'cw');

    expect((await stat(file)).mtimeMs).toBeGreaterThan(before);
  }, 90_000);

  it('leaves no _original twin beside the photo', async () => {
    // exiftool's default backup carries an extension the scanner does not know
    // and the clean-up planner has no notion of, so the twins would pile up
    // invisibly beside the user's photos.
    const file = await makeJpeg('backup.jpg');
    await rotateImage(file, 'cw');

    const entries = await readdir(dir);
    expect(entries.filter((name) => name.includes('_original'))).toEqual([]);
  }, 90_000);

  it('refuses a PNG and leaves it byte-identical', async () => {
    // ExifTool would happily write an eXIf chunk here, and measurably losslessly
    // — one byte. The blocker is the display end: the renderer applies
    // orientation with `createImageBitmap(…, { imageOrientation: 'from-image' })`
    // and its PNG support is unverified, so the tag could change while the photo
    // on screen did not. Refusing says so; re-encoding with sharp is the data
    // loss this replaced.
    const file = path.join(dir, 'shot.png');
    await sharp({ create: { width: 320, height: 240, channels: 3, background: '#228833' } })
      .png()
      .toFile(file);
    const before = await readFile(file);
    const mtimeBefore = (await stat(file)).mtimeMs;

    const result = await rotateImage(file, 'cw');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('.png');
    expect(result.orientation).toBeUndefined();
    // Not "roughly unchanged" — untouched.
    expect(Buffer.compare(await readFile(file), before)).toBe(0);
    expect((await stat(file)).mtimeMs).toBe(mtimeBefore);
  }, 60_000);

  it('refuses every other format the scanner accepts, by extension', async () => {
    // An allow-list, so the gate runs before the file is even opened and a new
    // scanner extension is refused rather than rotated on a guess.
    for (const ext of ['.webp', '.tif', '.tiff', '.png', '.PNG', '.heic', '']) {
      const result = await rotateImage(path.join(dir, `nothing${ext}`), 'cw');
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/Cannot rotate/);
    }
  });

  it('reports a bad direction instead of guessing one', async () => {
    const file = await makeJpeg('direction.jpg');
    // The direction crosses IPC, where the union is a hope rather than a
    // guarantee, and 'ccw' is what anything that is not 'cw' would otherwise
    // mean — a rotation quietly going the wrong way. The assertion stands in for
    // that boundary: nothing typed can produce a value the union forbids.
    const fromIpc: string = 'sideways';
    const result = await rotateImage(file, fromIpc as RotateDirection);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('sideways');
    expect(await readOrientation(file)).toBe(1);
  }, 60_000);

  it('refuses a relative path and a path with a newline', async () => {
    // batch-cluster feeds -stay_open one argument per line, so a newline in the
    // path would inject an ExifTool argument.
    await expect(rotateImage('relative.jpg', 'cw')).resolves.toEqual({
      ok: false,
      error: 'Unsupported file path',
    });
    await expect(rotateImage(`${path.join(dir, 'x.jpg')}\n-delete_all`, 'cw')).resolves.toEqual({
      ok: false,
      error: 'Unsupported file path',
    });
  });

  it('reports a missing file rather than swallowing it', async () => {
    const result = await rotateImage(path.join(dir, 'does-not-exist.jpg'), 'cw');

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  }, 60_000);
});
