# Photo Culler — Project Plan

A cross-platform desktop application for browsing, reviewing, and culling photos. Select a folder, view all images in a grid layout, preview them full-size, and batch-delete unwanted shots — like a lightweight image library for photographers. Builds for **macOS** and **Windows**.

## Problem

Manually culling 1,000+ club/event photos is tedious. Photographers need a fast way to browse a folder of images, preview them, and delete the bad ones in bulk — without importing into a heavy app like Lightroom.

## Design Principle: Zero System Requirements

- **End users:** Download the installer, double-click, done. No runtime, no dependencies.
- **Developers:** Clone the repo, run `pnpm install`, start coding. No native build tools, no Python, no C++ compiler, no system libraries.
- **How:** All dependencies are pure JavaScript/TypeScript or bundled WebAssembly. No native Node.js addons (`node-gyp`, `sharp`, etc.). Image processing uses Chromium's built-in `<canvas>` and `<img>` APIs in the renderer process. Electron bundles Node.js + Chromium, so the packaged app is fully self-contained.

## Tech Stack

- **Monorepo:** Turborepo
- **Language:** TypeScript
- **Desktop Framework:** Electron (cross-platform: macOS + Windows)
- **UI:** React 18 + Tailwind CSS
- **Image Processing:** Browser-native `<canvas>` (thumbnails/resize), `exifr` (EXIF metadata, pure JS), `heic2any` (HEIC decoding, bundled WASM)
- **File Operations:** Node.js `fs` via Electron IPC
- **Packaging:** `electron-builder` (`.dmg` for macOS, `.exe`/`.msi` for Windows)
- **Formatting:** Prettier
- **Linting:** ESLint
- **Testing:** Vitest + React Testing Library
- **Package Manager:** pnpm (workspaces)

> **No native addons.** Every dependency is pure JS/TS or bundled WASM. `pnpm install` never triggers `node-gyp`.

---

## Phases

### Phase 1 — Turborepo Scaffold & Electron Shell

**Goal:** Set up the monorepo, tooling, and a basic Electron window that launches on macOS and Windows. Ensure zero native dependencies from day one.

- Initialize Turborepo with pnpm workspaces
- Configure Prettier (`.prettierrc`) and ESLint at the root
- Create `apps/desktop` — Electron app with React renderer
- Set up Electron main process (`main.ts`) and preload script with context bridge
- Set up React entry point in renderer with Tailwind CSS
- Configure `electron-builder` with macOS (`.dmg`) and Windows (`.exe`) targets
- Add Turbo pipelines: `dev`, `build`, `lint`, `format`, `test`
- Verify the app launches on macOS (dev mode)
- Add `packages/tsconfig` for shared TypeScript configurations
- Validate: `pnpm install` completes with zero native compilation steps

**Dev requirements:** Node.js 18+ and pnpm — nothing else.

**Success Criteria:** `pnpm dev` launches an Electron window with a React "Hello World". `pnpm build` produces a macOS `.dmg`. `pnpm format` runs Prettier across the repo. `pnpm install` triggers no native builds.

---

### Phase 2 — Folder Selection & Image Discovery

**Goal:** Let users pick a folder and discover all images in it.

- Create `packages/image-utils` — shared image processing logic (pure JS only)
- Implement folder picker via Electron's `dialog.showOpenDialog` (IPC bridge)
- Scan selected folder for images: JPG, JPEG, PNG, TIFF, WebP, HEIC
- Read EXIF metadata (date taken, dimensions, orientation) using `exifr` (pure JS)
- For HEIC files: decode to JPEG in renderer using `heic2any` (bundled WASM)
- Expose image list to renderer via IPC: `{ path, filename, size, dateTaken, width, height }`
- Add menu bar: `File > Open Folder...` (Cmd+O / Ctrl+O)
- Display status bar: folder path and image count

**Success Criteria:** User selects a folder via native dialog, app discovers images and shows "Loaded 42 images from /path" in the status bar.

---

### Phase 3 — Thumbnail Grid View

**Goal:** Display all images as a scrollable, responsive grid of thumbnails.

- Generate thumbnails in the renderer using `<canvas>` + `OffscreenCanvas` in a Web Worker
  - Load image via `<img>` → draw scaled to canvas → export as data URL or blob
  - Process in batches to avoid blocking the UI thread
- Build `ThumbnailGrid` React component — responsive CSS grid with Tailwind
- Virtualized scrolling (e.g., `react-window` or `react-virtuoso`) for 1,000+ images
- Show filename and basic info below each thumbnail
- Loading skeleton/spinner while thumbnails generate
- Cache generated thumbnails in memory (Map/LRU) for fast scrolling

**Success Criteria:** Opening a folder with 500+ images shows a scrollable grid that loads progressively without UI freezes.

---

### Phase 4 — Image Preview

**Goal:** Full-size image preview with navigation.

- Click thumbnail to enter preview mode (full-screen overlay or split panel)
- Display image scaled to fit viewport, loaded from original file
- Zoom controls: fit-to-window (default), zoom-in/out, scroll-to-zoom
- Arrow keys (← →) to navigate between images
- Show metadata sidebar: filename, dimensions, file size, date taken, camera info
- Press Escape or click backdrop to return to grid view
- Preload adjacent images for instant navigation

**Success Criteria:** Click any thumbnail, see full-size preview, navigate with arrow keys, press Escape to return.

---

### Phase 5 — Selection & Batch Delete

**Goal:** Multi-select images and delete them in batch.

- Click to select (highlight border/overlay with checkmark)
- Ctrl+Click (Cmd+Click on macOS) to toggle, Shift+Click for range select
- Ctrl+A / Cmd+A to select all, Escape to deselect
- Selection counter in toolbar: "12 of 42 selected"
- Delete action (Delete key or toolbar button):
  - macOS: move to Trash via `shell.trashItem()` (Electron API)
  - Windows: move to Recycle Bin via `shell.trashItem()`
- Confirmation dialog: "Move 12 images to Trash?"
- Remove deleted images from grid immediately after confirmation
- Session log of deletions for reference

**Success Criteria:** User multi-selects images and batch-deletes them to OS trash with a single confirmation.

---

### Phase 6 — Sorting, Filtering & Search

**Goal:** Sort and filter the grid for faster culling.

- Sort by: filename, date taken, file size, dimensions
- Sort order toggle (ascending/descending)
- Filter by file type dropdown (All, JPG, PNG, etc.)
- Search bar: filter by filename (instant, client-side)
- Toolbar with sort/filter controls
- Persist preferences via `electron-store` or localStorage

**Success Criteria:** User can sort by date, filter to JPGs only, and search by name.

---

### Phase 7 — Automatic Quality Scoring

**Goal:** Automatically rate images on technical quality so users can quickly identify and cull bad photos.

- Analyze images in a Web Worker using `<canvas>` pixel data (`getImageData`)
- **Sharpness score** — Laplacian-style edge detection on grayscale pixels (more edges = sharper)
- **Exposure score** — Luminance histogram analysis (penalize too dark < 40 or blown out > 220)
- **Noise score** — Estimate noise via local pixel variance in smooth regions
- **Contrast score** — Standard deviation of luminance channel
- Combine into a composite score: `sharpness * 0.40 + exposure * 0.25 + noise * 0.20 + contrast * 0.15`
- Normalize each metric to a 0–100 scale
- Display score badge overlay on each thumbnail (color-coded: green ≥ 60, yellow 35–59, red < 35)
- Sort by quality score option in the toolbar
- "Auto-select rejects" button: selects all images below a configurable threshold
- Score progressively in background — badges appear as scores complete
- All processing in pure JS (canvas pixel math), no native dependencies

**Success Criteria:** Each thumbnail shows a quality score badge. Users can sort by score and auto-select likely bad photos for batch deletion.

---

### Phase 8 — Cross-Platform Build & Packaging

**Goal:** Produce distributable installers for macOS and Windows.

- Finalize `electron-builder` config for both platforms:
  - macOS: `.dmg` installer, universal binary (Intel + Apple Silicon), code signing
  - Windows: `.exe` installer (NSIS), optional `.msi`
- App icon for both platforms (`.icns` for macOS, `.ico` for Windows)
- Auto-updater setup via `electron-updater` (optional, for future releases)
- GitHub Actions CI pipeline:
  - Lint + format check (`turbo run lint format:check`)
  - Tests (`turbo run test`)
  - Build macOS artifact on macOS runner
  - Build Windows artifact on Windows runner
- Test installation on both platforms

**Success Criteria:** CI produces downloadable `.dmg` and `.exe` installers. App installs and runs correctly on both macOS and Windows.

---

### Phase 9 — Polish & UX

**Goal:** Refine the experience and handle edge cases.

- Remember last opened folder (persist across sessions)
- Drag-and-drop folder onto window to open it
- Thumbnail size slider (small / medium / large grid)
- Dark mode / light mode (follow OS preference, with manual toggle)
- Keyboard shortcuts: Delete, Ctrl+A, arrows, Escape, Space (toggle select)
- Handle edge cases: empty folders, corrupted images, permission errors
- File watcher: detect external changes and offer refresh
- Loading states and error boundaries throughout
- About dialog with version info

**Success Criteria:** App feels polished, handles edge cases gracefully, and provides a smooth culling workflow for 1,000+ image sessions.

---

## Project Structure

```
photo-culler/
├── apps/
│   └── desktop/                    # Electron + React app
│       ├── src/
│       │   ├── main/               # Electron main process
│       │   │   ├── index.ts        # App entry, window creation
│       │   │   ├── ipc.ts          # IPC handlers (folder, images, delete)
│       │   │   └── preload.ts      # Context bridge
│       │   └── renderer/           # React UI
│       │       ├── App.tsx
│       │       ├── main.tsx        # React entry
│       │       ├── components/
│       │       │   ├── ThumbnailGrid.tsx
│       │       │   ├── ThumbnailCard.tsx
│       │       │   ├── ImagePreview.tsx
│       │       │   ├── Toolbar.tsx
│       │       │   └── StatusBar.tsx
│       │       ├── workers/
│       │       │   └── scoring.worker.ts  # Quality scoring in Web Worker
│       │       ├── hooks/
│       │       │   ├── useImages.ts
│       │       │   ├── useSelection.ts
│       │       │   ├── useScoring.ts
│       │       │   └── usePreview.ts
│       │       └── styles/
│       │           └── globals.css  # Tailwind entry
│       ├── electron-builder.yml
│       ├── vite.config.ts          # Vite for renderer bundling
│       ├── tailwind.config.ts
│       ├── tsconfig.json
│       └── package.json
├── packages/
│   ├── image-utils/                # Shared image processing (pure JS)
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── scanner.ts          # Directory scanning (Node fs)
│   │   │   ├── thumbnails.ts       # Thumbnail generation (canvas API)
│   │   │   ├── metadata.ts         # EXIF reading (exifr)
│   │   │   ├── heic.ts             # HEIC decoding (heic2any)
│   │   │   └── types.ts            # Shared types
│   │   ├── tsconfig.json
│   │   └── package.json
│   ├── ui/                         # Shared UI components (optional)
│   │   ├── src/
│   │   ├── tsconfig.json
│   │   └── package.json
│   └── tsconfig/                   # Shared TS configs
│       ├── base.json
│       ├── react.json
│       └── node.json
├── .github/
│   └── workflows/
│       └── build.yml               # CI: lint, test, build artifacts
├── turbo.json                      # Turbo pipeline config
├── .prettierrc                     # Prettier config
├── .eslintrc.js                    # Root ESLint config
├── pnpm-workspace.yaml
├── package.json                    # Root: scripts, devDependencies
├── README.md
└── PROJECT-PLAN.md
```

## Key Dependencies

All dependencies are pure JS/TS or bundled WASM. **No native addons.**

### Root
```
turbo
prettier
eslint
typescript
```

### apps/desktop
```
electron
electron-builder
react
react-dom
tailwindcss
vite
@vitejs/plugin-react
vitest
react-window             # Virtualized grid
electron-store           # Persist preferences
```

### packages/image-utils
```
exifr                    # EXIF/metadata reading (pure JS, no native deps)
heic2any                 # HEIC → JPEG conversion (bundled WASM, no system deps)
```

## Turbo Pipelines

```jsonc
// turbo.json
{
  "pipeline": {
    "build": { "dependsOn": ["^build"] },
    "dev": { "persistent": true },
    "lint": {},
    "format": {},
    "format:check": {},
    "test": { "dependsOn": ["^build"] }
  }
}
```

## Scripts (Root package.json)

```bash
pnpm dev          # Start Electron in dev mode (hot reload)
pnpm build        # Build all packages + Electron app
pnpm package      # Build + package installers (dmg/exe)
pnpm lint         # ESLint across all packages
pnpm format       # Prettier write across all packages
pnpm format:check # Prettier check (CI)
pnpm test         # Vitest across all packages
```
