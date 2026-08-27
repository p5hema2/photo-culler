# CLAUDE.md

## What this is

**Photo Culler** — a local-first Electron desktop app for triaging photo shoots. Open a folder,
review images, rate them 0-5 stars, then batch-execute: permanently delete everything inside a
`1..x` star range and apply the pending rotations to disk.

0 stars and "unrated" are the same thing, and Execute's range always starts at 1 — that is the one
structural safety property in the app, because it means an image nobody has looked at cannot be
deleted.

Opening a folder scans it **recursively**, so a parent holding several shoots can be culled in one
session; the grid shows one collapsible section per folder.

No server, no accounts, no network calls. All state lives beside the user's photos:
`.photo-culler-results.json` (quality scores and pending rotations) and a `.photo-culler-thumbs/`
cache dir — **one of each per directory**, beside the photos they describe. Treat both as user data;
losing them costs real culling work. Ratings are the exception: they live in the image files
themselves, which is a trap of its own below.

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
| `pnpm typecheck` | `tsc` across all packages — real since 1.5.3, and it can fail |

Packaging (from `apps/desktop`): `pnpm build && pnpm package:win` (or `package:mac`, or `package`
for the current platform). Each of those vendors the target's native binaries first — see the
vendoring trap below. Artifacts land in `apps/desktop/dist/`, versioned `0.0.0-dev`.

Toolchain: pnpm 10.32.1 (`packageManager` field), Node >= 20.19.0 locally, Node 22 in CI.

## Architecture

```
main/          Node side: fs ops, native dialogs, permanent delete (unlink), sharp
               rotation, exifr metadata at scan time, exiftool rating writes and
               deep metadata reads, electron-store session, app:// protocol
               handler, the native menu
  |            typed IPC — contract lives in packages/types/src/ipc.ts
preload/       contextBridge -> window.api + window.menuEvents
               (contextIsolation on, sandbox on, nodeIntegration off — keep it that way)
renderer/      React. usePhotoStore.ts is the state brain (~1000 lines).
               Two Web Workers do the pixel work: thumbnail and scoring.
```

Shared packages: `@photo-culler/types` (IPC contract + domain types), `@photo-culler/image-utils`
(scanner, metadata, rating, grouping, sorting), `@photo-culler/tsconfig` (shared TS configs),
`@photo-culler/ui` (empty placeholder).

## Traps

These are the things that will bite you. Most were learned the hard way — check git history before
"simplifying" any of them.

**Shared packages are source-only, resolved by alias.** `@photo-culler/types` and
`@photo-culler/image-utils` set `"main": "src/index.ts"` and have no build step. Consumers get raw
TypeScript through path aliases declared in **four** places: the `main`, `preload`, and `renderer`
blocks of `apps/desktop/electron.vite.config.ts`, plus `apps/desktop/vitest.config.ts`. Add a shared
package or a new deep import and you must register it in every relevant one — a miss fails at
runtime, not build time.

`tsc` deliberately does **not** use those aliases — it resolves through the packages' own manifests
instead, so a new deep import needs one entry in `packages/image-utils`'s `exports` map rather than
two more copies of the alias table. Net effect: a new deep import touches the two vite/vitest
configs plus `exports`. If it works at runtime but `pnpm typecheck` cannot find it, the `exports`
entry is what is missing.

**Renderer state is keyed by absolute PATH; results files are keyed by basename.** Both matter.
With subfolders in play `IMG_001.JPG` is not unique, so every in-memory map (`ratings`,
`qualityScores`, `qualitySubscores`, `rotations`) keys by full path. The files on disk keep their
original basename keying, which is only unambiguous because there is one file per directory — and
which is why every results file written before recursive scanning still loads unchanged.
`projectFolderResults` in `lib/results.ts` is the single place that translates between the two.
`ratings` is in that list of maps but is deliberately **not** in the projection — see the next trap.

**Mutations do not write the results file; they mark a folder dirty.** `markDirty(folder)` queues a
debounced flush that projects state onto that folder's file. Setters used to mirror each field into
the results object by hand, which is how the delete path came to drop two of six fields — a single
Delete stripped `qualitySubscores` and `rotation` from every remaining image in the folder.
`rebuildResults` and `projectFolderResults` in `lib/results.ts` are now the only two projections,
both spread the existing entry so a new `ImageResult` field cannot be lost by omission, and
`results-rebuild.test.ts` guards them. Do not reintroduce inline writes.

**The keep classification and `picks/` are gone, data and all.** Up to 1.5.x images were classified
keep/review/delete, Execute moved the keeps into a `picks/` subfolder, the scanner folded those
images back into the parent section, and the clean-up planner therefore had to accept that a parent's
results file legitimately described its `picks/` children (`describableNames`). All of it went with
the rating rewrite, and no user ever ran keep, so no `picks/` directory exists anywhere. A `picks/`
folder is now an ordinary shoot subfolder with its own results file and its own thumbnail cache: do
not reintroduce the fold-up or the name union to "stay compatible" with data that was never written.

**The image file is the authority for a rating; the results file must never hold a copy.**
`xmp:Rating` plus `EXIF:Rating`/`RatingPercent` in IFD0 is where a rating lives — read by
`readImageMetadata` during `scanFolder` into `ImageFileInfo.rating`, written by
`window.api.writeRating` on every change. `ImageResult` has no rating field and
`projectFolderResults` projects none, on purpose: a second copy would drift the moment Lightroom,
Explorer or a re-import touched a file, and nothing could then say which one won. Two consequences
worth keeping: the renderer's write is optimistic with rollback (`persistRating` in
`usePhotoStore.ts` restores the previous value and surfaces an error, because a star left on screen
over a failed write is a rating the user believes they have), and `settleFileLocks` runs on quit so a
rating typed a moment before the window closes still lands in the file.

**`-P` in the rating write deliberately defeats the thumbnail freshness check.** `writeRating` passes
`-P`, which makes exiftool restore FileModifyDate. Without it every rating keypress bumps the source
mtime, and `LOAD_THUMB_CACHE` discards any thumbnail older than its source: rating 2000 photos would
destroy 2000 cache entries and force 2000 full-size decodes. It would also corrupt burst grouping,
which falls back to `lastModified` where a file has no `DateTimeOriginal`, and evict the
detail-metadata cache, which is keyed on mtime. Suppressing a freshness signal is only safe because a
rating write changes no pixels — do not carry `-P` over to any path that does.

`-P` restores the timestamp at the resolution exiftool recorded it, and that differs by platform:
exact on Windows, truncated to the whole second on macOS. **The guarantee is therefore "never moves
forward", not "bit-identical"** — truncation moves the mtime backwards, which only makes the freshness
check pass more easily. A test asserting bit-equality passes on Windows and fails on macOS; that
already cost one red CI run on v1.6.0, where the shipped code was correct and the assertion was not.

**The rating tags must stay split across exiftool's `tags` and `writeArgs`.** Measured, not
stylistic. A plain `Rating` in `tags` reaches XMP but never IFD0, so Windows Explorer would not see
it. Passing every assignment through `writeArgs` with an EMPTY `tags` object does write both groups —
but loses the mtime, because the library takes a different path and `-P` stops taking effect.
Non-empty `tags` plus the EXIF assignments as explicit args is the only combination that yields
IFD0:Rating, IFD0:RatingPercent and XMP-xmp:Rating with zero drift.

**exifr's `pick` list filters the XMP block out.** `PARSE_OPTIONS` in
`packages/image-utils/src/metadata.ts` sets `xmp: true` and no `pick`, deliberately. Measured over 20
files carrying only `xmp:Rating`: a pick list containing `'Rating'` found 0 of 20, these options found
20 of 20, at the same 0.2-0.5 ms per file. A rating written by Lightroom lives in the XMP packet
alone, so adding a pick list back "to make the scan cheaper" would make exactly the interoperability
case invisible.

**exifr must stay in `externalizeDepsPlugin`'s `exclude` list.** It runs in the MAIN process now,
because the scanner reads ratings there, and `electron-builder.yml` excludes `node_modules` and ships
only the vendored subset (sharp, exiftool-vendored). An externalised pure-JS dependency is therefore
simply absent at runtime: dev and `pnpm build` look fine, and the installed app throws on the first
scan.

**READ_FILE and the rating write share a per-path lock.** `withFileLock` in `main/file-lock.ts`.
exiftool writes by renaming a temp file over the original, and Windows fails that rename while a
handle is open — and the app opens the same image from a dozen places at once: one READ_FILE per
thumbnail worker (there are `hardwareConcurrency` of them), plus the scoring worker, the detail
viewer and its neighbour preload. The lock is keyed by path, so reads of *different* images stay
fully parallel and the thumbnail burst is unaffected; only the set that can actually collide queues.
A new handler that opens an original belongs inside it.

**Deletion is permanent and nothing in the app has undo.** `DELETE_FILES` unlinks; there is no
OS-trash path any more, no restore, and no history. Both entry points confirm first — the
Delete/Backspace dialog naming the count, and the Execute panel naming the star range plus the
visible count it is scoped to. `useKeyboardNav` takes a `modalOpen` flag for the same reason: it
listens on the *document*, so without the gate a Delete aimed at a dialog also reaches the photo
behind it. And Execute's range floor is fixed at 1 in `ExecutePanel.tsx` rather than being a second
slider handle, which is what makes "an unrated image is never deleted" true by construction
(`isInRatingRange`).

**The renderer must never import the `image-utils` barrel.** It aliases
`@photo-culler/image-utils/sorting`, `/grouping`, `/focus`, `/folders` and `/rating` deep, on
purpose: the barrel re-exports `scanner.ts`, which imports `node:fs/promises` and would break the
browser bundle. `metadata.ts` is off limits to the renderer for the same reason — it imports `exifr`
at module scope. Import deep paths in renderer code, and register each new one in **both**
`electron.vite.config.ts` and `vitest.config.ts`.

**`pnpm typecheck` is real as of 1.5.3 — trust it, and keep it honest.** It was a no-op until
then (no package defined the script, so Turbo resolved every task to nothing) and CI plus the
`pre-push` hook were green regardless of type errors. Four things hold it up:

- Every package defines `typecheck`. `apps/desktop` runs `tsc -b`, which follows the `references`
  in `tsconfig.json`; the shared packages run `tsc --noEmit`.
- `composite: true` is required by those references and **forbids `noEmit`**, so the two app
  projects emit declarations only, into `apps/desktop/.tscheck/` — never into `./out`, which is
  electron-vite's output directory. Two build systems writing one folder is not worth debugging.
- `@types/node` is a real devDependency of `apps/desktop` and `packages/image-utils`, whose
  tsconfigs both inherit `types: ["node"]`. The old note in `ci.yml` claimed adding it re-resolves
  vite 6 to 8; that was written one day before `pnpm.overrides` pinned vite, and the pin makes it
  false. Verified: adding it moved only the `@types/node` peer identity in the lockfile's
  resolution keys, not vite's version.
- Module resolution works through the packages' own manifests, **not** through a copy of the Vite
  alias table. `@photo-culler/types` resolves via `main`/`types`; the deep `image-utils` entry
  points resolve via its `exports` map. Add a new deep import and you add it there — do not add
  `paths` to a tsconfig, or the alias table gains yet another copy to drift out of sync.

`packages/types/src/index.ts` re-exports a type from `window.d.ts` for one reason only: that pulls
the file into the program, and with it the `declare global { interface Window }` augmentation. An
editor loads every file in a package and applied it anyway, which is why `window.api` type-checked
in the IDE and produced 30-odd TS2339s the moment `tsc` ran for real. Deleting that re-export
because "nothing imports MenuEvents" breaks the build, not just a lint.

**A missing `@tailwindcss/oxide` native binding does not fail the build — it silently ships broken
CSS.** The loader falls back to a WASI build whose source scanner finds a fraction of the classes:
36 kB of CSS becomes 5 kB, the build exits 0, and the only trace is one
`ExperimentalWarning: WASI` line in the log. It happens when an incremental `pnpm add`/`pnpm install`
leaves `node_modules/.pnpm/@tailwindcss+oxide-win32-x64-msvc@*/…/oxide-win32-x64-msvc/` holding the
`.node` file but no `package.json` — the loader does
`require('@tailwindcss/oxide-win32-x64-msvc/package.json')` and gives up. Fix by deleting that
`.pnpm` directory and re-running `pnpm install`. Sanity check after any dependency change: the
renderer CSS should be ~36 kB, and the build log should NOT mention WASI. Fresh CI installs link
correctly, so released artifacts have not been affected.

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

**Icons are generated, not hand-authored.** `build/icon-source.png` is the master; `pnpm icons`
(`scripts/make-icons.mjs`) derives `icon.ico`, `icon.icns` and the 512px `icon.png` from it.
The script writes both containers itself because `iconutil` is macOS-only and this is a Windows dev
machine — do not reach for it, or for a new dependency, to "fix" that. `build/README.md` carries
the sizes and the prompt the artwork came from.

**`pnpm.overrides` pins vite to 6.4.1, and that pin is load-bearing.** `vite` is not a direct
dependency anywhere — it arrives only as a peer of `electron-vite`, `@vitejs/plugin-react`,
`@tailwindcss/vite` and `vitest`. Of those, only vitest allows vite 8, so any `pnpm add` re-resolves
the tree to vite 8 and the build dies with
`The requested module 'vite' does not provide an export named 'splitVendorChunk'`. electron-vite 3.1
supports vite 6 at most. Remove the override only when electron-vite supports a newer vite.

**`pnpm.supportedArchitectures` must NOT list `os`.** It declares only `cpu: [x64, arm64]`, and that
is deliberate. Listing `os` explicitly makes pnpm match each optional dependency against that literal
list, which silently never matches a **negated** `os` field — `exiftool-vendored.pl` declares
`"os": ["!win32"]`, so it was installed on *no* platform at all, including macOS runners. Omitting
`os` while keeping `cpu` makes pnpm link optional deps for every platform, which is exactly what the
per-target vendoring needs (`node_modules` grows; nothing extra ships, the vendor script prunes).

Cost of getting this wrong: the release build fails at `pnpm vendor:mac` with
`missing exiftool-vendored.pl`. That is the intended failure — loud, before anything is published.

**CI blocks new native addons.** `ci.yml` greps the dependency tree for
`node-gyp|prebuild-install|node-pre-gyp|cmake-js` and fails the build on a hit. `sharp` passes only
because it ships prebuilt binaries. Any dependency that compiles at install time will fail CI.

**Adding an IPC channel touches three files, in order:** `packages/types/src/ipc.ts` (add to
`IPC_CHANNELS` *and* to the `ElectronAPI` interface) -> `src/preload/index.ts` (wire the invoke) ->
`src/main/ipc-handlers.ts` (register the handler). `MENU_COMMANDS` is a closed union for the same
reason — the menu and the renderer handler cannot drift.

**Menu accelerators must use modifiers.** Bare keys (`0`-`5` for rating, `V`, arrows)
belong to the renderer; a menu accelerator swallows them before the window ever sees the keypress.
See the comments in `src/main/index.ts`. The Edit menu's roles are also load-bearing on macOS — they
bind Cmd+C/V/X inside the toolbar search field.

**Two EXIF paths, deliberately.** `exifr` runs in the main process, inside `scanFolder`, over every
image in the tree — the handful of fields grouping, sorting and the rating need, at ~0.3 ms each with
`METADATA_CONCURRENCY` reads in flight. `exiftool` runs as a long-lived child process in the same
process, on demand, for the ONE focused image: that is where the maker-note data lives (AF point,
face detection), which exifr returns as an undecoded blob, and it is also what writes ratings. Don't
merge them — the bulk path must stay cheap, and exiftool must stay off the per-image hot path. It
used to be three paths: a renderer `exif.worker.ts` carried the bulk pass until the scanner took it
over, so a rating could be known before the first thumbnail drew.

**The grid virtualizes a flat row list, not a tree.** `buildRows` in `PhotoGrid.tsx` flattens
folder headers and timestamp groups into one array so a single virtualizer keeps working across
thousands of images spread over many shoots; a nested virtualizer per folder would wreck scroll
estimation. A collapsed folder contributes only its header row.

The row model is also a **pixel contract**, because it is what positions cells. Rows are absolutely
placed at offsets summed from `groupHeight`, so `cellOffsetInGrid` can say where any image sits —
including one whose row is not rendered, which is how returning from the loupe re-centres on the
focused image. That only holds while the DOM matches the model: `GroupRow` pins its header to
`HEADER_HEIGHT` for exactly this reason. Let the header size itself again and every cell in the
grid sits a few pixels above where the model says it does.

The model is also the only thing worth trusting in the commit where the row heights change.
`virtualizer.measure()` invalidates the size cache and *schedules* a render: until that render
commits, every row in the DOM still sits at its old offset and the sizer is still its old height.
So the re-centre that follows a thumbnail-size change reads `cellOffsetInGrid` and
`getTotalSize()`, never rects, and hands a clamped offset to a layout effect that re-applies it
once the taller sizer commits.

**The container scrolls the focused image, never the cell itself.** Grid, loupe strip and vertical
filmstrip each centre it — `lib/focus-scroll.ts`, assigning `scrollTop`/`scrollLeft` rather than
calling `scrollIntoView`, which walks every scrollable ancestor. Two things are load-bearing:
scrolling is **instant**, because Chromium's smooth scroll restarts on each call and never catches
up under key repeat; and a **pointer-driven** focus change does not scroll at all
(`usePointerFocus`). That second rule is not cosmetic: re-centring on a click shifts every other
thumbnail out from under the cursor mid-gesture. It was originally load-bearing for select-on-hover,
which is gone — hover centred the next thumbnail under a resting cursor, which selected it, which
scrolled again, and the list ran to one end. `FocusOrigin` is a one-member union (`'click'`) as a
result; the rule it protects still holds.

**The thumbnail cache has no version folder — the filename suffix is the format marker.**
`.photo-culler-thumbs/<name>.thumb.webp`, flat, 512px longest edge, WebP q0.82. Change
`THUMB_SUFFIX` in `ipc-handlers.ts` whenever the pixel format changes, and keep `THUMB_MIME` in
`lib/thumbnail-geometry.ts` in step with it. That pair *is* the migration story: the loader asks for
one exact filename, so anything a past format left behind is unreachable rather than servable, and
no fallback read path is needed. `partitionCacheEntries` then classifies everything in the cache
directory that is not a current-suffix file — a subdirectory (the `v2/` layout used up to 1.5.1) or
a stray `.thumb.jpg` — as legacy, and the vacuum removes it regardless of whether its image still
exists. Do not reintroduce a version constant; the pre-1.5.2 arrangement needed one only because the
filename could not tell formats apart.

Freshness is decided in the main process against the source file's *current* mtime, so a rotation
invalidates the thumbnail automatically. Note what that does **not** cover: mtime says nothing about
pixel format, which is why an unchanged suffix plus a changed format would serve stale pixels forever.

The size is chosen for physical pixels, not CSS ones. `ThumbnailCell` sizes its canvas backing store
at `box * devicePixelRatio` and scales it back via CSS, so the 'large' preset's 292px box wants 584px
on a 2x display. Drop either half of that and thumbnails go soft on every scaled display no matter
how large they were generated.

**Constants shared with a worker live in `lib/`, never in the worker module.** `thumbnail.worker.ts`
assigns `self.onmessage` at module scope, so importing a *value* from it would execute that on the
main thread — where `self` is `window`. Only `import type` from a worker file.

**Quality-score weights are a persisted contract.** Sharpness 40% / exposure 25% / contrast 20% /
noise 15%, in `src/renderer/src/workers/scoring.worker.ts` and documented in the README. Scores are
cached in every user's results file, so changing the weights silently makes old and new scores
incomparable. They are advisory since 1.6.0 — a badge on the thumbnail and a breakdown in the info
panel, nothing filters or sorts by them — but they are still persisted, so the contract stands.

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

`ci.yml` runs on push/PR to `main` across a macOS + Windows matrix: format:check, lint, typecheck,
test, build, native-addon guard.

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
