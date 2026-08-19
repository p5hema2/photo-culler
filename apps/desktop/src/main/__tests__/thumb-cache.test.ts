import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockUnlink,
  mockRename,
  mockMkdir,
  mockReaddir,
  mockRm,
  mockStat,
  mockTrashItem,
  mockReadFile,
  mockWriteFile,
} = vi.hoisted(() => ({
  mockUnlink: vi.fn(),
  mockRename: vi.fn(),
  mockMkdir: vi.fn(),
  mockReaddir: vi.fn(),
  mockRm: vi.fn(),
  mockStat: vi.fn(),
  mockTrashItem: vi.fn(),
  mockReadFile: vi.fn(),
  mockWriteFile: vi.fn(),
}));

vi.mock('node:fs/promises', () => {
  const fs = {
    readFile: mockReadFile,
    writeFile: mockWriteFile,
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

const { registerIpcHandlers, getThumbCachePath, vacuumThumbCache, planCleanUp, applyCleanUp } =
  await import('../ipc-handlers');

/** Pull a registered handler out of the ipcMain.handle mock by channel name. */
function handlerFor(channel: string): (event: unknown, ...args: never[]) => Promise<unknown> {
  const call = mockHandle.mock.calls.find((c) => c[0] === channel);
  if (!call) throw new Error(`no handler registered for ${channel}`);
  return call[1] as never;
}

/** Normalise separators so assertions work on both Windows and POSIX. */
function norm(p: unknown): string {
  return String(p).split(String.fromCharCode(92)).join('/');
}

/**
 * readdir is called two ways: with `withFileTypes` while walking directories,
 * and without it to list image names. The helper serves both from one map of
 * directory -> entry names.
 */
function readdirFrom(tree: Record<string, string[]>, dirs: ReadonlySet<string>) {
  return async (dirPath: string, options?: { withFileTypes?: boolean }) => {
    const names = tree[norm(dirPath)];
    if (!names) throw new Error('ENOENT');
    if (!options?.withFileTypes) return names;
    return names.map((name) => ({
      name,
      isDirectory: () => dirs.has(`${norm(dirPath)}/${name}`),
    }));
  };
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
    mockReaddir.mockImplementation(
      async (dirPath: string, options?: { withFileTypes?: boolean }) => {
        if (norm(dirPath).endsWith('.photo-culler-thumbs')) {
          return options?.withFileTypes ? [{ name: 'v2', isDirectory: () => true }] : ['v2'];
        }
        throw new Error('EPERM');
      },
    );

    const { removed } = await vacuumThumbCache('/photos');

    expect(removed).toBe(0);
    expect(mockRm).not.toHaveBeenCalled();
    expect(mockUnlink).not.toHaveBeenCalled();
  });

  it('removes loose v1 files and keeps the current version directory', async () => {
    mockReaddir.mockImplementation(
      readdirFrom(
        {
          '/photos': ['a.jpg'],
          '/photos/.photo-culler-thumbs': ['v2', 'a.jpg.thumb.jpg'],
          '/photos/.photo-culler-thumbs/v2': ['a.jpg.thumb.jpg'],
        },
        new Set(['/photos/.photo-culler-thumbs/v2']),
      ),
    );
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
    mockReaddir.mockImplementation(
      readdirFrom(
        {
          '/photos': ['a.jpg'],
          '/photos/.photo-culler-thumbs': ['v2'],
          '/photos/.photo-culler-thumbs/v2': ['a.jpg.thumb.jpg', 'gone.jpg.thumb.jpg'],
        },
        new Set(['/photos/.photo-culler-thumbs/v2']),
      ),
    );
    mockUnlink.mockResolvedValue(undefined);

    const { removed } = await vacuumThumbCache('/photos');

    expect(mockUnlink.mock.calls.map((c) => norm(c[0]))).toEqual([
      '/photos/.photo-culler-thumbs/v2/gone.jpg.thumb.jpg',
    ]);
    expect(removed).toBe(1);
  });

  it('matches image names case-insensitively', async () => {
    mockReaddir.mockImplementation(
      readdirFrom(
        {
          '/photos': ['img_1.jpg'],
          '/photos/.photo-culler-thumbs': ['v2'],
          '/photos/.photo-culler-thumbs/v2': ['IMG_1.JPG.thumb.jpg'],
        },
        new Set(['/photos/.photo-culler-thumbs/v2']),
      ),
    );

    const { removed } = await vacuumThumbCache('/photos');

    expect(mockUnlink).not.toHaveBeenCalled();
    expect(removed).toBe(0);
  });

  it('follows subfolders, so orphans in a nested shoot are cleaned too', async () => {
    mockReaddir.mockImplementation(
      readdirFrom(
        {
          '/photos': ['eventA'],
          '/photos/eventA': ['a.jpg'],
          '/photos/eventA/.photo-culler-thumbs': ['v2'],
          '/photos/eventA/.photo-culler-thumbs/v2': ['a.jpg.thumb.jpg', 'gone.jpg.thumb.jpg'],
        },
        new Set(['/photos/eventA', '/photos/eventA/.photo-culler-thumbs/v2']),
      ),
    );
    mockUnlink.mockResolvedValue(undefined);

    const { removed } = await vacuumThumbCache('/photos');

    expect(mockUnlink.mock.calls.map((c) => norm(c[0]))).toEqual([
      '/photos/eventA/.photo-culler-thumbs/v2/gone.jpg.thumb.jpg',
    ]);
    expect(removed).toBe(1);
  });
});

describe('planCleanUp', () => {
  /** Serve readdir both ways and readFile from a small in-memory tree. */
  function mountTree(
    tree: Record<string, string[]>,
    dirs: ReadonlySet<string>,
    files: Record<string, string> = {},
  ) {
    mockReaddir.mockImplementation(readdirFrom(tree, dirs));
    mockReadFile.mockImplementation(async (filePath: string) => {
      const content = files[norm(filePath)];
      if (content === undefined) throw new Error('ENOENT');
      return content;
    });
  }

  function resultsFile(names: string[]): string {
    return JSON.stringify({
      version: 1,
      folderPath: '/photos',
      updatedAt: 'x',
      images: Object.fromEntries(names.map((n) => [n, { classification: 'keep' }])),
    });
  }

  it('proposes only records whose image is missing', async () => {
    mountTree({ '/photos': ['a.jpg', '.photo-culler-results.json'] }, new Set(), {
      '/photos/.photo-culler-results.json': resultsFile(['a.jpg', 'gone.jpg']),
    });

    const plan = await planCleanUp('/photos');

    expect(plan.results).toHaveLength(1);
    expect(plan.results[0]!.names).toEqual(['gone.jpg']);
  });

  it('keeps records for images that were moved into picks/', async () => {
    // Execute moves keeps into picks/ and the scanner files them back under the
    // parent, so the parent's results file legitimately describes them. Pruning
    // against the bare directory listing would delete every moved pick.
    mountTree(
      {
        '/photos': ['a.jpg', 'picks', '.photo-culler-results.json'],
        '/photos/picks': ['moved.jpg'],
      },
      new Set(['/photos/picks']),
      { '/photos/.photo-culler-results.json': resultsFile(['a.jpg', 'moved.jpg']) },
    );

    const plan = await planCleanUp('/photos');

    expect(plan.results).toHaveLength(0);
  });

  it('descends into subfolders', async () => {
    mountTree(
      {
        '/photos': ['eventA'],
        '/photos/eventA': ['a.jpg', '.photo-culler-results.json'],
      },
      new Set(['/photos/eventA']),
      { '/photos/eventA/.photo-culler-results.json': resultsFile(['a.jpg', 'gone.jpg']) },
    );

    const plan = await planCleanUp('/photos');

    expect(plan.results).toHaveLength(1);
    expect(norm(plan.results[0]!.file)).toBe('/photos/eventA/.photo-culler-results.json');
    expect(plan.results[0]!.names).toEqual(['gone.jpg']);
  });

  it('proposes orphaned thumbnails alongside records', async () => {
    mountTree(
      {
        '/photos': ['a.jpg'],
        '/photos/.photo-culler-thumbs': ['v2'],
        '/photos/.photo-culler-thumbs/v2': ['a.jpg.thumb.jpg', 'gone.jpg.thumb.jpg'],
      },
      new Set(['/photos/.photo-culler-thumbs/v2']),
    );

    const plan = await planCleanUp('/photos');

    expect(plan.thumbs.map(norm)).toEqual(['/photos/.photo-culler-thumbs/v2/gone.jpg.thumb.jpg']);
  });

  it('proposes nothing when a directory cannot be listed', async () => {
    mockReaddir.mockImplementation(async () => {
      throw new Error('EPERM');
    });

    const plan = await planCleanUp('/photos');

    expect(plan.thumbs).toEqual([]);
    expect(plan.results).toEqual([]);
  });

  it('leaves an unreadable results file alone', async () => {
    mountTree({ '/photos': ['a.jpg', '.photo-culler-results.json'] }, new Set(), {
      '/photos/.photo-culler-results.json': '{ not json',
    });

    const plan = await planCleanUp('/photos');
    expect(plan.results).toEqual([]);
  });
});

describe('applyCleanUp', () => {
  it('removes only the named records and keeps the rest', async () => {
    const onDisk = JSON.stringify({
      version: 1,
      folderPath: '/photos',
      updatedAt: 'x',
      images: {
        'a.jpg': { classification: 'keep', qualityScore: 88 },
        'gone.jpg': { classification: 'delete' },
      },
    });
    mockReadFile.mockResolvedValue(onDisk);
    mockWriteFile.mockResolvedValue(undefined);

    const result = await applyCleanUp({
      thumbs: [],
      staleCacheDirs: [],
      results: [{ file: '/photos/.photo-culler-results.json', names: ['gone.jpg'] }],
      directoriesScanned: 1,
    });

    expect(result.entriesRemoved).toBe(1);
    const written = JSON.parse(String(mockWriteFile.mock.calls[0]![1]));
    expect(Object.keys(written.images)).toEqual(['a.jpg']);
    // The surviving record keeps everything it had.
    expect(written.images['a.jpg'].qualityScore).toBe(88);
  });

  it('re-reads the file rather than trusting the plan snapshot', async () => {
    // A debounced save may have rewritten the file between planning and
    // applying; only the named keys may be dropped.
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        version: 1,
        folderPath: '/photos',
        updatedAt: 'x',
        images: { 'gone.jpg': {}, 'added-since.jpg': { classification: 'review' } },
      }),
    );
    mockWriteFile.mockResolvedValue(undefined);

    await applyCleanUp({
      thumbs: [],
      staleCacheDirs: [],
      results: [{ file: '/photos/.photo-culler-results.json', names: ['gone.jpg'] }],
      directoriesScanned: 1,
    });

    const written = JSON.parse(String(mockWriteFile.mock.calls[0]![1]));
    expect(Object.keys(written.images)).toEqual(['added-since.jpg']);
  });
});
