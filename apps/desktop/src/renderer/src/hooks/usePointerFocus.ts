import { useCallback, useRef } from 'react';
import type { FocusOrigin } from '../lib/focus-scroll';

export interface PointerFocus {
  /** Pass to a thumbnail list in place of the raw focus callback. */
  handleImageFocus: (path: string, origin: FocusOrigin) => void;
  /**
   * Whether the focus now on `path` was put there by the pointer — and clears
   * the mark either way.
   *
   * Consuming rather than only reading matters: clicking the already-focused
   * cell changes nothing, so no effect runs to clear the mark, and a stale one
   * would silence the scroll on the next arrow key.
   */
  consumePointerFocus: (path: string) => boolean;
}

/**
 * Tells a pointer-driven focus change from every other kind.
 *
 * Views that scroll the focused image into place need the distinction: a click
 * has already put the cell where the user is looking, and moving it then is at
 * best a fight with them.
 */
export function usePointerFocus(onImageFocus: (path: string) => void): PointerFocus {
  const lastRef = useRef<{ path: string; origin: FocusOrigin } | null>(null);

  const handleImageFocus = useCallback(
    (path: string, origin: FocusOrigin) => {
      lastRef.current = { path, origin };
      onImageFocus(path);
    },
    [onImageFocus],
  );

  const consumePointerFocus = useCallback((path: string) => {
    const last = lastRef.current;
    lastRef.current = null;
    return last?.path === path;
  }, []);

  return { handleImageFocus, consumePointerFocus };
}
