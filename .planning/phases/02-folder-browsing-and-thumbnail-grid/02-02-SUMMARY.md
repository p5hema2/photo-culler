---
phase: 02-folder-browsing-and-thumbnail-grid
plan: 02
subsystem: desktop-main, desktop-renderer, types
tags: [ipc, electron-store, web-workers, thumbnails, exif, hooks, vitest]
dependency_graph:
  requires: [02-01]
  provides: [IPC handlers, sessionStore, thumbnail worker, EXIF worker, useThumbnailWorker, useExifExtractor, useDebouncedSave, Cmd+O shortcut]
  affects: [02-03, 02-04]
tech_stack:
  added: [electron-store, exifr, @testing-library/react, jsdom]
  patterns: [Web Workers with OffscreenCanvas, worker pool with priority queue, debounced auto-save, write queue for concurrent writes]
key_files:
  created:
    - apps/desktop/src/main/store.ts
    - apps/desktop/src/renderer/src/workers/thumbnail.worker.ts
    - apps/desktop/src/renderer/src/workers/exif.worker.ts
    - apps/desktop/src/renderer/src/hooks/useThumbnailWorker.ts
    - apps/desktop/src/renderer/src/hooks/useExifExtractor.ts
    - apps/desktop/src/renderer/src/lib/results.ts
    - apps/desktop/src/main/__tests__/store.test.ts
    - apps/desktop/src/renderer/src/__tests__/folder-selection.test.ts
    - apps/desktop/src/renderer/src/__tests__/thumbnail-worker.test.ts
    - apps/desktop/src/renderer/src/__tests__/results.test.ts
  modified:
    - apps/desktop/src/main/ipc-handlers.ts
    - apps/desktop/src/main/index.ts
    - apps/desktop/src/preload/index.ts
    - apps/desktop/electron.vite.config.ts
    - apps/desktop/package.json
    - apps/desktop/vitest.config.ts
    - packages/types/src/window.d.ts
decisions:
  - electron-store excluded from Vite externalization to handle ESM-only package
  - ImageBitmap check uses duck typing instead of instanceof for jsdom test compatibility
  - Vitest environmentMatchGlobs separates node (main) and jsdom (renderer) test environments
  - Write queue pattern for results file prevents concurrent write corruption
  - menuEvents exposed as separate contextBridge namespace alongside api
metrics:
  duration: 8 min
  completed: "2026-03-14T18:17:00Z"
  tasks: 2/2
  tests: 29 passing
---

# Phase 2 Plan 2: IPC Handlers, Workers, and Hooks Summary

Real IPC handlers with disk scanning via image-utils, electron-store session persistence, Web Workers for off-thread thumbnail generation (256x256 JPEG via createImageBitmap + OffscreenCanvas) and EXIF extraction (exifr), worker pool with priority queue for visible thumbnails, debounced results auto-save, and Cmd+O shortcut.

## What Was Built

### Task 1: Main Process IPC Handlers, Session Store, Cmd+O

**IPC Handlers** (`ipc-handlers.ts`):
- `SCAN_FOLDER`: Delegates to `scanFolder` from `@photo-culler/image-utils`
- `SAVE_RESULTS`: Writes `photo-culler-results.json` with write queue to prevent corruption from concurrent saves
- `LOAD_RESULTS`: Reads results file, returns null on ENOENT
- `GET_SESSION` / `SET_SESSION`: Reads/writes electron-store session persistence
- `MOVE_TO_PICKS`: Creates `picks/` subfolder, moves files via `fs.rename`
- `TRASH_FILES`: Uses `shell.trashItem()` for OS-native trash

**Session Store** (`store.ts`):
- electron-store with typed schema for `SessionConfig`
- Defaults: `thumbnailSize: 'medium'`, `groupingThresholdMs: 5000`
- `getSession()` and `updateSession(partial)` with merge semantics

**Cmd+O Shortcut**: Added to File menu with `CmdOrCtrl+O` accelerator. Opens folder dialog and sends path to renderer via `webContents.send('menu:open-folder')`.

**Preload**: All 8 API methods exposed via `window.api`, plus `window.menuEvents.onOpenFolder` for menu events.

**Build Config**: electron-store excluded from externalization (ESM-only package fix), `@photo-culler/image-utils` alias added.

### Task 2: Web Workers, Renderer Hooks, Tests

**Thumbnail Worker** (`thumbnail.worker.ts`):
- Fetches image via `app://` protocol
- `createImageBitmap()` for off-thread decode
- Center-crop to target size via `OffscreenCanvas` with object-fit:cover math
- Converts to JPEG at 0.8 quality, transfers `ImageBitmap` back (zero-copy)
- Graceful error handling for corrupt/TIFF files

**EXIF Worker** (`exif.worker.ts`):
- Processes batch of files via `exifr.parse()` with `pick: ['DateTimeOriginal', 'ImageWidth', 'ImageHeight']`
- Streams results back individually as each file completes
- Per-file error isolation (one bad file doesn't stop the batch)
- Sends `{ done: true }` on completion

**useThumbnailWorker Hook**:
- Creates `navigator.hardwareConcurrency` workers on mount
- Priority queue: visible-range items dispatched first
- `requestThumbnail` / `getThumbnail` / `updateVisibleRange` / `clearAll` API
- `clearAll` terminates workers, closes ImageBitmaps, creates fresh pool

**useExifExtractor Hook**:
- Single-worker batch processing with progress tracking
- `extractAll(files, onResult)` with streaming callback
- Auto-terminates worker on completion

**Results Hooks** (`lib/results.ts`):
- `loadResults`: Parse + validate JSON, returns null on missing/invalid
- `saveResults`: Serialize with updated timestamp
- `useDebouncedSave`: 500ms debounce, coalesces rapid changes, flushes on unmount

**Tests (29 passing)**:
- `store.test.ts` (6): Default config, partial updates, merge semantics
- `folder-selection.test.ts` (5): Select/scan flow, empty folder, cancel
- `thumbnail-worker.test.ts` (9): Pool creation, queueing, priority, cache, clearAll
- `results.test.ts` (9): Load/save, invalid JSON, debounce, coalescing, unmount flush

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Missing jsdom dependency**
- **Found during:** Task 2 test execution
- **Issue:** Vitest config specified `environment: 'jsdom'` but jsdom was not installed
- **Fix:** Added jsdom as devDependency, configured `environmentMatchGlobs` to use node for main process tests
- **Files modified:** `apps/desktop/package.json`, `apps/desktop/vitest.config.ts`

**2. [Rule 3 - Blocking] Missing @testing-library/react**
- **Found during:** Task 2 test execution
- **Issue:** Hook tests require renderHook from @testing-library/react
- **Fix:** Added @testing-library/react as devDependency
- **Files modified:** `apps/desktop/package.json`

**3. [Rule 1 - Bug] ImageBitmap not available in jsdom test environment**
- **Found during:** Task 2 test execution
- **Issue:** `instanceof ImageBitmap` throws ReferenceError in jsdom
- **Fix:** Changed to duck-typing check (`typeof value.close === 'function'`) in useThumbnailWorker
- **Files modified:** `apps/desktop/src/renderer/src/hooks/useThumbnailWorker.ts`

**4. [Rule 1 - Bug] vi.mock hoisting prevents access to mock data variable**
- **Found during:** Task 2 test execution
- **Issue:** `vi.mock` factory hoisted above `const` declarations, causing TDZ error
- **Fix:** Used `vi.hoisted()` to declare mock data before mock factory runs
- **Files modified:** `apps/desktop/src/main/__tests__/store.test.ts`

**5. [Rule 2 - Missing] MenuEvents type declaration for window.menuEvents**
- **Found during:** Task 1
- **Issue:** `window.menuEvents` exposed via contextBridge but not typed
- **Fix:** Added `MenuEvents` interface to `packages/types/src/window.d.ts`
- **Files modified:** `packages/types/src/window.d.ts`

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 803bed9 | IPC handlers, session store, Cmd+O shortcut |
| 2 | 69d1fce | Web workers, renderer hooks, and tests |

## Self-Check: PASSED
