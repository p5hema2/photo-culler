import { useRef, useEffect, useCallback } from 'react';
import type { ImageFileInfo } from '@photo-culler/types';

type ThumbnailStatus = ImageBitmap | 'loading' | 'error';

interface FilmstripProps {
  images: ImageFileInfo[];
  activeImageId: string;
  onSelect: (path: string) => void;
  getThumbnail: (id: string) => ThumbnailStatus;
  requestThumbnail: (id: string, url: string, size: number) => void;
}

function FilmstripThumbnail({
  image,
  isActive,
  onSelect,
  getThumbnail,
  requestThumbnail,
}: {
  image: ImageFileInfo;
  isActive: boolean;
  onSelect: (path: string) => void;
  getThumbnail: (id: string) => ThumbnailStatus;
  requestThumbnail: (id: string, url: string, size: number) => void;
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const thumbnail = getThumbnail(image.path);

  // Request thumbnail if loading
  useEffect(() => {
    if (thumbnail === 'loading') {
      const encodedPath = image.path
        .split('/')
        .map(encodeURIComponent)
        .join('/');
      requestThumbnail(image.path, `app://file${encodedPath}`, 256);
    }
  }, [image.path, thumbnail, requestThumbnail]);

  // Draw bitmap to canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || thumbnail === 'loading' || thumbnail === 'error') return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = 64;
    canvas.height = 64;
    ctx.clearRect(0, 0, 64, 64);
    ctx.drawImage(thumbnail, 0, 0, 64, 64);
  }, [thumbnail]);

  const handleClick = useCallback(() => {
    onSelect(image.path);
  }, [onSelect, image.path]);

  const borderClass = isActive
    ? 'border-2 border-blue-400'
    : 'border-2 border-transparent hover:border-gray-500';

  return (
    <div
      className={`flex-shrink-0 cursor-pointer ${borderClass}`}
      style={{ width: 64, height: 64 }}
      onClick={handleClick}
      data-image-path={image.path}
      data-testid="filmstrip-thumbnail"
    >
      {thumbnail === 'loading' && (
        <div className="w-full h-full bg-gray-700 animate-pulse" />
      )}
      {thumbnail === 'error' && (
        <div className="w-full h-full bg-gray-700 flex items-center justify-center">
          <span className="text-gray-500 text-xs">!</span>
        </div>
      )}
      {thumbnail !== 'loading' && thumbnail !== 'error' && (
        <canvas ref={canvasRef} className="w-full h-full" />
      )}
    </div>
  );
}

export function Filmstrip({
  images,
  activeImageId,
  onSelect,
  getThumbnail,
  requestThumbnail,
}: FilmstripProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll active thumbnail into view
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const activeEl = container.querySelector(`[data-image-path="${CSS.escape(activeImageId)}"]`);
    if (activeEl) {
      activeEl.scrollIntoView({ inline: 'center', behavior: 'smooth' });
    }
  }, [activeImageId]);

  return (
    <div
      ref={containerRef}
      className="h-20 bg-gray-900 border-t border-gray-700 flex items-center overflow-x-auto px-2 gap-1"
      data-testid="filmstrip"
    >
      {images.map((image) => (
        <FilmstripThumbnail
          key={image.path}
          image={image}
          isActive={image.path === activeImageId}
          onSelect={onSelect}
          getThumbnail={getThumbnail}
          requestThumbnail={requestThumbnail}
        />
      ))}
    </div>
  );
}
