# Phase 2: Folder Browsing and Thumbnail Grid - Research

**Researched:** 2026-03-14
**Domain:** Virtualized image grid, Web Worker thumbnail generation, EXIF extraction, Electron file I/O
**Confidence:** HIGH

## Summary

Phase 2 builds the core photo browsing experience: folder scanning, EXIF extraction, timestamp-based grouping, virtualized grid rendering with variable-height group rows, Web Worker thumbnail generation, classification borders, results file persistence, and session persistence. The key architectural challenge is combining a grouped layout (variable-height rows for photo series) with virtualized scrolling that handles 1,000+ images without UI freezes.

The standard stack is well-established: `@tanstack/react-virtual` for headless virtualization with variable-height rows, `exifr` for fast EXIF parsing in Web Workers, `electron-store` for session persistence, and `natural-orderby` for natural filename sorting. All are pure JS/TS with no native dependencies, matching the project's zero-native-deps constraint.

**Primary recommendation:** Use `@tanstack/react-virtual` with row-level virtualization where each "row" is a group (photo series). Compute group heights deterministically from thumbnail size and wrap count. Extract EXIF timestamps eagerly via a Web Worker pool using `exifr` with the `pick` option for minimal parsing overhead.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- Images grouped by timestamp delta between consecutive photos (sorted by EXIF DateTimeOriginal, fallback to file modified time)
- Configurable threshold via slider (range: <1s to <60s, default at Claude's discretion)
- Each group occupies its own row(s) in the grid, wrapping within group area if too wide
- HR-style divider between groups with lightweight group headers showing count + time range
- Classification via colored borders: green=keep, yellow=review, red=delete
- Manual override: click or Space cycles red->yellow->green->red
- Arrow keys navigate grid (left/right within group, up/down between groups)
- Single JSON results file in photo folder (`photo-culler-results.json`), keyed by filename
- Auto-saved on every classification change (debounced), reloaded on reopen
- Execute button: move to OS trash or permanent delete, optional move keeps to `picks/` subfolder
- Thumbnails generated in renderer Web Workers using `createImageBitmap()` + OffscreenCanvas
- Thumbnail target: 256x256px, memory-cached only (no disk cache)
- Progressive loading with placeholders, priority loading for visible viewport
- Worker pool size: `navigator.hardwareConcurrency`
- Three thumbnail size presets: Small (120px), Medium (200px default), Large (300px)
- `object-fit: cover` in square cells
- Flat scan of selected directory + `picks/` subfolder
- Supported extensions: .jpg, .jpeg, .png, .tiff, .tif, .webp (case-insensitive)
- EXIF timestamps extracted eagerly for ALL images on folder open
- Scanning in main process via `fs.readdir()` + `fs.stat()`
- Sort options: timestamp (default), filename (natural sort), file size, dimensions
- Filter by file type (multi-select) and classification
- Search by filename (instant, debounced)
- Session persistence: last folder, thumbnail size, grouping slider value
- Drag-and-drop folder opening with full-window drop target
- Error handling: empty state, broken-image placeholder, permission banner, progress for 10,000+

### Claude's Discretion
- Exact Web Worker pool implementation details (queue strategy, error recovery)
- Virtualization library choice (must handle variable-height rows for groups)
- Exact UI component hierarchy and file organization
- Toolbar layout and control positioning
- Grouping slider default value and step increments
- Results file JSON schema
- Whether Phase 2 ships a real quality heuristic or marks all as "review" pending Phase 4
- Animation/transition details
- Whether to use `electron-store` package or hand-rolled JSON persistence

### Deferred Ideas (OUT OF SCOPE)
- EXIF-embedded classifications (corruption risk, format limitations)
- Content-hash keyed results (hashing overhead)

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| BROW-01 | User can select a folder via native OS dialog (Cmd+O / Ctrl+O) | Existing `SELECT_FOLDER` IPC handler + keyboard shortcut in menu |
| BROW-02 | User can view all images as a scrollable thumbnail grid | @tanstack/react-virtual grouped layout + Web Worker thumbnails |
| BROW-03 | Thumbnail grid handles 1,000+ images without UI freezes | Virtualized scrolling with overscan, off-main-thread thumbnail generation |
| BROW-04 | Thumbnails load progressively via Web Workers | Worker pool with priority queue, `createImageBitmap` + OffscreenCanvas |
| BROW-05 | User can navigate thumbnails with arrow keys | Keyboard handler on grid container with group-aware navigation |
| BROW-06 | User can sort by filename, date taken, file size, dimensions | natural-orderby for filename sort, standard comparators for rest |
| BROW-07 | User can filter images by file type | Client-side filter on extension field |
| BROW-08 | User can search images by filename | Debounced client-side filter on name field |
| UX-01 | App remembers last opened folder across sessions | electron-store for session persistence |
| UX-02 | User can drag-and-drop a folder onto the window | HTML5 drag-and-drop with directory detection via `webkitGetAsEntry()` |
| UX-04 | App handles edge cases gracefully | Error boundaries, placeholder thumbnails, permission checks |
| UX-05 | User can adjust thumbnail size | Three presets persisted via electron-store, grid recomputes on change |

</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @tanstack/react-virtual | ^3.13 | Headless virtualization for variable-height grouped rows | Only mainstream virtualizer that supports variable row heights without opinionated rendering. Headless design fits custom grouped layout. |
| exifr | ^7.1 | EXIF DateTimeOriginal extraction in Web Workers | Fastest JS EXIF parser. Supports `pick` option to read only specific tags. Works in Web Workers. Pure JS, no native deps. |
| electron-store | ^10.0 | Session persistence (last folder, thumbnail size, grouping slider) | De facto standard for Electron key-value persistence. Schema validation, migration support. |
| natural-orderby | ^4.0 | Natural sort for filenames (IMG_2 before IMG_10) | < 1.6kB gzipped. TypeScript-native. Provides `compare()` for Array.sort(). |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (built-in) Web Workers | N/A | Off-main-thread thumbnail generation + EXIF extraction | Always -- all heavy image work runs in workers |
| (built-in) createImageBitmap | N/A | Decode images off-main-thread | Thumbnail generation in worker pool |
| (built-in) OffscreenCanvas | N/A | Resize decoded images to thumbnail dimensions | Drawing resized thumbnails in workers |
| (built-in) shell.trashItem | Electron 41 | Move files to OS trash | Execute button trash action |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| @tanstack/react-virtual | react-window | react-window's VariableSizeList works but is less flexible for custom grouped layouts. No headless design -- couples rendering with virtualization. Not maintained as actively. |
| @tanstack/react-virtual | react-virtuoso | Heavier abstraction, better out-of-box grouped lists but harder to customize at the cell level. Would add unnecessary weight. |
| exifr | ExifReader | ExifReader works but exifr is faster (up to 30x) and has purpose-built `pick` option for reading only specific tags. |
| electron-store | Hand-rolled JSON + app.getPath('userData') | electron-store adds schema validation, migrations, and atomic writes. Hand-rolling saves a dependency but loses robustness for ~5KB. Use electron-store. |
| natural-orderby | String.prototype.localeCompare with numeric option | `localeCompare(b, undefined, {numeric: true})` works for simple cases but natural-orderby handles more edge cases (mixed decimals, dates, hex). Worth the 1.6kB. |

**Installation:**
```bash
cd apps/desktop
pnpm add @tanstack/react-virtual exifr electron-store natural-orderby
pnpm add -D @types/natural-orderby  # if needed -- check if types are bundled
```

Note: `natural-orderby` is written in TypeScript natively, so no `@types` package needed.

## Architecture Patterns

### Recommended Project Structure
```
apps/desktop/src/
├── main/
│   ├── index.ts                 # App entry, menu with Cmd+O
│   ├── ipc-handlers.ts          # SCAN_FOLDER, SAVE_RESULTS, LOAD_RESULTS, MOVE_TO_PICKS, TRASH_FILES
│   ├── protocol.ts              # app:// protocol (existing)
│   └── store.ts                 # electron-store instance (session persistence)
├── preload/
│   └── index.ts                 # contextBridge with new IPC methods
├── renderer/src/
│   ├── App.tsx                  # Root component with folder state
│   ├── components/
│   │   ├── Toolbar.tsx          # Sort, filter, search, grouping slider, thumbnail size, execute button
│   │   ├── DropZone.tsx         # Full-window drag-and-drop overlay
│   │   ├── PhotoGrid.tsx        # Virtualized grouped grid (main component)
│   │   ├── GroupRow.tsx         # Single group: header + thumbnail cells
│   │   ├── ThumbnailCell.tsx    # Individual thumbnail with classification border
│   │   └── EmptyState.tsx       # No-images-found UI
│   ├── hooks/
│   │   ├── usePhotoStore.ts     # Central state: images, groups, classifications, filters
│   │   ├── useThumbnailWorker.ts # Worker pool management + priority queue
│   │   ├── useKeyboardNav.ts    # Arrow key navigation within grouped grid
│   │   └── useGrouping.ts       # Timestamp grouping logic with configurable threshold
│   ├── workers/
│   │   ├── thumbnail.worker.ts  # createImageBitmap + OffscreenCanvas resize
│   │   └── exif.worker.ts       # exifr DateTimeOriginal extraction
│   └── lib/
│       ├── grouping.ts          # Pure function: images + threshold -> groups
│       ├── sorting.ts           # Sort comparators using natural-orderby
│       └── results.ts           # Results file schema + serialization
packages/
├── types/src/
│   ├── image.ts                 # ImageFileInfo (extended with dateTaken)
│   └── ipc.ts                   # IPC channel constants + ElectronAPI (extended)
└── image-utils/src/
    ├── scanner.ts               # Folder scanning logic (used by main process)
    └── index.ts                 # Re-exports
```

### Pattern 1: Row-Level Virtualization for Grouped Grid

**What:** Each "virtual row" is an entire photo group (series). The virtualizer manages groups, not individual thumbnails. Group height is computed deterministically from: number of images, thumbnail cell size, container width.

**When to use:** Always -- this is the core grid architecture.

**Why:** The grid is grouped by timestamp, meaning each group has a different number of photos and therefore a different pixel height. @tanstack/react-virtual's `estimateSize` callback receives the group index and returns the precomputed height.

**Example:**
```typescript
// Source: @tanstack/react-virtual docs + project-specific adaptation
import { useVirtualizer } from '@tanstack/react-virtual';

function PhotoGrid({ groups, cellSize, containerWidth }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);

  // Compute height for each group deterministically
  const getGroupHeight = (groupIndex: number) => {
    const group = groups[groupIndex];
    const imagesPerRow = Math.floor(containerWidth / cellSize);
    const rowCount = Math.ceil(group.images.length / imagesPerRow);
    const headerHeight = 32; // group header
    const dividerHeight = 16; // hr divider
    return headerHeight + rowCount * cellSize + dividerHeight;
  };

  const virtualizer = useVirtualizer({
    count: groups.length,
    getScrollElement: () => parentRef.current,
    estimateSize: getGroupHeight,
    overscan: 3, // render 3 groups above/below viewport
  });

  return (
    <div ref={parentRef} style={{ height: '100%', overflow: 'auto' }}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={virtualRow.key}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: virtualRow.size,
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            <GroupRow group={groups[virtualRow.index]} cellSize={cellSize} />
          </div>
        ))}
      </div>
    </div>
  );
}
```

### Pattern 2: Priority-Based Worker Pool for Thumbnails

**What:** A pool of Web Workers processes thumbnail generation requests. Visible thumbnails get priority over off-screen ones. When the user scrolls, off-screen pending requests are deprioritized.

**When to use:** Always -- thumbnails must not block the main thread.

**Example:**
```typescript
// Thumbnail worker (thumbnail.worker.ts)
self.onmessage = async (e: MessageEvent<{ id: string; url: string; size: number }>) => {
  const { id, url, size } = e.data;
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);

    // Resize to target thumbnail size using OffscreenCanvas
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d')!;

    // object-fit: cover -- crop to fill square
    const scale = Math.max(size / bitmap.width, size / bitmap.height);
    const sw = size / scale;
    const sh = size / scale;
    const sx = (bitmap.width - sw) / 2;
    const sy = (bitmap.height - sh) / 2;
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, size, size);
    bitmap.close(); // free memory

    const thumbnailBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
    const thumbnailBitmap = await createImageBitmap(thumbnailBlob);
    self.postMessage({ id, bitmap: thumbnailBitmap }, [thumbnailBitmap]);
  } catch {
    self.postMessage({ id, error: true });
  }
};

// Pool manager (useThumbnailWorker.ts)
// - Maintain array of N workers (navigator.hardwareConcurrency)
// - Priority queue: visible items first (check against viewport range)
// - On scroll, re-sort queue to prioritize newly visible items
// - Cache: Map<string, ImageBitmap> keyed by file path
// - On completion, postMessage transfers ImageBitmap (zero-copy)
```

### Pattern 3: Eager EXIF Extraction in Dedicated Worker

**What:** On folder open, dispatch all image paths to an EXIF worker that extracts DateTimeOriginal for each image. Results stream back progressively.

**Example:**
```typescript
// exif.worker.ts
import exifr from 'exifr';

self.onmessage = async (e: MessageEvent<{ files: Array<{ path: string; url: string }> }>) => {
  for (const file of e.data.files) {
    try {
      const response = await fetch(file.url);
      const buffer = await response.arrayBuffer();
      // Only read DateTimeOriginal -- minimal parsing
      const exif = await exifr.parse(buffer, {
        pick: ['DateTimeOriginal'],
        translateValues: false,
      });
      const dateTaken = exif?.DateTimeOriginal
        ? new Date(exif.DateTimeOriginal).getTime()
        : null;
      self.postMessage({ path: file.path, dateTaken });
    } catch {
      self.postMessage({ path: file.path, dateTaken: null });
    }
  }
  self.postMessage({ done: true });
};
```

### Pattern 4: Deterministic Grouping as Pure Function

**What:** Grouping logic is a pure function: `(sortedImages, thresholdMs) => Group[]`. No side effects, easily testable.

**Example:**
```typescript
// lib/grouping.ts
export interface PhotoGroup {
  id: string;
  images: ImageFileInfo[];
  startTime: number | null;
  endTime: number | null;
}

export function groupByTimestamp(
  images: ImageFileInfo[],  // already sorted by dateTaken
  thresholdMs: number,
): PhotoGroup[] {
  if (images.length === 0) return [];

  const groups: PhotoGroup[] = [];
  let currentGroup: ImageFileInfo[] = [images[0]];

  for (let i = 1; i < images.length; i++) {
    const prev = images[i - 1];
    const curr = images[i];
    const prevTime = prev.dateTaken ?? prev.lastModified;
    const currTime = curr.dateTaken ?? curr.lastModified;
    const delta = Math.abs(currTime - prevTime);

    if (delta <= thresholdMs) {
      currentGroup.push(curr);
    } else {
      groups.push(makeGroup(currentGroup));
      currentGroup = [curr];
    }
  }
  groups.push(makeGroup(currentGroup));
  return groups;
}
```

### Pattern 5: Drag-and-Drop Directory Detection

**What:** Use HTML5 drag-and-drop with `webkitGetAsEntry()` to detect directories vs files.

**Example:**
```typescript
// DropZone.tsx
function handleDrop(e: React.DragEvent) {
  e.preventDefault();
  const items = e.dataTransfer.items;
  for (let i = 0; i < items.length; i++) {
    const entry = items[i].webkitGetAsEntry?.();
    if (entry?.isDirectory) {
      // In Electron, files have a .path property
      const file = e.dataTransfer.files[i];
      const folderPath = (file as any).path;
      openFolder(folderPath);
      return;
    }
  }
  // Show toast: "Drop a folder, not a file"
}
```

### Anti-Patterns to Avoid
- **Virtualizing individual thumbnails:** Do NOT virtualize at the thumbnail level. Groups have visual structure (header, divider) that breaks with per-cell virtualization. Virtualize at the group level.
- **Lazy EXIF extraction:** Grouping requires ALL timestamps upfront. Do not defer EXIF extraction -- run it eagerly as a batch on folder open.
- **Main-thread image decoding:** Never decode or resize images on the main thread. Always use Web Workers with createImageBitmap.
- **Storing ImageBitmap in React state:** ImageBitmap is a transferable object, not serializable. Use a Map/WeakMap ref outside React state, and use a counter or version number in state to trigger re-renders.
- **Re-creating workers on every render:** Create the worker pool once and hold it in a ref. Workers are expensive to spawn.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Natural sort | Custom regex-based number extraction | `natural-orderby` `compare()` | Handles decimals, hex, dates, unicode edge cases. 1.6kB. |
| EXIF parsing | Manual JPEG segment parsing | `exifr` with `pick` option | EXIF format is deeply complex (IFD pointers, byte order, TIFF structure). Exifr handles all image formats. |
| Session persistence | `fs.writeFileSync` to userData | `electron-store` | Atomic writes, schema validation, migration support, handles concurrent access. |
| Virtualized scrolling | Manual scroll position tracking + DOM recycling | `@tanstack/react-virtual` | Scroll position management, overscan, variable heights, measurement -- all solved. |
| Object-fit cover cropping | CSS-only approach in workers | Canvas math (see thumbnail worker example) | Workers have no CSS. Must compute crop rect manually when using OffscreenCanvas. |

**Key insight:** The temptation in this phase is to hand-roll the worker pool and priority queue from scratch. While the pool itself is simple, the priority scheduling (viewport-aware) and error recovery are where complexity hides. Keep the pool simple with a sorted array queue -- do not build a sophisticated data structure.

## Common Pitfalls

### Pitfall 1: electron-store ESM + electron-vite Bundling
**What goes wrong:** electron-store v10+ is ESM-only. electron-vite's `externalizeDepsPlugin` externalizes all dependencies by default. Externalized ESM packages fail at runtime because Electron's main process historically uses CJS.
**Why it happens:** electron-vite externalizes deps listed in package.json `dependencies`, but ESM-only packages need to be bundled.
**How to avoid:** Exclude electron-store from externalization in `electron.vite.config.ts`:
```typescript
main: {
  plugins: [externalizeDepsPlugin({ exclude: ['electron-store'] })],
}
```
**Warning signs:** "Cannot use import statement outside a module" error at runtime in main process.

### Pitfall 2: ImageBitmap Memory Leaks
**What goes wrong:** ImageBitmap objects consume GPU/CPU memory and are not garbage collected like normal JS objects. If you decode 1,000+ images and never call `.close()`, memory balloons.
**Why it happens:** ImageBitmap is a handle to decoded pixel data, not a JS object graph.
**How to avoid:** Call `bitmap.close()` on intermediate bitmaps in the worker after drawing to canvas. For cached thumbnails in the main thread, close them when images leave the cache (e.g., on folder change).
**Warning signs:** Memory usage growing linearly with folder size, never decreasing.

### Pitfall 3: Worker Message Overhead with Large Payloads
**What goes wrong:** If you postMessage the thumbnail as a Blob or ArrayBuffer without transferring, the data is cloned (copied), doubling memory briefly.
**Why it happens:** `postMessage` copies by default. Only transferable objects (ImageBitmap, ArrayBuffer) can be zero-copy transferred.
**How to avoid:** Always use the transfer list: `self.postMessage({ bitmap }, [bitmap])`. After transfer, the bitmap is neutered in the sender.
**Warning signs:** Brief memory spikes during thumbnail generation, slower-than-expected worker throughput.

### Pitfall 4: TIFF Files and createImageBitmap
**What goes wrong:** `createImageBitmap()` does not support TIFF files in Chromium. Calling it on a TIFF blob throws an error.
**Why it happens:** TIFF is not a web-standard image format. Chromium's image decoder doesn't handle it.
**How to avoid:** For TIFF files, fall back to decoding in the main thread using an `<img>` element (which Electron's Chromium may or may not support for TIFF), or use a TIFF decoder library. Best approach: try `createImageBitmap` first, catch the error, and show a broken-image placeholder for unsupported formats. Document TIFF as potentially limited.
**Warning signs:** TIFF thumbnails never appearing, unhandled promise rejections in worker.

### Pitfall 5: Grouping Slider Re-renders Entire Grid
**What goes wrong:** Moving the grouping slider recomputes groups, which changes the virtualizer's `count` and `estimateSize`. If not handled carefully, this causes the virtualizer to reset scroll position.
**Why it happens:** TanStack Virtual recalculates everything when count changes.
**How to avoid:** Debounce the slider's onChange (e.g., 150ms). When groups change, try to maintain scroll position by finding which group was at the top of the viewport and scrolling to the equivalent group after regroup.
**Warning signs:** Grid jumps to top every time the user adjusts the grouping slider.

### Pitfall 6: Electron File Paths on Windows
**What goes wrong:** File paths with backslashes, spaces, or unicode characters fail when used as `app://` protocol URLs.
**Why it happens:** URL encoding differences between platforms.
**How to avoid:** Always `encodeURIComponent()` each path segment when constructing `app://` URLs. The existing protocol handler already uses `decodeURIComponent`, so encoding is safe.
**Warning signs:** Images fail to load on Windows but work on macOS.

### Pitfall 7: exifr Failing Silently on Non-EXIF Images
**What goes wrong:** PNG and WebP files often have no EXIF data. `exifr.parse()` returns `null` or `undefined` rather than throwing.
**Why it happens:** EXIF is primarily a JPEG/TIFF standard. PNG uses tEXt chunks, WebP has its own metadata format.
**How to avoid:** Always handle the `null` return. Fall back to `lastModified` from the file stat. The grouping function already handles this (see pattern 4).
**Warning signs:** PNG/WebP images always appearing as ungrouped singletons.

### Pitfall 8: Results File Race Condition
**What goes wrong:** Rapid classification changes trigger multiple concurrent writes to the results JSON file, potentially corrupting it.
**Why it happens:** Debouncing helps but doesn't fully prevent overlapping writes if the debounce window is short.
**How to avoid:** Use a write queue: only one write in flight at a time, with a "dirty" flag to trigger another write after the current one completes. Alternatively, electron-store (or a similar atomic-write approach) for the results file.
**Warning signs:** Truncated or empty results file after rapid clicking.

## Code Examples

### Web Worker Setup with electron-vite

electron-vite supports Web Workers via Vite's built-in worker support:
```typescript
// In renderer component
const worker = new Worker(
  new URL('../workers/thumbnail.worker.ts', import.meta.url),
  { type: 'module' }
);
```

### Results File Schema
```typescript
// lib/results.ts
interface ResultsFile {
  version: 1;
  folderPath: string;
  updatedAt: string; // ISO 8601
  images: Record<string, ImageResult>; // keyed by filename
}

interface ImageResult {
  classification: 'keep' | 'review' | 'delete';
  userOverride: boolean; // true if user manually changed classification
  qualityScore?: number; // populated by Phase 4
}
```

### Folder Scanning in Main Process
```typescript
// packages/image-utils/src/scanner.ts
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const SUPPORTED_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.tiff', '.tif', '.webp',
]);
const RESULTS_FILENAME = 'photo-culler-results.json';

export async function scanFolder(folderPath: string): Promise<ImageFileInfo[]> {
  const entries = await readdir(folderPath, { withFileTypes: true });
  const images: ImageFileInfo[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name.startsWith('.')) continue;
    if (entry.name === RESULTS_FILENAME) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) continue;

    const filePath = path.join(folderPath, entry.name);
    const stats = await stat(filePath);
    images.push({
      path: filePath,
      name: entry.name,
      extension: ext.slice(1),
      size: stats.size,
      lastModified: stats.mtimeMs,
    });
  }

  // Also scan picks/ subfolder
  const picksDir = path.join(folderPath, 'picks');
  try {
    const picksEntries = await readdir(picksDir, { withFileTypes: true });
    for (const entry of picksEntries) {
      if (!entry.isFile()) continue;
      if (entry.name.startsWith('.')) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(ext)) continue;

      const filePath = path.join(picksDir, entry.name);
      const stats = await stat(filePath);
      images.push({
        path: filePath,
        name: entry.name,
        extension: ext.slice(1),
        size: stats.size,
        lastModified: stats.mtimeMs,
      });
    }
  } catch {
    // picks/ doesn't exist -- that's fine
  }

  return images;
}
```

### electron-store Session Config
```typescript
// main/store.ts
import Store from 'electron-store';

interface SessionSchema {
  lastFolderPath?: string;
  thumbnailSize: 'small' | 'medium' | 'large';
  groupingThresholdMs: number;
}

export const sessionStore = new Store<SessionSchema>({
  name: 'session',
  defaults: {
    thumbnailSize: 'medium',
    groupingThresholdMs: 5000, // 5 second default
  },
});
```

### ImageBitmap Transfer from Worker
```typescript
// In worker: transfer bitmap (zero-copy)
const bitmap = await createImageBitmap(thumbnailBlob);
self.postMessage({ id, bitmap }, [bitmap]);

// In main thread: receive and cache
worker.onmessage = (e) => {
  const { id, bitmap, error } = e.data;
  if (error) {
    thumbnailCache.set(id, 'error');
  } else {
    thumbnailCache.set(id, bitmap);
  }
  // Trigger re-render via state update (e.g., increment a counter)
  setThumbnailVersion((v) => v + 1);
};
```

### Rendering Cached ImageBitmap to Visible Canvas
```typescript
// ThumbnailCell.tsx
function ThumbnailCell({ imageId, cellSize }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bitmap = thumbnailCache.get(imageId);

  useEffect(() => {
    if (bitmap && bitmap !== 'error' && canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        ctx.drawImage(bitmap, 0, 0, cellSize, cellSize);
      }
    }
  }, [bitmap, cellSize]);

  return (
    <canvas
      ref={canvasRef}
      width={cellSize}
      height={cellSize}
      className="rounded"
    />
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| react-window / react-virtualized | @tanstack/react-virtual v3 | 2023+ | Headless, framework-agnostic, better TypeScript, active maintenance |
| exif-js | exifr | 2020+ | exif-js is unmaintained. exifr is 30x faster with modular bundles. |
| shell.moveItemToTrash (sync) | shell.trashItem (async) | Electron 13 | Old API removed. Must use async shell.trashItem(). |
| Canvas in main thread | OffscreenCanvas in Worker | 2022+ (broad support) | Enables off-main-thread image processing. Chromium fully supports it. |
| electron-store CJS | electron-store ESM-only | v9+ | Must handle ESM bundling in electron-vite config |

**Deprecated/outdated:**
- `react-virtualized`: Superseded by react-window, then by @tanstack/react-virtual. Do not use.
- `exif-js`: Unmaintained since 2019. Use exifr.
- `shell.moveItemToTrash()`: Removed in Electron 13. Use `shell.trashItem()`.

## Open Questions

1. **TIFF Support in createImageBitmap**
   - What we know: Chromium does not support TIFF in `createImageBitmap`. Electron inherits this limitation.
   - What's unclear: Whether Electron's `<img>` tag can render TIFF (it may via system codecs on macOS but not Windows).
   - Recommendation: Attempt `createImageBitmap` for all formats, catch failures for TIFF, show broken-image placeholder. TIFF is a niche format for web use. If users request it, explore a TIFF decoder library in a future phase.

2. **Phase 2 Quality Heuristic vs Placeholder**
   - What we know: Phase 4 implements real quality scoring. Phase 2 needs colored borders.
   - What's unclear: Whether a simple sharpness heuristic (Laplacian variance) is worth implementing now.
   - Recommendation: Mark all images as "review" (yellow) in Phase 2. This is honest, avoids misleading classifications, and keeps Phase 2 focused on the grid/browsing experience. Phase 4 will populate real scores.

3. **Worker Termination on Folder Change**
   - What we know: When user opens a new folder, all in-flight thumbnail generation for the old folder is wasted work.
   - What's unclear: Best strategy for cancellation.
   - Recommendation: Terminate all workers and create new ones on folder change. Worker creation is cheap (~1ms). Clear the thumbnail cache. This is simpler and more reliable than trying to cancel individual messages.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1 (already in devDependencies) |
| Config file | none -- see Wave 0 |
| Quick run command | `pnpm --filter @photo-culler/desktop test` |
| Full suite command | `pnpm test` (turbo run test) |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BROW-01 | Folder selection returns path | integration (IPC mock) | `pnpm --filter @photo-culler/desktop exec vitest run src/renderer/src/__tests__/folder-selection.test.ts` | Wave 0 |
| BROW-02 | Images display in grid | unit (component) | `pnpm --filter @photo-culler/desktop exec vitest run src/renderer/src/__tests__/photo-grid.test.ts` | Wave 0 |
| BROW-03 | Virtualization renders only visible groups | unit | `pnpm --filter @photo-culler/desktop exec vitest run src/renderer/src/__tests__/photo-grid.test.ts` | Wave 0 |
| BROW-04 | Thumbnails load progressively | unit (worker mock) | `pnpm --filter @photo-culler/desktop exec vitest run src/renderer/src/__tests__/thumbnail-worker.test.ts` | Wave 0 |
| BROW-05 | Arrow keys navigate grid | unit | `pnpm --filter @photo-culler/desktop exec vitest run src/renderer/src/__tests__/keyboard-nav.test.ts` | Wave 0 |
| BROW-06 | Sort by filename/date/size/dimensions | unit | `pnpm --filter @photo-culler/image-utils exec vitest run src/__tests__/sorting.test.ts` | Wave 0 |
| BROW-07 | Filter by file type | unit | `pnpm --filter @photo-culler/desktop exec vitest run src/renderer/src/__tests__/filtering.test.ts` | Wave 0 |
| BROW-08 | Search by filename | unit | `pnpm --filter @photo-culler/desktop exec vitest run src/renderer/src/__tests__/filtering.test.ts` | Wave 0 |
| UX-01 | Session persistence | unit (electron-store mock) | `pnpm --filter @photo-culler/desktop exec vitest run src/main/__tests__/store.test.ts` | Wave 0 |
| UX-02 | Drag-and-drop folder | unit (event mock) | `pnpm --filter @photo-culler/desktop exec vitest run src/renderer/src/__tests__/drop-zone.test.ts` | Wave 0 |
| UX-04 | Error handling edge cases | unit | `pnpm --filter @photo-culler/image-utils exec vitest run src/__tests__/scanner.test.ts` | Wave 0 |
| UX-05 | Thumbnail size adjustment | unit | `pnpm --filter @photo-culler/desktop exec vitest run src/renderer/src/__tests__/photo-grid.test.ts` | Wave 0 |
| -- | Grouping by timestamp | unit | `pnpm --filter @photo-culler/image-utils exec vitest run src/__tests__/grouping.test.ts` | Wave 0 |
| -- | Results file save/load | unit | `pnpm --filter @photo-culler/desktop exec vitest run src/main/__tests__/results.test.ts` | Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm --filter @photo-culler/desktop exec vitest run`
- **Per wave merge:** `pnpm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `apps/desktop/vitest.config.ts` -- Vitest config for desktop app (needs jsdom environment for renderer tests)
- [ ] `packages/image-utils/vitest.config.ts` -- Vitest config for image-utils package
- [ ] `packages/image-utils/src/__tests__/grouping.test.ts` -- grouping pure function tests
- [ ] `packages/image-utils/src/__tests__/scanner.test.ts` -- folder scanner tests (mock fs)
- [ ] `packages/image-utils/src/__tests__/sorting.test.ts` -- sort comparator tests
- [ ] Web Worker mocking strategy for vitest (workers don't run in jsdom)

## Sources

### Primary (HIGH confidence)
- [@tanstack/react-virtual npm](https://www.npmjs.com/package/@tanstack/react-virtual) - v3.13, variable height API, estimateSize pattern
- [TanStack Virtual variable example](https://tanstack.com/virtual/latest/docs/framework/react/examples/variable) - variable height row implementation
- [exifr GitHub](https://github.com/MikeKovarik/exifr) - API, pick option, bundle variants, Web Worker usage
- [MDN OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas) - Worker-compatible canvas API
- [MDN createImageBitmap](https://developer.mozilla.org/en-US/docs/Web/API/WorkerGlobalScope/createImageBitmap) - Off-thread image decoding
- [Electron shell API](https://www.electronjs.org/docs/latest/api/shell) - shell.trashItem() documentation
- [electron-store GitHub](https://github.com/sindresorhus/electron-store) - ESM-only, Electron 30+ requirement
- [natural-orderby GitHub](https://github.com/yobacca/natural-orderby) - API, TypeScript support, compare() function

### Secondary (MEDIUM confidence)
- [electron-vite dependency handling](https://electron-vite.org/guide/dependency-handling) - externalizeDepsPlugin exclude pattern
- [electron-vite troubleshooting](https://electron-vite.org/guide/troubleshooting) - ESM package bundling
- [Web Performance Calendar 2025](https://calendar.perfplanet.com/2025/non-blocking-image-canvas/) - OffscreenCanvas real-world usage patterns

### Tertiary (LOW confidence)
- TIFF support in Chromium's createImageBitmap -- inferred from general web platform knowledge, not verified with Electron-specific testing

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all libraries verified via npm/GitHub, actively maintained, compatible versions confirmed
- Architecture: HIGH - patterns derived from official TanStack Virtual examples + established Web Worker patterns
- Pitfalls: HIGH - electron-store ESM issue verified via electron-vite docs; ImageBitmap memory/transfer patterns from MDN
- TIFF support: LOW - needs runtime testing in Electron environment

**Research date:** 2026-03-14
**Valid until:** 2026-04-14 (stable ecosystem, 30-day window)
