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
  keepCount: number;
  selectedCount: number;
  totalCount: number;
  filterScoreRange: { min: number; max: number } | null;
  scoringProgress: { completed: number; total: number };
  selectOnHover: boolean;
  folderPath: string | null;
  onSelectFolder: () => void;
  onRescan: () => void;
  onSortFieldChange: (field: SortField) => void;
  onSortDirectionChange: (direction: SortDirection) => void;
  onFilterExtensionsChange: (extensions: Set<string>) => void;
  onFilterClassificationChange: (classification: ClassificationFilter) => void;
  onSearchQueryChange: (query: string) => void;
  onThumbnailSizeChange: (size: 'small' | 'medium' | 'large') => void;
  onGroupingThresholdChange: (ms: number) => void;
  onFilterScoreRangeChange: (range: { min: number; max: number } | null) => void;
  onToggleSelectMode: () => void;
  onExecute: () => void;
  onDeleteSelected: () => void;
  onShowShortcuts: () => void;
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

const CLASSIFICATION_CHIPS: Array<{
  value: ClassificationFilter;
  label: string;
  activeColor: string;
}> = [
  { value: 'unclassified', label: 'None', activeColor: 'bg-gray-600 text-gray-300' },
  { value: 'keep', label: 'Keep', activeColor: 'bg-green-900 text-green-300' },
  { value: 'review', label: 'Review', activeColor: 'bg-yellow-900 text-yellow-300' },
  { value: 'delete', label: 'Delete', activeColor: 'bg-red-900 text-red-300' },
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
  sortField,
  sortDirection,
  filterExtensions,
  filterClassification,
  searchQuery,
  thumbnailSize,
  groupingThresholdMs,
  exifProgress,
  deleteCount,
  keepCount,
  selectedCount,
  totalCount,
  filterScoreRange,
  scoringProgress,
  folderPath,
  onSelectFolder,
  onRescan,
  onSortFieldChange,
  onSortDirectionChange,
  onFilterExtensionsChange,
  onFilterClassificationChange,
  onSearchQueryChange,
  onThumbnailSizeChange,
  onGroupingThresholdChange,
  onFilterScoreRangeChange,
  selectOnHover,
  onToggleSelectMode,
  onExecute,
  onDeleteSelected,
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

  const handleScoreMinChange = useCallback(
    (value: number) => {
      const max = filterScoreRange?.max ?? 100;
      if (value === 0 && max === 100) {
        onFilterScoreRangeChange(null);
      } else {
        onFilterScoreRangeChange({ min: value, max: Math.max(value, max) });
      }
    },
    [filterScoreRange, onFilterScoreRangeChange],
  );

  const handleScoreMaxChange = useCallback(
    (value: number) => {
      const min = filterScoreRange?.min ?? 0;
      if (min === 0 && value === 100) {
        onFilterScoreRangeChange(null);
      } else {
        onFilterScoreRangeChange({ min: Math.min(min, value), max: value });
      }
    },
    [filterScoreRange, onFilterScoreRangeChange],
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
  const showScoringProgress =
    scoringProgress.total > 0 && scoringProgress.completed < scoringProgress.total;

  // Active filter indicator
  const activeFilters: string[] = [];
  if (filterExtensions.size > 0) activeFilters.push('type');
  if (filterClassification) activeFilters.push('class');
  if (filterScoreRange) activeFilters.push('score');

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

      {/* Sort dropdown */}
      <DropdownMenu
        label={`Sort: ${SORT_OPTIONS.find((o) => o.value === sortField)?.label ?? ''}`}
        testId="sort-menu"
        tooltip="Change image sort order"
      >
        <div className="text-[10px] text-gray-500 uppercase tracking-wider px-1">Sort by</div>
        {SORT_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => handleSortClick(opt.value)}
            className={`px-2 py-1 text-xs rounded text-left transition-colors ${
              sortField === opt.value ? 'bg-gray-600 text-white' : 'text-gray-300 hover:bg-gray-700'
            }`}
            data-testid={`sort-${opt.value}`}
          >
            {opt.label}
            {sortField === opt.value && (
              <span className="ml-2 text-gray-400">
                {sortDirection === 'asc' ? '\u2191 Asc' : '\u2193 Desc'}
              </span>
            )}
          </button>
        ))}
      </DropdownMenu>

      {/* Filter dropdown */}
      <DropdownMenu
        label={`Filter${activeFilters.length > 0 ? ` (${activeFilters.length})` : ''}`}
        testId="filter-menu"
        tooltip="Filter images by type, classification, or quality score"
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

        {/* Classification */}
        <div className="text-[10px] text-gray-500 uppercase tracking-wider px-1 mt-1">
          Classification
        </div>
        <div className="flex gap-1">
          {CLASSIFICATION_CHIPS.map((chip) => (
            <button
              key={String(chip.value)}
              onClick={() => handleClassificationToggle(chip.value)}
              className={`px-2 py-0.5 text-xs rounded transition-colors ${
                filterClassification === chip.value
                  ? chip.activeColor
                  : 'text-gray-400 hover:text-gray-300'
              }`}
              data-testid={`filter-cls-${chip.value}`}
            >
              {chip.label}
            </button>
          ))}
        </div>

        {/* Score range */}
        <div className="text-[10px] text-gray-500 uppercase tracking-wider px-1 mt-1">
          Score: {filterScoreRange ? `${filterScoreRange.min}–${filterScoreRange.max}` : 'All'}
          {filterScoreRange && (
            <button
              onClick={() => onFilterScoreRangeChange(null)}
              className="ml-1 text-gray-500 hover:text-white"
            >
              &times;
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 px-1">
          <span className="text-[10px] text-gray-500 w-4">{filterScoreRange?.min ?? 0}</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={filterScoreRange?.min ?? 0}
            onChange={(e) => handleScoreMinChange(Number(e.target.value))}
            className="flex-1 accent-blue-500"
            data-testid="score-min-range"
          />
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={filterScoreRange?.max ?? 100}
            onChange={(e) => handleScoreMaxChange(Number(e.target.value))}
            className="flex-1 accent-blue-500"
            data-testid="score-max-range"
          />
          <span className="text-[10px] text-gray-500 w-6">{filterScoreRange?.max ?? 100}</span>
        </div>
      </DropdownMenu>

      {/* View dropdown */}
      <DropdownMenu
        label="View"
        testId="view-menu"
        tooltip="Thumbnail size, grouping, and selection mode"
      >
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

        <div className="text-[10px] text-gray-500 uppercase tracking-wider px-1 mt-1">
          Selection mode
        </div>
        <button
          onClick={onToggleSelectMode}
          className={`px-2 py-1 text-xs rounded transition-colors ${
            selectOnHover ? 'bg-cyan-900 text-cyan-300' : 'bg-gray-700 text-gray-300'
          }`}
          data-testid="select-mode-toggle"
        >
          {selectOnHover ? 'Hover to select' : 'Click to select'}
        </button>
        <div className="text-[10px] text-gray-600 px-1">
          {selectOnHover
            ? 'Move mouse over thumbnail to focus it. Right-click to classify.'
            : 'Left-click to focus. Right-click to classify.'}
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
        className="px-2 py-1 text-xs text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
        data-testid="shortcuts-btn"
        title="Keyboard shortcuts (?)"
      >
        ?
      </button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Progress indicators — only while active */}
      {showExifProgress && (
        <span className="text-[10px] text-gray-500" data-testid="exif-progress">
          EXIF {exifProgress.completed}/{exifProgress.total}
        </span>
      )}
      {showScoringProgress && (
        <span className="text-[10px] text-gray-500" data-testid="scoring-progress">
          Scoring {scoringProgress.completed}/{scoringProgress.total}
        </span>
      )}

      {/* Selection */}
      {selectedCount > 0 && (
        <span className="text-xs text-blue-400" data-testid="selection-count">
          {selectedCount}/{totalCount}
        </span>
      )}
      {selectedCount > 0 && (
        <button
          onClick={onDeleteSelected}
          className="px-2 py-1 bg-red-600 hover:bg-red-700 rounded text-xs font-medium transition-colors"
          data-testid="delete-selected-btn"
          title="Move selected images to OS trash (recoverable)"
        >
          Trash ({selectedCount})
        </button>
      )}

      {/* Save / Delete — execute actions on classified images */}
      <button
        onClick={onExecute}
        disabled={deleteCount === 0 && keepCount === 0}
        className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
          deleteCount > 0 || keepCount > 0
            ? 'bg-blue-600 hover:bg-blue-700'
            : 'bg-gray-600 cursor-not-allowed text-gray-400'
        }`}
        data-testid="execute-btn"
        title="Execute actions: save keeps, delete rejects, apply rotations"
      >
        Save / Delete
      </button>
    </div>
  );
}
