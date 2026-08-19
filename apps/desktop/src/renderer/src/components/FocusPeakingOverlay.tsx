import { useCallback } from 'react';
import { computeSobelEdges } from '../lib/image-analysis';
import { useOverlayCanvas } from '../hooks/useOverlayCanvas';

interface FocusPeakingOverlayProps {
  imageUrl: string | null;
  imageDimensions: { width: number; height: number };
  visible: boolean;
  /**
   * Sobel gradient magnitude above which a pixel counts as in focus. Part of
   * the cache key, so moving the slider actually recomputes.
   */
  threshold: number;
}

export function FocusPeakingOverlay({
  imageUrl,
  imageDimensions,
  visible,
  threshold,
}: FocusPeakingOverlayProps): React.JSX.Element | null {
  const compute = useCallback(
    (pixels: Uint8ClampedArray, width: number, height: number) =>
      computeSobelEdges(pixels, width, height, threshold),
    [threshold],
  );

  const canvasRef = useOverlayCanvas({
    imageUrl,
    imageDimensions,
    visible,
    cacheKey: `${imageUrl}|sobel|${threshold}`,
    compute,
  });

  if (!visible) return null;

  return (
    <canvas
      ref={canvasRef}
      width={imageDimensions.width}
      height={imageDimensions.height}
      className="absolute top-0 left-0 pointer-events-none"
      style={{ width: imageDimensions.width, height: imageDimensions.height }}
      data-testid="focus-peaking-overlay"
    />
  );
}
