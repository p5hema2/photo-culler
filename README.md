# Photo Culler

A fast, keyboard-driven desktop app for culling photo shoots. Open a folder, review your images, rate them 0-5 stars, and batch-delete the ones that did not make it — all without leaving the keyboard.

Rate one photo or a hundred: click, Shift+click or Ctrl/Cmd+click builds a selection, and every rating, rotation and delete acts on all of it.

Ratings are written into the image files themselves, so Lightroom, Bridge, darktable and Windows Explorer all see the same stars.

Built with Electron, React, TypeScript, and Tailwind CSS.

## Features

- **Thumbnail grid** with virtual scrolling — handles thousands of images
- **Auto-grouping** by timestamp — burst shots are grouped together
- **Star ratings in the file** — 0-5, written as `xmp:Rating` plus the EXIF rating tag, so other
  photo tools and the OS file browser read them back
- **Rating filter** — a two-handle slider narrows the grid to a star range; 0 means unrated
- **Quality scoring** — automatic sharpness, exposure, contrast, and noise analysis, shown per
  thumbnail
- **Keyboard-first workflow** — arrow keys to navigate, 0-5 to rate
- **Multi-select** — click, Shift+click for a range, Ctrl/Cmd+click to pick and choose; rating, rotation and
  delete then act on the whole selection
- **Right-click menu** — rating, rotate and delete for the selection, with the keyboard shortcut shown
  beside each item that has one, plus “Reveal in Explorer/Finder” for the image under the cursor
- **Image rotation** — Alt+Arrow to rotate, written to the photo immediately as an EXIF
  orientation change: one byte, no re-encode, and rotating back restores the file exactly
- **EXIF display** — camera body, lens, exposure settings, histogram
- **Focus peaking, clipping & AF point overlays** — spot soft focus, blown highlights, and where the
  camera actually focused
- **Zoom/pan preview** — scroll to zoom, drag to pan in the info panel
- **Batch execute** — permanently delete a 1-to-_x_ star range among the images you can see
- **Persistent state** — quality scores saved per folder; ratings and orientation live in the images
  themselves

## Installing

Grab the installer for your platform from the
[latest release](https://github.com/p5hema2/photo-culler/releases/latest):
`.exe` for Windows, `-mac-arm64.dmg` for Apple Silicon, `-mac-x64.dmg` for Intel.

**Both platforms will warn you the first time.** The builds carry no code-signing
certificate — see [Code signing](#code-signing) for why — so the OS has no
publisher to vouch for them. Getting past it:

**Windows.** SmartScreen shows "Windows protected your PC". Click **More info**,
then **Run anyway**. Your browser may also flag the download itself as
uncommon — keep the file.

**macOS.** Open the `.dmg`, drag the app to Applications, then launch it from
Applications rather than from the disk image:

- Control-click the app and choose **Open**, then **Open** again in the dialog.
- On macOS 15 (Sequoia) and later that shortcut is gone. Double-click the app,
  let it be blocked, then go to **System Settings → Privacy & Security**, scroll
  to the message about Photo Culler, and click **Open Anyway**.
- If macOS insists the app is *damaged*, quarantine is the cause rather than the
  app. Clear it and reopen:

  ```bash
  xattr -dr com.apple.quarantine "/Applications/Photo Culler.app"
  ```

You only have to do this once per installed version.

### Code signing

Neither platform's build is signed, and that is a purchasing decision rather than
a missing config: Windows code-signing certificates must now live on a hardware
token or a cloud HSM (Azure Trusted Signing at roughly $10/month is the cheapest
CI-friendly route), and macOS notarisation requires an Apple Developer Program
membership at $99/year. The macOS artefacts are ad-hoc signed on Apple Silicon,
because arm64 refuses to execute an entirely unsigned binary; the Intel build
carries no signature at all.

Worth knowing before buying: a standard (OV) Windows certificate does not silence
SmartScreen immediately — reputation accrues as downloads accumulate. Only an EV
certificate is trusted on sight.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Arrow keys | Move the cursor — and collapse the selection onto it |
| 1 – 5 | Rate the selection |
| 0 | Clear the rating of the selection |
| Alt+Arrow Left/Right | Rotate the selection 90 CCW/CW — written to each file's EXIF orientation there and then |
| Backspace / Delete | Permanently delete the selection (asks first, and names the count) |
| Home / End | Jump to first / last image |
| V | Cycle layout: grid / loupe / filmstrip |
| Ctrl/Cmd+1 / 2 / 3 | Go straight to grid / loupe / filmstrip |
| I | Toggle metadata overlay (loupe/filmstrip) |
| Ctrl/Cmd+I | Toggle the info panel |
| P / C / A | Toggle focus peaking / exposure clipping / AF point |
| Ctrl/Cmd+O | Open a folder |
| F5 | Rescan the folder — new images in, missing ones out, scores and ratings kept |
| Ctrl/Cmd+S | Execute — delete the low-rated images |
| ? | Show / hide the shortcuts panel |

### Mouse

| Gesture | Action |
|---------|--------|
| Click | Select one image, and move the cursor to it |
| Shift+click | Select everything between the last click and this one |
| Ctrl/Cmd+click | Add one image to the selection, or take it out |
| Right click | Context menu — rating, rotate, reveal, delete — for the selection |
| Click a star | Rate that one image; clicking the lit star clears its rating |
| Scroll / drag | Zoom and pan in the info panel |

Right-clicking an image that is not in the selection selects just that image first, so the menu never
acts on something you cannot see. A star belongs to the photo it sits on: clicking it rates that photo
alone, whatever else is selected. **Reveal in Explorer/Finder** is the one menu item that does not act
on the whole selection: the OS call opens one folder with one file picked out, so it acts on the image
under the cursor.

The toolbar shows a count while more than one image is selected, and every selected cell carries a
white inner frame — distinct from the cursor's outline, because an image is usually both. Press `?` in
the app for the full shortcut list.

## Getting Started

### Prerequisites

- Node.js >= 20.19.0
- pnpm >= 10.x

### Development

```bash
# Install dependencies
pnpm install

# Start the dev server (opens Electron window)
pnpm dev
```

### Building

```bash
# Build for current platform
cd apps/desktop
pnpm build && pnpm package

# Build for macOS specifically
pnpm build && pnpm package:mac

# Build for Windows specifically
pnpm build && pnpm package:win
```

Built artifacts are output to `apps/desktop/dist/`.

Local builds are versioned `0.0.0-dev`. The version in
`apps/desktop/package.json` is a placeholder — see Releasing below.

### Releasing

The **git tag is the single source of truth** for the release version. Do not
bump `apps/desktop/package.json` by hand; CI overwrites it from the tag.

```bash
# Tag and push — that's the whole release
git tag v1.2.0
git push origin v1.2.0
```

Pushing a `v*` tag triggers `.github/workflows/build.yml`, which stamps the
version from the tag (`apps/desktop/scripts/set-version.mjs`), builds and
packages for macOS and Windows, then publishes a GitHub Release with the
installers attached.

## Project Structure

```
photo-culler/
  apps/
    desktop/          # Electron app (main + preload + renderer)
  packages/
    types/            # Shared TypeScript types (IPC, image metadata)
    image-utils/      # Image scanning, metadata, rating, orientation, sorting, grouping utilities
    ui/               # Shared UI components (future)
    tsconfig/         # Shared TypeScript configurations
```

## Tutorial

### Quick Start Workflow

1. **Open a folder** — Click "Open" or drag a folder onto the window. Subfolders are scanned too, one
   collapsible section per folder.
2. **Wait for processing** — EXIF and any existing ratings are read while the folder is scanned;
   quality scoring runs in the background afterwards
3. **Review images** — Arrow keys to move through the grid, V to switch to the loupe or filmstrip
4. **Rate** — Press 1-5, or click a star. Press 0 (or click the lit star) to clear. Each keypress is
   written straight into the image file.
5. **Or rate in batches** — Shift+click a run of near-identical frames, or Ctrl/Cmd+click a handful
   across the shoot, then press one number. One file write per image, all optimistic: a star that
   fails to save rolls back and says so.
6. **Rotate if needed** — Alt+Left/Right, or right-click > Rotate — both act on the selection, and
   each turn lands in the file at once. It changes the EXIF orientation tag and nothing else, so
   turning a photo back leaves it byte-for-byte as it was. JPEG only: PNG, WebP and TIFF say so
   rather than pretend
7. **Execute** — Ctrl/Cmd+S, or the "Execute" button:
   - The slider picks the top of the delete range; the bottom is always 1 star, so unrated images are
     never deleted
   - Those images are **permanently deleted** — there is no trash step and no undo
   - Only images currently visible are considered, so a filter also scopes the delete
   - Deleting is all Execute does: rotations are already on disk by the time you get here

### Tips

- **Ratings live in the photos, not in the app.** Nothing is lost if you move the files, and stars set
  in Lightroom or Explorer show up here. So does rotation — an EXIF orientation change, applied on
  the keypress. The per-folder `.photo-culler-results.json` only caches quality scores.
- **The selection is only ever what you can see.** Anything that hides an image — a filter, the search
  box, collapsing a folder — drops it from the selection on the spot, so a number key or a Delete can
  never reach a photo that is off screen. The cursor is separate: it stays where it was and drives the
  loupe, the info panel and the metadata read.
- **The rating filter** (toolbar) is an inclusive window: `0-0` shows only what you have not judged
  yet, `4-5` only the best. Execute always works on what the filter leaves visible.
- **Quality scores** appear on each thumbnail (0-100%). The info panel shows the breakdown: sharpness (40%), exposure (25%), contrast (20%), noise (15%). They are advisory — nothing filters or sorts by them.
- **Sorting** is by filename, ascending or descending. If your files are named after capture time, that is capture order.
- **Rescan** (`F5`) re-walks the folder after you have added or removed files elsewhere: new images
  come in, missing ones drop out, and cached thumbnails and score records whose image is gone are
  removed along with anything an older thumbnail format left behind. It keeps every quality score and
  every rating, asks nothing, and reports what it did in the toolbar for a few seconds. It never
  deletes a results file — ratings would survive that, because they live in the photos, but quality
  scores exist nowhere else and a large library costs hours of reading to rebuild them.
- **Grouping threshold** (View menu) controls how close timestamps must be to form a burst group. Default is 5 seconds.
- **Focus peaking**, **clipping** and **AF point** overlays (in the info panel) help evaluate technical quality without pixel-peeping.

## License

Private — all rights reserved.
