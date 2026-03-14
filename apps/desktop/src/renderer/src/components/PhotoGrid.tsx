import { useRef, useEffect, useState, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { PhotoGroup } from '@photo-culler/image-utils/grouping';
import { GroupRow } from './GroupRow';
import type { Classification } from './ThumbnailCell';

const HEADER_HEIGHT = 32;
const DIVIDER_HEIGHT = 16;

export const THUMBNAIL_SIZE_MAP: Record<string, number> = {
  small: 120,
  medium: 200,
  large: 300,
};

interface PhotoGridProps {
  groups: PhotoGroup[];
  classifications: Record<string, Classification>;
  thumbnailSize: 'small' | 'medium' | 'large';
  focusedImageId: string | null;
  onImageClick: (filename: string) => void;
  getThumbnail: (id: string) => ImageBitmap | 'loading' | 'error';
  requestThumbnail: (id: string, url: string, size: number, groupIndex?: number) => void;
  updateVisibleRange: (first: number, last: number) => void;
}

export function PhotoGrid({
  groups,
  classifications,
  thumbnailSize,
  focusedImageId,
  onImageClick,
  getThumbnail,
  requestThumbnail,
  updateVisibleRange,
}: PhotoGridProps): React.JSX.Element {
  const parentRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);

  const cellSize = THUMBNAIL_SIZE_MAP[thumbnailSize] ?? 200;
  const imagesPerRow = Math.max(1, Math.floor(containerWidth / cellSize));

  const getGroupHeight = useCallback(
    (index: number): number => {
      const group = groups[index];
      if (!group) return HEADER_HEIGHT + cellSize + DIVIDER_HEIGHT;
      const rows = Math.ceil(group.images.length / imagesPerRow);
      return HEADER_HEIGHT + rows * cellSize + DIVIDER_HEIGHT;
    },
    [groups, cellSize, imagesPerRow],
  );

  const virtualizer = useVirtualizer({
    count: groups.length,
    getScrollElement: () => parentRef.current,
    estimateSize: getGroupHeight,
    overscan: 3,
  });

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
      className="h-full overflow-auto"
      data-testid="photo-grid"
      role="grid"
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
              focusedImageId={focusedImageId}
              onImageClick={onImageClick}
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
