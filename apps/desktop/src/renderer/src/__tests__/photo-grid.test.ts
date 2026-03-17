import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { PhotoGroup } from '@photo-culler/image-utils/grouping';
import type { ImageFileInfo } from '@photo-culler/types';
import { useGrouping, HEADER_HEIGHT, DIVIDER_HEIGHT } from '../hooks/useGrouping';
import { THUMBNAIL_SIZE_MAP } from '../components/PhotoGrid';

// Mock thumbnail worker and exif extractor
vi.mock('../hooks/useThumbnailWorker', () => ({
  useThumbnailWorker: () => ({
    requestThumbnail: vi.fn(),
    getThumbnail: () => 'loading' as const,
    updateVisibleRange: vi.fn(),
    clearAll: vi.fn(),
  }),
}));

vi.mock('../hooks/useExifExtractor', () => ({
  useExifExtractor: () => ({
    extractAll: vi.fn(),
    isExtracting: false,
    progress: { completed: 0, total: 0 },
  }),
}));

function makeImage(name: string, dateTaken?: number): ImageFileInfo {
  return {
    path: `/photos/${name}`,
    name,
    extension: 'jpg',
    size: 1000,
    lastModified: dateTaken ?? Date.now(),
    dateTaken,
  };
}

function makeGroup(
  id: string,
  images: ImageFileInfo[],
  startTime: number | null = null,
  endTime: number | null = null,
): PhotoGroup {
  return { id, images, startTime, endTime };
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

  describe('useGrouping', () => {
    it('computes group heights based on images per row', () => {
      const images = [makeImage('a.jpg', 1000), makeImage('b.jpg', 2000), makeImage('c.jpg', 3000)];

      const { result } = renderHook(() => useGrouping(images, 60000, 200, 600));

      // 600px width / 200px cell = 3 per row
      // 3 images = 1 row
      // Height = 32 (header) + 1 * 200 (row) + 16 (divider) = 248
      expect(result.current.groups.length).toBe(1);
      expect(result.current.getGroupHeight(0)).toBe(HEADER_HEIGHT + 200 + DIVIDER_HEIGHT);
    });

    it('handles multi-row groups', () => {
      const images = Array.from({ length: 7 }, (_, i) => makeImage(`img${i}.jpg`, 1000 + i * 100));

      const { result } = renderHook(() => useGrouping(images, 60000, 120, 360));

      // 360 / 120 = 3 per row, 7 images = ceil(7/3) = 3 rows
      // Height = 32 + 3*120 + 16 = 408
      expect(result.current.getGroupHeight(0)).toBe(HEADER_HEIGHT + 3 * 120 + DIVIDER_HEIGHT);
    });

    it('creates multiple groups when timestamps are far apart', () => {
      const images = [
        makeImage('a.jpg', 1000),
        makeImage('b.jpg', 2000),
        makeImage('c.jpg', 100000), // far apart
      ];

      const { result } = renderHook(() => useGrouping(images, 5000, 200, 600));

      expect(result.current.groups.length).toBe(2);
    });

    it('ensures minimum 1 image per row even with narrow container', () => {
      const images = [makeImage('a.jpg', 1000)];

      const { result } = renderHook(
        () => useGrouping(images, 60000, 300, 100), // container narrower than cell
      );

      // imagesPerRow = max(1, floor(100/300)) = 1
      expect(result.current.getGroupHeight(0)).toBe(HEADER_HEIGHT + 300 + DIVIDER_HEIGHT);
    });
  });

  describe('Group header display', () => {
    it('generates groups with correct photo count', () => {
      const images = Array.from({ length: 5 }, (_, i) => makeImage(`img${i}.jpg`, 1000 + i * 100));

      const { result } = renderHook(() => useGrouping(images, 60000, 200, 800));

      expect(result.current.groups[0]!.images.length).toBe(5);
    });

    it('generates groups with start and end time', () => {
      const images = [makeImage('a.jpg', 1000), makeImage('b.jpg', 5000)];

      const { result } = renderHook(() => useGrouping(images, 60000, 200, 800));

      const group = result.current.groups[0]!;
      expect(group.startTime).toBe(1000);
      expect(group.endTime).toBe(5000);
    });
  });

  describe('Empty state', () => {
    it('returns no groups for empty image array', () => {
      const { result } = renderHook(() => useGrouping([], 5000, 200, 800));

      expect(result.current.groups.length).toBe(0);
    });
  });
});
