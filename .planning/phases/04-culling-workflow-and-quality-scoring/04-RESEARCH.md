# Phase 4: Culling Workflow and Quality Scoring - Research

**Researched:** 2026-03-15
**Domain:** Electron desktop app -- image quality analysis, visual overlays, scoring workflow
**Confidence:** HIGH

## Summary

Phase 4 adds automatic quality scoring (0-100) computed in background Web Workers, auto-assigned classifications (keep/review/delete) and star ratings (1-5), an always-visible RGB histogram, toggleable focus peaking and exposure clipping overlays in preview mode, and sort-by-score / filter-by-stars in the toolbar. The codebase already has well-established patterns for Web Worker pools (`useThumbnailWorker`), progressive loading, and debounced state persistence to a results file.

The core technical challenges are: (a) computing sharpness, exposure, noise, and contrast scores in Web Workers using OffscreenCanvas + getImageData (well-supported in all modern browsers and already used by the thumbnail worker), (b) rendering an RGB histogram on a small canvas element in the info panel, (c) rendering focus peaking and exposure clipping overlays as canvas layers that track the preview image's CSS zoom/pan transforms, and (d) changing the classification type to support `null`/undefined for "unclassified" state without breaking existing Phase 2/3 code.

All scoring and visual analysis can be implemented in pure JavaScript with canvas pixel math -- no native dependencies or external libraries needed.

**Primary recommendation:** Create a `scoring.worker.ts` that receives image ArrayBuffers, uses OffscreenCanvas + getImageData for pixel analysis, computes a composite quality score, and posts results back. The existing EXIF extractor pattern (single worker, sequential dispatch with concurrency) is the best model. Overlays should use absolutely-positioned `<canvas>` elements inside PreviewPanel's container, inheriting the same CSS transform as the preview image.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Images start with no classification** (no colored border) until the quality scoring algorithm runs
- Once scored, images are auto-classified based on their quality score (high=keep, medium=review, low=delete)
- Score-to-classification thresholds are at Claude's discretion (e.g., >=60 keep, 35-59 review, <35 delete)
- `review` is no longer a default state -- it means the algorithm is genuinely uncertain
- **Manual override cycle via Space**: none -> keep -> review -> delete -> none
- **Two metadata dimensions per image**: classification (none/keep/review/delete) + star rating (1-5)
- Star rating is algorithmically assigned based on quality score (e.g., 0-20=1 star, 21-40=2, 41-60=3, 61-80=4, 81-100=5)
- **No keyboard shortcuts for star rating** -- stars are not a manual workflow step
- Users can **manually override star rating in info panel only** (click or UI control)
- Stars are **visible on both thumbnails and info panel**
- **Filterable**: users can filter by star rating (e.g., "3+ stars", "unrated only")
- Stars are saved to results file alongside classification
- **RGB histogram**: always visible in info panel for current preview/focused image
- **Focus peaking overlay**: toggleable -- colored edge overlay on preview image
- **Exposure clipping overlay**: toggleable -- highlights blown highlights and crushed shadows on preview image
- Toggle buttons for focus peaking and exposure clipping live in info panel or as overlay controls
- These overlays only apply in preview mode (not on grid thumbnails)
- Add **sort by quality score** option to toolbar
- Add **filter by star rating** to toolbar
- Existing sort/filter options remain unchanged
- Quality scoring runs in background Web Workers -- badges appear progressively
- All processing in pure JS (canvas pixel math), no native dependencies
- **No Pick/Reject/Unflag flags** -- classification system sufficient
- **No color labels**
- **No auto-select rejects button**
- **No manual star rating keyboard shortcuts**

### Claude's Discretion
- Quality score composite weights and normalization approach
- Score-to-classification thresholds
- Score-to-stars mapping (exact breakpoints)
- Thumbnail badge format (stars vs numeric score vs both)
- Focus peaking color and implementation (edge detection approach)
- Exposure clipping thresholds and overlay colors
- RGB histogram rendering approach (canvas vs SVG)
- Toggle button placement and styling
- Star rating override UI in info panel (clickable stars, dropdown, etc.)
- Whether to use AI/ML model or pure algorithmic scoring (pure JS constraint applies)
- Web Worker pool strategy for scoring (reuse existing workers or separate pool)

### Deferred Ideas (OUT OF SCOPE)
- **AI/ML-based scoring**: Could use NIMA but must be pure JS/WASM. May explore in future phase
- **UX-03 (theme toggle)**: Still deferred -- dark theme only
- **Color labels**: Removed per user decision
- **Pick/Reject/Unflag flags**: Removed per user decision
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CULL-01 | User can flag images as Pick/Reject/Unflag | **MODIFIED per CONTEXT.md**: Space cycles none->keep->review->delete->none. No P/X/U keys. Classification type changes to support null. |
| CULL-02 | After flagging, preview auto-advances to next image | Space key in preview mode should advance after cycling classification |
| CULL-03 | User can rate images 1-5 stars | Stars auto-assigned by quality score; manual override in info panel only |
| CULL-04 | User can assign color labels | **REMOVED per CONTEXT.md** -- no color labels |
| CULL-05 | User can filter by picks/rejects/stars | Filter by classification (existing) + new filter by star rating in toolbar |
| QUAL-01 | Quality score 0-100 based on sharpness, exposure, noise, contrast | Scoring worker computes composite score; Laplacian variance for sharpness, luminance histogram for exposure, local variance for noise, stddev for contrast |
| QUAL-02 | Color-coded badges on thumbnails | Stars + optional numeric score badge on ThumbnailCell |
| QUAL-03 | Sort by quality score | Add 'qualityScore' to SortField type, handle in sortImages function |
| QUAL-04 | Auto-select below threshold | **REMOVED per CONTEXT.md** -- users filter instead |
| QUAL-05 | Scoring in background Web Workers | New scoring.worker.ts following existing EXIF extractor pattern |
| QUAL-06 | Focus peaking overlay in preview | Sobel/Laplacian edge detection rendered as colored canvas overlay |
| QUAL-07 | Exposure clipping warnings in preview | Threshold-based pixel highlighting: red for blown, blue for crushed |
| QUAL-08 | RGB histogram for selected image | Canvas-based histogram rendering in InfoPanel |
</phase_requirements>

## Codebase Analysis

### Current Architecture Summary

The app follows established patterns that Phase 4 extends naturally:

- **State**: `usePhotoStore` is the single source of truth with `PhotoState`. Currently has `classifications: Record<string, Classification>` where `Classification = 'keep' | 'review' | 'delete'`. Needs: `qualityScores: Record<string, number>`, `starRatings: Record<string, number>`, and Classification type must support `null` for "unclassified".
- **Workers**: Two worker patterns exist:
  - `useThumbnailWorker` -- pool of `navigator.hardwareConcurrency` workers with queue, priority dispatch, and in-memory + disk caching
  - `useExifExtractor` -- single worker with concurrency=4 sequential dispatch, progress tracking, per-image callback
- **Results file**: `ResultsFile` type in `packages/types/src/ipc.ts` has `ImageResult` with `classification`, `userOverride`, and `qualityScore` fields. The `qualityScore` is already typed but scaled 0-1. Needs: `starRating` field added, and score scale changed to 0-100 (or kept 0-1 and displayed as 0-100).
- **PreviewPanel**: Uses CSS `transform: scale(zoom) translate(panX, panY)` with `transformOrigin: '0 0'` on the `<img>` element. Overlays must match this transform.
- **InfoPanel**: Already loads a full-size preview image via IPC `readFile`. Has preview image + EXIF metadata layout. Needs histogram canvas, star rating display/override, and toggle buttons added.
- **Toolbar**: Has sort buttons (`SORT_OPTIONS` array), classification filter chips, extension filter chips. Needs `'qualityScore'` sort option and star filter chips.

### Key Type Changes Required

1. **Classification type** (in `usePhotoStore.ts` and `ThumbnailCell.tsx`):
   - Current: `'keep' | 'review' | 'delete'`
   - Needed: `'keep' | 'review' | 'delete' | null` (null = unclassified, no border)
   - Impact: Every `classifications[img.name] ?? 'review'` fallback must change to `?? null`
   - Impact: `BORDER_COLORS` in ThumbnailCell needs a null case (no border)
   - Impact: `cycleClassification` cycle changes: `null -> keep -> review -> delete -> null`

2. **ImageResult type** (in `packages/types/src/ipc.ts`):
   - Current: `{ classification: 'keep' | 'review' | 'delete'; userOverride: boolean; qualityScore?: number }`
   - Needed: `{ classification: 'keep' | 'review' | 'delete' | null; userOverride: boolean; qualityScore?: number; starRating?: number }`

3. **SortField type** (in `packages/image-utils/src/sorting.ts`):
   - Current: `'filename' | 'dateTaken' | 'size' | 'dimensions'`
   - Needed: `'filename' | 'dateTaken' | 'size' | 'dimensions' | 'qualityScore'`

4. **PhotoState** (in `usePhotoStore.ts`):
   - Add: `qualityScores: Record<string, number>` (0-100 per image name)
   - Add: `starRatings: Record<string, number>` (1-5 per image name)
   - Add: `filterStarRating: number | null` (minimum stars to show, or null for all/unrated)
   - Add: `scoringProgress: { completed: number; total: number }`

### Integration Points

1. **openFolder** (line 166-267): Currently sets `classifications[img.name] = 'review'` for new images. Must change to `null` for new images. Must load saved `starRating` and `qualityScore` from results file.
2. **scheduleSave** (line 110-133): Must include `starRating` in saved results.
3. **cycleClassification** (line 299-330): Cycle must change to `null -> keep -> review -> delete -> null`.
4. **filteredImages** (line 636-658): Must add star rating filter logic.
5. **sortImages** (in sorting.ts): Must handle `'qualityScore'` sort field.

## Technical Approach

### Quality Scoring Algorithm

**Approach:** Pure JavaScript canvas pixel analysis in a Web Worker. The worker receives an image ArrayBuffer, creates an OffscreenCanvas, draws the image, calls getImageData, and computes four metrics.

**Score Components:**

1. **Sharpness (weight: 0.40)** -- Laplacian variance
   - Convert to grayscale
   - Apply Laplacian kernel: `4*center - top - bottom - left - right`
   - Compute variance of the Laplacian response across all pixels
   - Higher variance = sharper image
   - Normalize: variance 0-2000+ mapped to 0-100 (calibrate empirically)

2. **Exposure (weight: 0.25)** -- Luminance histogram analysis
   - Compute luminance histogram (256 bins)
   - Penalize if >15% of pixels are clipped (luminance <5 or >250)
   - Penalize if mean luminance is far from midpoint (128)
   - Well-exposed: score ~100; over/underexposed: score decreases

3. **Contrast (weight: 0.20)** -- Standard deviation of luminance
   - Compute stddev of luminance values
   - Very low stddev = flat/hazy image = low score
   - Moderate stddev = good tonal range = high score
   - Very high stddev may indicate harsh lighting, slight penalty
   - Sweet spot: stddev 40-80 out of 255

4. **Noise (weight: 0.15)** -- Local pixel variance in smooth regions
   - Sample NxN patches from flat regions (low edge content)
   - Compute variance within each patch
   - High variance in smooth regions = noise
   - Normalize inversely: low noise = high score

**Composite:**
```
score = sharpness * 0.40 + exposure * 0.25 + contrast * 0.20 + noise * 0.15
```

**Thresholds (recommended):**
- Classification: >=60 keep, 35-59 review, <35 delete
- Stars: 0-20=1, 21-40=2, 41-60=3, 61-80=4, 81-100=5

**Downsampling for performance:** Score at reduced resolution (e.g., 800px longest side) rather than full resolution. This is faster and sufficient for quality assessment. The scoring worker should resize the image internally before analysis.

### Scoring Worker Architecture

Follow the `useExifExtractor` pattern (not the thumbnail worker pool):
- **Single worker** with sequential dispatch and concurrency of 2-4
- Worker receives `{ path: string, buffer: ArrayBuffer }`
- Worker creates `OffscreenCanvas`, draws image via `createImageBitmap`, resizes to ~800px, calls `getImageData`, computes scores
- Worker returns `{ path: string, qualityScore: number, sharpness: number, exposure: number, contrast: number, noise: number }`
- Hook (`useScoringWorker`) tracks progress, calls back per-image, updates store

**Why not the thumbnail pool pattern:** Scoring is CPU-intensive per image (100-500ms at reduced resolution). A pool of `hardwareConcurrency` workers all doing scoring simultaneously would starve the UI thread and thumbnail/EXIF workers. A single worker with limited concurrency keeps background scoring gentle.

### RGB Histogram Rendering

**Approach:** Canvas-based rendering in InfoPanel.

1. When the focused image changes, get pixel data from the InfoPanel's preview image (or the scoring worker's intermediate data)
2. Compute 3 histograms (R, G, B) -- 256 bins each
3. Also compute luminance histogram
4. Render on a small `<canvas>` element (~240x80px):
   - Draw R channel as semi-transparent red filled area
   - Draw G channel as semi-transparent green filled area
   - Draw B channel as semi-transparent blue filled area
   - Overlay produces the classic RGB histogram look
5. Normalize by max bin count to fill vertical space
6. Dark background, thin axes

**Data source:** The histogram should be computed from the preview image already loaded in InfoPanel. When the image loads (`onLoad` callback), draw it to a hidden canvas, getImageData, compute histogram, render. This avoids an extra IPC read.

### Focus Peaking Overlay

**Approach:** Sobel edge detection with colored pixel overlay.

1. When focus peaking is toggled ON and preview is active:
   - Take the current preview image data
   - Apply Sobel filter (horizontal + vertical gradients)
   - Threshold the gradient magnitude (e.g., >30 out of 255)
   - Create an overlay ImageData where edge pixels are colored (cyan or red, with alpha ~180) and non-edge pixels are transparent
   - Draw to a `<canvas>` element positioned over the preview image

2. **Overlay positioning:** The overlay canvas must match the preview image dimensions and share the same CSS transform:
   ```tsx
   <div style={{ transform: `scale(${zoom}) translate(${panX}px, ${panY}px)`, transformOrigin: '0 0' }}>
     <img src={imageUrl} ... />
     {showFocusPeaking && <canvas className="absolute inset-0 pointer-events-none" ... />}
   </div>
   ```

3. **Color choice:** Cyan (rgb(0, 255, 255)) at ~70% opacity. Contrasts well with most photo content. Red is also standard but conflicts with exposure clipping overlay.

4. **Performance:** Compute on image change or toggle. Cache the overlay data. Do NOT recompute on zoom/pan -- the overlay moves with the image via the shared CSS transform.

### Exposure Clipping Overlay

**Approach:** Simple threshold-based pixel highlighting.

1. When exposure clipping is toggled ON:
   - Iterate all pixels of the preview image
   - Blown highlights: any channel >250 and luminance >240 -> red overlay pixel (rgba(255, 0, 0, 180))
   - Crushed shadows: all channels <5 or luminance <10 -> blue overlay pixel (rgba(0, 0, 255, 180))
   - Non-clipped pixels are transparent

2. **Same overlay approach as focus peaking:** Absolutely-positioned canvas sharing the CSS transform.

3. **Can share the canvas** with focus peaking if both are on simultaneously, or use separate canvases for simplicity.

### Star Rating UI in InfoPanel

**Recommendation:** Clickable 5-star row.

- Display 5 star icons (filled/unfilled based on current rating)
- Click a star to manually override to that rating
- Click the current rating again to revert to algorithm-assigned rating
- Show below the classification badge in the header area
- Small and compact -- consistent with EXIF metadata density

### Thumbnail Badge

**Recommendation:** Show star rating as small yellow stars in the bottom-left corner of each thumbnail cell.

- Stars are tiny (8-10px each), displayed as a row of 1-5 filled circles or star glyphs
- When score is not yet computed, show nothing (no placeholder)
- Stars appear progressively as scoring completes
- Do NOT show the numeric score on thumbnails (too cluttered) -- numeric score visible in InfoPanel only

## Integration Plan

### Wave 1: Type Changes and Scoring Infrastructure

1. **Update Classification type** to support `null` across codebase:
   - `usePhotoStore.ts`: Change `Classification` type, update `cycleClassification`, update `openFolder` to default to `null`
   - `ThumbnailCell.tsx`: Add `null` case to `BORDER_COLORS` (no border or gray)
   - `InfoPanel.tsx`: Add `null` case to `CLASSIFICATION_BADGES`
   - `Toolbar.tsx`: Update `CLASSIFICATION_CHIPS` to include "None" option
   - `packages/types/src/ipc.ts`: Update `ImageResult.classification` type

2. **Add new state fields** to `PhotoState` and `PhotoStoreAPI`:
   - `qualityScores`, `starRatings`, `filterStarRating`, `scoringProgress`
   - New methods: `setQualityScore`, `setStarRating`, `setFilterStarRating`

3. **Update ResultsFile** to persist star ratings

4. **Add `'qualityScore'` to SortField** and implement in `sortImages`

### Wave 2: Scoring Worker

5. **Create `scoring.worker.ts`** with quality scoring algorithm
6. **Create `useScoringWorker.ts`** hook following useExifExtractor pattern
7. **Wire into openFolder** to trigger scoring after images load (can run in parallel with EXIF extraction)
8. **Update store** with scores as they arrive, auto-assign classifications and star ratings

### Wave 3: Visual Analysis Tools

9. **RGB Histogram component** -- canvas-based, rendered in InfoPanel
10. **Focus peaking overlay** -- Sobel edge detection canvas in PreviewPanel
11. **Exposure clipping overlay** -- threshold-based canvas in PreviewPanel
12. **Toggle buttons** in InfoPanel or PreviewPanel overlay controls

### Wave 4: Toolbar and Thumbnail Updates

13. **Add sort-by-score** to toolbar sort options
14. **Add filter-by-stars** to toolbar (chip-style buttons: 1-5 stars + "unrated")
15. **Star rating badge on ThumbnailCell**
16. **Star rating display and override UI in InfoPanel**

## Risks & Mitigations

### Risk 1: Scoring Performance for 1000+ Images (MEDIUM)
**Risk:** Scoring each image takes 100-500ms even at reduced resolution. For 1000 images, total scoring time could be 2-8 minutes.
**Mitigation:** Progressive display -- scores appear one by one as computed. Use a single worker with concurrency of 2 to avoid starving the main thread. Downscale images to ~800px longest side before analysis. The user can interact with the app immediately; scores arrive in the background.
**Warning signs:** Main thread jank, thumbnail loading slows down.

### Risk 2: OffscreenCanvas + getImageData in Workers (LOW)
**Risk:** OffscreenCanvas might have limitations or performance issues in Electron's Chromium.
**Mitigation:** The existing `thumbnail.worker.ts` already uses `OffscreenCanvas` successfully (line 38: `new OffscreenCanvas(size, size)`). The scoring worker follows the same pattern. This is proven infrastructure in this codebase.

### Risk 3: Overlay Performance During Zoom/Pan (LOW)
**Risk:** Focus peaking and exposure clipping overlays could cause jank during zoom/pan.
**Mitigation:** Overlays are pre-computed canvases that share the same CSS transform as the image. During zoom/pan, only the transform changes (GPU-accelerated), not the overlay content. The overlay canvas is NOT redrawn on zoom/pan -- only on image change or toggle.

### Risk 4: Classification Type Change Breaking Existing Code (MEDIUM)
**Risk:** Changing `Classification` from `'keep' | 'review' | 'delete'` to include `null` breaks every place that assumes one of the three values.
**Mitigation:** Systematic grep for `?? 'review'` patterns (there are ~8 occurrences in usePhotoStore alone). Change all to `?? null`. Update ThumbnailCell's `BORDER_COLORS` and InfoPanel's `CLASSIFICATION_BADGES` to handle null. Update Toolbar's classification filter chips.

### Risk 5: Memory Usage for Scoring Data (LOW)
**Risk:** Storing pixel data or intermediate results for 1000+ images could consume significant memory.
**Mitigation:** The worker processes one image at a time, computes the score, and discards pixel data. Only the final numeric scores (a few bytes per image) are stored in state. The histogram and overlays are computed on-demand for the currently viewed image only.

### Risk 6: Histogram and Overlay Recomputation on Every Image Change (MEDIUM)
**Risk:** Computing histogram (iterating all pixels) and overlays (Sobel filter) on every image navigation could cause visible delay.
**Mitigation:** The InfoPanel already loads images via IPC which takes 200-500ms. Histogram computation on loaded image data adds ~50ms -- imperceptible. Focus peaking/exposure clipping overlays can be computed asynchronously after the image renders (requestIdleCallback or setTimeout). Cache overlay results for 3-5 recent images.

## Architecture Patterns

### Recommended New Files

```
src/renderer/src/
  workers/
    scoring.worker.ts          # Quality scoring (sharpness, exposure, noise, contrast)
  hooks/
    useScoringWorker.ts        # Hook managing scoring worker lifecycle
  components/
    Histogram.tsx              # RGB histogram canvas component
    FocusPeakingOverlay.tsx    # Sobel edge detection overlay canvas
    ExposureClippingOverlay.tsx # Highlight/shadow clipping overlay canvas
    StarRating.tsx             # Clickable star rating display/edit component
  lib/
    image-analysis.ts          # Shared utility functions (Sobel, Laplacian, histogram computation)
```

### Pattern: Overlay Canvas Sharing Transform

The key insight for overlays is that they must zoom/pan with the image. The cleanest approach is wrapping the image and overlay canvases in a single div that receives the CSS transform:

```typescript
// In PreviewPanel -- wrap image + overlays in one transformed container
<div
  style={{
    transform: `scale(${zoom}) translate(${panX}px, ${panY}px)`,
    transformOrigin: '0 0',
    willChange: 'transform',
  }}
>
  <img src={imageUrl} onLoad={handleImageLoad} className="max-w-none select-none" draggable={false} />
  {showFocusPeaking && (
    <canvas
      ref={focusPeakingRef}
      width={imageDimensions.width}
      height={imageDimensions.height}
      className="absolute top-0 left-0 pointer-events-none"
    />
  )}
  {showClipping && (
    <canvas
      ref={clippingRef}
      width={imageDimensions.width}
      height={imageDimensions.height}
      className="absolute top-0 left-0 pointer-events-none"
    />
  )}
</div>
```

### Pattern: Scoring Worker Following EXIF Extractor

```typescript
// useScoringWorker.ts -- similar to useExifExtractor
export function useScoringWorker(): ScoringWorkerAPI {
  const workerRef = useRef<Worker | null>(null);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });

  const scoreAll = useCallback((
    files: Array<{ path: string }>,
    onResult: (path: string, score: QualityScore) => void,
  ) => {
    // Terminate existing worker if re-scoring
    // Create new worker
    // Sequential dispatch with concurrency of 2
    // For each file: read via IPC, post ArrayBuffer to worker
    // On result: callback with score, update progress
  }, []);

  return { scoreAll, progress };
}
```

### Anti-Patterns to Avoid

- **Do not run scoring on full-resolution images.** A 24MP image is 96MB of pixel data. Downscale to ~800px before analysis -- quality assessment does not need pixel-level precision.
- **Do not use a pool of scoring workers.** Unlike thumbnails (fast, GPU-assisted), scoring is pure CPU math. A pool would saturate all cores and cause UI jank. One worker with controlled concurrency is better.
- **Do not recompute overlays on zoom/pan.** Pre-compute once on image load/toggle, let CSS transforms handle zoom/pan for free.
- **Do not block on scoring before showing grid.** Scores arrive progressively; the grid is usable immediately with "unclassified" state.
- **Do not store histogram data in the global store.** Histogram is view-specific (current image only). Keep it as local component state in InfoPanel.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Image loading in workers | Custom fetch logic | Existing `window.api.readFile` + `createImageBitmap` | Already proven pattern in thumbnail worker |
| Image resizing in workers | Manual pixel scaling | `createImageBitmap(blob, { resizeWidth, resizeHeight })` | Browser-native, GPU-accelerated resize |
| Results persistence | New save mechanism | Existing `saveResults`/`loadResults` + `ResultsFile` type | Already handles debounced save, beforeunload flush |
| Worker lifecycle | Custom worker manager | Follow `useExifExtractor` pattern exactly | Handles termination, progress, sequential dispatch |

## Code Examples

### Laplacian Sharpness Computation (in scoring.worker.ts)
```typescript
function computeSharpness(pixels: Uint8ClampedArray, width: number, height: number): number {
  // Convert to grayscale luminance
  const gray = new Float32Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    const r = pixels[i * 4];
    const g = pixels[i * 4 + 1];
    const b = pixels[i * 4 + 2];
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  // Apply Laplacian kernel: 4*center - top - bottom - left - right
  let sum = 0;
  let sumSq = 0;
  let count = 0;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const lap = 4 * gray[idx]
        - gray[(y - 1) * width + x]
        - gray[(y + 1) * width + x]
        - gray[y * width + (x - 1)]
        - gray[y * width + (x + 1)];
      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }

  const mean = sum / count;
  const variance = sumSq / count - mean * mean;
  return variance; // Higher = sharper
}
```

### RGB Histogram Rendering (in Histogram.tsx)
```typescript
function drawHistogram(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  histR: Uint32Array,
  histG: Uint32Array,
  histB: Uint32Array,
): void {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, width, height);

  // Find max across all channels for normalization
  let max = 1;
  for (let i = 0; i < 256; i++) {
    max = Math.max(max, histR[i], histG[i], histB[i]);
  }

  const barWidth = width / 256;

  // Draw each channel with alpha blending
  const channels: Array<[Uint32Array, string]> = [
    [histR, 'rgba(255, 0, 0, 0.5)'],
    [histG, 'rgba(0, 255, 0, 0.5)'],
    [histB, 'rgba(0, 0, 255, 0.5)'],
  ];

  for (const [hist, color] of channels) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, height);
    for (let i = 0; i < 256; i++) {
      const barHeight = (hist[i] / max) * height;
      ctx.lineTo(i * barWidth, height - barHeight);
    }
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fill();
  }
}
```

### Exposure Clipping Detection
```typescript
function computeClippingOverlay(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): ImageData {
  const overlay = new ImageData(width, height);
  const data = overlay.data;

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;

    if ((r > 250 || g > 250 || b > 250) && lum > 240) {
      // Blown highlights -- red overlay
      data[i] = 255;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 180;
    } else if (lum < 10) {
      // Crushed shadows -- blue overlay
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 255;
      data[i + 3] = 180;
    }
    // else: transparent (data is already zeroed)
  }

  return overlay;
}
```

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
| CULL-01 | Space cycles none->keep->review->delete->none | unit | `cd apps/desktop && npx vitest run src/renderer/src/__tests__/classification-cycle.test.ts -x` | Wave 0 |
| CULL-02 | Auto-advance after classification in preview | unit | `cd apps/desktop && npx vitest run src/renderer/src/__tests__/classification-cycle.test.ts -x` | Wave 0 |
| CULL-03 | Star rating auto-assigned and manually overridable | unit | `cd apps/desktop && npx vitest run src/renderer/src/__tests__/star-rating.test.ts -x` | Wave 0 |
| CULL-05 | Filter by star rating | unit | `cd apps/desktop && npx vitest run src/renderer/src/__tests__/filtering.test.ts -x` | Extend existing |
| QUAL-01 | Quality score computation | unit | `cd apps/desktop && npx vitest run src/renderer/src/__tests__/quality-scoring.test.ts -x` | Wave 0 |
| QUAL-02 | Score badge on thumbnails | unit | `cd apps/desktop && npx vitest run src/renderer/src/__tests__/thumbnail-badge.test.ts -x` | Wave 0 |
| QUAL-03 | Sort by quality score | unit | `cd apps/desktop && npx vitest run src/renderer/src/__tests__/filtering.test.ts -x` | Extend existing |
| QUAL-05 | Background worker scoring | unit | `cd apps/desktop && npx vitest run src/renderer/src/__tests__/scoring-worker.test.ts -x` | Wave 0 |
| QUAL-08 | RGB histogram display | unit | `cd apps/desktop && npx vitest run src/renderer/src/__tests__/histogram.test.ts -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `cd apps/desktop && npx vitest run --reporter=verbose`
- **Per wave merge:** `pnpm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/renderer/src/__tests__/classification-cycle.test.ts` -- covers CULL-01, CULL-02
- [ ] `src/renderer/src/__tests__/star-rating.test.ts` -- covers CULL-03
- [ ] `src/renderer/src/__tests__/quality-scoring.test.ts` -- covers QUAL-01 (scoring algorithm unit tests)
- [ ] `src/renderer/src/__tests__/scoring-worker.test.ts` -- covers QUAL-05 (worker integration)
- [ ] `src/renderer/src/__tests__/histogram.test.ts` -- covers QUAL-08
- [ ] `src/renderer/src/__tests__/thumbnail-badge.test.ts` -- covers QUAL-02
- Extend `src/renderer/src/__tests__/filtering.test.ts` -- covers CULL-05, QUAL-03

## Common Pitfalls

### Pitfall 1: Classification Default Change Regression
**What goes wrong:** Changing the default from `'review'` to `null` breaks 8+ locations in usePhotoStore that use `?? 'review'` as a fallback.
**Why it happens:** The fallback is used in `filteredImages`, `executeActions`, `selectAll`, `openFolder`, and save logic.
**How to avoid:** Do a full grep for `?? 'review'` and `?? "review"` and update each one. Update the Execute panel logic (currently filters for `'delete'` classification). Ensure results file backward compatibility -- old results files have `classification: 'review'` which should still load correctly.
**Warning signs:** All images showing as "unclassified" after loading a previously-classified folder.

### Pitfall 2: Results File Backward Compatibility
**What goes wrong:** Existing `photo-culler-results.json` files don't have `starRating` fields and use the old classification values.
**Why it happens:** Phase 2 created results files without star ratings.
**How to avoid:** When loading results, treat missing `starRating` as undefined (unrated). Treat existing `classification: 'review'` as a valid classification (not null). Only new images that haven't been scored get `null` classification.

### Pitfall 3: Scoring Worker Starving Other Workers
**What goes wrong:** Scoring worker consumes too much CPU and slows down thumbnail loading and EXIF extraction.
**Why it happens:** All workers compete for CPU time.
**How to avoid:** Start scoring AFTER thumbnails and EXIF are complete (or at least partially complete). Use requestIdleCallback or a simple delay (e.g., start scoring 2 seconds after folder opens). Limit concurrency to 1-2 images at a time.

### Pitfall 4: Overlay at Wrong Scale
**What goes wrong:** Focus peaking or clipping overlay doesn't align with the image when zoomed/panned.
**Why it happens:** The overlay canvas has different dimensions than the image, or isn't sharing the same CSS transform.
**How to avoid:** The overlay canvas dimensions must exactly match the image's natural dimensions. Both image and overlay must be children of the same transformed container (not siblings with independent transforms).

### Pitfall 5: Memory Leak from Overlay Canvases
**What goes wrong:** Creating new ImageData or canvas contexts on every image change without cleanup.
**Why it happens:** Canvas contexts and ImageData objects consume significant memory.
**How to avoid:** Reuse canvas refs. Clear canvas context before redrawing. Don't cache overlay data for more than 3-5 images. Set overlay canvas dimensions to 0x0 when not visible.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| ML-based quality scoring (NIMA) | Algorithmic scoring (Laplacian, histogram) | Always for pure-JS apps | No model download, instant startup, predictable results |
| SVG histograms | Canvas histograms | Standard practice | Better performance for 256-bin rendering at 60fps |
| Server-side image analysis | Client-side OffscreenCanvas in Workers | 2020+ (OffscreenCanvas widely supported) | Zero latency, no network dependency |

## Open Questions

1. **Scoring calibration**
   - What we know: Laplacian variance ranges differ widely based on image content (macro vs landscape)
   - What's unclear: Exact normalization curves to map raw metrics to 0-100
   - Recommendation: Start with linear normalization based on empirical testing with 50-100 sample images. Adjust curves in a follow-up if scoring feels off. The CONTEXT.md gives Claude discretion here.

2. **Scoring vs EXIF timing**
   - What we know: EXIF extraction and scoring both read the full file via IPC
   - What's unclear: Whether to share the file buffer between EXIF and scoring workers
   - Recommendation: Keep them independent. EXIF reads happen quickly (100ms). Scoring can start after EXIF completes to avoid IPC contention. The simplicity of independent workers outweighs the small overhead of reading files twice.

3. **Histogram source image**
   - What we know: InfoPanel already loads the full image via `window.api.readFile`
   - What's unclear: Whether to compute histogram from the InfoPanel's preview image (already loaded) or request separately
   - Recommendation: Compute from the InfoPanel's already-loaded image. After the `<img>` onLoad fires, draw to a hidden canvas, getImageData, compute histogram. No extra IPC call needed.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: Direct reading of all 12 source files listed in task requirements
- `apps/desktop/src/renderer/src/workers/thumbnail.worker.ts` -- verified OffscreenCanvas + createImageBitmap pattern in Web Workers
- `apps/desktop/src/renderer/src/hooks/useExifExtractor.ts` -- verified single-worker sequential dispatch pattern
- `apps/desktop/src/renderer/src/hooks/useZoomPan.ts` -- verified CSS transform zoom/pan implementation
- `packages/types/src/ipc.ts` -- verified ResultsFile and ImageResult types (qualityScore field already exists)
- [MDN OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas) -- confirmed full browser support including getImageData in workers

### Secondary (MEDIUM confidence)
- [Revolut: Canvas-based blur detection](https://medium.com/revolut/canvas-based-javascript-blur-detection-b92ab1075acf) -- Laplacian variance approach for sharpness
- [web.dev: OffscreenCanvas](https://web.dev/articles/offscreen-canvas) -- performance patterns for worker-based canvas operations
- [Sobel edge detection in JS](https://gist.github.com/arifd/9ef3d02b43e858170f52553319c05952) -- reference implementation for focus peaking

### Tertiary (LOW confidence)
- Scoring weight calibration (0.40/0.25/0.20/0.15) -- based on photography domain knowledge, not empirically validated. May need adjustment.

## Metadata

**Confidence breakdown:**
- Codebase integration: HIGH -- all integration points identified from direct file reading
- Scoring algorithm: MEDIUM -- approach is well-established but calibration is empirical
- Visual overlays: HIGH -- canvas overlay + shared CSS transform is standard pattern
- Worker architecture: HIGH -- follows proven existing patterns in this codebase
- Type changes: HIGH -- all impacted locations identified via codebase analysis

**Research date:** 2026-03-15
**Valid until:** 2026-04-15 (stable -- no fast-moving dependencies, pure JS algorithms)
