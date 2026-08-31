# Changelog

All notable changes to Photo Culler, newest first, in
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.
The project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Every download is about 6 MB smaller, and the installed app about 17 MB.** The image library
  behind the old rotation code has not been used since rotation became a one-byte EXIF change in
  1.6.0, but it was still being packaged — 19 to 21 MB of it, in every installer, on every platform.
  Nothing about what the app does changes. Windows: installer 116.9 MB to 110.3 MB, portable zip
  151.3 MB to 143.3 MB, installed 404 MB to 387 MB.

### Added

- **A portable variant for Windows and macOS** — no installer, no admin rights. Unpack it
  anywhere, including onto a USB stick, and run it from there. On Windows that is a new
  `-win-x64-portable.zip` beside the installer; on macOS the `-mac-…-portable.zip` files, which
  need unpacking on the Mac itself because the bundle contains symlinks Windows zip tools discard.
  A portable copy and an installed copy see exactly the same ratings and scores, because that work
  already lives beside your photos rather than in the app.
- **Portable settings, on request.** Put an empty file named `portable.txt` next to
  `Photo Culler.exe` or next to `Photo Culler.app`, and the app keeps all of its own settings and
  caches inside its own folder instead of in your user profile — so nothing is left behind on a
  machine you only plugged the stick into. It is opt-in so that an ordinary unpacked copy keeps the
  settings it already has, and it declines quietly on a write-protected volume rather than refusing
  to start. **Help → About** prints where the settings actually went.

## [1.8.2] - 2026-08-31

*Lower-case extensions, a rename preview that plans in seconds, and a thumbnail counter that adds
up.*

### Changed

- **Extensions are lower-cased** when a file is renamed or moved, so a card full of `.JPG` arrives
  as `.jpg`. A companion's whole dotted tail follows the same rule, because `2025-… .jpg` sitting
  beside `2025-… .ARW` is the inconsistency worth avoiding. This is the one place the naming
  deliberately differs from `rename-by-date`, which reattaches the extension exactly as it found
  it; the stem format is untouched.
- **The rename preview plans in seconds instead of minutes.** Capture times for photos are read
  with exifr now — 0.6 ms a file against exiftool's 28.5 ms — so planning a thousand files went
  from 33 seconds to under one, which is what makes a folder-wide preview usable at all. Videos
  still go the slow way, because a clip's creation time lives in a part of the file only exiftool
  reads. The names themselves are unchanged: both readers were run over 550 real photos across
  three shoots and produced an identical name for every one, because a file's name must not depend
  on which reader happened to run.
- **Duplicate detection reads each file once per plan.** When several files want the same target
  name, the planner hashes both sides to tell a genuine duplicate from a plain collision, and it
  was re-reading the file holding that name once for every group that wanted it. On one real `DCIM`
  with 3044 duplicate names, that was 79 of the 90 seconds the plan took.
- **The rename preview shows a dozen example rows instead of two hundred**, with the rules stated
  above them: the name format, why a collision takes a content suffix rather than a counter, that
  nothing is ever overwritten, and what travels along with the photo. Nobody reads a list of
  several thousand rows; what you need before committing is what the operation is going to do.

### Fixed

- **The thumbnail counter on a folder header reaches its total again.** It took the larger of two
  numbers — the thumbnails already cached on disk when the folder opened, and the ones generated
  since — but those two sets never overlap and have to be added up. A folder holding 600 cached
  thumbnails that then generated 900 more read 900 of 1500 and sat there looking like unfinished
  work. The scoring counter beside it was always right, which is what gave the bug away.
- **A video that fails to decode although its container is supported is now labelled a broken file,
  in red**, rather than looking like a format the app simply cannot open. Three MP4s in one
  22 000-file archive turned out to be 170 MB of pure zero bytes — a camera or a copy that never
  finished writing — and nothing on screen told them apart from an unsupported container.

### Notes

- Running the rename again over a folder that 1.8.0 or 1.8.1 already renamed changes only the case
  of the extensions. The stem is generated exactly as before, so nothing else moves.

## [1.8.1] - 2026-08-30

*A real folder tree, moving files, and renaming without waiting for the scan.*

### Added

- **The grid shows the real folder tree** — indented and collapsible at every level, instead of one
  flat section per folder labelled with a path like `Festival/DCIM/100_PANA`. A path is not a
  structure: it could not be collapsed at the shoot level, and every level of nesting only made the
  label longer. Collapsing a folder now hides everything below it, and descending sort reverses
  folders within each level, so a subfolder never sorts above its parent.
- **Move files.** Drag a selection onto a folder, or right-click and pick a target from a list. A
  move goes through the same planner, the same preview and the same executor as the rename by
  capture time, so it carries the RAW and the XMP sidecar along, cannot overwrite anything, and the
  quality scores and cached thumbnails follow the files to their new home.
- **Create and delete folders** from the right-click menu on a folder header. The delete is
  recursive, and its confirmation counts what is actually on disk rather than what the grid shows —
  a folder displaying 40 JPEGs may also hold 40 RAW files, 40 sidecars and a thumbnail cache, and
  all of it goes.
- **The thumbnail and scoring counters now sit on each folder header**, so "is this shoot done?" is
  answered per folder instead of once for the whole library. Each counter has its own denominator: a
  video is never scored and a container Chromium cannot decode never gets a poster frame, so a
  folder holding clips no longer sits at 25/28 for ever and reads as unfinished work that is in
  fact finished.
- Folders with no photos anywhere below them now appear in the tree, so a file can be moved into
  one and a subfolder you have just created shows up straight away.

### Fixed

- **Renaming while a folder is still being scanned is allowed again — and now it is safe.** It was
  refused outright, which is exactly the moment a large library makes you want it, and the refusal
  was covering a real problem: the scan reads metadata by file path, so a file renamed underneath
  it lost its capture date, its dimensions and its rating for the rest of the session. The scan is
  now told where the files went, and the renamed images are re-read, with any star you typed a
  moment ago left alone.
- **The app no longer goes to a blank window on a large folder.** Drawing a thumbnail that had just
  been dropped from the in-memory cache threw and took the entire grid down with it — first seen on
  a folder of about 1500 images.
- The right-click menu no longer shuts itself two or three times a second while a scan is running.

## [1.8.0] - 2026-08-30

*Rename by capture time, videos alongside the photos, and folder sections in name order.*

### Added

- **Rename by capture time.** Right-click a photo or a folder section header and the whole shoot is
  renamed to `YYYY-MM-DD HH-MM-SS-fff` — the same stem format `rename-by-date` produces, so a
  folder processed by either tool is indistinguishable — with a preview of every move before
  anything happens. The RAW, the XMP sidecar and the macOS `._` twin sitting beside a photo come
  along under the same name, so a Lightroom-first user's ratings and develop settings are not
  dissolved; quality scores and cached thumbnails follow the new names too, which means nothing has
  to be re-scored and no thumbnail has to be decoded again.
- **Videos alongside the photos.** MP4, MOV, M4V, AVI, MKV, MTS, M2TS, 3GP and WebM are listed in
  the grid and can be viewed, renamed and deleted like anything else. The four Chromium can decode
  get a real poster frame in the grid and play in the info panel, seeking a long clip without
  pulling the whole file into memory.
- **Consolidate camera bucket folders.** Numbered subfolders under a `DCIM` — `100_PANA`,
  `101_PANA` and so on — can be merged into `DCIM` in the same pass as a rename. That is the only
  change the rename ever makes to your folder structure.
- **Nothing a rename touches can be overwritten.** Two files that want the same name — the normal
  case, not the edge case, since a burst on a camera that writes no sub-second tag gives every
  frame the same second — are told apart by a suffix derived from the file's own contents rather
  than by a counter, so a photo can never inherit another's position or its cull verdict. The whole
  plan is checked for overlaps before a single file moves, and each name is reserved on disk as it
  is taken.
- On Windows, a rename that would push a file past the 260-character path limit is refused with the
  reason given. The generated name is often longer than the camera's, and a rename that succeeded
  here would silently stop that file's thumbnails from working.

### Changed

- **Folder sections are ordered by folder name**, not by where each folder's first image falls in
  the current sort. The old order read fine for a single shoot and scrambled a parent holding
  several as soon as two folders interleaved in time.

### Notes

- Videos are deliberately never rated, scored or rotated: a rating lives in the file, and writing
  one into an MP4 means rewriting the whole container — seconds and gigabytes per keypress. Since
  Execute's range starts at 1 star and an unrated file is 0, **Execute can never delete a video.**
  The Delete key still can, with its usual confirmation.
- AVI, MKV, MTS, M2TS and 3GP get a film-strip tile showing the extension instead of a poster
  frame. Chromium cannot demux those containers, and no off-the-shelf ffmpeg build could be shipped
  legally — the ones available are either non-redistributable or GPLv3 with corresponding source
  that no longer exists.

## [1.7.0] - 2026-08-28

*Rotation lands in the photo losslessly on the keypress, and Rescan stops deleting quality scores.*

### Added

- **Reveal in Explorer/Finder** in the right-click menu — opens the containing folder with the file
  picked out. It is the one menu item that does not act on the whole selection: the OS call opens
  one folder with one file selected, so it acts on the image under the cursor.
- **The right-click menu now prints the keyboard shortcut beside each item that has one** — `1`-`5`,
  `0`, `Alt+Arrow`, `Del`. The labels come from the same table the app binds its keys from, so the
  menu can no longer advertise a key that no longer works.
- **Rescan says what it did**: a one-line summary in the toolbar of images taken up, images dropped,
  and records and thumbnails pruned. The Rescan button also shows its `F5` accelerator.

### Changed

- **Rotation is now a one-byte EXIF orientation change, written to the photo the moment you press
  the key.** Alt+Arrow used to record a pending quarter-turn that Execute later applied by
  re-encoding the file. Measured on one 6102 kB camera JPEG that rewrote 6 226 940 bytes in 225 ms,
  left the file at 1470 kB — roughly 76% of the photo thrown away to turn it — and destroyed the
  embedded preview, which drops that photo off the fast thumbnail path for good. A turn now takes
  31 ms, changes a single byte, leaves the stored pixels bit-identical, and turning the photo back
  restores the file exactly. It also means Lightroom and Explorer see the rotation immediately, the
  same way they already see your stars.
- **Nothing about a rotation is pending any more.** Every turn is on disk by the time you reach
  Execute, so Execute only deletes — the "apply pending rotations" checkbox and its count are gone
  from the panel, and a folder's `.photo-culler-results.json` now holds quality scores and nothing
  else.
- **Rescan (F5) keeps everything it can and asks nothing.** New images come in, missing ones drop
  out, and cached thumbnails and score records whose image is gone are removed along with anything
  an older thumbnail format left behind. Every quality score and every rating is kept, and the
  toolbar reports what it did for a few seconds afterwards.
- **Rotation is JPEG only, and says so.** PNG, WebP and TIFF used to be re-encoded like everything
  else; they now refuse with a message you can read. The orientation tag is just as lossless in
  those containers, but the app's display side only honours it for JPEG, and a rotation that
  silently does nothing is worse than one that declines.

### Fixed

- **Rescan no longer destroys quality scores.** Up to 1.6.4, F5 deleted
  `.photo-culler-results.json` in *every* directory below the folder you had opened — 55 files and
  21 851 images in the library where this was found — so one keypress threw away every quality
  score in the tree, with no dialog, no undo and no second copy. Ratings survived, because they
  live in the photos themselves; the results file holds the one thing that exists nowhere else, and
  rebuilding it on a large library costs hours of re-reading. Rescan is now non-destructive and
  never deletes a results file.

### Removed

- **Clean Up Folder…** is gone from the File menu. Rescan prunes orphaned score records and stale
  thumbnails itself now, so the only thing that item still did was ask a question first.

### Notes

- **Nothing in the app can force a quality-score recompute any more** — that was the price of making
  Rescan safe. Deleting a folder's `.photo-culler-results.json` by hand is the escape hatch. Cached
  scores stay valid regardless: a score is a function of the pixels, and a rotation no longer
  rewrites them.
- **A rotation you queued in 1.6.x but never executed is forgotten.** The pending quarter-turn
  sitting in an old results file is carried forward untouched but ignored, because rotations no
  longer live there. Turn the photo again — it lands in the file on the keypress.

## [1.6.4] - 2026-08-28

*Missing thumbnails fill themselves in.*

### Added

- **Every thumbnail in the folder is now generated in the background**, not just the ones a cell has
  rendered. The counter stopping at 1,251/3,470 was never a stall — nothing had asked for the other
  2,219 — so scrolling the whole shoot was the only way to finish it. The sweep does that now, and a
  later scroll to one of those cells is a 19 kB read from the cache rather than a fresh decode.
- The sweep deliberately stays out of the way: it sits in its own queue behind anything visible,
  only two of the worker pool may take sweep work so the disk stays free for the cells you are
  looking at and for the info panel's full-size read, and a swept thumbnail is written to disk and
  then released instead of cached, so work you cannot see cannot push out the thumbnails you can.
  Changing folders cancels it.

### Notes

- This is only worth doing because of 1.6.2. A full pass over that 3,470-image folder reads about
  1.7 GB of embedded previews where reading the originals would have been 20.9 GB, and the bounded
  thumbnail cache is what stops it holding every decoded frame.

## [1.6.3] - 2026-08-28

*A thumbnail counter beside the scoring counter.*

### Added

- **"Thumbs 1,725/3,470" in the toolbar**, next to the scoring counter, with the same styling and
  the same rule of disappearing once it is finished. The number is seeded by counting what is
  already in the folder's thumbnail cache, so re-opening a half-culled shoot shows the thumbnails
  you already have instead of climbing from zero; from there only newly generated thumbnails are
  added, and a cache hit is not counted twice.
- The count is read in the background and never delays the grid, and a slow count for a folder you
  have already left is discarded.

### Notes

- Unlike the scoring counter, this one can sit below its total indefinitely: thumbnails are
  generated for cells that have been on screen, so in this release a folder is only fully
  thumbnailed once you have scrolled through all of it. That is information, not a stall.

## [1.6.2] - 2026-08-28

*Big folders open fast, even off a spinning disk.*

### Changed

- **Thumbnails are built from the camera's embedded preview instead of the whole file.** Every
  thumbnail used to read the full 6.2 MB original to produce a 19 kB tile — 270 times more data
  than it needed, which is what made a 3,470-image folder take minutes to open on a spinning disk
  at 7.3 thumbnails per second. Most camera JPEGs carry a ~500 kB 1620x1080 preview; reading that
  is roughly 10x less disk I/O and 8x less decode (11.6 ms against 94 ms). Anything without a usable
  preview — PNG, TIFF, stripped JPEGs, unfamiliar cameras — falls back to the whole file and behaves
  exactly as before.
- **The grid paints as soon as the folder has been walked.** Opening a folder used to read every
  image's metadata before showing anything; it now waits only for the first screenful and streams
  the rest in while you work. The spinner reports numbers — "3,470 images found", then "Reading
  metadata 1,200/3,470" — instead of spinning indeterminately, and the same line stays under the
  toolbar once the grid is up. A late batch of metadata can no longer overwrite a rating you set
  while it was still reading.
- **The info panel no longer waits behind the thumbnail burst.** It now uses the same neighbour
  prefetch the loupe always had, holds off 180 ms before reading at all (an image you scroll past
  cannot be judged anyway), and shows the already-decoded thumbnail, blurred, until the original
  arrives rather than blanking on every keypress. The original is still what is displayed and still
  what the histogram is computed from. This is why switching images felt slower in the grid than in
  the loupe: the loupe does more total reading, it just did it ahead of time.

### Fixed

- **Decoded thumbnails are no longer held forever.** The cache only ever grew, so opening the
  filmstrip on a 3,470-image folder decoded and kept every one of them — around 2.4 GB for the
  session. It is now bounded and releases what it drops.
- The neighbouring images were being fetched ahead of the image you were actually waiting for.

## [1.6.1] - 2026-08-27

*Multi-select and a right-click menu.*

### Added

- **Rate, rotate and delete a whole selection.** Click selects one image, Shift+click takes the
  contiguous range, Ctrl/Cmd+click picks and chooses. The 0-5 keys, Alt+Arrow, Delete and every
  menu item then act on all of it — one file write per image, each optimistic, so a star that fails
  to save rolls back on its own photo.
- **Right-click menu in the grid** — Rating as a 0-5 submenu that ticks the current value and reads
  "mixed" when the selection disagrees, Rotate clockwise and counter-clockwise, and Delete.
  Right-clicking an image that is not in the selection selects just that image first, so the menu
  never acts on something you cannot see.
- The toolbar shows a count while more than one image is selected, and every selected cell carries a
  white inner frame — distinct from the cursor's outline, because an image is usually both.

### Changed

- **The cursor and the selection are two separate things.** The cursor is where you are looking: it
  drives the loupe, the info panel and the on-demand metadata read, and arrow keys, the loupe and
  the filmstrip move it and collapse the selection onto it. The selection is what a batch action
  spends. Anything that hides an image — the rating filter, the search box, collapsing a folder, a
  rescan — drops it from the selection on the spot, so a number key or a Delete can never reach a
  photo that is off screen.
- Clicking a star rates that one photo, whatever else is selected. A star belongs to the photo it
  sits on, so Shift-clicking a star no longer rates one image while range-selecting a hundred
  others.

### Fixed

- **Deleting jumped past the photo you were looking at.** The cursor was placed at the old position
  in the now-shorter list, so every deletion above it skipped one image — deleting twelve landed
  eleven photos further on. It now moves to the next surviving image.

## [1.6.0] - 2026-08-27

*Star ratings, written into the photos themselves.*

### Added

- **0-5 star ratings that live in the photo, not in the app.** Press 0-5 or click a star to rate the
  focused image; clicking the lit star clears it. Every change is written straight into the file as
  `xmp:Rating` plus the EXIF rating tags, so Lightroom, Bridge, darktable and Windows Explorer read
  back the same stars — and stars set in those tools show up here, because the rating is read out of
  every image each time a folder is opened. A rescan, a moved folder or a deleted results file
  cannot lose a rating any more.
- **Rating filter** — a two-handle slider narrows the grid to a star range. `0-0` shows only what
  you have not judged yet, `4-5` only the best.
- **Execute's star range sits in the Execute panel**, beside the confirmation, so the count moves as
  you drag it. The bottom of the range is fixed at 1, which is what makes "an image nobody has rated
  is never deleted" true rather than merely likely — the old three-bucket system never guaranteed
  it.
- **Delete and Backspace now ask first**, and the grid no longer receives keys while a dialog is
  open — a Delete aimed at a confirmation used to reach the photo behind it as well.
- A rating that fails to save rolls back and says so, instead of leaving a lit star over a write
  that never landed. Pending writes are also flushed when you quit, so a star typed a moment before
  closing the window still reaches the file.

### Changed

- **Deletion is permanent.** The OS-trash route is gone: Execute and the Delete key unlink the
  files. There is no restore and no undo, which is why both entry points confirm first and name what
  they are about to remove.
- **Rating a photo does not move its modification date.** Without that, rating 2,000 photos would
  have thrown away 2,000 cached thumbnails and forced 2,000 full-size re-decodes, and it would have
  re-cut burst groups for any file without a capture time.
- **Sorting is by filename, with the direction toggle kept.** Sorting by date, size or quality score
  is gone: burst grouping needs a filename-ordered list, and sorting by size handed it a
  size-ordered one, which fragmented every burst.
- `.photo-culler-results.json` now holds only what genuinely cannot be recomputed — quality scores
  and rotations you have not applied yet. The cached EXIF block it used to carry is no longer read;
  metadata comes from the files.

### Fixed

- **A rotation you had already applied came back and was applied a second time.** Execute wrote the
  rotation into the file and cleared it from the app, but the folder's results file wrote the old
  angle straight back — so the next time you opened that folder the photo was shown turned another
  90 degrees on top of the rotation already in the file.

### Removed

- **The keep / review / delete classification**, and with it moving keeps into a `picks/` subfolder.
  Execute deletes a star range and does nothing else.
- The quality-score filter and sort. Scores stay as a badge on each thumbnail and a breakdown in the
  info panel — advisory, with nothing filtering or sorting by them.
- Select-on-hover: moving the mouse across the grid no longer changes which image is focused.

### Notes

- Existing keep/review/delete verdicts are not converted to stars — three buckets do not map onto
  six values, so those photos start out unrated. The old entries are left in
  `.photo-culler-results.json` and ignored; quality scores are untouched and nothing has to be
  recomputed.
- A "rejected" rating (-1, as Adobe writes it) reads as unrated rather than one star, and a
  fractional rating is rounded into range. One star is the delete bucket, so inheriting another
  tool's rejection must never queue a photo for deletion.
- No `_original` copies are left beside your photos: the rating write overwrites in place.

## [1.5.3] - 2026-08-27

*A type-checking pass over the whole project, and the two real bugs it turned up.*

### Fixed

- In a folder where nothing had been classified yet, caching an image's EXIF data created that
  image's record in `.photo-culler-results.json` with no classification field at all, and it loaded
  back as neither set nor cleared. Records are now always written complete, on the same defaults the
  normal save path uses.
- The info panel's classification badge no longer depends on the results file holding a value it
  recognises. An unexpected or hand-edited classification now falls back to a plain label instead of
  taking the panel down with it.

### Notes

- Nothing else in this release changes behaviour. The project's type checker had been silently
  passing everything it was given, in CI and before every push; switching it on for real produced 56
  complaints, of which the two above were actual defects and the rest were annotations.

## [1.5.2] - 2026-08-27

*Thumbnails are sharp again — 512px WebP, drawn at the display's real pixel density.*

### Changed

- **Thumbnails no longer look upscaled.** They are generated at 512px WebP instead of 256px JPEG,
  and the canvas they are drawn into is sized in physical pixels rather than CSS pixels. Before
  this, the 'large' preset stretched a 256px thumbnail 2.3x before the display's own scale factor
  came into it at all, so on a scaled or high-DPI screen every thumbnail was soft no matter which
  size you picked.
- **Clean Up Folder counts leftovers from an older thumbnail format apart from orphaned
  thumbnails.** One such leftover can be a whole directory holding thousands of cached images, and
  reporting that in the confirmation dialog as "1 thumbnail" understated what was about to be
  deleted.

### Notes

- The first time you open a folder after this update, its thumbnails are regenerated at the new
  size: the old cache cannot be served any more, and a housekeeping pass a few seconds after the
  scan removes it. On a large library that first pass costs one full re-generation. Nothing in
  `.photo-culler-results.json` is touched — classifications, quality scores and rotations all
  survive, and scores stay comparable with earlier versions.

## [1.5.1] - 2026-08-19

*A real app icon, and instructions on the release page for getting past the install warnings.*

### Changed

- **A real app icon**, replacing the flat blue placeholder square that has shipped since the first
  packaged build. It is a stack of frames — red, amber, white for the three classifications — under
  a green check, so the icon speaks the same language as the grid it opens.

### Notes

- Every release page now opens with the steps to install. These builds carry no code-signing
  certificate, so Windows SmartScreen says "Windows protected your PC" (More info, then Run anyway)
  and macOS blocks the app on first launch. On macOS 15 (Sequoia) and later the Control-click bypass
  is gone: let it be blocked once, then allow it under System Settings, Privacy & Security, Open
  Anyway. If macOS calls the app *damaged*, that is the download quarantine flag rather than a
  broken file — the README's Code signing section has the `xattr` command that clears it.

## [1.5.0] - 2026-08-19

*The image you are looking at stays in the middle of the view, and the classification filter takes
more than one bucket.*

### Added

- **The classification filter takes more than one bucket at a time.** The None / Keep / Review /
  Delete chips each toggle independently, so "everything I have not decided on, plus the maybes" is
  one pass over the shoot instead of two. No chips selected still means no filter.

### Changed

- **The focused image is centred, not merely made visible.** Arrow keys used to leave it pinned to
  whichever edge it entered from — the bottom on the way down, the top on the way up — because each
  thumbnail scrolled itself just far enough to be on screen. The grid, the loupe's strip and the
  filmstrip each now scroll it to the middle, instantly, so it does not lag behind under key repeat.
- Clicking or hovering a thumbnail deliberately does **not** re-centre the view. Scrolling on a
  click would slide every other thumbnail out from under the cursor in the middle of the gesture.

### Fixed

- Leaving the loupe no longer dumps you back at the top of the shoot. It returns to the image you
  were just looking at, even when that image's row had been scrolled out of the grid entirely and so
  had nothing on screen to scroll to.
- One arrow key could advance two images: the centring scroll slid a new thumbnail under a resting
  mouse pointer, and select-on-hover took that as a hover the user had made. A scroll the app
  performed itself no longer counts as pointing at anything until the pointer genuinely moves.

## [1.4.4] - 2026-08-19

*The other half of the arrow-key fix: navigation keys work wherever the window's focus sits.*

### Fixed

- **Navigation keys work no matter where focus sits in the window.** 1.4.3 fixed the case where the
  focused photo was off screen; this fixes the case where the keys never reached the app at all.
  They were only listened for while focus was inside the app container, and focus leaves easily — a
  click on empty chrome, a closing dialog — after which the browser scrolled the photo grid instead.
  They are now handled on the document, like every other shortcut in the app.
- Text fields keep their own arrow keys and typing, so the toolbar search box is unaffected.

## [1.4.3] - 2026-08-19

*Arrow keys navigate instead of scrolling the gallery when the focused photo is off screen.*

### Fixed

- **Arrow keys no longer scroll the gallery instead of navigating.** When the focused photo was not
  among the visible ones the key was left unhandled and the browser scrolled the grid — reported as
  "sometimes the arrow keys do nothing and the gallery scrolls instead". Navigation now recovers
  onto the first visible photo and swallows the key, so scrolling can never stand in for navigation.
- It happened whenever focus left the visible set: its folder had been collapsed (new in 1.4.0, and
  the likeliest trigger), a filter or the search box excluded it, or it had been trashed.
- Space is covered by the same fix — left unhandled it paged the scroll container instead of cycling
  the classification.

## [1.4.2] - 2026-08-19

*Classification, rotation and quality scoring work again after 1.4.0 silently broke them.*

### Fixed

- **Classifying, cycling and rotating work again.** 1.4.0's switch to full paths left seven places
  still passing bare filenames, and the affected features went quiet rather than reporting an error:
  keys 1 / 2 / 3 / 0 did not classify, Space did not cycle, and Alt+Arrow did not rotate.
  Right-click cycling kept working throughout, which is why the failure looked intermittent.
- **Quality scores appear and are saved again.** Every computed score was filed under a key nothing
  reads, so no score was ever shown, none reached the results file, and the whole analysis pass
  re-ran from scratch on every open of the folder.
- The info panel again shows the focused image's classification, score, subscores and rotation, and
  the loupe and filmstrip metadata overlay again show its score and subscores. All of them read
  empty in 1.4.0 and 1.4.1.
- The Execute panel's keep and delete counts are correct again instead of reading zero.

### Notes

- Folders analysed under 1.4.0 or 1.4.1 have no scores in their results file — nothing was written.
  The next open scores them once and saves them.

## [1.4.1] - 2026-08-19

*Clean Up Folder removes cached thumbnails and saved records whose photo is gone.*

### Added

- **File > Clean Up Folder…** walks the whole tree and removes exactly the leftovers: a cached
  thumbnail or a saved record whose image is no longer beside it. Copying photos between folders
  leaves each copy's results file and thumbnail cache describing images that are not there any more,
  and this is what clears them out. Everything whose image is still present stays.
- It plans first and asks before touching disk. The dialog reports how many folders were scanned,
  how many cached thumbnails and how many saved records would go, and does nothing if you cancel —
  worth reading, because removing a record discards that image's classification, score and rotation.
- Photos are never touched by clean-up. It removes cache files and saved records only.

### Removed

- The Vacuum Thumbnails menu command is gone. It did nothing the automatic vacuum after each scan
  does not already do.

### Notes

- Clean-up is deliberately cautious: a directory that cannot be listed is skipped entirely rather
  than read as "no images here", so an offline drive or a permission problem cannot make it delete a
  record whose photo is fine.

## [1.4.0] - 2026-08-19

*Recursive scanning: a parent folder of several shoots can now be culled in one session.*

### Added

- **Recursive folder scanning.** Opening a folder now scans every directory below it and shows one
  collapsible section per folder, so a parent holding several shoots — or a camera's own DCIM
  subfolders — can be culled in one session instead of being copied into a single flat folder first.
- **Folder headers** show each folder's path relative to the one you opened, plus its image count,
  and click to collapse or expand.
- Every folder keeps its own `.photo-culler-results.json` and `.photo-culler-thumbs/` beside its own
  photos, so classifications, scores, rotations and cached thumbnails stay with the shoot they
  describe.

### Changed

- **Rescan (F5) now discards saved results for every folder in the tree**, not only the one you
  opened. It deletes each `.photo-culler-results.json` below the root, so classifications, quality
  scores and pending rotations for the whole tree are gone and the scores are recomputed from
  scratch.
- Timestamp grouping sits inside each folder section rather than being replaced by it — a shoot is
  the unit you think in, and burst detection is still what makes it reviewable.
- Arrow keys skip over collapsed folders, so focus never lands on a photo you cannot see.
- A single folder shows no header at all, so the classic one-shoot case looks exactly as it did
  before.
- Images that Execute moved into a `picks/` subfolder still appear in the section they were culled
  in rather than showing up as a folder of their own.
- The automatic thumbnail vacuum after each scan now walks the same tree the scan does, so cached
  thumbnails in subfolders are tidied too.

### Notes

- The on-disk format is unchanged: every `.photo-culler-results.json` and thumbnail cache written by
  an earlier version loads as it is.
- The scan visits at most 2000 directories, as a safety net against opening a whole drive by
  accident. A subfolder that cannot be read is skipped rather than failing the whole scan.

## [1.3.2] - 2026-08-19

*Loupe strip and filmstrip keep up with a held arrow key.*

### Fixed

- **Holding an arrow key no longer leaves the strip behind.** In both the loupe strip and the
  filmstrip the focused image drifted off the edge and then snapped back. Two causes: the strips
  scrolled smoothly, and Chromium's smooth scroll restarts on every new call, so at key-repeat rate
  it never once finished — scrolling is instant now. And the thumbnail scrolled itself into view
  while the strip scrolled the same thumbnail from its own effect, so two scrolls raced on every
  keypress, one aiming at "nearest" and one at "center". The strip is now the single owner of that
  scroll.
- Scrolling the loupe strip could also shift a vertical container as a side effect, because a scroll
  that names only one axis defaults the other to the start of the element. Both calls now pin the
  cross axis.

## [1.3.1] - 2026-08-19

*The info panel stops jumping while you navigate.*

### Fixed

- **The info panel no longer jumps under the cursor while you move through images.** Rows and whole
  sections were only drawn once their data arrived — plain EXIF lands progressively while a folder
  is processed, and the full tag list comes from an on-demand read — so everything below whichever
  field arrived last shifted down a moment later. Empty rows now show an em dash, the Camera and
  Settings groups stay in place, and "All metadata" is always present with a (loading) badge until
  its count is known. Section heights are fixed.
- The Focus section's "unsupported" and "error" messages could never appear: the wrapper meant to
  show them excluded exactly those two states, so a file whose focus data could not be read simply
  showed nothing.
- Opening "All metadata" with nothing to show now says so, instead of offering a filter box over an
  empty list. A leftover duplicate "Focus" heading is gone.

## [1.3.0] - 2026-08-19

*Autofocus data from the camera, and a Delete that no longer eats quality scores.*

### Added

- **Autofocus data from the camera.** The info panel has a new Focus section showing where the
  camera focused, in which focus mode, and which faces it detected — read out of the vendor
  MakerNote by exiftool, on demand, for the image you are looking at. It answers the question the
  quality score never could: the global sharpness number cannot tell a sharp background from a sharp
  subject, so it cannot say whether focus landed on the eye or on the ear.
- **AF-point overlay**, toggled with A: amber brackets for the AF area, lime dashed boxes for
  detected faces. AF coordinates are recorded in the camera's raw sensor frame, so they are mapped
  through the image's EXIF orientation before being drawn — otherwise every portrait-orientation
  frame, about a quarter of a typical shoot, would show the brackets in the wrong place. Verified
  against roughly 960 real DC-S5D frames.
- **Focus peaking now has a threshold slider**, and its default rises from 30 to 80. At 30 nearly
  every texture in the frame was flagged as sharp, which made the overlay useless for judging focus.
- **Overlay toggles are reachable everywhere**, not just in the grid: P for focus peaking, C for
  exposure clipping, A for the AF point, in the loupe and the filmstrip too, plus a View › Overlays
  menu with the same three items.
- A filterable list of every metadata tag in the file, under the info panel's "All metadata"
  section.

### Changed

- **The Windows installer is 116 MB instead of 148 MB.** Native binaries are now vendored per build
  target, so a Windows installer no longer carries the macOS and Linux copies of libvips it never
  used. A packaging check fails the build if that ever comes back.
- The info panel opens on the histogram, score and exposure; the rest is behind disclosures, so the
  panel is not a wall of text.
- Thumbnails keep their aspect ratio instead of being centre-cropped to a square.

### Fixed

- **A single Delete keypress destroyed quality-score detail for the whole folder.** Deleting
  rewrote `.photo-culler-results.json` from four of its six per-image fields, so every remaining
  image in that folder silently lost its quality-score breakdown and any rotation waiting to be
  applied — data that lives nowhere but that file. Deletion now carries every field forward and only
  removes the records for the files it actually deleted.
- **Rotating an image left its thumbnail stale for ever**, so the grid kept showing the old
  orientation. Thumbnail freshness is now decided against the source file's current modification
  time.
- The focus-peaking and clipping overlays did not rotate with the image. The photo and its overlays
  now share one wrapper, so the overlays track it by construction.
- The loupe and the filmstrip ignored the thumbnail cache and re-decoded the full-size file for
  every strip entry.
- Deleting an image left its cached thumbnail behind on disk, and moving a pick into `picks/`
  orphaned its thumbnail and generated a duplicate.

## [1.2.0] - 2026-08-18

*Culled folders open instantly instead of re-analysing themselves, and the native menu does real
work.*

### Added

- **A native menu with real actions.** File: Open Folder, Rescan Folder (F5), Save / Delete
  (Ctrl/Cmd+S). View: Layout — grid, loupe, filmstrip, also on Ctrl/Cmd+1/2/3 — plus Thumbnail Size
  and Toggle Info Panel (Ctrl/Cmd+I). Help: Keyboard Shortcuts (Ctrl/Cmd+/) and About. On Windows
  and Linux the menu bar stays out of the way and Alt reveals it.
- **The version is visible.** Help > About reports it alongside the Electron, Chromium and Node
  versions, the shortcuts panel shows it in its footer, and the macOS About panel agrees with both.
- The toolbar's bare **?** is now labelled as a Help button.

### Changed

- **The results file is now hidden: `.photo-culler-results.json`.** Folders culled with an earlier
  version hold `photo-culler-results.json`, and it is renamed on first read — once per folder, with
  nothing lost.

### Fixed

- **Opening an already-culled folder re-ran the whole analysis.** Quality scores only ever lived in
  memory: the debounced write closed long before scoring finished, so nothing reached the results
  file and every open re-read the EXIF and recomputed sharpness, exposure, contrast and noise for
  the entire folder — even with a full thumbnail cache sitting beside the photos. Scores are now
  written when they are produced, so the second open of a folder reads them from disk.
- **Switching folders could destroy the new folder's saved work.** A quality score arriving late
  from the folder you had just left was written into the newly opened folder's results file over an
  empty image map, taking that folder's classifications, quality scores and cached EXIF with it.
  Every queued write now carries the folder it was made for and is discarded if you have since moved
  on.
- **Scores from the previous folder no longer land on the new folder's photos.** The scoring worker
  kept running after a folder change, and any filename the two folders shared — `DSC_0001.JPG` off
  two different cards — inherited the other photo's score. The run is now cancelled on folder
  change, and a result is refused outright if it does not belong to the folder on screen.
- **The last edits before a folder switch are no longer lost.** A pending save is written out on the
  way out of a folder instead of being dropped with it.
- **A save can no longer delete records it did not know about.** Writes are projected over every
  image the results file already describes, so a partial set of classifications cannot strip other
  images' entries and their cached EXIF.
- **An image that could not be read is left unscored rather than scored 50.** Now that scores
  persist, a placeholder written during a transient lock — antivirus, a network drive, another app
  holding the file — would have stuck for good, because an image that already has a score is never
  revisited. It is simply retried on the next open.
- **Rescan clears the results file properly.** It used to "delete" the file by writing an empty
  string to it, leaving a 0-byte file behind, and a debounced write could still fire afterwards and
  restore what had just been discarded.
- **Ctrl/Cmd+1/2/3 no longer classifies the focused photo** while it switches layout. The keyboard
  handler looked at the key alone, and the key for Ctrl+1 is `1`.

### Notes

- A folder you culled with an earlier version may still be analysed once more on the next open: most
  of its quality scores never reached disk, so there is nothing there to read. Every open after that
  first pass comes from the results file.

## [1.1.0] - 2026-04-09

*Three view layouts, and quality scores stop deciding what gets deleted.*

### Added

- **Loupe and Filmstrip layouts.** Loupe fills the window with one photo and puts a horizontal
  filmstrip underneath; Filmstrip keeps a vertical thumbnail column on the left beside the large
  image. `V` cycles Grid / Loupe / Filmstrip, `I` toggles the metadata overlay, and zoom and pan
  behave identically in both.
- **Shortcuts tutorial.** `?` or the toolbar button opens a list of every keybinding, grouped by
  what it does.
- **The timezone is shown with the capture time.** The info panel labels Taken and Modified with the
  offset the camera recorded (CET, CEST, JST and so on), so a shoot from another country reads
  correctly instead of silently in your own time.
- macOS builds can reach Downloads, Pictures and the Photos library, instead of being refused the
  folder you picked.
- The filename is drawn in the upper-left corner of each thumbnail.

### Changed

- **Quality scores no longer classify anything.** Until now the scorer assigned keep/review/delete
  by itself — anything scoring under 35% was marked delete before you had ever looked at it, and
  Execute trashes what is marked delete. Classification is now entirely yours. The scores are still
  computed, still shown on the thumbnail and still broken down in the info panel; they just no
  longer decide anything.
- Opening a folder focuses the first image, and click-to-focus is the default.

### Fixed

- **Capture times across a DST or timezone change.** EXIF dates are now read as the raw camera
  string, so a photo taken inside the spring-forward gap hour is no longer shifted by an hour.
  Sorting uses the true instant (the camera's wall clock minus the offset it recorded) while the
  display keeps the wall clock the photographer remembers, so a shoot that crosses a boundary is in
  the order it was actually shot.
- **Burst shots that share a timestamp keep a stable order** — frames with identical capture times
  now fall back to filename order instead of landing wherever the sort left them.
- The large image could come up blank when moving quickly between photos: the preload cache released
  an image URL the viewer was still displaying.
- Fit-to-window is recalculated after switching image or layout, instead of sizing the new photo
  against the previous one.
- Arrow keys in Loupe and Filmstrip move one photo at a time, rather than jumping by grid rows.

### Removed

- **Preview mode is gone**, replaced by the Loupe and Filmstrip layouts — `Enter` no longer opens a
  separate panel.
- **Multi-select is gone.** Ctrl/Cmd+A, Ctrl/Cmd+Click and Shift+Click no longer build a selection,
  and actions apply to the focused image.

### Notes

- A folder you culled with an earlier version may still hold classifications the scorer assigned
  rather than you. Nothing rewrites them, so it is worth going through a folder's delete marks
  yourself before you Execute it.

## [1.0.5] - 2026-03-17

*Windows installs for your user, without administrator rights.*

### Changed

- **The Windows installer no longer asks for administrator rights.** It installs into your own user
  profile by default. Program Files is still offered in the setup dialog if you want it there.

## [1.0.4] - 2026-03-17

*The Windows app starts.*

### Fixed

- **Windows: the app opens.** The installer packed everything into a single archive, and the native
  image binaries inside it were extracted to a temporary folder at launch — where the DLLs they link
  against could not be found, so loading them failed. The files now sit unpacked on disk beside the
  app, and the `Could not load the "sharp" module` startup crash is gone.

### Notes

- No Windows installer before this one could start the app. If you downloaded 1.0.0 through 1.0.3,
  throw it away and install this instead.

## [1.0.3] - 2026-03-17

*The Windows installer carries the whole image library, not part of it.*

### Fixed

- **The packaged app now ships the complete image library.** 1.0.1 and 1.0.2 included its top-level
  package but left out the packages it depends on, so the app still could not load it. That library
  is loaded when the app starts up — which is why an incomplete copy kept the window from opening at
  all, rather than just breaking the one feature that uses it (rotating a photo).

### Notes

- Still not the end of it: the Windows app remained unable to start. 1.0.4 is the release that fixes
  it.

## [1.0.2] - 2026-03-17

### Notes

- Nothing changed in the app. 1.0.2 is 1.0.1 with a new version number, released only to produce a
  fresh set of installers. If you already have 1.0.1, there is nothing here for you.

## [1.0.1] - 2026-03-17

*First attempt at fixing the broken Windows build.*

### Fixed

- **The Windows build now carries Windows image binaries.** The 1.0.0 installer was packaged with
  the native image-processing binaries of the machine that built it, so the Windows app failed with
  `Could not load the "sharp" module`. The build now fetches those binaries for every platform it
  packages.

### Notes

- This did not finish the job. The Windows app still would not open after this release — see 1.0.3
  and 1.0.4, which is where it finally does.

## [1.0.0] - 2026-03-16

*First release: open a folder, classify from the keyboard, execute the batch.*

### Added

- **Keyboard-driven culling.** Open a folder — Ctrl/Cmd+O, or drag it onto the window — and work
  through a virtualized thumbnail grid that stays smooth across thousands of images. Arrow keys
  move, `1`/`2`/`3` classify keep/review/delete, `0` clears, Space cycles, and a right-click cycles
  a single thumbnail without disturbing the selection.
- **Automatic quality scoring.** Every image is analysed for sharpness, exposure, contrast and noise
  and gets one 0-100 score as a colour-coded badge on its thumbnail, with the four subscores broken
  out in the info panel. The weighting is sharpness 40%, exposure 25%, contrast 20%, noise 15%.
- **Execute** carries out the whole session in one confirmed step: everything marked delete goes to
  the trash — or permanently, if you pick that — the keeps can be moved into a `picks/` subfolder,
  and pending rotations are written to the files. It is scoped to what the filters currently show,
  and it names the counts before touching anything.
- **Burst grouping.** Images are grouped by capture time so a burst reads as one block instead of
  twelve near-identical rows; the threshold is adjustable in the View menu and defaults to 5
  seconds.
- **Info panel** with the full camera EXIF — body, lens, aperture, shutter, ISO, focal length,
  exposure compensation, flash, white balance, metering — an RGB histogram, and a preview you can
  zoom toward the cursor and drag.
- **Focus peaking and exposure clipping overlays** on the preview: cyan edges where the image is
  actually sharp, red for blown highlights, blue for crushed shadows. Both zoom and pan with the
  image, so you can judge technical quality without pixel-peeping.
- **Preview mode with a filmstrip.** Enter opens the focused image full size and its neighbours are
  preloaded, so arrow keys stay instant; Escape returns to the grid.
- Sort by filename, capture date, file size, dimensions or quality score. Filter by classification
  or by a min/max quality range, and search by filename.
- **Multi-select** with Ctrl/Cmd+click, Shift+click for a range and Ctrl/Cmd+A for everything
  visible. Delete removes the selection and Backspace the focused image, each behind a confirmation
  that names the count.
- **Rotation** with Alt+Left/Right. The grid shows the result immediately; the files themselves are
  only touched when you Execute.
- **All state lives beside the photos.** Each folder gets a `.photo-culler-results.json` holding
  classifications, quality scores, rotations and the EXIF already read, plus a
  `.photo-culler-thumbs/` thumbnail cache. Reopening a folder picks up where you left off without
  re-reading every file, and pending saves are flushed when the window closes.
- Rescan re-processes a folder from scratch after you have added or removed files outside the app.
- A single-row toolbar: sort, filter and view options in dropdown menus, a search box that expands
  on focus, a thumbnail-size toggle, tooltips throughout, and scoring/EXIF progress that shows only
  while work is running.
- Choose whether the info panel follows the mouse (hover-select, the default) or only a click.
- The app starts empty instead of reopening the last folder.

### Notes

- Installers are published for Windows (x64) and for macOS on both Intel and Apple Silicon.
- Supported formats are JPEG, PNG, TIFF and WebP. A folder's own images are scanned, plus a `picks/`
  subfolder if one exists — other subfolders are not.
- Permanent delete is permanent: there is no undo and no history anywhere in the app. Trash is the
  default for that reason.
- No accounts and no network calls. Everything the app knows is either inside your image files or in
  the two dot-entries beside them.

[1.8.2]: https://github.com/p5hema2/photo-culler/compare/v1.8.1...v1.8.2
[1.8.1]: https://github.com/p5hema2/photo-culler/compare/v1.8.0...v1.8.1
[1.8.0]: https://github.com/p5hema2/photo-culler/compare/v1.7.0...v1.8.0
[1.7.0]: https://github.com/p5hema2/photo-culler/compare/v1.6.4...v1.7.0
[1.6.4]: https://github.com/p5hema2/photo-culler/compare/v1.6.3...v1.6.4
[1.6.3]: https://github.com/p5hema2/photo-culler/compare/v1.6.2...v1.6.3
[1.6.2]: https://github.com/p5hema2/photo-culler/compare/v1.6.1...v1.6.2
[1.6.1]: https://github.com/p5hema2/photo-culler/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/p5hema2/photo-culler/compare/v1.5.3...v1.6.0
[1.5.3]: https://github.com/p5hema2/photo-culler/compare/v1.5.2...v1.5.3
[1.5.2]: https://github.com/p5hema2/photo-culler/compare/v1.5.1...v1.5.2
[1.5.1]: https://github.com/p5hema2/photo-culler/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/p5hema2/photo-culler/compare/v1.4.4...v1.5.0
[1.4.4]: https://github.com/p5hema2/photo-culler/compare/v1.4.3...v1.4.4
[1.4.3]: https://github.com/p5hema2/photo-culler/compare/v1.4.2...v1.4.3
[1.4.2]: https://github.com/p5hema2/photo-culler/compare/v1.4.1...v1.4.2
[1.4.1]: https://github.com/p5hema2/photo-culler/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/p5hema2/photo-culler/compare/v1.3.2...v1.4.0
[1.3.2]: https://github.com/p5hema2/photo-culler/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/p5hema2/photo-culler/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/p5hema2/photo-culler/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/p5hema2/photo-culler/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/p5hema2/photo-culler/compare/v1.0.5...v1.1.0
[1.0.5]: https://github.com/p5hema2/photo-culler/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/p5hema2/photo-culler/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/p5hema2/photo-culler/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/p5hema2/photo-culler/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/p5hema2/photo-culler/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/p5hema2/photo-culler/releases/tag/v1.0.0
