import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockReadFile, mockRename } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockRename: vi.fn(),
}));

vi.mock('node:fs/promises', () => {
  const fs = {
    readFile: mockReadFile,
    rename: mockRename,
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    unlink: vi.fn(),
    stat: vi.fn(),
  };
  return { ...fs, default: fs };
});

// ipc-handlers pulls in electron, sharp and the store at module scope
vi.mock('electron', () => ({
  app: { getVersion: () => '1.2.0' },
  ipcMain: { handle: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
}));
vi.mock('sharp', () => ({ default: vi.fn() }));
vi.mock('../store', () => ({ getSession: vi.fn(), updateSession: vi.fn() }));
vi.mock('@photo-culler/image-utils', () => ({ scanFolder: vi.fn() }));

const { readResultsFile } = await import('../ipc-handlers');

const FOLDER = '/photos/2026-06';
const CURRENT = '.photo-culler-results.json';
const LEGACY = 'photo-culler-results.json';

function enoent(): NodeJS.ErrnoException {
  const err = new Error('not found') as NodeJS.ErrnoException;
  err.code = 'ENOENT';
  return err;
}

/** Match regardless of the platform's path separator. */
function endsWith(name: string) {
  return (call: unknown[]) => String(call[0]).endsWith(name);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('readResultsFile', () => {
  it('reads the current dotfile name and does not migrate', async () => {
    mockReadFile.mockResolvedValue('{"version":1}');

    const result = await readResultsFile(FOLDER);

    expect(result).toBe('{"version":1}');
    expect(mockReadFile.mock.calls.some(endsWith(CURRENT))).toBe(true);
    expect(mockRename).not.toHaveBeenCalled();
  });

  it('returns null when neither name exists', async () => {
    mockReadFile.mockRejectedValue(enoent());

    expect(await readResultsFile(FOLDER)).toBeNull();
    expect(mockRename).not.toHaveBeenCalled();
  });

  it('falls back to the legacy name and migrates it to the dotfile', async () => {
    mockReadFile.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith(CURRENT)) throw enoent();
      return '{"version":1,"legacy":true}';
    });

    const result = await readResultsFile(FOLDER);

    expect(result).toBe('{"version":1,"legacy":true}');
    expect(mockRename).toHaveBeenCalledTimes(1);
    const [from, to] = mockRename.mock.calls[0] as [string, string];
    expect(from.endsWith(LEGACY)).toBe(true);
    expect(to.endsWith(CURRENT)).toBe(true);
  });

  it('still returns legacy data when the rename fails', async () => {
    // Migration is best-effort: a locked or read-only folder must never cost
    // the user their existing scores and rotations.
    mockReadFile.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith(CURRENT)) throw enoent();
      return '{"version":1,"legacy":true}';
    });
    mockRename.mockRejectedValue(new Error('EPERM'));

    expect(await readResultsFile(FOLDER)).toBe('{"version":1,"legacy":true}');
  });

  it('propagates non-ENOENT errors instead of silently discarding results', async () => {
    const eacces = new Error('permission denied') as NodeJS.ErrnoException;
    eacces.code = 'EACCES';
    mockReadFile.mockRejectedValue(eacces);

    await expect(readResultsFile(FOLDER)).rejects.toThrow('permission denied');
  });
});
