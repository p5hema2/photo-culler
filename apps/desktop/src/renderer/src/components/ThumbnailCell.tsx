import { useRef, useEffect } from 'react';
import type { ImageFileInfo } from '@photo-culler/types';

export type Classification = 'keep' | 'review' | 'delete' | null;
type ThumbnailStatus = ImageBitmap | 'loading' | 'error';

interface ThumbnailCellProps {
  image: ImageFileInfo;
  cellSize: number;
  classification: Classification;
  qualityScore?: number;
  rotation?: number;
  isFocused: boolean;
  isSelected: boolean;
  selectOnHover: boolean;
  onClick: () => void;
  onFocus: () => void;
  onCycleClassification: () => void;
  onToggleSelect: (path: string) => void;
  onRangeSelect: (path: string) => void;
  getThumbnail: (id: string) => ThumbnailStatus;
  requestThumbnail: (id: string, url: string, size: number, groupIndex?: number) => void;
  setLastModified?: (id: string, lastModified: number) => void;
  groupIndex: number;
}

const BORDER_COLORS: Record<string, string> = {
  keep: 'border-green-500',
  review: 'border-yellow-500',
  delete: 'border-red-500',
  null: 'border-transparent',
};

export function ThumbnailCell({
  image,
  cellSize,
  classification,
  qualityScore,
  rotation = 0,
  isFocused,
  isSelected,
  selectOnHover,
  onClick,
  onFocus,
  onCycleClassification,
  onToggleSelect,
  onRangeSelect,
  getThumbnail,
  requestThumbnail,
  setLastModified,
  groupIndex,
}: ThumbnailCellProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cellRef = useRef<HTMLDivElement>(null);
  const thumbnail = getThumbnail(image.path);

  // Auto-scroll into view when focused via keyboard
  useEffect(() => {
    if (isFocused && cellRef.current) {
      cellRef.current.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [isFocused]);

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

    // Account for border (2px) + gap (2px) on each side = 8px total
    const displaySize = cellSize - 8;
    canvas.width = displaySize;
    canvas.height = displaySize;

    ctx.clearRect(0, 0, displaySize, displaySize);

    if (rotation !== 0) {
      ctx.save();
      ctx.translate(displaySize / 2, displaySize / 2);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.drawImage(thumbnail, -displaySize / 2, -displaySize / 2, displaySize, displaySize);
      ctx.restore();
    } else {
      ctx.drawImage(thumbnail, 0, 0, displaySize, displaySize);
    }
  }, [thumbnail, cellSize, rotation]);

  const handleClick = (e: React.MouseEvent): void => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      onToggleSelect(image.path);
    } else if (e.shiftKey) {
      e.preventDefault();
      onRangeSelect(image.path);
    } else if (!selectOnHover) {
      // In click-select mode, left-click focuses the image
      onFocus();
    }
  };

  const handleContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault();
    onCycleClassification();
  };

  const handleMouseEnter = (): void => {
    if (selectOnHover) {
      onFocus();
    }
  };

  const borderColor = BORDER_COLORS[String(classification)] ?? 'border-transparent';

  return (
    <div
      ref={cellRef}
      className="relative cursor-pointer flex-shrink-0"
      style={{ width: cellSize, height: cellSize }}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onMouseEnter={handleMouseEnter}
      data-image-path={image.path}
      data-testid="thumbnail-cell"
      role="gridcell"
      tabIndex={isFocused ? 0 : -1}
    >
      {/* Selection overlay */}
      {isSelected && (
        <div className="absolute inset-0 bg-blue-500/30 z-10 pointer-events-none">
          <div className="absolute top-1 left-1 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center">
            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        </div>
      )}
      {/* Quality score badge */}
      {qualityScore != null && (
        <div className={`absolute bottom-1 left-1 z-10 bg-black/60 px-1 rounded text-[10px] font-mono ${
          qualityScore >= 60 ? 'text-green-400' : qualityScore >= 35 ? 'text-yellow-400' : 'text-red-400'
        }`}>
          {qualityScore}%
        </div>
      )}
      {/* Focus ring as outline - outside everything, 2px gap from classification border */}
      <div className={`absolute inset-0 ${isFocused ? 'outline-3 outline-blue-400 outline outline-offset-2' : ''}`} />
      {/* Classification border */}
      <div className={`absolute inset-0 border-2 ${borderColor}`}>
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
