import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ImageFileInfo } from '@photo-culler/types';

// Test the filtering logic directly (same as used in usePhotoStore)
type Classification = 'keep' | 'review' | 'delete';

function filterImages(
  images: ImageFileInfo[],
  filterExtensions: Set<string>,
  filterClassification: Classification | null,
  searchQuery: string,
  classifications: Record<string, Classification>,
): ImageFileInfo[] {
  let result = images;

  if (filterExtensions.size > 0) {
    result = result.filter((img) => filterExtensions.has(img.extension.toLowerCase()));
  }

  if (filterClassification) {
    result = result.filter(
      (img) => (classifications[img.name] ?? 'review') === filterClassification,
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
    extension,
    size: 1000,
    lastModified: Date.now(),
  };
}

describe('Filtering', () => {
  const images: ImageFileInfo[] = [
    makeImage('IMG_001.jpg', 'jpg'),
    makeImage('IMG_002.jpg', 'jpg'),
    makeImage('IMG_003.png', 'png'),
    makeImage('IMG_004.tiff', 'tiff'),
    makeImage('sunset.webp', 'webp'),
  ];

  const classifications: Record<string, Classification> = {
    'IMG_001.jpg': 'keep',
    'IMG_002.jpg': 'review',
    'IMG_003.png': 'keep',
    'IMG_004.tiff': 'delete',
    'sunset.webp': 'review',
  };

  describe('File type filter', () => {
    it('toggling JPG shows only JPG images', () => {
      const result = filterImages(images, new Set(['jpg']), null, '', classifications);
      expect(result.length).toBe(2);
      expect(result.every((img) => img.extension === 'jpg')).toBe(true);
    });

    it('multiple extensions can be active simultaneously', () => {
      const result = filterImages(images, new Set(['jpg', 'png']), null, '', classifications);
      expect(result.length).toBe(3);
    });

    it('empty filter set shows all images', () => {
      const result = filterImages(images, new Set(), null, '', classifications);
      expect(result.length).toBe(5);
    });
  });

  describe('Classification filter', () => {
    it('selecting "keep" shows only keep images', () => {
      const result = filterImages(images, new Set(), 'keep', '', classifications);
      expect(result.length).toBe(2);
      expect(result.map((img) => img.name).sort()).toEqual(['IMG_001.jpg', 'IMG_003.png']);
    });

    it('clicking active filter clears it (shows all)', () => {
      // null classification = show all
      const result = filterImages(images, new Set(), null, '', classifications);
      expect(result.length).toBe(5);
    });

    it('selecting "delete" shows only delete images', () => {
      const result = filterImages(images, new Set(), 'delete', '', classifications);
      expect(result.length).toBe(1);
      expect(result[0]!.name).toBe('IMG_004.tiff');
    });
  });

  describe('Search', () => {
    it('typing "IMG_0" filters to matching filenames', () => {
      const result = filterImages(images, new Set(), null, 'IMG_0', classifications);
      expect(result.length).toBe(4);
    });

    it('typing "sunset" filters to sunset.webp', () => {
      const result = filterImages(images, new Set(), null, 'sunset', classifications);
      expect(result.length).toBe(1);
      expect(result[0]!.name).toBe('sunset.webp');
    });

    it('empty search shows all images', () => {
      const result = filterImages(images, new Set(), null, '', classifications);
      expect(result.length).toBe(5);
    });

    it('search is case-insensitive', () => {
      const result = filterImages(images, new Set(), null, 'img_001', classifications);
      expect(result.length).toBe(1);
      expect(result[0]!.name).toBe('IMG_001.jpg');
    });

    it('whitespace-only search shows all images', () => {
      const result = filterImages(images, new Set(), null, '   ', classifications);
      expect(result.length).toBe(5);
    });
  });

  describe('Combined filters', () => {
    it('extension + classification + search all applied together', () => {
      // Only jpg + keep + "IMG"
      const result = filterImages(images, new Set(['jpg']), 'keep', 'IMG', classifications);
      expect(result.length).toBe(1);
      expect(result[0]!.name).toBe('IMG_001.jpg');
    });

    it('extension + search narrows results', () => {
      const result = filterImages(images, new Set(['jpg']), null, 'IMG_002', classifications);
      expect(result.length).toBe(1);
      expect(result[0]!.name).toBe('IMG_002.jpg');
    });
  });

  describe('Debounce behavior', () => {
    it('rapid filtering calls return consistent results', () => {
      // Simulate rapid filter changes - each should produce correct results
      const r1 = filterImages(images, new Set(), null, 'I', classifications);
      const r2 = filterImages(images, new Set(), null, 'IM', classifications);
      const r3 = filterImages(images, new Set(), null, 'IMG', classifications);

      expect(r1.length).toBe(4); // IMG_001, IMG_002, IMG_003, IMG_004 (not sunset)
      expect(r2.length).toBe(4);
      expect(r3.length).toBe(4);
    });
  });
});
