# Project Research Summary

**Project:** Photo Culler
**Domain:** Desktop photo culling application (Electron)
**Researched:** 2026-03-14
**Confidence:** HIGH

## Executive Summary

Photo Culler is a lightweight, folder-based desktop tool for quickly reviewing and deleting unwanted photos. The competitive landscape splits into AI-powered cullers (Aftershoot, FilterPixel), pro manual cullers (Photo Mechanic, PhotoCuller), and general browsers (XnView, ACDSee). This project targets the manual culler tier with a narrower scope: no RAW processing, no catalog, no cloud -- just "open folder, view photos, delete the bad ones." The closest competitor is PhotoCuller (macOS-only, launched Jan 2026). Cross-platform support and algorithmic quality scoring (unique in this tier) are the primary differentiators.

The recommended approach is Electron 41 + React 19 + TypeScript, built with electron-vite in a Turborepo monorepo. A hard constraint -- zero native Node.js addons -- eliminates sharp, better-sqlite3, and similar popular libraries, pushing all image processing to the browser's Canvas API and Web Workers using OffscreenCanvas. HEIC support comes via WASM-based decoders (heic2any or libheif-js). The architecture follows Electron's two-process model with typed IPC via contextBridge, a custom `app://` protocol for secure image loading, and a Web Worker pool for thumbnail generation and quality scoring.

The primary risks are: (1) renderer memory explosion when handling 1,000+ images (mitigated by virtualization, small thumbnails, and aggressive blob URL cleanup), (2) HEIC decoding being 10-50x slower than native (mitigated by caching, progress UI, and lazy decoding), (3) shell.trashItem cross-platform bugs (mitigated by per-file error handling and path normalization), and (4) electron-builder monorepo packaging complexity (mitigated by getting packaging working in Phase 0 before writing features). Every one of these risks has well-documented solutions; none should be surprising if addressed upfront.

## Key Findings

### Recommended Stack

The stack is entirely pure JS/TS/WASM with no native addons. Electron 41 (Chromium 134, Node 22) provides the desktop shell. React 19 with Zustand for state management handles the UI. electron-vite 5 provides fast HMR and unified builds for main/preload/renderer. Turborepo with pnpm workspaces orchestrates the monorepo. All image processing uses browser-native Canvas API and Web Workers rather than server-side libraries.

**Core technologies:**
- **Electron 41**: Desktop shell -- mature, built-in trash/dialog APIs, ships Chromium + Node.js
- **React 19 + Zustand 5**: UI and state -- concurrent rendering for smooth scrolling, centralized store for interconnected state (selections, scores, sort, filters)
- **electron-vite 5**: Build tooling -- purpose-built for Electron's three-process model, 100ms HMR
- **@tanstack/react-virtual 3**: Virtualized grid -- headless, variable-size support, 60fps scrolling at 1,000+ items
- **exifr + heic2any/libheif-js**: Image metadata and HEIC decoding -- pure JS/WASM, no native deps
- **Canvas API + Web Workers**: Thumbnail generation and quality scoring -- browser-native, parallel processing via OffscreenCanvas
- **electron-builder 26**: Packaging -- DMG/NSIS output, auto-update support, monorepo-compatible with proper config
- **Turborepo + pnpm 10**: Monorepo orchestration -- cached builds, strict dependency isolation

### Expected Features

**Must have (table stakes):**
- T1: Virtualized thumbnail grid (the core browsing interface)
- T2: Full-size preview with T8: zoom/pan (judging sharpness requires 100% view)
- T3: Keyboard navigation with auto-advance
- T4: Sort by filename, date taken (EXIF), file size
- T5: Multi-select and batch delete to OS trash (the core value proposition)
- T6: Fast performance at 1,000+ images (Photo Mechanic's entire brand is speed)
- T7: EXIF metadata display (camera, lens, exposure settings)
- T9/T10: File type filtering and filename search

**Should have (differentiators -- ship in Phase 2-3):**
- D2: Pick/reject flagging with P/X/U keys and auto-advance (core culling UX loop)
- D4/D3: Star ratings (1-5) and color labels (Lightroom-standard workflow)
- D1: Algorithmic quality scoring -- blur, exposure, noise detection via Canvas pixel math (unique in lightweight culler tier)
- D6/D7: Focus peaking overlay and exposure clipping warnings
- D8: Histogram display
- D13: Filmstrip navigation in preview mode
- D12: Dark theme (photographer preference for color accuracy)

**Defer (v2+):**
- D5: Side-by-side comparison view (high complexity, high value but not essential for launch)
- D9: Auto-grouping by burst/similarity (high complexity, low confidence in implementation approach)
- D10: Loupe/magnifier tool
- D11: Customizable keyboard shortcuts

**Explicit anti-features (never build):** RAW processing, image editing, catalog/database, cloud sync, AI/ML culling, face detection, IPTC/XMP writing, ingest from cards, plugin system.

### Architecture Approach

The app uses Electron's two-process model with strict security boundaries. The main process handles OS interactions (file dialogs, directory scanning, trash). The renderer process runs the React UI. A typed IPC bridge via contextBridge is the only communication channel. A custom `app://` protocol serves local images securely without disabling webSecurity. Heavy image work runs in a Web Worker pool (2-4 workers matching CPU cores) using OffscreenCanvas. The Turborepo monorepo splits into `apps/desktop` (Electron app), `packages/types` (shared IPC types), `packages/image-utils` (pure JS scoring/thumbnail algorithms), and shared config packages.

**Major components:**
1. **Main Process** -- Window management, file system service (scan, stat, trash), custom protocol handler
2. **IPC Bridge (Preload)** -- contextBridge with typed, whitelisted API functions; no raw ipcRenderer exposure
3. **React UI (Renderer)** -- Virtualized grid, full-size preview, toolbar, sort/filter; Zustand store for app state
4. **Web Worker Pool** -- Thumbnail generation, quality scoring, EXIF extraction; OffscreenCanvas for parallel processing
5. **@repo/image-utils** -- Pure JS/TS algorithms for scoring and thumbnails; testable without Electron

### Critical Pitfalls

1. **Memory explosion with large image sets** -- Loading 1,000+ full-res images crashes the renderer (72MB per decoded 24MP image). Prevent with: virtualization from day one, 300px thumbnails via Canvas, aggressive URL.revokeObjectURL() cleanup, explicit img width/height attributes.
2. **HEIC decoding is painfully slow** -- WASM-based HEIC decoding takes 2-5 seconds per image. A folder of 500 iPhone photos would take 15-40 minutes without mitigation. Prevent with: cached JPEG conversions in temp dir, background decoding with progress UI, tiny initial thumbnails (200px).
3. **shell.trashItem cross-platform bugs** -- Documented failures on Windows with OneDrive paths, forward-slash paths, and certain Windows 10 configs. Prevent with: path.normalize() before every call, per-file try/catch, permanent-delete fallback with user warning.
4. **IPC serialization bottleneck** -- Sending 1,000+ file metadata entries in one IPC message blocks the main process for hundreds of milliseconds. Prevent with: stream results in batches of 50-100, keep image data in renderer process, use async invoke/handle exclusively.
5. **electron-builder monorepo packaging** -- electron-builder was designed for single-package projects and fights pnpm symlinks. Prevent with: bundle renderer output via Vite before packaging, explicit `files` config, test packaging in Phase 0.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 0: Project Scaffold and Electron Shell
**Rationale:** Architecture research identifies monorepo packaging (Pitfall 6) and security defaults (Pitfall 12) as issues that compound if deferred. electron-vite expects a specific directory structure. Get the foundation right first.
**Delivers:** Working Electron app that opens a window, loads a React hello world, registers the `app://` custom protocol, and packages into a .dmg/.exe. Turborepo pipeline with build/dev/test/lint tasks. Typed IPC bridge with contextBridge. Shared `@repo/types` and `@repo/tsconfig` packages.
**Addresses:** T11 (cross-platform foundation)
**Avoids:** Pitfall 6 (monorepo packaging -- validate it works before adding features), Pitfall 12 (security defaults -- correct from the start)

### Phase 1: Folder Scanning and Thumbnail Grid
**Rationale:** The thumbnail grid (T1) is the foundation for every other feature. Architecture research shows all features layer on top of the grid and preview rendering. The Web Worker pipeline must be designed here -- retrofitting it later is painful.
**Delivers:** Folder picker, directory scanning with batched IPC, virtualized thumbnail grid using @tanstack/react-virtual, Web Worker pool for thumbnail generation, basic keyboard navigation.
**Addresses:** T1 (thumbnail grid), T3 (keyboard navigation), T6 (performance), T9 (file type filtering), T10 (filename search), partial T4 (sort by name/size)
**Avoids:** Pitfall 1 (memory explosion -- virtualize from day one), Pitfall 5 (IPC bottleneck -- stream in batches), Pitfall 7 (path handling -- use path.join everywhere), Pitfall 9 (worker lifecycle -- design pool architecture upfront)

### Phase 2: Preview, Selection, and Delete
**Rationale:** Preview (T2) and delete (T5) complete the core value proposition: "open folder, view photos, delete bad ones." These depend on the grid and IPC from Phase 1.
**Delivers:** Full-size image preview with zoom/pan, multi-select (click, Shift+click, Cmd/Ctrl+click), batch delete to OS trash with error handling, EXIF metadata panel.
**Addresses:** T2 (preview), T5 (batch delete), T7 (EXIF display), T8 (zoom/pan), T12 (OS trash)
**Avoids:** Pitfall 3 (shell.trashItem failures -- per-file error handling, path normalization)

### Phase 3: Culling Workflow (Flags, Ratings, Sort)
**Rationale:** Pick/reject flagging is the core UX loop that transforms this from a "file browser with delete" into a real culling tool. Color labels and star ratings share the same rating system architecture and should ship together. EXIF-based date sorting belongs here.
**Delivers:** Pick/reject flagging (P/X/U keys) with auto-advance, star ratings (1-5), color labels, sort by date taken (EXIF DateTimeOriginal), filmstrip in preview mode, dark theme.
**Addresses:** D2 (pick/reject), D3 (color labels), D4 (star ratings), D12 (dark theme), D13 (filmstrip), complete T4 (sort by date taken)
**Avoids:** Pitfall 11 (date sorting via mtime -- use EXIF DateTimeOriginal)

### Phase 4: Quality Intelligence
**Rationale:** Algorithmic quality scoring is the key differentiator (no competitor in this tier offers it). It depends on the Web Worker pipeline from Phase 1 and extends it with scoring algorithms. Focus peaking, exposure warnings, and histogram share the same pixel analysis pipeline.
**Delivers:** Quality scoring (sharpness, exposure, noise, contrast), sort-by-quality, focus peaking overlay, exposure clipping indicators, histogram display.
**Addresses:** D1 (quality scoring), D6 (focus peaking), D7 (exposure warnings), D8 (histogram)
**Avoids:** Pitfall 2 (Canvas getImageData memory leaks -- downsample before analysis, null references, batch with yields)

### Phase 5: HEIC Support and Polish
**Rationale:** HEIC support is critical for iPhone users but is architecturally complex and slow. Deferring it to a dedicated phase allows focused performance tuning. This phase also handles thumbnail caching for repeat folder opens.
**Delivers:** HEIC decoding via heic2any/libheif-js with progress UI, decoded JPEG caching in temp directory, thumbnail cache with mtime-based invalidation.
**Addresses:** HEIC subset of T1/T2 (viewing iPhone photos), performance optimization
**Avoids:** Pitfall 4 (HEIC decoding speed -- cache, progress UI, lazy decode), Pitfall 10 (thumbnail cache invalidation)

### Phase 6: Packaging and Distribution
**Rationale:** While Phase 0 validates that packaging works, this phase handles production-grade builds: code signing, notarization, auto-updates, CI/CD pipeline. Deferred here because the app needs to be feature-complete enough to distribute.
**Delivers:** Signed .dmg (macOS) and signed .exe (Windows), auto-update via GitHub Releases, CI/CD build pipeline, native addon detection in CI.
**Addresses:** T11 (cross-platform distribution)
**Avoids:** Pitfall 8 (code signing/notarization blocking distribution)

### Phase Ordering Rationale

- **Phase 0 before everything**: Monorepo packaging issues compound with every dependency added. Validating the build pipeline with a hello-world app prevents weeks of debugging later.
- **Phase 1 before Phase 2**: The grid is the foundation for selection and preview. The Web Worker pool is the foundation for quality scoring. Both must exist before downstream features.
- **Phase 2 before Phase 3**: Delete to trash is the core value proposition. Users need to be able to cull before they need star ratings.
- **Phase 3 before Phase 4**: The culling workflow (flags, ratings) is more universally useful than quality scoring. Most photographers cull manually; scoring is a power feature.
- **Phase 5 as a dedicated phase**: HEIC decoding is slow, fragile, and requires dedicated performance tuning. Mixing it into Phase 1 would slow down the core grid development. Many photographers shoot RAW+JPEG, so HEIC is not blocking for all users.
- **Phase 6 last**: Signing and auto-update are distribution concerns, not functionality. Phase 0 validates that packaging works; Phase 6 makes it production-ready.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1:** Web Worker pool design and thumbnail pipeline architecture -- the queue/priority system for visible-first loading needs careful design
- **Phase 4:** Quality scoring algorithms -- sharpness detection via Laplacian variance, exposure analysis via histograms, noise estimation need prototyping and calibration against real photographer expectations
- **Phase 5:** HEIC decoder benchmarking -- heic2any vs libheif-js performance characteristics need empirical testing with real iPhone photo sets

Phases with standard patterns (skip research-phase):
- **Phase 0:** Turborepo + electron-vite + electron-builder scaffolding is well-documented with reference repos (turbotron, yerba)
- **Phase 2:** Preview/zoom/pan and multi-select are standard UI patterns with extensive React examples
- **Phase 3:** Rating/flagging systems are straightforward state management; Lightroom's UX is the established pattern to follow
- **Phase 6:** electron-builder signing and CI/CD are well-documented

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All technologies are mature, well-documented, and version-pinned. Hard constraint (no native addons) is well-understood and alternatives are verified. |
| Features | HIGH | Competitor landscape is thoroughly mapped. Feature prioritization aligns with established culling tool patterns (Lightroom, Photo Mechanic, PhotoCuller). |
| Architecture | HIGH | Electron two-process model with typed IPC is official best practice. Web Worker pipeline for image processing is well-documented. Only MEDIUM confidence on electron-vite vs Electron Forge (chose electron-vite for pragmatic reasons). |
| Pitfalls | HIGH | All critical pitfalls reference specific Electron GitHub issues, Chromium bug trackers, or documented API limitations. Prevention strategies are concrete. |

**Overall confidence:** HIGH

### Gaps to Address

- **HEIC decoder choice**: heic2any vs libheif-js needs empirical benchmarking with real photo sets before committing. Both are MEDIUM confidence. Plan a spike in Phase 5.
- **Quality scoring accuracy**: The Canvas-based pixel analysis approach (Laplacian for sharpness, histogram for exposure) is sound in theory but needs calibration against real photographer expectations. May need user-adjustable thresholds. Plan a prototype spike in Phase 4.
- **react-virtuoso vs @tanstack/react-virtual**: Architecture research mentions react-virtuoso (VirtuosoGrid) while Stack research recommends @tanstack/react-virtual. Both are viable. Decide during Phase 1 planning based on grid layout requirements (variable-height rows may favor one over the other).
- **Electron 41 + electron-vite 5 compatibility**: Both are very recent releases. Verify compatibility during Phase 0 scaffold. If issues arise, Electron 40 + electron-vite 4 is the fallback.
- **Windows testing**: Multiple pitfalls (path handling, shell.trashItem, OneDrive) require real Windows testing. Establish a Windows test environment by Phase 1 at the latest.

## Sources

### Primary (HIGH confidence)
- [Electron official documentation](https://www.electronjs.org/docs/) -- IPC, process model, security, protocol, shell API
- [Electron GitHub Issues](https://github.com/electron/electron/issues) -- shell.trashItem bugs (#29598, #38541, #28029, #28831), memory limits (#31330), IPC performance (#1948, #7286)
- [Electron Releases](https://releases.electronjs.org/) -- version 41.0.2 confirmation
- [TanStack Virtual documentation](https://tanstack.com/virtual/latest) -- virtualization API
- [Zustand documentation](https://zustand.docs.pmnd.rs/) -- state management patterns
- [Turborepo documentation](https://turborepo.dev/docs) -- monorepo structure and pipeline config
- [electron-vite documentation](https://electron-vite.org/) -- build tooling for Electron
- [MDN Web Docs -- OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas) -- Web Worker image processing

### Secondary (MEDIUM confidence)
- [FilterPixel, Excire competitor reviews](https://app.filterpixel.com/best-photo-culling-software) -- feature landscape and market positioning
- [PhotoCuller product page](https://www.photoculler.com/) -- closest competitor feature set
- [exifr npm page](https://www.npmjs.com/package/exifr) -- EXIF parsing performance claims
- [heic2any](https://www.npmjs.com/package/heic2any) / [libheif-js](https://www.npmjs.com/package/libheif-js) -- HEIC decoding options
- [electron-builder documentation](https://www.electron.build/) -- packaging configuration
- [turbotron](https://github.com/ntwigs/turbotron) / [yerba](https://github.com/t3dotgg/yerba) -- reference monorepo implementations

### Tertiary (LOW confidence)
- HEIC decoding performance numbers (2-5s per image) -- based on community reports, needs empirical validation
- Quality scoring algorithm accuracy -- theoretical approach, needs prototype validation
- Auto-grouping by burst/similarity (D9) -- low confidence on implementation approach, deferred

---
*Research completed: 2026-03-14*
*Ready for roadmap: yes*
