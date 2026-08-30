import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { RenamePlan, RenamePlanEntry, ScanProgress } from '@photo-culler/types';
import { usePhotoStore, formatRenameStatus } from '../hooks/usePhotoStore';

/**
 * The renderer half of a rename: re-keying everything that names a path.
 *
 * The main process moves the file and re-keys the results FILE; these tests are
 * about what happens in memory afterwards, and the reason they matter is not
 * cosmetic. `projectFolderResults` reads `qualityScores[image.path]` and writes
 * `next[image.name]` — so an image whose `name` has moved while its score is
 * still filed under the OLD path does not merely show a blank badge, it writes
 * an EMPTY record over the score on the next save. A quality score exists in no
 * other place.
 *
 * The other half is ordering: a rating write is debounced against the old path,
 * and if it fires after the rename it hits a file that is gone, fails, and
 * rolls the star back — losing a rating from the only place it lives.
 */

class FakeWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event?: unknown) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
}

function img(folder: string, name: string) {
  return { name, path: `${folder}/${name}`, folder, extension: 'jpg', size: 100, lastModified: 1 };
}

function records(folder: string, scores: Record<string, number>): string {
  return JSON.stringify({
    version: 1,
    folderPath: folder,
    updatedAt: 'x',
    images: Object.fromEntries(
      Object.entries(scores).map(([name, qualityScore]) => [name, { qualityScore }]),
    ),
  });
}

/** One 'rename' entry, with the fields the store actually reads. */
function entry(
  srcFolder: string,
  srcName: string,
  targetName: string,
  targetFolder = srcFolder,
): RenamePlanEntry {
  return {
    src: `${srcFolder}/${srcName}`,
    srcFolder,
    srcName,
    targetFolder,
    targetName,
    targetPath: `${targetFolder}/${targetName}`,
    action: 'rename',
    tag: 'DateTimeOriginal',
  };
}

function planOf(entries: RenamePlanEntry[]): RenamePlan {
  return {
    entries,
    counts: { rename: entries.length, unchanged: 0, 'no-date': 0, duplicate: 0, blocked: 0 },
    touchedFolders: [...new Set(entries.flatMap((e) => [e.srcFolder, e.targetFolder]))],
  };
}

let present: Record<string, string[]>;
let disk: Record<string, string | null>;
/** Every path executeRename should refuse to move, by src. */
let refuse: Set<string>;
let order: string[];
let executed: RenamePlan[];
let ratingWrites: Array<{ path: string; rating: number }>;
/** The store's SCAN_PROGRESS subscriber, so a test can push a report at it. */
let progressListener: ((progress: ScanProgress) => void) | null;

beforeEach(() => {
  vi.useFakeTimers();
  order = [];
  executed = [];
  refuse = new Set();
  ratingWrites = [];
  progressListener = null;
  present = { '/A': ['a1.jpg', 'a2.jpg'] };
  disk = { '/A': records('/A', { 'a1.jpg': 88, 'a2.jpg': 71 }) };

  (globalThis as unknown as { Worker: unknown }).Worker = FakeWorker;
  (globalThis as unknown as { window: { api: unknown } }).window.api = {
    scanFolder: vi.fn(async (root: string) =>
      Object.keys(present)
        .filter((f) => f === root || f.startsWith(`${root}/`))
        .flatMap((folder) => (present[folder] ?? []).map((name) => img(folder, name))),
    ),
    loadResults: vi.fn(async (folder: string) => disk[folder] ?? null),
    saveResults: vi.fn(async (folder: string, data: string) => {
      order.push(`save:${folder}`);
      disk[folder] = data;
    }),
    writeRating: vi.fn(async (filePath: string, rating: number) => {
      order.push('writeRating');
      ratingWrites.push({ path: filePath, rating });
      return { ok: true };
    }),
    planRename: vi.fn(async () => ({ plan: planOf([]) })),
    executeRename: vi.fn(async (plan: RenamePlan) => {
      order.push('executeRename');
      executed.push(plan);
      const moving = plan.entries.filter((e) => e.action === 'rename');
      return {
        outcomes: moving.map((e) => ({
          src: e.src,
          targetPath: e.targetPath,
          ok: !refuse.has(e.src),
          ...(refuse.has(e.src) ? { error: 'EBUSY' } : {}),
        })),
        renamed: moving.filter((e) => !refuse.has(e.src)).length,
        failed: moving.filter((e) => refuse.has(e.src)).length,
        resultsFilesTouched: [],
      };
    }),
    pruneFolder: vi.fn(async () => ({
      thumbsRemoved: 0,
      legacyRemoved: 0,
      entriesRemoved: 0,
      directoriesScanned: 1,
    })),
    deleteFiles: vi.fn(async (paths: string[]) => ({ succeeded: paths, failed: [] })),
    countThumbCache: vi.fn(async () => 0),
    getSession: vi.fn(async () => ({})),
    setSession: vi.fn(async () => undefined),
    loadThumbCache: vi.fn(async () => null),
    saveThumbCache: vi.fn(async () => undefined),
    readFile: vi.fn(async () => new ArrayBuffer(8)),
    getAppVersion: vi.fn(async () => '1.8.0'),
    onScanProgress: vi.fn((l: (progress: ScanProgress) => void) => {
      progressListener = l;
    }),
    removeScanProgressListener: vi.fn(() => {
      progressListener = null;
    }),
  };
});

afterEach(() => {
  vi.useRealTimers();
});

async function openFolder(root = '/A') {
  const { result } = renderHook(() => usePhotoStore());
  await act(async () => {
    await result.current.openFolder(root);
  });
  await act(async () => {
    result.current.syncVisibleOrder(result.current.state.images.map((i) => i.path));
  });
  return result;
}

const RENAMED = '2025-08-24 14-30-12-000.jpg';

describe('applyRename re-keys the renderer', () => {
  it('moves the image path and name', async () => {
    const result = await openFolder();
    await act(async () => {
      await result.current.applyRename(planOf([entry('/A', 'a1.jpg', RENAMED)]));
    });

    const moved = result.current.state.images.find((i) => i.name === RENAMED);
    expect(moved?.path).toBe(`/A/${RENAMED}`);
    expect(result.current.state.images.some((i) => i.name === 'a1.jpg')).toBe(false);
  });

  it('carries the quality score across, so the next save does not blank it', async () => {
    const result = await openFolder();
    expect(result.current.state.qualityScores['/A/a1.jpg']).toBe(88);

    await act(async () => {
      await result.current.applyRename(planOf([entry('/A', 'a1.jpg', RENAMED)]));
    });

    expect(result.current.state.qualityScores[`/A/${RENAMED}`]).toBe(88);
    expect(result.current.state.qualityScores['/A/a1.jpg']).toBeUndefined();
    // The file it did not touch is untouched.
    expect(result.current.state.qualityScores['/A/a2.jpg']).toBe(71);
  });

  it('carries the rating across', async () => {
    const result = await openFolder();
    await act(async () => {
      result.current.setRating('/A/a1.jpg', 4);
    });
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    await act(async () => {
      await result.current.applyRename(planOf([entry('/A', 'a1.jpg', RENAMED)]));
    });

    expect(result.current.state.ratings[`/A/${RENAMED}`]).toBe(4);
    expect(result.current.state.ratings['/A/a1.jpg']).toBeUndefined();
  });

  it('moves the cursor and the selection with the file', async () => {
    const result = await openFolder();
    await act(async () => {
      result.current.selectImage('/A/a1.jpg', 'plain');
    });
    expect(result.current.state.focusedImageId).toBe('/A/a1.jpg');

    await act(async () => {
      await result.current.applyRename(planOf([entry('/A', 'a1.jpg', RENAMED)]));
    });

    expect(result.current.state.focusedImageId).toBe(`/A/${RENAMED}`);
    expect([...result.current.state.selection]).toContain(`/A/${RENAMED}`);
  });

  it('bumps fileRevision, which is what busts the path-keyed caches', async () => {
    const result = await openFolder();
    const before = result.current.state.fileRevision;

    await act(async () => {
      await result.current.applyRename(planOf([entry('/A', 'a1.jpg', RENAMED)]));
    });

    expect(result.current.state.fileRevision).toBe(before + 1);
  });

  it('leaves a file the rename could not move exactly as it was', async () => {
    const result = await openFolder();
    refuse.add('/A/a1.jpg');

    await act(async () => {
      await result.current.applyRename(
        planOf([entry('/A', 'a1.jpg', RENAMED), entry('/A', 'a2.jpg', 'other.jpg')]),
      );
    });

    // Refused: still under its old name, with its score.
    expect(result.current.state.images.some((i) => i.name === 'a1.jpg')).toBe(true);
    expect(result.current.state.qualityScores['/A/a1.jpg']).toBe(88);
    // Succeeded: moved, with its score.
    expect(result.current.state.qualityScores['/A/other.jpg']).toBe(71);
  });

  it('does nothing at all for a plan with nothing to move', async () => {
    const result = await openFolder();
    const outcome = await act(async () => result.current.applyRename(planOf([])));
    expect(outcome).toBeNull();
    expect(executed).toHaveLength(0);
  });

  it('handles a move between folders, as DCIM consolidation produces', async () => {
    present = { '/A': [], '/A/DCIM': [], '/A/DCIM/100': ['p.jpg'] };
    disk = { '/A/DCIM/100': records('/A/DCIM/100', { 'p.jpg': 55 }) };
    const result = await openFolder('/A');

    await act(async () => {
      await result.current.applyRename(planOf([entry('/A/DCIM/100', 'p.jpg', RENAMED, '/A/DCIM')]));
    });

    const moved = result.current.state.images.find((i) => i.name === RENAMED);
    expect(moved?.path).toBe(`/A/DCIM/${RENAMED}`);
    expect(result.current.state.qualityScores[`/A/DCIM/${RENAMED}`]).toBe(55);
    // `folder` moves too. It is `dirname(path)` by contract and it is what
    // `groupByFolder` sections by — left behind, the renamed photo sits under a
    // header naming the folder it just left. Caught by running the real app.
    expect(moved?.folder).toBe('/A/DCIM');
  });

  it('keeps folder equal to dirname(path) for every image it touched', async () => {
    present = { '/A': [], '/A/DCIM': [], '/A/DCIM/100': ['p.jpg', 'q.jpg'] };
    const result = await openFolder('/A');

    await act(async () => {
      await result.current.applyRename(
        planOf([
          entry('/A/DCIM/100', 'p.jpg', 'p-new.jpg', '/A/DCIM'),
          entry('/A/DCIM/100', 'q.jpg', 'q-new.jpg', '/A/DCIM'),
        ]),
      );
    });

    for (const image of result.current.state.images) {
      const dir = image.path.slice(0, image.path.lastIndexOf('/'));
      expect(image.folder).toBe(dir);
    }
  });
});

describe('applyRename quiesces first', () => {
  it('flushes a pending rating write BEFORE renaming', async () => {
    // The debounce is keyed by the OLD path. Left to fire afterwards it writes
    // to a file that no longer exists, the write fails, persistRating rolls the
    // star back, and the rating is gone from the only place it lived.
    const result = await openFolder();
    await act(async () => {
      result.current.setRating('/A/a1.jpg', 5);
    });

    await act(async () => {
      await result.current.applyRename(planOf([entry('/A', 'a1.jpg', RENAMED)]));
    });

    expect(order.indexOf('writeRating')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('writeRating')).toBeLessThan(order.indexOf('executeRename'));
    expect(ratingWrites).toEqual([{ path: '/A/a1.jpg', rating: 5 }]);
  });

  it('does not let a results write land in the middle', async () => {
    const result = await openFolder();
    // A score arrives, scheduling a debounced save.
    await act(async () => {
      result.current.setQualityScore('/A/a2.jpg', 42, {
        sharpness: 1,
        exposure: 1,
        contrast: 1,
        noise: 1,
      });
    });

    await act(async () => {
      await result.current.applyRename(planOf([entry('/A', 'a1.jpg', RENAMED)]));
    });

    const executeAt = order.indexOf('executeRename');
    const savesBefore = order.slice(0, executeAt).filter((o) => o.startsWith('save:'));
    expect(savesBefore).toEqual([]);
  });

  it('refuses to plan while the scan is still filling in metadata', async () => {
    const result = await openFolder();
    // The scan's deferred half reports over SCAN_PROGRESS, so this is the only
    // way in — and `scanId` has to be the store's own open epoch or the report
    // is dropped as belonging to a folder it has left.
    act(() => {
      progressListener?.({
        scanId: 1,
        phase: 'metadata',
        found: 10,
        completed: 3,
        images: [],
      });
    });

    const outcome = await act(async () =>
      result.current.planRename({
        target: { kind: 'folder', folder: '/A', recursive: false },
        consolidateDcim: true,
      }),
    );

    expect(outcome.plan).toBeNull();
    expect(outcome.error).toMatch(/Scan/);
    expect(window.api.planRename).not.toHaveBeenCalled();
  });
});

describe('formatRenameStatus', () => {
  it('never hides a failure', () => {
    expect(
      formatRenameStatus({ outcomes: [], renamed: 199, failed: 1, resultsFilesTouched: [] }),
    ).toBe('199 files renamed, 1 failed');
  });

  it('says nothing about failures when there are none', () => {
    expect(
      formatRenameStatus({ outcomes: [], renamed: 3, failed: 0, resultsFilesTouched: [] }),
    ).toBe('3 files renamed');
  });

  it('gets the singular right', () => {
    expect(
      formatRenameStatus({ outcomes: [], renamed: 1, failed: 0, resultsFilesTouched: [] }),
    ).toBe('1 file renamed');
  });
});
