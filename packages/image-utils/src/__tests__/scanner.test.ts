import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scanFolder } from '../scanner';
import type { ScanProgressUpdate } from '../scanner';
import type { Dirent, PathLike, Stats } from 'node:fs';
import { join } from 'node:path';

/**
 * Declare the mocks with the ONE signature scanner.ts actually calls, rather
 * than deriving them from the real `readdir`. `vi.mocked(readdir)` picks the
 * last of node's many overloads — the `{ encoding: 'buffer' }` one, which
 * returns `Dirent<NonSharedBuffer>[]` — so every `Dirent[]` the fixtures build
 * was rejected. Same arrangement as apps/desktop's thumb-cache.test.ts.
 */
const { mockReaddir, mockStat, mockReadImageMetadata } = vi.hoisted(() => ({
  mockReaddir: vi.fn<(dirPath: PathLike, options?: unknown) => Promise<Dirent[]>>(),
  mockStat: vi.fn<(path: PathLike) => Promise<Stats>>(),
  mockReadImageMetadata: vi.fn<(filePath: string) => Promise<{ dateTaken?: number }>>(),
}));

vi.mock('node:fs/promises', () => ({
  readdir: mockReaddir,
  stat: mockStat,
}));

// Mocked so the two-phase tests below can count reads and see their order.
// It also keeps exifr out of a test that has no files for it to open.
vi.mock('../metadata', () => ({ readImageMetadata: mockReadImageMetadata }));

/** Compare paths regardless of the platform separator. */
const norm = (p: unknown): string => String(p).split(String.fromCharCode(92)).join('/');

function makeDirent(name: string, isFile = true): Dirent {
  return {
    name,
    isFile: () => isFile,
    isDirectory: () => !isFile,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    isSymbolicLink: () => false,
    path: '/test/folder',
    parentPath: '/test/folder',
  } as Dirent;
}

function makeStats(size: number, mtimeMs: number): Stats {
  return { size, mtimeMs } as Stats;
}

describe('scanFolder', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockReadImageMetadata.mockResolvedValue({});
  });

  it('returns ImageFileInfo[] for supported image types only', async () => {
    mockReaddir.mockResolvedValue([
      makeDirent('photo.jpg'),
      makeDirent('image.jpeg'),
      makeDirent('pic.png'),
      makeDirent('raw.tiff'),
      makeDirent('scan.tif'),
      makeDirent('web.webp'),
      makeDirent('document.pdf'),
      makeDirent('video.mp4'),
      makeDirent('readme.txt'),
    ] as Dirent[]);
    mockStat.mockResolvedValue(makeStats(1024, 1000000));

    const result = (await scanFolder('/test/folder')).images;
    expect(result).toHaveLength(6);
    const names = result.map((r) => r.name);
    expect(names).toContain('photo.jpg');
    expect(names).toContain('image.jpeg');
    expect(names).toContain('pic.png');
    expect(names).toContain('raw.tiff');
    expect(names).toContain('scan.tif');
    expect(names).toContain('web.webp');
    expect(names).not.toContain('document.pdf');
  });

  it('excludes hidden files (names starting with .)', async () => {
    mockReaddir.mockResolvedValue([
      makeDirent('.hidden.jpg'),
      makeDirent('visible.jpg'),
    ] as Dirent[]);
    mockStat.mockResolvedValue(makeStats(1024, 1000000));

    const result = (await scanFolder('/test/folder')).images;
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('visible.jpg');
  });

  it('excludes photo-culler-results.json', async () => {
    mockReaddir.mockResolvedValue([
      makeDirent('photo-culler-results.json'),
      makeDirent('photo.jpg'),
    ] as Dirent[]);
    mockStat.mockResolvedValue(makeStats(1024, 1000000));

    const result = (await scanFolder('/test/folder')).images;
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('photo.jpg');
  });

  it('treats a picks/ subfolder as an ordinary directory', async () => {
    // It used to be folded into its parent, so that a shot Execute had moved
    // there stayed in the section it was culled in. Execute moves nothing now,
    // and `folder` is simply the containing directory for every image.
    mockReaddir.mockImplementation(async (dirPath) => {
      if (norm(dirPath).endsWith('/picks')) return [makeDirent('picked.jpg')] as Dirent[];
      return [makeDirent('main.jpg'), makeDirent('picks', false)] as Dirent[];
    });
    mockStat.mockResolvedValue(makeStats(1024, 1000000));

    const result = (await scanFolder('/test/folder')).images;
    const byName = Object.fromEntries(result.map((r) => [r.name, norm(r.folder)]));

    expect(byName['main.jpg']).toBe('/test/folder');
    expect(byName['picked.jpg']).toBe('/test/folder/picks');
  });

  it('descends into subfolders and files each image under its own directory', async () => {
    mockReaddir.mockImplementation(async (dirPath) => {
      const dir = norm(dirPath);
      if (dir === '/test/folder') {
        return [
          makeDirent('root.jpg'),
          makeDirent('eventA', false),
          makeDirent('eventB', false),
        ] as Dirent[];
      }
      if (dir.endsWith('/eventA'))
        return [makeDirent('a1.jpg'), makeDirent('day2', false)] as Dirent[];
      if (dir.endsWith('/day2')) return [makeDirent('a2.jpg')] as Dirent[];
      if (dir.endsWith('/eventB')) return [makeDirent('b1.jpg')] as Dirent[];
      return [] as Dirent[];
    });
    mockStat.mockResolvedValue(makeStats(1024, 1000000));

    const result = (await scanFolder('/test/folder')).images;
    const byName = Object.fromEntries(result.map((r) => [r.name, norm(r.folder)]));

    expect(Object.keys(byName).sort()).toEqual(['a1.jpg', 'a2.jpg', 'b1.jpg', 'root.jpg']);
    expect(byName['root.jpg']).toBe('/test/folder');
    expect(byName['a1.jpg']).toBe('/test/folder/eventA');
    // Nesting is unlimited, not one level.
    expect(byName['a2.jpg']).toBe('/test/folder/eventA/day2');
    expect(byName['b1.jpg']).toBe('/test/folder/eventB');
  });

  it('skips hidden directories, which is what excludes the thumbnail cache', async () => {
    mockReaddir.mockImplementation(async (dirPath) => {
      const dir = norm(dirPath);
      if (dir === '/test/folder') {
        return [makeDirent('a.jpg'), makeDirent('.photo-culler-thumbs', false)] as Dirent[];
      }
      return [makeDirent('a.jpg.thumb.jpg')] as Dirent[];
    });
    mockStat.mockResolvedValue(makeStats(1024, 1000000));

    const result = (await scanFolder('/test/folder')).images;
    expect(result.map((r) => r.name)).toEqual(['a.jpg']);
  });

  it('keeps scanning when a subfolder cannot be read', async () => {
    mockReaddir.mockImplementation(async (dirPath) => {
      const dir = norm(dirPath);
      if (dir === '/test/folder') {
        return [makeDirent('ok.jpg'), makeDirent('locked', false)] as Dirent[];
      }
      throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
    });
    mockStat.mockResolvedValue(makeStats(1024, 1000000));

    const result = (await scanFolder('/test/folder')).images;
    expect(result.map((r) => r.name)).toEqual(['ok.jpg']);
  });

  it('returns empty array for empty folder', async () => {
    mockReaddir.mockResolvedValue([] as Dirent[]);

    const result = (await scanFolder('/test/folder')).images;
    expect(result).toEqual([]);
  });

  it('handles case-insensitive extension matching (.JPG works)', async () => {
    mockReaddir.mockResolvedValue([makeDirent('PHOTO.JPG'), makeDirent('Image.PNG')] as Dirent[]);
    mockStat.mockResolvedValue(makeStats(1024, 1000000));

    const result = (await scanFolder('/test/folder')).images;
    expect(result).toHaveLength(2);
  });

  it('throws on permission error (EACCES)', async () => {
    mockReaddir.mockImplementation(async () => {
      const err = new Error('EACCES') as NodeJS.ErrnoException;
      err.code = 'EACCES';
      throw err;
    });

    await expect(scanFolder('/test/folder')).rejects.toThrow();
  });

  it('returns correct ImageFileInfo shape', async () => {
    mockReaddir.mockResolvedValue([makeDirent('photo.jpg')] as Dirent[]);
    mockStat.mockResolvedValue(makeStats(2048, 1700000000000));

    const result = (await scanFolder('/test/folder')).images;
    expect(result[0]).toEqual({
      // Built with join() so the assertion holds on Windows too
      path: join('/test/folder', 'photo.jpg'),
      name: 'photo.jpg',
      folder: '/test/folder',
      extension: 'jpg',
      size: 2048,
      lastModified: 1700000000000,
    });
  });
});

/**
 * The half of scanFolder that exists so the grid can paint before every header
 * in the folder has been read. What matters here is not that the metadata
 * arrives — a single awaited pass did that — but WHICH images are read first,
 * that nothing is read twice or skipped, and that a report can be trusted about
 * its totals.
 */
describe('scanFolder metadata phases', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockReadImageMetadata.mockResolvedValue({});
    mockStat.mockResolvedValue(makeStats(1024, 1000000));
  });

  /** `count` images named IMG_0001.jpg upwards, in that order. */
  function numbered(count: number): Dirent[] {
    return Array.from({ length: count }, (_, i) =>
      makeDirent(`IMG_${String(i + 1).padStart(4, '0')}.jpg`),
    );
  }

  /** The basenames readImageMetadata was called with, in call order. */
  function readNames(): string[] {
    return mockReadImageMetadata.mock.calls.map((call) => norm(call[0]).split('/').pop()!);
  }

  it('reads only the prefix before returning, and the rest on demand', async () => {
    mockReaddir.mockResolvedValue(numbered(5));

    const scan = await scanFolder('/test/folder', { prefix: 2 });

    expect(scan.images).toHaveLength(5);
    expect(scan.metadataReady).toBe(2);
    expect(readNames()).toEqual(['IMG_0001.jpg', 'IMG_0002.jpg']);

    await scan.readRemainingMetadata();
    expect(readNames()).toEqual([
      'IMG_0001.jpg',
      'IMG_0002.jpg',
      'IMG_0003.jpg',
      'IMG_0004.jpg',
      'IMG_0005.jpg',
    ]);
  });

  it('reads in display order even when the walk returns another one', async () => {
    // The prefix is only the first screenful if it is read in the order the
    // grid shows, and readdir order is the filesystem's, not the app's: name
    // order on NTFS, hash order on ext4.
    mockReaddir.mockResolvedValue([
      makeDirent('IMG_0009.jpg'),
      makeDirent('IMG_0002.jpg'),
      makeDirent('IMG_0010.jpg'),
      makeDirent('IMG_0001.jpg'),
    ]);

    const scan = await scanFolder('/test/folder', { prefix: 2 });

    expect(readNames()).toEqual(['IMG_0001.jpg', 'IMG_0002.jpg']);
    // Natural order, so IMG_0010 sorts after IMG_0009 rather than after IMG_0001.
    await scan.readRemainingMetadata();
    expect(readNames()).toEqual(['IMG_0001.jpg', 'IMG_0002.jpg', 'IMG_0009.jpg', 'IMG_0010.jpg']);
    // The returned list is still the walk's, untouched.
    expect(scan.images.map((img) => img.name)).toEqual([
      'IMG_0009.jpg',
      'IMG_0002.jpg',
      'IMG_0010.jpg',
      'IMG_0001.jpg',
    ]);
  });

  it('lands the metadata on the returned images, whichever pass read them', async () => {
    mockReaddir.mockResolvedValue(numbered(4));
    mockReadImageMetadata.mockImplementation(async (filePath) => ({
      dateTaken: norm(filePath).endsWith('IMG_0001.jpg') ? 1000 : 2000,
    }));

    const scan = await scanFolder('/test/folder', { prefix: 1 });
    const first = scan.images.find((img) => img.name === 'IMG_0001.jpg')!;
    const last = scan.images.find((img) => img.name === 'IMG_0004.jpg')!;

    expect(first.dateTaken).toBe(1000);
    expect(last.dateTaken).toBeUndefined();

    await scan.readRemainingMetadata();
    // The sorted reading order is a second view of the SAME objects, so a
    // deferred read shows up on the array the caller already holds.
    expect(last.dateTaken).toBe(2000);
  });

  it('reports the walk with a running count, and the metadata with a total', async () => {
    mockReaddir.mockResolvedValue(numbered(250));
    const updates: ScanProgressUpdate[] = [];

    const scan = await scanFolder('/test/folder', {
      prefix: 100,
      onProgress: (update) => updates.push(update),
    });
    await scan.readRemainingMetadata();

    const walking = updates.filter((u) => u.phase === 'walking');
    // Every hundredth image, and nothing else — 250 files means two reports.
    expect(walking.map((u) => u.found)).toEqual([100, 200]);

    const metadata = updates.filter((u) => u.phase === 'metadata');
    expect(metadata.length).toBeGreaterThan(0);
    // `found` is the total for every metadata report: the walk is over by then.
    expect(metadata.every((u) => u.found === 250)).toBe(true);
    expect(metadata.at(-1)!.completed).toBe(250);
    // Monotonic, so a renderer can drive a counter off it without sorting.
    const counts = metadata.map((u) => u.completed);
    expect([...counts].sort((a, b) => a - b)).toEqual(counts);
  });

  it('delivers the deferred images exactly once each, and none of the prefix', async () => {
    // 700 is more than one batch (METADATA_BATCH_SIZE), which is the case worth
    // pinning: a batch is flushed and reset mid-pass, and losing or repeating
    // one is silent — those images would simply never get their dates.
    mockReaddir.mockResolvedValue(numbered(700));
    const updates: ScanProgressUpdate[] = [];

    const scan = await scanFolder('/test/folder', {
      prefix: 300,
      onProgress: (update) => updates.push(update),
    });

    // The prefix travels in scan.images, so its reports carry no images.
    expect(updates.every((u) => u.images.length === 0)).toBe(true);

    await scan.readRemainingMetadata();

    const delivered = updates.flatMap((u) => u.images).map((img) => img.name);
    expect(delivered).toHaveLength(400);
    expect(new Set(delivered).size).toBe(400);
    expect(delivered).not.toContain('IMG_0001.jpg');
    expect(delivered).toContain('IMG_0301.jpg');
    expect(delivered).toContain('IMG_0700.jpg');
  });

  it('a prefix longer than the folder is not an error', async () => {
    mockReaddir.mockResolvedValue(numbered(3));

    const scan = await scanFolder('/test/folder', { prefix: 300 });
    expect(scan.metadataReady).toBe(3);
    expect(readNames()).toHaveLength(3);

    await scan.readRemainingMetadata();
    expect(readNames()).toHaveLength(3);
  });

  it('an empty folder still reports, so the renderer can stop waiting', async () => {
    mockReaddir.mockResolvedValue([] as Dirent[]);
    const updates: ScanProgressUpdate[] = [];

    const scan = await scanFolder('/test/folder', { onProgress: (u) => updates.push(u) });
    await scan.readRemainingMetadata();

    expect(scan.metadataReady).toBe(0);
    expect(updates.some((u) => u.phase === 'metadata' && u.found === 0 && u.completed === 0)).toBe(
      true,
    );
  });

  it('stops the deferred pass on abort, and reports nothing after it', async () => {
    mockReaddir.mockResolvedValue(numbered(200));
    const controller = new AbortController();
    const updates: ScanProgressUpdate[] = [];

    mockReadImageMetadata.mockImplementation(async (filePath) => {
      // Abort partway through the deferred pass, the way a second openFolder
      // does. Resolving rather than rejecting is the contract: an abandoned
      // pass is a normal outcome, not a failure.
      if (norm(filePath).endsWith('IMG_0060.jpg')) controller.abort();
      return {};
    });

    const scan = await scanFolder('/test/folder', {
      prefix: 10,
      signal: controller.signal,
      onProgress: (u) => updates.push(u),
    });
    await expect(scan.readRemainingMetadata()).resolves.toBeUndefined();

    // Concurrency 8, so the handful of reads already in flight still finish;
    // what must not happen is the other 130 files being read.
    expect(readNames().length).toBeLessThan(80);
    const afterAbort = updates.filter((u) => u.phase === 'metadata' && u.completed > 60);
    expect(afterAbort).toEqual([]);
  });

  it('calling readRemainingMetadata twice reads nothing twice', async () => {
    mockReaddir.mockResolvedValue(numbered(5));

    const scan = await scanFolder('/test/folder', { prefix: 1 });
    await scan.readRemainingMetadata();
    await scan.readRemainingMetadata();

    expect(readNames()).toHaveLength(5);
  });
});
