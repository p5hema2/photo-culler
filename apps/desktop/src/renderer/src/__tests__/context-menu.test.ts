import { describe, it, expect, vi, afterEach, type Mock } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { createElement } from 'react';
import {
  ContextMenu,
  flyoutPlacement,
  revealLabel,
  revealTarget,
  sharedRating,
  VIEWPORT_MARGIN,
} from '../components/ContextMenu';
import type { ContextMenuAction, Placement } from '../components/ContextMenu';
import { resolveSelectionClick, selectionTargets } from '../lib/selection';
import { SHORTCUTS } from '../hooks/useKeyboardNav';

const VIEWPORT = { width: 1000, height: 800 };
const MENU = { width: 224, height: 160 };

/** The root menu opens from the pointer in both directions. */
function atPointer(x: number, y: number, menu = MENU): Placement {
  return flyoutPlacement({ x, y }, { x, y }, menu, VIEWPORT);
}

describe('flyoutPlacement, root menu', () => {
  it('opens down and right of the pointer when there is room', () => {
    expect(atPointer(300, 200)).toEqual({ left: 300, top: 200 });
  });

  it('flips left of the pointer near the right edge', () => {
    // 900 + 224 would overflow, so the menu hangs from the pointer instead.
    expect(atPointer(900, 200)).toEqual({ left: 900 - MENU.width, top: 200 });
  });

  it('flips above the pointer near the bottom edge', () => {
    expect(atPointer(300, 700)).toEqual({ left: 300, top: 700 - MENU.height });
  });

  it('flips on both axes in the bottom-right corner, then keeps the margin', () => {
    // The vertical flip alone would put the bottom edge 3px past the margin —
    // the pointer is only 5px off the floor — so the clamp finishes the job.
    expect(atPointer(990, 795)).toEqual({
      left: 990 - MENU.width,
      top: VIEWPORT.height - MENU.height - VIEWPORT_MARGIN,
    });
  });

  it('keeps the margin when a flip would push it off the near edge', () => {
    // In a 300px-wide window the flipped left is -124. Clamping to the margin is
    // what stops the menu from being unreachable rather than merely awkward.
    const placement = flyoutPlacement({ x: 100, y: 20 }, { x: 100, y: 20 }, MENU, {
      width: 300,
      height: 800,
    });
    expect(placement).toEqual({ left: VIEWPORT_MARGIN, top: 20 });
  });

  it('pins a menu larger than the viewport to the start edge', () => {
    const placement = flyoutPlacement(
      { x: 500, y: 400 },
      { x: 500, y: 400 },
      { width: 2000, height: 2000 },
      VIEWPORT,
    );
    expect(placement).toEqual({ left: VIEWPORT_MARGIN, top: VIEWPORT_MARGIN });
  });
});

describe('flyoutPlacement, submenu', () => {
  const submenu = { width: 160, height: 200 };
  /** The parent item's box, which the submenu hangs off. */
  const item = { left: 300, right: 524, top: 300, bottom: 320 };

  it('opens off the right edge of the parent item when there is room', () => {
    const placement = flyoutPlacement(
      { x: item.right, y: item.top - 4 },
      { x: item.left, y: item.bottom + 4 },
      submenu,
      VIEWPORT,
    );
    expect(placement).toEqual({ left: item.right, top: item.top - 4 });
  });

  it('flips to the far side of the parent menu, not to right - width', () => {
    // The distinction the two anchors exist for: right - width would land the
    // submenu on top of the item that opened it.
    const tight = { left: 800, right: 960, top: 300, bottom: 320 };
    const placement = flyoutPlacement(
      { x: tight.right, y: tight.top - 4 },
      { x: tight.left, y: tight.bottom + 4 },
      submenu,
      VIEWPORT,
    );
    expect(placement.left).toBe(tight.left - submenu.width);
    expect(placement.left).not.toBe(tight.right - submenu.width);
  });

  it('hangs upwards from the bottom edge of the item near the viewport floor', () => {
    const low = { left: 300, right: 524, top: 700, bottom: 720 };
    const placement = flyoutPlacement(
      { x: low.right, y: low.top - 4 },
      { x: low.left, y: low.bottom + 4 },
      submenu,
      VIEWPORT,
    );
    expect(placement.top).toBe(low.bottom + 4 - submenu.height);
  });
});

describe('sharedRating', () => {
  const ratings = { '/a/1.jpg': 3, '/a/2.jpg': 3, '/a/3.jpg': 5 };

  it('reports the value the whole batch carries', () => {
    expect(sharedRating(['/a/1.jpg', '/a/2.jpg'], ratings)).toBe(3);
  });

  it('reports mixed as soon as two targets disagree', () => {
    expect(sharedRating(['/a/1.jpg', '/a/3.jpg'], ratings)).toBe('mixed');
  });

  it('treats an image with no entry as unrated rather than unknown', () => {
    // 0 and "unrated" are the same thing in this app, so an untouched image
    // agrees with an explicit 0 instead of reading as a second value.
    expect(sharedRating(['/a/9.jpg'], ratings)).toBe(0);
    expect(sharedRating(['/a/9.jpg', '/a/1.jpg'], ratings)).toBe('mixed');
  });

  it('falls back to unrated for an empty batch', () => {
    expect(sharedRating([], ratings)).toBe(0);
  });
});

describe('the menu itself', () => {
  let onAction: Mock<(action: ContextMenuAction) => void>;
  let onClose: Mock<() => void>;

  afterEach(() => {
    cleanup();
  });

  function renderMenu(count = 3, rating: number | 'mixed' = 2, canReveal = true) {
    onAction = vi.fn<(action: ContextMenuAction) => void>();
    onClose = vi.fn<() => void>();
    return render(
      createElement(ContextMenu, { x: 40, y: 60, count, rating, canReveal, onAction, onClose }),
    );
  }

  it('names the count on the destructive item and in the header', () => {
    const { getByTestId } = renderMenu(3);
    expect(getByTestId('context-menu-delete').textContent).toContain('Delete 3 images');
    expect(getByTestId('context-menu-count').textContent).toContain('3 images selected');
  });

  it('leaves the header off for a single image', () => {
    const { queryByTestId, getByTestId } = renderMenu(1);
    expect(queryByTestId('context-menu-count')).toBeNull();
    expect(getByTestId('context-menu-delete').textContent).toContain('Delete 1 image');
  });

  it('ticks the rating the batch shares', () => {
    const { getByTestId } = renderMenu(3, 2);
    fireEvent.click(getByTestId('context-menu-rating'));
    expect(getByTestId('context-menu-rate-2').getAttribute('aria-checked')).toBe('true');
    expect(getByTestId('context-menu-rate-3').getAttribute('aria-checked')).toBe('false');
  });

  it('ticks nothing when the batch disagrees', () => {
    const { getByTestId, getAllByRole } = renderMenu(3, 'mixed');
    expect(getByTestId('context-menu-rating').textContent).toContain('Mixed');
    fireEvent.click(getByTestId('context-menu-rating'));
    const checked = getAllByRole('menuitemradio').filter(
      (item) => item.getAttribute('aria-checked') === 'true',
    );
    expect(checked).toHaveLength(0);
  });

  it('rates the batch from the submenu', () => {
    const { getByTestId } = renderMenu();
    fireEvent.click(getByTestId('context-menu-rating'));
    fireEvent.click(getByTestId('context-menu-rate-4'));
    expect(onAction).toHaveBeenCalledWith({ kind: 'rate', rating: 4 });
  });

  it('reports rotate and delete', () => {
    const { getByTestId } = renderMenu();
    fireEvent.click(getByTestId('context-menu-rotate-ccw'));
    expect(onAction).toHaveBeenCalledWith({ kind: 'rotate', direction: 'ccw' });
    fireEvent.click(getByTestId('context-menu-delete'));
    expect(onAction).toHaveBeenCalledWith({ kind: 'delete' });
  });

  it('walks the items with the arrow keys and acts on Enter', () => {
    renderMenu();
    // From Rating past both Rotate items and Reveal to Delete, which is last.
    for (let i = 0; i < 4; i++) fireEvent.keyDown(document, { key: 'ArrowDown' });
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onAction).toHaveBeenCalledWith({ kind: 'delete' });
  });

  it('prints the shortcut of every item that has one', () => {
    // Read out of SHORTCUTS rather than compared against literals: the point of
    // the table is that the menu cannot say something the hook does not bind.
    const { getByTestId } = renderMenu();
    expect(getByTestId('context-menu-rotate-cw-shortcut').textContent).toBe(
      SHORTCUTS.rotate.cw.label,
    );
    expect(getByTestId('context-menu-rotate-ccw-shortcut').textContent).toBe(
      SHORTCUTS.rotate.ccw.label,
    );
    expect(getByTestId('context-menu-delete-shortcut').textContent).toBe(SHORTCUTS.delete.label);
  });

  it('prints the digit beside each rating in the submenu', () => {
    const { getByTestId } = renderMenu();
    fireEvent.click(getByTestId('context-menu-rating'));
    for (const { value, key } of SHORTCUTS.rating) {
      expect(getByTestId(`context-menu-rate-${value}-shortcut`).textContent).toBe(key);
    }
  });

  it('leaves the shortcut column empty where there is no binding', () => {
    // Reveal has no key, and a label invented for it would be a lie.
    const { queryByTestId, getByTestId } = renderMenu();
    expect(getByTestId('context-menu-reveal')).toBeTruthy();
    expect(queryByTestId('context-menu-reveal-shortcut')).toBeNull();
  });

  it('reports reveal, and offers it only when there is a cursor to reveal', () => {
    const withCursor = renderMenu(3, 2, true);
    fireEvent.click(withCursor.getByTestId('context-menu-reveal'));
    expect(onAction).toHaveBeenCalledWith({ kind: 'reveal' });
    cleanup();
    // An off-screen cursor: the item goes rather than doing nothing when clicked.
    const withoutCursor = renderMenu(3, 2, false);
    expect(withoutCursor.queryByTestId('context-menu-reveal')).toBeNull();
    expect(withoutCursor.getByTestId('context-menu-delete')).toBeTruthy();
  });

  it('names the file manager the platform actually has', () => {
    expect(revealLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toContain('Finder');
    expect(revealLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toContain('Explorer');
    expect(revealLabel('Mozilla/5.0 (X11; Linux x86_64)')).toBe('Reveal in file manager');
  });

  it('opens the submenu on the current value with ArrowRight', () => {
    const { getByTestId } = renderMenu(3, 5);
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(getByTestId('context-menu-rating-submenu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onAction).toHaveBeenCalledWith({ kind: 'rate', rating: 5 });
  });

  it('closes the submenu on Escape before the menu itself', () => {
    const { getByTestId, queryByTestId } = renderMenu();
    fireEvent.click(getByTestId('context-menu-rating'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(queryByTestId('context-menu-rating-submenu')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on a click outside, but not on one inside', () => {
    const { getByTestId } = renderMenu();
    fireEvent.mouseDown(getByTestId('context-menu-rotate-cw'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on scroll, because the content moves out from under it', () => {
    renderMenu();
    fireEvent.scroll(window);
    expect(onClose).toHaveBeenCalled();
  });
});

/**
 * The rule the menu relies on rather than implements: PhotoGrid dispatches a
 * `'context'` click before opening the menu, so by the time it renders the
 * selection is already what the menu should act on.
 */
describe('right click and the selection', () => {
  const order = ['/a/1.jpg', '/a/2.jpg', '/a/3.jpg', '/b/4.jpg'];

  it('selects just the clicked image when it was outside the selection', () => {
    const state = { selection: new Set(['/a/1.jpg', '/a/2.jpg']), anchor: '/a/1.jpg' };
    const next = resolveSelectionClick(state, '/b/4.jpg', 'context', order);
    expect([...next.selection]).toEqual(['/b/4.jpg']);
    expect(next.anchor).toBe('/b/4.jpg');
  });

  it('leaves a multi-image selection alone when the click landed inside it', () => {
    const state = { selection: new Set(['/a/1.jpg', '/a/2.jpg']), anchor: '/a/1.jpg' };
    const next = resolveSelectionClick(state, '/a/2.jpg', 'context', order);
    expect(next).toBe(state);
  });

  it('selects the clicked image when nothing was selected at all', () => {
    const next = resolveSelectionClick(
      { selection: new Set<string>(), anchor: null },
      '/a/3.jpg',
      'context',
      order,
    );
    expect([...next.selection]).toEqual(['/a/3.jpg']);
  });
});

/**
 * Reveal is the one item that does NOT spend the batch: the platform call takes
 * a single path, so it acts on the cursor — and only while the cursor is on
 * screen, which is the same rule the batch follows.
 */
describe('what reveal acts on', () => {
  const visible = ['/a/1.jpg', '/a/2.jpg', '/a/3.jpg'];
  const batch = { selection: new Set(['/a/1.jpg', '/a/2.jpg', '/a/3.jpg']), anchor: '/a/1.jpg' };

  it('names the focused image, not the selection', () => {
    expect(selectionTargets(batch, '/a/2.jpg', new Set(visible))).toHaveLength(3);
    expect(revealTarget('/a/2.jpg', visible)).toBe('/a/2.jpg');
  });

  it('names nothing while the cursor is off screen', () => {
    // Focus recovers lazily, so it can still point at an image a filter or a
    // collapsed folder has hidden. Revealing it would open a folder the user is
    // not looking at.
    expect(revealTarget('/a/9.jpg', visible)).toBeNull();
    expect(revealTarget(null, visible)).toBeNull();
  });
});
