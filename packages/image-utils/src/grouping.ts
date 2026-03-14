import type { ImageFileInfo } from '@photo-culler/types';

export interface PhotoGroup {
  /** Unique identifier for the group */
  id: string;
  /** Images in this group */
  images: ImageFileInfo[];
  /** Timestamp of the earliest image in the group (ms since epoch), or null if no timestamps */
  startTime: number | null;
  /** Timestamp of the latest image in the group (ms since epoch), or null if no timestamps */
  endTime: number | null;
}

/**
 * Get the effective timestamp for an image (dateTaken, falling back to lastModified).
 */
function getTimestamp(image: ImageFileInfo): number {
  return image.dateTaken ?? image.lastModified;
}

/**
 * Group images by timestamp proximity.
 *
 * Images MUST be pre-sorted by timestamp before calling this function.
 * Consecutive images within `thresholdMs` of each other are placed in the same group.
 */
export function groupByTimestamp(
  images: ImageFileInfo[],
  thresholdMs: number,
): PhotoGroup[] {
  if (images.length === 0) return [];

  const groups: PhotoGroup[] = [];
  let currentGroup: ImageFileInfo[] = [images[0]!];

  for (let i = 1; i < images.length; i++) {
    const prevTimestamp = getTimestamp(images[i - 1]!);
    const currTimestamp = getTimestamp(images[i]!);
    const delta = Math.abs(currTimestamp - prevTimestamp);

    if (delta <= thresholdMs) {
      currentGroup.push(images[i]!);
    } else {
      groups.push(buildGroup(currentGroup, groups.length));
      currentGroup = [images[i]!];
    }
  }

  // Push the last group
  groups.push(buildGroup(currentGroup, groups.length));

  return groups;
}

function buildGroup(images: ImageFileInfo[], index: number): PhotoGroup {
  const timestamps = images.map(getTimestamp);
  return {
    id: `group-${index}`,
    images,
    startTime: Math.min(...timestamps),
    endTime: Math.max(...timestamps),
  };
}
