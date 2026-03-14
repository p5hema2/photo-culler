---
phase: 1
slug: electron-shell-and-build-pipeline
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-14
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x |
| **Config file** | None — Wave 0 creates `vitest.config.ts` per package |
| **Quick run command** | `pnpm test` |
| **Full suite command** | `pnpm test` (runs across all packages via Turborepo) |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm lint && pnpm typecheck && pnpm test`
- **After every plan wave:** Run `pnpm build` (full monorepo build)
- **Before `/gsd:verify-work`:** Full build + packaging on both platforms
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | INFRA-01 | smoke | `pnpm build` completes | ❌ W0 | ⬜ pending |
| 01-01-02 | 01 | 1 | INFRA-02 | CI check | `pnpm ls --depth Infinity \| grep -iE "node-gyp\|prebuild-install"` empty | ❌ W0 | ⬜ pending |
| 01-01-03 | 01 | 1 | INFRA-03 | smoke | `pnpm format:check` exits 0 | ❌ W0 | ⬜ pending |
| 01-01-04 | 01 | 1 | INFRA-04 | smoke | `pnpm lint` exits 0 | ❌ W0 | ⬜ pending |
| 01-01-05 | 01 | 1 | INFRA-05 | manual | Manual: `pnpm dev`, verify window + HMR | N/A | ⬜ pending |
| 01-02-01 | 02 | 1 | INFRA-06 | unit | Vitest: protocol handler returns correct response | ❌ W0 | ⬜ pending |
| 01-02-02 | 02 | 1 | INFRA-07 | unit | Vitest: IPC types compile, preload API shape correct | ❌ W0 | ⬜ pending |
| 01-03-01 | 03 | 2 | DIST-01 | CI smoke | `electron-builder --mac` exits 0 on CI | ❌ W0 | ⬜ pending |
| 01-03-02 | 03 | 2 | DIST-02 | CI smoke | `electron-builder --win` exits 0 on CI | ❌ W0 | ⬜ pending |
| 01-03-03 | 03 | 2 | DIST-03 | manual | Manual: install on clean OS, verify launch | N/A | ⬜ pending |
| 01-03-04 | 03 | 2 | DIST-04 | smoke | GitHub Actions runs on macos-latest + windows-latest | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/desktop/vitest.config.ts` — unit test config for desktop app
- [ ] `packages/types/vitest.config.ts` — type compilation tests
- [ ] Vitest workspace config or per-package configs
- [ ] `.github/workflows/ci.yml` — lint, test, build on PR + main
- [ ] `.github/workflows/release.yml` — build + sign + upload artifacts on tags
- [ ] `pnpm add -Dw vitest` at root

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| HMR works in dev | INFRA-05 | Requires visual confirmation of window + live reload | Run `pnpm dev`, verify Electron window shows React page, edit a component, verify hot reload |
| Clean OS install | DIST-03 | Requires actual install on fresh machine | Download .dmg/.exe from CI, install on clean macOS/Windows, verify app launches |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
