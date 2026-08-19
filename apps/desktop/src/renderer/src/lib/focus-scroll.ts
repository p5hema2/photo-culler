/**
 * Keeping the focused image in view.
 *
 * Every view that shows a list of thumbnails owns its own scrolling: it knows
 * its axis, and — unlike `scrollIntoView` — it can move without dragging every
 * scrollable ancestor along with it. The geometry lives here, pure and DOM-free
 * where it can be, so the maths is testable without a layout engine.
 */

/**
 * Where a focus change came from, when a thumbnail itself caused it.
 *
 * Pointer-driven focus must not scroll: the cell is already under the cursor,
 * and moving it away is at best a fight with the user.
 */
export type FocusOrigin = 'click' | 'hover';

export interface CenterScrollInput {
  /** Item offset from the start of the scrollable content, in px. */
  itemStart: number;
  /** Item length along the scroll axis, in px. */
  itemSize: number;
  /** Visible length of the scroll container along the same axis (clientHeight/clientWidth). */
  viewportSize: number;
  /** Total scrollable length of the content (scrollHeight/scrollWidth). */
  contentSize: number;
}

/**
 * Scroll offset that puts an item in the middle of its scroll container.
 *
 * Clamped to the ends of the content: the first and last few items cannot be
 * centred without scrolling into empty space, so they sit off-centre instead —
 * the same compromise every filmstrip makes.
 */
export function centeredScrollOffset({
  itemStart,
  itemSize,
  viewportSize,
  contentSize,
}: CenterScrollInput): number {
  const centered = itemStart + itemSize / 2 - viewportSize / 2;
  const maxOffset = Math.max(0, contentSize - viewportSize);
  return Math.round(Math.min(Math.max(centered, 0), maxOffset));
}

// ─── Hover after a programmatic scroll ───────────────────────────────

/**
 * Chromium re-evaluates the hover target after any scroll and dispatches
 * mouseenter on whatever lands under a resting cursor. With select-on-hover on,
 * that reads as a selection, so one arrow key would advance two images: once by
 * the key, once by the thumbnail the centring scroll slid under the pointer.
 *
 * So a scroll we performed ourselves marks hover stale, and only real pointer
 * movement clears it. Movement is judged by position, not by a mousemove event
 * arriving: Blink can dispatch a *fake* one at unchanged coordinates after a
 * layout change, which is the very event this needs to ignore.
 */
let hoverStale = false;
let pointerX = NaN;
let pointerY = NaN;

if (typeof document !== 'undefined') {
  document.addEventListener(
    'mousemove',
    (event) => {
      if (event.clientX === pointerX && event.clientY === pointerY) return;
      pointerX = event.clientX;
      pointerY = event.clientY;
      hoverStale = false;
    },
    { capture: true, passive: true },
  );
}

/** Whether hover is currently a leftover of our own scrolling rather than intent. */
export function isHoverStale(): boolean {
  return hoverStale;
}

/**
 * Scroll a container along one axis, and note that anything now under the
 * pointer got there by scrolling rather than by the user pointing at it.
 *
 * A no-op when the container is already there — an assignment that moves
 * nothing must not make a genuine hover look stale.
 */
export function setScrollTop(container: HTMLElement, target: number): void {
  if (Math.round(container.scrollTop) === target) return;
  container.scrollTop = target;
  hoverStale = true;
}

export function setScrollLeft(container: HTMLElement, target: number): void {
  if (Math.round(container.scrollLeft) === target) return;
  container.scrollLeft = target;
  hoverStale = true;
}

/**
 * Scroll `container` so that `el` sits in its vertical middle.
 *
 * Assigns `scrollTop` rather than calling `scrollIntoView({ block: 'center' })`,
 * which walks every scrollable ancestor. Instant by construction, which matters:
 * Chromium's smooth scroll runs ~300-500ms and restarts on every call, so under
 * key repeat it chases a selection it never catches.
 */
export function centerElementVertically(container: HTMLElement, el: HTMLElement): void {
  const containerBox = container.getBoundingClientRect();
  const itemBox = el.getBoundingClientRect();
  setScrollTop(
    container,
    centeredScrollOffset({
      // Back out of viewport coordinates into the container's scroll space.
      // clientTop drops the border, which getBoundingClientRect counts in.
      itemStart: itemBox.top - containerBox.top - container.clientTop + container.scrollTop,
      itemSize: itemBox.height,
      viewportSize: container.clientHeight,
      contentSize: container.scrollHeight,
    }),
  );
}

/**
 * Scroll `container` so that `el` sits in its horizontal middle.
 *
 * The `scrollLeft` twin of {@link centerElementVertically}, for the loupe's
 * horizontal strip.
 */
export function centerElementHorizontally(container: HTMLElement, el: HTMLElement): void {
  const containerBox = container.getBoundingClientRect();
  const itemBox = el.getBoundingClientRect();
  setScrollLeft(
    container,
    centeredScrollOffset({
      itemStart: itemBox.left - containerBox.left - container.clientLeft + container.scrollLeft,
      itemSize: itemBox.width,
      viewportSize: container.clientWidth,
      contentSize: container.scrollWidth,
    }),
  );
}
