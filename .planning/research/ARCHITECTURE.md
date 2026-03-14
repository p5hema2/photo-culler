# Architecture Patterns

**Domain:** Desktop photo culling application (Electron + React)
**Researched:** 2026-03-14

## Standard Architecture

### System Overview

The app follows the standard Electron two-process model with a strict security boundary between the **main process** (Node.js runtime with OS access) and the **renderer process** (Chromium-based browser window running React). Communication crosses this boundary exclusively through typed IPC channels exposed via a `contextBridge` preload script. Heavy image work (thumbnail generation, quality scoring) runs in **Web Workers** within the renderer process using `OffscreenCanvas`, keeping the UI thread free for scrolling and interaction.

The Turborepo monorepo splits code into independently buildable packages that enforce clear boundaries: the Electron shell, the React UI, shared types, and image processing utilities.

```
+------------------------------------------------------------------+
|  MAIN PROCESS (Node.js)                                          |
|                                                                  |
|  +------------------+  +------------------+  +--------------+    |
|  | Window Manager   |  | File System      |  | Custom       |    |
|  | (BrowserWindow)  |  | Service          |  | Protocol     |    |
|  |                  |  | (fs, dialog,     |  | (app://)     |    |
|  |                  |  |  shell.trashItem)|  |              |    |
|  +--------+---------+  +--------+---------+  +------+-------+    |
|           |                     |                    |            |
+-----------+---------------------+--------------------+------------+
            |         IPC Bridge (contextBridge)       |
+-----------+---------------------+--------------------+------------+
|  RENDERER PROCESS (Chromium)    |                    |            |
|                                 |                    |            |
|  +------------------+  +-------+--------+  +--------+-------+    |
|  | React UI         |  | State Manager  |  | Image Loader   |    |
|  | (Grid, Preview,  |  | (Zustand)      |  | (app:// URLs)  |    |
|  |  Toolbar, Sort)  |  |                |  |                |    |
|  +--------+---------+  +----------------+  +--------+-------+    |
|           |                                         |            |
|  +--------+-----------------------------------------+-------+    |
|  | Web Workers (OffscreenCanvas)                            |    |
|  |  - Thumbnail generation                                  |    |
|  |  - Quality scoring (sharpness, exposure, noise)          |    |
|  |  - EXIF extraction (exifr)                               |    |
|  +----------------------------------------------------------+    |
+------------------------------------------------------------------+
```

### Component Responsibilities

| Component | Process | Responsibility | Communicates With |
|-----------|---------|---------------|-------------------|
| **Window Manager** | Main | Creates BrowserWindow, manages lifecycle, registers custom protocol | File System Service |
| **File System Service** | Main | Folder selection (`dialog.showOpenDialog`), directory scanning (`fs.readdir`), file deletion (`shell.trashItem`), file metadata (`fs.stat`) | Window Manager, IPC Bridge |
| **Custom Protocol Handler** | Main | Registers `app://` protocol to serve local image files securely (replaces `file://`) | Renderer (via protocol) |
| **IPC Bridge (Preload)** | Bridge | Exposes whitelisted APIs via `contextBridge.exposeInMainWorld`; never exposes raw `ipcRenderer` | Main handlers, Renderer callers |
| **React UI** | Renderer | Grid view, full-size preview, toolbar, sort/filter controls, selection state | State Manager, Image Loader |
| **State Manager** | Renderer | Holds image list, selection set, sort/filter state, processing status | React UI, IPC Bridge |
| **Image Loader** | Renderer | Loads images via `app://` protocol URLs, manages loading queues for visible viewport | Custom Protocol, Web Workers |
| **Web Workers** | Renderer | Thumbnail generation via `OffscreenCanvas`, quality scoring via pixel math, EXIF parsing | Image Loader, State Manager |

## Recommended Project Structure

Use `@repo/` namespace prefix for internal packages per Turborepo convention.

```
photo-culler/
├── apps/
│   └── desktop/                     # Electron application
│       ├── src/
│       │   ├── main/                # Main process
│       │   │   ├── index.ts         # App entry, window creation, protocol registration
│       │   │   ├── ipc-handlers.ts  # All ipcMain.handle() registrations
│       │   │   ├── file-service.ts  # fs operations: scan dir, stat, trash
│       │   │   └── protocol.ts      # Custom app:// protocol registration
│       │   ├── preload/             # Preload bridge
│       │   │   ├── index.ts         # contextBridge.exposeInMainWorld()
│       │   │   └── api.ts           # Typed API surface exposed to renderer
│       │   └── renderer/            # React application (Vite-built)
│       │       ├── index.html
│       │       ├── src/
│       │       │   ├── App.tsx
│       │       │   ├── main.tsx     # React entry
│       │       │   ├── components/  # UI components
│       │       │   │   ├── Grid/         # Virtualized thumbnail grid
│       │       │   │   ├── Preview/      # Full-size image viewer
│       │       │   │   ├── Toolbar/      # Sort, filter, actions
│       │       │   │   └── FolderPicker/ # Folder selection trigger
│       │       │   ├── hooks/       # React hooks (useImages, useSelection, etc.)
│       │       │   ├── store/       # Zustand state management
│       │       │   ├── workers/     # Web Worker scripts
│       │       │   │   ├── thumbnail.worker.ts
│       │       │   │   └── scoring.worker.ts
│       │       │   └── lib/         # Renderer-side utilities
│       │       └── ...
│       ├── electron.vite.config.ts  # Builds main, preload, renderer separately
│       ├── electron-builder.yml     # Packaging config for .dmg / .exe
│       └── package.json
│
├── packages/
│   ├── types/                       # @repo/types
│   │   ├── src/
│   │   │   ├── image.ts             # ImageFile, ImageMetadata, QualityScore
│   │   │   ├── ipc.ts              # IPC channel names and payload types
│   │   │   └── index.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── image-utils/                 # @repo/image-utils (pure JS, no Node/Electron deps)
│   │   ├── src/
│   │   │   ├── scoring.ts           # Quality scoring algorithms (sharpness, exposure, etc.)
│   │   │   ├── thumbnail.ts         # Canvas-based thumbnail generation
│   │   │   ├── exif.ts              # EXIF extraction wrapper (exifr)
│   │   │   └── index.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── tsconfig/                    # @repo/tsconfig (shared TS configs)
│   │   ├── base.json
│   │   ├── react.json
│   │   └── node.json
│   │
│   └── eslint-config/              # @repo/eslint-config (shared lint rules)
│       └── ...
│
├── turbo.json
├── pnpm-workspace.yaml
├── package.json                     # Root: prettier, dev scripts
└── .prettierrc
```

### Why This Split

| Package | Rationale |
|---------|-----------|
| `apps/desktop` | Single Electron app with colocated main/preload/renderer. Keeps electron-vite config simple -- it expects this structure. |
| `packages/types` | Shared between main process, preload, and renderer. IPC channel names and payloads defined once, used everywhere. Prevents type drift across the process boundary. |
| `packages/image-utils` | Pure JS/TS image algorithms (scoring, thumbnail math). No DOM, no Node, no Electron deps. Testable in isolation with Vitest. Consumed by Web Workers in the renderer. |
| `packages/tsconfig` | Standard Turborepo pattern. Base config extended by each package. |

**Why NOT separate `apps/main` and `apps/renderer`:** electron-vite expects a single app with `src/main`, `src/preload`, `src/renderer` directories. Fighting this convention adds complexity with no benefit. The process boundary is enforced by Electron itself, not by package boundaries.

## Architectural Patterns

### Pattern 1: Typed IPC via contextBridge

The preload script is the single choke point between processes. Define channel names and payloads as types in `@repo/types`, then use them in both the main handlers and the preload bridge.

**Confidence:** HIGH (official Electron documentation)

```typescript
// packages/types/src/ipc.ts
export const IPC = {
  SELECT_FOLDER: 'fs:select-folder',
  SCAN_FOLDER: 'fs:scan-folder',
  TRASH_FILES: 'fs:trash-files',
  GET_FILE_STAT: 'fs:get-file-stat',
} as const;

export interface FolderScanResult {
  files: ImageFileInfo[];
  totalCount: number;
}

// apps/desktop/src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '@repo/types';

contextBridge.exposeInMainWorld('electronAPI', {
  selectFolder: () => ipcRenderer.invoke(IPC.SELECT_FOLDER),
  scanFolder: (path: string) => ipcRenderer.invoke(IPC.SCAN_FOLDER, path),
  trashFiles: (paths: string[]) => ipcRenderer.invoke(IPC.TRASH_FILES, paths),
});

// apps/desktop/src/main/ipc-handlers.ts
import { ipcMain, dialog, shell } from 'electron';
import { IPC } from '@repo/types';

ipcMain.handle(IPC.SELECT_FOLDER, async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle(IPC.TRASH_FILES, async (_event, paths: string[]) => {
  for (const p of paths) {
    await shell.trashItem(p);
  }
});
```

**Why:** Never expose raw `ipcRenderer`. Each IPC channel is a named, typed function. The renderer only sees `window.electronAPI.selectFolder()` -- no knowledge of Electron internals. This is the security model Electron requires since v12+ with context isolation enabled by default.

### Pattern 2: Custom Protocol for Image Loading

Register an `app://` custom protocol in the main process to serve local files. The renderer loads images via `<img src="app://image?path=/abs/path/to/photo.jpg">`. This avoids disabling `webSecurity` and prevents `file://` access.

**Confidence:** HIGH (official Electron documentation)

```typescript
// apps/desktop/src/main/protocol.ts
import { protocol, net } from 'electron';
import path from 'node:path';

// Must be called BEFORE app.whenReady()
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, stream: true } }
]);

// Called AFTER app.whenReady()
export function registerProtocol() {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    const filePath = decodeURIComponent(url.searchParams.get('path') ?? '');

    // Security: validate path is within allowed directories
    if (!filePath || !isAllowedPath(filePath)) {
      return new Response('Forbidden', { status: 403 });
    }

    return net.fetch(`file://${filePath}`);
  });
}
```

**Why:** The `file://` protocol gives unilateral access to the entire filesystem. A custom protocol lets you validate paths (prevent directory traversal), restrict to allowed directories, and serve images with proper CORS and CSP headers.

### Pattern 3: Web Worker Pipeline for Image Processing

Thumbnail generation and quality scoring happen in dedicated Web Workers using `OffscreenCanvas`. The renderer posts image URLs to workers; workers fetch, decode, process, and return results without blocking the UI thread.

**Confidence:** HIGH (Web platform standard, well-supported in Chromium/Electron)

```typescript
// apps/desktop/src/renderer/src/workers/thumbnail.worker.ts
import { generateThumbnail } from '@repo/image-utils';

self.onmessage = async (event: MessageEvent<{ url: string; maxSize: number }>) => {
  const { url, maxSize } = event.data;
  const response = await fetch(url);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  const canvas = new OffscreenCanvas(maxSize, maxSize);
  const thumbnailBlob = await generateThumbnail(canvas, bitmap, maxSize);

  self.postMessage({ url, thumbnail: thumbnailBlob }, [thumbnailBlob]);
};
```

**Why:** Processing 1,000+ images on the main thread freezes the UI. Web Workers + `OffscreenCanvas` run in separate threads. The `@repo/image-utils` package contains pure algorithms that work with both `OffscreenCanvas` (workers) and regular `Canvas` (if needed for testing). `createImageBitmap` decodes images off the main thread.

### Pattern 4: Virtualized Grid with Lazy Thumbnail Loading

Use `react-virtuoso` (VirtuosoGrid) for the thumbnail grid. Only images in/near the viewport trigger thumbnail generation. Combined with an intersection-based loading queue, this handles 1,000+ images without memory pressure.

**Confidence:** HIGH (react-virtuoso is mature, widely used for this exact use case)

```
Scroll viewport (visible: ~40 thumbnails)
  → VirtuosoGrid renders only visible cells + overscan buffer
  → Each cell requests thumbnail from worker pool
  → Worker generates thumbnail, returns blob URL
  → Cell displays blob URL via <img>
  → On scroll, old cells unmount, blob URLs revoked
```

**Why:** Rendering 1,000+ `<img>` elements with full-size photos crashes the renderer. Virtualization keeps DOM size under ~100 elements regardless of folder size. Lazy thumbnail generation means only visible images consume memory.

### Pattern 5: Zustand for State Management

Use Zustand (not Redux, not Context) for application state. Lightweight, no boilerplate, works well with Electron IPC patterns.

**Confidence:** MEDIUM (Zustand is dominant in the React ecosystem for this scale of app, but this is an opinionated choice)

```typescript
// Key state slices:
// - images: ImageFile[] (the scanned folder contents)
// - selection: Set<string> (selected file paths)
// - sort: { field, direction }
// - filter: { types, searchQuery }
// - processing: Map<string, 'pending' | 'done'> (thumbnail/score status)
// - currentFolder: string | null
```

**Why:** The app has straightforward state: a list of images, selection, sort/filter criteria, and processing status. Zustand handles this with minimal code. Redux is overkill. React Context re-renders too broadly for selection state changes on a 1,000-item grid.

## Data Flow

### Primary Flow: Folder Open to Display

```
1. USER clicks "Open Folder"
   │
2. RENDERER calls window.electronAPI.selectFolder()
   │  (ipcRenderer.invoke → ipcMain.handle)
   │
3. MAIN shows native OS folder picker (dialog.showOpenDialog)
   │  Returns: folderPath or null
   │
4. RENDERER calls window.electronAPI.scanFolder(folderPath)
   │  (ipcRenderer.invoke → ipcMain.handle)
   │
5. MAIN scans directory (fs.readdir + fs.stat for each file)
   │  Filters to supported extensions: .jpg, .jpeg, .png, .webp, .tiff, .heic
   │  Returns: ImageFileInfo[] (path, name, size, modifiedDate)
   │
6. RENDERER receives file list → updates Zustand store
   │
7. REACT re-renders VirtuosoGrid with image entries
   │  Each visible cell shows placeholder + queues thumbnail generation
   │
8. WEB WORKER receives thumbnail request
   │  Fetches image via app:// protocol URL
   │  Decodes with createImageBitmap
   │  Draws scaled version on OffscreenCanvas
   │  Returns blob
   │
9. CELL receives thumbnail blob → displays via object URL
```

### Secondary Flow: Quality Scoring

```
1. RENDERER queues scoring for all images (lower priority than thumbnails)
   │
2. SCORING WORKER receives image URL
   │  Fetches full image, draws to OffscreenCanvas
   │  Runs getImageData → pixel analysis:
   │    - Sharpness (Laplacian variance approximation)
   │    - Exposure (histogram distribution)
   │    - Noise estimation (high-frequency energy)
   │    - Contrast (standard deviation of luminance)
   │  Returns: QualityScore { sharpness, exposure, noise, contrast, overall }
   │
3. RENDERER updates store with scores
   │  Enables "Sort by quality" and "Auto-select below threshold"
```

### Delete Flow: Batch Trash

```
1. USER selects images (click, Ctrl+click, Shift+click)
   │  Selection state managed in Zustand store
   │
2. USER clicks "Delete Selected"
   │
3. RENDERER calls window.electronAPI.trashFiles(selectedPaths)
   │  (ipcRenderer.invoke → ipcMain.handle)
   │
4. MAIN iterates paths, calls shell.trashItem(path) for each
   │  Returns: { success: string[], failed: string[] }
   │
5. RENDERER removes trashed files from store
   │  Grid re-renders, selection clears
```

### HEIC Handling Flow

```
1. RENDERER detects .heic file in image list
   │
2. WEB WORKER (or main thread) uses heic2any (WASM-bundled)
   │  Converts HEIC → JPEG blob
   │  This conversion is expensive (~200-500ms per image)
   │
3. Converted blob used for both thumbnail and display
   │  Cache the converted blob to avoid re-conversion
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Exposing Raw ipcRenderer
**What:** `contextBridge.exposeInMainWorld('ipc', ipcRenderer)`
**Why bad:** Any code in the renderer (including XSS payloads) can send arbitrary IPC messages to the main process, which has full OS access. This is effectively giving the renderer root access.
**Instead:** Expose individual typed functions that each call a single, specific IPC channel.

### Anti-Pattern 2: Using file:// Protocol for Images
**What:** Loading images via `<img src="file:///absolute/path/to/photo.jpg">`
**Why bad:** Requires disabling `webSecurity`, which removes all CORS protections. Any injected content can read any file on the system.
**Instead:** Register a custom `app://` protocol with path validation.

### Anti-Pattern 3: Processing Images on the Main Thread (Renderer)
**What:** Running canvas operations, EXIF parsing, or quality scoring in React components or event handlers.
**Why bad:** Processing 1,000+ images blocks the UI thread. Grid becomes unscrollable during processing. React state updates cause cascading re-renders.
**Instead:** All image processing in Web Workers. Return only results (blob URLs, score numbers) to the main thread.

### Anti-Pattern 4: Loading Full-Size Images in Grid
**What:** Setting grid thumbnail `src` to the original 5000x3000 photo.
**Why bad:** 1,000 full-size images = 10-50 GB of decoded image data in memory. Chromium will crash or become extremely slow.
**Instead:** Generate ~300px thumbnails in Web Workers. Only load full-size when opening the preview modal.

### Anti-Pattern 5: Synchronous IPC
**What:** Using `ipcRenderer.sendSync()` for any file operations.
**Why bad:** Blocks the renderer process entirely until the main process responds. Directory scans or file deletions can take seconds.
**Instead:** Always use the async invoke/handle pattern.

### Anti-Pattern 6: Putting Electron Dependencies in Shared Packages
**What:** Importing `electron` in `@repo/image-utils` or `@repo/types`.
**Why bad:** Shared packages become untestable outside Electron. Can't run Vitest on them without an Electron environment.
**Instead:** `@repo/image-utils` depends only on web platform APIs (Canvas, ImageBitmap). `@repo/types` is pure TypeScript interfaces. Only `apps/desktop/src/main` and `apps/desktop/src/preload` import from `electron`.

## Integration Points

### Build Tooling: electron-vite + electron-builder

Use **electron-vite** as the dev/build tool (Vite-based, understands main/preload/renderer split) and **electron-builder** for packaging into .dmg/.exe installers. electron-vite is more mature than Electron Forge's experimental Vite support and integrates naturally with the Turborepo workflow.

**Confidence:** MEDIUM (electron-vite is popular and well-maintained; Electron Forge is the "official" tool but its Vite support is still experimental as of early 2026)

### Turborepo Pipeline

```jsonc
// turbo.json
{
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "dependsOn": ["^build"],
      "persistent": true,
      "cache": false
    },
    "test": {
      "dependsOn": ["^build"]
    },
    "lint": {},
    "typecheck": {
      "dependsOn": ["^build"]
    }
  }
}
```

Build order enforced by `dependsOn: ["^build"]`: `@repo/types` builds first, then `@repo/image-utils` (depends on types), then `apps/desktop` (depends on both).

### Key Libraries

| Library | Purpose | Confidence |
|---------|---------|------------|
| `react-virtuoso` | Virtualized grid for 1,000+ thumbnails | HIGH |
| `zustand` | Lightweight state management | MEDIUM |
| `exifr` | Pure JS EXIF/metadata extraction | HIGH (per PROJECT.md) |
| `heic2any` | HEIC to JPEG conversion (bundled WASM) | HIGH (per PROJECT.md) |
| `electron-vite` | Dev server + build for main/preload/renderer | MEDIUM |
| `electron-builder` | Package into .dmg/.exe installers | HIGH |

## Suggested Build Order (Phase Dependencies)

Components have natural dependencies that should drive the roadmap:

1. **Monorepo scaffold + Electron shell** -- Must exist first. Turborepo config, `apps/desktop` with electron-vite, basic BrowserWindow that loads a React hello world. Includes custom `app://` protocol.
2. **IPC bridge + file system service** -- Depends on (1). Folder picker, directory scanner, preload bridge with typed channels. This unlocks all features that need file access.
3. **Thumbnail pipeline + virtualized grid** -- Depends on (2). Web Worker for thumbnail generation, VirtuosoGrid rendering. This is the core UI that users interact with.
4. **Preview + selection + deletion** -- Depends on (3). Full-size image viewer, multi-select, batch trash. Builds on the existing grid and IPC.
5. **Sort/filter + EXIF** -- Depends on (2) and (3). EXIF extraction, sort by date/size/name, filter by type. Enhances the grid.
6. **Quality scoring** -- Depends on (3). Scoring worker, score display, auto-select. Can be built independently once the worker pipeline exists.
7. **Packaging + installers** -- Depends on all above. electron-builder config for macOS .dmg and Windows .exe.

## Scalability Considerations

| Concern | At 100 images | At 1,000 images | At 5,000 images |
|---------|---------------|-----------------|-----------------|
| Grid rendering | Direct render OK | Virtualization required | Virtualization required, careful overscan tuning |
| Thumbnail memory | ~30 MB (300px thumbs) | ~300 MB | ~1.5 GB -- need to revoke blob URLs for off-screen items |
| Directory scan | <100ms | ~500ms | ~2s -- consider streaming results to renderer |
| Quality scoring | <5s total | ~30-60s total | ~3-5 min -- must be background, show progress |
| HEIC conversion | N/A (few HEIC) | ~30s for HEIC subset | Minutes -- convert lazily, only on demand |
| Selection state | Set in memory | Set in memory | Set in memory (5,000 strings is trivial) |

## Sources

- [Electron IPC Tutorial (official)](https://www.electronjs.org/docs/latest/tutorial/ipc)
- [Electron Process Model (official)](https://www.electronjs.org/docs/latest/tutorial/process-model)
- [Electron Context Isolation (official)](https://www.electronjs.org/docs/latest/tutorial/context-isolation)
- [Electron contextBridge API (official)](https://www.electronjs.org/docs/latest/api/context-bridge)
- [Electron Using Preload Scripts (official)](https://www.electronjs.org/docs/latest/tutorial/tutorial-preload)
- [Electron protocol API (official)](https://www.electronjs.org/docs/latest/api/protocol)
- [Electron Security Guide (official)](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron shell API -- trashItem (official)](https://www.electronjs.org/docs/latest/api/shell)
- [Turborepo -- Structuring a Repository (official)](https://turborepo.dev/docs/crafting-your-repository/structuring-a-repository)
- [OffscreenCanvas -- MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas)
- [OffscreenCanvas and Web Workers -- web.dev](https://developer.chrome.com/blog/offscreen-canvas/)
- [React Virtuoso documentation](https://virtuoso.dev/)
- [Advanced Electron.js Architecture -- LogRocket](https://blog.logrocket.com/advanced-electron-js-architecture/)
- [electron-vite documentation](https://electron-vite.org/)
- [Why Electron Forge -- Electron Forge docs](https://www.electronforge.io/core-concepts/why-electron-forge)
