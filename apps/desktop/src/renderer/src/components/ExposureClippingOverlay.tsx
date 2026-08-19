import { useCallback } from 'react';
import { computeClippingOverlay } from '../lib/image-analysis';
import { useOverlayCanvas } from '../hooks/useOverlayCanvas';

interface ExposureClippingOverlayProps {
  imageUrl: string | null;
  imageDimensions: { width: number; height: number };
  visible: boolean;
}

export function ExposureClippingOverlay({
  imageUrl,
  imageDimensions,
  visible,
}: ExposureClippingOverlayProps): React.JSX.Element | null {
  const compute = useCallback(
    (pixels: Uint8ClampedArray, width: number, height: number) =>
      computeClippingOverlay(pixels, width, height),
    [],
  );

  const canvasRef = useOverlayCanvas({
    imageUrl,
    imageDimensions,
    visible,
    cacheKey: `${imageUrl}|clipping`,
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
      data-testid="clipping-overlay"
    />
  );
}
