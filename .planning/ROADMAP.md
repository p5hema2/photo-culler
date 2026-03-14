# Roadmap: Photo Culler

## Overview

Photo Culler goes from zero to a distributable desktop app in four phases. Phase 1 establishes the Electron monorepo foundation and validates packaging early (the top research-identified risk). Phase 2 delivers the core browsing experience -- folder selection and a performant thumbnail grid. Phase 3 completes the core value proposition by adding full-size preview, multi-select, and batch delete to OS trash. Phase 4 layers on the culling workflow (flags, ratings, labels) and algorithmic quality scoring -- the key differentiator in the lightweight culler tier.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Electron Shell and Build Pipeline** - Turborepo monorepo with Electron app that launches, registers custom protocol, typed IPC bridge, and packages into macOS/Windows installers with CI
- [ ] **Phase 2: Folder Browsing and Thumbnail Grid** - User can open a folder and browse all images in a virtualized, sortable, filterable thumbnail grid that handles 1,000+ photos
- [ ] **Phase 3: Preview, Selection, and Deletion** - User can preview images full-size with zoom/pan, multi-select images, and batch-delete to OS trash
- [ ] **Phase 4: Culling Workflow and Quality Scoring** - User can flag/rate/label images with keyboard shortcuts and get automatic quality scores with visual analysis tools

## Phase Details

### Phase 1: Electron Shell and Build Pipeline
**Goal**: A working Electron + React app in a Turborepo monorepo that packages into native installers on both platforms, with typed IPC and zero native dependencies
**Depends on**: Nothing (first phase)
**Requirements**: INFRA-01, INFRA-02, INFRA-03, INFRA-04, INFRA-05, INFRA-06, INFRA-07, DIST-01, DIST-02, DIST-03, DIST-04
**Success Criteria** (what must be TRUE):
  1. Running `pnpm dev` launches an Electron window displaying a React page with hot module reload
  2. Running `pnpm build` produces a macOS .dmg and Windows .exe installer that launches successfully on the target OS
  3. The renderer process cannot access Node.js APIs directly -- all OS interaction goes through a typed contextBridge IPC layer
  4. Running `pnpm format` and `pnpm lint` checks all packages; CI pipeline runs build and lint on both macOS and Windows runners
  5. No dependency in the lockfile triggers native compilation (no node-gyp, no Python/C++ build tools required)
**Plans:** 3/3 plans executed

Plans:
- [ ] 01-01-PLAN.md -- Monorepo scaffold with Turborepo, pnpm workspaces, shared packages, Prettier, and ESLint
- [ ] 01-02-PLAN.md -- Electron app with electron-vite, typed IPC via contextBridge, custom app:// protocol, and React renderer
- [ ] 01-03-PLAN.md -- electron-builder packaging for macOS/Windows and GitHub Actions CI/release workflows

### Phase 2: Folder Browsing and Thumbnail Grid
**Goal**: Users can select a folder and browse all discovered images in a grouped, virtualized thumbnail grid with timestamp-based grouping, classification borders, sorting, filtering, search, and batch execute
**Depends on**: Phase 1
**Requirements**: BROW-01, BROW-02, BROW-03, BROW-04, BROW-05, BROW-06, BROW-07, BROW-08, UX-01, UX-02, UX-04, UX-05
**Success Criteria** (what must be TRUE):
  1. User can open a folder via native dialog (Cmd+O) or drag-and-drop and see all JPG/PNG/TIFF/WebP images as thumbnails in a scrollable grid
  2. A folder with 1,000+ images loads without UI freezes -- grid is immediately scrollable while thumbnails appear progressively
  3. User can sort images by filename, date taken, file size, and dimensions, and filter by file type or search by filename
  4. User can navigate thumbnails with arrow keys and adjust thumbnail size (small/medium/large)
  5. App remembers the last opened folder across sessions and handles empty folders, corrupted images, and permission errors gracefully
**Plans:** 3/4 plans executed

Plans:
- [ ] 02-01-PLAN.md -- Types extension, folder scanner, grouping, and sorting pure functions with TDD
- [ ] 02-02-PLAN.md -- Main process IPC handlers, session store, Web Workers for thumbnails and EXIF
- [ ] 02-03-PLAN.md -- Virtualized grouped grid UI, toolbar, drag-and-drop, keyboard navigation
- [ ] 02-04-PLAN.md -- Execute panel for batch operations, results auto-save, end-to-end verification

### Phase 3: Preview, Selection, and Deletion
**Goal**: Users can preview images at full size, select multiple images, and batch-delete unwanted shots to the OS trash -- completing the core value proposition
**Depends on**: Phase 2
**Requirements**: PREV-01, PREV-02, PREV-03, PREV-04, PREV-05, PREV-06, PREV-07, DEL-01, DEL-02, DEL-03, DEL-04, DEL-05, DEL-06, DEL-07, DEL-08, UX-03
**Success Criteria** (what must be TRUE):
  1. User can click a thumbnail to see a full-size preview, zoom in (fit-to-window, 100%, scroll-to-zoom), pan when zoomed, and navigate between images with arrow keys
  2. User can view EXIF metadata (camera, lens, aperture, shutter speed, ISO, date) and a filmstrip of thumbnails in preview mode, and press Escape to return to grid
  3. User can select images via click, Ctrl/Cmd+click (toggle), Shift+click (range), and Ctrl+A (all), with a visible selection count in the toolbar
  4. User can delete selected images via Delete key or toolbar button, sees a confirmation dialog, and deleted images move to OS trash (never permanent delete) and disappear from the grid
  5. App supports dark theme (default) and light theme toggle
**Plans**: TBD

Plans:
- [ ] 03-01: TBD
- [ ] 03-02: TBD
- [ ] 03-03: TBD

### Phase 4: Culling Workflow and Quality Scoring
**Goal**: Users can efficiently cull photos using keyboard-driven flagging, rating, and labeling, enhanced by automatic quality scoring and visual analysis tools
**Depends on**: Phase 3
**Requirements**: CULL-01, CULL-02, CULL-03, CULL-04, CULL-05, QUAL-01, QUAL-02, QUAL-03, QUAL-04, QUAL-05, QUAL-06, QUAL-07, QUAL-08
**Success Criteria** (what must be TRUE):
  1. User can flag images as Pick (P), Reject (X), or Unflag (U) and preview auto-advances to the next image after flagging
  2. User can rate images 1-5 stars with number keys, assign color labels via keyboard, and filter the grid by flags, star ratings, or labels
  3. Each image receives an automatic quality score (0-100) displayed as a color-coded badge on its thumbnail, computed in background Web Workers without freezing the UI
  4. User can sort by quality score and auto-select images below a quality threshold for batch deletion
  5. User can view focus peaking overlay, exposure clipping warnings (blown highlights / crushed shadows), and an RGB histogram for the selected image in preview mode
**Plans**: TBD

Plans:
- [ ] 04-01: TBD
- [ ] 04-02: TBD
- [ ] 04-03: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Electron Shell and Build Pipeline | 3/3 | Complete | 2026-03-14 |
| 2. Folder Browsing and Thumbnail Grid | 3/4 | In Progress|  |
| 3. Preview, Selection, and Deletion | 0/3 | Not started | - |
| 4. Culling Workflow and Quality Scoring | 0/3 | Not started | - |
