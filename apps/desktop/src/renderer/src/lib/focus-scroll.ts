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
 * and moving it away is at best a fight with the user. Since select-on-hover
 * went, a click is the only way a thumbnail can move the focus — hence the
 * single member. Named rather than inlined because the thumbnail views read
 * better saying what moved the focus than passing a bare flag.
 */
export type FocusOrigin = 'click';

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

/**
 * Scroll a container along one axis.
 *
 * A no-op when the container is already there, so a redundant re-centre costs
 * no scroll event.
 */
export function setScrollTop(container: HTMLElement, target: number): void {
  if (Math.round(container.scrollTop) === target) return;
  container.scrollTop = target;
}

export function setScrollLeft(container: HTMLElement, target: number): void {
  if (Math.round(container.scrollLeft) === target) return;
  container.scrollLeft = target;
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
