import { useCallback, useRef, useEffect } from 'react';
import type { PhotoGroup } from '@photo-culler/image-utils/grouping';
import type { ImageFileInfo } from '@photo-culler/types';
import { RATING_VALUES } from '@photo-culler/image-utils/rating';

const THUMBNAIL_SIZE_MAP: Record<string, number> = {
  small: 120,
  medium: 200,
  large: 300,
};

type ViewLayout = 'default' | 'loupe' | 'filmstrip';

interface KeyboardNavOptions {
  groups: PhotoGroup[];
  focusedImageId: string | null;
  onFocusChange: (path: string | null) => void;
  /**
   * Set one image's star rating, 0-5, where 0 clears it. Called once per image
   * in `selectedPaths`.
   * Takes the image's ABSOLUTE PATH — renderer state is keyed by path.
   */
  onRate: (imagePath: string, rating: number) => void;
  /**
   * The batch the 0-5 keys and Alt+Arrow act on, in place of the focused image
   * alone. Must already be reconciled against what is visible — the hook does
   * not own the selection, it only spends it.
   *
   * Optional, and empty means "just the cursor", so a caller with no selection
   * concept still gets the single-image behaviour.
   */
  selectedPaths?: readonly string[];
  containerRef: React.RefObject<HTMLElement | null>;
  /**
   * Ask to delete what is currently selected. The caller decides what that is
   * and confirms first.
   */
  onDeleteFocused: () => void;
  /**
   * Rotate one image. Called once per image in `selectedPaths`.
   * Takes the image's ABSOLUTE PATH — renderer state is keyed by path.
   */
  onRotate: (imagePath: string, direction: 'cw' | 'ccw') => void;
  sortedFlatImages: ImageFileInfo[];
  thumbnailSize: 'small' | 'medium' | 'large';
  viewLayout: ViewLayout;
  /**
   * True while a dialog is up. This hook listens on the document, so without
   * the gate a Delete meant for nothing in particular still reaches the photo
   * behind the Execute panel.
   */
  modalOpen: boolean;
}

interface KeyboardNavResult {
  handleKeyDown: (e: KeyboardEvent) => void;
}

/**
 * Find which group and position an image is in.
 */
/** True while the user is typing into a field, where keys are not ours. */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  const tag = el?.tagName?.toLowerCase();
  return (
    tag === 'input' || tag === 'textarea' || tag === 'select' || el?.isContentEditable === true
  );
}

/**
 * Keys the grid handles that the browser would otherwise use to scroll.
 * Space is included: unhandled, it pages the scroll container.
 */
const GRID_NAV_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  ' ',
]);

/** '0'-'5': the digit is the rating, and '0' clears it. */
const RATING_KEYS = new Map(RATING_VALUES.map((value) => [String(value), value]));

function findImagePosition(
  groups: PhotoGroup[],
  imagePath: string,
): { groupIndex: number; imageIndex: number } | null {
  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi]!;
    for (let ii = 0; ii < group.images.length; ii++) {
      if (group.images[ii]!.path === imagePath) {
        return { groupIndex: gi, imageIndex: ii };
      }
    }
  }
  return null;
}

export function useKeyboardNav({
  groups,
  focusedImageId,
  onFocusChange,
  onRate,
  selectedPaths,
  containerRef,
  onDeleteFocused,
  onRotate,
  sortedFlatImages,
  thumbnailSize,
  viewLayout,
  modalOpen,
}: KeyboardNavOptions): KeyboardNavResult {
  const groupsRef = useRef(groups);
  const focusRef = useRef(focusedImageId);
  const flatImagesRef = useRef(sortedFlatImages);
  const selectedPathsRef = useRef<readonly string[]>(selectedPaths ?? []);
  const thumbnailSizeRef = useRef(thumbnailSize);
  const viewLayoutRef = useRef(viewLayout);
  const modalOpenRef = useRef(modalOpen);
  groupsRef.current = groups;
  focusRef.current = focusedImageId;
  flatImagesRef.current = sortedFlatImages;
  selectedPathsRef.current = selectedPaths ?? [];
  thumbnailSizeRef.current = thumbnailSize;
  viewLayoutRef.current = viewLayout;
  modalOpenRef.current = modalOpen;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // This handler owns bare keys and Alt+Arrow only. Ctrl/Cmd chords belong
      // to the native menu — without this guard, KeyboardEvent.key for Ctrl+1
      // is still '1', so the menu's "Layout > Grid" accelerator would also
      // rate the focused photo one star.
      if (e.ctrlKey || e.metaKey) return;

      // A dialog is up: the grid behind it is not what the user is typing at.
      if (modalOpenRef.current) return;

      // Listening on the document means text fields would otherwise navigate
      // the grid while the user types in them.
      if (isTypingTarget(e.target)) return;

      const currentGroups = groupsRef.current;
      if (currentGroups.length === 0) return;

      const focused = focusRef.current;
      const flatImages = flatImagesRef.current;
      const layout = viewLayoutRef.current;

      // If nothing focused, focus the first image on any nav key
      if (!focused) {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
          e.preventDefault();
          const first = currentGroups[0]?.images[0];
          if (first) onFocusChange(first.path);
        }
        return;
      }

      /**
       * What a batch key acts on: the selection, or the cursor alone when there
       * is nothing selected — and then only if the cursor is on screen.
       *
       * `cursorVisible` is the caller's own answer to that, because the two
       * layouts locate the cursor differently. Without it a rating or a rotation
       * could land on an image a filter has hidden: the selection is reconciled
       * against the visible list the moment it changes, but focus recovers only
       * on the next arrow key. See lib/selection.ts.
       */
      const batchTargets = (cursorVisible: boolean): readonly string[] => {
        const selected = selectedPathsRef.current;
        if (selected.length > 0) return selected;
        return cursorVisible ? [focused] : [];
      };

      // Loupe & filmstrip: all arrows navigate linearly through flat image list
      if (layout === 'loupe' || layout === 'filmstrip') {
        const flatIndex = flatImages.findIndex((img) => img.path === focused);

        // Alt+Arrow: rotate
        if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
          e.preventDefault();
          const direction = e.key === 'ArrowRight' ? 'cw' : 'ccw';
          for (const path of batchTargets(flatIndex !== -1)) onRotate(path, direction);
          return;
        }

        switch (e.key) {
          case 'ArrowRight':
          case 'ArrowDown': {
            e.preventDefault();
            if (flatIndex < flatImages.length - 1) {
              onFocusChange(flatImages[flatIndex + 1]!.path);
            }
            return;
          }
          case 'ArrowLeft':
          case 'ArrowUp': {
            e.preventDefault();
            if (flatIndex > 0) {
              onFocusChange(flatImages[flatIndex - 1]!.path);
            }
            return;
          }
        }
      }

      // Alt+Arrow Left/Right: rotate the whole selection
      if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        const direction = e.key === 'ArrowRight' ? 'cw' : 'ccw';
        const onScreen = findImagePosition(currentGroups, focused) !== null;
        for (const path of batchTargets(onScreen)) onRotate(path, direction);
        return;
      }

      const pos = findImagePosition(currentGroups, focused);

      // Rating keys act on the whole selection, and so are handled before the
      // off-screen-cursor recovery below: a selection is reconciled against
      // what is visible, so it stays rateable even in the moment where the
      // cursor is not — a filter change can leave the two out of step.
      const rating = RATING_KEYS.get(e.key);
      if (rating !== undefined) {
        const targets = batchTargets(pos !== null);
        // Nothing to rate: no selection, and a cursor that is not on screen.
        // Leave the key to whatever else wants it rather than swallowing it.
        if (targets.length === 0) return;
        e.preventDefault();
        for (const path of targets) onRate(path, rating);
        return;
      }

      if (!pos) {
        // The focused image is not on screen: its folder was collapsed, a
        // filter excluded it, or it was just deleted. Bailing out here used to
        // leave the browser to handle the key, which scrolled the gallery —
        // that is what "the arrow keys sometimes stop working" looked like.
        // Recover onto the first visible image instead, and swallow the key so
        // scrolling never stands in for navigation.
        if (GRID_NAV_KEYS.has(e.key)) {
          e.preventDefault();
          const first = currentGroups[0]?.images[0];
          if (first) onFocusChange(first.path);
        }
        return;
      }

      const { groupIndex, imageIndex } = pos;
      const currentGroup = currentGroups[groupIndex]!;

      switch (e.key) {
        case 'ArrowRight': {
          e.preventDefault();
          if (imageIndex < currentGroup.images.length - 1) {
            onFocusChange(currentGroup.images[imageIndex + 1]!.path);
          } else if (groupIndex < currentGroups.length - 1) {
            const nextGroup = currentGroups[groupIndex + 1]!;
            onFocusChange(nextGroup.images[0]!.path);
          }
          break;
        }

        case 'ArrowLeft': {
          e.preventDefault();
          if (imageIndex > 0) {
            onFocusChange(currentGroup.images[imageIndex - 1]!.path);
          } else if (groupIndex > 0) {
            const prevGroup = currentGroups[groupIndex - 1]!;
            onFocusChange(prevGroup.images[prevGroup.images.length - 1]!.path);
          }
          break;
        }

        case 'ArrowDown': {
          e.preventDefault();
          const cellSize = THUMBNAIL_SIZE_MAP[thumbnailSizeRef.current] ?? 200;
          const gap = 8;
          const containerWidth =
            containerRef.current?.querySelector('[data-testid="photo-grid"]')?.clientWidth ??
            containerRef.current?.clientWidth ??
            800;
          const perRow = Math.max(1, Math.floor((containerWidth + gap) / (cellSize + gap)));

          const currentRow = Math.floor(imageIndex / perRow);
          const col = imageIndex % perRow;
          const totalRows = Math.ceil(currentGroup.images.length / perRow);

          if (currentRow < totalRows - 1) {
            // Move to next row in same group
            const targetIndex = Math.min(
              (currentRow + 1) * perRow + col,
              currentGroup.images.length - 1,
            );
            onFocusChange(currentGroup.images[targetIndex]!.path);
          } else if (groupIndex < currentGroups.length - 1) {
            // Last row of group — jump to first row of next group, same column
            const nextGroup = currentGroups[groupIndex + 1]!;
            const targetIndex = Math.min(col, nextGroup.images.length - 1);
            onFocusChange(nextGroup.images[targetIndex]!.path);
          }
          break;
        }

        case 'ArrowUp': {
          e.preventDefault();
          const cellSizeUp = THUMBNAIL_SIZE_MAP[thumbnailSizeRef.current] ?? 200;
          const gapUp = 8;
          const containerWidthUp =
            containerRef.current?.querySelector('[data-testid="photo-grid"]')?.clientWidth ??
            containerRef.current?.clientWidth ??
            800;
          const perRowUp = Math.max(
            1,
            Math.floor((containerWidthUp + gapUp) / (cellSizeUp + gapUp)),
          );

          const currentRowUp = Math.floor(imageIndex / perRowUp);
          const colUp = imageIndex % perRowUp;

          if (currentRowUp > 0) {
            // Move to previous row in same group
            const targetIndex = (currentRowUp - 1) * perRowUp + colUp;
            onFocusChange(currentGroup.images[targetIndex]!.path);
          } else if (groupIndex > 0) {
            // First row of group — jump to last row of previous group, same column
            const prevGroup = currentGroups[groupIndex - 1]!;
            const prevPerRow = perRowUp;
            const prevLastRow = Math.floor((prevGroup.images.length - 1) / prevPerRow);
            const targetIndex = Math.min(
              prevLastRow * prevPerRow + colUp,
              prevGroup.images.length - 1,
            );
            onFocusChange(prevGroup.images[targetIndex]!.path);
          }
          break;
        }

        case 'Home': {
          e.preventDefault();
          const firstGroup = currentGroups[0]!;
          onFocusChange(firstGroup.images[0]!.path);
          break;
        }

        case 'End': {
          e.preventDefault();
          const lastGroup = currentGroups[currentGroups.length - 1]!;
          onFocusChange(lastGroup.images[lastGroup.images.length - 1]!.path);
          break;
        }

        case ' ': {
          // Space no longer does anything, but it must still be swallowed:
          // unhandled, it pages the scroll container. See GRID_NAV_KEYS.
          e.preventDefault();
          break;
        }

        case 'Backspace':
        case 'Delete': {
          const tag = (document.activeElement as HTMLElement)?.tagName?.toLowerCase();
          if (tag === 'input' || tag === 'textarea') return;
          e.preventDefault();
          onDeleteFocused();
          break;
        }
      }
    },
    [onFocusChange, onRate, onDeleteFocused, onRotate],
  );

  /**
   * Listen on the document, not on the container.
   *
   * A container listener only fires while focus is inside it, and focus leaves
   * easily — a click on empty chrome, a closing dialog, anything that lands on
   * document.body. The keys then went unhandled and the browser scrolled the
   * nearest scrollable ancestor, which is the photo grid: navigation looked
   * dead and the gallery moved instead.
   *
   * Every other keyboard handler in the app (App.tsx, DetailImageViewer)
   * already listens on the document; this one was the exception.
   */
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  return { handleKeyDown };
}
