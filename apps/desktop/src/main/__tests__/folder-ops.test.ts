import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Creating, counting and deleting folders — on a real temp tree.
 *
 * The counting half is the interesting one. It exists to feed the confirmation
 * behind a recursive folder delete, which is the most destructive thing this
 * app can do: more than Execute, which is bounded by a star range, and more
 * than the Delete key, which names the images it removes. A confirmation that
 * undercounts is worse than none, so what it counts is asserted here rather
 * than assumed.
 */

vi.mock('electron', () => ({ app: { isPackaged: false } }));

const { createFolder, statFolder, deleteFolder } = await import('../folder-ops');

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'pc-folderops-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function file(rel: string, body = 'x'): Promise<void> {
  const full = path.join(root, rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, body);
}

describe('createFolder', () => {
  it('creates one subfolder', async () => {
    const result = await createFolder(root, 'Aussortiert');
    expect(result.ok).toBe(true);
    expect(await readdir(root)).toEqual(['Aussortiert']);
  });

  it('trims the name', async () => {
    await createFolder(root, '  Spaced  ');
    expect(await readdir(root)).toEqual(['Spaced']);
  });

  it('refuses a name the filesystem would not take', async () => {
    // Free text, unlike a generated filename — which makes it the more
    // dangerous of the two and the reason validateComponent is applied here.
    // Not a trailing SPACE: the name is trimmed first, deliberately, so that
    // one is legal by the time it is checked. A trailing dot survives trimming
    // and is what Windows actually refuses.
    for (const bad of ['a/b', 'co:lon', 'NUL', 'trailing.', '']) {
      const result = await createFolder(root, bad);
      expect(result.ok, bad).toBe(false);
      expect(result.error, bad).toBeTruthy();
    }
    expect(await readdir(root)).toEqual([]);
  });

  it('does not create a chain of folders from a slashed name', async () => {
    // Not `recursive: true`: the user asked for one folder.
    await createFolder(root, 'a/b/c');
    expect(await readdir(root)).toEqual([]);
  });

  it('reports an existing folder rather than silently succeeding', async () => {
    await createFolder(root, 'Same');
    const again = await createFolder(root, 'Same');
    expect(again.ok).toBe(false);
    expect(again.error).toMatch(/schon/);
  });
});

describe('statFolder', () => {
  it('counts every file and every byte, hidden ones included', async () => {
    await file('a.JPG', 'aaaa');
    await file('a.RW2', 'bbbbbb');
    await file('.photo-culler-results.json', '{}');
    await file('sub/b.JPG', 'cc');

    const stats = await statFolder(root);
    expect(stats.files).toBe(4);
    expect(stats.directories).toBe(1);
    expect(stats.bytes).toBe(4 + 6 + 2 + 2);
  });

  it('does not count the thumbnail cache as media the app displays', async () => {
    // `.photo-culler-thumbs` is full of .webp files and isMediaFile says yes to
    // those. Without the hidden-directory rule the dialog would claim the app
    // shows four photos where it shows one.
    await file('a.JPG');
    await file('.photo-culler-thumbs/a.JPG.thumb.webp');
    await file('.photo-culler-thumbs/b.JPG.thumb.webp');

    const stats = await statFolder(root);
    expect(stats.files).toBe(3);
    expect(stats.mediaFiles).toBe(1);
  });

  it('separates what the app shows from what would be deleted', async () => {
    await file('a.JPG');
    await file('a.RW2');
    await file('a.RW2.xmp');

    const stats = await statFolder(root);
    expect(stats.files).toBe(3);
    // The RAW and the sidecar are invisible to the app and go with it anyway —
    // which is the whole reason the dialog quotes both numbers.
    expect(stats.mediaFiles).toBe(1);
  });

  it('counts a video as media', async () => {
    await file('clip.MP4');
    expect((await statFolder(root)).mediaFiles).toBe(1);
  });

  it('reports zeroes for an empty folder', async () => {
    expect(await statFolder(root)).toEqual({
      files: 0,
      directories: 0,
      bytes: 0,
      mediaFiles: 0,
    });
  });

  it('reports zeroes for a folder that is not there', async () => {
    const stats = await statFolder(path.join(root, 'nope'));
    expect(stats.files).toBe(0);
  });
});

describe('deleteFolder', () => {
  it('removes the folder and everything below it', async () => {
    await file('doomed/a.JPG');
    await file('doomed/deep/b.JPG');
    await file('keep/c.JPG');

    const result = await deleteFolder(path.join(root, 'doomed'), root);

    expect(result.ok).toBe(true);
    expect(await readdir(root)).toEqual(['keep']);
  });

  it('refuses the opened root itself', async () => {
    // The app would be left pointing at nothing, and "close the folder" is not
    // what the user asked for.
    const result = await deleteFolder(root, root);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/geöffnete/);
  });

  it('refuses an ancestor of the opened root', async () => {
    await file('inner/x.JPG');
    const result = await deleteFolder(root, path.join(root, 'inner'));
    expect(result.ok).toBe(false);
  });

  it('refuses a folder outside the opened tree', async () => {
    const outside = await mkdtemp(path.join(tmpdir(), 'pc-outside-'));
    try {
      const result = await deleteFolder(outside, root);
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/außerhalb/);
      // Still there.
      expect(await readdir(outside)).toEqual([]);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('refuses a file', async () => {
    await file('a.JPG');
    const result = await deleteFolder(path.join(root, 'a.JPG'), root);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/kein Ordner/);
  });

  it('reports a folder that has already gone', async () => {
    const result = await deleteFolder(path.join(root, 'never'), root);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/existiert nicht/);
  });

  it('refuses a relative path', async () => {
    expect((await deleteFolder('relative', root)).ok).toBe(false);
  });
});
