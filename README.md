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
