import { useCallback, useRef, useEffect } from 'react';
import type { PhotoGroup } from '@photo-culler/image-utils/grouping';
import type { ImageFileInfo } from '@photo-culler/types';

const THUMBNAIL_SIZE_MAP: Record<string, number> = {
  small: 120,
  medium: 200,
  large: 300,
};

interface KeyboardNavOptions {
  groups: PhotoGroup[];
  focusedImageId: string | null;
  onFocusChange: (path: string | null) => void;
  onCycleClassification: (filename: string) => void;
  onSetClassification: (filename: string, classification: 'keep' | 'review' | 'delete' | null) => void;
  containerRef: React.RefObject<HTMLElement | null>;
  onToggleSelect: (path: string) => void;
  onRangeSelect: (path: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onTrashFocused: () => void;
  onTrashSelected: () => void;
  onEnterPreview: (path: string) => void;
  onExitPreview: () => void;
  onRotate: (filename: string, direction: 'cw' | 'ccw') => void;
  isPreviewMode: boolean;
  sortedFlatImages: ImageFileInfo[];
  thumbnailSize: 'small' | 'medium' | 'large';
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
  onSetClassification,
  containerRef,
  onToggleSelect,
  onRangeSelect,
  onSelectAll,
  onClearSelection,
  onTrashFocused,
  onTrashSelected,
  onEnterPreview,
  onExitPreview,
  onRotate,
  isPreviewMode,
  sortedFlatImages,
  thumbnailSize,
}: KeyboardNavOptions): KeyboardNavResult {
  const groupsRef = useRef(groups);
  const focusRef = useRef(focusedImageId);
  const previewRef = useRef(isPreviewMode);
  const flatImagesRef = useRef(sortedFlatImages);
  const thumbnailSizeRef = useRef(thumbnailSize);
  groupsRef.current = groups;
  focusRef.current = focusedImageId;
  previewRef.current = isPreviewMode;
  flatImagesRef.current = sortedFlatImages;
  thumbnailSizeRef.current = thumbnailSize;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const currentGroups = groupsRef.current;
      if (currentGroups.length === 0) return;

      const focused = focusRef.current;
      const inPreview = previewRef.current;
      const flatImages = flatImagesRef.current;

      // Ctrl/Cmd+A: select all (before switch since 'a' is a letter)
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        onSelectAll();
        return;
      }

      // If nothing focused, focus the first image on any nav key
      if (!focused) {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
          e.preventDefault();
          const first = currentGroups[0]?.images[0];
          if (first) onFocusChange(first.path);
        }
        return;
      }

      // Preview mode: arrow keys navigate linearly through flat image list
      if (inPreview) {
        const flatIndex = flatImages.findIndex((img) => img.path === focused);
        switch (e.key) {
          case 'ArrowRight':
          case 'ArrowDown': {
            e.preventDefault();
            if (flatIndex < flatImages.length - 1) {
              onEnterPreview(flatImages[flatIndex + 1]!.path);
            }
            return;
          }
          case 'ArrowLeft':
          case 'ArrowUp': {
            e.preventDefault();
            if (flatIndex > 0) {
              onEnterPreview(flatImages[flatIndex - 1]!.path);
            }
            return;
          }
        }
      }

      // Alt+Arrow Left/Right: rotate focused image
      if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        const pos = findImagePosition(currentGroups, focused);
        if (pos) {
          const image = currentGroups[pos.groupIndex]!.images[pos.imageIndex]!;
          onRotate(image.name, e.key === 'ArrowRight' ? 'cw' : 'ccw');
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
          const containerWidth = containerRef.current?.querySelector('[data-testid="photo-grid"]')?.clientWidth
            ?? containerRef.current?.clientWidth ?? 800;
          const perRow = Math.max(1, Math.floor((containerWidth + gap) / (cellSize + gap)));

          const currentRow = Math.floor(imageIndex / perRow);
          const col = imageIndex % perRow;
          const totalRows = Math.ceil(currentGroup.images.length / perRow);

          if (currentRow < totalRows - 1) {
            // Move to next row in same group
            const targetIndex = Math.min((currentRow + 1) * perRow + col, currentGroup.images.length - 1);
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
          const containerWidthUp = containerRef.current?.querySelector('[data-testid="photo-grid"]')?.clientWidth
            ?? containerRef.current?.clientWidth ?? 800;
          const perRowUp = Math.max(1, Math.floor((containerWidthUp + gapUp) / (cellSizeUp + gapUp)));

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
            const targetIndex = Math.min(prevLastRow * prevPerRow + colUp, prevGroup.images.length - 1);
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

        case '1': {
          e.preventDefault();
          const img1 = currentGroup.images[imageIndex];
          if (img1) onSetClassification(img1.name, 'keep');
          break;
        }

        case '2': {
          e.preventDefault();
          const img2 = currentGroup.images[imageIndex];
          if (img2) onSetClassification(img2.name, 'review');
          break;
        }

        case '3': {
          e.preventDefault();
          const img3 = currentGroup.images[imageIndex];
          if (img3) onSetClassification(img3.name, 'delete');
          break;
        }

        case '0': {
          e.preventDefault();
          const img0 = currentGroup.images[imageIndex];
          if (img0) onSetClassification(img0.name, null);
          break;
        }

        case 'Enter': {
          if (!inPreview && focused) {
            e.preventDefault();
            onEnterPreview(focused);
          }
          break;
        }

        case 'Escape': {
          e.preventDefault();
          if (inPreview) {
            onExitPreview();
          } else {
            onClearSelection();
          }
          break;
        }

        case 'Backspace': {
          const tag = (document.activeElement as HTMLElement)?.tagName?.toLowerCase();
          if (tag === 'input' || tag === 'textarea') return;
          e.preventDefault();
          onTrashFocused();
          break;
        }

        case 'Delete': {
          const tag = (document.activeElement as HTMLElement)?.tagName?.toLowerCase();
          if (tag === 'input' || tag === 'textarea') return;
          e.preventDefault();
          onTrashSelected();
          break;
        }
      }
    },
    [
      onFocusChange,
      onCycleClassification,
      onSetClassification,
      onSelectAll,
      onClearSelection,
      onTrashFocused,
      onTrashSelected,
      onEnterPreview,
      onExitPreview,
      onRotate,
    ],
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
