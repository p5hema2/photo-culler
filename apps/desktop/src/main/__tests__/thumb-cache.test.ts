import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockUnlink, mockRename, mockMkdir, mockReaddir, mockRm, mockStat, mockTrashItem } =
  vi.hoisted(() => ({
    mockUnlink: vi.fn(),
    mockRename: vi.fn(),
    mockMkdir: vi.fn(),
    mockReaddir: vi.fn(),
    mockRm: vi.fn(),
    mockStat: vi.fn(),
    mockTrashItem: vi.fn(),
  }));

vi.mock('node:fs/promises', () => {
  const fs = {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: mockMkdir,
    rename: mockRename,
    unlink: mockUnlink,
    stat: mockStat,
    readdir: mockReaddir,
    rm: mockRm,
  };
  return { ...fs, default: fs };
});

const mockHandle = vi.fn();
vi.mock('electron', () => ({
  app: { getVersion: () => '1.2.0' },
  ipcMain: { handle: mockHandle },
  dialog: { showOpenDialog: vi.fn() },
  shell: { trashItem: mockTrashItem },
}));
vi.mock('sharp', () => ({ default: vi.fn() }));
vi.mock('../store', () => ({ getSession: vi.fn(), updateSession: vi.fn() }));
vi.mock('@photo-culler/image-utils', () => ({ scanFolder: vi.fn(async () => []) }));

const { registerIpcHandlers, getThumbCachePath, vacuumThumbCache } =
  await import('../ipc-handlers');

/** Pull a registered handler out of the ipcMain.handle mock by channel name. */
function handlerFor(channel: string): (event: unknown, ...args: never[]) => Promise<unknown> {
  const call = mockHandle.mock.calls.find((c) => c[0] === channel);
  if (!call) throw new Error(`no handler registered for ${channel}`);
  return call[1] as never;
}

/** Normalise separators so assertions work on both Windows and POSIX. */
function norm(p: unknown): string {
  return String(p).replace(/\\/g, '/');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockHandle.mockClear();
  registerIpcHandlers();
});

describe('getThumbCachePath', () => {
  it('puts thumbnails in a version subdirectory beside the image', () => {
    expect(norm(getThumbCachePath('/photos/IMG_1.JPG'))).toBe(
      '/photos/.photo-culler-thumbs/v2/IMG_1.JPG.thumb.jpg',
    );
  });

  it('uses the picks/ subfolder for images that live there', () => {
    expect(norm(getThumbCachePath('/photos/picks/IMG_1.JPG'))).toBe(
      '/photos/picks/.photo-culler-thumbs/v2/IMG_1.JPG.thumb.jpg',
    );
  });
});

describe('trashing and deleting', () => {
  it('removes the cached thumbnail after a successful trash', async () => {
    mockTrashItem.mockResolvedValue(undefined);
    const result = (await handlerFor('fs:trash-files')({}, ['/photos/a.jpg'] as never)) as {
      succeeded: string[];
    };

    expect(result.succeeded).toEqual(['/photos/a.jpg']);
    expect(mockUnlink.mock.calls.map((c) => norm(c[0]))).toContain(
      '/photos/.photo-culler-thumbs/v2/a.jpg.thumb.jpg',
    );
  });

  it('does NOT remove the thumbnail when the trash operation failed', async () => {
    mockTrashItem.mockRejectedValue(new Error('locked'));
    const result = (await handlerFor('fs:trash-files')({}, ['/photos/a.jpg'] as never)) as {
      failed: unknown[];
    };

    expect(result.failed).toHaveLength(1);
    expect(mockUnlink).not.toHaveBeenCalled();
  });

  it('removes the cached thumbnail after a permanent delete', async () => {
    mockUnlink.mockResolvedValue(undefined);
    await handlerFor('fs:delete-files')({}, ['/photos/a.jpg'] as never);

    expect(mockUnlink.mock.calls.map((c) => norm(c[0]))).toContain(
      '/photos/.photo-culler-thumbs/v2/a.jpg.thumb.jpg',
    );
  });

  it('reports success even when the thumbnail cannot be removed', async () => {
    mockTrashItem.mockResolvedValue(undefined);
    mockUnlink.mockRejectedValue(new Error('EPERM'));

    const result = (await handlerFor('fs:trash-files')({}, ['/photos/a.jpg'] as never)) as {
      succeeded: string[];
      failed: unknown[];
    };

    expect(result.succeeded).toEqual(['/photos/a.jpg']);
    expect(result.failed).toEqual([]);
  });
});

describe('moving to picks/', () => {
  it('follows the thumbnail into the picks cache directory', async () => {
    mockMkdir.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);

    await handlerFor('fs:move-to-picks')({}, '/photos' as never, ['/photos/a.jpg'] as never);

    const renames = mockRename.mock.calls.map((c) => [norm(c[0]), norm(c[1])]);
    expect(renames).toContainEqual([
      '/photos/.photo-culler-thumbs/v2/a.jpg.thumb.jpg',
      '/photos/picks/.photo-culler-thumbs/v2/a.jpg.thumb.jpg',
    ]);
  });

  it('drops the source thumbnail when the relocation fails', async () => {
    mockMkdir.mockResolvedValue(undefined);
    // First rename moves the image, second (the thumbnail) fails.
    mockRename.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('EXDEV'));

    await handlerFor('fs:move-to-picks')({}, '/photos' as never, ['/photos/a.jpg'] as never);

    expect(mockUnlink.mock.calls.map((c) => norm(c[0]))).toContain(
      '/photos/.photo-culler-thumbs/v2/a.jpg.thumb.jpg',
    );
  });
});

describe('cache freshness', () => {
  it('rejects a thumbnail older than the source file', async () => {
    mockStat.mockImplementation(async (p: string) =>
      norm(p).includes('.photo-culler-thumbs') ? { mtimeMs: 100 } : { mtimeMs: 200 },
    );

    // The source was rewritten after the thumbnail was made — e.g. by a rotation.
    const result = await handlerFor('fs:load-thumb-cache')({}, '/photos/a.jpg' as never);
    expect(result).toBeNull();
  });
});

describe('vacuumThumbCache', () => {
  it('deletes nothing when the image directory cannot be listed', async () => {
    mockReaddir.mockImplementation(async (p: string) => {
      if (norm(p).endsWith('.photo-culler-thumbs'))
        return [{ name: 'v2', isDirectory: () => true }];
      throw new Error('EPERM');
    });

    const { removed } = await vacuumThumbCache('/photos');

    expect(removed).toBe(0);
    expect(mockRm).not.toHaveBeenCalled();
    expect(mockUnlink).not.toHaveBeenCalled();
  });

  it('removes loose v1 files and keeps the current version directory', async () => {
    mockReaddir.mockImplementation(async (p: string) => {
      const n = norm(p);
      if (n.endsWith('/.photo-culler-thumbs')) {
        return [
          { name: 'v2', isDirectory: () => true },
          { name: 'a.jpg.thumb.jpg', isDirectory: () => false },
        ];
      }
      if (n.endsWith('/.photo-culler-thumbs/v2')) return ['a.jpg.thumb.jpg'];
      if (n === '/photos') return ['a.jpg'];
      throw new Error('ENOENT');
    });
    mockRm.mockResolvedValue(undefined);

    const { removed } = await vacuumThumbCache('/photos');

    // The loose v1 file goes; the live v2 thumbnail stays.
    expect(mockRm.mock.calls.map((c) => norm(c[0]))).toEqual([
      '/photos/.photo-culler-thumbs/a.jpg.thumb.jpg',
    ]);
    expect(mockUnlink).not.toHaveBeenCalled();
    expect(removed).toBe(1);
  });

  it('removes orphaned thumbnails whose image is gone', async () => {
    mockReaddir.mockImplementation(async (p: string) => {
      const n = norm(p);
      if (n.endsWith('/.photo-culler-thumbs')) return [{ name: 'v2', isDirectory: () => true }];
      if (n.endsWith('/.photo-culler-thumbs/v2')) {
        return ['a.jpg.thumb.jpg', 'gone.jpg.thumb.jpg'];
      }
      if (n === '/photos') return ['a.jpg'];
      throw new Error('ENOENT');
    });
    mockUnlink.mockResolvedValue(undefined);

    const { removed } = await vacuumThumbCache('/photos');

    expect(mockUnlink.mock.calls.map((c) => norm(c[0]))).toEqual([
      '/photos/.photo-culler-thumbs/v2/gone.jpg.thumb.jpg',
    ]);
    expect(removed).toBe(1);
  });

  it('matches image names case-insensitively', async () => {
    mockReaddir.mockImplementation(async (p: string) => {
      const n = norm(p);
      if (n.endsWith('/.photo-culler-thumbs')) return [{ name: 'v2', isDirectory: () => true }];
      if (n.endsWith('/.photo-culler-thumbs/v2')) return ['IMG_1.JPG.thumb.jpg'];
      if (n === '/photos') return ['img_1.jpg'];
      throw new Error('ENOENT');
    });

    const { removed } = await vacuumThumbCache('/photos');

    expect(mockUnlink).not.toHaveBeenCalled();
    expect(removed).toBe(0);
  });
});
