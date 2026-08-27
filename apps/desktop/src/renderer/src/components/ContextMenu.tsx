import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { RATING_VALUES } from '@photo-culler/image-utils/rating';

/**
 * The right-click menu.
 *
 * A renderer overlay rather than Electron's `Menu.popup`, because the renderer
 * is the only side that knows what a right click means here: the selection and
 * the rating to tick both live in this process, while `MENU_COMMANDS` is
 * deliberately payload-free — a native menu would need a new IPC channel
 * carrying a target and a mirror of the current rating. See CLAUDE.md.
 *
 * Everything the menu does acts on the selection, which the caller has already
 * settled: PhotoGrid dispatches a `'context'` click before opening us, so a
 * right click outside the selection has replaced it with the clicked image and
 * one inside it has left it alone.
 */

export type ContextMenuAction =
  | { kind: 'rate'; rating: number }
  | { kind: 'rotate'; direction: 'cw' | 'ccw' }
  | { kind: 'delete' };

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Placement {
  left: number;
  top: number;
}

/** How close to an edge the menu may sit before it is pushed back in. */
export const VIEWPORT_MARGIN = 8;

/** The menu's own width (Tailwind w-56), used as the submenu's pre-measurement guess. */
const MENU_WIDTH = 224;
/** Lines the submenu's first item up with the parent item rather than its border. */
const SUBMENU_TOP_PAD = 4;

/**
 * Where a flyout goes so that it stays on screen.
 *
 * Two anchors, not one: `preferred` is the start edge to use while there is
 * room, `flipped` is the *end* edge to hang it from when there is not. For the
 * root menu both are the pointer, so a menu near the right edge opens leftwards
 * from it. For a submenu they differ — it must flip to the far side of the
 * parent menu (`anchor.left`), not to `anchor.right - width`, which would land
 * it on top of the item that opened it.
 */
export function flyoutPlacement(
  preferred: Point,
  flipped: Point,
  menu: Size,
  viewport: Size,
  margin: number = VIEWPORT_MARGIN,
): Placement {
  return {
    left: fitAxis(preferred.x, flipped.x, menu.width, viewport.width, margin),
    top: fitAxis(preferred.y, flipped.y, menu.height, viewport.height, margin),
  };
}

function fitAxis(
  preferred: number,
  flipped: number,
  size: number,
  viewport: number,
  margin: number,
): number {
  let start = preferred;
  if (start + size > viewport - margin) start = flipped - size;
  // A flyout taller (or wider) than the viewport has a `max` below `margin`;
  // pinning it to the start edge at least keeps its first items reachable.
  const max = Math.max(margin, viewport - size - margin);
  return Math.max(margin, Math.min(start, max));
}

/**
 * The one rating the batch agrees on, or `'mixed'`.
 *
 * The menu ticks a value only where every target carries it — a tick on an
 * arbitrary member's rating would be a claim about the others.
 */
export function sharedRating(
  targets: readonly string[],
  ratings: Record<string, number>,
): number | 'mixed' {
  let shared: number | null = null;
  for (const path of targets) {
    const rating = ratings[path] ?? 0;
    if (shared === null) shared = rating;
    else if (shared !== rating) return 'mixed';
  }
  return shared ?? 0;
}

interface Entry {
  key: string;
  label: string;
  hint?: string;
  danger?: boolean;
  /** Rule above the item — the destructive one is set apart from the rest. */
  separator?: boolean;
  /** Opens the rating submenu instead of acting. */
  submenu?: boolean;
  action?: ContextMenuAction;
}

/** Index of the rating entry in `entries` below — the submenu hangs off it. */
const RATING_INDEX = 0;

function ratingLabel(value: number): string {
  if (value === 0) return 'No rating';
  return `${value} star${value === 1 ? '' : 's'}`;
}

interface ContextMenuProps {
  /** Viewport coordinates of the click that opened the menu. */
  x: number;
  y: number;
  /** How many images the menu acts on. */
  count: number;
  rating: number | 'mixed';
  onAction: (action: ContextMenuAction) => void;
  onClose: () => void;
}

export function ContextMenu({
  x,
  y,
  count,
  rating,
  onAction,
  onClose,
}: ContextMenuProps): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const subItemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [activeIndex, setActiveIndex] = useState(RATING_INDEX);
  /**
   * Submenu state: `null` closed, `{ focused: null }` opened by hover — the
   * pointer is the cursor there — and `{ focused: n }` opened by the keyboard.
   */
  const [submenu, setSubmenu] = useState<{ focused: number | null } | null>(null);
  const [position, setPosition] = useState<Placement>({ left: x, top: y });
  const [submenuPosition, setSubmenuPosition] = useState<Placement | null>(null);
  const submenuOpen = submenu !== null;

  const entries: Entry[] = [
    {
      key: 'rating',
      label: 'Rating',
      hint: rating === 'mixed' ? 'Mixed' : rating === 0 ? 'None' : '★'.repeat(rating),
      submenu: true,
    },
    {
      key: 'rotate-cw',
      label: 'Rotate clockwise',
      hint: 'Alt + →',
      action: { kind: 'rotate', direction: 'cw' },
    },
    {
      key: 'rotate-ccw',
      label: 'Rotate counter-clockwise',
      hint: 'Alt + ←',
      action: { kind: 'rotate', direction: 'ccw' },
    },
    {
      key: 'delete',
      label: `Delete ${count} image${count === 1 ? '' : 's'}`,
      hint: 'Del',
      danger: true,
      separator: true,
      action: { kind: 'delete' },
    },
  ];

  const openSubmenu = (): void => {
    // Land on the current value, so Enter twice is a no-op rather than a change.
    const current = rating === 'mixed' ? 0 : RATING_VALUES.findIndex((value) => value === rating);
    setActiveIndex(RATING_INDEX);
    setSubmenu({ focused: current < 0 ? 0 : current });
  };

  const closeSubmenu = (): void => {
    setSubmenu(null);
  };

  const activate = (entry: Entry): void => {
    if (entry.submenu) {
      openSubmenu();
      return;
    }
    if (entry.action) onAction(entry.action);
  };

  /**
   * Restore the caller's focus when the menu goes away.
   *
   * Declared before the effect that moves focus inside — effects run in order,
   * so this one reads the grid container while it is still the active element.
   * That container is the grid's single tab stop; leaving focus on a button that
   * is about to unmount would drop the whole app back to the body.
   *
   * Which is also the test for "may I take focus back": the menu's own button is
   * gone by the time this cleanup runs, so the active element is the body — and
   * anything else means someone else has claimed the cursor since. The grid
   * focuses itself on mouseenter, and the delete confirmation focuses its own
   * button; neither wants it pulled away again.
   */
  useEffect(() => {
    const previous = document.activeElement;
    return () => {
      if (document.activeElement !== document.body) return;
      if (previous instanceof HTMLElement) previous.focus({ preventScroll: true });
    };
  }, []);

  /**
   * Move real focus onto the active item, without scrolling.
   *
   * `preventScroll` is load-bearing: focus() may scroll an ancestor, and the
   * scroll listener below closes the menu — the menu would shut itself the
   * instant it opened.
   */
  useEffect(() => {
    if (submenu?.focused != null)
      subItemRefs.current[submenu.focused]?.focus({ preventScroll: true });
    else itemRefs.current[activeIndex]?.focus({ preventScroll: true });
  }, [activeIndex, submenu]);

  // Measure, then place. A layout effect, so the corrected position is in the
  // first painted frame rather than one after it.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pointer = { x, y };
    setPosition(
      flyoutPlacement(pointer, pointer, { width: rect.width, height: rect.height }, viewportSize()),
    );
  }, [x, y]);

  useLayoutEffect(() => {
    if (!submenuOpen) {
      setSubmenuPosition(null);
      return;
    }
    const parent = itemRefs.current[RATING_INDEX];
    const el = submenuRef.current;
    if (!parent || !el) return;
    const anchor = parent.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    setSubmenuPosition(
      flyoutPlacement(
        { x: anchor.right, y: anchor.top - SUBMENU_TOP_PAD },
        { x: anchor.left, y: anchor.bottom + SUBMENU_TOP_PAD },
        { width: rect.width, height: rect.height },
        viewportSize(),
      ),
    );
  }, [submenuOpen, position]);

  /**
   * Keys are handled on the *document*, in the capture phase, and not on the
   * menu element.
   *
   * The grid focuses itself on mouseenter, so the pointer crossing back over it
   * takes focus off the menu while the menu is still open — a handler bound to
   * the menu would stop hearing Escape. Capturing also stops the app's own
   * document-level handlers from seeing the keys we consume.
   */
  const handleKeyRef = useRef<(event: KeyboardEvent) => void>(() => {});
  handleKeyRef.current = (event: KeyboardEvent): void => {
    const inSubmenu = submenu?.focused != null;
    const stop = (): void => {
      event.preventDefault();
      event.stopPropagation();
    };
    /** Move the cursor to a root item, taking any hover-opened submenu with it. */
    const goTo = (index: number): void => {
      setActiveIndex(index);
      if (index !== RATING_INDEX) closeSubmenu();
    };
    const step = (delta: number): void => {
      stop();
      if (inSubmenu) {
        const from = submenu?.focused ?? 0;
        setSubmenu({ focused: wrap(from + delta, RATING_VALUES.length) });
      } else {
        goTo(wrap(activeIndex + delta, entries.length));
      }
    };
    const jump = (index: number): void => {
      stop();
      if (inSubmenu) setSubmenu({ focused: index < 0 ? RATING_VALUES.length - 1 : index });
      else goTo(index < 0 ? entries.length - 1 : index);
    };

    switch (event.key) {
      case 'Escape':
        stop();
        if (submenuOpen) closeSubmenu();
        else onClose();
        break;
      case 'ArrowDown':
        step(1);
        break;
      case 'ArrowUp':
        step(-1);
        break;
      // Tab moves within the menu rather than out of it: the app has exactly one
      // tab stop, and tabbing away from a menu that is still open would leave
      // the keyboard nowhere useful.
      case 'Tab':
        step(event.shiftKey ? -1 : 1);
        break;
      case 'Home':
        jump(0);
        break;
      case 'End':
        jump(-1);
        break;
      case 'ArrowRight':
        if (!inSubmenu && entries[activeIndex]?.submenu) {
          stop();
          openSubmenu();
        }
        break;
      case 'ArrowLeft':
        if (submenuOpen) {
          stop();
          closeSubmenu();
        }
        break;
      case 'Enter':
      case ' ':
        // Activated from state, not from whichever button happens to hold DOM
        // focus — see the comment above this handler.
        stop();
        if (inSubmenu) {
          const value = RATING_VALUES[submenu?.focused ?? 0];
          if (value != null) onAction({ kind: 'rate', rating: value });
        } else {
          const entry = entries[activeIndex];
          if (entry) activate(entry);
        }
        break;
    }
  };

  useEffect(() => {
    const listener = (event: KeyboardEvent): void => handleKeyRef.current(event);
    document.addEventListener('keydown', listener, true);
    return () => document.removeEventListener('keydown', listener, true);
  }, []);

  useEffect(() => {
    const handleDown = (event: MouseEvent): void => {
      const target = event.target;
      if (!(target instanceof Node) || !menuRef.current?.contains(target)) onClose();
    };
    // Capture on scroll: the grid is the scroller, and scroll does not bubble.
    // Anything that moves the content out from under the menu closes it rather
    // than leaving it pointing at a different photo.
    const close = (): void => onClose();
    document.addEventListener('mousedown', handleDown);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', handleDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 w-56 py-1 bg-gray-800 border border-gray-600 rounded-lg shadow-xl text-xs text-gray-200 select-none"
      style={{ left: position.left, top: position.top }}
      role="menu"
      aria-label="Image actions"
      data-testid="context-menu"
      onContextMenu={(e) => e.preventDefault()}
    >
      {count > 1 && (
        <div
          className="px-3 py-1 text-[10px] uppercase tracking-wider text-gray-500"
          data-testid="context-menu-count"
        >
          {count} images selected
        </div>
      )}

      {entries.map((entry, index) => (
        <Fragment key={entry.key}>
          {entry.separator && <div role="separator" className="my-1 border-t border-gray-700" />}
          <button
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            type="button"
            role="menuitem"
            tabIndex={-1}
            aria-haspopup={entry.submenu ? 'menu' : undefined}
            aria-expanded={entry.submenu ? submenuOpen : undefined}
            data-testid={`context-menu-${entry.key}`}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-left focus:outline-none ${
              entry.danger ? 'text-red-300' : ''
            } ${activeIndex === index ? (entry.danger ? 'bg-red-900/40' : 'bg-gray-700') : ''}`}
            onMouseEnter={() => {
              setActiveIndex(index);
              if (entry.submenu) setSubmenu({ focused: null });
              else closeSubmenu();
            }}
            onClick={() => activate(entry)}
          >
            <span className="flex-1 truncate">{entry.label}</span>
            {entry.hint && (
              <span className="text-[10px] text-gray-500 font-mono whitespace-nowrap">
                {entry.hint}
              </span>
            )}
            {entry.submenu && <span className="text-gray-500">{'▸'}</span>}
          </button>
        </Fragment>
      ))}

      {submenuOpen && (
        <div
          ref={submenuRef}
          className="fixed w-40 py-1 bg-gray-800 border border-gray-600 rounded-lg shadow-xl"
          style={submenuPosition ?? { left: position.left + MENU_WIDTH, top: position.top }}
          role="menu"
          aria-label="Rating"
          data-testid="context-menu-rating-submenu"
        >
          {RATING_VALUES.map((value, index) => (
            <button
              key={value}
              ref={(el) => {
                subItemRefs.current[index] = el;
              }}
              type="button"
              role="menuitemradio"
              tabIndex={-1}
              aria-checked={rating === value}
              data-testid={`context-menu-rate-${value}`}
              className={`w-full flex items-center gap-2 px-2 py-1.5 text-left focus:outline-none ${
                submenu?.focused === index ? 'bg-gray-700' : ''
              }`}
              onMouseEnter={() => setSubmenu({ focused: index })}
              onClick={() => onAction({ kind: 'rate', rating: value })}
            >
              <span className="w-3 text-amber-400">{rating === value ? '✓' : ''}</span>
              <span className="flex-1">{ratingLabel(value)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function viewportSize(): Size {
  return { width: window.innerWidth, height: window.innerHeight };
}

function wrap(index: number, length: number): number {
  return ((index % length) + length) % length;
}
