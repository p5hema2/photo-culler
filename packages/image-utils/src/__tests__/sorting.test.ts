import { describe, it, expect } from 'vitest';
import { sortImages, type SortField, type SortDirection } from '../sorting';
import type { ImageFileInfo } from '@photo-culler/types';

function makeImage(
  name: string,
  overrides: Partial<ImageFileInfo> = {},
): ImageFileInfo {
  return {
    path: `/test/${name}`,
    name,
    extension: 'jpg',
    size: 1024,
    lastModified: 1000000,
    ...overrides,
  };
}

describe('sortImages', () => {
  it('does not mutate the input array', () => {
    const images = [makeImage('b.jpg'), makeImage('a.jpg')];
    const original = [...images];
    sortImages(images, 'filename', 'asc');
    expect(images).toEqual(original);
  });

  describe('sort by filename', () => {
    it('uses natural sort (IMG_2 before IMG_10)', () => {
      const images = [
        makeImage('IMG_10.jpg'),
        makeImage('IMG_2.jpg'),
        makeImage('IMG_1.jpg'),
      ];
      const sorted = sortImages(images, 'filename', 'asc');
      expect(sorted.map((i) => i.name)).toEqual([
        'IMG_1.jpg',
        'IMG_2.jpg',
        'IMG_10.jpg',
      ]);
    });

    it('supports descending order', () => {
      const images = [
        makeImage('IMG_1.jpg'),
        makeImage('IMG_2.jpg'),
        makeImage('IMG_10.jpg'),
      ];
      const sorted = sortImages(images, 'filename', 'desc');
      expect(sorted.map((i) => i.name)).toEqual([
        'IMG_10.jpg',
        'IMG_2.jpg',
        'IMG_1.jpg',
      ]);
    });
  });

  describe('sort by dateTaken', () => {
    it('sorts ascending by dateTaken', () => {
      const images = [
        makeImage('c.jpg', { dateTaken: 3000 }),
        makeImage('a.jpg', { dateTaken: 1000 }),
        makeImage('b.jpg', { dateTaken: 2000 }),
      ];
      const sorted = sortImages(images, 'dateTaken', 'asc');
      expect(sorted.map((i) => i.name)).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
    });

    it('sorts descending by dateTaken', () => {
      const images = [
        makeImage('a.jpg', { dateTaken: 1000 }),
        makeImage('c.jpg', { dateTaken: 3000 }),
        makeImage('b.jpg', { dateTaken: 2000 }),
      ];
      const sorted = sortImages(images, 'dateTaken', 'desc');
      expect(sorted.map((i) => i.name)).toEqual(['c.jpg', 'b.jpg', 'a.jpg']);
    });

    it('images without dateTaken sort to end', () => {
      const images = [
        makeImage('no-date.jpg', { dateTaken: undefined }),
        makeImage('has-date.jpg', { dateTaken: 1000 }),
      ];
      const sorted = sortImages(images, 'dateTaken', 'asc');
      expect(sorted[0]!.name).toBe('has-date.jpg');
      expect(sorted[1]!.name).toBe('no-date.jpg');
    });
  });

  describe('sort by size', () => {
    it('sorts ascending by size', () => {
      const images = [
        makeImage('big.jpg', { size: 5000 }),
        makeImage('small.jpg', { size: 100 }),
        makeImage('mid.jpg', { size: 2500 }),
      ];
      const sorted = sortImages(images, 'size', 'asc');
      expect(sorted.map((i) => i.name)).toEqual([
        'small.jpg',
        'mid.jpg',
        'big.jpg',
      ]);
    });

    it('sorts descending by size', () => {
      const images = [
        makeImage('small.jpg', { size: 100 }),
        makeImage('big.jpg', { size: 5000 }),
      ];
      const sorted = sortImages(images, 'size', 'desc');
      expect(sorted[0]!.name).toBe('big.jpg');
      expect(sorted[1]!.name).toBe('small.jpg');
    });
  });

  describe('sort by dimensions', () => {
    it('sorts ascending by megapixels (width * height)', () => {
      const images = [
        makeImage('large.jpg', { width: 4000, height: 3000 }),
        makeImage('small.jpg', { width: 640, height: 480 }),
        makeImage('medium.jpg', { width: 1920, height: 1080 }),
      ];
      const sorted = sortImages(images, 'dimensions', 'asc');
      expect(sorted.map((i) => i.name)).toEqual([
        'small.jpg',
        'medium.jpg',
        'large.jpg',
      ]);
    });

    it('sorts descending by megapixels', () => {
      const images = [
        makeImage('small.jpg', { width: 640, height: 480 }),
        makeImage('large.jpg', { width: 4000, height: 3000 }),
      ];
      const sorted = sortImages(images, 'dimensions', 'desc');
      expect(sorted[0]!.name).toBe('large.jpg');
    });

    it('images without dimensions sort to end', () => {
      const images = [
        makeImage('no-dims.jpg', { width: undefined, height: undefined }),
        makeImage('has-dims.jpg', { width: 1920, height: 1080 }),
      ];
      const sorted = sortImages(images, 'dimensions', 'asc');
      expect(sorted[0]!.name).toBe('has-dims.jpg');
      expect(sorted[1]!.name).toBe('no-dims.jpg');
    });
  });
});
