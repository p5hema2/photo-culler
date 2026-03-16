# Phase 2: Folder Browsing and Thumbnail Grid - Context

**Gathered:** 2026-03-14
**Status:** Ready for planning
**Mode:** User-discussed (interactive decisions on grouping, results, classification)

<domain>
## Phase Boundary

Users can select a folder and browse all discovered images in a grouped, virtualized thumbnail grid. Photos are automatically grouped by timestamp proximity into series. Each image receives an auto-quality classification (keep/review/delete) shown via colored borders, which the user can override. Results are saved to a JSON file alongside the photos. Includes sorting, filtering, search, and an execute button for batch operations. Handles 1,000+ photos without UI freezes.

</domain>

<decisions>
## Implementation Decisions

### Photo Series Grouping
- Images are **grouped by timestamp delta** between consecutive photos (sorted by EXIF DateTimeOriginal, falling back to file modified time)
- **Configurable threshold via slider** — user adjusts grouping sensitivity per session:
  - Range: <1s (tight burst) to <60s (loose grouping)
  - Default: a sensible mid-range (e.g., 5s) — Claude decides exact default
- Each group occupies its **own row** in the grid — images side-by-side, equal size
- If a group is too wide, it **wraps within the group area** (multi-row for one group)
- **`<hr>`-style divider** between groups — clear visual separation
- **Group header** above each row showing: photo count, time range (e.g., "Series: 8 photos · 14:23:05 – 14:23:12")
- Single photos are a **group of 1** — same visual treatment, same header
- EXIF timestamps must be extracted for ALL images on folder open (required for grouping) — not lazy like originally planned

### Classification and Color Borders
- Each image gets an **auto-quality classification** on folder open:
  - **Green border** = keep (good quality)
  - **Yellow border** = review (uncertain)
  - **Red border** = delete (poor quality)
- Auto-classification runs **immediately in background** when folder opens — borders appear progressively as scoring completes
- Quality scoring algorithm is Phase 4's domain, but the **border UI and manual override** ship in Phase 2
  - Phase 2 can use a simple heuristic (e.g., sharpness via Laplacian approximation) or mark all as "review" until Phase 4 scoring is implemented — Claude decides
- **Manual override**: click or press Space on a focused thumbnail to **cycle**: red → yellow → green → red
- **Arrow keys** navigate between thumbnails (left/right within group, up/down between groups)
- Border is the **only indicator** — no extra icons or labels
- **Group header includes classification summary** (e.g., "2 keep · 1 review · 5 delete")

### Results File
- Single **JSON file** saved in the same folder as the photos (e.g., `photo-culler-results.json`)
- Keyed by **filename** (user accepts rename risk)
- Stores per-image: classification (keep/review/delete), any user overrides, quality score
- **Auto-saved** on every classification change (debounced)
- **Reloaded on reopen** — when opening a folder with an existing results file, previous classifications are restored so the user can continue where they left off
- Results file format and exact schema at Claude's discretion

### Execute Button (Batch Operations)
- **Execute button** in the toolbar to act on classifications
- User chooses action mode: **move to OS trash** (recoverable) or **permanent delete** — let the user decide each time
- "Keep" files can optionally be **moved to a `picks/` subfolder**
- When opening a parent folder, the scan **includes the `picks/` subfolder** so all images load together regardless of location
- After executing, **grid updates immediately** — deleted images removed, moved images reflect new state

### Thumbnail Generation Strategy
- Generate thumbnails **in the renderer process** using Canvas API inside **Web Workers** — no native dependencies
- Thumbnail target size: **256×256 pixels** (fits all grid density levels with crisp display on 2x screens)
- Thumbnails are **memory-cached only** (no disk cache) — keeps the app zero-state and avoids managing stale caches
- Use `createImageBitmap()` in Web Workers for off-main-thread decoding, then draw to OffscreenCanvas to resize
- **Progressive loading**: grid renders immediately with placeholder cells; thumbnails fill in as Workers complete them
- Worker pool size: **navigator.hardwareConcurrency** (typically 4-8), with a task queue for remaining images
- Images are loaded via the existing `app://` protocol, which already handles path normalization and security
- **Priority loading**: visible thumbnails are generated first (viewport-aware scheduling), off-screen thumbnails queued at lower priority

### Grid Layout and Density
- **Grouped layout** — NOT a uniform auto-fill grid. Each group is its own row of equal-size thumbnails, wrapping if needed
- Three thumbnail size presets (UX-05):
  - **Small**: 120px cells — maximum density for fast scanning
  - **Medium**: 200px cells — default, balanced density
  - **Large**: 300px cells — detail-oriented browsing
- Thumbnails display with **`object-fit: cover`** inside square cells — consistent rhythm, slight crop on non-square images
- Size toggle persisted alongside last-opened folder and grouping slider value
- **Virtualized scrolling** — only renders visible groups plus overscan buffer (virtualization must handle variable-height group rows)
- Each thumbnail cell shows: image preview with colored classification border

### Folder Scanning Behavior
- **Flat scan** of selected directory PLUS a `picks/` subfolder if it exists
- Supported extensions: `.jpg`, `.jpeg`, `.png`, `.tiff`, `.tif`, `.webp` (case-insensitive match)
- HEIC excluded per roadmap decision (deferred to v2)
- Scanning happens in the **main process** via `fs.readdir()` + `fs.stat()` — returns `ImageFileInfo[]` to renderer
- **EXIF timestamps extracted eagerly** for all images (required for grouping) — runs in Web Workers in renderer after scan results arrive
- Hidden files (dotfiles), system files, and the results JSON file are excluded from results

### Sorting, Filtering, and Search
- **Default sort**: by timestamp (natural for grouped view — groups appear in chronological order)
- Sort options: timestamp (default), filename (natural sort), file size, dimensions (megapixels)
- **Filter by file type**: multi-select chip/toggle bar (JPG, PNG, TIFF, WebP) — filters are additive
- **Filter by classification**: show only keep, review, or delete — useful for reviewing specific categories
- **Search by filename**: instant client-side filter, debounced
- Sort direction toggle (ascending/descending)
- Grouping slider is always visible in toolbar — adjusting it re-groups in real time

### Keyboard Navigation
- **Arrow keys** navigate the grid: left/right move between thumbnails within a group, up/down jump between groups
- **Click or Space** on focused thumbnail to cycle classification: red → yellow → green → red
- **Focus ring** highlights the currently focused thumbnail
- Home/End jump to first/last thumbnail
- Enter on a focused thumbnail does nothing in Phase 2 (Phase 3 will open preview)

### Session Persistence (UX-01)
- Store last-opened folder path, thumbnail size, and grouping slider value
- Using Electron's `electron-store` or `app.getPath('userData')` + JSON file
- On app launch: if a stored folder path exists AND the folder still exists, auto-reopen it
- Results file in the photo folder handles classification persistence separately

### Drag-and-Drop (UX-02)
- User can drag a folder from Finder/Explorer onto the app window to open it
- Drop zone covers the entire window (full-window drop target)
- Visual feedback: overlay with "Drop folder to open" message during drag-over
- Validate that the dropped item is a directory (not a file) — ignore file drops with a brief toast

### Error Handling (UX-04)
- **Empty folder**: friendly empty state — folder icon + "No images found in this folder"
- **Corrupted/unreadable images**: skip silently during scan, show broken-image placeholder in grid if thumbnail generation fails, classify as "review" by default
- **Permission errors**: inline error banner "Cannot access [folder] — check permissions"
- **Massive folders (10,000+)**: progress indicator during scan and EXIF extraction
- **Results file write failure**: show warning toast, don't crash — classifications still held in memory

### Claude's Discretion
- Exact Web Worker pool implementation details (queue strategy, error recovery)
- Virtualization library choice (`react-window` vs `@tanstack/virtual` — must handle variable-height rows for groups)
- Exact UI component hierarchy and file organization
- Toolbar layout and control positioning
- Grouping slider default value and step increments
- Results file JSON schema
- Whether Phase 2 ships a real quality heuristic or marks all as "review" pending Phase 4
- Animation/transition details
- Whether to use `electron-store` package or hand-rolled JSON persistence

</decisions>

<specifics>
## Specific Ideas

- Thumbnail cells should feel snappy — placeholder → thumbnail transition should be near-instant for visible cells
- The grid should be usable (scrollable) even while thumbnails and classifications are still loading
- Natural sort for filenames is important for photographers (IMG_2 before IMG_10, not after)
- The sort/filter toolbar + grouping slider should be compact — maximize grid space
- The grouping slider is the signature UX of this app — it should feel responsive and re-group instantly
- Group headers should be lightweight, not dominating — the photos are the focus

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- **IPC bridge**: `SCAN_FOLDER` channel already defined in `packages/types/src/ipc.ts` — handler in `apps/desktop/src/main/ipc-handlers.ts` is a placeholder returning `[]`
- **`ImageFileInfo` type**: defined in `packages/types/src/image.ts` — has path, name, extension, size, lastModified, optional width/height. Needs extension: add `dateTaken?: number` for EXIF timestamp
- **`app://` protocol**: registered in `apps/desktop/src/main/protocol.ts` — serves local images to renderer securely
- **Folder selection**: `SELECT_FOLDER` IPC handler already working — opens native dialog, returns path
- **`TRASH_FILES` IPC channel**: defined but placeholder — needed for the execute/delete button
- **`packages/image-utils`**: exists but empty (`src/index.ts` exports only VERSION) — scanner and grouping logic goes here

### Established Patterns
- IPC channels defined as constants in `@photo-culler/types` package, handlers registered in main process
- Renderer accesses OS features exclusively through `window.api` (contextBridge)
- Tailwind CSS for styling, dark theme (`bg-gray-900 text-white`) as default
- electron-vite builds three targets: main, preload, renderer
- Path alias `@renderer` available in renderer code

### Integration Points
- `App.tsx` currently has a basic folder picker button — will be replaced with full grouped grid UI
- Main process menu (`main/index.ts`) has standard File/Edit/View/Window/Help — File menu needs Cmd+O shortcut
- electron-vite config has path aliases ready for use
- New IPC channels needed: `SAVE_RESULTS`, `LOAD_RESULTS`, `MOVE_TO_PICKS` (or extend existing channels)

</code_context>

<deferred>
## Deferred Ideas

- **EXIF-embedded classifications**: User considered storing keep/review/delete in image EXIF metadata to survive renames. Deferred due to corruption risk and format limitations (PNG/WebP). Could revisit as optional export in a future phase.
- **Content-hash keyed results**: Using image content hash instead of filename for rename-proof results. Deferred due to hashing overhead on reopen. Could be a future enhancement.

</deferred>

---

*Phase: 02-folder-browsing-and-thumbnail-grid*
*Context gathered: 2026-03-14*
*Mode: User-discussed (interactive session — grouping, results file, classification borders)*
