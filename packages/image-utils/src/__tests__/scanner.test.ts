import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scanFolder } from '../scanner';
import type { Dirent, Stats } from 'node:fs';

// Mock node:fs/promises
vi.mock('node:fs/promises', () => ({
  readdir: vi.fn(),
  stat: vi.fn(),
}));

import { readdir, stat } from 'node:fs/promises';

const mockReaddir = vi.mocked(readdir);
const mockStat = vi.mocked(stat);

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
    mockReaddir.mockImplementation(async (dirPath) => {
      if (String(dirPath).endsWith('/picks')) {
        const err = new Error('ENOENT') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
      return [
        makeDirent('photo.jpg'),
        makeDirent('image.jpeg'),
        makeDirent('pic.png'),
        makeDirent('raw.tiff'),
        makeDirent('scan.tif'),
        makeDirent('web.webp'),
        makeDirent('document.pdf'),
        makeDirent('video.mp4'),
        makeDirent('readme.txt'),
      ] as Dirent[];
    });
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
    mockReaddir.mockImplementation(async (dirPath) => {
      if (String(dirPath).endsWith('/picks')) {
        const err = new Error('ENOENT') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
      return [makeDirent('.hidden.jpg'), makeDirent('visible.jpg')] as Dirent[];
    });
    mockStat.mockResolvedValue(makeStats(1024, 1000000));

    const result = await scanFolder('/test/folder');
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('visible.jpg');
  });

  it('excludes photo-culler-results.json', async () => {
    mockReaddir.mockImplementation(async (dirPath) => {
      if (String(dirPath).endsWith('/picks')) {
        const err = new Error('ENOENT') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
      return [makeDirent('photo-culler-results.json'), makeDirent('photo.jpg')] as Dirent[];
    });
    mockStat.mockResolvedValue(makeStats(1024, 1000000));

    const result = await scanFolder('/test/folder');
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('photo.jpg');
  });

  it('includes files from picks/ subfolder when it exists', async () => {
    mockReaddir.mockImplementation(async (dirPath) => {
      const dir = String(dirPath);
      if (dir.endsWith('/picks')) {
        return [makeDirent('picked.jpg')] as Dirent[];
      }
      return [makeDirent('main.jpg')] as Dirent[];
    });
    mockStat.mockResolvedValue(makeStats(1024, 1000000));

    const result = await scanFolder('/test/folder');
    expect(result).toHaveLength(2);
    const names = result.map((r) => r.name);
    expect(names).toContain('main.jpg');
    expect(names).toContain('picked.jpg');
  });

  it('handles picks/ not existing without error', async () => {
    mockReaddir.mockImplementation(async (dirPath) => {
      if (String(dirPath).endsWith('/picks')) {
        const err = new Error('ENOENT') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
      return [makeDirent('photo.jpg')] as Dirent[];
    });
    mockStat.mockResolvedValue(makeStats(1024, 1000000));

    const result = await scanFolder('/test/folder');
    expect(result).toHaveLength(1);
  });

  it('returns empty array for empty folder', async () => {
    mockReaddir.mockImplementation(async (dirPath) => {
      if (String(dirPath).endsWith('/picks')) {
        const err = new Error('ENOENT') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
      return [] as Dirent[];
    });

    const result = await scanFolder('/test/folder');
    expect(result).toEqual([]);
  });

  it('handles case-insensitive extension matching (.JPG works)', async () => {
    mockReaddir.mockImplementation(async (dirPath) => {
      if (String(dirPath).endsWith('/picks')) {
        const err = new Error('ENOENT') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
      return [makeDirent('PHOTO.JPG'), makeDirent('Image.PNG')] as Dirent[];
    });
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
    mockReaddir.mockImplementation(async (dirPath) => {
      if (String(dirPath).endsWith('/picks')) {
        const err = new Error('ENOENT') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
      return [makeDirent('photo.jpg')] as Dirent[];
    });
    mockStat.mockResolvedValue(makeStats(2048, 1700000000000));

    const result = await scanFolder('/test/folder');
    expect(result[0]).toEqual({
      path: '/test/folder/photo.jpg',
      name: 'photo.jpg',
      extension: 'jpg',
      size: 2048,
      lastModified: 1700000000000,
    });
  });
});
