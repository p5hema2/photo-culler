import { describe, it, expect } from 'vitest';
import type { ImageFileInfo } from '@photo-culler/types';
import { groupByTimestamp } from '@photo-culler/image-utils/grouping';
import type { FolderSection } from '@photo-culler/image-utils/folders';
import {
  THUMBNAIL_SIZE_MAP,
  HEADER_HEIGHT,
  DIVIDER_HEIGHT,
  GRID_GAP,
  FOLDER_HEADER_HEIGHT,
  imagesPerRow,
  groupHeight,
  buildRows,
  cellOffsetInGrid,
} from '../components/PhotoGrid';

function makeImage(name: string, dateTaken?: number): ImageFileInfo {
  return {
    path: `/photos/${name}`,
    name,
    folder: '/photos',
    extension: 'jpg',
    size: 1000,
    lastModified: dateTaken ?? 0,
    dateTaken,
  };
}

/** One folder section holding `counts` groups of the given sizes. */
function makeSection(path: string, counts: number[]): FolderSection {
  let n = 0;
  const groups = counts.map((count, gi) => ({
    id: `${path}#${gi}`,
    images: Array.from({ length: count }, () => makeImage(`${path.slice(1)}-img${n++}.jpg`)),
    startTime: null,
    endTime: null,
  }));
  return {
    path,
    label: path,
    groups,
    imageCount: counts.reduce((a, b) => a + b, 0),
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

  // The virtualizer positions rows from these same numbers, so an offset read
  // off the model is where the cell actually is — including for rows that are
  // not rendered, which is the case that matters when the view switches back.
  describe('cellOffsetInGrid', () => {
    const cellSize = 200;
    const rowPitch = cellSize + GRID_GAP;

    it('finds the first image at the top of its group, below the header', () => {
      const section = makeSection('/a', [4]);
      const rows = buildRows([section], new Set(), false);
      expect(cellOffsetInGrid(rows, section.groups[0]!.images[0]!.path, 2, cellSize)).toEqual({
        top: HEADER_HEIGHT,
        height: cellSize,
      });
    });

    it('drops a full row height per wrapped line', () => {
      const section = makeSection('/a', [6]);
      const rows = buildRows([section], new Set(), false);
      // 2 per row: index 4 is on the third line.
      expect(cellOffsetInGrid(rows, section.groups[0]!.images[4]!.path, 2, cellSize)).toEqual({
        top: HEADER_HEIGHT + 2 * rowPitch,
        height: cellSize,
      });
    });

    it('adds up the groups above it', () => {
      const section = makeSection('/a', [2, 3]);
      const rows = buildRows([section], new Set(), false);
      const second = section.groups[1]!.images[0]!.path;
      expect(cellOffsetInGrid(rows, second, 2, cellSize)).toEqual({
        top: groupHeight(2, 2, cellSize) + HEADER_HEIGHT,
        height: cellSize,
      });
      // Sanity: that first group really is header + one row + divider.
      expect(groupHeight(2, 2, cellSize)).toBe(HEADER_HEIGHT + cellSize + DIVIDER_HEIGHT);
    });

    it('counts folder headers when they are shown', () => {
      const sections = [makeSection('/a', [2]), makeSection('/b', [2])];
      const rows = buildRows(sections, new Set(), true);
      const inB = sections[1]!.groups[0]!.images[0]!.path;
      expect(cellOffsetInGrid(rows, inB, 2, cellSize)).toEqual({
        top:
          FOLDER_HEADER_HEIGHT + groupHeight(2, 2, cellSize) + FOLDER_HEADER_HEIGHT + HEADER_HEIGHT,
        height: cellSize,
      });
    });

    it('returns null for an image in a collapsed folder, which has no cell', () => {
      const sections = [makeSection('/a', [2]), makeSection('/b', [2])];
      const rows = buildRows(sections, new Set(['/b']), true);
      const inB = sections[1]!.groups[0]!.images[0]!.path;
      expect(cellOffsetInGrid(rows, inB, 2, cellSize)).toBe(null);
    });

    it('returns null for a path that is not in the grid at all', () => {
      const rows = buildRows([makeSection('/a', [2])], new Set(), false);
      expect(cellOffsetInGrid(rows, '/photos/nope.jpg', 2, cellSize)).toBe(null);
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
