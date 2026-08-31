import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mkdtemp, mkdir, rm, readFile, writeFile, readdir, utimes, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import type { RenameHooks } from '../rename';

/**
 * Integration test for the third code path that MODIFIES a user's files, and
 * the only one that moves them. Real files, real exiftool, real renames.
 *
 * The assertions that matter are not "did it get a new name" — that is the easy
 * half. They are:
 *
 *   - the quality score, which exists in NO other place, arrives under the new
 *     basename (a rename the results file does not learn about is a score the
 *     next F5 prunes as an orphan);
 *   - the RAW, the sidecar and the AppleDouble twin travel with the photo,
 *     because Lightroom, Capture One and Bridge all pair by STEM and this app
 *     cannot see any of those files;
 *   - nothing is ever overwritten, because `fs.rename` replaces its destination
 *     without a word and this app has no undo.
 */

vi.mock('electron', () => ({ app: { isPackaged: false } }));

const { planRename, executeRename } = await import('../rename');
const { endExifTool } = await import('../exiftool');

const RESULTS = '.photo-culler-results.json';
const THUMBS = '.photo-culler-thumbs';

let root: string;

/** Hooks over the real temp tree, so the results and thumb moves are observable. */
const hooks: RenameHooks = {
  thumbCachePathOf: (filePath) =>
    path.join(path.dirname(filePath), THUMBS, `${path.basename(filePath)}.thumb.webp`),
  resultsFilePathOf: (folder) => path.join(folder, RESULTS),
  readResults: async (folder) => {
    try {
      return await readFile(path.join(folder, RESULTS), 'utf-8');
    } catch {
      return null;
    }
  },
  writeResults: async (folder, data) => {
    await writeFile(path.join(folder, RESULTS), data, 'utf-8');
  },
  dropQueuedWrite: () => undefined,
};

/**
 * A real JPEG whose FileModifyDate is the capture time.
 *
 * FileModifyDate is the bottom rung of the ladder and a legitimate one, so this
 * exercises the whole naming path without a second write to set an EXIF tag.
 * `dateEpochSeconds` is wall-clock local time, because that is what the naming
 * rules read and what the resulting filename must show.
 */
async function makeJpeg(dir: string, name: string, when: Date): Promise<string> {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, name);
  await sharp({ create: { width: 64, height: 48, channels: 3, background: '#224466' } })
    .jpeg()
    .toFile(file);
  const seconds = when.getTime() / 1000;
  await utimes(file, seconds, seconds);
  return file;
}

/** Any non-media file beside a photo — a RAW, a sidecar, an AppleDouble twin. */
async function makeCompanion(dir: string, name: string, body = 'x'): Promise<string> {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, name);
  await writeFile(file, body);
  return file;
}

async function putResults(folder: string, images: Record<string, unknown>): Promise<void> {
  await writeFile(
    path.join(folder, RESULTS),
    JSON.stringify({ version: 1, folderPath: folder, updatedAt: '2025-01-01T00:00:00Z', images }),
    'utf-8',
  );
}

async function getResults(folder: string): Promise<Record<string, unknown>> {
  const raw = await readFile(path.join(folder, RESULTS), 'utf-8');
  return (JSON.parse(raw) as { images: Record<string, unknown> }).images;
}

async function namesIn(dir: string): Promise<string[]> {
  return (await readdir(dir)).sort();
}

/** Plan and execute in one step, the way the renderer does after a confirm. */
async function renameFolder(folder: string, opts: { recursive?: boolean; dcim?: boolean } = {}) {
  const planned = await planRename({
    target: { kind: 'folder', folder, recursive: opts.recursive ?? false },
    consolidateDcim: opts.dcim ?? false,
  });
  expect(planned.error).toBeUndefined();
  expect(planned.plan).not.toBeNull();
  const result = await executeRename(planned.plan!, hooks);
  return { plan: planned.plan!, result };
}

const CAPTURE = new Date(2025, 7, 24, 14, 30, 12); // 2025-08-24 14:30:12 local
const CAPTURED_AS = '2025-08-24 14-30-12-000';

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'pc-rename-'));
});

afterAll(async () => {
  await endExifTool();
  await rm(root, { recursive: true, force: true });
});

let dir: string;
let caseNumber = 0;
beforeEach(async () => {
  dir = path.join(root, `case-${caseNumber++}`);
  await mkdir(dir, { recursive: true });
});

describe('renaming one photo', () => {
  it('renames it to its capture time and lower-cases the extension', async () => {
    await makeJpeg(dir, 'P1000001.JPG', CAPTURE);

    const { result } = await renameFolder(dir);

    expect(result.failed).toBe(0);
    expect(result.renamed).toBe(1);
    expect(await namesIn(dir)).toEqual([`${CAPTURED_AS}.jpg`]);
  });

  it('is idempotent — a second run renames nothing', async () => {
    await makeJpeg(dir, 'P1000001.JPG', CAPTURE);
    await renameFolder(dir);

    const { plan, result } = await renameFolder(dir);

    expect(result.renamed).toBe(0);
    expect(plan.counts.unchanged).toBe(1);
    expect(await namesIn(dir)).toEqual([`${CAPTURED_AS}.jpg`]);
  });

  it('leaves a file alone when no rung of the ladder has a plausible date', async () => {
    // Year 1980 is below the plausible floor on every rung, including
    // FileModifyDate, so the planner refuses to invent a name.
    await makeJpeg(dir, 'scan.jpg', new Date(1980, 0, 1, 12, 0, 0));

    const { plan, result } = await renameFolder(dir);

    expect(result.renamed).toBe(0);
    expect(plan.counts['no-date']).toBe(1);
    expect(await namesIn(dir)).toEqual(['scan.jpg']);
  });

  it('renames a video too', async () => {
    await makeCompanion(dir, 'C0001.MP4', 'not really a video');
    const seconds = CAPTURE.getTime() / 1000;
    await utimes(path.join(dir, 'C0001.MP4'), seconds, seconds);

    const { result } = await renameFolder(dir);

    expect(result.renamed).toBe(1);
    expect(await namesIn(dir)).toEqual([`${CAPTURED_AS}.mp4`]);
  });
});

describe('a shouting extension on a file that is otherwise correctly named', () => {
  // The whole path end to end on a REAL case-insensitive filesystem, because
  // every piece of it had to be told separately: `renameNoReplace` cannot
  // reserve a destination that IS its source, `assertNoOverlap` must not read
  // that as a cycle, and the two basename-keyed caches have to follow along.
  it('renames it, on disk, and keeps the bytes', async () => {
    const existing = await makeJpeg(dir, `${CAPTURED_AS}.JPG`, CAPTURE);
    const bytes = await readFile(existing);

    const { result } = await renameFolder(dir);

    expect(result.failed).toBe(0);
    expect(result.renamed).toBe(1);
    expect(await namesIn(dir)).toEqual([`${CAPTURED_AS}.jpg`]);
    expect(await readFile(path.join(dir, `${CAPTURED_AS}.jpg`))).toEqual(bytes);
  });

  it('carries the score and the cached thumbnail with it', async () => {
    const image = await makeJpeg(dir, `${CAPTURED_AS}.JPG`, CAPTURE);
    await putResults(dir, { [`${CAPTURED_AS}.JPG`]: { qualityScore: 55 } });
    await mkdir(path.join(dir, THUMBS), { recursive: true });
    await writeFile(hooks.thumbCachePathOf(image), 'pretend webp');

    await renameFolder(dir);

    expect(await getResults(dir)).toEqual({ [`${CAPTURED_AS}.jpg`]: { qualityScore: 55 } });
    expect(await namesIn(path.join(dir, THUMBS))).toEqual([`${CAPTURED_AS}.jpg.thumb.webp`]);
  });
});

describe('the quality score follows the file', () => {
  it('re-keys the results record to the new basename', async () => {
    await makeJpeg(dir, 'P1000001.JPG', CAPTURE);
    await putResults(dir, {
      'P1000001.JPG': { qualityScore: 87, qualitySubscores: { sharpness: 90 } },
    });

    await renameFolder(dir);

    const images = await getResults(dir);
    expect(images['P1000001.JPG']).toBeUndefined();
    expect(images[`${CAPTURED_AS}.jpg`]).toEqual({
      qualityScore: 87,
      qualitySubscores: { sharpness: 90 },
    });
  });

  it('leaves records for files it did not move exactly where they were', async () => {
    await makeJpeg(dir, 'P1000001.JPG', CAPTURE);
    await putResults(dir, {
      'P1000001.JPG': { qualityScore: 87 },
      'somebody-elses.JPG': { qualityScore: 12 },
    });

    await renameFolder(dir);

    const images = await getResults(dir);
    expect(images['somebody-elses.JPG']).toEqual({ qualityScore: 12 });
  });

  it('reports the results files it rewrote', async () => {
    await makeJpeg(dir, 'P1000001.JPG', CAPTURE);
    await putResults(dir, { 'P1000001.JPG': { qualityScore: 87 } });

    const { result } = await renameFolder(dir);

    expect(result.resultsFilesTouched).toEqual([path.join(dir, RESULTS)]);
  });

  it('does not create a results file for a folder that had none', async () => {
    await makeJpeg(dir, 'P1000001.JPG', CAPTURE);

    const { result } = await renameFolder(dir);

    expect(result.resultsFilesTouched).toEqual([]);
    expect(await namesIn(dir)).not.toContain(RESULTS);
  });
});

describe('the cached thumbnail follows the file', () => {
  it('moves the cache entry rather than orphaning it', async () => {
    const image = await makeJpeg(dir, 'P1000001.JPG', CAPTURE);
    await mkdir(path.join(dir, THUMBS), { recursive: true });
    await writeFile(hooks.thumbCachePathOf(image), 'pretend webp');

    await renameFolder(dir);

    expect(await namesIn(path.join(dir, THUMBS))).toEqual([`${CAPTURED_AS}.jpg.thumb.webp`]);
  });

  it('stays fresh, because a rename does not move the source mtime', async () => {
    // This is what makes moving the thumbnail worth doing at all: if a rename
    // bumped the source mtime, LOAD_THUMB_CACHE would reject the moved entry
    // and the move would have bought nothing.
    const image = await makeJpeg(dir, 'P1000001.JPG', CAPTURE);
    const before = (await stat(image)).mtimeMs;

    await renameFolder(dir);

    const after = (await stat(path.join(dir, `${CAPTURED_AS}.jpg`))).mtimeMs;
    expect(after).toBe(before);
  });
});

describe('files the app cannot see travel with the photo', () => {
  it('takes the RAW sibling along, under the same base name', async () => {
    await makeJpeg(dir, 'P1000001.JPG', CAPTURE);
    await makeCompanion(dir, 'P1000001.RW2');

    const { result } = await renameFolder(dir);

    expect(result.failed).toBe(0);
    expect(await namesIn(dir)).toEqual([`${CAPTURED_AS}.jpg`, `${CAPTURED_AS}.rw2`]);
  });

  it('takes a full-name XMP sidecar along', async () => {
    await makeJpeg(dir, 'P1000001.JPG', CAPTURE);
    await makeCompanion(dir, 'P1000001.RW2');
    await makeCompanion(dir, 'P1000001.RW2.xmp');

    await renameFolder(dir);

    expect(await namesIn(dir)).toEqual([
      `${CAPTURED_AS}.jpg`,
      `${CAPTURED_AS}.rw2`,
      `${CAPTURED_AS}.rw2.xmp`,
    ]);
  });

  it('takes the AppleDouble twin along, prefix intact', async () => {
    await makeJpeg(dir, 'P1000001.JPG', CAPTURE);
    await makeCompanion(dir, '._P1000001.JPG');

    await renameFolder(dir);

    // '.' (0x2e) sorts before '2' (0x32), so the twin leads.
    expect(await namesIn(dir)).toEqual([`._${CAPTURED_AS}.jpg`, `${CAPTURED_AS}.jpg`]);
  });

  it('does not swallow a file whose stem merely starts the same way', async () => {
    // P1000001 must not claim P10000012.txt — the dot is what separates them.
    await makeJpeg(dir, 'P1000001.JPG', CAPTURE);
    await makeCompanion(dir, 'P10000012.txt');

    await renameFolder(dir);

    expect(await namesIn(dir)).toEqual([`${CAPTURED_AS}.jpg`, 'P10000012.txt']);
  });

  it('does not drag companions through a rename that is a no-op', async () => {
    await makeJpeg(dir, 'P1000001.JPG', CAPTURE);
    await makeCompanion(dir, 'P1000001.RW2');
    await renameFolder(dir);

    const { result } = await renameFolder(dir);

    expect(result.renamed).toBe(0);
  });

  it('gives a sidecar to the source with the LONGEST matching stem', async () => {
    // `a.1.JPG` and `a.JPG` both prefix `a.1.JPG.xmp`; it belongs to the former.
    await makeJpeg(dir, 'a.JPG', CAPTURE);
    await makeJpeg(dir, 'a.1.JPG', new Date(2025, 7, 24, 15, 0, 0));
    await makeCompanion(dir, 'a.1.JPG.xmp');

    const { plan } = await renameFolder(dir);

    const sidecar = plan.entries.find((e) => e.srcName === 'a.1.JPG.xmp');
    expect(sidecar?.companionOf).toBe(path.join(dir, 'a.1.JPG'));
    expect(sidecar?.targetName).toBe('2025-08-24 15-00-00-000.jpg.xmp');
  });
});

describe('nothing is ever overwritten', () => {
  it('gives a colliding photo a content-hash suffix instead of replacing one', async () => {
    // Two different photos claiming the same second. One wins the plain name.
    await makeJpeg(dir, 'A.JPG', CAPTURE);
    const b = path.join(dir, 'B.JPG');
    await sharp({ create: { width: 64, height: 48, channels: 3, background: '#ff0000' } })
      .jpeg()
      .toFile(b);
    const seconds = CAPTURE.getTime() / 1000;
    await utimes(b, seconds, seconds);

    const { result } = await renameFolder(dir);

    expect(result.failed).toBe(0);
    const names = await namesIn(dir);
    expect(names).toHaveLength(2);
    expect(names).toContain(`${CAPTURED_AS}.jpg`);
    expect(names.some((n) => /~[0-9a-f]{4}\.jpg$/.test(n))).toBe(true);
  });

  it('does not touch a file that already holds a target name', async () => {
    // A photo already correctly named, and a second one shot in the same second.
    const existing = await makeJpeg(dir, `${CAPTURED_AS}.JPG`, CAPTURE);
    const existingBytes = await readFile(existing);
    const other = path.join(dir, 'B.JPG');
    await sharp({ create: { width: 32, height: 32, channels: 3, background: '#00ff00' } })
      .jpeg()
      .toFile(other);
    const seconds = CAPTURE.getTime() / 1000;
    await utimes(other, seconds, seconds);

    await renameFolder(dir);

    expect(await readFile(path.join(dir, `${CAPTURED_AS}.jpg`))).toEqual(existingBytes);
  });

  it('never plans two files onto one target path', async () => {
    // Ten frames of a burst, all in the same second, none carrying SubSec.
    for (let i = 0; i < 10; i++) {
      const file = path.join(dir, `IMG_${i}.JPG`);
      await sharp({
        create: { width: 32 + i, height: 32, channels: 3, background: '#112233' },
      })
        .jpeg()
        .toFile(file);
      const seconds = CAPTURE.getTime() / 1000;
      await utimes(file, seconds, seconds);
    }

    const { result } = await renameFolder(dir);

    expect(result.failed).toBe(0);
    expect(result.renamed).toBe(10);
    expect(await namesIn(dir)).toHaveLength(10);
  });
});

describe('DCIM consolidation', () => {
  it('lifts files out of camera bucket folders into DCIM', async () => {
    const dcim = path.join(dir, 'DCIM');
    await makeJpeg(path.join(dcim, '100_PANA'), 'P1000001.JPG', CAPTURE);
    await makeJpeg(path.join(dcim, '101_PANA'), 'P1010001.JPG', new Date(2025, 7, 24, 15, 0, 0));

    const { result } = await renameFolder(dcim, { recursive: true, dcim: true });

    expect(result.failed).toBe(0);
    expect(await namesIn(dcim)).toEqual([
      '100_PANA',
      '101_PANA',
      `${CAPTURED_AS}.jpg`,
      '2025-08-24 15-00-00-000.jpg',
    ]);
    expect(await namesIn(path.join(dcim, '100_PANA'))).toEqual([]);
  });

  it('carries a score across the folder boundary', async () => {
    const dcim = path.join(dir, 'DCIM');
    const bucket = path.join(dcim, '100_PANA');
    await makeJpeg(bucket, 'P1000001.JPG', CAPTURE);
    await putResults(bucket, { 'P1000001.JPG': { qualityScore: 42 } });

    await renameFolder(dcim, { recursive: true, dcim: true });

    expect(await getResults(bucket)).toEqual({});
    expect(await getResults(dcim)).toEqual({ [`${CAPTURED_AS}.jpg`]: { qualityScore: 42 } });
  });

  it('carries the thumbnail cache entry across the folder boundary too', async () => {
    const dcim = path.join(dir, 'DCIM');
    const bucket = path.join(dcim, '100_PANA');
    const image = await makeJpeg(bucket, 'P1000001.JPG', CAPTURE);
    await mkdir(path.join(bucket, THUMBS), { recursive: true });
    await writeFile(hooks.thumbCachePathOf(image), 'pretend webp');

    await renameFolder(dcim, { recursive: true, dcim: true });

    expect(await namesIn(path.join(dcim, THUMBS))).toEqual([`${CAPTURED_AS}.jpg.thumb.webp`]);
  });

  it('leaves the structure alone when consolidation is off', async () => {
    const dcim = path.join(dir, 'DCIM');
    const bucket = path.join(dcim, '100_PANA');
    await makeJpeg(bucket, 'P1000001.JPG', CAPTURE);

    await renameFolder(dcim, { recursive: true, dcim: false });

    expect(await namesIn(bucket)).toEqual([`${CAPTURED_AS}.jpg`]);
    expect(await namesIn(dcim)).toEqual(['100_PANA']);
  });

  it('never touches an ordinary tree, even with consolidation on', async () => {
    const deep = path.join(dir, 'shoot', 'day2');
    await makeJpeg(deep, 'P1000001.JPG', CAPTURE);

    await renameFolder(dir, { recursive: true, dcim: true });

    expect(await namesIn(deep)).toEqual([`${CAPTURED_AS}.jpg`]);
  });
});

describe('scope', () => {
  it('does not descend when recursive is off', async () => {
    await makeJpeg(dir, 'top.JPG', CAPTURE);
    await makeJpeg(path.join(dir, 'sub'), 'inner.JPG', CAPTURE);

    await renameFolder(dir, { recursive: false });

    expect(await namesIn(path.join(dir, 'sub'))).toEqual(['inner.JPG']);
  });

  it('renames exactly one file when asked for one file', async () => {
    const one = await makeJpeg(dir, 'A.JPG', CAPTURE);
    await makeJpeg(dir, 'B.JPG', new Date(2025, 7, 24, 16, 0, 0));

    const planned = await planRename({
      target: { kind: 'files', paths: [one] },
      consolidateDcim: false,
    });
    const result = await executeRename(planned.plan!, hooks);

    expect(result.renamed).toBe(1);
    expect(await namesIn(dir)).toEqual([`${CAPTURED_AS}.jpg`, 'B.JPG']);
  });

  it('takes a single file’s companions with it', async () => {
    const one = await makeJpeg(dir, 'A.JPG', CAPTURE);
    await makeCompanion(dir, 'A.RW2');

    const planned = await planRename({
      target: { kind: 'files', paths: [one] },
      consolidateDcim: false,
    });
    await executeRename(planned.plan!, hooks);

    expect(await namesIn(dir)).toEqual([`${CAPTURED_AS}.jpg`, `${CAPTURED_AS}.rw2`]);
  });

  it('ignores the results file and the thumbnail cache directory', async () => {
    await makeJpeg(dir, 'P1000001.JPG', CAPTURE);
    await putResults(dir, {});
    await mkdir(path.join(dir, THUMBS), { recursive: true });

    const { plan } = await renameFolder(dir);

    expect(plan.entries.map((e) => e.srcName)).toEqual(['P1000001.JPG']);
  });
});
