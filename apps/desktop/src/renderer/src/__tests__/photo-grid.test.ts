import { describe, it, expect } from 'vitest';
import type { ImageFileInfo } from '@photo-culler/types';
import { groupByTimestamp } from '@photo-culler/image-utils/grouping';
import {
  THUMBNAIL_SIZE_MAP,
  HEADER_HEIGHT,
  DIVIDER_HEIGHT,
  GRID_GAP,
  imagesPerRow,
  groupHeight,
} from '../components/PhotoGrid';

function makeImage(name: string, dateTaken?: number): ImageFileInfo {
  return {
    path: `/photos/${name}`,
    name,
    extension: 'jpg',
    size: 1000,
    lastModified: dateTaken ?? 0,
    dateTaken,
  };
}

describe('PhotoGrid', () => {
  describe('THUMBNAIL_SIZE_MAP', () => {
    it('maps small to 120px', () => {
      expect(THUMBNAIL_SIZE_MAP.small).toBe(120);
    });

    it('maps medium to 200px', () => {
      expect(THUMBNAIL_SIZE_MAP.medium).toBe(200);
    });

    it('maps large to 300px', () => {
      expect(THUMBNAIL_SIZE_MAP.large).toBe(300);
    });
  });

  // These two formulas are the layout contract. Cells are a fixed square box,
  // so aspect-correct thumbnails must not change either of them.
  describe('imagesPerRow', () => {
    it('accounts for the gap between cells', () => {
      // floor((800 + 8) / (200 + 8)) = 3
      expect(imagesPerRow(800, 200)).toBe(3);
      // 600px fits only 2 once the gap is charged: floor(608 / 208) = 2
      expect(imagesPerRow(600, 200)).toBe(2);
      expect(imagesPerRow(360, 120)).toBe(2);
    });

    it('never drops below one cell per row', () => {
      expect(imagesPerRow(100, 300)).toBe(1);
      expect(imagesPerRow(0, 300)).toBe(1);
    });
  });

  describe('groupHeight', () => {
    it('is header + one row + divider for a single row', () => {
      // The trailing gap is subtracted, so a single row costs exactly cellSize.
      expect(groupHeight(3, 3, 200)).toBe(HEADER_HEIGHT + 200 + DIVIDER_HEIGHT);
    });

    it('charges a gap between rows but not after the last one', () => {
      // 7 images at 2 per row = 4 rows
      expect(groupHeight(7, 2, 120)).toBe(
        HEADER_HEIGHT + 4 * (120 + GRID_GAP) - GRID_GAP + DIVIDER_HEIGHT,
      );
      expect(groupHeight(7, 2, 120)).toBe(552);
    });

    it('handles a container narrower than one cell', () => {
      expect(groupHeight(1, imagesPerRow(100, 300), 300)).toBe(
        HEADER_HEIGHT + 300 + DIVIDER_HEIGHT,
      );
    });
  });

  describe('grouping feeding the grid', () => {
    it('creates one group when timestamps are close together', () => {
      const images = [makeImage('a.jpg', 1000), makeImage('b.jpg', 2000), makeImage('c.jpg', 3000)];
      const groups = groupByTimestamp(images, 60000);

      expect(groups.length).toBe(1);
      expect(groups[0]!.images.length).toBe(3);
      expect(groups[0]!.startTime).toBe(1000);
      expect(groups[0]!.endTime).toBe(3000);
    });

    it('splits into multiple groups when timestamps are far apart', () => {
      const images = [
        makeImage('a.jpg', 1000),
        makeImage('b.jpg', 2000),
        makeImage('c.jpg', 100000),
      ];

      expect(groupByTimestamp(images, 5000).length).toBe(2);
    });

    it('returns no groups for an empty image array', () => {
      expect(groupByTimestamp([], 5000).length).toBe(0);
    });
  });
});
