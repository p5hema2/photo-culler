# Photo Culler

## What This Is

A cross-platform desktop application (macOS + Windows) for browsing, reviewing, and culling photos. Users select a folder, view all images in a responsive grid layout, preview them full-size, and batch-delete unwanted shots — like a lightweight image library for photographers. Built as a Turborepo monorepo with Electron, React, and zero native dependencies.

## Core Value

Photographers can quickly browse a folder of photos, visually identify bad shots, and delete them in bulk — without importing into a heavy tool like Lightroom.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] User can select a folder via native OS dialog and see all images discovered
- [ ] User can view all images as a scrollable thumbnail grid that handles 1,000+ photos
- [ ] User can click a thumbnail to preview the full-size image with zoom and navigation
- [ ] User can multi-select images (click, Ctrl/Cmd+click, Shift+click) and batch-delete to OS trash
- [ ] User can sort images by filename, date taken, file size, and dimensions
- [ ] User can filter images by file type and search by filename
- [ ] Each image receives an automatic quality score (sharpness, exposure, noise, contrast)
- [ ] User can sort by quality score and auto-select images below a threshold
- [ ] App compiles to native installers for macOS (.dmg) and Windows (.exe)
- [ ] All dependencies are pure JS/TS — no native addons, no system requirements for dev or end users
- [ ] Project uses Turborepo monorepo with Prettier formatting

### Out of Scope

- Cloud storage / sync — this is a local-only tool
- Image editing (crop, rotate, color correction) — this is a culling tool, not an editor
- RAW file processing (CR2, NEF, ARW) — stick to standard formats (JPG, PNG, WebP, TIFF, HEIC)
- Mobile app — desktop only
- NIMA/ML-based aesthetic scoring — keep quality scoring algorithmic and pure JS
- Import/catalog system — no database, no library management, just open a folder

## Context

- Target users: event/club photographers who shoot 500-2,000 photos per session and need to quickly cull the bad ones
- The tool replaces the tedious process of scrolling through Finder/Explorer deleting photos one by one
- Zero system requirements is a hard constraint — `pnpm install` must never trigger native compilation (no node-gyp, no sharp, no Python/C++ build tools)
- Image processing (thumbnails, scoring) happens in the renderer process using browser-native Canvas API and Web Workers
- EXIF metadata via `exifr` (pure JS), HEIC decoding via `heic2any` (bundled WASM)

## Constraints

- **Tech stack**: Turborepo + Electron + React + TypeScript + Tailwind CSS + Prettier
- **Zero native deps**: Every dependency must be pure JS/TS or bundled WASM — no native Node.js addons
- **Cross-platform**: Must produce working installers for both macOS and Windows
- **Dev requirements**: Only Node.js 18+ and pnpm — nothing else to install
- **Performance**: Must handle folders with 1,000+ images without freezing (virtualized grid, Web Worker processing)
- **Package manager**: pnpm with workspaces

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Electron over Tauri | Mature ecosystem, better for image-heavy apps, simpler packaging | — Pending |
| Pure JS over sharp | Zero native deps constraint — canvas API + Web Workers for thumbnails | — Pending |
| PySide6 dropped for Electron | Cross-platform builds (macOS + Windows) with single codebase, Turborepo integration | — Pending |
| Turborepo monorepo | Shared packages (image-utils, ui, tsconfig), dependency-aware build pipelines | — Pending |
| Canvas-based quality scoring | No OpenCV/native deps — Laplacian approximation via getImageData pixel math in Web Worker | — Pending |
| send2trash → shell.trashItem | Electron's built-in API handles both macOS Trash and Windows Recycle Bin natively | — Pending |

---
*Last updated: 2026-03-14 after initialization*
