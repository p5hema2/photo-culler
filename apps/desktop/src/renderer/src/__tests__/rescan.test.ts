import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePhotoStore, formatRescanStatus } from '../hooks/usePhotoStore';

/**
 * Rescan, as of 1.7.0: non-destructive, and the only thing that prunes.
 *
 * Up to 1.6.4 it called `clearResults`, which deleted the results file in every
 * directory below the root — on a 21 851-image library that discarded every
 * quality score and cost ~128 GB of re-reading to rebuild. What it does now is
 * re-walk the tree, take up what is new, drop what is gone, remove records and
 * thumbnails whose image no longer exists, and keep everything else.
 *
 * The fake disk below is deliberately two-part: `present` is what the walk finds,
 * `disk` is what the results files hold. An orphan is a record in the second with
 * no name in the first, which is exactly how the main process decides.
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

/** Image names the walk finds, per folder. */
let present: Record<string, string[]>;
/** Results file contents, per folder. */
let disk: Record<string, string | null>;
/**
 * Star ratings, by absolute path — the image FILES, not the results files. The
 * walk reads them back, which is why a rescan has to flush pending writes first.
 */
let ratingsOnDisk: Record<string, number>;
let pruneCalls: string[];
let saveCalls: string[];
/** Set to hold the prune open, so the rescan can be inspected mid-flight. */
let pruneGate: { promise: Promise<void>; open: () => void } | null;
/** Call order across the IPC surface, for the tests that care which came first. */
let order: string[];

function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

/** Folders at or below `root`, in the fake tree. */
function foldersUnder(root: string): string[] {
  return Object.keys(present).filter((folder) => folder === root || folder.startsWith(`${root}/`));
}

/**
 * The fake prune, split the way the real one is: work out what is orphaned NOW,
 * delete it later. Only the named keys go, so a write that lands in between keeps
 * whatever else it added.
 */
function planPrune(root: string): Array<{ folder: string; names: string[] }> {
  const plan: Array<{ folder: string; names: string[] }> = [];
  for (const folder of foldersUnder(root)) {
    const raw = disk[folder];
    if (!raw) continue;
    const parsed = JSON.parse(raw) as { images: Record<string, unknown> };
    const names = Object.keys(parsed.images).filter((n) => !present[folder]?.includes(n));
    if (names.length > 0) plan.push({ folder, names });
  }
  return plan;
}

function applyPrune(plan: Array<{ folder: string; names: string[] }>): number {
  let entriesRemoved = 0;
  for (const { folder, names } of plan) {
    const raw = disk[folder];
    if (!raw) continue;
    const parsed = JSON.parse(raw) as { images: Record<string, unknown> };
    for (const name of names) {
      if (name in parsed.images) {
        delete parsed.images[name];
        entriesRemoved += 1;
      }
    }
    disk[folder] = JSON.stringify(parsed);
  }
  return entriesRemoved;
}

beforeEach(() => {
  vi.useFakeTimers();
  pruneGate = null;
  pruneCalls = [];
  saveCalls = [];
  order = [];
  ratingsOnDisk = {};
  present = { '/A': ['a1.jpg', 'a2.jpg', 'a3.jpg'] };
  disk = { '/A': records('/A', { 'a1.jpg': 88, 'a2.jpg': 71, 'gone.jpg': 12 }) };

  (globalThis as unknown as { Worker: unknown }).Worker = FakeWorker;
  (globalThis as unknown as { window: { api: unknown } }).window.api = {
    scanFolder: vi.fn(async (root: string) => {
      order.push('scan');
      return foldersUnder(root).flatMap((folder) =>
        (present[folder] ?? []).map((name) => {
          const file = img(folder, name);
          const rating = ratingsOnDisk[file.path];
          return rating === undefined ? file : { ...file, rating };
        }),
      );
    }),
    loadResults: vi.fn(async (folder: string) => disk[folder] ?? null),
    saveResults: vi.fn(async (folder: string, data: string) => {
      order.push('save');
      saveCalls.push(folder);
      disk[folder] = data;
    }),
    pruneFolder: vi.fn((root: string) => {
      pruneCalls.push(root);
      const plan = planPrune(root);
      const finish = () => {
        order.push('prune');
        return {
          thumbsRemoved: 2,
          legacyRemoved: 0,
          entriesRemoved: applyPrune(plan),
          directoriesScanned: foldersUnder(root).length,
        };
      };
      return pruneGate ? pruneGate.promise.then(finish) : Promise.resolve(finish());
    }),
    writeRating: vi.fn(async (filePath: string, rating: number) => {
      order.push('writeRating');
      ratingsOnDisk[filePath] = rating;
      return { ok: true };
    }),
    deleteFiles: vi.fn(async (paths: string[]) => ({ succeeded: paths, failed: [] })),
    countThumbCache: vi.fn(async () => 0),
    getSession: vi.fn(async () => ({})),
    setSession: vi.fn(async () => undefined),
    loadThumbCache: vi.fn(async () => null),
    saveThumbCache: vi.fn(async () => undefined),
    readFile: vi.fn(async () => new ArrayBuffer(8)),
    getAppVersion: vi.fn(async () => '1.7.0'),
  };
});

afterEach(() => {
  vi.useRealTimers();
});

/** Open a folder and report the visible order back, the way App's effect does. */
async function openWithOrder(root: string) {
  const { result } = renderHook(() => usePhotoStore());
  await act(async () => {
    await result.current.openFolder(root);
  });
  await act(async () => {
    result.current.syncVisibleOrder(result.current.state.images.map((i) => i.path));
  });
  return result;
}

/** Run a rescan to completion and re-report the order, as App would. */
async function rescanWithOrder(result: Awaited<ReturnType<typeof openWithOrder>>) {
  await act(async () => {
    await result.current.rescanFolder();
  });
  await act(async () => {
    result.current.syncVisibleOrder(result.current.state.images.map((i) => i.path));
  });
}

describe('Rescan keeps the work', () => {
  it('keeps the quality scores the old Rescan deleted', async () => {
    const result = await openWithOrder('/A');
    expect(result.current.state.qualityScores['/A/a1.jpg']).toBe(88);

    await rescanWithOrder(result);

    expect(result.current.state.qualityScores['/A/a1.jpg']).toBe(88);
    expect(result.current.state.qualityScores['/A/a2.jpg']).toBe(71);
    const onDisk = JSON.parse(disk['/A']!) as { images: Record<string, unknown> };
    expect(onDisk.images['a1.jpg']).toEqual({ qualityScore: 88 });
  });

  it('prunes the record whose image is gone, and only that one', async () => {
    const result = await openWithOrder('/A');
    await rescanWithOrder(result);

    expect(pruneCalls).toEqual(['/A']);
    const onDisk = JSON.parse(disk['/A']!) as { images: Record<string, unknown> };
    expect(Object.keys(onDisk.images).sort()).toEqual(['a1.jpg', 'a2.jpg']);
  });

  it('takes up new images and drops ones that are no longer there', async () => {
    const result = await openWithOrder('/A');

    present['/A'] = ['a2.jpg', 'a3.jpg', 'a4.jpg'];
    await rescanWithOrder(result);

    expect(result.current.state.images.map((i) => i.name)).toEqual(['a2.jpg', 'a3.jpg', 'a4.jpg']);
  });

  it('gets a pending rating into the file before the walk reads it back', async () => {
    // The image file is the authority for a rating, and the walk re-reads it. A
    // rating still sitting out its 300 ms debounce would otherwise be read back
    // at its old value and then overwritten on disk a moment later, leaving the
    // screen and the file disagreeing with nothing able to say which is right.
    const result = await openWithOrder('/A');
    act(() => {
      result.current.setRating('/A/a1.jpg', 4);
    });
    order.length = 0;

    await rescanWithOrder(result);

    expect(order.indexOf('writeRating')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('writeRating')).toBeLessThan(order.indexOf('scan'));
    expect(result.current.state.ratings['/A/a1.jpg']).toBe(4);
  });
});

describe('Rescan keeps the user in place', () => {
  it('leaves the cursor and the batch exactly where they were', async () => {
    const result = await openWithOrder('/A');
    await act(async () => {
      result.current.selectImage('/A/a2.jpg', 'plain');
    });
    await act(async () => {
      result.current.selectImage('/A/a3.jpg', 'range');
    });
    expect(result.current.selectionTargets).toEqual(['/A/a2.jpg', '/A/a3.jpg']);

    await rescanWithOrder(result);

    expect(result.current.state.focusedImageId).toBe('/A/a3.jpg');
    expect(result.current.selectionTargets).toEqual(['/A/a2.jpg', '/A/a3.jpg']);
  });

  it('moves the cursor to the next survivor when its own image has gone', async () => {
    const result = await openWithOrder('/A');
    await act(async () => {
      result.current.selectImage('/A/a2.jpg', 'plain');
    });

    present['/A'] = ['a1.jpg', 'a3.jpg'];
    await rescanWithOrder(result);

    expect(result.current.state.focusedImageId).toBe('/A/a3.jpg');
    // Reconciled, not merely re-reported: a batch action must never be able to
    // name a file that is not on disk.
    expect(result.current.selectionTargets).toEqual(['/A/a3.jpg']);
  });

  it('does not empty the selection just because the walk is running', async () => {
    // Rescan deliberately keeps the image list on screen while it re-walks. If it
    // cleared it, App would report an empty visible order back and the selection
    // would be reconciled away — which is the thing this has to preserve.
    const result = await openWithOrder('/A');
    await act(async () => {
      result.current.selectImage('/A/a2.jpg', 'plain');
    });

    pruneGate = gate();
    let running!: Promise<void>;
    await act(async () => {
      running = result.current.rescanFolder();
    });

    expect(result.current.state.isLoading).toBe(true);
    expect(result.current.state.images).toHaveLength(3);
    expect(result.current.selectionTargets).toEqual(['/A/a2.jpg']);

    pruneGate.open();
    await act(async () => {
      await running;
    });
  });
});

describe('Rescan and the write queue', () => {
  it('cannot let a queued subfolder write resurrect a pruned record', async () => {
    // The renderer's half of the guard. Pruning used to be a menu command nobody
    // ran; it is on F5 now, and `writeFolder` projects state over `resultsRef` —
    // which, until the re-walk has reloaded the files, still holds every record
    // the prune is removing. So no results write may go out while a rescan runs.
    present['/A/sub'] = ['s1.jpg'];
    disk['/A/sub'] = records('/A/sub', { 's1.jpg': 55, 'sub-gone.jpg': 9 });

    const result = await openWithOrder('/A');
    saveCalls.length = 0;

    pruneGate = gate();
    let running!: Promise<void>;
    await act(async () => {
      running = result.current.rescanFolder();
    });

    // A score lands mid-prune and its debounce fires. Nothing may reach disk.
    await act(async () => {
      result.current.setQualityScore('/A/sub/s1.jpg', 60);
    });
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(saveCalls).toEqual([]);

    pruneGate.open();
    await act(async () => {
      await running;
    });
    // And the held write, once released, is projected over the RELOADED results.
    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    const onDisk = JSON.parse(disk['/A/sub']!) as { images: Record<string, unknown> };
    expect(Object.keys(onDisk.images)).toEqual(['s1.jpg']);
  });

  it('holds the write queue from the very first await, not from the prune', async () => {
    // The gap this closes: `rescanFolder` flushes pending RATING writes before it
    // prunes, and that flush awaits real IPC. A scoring result arriving inside
    // that window scheduled its debounce while the hold was still off, and the
    // timer then fired mid-prune with `resultsRef` holding every record the prune
    // was removing.
    //
    // The assertion is that nothing reaches disk at all, rather than that the
    // orphan stays gone: whether an escaped write lands before or after the
    // prune's own read-modify-write is not something the renderer can order, so
    // the only rule it can hold up is that no results write goes out while a
    // rescan runs.
    const result = await openWithOrder('/A');

    const ratingGate = gate();
    const api = (window as unknown as { api: Record<string, unknown> }).api;
    api.writeRating = vi.fn(async (filePath: string, rating: number) => {
      await ratingGate.promise;
      ratingsOnDisk[filePath] = rating;
      return { ok: true };
    });

    act(() => {
      result.current.setRating('/A/a1.jpg', 4);
    });
    saveCalls.length = 0;

    pruneGate = gate();
    let running!: Promise<void>;
    await act(async () => {
      running = result.current.rescanFolder();
    });
    // Parked on the rating flush now — the prune has not been asked for yet.
    expect(pruneCalls).toEqual([]);

    await act(async () => {
      result.current.setQualityScore('/A/a1.jpg', 60);
    });
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(saveCalls).toEqual([]);

    ratingGate.open();
    pruneGate.open();
    await act(async () => {
      await running;
    });
    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    // And the held write, released afterwards, is projected over the RELOADED
    // results, so it cannot bring the pruned record back. The score of 60 is not
    // on disk either, and that is the documented trade rather than a miss: the
    // re-walk rebuilt `qualityScores` from the files, so 88 is what state holds
    // now and the scoring pass recomputes anything genuinely absent.
    const onDisk = JSON.parse(disk['/A']!) as { images: Record<string, unknown> };
    expect(Object.keys(onDisk.images)).not.toContain('gone.jpg');
    expect(onDisk.images['a1.jpg']).toEqual({ qualityScore: 88 });
  });

  it('abandons a rescan whose folder was opened over mid-prune', async () => {
    // The prune walks the whole tree, so there is real time in which the user can
    // open something else. Following it up with the re-walk would then replace the
    // tree that is on screen with the wrong photos — and, because state and
    // `resultsRef` would be one tree apart, the next projection would write an
    // empty map over /A's real file.
    present['/B'] = ['b1.jpg'];
    disk['/B'] = records('/B', { 'b1.jpg': 40 });

    const result = await openWithOrder('/A');
    await act(async () => {
      result.current.setQualityScore('/A/a1.jpg', 99);
    });

    pruneGate = gate();
    let running!: Promise<void>;
    await act(async () => {
      running = result.current.rescanFolder();
    });

    await act(async () => {
      await result.current.openFolder('/B');
    });

    pruneGate.open();
    await act(async () => {
      await running;
    });
    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    // /B is what is on screen, and /A's file still describes /A.
    expect(result.current.state.folderPath).toBe('/B');
    expect(result.current.state.images.map((i) => i.name)).toEqual(['b1.jpg']);
    const onDisk = JSON.parse(disk['/A']!) as { images: Record<string, unknown> };
    expect(Object.keys(onDisk.images).sort()).toEqual(['a1.jpg', 'a2.jpg']);
  });
});

describe('the Rescan status line', () => {
  it('says what happened and then takes itself away', async () => {
    const result = await openWithOrder('/A');
    present['/A'] = ['a1.jpg', 'a2.jpg', 'a3.jpg', 'a4.jpg'];

    await rescanWithOrder(result);

    expect(result.current.state.status).toBe(
      'Rescan: 1 new, 1 stale record removed, 2 stale thumbnails removed',
    );

    // A permanent line would be read as a condition rather than as news.
    await act(async () => {
      vi.advanceTimersByTime(6000);
    });
    expect(result.current.state.status).toBeNull();
  });

  it('still reports an F5 that found nothing to do', async () => {
    const result = await openWithOrder('/A');
    // First rescan clears the one orphan and the two thumbnails.
    await rescanWithOrder(result);
    await act(async () => {
      vi.advanceTimersByTime(6000);
    });

    (window.api.pruneFolder as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      thumbsRemoved: 0,
      legacyRemoved: 0,
      entriesRemoved: 0,
      directoriesScanned: 1,
    });
    await rescanWithOrder(result);

    expect(result.current.state.status).toBe('Rescan: nothing to update');
  });
});

describe('formatRescanStatus', () => {
  it('leaves out every count that is zero', () => {
    expect(
      formatRescanStatus({ added: 12, removed: 0, recordsRemoved: 340, thumbsRemoved: 0 }),
    ).toBe('Rescan: 12 new, 340 stale records removed');
  });

  it('says it once when there is nothing to report', () => {
    expect(formatRescanStatus({ added: 0, removed: 0, recordsRemoved: 0, thumbsRemoved: 0 })).toBe(
      'Rescan: nothing to update',
    );
  });

  it('gets the singular right, since one stale record is the common case', () => {
    expect(formatRescanStatus({ added: 0, removed: 1, recordsRemoved: 1, thumbsRemoved: 1 })).toBe(
      'Rescan: 1 gone, 1 stale record removed, 1 stale thumbnail removed',
    );
  });
});
