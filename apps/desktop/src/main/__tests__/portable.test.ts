import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * `portable.ts` does its work at MODULE scope, because a userData redirect has to
 * land before electron-store's constructor reads the path — see that file's
 * header. So every case here resets the module registry and re-imports, rather
 * than calling a function.
 */

const { appMock } = vi.hoisted(() => ({
  appMock: {
    isPackaged: false,
    exePath: '',
    userDataPath: 'OS-DEFAULT',
    setPath: vi.fn(),
    getPath: vi.fn(),
  },
}));

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return appMock.isPackaged;
    },
    getPath: (name: string) => {
      appMock.getPath(name);
      if (name === 'exe') return appMock.exePath;
      if (name === 'userData') return appMock.userDataPath;
      throw new Error(`unexpected getPath(${name})`);
    },
    setPath: appMock.setPath,
  },
}));

let root: string;
const realPlatform = process.platform;

/** Re-evaluate portable.ts against the current mock state. */
async function loadPortable(): Promise<string | null> {
  vi.resetModules();
  const mod = await import('../portable');
  return mod.portableDataDir;
}

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value, configurable: true });
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'pc-portable-'));
  appMock.isPackaged = true;
  appMock.exePath = path.join(root, 'Photo Culler.exe');
  appMock.setPath.mockClear();
  delete process.env.PORTABLE_EXECUTABLE_DIR;
});

afterEach(async () => {
  setPlatform(realPlatform);
  delete process.env.PORTABLE_EXECUTABLE_DIR;
  await rm(root, { recursive: true, force: true });
});

describe('portable mode', () => {
  it('does nothing in an unpackaged (dev) run, even with a marker present', async () => {
    appMock.isPackaged = false;
    await writeFile(path.join(root, 'portable'), '');

    expect(await loadPortable()).toBeNull();
    expect(appMock.setPath).not.toHaveBeenCalled();
  });

  it('does nothing without a marker file — an unzip into Program Files keeps the OS profile', async () => {
    expect(await loadPortable()).toBeNull();
    expect(appMock.setPath).not.toHaveBeenCalled();
    // Nothing may be created speculatively beside the exe.
    expect(readdirSync(root)).toEqual([]);
  });

  it('redirects userData beside the exe when a `portable` marker is there', async () => {
    await writeFile(path.join(root, 'portable'), '');

    const expected = path.join(root, 'photo-culler-data');
    expect(await loadPortable()).toBe(expected);
    expect(appMock.setPath).toHaveBeenCalledWith('userData', expected);
    expect(existsSync(expected)).toBe(true);
  });

  it('accepts `portable.txt`, because Explorer appends .txt to an extensionless file', async () => {
    await writeFile(path.join(root, 'portable.txt'), '');

    expect(await loadPortable()).toBe(path.join(root, 'photo-culler-data'));
  });

  it('leaves no write probe behind', async () => {
    await writeFile(path.join(root, 'portable'), '');
    const dir = await loadPortable();

    expect(readdirSync(dir!)).toEqual([]);
  });

  it('declines when the data directory cannot be created, rather than failing to start', async () => {
    await writeFile(path.join(root, 'portable'), '');
    // A FILE sitting on the directory's name: mkdir refuses, which is the
    // portable stand-in for a read-only stick or an ACL that says no.
    await writeFile(path.join(root, 'photo-culler-data'), 'in the way');

    expect(await loadPortable()).toBeNull();
    expect(appMock.setPath).not.toHaveBeenCalled();
  });

  it('resolves to the folder HOLDING the .app on macOS, never inside the bundle', async () => {
    setPlatform('darwin');
    const macos = path.join(root, 'Photo Culler.app', 'Contents', 'MacOS');
    await mkdir(macos, { recursive: true });
    appMock.exePath = path.join(macos, 'Photo Culler');
    // Marker sits beside the bundle, not in it — writing inside would break the
    // ad-hoc signature and fail outright on a read-only volume.
    await writeFile(path.join(root, 'portable'), '');

    expect(await loadPortable()).toBe(path.join(root, 'photo-culler-data'));
  });

  it('ignores a marker INSIDE the mac bundle', async () => {
    setPlatform('darwin');
    const macos = path.join(root, 'Photo Culler.app', 'Contents', 'MacOS');
    await mkdir(macos, { recursive: true });
    appMock.exePath = path.join(macos, 'Photo Culler');
    await writeFile(path.join(macos, 'portable'), '');

    expect(await loadPortable()).toBeNull();
  });

  it('honours PORTABLE_EXECUTABLE_DIR without a marker — the NSIS stub only exists in a portable build', async () => {
    const stubDir = path.join(root, 'stub');
    await mkdir(stubDir, { recursive: true });
    process.env.PORTABLE_EXECUTABLE_DIR = stubDir;
    // Deliberately no marker, and the exe elsewhere: the variable is proof enough.
    appMock.exePath = path.join(root, 'elsewhere', 'Photo Culler.exe');

    expect(await loadPortable()).toBe(path.join(stubDir, 'photo-culler-data'));
  });
});
