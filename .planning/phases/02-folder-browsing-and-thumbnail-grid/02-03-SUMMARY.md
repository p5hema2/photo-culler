---
phase: 02-folder-browsing-and-thumbnail-grid
plan: 03
subsystem: desktop-renderer
tags: [virtualized-grid, tanstack-virtual, toolbar, drag-and-drop, keyboard-nav, filtering, grouping, vitest]
dependency_graph:
  requires: [02-01, 02-02]
  provides: [usePhotoStore, PhotoGrid, GroupRow, ThumbnailCell, Toolbar, DropZone, useKeyboardNav, useGrouping, EmptyState]
  affects: [02-04]
tech_stack:
  added: ["@tanstack/react-virtual"]
  patterns: [group-level virtualization, renderer-safe aliases for image-utils, debounced search/slider, drag counter pattern]
key_files:
  created:
    - apps/desktop/src/renderer/src/hooks/usePhotoStore.ts
    - apps/desktop/src/renderer/src/hooks/useGrouping.ts
    - apps/desktop/src/renderer/src/hooks/useKeyboardNav.ts
    - apps/desktop/src/renderer/src/components/PhotoGrid.tsx
    - apps/desktop/src/renderer/src/components/GroupRow.tsx
    - apps/desktop/src/renderer/src/components/ThumbnailCell.tsx
    - apps/desktop/src/renderer/src/components/Toolbar.tsx
    - apps/desktop/src/renderer/src/components/DropZone.tsx
    - apps/desktop/src/renderer/src/components/EmptyState.tsx
    - apps/desktop/src/renderer/src/__tests__/photo-grid.test.ts
    - apps/desktop/src/renderer/src/__tests__/keyboard-nav.test.ts
    - apps/desktop/src/renderer/src/__tests__/filtering.test.ts
    - apps/desktop/src/renderer/src/__tests__/drop-zone.test.ts
  modified:
    - apps/desktop/src/renderer/src/App.tsx
    - apps/desktop/electron.vite.config.ts
    - apps/desktop/vitest.config.ts
    - apps/desktop/package.json
decisions:
  - Renderer-safe aliases for image-utils/sorting and image-utils/grouping to avoid bundling node:fs scanner
  - Classification cycle order review -> keep -> delete -> review (matches plan)
  - Group heights computed as headerHeight(32) + rows * cellSize + dividerHeight(16)
metrics:
  duration: 10 min
  completed: "2026-03-14T18:32:00Z"
  tasks: 2/2
  tests: 45 new (74 total desktop tests passing)
---

# Phase 2 Plan 3: Virtualized Grouped Grid UI, Toolbar, Drag-and-Drop, Keyboard Navigation Summary

Virtualized grouped photo grid using @tanstack/react-virtual with group-level row virtualization, central state hook managing filtering/sorting/grouping derived data, toolbar with sort/filter/search/grouping slider/thumbnail size controls, full-window drag-and-drop folder opening, arrow-key grid navigation, and 45 tests across 4 files.

## What Was Built

### Task 1: Central State Hook, Grouping Hook, and Core Components

**usePhotoStore** (`hooks/usePhotoStore.ts`):
- Central state management with `useState` (no external state library)
- `openFolder`: scan, load results, restore classifications, trigger EXIF extraction, persist session
- Derived state via `useMemo`: filteredImages (extension + classification + search), sortedImages, groups
- Classification cycling (review -> keep -> delete -> review) with debounced auto-save
- All setter methods for sort/filter/search/size/threshold with session persistence
- Auto-opens last folder on mount from session store

**useGrouping** (`hooks/useGrouping.ts`):
- Thin wrapper around `groupByTimestamp` that computes `getGroupHeight(index)` for virtualizer
- Height formula: `HEADER_HEIGHT(32) + ceil(images/imagesPerRow) * cellSize + DIVIDER_HEIGHT(16)`
- `imagesPerRow = max(1, floor(containerWidth / cellSize))`

**PhotoGrid** (`components/PhotoGrid.tsx`):
- `useVirtualizer` from @tanstack/react-virtual with group-level virtualization
- Absolutely positioned virtual items with `translateY(start)`
- ResizeObserver tracking container width for responsive layout
- Visible range updates sent to thumbnail worker for priority loading
- Thumbnail size map: small=120, medium=200, large=300

**GroupRow** (`components/GroupRow.tsx`):
- Group header: "Series: N photos [time range]" with classification summary
- Time range formatted as HH:MM:SS -- HH:MM:SS
- Flex-wrap container of ThumbnailCell components
- HR-style divider at bottom

**ThumbnailCell** (`components/ThumbnailCell.tsx`):
- Canvas-based rendering of ImageBitmap from thumbnail worker
- Loading state: gray pulse animation placeholder
- Error state: broken-image SVG icon
- Classification borders: green (keep), yellow (review), red (delete) -- 3px solid
- Focus ring: ring-2 ring-blue-400

**EmptyState** (`components/EmptyState.tsx`):
- Folder icon + "No images found in this folder" message

### Task 2: Toolbar, DropZone, Keyboard Navigation, App Wiring, Tests

**Toolbar** (`components/Toolbar.tsx`):
- Open Folder button, sort buttons with direction toggle
- Grouping slider: discrete steps (500ms-60000ms), 150ms debounce
- File type filter chips: JPG/PNG/TIFF/WebP toggleable
- Classification filter chips: Keep/Review/Delete single-select with colored styling
- Search input: 300ms debounced, case-insensitive
- Thumbnail size toggle: S/M/L buttons
- EXIF extraction progress indicator

**DropZone** (`components/DropZone.tsx`):
- Full-window drag target using drag counter pattern for nested element handling
- `webkitGetAsEntry()` for directory detection
- Electron `File.path` for folder path extraction
- Semi-transparent blue overlay during drag-over
- Error toast "Drop a folder, not a file" with 3-second auto-dismiss

**useKeyboardNav** (`hooks/useKeyboardNav.ts`):
- Left/Right: navigate within group, wrap to next/prev group at boundaries
- Up/Down: same column position in adjacent group, clamped to last image
- Home/End: first/last image globally
- Space: cycle classification of focused image
- Attaches keydown listener to container ref

**App.tsx** (rewritten):
- DropZone wrapping full app
- Toolbar always visible
- Content area: WelcomeState -> LoadingState -> EmptyState -> PhotoGrid
- Error banner for permission errors with dismiss button
- Menu event listener for Cmd+O
- Session auto-load on mount

**Tests (45 passing)**:
- `photo-grid.test.ts` (10): Thumbnail size map, group height calculations, multi-row groups, empty state
- `keyboard-nav.test.ts` (14): Arrow navigation, group wrapping, clamping, Home/End, Space classification
- `filtering.test.ts` (13): Extension filters, classification filters, search, combined filters
- `drop-zone.test.ts` (7+1): Drag overlay, directory detection, file rejection, auto-dismiss timer, cleanup

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | c949fa7 | Central state hook, grouping hook, and core grid components |
| 2 | d3cfa74 | Toolbar, drop zone, keyboard nav, App wiring, and tests |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Renderer cannot import @photo-culler/image-utils barrel**
- **Found during:** Task 1 build verification
- **Issue:** Importing from `@photo-culler/image-utils` barrel index pulls in `scanner.ts` which uses `node:fs/promises` and `node:path` -- these are externalized for browser compatibility and cause Vite build failure
- **Fix:** Added renderer-safe path aliases `@photo-culler/image-utils/sorting` and `@photo-culler/image-utils/grouping` in `electron.vite.config.ts` and `vitest.config.ts`, updated all renderer imports
- **Files modified:** `electron.vite.config.ts`, `vitest.config.ts`, all renderer files importing from image-utils

**2. [Rule 1 - Bug] DOM not cleaned between drop-zone tests**
- **Found during:** Task 2 test execution
- **Issue:** Multiple `render()` calls accumulated DOM elements, causing `getByTestId` to find duplicates
- **Fix:** Added `cleanup()` call in `afterEach` for drop-zone tests
- **Files modified:** `drop-zone.test.ts`

## Verification

- `pnpm --filter @photo-culler/desktop exec electron-vite build` -- succeeds (main, preload, renderer)
- `pnpm --filter @photo-culler/desktop exec vitest run` -- 74/74 tests pass (8 test files)
- PhotoGrid uses @tanstack/react-virtual useVirtualizer
- ThumbnailCell renders canvas with classification borders
- Toolbar includes all controls: sort, filter, search, grouping slider, size toggle
- DropZone uses webkitGetAsEntry for directory detection
- App.tsx handles all view states (welcome, loading, empty, grid, error)

## Self-Check: PASSED
