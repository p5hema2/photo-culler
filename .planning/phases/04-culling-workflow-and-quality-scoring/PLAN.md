# Phase 4: Culling Workflow and Quality Scoring -- Plan

## Goal

Add automatic quality scoring (0-100) in background Web Workers that auto-assigns classifications and star ratings, with RGB histogram, focus peaking, and exposure clipping overlays in the info/preview panels, plus sort-by-score and filter-by-stars in the toolbar.

## Requirements Traceability

| Req ID | Description | Task |
|--------|-------------|------|
| CULL-01 | Classification cycle: none -> keep -> review -> delete -> none | 1.1 |
| CULL-02 | Auto-advance after classification in preview | 1.1 (existing behavior, cycle change only) |
| CULL-03 | Star rating auto-assigned, manually overridable in info panel | 1.2 (store/types), 2.1 (auto-assign), 2.2 (info panel override UI) |
| CULL-04 | Color labels | REMOVED per user decision |
| CULL-05 | Filter by star rating | 1.2 (store filter state + toolbar) |
| QUAL-01 | Quality score 0-100 (sharpness, exposure, noise, contrast) | 2.1 |
| QUAL-02 | Color-coded badges on thumbnails (stars) | 2.2 |
| QUAL-03 | Sort by quality score | 1.2 |
| QUAL-04 | Auto-select below threshold | REMOVED per user decision |
| QUAL-05 | Scoring in background Web Workers | 2.1 |
| QUAL-06 | Focus peaking overlay in preview | 3.1 |
| QUAL-07 | Exposure clipping overlay in preview | 3.1 |
| QUAL-08 | RGB histogram for selected image | 2.2 |

## Waves

### Wave 1: Foundation -- Types, State, and Classification Model Change

This wave updates the data model across the codebase to support null classification, star ratings, quality scores, and new sort/filter options. No visual or algorithmic work yet -- just the plumbing.

#### Task 1.1: Classification null support and cycle change

**Files:**
- `packages/types/src/ipc.ts` (modify)
- `apps/desktop/src/renderer/src/hooks/usePhotoStore.ts` (modify)
- `apps/desktop/src/renderer/src/components/ThumbnailCell.tsx` (modify)
- `apps/desktop/src/renderer/src/components/InfoPanel.tsx` (modify)
- `apps/desktop/src/renderer/src/components/ExecutePanel.tsx` (modify)

**Delivers:** CULL-01, CULL-02

**Detailed implementation:**

1. **`packages/types/src/ipc.ts`** -- Update `ImageResult` type:
   - Change `classification` to `'keep' | 'review' | 'delete' | null`
   - Add `starRating?: number` field (1-5)
   - Keep `qualityScore?: number` but note it will now be 0-100 scale (was 0-1)

2. **`apps/desktop/src/renderer/src/hooks/usePhotoStore.ts`** -- Classification null support:
   - Change `Classification` type to `'keep' | 'review' | 'delete' | null`
   - **CRITICAL: Update all `?? 'review'` fallbacks to `?? null`**. Every occurrence:
     - `openFolder` (line ~195): Change `classifications[img.name] = 'review'` to `classifications[img.name] = null` for new images. Existing results with `'review'` keep their value (backward compat).
     - `cycleClassification` (line ~302): Change fallback `?? 'review'` to `?? null`. Update cycle: `current === null ? 'keep' : current === 'keep' ? 'review' : current === 'review' ? 'delete' : null`
     - `executeActions` (line ~382): Change `?? 'review'` to `?? null` in delete path filter
     - `executeActions` (line ~400): Change `?? 'review'` to `?? null` in keep path filter
     - `executeActions` (line ~442): Change `?? 'review'` to `?? null` in remaining classifications
     - `selectAll` (line ~522-524): Change `?? 'review'` to `?? null` in classification filter
     - `filteredImages` (line ~647): Change `?? 'review'` to `?? null` in classification filter
     - `trashImages` (line ~598): Change `?? 'review'` to `?? null` in remaining classifications

3. **`apps/desktop/src/renderer/src/components/ThumbnailCell.tsx`**:
   - Update `Classification` type to include `null`
   - Update `BORDER_COLORS`: Add `null` case with `'border-transparent'` (blends with dark background)

4. **`apps/desktop/src/renderer/src/components/InfoPanel.tsx`**:
   - Update `Classification` import to include `null`
   - Add `null` case to `CLASSIFICATION_BADGES`: `{ label: 'Unscored', className: 'bg-gray-700 text-gray-400 border-gray-500' }`

5. **`apps/desktop/src/renderer/src/components/ExecutePanel.tsx`**:
   - Update any `?? 'review'` fallbacks to `?? null`
   - **Update the counts memo**: Skip `null` classification values when counting (don't create a `summary[null]` key). Add an "Unclassified" count showing how many images have no classification yet.
   - Ensure null-classified images are NOT included in delete or move operations

**Commit message:** `feat(04): add null classification support with none→keep→review→delete→none cycle`

**Verify:**
- `cd apps/desktop && npx vitest run --reporter=verbose` -- all tests pass
- `pnpm build` succeeds with no type errors
- Open app, open folder -- images show with NO colored border
- Press Space on a focused image: cycles none → keep (green) → review (yellow) → delete (red) → none

---

#### Task 1.2: Star/score state, sort-by-score, filter-by-stars

**Files:**
- `packages/image-utils/src/sorting.ts` (modify)
- `apps/desktop/src/renderer/src/hooks/usePhotoStore.ts` (modify)
- `apps/desktop/src/renderer/src/components/Toolbar.tsx` (modify)
- `apps/desktop/src/renderer/src/App.tsx` (modify)
- `apps/desktop/src/renderer/src/lib/results.ts` (modify)

**Delivers:** CULL-03 (store/types), CULL-05, QUAL-03

**Detailed implementation:**

1. **`packages/image-utils/src/sorting.ts`** -- Add quality score sort:
   - Add `'qualityScore'` to `SortField` type union
   - Add `case 'qualityScore'` to `sortImages` switch: sort by score descending by default (high scores first), images without scores sort to end. Add an optional `context?: { qualityScores?: Record<string, number> }` parameter to `sortImages`.

2. **`apps/desktop/src/renderer/src/hooks/usePhotoStore.ts`** -- Add state and methods:
   - Add to `PhotoState`: `qualityScores: Record<string, number>`, `starRatings: Record<string, number>`, `filterStarRating: number | null` (null = show all), `scoringProgress: { completed: number; total: number }`
   - Add to `initialState`: `qualityScores: {}`, `starRatings: {}`, `filterStarRating: null`, `scoringProgress: { completed: 0, total: 0 }`
   - Add methods to `PhotoStoreAPI`:
     - `setQualityScore(filename, score)`: Sets `qualityScores[filename] = score`. Auto-assigns classification (≥60 keep, 35-59 review, <35 delete) ONLY if user hasn't manually overridden. Auto-assigns star rating (0-20=1, 21-40=2, 41-60=3, 61-80=4, 81-100=5). Triggers scheduleSave.
     - `setStarRating(filename, rating)`: Manual override — sets `starRatings[filename] = rating`. Triggers scheduleSave.
     - `setFilterStarRating(rating)`: Sets filter. Special value `0` = filter for unrated only.
     - `setScoringProgress(progress)`: Updates scoring progress.
   - **Add star rating filter to `filteredImages`**: If `filterStarRating > 0`, filter where `starRatings[img.name] >= filterStarRating`. If `filterStarRating === 0`, filter for unrated only.
   - **Update `scheduleSave`** to include `starRating` and `qualityScore` in saved results
   - **Update `sortImages` call** in `sortedImages` memo to pass `qualityScores` context
   - **Load star ratings and quality scores from results file** in `openFolder`
   - Clear `qualityScores`, `starRatings`, `filterStarRating`, `scoringProgress` in `openFolder`

3. **`apps/desktop/src/renderer/src/components/Toolbar.tsx`**:
   - Add `'qualityScore'` to `SORT_OPTIONS`: `{ value: 'qualityScore', label: 'Quality' }`
   - Add star filter UI: chips for 1-5 stars + "Unrated", similar to classification chips
   - Add props: `filterStarRating`, `onFilterStarRatingChange`, `scoringProgress`
   - Show scoring progress indicator next to EXIF progress when scoring is active
   - Add `'none'` to `CLASSIFICATION_CHIPS` for filtering unclassified images

4. **`apps/desktop/src/renderer/src/App.tsx`**:
   - Pass new props to Toolbar: `filterStarRating`, `onFilterStarRatingChange`, `scoringProgress`
   - Update `focusedClassification` memo: Change `?? ('review' as const)` to `?? null`
   - Pass star rating for focused image to InfoPanel (add prop)

5. **`apps/desktop/src/renderer/src/lib/results.ts`**:
   - Ensure backward compat: missing `starRating`/`qualityScore` in loaded results treated as undefined

**Commit message:** `feat(04): add star/score state, sort-by-quality, filter-by-stars`

**Verify:**
- `cd apps/desktop && npx vitest run --reporter=verbose` -- all tests pass
- `pnpm build` succeeds
- Sort dropdown includes "Quality" option
- Star filter chips visible in toolbar (all unrated since no scores yet)
- Classification filter has "None" option for unscored images

---

### Wave 2: Quality Scoring Worker + Visual Displays

This wave implements the scoring algorithm in a Web Worker, auto-assigns scores/classifications/stars progressively, and adds the visual displays: star rating on thumbnails, star rating override + RGB histogram in the info panel.

#### Task 2.1: Quality scoring worker and hook

**Files:**
- `apps/desktop/src/renderer/src/workers/scoring.worker.ts` (NEW)
- `apps/desktop/src/renderer/src/hooks/useScoringWorker.ts` (NEW)
- `apps/desktop/src/renderer/src/hooks/usePhotoStore.ts` (wire scoring into openFolder)
- `apps/desktop/src/renderer/src/App.tsx` (wire hook)

**Delivers:** QUAL-01, QUAL-05, CULL-03 (auto-assign part)

**Detailed implementation:**

1. **`scoring.worker.ts`** -- Quality scoring Web Worker:
   - Receives `{ path: string, buffer: ArrayBuffer }` messages
   - Creates `OffscreenCanvas`, uses `createImageBitmap(new Blob([buffer]))` to decode
   - **Downscale** to ~800px longest side using `createImageBitmap(blob, { resizeWidth, resizeHeight })` for performance
   - Draws to OffscreenCanvas, calls `getImageData` to get pixel data
   - Computes four metrics (all pure JS, no dependencies):

   **Sharpness (weight 0.40):**
   - Convert to grayscale: `0.299*R + 0.587*G + 0.114*B`
   - Apply Laplacian kernel: `4*center - top - bottom - left - right`
   - Compute variance of Laplacian response
   - Normalize: clamp `variance / 20` to 0-100 (calibrate: typical sharp photos have variance 500-2000+)

   **Exposure (weight 0.25):**
   - Build luminance histogram (256 bins)
   - Compute mean luminance and percentage of clipped pixels (lum < 5 or lum > 250)
   - Score: start at 100, penalize proportionally for mean deviation from 128 and for clipping percentage >15%
   - Formula: `100 - (|mean - 128| / 128) * 50 - clamp(clipPercent - 15, 0, 85) * 0.5`

   **Contrast (weight 0.20):**
   - Compute standard deviation of luminance values
   - Sweet spot: stddev 40-80 scores highest (100)
   - Below 40: linear ramp from 0 (stddev=0) to 100 (stddev=40)
   - Above 80: gentle penalty, e.g., `100 - (stddev - 80) * 0.3` clamped to 50-100

   **Noise (weight 0.15):**
   - Sample 16-20 random 8x8 patches from flat regions (those with low Laplacian variance)
   - Compute mean variance within these patches
   - Low variance = low noise = high score
   - Normalize inversely: `100 - clamp(meanVariance * 2, 0, 100)`

   **Composite:** `sharpness * 0.40 + exposure * 0.25 + contrast * 0.20 + noise * 0.15`, clamped 0-100, rounded to integer.

   - Posts back: `{ path: string, qualityScore: number, sharpness: number, exposure: number, contrast: number, noise: number }`
   - On error: posts back `{ path: string, qualityScore: 50, sharpness: 50, exposure: 50, contrast: 50, noise: 50 }` (neutral score)

2. **`useScoringWorker.ts`** -- Hook following `useExifExtractor` pattern:
   - Single worker, concurrency of 2 (not a pool -- keeps background gentle)
   - `scoreAll(files: Array<{ path: string }>, onResult: (path: string, score: QualityScore) => void): void`
   - Reads file via `window.api.readFile(path)`, transfers ArrayBuffer to worker
   - Tracks progress: `{ completed: number; total: number }`
   - Terminates previous worker if `scoreAll` is called again (folder change)
   - Exports: `{ scoreAll, isScoring, progress }`

3. **Wire into `usePhotoStore.ts`**:
   - Do NOT call scoring inside `openFolder` directly. Instead, expose a method or let App.tsx orchestrate.
   - Add a `startScoring` method or use the hook externally in App.tsx.

4. **Wire into `App.tsx`**:
   - Import `useScoringWorker`
   - After `openFolder` completes (images loaded), trigger `scoringWorker.scoreAll(images, onResult)` -- but delay start by ~2 seconds or wait until EXIF extraction reaches 50% to avoid IPC contention
   - `onResult` callback: Call `store.setQualityScore(filename, score.qualityScore)` which auto-assigns classification and star rating
   - Pass `scoringWorker.progress` to toolbar as `scoringProgress`
   - Watch for `state.images` changes (folder open) to trigger scoring

**Commit message:** `feat(04): add quality scoring worker with sharpness, exposure, contrast, noise analysis`

**Verify:**
- `cd /Users/martinhess/workspace/photo-culler && pnpm build` succeeds
- Open a folder -- after ~2s delay, scoring begins progressively
- Images get auto-classified (green/yellow/red borders appear one by one)
- Toolbar shows scoring progress indicator
- Sort by "Quality" now works and reorders the grid

---

#### Task 2.2: Star rating UI, thumbnails badges, and RGB histogram

**Files:**
- `apps/desktop/src/renderer/src/components/StarRating.tsx` (NEW)
- `apps/desktop/src/renderer/src/components/Histogram.tsx` (NEW)
- `apps/desktop/src/renderer/src/components/ThumbnailCell.tsx`
- `apps/desktop/src/renderer/src/components/InfoPanel.tsx`
- `apps/desktop/src/renderer/src/App.tsx`

**Delivers:** CULL-03 (manual override), QUAL-02, QUAL-08

**Detailed implementation:**

1. **`StarRating.tsx`** -- Reusable star rating component:
   - Props: `rating: number | undefined`, `onChange?: (rating: number) => void`, `size?: 'sm' | 'md'`, `readonly?: boolean`
   - Renders 5 stars as SVG star icons (filled = gold, unfilled = gray)
   - `size='sm'` for thumbnails (10px stars), `size='md'` for info panel (16px stars)
   - When `onChange` provided and not readonly: click a star to set that rating. Click current rating to clear back to algorithm-assigned (call onChange with the algorithm value).
   - Hover state: highlight stars up to hovered position
   - Tailwind dark theme styling

2. **`Histogram.tsx`** -- RGB histogram canvas component:
   - Props: `imageElement: HTMLImageElement | null` (the preview img element from InfoPanel)
   - When imageElement changes and is loaded, draw it to a hidden canvas, getImageData, compute R/G/B histograms (256 bins each)
   - Render on a visible `<canvas>` element (~240x80px or full-width of info panel)
   - Draw R/G/B channels as semi-transparent filled area charts overlaid (classic RGB histogram look)
   - Dark background (#111), no axes needed, compact
   - Use `requestAnimationFrame` for smooth rendering
   - Handle cleanup: revoke any created object URLs, clear canvas on unmount
   - Memoize histogram data -- only recompute when image changes

3. **`ThumbnailCell.tsx`** -- Add star rating badge:
   - Add props: `starRating?: number`
   - Import `StarRating` component
   - When `starRating` is defined, render small stars in bottom-left corner of the thumbnail
   - Use `size='sm'`, `readonly={true}`
   - Position: `absolute bottom-1 left-1 z-10` with slight dark background for readability
   - When no rating (unscored), show nothing

4. **`InfoPanel.tsx`** -- Add star rating display/override + histogram:
   - Add props: `starRating?: number`, `qualityScore?: number`, `onStarRatingChange?: (rating: number) => void`
   - Below the classification badge in the header, show:
     - `StarRating` component with `size='md'`, `onChange={onStarRatingChange}`
     - Small text showing numeric quality score: "Score: 72/100" in muted text
   - Below the preview image, render `Histogram` component (always visible when image is loaded)
   - Pass a ref to the preview `<img>` element so Histogram can read pixel data from it
   - Histogram renders between the preview and the info content sections

5. **`App.tsx`** -- Wire new props:
   - Pass `starRating={state.starRatings[focusedImage?.name]}` to InfoPanel
   - Pass `qualityScore={state.qualityScores[focusedImage?.name]}` to InfoPanel
   - Pass `onStarRatingChange` callback that calls `store.setStarRating`
   - Pass `starRatings={state.starRatings}` to PhotoGrid/ThumbnailCell (thread through)

**Commit message:** `feat(04): add star rating UI, thumbnail star badges, and RGB histogram in info panel`

**Verify:**
- `cd /Users/martinhess/workspace/photo-culler && pnpm build` succeeds
- Open a folder, wait for scoring -- star ratings appear on thumbnails progressively
- Info panel shows stars (clickable to override), numeric score, and RGB histogram below preview
- Clicking a star in info panel changes the rating for that image
- Histogram updates when navigating between images

---

### Wave 3: Preview Overlays -- Focus Peaking and Exposure Clipping

This wave adds the two toggleable analysis overlays on the preview image.

#### Task 3.1: Focus peaking and exposure clipping overlays on preview

**Files:**
- `apps/desktop/src/renderer/src/components/FocusPeakingOverlay.tsx` (NEW)
- `apps/desktop/src/renderer/src/components/ExposureClippingOverlay.tsx` (NEW)
- `apps/desktop/src/renderer/src/lib/image-analysis.ts` (NEW -- shared utility functions)
- `apps/desktop/src/renderer/src/components/PreviewPanel.tsx`
- `apps/desktop/src/renderer/src/components/InfoPanel.tsx` (toggle buttons)
- `apps/desktop/src/renderer/src/App.tsx` (state for toggles)

**Delivers:** QUAL-06, QUAL-07

**Detailed implementation:**

1. **`image-analysis.ts`** -- Shared pixel analysis utilities:
   - `computeSobelEdges(pixels: Uint8ClampedArray, width: number, height: number, threshold: number): ImageData` -- Sobel edge detection. Returns ImageData where edge pixels (gradient magnitude > threshold) are cyan (rgba(0, 255, 255, 180)) and non-edge pixels are transparent. Threshold default: 30.
   - `computeClippingOverlay(pixels: Uint8ClampedArray, width: number, height: number): ImageData` -- Blown highlights (any channel > 250 AND luminance > 240) are red (rgba(255, 0, 0, 180)). Crushed shadows (luminance < 10) are blue (rgba(0, 0, 255, 180)). Non-clipped pixels are transparent.
   - Both functions work on raw pixel data from `getImageData`.

2. **`FocusPeakingOverlay.tsx`**:
   - Props: `imageUrl: string | null`, `imageDimensions: { width: number; height: number }`, `visible: boolean`
   - When `visible` and `imageUrl` changes:
     - Load image into a hidden `<img>` element
     - Draw to hidden canvas, getImageData
     - Run `computeSobelEdges` from image-analysis.ts
     - Draw result to the overlay canvas ref
   - Renders: `<canvas>` with `className="absolute top-0 left-0 pointer-events-none"` and width/height matching imageDimensions
   - Cache result per imageUrl -- don't recompute on zoom/pan (canvas moves with parent via shared CSS transform)
   - Clear canvas when `visible` is false or on unmount

3. **`ExposureClippingOverlay.tsx`**:
   - Same pattern as FocusPeakingOverlay
   - Uses `computeClippingOverlay` instead
   - Same canvas positioning and caching strategy

4. **`PreviewPanel.tsx`** -- Add overlay canvases:
   - Add props: `showFocusPeaking: boolean`, `showClipping: boolean`
   - **Restructure the image rendering**: Wrap the `<img>` and overlay canvases in a single `<div>` that receives the CSS transform (currently the transform is on the `<img>` directly). This is critical for overlays to zoom/pan with the image:
     ```tsx
     <div
       style={{
         transform: `scale(${zoom}) translate(${panX}px, ${panY}px)`,
         transformOrigin: '0 0',
         willChange: 'transform',
       }}
     >
       <img src={imageUrl} onLoad={handleImageLoad} className="max-w-none select-none" draggable={false} />
       {showFocusPeaking && <FocusPeakingOverlay imageUrl={imageUrl} imageDimensions={imageDimensions} visible={showFocusPeaking} />}
       {showClipping && <ExposureClippingOverlay imageUrl={imageUrl} imageDimensions={imageDimensions} visible={showClipping} />}
     </div>
     ```
   - Ensure `useZoomPan` handlers still work correctly with the wrapper div

5. **`InfoPanel.tsx`** -- Add toggle buttons for overlays:
   - Add props: `showFocusPeaking: boolean`, `onToggleFocusPeaking: () => void`, `showClipping: boolean`, `onToggleClipping: () => void`
   - Render two toggle buttons near the histogram or at the top of the info content area:
     - "Focus Peaking" button -- cyan accent when active, gray when inactive
     - "Clipping" button -- red/blue accent when active, gray when inactive
   - Only visible when in preview mode (add `isPreviewMode` prop or conditionally render)
   - Small pill-style toggle buttons with icons or text labels

6. **`App.tsx`** -- Wire toggle state:
   - Add state: `showFocusPeaking: boolean` (default false), `showClipping: boolean` (default false)
   - Pass to PreviewPanel and InfoPanel
   - Toggle callbacks for InfoPanel buttons
   - Reset both to false when exiting preview mode

**Commit message:** `feat(04): add focus peaking and exposure clipping overlays on preview image`

**Verify:**
- `cd /Users/martinhess/workspace/photo-culler && pnpm build` succeeds
- Open a folder, enter preview mode (double-click a thumbnail)
- In info panel, toggle "Focus Peaking" -- cyan edges appear on in-focus areas of the preview image
- Toggle "Clipping" -- red highlights on blown areas, blue on crushed shadows
- Zoom and pan -- overlays move correctly with the image (no misalignment)
- Both overlays can be active simultaneously
- Toggle off -- overlays disappear immediately
- Navigate to another image -- overlays recompute for the new image
- Exit preview mode -- overlays reset to off
