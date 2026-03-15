import { useState, useRef, useCallback, useEffect } from 'react';
import type { SortField, SortDirection } from '@photo-culler/image-utils/sorting';
import type { Classification } from './ThumbnailCell';

type ClassificationFilter = Classification | 'unclassified' | null;

interface ToolbarProps {
  sortField: SortField;
  sortDirection: SortDirection;
  filterExtensions: Set<string>;
  filterClassification: ClassificationFilter;
  searchQuery: string;
  thumbnailSize: 'small' | 'medium' | 'large';
  groupingThresholdMs: number;
  exifProgress: { completed: number; total: number };
  deleteCount: number;
  selectedCount: number;
  totalCount: number;
  filterStarRating: number | null;
  scoringProgress: { completed: number; total: number };
  onSelectFolder: () => void;
  onSortFieldChange: (field: SortField) => void;
  onSortDirectionChange: (direction: SortDirection) => void;
  onFilterExtensionsChange: (extensions: Set<string>) => void;
  onFilterClassificationChange: (classification: ClassificationFilter) => void;
  onSearchQueryChange: (query: string) => void;
  onThumbnailSizeChange: (size: 'small' | 'medium' | 'large') => void;
  onGroupingThresholdChange: (ms: number) => void;
  onFilterStarRatingChange: (rating: number | null) => void;
  onExecute: () => void;
  onDeleteSelected: () => void;
}

const SORT_OPTIONS: Array<{ value: SortField; label: string }> = [
  { value: 'dateTaken', label: 'Timestamp' },
  { value: 'filename', label: 'Filename' },
  { value: 'size', label: 'File Size' },
  { value: 'dimensions', label: 'Dimensions' },
  { value: 'qualityScore', label: 'Quality' },
];

const GROUPING_STEPS = [500, 1000, 2000, 3000, 5000, 10000, 15000, 30000, 60000];

const FILE_TYPE_CHIPS = ['jpg', 'png', 'tiff', 'webp'] as const;

const CLASSIFICATION_CHIPS: Array<{ value: ClassificationFilter; label: string; color: string; activeColor: string }> = [
  { value: 'unclassified', label: 'None', color: 'text-gray-400', activeColor: 'bg-gray-700 text-gray-300 border-gray-500' },
  { value: 'keep', label: 'Keep', color: 'text-green-400', activeColor: 'bg-green-900 text-green-300 border-green-500' },
  { value: 'review', label: 'Review', color: 'text-yellow-400', activeColor: 'bg-yellow-900 text-yellow-300 border-yellow-500' },
  { value: 'delete', label: 'Delete', color: 'text-red-400', activeColor: 'bg-red-900 text-red-300 border-red-500' },
];

const STAR_FILTER_CHIPS: Array<{ value: number; label: string }> = [
  { value: 0, label: 'Unrated' },
  { value: 1, label: '1+' },
  { value: 2, label: '2+' },
  { value: 3, label: '3+' },
  { value: 4, label: '4+' },
  { value: 5, label: '5' },
];

const SIZE_OPTIONS: Array<{ value: 'small' | 'medium' | 'large'; label: string }> = [
  { value: 'small', label: 'S' },
  { value: 'medium', label: 'M' },
  { value: 'large', label: 'L' },
];

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

export function Toolbar({
  sortField,
  sortDirection,
  filterExtensions,
  filterClassification,
  searchQuery,
  thumbnailSize,
  groupingThresholdMs,
  exifProgress,
  deleteCount,
  selectedCount,
  totalCount,
  filterStarRating,
  scoringProgress,
  onSelectFolder,
  onSortFieldChange,
  onSortDirectionChange,
  onFilterExtensionsChange,
  onFilterClassificationChange,
  onSearchQueryChange,
  onThumbnailSizeChange,
  onGroupingThresholdChange,
  onFilterStarRatingChange,
  onExecute,
  onDeleteSelected,
}: ToolbarProps): React.JSX.Element {
  const [localSearch, setLocalSearch] = useState(searchQuery);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sliderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync external search query changes
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

  // Cleanup timers
  useEffect(() => {
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      if (sliderTimerRef.current) clearTimeout(sliderTimerRef.current);
    };
  }, []);

  const handleSortClick = useCallback(
    (field: SortField) => {
      if (field === sortField) {
        onSortDirectionChange(sortDirection === 'asc' ? 'desc' : 'asc');
      } else {
        onSortFieldChange(field);
        onSortDirectionChange('asc');
      }
    },
    [sortField, sortDirection, onSortFieldChange, onSortDirectionChange],
  );

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

  const handleClassificationToggle = useCallback(
    (cls: ClassificationFilter) => {
      onFilterClassificationChange(filterClassification === cls ? null : cls);
    },
    [filterClassification, onFilterClassificationChange],
  );

  const handleStarFilterToggle = useCallback(
    (value: number) => {
      onFilterStarRatingChange(filterStarRating === value ? null : value);
    },
    [filterStarRating, onFilterStarRatingChange],
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

  const showExifProgress = exifProgress.total > 0 && exifProgress.completed < exifProgress.total;
  const showScoringProgress = scoringProgress.total > 0 && scoringProgress.completed < scoringProgress.total;

  return (
    <div
      className="bg-gray-800 border-b border-gray-700 px-4 py-2 flex items-center gap-4 flex-wrap"
      data-testid="toolbar"
    >
      {/* Left: Open Folder + Sort */}
      <button
        onClick={onSelectFolder}
        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium transition-colors"
        data-testid="open-folder-btn"
      >
        Open Folder
      </button>

      <div className="flex items-center gap-1" data-testid="sort-controls">
        {SORT_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => handleSortClick(opt.value)}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              sortField === opt.value
                ? 'bg-gray-600 text-white'
                : 'text-gray-400 hover:text-white hover:bg-gray-700'
            }`}
            data-testid={`sort-${opt.value}`}
          >
            {opt.label}
            {sortField === opt.value && (
              <span className="ml-1">{sortDirection === 'asc' ? '\u2191' : '\u2193'}</span>
            )}
          </button>
        ))}
      </div>

      {/* Center: Grouping slider */}
      <div className="flex items-center gap-2" data-testid="grouping-slider">
        <label className="text-xs text-gray-400">Group:</label>
        <input
          type="range"
          min={0}
          max={GROUPING_STEPS.length - 1}
          step={1}
          value={findClosestStep(groupingThresholdMs)}
          onChange={(e) => handleSliderChange(Number(e.target.value))}
          className="w-24 accent-blue-500"
          data-testid="grouping-range"
        />
        <span className="text-xs text-gray-400 w-10">
          {formatThreshold(groupingThresholdMs)}
        </span>
      </div>

      {/* Right: Filters, Search, Size */}
      <div className="flex items-center gap-1" data-testid="extension-filters">
        {FILE_TYPE_CHIPS.map((ext) => (
          <button
            key={ext}
            onClick={() => handleExtensionToggle(ext)}
            className={`px-2 py-0.5 text-xs rounded border transition-colors ${
              filterExtensions.size === 0 || filterExtensions.has(ext)
                ? 'bg-gray-600 text-white border-gray-500'
                : 'text-gray-500 border-gray-700 hover:border-gray-500'
            }`}
            data-testid={`filter-ext-${ext}`}
          >
            {ext.toUpperCase()}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1" data-testid="classification-filters">
        {CLASSIFICATION_CHIPS.map((chip) => (
          <button
            key={String(chip.value)}
            onClick={() => handleClassificationToggle(chip.value)}
            className={`px-2 py-0.5 text-xs rounded border transition-colors ${
              filterClassification === chip.value
                ? chip.activeColor
                : `${chip.color} border-gray-700 hover:border-gray-500`
            }`}
            data-testid={`filter-cls-${chip.value}`}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1" data-testid="star-filters">
        {STAR_FILTER_CHIPS.map((chip) => (
          <button
            key={chip.value}
            onClick={() => handleStarFilterToggle(chip.value)}
            className={`px-2 py-0.5 text-xs rounded border transition-colors ${
              filterStarRating === chip.value
                ? 'bg-yellow-900 text-yellow-300 border-yellow-500'
                : 'text-yellow-600 border-gray-700 hover:border-gray-500'
            }`}
            data-testid={`filter-star-${chip.value}`}
          >
            {chip.value > 0 ? '\u2605'.repeat(Math.min(chip.value, 3)) : ''} {chip.label}
          </button>
        ))}
      </div>

      <div className="relative" data-testid="search-container">
        <svg
          className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500"
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
          placeholder="Search by filename..."
          className="pl-7 pr-2 py-1 text-xs bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-500 w-40 focus:outline-none focus:border-blue-500"
          data-testid="search-input"
        />
      </div>

      <div className="flex items-center gap-0.5" data-testid="size-toggle">
        {SIZE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onThumbnailSizeChange(opt.value)}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              thumbnailSize === opt.value
                ? 'bg-gray-600 text-white'
                : 'text-gray-400 hover:text-white hover:bg-gray-700'
            }`}
            data-testid={`size-${opt.value}`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Spacer to push execute button right */}
      <div className="flex-1" />

      {/* Selection count and trash button */}
      {selectedCount > 0 && (
        <span className="text-sm text-blue-400" data-testid="selection-count">
          {selectedCount} of {totalCount} selected
        </span>
      )}
      {selectedCount > 0 && (
        <button
          onClick={onDeleteSelected}
          className="px-3 py-1.5 bg-red-600 hover:bg-red-700 rounded text-sm font-medium transition-colors"
          data-testid="delete-selected-btn"
        >
          Trash Selected ({selectedCount})
        </button>
      )}

      {/* EXIF progress */}
      {showExifProgress && (
        <span className="text-xs text-gray-500" data-testid="exif-progress">
          Extracting metadata: {exifProgress.completed}/{exifProgress.total}
        </span>
      )}

      {/* Scoring progress */}
      {showScoringProgress && (
        <span className="text-xs text-gray-500" data-testid="scoring-progress">
          Scoring: {scoringProgress.completed}/{scoringProgress.total}
        </span>
      )}

      {/* Execute button */}
      <button
        onClick={onExecute}
        disabled={deleteCount === 0}
        className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
          deleteCount > 0
            ? 'bg-red-600 hover:bg-red-700'
            : 'bg-gray-600 cursor-not-allowed text-gray-400'
        }`}
        data-testid="execute-btn"
      >
        Execute{deleteCount > 0 ? ` (${deleteCount})` : ''}
      </button>
    </div>
  );
}
