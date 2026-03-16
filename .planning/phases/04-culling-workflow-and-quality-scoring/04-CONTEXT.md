# Phase 4: Culling Workflow and Quality Scoring - Context

**Gathered:** 2026-03-15
**Status:** Ready for planning
**Mode:** User-discussed (interactive decisions on classification model, star ratings, visual analysis tools)

<domain>
## Phase Boundary

Users get automatic quality scores (0-100) computed in background Web Workers, which auto-assign both a classification (keep/review/delete) and a star rating (1-5) to every image. Stars are visible on thumbnails and in the info panel, filterable and sortable. The info panel shows an always-visible RGB histogram and toggleable focus peaking and exposure clipping overlays on the preview image. Classification and star rating are saved to the results file. This phase replaces the "all start as review" behavior from Phase 2 with algorithm-driven initial classifications.

</domain>

<decisions>
## Implementation Decisions

### Classification Model Changes
- **Images start with no classification** (no colored border) until the quality scoring algorithm runs
- Once scored, images are auto-classified based on their quality score:
  - High score → `keep` (green border)
  - Medium score → `review` (yellow border)
  - Low score → `delete` (red border)
- Score-to-classification thresholds are at Claude's discretion (e.g., ≥60 keep, 35-59 review, <35 delete)
- **`review` is no longer a default state** — it means the algorithm is genuinely uncertain
- **Manual override cycle via Space**: none → keep → review → delete → none
- This changes the Phase 2 behavior where all images started as `review`

### Star Rating System
- **Two metadata dimensions per image**: classification (none/keep/review/delete) + star rating (1-5)
- Star rating is **algorithmically assigned** based on quality score (e.g., 0-20 = 1 star, 21-40 = 2 stars, 41-60 = 3 stars, 61-80 = 4 stars, 81-100 = 5 stars)
- **No keyboard shortcuts for star rating** — stars are not a manual workflow step
- Users can **manually override the star rating in the info panel only** (click or UI control)
- Stars are **visible on both thumbnails and the info panel**
- **Filterable**: users can filter the grid by star rating (e.g., "3+ stars", "unrated only")
- Stars are saved to the results file alongside classification

### What Was Removed from Roadmap Scope
- **No Pick/Reject/Unflag flags** — the existing classification system (keep/review/delete) is sufficient
- **No color labels** — not needed
- **No auto-select rejects button** — users can filter by classification or rating instead
- **No manual star rating keyboard shortcuts** — stars are algorithm-driven

### Quality Scoring Algorithm
- Compute a composite quality score (0-100) per image in background Web Workers
- Score components (from PROJECT-PLAN.md):
  - **Sharpness** — Laplacian-style edge detection on grayscale pixels
  - **Exposure** — Luminance histogram analysis (penalize too dark or blown out)
  - **Noise** — Local pixel variance in smooth regions
  - **Contrast** — Standard deviation of luminance channel
- Composite weights and normalization at Claude's discretion
- Score progressively in background — classifications and stars appear as scores complete
- All processing in pure JS (canvas pixel math), no native dependencies
- Score displayed as a color-coded badge on thumbnails (format at Claude's discretion — may show stars, numeric score, or both)

### Visual Analysis Tools in Preview
- **RGB histogram**: always visible in the info panel for the current preview/focused image
- **Focus peaking overlay**: toggleable — colored edge overlay on the preview image highlighting in-focus areas
- **Exposure clipping overlay**: toggleable — highlights blown highlights and crushed shadows on the preview image
- Toggle buttons for focus peaking and exposure clipping live in the info panel or as overlay controls
- These overlays only apply in preview mode (not on grid thumbnails)

### Sorting and Filtering
- Add **sort by quality score** option to toolbar
- Add **filter by star rating** to toolbar (e.g., "3+ stars", "unrated")
- Existing sort/filter options remain unchanged

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

</decisions>

<specifics>
## Specific Ideas

- Quality scoring should feel fast — badges appearing progressively as images are scored, similar to how thumbnails load
- Histogram should be compact but readable — standard RGB overlay style
- Focus peaking should use a visible color (e.g., red or cyan edges) that contrasts with most photo content
- Exposure clipping: red for blown highlights, blue for crushed shadows is the photography convention
- Stars on thumbnails should be small and unobtrusive — not competing with the classification border

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`usePhotoStore`**: Central state with `classifications`, `focusedImageId`, `selectedImages`. Needs `starRatings: Record<string, number>` and `qualityScores: Record<string, number>` added
- **`useThumbnailWorker`**: Web Worker pool pattern for off-main-thread processing. Quality scoring can follow the same pool pattern
- **`workers/thumbnail.worker.ts`** and **`workers/exif.worker.ts`**: Existing worker patterns to follow
- **Classification type**: Currently `'keep' | 'review' | 'delete'` — needs to support `null`/`undefined` for "unclassified"
- **Results file** (`lib/results.ts`): Saves/loads `photo-culler-results.json`. Needs star ratings and quality scores added
- **InfoPanel** (`components/InfoPanel.tsx`): Shows EXIF metadata and large preview. Needs histogram, star rating display/override, and toggle buttons
- **PreviewPanel** (`components/PreviewPanel.tsx`): Full-size preview with zoom/pan. Needs focus peaking and exposure clipping overlays
- **Toolbar** (`components/Toolbar.tsx`): Has sort/filter controls. Needs sort-by-score and filter-by-stars options
- **`SortField` type**: Defined in `@photo-culler/image-utils/sorting`. Needs `'qualityScore'` added

### Established Patterns
- Web Workers for heavy computation (thumbnails, EXIF extraction)
- Progressive loading — UI usable while background work completes
- State in `usePhotoStore` with `useState` + `useCallback` + `stateRef` pattern
- IPC via `window.api` for file system operations
- Tailwind dark theme throughout
- Canvas API for image processing in workers

### Integration Points
- `usePhotoStore` — add `qualityScores`, `starRatings`, classification change to support `null`
- `ThumbnailCell` — add star rating badge and score overlay
- `InfoPanel` — add histogram, star override, toggle buttons
- `PreviewPanel` — add overlay layers for focus peaking and exposure clipping
- `Toolbar` — add sort-by-score, filter-by-stars
- `ResultsFile` type — add starRating and qualityScore fields
- `SortField` — add `'qualityScore'` variant
- New workers: `scoring.worker.ts` for quality analysis

</code_context>

<deferred>
## Deferred Ideas

- **AI/ML-based scoring**: Could use a pre-trained model (e.g., NIMA) for aesthetic scoring, but must be pure JS/WASM. May explore in a future phase if algorithmic scoring proves insufficient.
- **UX-03 (theme toggle)**: Still deferred from Phase 3 — dark theme only
- **Color labels**: Mentioned in original roadmap but removed per user decision — not needed
- **Pick/Reject/Unflag flags**: Removed per user decision — classification system is sufficient

</deferred>

---

*Phase: 04-culling-workflow-and-quality-scoring*
*Context gathered: 2026-03-15*
*Mode: User-discussed (classification model, star ratings, visual analysis tools, quality scoring)*
