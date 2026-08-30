import { useRef, useEffect, useLayoutEffect, useState, useCallback, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { PhotoGroup } from '@photo-culler/image-utils/grouping';
import type { FolderSection } from '@photo-culler/image-utils/folders';
import type { FolderCounts, FolderNode } from '@photo-culler/image-utils/tree';
import { FolderHeaderRow } from './FolderHeaderRow';
import { GroupRow, HEADER_HEIGHT } from './GroupRow';
import { centeredScrollOffset, centerElementVertically, setScrollTop } from '../lib/focus-scroll';
import type { SelectionClickModifier } from '../lib/selection';
import { usePointerFocus } from '../hooks/usePointerFocus';

// Owned by GroupRow, which has to render exactly this; re-exported because the
// row model below is the other half of that contract.
export { HEADER_HEIGHT };
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
  | { kind: 'folder'; node: FolderNode }
  | { kind: 'group'; section: FolderSection; group: PhotoGroup; groupIndex: number };

export function buildRows(roots: readonly FolderNode[], collapsed: ReadonlySet<string>): GridRow[] {
  const rows: GridRow[] = [];
  let groupIndex = 0;

  /**
   * `hidden` is the tree's whole behavioural difference from the flat list it
   * replaced: a collapsed folder used to hide only its OWN groups, because no
   * section knew about any other. Here a collapsed node takes its descendants
   * with it, and they contribute no rows at all.
   *
   * `groupIndex` still advances past everything hidden. It is not row
   * bookkeeping — it is the thumbnail fetch priority (`useThumbnailWorker`
   * sorts the queue by it against the visible range) — and keeping it aligned
   * with the UNCOLLAPSED numbering is what stops collapsing one shoot from
   * re-prioritising every folder after it.
   */
  const walk = (node: FolderNode, hidden: boolean): void => {
    if (!hidden) rows.push({ kind: 'folder', node });

    const collapsedHere = collapsed.has(node.path);
    const groups = node.section?.groups ?? [];
    if (!hidden && !collapsedHere && node.section) {
      for (const group of groups) {
        rows.push({ kind: 'group', section: node.section, group, groupIndex: groupIndex++ });
      }
    } else {
      groupIndex += groups.length;
    }

    for (const child of node.children) walk(child, hidden || collapsedHere);
  };

  for (const root of roots) walk(root, false);
  return rows;
}

/**
 * Where the cell for `imagePath` sits in the grid's scrollable content.
 *
 * Read off the same row model the virtualizer lays out with — rows are
 * absolutely positioned from these numbers — so it is exact, and it answers for
 * images whose row is not currently rendered. That is the case that matters:
 * coming back from the loupe, the focused image is nowhere in the DOM.
 *
 * Null for an image inside a collapsed folder, which has no cell at all.
 */
export function cellOffsetInGrid(
  rows: readonly GridRow[],
  imagePath: string,
  perRow: number,
  cellSize: number,
): { top: number; height: number } | null {
  let top = 0;

  for (const row of rows) {
    if (row.kind === 'folder') {
      top += FOLDER_HEADER_HEIGHT;
      continue;
    }
    const index = row.group.images.findIndex((img) => img.path === imagePath);
    if (index !== -1) {
      const line = Math.floor(index / Math.max(1, perRow));
      return { top: top + HEADER_HEIGHT + line * (cellSize + GRID_GAP), height: cellSize };
    }
    top += groupHeight(row.group.images.length, perRow, cellSize);
  }

  return null;
}

interface PhotoGridProps {
  /** The folder tree, in sibling order. Replaced the flat section list in 1.8.1. */
  folderTree: FolderNode[];
  /** Per-folder subtree tallies for the header counters, keyed by folder path. */
  folderCounts: Map<string, FolderCounts>;
  ratings: Record<string, number>;
  qualityScores: Record<string, number>;
  thumbnailSize: 'small' | 'medium' | 'large';
  focusedImageId: string | null;
  /** The batch rating and deletion act on — see lib/selection.ts. */
  selection: ReadonlySet<string>;
  collapsedFolders: ReadonlySet<string>;
  onToggleFolder: (folderPath: string) => void;
  /**
   * A cell was clicked. Moves the cursor onto it and applies the modifier to
   * the selection; the store decides what each modifier means.
   */
  onImageSelect: (path: string, modifier: SelectionClickModifier) => void;
  /**
   * A cell was right-clicked, at these viewport coordinates. The selection has
   * already been settled by then — see handleContextMenu.
   */
  onOpenContextMenu: (position: { x: number; y: number }) => void;
  /**
   * A folder SECTION HEADER was right-clicked.
   *
   * Separate from `onOpenContextMenu` because it carries a target the image
   * menu has no use for and, more importantly, because it must NOT settle the
   * selection: there is no image under the pointer, so a right click here has
   * nothing to select and must leave the batch exactly as it was.
   */
  onOpenFolderMenu: (node: FolderNode, at: { x: number; y: number }) => void;
  /** The folder a dragged selection is currently over, or null. */
  dropTargetFolder: string | null;
  /** A dragged selection entered, left, or was released on a folder header. */
  onFolderDragOver: (node: FolderNode | null) => void;
  onFolderDrop: (node: FolderNode) => void;
  onRate: (imagePath: string, rating: number) => void;
  getThumbnail: (id: string) => ImageBitmap | 'loading' | 'error';
  requestThumbnail: (id: string, url: string, size: number, groupIndex?: number) => void;
  updateVisibleRange: (first: number, last: number) => void;
}

export function PhotoGrid({
  folderTree,
  folderCounts,
  ratings,
  qualityScores,
  thumbnailSize,
  focusedImageId,
  selection,
  collapsedFolders,
  onToggleFolder,
  onImageSelect,
  onOpenContextMenu,
  onOpenFolderMenu,
  dropTargetFolder,
  onFolderDragOver,
  onFolderDrop,
  onRate,
  getThumbnail,
  requestThumbnail,
  updateVisibleRange,
}: PhotoGridProps): React.JSX.Element {
  const parentRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);
  /** A centring offset the scroll range was too short to accept — see below. */
  const pendingScrollRef = useRef<number | null>(null);
  /**
   * The modifier of the click currently being dispatched.
   *
   * usePointerFocus takes a plain `(path) => void`, because marking the focus as
   * pointer-driven is all it is for — and that mark is what stops the grid
   * scrolling a cell that is already under the cursor. Handing the modifier over
   * beside the path keeps one dispatch for all three kinds of click; the ref is
   * read synchronously, inside the call below.
   */
  const clickModifierRef = useRef<SelectionClickModifier>('plain');
  const onImageSelectRef = useRef(onImageSelect);
  onImageSelectRef.current = onImageSelect;

  const { handleImageFocus, consumePointerFocus } = usePointerFocus(
    useCallback((path: string) => onImageSelectRef.current(path, clickModifierRef.current), []),
  );

  const handleCellClick = useCallback(
    (path: string, modifier: SelectionClickModifier) => {
      clickModifierRef.current = modifier;
      handleImageFocus(path, 'click');
    },
    [handleImageFocus],
  );

  /**
   * A cell started a drag.
   *
   * Settles the selection first, with the same `'context'` modifier a right
   * click uses: dragging a photo that is NOT in the batch replaces the batch
   * with it, and dragging one that IS leaves the batch alone. Without that,
   * dragging an unselected photo would silently move whatever happened to be
   * selected somewhere else.
   */
  const handleCellDragStart = useCallback(
    (event: React.DragEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const cell = target.closest('[data-image-path]');
      const path = cell?.getAttribute('data-image-path');
      if (!path) return;

      handleCellClick(path, 'context');
      event.dataTransfer.effectAllowed = 'move';
      // Firefox and Chromium both refuse to start a drag with an empty payload.
      // Nothing reads it back: the drop handler spends `selectionTargets`,
      // which is the only value that applies the batch's visibility rule.
      event.dataTransfer.setData('text/plain', path);
    },
    [handleCellClick],
  );

  /**
   * Right click, resolved by delegation on the scroll container.
   *
   * `data-image-path` is already how this component finds a cell — the centring
   * effect looks one up that way — and one listener here beats threading a prop
   * per cell down through GroupRow to reach the same element.
   */
  const handleContextMenu = useCallback(
    (event: React.MouseEvent) => {
      const target = event.target;
      const cell = target instanceof Element ? target.closest('[data-image-path]') : null;
      const path = cell?.getAttribute('data-image-path');
      if (!path) return;
      event.preventDefault();
      // Select through the click path, not by calling onImageSelect directly:
      // that marks the focus change pointer-driven, and without the mark the
      // centring effect would scroll the cell to the middle — moving the content
      // out from under the coordinates the menu is about to open at.
      handleCellClick(path, 'context');
      onOpenContextMenu({ x: event.clientX, y: event.clientY });
    },
    [handleCellClick, onOpenContextMenu],
  );

  const cellSize = THUMBNAIL_SIZE_MAP[thumbnailSize] ?? 200;
  const perRow = imagesPerRow(containerWidth, cellSize);

  // A single folder needs no disclosure — that is the classic one-shoot case,
  // and a header for it would only cost vertical space.
  // Every node gets a header now, single-folder shoots included: the tree IS the
  // structure, and the thumbnail and scoring counters have nowhere else to live
  // since they left the toolbar.

  const rows = useMemo(
    () => buildRows(folderTree, collapsedFolders),
    [folderTree, collapsedFolders],
  );
  // The row model, held in a ref so that reading it does not tie an effect to
  // it. The rows churn constantly — scoring rebuilds them — and re-centring on
  // that would yank the grid out from under someone scrolling with the wheel.
  const modelRef = useRef({ rows, perRow, cellSize });
  modelRef.current = { rows, perRow, cellSize };

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
    .map((r) => (r.kind === 'folder' ? `f:${r.node.path}` : `g:${r.group.images.length}`))
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

  /**
   * Scroll the focused image to the middle from the row model rather than the
   * DOM, returning the offset it asked for. Stable, so that neither effect
   * below re-runs on the other's trigger.
   */
  const centerFromModel = useCallback(
    (container: HTMLElement, imagePath: string): number | null => {
      const model = modelRef.current;
      const cell = cellOffsetInGrid(model.rows, imagePath, model.perRow, model.cellSize);
      if (!cell) return null;

      const target = centeredScrollOffset({
        itemStart: cell.top,
        itemSize: cell.height,
        viewportSize: container.clientHeight,
        // The model's own total rather than scrollHeight, which lags a commit
        // behind it whenever the row heights have just changed.
        contentSize: virtualizer.getTotalSize(),
      });
      setScrollTop(container, target);
      return target;
    },
    [virtualizer],
  );

  /**
   * Keep the focused image in the vertical middle as the focus moves.
   *
   * Layout is settled here — nothing but the focus changed in this commit — so
   * the rendered cell is measured directly when there is one. There usually is;
   * the model is for the image that is virtualized away, which is exactly the
   * case that matters when the view switches back to the grid.
   */
  useEffect(() => {
    const container = parentRef.current;
    if (!container || !focusedImageId) return;

    // The pointer put the cell where the user wanted it; scrolling now would
    // only fight them. See usePointerFocus.
    if (consumePointerFocus(focusedImageId)) return;

    const rendered = container.querySelector<HTMLElement>(
      `[data-image-path="${CSS.escape(focusedImageId)}"]`,
    );
    if (rendered) {
      centerElementVertically(container, rendered);
      return;
    }
    centerFromModel(container, focusedImageId);
  }, [focusedImageId, consumePointerFocus, centerFromModel]);

  /**
   * Re-centre after the layout itself moves — a thumbnail-size change, or a
   * resize that fits a different number of cells per row.
   *
   * Model-derived, never measured: `virtualizer.measure()` above only
   * invalidates the size cache and schedules a render, so until that render
   * commits every row in the DOM still sits at its old offset. The model and
   * getTotalSize() are already the new geometry; the DOM is a commit behind.
   */
  useEffect(() => {
    const container = parentRef.current;
    if (!container || !focusedImageId) return;

    const target = centerFromModel(container, focusedImageId);
    // Growing the cells makes the content taller, and the browser clamps a
    // scroll the sizer has no room for yet. Nothing to race against: the render
    // that grows it is already scheduled, so hand the offset on and let the
    // layout effect below re-apply it the moment that render commits.
    if (target != null && Math.round(container.scrollTop) !== target) {
      pendingScrollRef.current = target;
    }
    // focusedImageId is read, not watched: a focus change is the effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perRow, cellSize, centerFromModel]);

  /**
   * Second half of that: re-apply a clamped offset once, against the grown
   * scroll range. A layout effect so it lands before the frame is painted.
   */
  useLayoutEffect(() => {
    const container = parentRef.current;
    const target = pendingScrollRef.current;
    if (!container || target == null) return;

    // One attempt only. A target the content can never reach must not turn into
    // a scroll the user cannot escape.
    pendingScrollRef.current = null;
    setScrollTop(container, target);
  });

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
      onContextMenu={handleContextMenu}
      onDragStart={handleCellDragStart}
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
                <FolderHeaderRow
                  node={row.node}
                  collapsed={collapsedFolders.has(row.node.path)}
                  counts={folderCounts.get(row.node.path)}
                  dropTarget={dropTargetFolder === row.node.path}
                  onToggle={onToggleFolder}
                  onContextMenu={onOpenFolderMenu}
                  onDragOver={onFolderDragOver}
                  onDragLeave={() => onFolderDragOver(null)}
                  onDrop={onFolderDrop}
                />
              ) : (
                <GroupRow
                  group={row.group}
                  cellSize={cellSize}
                  ratings={ratings}
                  qualityScores={qualityScores}
                  focusedImageId={focusedImageId}
                  selection={selection}
                  onImageClick={handleCellClick}
                  onRate={onRate}
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
