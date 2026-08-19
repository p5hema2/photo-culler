# Photo Culler

A fast, keyboard-driven desktop app for culling photo shoots. Open a folder, review your images, classify them as keep/review/delete, and execute batch actions — all without leaving the keyboard.

Built with Electron, React, TypeScript, and Tailwind CSS.

## Features

- **Thumbnail grid** with virtual scrolling — handles thousands of images
- **Auto-grouping** by timestamp — burst shots are grouped together
- **Quality scoring** — automatic sharpness, exposure, contrast, and noise analysis
- **Keyboard-first workflow** — arrow keys to navigate, 1/2/3 to classify, Space to cycle
- **Image rotation** — Alt+Arrow to rotate, applied losslessly on execute
- **EXIF display** — camera body, lens, exposure settings, histogram
- **Focus peaking & clipping overlays** — spot soft focus and blown highlights
- **Zoom/pan preview** — scroll to zoom, drag to pan in the info panel
- **Batch execute** — trash rejects, move picks to subfolder, apply rotations
- **Persistent state** — classifications, scores, and rotations saved per folder

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
| Arrow keys | Navigate thumbnails |
| 1 | Classify as Keep |
| 2 | Classify as Review |
| 3 | Classify as Delete |
| 0 | Clear classification |
| Space | Cycle classification |
| Alt+Arrow Left/Right | Rotate image 90 CCW/CW |
| Enter | Open preview mode |
| Escape | Exit preview / clear selection |
| Ctrl/Cmd+A | Select all |
| Ctrl/Cmd+Click | Toggle select |
| Shift+Click | Range select |
| Backspace | Trash focused image |
| Delete | Trash selected images |
| Home / End | Jump to first / last image |

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
    image-utils/      # Image scanning, sorting, grouping utilities
    ui/               # Shared UI components (future)
    tsconfig/         # Shared TypeScript configurations
```

## Tutorial

### Quick Start Workflow

1. **Open a folder** — Click "Open" or drag a folder onto the window
2. **Wait for processing** — EXIF extraction and quality scoring run automatically
3. **Review images** — Arrow keys to move through the grid, Enter for full preview
4. **Classify** — Press 1 (keep), 2 (review), or 3 (delete) on each image
5. **Rotate if needed** — Alt+Left/Right to rotate images
6. **Execute** — Click "Save / Delete" to batch-process:
   - Trash or permanently delete images marked as "delete"
   - Optionally move "keep" images to a `picks/` subfolder
   - Optionally apply rotations to files on disk

### Tips

- **Quality scores** appear on each thumbnail (0-100%). The info panel shows the breakdown: sharpness (40%), exposure (25%), contrast (20%), noise (15%).
- **Rescan** re-processes the folder from scratch if you add/remove files externally.
- **Grouping threshold** (View menu) controls how close timestamps must be to form a burst group. Default is 5 seconds.
- **Focus peaking** and **clipping overlays** (in the info panel) help evaluate technical quality without pixel-peeping.
- Right-click any thumbnail to cycle its classification without selecting it.

## License

Private — all rights reserved.
