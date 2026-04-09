import { describe, it, expect } from 'vitest';
import { groupByTimestamp } from '../grouping';
import type { ImageFileInfo } from '@photo-culler/types';

function makeImage(name: string, dateTaken?: number, lastModified = 1000000): ImageFileInfo {
  return {
    path: `/test/${name}`,
    name,
    extension: 'jpg',
    size: 1024,
    lastModified,
    dateTaken,
  };
}

describe('groupByTimestamp', () => {
  it('groups consecutive images within threshold into same group', () => {
    const images = [makeImage('a.jpg', 1000), makeImage('b.jpg', 1500), makeImage('c.jpg', 2000)];
    const groups = groupByTimestamp(images, 1000);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.images).toHaveLength(3);
  });

  it('splits images with gap > threshold into separate groups', () => {
    const images = [makeImage('a.jpg', 1000), makeImage('b.jpg', 1500), makeImage('c.jpg', 5000)];
    const groups = groupByTimestamp(images, 1000);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.images).toHaveLength(2);
    expect(groups[1]!.images).toHaveLength(1);
  });

  it('single image becomes group of 1', () => {
    const images = [makeImage('a.jpg', 1000)];
    const groups = groupByTimestamp(images, 1000);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.images).toHaveLength(1);
  });

  it('empty array returns empty groups', () => {
    const groups = groupByTimestamp([], 1000);
    expect(groups).toEqual([]);
  });

  it('falls back to lastModified when dateTaken is undefined', () => {
    const images = [
      makeImage('a.jpg', undefined, 1000),
      makeImage('b.jpg', undefined, 1500),
      makeImage('c.jpg', undefined, 5000),
    ];
    const groups = groupByTimestamp(images, 1000);
    expect(groups).toHaveLength(2);
  });

  it('group has correct startTime and endTime', () => {
    const images = [makeImage('a.jpg', 1000), makeImage('b.jpg', 2000), makeImage('c.jpg', 3000)];
    const groups = groupByTimestamp(images, 5000);
    expect(groups[0]!.startTime).toBe(1000);
    expect(groups[0]!.endTime).toBe(3000);
  });

  it('threshold of 0ms groups only identical timestamps', () => {
    const images = [makeImage('a.jpg', 1000), makeImage('b.jpg', 1000), makeImage('c.jpg', 1001)];
    const groups = groupByTimestamp(images, 0);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.images).toHaveLength(2);
    expect(groups[1]!.images).toHaveLength(1);
  });

  it('large threshold groups everything into one group', () => {
    const images = [makeImage('a.jpg', 0), makeImage('b.jpg', 50000), makeImage('c.jpg', 100000)];
    const groups = groupByTimestamp(images, 999999);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.images).toHaveLength(3);
  });
});
