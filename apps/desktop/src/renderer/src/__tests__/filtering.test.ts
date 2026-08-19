import { describe, it, expect } from 'vitest';
import type { ImageFileInfo } from '@photo-culler/types';
import type { ClassificationFilter } from '../lib/filters';
import { matchesClassificationFilter, toggleClassificationFilter } from '../lib/filters';

type Classification = 'keep' | 'review' | 'delete' | null;

/**
 * The filter pipeline from usePhotoStore. The classification step calls the
 * real predicate, so the multi-select rule is tested rather than re-stated.
 */
function filterImages(
  images: ImageFileInfo[],
  filterExtensions: Set<string>,
  filterClassifications: ReadonlySet<ClassificationFilter>,
  searchQuery: string,
  classifications: Record<string, Classification>,
): ImageFileInfo[] {
  let result = images;

  if (filterExtensions.size > 0) {
    result = result.filter((img) => filterExtensions.has(img.extension.toLowerCase()));
  }

  if (filterClassifications.size > 0) {
    result = result.filter((img) =>
      matchesClassificationFilter(classifications[img.path], filterClassifications),
    );
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

const NO_CLASS = new Set<ClassificationFilter>();

const withClasses = (...values: ClassificationFilter[]): Set<ClassificationFilter> =>
  new Set(values);

describe('Filtering', () => {
  const images: ImageFileInfo[] = [
    makeImage('IMG_001.jpg', 'jpg'),
    makeImage('IMG_002.jpg', 'jpg'),
    makeImage('IMG_003.png', 'png'),
    makeImage('IMG_004.tiff', 'tiff'),
    makeImage('sunset.webp', 'webp'),
    makeImage('IMG_005.jpg', 'jpg'), // deliberately left unclassified
  ];

  const classifications: Record<string, Classification> = {
    '/photos/IMG_001.jpg': 'keep',
    '/photos/IMG_002.jpg': 'review',
    '/photos/IMG_003.png': 'keep',
    '/photos/IMG_004.tiff': 'delete',
    '/photos/sunset.webp': 'review',
  };

  describe('File type filter', () => {
    it('toggling JPG shows only JPG images', () => {
      const result = filterImages(images, new Set(['jpg']), NO_CLASS, '', classifications);
      expect(result.every((img) => img.extension === 'jpg')).toBe(true);
      expect(result.length).toBe(3);
    });

    it('multiple extensions can be active simultaneously', () => {
      const result = filterImages(images, new Set(['jpg', 'png']), NO_CLASS, '', classifications);
      expect(result.length).toBe(4);
    });

    it('empty filter set shows all images', () => {
      const result = filterImages(images, new Set(), NO_CLASS, '', classifications);
      expect(result.length).toBe(6);
    });
  });

  describe('Classification filter', () => {
    it('selecting "keep" shows only keep images', () => {
      const result = filterImages(images, new Set(), withClasses('keep'), '', classifications);
      expect(result.map((img) => img.name).sort()).toEqual(['IMG_001.jpg', 'IMG_003.png']);
    });

    it('selecting two classifications shows the union', () => {
      const result = filterImages(
        images,
        new Set(),
        withClasses('keep', 'delete'),
        '',
        classifications,
      );
      expect(result.map((img) => img.name).sort()).toEqual([
        'IMG_001.jpg',
        'IMG_003.png',
        'IMG_004.tiff',
      ]);
    });

    it('"None" selects the images with no classification at all', () => {
      const result = filterImages(
        images,
        new Set(),
        withClasses('unclassified'),
        '',
        classifications,
      );
      expect(result.map((img) => img.name)).toEqual(['IMG_005.jpg']);
    });

    it('"None" combines with a real classification', () => {
      const result = filterImages(
        images,
        new Set(),
        withClasses('unclassified', 'delete'),
        '',
        classifications,
      );
      expect(result.map((img) => img.name).sort()).toEqual(['IMG_004.tiff', 'IMG_005.jpg']);
    });

    it('deselecting the last classification shows all again', () => {
      const result = filterImages(images, new Set(), NO_CLASS, '', classifications);
      expect(result.length).toBe(6);
    });

    it('selecting every classification is the same as no filter', () => {
      const all = withClasses('unclassified', 'keep', 'review', 'delete');
      const result = filterImages(images, new Set(), all, '', classifications);
      expect(result.length).toBe(6);
    });
  });

  describe('Search', () => {
    it('typing "IMG_0" filters to matching filenames', () => {
      const result = filterImages(images, new Set(), NO_CLASS, 'IMG_0', classifications);
      expect(result.length).toBe(5);
    });

    it('typing "sunset" filters to sunset.webp', () => {
      const result = filterImages(images, new Set(), NO_CLASS, 'sunset', classifications);
      expect(result.length).toBe(1);
      expect(result[0]!.name).toBe('sunset.webp');
    });

    it('empty search shows all images', () => {
      const result = filterImages(images, new Set(), NO_CLASS, '', classifications);
      expect(result.length).toBe(6);
    });

    it('search is case-insensitive', () => {
      const result = filterImages(images, new Set(), NO_CLASS, 'img_001', classifications);
      expect(result.length).toBe(1);
      expect(result[0]!.name).toBe('IMG_001.jpg');
    });

    it('whitespace-only search shows all images', () => {
      const result = filterImages(images, new Set(), NO_CLASS, '   ', classifications);
      expect(result.length).toBe(6);
    });
  });

  describe('Combined filters', () => {
    it('extension + classification + search all applied together', () => {
      const result = filterImages(
        images,
        new Set(['jpg']),
        withClasses('keep'),
        'IMG',
        classifications,
      );
      expect(result.map((img) => img.name)).toEqual(['IMG_001.jpg']);
    });

    it('extension + search narrows results', () => {
      const result = filterImages(images, new Set(['jpg']), NO_CLASS, 'IMG_002', classifications);
      expect(result.length).toBe(1);
      expect(result[0]!.name).toBe('IMG_002.jpg');
    });
  });

  describe('Debounce behavior', () => {
    it('rapid filtering calls return consistent results', () => {
      const r1 = filterImages(images, new Set(), NO_CLASS, 'I', classifications);
      const r2 = filterImages(images, new Set(), NO_CLASS, 'IM', classifications);
      const r3 = filterImages(images, new Set(), NO_CLASS, 'IMG', classifications);

      expect(r1.length).toBe(5);
      expect(r2.length).toBe(5);
      expect(r3.length).toBe(5);
    });
  });
});

describe('matchesClassificationFilter', () => {
  it('passes everything when nothing is selected', () => {
    expect(matchesClassificationFilter('keep', NO_CLASS)).toBe(true);
    expect(matchesClassificationFilter(null, NO_CLASS)).toBe(true);
  });

  it('treats a missing entry as unclassified', () => {
    const selected = withClasses('unclassified');
    expect(matchesClassificationFilter(undefined, selected)).toBe(true);
    expect(matchesClassificationFilter(null, selected)).toBe(true);
    expect(matchesClassificationFilter('keep', selected)).toBe(false);
  });
});

describe('toggleClassificationFilter', () => {
  it('adds a value that is not selected', () => {
    expect([...toggleClassificationFilter(NO_CLASS, 'keep')]).toEqual(['keep']);
  });

  it('removes a value that is selected', () => {
    expect([...toggleClassificationFilter(withClasses('keep', 'delete'), 'keep')]).toEqual([
      'delete',
    ]);
  });

  it('never mutates the set it was given', () => {
    const selected = withClasses('keep');
    toggleClassificationFilter(selected, 'delete');
    expect([...selected]).toEqual(['keep']);
  });
});
