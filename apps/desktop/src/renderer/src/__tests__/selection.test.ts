import { describe, it, expect } from 'vitest';
import {
  EMPTY_SELECTION,
  clickModifier,
  reconcileSelection,
  resolveSelectionClick,
  selectionTargets,
} from '../lib/selection';
import type { SelectionState } from '../lib/selection';

/**
 * The visible order: one flat list across folder sections and timestamp groups,
 * exactly what the grid renders. A Shift-range is defined over this and nothing
 * else — see lib/selection.ts.
 */
const ORDER = ['/a/1.jpg', '/a/2.jpg', '/a/3.jpg', '/b/4.jpg', '/b/5.jpg'];

function state(selection: string[], anchor: string | null): SelectionState {
  return { selection: new Set(selection), anchor };
}

/** Sorted for comparison — set iteration order is click order, not visible order. */
function paths(s: SelectionState): string[] {
  return [...s.selection].sort();
}

describe('clickModifier', () => {
  const keys = { shiftKey: false, ctrlKey: false, metaKey: false };

  it('reads a bare click as a plain one', () => {
    expect(clickModifier(keys)).toBe('plain');
  });

  it('reads Ctrl and Cmd as the same toggle', () => {
    expect(clickModifier({ ...keys, ctrlKey: true })).toBe('toggle');
    expect(clickModifier({ ...keys, metaKey: true })).toBe('toggle');
  });

  it('lets Shift win over Ctrl/Cmd', () => {
    // Extending a range is the more specific intent, and "toggle a range" is
    // not something this app offers.
    expect(clickModifier({ shiftKey: true, ctrlKey: true, metaKey: true })).toBe('range');
  });
});

describe('a plain click', () => {
  it('replaces the selection and plants the anchor', () => {
    const next = resolveSelectionClick(state(ORDER, '/a/1.jpg'), '/b/4.jpg', 'plain', ORDER);
    expect(paths(next)).toEqual(['/b/4.jpg']);
    expect(next.anchor).toBe('/b/4.jpg');
  });
});

describe('Shift-click', () => {
  it('selects the contiguous span from the anchor, inclusive', () => {
    const next = resolveSelectionClick(state(['/a/1.jpg'], '/a/1.jpg'), '/a/3.jpg', 'range', ORDER);
    expect(paths(next)).toEqual(['/a/1.jpg', '/a/2.jpg', '/a/3.jpg']);
  });

  it('spans the same range dragged backwards', () => {
    const next = resolveSelectionClick(state(['/b/4.jpg'], '/b/4.jpg'), '/a/2.jpg', 'range', ORDER);
    expect(paths(next)).toEqual(['/a/2.jpg', '/a/3.jpg', '/b/4.jpg']);
  });

  it('crosses folder sections, because the visible order does', () => {
    const next = resolveSelectionClick(state(['/a/3.jpg'], '/a/3.jpg'), '/b/5.jpg', 'range', ORDER);
    expect(paths(next)).toEqual(['/a/3.jpg', '/b/4.jpg', '/b/5.jpg']);
  });

  it('keeps the anchor, so the range can be re-dragged over the same pivot', () => {
    const wide = resolveSelectionClick(state(['/a/2.jpg'], '/a/2.jpg'), '/b/5.jpg', 'range', ORDER);
    expect(wide.anchor).toBe('/a/2.jpg');

    // Second Shift-click shrinks the range instead of ranging from /b/5.jpg.
    const narrowed = resolveSelectionClick(wide, '/a/3.jpg', 'range', ORDER);
    expect(paths(narrowed)).toEqual(['/a/2.jpg', '/a/3.jpg']);
  });

  it('acts as a plain click when there is no anchor at all', () => {
    const next = resolveSelectionClick(EMPTY_SELECTION, '/a/3.jpg', 'range', ORDER);
    expect(paths(next)).toEqual(['/a/3.jpg']);
    expect(next.anchor).toBe('/a/3.jpg');
  });

  it('acts as a plain click when the anchor has been filtered away', () => {
    // The anchor is a path the current filter no longer shows: there is no span
    // between it and the click, so the click plants a new anchor rather than
    // selecting an arbitrary stretch.
    const stale = state(['/a/2.jpg'], '/hidden/9.jpg');
    const next = resolveSelectionClick(stale, '/b/4.jpg', 'range', ORDER);
    expect(paths(next)).toEqual(['/b/4.jpg']);
    expect(next.anchor).toBe('/b/4.jpg');
  });

  it('replaces the selection rather than adding to it', () => {
    const next = resolveSelectionClick(state(['/b/5.jpg'], '/a/1.jpg'), '/a/2.jpg', 'range', ORDER);
    expect(paths(next)).toEqual(['/a/1.jpg', '/a/2.jpg']);
  });
});

describe('Ctrl/Cmd-click', () => {
  it('adds one image and leaves the rest alone', () => {
    const next = resolveSelectionClick(
      state(['/a/1.jpg', '/a/2.jpg'], '/a/1.jpg'),
      '/b/5.jpg',
      'toggle',
      ORDER,
    );
    expect(paths(next)).toEqual(['/a/1.jpg', '/a/2.jpg', '/b/5.jpg']);
    expect(next.anchor).toBe('/b/5.jpg');
  });

  it('removes an image that was selected', () => {
    const next = resolveSelectionClick(
      state(['/a/1.jpg', '/a/2.jpg'], '/a/1.jpg'),
      '/a/2.jpg',
      'toggle',
      ORDER,
    );
    expect(paths(next)).toEqual(['/a/1.jpg']);
  });

  it('can empty the selection', () => {
    const next = resolveSelectionClick(
      state(['/a/1.jpg'], '/a/1.jpg'),
      '/a/1.jpg',
      'toggle',
      ORDER,
    );
    expect(paths(next)).toEqual([]);
  });

  it('moves the anchor onto the clicked image even when it removed the anchor', () => {
    const next = resolveSelectionClick(
      state(['/a/1.jpg', '/a/2.jpg'], '/a/1.jpg'),
      '/a/1.jpg',
      'toggle',
      ORDER,
    );
    expect(paths(next)).toEqual(['/a/2.jpg']);
    expect(next.anchor).toBe('/a/1.jpg');

    // And a Shift-click after it still ranges from where the user last clicked,
    // which pulls the de-selected image back in.
    const ranged = resolveSelectionClick(next, '/a/3.jpg', 'range', ORDER);
    expect(paths(ranged)).toEqual(['/a/1.jpg', '/a/2.jpg', '/a/3.jpg']);
  });

  it('does not mutate the selection it was given', () => {
    const before = state(['/a/1.jpg'], '/a/1.jpg');
    resolveSelectionClick(before, '/a/2.jpg', 'toggle', ORDER);
    expect(paths(before)).toEqual(['/a/1.jpg']);
  });
});

describe('right click', () => {
  it('keeps the selection when it lands inside it', () => {
    const before = state(['/a/1.jpg', '/a/2.jpg'], '/a/1.jpg');
    const next = resolveSelectionClick(before, '/a/2.jpg', 'context', ORDER);
    expect(next).toBe(before);
  });

  it('selects just the clicked image when it lands outside', () => {
    const next = resolveSelectionClick(
      state(['/a/1.jpg', '/a/2.jpg'], '/a/1.jpg'),
      '/b/4.jpg',
      'context',
      ORDER,
    );
    expect(paths(next)).toEqual(['/b/4.jpg']);
    expect(next.anchor).toBe('/b/4.jpg');
  });
});

describe('reconciling against what is visible', () => {
  it('drops paths that are no longer on screen', () => {
    const next = reconcileSelection(state(['/a/1.jpg', '/gone/9.jpg'], '/a/1.jpg'), ORDER);
    expect(paths(next)).toEqual(['/a/1.jpg']);
    expect(next.anchor).toBe('/a/1.jpg');
  });

  it('clears an anchor that is no longer on screen', () => {
    const next = reconcileSelection(state(['/a/1.jpg'], '/gone/9.jpg'), ORDER);
    expect(next.anchor).toBeNull();
  });

  it('can empty the selection completely', () => {
    const next = reconcileSelection(state(['/gone/8.jpg', '/gone/9.jpg'], '/gone/8.jpg'), ORDER);
    expect(paths(next)).toEqual([]);
    expect(next.anchor).toBeNull();
  });

  it('returns the same state when nothing was dropped, so the render is skipped', () => {
    const before = state(['/a/1.jpg', '/b/4.jpg'], '/a/1.jpg');
    expect(reconcileSelection(before, ORDER)).toBe(before);
    expect(reconcileSelection(EMPTY_SELECTION, [])).toBe(EMPTY_SELECTION);
  });

  it('leaves a Shift-click after it with no range to draw', () => {
    // The whole point of reconciling: a filter has hidden the anchor, so the
    // next Shift-click cannot span from it and must not act on the images
    // between two paths the user can no longer both see.
    const reconciled = reconcileSelection(state(['/a/1.jpg'], '/a/1.jpg'), [
      '/b/4.jpg',
      '/b/5.jpg',
    ]);
    const next = resolveSelectionClick(reconciled, '/b/5.jpg', 'range', ['/b/4.jpg', '/b/5.jpg']);
    expect(paths(next)).toEqual(['/b/5.jpg']);
  });

  it('survives a sort flip, which reverses the order without hiding anything', () => {
    const before = state(['/a/1.jpg', '/b/5.jpg'], '/a/1.jpg');
    const reversed = [...ORDER].reverse();
    expect(reconcileSelection(before, reversed)).toBe(before);

    // The range now spans what lies between them in the NEW order.
    const next = resolveSelectionClick(before, '/b/5.jpg', 'range', reversed);
    expect(paths(next)).toEqual(['/a/1.jpg', '/a/2.jpg', '/a/3.jpg', '/b/4.jpg', '/b/5.jpg']);
  });
});

describe('what a batch action acts on', () => {
  const VISIBLE = new Set(ORDER);

  it('is the selection when there is one', () => {
    expect(
      selectionTargets(state(['/a/1.jpg', '/a/2.jpg'], '/a/1.jpg'), '/b/4.jpg', VISIBLE).sort(),
    ).toEqual(['/a/1.jpg', '/a/2.jpg']);
  });

  it('falls back to the focused image when the selection is empty', () => {
    // This is what keeps the 0-5 keys working after a Ctrl-click has toggled the
    // last selected image away, and it is the one-image case of "click, press 3".
    expect(selectionTargets(EMPTY_SELECTION, '/b/4.jpg', VISIBLE)).toEqual(['/b/4.jpg']);
  });

  it('is empty when there is nothing selected and nothing focused', () => {
    expect(selectionTargets(EMPTY_SELECTION, null, VISIBLE)).toEqual([]);
  });

  it('refuses to fall back to a focused image that is off screen', () => {
    // The case that matters: focus recovers lazily, so a filter that hides the
    // cursor leaves it named here for a while. An unconditional fallback would
    // let the next `3` — or the next Delete, which is permanent — act on a photo
    // the user cannot see.
    const hidden = new Set(['/a/1.jpg', '/a/2.jpg']);
    expect(selectionTargets(EMPTY_SELECTION, '/b/4.jpg', hidden)).toEqual([]);
  });

  it('still returns a selection whose members are all visible, unchanged', () => {
    // Belt to reconcileSelection's braces: the selection is reconciled eagerly,
    // so once it is non-empty it is trusted as-is and no second filter runs.
    const visible = new Set(['/a/1.jpg']);
    expect(selectionTargets(state(['/a/1.jpg'], '/a/1.jpg'), null, visible)).toEqual(['/a/1.jpg']);
  });
});
