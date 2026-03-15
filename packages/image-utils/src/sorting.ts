import { compare } from 'natural-orderby';
import type { ImageFileInfo } from '@photo-culler/types';

export type SortField = 'filename' | 'dateTaken' | 'size' | 'dimensions' | 'qualityScore';
export type SortDirection = 'asc' | 'desc';

/**
 * Sort images by the specified field and direction.
 * Returns a new sorted array (does not mutate the input).
 *
 * Special behaviors:
 * - filename: uses natural sort (IMG_2 before IMG_10)
 * - dateTaken: images without dateTaken sort to end regardless of direction
 * - dimensions: computed as width * height; images without dimensions sort to end
 */
export function sortImages(
  images: ImageFileInfo[],
  field: SortField,
  direction: SortDirection,
  context?: { qualityScores?: Record<string, number> },
): ImageFileInfo[] {
  const sorted = [...images];
  const dirMultiplier = direction === 'asc' ? 1 : -1;

  switch (field) {
    case 'filename': {
      const naturalCompare = compare({ order: direction });
      sorted.sort((a, b) => naturalCompare(a.name, b.name));
      break;
    }

    case 'dateTaken': {
      sorted.sort((a, b) => {
        const aDate = a.dateTaken;
        const bDate = b.dateTaken;

        // Images without dateTaken sort to end
        if (aDate == null && bDate == null) return 0;
        if (aDate == null) return 1;
        if (bDate == null) return -1;

        return (aDate - bDate) * dirMultiplier;
      });
      break;
    }

    case 'size': {
      sorted.sort((a, b) => (a.size - b.size) * dirMultiplier);
      break;
    }

    case 'dimensions': {
      sorted.sort((a, b) => {
        const aPixels = (a.width ?? 0) * (a.height ?? 0);
        const bPixels = (b.width ?? 0) * (b.height ?? 0);

        // Images without dimensions (0 pixels) sort to end
        if (aPixels === 0 && bPixels === 0) return 0;
        if (aPixels === 0) return 1;
        if (bPixels === 0) return -1;

        return (aPixels - bPixels) * dirMultiplier;
      });
      break;
    }

    case 'qualityScore': {
      const scores = context?.qualityScores ?? {};
      sorted.sort((a, b) => {
        const aScore = scores[a.name];
        const bScore = scores[b.name];

        // Unscored images sort to end
        if (aScore == null && bScore == null) return 0;
        if (aScore == null) return 1;
        if (bScore == null) return -1;

        return (aScore - bScore) * dirMultiplier;
      });
      break;
    }
  }

  return sorted;
}
