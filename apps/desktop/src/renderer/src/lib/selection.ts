/**
 * The selection model: which images a batch action acts on.
 *
 * Selection is not focus. Focus is the single cursor that drives the loupe, the
 * InfoPanel, the exiftool detail read and the centring scroll; the selection is
 * the batch that rating and deletion act on. Keeping them apart is what lets
 * "rate these twelve" and "show me this one" be the same gesture set.
 *
 * The interesting part is pure and lives here, DOM-free and React-free, because
 * every awkward case is a data case: a Shift-click with no anchor, an anchor a
 * filter has since hidden, a Ctrl-click that removes the anchor itself, a range
 * dragged backwards.
 */

/**
 * What a click means for the selection.
 *
 * - `plain` — replace the selection with the clicked image.
 * - `range` — Shift: the contiguous span from the anchor to the clicked image.
 * - `toggle` — Ctrl/Cmd: add or remove the clicked image, leaving the rest.
 * - `context` — right click: keep the selection if the click landed inside it,
 *   otherwise select just the clicked image.
 */
export type SelectionClickModifier = 'plain' | 'range' | 'toggle' | 'context';

export interface SelectionState {
  /**
   * The selected absolute paths.
   *
   * A Set rather than an array: the grid asks "is this cell selected?" once per
   * visible cell, and it is always replaced wholesale rather than mutated, so
   * its identity is still a usable memo key.
   */
  readonly selection: ReadonlySet<string>;
  /** Where a Shift-click ranges from, or null when there is nothing to range from. */
  readonly anchor: string | null;
}

/** Nothing selected. Shared, so a reset does not allocate. */
export const EMPTY_SELECTION: SelectionState = { selection: new Set<string>(), anchor: null };

interface ModifierKeys {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

/**
 * Read a click's modifiers.
 *
 * Shift wins over Ctrl/Cmd when both are held: extending a range is the more
 * specific intent, and "toggle a range" is not a thing this app offers.
 */
export function clickModifier(event: ModifierKeys): SelectionClickModifier {
  if (event.shiftKey) return 'range';
  if (event.ctrlKey || event.metaKey) return 'toggle';
  return 'plain';
}

/**
 * The selection a click produces.
 *
 * `visibleOrder` is the flat order the grid renders — folder sections and
 * timestamp groups already flattened, collapsed folders already gone. A range
 * is defined over that and nothing else: any other order would select images
 * the user cannot see between the two they clicked.
 */
export function resolveSelectionClick(
  state: SelectionState,
  path: string,
  modifier: SelectionClickModifier,
  visibleOrder: readonly string[],
): SelectionState {
  const justThis: SelectionState = { selection: new Set([path]), anchor: path };

  switch (modifier) {
    case 'plain':
      return justThis;

    case 'context':
      return state.selection.has(path) ? state : justThis;

    case 'toggle': {
      const next = new Set(state.selection);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      // The anchor follows the pointer whether the click added or removed the
      // image — including when it removed the anchor itself. A later Shift-click
      // then ranges from where the user last clicked, which is the only place
      // they have any reason to expect it to start.
      return { selection: next, anchor: path };
    }

    case 'range': {
      const from = state.anchor === null ? -1 : visibleOrder.indexOf(state.anchor);
      const to = visibleOrder.indexOf(path);
      // No anchor, or an anchor that a filter, a search or a collapsed folder
      // has taken off screen: there is no span to speak of, so the click lands
      // as a plain one and plants a new anchor.
      if (from === -1 || to === -1) return justThis;
      const [start, end] = from <= to ? [from, to] : [to, from];
      // The anchor stays where it was, so dragging the range up and then back
      // down pivots on the same image instead of collapsing onto the last click.
      return { selection: new Set(visibleOrder.slice(start, end + 1)), anchor: state.anchor };
    }
  }
}

/**
 * Drop everything the user can no longer see.
 *
 * Called on every event that can hide or remove an image — filter, search, sort
 * direction, folder collapse, rescan, open, delete. Focus gets away with lazy
 * recovery on the next keypress; a Set does not, because a stale path in it
 * would let the next `3` or `Delete` act on something invisible or gone.
 *
 * Returns the state it was given when nothing was dropped, so the caller can
 * skip the render.
 */
export function reconcileSelection(
  state: SelectionState,
  visiblePaths: readonly string[],
): SelectionState {
  if (state.selection.size === 0 && state.anchor === null) return state;

  const visible = new Set(visiblePaths);
  const next = new Set<string>();
  let dropped = false;
  for (const path of state.selection) {
    if (visible.has(path)) next.add(path);
    else dropped = true;
  }
  const anchor = state.anchor !== null && visible.has(state.anchor) ? state.anchor : null;

  if (!dropped && anchor === state.anchor) return state;
  return { selection: next, anchor };
}

/**
 * What a batch action should act on.
 *
 * An empty selection falls back to the focused image — that is what makes
 * "click one photo, press 3" the one-image case of the same code path, and what
 * keeps the 0-5 keys working after a Ctrl-click has toggled the last selected
 * image away.
 *
 * The fallback is conditional on the cursor being ON SCREEN, and that condition
 * is the whole point of the parameter. Focus recovers *lazily*: it stays on an
 * image that a filter, a search or a collapsed folder has hidden until the next
 * arrow key moves it somewhere visible. The selection is reconciled eagerly, so
 * in that window the selection is empty and `focusedPath` names a photo the user
 * cannot see — and an unconditional fallback would let the `3` or the `Delete`
 * that arrives next rate or PERMANENTLY delete exactly that photo.
 */
export function selectionTargets(
  state: SelectionState,
  focusedPath: string | null,
  visiblePaths: ReadonlySet<string>,
): string[] {
  if (state.selection.size > 0) return [...state.selection];
  if (focusedPath === null || !visiblePaths.has(focusedPath)) return [];
  return [focusedPath];
}
