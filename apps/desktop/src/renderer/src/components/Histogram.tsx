import { useRef, useEffect, useCallback } from 'react';

interface HistogramProps {
  imageElement: HTMLImageElement | null;
}

const CANVAS_WIDTH = 240;
const CANVAS_HEIGHT = 80;
const BG_COLOR = '#111111';

interface HistogramData {
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
}

function computeHistogram(imageElement: HTMLImageElement): HistogramData | null {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Downscale for performance -- max 400px on longest side
  const maxDim = 400;
  const scale = Math.min(
    1,
    maxDim / Math.max(imageElement.naturalWidth, imageElement.naturalHeight),
  );
  const w = Math.round(imageElement.naturalWidth * scale);
  const h = Math.round(imageElement.naturalHeight * scale);

  canvas.width = w;
  canvas.height = h;
  ctx.drawImage(imageElement, 0, 0, w, h);

  let pixels: Uint8ClampedArray;
  try {
    pixels = ctx.getImageData(0, 0, w, h).data;
  } catch {
    // CORS or tainted canvas
    return null;
  }

  const r = new Uint32Array(256);
  const g = new Uint32Array(256);
  const b = new Uint32Array(256);

  for (let i = 0; i < pixels.length; i += 4) {
    r[pixels[i]!]++;
    g[pixels[i + 1]!]++;
    b[pixels[i + 2]!]++;
  }

  return { r, g, b };
}

function drawHistogram(canvas: HTMLCanvasElement, data: HistogramData): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const { width, height } = canvas;
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, width, height);

  // Find max across all channels (skip first/last few bins to avoid extremes from clipping)
  let maxCount = 0;
  for (let i = 2; i < 254; i++) {
    maxCount = Math.max(maxCount, data.r[i]!, data.g[i]!, data.b[i]!);
  }
  if (maxCount === 0) return;

  const channels: Array<{ bins: Uint32Array; color: string }> = [
    { bins: data.r, color: 'rgba(255, 60, 60, 0.5)' },
    { bins: data.g, color: 'rgba(60, 255, 60, 0.5)' },
    { bins: data.b, color: 'rgba(60, 100, 255, 0.5)' },
  ];

  const binWidth = width / 256;

  for (const channel of channels) {
    ctx.fillStyle = channel.color;
    ctx.beginPath();
    ctx.moveTo(0, height);

    for (let i = 0; i < 256; i++) {
      const x = i * binWidth;
      const h = (channel.bins[i]! / maxCount) * height;
      ctx.lineTo(x, height - h);
    }

    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fill();
  }
}

export function Histogram({ imageElement }: HistogramProps): React.JSX.Element | null {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastSrcRef = useRef<string | null>(null);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageElement) return;

    // Only recompute if image source changed
    if (imageElement.src === lastSrcRef.current) return;
    lastSrcRef.current = imageElement.src;

    const data = computeHistogram(imageElement);
    if (data) {
      requestAnimationFrame(() => {
        drawHistogram(canvas, data);
      });
    }
  }, [imageElement]);

  useEffect(() => {
    if (!imageElement) {
      // Clear canvas
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = BG_COLOR;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
      }
      lastSrcRef.current = null;
      return;
    }

    if (imageElement.complete && imageElement.naturalWidth > 0) {
      render();
    } else {
      const handleLoad = (): void => {
        render();
      };
      imageElement.addEventListener('load', handleLoad);
      return () => imageElement.removeEventListener('load', handleLoad);
    }
  }, [imageElement, render]);

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_WIDTH}
      height={CANVAS_HEIGHT}
      className="w-full rounded"
      style={{ height: `${CANVAS_HEIGHT}px`, background: BG_COLOR }}
      data-testid="histogram"
    />
  );
}
