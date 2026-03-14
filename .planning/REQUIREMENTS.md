# Requirements: Photo Culler

**Defined:** 2026-03-14
**Core Value:** Photographers can quickly browse a folder of photos, visually identify bad shots, and delete them in bulk

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Infrastructure

- [x] **INFRA-01**: Project uses Turborepo monorepo with pnpm workspaces and shared packages
- [x] **INFRA-02**: All dependencies are pure JS/TS or bundled WASM — no native Node.js addons
- [x] **INFRA-03**: Prettier formats all code with a single `pnpm format` command
- [x] **INFRA-04**: ESLint enforces code quality across all packages
- [x] **INFRA-05**: Electron app launches via `pnpm dev` with hot module reload
- [x] **INFRA-06**: Custom `app://` protocol serves local images securely (no webSecurity disable)
- [x] **INFRA-07**: Typed IPC bridge via contextBridge — renderer never accesses Node.js directly

### Browsing

- [ ] **BROW-01**: User can select a folder via native OS dialog (Cmd+O / Ctrl+O)
- [ ] **BROW-02**: User can view all images (JPG, JPEG, PNG, TIFF, WebP) as a scrollable thumbnail grid
- [ ] **BROW-03**: Thumbnail grid handles 1,000+ images without UI freezes (virtualized scrolling)
- [ ] **BROW-04**: Thumbnails load progressively via Web Workers — grid is immediately scrollable
- [ ] **BROW-05**: User can navigate thumbnails with arrow keys
- [ ] **BROW-06**: User can sort images by filename, date taken, file size, and dimensions
- [ ] **BROW-07**: User can filter images by file type (JPG, PNG, etc.)
- [ ] **BROW-08**: User can search images by filename (instant client-side filter)

### Preview

- [ ] **PREV-01**: User can click a thumbnail to see a full-size preview
- [ ] **PREV-02**: User can zoom in preview: fit-to-window, 100%, scroll-to-zoom
- [ ] **PREV-03**: User can pan when zoomed in
- [ ] **PREV-04**: User can navigate between images with arrow keys in preview mode
- [ ] **PREV-05**: User can view EXIF metadata: camera, lens, aperture, shutter speed, ISO, date taken
- [ ] **PREV-06**: User can press Escape to return to grid view
- [ ] **PREV-07**: User can view a filmstrip (horizontal thumbnail strip) in preview mode

### Selection & Deletion

- [ ] **DEL-01**: User can click to select a single image (visual highlight)
- [ ] **DEL-02**: User can Ctrl/Cmd+Click to toggle selection, Shift+Click for range select
- [ ] **DEL-03**: User can select all images with Ctrl+A / Cmd+A
- [ ] **DEL-04**: User can see selection count in toolbar: "12 of 42 selected"
- [ ] **DEL-05**: User can delete selected images via Delete key or toolbar button
- [ ] **DEL-06**: Deleted images move to OS trash (macOS Trash / Windows Recycle Bin) — never permanent delete
- [ ] **DEL-07**: User sees confirmation dialog before deletion: "Move 12 images to Trash?"
- [ ] **DEL-08**: Deleted images are removed from grid immediately after confirmation

### Culling Workflow

- [ ] **CULL-01**: User can flag images as Pick (P key), Reject (X key), or Unflag (U key)
- [ ] **CULL-02**: After flagging, preview auto-advances to next image
- [ ] **CULL-03**: User can rate images 1-5 stars using number keys
- [ ] **CULL-04**: User can assign color labels (red, yellow, green, blue, purple) via keyboard
- [ ] **CULL-05**: User can filter grid to show only picks, rejects, unflagged, or specific star ratings

### Quality Scoring

- [ ] **QUAL-01**: Each image receives an automatic quality score (0-100) based on sharpness, exposure, noise, and contrast
- [ ] **QUAL-02**: Quality scores display as color-coded badges on thumbnails (green ≥ 60, yellow 35-59, red < 35)
- [ ] **QUAL-03**: User can sort images by quality score
- [ ] **QUAL-04**: User can auto-select images below a quality threshold for batch deletion
- [ ] **QUAL-05**: Quality scoring runs in background Web Workers — badges appear progressively
- [ ] **QUAL-06**: User can view focus peaking overlay (highlights in-focus areas) in preview
- [ ] **QUAL-07**: User can view exposure clipping warnings (blown highlights / crushed shadows) in preview
- [ ] **QUAL-08**: User can view an RGB histogram for the selected image

### Distribution

- [ ] **DIST-01**: App compiles to a macOS `.dmg` installer (Intel + Apple Silicon)
- [ ] **DIST-02**: App compiles to a Windows `.exe` installer
- [ ] **DIST-03**: End users have zero system requirements — download, install, run
- [ ] **DIST-04**: CI pipeline builds and tests on both macOS and Windows runners

### UX Polish

- [ ] **UX-01**: App remembers last opened folder across sessions
- [ ] **UX-02**: User can drag-and-drop a folder onto the window to open it
- [ ] **UX-03**: App supports dark theme (default) and light theme toggle
- [ ] **UX-04**: App handles edge cases gracefully: empty folders, corrupted images, permission errors
- [ ] **UX-05**: User can adjust thumbnail size (small / medium / large grid)

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Advanced Viewing

- **VIEW-01**: User can view two images side-by-side with synchronized zoom/pan
- **VIEW-02**: User can use a loupe/magnifier tool for quick focus checking without full zoom
- **VIEW-03**: User can customize keyboard shortcuts

### Advanced Organization

- **ORG-01**: User can auto-group images by burst/similarity
- **ORG-02**: App persists flags/ratings between sessions for a folder (e.g., via JSON sidecar)

### HEIC Support

- **HEIC-01**: User can view HEIC files (iPhone photos) in grid and preview
- **HEIC-02**: HEIC decoding happens progressively with progress indicator
- **HEIC-03**: Decoded HEIC images are cached to disk for fast re-opens

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| RAW file processing (CR2, NEF, ARW) | Requires native libraries (LibRaw/dcraw) — violates zero-native-deps constraint |
| Image editing (crop, rotate, color) | Scope creep — this is a culling tool, not an editor |
| Catalog / database / library management | Value is zero-setup folder browsing — catalogs add complexity and import steps |
| Cloud sync / upload | Local-only tool — no network calls, no accounts |
| AI / ML-based culling | Violates constraint (no NIMA/ML models) — competitors own this space |
| Face detection / recognition | Requires ML models — competitors (Narrative Select) own this |
| Ingest from SD cards | Adds OS-level device detection — user copies files to disk first |
| IPTC / XMP metadata writing | Read-only EXIF — metadata editing is a separate tool's job |
| Plugin / extension system | Premature architecture — ship core features well first |
| Slideshow / presentation mode | Not relevant to culling workflow |
| Print / export / resize | Feature of editors — culling tools pass files through untouched |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01 | Phase 1 | Complete |
| INFRA-02 | Phase 1 | Complete |
| INFRA-03 | Phase 1 | Complete |
| INFRA-04 | Phase 1 | Complete |
| INFRA-05 | Phase 1 | Pending |
| INFRA-06 | Phase 1 | Pending |
| INFRA-07 | Phase 1 | Pending |
| DIST-01 | Phase 1 | Pending |
| DIST-02 | Phase 1 | Pending |
| DIST-03 | Phase 1 | Pending |
| DIST-04 | Phase 1 | Pending |
| BROW-01 | Phase 2 | Pending |
| BROW-02 | Phase 2 | Pending |
| BROW-03 | Phase 2 | Pending |
| BROW-04 | Phase 2 | Pending |
| BROW-05 | Phase 2 | Pending |
| BROW-06 | Phase 2 | Pending |
| BROW-07 | Phase 2 | Pending |
| BROW-08 | Phase 2 | Pending |
| UX-01 | Phase 2 | Pending |
| UX-02 | Phase 2 | Pending |
| UX-04 | Phase 2 | Pending |
| UX-05 | Phase 2 | Pending |
| PREV-01 | Phase 3 | Pending |
| PREV-02 | Phase 3 | Pending |
| PREV-03 | Phase 3 | Pending |
| PREV-04 | Phase 3 | Pending |
| PREV-05 | Phase 3 | Pending |
| PREV-06 | Phase 3 | Pending |
| PREV-07 | Phase 3 | Pending |
| DEL-01 | Phase 3 | Pending |
| DEL-02 | Phase 3 | Pending |
| DEL-03 | Phase 3 | Pending |
| DEL-04 | Phase 3 | Pending |
| DEL-05 | Phase 3 | Pending |
| DEL-06 | Phase 3 | Pending |
| DEL-07 | Phase 3 | Pending |
| DEL-08 | Phase 3 | Pending |
| UX-03 | Phase 3 | Pending |
| CULL-01 | Phase 4 | Pending |
| CULL-02 | Phase 4 | Pending |
| CULL-03 | Phase 4 | Pending |
| CULL-04 | Phase 4 | Pending |
| CULL-05 | Phase 4 | Pending |
| QUAL-01 | Phase 4 | Pending |
| QUAL-02 | Phase 4 | Pending |
| QUAL-03 | Phase 4 | Pending |
| QUAL-04 | Phase 4 | Pending |
| QUAL-05 | Phase 4 | Pending |
| QUAL-06 | Phase 4 | Pending |
| QUAL-07 | Phase 4 | Pending |
| QUAL-08 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 52 total
- Mapped to phases: 52
- Unmapped: 0

---
*Requirements defined: 2026-03-14*
*Last updated: 2026-03-14 after roadmap creation*
