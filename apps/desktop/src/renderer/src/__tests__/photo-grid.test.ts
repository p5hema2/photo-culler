import { describe, it, expect } from 'vitest';
import type { ImageFileInfo } from '@photo-culler/types';
import { groupByTimestamp } from '@photo-culler/image-utils/grouping';
import type { FolderSection } from '@photo-culler/image-utils/folders';
import type { FolderNode } from '@photo-culler/image-utils/tree';
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

  /**
   * One flat level of the tree, which is what most of these tests need.
   *
   * `buildRows` takes FolderNodes since 1.8.1; before that it took sections and
   * a `showFolderHeaders` flag. Every node now gets a header, so the tests that
   * used to pass `false` build a single node and subtract nothing — the header
   * is simply part of the offset.
   */
  function nodesOf(sections: FolderSection[]): FolderNode[] {
    return sections.map((section) => ({
      path: section.path,
      name: section.path.slice(1),
      depth: 0,
      children: [],
      section,
      ownCount: section.imageCount,
      totalCount: section.imageCount,
    }));
  }

  /** A parent holding `children`, none of which carry images of their own. */
  function parentOf(path: string, children: FolderNode[]): FolderNode {
    return {
      path,
      name: path.slice(1),
      depth: 0,
      children: children.map((c) => ({ ...c, depth: 1 })),
      section: null,
      ownCount: 0,
      totalCount: children.reduce((n, c) => n + c.totalCount, 0),
    };
  }

  describe('buildRows over a tree', () => {
    it('emits a header for every node, then that node’s own groups', () => {
      const a = makeSection('/p/a', [2]);
      const rows = buildRows([parentOf('/p', nodesOf([a]))], new Set());
      expect(rows.map((r) => (r.kind === 'folder' ? `f:${r.node.path}` : 'g'))).toEqual([
        'f:/p',
        'f:/p/a',
        'g',
      ]);
    });

    it('hides a collapsed node’s whole subtree, not just its own images', () => {
      // The behavioural difference from the flat list this replaced: there, one
      // section's collapse could not hide another's.
      const a = makeSection('/p/a', [2]);
      const rows = buildRows([parentOf('/p', nodesOf([a]))], new Set(['/p']));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.kind).toBe('folder');
    });

    it('still shows a collapsed node itself, without its groups', () => {
      const a = makeSection('/p/a', [2]);
      const rows = buildRows([parentOf('/p', nodesOf([a]))], new Set(['/p/a']));
      expect(rows.map((r) => r.kind)).toEqual(['folder', 'folder']);
    });

    it('keeps groupIndex aligned with the uncollapsed numbering', () => {
      // groupIndex is the thumbnail fetch priority, not row bookkeeping.
      // Advancing it past hidden groups is what stops collapsing one shoot from
      // re-prioritising every folder after it.
      const a = makeSection('/p/a', [2, 2]);
      const b = makeSection('/p/b', [2]);
      const tree = [parentOf('/p', nodesOf([a, b]))];

      const open = buildRows(tree, new Set());
      const collapsed = buildRows(tree, new Set(['/p/a']));

      const indexIn = (rows: ReturnType<typeof buildRows>) =>
        rows.find((r) => r.kind === 'group' && r.section.path === '/p/b');
      const openB = indexIn(open);
      const collapsedB = indexIn(collapsed);
      expect(openB?.kind === 'group' && openB.groupIndex).toBe(2);
      expect(collapsedB?.kind === 'group' && collapsedB.groupIndex).toBe(2);
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
      const rows = buildRows(nodesOf([section]), new Set());
      // Every folder has a header now, so its own 40 px sits above the group.
      expect(cellOffsetInGrid(rows, section.groups[0]!.images[0]!.path, 2, cellSize)).toEqual({
        top: FOLDER_HEADER_HEIGHT + HEADER_HEIGHT,
        height: cellSize,
      });
    });

    it('drops a full row height per wrapped line', () => {
      const section = makeSection('/a', [6]);
      const rows = buildRows(nodesOf([section]), new Set());
      // 2 per row: index 4 is on the third line.
      expect(cellOffsetInGrid(rows, section.groups[0]!.images[4]!.path, 2, cellSize)).toEqual({
        top: FOLDER_HEADER_HEIGHT + HEADER_HEIGHT + 2 * rowPitch,
        height: cellSize,
      });
    });

    it('adds up the groups above it', () => {
      const section = makeSection('/a', [2, 3]);
      const rows = buildRows(nodesOf([section]), new Set());
      const second = section.groups[1]!.images[0]!.path;
      expect(cellOffsetInGrid(rows, second, 2, cellSize)).toEqual({
        top: FOLDER_HEADER_HEIGHT + groupHeight(2, 2, cellSize) + HEADER_HEIGHT,
        height: cellSize,
      });
      // Sanity: that first group really is header + one row + divider.
      expect(groupHeight(2, 2, cellSize)).toBe(HEADER_HEIGHT + cellSize + DIVIDER_HEIGHT);
    });

    it('counts folder headers', () => {
      const sections = [makeSection('/a', [2]), makeSection('/b', [2])];
      const rows = buildRows(nodesOf(sections), new Set());
      const inB = sections[1]!.groups[0]!.images[0]!.path;
      expect(cellOffsetInGrid(rows, inB, 2, cellSize)).toEqual({
        top:
          FOLDER_HEADER_HEIGHT + groupHeight(2, 2, cellSize) + FOLDER_HEADER_HEIGHT + HEADER_HEIGHT,
        height: cellSize,
      });
    });

    it('returns null for an image in a collapsed folder, which has no cell', () => {
      const sections = [makeSection('/a', [2]), makeSection('/b', [2])];
      const rows = buildRows(nodesOf(sections), new Set(['/b']));
      const inB = sections[1]!.groups[0]!.images[0]!.path;
      expect(cellOffsetInGrid(rows, inB, 2, cellSize)).toBe(null);
    });

    it('returns null for a path that is not in the grid at all', () => {
      const rows = buildRows(nodesOf([makeSection('/a', [2])]), new Set());
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
