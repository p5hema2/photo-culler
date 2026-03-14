# Phase 1: Electron Shell and Build Pipeline - Context

**Gathered:** 2026-03-14
**Status:** Ready for planning

<domain>
## Phase Boundary

A working Electron + React app in a Turborepo monorepo that packages into native installers on both platforms, with typed IPC and zero native dependencies. This phase delivers the foundation — no photo-specific features yet.

</domain>

<decisions>
## Implementation Decisions

### Build Tooling
- Use **electron-vite 5** as the build tool (not Electron Forge) — purpose-built for Electron's 3-process model, fast HMR
- Use **Vite defaults** for the renderer process (standard Vite + React plugin, no custom optimization)
- Use **electron-builder** for packaging into .dmg and .exe (better monorepo support, built-in auto-update)

### Monorepo Packages
- **Full structure from day one:** apps/desktop + packages/image-utils + packages/types + packages/ui + packages/tsconfig
- Shared TypeScript types live in a **separate @photo-culler/types package** — single source of truth for IPC contracts
- Package naming convention: **@photo-culler/** scope (e.g., @photo-culler/desktop, @photo-culler/image-utils, @photo-culler/types, @photo-culler/ui)
- Minimum **Node.js 20 LTS** enforced (engines field in package.json)

### Window Chrome
- **Default OS title bar** — native look on each platform, no custom frameless window
- Window launches **maximized** — photo apps need maximum screen space for the grid
- **Minimum window size: 800x600** — prevents unusable layouts
- **Standard OS menu bar** — File, Edit, View, Window, Help structure

### CI Pipeline
- **GitHub Actions** for CI/CD
- Lint + test on **PRs and pushes to main**
- Installer artifacts (.dmg, .exe) built **only on version tags** (saves CI minutes)
- **Code signing set up from Phase 1** — macOS notarization and Windows signing configured now, not deferred

### Claude's Discretion
- HMR configuration details
- Exact menu bar items (will evolve as features are added in later phases)
- Prettier and ESLint rule specifics
- tsconfig strictness levels
- Exact electron-builder NSIS/DMG configuration details

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. User wants a solid, well-structured foundation that "just works" on both platforms.

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — greenfield project

### Established Patterns
- None — patterns will be established in this phase

### Integration Points
- PROJECT-PLAN.md exists at repo root with the original project plan (kept for reference, not used by the app)

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-electron-shell-and-build-pipeline*
*Context gathered: 2026-03-14*
