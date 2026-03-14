---
phase: 02
slug: folder-browsing-and-thumbnail-grid
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-14
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1 (already in devDependencies) |
| **Config file** | none — Wave 0 installs |
| **Quick run command** | `pnpm --filter @photo-culler/desktop exec vitest run` |
| **Full suite command** | `pnpm test` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter @photo-culler/desktop exec vitest run`
- **After every plan wave:** Run `pnpm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | BROW-01 | integration (IPC mock) | `pnpm --filter @photo-culler/desktop exec vitest run src/renderer/src/__tests__/folder-selection.test.ts` | ❌ W0 | ⬜ pending |
| 02-01-02 | 01 | 1 | BROW-02 | unit (component) | `pnpm --filter @photo-culler/desktop exec vitest run src/renderer/src/__tests__/photo-grid.test.ts` | ❌ W0 | ⬜ pending |
| 02-01-03 | 01 | 1 | BROW-03 | unit | `pnpm --filter @photo-culler/desktop exec vitest run src/renderer/src/__tests__/photo-grid.test.ts` | ❌ W0 | ⬜ pending |
| 02-01-04 | 01 | 1 | BROW-04 | unit (worker mock) | `pnpm --filter @photo-culler/desktop exec vitest run src/renderer/src/__tests__/thumbnail-worker.test.ts` | ❌ W0 | ⬜ pending |
| 02-01-05 | 01 | 1 | BROW-05 | unit | `pnpm --filter @photo-culler/desktop exec vitest run src/renderer/src/__tests__/keyboard-nav.test.ts` | ❌ W0 | ⬜ pending |
| 02-01-06 | 01 | 1 | BROW-06 | unit | `pnpm --filter @photo-culler/image-utils exec vitest run src/__tests__/sorting.test.ts` | ❌ W0 | ⬜ pending |
| 02-01-07 | 01 | 1 | BROW-07 | unit | `pnpm --filter @photo-culler/desktop exec vitest run src/renderer/src/__tests__/filtering.test.ts` | ❌ W0 | ⬜ pending |
| 02-01-08 | 01 | 1 | BROW-08 | unit | `pnpm --filter @photo-culler/desktop exec vitest run src/renderer/src/__tests__/filtering.test.ts` | ❌ W0 | ⬜ pending |
| 02-02-01 | 02 | 1 | UX-01 | unit (electron-store mock) | `pnpm --filter @photo-culler/desktop exec vitest run src/main/__tests__/store.test.ts` | ❌ W0 | ⬜ pending |
| 02-02-02 | 02 | 1 | UX-02 | unit (event mock) | `pnpm --filter @photo-culler/desktop exec vitest run src/renderer/src/__tests__/drop-zone.test.ts` | ❌ W0 | ⬜ pending |
| 02-02-03 | 02 | 1 | UX-04 | unit | `pnpm --filter @photo-culler/image-utils exec vitest run src/__tests__/scanner.test.ts` | ❌ W0 | ⬜ pending |
| 02-02-04 | 02 | 1 | UX-05 | unit | `pnpm --filter @photo-culler/desktop exec vitest run src/renderer/src/__tests__/photo-grid.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/desktop/vitest.config.ts` — Vitest config for desktop app (jsdom environment for renderer tests)
- [ ] `packages/image-utils/vitest.config.ts` — Vitest config for image-utils package
- [ ] `packages/image-utils/src/__tests__/grouping.test.ts` — grouping pure function tests
- [ ] `packages/image-utils/src/__tests__/scanner.test.ts` — folder scanner tests (mock fs)
- [ ] `packages/image-utils/src/__tests__/sorting.test.ts` — sort comparator tests
- [ ] Web Worker mocking strategy for vitest (workers don't run in jsdom)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Drag-and-drop folder onto window | UX-02 | Requires real Electron window + OS drag events | Launch app, drag folder from Finder onto window, verify folder opens |
| Thumbnail progressive loading visual | BROW-04 | Visual timing/perception | Open 1000+ image folder, verify thumbnails appear progressively without UI freezes |
| Grouping slider responsiveness | CONTEXT | UX feel/performance | Adjust slider, verify groups re-render instantly without scroll position loss |
| 10,000+ image progress indicator | UX-04 | Requires large dataset | Open folder with 10,000+ images, verify progress indicator appears |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
