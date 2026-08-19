import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { PhotoGroup } from '@photo-culler/image-utils/grouping';
import type { FolderSection } from '@photo-culler/image-utils/folders';
import { GroupRow } from './GroupRow';
import type { Classification } from './ThumbnailCell';

export const HEADER_HEIGHT = 32;
export const DIVIDER_HEIGHT = 16;
/** Matches the `gap-2` (0.5rem) between cells in GroupRow. */
export const GRID_GAP = 8;
/** Height of one folder disclosure header. */
export const FOLDER_HEADER_HEIGHT = 40;

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

/**
 * One virtualized row: either a folder's disclosure header, or one timestamp
 * group inside an expanded folder.
 *
 * Flattening the two levels into a single list keeps the existing single-axis
 * virtualizer — nesting a virtualizer per folder would break scroll estimation
 * across thousands of images spread over many shoots.
 */
export type GridRow =
  | { kind: 'folder'; section: FolderSection }
  | { kind: 'group'; section: FolderSection; group: PhotoGroup; groupIndex: number };

export function buildRows(
  sections: readonly FolderSection[],
  collapsed: ReadonlySet<string>,
  showFolderHeaders: boolean,
): GridRow[] {
  const rows: GridRow[] = [];
  let groupIndex = 0;

  for (const section of sections) {
    if (showFolderHeaders) rows.push({ kind: 'folder', section });
    if (collapsed.has(section.path)) {
      groupIndex += section.groups.length;
      continue;
    }
    for (const group of section.groups) {
      rows.push({ kind: 'group', section, group, groupIndex: groupIndex++ });
    }
  }
  return rows;
}

interface PhotoGridProps {
  folders: FolderSection[];
  classifications: Record<string, Classification>;
  qualityScores: Record<string, number>;
  rotations: Record<string, number>;
  thumbnailSize: 'small' | 'medium' | 'large';
  focusedImageId: string | null;
  selectOnHover: boolean;
  collapsedFolders: ReadonlySet<string>;
  onToggleFolder: (folderPath: string) => void;
  onImageClick: (imagePath: string) => void;
  onImageFocus: (path: string) => void;
  onCycleClassification: (imagePath: string) => void;
  getThumbnail: (id: string) => ImageBitmap | 'loading' | 'error';
  requestThumbnail: (id: string, url: string, size: number, groupIndex?: number) => void;
  updateVisibleRange: (first: number, last: number) => void;
}

export function PhotoGrid({
  folders,
  classifications,
  qualityScores,
  rotations,
  thumbnailSize,
  focusedImageId,
  selectOnHover,
  collapsedFolders,
  onToggleFolder,
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

  // A single folder needs no disclosure — that is the classic one-shoot case,
  // and a header for it would only cost vertical space.
  const showFolderHeaders = folders.length > 1;

  const rows = useMemo(
    () => buildRows(folders, collapsedFolders, showFolderHeaders),
    [folders, collapsedFolders, showFolderHeaders],
  );

  const getRowHeight = useCallback(
    (index: number): number => {
      const row = rows[index];
      if (!row) return FOLDER_HEADER_HEIGHT;
      if (row.kind === 'folder') return FOLDER_HEADER_HEIGHT;
      return groupHeight(row.group.images.length, perRow, cellSize);
    },
    [rows, cellSize, perRow],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: getRowHeight,
    overscan: 3,
  });

  // Fingerprint that changes when the row set or any group's size changes
  const rowsKey = rows
    .map((r) => (r.kind === 'folder' ? `f:${r.section.path}` : `g:${r.group.images.length}`))
    .join(',');

  useEffect(() => {
    virtualizer.measure();
  }, [cellSize, containerWidth, rowsKey, virtualizer]);

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
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const row = rows[virtualItem.index];
          if (!row) return null;

          return (
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
              data-testid={row.kind === 'folder' ? 'folder-header-row' : 'virtual-group'}
            >
              {row.kind === 'folder' ? (
                <button
                  onClick={() => onToggleFolder(row.section.path)}
                  className="w-full h-full flex items-center gap-2 px-3 text-left bg-gray-850 hover:bg-gray-800 border-b border-gray-700 transition-colors"
                  style={{ backgroundColor: '#1a1d23' }}
                  data-testid="folder-header"
                  data-folder-path={row.section.path}
                  aria-expanded={!collapsedFolders.has(row.section.path)}
                >
                  <span className="text-gray-500 w-3 flex-shrink-0">
                    {collapsedFolders.has(row.section.path) ? '▸' : '▾'}
                  </span>
                  <span
                    className="text-sm font-medium text-gray-200 truncate"
                    title={row.section.path}
                  >
                    {row.section.label}
                  </span>
                  <span className="text-xs text-gray-500 flex-shrink-0">
                    {row.section.imageCount}
                  </span>
                </button>
              ) : (
                <GroupRow
                  group={row.group}
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
                  groupIndex={row.groupIndex}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
