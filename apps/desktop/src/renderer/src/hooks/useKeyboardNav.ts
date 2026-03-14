import { useCallback, useRef, useEffect } from 'react';
import type { PhotoGroup } from '@photo-culler/image-utils/grouping';

interface KeyboardNavOptions {
  groups: PhotoGroup[];
  focusedImageId: string | null;
  onFocusChange: (path: string | null) => void;
  onCycleClassification: (filename: string) => void;
  containerRef: React.RefObject<HTMLElement | null>;
}

interface KeyboardNavResult {
  handleKeyDown: (e: KeyboardEvent) => void;
}

/**
 * Find which group and position an image is in.
 */
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
  onCycleClassification,
  containerRef,
}: KeyboardNavOptions): KeyboardNavResult {
  const groupsRef = useRef(groups);
  const focusRef = useRef(focusedImageId);
  groupsRef.current = groups;
  focusRef.current = focusedImageId;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const currentGroups = groupsRef.current;
      if (currentGroups.length === 0) return;

      const focused = focusRef.current;

      // If nothing focused, focus the first image on any nav key
      if (!focused) {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
          e.preventDefault();
          const first = currentGroups[0]?.images[0];
          if (first) onFocusChange(first.path);
        }
        return;
      }

      const pos = findImagePosition(currentGroups, focused);
      if (!pos) return;

      const { groupIndex, imageIndex } = pos;
      const currentGroup = currentGroups[groupIndex]!;

      switch (e.key) {
        case 'ArrowRight': {
          e.preventDefault();
          if (imageIndex < currentGroup.images.length - 1) {
            // Next image in same group
            onFocusChange(currentGroup.images[imageIndex + 1]!.path);
          } else if (groupIndex < currentGroups.length - 1) {
            // First image of next group
            const nextGroup = currentGroups[groupIndex + 1]!;
            onFocusChange(nextGroup.images[0]!.path);
          }
          break;
        }

        case 'ArrowLeft': {
          e.preventDefault();
          if (imageIndex > 0) {
            // Previous image in same group
            onFocusChange(currentGroup.images[imageIndex - 1]!.path);
          } else if (groupIndex > 0) {
            // Last image of previous group
            const prevGroup = currentGroups[groupIndex - 1]!;
            onFocusChange(prevGroup.images[prevGroup.images.length - 1]!.path);
          }
          break;
        }

        case 'ArrowDown': {
          e.preventDefault();
          if (groupIndex < currentGroups.length - 1) {
            const nextGroup = currentGroups[groupIndex + 1]!;
            // Same column position, clamped
            const targetIndex = Math.min(imageIndex, nextGroup.images.length - 1);
            onFocusChange(nextGroup.images[targetIndex]!.path);
          }
          break;
        }

        case 'ArrowUp': {
          e.preventDefault();
          if (groupIndex > 0) {
            const prevGroup = currentGroups[groupIndex - 1]!;
            // Same column position, clamped
            const targetIndex = Math.min(imageIndex, prevGroup.images.length - 1);
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
          e.preventDefault();
          const image = currentGroup.images[imageIndex];
          if (image) {
            onCycleClassification(image.name);
          }
          break;
        }
      }
    },
    [onFocusChange, onCycleClassification],
  );

  // Attach keydown listener to container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    el.addEventListener('keydown', handleKeyDown);
    return () => {
      el.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown, containerRef]);

  return { handleKeyDown };
}
