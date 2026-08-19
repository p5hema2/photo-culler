# Build resources

Everything electron-builder picks up by convention from `buildResources: build`.

| File | Used by |
|---|---|
| `icon-source.png` | Nothing at pack time — it is the master artwork the others are generated from |
| `icon.icns` | macOS `.app` bundle |
| `icon.ico` | Windows `.exe` and the NSIS installer |
| `icon.png` | The dev window (`src/main/index.ts`); the reference 512px render |
| `entitlements.mac.plist` | macOS hardened runtime, once the app is signed |

## Regenerating the icons

Drop a square PNG of at least 1024x1024 at `build/icon-source.png` and run, from
`apps/desktop`:

```bash
pnpm icons
```

`scripts/make-icons.mjs` writes all three derived files. It builds the `.ico` and
`.icns` containers itself rather than shelling out to `iconutil` or ImageMagick —
neither exists on a Windows dev machine, and both formats are a small header
wrapping embedded PNGs. Commit the master along with the generated files so the
set can always be rebuilt.

Sizes emitted: `.ico` at 16/24/32/48/64/128/256, `.icns` at 32 through 1024
including the `@2x` slots macOS asks for on Retina displays.

## Generating the artwork

The prompt below produces a usable icon from an image model. Swap the `Subject:`
line to change direction; keep the constraints, which are what make it survive
being shrunk to a 32px list row.

```text
Create an application icon for a desktop app called "Photo Culler" — a tool
photographers use to rapidly triage a shoot: they flip through hundreds of
near-identical frames and mark each one keep, review, or delete.

Composition:
- Square canvas, 1024 x 1024 px.
- A single centred subject on a rounded-square (squircle) badge that fills the
  canvas edge to edge, with roughly 8% breathing room inside the corners.
- Subject: a small stack of photo frames, the top one crisp and highlighted,
  with a bold check mark badge overlapping its lower-right corner.

Style:
- Flat modern vector, geometric, thick confident shapes — the visual language of
  macOS Sonoma and Windows 11 app icons.
- Badge background: near-black charcoal, subtle vertical gradient (#2b313b to
  #171a1f).
- Accent palette, used sparingly: green #22c55e (the check), amber #fbbf24,
  red #ef4444, light neutral #e8eaed for the photo surface.
- Depth only from flat layering and one soft ambient shadow. No glossy
  highlights, no skeuomorphic leather or glass, no 3D render.

Hard constraints:
- No text, no letters, no numbers anywhere.
- No thin strokes or fine detail: every element must stay readable when the icon
  is shrunk to 32 x 32 px.
- Two or three shapes maximum. Simplicity beats accuracy.
- No photographic imagery, no people, no camera bodies, no lens barrels.
- Fully opaque artwork filling the square — no transparent background, no
  drop shadow spilling outside the badge, no mockup, no device frame, no
  presentation scene. Just the icon itself, filling the frame.

Deliver a single 1024 x 1024 PNG.
```

Two things worth checking before committing whatever comes back: that the image
is genuinely square (models like to return 1024x1536), and that it still reads at
32px — open `build/icon.ico` in an image viewer, or just look at the dev window's
taskbar entry.

## A note on the green accent

The accents deliberately echo the app's own classification colours — green keep,
amber review, red delete — so the icon and the grid speak the same language.
Those hexes are Tailwind's `green-500`, `amber-400` and `red-500`, the same
scales `ThumbnailCell` borders use.
