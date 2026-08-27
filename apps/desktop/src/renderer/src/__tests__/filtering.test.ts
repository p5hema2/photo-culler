import { describe, it, expect } from 'vitest';
import type { ImageFileInfo } from '@photo-culler/types';
import { isInRatingRange } from '@photo-culler/image-utils/rating';
import type { RatingRange } from '../lib/filters';
import { FULL_RATING_RANGE, isFullRatingRange, normalizeRatingRange } from '../lib/filters';

/**
 * The filter pipeline from usePhotoStore. The rating step calls the real
 * predicate, so the range rule is tested rather than re-stated.
 */
function filterImages(
  images: ImageFileInfo[],
  filterExtensions: Set<string>,
  filterRatingRange: RatingRange,
  searchQuery: string,
  ratings: Record<string, number>,
): ImageFileInfo[] {
  let result = images;

  if (filterExtensions.size > 0) {
    result = result.filter((img) => filterExtensions.has(img.extension.toLowerCase()));
  }

  if (!isFullRatingRange(filterRatingRange)) {
    result = result.filter((img) => isInRatingRange(ratings[img.path], filterRatingRange));
  }

  if (searchQuery.trim()) {
    const query = searchQuery.toLowerCase().trim();
    result = result.filter((img) => img.name.toLowerCase().includes(query));
  }

  return result;
}

function makeImage(name: string, extension: string = 'jpg'): ImageFileInfo {
  return {
    path: `/photos/${name}`,
    name,
    folder: '/photos',
    extension,
    size: 1000,
    lastModified: Date.now(),
  };
}

const ALL = FULL_RATING_RANGE;

const range = (min: number, max: number): RatingRange => ({ min, max });

describe('Filtering', () => {
  const images: ImageFileInfo[] = [
    makeImage('IMG_001.jpg', 'jpg'),
    makeImage('IMG_002.jpg', 'jpg'),
    makeImage('IMG_003.png', 'png'),
    makeImage('IMG_004.tiff', 'tiff'),
    makeImage('sunset.webp', 'webp'),
    makeImage('IMG_005.jpg', 'jpg'), // deliberately left unrated
  ];

  const ratings: Record<string, number> = {
    '/photos/IMG_001.jpg': 5,
    '/photos/IMG_002.jpg': 3,
    '/photos/IMG_003.png': 5,
    '/photos/IMG_004.tiff': 1,
    '/photos/sunset.webp': 3,
  };

  describe('File type filter', () => {
    it('toggling JPG shows only JPG images', () => {
      const result = filterImages(images, new Set(['jpg']), ALL, '', ratings);
      expect(result.every((img) => img.extension === 'jpg')).toBe(true);
      expect(result.length).toBe(3);
    });

    it('multiple extensions can be active simultaneously', () => {
      const result = filterImages(images, new Set(['jpg', 'png']), ALL, '', ratings);
      expect(result.length).toBe(4);
    });

    it('empty filter set shows all images', () => {
      const result = filterImages(images, new Set(), ALL, '', ratings);
      expect(result.length).toBe(6);
    });
  });

  describe('Rating filter', () => {
    it('a single-value range shows only that rating', () => {
      const result = filterImages(images, new Set(), range(5, 5), '', ratings);
      expect(result.map((img) => img.name).sort()).toEqual(['IMG_001.jpg', 'IMG_003.png']);
    });

    it('a wider range shows the whole span', () => {
      const result = filterImages(images, new Set(), range(3, 5), '', ratings);
      expect(result.map((img) => img.name).sort()).toEqual([
        'IMG_001.jpg',
        'IMG_002.jpg',
        'IMG_003.png',
        'sunset.webp',
      ]);
    });

    it('min 0 is what includes the unrated images', () => {
      const result = filterImages(images, new Set(), range(0, 1), '', ratings);
      expect(result.map((img) => img.name).sort()).toEqual(['IMG_004.tiff', 'IMG_005.jpg']);
    });

    it('a range above 0 excludes the unrated images', () => {
      const result = filterImages(images, new Set(), range(1, 5), '', ratings);
      expect(result.map((img) => img.name)).not.toContain('IMG_005.jpg');
      expect(result.length).toBe(5);
    });

    it('the full range is the same as no filter', () => {
      const result = filterImages(images, new Set(), range(0, 5), '', ratings);
      expect(result.length).toBe(6);
    });
  });

  describe('Search', () => {
    it('typing "IMG_0" filters to matching filenames', () => {
      const result = filterImages(images, new Set(), ALL, 'IMG_0', ratings);
      expect(result.length).toBe(5);
    });

    it('typing "sunset" filters to sunset.webp', () => {
      const result = filterImages(images, new Set(), ALL, 'sunset', ratings);
      expect(result.length).toBe(1);
      expect(result[0]!.name).toBe('sunset.webp');
    });

    it('empty search shows all images', () => {
      const result = filterImages(images, new Set(), ALL, '', ratings);
      expect(result.length).toBe(6);
    });

    it('search is case-insensitive', () => {
      const result = filterImages(images, new Set(), ALL, 'img_001', ratings);
      expect(result.length).toBe(1);
      expect(result[0]!.name).toBe('IMG_001.jpg');
    });

    it('whitespace-only search shows all images', () => {
      const result = filterImages(images, new Set(), ALL, '   ', ratings);
      expect(result.length).toBe(6);
    });
  });

  describe('Combined filters', () => {
    it('extension + rating + search all applied together', () => {
      const result = filterImages(images, new Set(['jpg']), range(5, 5), 'IMG', ratings);
      expect(result.map((img) => img.name)).toEqual(['IMG_001.jpg']);
    });

    it('extension + search narrows results', () => {
      const result = filterImages(images, new Set(['jpg']), ALL, 'IMG_002', ratings);
      expect(result.length).toBe(1);
      expect(result[0]!.name).toBe('IMG_002.jpg');
    });
  });

  describe('Debounce behavior', () => {
    it('rapid filtering calls return consistent results', () => {
      const r1 = filterImages(images, new Set(), ALL, 'I', ratings);
      const r2 = filterImages(images, new Set(), ALL, 'IM', ratings);
      const r3 = filterImages(images, new Set(), ALL, 'IMG', ratings);

      expect(r1.length).toBe(5);
      expect(r2.length).toBe(5);
      expect(r3.length).toBe(5);
    });
  });
});

describe('isFullRatingRange', () => {
  it('is true for the whole 0-5 span', () => {
    expect(isFullRatingRange(FULL_RATING_RANGE)).toBe(true);
  });

  it('is false as soon as either handle moves inward', () => {
    expect(isFullRatingRange(range(1, 5))).toBe(false);
    expect(isFullRatingRange(range(0, 4))).toBe(false);
  });
});

describe('normalizeRatingRange', () => {
  it('swaps handles that have been dragged past each other', () => {
    expect(normalizeRatingRange(range(4, 2))).toEqual({ min: 2, max: 4 });
  });

  it('clamps values from outside 0-5', () => {
    expect(normalizeRatingRange(range(-3, 9))).toEqual({ min: 0, max: 5 });
  });

  it('leaves a valid range alone', () => {
    expect(normalizeRatingRange(range(1, 3))).toEqual({ min: 1, max: 3 });
  });
});
