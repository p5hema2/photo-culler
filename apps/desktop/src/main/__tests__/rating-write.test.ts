import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtemp, rm, readdir, stat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import exifr from 'exifr';

/**
 * Integration test for the one code path in this app that MODIFIES a user's
 * photo. It spawns a real exiftool and writes to real files, which makes it the
 * slowest test in the suite by far — and worth every millisecond, because
 * nothing else can catch a regression here. A silently wrong write means a lost
 * rating with a star still showing, and the file is the only place it lives.
 */

vi.mock('electron', () => ({ app: { isPackaged: false } }));

const { writeRating, endExifTool } = await import('../exiftool');

let dir: string;

/** A small but real JPEG, backdated so a preserved mtime is unmistakable. */
async function makeImage(name: string): Promise<string> {
  const file = path.join(dir, name);
  await sharp({
    create: { width: 640, height: 480, channels: 3, background: '#345678' },
  })
    .jpeg()
    .toFile(file);
  const past = Date.now() / 1000 - 3600;
  await utimes(file, past, past);
  return file;
}

async function readRating(file: string): Promise<unknown> {
  const parsed = await exifr.parse(file, {
    xmp: true,
    translateValues: false,
    reviveValues: false,
  });
  return parsed?.Rating;
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'pc-rating-'));
}, 30_000);

afterAll(async () => {
  await endExifTool();
  await rm(dir, { recursive: true, force: true });
}, 30_000);

describe('writeRating', () => {
  it('writes a rating that exifr reads back', async () => {
    const file = await makeImage('a.jpg');

    await expect(writeRating(file, 4)).resolves.toEqual({ ok: true });
    expect(await readRating(file)).toBe(4);
  }, 60_000);

  it('never moves the mtime forward, so the cached thumbnail stays valid', async () => {
    // LOAD_THUMB_CACHE discards any thumbnail whose mtime is BELOW its source's.
    // Without -P every keypress would bump the source and rating 2000 photos
    // would destroy 2000 cache entries — see the trap in CLAUDE.md.
    //
    // Not-forward rather than bit-identical, because -P restores FileModifyDate
    // at the resolution exiftool recorded it: exact on Windows, truncated to the
    // second on macOS (…384127 came back as …384000). Truncation moves the
    // timestamp BACKWARDS, which only makes the freshness check pass more
    // easily. The upper bound on the drift is what would catch -P silently
    // ceasing to work, since that resets the mtime to now.
    const file = await makeImage('mtime.jpg');
    const before = (await stat(file)).mtimeMs;

    await writeRating(file, 3);
    const after = (await stat(file)).mtimeMs;

    expect(after).toBeLessThanOrEqual(before);
    expect(before - after).toBeLessThan(1000);
  }, 60_000);

  it('reaches both the XMP and the EXIF group', async () => {
    // A plain Rating tag lands in XMP only, which Windows Explorer never reads;
    // routing everything through writeArgs reaches both but loses the mtime.
    // This asserts the split arrangement actually produces both.
    const file = await makeImage('groups.jpg');
    await writeRating(file, 5);

    // `mergeOutput: false` keeps the segments apart, which is the only way to
    // tell them apart here: exifr's `ifd0` option is a FormatOptions object and
    // its own typings note it "cannot be disabled", so the groups cannot be
    // isolated by switching one off.
    const segmented = await exifr.parse(file, { xmp: true, mergeOutput: false });

    expect(segmented?.xmp?.Rating).toBe(5);
    expect(segmented?.ifd0?.Rating).toBe(5);
    // Windows' own non-linear scale — 99, not 100.
    expect(segmented?.ifd0?.RatingPercent).toBe(99);
  }, 60_000);

  it('overwrites a rating and can clear it back to 0', async () => {
    const file = await makeImage('seq.jpg');

    for (const value of [1, 5, 0, 2]) {
      await expect(writeRating(file, value)).resolves.toEqual({ ok: true });
      expect(await readRating(file)).toBe(value);
    }
  }, 90_000);

  it('leaves no _original twin beside the photo', async () => {
    // exiftool's default backup carries an extension the scanner does not know
    // and the clean-up planner has no notion of, so the twins would pile up
    // invisibly.
    const file = await makeImage('backup.jpg');
    await writeRating(file, 2);

    const entries = await readdir(dir);
    expect(entries.filter((name) => name.includes('_original'))).toEqual([]);
  }, 60_000);

  it('reports a bad rating instead of writing it', async () => {
    const file = await makeImage('range.jpg');

    for (const bad of [-1, 6, 2.5, NaN]) {
      const result = await writeRating(file, bad);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Rating');
    }
    expect(await readRating(file)).toBeUndefined();
  }, 60_000);

  it('reports a failure rather than swallowing it', async () => {
    const result = await writeRating(path.join(dir, 'does-not-exist.jpg'), 3);

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  }, 60_000);

  it('refuses a relative path and a path with a newline', async () => {
    // batch-cluster feeds -stay_open one argument per line, so a newline in the
    // path would inject an ExifTool argument.
    await expect(writeRating('relative.jpg', 3)).resolves.toEqual({
      ok: false,
      error: 'Unsupported file path',
    });
    await expect(writeRating(`${path.join(dir, 'x')}\n-delete_all`, 3)).resolves.toEqual({
      ok: false,
      error: 'Unsupported file path',
    });
  });
});
