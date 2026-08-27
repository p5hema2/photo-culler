import { compare } from 'natural-orderby';
import type { ImageFileInfo } from '@photo-culler/types';

export type SortDirection = 'asc' | 'desc';

/**
 * Sort images by filename, naturally (IMG_2 before IMG_10).
 * Returns a new sorted array (does not mutate the input).
 *
 * Filename is the only order the app offers, and that is deliberate: the user
 * names files after capture time, so filename order IS capture order — and it
 * is the one ordering that never depends on metadata a file might be missing.
 */
export function sortImages(images: ImageFileInfo[], direction: SortDirection): ImageFileInfo[] {
  const sorted = [...images];
  const naturalCompare = compare({ order: direction });
  sorted.sort((a, b) => naturalCompare(a.name, b.name));
  return sorted;
}
