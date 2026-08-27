import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scanFolder } from '../scanner';
import type { Dirent, PathLike, Stats } from 'node:fs';
import { join } from 'node:path';

/**
 * Declare the mocks with the ONE signature scanner.ts actually calls, rather
 * than deriving them from the real `readdir`. `vi.mocked(readdir)` picks the
 * last of node's many overloads — the `{ encoding: 'buffer' }` one, which
 * returns `Dirent<NonSharedBuffer>[]` — so every `Dirent[]` the fixtures build
 * was rejected. Same arrangement as apps/desktop's thumb-cache.test.ts.
 */
const { mockReaddir, mockStat } = vi.hoisted(() => ({
  mockReaddir: vi.fn<(dirPath: PathLike, options?: unknown) => Promise<Dirent[]>>(),
  mockStat: vi.fn<(path: PathLike) => Promise<Stats>>(),
}));

vi.mock('node:fs/promises', () => ({
  readdir: mockReaddir,
  stat: mockStat,
}));

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

    const result = await scanFolder('/test/folder');
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

    const result = await scanFolder('/test/folder');
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('visible.jpg');
  });

  it('excludes photo-culler-results.json', async () => {
    mockReaddir.mockResolvedValue([
      makeDirent('photo-culler-results.json'),
      makeDirent('photo.jpg'),
    ] as Dirent[]);
    mockStat.mockResolvedValue(makeStats(1024, 1000000));

    const result = await scanFolder('/test/folder');
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

    const result = await scanFolder('/test/folder');
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

    const result = await scanFolder('/test/folder');
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

    const result = await scanFolder('/test/folder');
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

    const result = await scanFolder('/test/folder');
    expect(result.map((r) => r.name)).toEqual(['ok.jpg']);
  });

  it('returns empty array for empty folder', async () => {
    mockReaddir.mockResolvedValue([] as Dirent[]);

    const result = await scanFolder('/test/folder');
    expect(result).toEqual([]);
  });

  it('handles case-insensitive extension matching (.JPG works)', async () => {
    mockReaddir.mockResolvedValue([makeDirent('PHOTO.JPG'), makeDirent('Image.PNG')] as Dirent[]);
    mockStat.mockResolvedValue(makeStats(1024, 1000000));

    const result = await scanFolder('/test/folder');
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

    const result = await scanFolder('/test/folder');
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
