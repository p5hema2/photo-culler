import { useRef, useEffect, useState, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { PhotoGroup } from '@photo-culler/image-utils/grouping';
import { GroupRow } from './GroupRow';
import type { Classification } from './ThumbnailCell';

export const HEADER_HEIGHT = 32;
export const DIVIDER_HEIGHT = 16;
/** Matches the `gap-2` (0.5rem) between cells in GroupRow. */
export const GRID_GAP = 8;

export const THUMBNAIL_SIZE_MAP: Record<string, number> = {
  small: 120,
  medium: 200,
  large: 300,
};

/**
 * How many cells fit on one row. Exported so the layout contract is testable:
 * cells stay a fixed square box, so aspect-correct thumbnails must not change
 * either of these two formulas.
 */
export function imagesPerRow(containerWidth: number, cellSize: number): number {
  return Math.max(1, Math.floor((containerWidth + GRID_GAP) / (cellSize + GRID_GAP)));
}

/** Pixel height of one group: header + wrapped rows of cells + divider. */
export function groupHeight(imageCount: number, perRow: number, cellSize: number): number {
  const rows = Math.ceil(imageCount / Math.max(1, perRow));
  return HEADER_HEIGHT + rows * (cellSize + GRID_GAP) - GRID_GAP + DIVIDER_HEIGHT;
}

interface PhotoGridProps {
  groups: PhotoGroup[];
  classifications: Record<string, Classification>;
  qualityScores: Record<string, number>;
  rotations: Record<string, number>;
  thumbnailSize: 'small' | 'medium' | 'large';
  focusedImageId: string | null;
  selectOnHover: boolean;
  onImageClick: (filename: string) => void;
  onImageFocus: (path: string) => void;
  onCycleClassification: (filename: string) => void;
  getThumbnail: (id: string) => ImageBitmap | 'loading' | 'error';
  requestThumbnail: (id: string, url: string, size: number, groupIndex?: number) => void;
  updateVisibleRange: (first: number, last: number) => void;
}

export function PhotoGrid({
  groups,
  classifications,
  qualityScores,
  rotations,
  thumbnailSize,
  focusedImageId,
  selectOnHover,
  onImageClick,
  onImageFocus,
  onCycleClassification,
  getThumbnail,
  requestThumbnail,
  updateVisibleRange,
}: PhotoGridProps): React.JSX.Element {
  const parentRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);

  const cellSize = THUMBNAIL_SIZE_MAP[thumbnailSize] ?? 200;
  const perRow = imagesPerRow(containerWidth, cellSize);

  const getGroupHeight = useCallback(
    (index: number): number => {
      const group = groups[index];
      if (!group) return HEADER_HEIGHT + cellSize + DIVIDER_HEIGHT;
      return groupHeight(group.images.length, perRow, cellSize);
    },
    [groups, cellSize, perRow],
  );

  const virtualizer = useVirtualizer({
    count: groups.length,
    getScrollElement: () => parentRef.current,
    estimateSize: getGroupHeight,
    overscan: 3,
  });

  // Fingerprint that changes when any group's image count changes (not just group count)
  const groupSizesKey = groups.map((g) => g.images.length).join(',');

  // Force virtualizer to recalculate when cell size, container width, or group contents change
  useEffect(() => {
    virtualizer.measure();
  }, [cellSize, containerWidth, groups.length, groupSizesKey, virtualizer]);

  // Track container width via ResizeObserver
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });

    observer.observe(el);
    setContainerWidth(el.clientWidth);

    return () => observer.disconnect();
  }, []);

  // Update visible range for thumbnail priority
  useEffect(() => {
    const items = virtualizer.getVirtualItems();
    if (items.length > 0) {
      const first = items[0]!.index;
      const last = items[items.length - 1]!.index;
      updateVisibleRange(first, last);
    }
  }, [virtualizer.getVirtualItems(), updateVisibleRange]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={parentRef}
      className="h-full overflow-auto outline-none"
      data-testid="photo-grid"
      role="grid"
      tabIndex={0}
      onMouseEnter={() => parentRef.current?.focus()}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => (
          <div
            key={virtualItem.key}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: `${virtualItem.size}px`,
              transform: `translateY(${virtualItem.start}px)`,
            }}
            data-testid="virtual-group"
          >
            <GroupRow
              group={groups[virtualItem.index]!}
              cellSize={cellSize}
              classifications={classifications}
              qualityScores={qualityScores}
              rotations={rotations}
              focusedImageId={focusedImageId}
              selectOnHover={selectOnHover}
              onImageClick={onImageClick}
              onImageFocus={onImageFocus}
              onCycleClassification={onCycleClassification}
              getThumbnail={getThumbnail}
              requestThumbnail={requestThumbnail}
              groupIndex={virtualItem.index}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
