import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePhotoStore } from '../hooks/usePhotoStore';

/**
 * The selection through the store, not through lib/selection.ts.
 *
 * The pure rules are tested in selection.test.ts; what these cover is the wiring
 * that decides what a keypress ACTS on — the loop App closes by reporting the
 * visible order back into the store, and the guarantee that hangs off it: a
 * batch action can never name an image the user cannot see.
 */

class FakeWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event?: unknown) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
}

const NAMES = ['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg'];
const PATHS = NAMES.map((name) => `/A/${name}`);

function img(name: string) {
  return { name, path: `/A/${name}`, folder: '/A', extension: 'jpg', size: 100, lastModified: 1 };
}

let writeRating: ReturnType<typeof vi.fn>;
let deleteFiles: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  writeRating = vi.fn(async () => ({ ok: true }));
  deleteFiles = vi.fn(async (paths: string[]) => ({ succeeded: paths, failed: [] }));
  (globalThis as unknown as { Worker: unknown }).Worker = FakeWorker;
  (globalThis as unknown as { window: { api: unknown } }).window.api = {
    scanFolder: vi.fn(async () => NAMES.map(img)),
    loadResults: vi.fn(async () => null),
    saveResults: vi.fn(async () => undefined),
    getSession: vi.fn(async () => ({})),
    setSession: vi.fn(async () => undefined),
    loadThumbCache: vi.fn(async () => null),
    saveThumbCache: vi.fn(async () => undefined),
    readFile: vi.fn(async () => new ArrayBuffer(8)),
    getAppVersion: vi.fn(async () => '1.6.1'),
    writeRating,
    deleteFiles,
  };
});

afterEach(() => {
  vi.useRealTimers();
});

/** Open the folder and report the full order back, the way App's effect does. */
async function openWithOrder() {
  const { result } = renderHook(() => usePhotoStore());
  await act(async () => {
    await result.current.openFolder('/A');
  });
  await act(async () => {
    result.current.syncVisibleOrder(PATHS);
  });
  return result;
}

describe('the selection through the store', () => {
  it('starts on the first image, so the very first rating keypress has a target', async () => {
    const result = await openWithOrder();
    expect(result.current.state.focusedImageId).toBe(PATHS[0]);
    expect(result.current.selectionTargets).toEqual([PATHS[0]]);
  });

  it('ranges a Shift-click over the order App reported, and rates all of it', async () => {
    const result = await openWithOrder();

    await act(async () => {
      result.current.selectImage(PATHS[1]!, 'plain');
    });
    await act(async () => {
      result.current.selectImage(PATHS[3]!, 'range');
    });
    expect([...result.current.state.selection].sort()).toEqual([PATHS[1], PATHS[2], PATHS[3]]);

    await act(async () => {
      result.current.rateSelection(4);
    });
    // The cursor is on the last click; the batch is the whole span.
    expect(result.current.state.focusedImageId).toBe(PATHS[3]);
    for (const path of [PATHS[1], PATHS[2], PATHS[3]]) {
      expect(result.current.state.ratings[path!]).toBe(4);
    }
    // 0 is "unrated", which is what the scan reported for every image.
    expect(result.current.state.ratings[PATHS[0]!]).toBe(0);

    await act(async () => {
      vi.advanceTimersByTime(400);
      await Promise.resolve();
    });
    expect(writeRating).toHaveBeenCalledTimes(3);
  });

  it('collapses the selection when the cursor moves, which is what an arrow key does', async () => {
    const result = await openWithOrder();
    await act(async () => {
      result.current.selectImage(PATHS[0]!, 'plain');
    });
    await act(async () => {
      result.current.selectImage(PATHS[4]!, 'range');
    });
    expect(result.current.state.selection.size).toBe(5);

    await act(async () => {
      result.current.setFocusedImage(PATHS[2]!);
    });
    expect([...result.current.state.selection]).toEqual([PATHS[2]]);
    expect(result.current.selectionTargets).toEqual([PATHS[2]]);
  });

  it('drops a selected image the moment it leaves the visible order', async () => {
    const result = await openWithOrder();
    await act(async () => {
      result.current.selectImage(PATHS[0]!, 'plain');
    });
    await act(async () => {
      result.current.selectImage(PATHS[2]!, 'range');
    });

    // A filter, a search or a collapsed folder — App reports the shorter order.
    await act(async () => {
      result.current.syncVisibleOrder([PATHS[0]!, PATHS[1]!]);
    });
    expect([...result.current.state.selection].sort()).toEqual([PATHS[0], PATHS[1]]);
  });

  it('has NOTHING to act on while the cursor is off screen', async () => {
    // The one that matters. Focus recovers lazily — it is still sitting on the
    // hidden image until the next arrow key — so the batch, and not the cursor,
    // has to be what a rating or a Delete reads. Rating an invisible photo is
    // merely baffling; deleting one is unrecoverable.
    const result = await openWithOrder();
    await act(async () => {
      result.current.selectImage(PATHS[4]!, 'plain');
    });
    await act(async () => {
      result.current.syncVisibleOrder([PATHS[0]!, PATHS[1]!]);
    });

    expect(result.current.state.focusedImageId).toBe(PATHS[4]);
    expect(result.current.state.selection.size).toBe(0);
    expect(result.current.selectionTargets).toEqual([]);

    await act(async () => {
      result.current.rateSelection(5);
    });
    expect(result.current.state.ratings[PATHS[4]!]).toBe(0);
    expect(writeRating).not.toHaveBeenCalled();
  });

  it('still falls back to the cursor once it is visible again', async () => {
    const result = await openWithOrder();
    // Ctrl-clicking the selected image empties the selection without moving the
    // cursor, and the cursor is on screen, so it is what a 0-5 key rates.
    await act(async () => {
      result.current.selectImage(PATHS[1]!, 'plain');
    });
    await act(async () => {
      result.current.selectImage(PATHS[1]!, 'toggle');
    });
    expect(result.current.state.selection.size).toBe(0);
    expect(result.current.selectionTargets).toEqual([PATHS[1]]);
  });

  it('lands the batch on the surviving neighbour after deleting it', async () => {
    const result = await openWithOrder();
    await act(async () => {
      result.current.selectImage(PATHS[1]!, 'plain');
    });
    await act(async () => {
      result.current.selectImage(PATHS[2]!, 'range');
    });
    await act(async () => {
      await result.current.deleteImages([PATHS[1]!, PATHS[2]!]);
    });

    expect(deleteFiles).toHaveBeenCalledWith([PATHS[1], PATHS[2]]);
    expect(result.current.state.focusedImageId).toBe(PATHS[3]);
    // Neither the gone paths nor an empty batch: a Delete straight after a
    // Delete has to mean the image now under the cursor.
    expect([...result.current.state.selection]).toEqual([PATHS[3]]);
  });

  it('forgets the selection and the order when another folder is opened', async () => {
    const result = await openWithOrder();
    await act(async () => {
      result.current.selectImage(PATHS[0]!, 'plain');
    });
    await act(async () => {
      result.current.selectImage(PATHS[4]!, 'range');
    });
    expect(result.current.state.selection.size).toBe(5);

    await act(async () => {
      await result.current.openFolder('/A');
    });
    // Back to just the first image — the new folder's, whatever it holds.
    expect([...result.current.state.selection]).toEqual([PATHS[0]]);
    expect(result.current.state.selectionAnchor).toBe(PATHS[0]);
  });
});
