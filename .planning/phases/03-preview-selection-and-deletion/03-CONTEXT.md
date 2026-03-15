# Phase 3: Preview, Selection, and Deletion - Context

**Gathered:** 2026-03-15
**Status:** Ready for planning
**Mode:** User-discussed (interactive decisions on preview, selection, delete workflow, theme)

<domain>
## Phase Boundary

Users can click a thumbnail to open a full-size preview with zoom/pan, navigate between images, see EXIF metadata and a filmstrip. Users can multi-select images via Ctrl/Cmd+click and Shift+click, and batch-delete to OS trash. Backspace instantly trashes the focused image. Dark theme only (no theme toggle). Completes the core value proposition.

</domain>

<decisions>
## Implementation Decisions

### Preview Mode Layout
- **Keep the current layout as-is** — preview replaces the grid area, info panel stays on the right
- Enter on a focused thumbnail opens preview mode (Phase 2 CONTEXT deferred this)
- Preview shows the full-size image in the grid area with zoom/pan
- Filmstrip of thumbnails at the bottom of the preview area
- Escape returns to grid view
- Arrow keys navigate between images in preview mode
- Info panel continues showing EXIF metadata for the current preview image

### Selection Model
- **Keep existing classification behavior unchanged** — click/Space cycles classification borders (keep/review/delete)
- **No new hotkeys** for classification — existing Space key cycle is sufficient
- Multi-select is additive: Ctrl/Cmd+click toggles individual images, Shift+click selects range
- **Shift+click range is within the same group only** — does not cross group boundaries
- Ctrl+A selects all images
- Selection is a separate concept from classification — selected images have a visual highlight distinct from classification borders
- Selection count shown in toolbar: "12 of 42 selected"

### Delete Workflow
- **Backspace key = instant trash** — no confirmation dialog, immediately moves focused image to OS trash via `shell.trashItem`
- After trashing, **focus moves to the next image** in the sequence
- **No permanent delete option** in this phase — Backspace always uses OS trash (recoverable)
- Delete key or toolbar button on multi-selected images also moves to OS trash instantly (no confirmation for keyboard shortcut)
- **Confirmation dialog only on batch Execute** — the existing Execute panel from Phase 2 keeps its confirmation flow for classification-based batch operations
- Deleted images removed from grid immediately

### Theme
- **No theme toggle** — keep dark theme only as shipped in Phase 2
- UX-03 (dark/light theme toggle) is deferred out of Phase 3

### Claude's Discretion
- Preview zoom implementation (CSS transform vs canvas)
- Filmstrip thumbnail size and scroll behavior
- Selection highlight styling (how it visually differs from classification borders)
- Zoom levels and transitions (fit-to-window, 100%, scroll-to-zoom increments)
- Pan implementation (drag vs cursor-based)
- Toolbar layout changes for selection count
- Whether preview mode is a route change or a state toggle

</decisions>

<specifics>
## Specific Ideas

- Preview should feel instant — preload the full-size image while showing the cached thumbnail as placeholder
- Filmstrip should highlight the current image and scroll to keep it centered
- Backspace-to-trash should feel snappy — no animation delay, just gone, next image immediately
- Selection highlight should be clearly different from classification borders — maybe a checkmark overlay or a blue tint
- Zoom should be smooth — scroll-to-zoom with momentum, not stepped

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- **InfoPanel** (`components/InfoPanel.tsx`): Already shows large preview + full EXIF metadata. Preview mode can reuse this or extend it
- **`window.api.readFile`** IPC: Reads full image files — already used by InfoPanel for large preview via object URL
- **`window.api.trashFiles`** IPC: Already implemented and working — accepts array of file paths
- **Thumbnail disk cache** (`.photo-culler-thumbs/`): Cached JPEG thumbnails can be used for the filmstrip
- **`useKeyboardNav`** hook: Handles arrow keys, Space, Home/End. Needs extension for Backspace, Enter, Escape, Ctrl+A
- **`usePhotoStore`** hook: Central state — needs `selectedImages: Set<string>` added alongside existing `focusedImageId`
- **EXIF metadata fields**: Full camera metadata already on `ImageFileInfo` (cameraMake, cameraModel, lens, aperture, shutter, ISO, etc.)

### Established Patterns
- IPC channels defined in `@photo-culler/types`, handlers in main process
- Renderer accesses OS features through `window.api` (contextBridge)
- Tailwind CSS dark theme (`bg-gray-900 text-white`) as default
- State managed via `useState` + `useCallback` in `usePhotoStore` hook
- Image files read via IPC `READ_FILE` channel, displayed via object URLs

### Integration Points
- `App.tsx` renders grid or preview based on a mode state
- `useKeyboardNav` needs Backspace (trash), Enter (open preview), Escape (close preview)
- `Toolbar.tsx` needs selection count display and possibly a delete button
- `usePhotoStore` needs selection state (Set<string>) and preview mode state

</code_context>

<deferred>
## Deferred Ideas

- **UX-03 (theme toggle)**: Dark/light theme toggle deferred — app stays dark-only for now
- **Permanent delete**: No permanent delete option — Backspace always uses OS trash

</deferred>

---

*Phase: 03-preview-selection-and-deletion*
*Context gathered: 2026-03-15*
*Mode: User-discussed (preview layout, selection model, delete workflow, theme)*
