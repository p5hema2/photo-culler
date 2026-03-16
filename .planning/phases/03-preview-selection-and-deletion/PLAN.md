# Phase 3: Preview, Selection, and Deletion -- Plan

## Goal

Users can open a full-size image preview with zoom/pan and filmstrip navigation, multi-select images via modifier-clicks and Ctrl+A, and instantly trash images via Backspace/Delete -- completing the core photo-culling workflow.

## Requirements Traceability

| Requirement | Description | Task |
|-------------|-------------|------|
| PREV-01 | Click/Enter opens full-size preview | 1.1 (store + preview state), 2.1 (PreviewPanel component) |
| PREV-02 | Zoom: fit-to-window, 100%, scroll-to-zoom | 2.1 (useZoomPan hook) |
| PREV-03 | Pan when zoomed in | 2.1 (useZoomPan hook) |
| PREV-04 | Arrow key navigation in preview | 1.1 (useKeyboardNav extension) |
| PREV-05 | EXIF metadata in preview | 1.1 (existing InfoPanel -- focusedImageId drives it, no changes needed) |
| PREV-06 | Escape returns to grid | 1.1 (useKeyboardNav extension) |
| PREV-07 | Filmstrip in preview mode | 2.1 (Filmstrip component) |
| DEL-01 | Click to select single image | 1.1 (selection state + ThumbnailCell click handler) |
| DEL-02 | Ctrl/Cmd+click toggle, Shift+click range | 1.1 (selection state + ThumbnailCell click handler) |
| DEL-03 | Ctrl+A select all | 1.1 (useKeyboardNav extension) |
| DEL-04 | Selection count in toolbar | 1.1 (Toolbar update) |
| DEL-05 | Delete key trashes selected images | 1.1 (useKeyboardNav + trashImages in store) |
| DEL-06 | Deleted images move to OS trash | 1.1 (reuses existing `window.api.trashFiles` IPC) |
| DEL-07 | Confirmation dialog only on batch Execute | No change needed -- existing ExecutePanel already has confirmation; keyboard delete is instant per user decision |
| DEL-08 | Deleted images removed from grid immediately | 1.1 (trashImages removes from state) |
| UX-03 | Dark/light theme toggle | DEFERRED per user decision -- no implementation |

## Waves

### Wave 1: Selection, Trash, and Keyboard Extensions

This wave adds multi-select, instant trash, and all new keyboard shortcuts. It also extends the store with preview mode state so Wave 2 can build the preview UI against it. After this wave, users can select images, trash them with Backspace/Delete, and see selection counts in the toolbar.

#### Task 1.1: Add selection state, trash operations, and keyboard extensions

**Files:**
- `apps/desktop/src/renderer/src/hooks/usePhotoStore.ts` (modify)
- `apps/desktop/src/renderer/src/hooks/useKeyboardNav.ts` (modify)
- `apps/desktop/src/renderer/src/components/ThumbnailCell.tsx` (modify)
- `apps/desktop/src/renderer/src/components/GroupRow.tsx` (modify)
- `apps/desktop/src/renderer/src/components/PhotoGrid.tsx` (modify)
- `apps/desktop/src/renderer/src/components/Toolbar.tsx` (modify)
- `apps/desktop/src/renderer/src/App.tsx` (modify)

**Delivers:** DEL-01, DEL-02, DEL-03, DEL-04, DEL-05, DEL-06, DEL-08, PREV-04, PREV-05, PREV-06, DEL-07

**Implementation:**

**1. Extend `usePhotoStore` with selection and preview state**

Add these fields to `PhotoState`:
```typescript
selectedImages: Set<string>;       // paths of selected images
selectionAnchor: string | null;    // last non-shift-clicked image for range select
isPreviewMode: boolean;            // false = grid view, true = preview view
previewImageId: string | null;     // which image is being previewed (synced with focusedImageId)
```

Initialize in `initialState`: `selectedImages: new Set()`, `selectionAnchor: null`, `isPreviewMode: false`, `previewImageId: null`.

Add these methods to `PhotoStoreAPI` and implement them:

- `toggleSelect(path: string)`: Toggle path in `selectedImages` Set. Set `selectionAnchor` to this path. If `selectedImages` becomes empty, clear anchor.
- `rangeSelect(path: string)`: Compute range from `selectionAnchor` to `path` within the same group (use the `groups` computed from `filteredImages`). If anchor and target are in different groups, just select the target alone. Add all paths in the range to `selectedImages`. Logic: iterate through `groups`, find the group containing both anchor and target, get the slice between them, add all to set.
- `selectAll()`: Add all paths from `filteredImages` to `selectedImages`. Note: use the store's internal `filteredImages` (the filtered+sorted list).
- `clearSelection()`: Set `selectedImages` to empty Set, `selectionAnchor` to null.
- `trashImages(paths: string[])`: Call `window.api.trashFiles(paths)`. On success, remove trashed paths from `images`, `classifications`, and `selectedImages`. If `focusedImageId` was trashed, advance focus to the next image in the flat list (try `images[oldIndex]` then `images[oldIndex - 1]`). If `previewImageId` was trashed, update it to match the new `focusedImageId`. Save results file immediately (same pattern as `executeActions`). See the RESEARCH.md code example for the full implementation pattern.
- `enterPreview(path: string)`: Set `isPreviewMode: true`, `previewImageId: path`, `focusedImageId: path`.
- `exitPreview()`: Set `isPreviewMode: false`, `previewImageId: null`. Keep `focusedImageId` as-is so the grid scrolls to the right place.

Clear `selectedImages` and `selectionAnchor` in `openFolder` (when a new folder is loaded). Also clear them and reset `isPreviewMode`/`previewImageId`.

Pass `groups` to `trashImages` via closure (it needs them for range select -- actually `rangeSelect` needs groups, not `trashImages`). The simplest approach: `rangeSelect` should accept `groups` as a parameter from the caller, or since `groups` is a `useMemo` in the hook, the `rangeSelect` callback can capture it via the `stateRef` pattern. Actually, the cleanest approach: compute the range in the callback using `groupsRef` (add a `groupsRef` like `stateRef`). Store the groups ref:
```typescript
const groupsRef = useRef(groups);
groupsRef.current = groups;
```

**2. Extend `useKeyboardNav` with new key handlers**

Add new options to `KeyboardNavOptions`:
```typescript
onToggleSelect: (path: string) => void;
onRangeSelect: (path: string) => void;
onSelectAll: () => void;
onClearSelection: () => void;
onTrashFocused: () => void;        // Backspace: trash the focused image
onTrashSelected: () => void;       // Delete: trash all selected (or focused if none selected)
onEnterPreview: (path: string) => void;
onExitPreview: () => void;
isPreviewMode: boolean;
sortedFlatImages: ImageFileInfo[];  // flat sorted list for linear navigation in preview (derive from groups.flatMap(g => g.images), NOT store.filteredImages which is pre-sort)
```

Add these key handlers inside the `switch` statement:

- `Enter`: If not in preview mode and there's a focused image, call `onEnterPreview(focused)`. Prevent default.
- `Escape`: If in preview mode, call `onExitPreview()`. Otherwise, call `onClearSelection()`. Prevent default.
- `Backspace`: **Only if `document.activeElement` is not an input/textarea** (check `tagName`). Call `onTrashFocused()`. Prevent default.
- `Delete`: Same activeElement guard. Call `onTrashSelected()`. Prevent default.
- `a` (with `e.ctrlKey || e.metaKey`): Call `onSelectAll()`. Prevent default. Place this check BEFORE the switch statement since 'a' is a letter key.

For arrow keys in preview mode (`isPreviewMode` is true): Navigate linearly through `sortedFlatImages` instead of group-based grid navigation. Find the current index in `sortedFlatImages`, then move to `index + 1` (ArrowRight) or `index - 1` (ArrowLeft). ArrowUp/ArrowDown can do the same as Left/Right in preview mode. Update both `focusedImageId` and `previewImageId` together via `onEnterPreview` (which sets both).

**3. Modify `ThumbnailCell` for selection**

Add new props:
```typescript
isSelected: boolean;
onToggleSelect: (path: string) => void;
onRangeSelect: (path: string) => void;
```

Change the `onClick` handler to differentiate:
- `e.ctrlKey || e.metaKey` --> call `onToggleSelect(image.path)`, prevent default
- `e.shiftKey` --> call `onRangeSelect(image.path)`, prevent default
- Plain click (no modifier) --> existing behavior: call `onClick()` (cycles classification)

Add a selection overlay inside the cell (rendered when `isSelected` is true). Place it ABOVE the canvas but below the focus ring. Use a semi-transparent blue overlay with a checkmark in the top-left corner:
```tsx
{isSelected && (
  <div className="absolute inset-0 bg-blue-500/30 z-10 pointer-events-none">
    <div className="absolute top-1 left-1 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center">
      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
      </svg>
    </div>
  </div>
)}
```

Also add double-click handler: `onDoubleClick` opens preview mode for this image (call a new `onOpenPreview` prop).

**4. Thread selection props through `GroupRow` and `PhotoGrid`**

`GroupRow` needs new props: `selectedImages: Set<string>`, `onToggleSelect`, `onRangeSelect`, `onOpenPreview`. Pass `isSelected={selectedImages.has(image.path)}` to each `ThumbnailCell`.

`PhotoGrid` needs the same new props to pass through to `GroupRow`.

**5. Update `Toolbar` with selection count and delete button**

Add new props:
```typescript
selectedCount: number;
totalCount: number;
onDeleteSelected: () => void;
```

Add a selection count display between the spacer and the execute button. Show it only when `selectedCount > 0`:
```tsx
{selectedCount > 0 && (
  <span className="text-sm text-blue-400" data-testid="selection-count">
    {selectedCount} of {totalCount} selected
  </span>
)}
```

Add a "Delete Selected" button next to the selection count (visible only when `selectedCount > 0`):
```tsx
{selectedCount > 0 && (
  <button
    onClick={onDeleteSelected}
    className="px-3 py-1.5 bg-red-600 hover:bg-red-700 rounded text-sm font-medium transition-colors"
    data-testid="delete-selected-btn"
  >
    Trash Selected ({selectedCount})
  </button>
)}
```

**6. Update `App.tsx` to wire everything together**

- Create handler functions that delegate to the store: `handleToggleSelect`, `handleRangeSelect`, `handleSelectAll`, `handleClearSelection`, `handleTrashFocused` (trashes `[state.focusedImageId]` if it exists), `handleTrashSelected` (trashes `Array.from(state.selectedImages)` if non-empty, else trashes `[state.focusedImageId]`), `handleEnterPreview`, `handleExitPreview`.
- Pass the new handlers to `useKeyboardNav`.
- Pass `selectedImages`, `onToggleSelect`, `onRangeSelect`, `onOpenPreview` to `PhotoGrid`.
- Pass `selectedCount`, `totalCount`, `onDeleteSelected` to `Toolbar`.
- In `renderContent()`: when `state.isPreviewMode && state.previewImageId`, render a placeholder `<div>` with text "Preview mode - coming in Wave 2" instead of `PhotoGrid`. This ensures the state toggle works and can be tested before the actual preview UI exists.
- Compute `selectedCount` as `state.selectedImages.size` and `totalCount` as `filteredImages.length` (from store).

**Commit message:** `feat(03): add multi-select, instant trash, and keyboard extensions`

**Verify:**
- Start dev server (`pnpm dev`), open a folder with images
- Ctrl+click multiple thumbnails -- they should show blue overlay with checkmark
- Shift+click to select a range within a group
- Ctrl+A selects all, toolbar shows "X of Y selected"
- Backspace trashes the focused image instantly, focus advances to next
- Delete trashes all selected images
- "Trash Selected" button appears when images are selected
- Enter on a focused thumbnail shows the placeholder preview text
- Escape from "preview mode" returns to grid
- `cd apps/desktop && npx vitest run --reporter=verbose` -- existing tests still pass

---

### Wave 2: Preview Panel with Zoom/Pan and Filmstrip

This wave builds the full preview experience: a large image view with smooth zoom/pan, a filmstrip for navigation, and all preview keyboard shortcuts. After this wave, the complete Phase 3 feature set is functional.

#### Task 2.1: Build PreviewPanel, useZoomPan, and Filmstrip components

**Files:**
- `apps/desktop/src/renderer/src/hooks/useZoomPan.ts` (create)
- `apps/desktop/src/renderer/src/components/PreviewPanel.tsx` (create)
- `apps/desktop/src/renderer/src/components/Filmstrip.tsx` (create)
- `apps/desktop/src/renderer/src/App.tsx` (modify -- replace placeholder with real PreviewPanel)

**Delivers:** PREV-01, PREV-02, PREV-03, PREV-07

**Implementation:**

**1. Create `useZoomPan.ts` hook**

This hook manages zoom and pan state for the preview image via CSS transforms.

```typescript
interface ZoomPanState {
  zoom: number;       // current zoom level (1 = fit-to-window)
  panX: number;       // horizontal offset in px
  panY: number;       // vertical offset in px
  fitZoom: number;    // calculated zoom level that fits the image in the container
  isDragging: boolean;
}

interface UseZoomPanOptions {
  imageWidth: number;
  imageHeight: number;
  containerRef: React.RefObject<HTMLElement | null>;
}

interface UseZoomPanReturn {
  zoom: number;
  panX: number;
  panY: number;
  isDragging: boolean;
  handlers: {
    onWheel: (e: React.WheelEvent) => void;
    onMouseDown: (e: React.MouseEvent) => void;
  };
  resetZoom: () => void;      // reset to fit-to-window
  zoomTo100: () => void;      // set zoom to show actual pixels
  fitToWindow: () => void;    // alias for resetZoom
}
```

Implementation details:
- **Fit-to-window zoom**: Calculate `fitZoom = Math.min(containerWidth / imageWidth, containerHeight / imageHeight)`. Use a `ResizeObserver` on the container to recalculate when it resizes.
- **Scroll-to-zoom**: On `wheel` event, compute new zoom: `newZoom = zoom * (1 - deltaY * 0.001)`. Clamp between `fitZoom * 0.5` and `10`. Use the zoom-toward-cursor math from RESEARCH.md to adjust pan so the point under the cursor stays fixed.
- **Pan**: On `mousedown`, start tracking. On `mousemove` (via document-level listener), update `panX/panY` by the mouse delta. On `mouseup`, stop tracking. Only allow panning when `zoom > fitZoom` (image is larger than container). Use `requestAnimationFrame` to batch updates.
- **100% zoom**: Set `zoom = 1` (1 CSS pixel = 1 image pixel). Center the image in the container.
- **Cursor**: Show `cursor-grab` normally, `cursor-grabbing` when dragging, `cursor-zoom-in` when at fit-to-window (to hint scroll-to-zoom is available).
- Apply `will-change: transform` to the image for GPU acceleration.
- **Reset on image change**: Expose `resetZoom()` for the parent to call when the image changes.

**2. Create `PreviewPanel.tsx`**

This component renders the full-size preview image with zoom/pan controls and integrates the filmstrip.

Props:
```typescript
interface PreviewPanelProps {
  imageId: string;                    // path of the current preview image
  images: ImageFileInfo[];            // flat sorted list of all filtered images (for filmstrip + navigation)
  onNavigate: (path: string) => void; // called when user clicks filmstrip or uses arrows
  onClose: () => void;                // called on Escape
  getThumbnail: (id: string) => ImageBitmap | 'loading' | 'error';
  requestThumbnail: (id: string, url: string, size: number) => void;
}
```

Structure:
```
+----------------------------------------------+
|  [full-size image with zoom/pan]              |
|                                               |
|                                               |
+----------------------------------------------+
|  [filmstrip: scrollable row of thumbnails]    |
+----------------------------------------------+
```

Image loading pattern (same as InfoPanel):
- Use `useEffect` keyed on `imageId` to load the full-size image via `window.api.readFile(imageId)`.
- Create a `Blob` with the correct MIME type (use same `mimeMap` as InfoPanel).
- Create an object URL, store in state. Revoke the previous URL before setting a new one.
- Set `cancelled = true` in the cleanup function to prevent stale updates.
- While loading, show the cached thumbnail as a placeholder: render it on a small canvas that fills the container with `object-fit: contain` and CSS `filter: blur(4px)` for a nice transition effect.

Track natural image dimensions: use an `<img>` `onLoad` handler to read `naturalWidth` and `naturalHeight`, then pass to `useZoomPan`.

Reset zoom when `imageId` changes by calling `resetZoom()` in a `useEffect`.

Preloading: After the current image loads, kick off preloads for the next and previous images in the `images` list. Store preloaded object URLs in a `useRef<Map<string, string>>` (LRU of 3 entries). When navigating, check the preload cache first before loading via IPC.

Zoom controls overlay: Small buttons in the top-right corner of the preview area:
```tsx
<div className="absolute top-2 left-2 flex gap-1 z-20">
  <button onClick={fitToWindow} className="px-2 py-1 bg-gray-800/80 hover:bg-gray-700 rounded text-xs text-white">Fit</button>
  <button onClick={zoomTo100} className="px-2 py-1 bg-gray-800/80 hover:bg-gray-700 rounded text-xs text-white">100%</button>
</div>
```

The image element:
```tsx
<img
  src={imageUrl ?? ''}
  onLoad={(e) => {
    const img = e.currentTarget;
    setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
  }}
  style={{
    transform: `scale(${zoom}) translate(${panX}px, ${panY}px)`,
    transformOrigin: '0 0',
    willChange: 'transform',
  }}
  className="max-w-none select-none"
  draggable={false}
/>
```

Double-click on the image: toggle between fit-to-window and 100% zoom.

**3. Create `Filmstrip.tsx`**

Horizontal scrollable strip of thumbnail images at the bottom of the preview.

Props:
```typescript
interface FilmstripProps {
  images: ImageFileInfo[];
  activeImageId: string;
  onSelect: (path: string) => void;
  getThumbnail: (id: string) => ImageBitmap | 'loading' | 'error';
  requestThumbnail: (id: string, url: string, size: number) => void;
}
```

Implementation:
- Container: `h-20 bg-gray-900 border-t border-gray-700 flex items-center overflow-x-auto px-2 gap-1` with `scrollbar-thin scrollbar-thumb-gray-600`.
- Each thumbnail: 64x64px canvas element (smaller than grid thumbnails). Draw the `ImageBitmap` from `getThumbnail`. Request thumbnail if status is `'loading'`.
- Active image: bright blue border (`border-2 border-blue-400`). Others: `border-2 border-transparent hover:border-gray-500`.
- Auto-scroll: Use a `useEffect` keyed on `activeImageId`. Find the active thumbnail element via `ref` or `data-image-path` attribute and call `scrollIntoView({ inline: 'center', behavior: 'smooth' })`.
- Click handler: Call `onSelect(image.path)` on click.

**4. Wire PreviewPanel into `App.tsx`**

Replace the placeholder from Task 1.1 with the real `PreviewPanel`.

**IMPORTANT:** `store.filteredImages` is pre-sort and does NOT match grid display order. Derive the flat sorted list from groups instead: `const sortedFlatImages = groups.flatMap(g => g.images)`. Use this for both the filmstrip and arrow-key navigation so preview order matches the grid.

```tsx
const sortedFlatImages = useMemo(() => groups.flatMap(g => g.images), [groups]);

// In renderContent():
if (state.isPreviewMode && state.previewImageId) {
  return (
    <PreviewPanel
      imageId={state.previewImageId}
      images={sortedFlatImages}
      onNavigate={(path) => store.enterPreview(path)}
      onClose={store.exitPreview}
      getThumbnail={thumbnailWorker.getThumbnail}
      requestThumbnail={thumbnailWorker.requestThumbnail}
    />
  );
}
```

The InfoPanel on the right continues to work unchanged -- it reads from `focusedImageId` which stays synced with `previewImageId`, so EXIF metadata updates automatically as the user navigates in preview mode.

**Commit message:** `feat(03): add preview panel with zoom/pan and filmstrip navigation`

**Verify:**
- Start dev server, open a folder, focus a thumbnail, press Enter
- Preview should show the full-size image filling the main area
- Scroll wheel to zoom in/out -- should zoom toward cursor position
- Click and drag to pan when zoomed in
- "Fit" and "100%" buttons work
- Filmstrip shows thumbnails at the bottom, active image is highlighted and centered
- Click a filmstrip thumbnail to navigate to that image
- Arrow keys navigate between images in preview mode
- Escape returns to the grid with the same image focused
- InfoPanel on the right shows EXIF data for the current preview image
- Backspace in preview trashes the current image and advances to next
- Double-click toggles between fit and 100% zoom
- `cd apps/desktop && npx vitest run --reporter=verbose` -- all tests pass
