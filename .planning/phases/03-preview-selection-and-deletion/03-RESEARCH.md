# Phase 3: Preview, Selection, and Deletion - Research

**Researched:** 2026-03-15
**Domain:** Electron desktop app -- image preview, multi-select, batch delete
**Confidence:** HIGH

## Summary

Phase 3 adds three major features to the existing photo-culler app: (1) full-size image preview with zoom/pan and filmstrip navigation, (2) multi-select via Ctrl/Cmd+click, Shift+click, and Ctrl+A, and (3) instant trash via Backspace and batch delete via Delete key. The codebase is well-structured for these additions -- the existing `usePhotoStore` hook needs a `selectedImages: Set<string>` and a `previewMode: boolean` flag; `useKeyboardNav` needs new key handlers for Enter, Escape, Backspace, Delete, and Ctrl+A; and `App.tsx` needs to conditionally render a preview component instead of the grid.

The core technical challenges are: (a) smooth CSS transform-based zoom/pan on large images, (b) a horizontal filmstrip with auto-centering on the active thumbnail, and (c) coordinating selection state with existing classification and grouping systems. All three are solvable with standard React + CSS patterns and no new dependencies.

**Primary recommendation:** Build preview as a state toggle (not route), add selection as a `Set<string>` in the store, use CSS `transform: scale() translate()` for zoom/pan, and reuse the existing `window.api.trashFiles` IPC for instant trash.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Preview replaces grid area** -- info panel stays on the right, preview shown in the grid's space
- **Enter on focused thumbnail opens preview mode** (deferred from Phase 2)
- **Filmstrip** of thumbnails at bottom of preview area
- **Escape returns to grid view**, arrow keys navigate in preview
- **Classification unchanged** -- click/Space cycles classification borders (keep/review/delete)
- **No new hotkeys for classification** -- existing Space key cycle is sufficient
- **Multi-select is additive**: Ctrl/Cmd+click toggles, Shift+click selects range within same group only
- **Ctrl+A selects all images**
- **Selection is separate from classification** -- distinct visual highlight
- **Selection count in toolbar**: "12 of 42 selected"
- **Backspace = instant trash** -- no confirmation, immediate `shell.trashItem`, focus moves to next image
- **No permanent delete in this phase** -- Backspace always uses OS trash
- **Delete key or toolbar button on multi-selected images** also moves to OS trash instantly (no confirmation for keyboard)
- **Confirmation dialog only on batch Execute** -- existing Execute panel keeps its flow
- **No theme toggle** -- dark theme only (UX-03 deferred)

### Claude's Discretion
- Preview zoom implementation (CSS transform vs canvas)
- Filmstrip thumbnail size and scroll behavior
- Selection highlight styling (how it visually differs from classification borders)
- Zoom levels and transitions (fit-to-window, 100%, scroll-to-zoom increments)
- Pan implementation (drag vs cursor-based)
- Toolbar layout changes for selection count
- Whether preview mode is a route change or a state toggle

### Deferred Ideas (OUT OF SCOPE)
- UX-03 (theme toggle): Dark/light theme toggle deferred -- app stays dark-only
- Permanent delete: No permanent delete option -- Backspace always uses OS trash
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PREV-01 | User can click a thumbnail to see a full-size preview | Preview component replaces grid area; Enter key + click open preview; image loaded via existing `window.api.readFile` IPC |
| PREV-02 | User can zoom: fit-to-window, 100%, scroll-to-zoom | CSS `transform: scale()` with wheel event handler; three zoom modes tracked in state |
| PREV-03 | User can pan when zoomed in | CSS `transform: translate()` combined with scale; mousedown+mousemove drag handler |
| PREV-04 | User can navigate between images with arrow keys in preview | Extended `useKeyboardNav` handles ArrowLeft/ArrowRight in preview mode using flat image list |
| PREV-05 | User can view EXIF metadata in preview | Existing InfoPanel already shows full EXIF -- continues working because focused image drives it |
| PREV-06 | User can press Escape to return to grid view | Escape key handler in `useKeyboardNav` sets preview mode to false |
| PREV-07 | User can view a filmstrip in preview mode | Horizontal scrollable strip using cached thumbnails; auto-scroll to keep active centered |
| DEL-01 | User can click to select a single image | Click handler (distinct from classification click) adds to `selectedImages` Set |
| DEL-02 | User can Ctrl/Cmd+click to toggle, Shift+click for range | Modifier key detection in click handler; range limited to same group per CONTEXT.md |
| DEL-03 | User can select all with Ctrl+A | Keyboard handler in `useKeyboardNav`; selects all visible (filtered) images |
| DEL-04 | Selection count in toolbar | Toolbar receives `selectedCount` and `totalCount` props |
| DEL-05 | User can delete selected via Delete key or toolbar button | Delete key handler trashes selected images via `window.api.trashFiles` |
| DEL-06 | Deleted images move to OS trash | Reuses existing `TRASH_FILES` IPC channel with `shell.trashItem` |
| DEL-07 | Confirmation dialog (batch Execute only per CONTEXT.md) | Execute panel already has confirmation flow; keyboard delete is instant per user decision |
| DEL-08 | Deleted images removed from grid immediately | Store removes trashed paths from `state.images` and `state.classifications` |
| UX-03 | Dark/light theme toggle | **DEFERRED per CONTEXT.md** -- dark theme only, no implementation needed |
</phase_requirements>

## Codebase Analysis

### Current Architecture Summary

The app follows a clean pattern:
- **State**: `usePhotoStore` is the single source of truth -- holds `PhotoState` with `images`, `classifications`, `focusedImageId`, sort/filter/search state
- **Keyboard**: `useKeyboardNav` attaches a `keydown` listener to the grid container, navigates via `findImagePosition()` across groups
- **Layout**: `App.tsx` renders `Toolbar` + (`PhotoGrid` | loading/empty states) + `InfoPanel` in a flex column
- **Grid**: `PhotoGrid` uses `@tanstack/react-virtual` to virtualize grouped rows; each `GroupRow` renders `ThumbnailCell` components
- **Preview**: `InfoPanel` already loads full-size images via `window.api.readFile` and displays them -- this pattern will be reused for the main preview
- **IPC**: `trashFiles` already implemented and working in `ipc-handlers.ts` via `shell.trashItem`; returns `TrashResult` with `succeeded`/`failed` arrays
- **Thumbnails**: `ThumbnailCell` draws `ImageBitmap` to canvas; has classification borders (green/yellow/red) and a blue focus ring

### Key Integration Points

1. **`usePhotoStore` needs new state fields:**
   - `selectedImages: Set<string>` -- paths of selected images
   - `isPreviewMode: boolean` -- whether preview is active
   - `previewImageId: string | null` -- which image is being previewed (may differ from focusedImageId)

2. **`useKeyboardNav` needs new key handlers:**
   - `Enter` -- open preview for focused image
   - `Escape` -- close preview, return to grid
   - `Backspace` -- trash focused image instantly
   - `Delete` -- trash all selected images (or focused if none selected)
   - `Ctrl/Cmd+A` -- select all visible images
   - Arrow keys in preview mode -- navigate between images (different behavior than grid navigation)

3. **`App.tsx` layout change:**
   - When `isPreviewMode` is true, render `PreviewPanel` instead of `PhotoGrid` in the main area
   - InfoPanel stays on the right and continues showing EXIF for the previewed image

4. **`ThumbnailCell` needs selection overlay:**
   - A distinct visual for "selected" that differs from classification borders
   - Recommendation: semi-transparent blue overlay with a checkmark icon in the corner

5. **`Toolbar` needs selection count:**
   - Show "12 of 42 selected" when selection is active
   - Add a "Delete Selected" button (or modify existing Execute button behavior)

### Existing IPC Already Sufficient

No new IPC channels needed. The existing API covers everything:
- `window.api.readFile(path)` -- load full-size image for preview (already used by InfoPanel)
- `window.api.trashFiles(paths)` -- trash single or multiple files (already implemented)
- `window.api.loadThumbCache(path, lastModified)` -- load cached thumbnails for filmstrip

## Architecture Patterns

### Recommended New Components and Hooks

```
src/renderer/src/
  components/
    PreviewPanel.tsx       # Full-size preview with zoom/pan
    Filmstrip.tsx           # Horizontal thumbnail strip below preview
    SelectionOverlay.tsx    # Checkmark + tint overlay for ThumbnailCell
  hooks/
    useSelection.ts         # Selection state logic (Set operations, range select)
    usePreviewMode.ts       # Preview state, zoom/pan, image loading
    useZoomPan.ts           # CSS transform zoom + pan logic (extracted for testability)
```

### Pattern: Preview Mode as State Toggle

**What:** Preview mode is a boolean flag in the store, not a route change.
**Why:** The app has no router. Adding one just for preview would be overengineering. A state toggle keeps things simple and allows the info panel to stay mounted.
**How:**
```typescript
// In usePhotoStore state
isPreviewMode: boolean;     // false = grid view, true = preview view
previewImageId: string | null;

// In App.tsx
const renderContent = () => {
  if (state.isPreviewMode && state.previewImageId) {
    return <PreviewPanel imageId={state.previewImageId} ... />;
  }
  // existing grid rendering
};
```

### Pattern: CSS Transform Zoom/Pan

**What:** Use CSS `transform: scale(zoom) translate(panX, panY)` on the image element.
**Why:** CSS transforms are GPU-accelerated, handle sub-pixel rendering, and perform better than canvas for single-image display. Canvas would be overkill for displaying one image.
**How:**
```typescript
// useZoomPan hook
interface ZoomPanState {
  zoom: number;       // 1 = fit-to-window, actual pixels ratio for 100%
  panX: number;       // px offset
  panY: number;       // px offset
  fitZoom: number;    // calculated fit-to-window zoom level
}

// Zoom levels: fit-to-window (default), 100% (actual pixels), smooth scroll-to-zoom
// Wheel: deltaY controls zoom, zooms toward cursor position
// Pan: mousedown + mousemove when zoomed > fit

// On the image element:
<img
  style={{
    transform: `scale(${zoom}) translate(${panX}px, ${panY}px)`,
    transformOrigin: '0 0',
  }}
/>
```

**Zoom-toward-cursor math:**
```typescript
function zoomTowardPoint(
  currentZoom: number,
  newZoom: number,
  cursorX: number,
  cursorY: number,
  panX: number,
  panY: number,
): { panX: number; panY: number } {
  // Adjust pan so the point under the cursor stays fixed
  const factor = newZoom / currentZoom;
  return {
    panX: cursorX - factor * (cursorX - panX),
    panY: cursorY - factor * (cursorY - panY),
  };
}
```

### Pattern: Set-Based Multi-Select

**What:** Selection state is a `Set<string>` of image paths, stored in `usePhotoStore`.
**Why:** Set provides O(1) lookup for "is this selected?" checks on every thumbnail render. Using paths (not filenames) avoids collisions.
**How:**
```typescript
// Selection operations
toggleSelect(path: string)          // Ctrl/Cmd+click
rangeSelect(path: string)           // Shift+click -- selects from last-selected to this, within same group
selectAll()                         // Ctrl+A -- all filtered images
clearSelection()                    // Escape (when not in preview), or after trash
```

**Shift+click range logic (within same group only):**
```typescript
function computeRange(
  groups: PhotoGroup[],
  anchorPath: string,
  targetPath: string,
): string[] {
  // Find both images; if not in the same group, only select the target
  for (const group of groups) {
    const anchorIdx = group.images.findIndex(img => img.path === anchorPath);
    const targetIdx = group.images.findIndex(img => img.path === targetPath);
    if (anchorIdx !== -1 && targetIdx !== -1) {
      const [start, end] = anchorIdx < targetIdx
        ? [anchorIdx, targetIdx]
        : [targetIdx, anchorIdx];
      return group.images.slice(start, end + 1).map(img => img.path);
    }
  }
  return [targetPath]; // fallback: just select the target
}
```

### Pattern: Filmstrip with Auto-Center

**What:** Horizontal scrollable div showing small thumbnails, with the active one centered.
**Why:** Photographers need spatial context during preview -- which image am I on relative to the set?
**How:**
```typescript
// Filmstrip.tsx
// Use a horizontal flex container with overflow-x: auto
// Each thumbnail is ~80x80px (smaller than grid thumbnails)
// Active thumbnail gets a bright border and scrollIntoView({ inline: 'center', behavior: 'smooth' })
// Thumbnails loaded from disk cache via existing thumbnail worker
// Click on filmstrip thumbnail navigates to that image
```

### Anti-Patterns to Avoid

- **Do not use canvas for the preview image.** CSS transforms on `<img>` are simpler, GPU-accelerated, and sufficient for displaying a single image with zoom/pan. Canvas adds complexity with no benefit here.
- **Do not add a router for preview mode.** The app is a single-view application. A state toggle is simpler and avoids the overhead of react-router.
- **Do not store selection as an array.** `Set<string>` provides O(1) membership checks; arrays would cause O(n) checks on every thumbnail render.
- **Do not combine selection and classification.** They are orthogonal concepts -- selection is transient (for batch operations), classification is persistent (saved to results file).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| OS trash | Custom file deletion | `shell.trashItem` via existing IPC | Cross-platform, recoverable, already implemented |
| Virtualized scrolling | Custom virtual list | `@tanstack/react-virtual` | Already in use for the grid |
| EXIF metadata display | Custom metadata panel | Existing `InfoPanel` component | Already renders all EXIF fields |
| Thumbnail caching | New caching layer | Existing `useThumbnailWorker` + disk cache | Already handles bitmap caching and disk persistence |

## Common Pitfalls

### Pitfall 1: Object URL Memory Leaks
**What goes wrong:** Creating object URLs for preview images without revoking old ones causes memory leaks, especially when navigating rapidly between images.
**Why it happens:** `URL.createObjectURL` allocates browser memory that is not garbage collected until explicitly revoked.
**How to avoid:** The existing `InfoPanel` pattern is correct -- revoke the previous URL before setting a new one. Apply the same pattern in the preview component. Use a cleanup function in useEffect.
**Warning signs:** Memory usage grows linearly as user navigates through images.

### Pitfall 2: Zoom State Not Reset on Image Change
**What goes wrong:** User zooms into image A, navigates to image B, and image B appears at the same zoom/pan position, which is disorienting.
**How to avoid:** Reset zoom to fit-to-window and pan to (0,0) whenever the preview image changes. Only preserve zoom across images if the user explicitly requests it.

### Pitfall 3: Backspace Key Conflicts
**What goes wrong:** Backspace fires the trash action even when the user is typing in the search input.
**How to avoid:** Check `document.activeElement` -- if it's an input or textarea, don't handle Backspace. The existing `useKeyboardNav` attaches to the grid container, which helps, but need to ensure focus management is correct when toggling between preview and grid.

### Pitfall 4: Shift+Click Range Crossing Group Boundaries
**What goes wrong:** User shift-clicks across two groups and gets unexpected selection behavior.
**How to avoid:** Per CONTEXT.md, Shift+click range is within the same group only. If anchor and target are in different groups, just select the target image alone.

### Pitfall 5: Stale Selection After Trash
**What goes wrong:** User selects 5 images, trashes them, but `selectedImages` Set still contains the deleted paths.
**How to avoid:** After a successful trash operation, remove trashed paths from both `state.images` and `state.selectedImages`. Also clear `focusedImageId` if the focused image was trashed, and advance focus to the next image.

### Pitfall 6: Large Image Loading Delay
**What goes wrong:** Preview feels sluggish because full-resolution images (20MB+ RAW JPEGs) take time to load via IPC.
**How to avoid:** Show the cached thumbnail immediately as a blurred placeholder, then swap in the full-size image when loaded. Preload the next and previous images in the sequence.

## Code Examples

### Preview Component Structure
```typescript
// PreviewPanel.tsx -- core structure
interface PreviewPanelProps {
  imageId: string;
  images: ImageFileInfo[];  // flat list for navigation
  onNavigate: (path: string) => void;
  onClose: () => void;
  getThumbnail: (id: string) => ImageBitmap | 'loading' | 'error';
  requestThumbnail: (id: string, url: string, size: number) => void;
}

function PreviewPanel({ imageId, images, onNavigate, onClose, getThumbnail, requestThumbnail }: PreviewPanelProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const { zoom, panX, panY, handlers, resetZoom, zoomTo100, fitToWindow } = useZoomPan();

  // Load full-size image
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const buffer = await window.api.readFile(imageId);
      if (cancelled) return;
      const blob = new Blob([buffer], { type: 'image/jpeg' });
      const url = URL.createObjectURL(blob);
      setImageUrl(prev => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
    };
    load();
    return () => { cancelled = true; };
  }, [imageId]);

  // Reset zoom on image change
  useEffect(() => { resetZoom(); }, [imageId]);

  return (
    <div className="flex flex-col h-full">
      {/* Main preview area */}
      <div
        className="flex-1 overflow-hidden relative bg-black cursor-grab"
        onWheel={handlers.onWheel}
        onMouseDown={handlers.onMouseDown}
      >
        <img
          src={imageUrl ?? ''}
          style={{
            transform: `scale(${zoom}) translate(${panX}px, ${panY}px)`,
            transformOrigin: '0 0',
          }}
          className="max-w-none"
          draggable={false}
        />
      </div>

      {/* Filmstrip */}
      <Filmstrip
        images={images}
        activeImageId={imageId}
        onSelect={onNavigate}
        getThumbnail={getThumbnail}
        requestThumbnail={requestThumbnail}
      />
    </div>
  );
}
```

### Selection Click Handler in ThumbnailCell
```typescript
// How to differentiate selection click from classification click:
// - Plain click (no modifier) = cycle classification (existing behavior)
// - Ctrl/Cmd+click = toggle selection
// - Shift+click = range select

function handleClick(e: React.MouseEvent) {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    onToggleSelect(image.path);
  } else if (e.shiftKey) {
    e.preventDefault();
    onRangeSelect(image.path);
  } else {
    // existing: cycle classification
    onClick();
  }
}
```

### Trash Operation in Store
```typescript
// In usePhotoStore
const trashImages = useCallback(async (paths: string[]) => {
  if (paths.length === 0) return;

  const result = await window.api.trashFiles(paths);
  const trashedSet = new Set(result.succeeded);

  setState(prev => {
    const nextImages = prev.images.filter(img => !trashedSet.has(img.path));
    const nextClassifications = { ...prev.classifications };
    const nextSelected = new Set(prev.selectedImages);

    for (const img of prev.images) {
      if (trashedSet.has(img.path)) {
        delete nextClassifications[img.name];
        nextSelected.delete(img.path);
      }
    }

    // Advance focus if current focus was trashed
    let nextFocused = prev.focusedImageId;
    if (prev.focusedImageId && trashedSet.has(prev.focusedImageId)) {
      const oldIndex = prev.images.findIndex(img => img.path === prev.focusedImageId);
      // Try next image, then previous
      const nextImg = nextImages[oldIndex] ?? nextImages[oldIndex - 1] ?? null;
      nextFocused = nextImg?.path ?? null;
    }

    return {
      ...prev,
      images: nextImages,
      classifications: nextClassifications,
      selectedImages: nextSelected,
      focusedImageId: nextFocused,
    };
  });
}, []);
```

### Selection Visual in ThumbnailCell
```typescript
// Selection overlay -- distinct from classification borders
// Recommendation: blue semi-transparent overlay with checkmark
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

## Integration Plan

### Step 1: Add Selection State to Store
- Add `selectedImages: Set<string>` to `PhotoState`
- Add `isPreviewMode: boolean` and `previewImageId: string | null`
- Add store methods: `toggleSelect`, `rangeSelect`, `selectAll`, `clearSelection`, `trashImages`, `enterPreview`, `exitPreview`
- Clear selection when folder changes

### Step 2: Build Preview Component
- Create `PreviewPanel.tsx` with zoom/pan via CSS transforms
- Create `useZoomPan.ts` hook for zoom/pan state management
- Create `Filmstrip.tsx` using cached thumbnails
- Wire into `App.tsx` -- render `PreviewPanel` when `isPreviewMode` is true

### Step 3: Extend Keyboard Navigation
- Add Enter (open preview), Escape (close preview or clear selection)
- Add Backspace (trash focused image), Delete (trash selected images)
- Add Ctrl/Cmd+A (select all)
- Handle arrow keys differently in preview mode (linear navigation, not grid)

### Step 4: Add Selection Visuals to Grid
- Add `isSelected` prop to `ThumbnailCell`
- Add selection overlay (blue tint + checkmark)
- Pass Ctrl/Cmd+click and Shift+click handlers through

### Step 5: Update Toolbar
- Add selection count display: "12 of 42 selected"
- Add "Delete Selected" button when selection is active

### Step 6: Wire Trash Operations
- Backspace in grid: trash focused image, advance focus to next
- Backspace in preview: trash previewed image, advance to next
- Delete key: trash all selected images (or focused if no selection)
- Remove trashed images from state immediately
- Save results file after trash

## Risks & Mitigations

### Risk 1: Large Image Performance (MEDIUM)
**Risk:** Full-size images (30MB+ high-res JPEGs) may take 500ms+ to load via IPC `readFile`.
**Mitigation:** Show cached thumbnail as placeholder immediately. Preload adjacent images (prev/next) in background. The existing `readFile` IPC reads the full buffer into memory -- for very large images this is fine since we're displaying one at a time.

### Risk 2: Zoom/Pan Jankiness (LOW)
**Risk:** CSS transform zoom/pan may not feel smooth, especially during rapid scroll-to-zoom.
**Mitigation:** Use `requestAnimationFrame` for zoom updates. Limit zoom range (e.g., 0.1x to 10x). Apply `will-change: transform` CSS hint. If needed, debounce wheel events slightly.

### Risk 3: Selection/Classification Confusion (LOW)
**Risk:** Users may not understand the difference between "selected" (blue overlay) and "classified as delete" (red border).
**Mitigation:** Clear visual distinction -- selection uses a semi-transparent blue overlay with checkmark, classification uses border colors. Toolbar shows selection count separately from classification counts.

### Risk 4: Focus Management Complexity (MEDIUM)
**Risk:** Focus state (`focusedImageId`) vs preview state (`previewImageId`) vs selection state (`selectedImages`) creates three independent concepts that must be coordinated.
**Mitigation:** Clear rules: (1) focused image is always one, drives InfoPanel, (2) preview image equals focused image and stays synced, (3) selection is independent of focus. When entering preview, set `previewImageId = focusedImageId`. When navigating in preview, update both.

### Risk 5: Shift+Click Range in Grouped Grid (LOW)
**Risk:** Range selection within groups could be confusing if the "anchor" image was in a different group.
**Mitigation:** Per CONTEXT.md, range selection is within the same group only. Track the anchor path. If anchor and target are in different groups, fall back to single-select on the target.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest + jsdom |
| Config file | `apps/desktop/vitest.config.ts` |
| Quick run command | `cd apps/desktop && npx vitest run --reporter=verbose` |
| Full suite command | `pnpm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PREV-01 | Click thumbnail opens preview | unit | `cd apps/desktop && npx vitest run src/renderer/src/__tests__/preview-mode.test.ts -x` | Wave 0 |
| PREV-02 | Zoom: fit, 100%, scroll-to-zoom | unit | `cd apps/desktop && npx vitest run src/renderer/src/__tests__/zoom-pan.test.ts -x` | Wave 0 |
| PREV-03 | Pan when zoomed | unit | `cd apps/desktop && npx vitest run src/renderer/src/__tests__/zoom-pan.test.ts -x` | Wave 0 |
| PREV-04 | Arrow key navigation in preview | unit | `cd apps/desktop && npx vitest run src/renderer/src/__tests__/keyboard-nav.test.ts -x` | Extend existing |
| PREV-06 | Escape returns to grid | unit | `cd apps/desktop && npx vitest run src/renderer/src/__tests__/keyboard-nav.test.ts -x` | Extend existing |
| DEL-01 | Click to select | unit | `cd apps/desktop && npx vitest run src/renderer/src/__tests__/selection.test.ts -x` | Wave 0 |
| DEL-02 | Ctrl+click toggle, Shift+click range | unit | `cd apps/desktop && npx vitest run src/renderer/src/__tests__/selection.test.ts -x` | Wave 0 |
| DEL-03 | Ctrl+A select all | unit | `cd apps/desktop && npx vitest run src/renderer/src/__tests__/selection.test.ts -x` | Wave 0 |
| DEL-05 | Delete key trashes selected | unit | `cd apps/desktop && npx vitest run src/renderer/src/__tests__/trash.test.ts -x` | Wave 0 |
| DEL-08 | Trashed images removed from grid | unit | `cd apps/desktop && npx vitest run src/renderer/src/__tests__/trash.test.ts -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `cd apps/desktop && npx vitest run --reporter=verbose`
- **Per wave merge:** `pnpm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/renderer/src/__tests__/preview-mode.test.ts` -- covers PREV-01, PREV-06
- [ ] `src/renderer/src/__tests__/zoom-pan.test.ts` -- covers PREV-02, PREV-03
- [ ] `src/renderer/src/__tests__/selection.test.ts` -- covers DEL-01, DEL-02, DEL-03
- [ ] `src/renderer/src/__tests__/trash.test.ts` -- covers DEL-05, DEL-08
- Extend `src/renderer/src/__tests__/keyboard-nav.test.ts` -- covers PREV-04, PREV-06

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Canvas-based image viewer | CSS transform on `<img>` | Standard practice | Simpler, GPU-accelerated, fewer bugs |
| React state for large sets | `Set<string>` + immutable updates | Always best practice | O(1) membership check on renders |
| Confirmation dialogs for every delete | Instant trash + recoverable | UX trend | Faster workflow, OS handles recovery |

## Open Questions

1. **Preload strategy for adjacent images**
   - What we know: Loading via IPC `readFile` may take 200-500ms for large files
   - What's unclear: How many adjacent images to preload (1 each direction? 2?)
   - Recommendation: Preload 1 next and 1 previous. Use a simple LRU cache of 3-5 object URLs.

2. **Filmstrip thumbnail source**
   - What we know: Disk-cached thumbnails exist at `.photo-culler-thumbs/` as JPEG files
   - What's unclear: Whether to load filmstrip thumbnails from disk cache (via IPC) or reuse in-memory ImageBitmaps from the grid's thumbnail worker
   - Recommendation: Reuse the existing `getThumbnail` from the thumbnail worker -- these are already loaded in memory for visible images.

3. **Selection anchor tracking**
   - What we know: Shift+click needs an "anchor" -- the last non-shift-clicked image
   - What's unclear: Whether to store the anchor separately or derive from the last element added to the selection
   - Recommendation: Store `selectionAnchor: string | null` in the store. Set it on Ctrl+click or plain select-click. Use it for Shift+click range calculation.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: Direct reading of all source files listed in task requirements
- `apps/desktop/src/main/ipc-handlers.ts` -- verified `shell.trashItem` implementation and `readFile` IPC
- `apps/desktop/src/preload/index.ts` -- verified `trashFiles` and `readFile` exposed via contextBridge
- `packages/types/src/ipc.ts` -- verified `TrashResult` type and `ElectronAPI` interface
- `apps/desktop/src/renderer/src/hooks/usePhotoStore.ts` -- verified state structure and `executeActions` pattern
- `apps/desktop/src/renderer/src/hooks/useKeyboardNav.ts` -- verified key handling and `findImagePosition` utility
- `apps/desktop/src/renderer/src/components/InfoPanel.tsx` -- verified image loading via `readFile` and object URL pattern

### Secondary (MEDIUM confidence)
- CSS transform zoom/pan approach -- standard browser API, well-documented, used in production by many image viewers
- `Set<string>` selection pattern -- standard React pattern for multi-select

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies needed, all existing APIs sufficient
- Architecture: HIGH -- clear integration points, existing patterns to follow
- Pitfalls: HIGH -- based on direct codebase analysis and common React patterns
- Zoom/pan implementation: MEDIUM -- CSS transforms are standard but smooth feel requires tuning

**Research date:** 2026-03-15
**Valid until:** 2026-04-15 (stable -- no fast-moving dependencies)
