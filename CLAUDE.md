# CLAUDE.md

## What this is

**Photo Culler** — a local-first Electron desktop app for triaging photo shoots. Open a folder,
review images, rate them 0-5 stars, then batch-execute: permanently delete everything inside a
`1..x` star range. Deleting is all Execute does — a rotation lands on disk the moment the key is
pressed.

0 stars and "unrated" are the same thing, and Execute's range always starts at 1 — that is the one
structural safety property in the app, because it means an image nobody has looked at cannot be
deleted.

Opening a folder scans it **recursively**, so a parent holding several shoots can be culled in one
session; the grid shows the folder TREE, indented and collapsible, with the thumbnail and scoring
counters on each folder's own header. Folders can be created, deleted and moved between from the
right-click menu, and a selection can be dragged onto a folder to move it.

Videos are listed alongside the photos and can be viewed, renamed and deleted — but never rated,
scored or rotated. Renaming is the second thing that changes a user's files: right-click a photo or
a section header and the whole shoot can be renamed to its capture time, in the exact format
`H:\rename-by-date` produces.

No server, no accounts, no network calls. All state lives beside the user's photos:
`.photo-culler-results.json` (quality scores and nothing else) and a `.photo-culler-thumbs/`
cache dir — **one of each per directory**, beside the photos they describe. Treat both as user data;
losing them costs real culling work. Ratings and rotation are the exceptions: both live in the image
files themselves, and each is a trap of its own below.

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
main/          Node side: fs ops, native dialogs, permanent delete (unlink), exifr
               metadata at scan time, exiftool rating writes, orientation-tag
               rotation and deep metadata reads, electron-store session, app://
               protocol handler, the native menu
  |            typed IPC — contract lives in packages/types/src/ipc.ts
preload/       contextBridge -> window.api + window.menuEvents
               (contextIsolation on, sandbox on, nodeIntegration off — keep it that way)
renderer/      React. usePhotoStore.ts is the state brain (~1000 lines).
               Two Web Workers do the pixel work: thumbnail and scoring.
```

Shared packages: `@photo-culler/types` (IPC contract + domain types), `@photo-culler/image-utils`
(scanner, metadata, rating, orientation, grouping, sorting), `@photo-culler/tsconfig` (shared TS
configs), `@photo-culler/ui` (empty placeholder).

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
two more copies of the alias table. If it works at runtime but `pnpm typecheck` cannot find it, the
`exports` entry is what is missing.

"Every relevant one" is the operative word: check which places actually resolve the import rather
than adding four entries reflexively. `@photo-culler/image-utils/orientation`, imported by the main
process only, needed the `exports` entry and **nothing else** — the `main` block and
`vitest.config.ts` each carry a whole-package `'@photo-culler/image-utils'` alias, and Vite
aliases are prefix matches, so a deep path falls through the specific entries to that one. The
`renderer` block is the exception that needs each deep path spelled out, because it has no such
catch-all, on purpose — see the barrel trap below.

**Renderer state is keyed by absolute PATH; results files are keyed by basename.** Both matter.
With subfolders in play `IMG_001.JPG` is not unique, so every in-memory map (`ratings`,
`qualityScores`, `qualitySubscores`) keys by full path. The files on disk keep their
original basename keying, which is only unambiguous because there is one file per directory — and
which is why every results file written before recursive scanning still loads unchanged.
`projectFolderResults` in `lib/results.ts` is the single place that translates between the two.
`ratings` is in that list of maps but is deliberately **not** in the projection — see the next trap.

**Mutations do not write the results file; they mark a folder dirty.** `markDirty(folder)` queues a
debounced flush that projects state onto that folder's file. Setters used to mirror each field into
the results object by hand, which is how the delete path came to drop two of six fields — a single
Delete stripped `qualitySubscores` and the then-pending `rotation` from every remaining image in
the folder.
`rebuildResults` and `projectFolderResults` in `lib/results.ts` are now the only two projections,
both spread the existing entry so a new `ImageResult` field cannot be lost by omission, and
`results-rebuild.test.ts` guards them. Do not reintroduce inline writes.

**Rescan must NEVER delete a results file.** Up to 1.6.4 it did: `rescan` called `clearResults`,
whose comment read "forget everything below here", and it unlinked the file in *every* directory
below the root. On the user's 21 851-image library that discarded every quality score in one
keypress and cost roughly 128 GB of re-reading to rebuild them. Note the asymmetry that makes this
worse than it sounds: **ratings survive anything**, because they live in the photos themselves, so
the only thing a results file holds is the one thing that exists nowhere else. There is no undo and
no second copy.

What F5 does now, with no confirmation dialog, is `rescanFolder` in `usePhotoStore.ts`: re-walk the
tree, take up new images, drop ones that are gone, prune what is *orphaned* — records and cached
thumbnails whose image is no longer on disk, plus anything a past cache format left behind — and
keep everything else. `PRUNE_FOLDER` ('fs:prune-folder') is that step, and `planCleanUp` /
`applyCleanUp` are still its tested implementation. It removes nothing that describes a file the
user has not already removed, which is why no dialog is needed and why the old
`Clean Up Folder…` menu item and `'clean-up-folder'` command are gone rather than kept alongside.

The capability given up in exchange, knowingly: **nothing in the UI can force a quality-score
recompute any more.** Deleting `.photo-culler-results.json` by hand is the escape hatch. Do not add
a menu item for it — that item is exactly the 128 GB mistake with a friendlier label. `CLEAR_RESULTS`
had one caller, so the channel, its `ElectronAPI` member, the preload wiring and the handler are all
gone.

**Pruning now sits in the F5 path, and that is what makes the write queue load-bearing.** It used to
be a menu command nobody ran; it is on the key people press between shoots. A debounced results
write that lands after a prune re-writes the records it just removed, and both halves have to stop
that:

- **Main:** `dropQueuedWrite` is called for **every** results file `plan.results` names, not just
  the root's. `CLEAR_RESULTS` looked up exactly one queue key, so a queued write for a *subfolder*
  drained after the prune and resurrected that folder's orphans. Only the files with orphans,
  though — dropping every queue in the tree would throw away somebody's fresh quality score.
- **Renderer:** `rescanHoldsRef` holds *all* results writes for the duration of a rescan, because
  `writeFolder` projects state over `resultsRef`, which until the re-walk reloads still holds the
  very records being removed. It is a count, so two F5s inside one prune window cannot un-hold each
  other, and it is raised **before the first await** — `flushRatingWrites` awaits real IPC, and a
  scoring result arriving in that window would otherwise schedule a debounce while the hold was
  still off and fire it mid-prune. `scheduleSave` checks the hold at schedule time only, which is
  sufficient *because* of that ordering plus `cancelPendingSave` clearing any timer already running.
  `releaseHeldSave(keep)` lets the held marks through afterwards, projected over the reloaded
  results, and re-stamps the epoch only when the rescan finished in its own tree.

Two consequences worth knowing. A rescan awaits pending **rating** writes before walking, because the
image file is the authority for a rating and the walk reads it back — otherwise the walk reads the old
value and the write lands after it. And a rescan does discard in-memory quality scores that had not
reached disk (one debounce window, plus anything scored while the prune ran): the re-walk rebuilds
`qualityScores` from the files, and the scoring pass recomputes precisely those because they are then
absent. `rescan.test.ts` guards all of it.

**The grid renders a TREE as of 1.8.1, and it is still ONE FLAT ROW LIST.** Up to 1.8.0 the sections
were flat and labelled with the path relative to the root, so a card read as one row saying
`2026-07-03 - Heidewitzka Festival/DCIM/100_PANA`. That is a path, not a structure: it cannot be
collapsed at the shoot level, it has nowhere to hang "new subfolder", and every level of nesting
makes the label longer instead of the layout deeper.

`tree.ts` builds the structure; `buildRows` still flattens it, because the virtualizer needs one
array and CLAUDE.md's row-model trap has not moved. Four things are load-bearing:

- **A folder row costs a flat `FOLDER_HEADER_HEIGHT` at every depth.** `cellOffsetInGrid` re-derives
  every row's offset by summing heights — that is how it answers for an image whose row is not
  rendered, which is what re-centres the grid on return from the loupe — and it charges 40 px with
  no depth term. So the indent is PADDING INSIDE the row. A taller row for a deeper folder would
  silently move every cell below it.
- **A collapsed node hides its whole SUBTREE.** That is the behavioural difference from the flat
  list, where one section's collapse could not affect another's. `visibleNodes` does it once, and
  `buildRows`, `sortedFlatImages` and `navGroups` all read it.
- **`groupIndex` still advances past everything hidden.** It is not row bookkeeping — it is the
  thumbnail fetch priority — and keeping it aligned with the UNCOLLAPSED numbering is what stops
  collapsing one shoot from re-prioritising every folder after it.
- **Descending reverses SIBLINGS, not the list.** A flat list could simply be reversed; a tree
  cannot, because a child may never sort above its parent. `direction` therefore means the only
  thing it can mean here, and `buildFolderTree` applies it per level.

**The scan reports DIRECTORIES as well as images, and that is not redundant.** `scanFolder` returns
`{ images, directories }` since 1.8.1. A folder with no photos anywhere below it has no image to
derive it from — and it still has to appear, because it is where a moved file can be dropped and
where a subfolder the user has just created shows up. Hidden directories are excluded, which is what
keeps `.photo-culler-thumbs` out of the tree.

**The thumbnail and scoring counters live on the folder headers, and each has its OWN denominator.**
They were one pair in the toolbar until 1.8.1; with a tree that number cannot be split back up, and
the question a user has — "is this shoot done?" — is per folder. `rollUpCounts` sums a folder and
everything below it.

The denominators are the subtle half. A video is never scored, and a container Chromium cannot demux
never gets a poster frame, so a counter measured against the plain image count would sit at 25/28
for ever and read as unfinished work that is in fact finished. `FolderOwnCounts` therefore carries
`scoreable` and `thumbable` beside `scored` and `thumbs`, and the store fills them from
`isVideoFile` / `isPlayableVideo`. Both pairs are clamped: a thumbnail outlives its image until the
next vacuum, and 41/40 is a bug report.

**Renaming during a scan is allowed, and the mechanism is a REMAP rather than a wait.** Up to 1.8.0
`planRename` refused while `isScanIncomplete`, because the deferred metadata pass re-reads BY PATH
and `readImageMetadata` answers a miss with `{}` — so a renamed image silently lost its date, its
dimensions and its RATING for the rest of the session. That was the only defence the renderer had,
and it made renaming impossible for the minutes a large library takes to scan, which is exactly when
the user wants it.

The pass and the rename both run in the MAIN process, so the rename now tells the pass where the
files went. `main/scan-pass.ts` holds the very `ImageFileInfo` objects the pass is filling in — the
array is shared, not copied — and `remapScanPass` rewrites the entries it has not reached. Two
details:

- **It remaps before renaming, for every PLANNED entry**, not only the ones that succeed. A file
  whose rename is refused keeps its old path and costs one image's metadata in a case that is
  already an error; the reverse — moving a file the pass still thinks is elsewhere — costs it
  silently in the common case.
- **`executeRename` re-reads the renamed images and returns them** in `RenameExecuteResult.refreshed`,
  but only when a pass was running. `METADATA_CONCURRENCY` is 8, so up to eight files can be mid-read
  at the instant they move and come back empty; rather than work out which, re-read them all. The
  renderer merges them through `mergeMetadata` and `mergeRatings`, and `userRatedRef` is re-keyed
  BEFORE that updater — left until after, every refreshed rating would win and a star typed a moment
  ago would be rolled back to what the file still holds.

**The context menu closes on a CHANGE to the visible order, not on its identity.** `visibleOrder` is
a fresh array on every render that touches the folder tree, and during a scan that is every metadata
batch — one every 400 ms. Its CONTENTS barely move: `sortImages` orders by filename, which a batch
does not change, and `groupByTimestamp` only re-cuts group boundaries inside an already-sorted list.
`syncVisibleOrder` is fine with the churn; the menu was not, and was being shut two or three times a
second for the whole scan. `visibleOrderKey` is the value-identity that fixed it.

**Moving is renaming, and shares the executor deliberately.** `planMoves` and `planRenames` differ in
exactly one thing — where the base name comes from, the clock or the file's own stem — so they share
`planWith`, and with it the namespace allocation, the collision suffix, the companion pass and
`assertNoOverlap`. A move therefore carries the RAW and the XMP sidecar too, cannot overwrite
anything, and is carried out by the same `executeRename` that re-keys the results file and moves the
thumbnail cache. Two entry points, one preview panel, one executor: a second dialog would be a second
place for the confirmation wording to drift.

**A recursive folder delete is the most destructive thing this app can do, and its confirmation
counts what MAIN walked.** More destructive than Execute, which is bounded by a star range, and than
the Delete key, which names the images it removes. `statFolder` walks the directory itself rather
than deriving numbers from `state.images`: a folder showing 40 JPEGs may hold 40 RAW files, 40
sidecars and a thumbnail cache, and all of it goes. Two rules in that walk:

- every file is counted and its bytes totalled, hidden or not — all of it is being deleted;
- but a file inside a HIDDEN directory never counts as media, because `.photo-culler-thumbs` is full
  of `.webp` files and `isMediaFile` says yes to those. Without that the dialog claimed the app
  displayed four photos where it displayed two.

`deleteFolder` refuses three things in main as well as in the menu that offers it — a path outside
the opened tree, the root itself, and anything that is not a directory. The renderer decides what to
OFFER; main decides what to DO.

**`drawImage` on an evicted ImageBitmap unmounts the whole grid.** `storeBitmap` closes the
least-recently-used entry once the cache passes MAX_CACHED_BITMAPS, and the comment there says an
evicted visible thumbnail is "not fatal" because the cell re-renders as 'loading'. It is not fatal
only because `ThumbnailCell` now checks: the draw effect can still run once more with the value it
captured, and `drawImage` on a detached bitmap throws `InvalidStateError` — which took the entire app
to a blank window on a 1500-image folder. A closed ImageBitmap reports zero dimensions, which is the
only way to ask.

**Videos are listed, but they are not photos, and five paths say so separately.** `media.ts` is the
single answer to "is this a video?" — deliberately NOT a field on `ImageFileInfo`, because the
extension is already carried there and a second copy of one fact is a second thing to keep honest.
What follows from it:

- **No rating.** `setRating` returns early for a video, and the check is in the STORE rather than
  only in the cell that hides the stars, because the 0-5 keys act on the whole selection and a
  selection routinely mixes stills and clips. The reason is not taste: a rating lives in the file,
  and ExifTool writes XMP into an MP4 by rewriting the whole container — seconds and gigabytes per
  keypress on a real clip. A consequence worth stating: since Execute's range starts at 1 and an
  unrated file is 0, **Execute can never delete a video.** The Delete key still can, with its dialog.
- **No quality score.** The scoring worker's pixel loops assume one frame, and a score from one
  arbitrary frame of a clip would look exactly like a photo's and mean nothing. It would also cost a
  whole-file read of a 2 GB file.
- **No rotation.** `ROTATABLE_EXTENSIONS` already refused everything but JPEG, so this needed nothing.
- **No exifr.** `scanFolder` skips the metadata read for a video: exifr reads stills, and handing it
  an MP4 buys two seeking reads and a parse attempt for a guaranteed miss. A video's capture time
  lives in the `moov` atom, which only exiftool reads, and the only thing that needs it is the rename
  planner — which asks exiftool directly, in bulk, on demand. Until then grouping falls back to
  `lastModified`, which for a file straight off a card IS the capture time, because the camera wrote it.
- **No thumbnail worker.** See the next trap.

**A video's poster frame is decoded on the MAIN THREAD, and there is no ffmpeg — that was a legal
decision, not a technical one.** A Web Worker has no `HTMLVideoElement`, so `lib/video-poster.ts`
creates a `<video>`, seeks a second in, and draws one frame — bounded to two at a time, because
unlike every other thumbnail this competes with React for the main thread. It produces the same
512px WebP the worker does, so the disk cache needs no second format marker.

That limits posters to what Chromium can demux: MP4, M4V, MOV and WebM. AVI, MKV, MTS, M2TS and 3GP
are listed, renamed and deleted like anything else and get a film-strip tile with their extension.
ffmpeg would fix that, and all three off-the-shelf npm packages were examined and rejected — the
binaries themselves, not the metadata:

| package | npm `license` says | the binary says |
|---|---|---|
| `@ffmpeg-installer/darwin-arm64` | *(a URL)* | `--enable-nonfree` → "nonfree and **unredistributable**" |
| `@ffmpeg-installer/win32-x64` | `GPLv3` | a 2018 **zeranoe** build; zeranoe shut down in 2020, so the corresponding source GPLv3 §6 obliges you to convey cannot be produced |
| `@ffmpeg-installer/darwin-x64` | `LGPL-2.1` | actually `--enable-gpl --enable-version3` — mislabeled |
| `ffmpeg-static` | — | same nonfree arm64 binary, and its install hook fetches only the HOST platform, which per-target vendoring cannot use |

Shipping the first is a copyright violation with no compliance path. BtbN's builds have no macOS
assets at all. The clean route is a minimal LGPL ffmpeg built in-house and published as three
platform packages — ~10 MB each, since only the needed demuxers and decoders go in — and it is a
subproject, not a dependency bump. **Do not "just add ffmpeg-static".**

**`app://` answers Range requests, and that is load-bearing rather than tidy.** `main/protocol.ts`
used to be `net.fetch('file://…')`, which streams a whole file and says nothing about ranges. That is
fine for an image and useless for a video: Chromium's media stack will not seek in a resource it
cannot request a slice of, so `currentTime = 1` on a 2 GB clip either does nothing or buffers the
whole file into memory. Both the poster frame and the loupe's player depend on seeking. `Accept-Ranges:
bytes` on the plain response is the half that makes Chromium ask at all — without it the 206 branch
is dead code.

Images do NOT come through here: `useFullImage` reads them over `READ_FILE`, which takes the per-path
lock that stands between a read and exiftool's rename-over-the-original on Windows. A video is
different — this app never writes one — so there is nothing to serialise against, and streaming is the
only way not to pull gigabytes through IPC. `appUrlFor` in `lib/app-url.ts` is the other end of the
format; the encoding it replaced was **wrong on Windows** and had simply never been fetched.

**Folder sections are ordered by NAME as of 1.8.0, reversing a documented decision.** Up to 1.7.0
`groupByFolder` emitted sections in `Map` insertion order — i.e. by each folder's first image under
the active sort — and `folders.test.ts` pinned it with "folder order follows the image sort, not the
alphabet". It reads fine for one card and scrambles a parent holding several shoots the moment two
folders interleave in time. A shoot is a place in a tree, so the tree decides.

Two details that are not obvious. The comparison is **segment by segment**, not on the whole string:
`' '` (0x20) sorts before `'/'` (0x2f), so a plain string compare puts `/root/a b` between `/root/a`
and `/root/a/z` and lifts a sibling in between a parent and its own child. And `direction` REVERSES
the finished list rather than flipping the comparator, so descending is the exact mirror of ascending
and a subtree stays contiguous in both.

**Renaming: `fs.rename` overwrites its destination silently, and the planner is what makes that
safe.** On POSIX and on Windows alike, and Node exposes no no-replace flag — so a naive rename batch
is an unconfirmed, unrecoverable delete, worse than the Delete key, which at least shows a dialog.

`planRenames` in `packages/image-utils/src/rename.ts` closes it with one rule: the namespace of each
target directory is seeded with **everything already in it**, and a name is NEVER released — not even
when the file holding it is itself about to move away. That costs an occasional unnecessary `~hash`
suffix where two files would have swapped names, and it buys the invariant that

> no entry's target path equals another entry's source path, and no two entries share a target path.

So there are no rename cycles, nothing is overwritten, and the executor is a plain loop rather than a
two-phase temp-name dance. `assertNoOverlap` checks it rather than trusting it. `renameNoReplace` in
`main/rename.ts` still reserves each name with `open(dest, 'wx')` first, because the plan was computed
against a listing that is a moment old — `link()` would also give an atomic EEXIST and is unusable
here, because SD cards are exFAT and have no hard links.

**The naming rules are a contract with a program outside this repo.** `naming.ts` is a port of
`H:\rename-by-date\lib\rename-by-date.pl`, and `naming.test.ts` proves it: the Perl's own
`parse_stamp` and `stamp_epoch` were extracted and run over 937 inputs — 37 edge cases plus 900 from
a seeded PRNG — and the TypeScript matched all 937. `__tests__/fixtures/naming-golden.ts` holds those
answers so the guarantee survives without Perl and without the H: drive, which CI has neither of.
**Regenerate it only by re-running the differential**, never by pasting in what this codebase
currently produces — that turns a contract into a snapshot of a bug.

Format: `YYYY-MM-DD HH-MM-SS-fff`. The timezone is discarded (wall-clock is what the photographer
remembers), fractional seconds pad on the RIGHT (`.5` is 500 ms), the tag ladder puts every `SubSec`
rung DIRECTLY above its plain sibling (the original shell script had those swapped and threw away
milliseconds), and anything outside 1990-2100 is refused rather than named — exiftool prints
`0000:00:00 00:00:00` for an empty tag and a reset camera clock reports 1970.

Collisions take a **content-hash suffix, never a counter**. Straight from the Perl, and it applies
here twice over: a counter is handed out in directory-listing order — the filesystem's, name-ordered
on NTFS and hash-ordered on ext4 — and it shifts when a file is deleted, so a photo inherits the
position, and in this app the CULL VERDICT, of another. A burst shot on a camera that writes no
`SubSec` rung gives every frame the same second, so this is the normal case, not the edge case.

**A rename carries files the app cannot even see, and skipping that is silent data loss.** The
scanner admits stills and videos; it never lists `IMG_1234.ARW`, `IMG_1234.ARW.xmp` or the
AppleDouble `._IMG_1234.JPG` every Mac-formatted card collects. Lightroom, Capture One and Bridge all
pair RAW with JPEG **by stem**, and an XMP sidecar is where a Lightroom-first user's ratings and
develop settings actually live. Renaming the JPEG alone dissolves both, permanently and without a
word. So the planner's companion pass reads the full directory listing and takes them along under the
same base name and the same suffix, matching on the stem plus a literal dot so `IMG_1` cannot swallow
`IMG_12.JPG`, and offering each candidate only to the group with the LONGEST matching stem so a
sidecar cannot follow the wrong photo.

Two related notes. The planner groups by `(source folder, stem)` BEFORE looking up dates, which is
where it diverges from the Perl: that tool splits dated from undated first, so a RAW whose date
exiftool could not read would be left behind while its JPEG moved. And the listing handed to the
planner must be the FULL directory, not just the media — a `.DS_Store` or a text note occupies a
target name just as effectively as a photo.

**The results file and the thumbnail cache are re-keyed in the MAIN process, inside the same pass as
the rename.** Both are keyed by BASENAME, and the results file holds the one thing that exists nowhere
else. Left un-rekeyed, three separate paths destroy it without a dialog: the next F5's prune sees the
old record as an orphan (`planCleanUp` cannot tell a rename from a deletion), one Delete anywhere in
the folder drops all of them via `rebuildResults`, and `projectFolderResults` actively writes an EMPTY
record over the score on the next save. Doing it in the renderer instead would mean a crash between
the two loses the score.

The thumbnail is worth moving rather than dropping: **a rename does not change the source's mtime**,
so `LOAD_THUMB_CACHE`'s freshness test still passes and the moved entry stays valid. One `rename` per
file against one full decode per file. `moveThumbCache` checks the source exists BEFORE `mkdir`, or it
leaves an empty `.photo-culler-thumbs/` in every folder a rename touches.

**The renderer's rename quiesces in a specific order, and two steps are not housekeeping.**
`applyRename` follows `rescanFolder`'s choreography — hold results writes before the first await,
because `flushRatingWrites` awaits real IPC and a scoring result arriving in that window would
schedule a debounce while the hold was still off — plus two of its own:

- **Rating writes are FLUSHED, not cancelled.** The 300 ms debounce is keyed by the OLD path; left to
  fire after the rename it calls `writeRating` on a file that is gone, the write fails,
  `persistRating` rolls the star back, and the rating is gone from the only place it lived.
- **`thumbnailWorker.rekey(old, new)` runs BEFORE the rename, not after.** It bumps the old id's
  epoch, and that is the load-bearing half: a worker response already in flight for the pre-rename
  path would otherwise land and `saveThumbCache(oldPath)` would re-create the very cache file main
  just moved, where nothing but the next vacuum would find it. `rekey` rather than `invalidate`
  because the bytes did not change — throwing away hundreds of decoded thumbnails costs a decode each
  for nothing.

Then ONE `setState` re-keys `images` (`path`, `name` **and `folder`** — consolidation moves a file to
a different directory, and `folder` is `dirname(path)` by contract and is what `groupByFolder`
sections by), `ratings`, `qualityScores`, `qualitySubscores`, `focusedImageId`, `selection` and
`selectionAnchor`; then `userRatedRef` and `resultsRef`; then `fileRevision`, for the two path-keyed
caches that have no other way to learn. A rename is also REFUSED while `isScanIncomplete`: the
deferred metadata pass re-reads by path, `readImageMetadata` returns `{}` rather than throwing, and
the affected images would silently lose their dates and ratings for the rest of the session.

**Rename target paths are length-checked on Windows.** MAX_PATH is 260 and Node does not auto-prefix
`\\?\`. The generated stem is 23 characters plus the extension, which is often LONGER than the camera
name it replaces (`P1000123.JPG` is 12), so a deep tree that works today can be pushed over by the
rename. The limit subtracts 32 for the thumbnail cache path on top — without that headroom the rename
succeeds and thumbnails quietly stop working for those files, which is a far worse failure than
refusing the name.

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
rating write changes no pixels — do not carry `-P` over to any path that does. `rotateImage` in the
same file is that path, and the next trap is about it.

`-P` restores the timestamp at the resolution exiftool recorded it, and that differs by platform:
exact on Windows, truncated to the whole second on macOS. **The guarantee is therefore "never moves
forward", not "bit-identical"** — truncation moves the mtime backwards, which only makes the freshness
check pass more easily. A test asserting bit-equality passes on Windows and fails on macOS; that
already cost one red CI run on v1.6.0, where the shipped code was correct and the assertion was not.

**Rotation is an EXIF Orientation tag change, and `-P` must NOT be passed for it.** Same tool, same
file, one flag, opposite requirement — the one place in this codebase where copying the neighbouring
call is the bug. `writeRating` needs `-P` because a rating changes no displayed pixels, so the
mtime must not move; `rotateImage` must NOT pass it because a rotation changes which way up the
photo is, and the moving mtime is exactly the signal `LOAD_THUMB_CACHE` reads to decide the cached
thumbnail is stale. Here invalidation is the goal rather than the cost. The handler deletes the cache
file as well (`removeThumbCache`, whose other caller is the delete path) — one unlink, which closes
the same-millisecond tie and stops a thumbnail nobody can serve sitting on disk until the next
vacuum. `rotate.test.ts` asserts the mtime moves FORWARD, the mirror image of the rating write's
assertion.

Why the tag rather than the pixels, measured on one 6102 kB camera JPEG:

| | `sharp(...).rotate(90).withMetadata()` — up to 1.6.x | changing the Orientation tag |
|---|---|---|
| duration | 225 ms | **31 ms** |
| file size after | 6102 kB -> **1470 kB** | 6102 kB -> 6102 kB |
| bytes changed | 6 226 940 | **1** |
| embedded MPF preview | **destroyed** | intact |

The right-hand column is the STEADY STATE — every turn after the first. The FIRST exiftool write to
a camera original also drops the padding the camera reserved in its EXIF block, so that one shrinks
the file: measured on a Panasonic DC-S5D frame, 4 827 648 -> 4 811 050 bytes, all of it APP1 going
51 610 -> 35 012. Nothing is lost — 236 tags identical, the IFD1 thumbnail and the 438 789-byte MPF
preview both intact, and `sharp(...).raw()` bit-identical either side — and every rotation after it is
0 bytes of size change and exactly 1 byte of content. `rotate.test.ts` takes a priming turn for this
reason, though its comment names sharp's EXIF block rather than camera padding, because its fixture
is built with sharp. Worth knowing before someone measures one rotation of one camera file and
concludes the write is lossy.

So the old path re-encoded at sharp's default JPEG quality, threw away ~76% of the photo, and
stripped the preview — which permanently drops that file off the fast thumbnail path. It was latent
data loss rather than a reported bug only because the user rotates about one image in 3000. Three
consequences of the change worth knowing:

- **The results file no longer holds a rotation**, and `ExecuteOptions.applyRotations`,
  `rotatedCount` and the `ROTATE_FILES` batch channel are gone with it. `ImageResult` is
  `qualityScore` + `qualitySubscores`, full stop. There is no pending state, so undo is just a
  turn the other way and is lossless by construction. A legacy `rotation` sitting in a 1.6.x
  results file is carried forward untouched by `projectFolderResults`' spread of `prior` and
  otherwise ignored — an unexecuted rotation from that era is silently forgotten, which is cheaper
  than a migration for a field one keypress in 3000 ever wrote.
- **JPEG only, and the allow-list is about the DISPLAY end, not the write end.** ExifTool writes an
  orientation tag into a PNG (eXIf chunk), a WebP (EXIF chunk) and a TIFF (its own IFD0) exactly as
  losslessly. But the renderer applies orientation at decode time —
  `createImageBitmap(…, { imageOrientation: 'from-image' })` in the thumbnail worker, the browser's
  own `image-orientation` default for the `<img>` — and that is only verified for JPEG here
  (Chromium cannot decode TIFF at all). A tag change the display path ignores is a rotation that
  silently does nothing, so `ROTATABLE_EXTENSIONS` refuses the rest with an error the user can
  read. Adding a format means verifying the decode side first. Re-encoding them with sharp is the
  data loss this replaced.
- **The current value is read in the main process, not passed in by the renderer**, so the read and
  the write sit inside one `withFileLock` pass. The renderer's copy comes from the scan and is
  stale the moment anything else has touched the file, and computing the next value from a stale one
  would undo that change. The table itself is `packages/image-utils/src/orientation.ts`: two
  four-cycles, `1->6->3->8` and `2->7->4->5`, because a quarter turn can neither add nor remove a
  reflection — falling back to the un-mirrored cycle would silently un-mirror a file another tool
  flipped.

One benign cost, worth recording so the next person profiling the thumbnail sweep is not surprised:
after a rotation that file loses the embedded-preview fast path **permanently**. ExifTool writes
IFD0 only, the MPF preview keeps its own orientation, and `checkMpfPreview` rejects a preview whose
orientation differs from its parent's (`'orientation-mismatch'`) — deliberately, or the grid would
show it sideways. Display stays correct; the thumbnail just costs a 6.2 MB read instead of ~500 kB
from then on.

**A rotation changes a file's BYTES under an UNCHANGED PATH — which is the one thing every path-keyed
cache in the renderer cannot see.** There are three, and each is told separately:

| cache | keyed by | told by |
|---|---|---|
| decoded thumbnails (`useThumbnailWorker`) | path | `invalidate(path)` |
| the full-resolution object URL (`useFullImage`) | path | `reloadToken` |
| deep exiftool metadata (`useDetailedMetadata`) | path, module-level, survives unmount | `reloadToken` |

`invalidate` also bumps a per-id epoch, so a worker response already in flight for the pre-rotation
bytes cannot land on top of the fresh one.

The main process's own deep-metadata cache is not in that table because it is keyed on path **plus
mtime and size**, so a rotation makes the old entry unreachable by construction; `rotateImage` calls
`dropCachedMetadata` on top of that to evict it rather than let it occupy the LRU. It is the
renderer side, where the key is the path alone, that has to be told. Note also that
`dropCachedMetadata` matches on `CACHE_KEY_SEP`, the same constant the key builder uses — it used
to match a literal space against a key built with a NUL, so the invalidation after a *rating* write
matched nothing, and with `-P` holding the mtime steady the stale entry was served for the rest of
the session. Two ends of one format have to share a constant.

`PhotoState.fileRevision` is the one counter feeding the latter two: +1 per rotation that lands on
disk, session-global rather than per path, because at one rotation in 3000 keypresses re-reading a
handful of entries is cheaper than the bookkeeping to be precise. It is a cache-busting token, **not
rotation state** — nothing derives what is on screen from it.

Miss one of the three and the symptom is silent and specific. `useFullImage` was the first: without
it, rotating in the loupe changed nothing on screen, because the blob had already been decoded with
the old orientation. `useDetailedMetadata` was the second and nastier one, because the photo *does*
turn: `focusInfo.exifOrientation` is read out of that cache and is what `orientFocusInfo` maps
the AF box with, so a stale entry leaves the box 90 degrees out — on the one overlay whose whole job
is being in the right place. `detailed-metadata.test.ts` guards it.

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

**Deletion is permanent and there is no undo stack.** `DELETE_FILES` unlinks; there is no OS-trash
path any more, no restore, and no history. (A rotation is reversible, but only because turning the
photo back is the same one-byte write — not because anything records what happened.) Both entry points confirm first — the
Delete/Backspace dialog naming the count, and the Execute panel naming the star range plus the
visible count it is scoped to. `useKeyboardNav` takes a `modalOpen` flag for the same reason: it
listens on the *document*, so without the gate a Delete aimed at a dialog also reaches the photo
behind it. And Execute's range floor is fixed at 1 in `ExecutePanel.tsx` rather than being a second
slider handle, which is what makes "an unrated image is never deleted" true by construction
(`isInRatingRange`).

**Focus and selection are two concepts and must never be merged.** Since 1.6.1 there is a cursor
(`focusedImageId`) and a batch (`selection` + `selectionAnchor`), and they answer different questions.
The cursor is *where you are looking*: it drives the loupe, the InfoPanel, the on-demand exiftool read
and the centring scroll, there is exactly one of it, and every non-click way of moving it
(`setFocusedImage` — arrow keys, the loupe, the filmstrip) collapses the batch onto it. The selection
is *what a batch action spends*: click / Shift+click / Ctrl-Cmd+click build it, and the 0-5 keys,
Alt+Arrow, Delete and every context-menu item act on all of it.

Merging them looks tempting — the resting state is a one-image selection that equals the cursor — and
it is exactly what makes the app dangerous. `1` and `Delete` can now touch a hundred files at once,
and Delete is permanent with no undo. The rule that keeps that safe is:

> **A batch action must never be able to name an image the user cannot see.**

Which is why the selection is reconciled EAGERLY and the cursor is not. `reconcileSelection` runs on
every event that can hide or remove an image — filter, search, sort direction, folder collapse,
rescan, `openFolder`, delete, Execute — and drops anything no longer visible. The cursor recovers
LAZILY instead: it stays on the hidden image until the next arrow key moves it somewhere visible,
because that is what preserves the user's position when a folder is collapsed and reopened. So the two
are legitimately out of step for a while, and in that window `focusedImageId` names a photo that is off
screen. Read `store.selectionTargets`, never `state.selection` or `state.focusedImageId`, in anything
that rates, rotates or deletes: it is the only value that applies the fallback to the cursor *and*
checks the cursor is on screen first. `useKeyboardNav`'s `batchTargets` makes the same check for the
same reason.

The plumbing that closes the loop: **App owns the visible order, not the store.** Which folders are
collapsed lives in `App.tsx`, so App reports `sortedFlatImages`' paths into the store through
`syncVisibleOrder` in one effect, and that single call is what reconciles the selection and what
defines the span a Shift-click may cover. Ranges are defined over that flat order and nothing else —
any other order would select images lying invisibly between the two the user clicked.

Two sharp edges in the same area:
- `focusAfterRemoval` in `usePhotoStore.ts` finds the next *survivor* after the deleted cursor.
  Indexing the shrunken array at the old index — which is what the single-image delete did until
  1.6.1 — skips one image per deletion above the cursor, so deleting a selection of twelve landed
  eleven photos past the one the user was looking at.
- A star belongs to one photo, so `ThumbnailCell` stops the click on the star widget from bubbling
  into the cell's selection handler and dispatches a `plain` click itself. Left to bubble, a
  Shift-click on a star would rate one image while range-selecting a hundred others.

**The context menu is a renderer overlay, on purpose — do not move it to `Menu.popup`.**
`components/ContextMenu.tsx` is plain React. A native menu would have to be told which images it is
for and which rating to tick, and `MENU_COMMANDS` is a closed, **payload-free** union precisely so the
main-process menu and the renderer handler cannot drift (see the IPC trap below). Adding a target to
it would trade that guarantee away to duplicate state the renderer already holds. The menu is also
gated into `modalOpen` in `App.tsx`, like every other overlay, or its arrow and Delete keys would also
reach the grid behind it — and App closes it on a folder change, a layout change and any change to the
visible order, because Open Folder and Rescan arrive from the native menu without the outside mousedown
it dismisses itself on.

The shortcut printed beside each item comes from `SHORTCUTS`, exported by `useKeyboardNav` — the same
table the hook derives its key maps from, so a binding and every label naming it move together. There
were three copies of those labels before 1.7.0 (the hook, this menu, `ShortcutsTutorial`); there is
one now. `F5` on the Rescan *button* is the deliberate exception: it is a menu accelerator, so
`main/index.ts` stays its single source and `SHORTCUTS` holds only keys the renderer itself binds.

`'reveal'` is also the one menu item that does not spend the selection. `shell.showItemInFolder` takes
a single path, and forty of them would be forty Explorer windows, so it acts on the cursor — via
`revealTarget`, which applies the batch's own visibility rule to the cursor alone, because focus
recovers lazily and can still name a photo a filter has hidden. When it names nothing the item is left
out rather than shown doing nothing.

**The renderer must never import the `image-utils` barrel.** It aliases
`@photo-culler/image-utils/sorting`, `/grouping`, `/focus`, `/folders`, `/rating` and `/media` deep,
on purpose, and has **no** whole-package fallback alias: the barrel re-exports `scanner.ts`, which
imports `node:fs/promises` and would break the browser bundle. The absence of the fallback is the
guard — an accidental barrel or deep import fails to resolve instead of quietly bundling `node:fs`.
That is also why `/orientation` is not in the list: only the main process needs it. `metadata.ts` is
off limits to the renderer for the same reason — it imports `exifr` at module scope. Import deep
paths in renderer code, and register each new one in **both** `electron.vite.config.ts` and
`vitest.config.ts`.

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

**No main-process code imports `sharp` any more.** Rotation was its last runtime caller. What is
left is build- and test-time: `scripts/make-icons.mjs`, and the main-process tests that use it to
generate real JPEG/PNG fixtures. It is still a runtime `dependency` of `apps/desktop` and still
vendored per target, so every installer carries libvips for nothing. Dropping it is a real win and a
real risk — it means a `package.json` change, a lockfile change, and re-checking
`vendor-native-deps.mjs` and `verify-pack.mjs`, both of which are written around sharp's platform
packages — so it has deliberately not been done as part of the rotation change. Treat it as an open
task, not as dead weight to be swept out in passing.

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

**`PLAN_RENAME` and `EXECUTE_RENAME` are two channels on purpose.** The plan reads and computes and
writes nothing; the execute half carries out the plan the user saw, unmodified. Nothing recomputes in
between, so what was approved is what happens — the same reason Execute has a confirmation panel, and
a stronger one, because a rename moves files the user never picked. `executeRename` reports EVERY file
individually and is never optimistic: on Windows any single rename can be refused by a handle the app
does not own — Explorer's preview pane, which the app's own "Reveal in Explorer" invites the user to
open, the search indexer, a virus scanner — so "it did not throw" is not evidence that a file moved.
There is a short backoff for exactly those.

**Adding an IPC channel touches three files, in order:** `packages/types/src/ipc.ts` (add to
`IPC_CHANNELS` *and* to the `ElectronAPI` interface) -> `src/preload/index.ts` (wire the invoke) ->
`src/main/ipc-handlers.ts` (register the handler). `MENU_COMMANDS` is a closed union for the same
reason — the menu and the renderer handler cannot drift. It carries no payload, which is why the
right-click menu is a renderer overlay; see the focus-vs-selection trap.

**Menu accelerators must use modifiers.** Bare keys (`0`-`5` for rating, `V`, arrows)
belong to the renderer; a menu accelerator swallows them before the window ever sees the keypress.
See the comments in `src/main/index.ts`. The Edit menu's roles are also load-bearing on macOS — they
bind Cmd+C/V/X inside the toolbar search field.

**Two EXIF paths, deliberately.** `exifr` runs in the main process, inside `scanFolder`, over every
image in the tree — the handful of fields grouping, sorting and the rating need, at ~0.3 ms each with
`METADATA_CONCURRENCY` reads in flight. `exiftool` runs as a long-lived child process in the same
process, on demand, for the ONE focused image: that is where the maker-note data lives (AF point,
face detection), which exifr returns as an undecoded blob, and it is also what writes ratings and
orientation. Don't merge them — the bulk path must stay cheap, and exiftool must stay off the
per-image hot path.

Since 1.8.0 exiftool has a second, BULK use: `readTimestampTags` reads the capture-time ladder for
every file a rename plan covers. It goes through the same `-stay_open` child on purpose — `maxProcs:
1` means a read cannot interleave with a write to the same file — and it costs a round trip each, so
planning a folder of a few thousand takes seconds. That is acceptable because it is a deliberate,
one-off user action behind a preview, and it is the ONLY thing that reads a video's `moov` atom.

It
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
result; the rule it protects still holds, and since 1.6.1 it also holds up the context menu: that
opens at the pointer's viewport coordinates, so a centring scroll on the right click that opened it
would slide a different photo under the menu. `PhotoGrid` therefore routes the right click through the
same `handleCellClick` path as a left one instead of calling the store directly.

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
invalidates the thumbnail automatically — which is why `rotateImage` must not pass exiftool's `-P`,
and why the handler also unlinks the cache file outright. Note what mtime does **not** cover: it says
nothing about pixel format, which is why an unchanged suffix plus a changed format would serve stale
pixels forever.

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
left can't land in the new folder's file. Anything that REMOVES records must drop the queued writes
first, or the queue drains straight back over what was just deleted — and since 1.7.0 the only such
path is Rescan's prune, which has to do it for every affected folder rather than only the root. See
the Rescan trap above; `dropQueuedWrite` and `rescanHoldsRef` are the two halves.

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
