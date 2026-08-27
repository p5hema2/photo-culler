import { describe, it, expect } from 'vitest';
import { sortImages } from '../sorting';
import type { ImageFileInfo } from '@photo-culler/types';

function makeImage(name: string, overrides: Partial<ImageFileInfo> = {}): ImageFileInfo {
  return {
    path: `/test/${name}`,
    name,
    folder: '/test',
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
    sortImages(images, 'asc');
    expect(images).toEqual(original);
  });

  it('uses natural sort (IMG_2 before IMG_10)', () => {
    const images = [makeImage('IMG_10.jpg'), makeImage('IMG_2.jpg'), makeImage('IMG_1.jpg')];
    const sorted = sortImages(images, 'asc');
    expect(sorted.map((i) => i.name)).toEqual(['IMG_1.jpg', 'IMG_2.jpg', 'IMG_10.jpg']);
  });

  it('supports descending order', () => {
    const images = [makeImage('IMG_1.jpg'), makeImage('IMG_2.jpg'), makeImage('IMG_10.jpg')];
    const sorted = sortImages(images, 'desc');
    expect(sorted.map((i) => i.name)).toEqual(['IMG_10.jpg', 'IMG_2.jpg', 'IMG_1.jpg']);
  });

  it('ignores metadata entirely — filename is the only key', () => {
    // Filename order is capture order in this app, so a missing or misleading
    // timestamp must not move an image.
    const images = [
      makeImage('IMG_1.jpg', { dateTaken: 3000, size: 10 }),
      makeImage('IMG_2.jpg', { dateTaken: undefined, size: 9000 }),
      makeImage('IMG_3.jpg', { dateTaken: 1000, size: 500 }),
    ];
    const sorted = sortImages(images, 'asc');
    expect(sorted.map((i) => i.name)).toEqual(['IMG_1.jpg', 'IMG_2.jpg', 'IMG_3.jpg']);
  });
});
