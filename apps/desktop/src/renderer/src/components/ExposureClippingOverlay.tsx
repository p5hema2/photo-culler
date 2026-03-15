import { useEffect, useRef } from 'react';
import { computeClippingOverlay } from '../lib/image-analysis';

interface ExposureClippingOverlayProps {
  imageUrl: string | null;
  imageDimensions: { width: number; height: number };
  visible: boolean;
}

const MAX_ANALYSIS_SIZE = 800;

export function ExposureClippingOverlay({
  imageUrl,
  imageDimensions,
  visible,
}: ExposureClippingOverlayProps): React.JSX.Element | null {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cacheRef = useRef<{ url: string; data: ImageData } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!visible || !imageUrl) {
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    // Check cache
    if (cacheRef.current?.url === imageUrl) {
      canvas.width = imageDimensions.width;
      canvas.height = imageDimensions.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const tmp = document.createElement('canvas');
        tmp.width = cacheRef.current.data.width;
        tmp.height = cacheRef.current.data.height;
        const tmpCtx = tmp.getContext('2d');
        if (tmpCtx) {
          tmpCtx.putImageData(cacheRef.current.data, 0, 0);
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
        }
      }
      return;
    }

    let cancelled = false;

    const compute = async (): Promise<void> => {
      const img = new Image();
      img.crossOrigin = 'anonymous';

      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = imageUrl;
      });

      if (cancelled) return;

      const scale = Math.min(1, MAX_ANALYSIS_SIZE / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);

      const offscreen = document.createElement('canvas');
      offscreen.width = w;
      offscreen.height = h;
      const offCtx = offscreen.getContext('2d');
      if (!offCtx) return;

      offCtx.drawImage(img, 0, 0, w, h);
      const imageData = offCtx.getImageData(0, 0, w, h);

      if (cancelled) return;

      const clippingData = computeClippingOverlay(imageData.data, w, h);

      if (cancelled) return;

      cacheRef.current = { url: imageUrl, data: clippingData };

      canvas.width = imageDimensions.width;
      canvas.height = imageDimensions.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const tmp = document.createElement('canvas');
        tmp.width = w;
        tmp.height = h;
        const tmpCtx = tmp.getContext('2d');
        if (tmpCtx) {
          tmpCtx.putImageData(clippingData, 0, 0);
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
        }
      }
    };

    compute().catch(() => {
      // Non-critical overlay failure
    });

    return () => {
      cancelled = true;
    };
  }, [imageUrl, visible, imageDimensions.width, imageDimensions.height]);

  if (!visible) return null;

  return (
    <canvas
      ref={canvasRef}
      width={imageDimensions.width}
      height={imageDimensions.height}
      className="absolute top-0 left-0 pointer-events-none"
      style={{ width: imageDimensions.width, height: imageDimensions.height }}
    />
  );
}
