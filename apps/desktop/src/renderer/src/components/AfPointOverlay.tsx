import { useEffect, useRef } from 'react';
import type { FocusInfo, NormRect } from '@photo-culler/types';
import { orientFocusInfo } from '@photo-culler/image-utils/focus';

interface AfPointOverlayProps {
  focus: FocusInfo | null;
  imageDimensions: { width: number; height: number };
  /** Current zoom, so stroke width stays constant in screen pixels. */
  zoom?: number;
  visible: boolean;
}

/** Reject vendor values that would draw a nonsense box on the photo. */
function isUsable(rect: NormRect): boolean {
  const { cx, cy, w, h } = rect;
  return (
    [cx, cy, w, h].every(Number.isFinite) && cx >= -0.5 && cx <= 1.5 && cy >= -0.5 && cy <= 1.5
  );
}

function toPixels(
  rect: NormRect,
  W: number,
  H: number,
): { left: number; top: number; width: number; height: number } {
  const width = rect.w * W;
  const height = rect.h * H;
  return { left: rect.cx * W - width / 2, top: rect.cy * H - height / 2, width, height };
}

/**
 * Draws where the camera actually focused.
 *
 * Unlike the peaking and clipping overlays this loads no image and computes no
 * pixels — it is a synchronous vector draw of about ten primitives.
 *
 * Coordinates arrive in the raw sensor frame; `orientFocusInfo` maps them into
 * the EXIF-oriented frame the browser renders (27% of a typical shoot is
 * portrait, where an unmapped box would sit 90 degrees out). That mapping is the
 * whole of it: rotating a photo now writes the EXIF Orientation tag, so the
 * browser turns the <img> and this canvas has the same frame either way.
 */
export function AfPointOverlay({
  focus,
  imageDimensions,
  zoom = 1,
  visible,
}: AfPointOverlayProps): React.JSX.Element | null {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !visible || !focus) return;
    const ctx = canvas.getContext('2d');
    // jsdom returns null here; the guard keeps component tests alive.
    if (!ctx) return;

    const W = imageDimensions.width;
    const H = imageDimensions.height;
    ctx.clearRect(0, 0, W, H);
    if (W <= 0 || H <= 0) return;

    const oriented = orientFocusInfo(focus);
    // The canvas sits inside the zoom transform, so a fixed image-space width
    // would be a hairline at fit-zoom and a slab at 100%.
    const lw = 2.5 / Math.max(zoom, 0.01);

    const strokeWithHalo = (draw: () => void, accent: string): void => {
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = lw * 2.4;
      draw();
      ctx.strokeStyle = accent;
      ctx.lineWidth = lw;
      draw();
    };

    for (const region of oriented.regions) {
      if (!isUsable(region.rect)) continue;
      const p = toPixels(region.rect, W, H);

      if (region.kind === 'af-point') {
        const cx = p.left + p.width / 2;
        const cy = p.top + p.height / 2;

        if (p.width > 0 && p.height > 0) {
          // Camera-style corner brackets read as "AF" instantly and stay
          // distinguishable from the solid-fill peaking and clipping overlays.
          const arm = Math.min(p.width, p.height) * 0.25;
          strokeWithHalo(() => {
            ctx.beginPath();
            // top-left
            ctx.moveTo(p.left, p.top + arm);
            ctx.lineTo(p.left, p.top);
            ctx.lineTo(p.left + arm, p.top);
            // top-right
            ctx.moveTo(p.left + p.width - arm, p.top);
            ctx.lineTo(p.left + p.width, p.top);
            ctx.lineTo(p.left + p.width, p.top + arm);
            // bottom-right
            ctx.moveTo(p.left + p.width, p.top + p.height - arm);
            ctx.lineTo(p.left + p.width, p.top + p.height);
            ctx.lineTo(p.left + p.width - arm, p.top + p.height);
            // bottom-left
            ctx.moveTo(p.left + arm, p.top + p.height);
            ctx.lineTo(p.left, p.top + p.height);
            ctx.lineTo(p.left, p.top + p.height - arm);
            ctx.stroke();
          }, 'rgba(251,191,36,0.95)');
        }

        const cross = (Math.min(W, H) * 0.012) / Math.max(zoom, 0.01);
        strokeWithHalo(() => {
          ctx.beginPath();
          ctx.moveTo(cx - cross, cy);
          ctx.lineTo(cx + cross, cy);
          ctx.moveTo(cx, cy - cross);
          ctx.lineTo(cx, cy + cross);
          ctx.stroke();
        }, 'rgba(251,191,36,0.95)');
      } else {
        // Faces: dashed and a different hue, so they stay readable where they
        // overlap the AF box.
        strokeWithHalo(() => {
          ctx.setLineDash([lw * 4, lw * 3]);
          ctx.beginPath();
          ctx.rect(p.left, p.top, p.width, p.height);
          ctx.stroke();
          ctx.setLineDash([]);
        }, 'rgba(163,230,53,0.9)');
      }
    }
  }, [focus, visible, zoom, imageDimensions.width, imageDimensions.height]);

  if (!visible || !focus || focus.regions.length === 0) return null;

  return (
    <canvas
      ref={canvasRef}
      width={imageDimensions.width}
      height={imageDimensions.height}
      className="absolute top-0 left-0 pointer-events-none"
      style={{ width: imageDimensions.width, height: imageDimensions.height }}
      data-testid="af-point-overlay"
    />
  );
}
