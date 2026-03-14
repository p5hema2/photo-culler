# Phase 1: Electron Shell and Build Pipeline - Research

**Researched:** 2026-03-14
**Domain:** Electron + React monorepo scaffold, build pipeline, packaging, typed IPC, CI/CD
**Confidence:** HIGH

## Summary

Phase 1 delivers the complete project foundation: a Turborepo monorepo with pnpm workspaces, an Electron 41 app built with electron-vite 5, typed IPC via contextBridge, a custom `app://` protocol for secure image serving, electron-builder packaging into .dmg and .exe, and a GitHub Actions CI pipeline with code signing. This is a greenfield scaffold phase with no existing code.

The primary technical risks are: (1) electron-builder fighting pnpm's symlink structure in a monorepo -- mitigated by bundling all output via electron-vite before electron-builder touches it, (2) code signing complexity on both platforms -- macOS requires Apple Developer account + notarization, Windows now requires EV certificates stored on hardware security modules, and (3) getting the electron-vite project structure right from the start since it expects a specific `src/main`, `src/preload`, `src/renderer` layout.

**Primary recommendation:** Scaffold the monorepo manually (not via `create electron-vite` since we need a custom monorepo layout), configure electron-vite within `apps/desktop`, validate that `pnpm dev` launches with HMR and `pnpm build` produces working installers on both platforms before writing any feature code.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Use **electron-vite 5** as the build tool (not Electron Forge) -- purpose-built for Electron's 3-process model, fast HMR
- Use **Vite defaults** for the renderer process (standard Vite + React plugin, no custom optimization)
- Use **electron-builder** for packaging into .dmg and .exe (better monorepo support, built-in auto-update)
- **Full structure from day one:** apps/desktop + packages/image-utils + packages/types + packages/ui + packages/tsconfig
- Shared TypeScript types live in a **separate @photo-culler/types package** -- single source of truth for IPC contracts
- Package naming convention: **@photo-culler/** scope (e.g., @photo-culler/desktop, @photo-culler/image-utils, @photo-culler/types, @photo-culler/ui)
- Minimum **Node.js 20 LTS** enforced (engines field in package.json)
- **Default OS title bar** -- native look on each platform, no custom frameless window
- Window launches **maximized** -- photo apps need maximum screen space for the grid
- **Minimum window size: 800x600** -- prevents unusable layouts
- **Standard OS menu bar** -- File, Edit, View, Window, Help structure
- **GitHub Actions** for CI/CD
- Lint + test on **PRs and pushes to main**
- Installer artifacts (.dmg, .exe) built **only on version tags** (saves CI minutes)
- **Code signing set up from Phase 1** -- macOS notarization and Windows signing configured now, not deferred

### Claude's Discretion
- HMR configuration details
- Exact menu bar items (will evolve as features are added in later phases)
- Prettier and ESLint rule specifics
- tsconfig strictness levels
- Exact electron-builder NSIS/DMG configuration details

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INFRA-01 | Project uses Turborepo monorepo with pnpm workspaces and shared packages | Turborepo + pnpm workspace config, turbo.json pipeline, package structure documented below |
| INFRA-02 | All dependencies are pure JS/TS or bundled WASM -- no native Node.js addons | Native addon blocklist from STACK.md, detection strategy via CI check |
| INFRA-03 | Prettier formats all code with a single `pnpm format` command | Prettier 3.5+ config, Turborepo pipeline task |
| INFRA-04 | ESLint enforces code quality across all packages | ESLint 9 flat config, shared config package, TypeScript-ESLint |
| INFRA-05 | Electron app launches via `pnpm dev` with hot module reload | electron-vite 5 dev server with HMR for renderer, hot reload for main |
| INFRA-06 | Custom `app://` protocol serves local images securely (no webSecurity disable) | protocol.registerSchemesAsPrivileged + protocol.handle pattern documented below |
| INFRA-07 | Typed IPC bridge via contextBridge -- renderer never accesses Node.js directly | contextBridge + typed IPC pattern with @photo-culler/types documented below |
| DIST-01 | App compiles to a macOS .dmg installer (Intel + Apple Silicon) | electron-builder mac config with universal build |
| DIST-02 | App compiles to a Windows .exe installer | electron-builder win/nsis config |
| DIST-03 | End users have zero system requirements -- download, install, run | Electron bundles Chromium + Node.js; no native deps means no runtime requirements |
| DIST-04 | CI pipeline builds and tests on both macOS and Windows runners | GitHub Actions matrix strategy with macos-latest and windows-latest |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Electron | ^41.0.0 | Desktop shell (Chromium 134 + Node 22) | Latest stable. Built-in dialog, shell, protocol APIs. |
| React | ^19.2.0 | UI framework | Latest stable with concurrent rendering. |
| TypeScript | ^5.7.0 | Type safety across all packages | Strict mode catches IPC contract bugs at compile time. |
| electron-vite | ^5.0.0 | Build tooling (main + preload + renderer) | Purpose-built for Electron's 3-process model. Requires Node 20.19+ or 22.12+. |
| electron-builder | ^26.8.0 | Packaging into .dmg/.exe installers | 1.1M weekly downloads, mature monorepo patterns, built-in signing. |
| Turborepo | ^2.8.0 | Build orchestration and caching | Dependency-aware pipeline, cached builds, native pnpm support. |
| pnpm | ^10.32.0 | Package manager | Strict dependency isolation, workspace support, content-addressable store. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Tailwind CSS | ^4.0.0 | Utility-first CSS | All renderer styling. v4 zero-config: `@import "tailwindcss"`. |
| Prettier | ^3.5.0 | Code formatting | `pnpm format` across all packages. |
| ESLint | ^9.0.0 | Linting | Flat config format. @typescript-eslint + react-hooks plugin. |
| Vitest | ^4.1.0 | Unit testing | Vite-native, fast, ESM-first. Test shared packages. |
| @electron-toolkit/preload | latest | Preload utilities | Optional helper for exposing standard Electron APIs cleanly. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| electron-vite | Electron Forge + Vite plugin | Forge is "official" but its Vite support is experimental. electron-vite is purpose-built and more mature for Vite workflows. |
| electron-builder | Electron Forge packager | Forge has 500x fewer downloads. electron-builder has better monorepo docs and built-in auto-update. |
| Tailwind CSS 4 | CSS Modules | CSS Modules work but slower iteration. Tailwind is faster for prototyping layouts. |

**Installation (root):**
```bash
pnpm add -Dw turbo prettier eslint typescript
```

**Installation (apps/desktop):**
```bash
pnpm add --filter @photo-culler/desktop electron react react-dom
pnpm add -D --filter @photo-culler/desktop electron-vite electron-builder @vitejs/plugin-react typescript @types/react @types/react-dom tailwindcss vitest
```

**Installation (packages):**
```bash
# packages/types - no runtime deps, just TypeScript
pnpm add -D --filter @photo-culler/types typescript

# packages/image-utils - placeholder, pure TS
pnpm add -D --filter @photo-culler/image-utils typescript vitest

# packages/ui - placeholder, React components
pnpm add --filter @photo-culler/ui react react-dom
pnpm add -D --filter @photo-culler/ui typescript @types/react @types/react-dom tailwindcss vitest

# packages/tsconfig - no deps, just JSON config files
```

## Architecture Patterns

### Recommended Project Structure

```
photo-culler/
├── apps/
│   └── desktop/                        # @photo-culler/desktop
│       ├── src/
│       │   ├── main/                   # Electron main process
│       │   │   ├── index.ts            # App entry: window creation, protocol, menu
│       │   │   ├── ipc-handlers.ts     # All ipcMain.handle() registrations
│       │   │   └── protocol.ts         # Custom app:// protocol handler
│       │   ├── preload/                # Preload bridge
│       │   │   └── index.ts            # contextBridge.exposeInMainWorld()
│       │   └── renderer/               # React app (Vite-built)
│       │       ├── index.html          # Entry HTML
│       │       └── src/
│       │           ├── main.tsx        # React entry (createRoot)
│       │           ├── App.tsx         # Root component
│       │           └── app.css         # Tailwind imports
│       ├── electron.vite.config.ts     # Main/preload/renderer Vite config
│       ├── electron-builder.yml        # Packaging config
│       ├── tsconfig.json               # Extends @photo-culler/tsconfig
│       ├── tsconfig.node.json          # For main/preload (Node target)
│       ├── tsconfig.web.json           # For renderer (DOM target)
│       └── package.json
│
├── packages/
│   ├── types/                          # @photo-culler/types
│   │   ├── src/
│   │   │   ├── ipc.ts                  # IPC channel names + payload types
│   │   │   ├── image.ts                # ImageFileInfo, etc.
│   │   │   └── index.ts               # Barrel export
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── image-utils/                    # @photo-culler/image-utils (placeholder)
│   │   ├── src/
│   │   │   └── index.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── ui/                             # @photo-culler/ui (placeholder)
│   │   ├── src/
│   │   │   └── index.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── tsconfig/                       # @photo-culler/tsconfig
│       ├── base.json                   # Shared strict settings
│       ├── react.json                  # Renderer (DOM + JSX)
│       └── node.json                   # Main/preload (Node target)
│
├── .github/
│   └── workflows/
│       ├── ci.yml                      # Lint + build on PR/push to main
│       └── release.yml                 # Build installers on version tags
│
├── turbo.json                          # Task pipeline
├── pnpm-workspace.yaml                 # Workspace definition
├── package.json                        # Root: engines, scripts, devDeps
├── .prettierrc                         # Prettier config
├── eslint.config.js                    # Root ESLint flat config
├── .npmrc                              # pnpm settings
└── .node-version                       # Node 20 LTS
```

### Pattern 1: electron-vite Configuration

**What:** electron-vite 5 uses a single `electron.vite.config.ts` that configures three separate Vite builds (main, preload, renderer). Output goes to `out/` directory.

**Key details:**
- electron-vite auto-detects entry points: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`
- Main and preload targets are set to the Node version matching the Electron version automatically
- Renderer target is set to the Chrome version matching Electron automatically
- Electron and Node built-in modules are automatically externalized for main/preload
- Output directory is `out/` (main, preload, renderer subdirs)
- The `package.json` `main` field must point to `./out/main/index.js`

**Example:**
```typescript
// apps/desktop/electron.vite.config.ts
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@photo-culler/types': resolve(__dirname, '../../packages/types/src')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@photo-culler/types': resolve(__dirname, '../../packages/types/src')
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@photo-culler/types': resolve(__dirname, '../../packages/types/src')
      }
    },
    plugins: [react()]
  }
})
```

### Pattern 2: Typed IPC via contextBridge

**What:** Define IPC channel names and payload types in `@photo-culler/types`. The preload script exposes typed functions via `contextBridge.exposeInMainWorld()`. The renderer only sees `window.api.*` -- no Electron knowledge.

**Key security defaults (Electron 41):**
- `contextIsolation: true` (default since Electron 12)
- `sandbox: true` (default since Electron 20)
- `nodeIntegration: false` (default)

**Example:**
```typescript
// packages/types/src/ipc.ts
export const IPC_CHANNELS = {
  SELECT_FOLDER: 'dialog:select-folder',
  SCAN_FOLDER: 'fs:scan-folder',
  TRASH_FILES: 'fs:trash-files',
} as const;

export interface ElectronAPI {
  selectFolder: () => Promise<string | null>;
  scanFolder: (folderPath: string) => Promise<ImageFileInfo[]>;
  trashFiles: (filePaths: string[]) => Promise<TrashResult>;
}

// apps/desktop/src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '@photo-culler/types';

const api: import('@photo-culler/types').ElectronAPI = {
  selectFolder: () => ipcRenderer.invoke(IPC_CHANNELS.SELECT_FOLDER),
  scanFolder: (path) => ipcRenderer.invoke(IPC_CHANNELS.SCAN_FOLDER, path),
  trashFiles: (paths) => ipcRenderer.invoke(IPC_CHANNELS.TRASH_FILES, paths),
};
contextBridge.exposeInMainWorld('api', api);

// Type augmentation for renderer
// packages/types/src/window.d.ts
import type { ElectronAPI } from './ipc';
declare global {
  interface Window {
    api: ElectronAPI;
  }
}
```

### Pattern 3: Custom app:// Protocol

**What:** Register a custom protocol to serve local image files. The renderer loads images via `<img src="app://local/path/to/photo.jpg">` instead of `file://`. This keeps `webSecurity` enabled.

**Critical timing:** `protocol.registerSchemesAsPrivileged()` MUST be called before `app.whenReady()`. `protocol.handle()` is called after.

**Example:**
```typescript
// apps/desktop/src/main/protocol.ts
import { protocol, net } from 'electron';
import path from 'node:path';

// Call BEFORE app.whenReady()
export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, stream: true } }
  ]);
}

// Call AFTER app.whenReady()
export function registerProtocolHandlers(): void {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    const filePath = decodeURIComponent(url.pathname);
    // Security: validate the path
    const normalized = path.normalize(filePath);
    return net.fetch(`file://${normalized}`);
  });
}
```

### Pattern 4: electron-builder in Monorepo

**What:** electron-builder packages the pre-built output from electron-vite. It should never see raw source or monorepo node_modules.

**Key config points:**
- Set `directories.output` to a build output directory
- Use `files` to include only the `out/` directory (electron-vite output) and `package.json`
- Set `npmRebuild: false` (no native deps to rebuild)
- The `package.json` `main` field must point to the electron-vite output: `./out/main/index.js`

**Example:**
```yaml
# apps/desktop/electron-builder.yml
appId: com.photo-culler.app
productName: Photo Culler
directories:
  buildResources: build
  output: dist

files:
  - out/**
  - package.json
  - "!node_modules"

npmRebuild: false
asar: true

mac:
  category: public.app-category.photography
  target:
    - target: dmg
      arch:
        - x64
        - arm64
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
  notarize: true

win:
  target:
    - target: nsis
      arch:
        - x64
  # Sign options configured via environment variables

nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true

publish:
  provider: github
```

### Pattern 5: BrowserWindow Configuration

**What:** Create a maximized window with OS-native title bar, 800x600 minimum size, and proper security defaults.

**Example:**
```typescript
// apps/desktop/src/main/index.ts
import { app, BrowserWindow, Menu } from 'electron';
import { registerSchemes } from './protocol';
import path from 'node:path';

// MUST be before app.whenReady()
registerSchemes();

app.whenReady().then(() => {
  registerProtocolHandlers();
  registerIpcHandlers();

  const mainWindow = new BrowserWindow({
    minWidth: 800,
    minHeight: 600,
    show: false, // show after ready-to-show to avoid flash
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      // contextIsolation: true (default)
      // sandbox: true (default)
      // nodeIntegration: false (default)
    },
  });

  mainWindow.maximize();
  mainWindow.on('ready-to-show', () => mainWindow.show());

  // Load renderer
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL); // dev
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html')); // prod
  }
});
```

### Anti-Patterns to Avoid

- **Exposing raw ipcRenderer:** Never do `contextBridge.exposeInMainWorld('ipc', ipcRenderer)`. Expose individual typed functions only.
- **Disabling webSecurity:** Never set `webSecurity: false`. Use a custom protocol instead.
- **Using file:// for images:** Grants unilateral filesystem access. Use `app://` protocol.
- **Putting Electron imports in shared packages:** `@photo-culler/types` and `@photo-culler/image-utils` must never import from `electron`. Only `apps/desktop/src/main` and `apps/desktop/src/preload` may.
- **String concatenation for paths:** Always use `path.join()` / `path.resolve()`. Never `folder + '/' + file`.
- **Synchronous IPC:** Never use `ipcRenderer.sendSync()`. Always use async `invoke`/`handle`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Electron build tooling | Custom Vite config for main/preload/renderer | electron-vite 5 | Handles 3-process model, auto-externals, correct targets, HMR |
| Installer packaging | Custom packaging scripts | electron-builder | DMG/NSIS, code signing, notarization, auto-update built in |
| Monorepo task orchestration | Custom build scripts | Turborepo | Dependency-aware caching, parallel execution |
| IPC type safety | Manual type casting | Shared @photo-culler/types package | Single source of truth prevents drift between processes |
| Code formatting | Manual style enforcement | Prettier | Zero-config, deterministic, eliminates style debates |

## Common Pitfalls

### Pitfall 1: electron-builder Monorepo Packaging

**What goes wrong:** electron-builder bundles the entire monorepo's node_modules into the asar archive, causing 300+ MB app size and broken symlinks from pnpm.
**Why it happens:** electron-builder was designed for single-package projects. pnpm symlinks confuse its file collection.
**How to avoid:** Bundle everything via electron-vite first (output to `out/`). Configure electron-builder `files` to include ONLY `out/**` and `package.json`. Set `npmRebuild: false`. The key insight: electron-builder should package pre-built output, not source code.
**Warning signs:** asar file >50MB. Build time >2 minutes for a JS-only app.

### Pitfall 2: Code Signing Complexity

**What goes wrong:** Unsigned apps trigger Gatekeeper (macOS "app is damaged") and SmartScreen (Windows warning). Users cannot install.
**Why it happens:** macOS requires notarization since Ventura. Windows now requires EV certificates on hardware security modules (since June 2023).
**How to avoid:**
- **macOS:** Apple Developer account ($99/yr), notarytool via `electron-builder`'s built-in notarize support. Store credentials as GitHub Actions secrets (API key with .p8 file, or app-specific password for legacy notarytool).
- **Windows:** EV code signing certificate stored in cloud HSM (DigiCert KeyLocker, Azure Trusted Signing, or similar). Configure `win.azureSignOptions` or custom `signtool` in electron-builder.
- Set up CI secrets early. Do not defer signing setup.
**Warning signs:** Build produces unsigned artifacts. No signing step in CI workflow.

### Pitfall 3: electron-vite Project Structure Mismatch

**What goes wrong:** electron-vite cannot find entry points or outputs to wrong directories.
**Why it happens:** electron-vite expects `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html` by convention. Deviating requires explicit config.
**How to avoid:** Follow the default directory convention within `apps/desktop/src/`. Set `package.json` `main` to `./out/main/index.js`.
**Warning signs:** `electron-vite dev` fails with "entry not found" errors.

### Pitfall 4: Turborepo Pipeline Dependency Order

**What goes wrong:** `apps/desktop` builds before `packages/types` is compiled, causing import errors.
**Why it happens:** Missing `dependsOn: ["^build"]` in turbo.json means tasks run in parallel without respecting package dependencies.
**How to avoid:** Set `"dependsOn": ["^build"]` for build, dev, typecheck tasks. The `^` means "build dependencies first." Lint and format don't need this (they're package-local).
**Warning signs:** Intermittent build failures that pass on retry (race condition).

### Pitfall 5: registerSchemesAsPrivileged Timing

**What goes wrong:** Custom protocol doesn't work or throws "scheme already registered."
**Why it happens:** `protocol.registerSchemesAsPrivileged()` MUST be called before `app.whenReady()`. It can only be called once. `protocol.handle()` must be called after `app.whenReady()`.
**How to avoid:** Call `registerSchemesAsPrivileged` at module top level (before any async code). Call `protocol.handle` inside the `app.whenReady()` callback.

## Code Examples

### Turborepo Configuration

```yaml
# pnpm-workspace.yaml
packages:
  - "apps/*"
  - "packages/*"
```

```jsonc
// turbo.json
{
  "$schema": "https://turborepo.dev/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["out/**", "dist/**"]
    },
    "dev": {
      "dependsOn": ["^build"],
      "persistent": true,
      "cache": false
    },
    "lint": {},
    "format": {},
    "format:check": {},
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "test": {
      "dependsOn": ["^build"]
    }
  }
}
```

```jsonc
// Root package.json
{
  "name": "photo-culler",
  "private": true,
  "packageManager": "pnpm@10.32.1",
  "engines": {
    "node": ">=20.19.0"
  },
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "lint": "turbo run lint",
    "format": "turbo run format",
    "format:check": "turbo run format:check",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test"
  },
  "devDependencies": {
    "turbo": "^2.8.0",
    "prettier": "^3.5.0"
  }
}
```

### Native Addon Detection (CI)

```bash
# Add to CI pipeline to catch native deps
pnpm ls --depth Infinity 2>/dev/null | grep -iE "node-gyp|prebuild-install|node-pre-gyp|cmake-js" && echo "NATIVE ADDON DETECTED" && exit 1 || echo "No native addons found"
```

### macOS Entitlements File

```xml
<!-- apps/desktop/build/entitlements.mac.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.allow-dyld-environment-variables</key>
  <true/>
  <key>com.apple.security.files.user-selected.read-write</key>
  <true/>
</dict>
</plist>
```

### GitHub Actions CI Workflow

```yaml
# .github/workflows/ci.yml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  lint-and-build:
    strategy:
      matrix:
        os: [macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm format:check
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm build
```

```yaml
# .github/workflows/release.yml
name: Release
on:
  push:
    tags: ['v*']

jobs:
  build-installers:
    strategy:
      matrix:
        include:
          - os: macos-latest
            platform: mac
          - os: windows-latest
            platform: win
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - name: Build installer
        run: pnpm --filter @photo-culler/desktop exec electron-builder --${{ matrix.platform }}
        env:
          # macOS signing
          CSC_LINK: ${{ secrets.MAC_CERTIFICATE }}
          CSC_KEY_PASSWORD: ${{ secrets.MAC_CERTIFICATE_PASSWORD }}
          APPLE_API_KEY: ${{ secrets.APPLE_API_KEY }}
          APPLE_API_KEY_ID: ${{ secrets.APPLE_API_KEY_ID }}
          APPLE_API_KEY_ISSUER: ${{ secrets.APPLE_API_KEY_ISSUER }}
          # Windows signing (Azure Trusted Signing or similar)
          # Configure via electron-builder win.azureSignOptions or custom signtool
      - uses: actions/upload-artifact@v4
        with:
          name: installer-${{ matrix.platform }}
          path: apps/desktop/dist/*
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Electron Forge for packaging | electron-builder remains dominant (1.1M/week vs 2K) | Ongoing | Use electron-builder despite Forge being "official" |
| webpack for Electron builds | electron-vite (Vite-based) | 2023+ | 10-100x faster HMR, simpler config |
| `protocol.registerBufferProtocol` | `protocol.handle()` (returns Response) | Electron 25+ | Cleaner API, supports streaming |
| OV certificates for Windows | EV certificates on HSM required | June 2023 | Windows code signing now requires hardware security module |
| `registerStandardSchemes` | `registerSchemesAsPrivileged` | Electron 10+ | Single call for all privilege flags |
| ESLint `.eslintrc.*` | ESLint `eslint.config.js` (flat config) | ESLint 9 | New config format, simpler plugin loading |
| Tailwind CSS v3 config | Tailwind CSS v4 zero-config | Jan 2025 | No tailwind.config.js needed, use `@import "tailwindcss"` |

**Deprecated/outdated:**
- `protocol.registerFileProtocol` -- replaced by `protocol.handle()`
- `protocol.registerBufferProtocol` -- replaced by `protocol.handle()`
- ESLint `.eslintrc.json` -- use flat config `eslint.config.js` with ESLint 9
- Tailwind `tailwind.config.js` -- Tailwind CSS v4 uses CSS-based config

## Open Questions

1. **Windows EV code signing provider**
   - What we know: Windows requires EV certificates on hardware security modules since June 2023. DigiCert KeyLocker, Azure Trusted Signing, and AWS CloudHSM are options.
   - What's unclear: Which provider the user has or plans to use. Azure Trusted Signing requires US/Canada business with 3+ years history. Individual developers may need DigiCert or similar.
   - Recommendation: Set up the CI workflow with placeholder signing configuration. The actual certificate setup can be configured when certificates are obtained. App builds without signing still work for development.

2. **Apple Developer account availability**
   - What we know: macOS notarization requires Apple Developer account ($99/yr).
   - What's unclear: Whether the user already has one.
   - Recommendation: Same as above -- configure the workflow structure, allow unsigned builds for development, sign only when credentials are available.

3. **Monorepo package aliasing in electron-vite**
   - What we know: electron-vite supports `resolve.alias` per process config. Workspace packages need aliases to resolve correctly during dev.
   - What's unclear: Whether pnpm workspace protocol (`workspace:*`) resolves correctly in electron-vite without aliases, or if explicit aliases are needed.
   - Recommendation: Start with `workspace:*` in package.json dependencies. Add explicit `resolve.alias` entries if module resolution fails during dev.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1 |
| Config file | None yet -- Wave 0 creates `vitest.config.ts` per package |
| Quick run command | `pnpm test` |
| Full suite command | `pnpm test` (runs across all packages via Turborepo) |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INFRA-01 | Turborepo monorepo with pnpm workspaces | smoke | `pnpm build` completes without errors | Wave 0 |
| INFRA-02 | No native addons | CI check | `pnpm ls --depth Infinity \| grep -iE "node-gyp\|prebuild-install"` returns empty | Wave 0 |
| INFRA-03 | Prettier formats all code | smoke | `pnpm format:check` exits 0 | Wave 0 |
| INFRA-04 | ESLint enforces quality | smoke | `pnpm lint` exits 0 | Wave 0 |
| INFRA-05 | Dev launches with HMR | manual-only | Manual: run `pnpm dev`, verify window opens, edit React component, verify HMR | N/A |
| INFRA-06 | Custom app:// protocol | unit | `vitest` test that protocol handler returns correct response | Wave 0 |
| INFRA-07 | Typed IPC via contextBridge | unit | `vitest` test that IPC types compile correctly, preload exposes correct API shape | Wave 0 |
| DIST-01 | macOS .dmg installer | CI smoke | `electron-builder --mac` exits 0 (on CI mac runner) | Wave 0 |
| DIST-02 | Windows .exe installer | CI smoke | `electron-builder --win` exits 0 (on CI windows runner) | Wave 0 |
| DIST-03 | Zero system requirements | manual-only | Manual: install on clean OS, verify app launches | N/A |
| DIST-04 | CI on both runners | smoke | GitHub Actions workflow runs on macos-latest and windows-latest | Wave 0 |

### Sampling Rate

- **Per task commit:** `pnpm lint && pnpm typecheck && pnpm test`
- **Per wave merge:** `pnpm build` (full monorepo build)
- **Phase gate:** Full build + packaging on both platforms before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `apps/desktop/vitest.config.ts` -- unit test config for desktop app
- [ ] `packages/types/vitest.config.ts` -- type compilation tests
- [ ] Vitest workspace config or per-package configs
- [ ] CI workflow files (`.github/workflows/ci.yml`, `.github/workflows/release.yml`)
- [ ] Framework install: `pnpm add -Dw vitest` at root or per-package

## Sources

### Primary (HIGH confidence)
- [electron-vite Getting Started](https://electron-vite.org/guide/) - Project structure, config format, version requirements
- [electron-vite Configuration](https://electron-vite.org/config/) - Main/preload/renderer config options
- [electron-vite Distribution Guide](https://electron-vite.org/guide/distribution) - electron-builder integration
- [Electron Protocol API](https://www.electronjs.org/docs/latest/api/protocol) - registerSchemesAsPrivileged, protocol.handle
- [Electron IPC Tutorial](https://www.electronjs.org/docs/latest/tutorial/ipc) - invoke/handle pattern
- [Electron contextBridge API](https://www.electronjs.org/docs/latest/api/context-bridge) - exposeInMainWorld
- [Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window) - webPreferences defaults
- [Electron Security Guide](https://www.electronjs.org/docs/latest/tutorial/security) - contextIsolation, sandbox
- [Electron Code Signing](https://www.electronjs.org/docs/latest/tutorial/code-signing) - macOS/Windows signing
- [Turborepo Documentation](https://turborepo.dev/docs) - Pipeline config, workspace structure
- [electron-builder Documentation](https://www.electron.build/) - Common configuration, files, signing

### Secondary (MEDIUM confidence)
- [yerba (t3dotgg)](https://github.com/t3dotgg/yerba) - Turborepo + Electron + Vite reference monorepo
- [buqiyuan/electron-vite-monorepo](https://github.com/buqiyuan/electron-vite-monorepo) - Turborepo + electron-vite monorepo template
- [omkarcloud/macos-code-signing-example](https://github.com/omkarcloud/macos-code-signing-example) - GitHub Actions signing workflow
- [Melatonin blog: Windows EV code signing](https://melatonin.dev/blog/how-to-code-sign-windows-installers-with-an-ev-cert-on-github-actions/) - EV cert workflow
- [Hendrik Erz: Azure Trusted Signing](https://www.hendrik-erz.de/post/code-signing-with-azure-trusted-signing-on-github-actions) - Modern Windows signing

### Tertiary (LOW confidence)
- Exact electron-vite 5 + Electron 41 compatibility -- both are very recent releases (March 2026 and December 2025 respectively). Verify during scaffold. Fallback: Electron 40 + electron-vite 4.
- pnpm workspace protocol resolution in electron-vite -- may need explicit resolve.alias entries. Test during setup.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries are mature, well-documented, version-pinned
- Architecture: HIGH - electron-vite structure is well-documented, IPC patterns are official Electron best practice
- Build pipeline: HIGH - electron-builder + electron-vite integration has documented patterns and reference repos
- Code signing: MEDIUM - Platform requirements are clear but actual certificate setup depends on user's accounts/providers
- Pitfalls: HIGH - All identified from official docs, GitHub issues, and documented community experience

**Research date:** 2026-03-14
**Valid until:** 2026-04-14 (stable technologies, 30-day window)
