import { useState, useRef, useCallback, useEffect } from 'react';
import type { SortDirection } from '@photo-culler/image-utils/sorting';
import { MAX_RATING, MIN_RATING } from '@photo-culler/image-utils/rating';
import type { RatingRange } from '../lib/filters';
import { FULL_RATING_RANGE, isFullRatingRange, normalizeRatingRange } from '../lib/filters';

interface ToolbarProps {
  sortDirection: SortDirection;
  filterExtensions: Set<string>;
  filterRatingRange: RatingRange;
  searchQuery: string;
  thumbnailSize: 'small' | 'medium' | 'large';
  groupingThresholdMs: number;
  /** How many images the filters currently let through. */
  visibleCount: number;
  /**
   * How many images are selected. Shown only above one: a single selected image
   * is the resting state, and a permanent "1 selected" would be noise.
   */
  selectionCount: number;
  scoringProgress: { completed: number; total: number };
  /**
   * Thumbnail coverage of the folder. Does not run to completion on its own:
   * thumbnails are made per visible cell, so it climbs as the user scrolls.
   */
  thumbnailProgress: { completed: number; total: number };
  folderPath: string | null;
  onSelectFolder: () => void;
  onRescan: () => void;
  onSortDirectionChange: (direction: SortDirection) => void;
  onFilterExtensionsChange: (extensions: Set<string>) => void;
  onFilterRatingRangeChange: (range: RatingRange) => void;
  onSearchQueryChange: (query: string) => void;
  onThumbnailSizeChange: (size: 'small' | 'medium' | 'large') => void;
  onGroupingThresholdChange: (ms: number) => void;
  viewLayout: 'default' | 'loupe' | 'filmstrip';
  onSetViewLayout: (layout: 'default' | 'loupe' | 'filmstrip') => void;
  onExecute: () => void;
  onShowShortcuts: () => void;
}

const GROUPING_STEPS = [500, 1000, 2000, 3000, 5000, 10000, 15000, 30000, 60000];

const FILE_TYPE_CHIPS = ['jpg', 'png', 'tiff', 'webp'] as const;

// Words rather than star glyphs: the stars themselves are drawn as SVG paths
// (see StarRating), and a text ★ next to them renders as a different shape.
function formatRatingRange(range: RatingRange): string {
  if (isFullRatingRange(range)) return 'All';
  if (range.min === range.max) return range.min === MIN_RATING ? 'Unrated' : `${range.min}`;
  return `${range.min}–${range.max}`;
}

function formatThreshold(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${ms / 1000}s`;
}

function findClosestStep(ms: number): number {
  let closest = GROUPING_STEPS[0]!;
  let minDiff = Math.abs(ms - closest);
  for (const step of GROUPING_STEPS) {
    const diff = Math.abs(ms - step);
    if (diff < minDiff) {
      minDiff = diff;
      closest = step;
    }
  }
  return GROUPING_STEPS.indexOf(closest);
}

// Dropdown menu wrapper
function DropdownMenu({
  label,
  children,
  testId,
  tooltip,
}: {
  label: string;
  children: React.ReactNode;
  testId?: string;
  tooltip?: string;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative" data-testid={testId}>
      <button
        onClick={() => setOpen(!open)}
        className={`px-2 py-1 text-xs rounded transition-colors ${
          open ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'
        }`}
        title={tooltip}
      >
        {label} <span className="text-[10px]">{open ? '\u25B2' : '\u25BC'}</span>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-xl z-50 min-w-[200px] p-2 flex flex-col gap-2">
          {children}
        </div>
      )}
    </div>
  );
}

export function Toolbar({
  sortDirection,
  filterExtensions,
  filterRatingRange,
  searchQuery,
  thumbnailSize,
  groupingThresholdMs,
  visibleCount,
  selectionCount,
  scoringProgress,
  thumbnailProgress,
  folderPath,
  onSelectFolder,
  onRescan,
  onSortDirectionChange,
  onFilterExtensionsChange,
  onFilterRatingRangeChange,
  onSearchQueryChange,
  onThumbnailSizeChange,
  onGroupingThresholdChange,
  viewLayout,
  onSetViewLayout,
  onExecute,
  onShowShortcuts,
}: ToolbarProps): React.JSX.Element {
  const [localSearch, setLocalSearch] = useState(searchQuery);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sliderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocalSearch(searchQuery);
  }, [searchQuery]);

  const handleSearchChange = useCallback(
    (value: string) => {
      setLocalSearch(value);
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      searchTimerRef.current = setTimeout(() => {
        onSearchQueryChange(value);
      }, 300);
    },
    [onSearchQueryChange],
  );

  useEffect(() => {
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      if (sliderTimerRef.current) clearTimeout(sliderTimerRef.current);
    };
  }, []);

  const handleExtensionToggle = useCallback(
    (ext: string) => {
      const next = new Set(filterExtensions);
      if (next.has(ext)) {
        next.delete(ext);
      } else {
        next.add(ext);
      }
      onFilterExtensionsChange(next);
    },
    [filterExtensions, onFilterExtensionsChange],
  );

  // The two handles are independent inputs, so either can be dragged past the
  // other; normalizeRatingRange swaps them rather than showing nothing at all.
  const handleRatingMinChange = useCallback(
    (value: number) => {
      onFilterRatingRangeChange(normalizeRatingRange({ ...filterRatingRange, min: value }));
    },
    [filterRatingRange, onFilterRatingRangeChange],
  );

  const handleRatingMaxChange = useCallback(
    (value: number) => {
      onFilterRatingRangeChange(normalizeRatingRange({ ...filterRatingRange, max: value }));
    },
    [filterRatingRange, onFilterRatingRangeChange],
  );

  const handleSliderChange = useCallback(
    (stepIndex: number) => {
      const ms = GROUPING_STEPS[stepIndex] ?? 5000;
      if (sliderTimerRef.current) clearTimeout(sliderTimerRef.current);
      sliderTimerRef.current = setTimeout(() => {
        onGroupingThresholdChange(ms);
      }, 150);
    },
    [onGroupingThresholdChange],
  );

  const showScoringProgress =
    scoringProgress.total > 0 && scoringProgress.completed < scoringProgress.total;
  // Same rule as scoring: a counter sitting at its total is noise. Unlike
  // scoring this one can rest below the total indefinitely, because a folder is
  // only fully thumbnailed once every image has been on screen once.
  const showThumbnailProgress =
    thumbnailProgress.total > 0 && thumbnailProgress.completed < thumbnailProgress.total;

  const ratingFilterActive = !isFullRatingRange(filterRatingRange);

  // Active filter indicator
  const activeFilters: string[] = [];
  if (filterExtensions.size > 0) activeFilters.push('type');
  if (ratingFilterActive) activeFilters.push('rating');

  return (
    <div
      className="bg-gray-800 border-b border-gray-700 px-3 py-1.5 flex items-center gap-2"
      data-testid="toolbar"
    >
      <button
        onClick={onSelectFolder}
        className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 rounded text-xs font-medium transition-colors"
        data-testid="open-folder-btn"
        title="Open a folder to browse images (Cmd+O)"
      >
        Open
      </button>

      {folderPath && (
        <button
          onClick={onRescan}
          className="px-2 py-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded text-xs transition-colors"
          data-testid="rescan-btn"
          title="Rescan current folder — clears cached scores and re-processes all images"
        >
          &#x21BB; Rescan
        </button>
      )}

      {/* Sort direction — filename order is the only order, so this is all of it */}
      <button
        onClick={() => onSortDirectionChange(sortDirection === 'asc' ? 'desc' : 'asc')}
        className="px-2 py-1 text-xs rounded text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
        data-testid="sort-direction-btn"
        title="Sort by filename — ascending or descending"
      >
        {sortDirection === 'asc' ? '\u2191 A\u2013Z' : '\u2193 Z\u2013A'}
      </button>

      {/* Filter dropdown */}
      <DropdownMenu
        label={`Filter${activeFilters.length > 0 ? ` (${activeFilters.length})` : ''}`}
        testId="filter-menu"
        tooltip="Filter images by type or star rating"
      >
        {/* File type */}
        <div className="text-[10px] text-gray-500 uppercase tracking-wider px-1">File type</div>
        <div className="flex gap-1">
          {FILE_TYPE_CHIPS.map((ext) => (
            <button
              key={ext}
              onClick={() => handleExtensionToggle(ext)}
              className={`px-2 py-0.5 text-xs rounded transition-colors ${
                filterExtensions.size === 0 || filterExtensions.has(ext)
                  ? 'bg-gray-600 text-white'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
              data-testid={`filter-ext-${ext}`}
            >
              {ext.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Star rating — an inclusive window, min 0 meaning "unrated too" */}
        <div className="text-[10px] text-gray-500 uppercase tracking-wider px-1 mt-1">
          Rating: {formatRatingRange(filterRatingRange)}
          {ratingFilterActive && (
            <button
              onClick={() => onFilterRatingRangeChange(FULL_RATING_RANGE)}
              className="ml-1 text-gray-500 hover:text-white"
              title="Show every rating again"
              data-testid="rating-range-clear"
            >
              &times;
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 px-1">
          <span className="text-[10px] text-gray-500 w-3 text-right">{filterRatingRange.min}</span>
          <input
            type="range"
            min={MIN_RATING}
            max={MAX_RATING}
            step={1}
            value={filterRatingRange.min}
            onChange={(e) => handleRatingMinChange(Number(e.target.value))}
            className="flex-1 accent-amber-400"
            aria-label="Lowest rating to show"
            data-testid="rating-min-range"
          />
          <input
            type="range"
            min={MIN_RATING}
            max={MAX_RATING}
            step={1}
            value={filterRatingRange.max}
            onChange={(e) => handleRatingMaxChange(Number(e.target.value))}
            className="flex-1 accent-amber-400"
            aria-label="Highest rating to show"
            data-testid="rating-max-range"
          />
          <span className="text-[10px] text-gray-500 w-3">{filterRatingRange.max}</span>
        </div>
      </DropdownMenu>

      {/* View dropdown */}
      <DropdownMenu
        label="View"
        testId="view-menu"
        tooltip="Layout, thumbnail size, and burst grouping"
      >
        <div className="text-[10px] text-gray-500 uppercase tracking-wider px-1">Layout</div>
        <div className="flex gap-1 mb-2">
          {(['default', 'loupe', 'filmstrip'] as const).map((layout) => (
            <button
              key={layout}
              onClick={() => onSetViewLayout(layout)}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                viewLayout === layout
                  ? 'bg-gray-600 text-white'
                  : 'text-gray-400 hover:text-gray-300'
              }`}
              data-testid={`layout-${layout}`}
              title="Cycle with V"
            >
              {layout === 'default' ? 'Grid' : layout === 'loupe' ? 'Loupe' : 'Filmstrip'}
            </button>
          ))}
        </div>

        <div className="text-[10px] text-gray-500 uppercase tracking-wider px-1">
          Thumbnail size
        </div>
        <div className="flex gap-1">
          {(['small', 'medium', 'large'] as const).map((s) => (
            <button
              key={s}
              onClick={() => onThumbnailSizeChange(s)}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                thumbnailSize === s ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-gray-300'
              }`}
              data-testid={`size-${s}`}
            >
              {s === 'small' ? 'S' : s === 'medium' ? 'M' : 'L'}
            </button>
          ))}
        </div>

        <div className="text-[10px] text-gray-500 uppercase tracking-wider px-1 mt-1">
          Group threshold: {formatThreshold(groupingThresholdMs)}
        </div>
        <input
          type="range"
          min={0}
          max={GROUPING_STEPS.length - 1}
          step={1}
          value={findClosestStep(groupingThresholdMs)}
          onChange={(e) => handleSliderChange(Number(e.target.value))}
          className="w-full accent-blue-500"
          data-testid="grouping-range"
        />

        <div className="text-[10px] text-gray-600 px-1 mt-1">
          Click a thumbnail to focus it, a star to rate it, or press 0-5.
        </div>
      </DropdownMenu>

      {/* Search */}
      <div className="relative" data-testid="search-container">
        <svg
          className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          type="text"
          value={localSearch}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Search..."
          className="pl-6 pr-2 py-1 text-xs bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-500 w-28 focus:outline-none focus:border-blue-500 focus:w-40 transition-all"
          data-testid="search-input"
          title="Filter images by filename"
        />
      </div>

      {/* Shortcuts help */}
      <button
        onClick={onShowShortcuts}
        className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-300 border border-gray-600 rounded hover:text-white hover:bg-gray-700 hover:border-gray-500 transition-colors"
        data-testid="shortcuts-btn"
        title="Keyboard shortcuts and help (?)"
      >
        <span className="flex items-center justify-center w-3.5 h-3.5 rounded-full bg-gray-600 text-[9px] font-bold leading-none">
          ?
        </span>
        Help
      </button>

      {/* Spacer */}
      <div className="flex-1" />

      {selectionCount > 1 && (
        <span
          className="px-1.5 py-0.5 rounded bg-sky-900/70 text-sky-200 text-[10px] font-medium"
          data-testid="selection-count"
          title="Rating and Delete act on all of these"
        >
          {selectionCount} selected
        </span>
      )}

      {/* Progress indicator — only while active */}
      {showScoringProgress && (
        <span className="text-[10px] text-gray-500" data-testid="scoring-progress">
          Scoring {scoringProgress.completed}/{scoringProgress.total}
        </span>
      )}

      {showThumbnailProgress && (
        <span className="text-[10px] text-gray-500" data-testid="thumbnail-progress">
          Thumbs {thumbnailProgress.completed}/{thumbnailProgress.total}
        </span>
      )}

      {/* Execute — deletes the low-rated images among the visible ones */}
      <button
        onClick={onExecute}
        disabled={visibleCount === 0}
        className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
          visibleCount > 0
            ? 'bg-blue-600 hover:bg-blue-700'
            : 'bg-gray-600 cursor-not-allowed text-gray-400'
        }`}
        data-testid="execute-btn"
        title="Permanently delete low-rated images and apply rotations"
      >
        Execute
      </button>
    </div>
  );
}
