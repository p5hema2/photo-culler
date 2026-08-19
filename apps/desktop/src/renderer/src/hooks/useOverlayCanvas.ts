import { useEffect, useRef } from 'react';

/** Longest edge the pixel analysis runs at. */
export const MAX_ANALYSIS_SIZE = 800;

interface SourcePixels {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Two cache levels, both at MODULE scope rather than in a ref.
 *
 * Module scope matters for three separate reasons:
 *  1. The parents render `{show && <Overlay/>}`, so the component unmounts on
 *     every toggle — a ref cache dies with it, and toggling an overlay off and
 *     on used to re-decode the full-size image.
 *  2. Focus peaking and clipping analyse the same photo; sharing the decoded
 *     source halves that work.
 *  3. Dragging the threshold slider then costs only the Sobel pass, never a
 *     decode. Keying a single cache on url+threshold would re-decode a 30 MB
 *     JPEG per slider step.
 */
const sourceCache = new Map<string, SourcePixels>();
const resultCache = new Map<string, ImageData>();
const MAX_ENTRIES = 4;

function remember<T>(cache: Map<string, T>, key: string, value: T): void {
  cache.set(key, value);
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

async function loadSource(url: string): Promise<SourcePixels | null> {
  const cached = sourceCache.get(url);
  if (cached) return cached;

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('image load failed'));
    });
  } catch {
    return null;
  }

  const scale = Math.min(1, MAX_ANALYSIS_SIZE / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.drawImage(img, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height);
  const source: SourcePixels = { pixels: data.data, width, height };
  remember(sourceCache, url, source);
  return source;
}

interface UseOverlayCanvasOptions {
  imageUrl: string | null;
  imageDimensions: { width: number; height: number };
  visible: boolean;
  /** Everything that changes the output, e.g. `${imageUrl}|sobel|${threshold}`. */
  cacheKey: string;
  /** Must be referentially stable — wrap in useCallback keyed on its inputs. */
  compute: (pixels: Uint8ClampedArray, width: number, height: number) => ImageData;
}

/**
 * Renders a computed pixel overlay onto a canvas sized to the full image.
 * Collapses the machinery the focus-peaking and clipping overlays used to
 * duplicate.
 */
export function useOverlayCanvas({
  imageUrl,
  imageDimensions,
  visible,
  cacheKey,
  compute,
}: UseOverlayCanvasOptions): React.RefObject<HTMLCanvasElement | null> {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!visible || !imageUrl) return;
    let cancelled = false;

    const draw = (result: ImageData): void => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      // jsdom has no 2D context; this guard is what keeps tests from crashing.
      if (!ctx) return;

      const tmp = document.createElement('canvas');
      tmp.width = result.width;
      tmp.height = result.height;
      const tmpCtx = tmp.getContext('2d');
      if (!tmpCtx) return;
      tmpCtx.putImageData(result, 0, 0);

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // Nearest-neighbour: smoothing would blur the hard overlay edges into a haze.
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
    };

    const cachedResult = resultCache.get(cacheKey);
    if (cachedResult) {
      draw(cachedResult);
      return;
    }

    void (async () => {
      const source = await loadSource(imageUrl);
      if (cancelled || !source) return;
      const result = compute(source.pixels, source.width, source.height);
      if (cancelled) return;
      remember(resultCache, cacheKey, result);
      draw(result);
    })();

    return () => {
      cancelled = true;
    };
  }, [imageUrl, visible, cacheKey, compute, imageDimensions.width, imageDimensions.height]);

  return canvasRef;
}
