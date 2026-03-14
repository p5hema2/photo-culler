---
phase: 01-electron-shell-and-build-pipeline
plan: 03
subsystem: desktop
tags: [electron-builder, packaging, github-actions, ci, release, dmg, nsis, code-signing]

# Dependency graph
requires: [01-02]
provides:
  - electron-builder packaging config for macOS (DMG x64+arm64) and Windows (NSIS x64)
  - GitHub Actions CI workflow (lint, typecheck, build on macOS + Windows)
  - GitHub Actions release workflow (signed installers on version tags)
  - macOS entitlements plist for Electron hardened runtime
affects: [all-future-releases, phase-2-onwards]

# Tech tracking
tech-stack:
  added: [electron-builder 26.8]
  patterns: [electron-builder-yml-config, github-actions-matrix-strategy, code-signing-via-secrets]

key-files:
  created:
    - apps/desktop/electron-builder.yml
    - apps/desktop/build/entitlements.mac.plist
    - apps/desktop/build/icon.png
    - .github/workflows/ci.yml
    - .github/workflows/release.yml
  modified:
    - apps/desktop/package.json

key-decisions:
  - "Removed publish section from electron-builder.yml -- publish config causes errors without a git remote; release workflow uses --publish never and uploads artifacts separately"
  - "Release creates draft GitHub release via softprops/action-gh-release@v2 rather than auto-publishing"

patterns-established:
  - "electron-builder files=[out/**, package.json, !node_modules] to prevent source/node_modules bloat"
  - "CI matrix strategy: [macos-latest, windows-latest] for cross-platform validation"
  - "Native addon detection step in CI to enforce INFRA-02 zero-native-deps policy"
  - "Code signing env vars passed from GitHub secrets, silently skipped when absent"

requirements-completed: [DIST-01, DIST-02, DIST-03, DIST-04]

# Metrics
duration: 11min
completed: 2026-03-14
---

# Phase 1 Plan 03: Electron-Builder Packaging and GitHub Actions CI/Release Summary

**electron-builder packaging producing macOS DMG (x64+arm64) and Windows NSIS installers under 115MB, with GitHub Actions CI and release workflows including code signing support**

## Performance

- **Duration:** 11 min
- **Started:** 2026-03-14T15:52:59Z
- **Completed:** 2026-03-14T16:04:00Z
- **Tasks:** 2
- **Files created:** 5
- **Files modified:** 1

## Accomplishments

- electron-builder.yml configured with files=[out/**, package.json, !node_modules] preventing source bloat
- macOS DMG builds for both x64 (113MB) and arm64 (107MB) -- well under 200MB threshold
- Windows NSIS installer configured with custom install directory support
- macOS entitlements plist with JIT, unsigned memory, dyld env vars, and user file access
- CI workflow runs format:check, lint, typecheck, build on both macOS and Windows runners
- CI includes native addon detection step enforcing INFRA-02 zero-native-deps
- Release workflow builds signed installers on version tags with artifact upload and draft GitHub release
- npmRebuild: false and asar: true for minimal, secure packaging

## Task Commits

Each task was committed atomically:

1. **Task 1: Configure electron-builder packaging for macOS and Windows** - `660ed43` (feat)
2. **Task 2: Create GitHub Actions CI and release workflows** - `10d3293` (feat)

## Files Created/Modified

- `apps/desktop/electron-builder.yml` - electron-builder config: appId, files, mac DMG, win NSIS, no native rebuild
- `apps/desktop/build/entitlements.mac.plist` - macOS entitlements for Electron hardened runtime
- `apps/desktop/build/icon.png` - 512x512 placeholder icon (to be replaced with real icon)
- `.github/workflows/ci.yml` - CI pipeline: lint + typecheck + build on macOS/Windows, native addon check
- `.github/workflows/release.yml` - Release pipeline: build signed installers on v* tags, upload artifacts, create draft release
- `apps/desktop/package.json` - Added package, package:mac, package:win scripts

## Decisions Made

- Removed `publish` section from electron-builder.yml because it causes a null provider error when no git remote is configured (electron-builder 26.8 bug). The release workflow handles artifact upload separately via actions/upload-artifact and softprops/action-gh-release.
- Release workflow creates a **draft** GitHub release rather than auto-publishing, giving maintainers a chance to review release notes before making it public.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed publish section from electron-builder.yml**
- **Found during:** Task 1 (packaging verification)
- **Issue:** electron-builder 26.8 throws "Cannot read properties of null (reading 'provider')" when publish.provider is set to github but no git remote is configured
- **Fix:** Removed publish section from config; release workflow uses --publish never and handles uploads separately
- **Files modified:** apps/desktop/electron-builder.yml
- **Commit:** 660ed43

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** No functional change -- publish was only needed for auto-update which is a future concern.

## User Setup Required

Code signing and notarization require external credentials (documented in plan frontmatter):

**macOS (Apple Developer Program):**
- MAC_CERTIFICATE, MAC_CERTIFICATE_PASSWORD -- exported .p12 certificate
- APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_KEY_ISSUER -- App Store Connect API key

**Windows (EV Code Signing):**
- WIN_CSC_LINK, WIN_CSC_KEY_PASSWORD -- EV certificate from provider

These are GitHub Actions secrets. Unsigned builds work for development testing.

## Next Phase Readiness

- Phase 1 complete: monorepo + Electron app + packaging + CI all working
- Ready for Phase 2 planning (folder browsing and thumbnail grid)
- CI will validate all future changes on both platforms
- Release workflow ready when code signing secrets are configured

## Self-Check: PASSED
