import { useRef, useEffect } from 'react';
import type { ImageFileInfo } from '@photo-culler/types';

export type Classification = 'keep' | 'review' | 'delete';
type ThumbnailStatus = ImageBitmap | 'loading' | 'error';

interface ThumbnailCellProps {
  image: ImageFileInfo;
  cellSize: number;
  classification: Classification;
  isFocused: boolean;
  onClick: () => void;
  getThumbnail: (id: string) => ThumbnailStatus;
  requestThumbnail: (id: string, url: string, size: number, groupIndex?: number) => void;
  setLastModified?: (id: string, lastModified: number) => void;
  groupIndex: number;
}

const BORDER_COLORS: Record<Classification, string> = {
  keep: 'border-green-500',
  review: 'border-yellow-500',
  delete: 'border-red-500',
};

export function ThumbnailCell({
  image,
  cellSize,
  classification,
  isFocused,
  onClick,
  getThumbnail,
  requestThumbnail,
  setLastModified,
  groupIndex,
}: ThumbnailCellProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const thumbnail = getThumbnail(image.path);

  // Register lastModified for disk cache validation
  useEffect(() => {
    if (setLastModified && image.lastModified) {
      setLastModified(image.path, image.lastModified);
    }
  }, [image.path, image.lastModified, setLastModified]);

  // Request thumbnail if not yet requested
  useEffect(() => {
    if (thumbnail === 'loading') {
      const encodedPath = image.path
        .split('/')
        .map(encodeURIComponent)
        .join('/');
      requestThumbnail(
        image.path,
        `app://file${encodedPath}`,
        256,
        groupIndex,
      );
    }
  }, [image.path, thumbnail, requestThumbnail, groupIndex]);

  // Draw bitmap to canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || thumbnail === 'loading' || thumbnail === 'error') return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Account for border (4px) + gap (2px) on each side = 12px total
    const displaySize = cellSize - 12;
    canvas.width = displaySize;
    canvas.height = displaySize;

    ctx.clearRect(0, 0, displaySize, displaySize);
    ctx.drawImage(thumbnail, 0, 0, displaySize, displaySize);
  }, [thumbnail, cellSize]);

  const borderColor = BORDER_COLORS[classification];

  return (
    <div
      className="relative cursor-pointer flex-shrink-0"
      style={{ width: cellSize, height: cellSize }}
      onClick={onClick}
      data-image-path={image.path}
      data-testid="thumbnail-cell"
      role="gridcell"
      tabIndex={isFocused ? 0 : -1}
    >
      {/* Focus ring as outline - outside everything */}
      <div className={`absolute inset-0 ${isFocused ? 'outline-2 outline-blue-400 outline' : ''}`} />
      {/* Classification border */}
      <div className={`absolute inset-0 border-4 ${borderColor}`}>
        {/* 2px gap with dark background for separation */}
        <div className="absolute inset-[2px] bg-gray-900 overflow-hidden">
          {thumbnail === 'loading' && (
            <div className="absolute inset-0 bg-gray-700 animate-pulse" data-testid="thumbnail-loading" />
          )}
          {thumbnail === 'error' && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-700" data-testid="thumbnail-error">
              <svg
                className="w-8 h-8 text-gray-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z"
                />
                <line x1="4" y1="4" x2="20" y2="20" stroke="currentColor" strokeWidth={1.5} />
              </svg>
            </div>
          )}
          {thumbnail !== 'loading' && thumbnail !== 'error' && (
            <canvas ref={canvasRef} className="w-full h-full" />
          )}
        </div>
      </div>
    </div>
  );
}
