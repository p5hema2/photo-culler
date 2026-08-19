# CLAUDE.md

## What this is

**Photo Culler** — a local-first Electron desktop app for triaging photo shoots. Open a folder,
review images, classify them keep/review/delete, then batch-execute: trash the rejects, move the
picks to a `picks/` subfolder, apply rotations to disk.

No server, no accounts, no network calls. All state lives beside the user's photos:
`.photo-culler-results.json` (classifications, scores, rotations, cached EXIF) and a
`.photo-culler-thumbs/` cache dir. Treat both as user data — losing them costs real culling work.

Stack: Electron 41 + React 19 + TypeScript + Tailwind 4, in a pnpm/Turborepo monorepo.

## Commands

Run from the repo root unless noted.

| Command | What it does |
|---|---|
| `pnpm dev` | Launches the Electron window with HMR |
| `pnpm build` | Builds the app (only `apps/desktop` has a real build) |
| `pnpm lint` | ESLint across all packages |
| `pnpm test` | Vitest in `apps/desktop` + `packages/image-utils` |
| `pnpm format` / `pnpm format:check` | Prettier |
| `pnpm typecheck` | **No-op — see Traps below** |

Packaging (from `apps/desktop`): `pnpm build && pnpm package:win` (or `package:mac`, or `package`
for the current platform). Each of those vendors the target's native binaries first — see the
vendoring trap below. Artifacts land in `apps/desktop/dist/`, versioned `0.0.0-dev`.

Toolchain: pnpm 10.32.1 (`packageManager` field), Node >= 20.19.0 locally, Node 22 in CI.

## Architecture

```
main/          Node side: fs ops, native dialogs, shell.trashItem, sharp rotation,
               electron-store session, app:// protocol handler, the native menu
  |            typed IPC — contract lives in packages/types/src/ipc.ts
preload/       contextBridge -> window.api + window.menuEvents
               (contextIsolation on, sandbox on, nodeIntegration off — keep it that way)
renderer/      React. usePhotoStore.ts is the state brain (~1000 lines).
               Three Web Workers do the pixel work: thumbnail, exif, scoring.
```

Shared packages: `@photo-culler/types` (IPC contract + domain types), `@photo-culler/image-utils`
(scanner, grouping, sorting), `@photo-culler/tsconfig` (shared TS configs), `@photo-culler/ui`
(empty placeholder).

## Traps

These are the things that will bite you. Most were learned the hard way — check git history before
"simplifying" any of them.

**Shared packages are source-only, resolved by alias.** `@photo-culler/types` and
`@photo-culler/image-utils` set `"main": "src/index.ts"` and have no build step. Consumers get raw
TypeScript through path aliases declared in **four** places: the `main`, `preload`, and `renderer`
blocks of `apps/desktop/electron.vite.config.ts`, plus `apps/desktop/vitest.config.ts`. Add a shared
package or a new deep import and you must register it in every relevant one — a miss fails at
runtime, not build time.

**The renderer must never import the `image-utils` barrel.** It aliases
`@photo-culler/image-utils/sorting` and `/grouping` deep, on purpose: the barrel re-exports
`scanner.ts`, which imports `node:fs/promises` and would break the browser bundle. Import deep paths
in renderer code.

**`pnpm typecheck` cannot fail.** No package defines a `typecheck` script, so Turbo resolves every
task to nothing. It runs in CI and in the `pre-push` hook and is green regardless of type errors.
The reason it was left that way is documented in `.github/workflows/ci.yml`: making it real needs
`@types/node` plus TS path mappings mirroring the Vite aliases, and adding those re-resolves vite
6 to 8, which breaks electron-vite's peer range. **Do not trust it — verify types by other means
before claiming a change typechecks.**

**Native dependencies are vendored per target.** `scripts/vendor-native-deps.mjs` flattens `sharp`
and `exiftool-vendored` out of pnpm's virtual store into `vendor/<os>-<arch>/node_modules/`, because
electron-builder can't follow pnpm symlinks. `electron-builder.yml` picks the right one with the
`${os}-${arch}` macro, which is expanded **per pack pass** — that is what keeps a Windows installer
from carrying macOS and Linux libvips (it used to, ~115 MB of it).

Three things to know before touching it:
- Use `${os}` (`mac`/`win`/`linux`), **never `${platform}`** — that macro expands to the *host*
  platform, so a build would be correct only on the machine that produced it.
- Pruning is a **deny-list**: only names matching `@img/sharp-*`, `@img/sharp-libvips-*` and
  `exiftool-vendored.{exe,pl}` are filtered. A new platform-neutral dependency is carried along
  automatically.
- `scripts/verify-pack.mjs` runs as `afterPack` and fails the build if foreign-platform binaries
  slipped in. **Keep it.** A miss here builds and installs fine and only dies at runtime with
  `Could not load the "sharp" module`.

This is also why `electron-builder.yml` sets `asar: false` and `npmRebuild: false`. Commits
`cbe4229`, `8cf68b2`, and `f465675` are the original convergence on the sharp arrangement.

**`pnpm.overrides` pins vite to 6.4.1, and that pin is load-bearing.** `vite` is not a direct
dependency anywhere — it arrives only as a peer of `electron-vite`, `@vitejs/plugin-react`,
`@tailwindcss/vite` and `vitest`. Of those, only vitest allows vite 8, so any `pnpm add` re-resolves
the tree to vite 8 and the build dies with
`The requested module 'vite' does not provide an export named 'splitVendorChunk'`. electron-vite 3.1
supports vite 6 at most. Remove the override only when electron-vite supports a newer vite.

**pnpm ignores negated `os` fields.** `exiftool-vendored.pl` declares `"os": ["!win32"]`, and
`pnpm.supportedArchitectures` does **not** force it onto a Windows host the way it does for sharp's
positively-declared platform packages. So a mac bundle cannot be vendored from Windows — the script
exits 1 with an explanation rather than shipping a broken package. CI builds macOS on `macos-latest`,
where `.pl` installs normally.

**CI blocks new native addons.** `ci.yml` greps the dependency tree for
`node-gyp|prebuild-install|node-pre-gyp|cmake-js` and fails the build on a hit. `sharp` passes only
because it ships prebuilt binaries. Any dependency that compiles at install time will fail CI.

**Adding an IPC channel touches three files, in order:** `packages/types/src/ipc.ts` (add to
`IPC_CHANNELS` *and* to the `ElectronAPI` interface) -> `src/preload/index.ts` (wire the invoke) ->
`src/main/ipc-handlers.ts` (register the handler). `MENU_COMMANDS` is a closed union for the same
reason — the menu and the renderer handler cannot drift.

**Menu accelerators must use modifiers.** Bare keys (`1`/`2`/`3` for classification, `V`, arrows)
belong to the renderer; a menu accelerator swallows them before the window ever sees the keypress.
See the comments in `src/main/index.ts`. The Edit menu's roles are also load-bearing on macOS — they
bind Cmd+C/V/X inside the toolbar search field.

**Two EXIF paths, deliberately.** `exifr` runs in a renderer worker over every image in the folder
for the fields sorting and grouping need. `exiftool` runs as a long-lived child process in the main
process, on demand, for the ONE focused image — that is where the maker-note data lives (AF point,
face detection), which exifr returns as an undecoded blob. Don't merge them: the bulk path must stay
cheap, and exiftool must stay off the per-image hot path.

**Thumbnails are cached per format version.** `.photo-culler-thumbs/v2/<name>.thumb.jpg`. Bump
`THUMB_CACHE_VERSION` in `ipc-handlers.ts` whenever the pixel format changes; the vacuum then deletes
everything that is not the current version directory. Freshness is decided in the main process
against the source file's *current* mtime, so a rotation invalidates the thumbnail automatically.

**Quality-score weights are a persisted contract.** Sharpness 40% / exposure 25% / contrast 20% /
noise 15%, in `src/renderer/src/workers/scoring.worker.ts` and documented in the README. Scores are
cached in every user's results file, so changing the weights silently makes old and new scores
incomparable.

**Results-file writes are queued and epoch-guarded.** `ipc-handlers.ts` serializes writes per file;
`usePhotoStore.ts` tags pending saves with an `openEpochRef` so a save queued for a folder you've
left can't land in the new folder's file. Rescan and clear paths must drop queued writes first
(`cancelPendingSave`, then `clearResults`) or the queue drains straight back over the deleted file.

**The legacy results filename is migrated on read.** Pre-1.2.0 folders hold
`photo-culler-results.json`; `readResultsFile` renames it to the dotfile form on first load.
`scanner.ts` still excludes the old name explicitly. Don't drop either path — it would strand
existing users' work.

## Release process

**The git tag is the single source of truth for the version.** Never hand-edit
`apps/desktop/package.json`'s version — it stays `0.0.0-dev` in the repo and CI overwrites it.

```bash
git tag v1.3.0
git push origin v1.3.0
```

Pushing a `v*` tag triggers `.github/workflows/build.yml`: `scripts/set-version.mjs` stamps the
version from `GITHUB_REF_NAME`, then it packages macOS (dmg + zip, x64 + arm64) and Windows (nsis
x64) and publishes a GitHub Release with the installers attached.

`set-version.mjs` also accepts an explicit argument for local testing
(`node scripts/set-version.mjs 1.3.0`) — but that **modifies the tracked package.json**, so revert
it before committing.

`ci.yml` runs on push/PR to `main` across a macOS + Windows matrix: format:check, lint, typecheck
(no-op), test, build, native-addon guard.

## Conventions

- **Branch:** work directly on `main`. No PR flow in this repo's history.
- **Commits:** conventional commits — `feat:`, `fix:`, `chore:`, `ci:`, with optional scope
  (`fix(win):`, `feat(dx):`).
- **Formatting:** Prettier — single quotes, semicolons, trailing commas, 100 cols, 2-space indent,
  LF endings (enforced by `.gitattributes`). Markdown is in `.prettierignore`.
- **Hooks:** `pre-commit` runs lint-staged; `pre-push` runs format:check, lint, typecheck, build.
  Don't bypass with `--no-verify`.
- **TypeScript:** strict, plus `noUncheckedIndexedAccess` — hence the `!` assertions throughout the
  pixel-loop code. `no-explicit-any` is a warning; don't add new ones.
- **Tests:** Vitest. Main-process tests run in the `node` environment, renderer tests in `jsdom`
  (`environmentMatchGlobs` in `apps/desktop/vitest.config.ts`). Pure logic in `packages/image-utils`
  is the easiest place to test — prefer putting testable logic there.

## `.planning/`

A frozen record of the original GSD-driven build (roadmap, phase plans, research notes). It is
**stale** — `STATE.md` claims phase 2 of 4 while the shipped app has all four phases' features and
eight release tags. Useful for design rationale and the "why" behind early decisions.
**Do not update it.**
