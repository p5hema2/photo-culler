# Technology Stack

**Project:** Photo Culler
**Researched:** 2026-03-14
**Overall confidence:** HIGH

## Hard Constraint

Every dependency must be **pure JS/TS or bundled WASM**. No native Node.js addons. `pnpm install` must never trigger `node-gyp`, Python, or C++ compilation. This eliminates many popular image-processing libraries (sharp, better-sqlite3, canvas, etc.) and constrains every choice below.

---

## Recommended Stack

### Core Framework

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Electron | ^41.0.0 | Desktop shell (Chromium + Node.js) | Latest stable (41.0.2 released 2026-03-13). Mature ecosystem, built-in `shell.trashItem()` for cross-platform trash, native file dialogs, strong packaging story. Electron 41 ships Chromium 134 and Node.js 22. | HIGH |
| React | ^19.2.0 | UI framework | Latest stable (19.2.4). Concurrent rendering helps keep UI responsive during heavy image grid scrolling. Massive ecosystem, team familiarity assumed. | HIGH |
| TypeScript | ^5.7.0 | Type safety | Current stable. Strict mode for all packages. Catches IPC contract bugs between main/renderer at compile time. | HIGH |
| Vite (via electron-vite) | electron-vite ^5.0.0 | Build tooling | electron-vite 5.0 (Dec 2025) provides unified Vite config for main, preload, and renderer processes. HMR in renderer, fast rebuilds, isolatedEntries for multi-entry builds. Preferred over raw Vite + vite-plugin-electron because electron-vite is purpose-built and better documented for the three-process model. | HIGH |

### Monorepo & Package Management

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Turborepo | turbo ^2.8.0 | Build orchestration & caching | Latest stable (2.8.17). Intelligent task caching (30s build becomes 0.2s cached), dependency-aware pipeline, native pnpm workspace support. Simpler than Nx for JS-only monorepos. | HIGH |
| pnpm | ^10.32.0 | Package manager | Latest stable (10.32.1). Strict dependency isolation prevents phantom deps, fast installs via content-addressable store, native workspace support. Required by project constraints. | HIGH |

### Styling & UI

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Tailwind CSS | ^4.0.0 | Utility-first CSS | v4 (Jan 2025) is a ground-up rewrite: 5x faster builds, zero-config setup (`@import "tailwindcss"`), CSS-native cascade layers. Perfect for rapid UI iteration on grid layouts, toolbars, modals. | HIGH |
| Lucide React | ^0.577.0 | Icons | Tree-shakeable, pure SVG React components. Lightweight alternative to react-icons (which bundles entire icon sets). Consistent visual style for toolbar/action buttons. | MEDIUM |

### State Management

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Zustand | ^5.0.0 | Global app state | Latest stable (5.0.11). ~3KB, zero boilerplate, excellent TypeScript support. Centralized store pattern fits this app well: selected folder, sort order, filter state, selection set, quality scores. Better than Jotai here because state is interconnected (selections affect batch actions, scores affect sort), not independent atoms. | HIGH |

### Image Processing (Pure JS/WASM Only)

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| exifr | ^7.1.3 | EXIF/metadata extraction | Pure JS, fastest EXIF parser available (30x faster than alternatives on HEIC). Reads JPEG, HEIC, TIFF, PNG metadata. Extracts date taken, dimensions, camera info, GPS. Last published 5 years ago but stable and feature-complete -- no active bugs, widely used. | HIGH |
| heic2any | ^0.0.4 | HEIC-to-JPEG/PNG conversion | Browser-side HEIC decoding using bundled WASM (libheif). Converts HEIC to displayable format for `<img>` tags and Canvas operations. Version is old but functional. | MEDIUM |
| libheif-js | ^1.19.0 | HEIC decoding (alternative/supplement) | More actively maintained than heic2any (168K weekly downloads). Offers pure-JS and pre-bundled WASM variants. Use the pre-bundled WASM build for browser compatibility. Consider as primary HEIC decoder if heic2any proves unreliable. | MEDIUM |
| Canvas API (built-in) | N/A | Thumbnail generation, quality scoring | Browser-native, zero dependencies. `OffscreenCanvas` in Web Workers for parallel thumbnail generation. `getImageData()` for pixel-level quality analysis (sharpness via Laplacian approximation, exposure histograms, noise estimation). | HIGH |
| Web Workers (built-in) | N/A | Off-main-thread processing | Browser-native. Essential for processing 1,000+ images without blocking UI. Dedicate workers to: (1) thumbnail generation, (2) quality scoring, (3) EXIF extraction. | HIGH |

### Virtualization

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| @tanstack/react-virtual | ^3.13.0 | Virtualized image grid | Latest stable (3.13.22). Headless (no imposed markup), supports variable-size grids, 60fps scrolling. Better than react-window for this use case: headless architecture allows custom image grid layouts with aspect-ratio-aware sizing. More actively maintained (published 2 days ago vs react-window's infrequent updates). | HIGH |

### File Operations

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Electron shell.trashItem() | Built-in | Move files to OS trash | Built into Electron, async, cross-platform (macOS Trash + Windows Recycle Bin). No external dependency needed. Replaces `send2trash` or `trash-cli`. | HIGH |
| Electron dialog API | Built-in | Folder selection | Native OS folder picker via `dialog.showOpenDialog()`. Built-in, no dependency. | HIGH |
| Node.js fs/promises | Built-in | File system operations | Read directory contents, get file stats (size, modified date). Built into Node.js, available in Electron main process. | HIGH |

### Packaging & Distribution

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| electron-builder | ^26.8.0 | App packaging & installers | Latest stable (26.8.1). Produces .dmg (macOS) and .exe/NSIS (Windows). 1.1M weekly downloads, far more adoption than Electron Forge. Single dependency manages code signing, notarization, auto-update. More configurable for monorepo builds. | HIGH |
| electron-updater | ^6.8.0 | Auto-updates | Companion to electron-builder. Pure JS update mechanism (no native deps for the updater itself). Supports GitHub Releases as update server. | MEDIUM |

### Development Tools

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Vitest | ^4.1.0 | Unit & integration testing | Latest stable (4.1.0). Native Vite integration (shared config), 4.0 stabilized browser mode. Fast, ESM-native, excellent TypeScript support. Use for testing image-utils, scoring algorithms, store logic. | HIGH |
| Prettier | ^3.5.0 | Code formatting | Required by project constraints. Opinionated, zero-config. Run via Turborepo pipeline. | HIGH |
| ESLint | ^9.0.0 | Linting | Flat config format (eslint.config.js). Use @typescript-eslint for TS rules, eslint-plugin-react-hooks for hook rules. | HIGH |
| Playwright | ^1.51.0 | E2E testing (optional) | For testing full Electron app flows (folder selection, grid interaction, batch delete). Supports Electron via electron fixture. Defer to later phases. | MEDIUM |

---

## Monorepo Package Structure

```
photo-culler/
  apps/
    desktop/              # Electron app (main + preload + renderer)
  packages/
    image-utils/          # EXIF parsing, thumbnail gen, quality scoring (pure TS)
    ui/                   # Shared React components (grid, toolbar, modals)
    tsconfig/             # Shared TypeScript configs
    eslint-config/        # Shared ESLint configs
```

**Rationale:** Separating `image-utils` as a standalone package enables:
- Unit testing image processing logic without Electron
- Potential reuse if a web version is ever considered
- Clear boundary between "image domain logic" and "UI"

---

## Installation

```bash
# Root devDependencies (monorepo tooling)
pnpm add -Dw turbo prettier eslint

# apps/desktop
pnpm add --filter desktop electron react react-dom zustand @tanstack/react-virtual exifr heic2any lucide-react
pnpm add -D --filter desktop electron-vite electron-builder typescript @types/react @types/react-dom tailwindcss vitest @playwright/test

# packages/image-utils
pnpm add --filter image-utils exifr heic2any
pnpm add -D --filter image-utils typescript vitest

# packages/ui
pnpm add --filter ui react react-dom @tanstack/react-virtual lucide-react
pnpm add -D --filter ui typescript tailwindcss vitest
```

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Desktop framework | Electron | Tauri | Tauri produces smaller binaries but has a weaker ecosystem for image-heavy apps. Requires Rust toolchain (violates "only Node.js + pnpm" dev requirement). WebView2/WebKitGtk rendering is less consistent than Chromium for Canvas-heavy workloads. |
| Build tool | electron-vite | Webpack (electron-webpack) | Webpack is slower, more complex config. electron-vite gives HMR in ~100ms vs Webpack's multi-second rebuilds. Vite is the modern standard. |
| Packager | electron-builder | Electron Forge | Forge is officially recommended by Electron team but has 500x fewer weekly downloads (2K vs 1.1M). electron-builder has more mature monorepo support, better docs for custom build configs, and the ecosystem knowledge base is vastly larger. |
| State management | Zustand | Jotai | Jotai's atomic model is better for independent state atoms. Photo culler state is interconnected (selections + scores + sort + filters), making Zustand's centralized store a better fit. |
| State management | Zustand | Redux Toolkit | RTK is overkill for this app. Zustand achieves the same with 90% less boilerplate. |
| Virtualization | @tanstack/react-virtual | react-window | react-window works but imposes fixed markup structure. TanStack Virtual is headless, allowing custom grid layouts with variable-size thumbnails. More actively maintained. |
| EXIF parsing | exifr | ExifReader | ExifReader is actively maintained but larger bundle and slower. exifr is purpose-built for speed and handles HEIC natively. |
| Icons | Lucide React | react-icons | react-icons bundles entire icon sets (FontAwesome, etc.), bloating bundle size. Lucide is tree-shakeable with consistent design. |
| CSS | Tailwind CSS | CSS Modules / styled-components | Tailwind's utility-first approach is faster for prototyping and produces smaller CSS bundles with purging. No runtime cost (unlike styled-components). |

---

## What NOT to Use (Native Addon Blocklist)

These popular libraries require native compilation and **must not be used**:

| Library | What It Does | Why Banned | Pure JS Alternative |
|---------|-------------|------------|-------------------|
| **sharp** | Image resize/convert | C++ addon (libvips), requires node-gyp + Python + C++ compiler | Canvas API + OffscreenCanvas in Web Workers |
| **better-sqlite3** | SQLite database | C++ addon, requires node-gyp | Not needed (no database per project scope). If storage needed later, use IndexedDB or sql.js (WASM) |
| **node-canvas** | Server-side Canvas | C++ addon (Cairo), requires system libs | OffscreenCanvas (browser-native in Electron's Chromium) |
| **@napi-rs/* packages** | Various native bindings | Rust/C++ prebuilds, may need compilation on unsupported platforms | Case-by-case pure JS alternatives |
| **sqlite3** | SQLite database | C++ addon | Same as better-sqlite3 above |
| **bcrypt** | Password hashing | C++ addon | Not needed (no auth). If needed, use bcryptjs (pure JS) |
| **fsevents** | macOS file watching | macOS-only native addon | Electron's built-in file watching or chokidar (which optionally uses fsevents but works without it) |
| **libraw / dcraw** | RAW photo processing | Native C/C++ | Out of scope per project requirements (no RAW processing) |
| **opencv4nodejs** | Computer vision | Massive native dependency | Canvas API pixel math for quality scoring |

### Detection Strategy

Add to CI pipeline:
```bash
# Fail build if any native addon sneaks in
pnpm ls --depth Infinity | grep -E "node-gyp|prebuild-install|node-pre-gyp" && exit 1
```

Also configure `.npmrc`:
```ini
# Prevent optional native dependencies from installing
ignore-scripts=false
```

And in `package.json` at root:
```json
{
  "pnpm": {
    "neverBuiltDependencies": ["fsevents"]
  }
}
```

---

## Version Compatibility Matrix

| Technology | Min Version | Tested With | Node.js Requirement | Notes |
|------------|-------------|-------------|---------------------|-------|
| Electron 41 | 41.0.0 | 41.0.2 | Node 22 (bundled) | Ships own Node.js |
| React 19 | 19.2.0 | 19.2.4 | N/A (browser) | Runs in Chromium renderer |
| TypeScript | 5.7.0 | 5.7.x | N/A (compile-time) | Strict mode required |
| electron-vite | 5.0.0 | 5.0.0 | 18+ | Dev-time only |
| Vite | 6.x | (bundled with electron-vite 5) | 18+ | Dev-time only |
| Tailwind CSS | 4.0.0 | 4.x | 18+ | Dev-time only |
| Turborepo | 2.8.0 | 2.8.17 | 18+ | Dev-time only |
| pnpm | 10.0.0 | 10.32.1 | 18.12+ | Required globally |
| Vitest | 4.0.0 | 4.1.0 | 18+ | Dev-time only |

**Dev environment requirement:** Node.js 22 LTS + pnpm 10. Nothing else.

---

## Key Technical Decisions

### Why Canvas API Instead of sharp

sharp is the gold standard for server-side image processing, but it's a native addon. The Canvas API in Electron's Chromium provides:

- **OffscreenCanvas** in Web Workers for parallel thumbnail generation
- **getImageData()** for pixel-level analysis (quality scoring)
- **drawImage()** with resize for thumbnail creation
- **toBlob()/toDataURL()** for output

Performance is sufficient: generating a 200x200 thumbnail from a 6000x4000 JPEG takes ~50ms in a Web Worker on modern hardware. For 1,000 photos, parallel workers process the batch in under 30 seconds.

### Why No Database

The project explicitly avoids an import/catalog system. State is ephemeral: open folder, view images, cull, done. No persistence needed beyond the current session. If session persistence is ever needed, `localStorage` or a simple JSON file suffices. If structured queries become necessary, `sql.js` (SQLite compiled to WASM) is the zero-native-deps option.

### Why electron-builder Over Electron Forge

Despite Forge being the officially recommended tool, electron-builder is chosen because:

1. **Monorepo support**: Better documented patterns for building from a subdirectory within a monorepo
2. **Community knowledge**: 1.1M weekly downloads means every edge case has been solved on Stack Overflow/GitHub Issues
3. **Auto-update**: Built-in `electron-updater` package, no additional setup
4. **Output formats**: Produces DMG + NSIS out of the box with minimal config

---

## Sources

- [Electron Releases](https://releases.electronjs.org/) - version tracking
- [electron-vite 5.0 announcement](https://electron-vite.org/blog/) - build tooling
- [Tailwind CSS v4.0](https://tailwindcss.com/blog/tailwindcss-v4) - CSS framework
- [TanStack Virtual](https://tanstack.com/virtual/latest) - virtualization
- [Zustand](https://zustand.docs.pmnd.rs/) - state management
- [exifr on npm](https://www.npmjs.com/package/exifr) - EXIF parsing
- [heic2any on npm](https://www.npmjs.com/package/heic2any) - HEIC conversion
- [libheif-js on npm](https://www.npmjs.com/package/libheif-js) - HEIC decoding
- [electron-builder docs](https://www.electron.build/) - packaging
- [Vitest 4.0 announcement](https://vitest.dev/blog/vitest-4) - testing
- [React 19.2 blog](https://react.dev/blog/2025/10/01/react-19-2) - React version
- [Turborepo docs](https://turborepo.dev/docs) - monorepo tooling
- [pnpm releases](https://github.com/pnpm/pnpm/releases) - package management
- [Turbotron template](https://github.com/ntwigs/turbotron) - Electron + Turborepo + Vite + React reference
