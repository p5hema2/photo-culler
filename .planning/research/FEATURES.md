# Feature Landscape

**Domain:** Desktop photo culling / lightweight photo browser
**Researched:** 2026-03-14
**Scope:** Features appropriate for a lightweight, folder-based culling tool (NOT a full DAM, editor, or AI platform)

## Competitor Landscape

Before categorizing features, here is the competitive context. The photo culling space in 2026 divides into three tiers:

| Tier | Products | Approach | Price Range |
|------|----------|----------|-------------|
| **AI-powered cullers** | Aftershoot, FilterPixel, Narrative Select, Imagen Culling | Cloud or local AI to auto-reject/auto-pick | $10-30/mo subscription |
| **Pro manual cullers** | Photo Mechanic, FastRawViewer, PhotoCuller | Speed-first, keyboard-driven, no AI magic | $40-150 one-time |
| **General browsers** | XnView, ACDSee, IrfanView, FastStone | View/organize/light edit across many formats | Free - $80 |

Our project sits in the **Pro manual culler** tier but with a narrower scope: no RAW processing, no ingest from cards, no catalog. The value proposition is "open a folder, see your photos, delete the bad ones" with zero friction.

---

## Table Stakes

Features users expect from any culling tool. Missing any of these and users will not consider the product.

| # | Feature | Why Expected | Complexity | Confidence |
|---|---------|--------------|------------|------------|
| T1 | **Thumbnail grid view** | Every competitor has it. Core browsing metaphor. | Medium | HIGH |
| T2 | **Full-size preview / lightbox** | Must see images at full resolution to judge quality. Photo Mechanic, Lightroom, PhotoCuller all have it. | Medium | HIGH |
| T3 | **Keyboard navigation** | Arrow keys to advance photos. Every culling tool supports this. Auto-advance after rating is standard in Lightroom. | Low | HIGH |
| T4 | **Sort by filename, date, size** | Basic organization. Every file browser and photo tool has this. | Low | HIGH |
| T5 | **Multi-select and batch delete** | The core value prop. Click, Shift+click, Ctrl/Cmd+click selection. Delete to OS trash (not permanent). | Medium | HIGH |
| T6 | **Fast performance at scale** | Photo Mechanic's entire brand is speed. Users expect instant thumbnail loading and zero lag when navigating 1,000+ photos. Virtualized scrolling is required. | High | HIGH |
| T7 | **EXIF metadata display** | Camera, lens, aperture, shutter speed, ISO, date taken. Every culling tool shows this in an info panel or overlay. | Low | HIGH |
| T8 | **Zoom / pan in preview** | Click-to-zoom at 100% to check focus. Scroll-wheel zoom. Pan when zoomed in. Non-negotiable for judging sharpness. | Medium | HIGH |
| T9 | **File type filtering** | Filter by JPG, PNG, HEIC, etc. Basic expectation when a folder has mixed content. | Low | HIGH |
| T10 | **Filename search** | Quick filter to find specific images by name. | Low | HIGH |
| T11 | **Cross-platform (macOS + Windows)** | Defined in project constraints. Photo Mechanic, XnView, ACDSee all support both platforms. | High (build/packaging) | HIGH |
| T12 | **Native OS trash (not permanent delete)** | Safety net. Lightroom, Photo Mechanic, PhotoCuller all use OS trash/recycle bin. Permanent delete would be a dealbreaker. | Low | HIGH |

---

## Differentiators

Features that set the product apart. Not strictly expected, but valued. Ordered by impact-to-effort ratio.

| # | Feature | Value Proposition | Complexity | Confidence |
|---|---------|-------------------|------------|------------|
| D1 | **Algorithmic quality scoring** | Auto-detect blur, under/overexposure, noise, low contrast. Not AI/ML -- pure JS pixel math via Canvas. Unique among lightweight tools (competitors use heavy ML models or skip scoring entirely). Lets users sort worst-to-best and batch-select below threshold. | High | MEDIUM |
| D2 | **Pick / reject flagging with keyboard** | P to pick, X to reject, U to unflag (Lightroom-standard keys). Filter to show only picks, only rejects, or unflagged. Auto-advance to next photo after flagging. This is the core culling UX loop. | Medium | HIGH |
| D3 | **Color labels** | Industry-standard 5-color label system (red, yellow, green, blue, purple). Keyboard shortcut per color (6-9, 0). Useful for multi-pass culling workflows. | Low | HIGH |
| D4 | **Star ratings (1-5)** | Press 1-5 to rate. Standard across Lightroom, Photo Mechanic, Narrative Select. Enables graduated quality assessment beyond binary pick/reject. | Low | HIGH |
| D5 | **Comparison / side-by-side view** | View 2+ photos side by side with synchronized zoom and pan. PhotoCuller, Lightroom, Narrative Select all have this. Critical for choosing between similar shots. | High | HIGH |
| D6 | **Focus peaking overlay** | Highlight in-focus areas with colored overlay. FastRawViewer, PhotoCuller both have this. Helps judge sharpness without zooming to 100%. | Medium | MEDIUM |
| D7 | **Exposure warnings (clipping indicators)** | Highlight blown highlights (red) and crushed shadows (blue). FastRawViewer and PhotoCuller feature this. Helps identify exposure problems at a glance. | Medium | MEDIUM |
| D8 | **Histogram display** | Show RGB histogram for selected image. Standard in Lightroom, FastRawViewer, PhotoCuller. Useful for exposure assessment. | Medium | MEDIUM |
| D9 | **Auto-grouping by similarity / burst detection** | Group consecutive similar shots together. Narrative Select, OptiCull, and Keeper all auto-group bursts. Helps users compare similar shots without manual scene organization. | High | LOW |
| D10 | **Loupe / magnifier tool** | Floating zoom lens on hover, without leaving grid or preview view. PhotoCuller has this. Faster than switching to full zoom. | Medium | MEDIUM |
| D11 | **Customizable keyboard shortcuts** | PhotoCuller offers 30+ customizable shortcuts. Photo Mechanic recently added custom shortcuts. Power users expect this. | Medium | HIGH |
| D12 | **Dark / light theme** | Photographers prefer dark UI for color-accurate viewing. Most pro tools default to dark. Should be the default. | Low | HIGH |
| D13 | **Filmstrip navigation** | Horizontal thumbnail strip at bottom of preview mode. Lightroom, PhotoCuller, and Photo Mechanic all have this. Provides context while viewing individual images. | Medium | HIGH |

---

## Anti-Features

Features to explicitly NOT build. These expand scope beyond the project's "lightweight culling tool" identity.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **RAW file processing** | Project constraint: pure JS, no native deps. RAW decoding requires heavy libraries (dcraw, LibRaw). Competitors like FastRawViewer are purpose-built for this. | Support JPG, PNG, WebP, TIFF, HEIC (via heic2any WASM). Photographers export JPGs from their camera or shoot RAW+JPEG. |
| **Image editing (crop, rotate, color correction)** | Scope creep. This is a culling tool, not an editor. ACDSee and XnView do this but are bloated as a result. | Provide "open in external editor" action to hand off to user's preferred tool. |
| **Catalog / database / library management** | Photo Mechanic and Lightroom have catalogs. We do not. Our value is zero-setup: open a folder, cull, done. A database adds complexity, import steps, and state to manage. | Folder-based only. Persist nothing between sessions (or minimal session state like window position). |
| **Cloud sync / upload** | Out of scope per project definition. Adds massive infrastructure complexity. FilterPixel does cloud culling -- we are the opposite. | Local-only. No network calls. No accounts. |
| **AI / ML-based culling** | Project constraint: no NIMA/ML models. Aftershoot, FilterPixel, Narrative Select own this space. Competing on AI is a losing battle for a lightweight tool. | Algorithmic quality scoring via Canvas pixel analysis (sharpness via Laplacian, exposure via histogram, noise via variance). |
| **Face detection / recognition** | Requires ML models (face-api.js, TensorFlow.js). Heavy, slow, and competes with Narrative Select's core differentiator. | Skip entirely. Focus peaking and quality scoring cover the technical assessment use case. |
| **Ingest from SD cards / memory cards** | PhotoCuller and Photo Mechanic have ingest workflows. Adds OS-level device detection, file copy management, and destination templating. | User opens a folder they already copied to disk. |
| **IPTC / XMP metadata editing** | Writing metadata requires sidecar file management and format-specific writing. PhotoCuller and Photo Mechanic do this well. | Read-only EXIF display. If users need metadata editing, they use a dedicated tool. |
| **Slideshow / presentation mode** | Feature of general photo viewers (XnView, ACDSee), not culling tools. | Not applicable to the culling workflow. |
| **Print / export / resize** | Feature of editors and DAMs. Culling tools pass files through untouched. | Files stay on disk as-is. User deletes rejects, keeps the rest. |
| **Plugin / extension system** | Premature architecture. Adds API surface and maintenance burden. | Ship core features well. Revisit if user demand materializes. |

---

## Feature Dependencies

```
T1 Thumbnail grid ──────────┐
                             ├──> T5 Multi-select + batch delete
T3 Keyboard navigation ─────┘

T2 Full-size preview ───────> T8 Zoom/pan
                        ├──> D5 Comparison view (requires preview rendering)
                        ├──> D6 Focus peaking (overlay on preview)
                        ├──> D7 Exposure warnings (overlay on preview)
                        ├──> D10 Loupe tool (floating zoom)
                        └──> D13 Filmstrip (thumbnail strip in preview mode)

T7 EXIF metadata display ──> D8 Histogram (uses same image data pipeline)

T4 Sort ────────────────────> D1 Quality scoring (adds "quality" as sort field)
T9 File type filtering ─────> (standalone, no deps)
T10 Filename search ────────> (standalone, no deps)

D2 Pick/reject flagging ───> D3 Color labels (same rating system)
                        └──> D4 Star ratings (same rating system)

D1 Quality scoring ─────────> D9 Auto-grouping (scoring pipeline feeds grouping)
```

**Critical path:** Grid view (T1) and Preview (T2) are foundations. Everything else layers on top of these two rendering engines.

---

## MVP Recommendation

### Must Ship (Phase 1)

These are the minimum features for a usable culling tool:

1. **T1** Thumbnail grid view (virtualized for performance)
2. **T2** Full-size preview / lightbox
3. **T3** Keyboard navigation (arrow keys, auto-advance)
4. **T4** Sort by filename, date, size
5. **T5** Multi-select and batch delete to OS trash
6. **T6** Fast performance at 1,000+ photos
7. **T7** EXIF metadata display
8. **T8** Zoom / pan in preview
9. **T9** File type filtering
10. **T10** Filename search
11. **T12** Native OS trash

### Should Ship (Phase 2) -- Core Culling UX

These transform it from a "file browser with delete" into a real culling tool:

1. **D2** Pick / reject flagging (P/X/U keys + auto-advance)
2. **D4** Star ratings (1-5 keys)
3. **D3** Color labels (6-9, 0 keys)
4. **D12** Dark theme (default)
5. **D13** Filmstrip in preview mode

### Should Ship (Phase 3) -- Quality Intelligence

The differentiating features that justify the product's existence:

1. **D1** Algorithmic quality scoring
2. **D6** Focus peaking overlay
3. **D7** Exposure warnings (highlight/shadow clipping)
4. **D8** Histogram display

### Nice to Have (Phase 4+)

Ship if time/demand permits:

1. **D5** Comparison / side-by-side view
2. **D10** Loupe / magnifier tool
3. **D9** Auto-grouping by burst/similarity
4. **D11** Customizable keyboard shortcuts

### Defer Indefinitely

Everything in the Anti-Features list. These are conscious boundaries, not a backlog.

---

## Feature Prioritization Matrix

| Feature | User Impact | Implementation Effort | Risk | Priority |
|---------|-------------|----------------------|------|----------|
| T1 Thumbnail grid | Critical | High (virtualization) | Medium (perf) | P0 |
| T2 Full-size preview | Critical | Medium | Low | P0 |
| T3 Keyboard navigation | Critical | Low | Low | P0 |
| T5 Batch delete | Critical | Medium (trash API) | Low | P0 |
| T6 Performance at scale | Critical | High (workers, virtualization) | High | P0 |
| T4 Sorting | High | Low | Low | P0 |
| T7 EXIF display | High | Low (exifr library) | Low | P0 |
| T8 Zoom/pan | High | Medium | Low | P0 |
| D2 Pick/reject flagging | High | Low-Medium | Low | P1 |
| D4 Star ratings | High | Low | Low | P1 |
| D3 Color labels | Medium | Low | Low | P1 |
| D1 Quality scoring | High (differentiator) | High | High (accuracy) | P2 |
| D6 Focus peaking | Medium | Medium | Medium (perf) | P2 |
| D7 Exposure warnings | Medium | Medium | Low | P2 |
| D8 Histogram | Medium | Medium | Low | P2 |
| D5 Comparison view | Medium | High | Medium | P3 |
| D13 Filmstrip | Medium | Medium | Low | P1 |
| D12 Dark theme | Low-Medium | Low | Low | P1 |
| D10 Loupe tool | Low-Medium | Medium | Low | P3 |
| D9 Auto-grouping | Low | High | High | P3 |
| D11 Custom shortcuts | Low | Medium | Low | P3 |

---

## Competitor Feature Matrix

| Feature | Lightroom | Photo Mechanic | FastRawViewer | PhotoCuller | XnView | **Our Tool** |
|---------|-----------|---------------|---------------|-------------|--------|-------------|
| Thumbnail grid | Yes | Yes | Yes | Yes | Yes | **Yes (P0)** |
| Full preview | Yes | Yes | Yes | Yes | Yes | **Yes (P0)** |
| Keyboard culling | P/X/U | Configurable | Yes | WASD+keys | Limited | **Yes (P1)** |
| Star ratings | 1-5 | 0-5 | 0-5 | Yes | No | **Yes (P1)** |
| Color labels | Yes | Yes | Yes | Yes | No | **Yes (P1)** |
| Pick/reject flags | Yes | Yes | No | Yes | No | **Yes (P1)** |
| Batch delete | Yes | Yes | Yes | Yes | Yes | **Yes (P0)** |
| EXIF display | Yes | Extensive | Yes | Yes | Yes | **Yes (P0)** |
| Zoom/100% view | Yes | Yes | Yes | Yes | Yes | **Yes (P0)** |
| Focus peaking | No | No | Yes | Yes | No | **Yes (P2)** |
| Exposure warnings | No | No | Yes | Yes | No | **Yes (P2)** |
| Histogram | Yes | No | Yes | Yes | No | **Yes (P2)** |
| Quality scoring | AI (v15+) | No | No | No | No | **Algorithmic (P2)** |
| Comparison view | Yes | No | No | Yes | No | **P3** |
| RAW support | Yes | Yes | Yes | Yes | Limited | **No** |
| Catalog/DB | Yes | No | No | No | No | **No** |
| AI culling | Yes (v15+) | No | No | No | No | **No** |
| Face detection | Yes | No | No | Yes | No | **No** |
| Image editing | Yes | No | No | No | Yes | **No** |
| Ingest from cards | Yes | Yes | No | Yes | No | **No** |
| Price | $10/mo | $139 | $25 | ~$30 | Free | **TBD** |
| Platforms | Mac/Win | Mac/Win | Mac/Win | Mac only | Mac/Win/Linux | **Mac/Win** |

**Key competitive insight:** PhotoCuller (launched Jan 2026) is the closest competitor to our vision -- folder-based, keyboard-driven, no catalog, fast. However it is macOS-only and supports RAW files. Our cross-platform support and zero-dependency approach are differentiators. Our algorithmic quality scoring would be unique in the lightweight culler tier -- no competitor in this tier offers automated quality assessment.

---

## Sources

- [FilterPixel - Best Photo Culling Software 2026](https://app.filterpixel.com/best-photo-culling-software) - Competitor comparison and testing data
- [Excire - Best Culling Software 2026](https://excire.com/en/best-culling-software/) - Market overview
- [PhotoCuller](https://www.photoculler.com/) - Feature list for closest competitor
- [Keeper Culling](https://keeperculling.com/) - Keyboard-first culling app features
- [Photo Mechanic Tour](https://home.camerabits.com/tour-photo-mechanic/) - Feature overview
- [FastRawViewer Review - Photography Life](https://photographylife.com/reviews/fastrawviewer) - RAW viewer feature analysis
- [Adobe Lightroom - Flag, Label, Rate Photos](https://helpx.adobe.com/lightroom-classic/help/flag-label-rate-photos.html) - Rating system reference
- [Narrative Select](https://narrative.so/select) - AI culling and face grouping features
- [Aftershoot - Photo Culling Workflow Guide](https://aftershoot.com/blog/photo-culling-workflow/) - Workflow pain points
- [The Phoblographer - PhotoCuller Review](https://www.thephoblographer.com/2026/02/27/this-software-is-faster-than-adobe-lightroom/) - Competitor speed claims
- [Imagen - Photography Workflow Software](https://imagen-ai.com/valuable-tips/photography-workflow-software/) - Photographer pain points
- [Aftershoot vs Photo Mechanic](https://aftershoot.com/blog/aftershoot-vs-photo-mechanic/) - Workflow comparison
