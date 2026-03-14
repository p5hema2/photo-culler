---
phase: 02-folder-browsing-and-thumbnail-grid
plan: 01
subsystem: image-utils, types
tags: [tdd, pure-functions, scanner, grouping, sorting, vitest]
dependency_graph:
  requires: [01-02]
  provides: [scanFolder, groupByTimestamp, sortImages, ImageFileInfo.dateTaken, SessionConfig, ResultsFile, Vitest configs]
  affects: [02-02, 02-03, 02-04]
tech_stack:
  added: [natural-orderby, vitest]
  patterns: [TDD red-green-refactor, pure functions, fs mocking]
key_files:
  created:
    - packages/image-utils/src/scanner.ts
    - packages/image-utils/src/grouping.ts
    - packages/image-utils/src/sorting.ts
    - packages/image-utils/src/__tests__/scanner.test.ts
    - packages/image-utils/src/__tests__/grouping.test.ts
    - packages/image-utils/src/__tests__/sorting.test.ts
    - packages/image-utils/vitest.config.ts
    - apps/desktop/vitest.config.ts
  modified:
    - packages/types/src/image.ts
    - packages/types/src/ipc.ts
    - packages/types/src/index.ts
    - packages/image-utils/package.json
    - packages/image-utils/src/index.ts
    - pnpm-lock.yaml
key_decisions:
  - natural-orderby v5 for filename sorting (lightweight, well-maintained)
  - Group IDs use sequential index-based scheme (group-0, group-1, etc.)
  - Scanner returns flat array combining main folder and picks/ subfolder
metrics:
  duration: 5 min
  completed: 2026-03-14
  tasks_completed: 2
  tasks_total: 2
  tests_added: 28
  tests_passing: 28
---

# Phase 2 Plan 01: Types, Scanner, Grouping, and Sorting Summary

Extended shared types with EXIF dateTaken field, session/results IPC channels, and implemented folder scanning, timestamp-based grouping, and multi-field sorting as TDD-tested pure functions in image-utils.

## What Was Built

### Type Extensions (packages/types)
- Added `dateTaken?: number` to `ImageFileInfo` for EXIF DateTimeOriginal timestamps
- Added 5 new IPC channels: SAVE_RESULTS, LOAD_RESULTS, GET_SESSION, SET_SESSION, MOVE_TO_PICKS
- Added `SessionConfig` interface (lastFolderPath, thumbnailSize, groupingThresholdMs)
- Added `ResultsFile` and `ImageResult` interfaces for per-image classification persistence
- Extended `ElectronAPI` with corresponding typed methods

### Scanner (packages/image-utils/src/scanner.ts)
- `scanFolder(folderPath)` reads directory entries with `fs.readdir` + `fs.stat`
- Supports .jpg, .jpeg, .png, .tiff, .tif, .webp (case-insensitive)
- Excludes hidden files, system files, and photo-culler-results.json
- Includes images from `picks/` subfolder when present (graceful ENOENT handling)
- Returns `ImageFileInfo[]` with path, name, extension, size, lastModified

### Grouping (packages/image-utils/src/grouping.ts)
- `groupByTimestamp(images, thresholdMs)` clusters pre-sorted images by timestamp proximity
- Uses `dateTaken` with `lastModified` fallback for timestamp comparison
- Each `PhotoGroup` has id, images array, startTime, and endTime
- Handles edge cases: empty input, single image, zero threshold, large threshold

### Sorting (packages/image-utils/src/sorting.ts)
- `sortImages(images, field, direction)` returns new sorted array (immutable)
- Four sort fields: filename (natural sort), dateTaken, size, dimensions
- Natural sort via `natural-orderby` ensures IMG_2 sorts before IMG_10
- Images missing dateTaken or dimensions sort to end regardless of direction

### Test Infrastructure
- Vitest config for image-utils (node environment)
- Vitest config for desktop app (jsdom environment for future renderer tests)
- 28 tests across 3 test files, all passing

## Commits

| Commit | Type | Description |
|--------|------|-------------|
| 0d43888 | feat | Extend types, add Vitest configs, install deps |
| 062d816 | test | RED: Add failing tests for scanner, grouping, sorting |
| 83624f2 | feat | GREEN: Implement scanner, grouping, sorting (28/28 pass) |

## Deviations from Plan

None -- plan executed exactly as written.

## Verification

- `pnpm --filter @photo-culler/image-utils exec vitest run` -- 28/28 tests pass
- `pnpm install` succeeds
- All new types exported from `packages/types/src/index.ts`
- All functions exported from `packages/image-utils/src/index.ts`
