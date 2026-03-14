import { useMemo } from 'react';
import type { ImageFileInfo } from '@photo-culler/types';
import { groupByTimestamp } from '@photo-culler/image-utils/grouping';
import type { PhotoGroup } from '@photo-culler/image-utils/grouping';

const HEADER_HEIGHT = 32;
const DIVIDER_HEIGHT = 16;

interface GroupingResult {
  groups: PhotoGroup[];
  getGroupHeight: (index: number) => number;
}

/**
 * Thin wrapper around groupByTimestamp that also computes group heights
 * for virtualizer estimateSize.
 */
export function useGrouping(
  sortedImages: ImageFileInfo[],
  thresholdMs: number,
  cellSize: number,
  containerWidth: number,
): GroupingResult {
  const groups = useMemo(() => {
    return groupByTimestamp(sortedImages, thresholdMs);
  }, [sortedImages, thresholdMs]);

  const getGroupHeight = useMemo(() => {
    const imagesPerRow = Math.max(1, Math.floor(containerWidth / cellSize));
    return (index: number): number => {
      const group = groups[index];
      if (!group) return HEADER_HEIGHT + cellSize + DIVIDER_HEIGHT;
      const rows = Math.ceil(group.images.length / imagesPerRow);
      return HEADER_HEIGHT + rows * cellSize + DIVIDER_HEIGHT;
    };
  }, [groups, cellSize, containerWidth]);

  return { groups, getGroupHeight };
}

export { HEADER_HEIGHT, DIVIDER_HEIGHT };
