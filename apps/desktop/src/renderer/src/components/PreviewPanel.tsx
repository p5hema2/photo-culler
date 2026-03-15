import { useState, useEffect, useRef, useCallback } from 'react';
import type { ImageFileInfo } from '@photo-culler/types';
import { useZoomPan } from '../hooks/useZoomPan';
import { Filmstrip } from './Filmstrip';

type ThumbnailStatus = ImageBitmap | 'loading' | 'error';

interface PreviewPanelProps {
  imageId: string;
  images: ImageFileInfo[];
  onNavigate: (path: string) => void;
  onClose: () => void;
  getThumbnail: (id: string) => ThumbnailStatus;
  requestThumbnail: (id: string, url: string, size: number) => void;
}

const mimeMap: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  heic: 'image/jpeg',
};

function getExtension(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot >= 0 ? path.slice(dot + 1).toLowerCase() : '';
}

export function PreviewPanel({
  imageId,
  images,
  onNavigate,
  onClose,
  getThumbnail,
  requestThumbnail,
}: PreviewPanelProps): React.JSX.Element {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const preloadCacheRef = useRef<Map<string, string>>(new Map());
  const placeholderCanvasRef = useRef<HTMLCanvasElement>(null);

  const { zoom, panX, panY, isDragging, handlers, resetZoom, zoomTo100, fitToWindow } = useZoomPan({
    imageWidth: imageDimensions.width,
    imageHeight: imageDimensions.height,
    containerRef,
  });

  // Draw blurred placeholder thumbnail while loading
  useEffect(() => {
    const canvas = placeholderCanvasRef.current;
    if (!canvas || !isLoading) return;

    const thumb = getThumbnail(imageId);
    if (thumb === 'loading' || thumb === 'error') return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = thumb.width;
    canvas.height = thumb.height;
    ctx.drawImage(thumb, 0, 0);
  }, [imageId, isLoading, getThumbnail]);

  // Load full-size image
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    // Check preload cache first
    const cached = preloadCacheRef.current.get(imageId);
    if (cached) {
      setImageUrl((prev) => {
        if (prev && prev !== cached) URL.revokeObjectURL(prev);
        return cached;
      });
      setIsLoading(false);
      return;
    }

    const load = async (): Promise<void> => {
      try {
        const buffer = await window.api.readFile(imageId);
        if (cancelled) return;

        const ext = getExtension(imageId);
        const mimeType = mimeMap[ext] ?? 'image/jpeg';
        const blob = new Blob([buffer], { type: mimeType });
        const url = URL.createObjectURL(blob);

        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }

        setImageUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
      } catch {
        if (!cancelled) {
          setImageUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return null;
          });
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [imageId]);

  // Reset zoom on image change
  useEffect(() => {
    resetZoom();
  }, [imageId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Preload adjacent images
  useEffect(() => {
    if (isLoading) return; // wait until current image loaded

    const currentIndex = images.findIndex((img) => img.path === imageId);
    if (currentIndex === -1) return;

    const toPreload: string[] = [];
    if (currentIndex > 0) toPreload.push(images[currentIndex - 1]!.path);
    if (currentIndex < images.length - 1) toPreload.push(images[currentIndex + 1]!.path);

    const cache = preloadCacheRef.current;

    for (const path of toPreload) {
      if (cache.has(path)) continue;

      // Cap cache at 3 entries
      if (cache.size >= 3) {
        // Evict entries not in current neighborhood
        const keep = new Set([imageId, ...toPreload]);
        for (const [key, url] of cache) {
          if (!keep.has(key)) {
            URL.revokeObjectURL(url);
            cache.delete(key);
          }
        }
      }

      const preload = async (): Promise<void> => {
        try {
          const buffer = await window.api.readFile(path);
          const ext = getExtension(path);
          const mimeType = mimeMap[ext] ?? 'image/jpeg';
          const blob = new Blob([buffer], { type: mimeType });
          const url = URL.createObjectURL(blob);
          cache.set(path, url);
        } catch {
          // Preload failure is non-critical
        }
      };

      preload();
    }
  }, [imageId, isLoading, images]);

  // Cleanup preload cache on unmount
  useEffect(() => {
    return () => {
      for (const url of preloadCacheRef.current.values()) {
        URL.revokeObjectURL(url);
      }
      preloadCacheRef.current.clear();
    };
  }, []);

  // Cleanup main image URL on unmount
  useEffect(() => {
    return () => {
      setImageUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, []);

  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
  }, []);

  // Double-click toggles between fit and 100%
  const handleDoubleClick = useCallback(() => {
    const isFitted = Math.abs(zoom - (containerRef.current
      ? Math.min(
          containerRef.current.getBoundingClientRect().width / imageDimensions.width,
          containerRef.current.getBoundingClientRect().height / imageDimensions.height,
        )
      : 1)) < 0.01;

    if (isFitted) {
      zoomTo100();
    } else {
      fitToWindow();
    }
  }, [zoom, imageDimensions, zoomTo100, fitToWindow]);

  const cursorClass = isDragging ? 'cursor-grabbing' : zoom > (containerRef.current
    ? Math.min(
        containerRef.current.getBoundingClientRect().width / (imageDimensions.width || 1),
        containerRef.current.getBoundingClientRect().height / (imageDimensions.height || 1),
      )
    : 1) ? 'cursor-grab' : 'cursor-zoom-in';

  return (
    <div className="flex flex-col h-full" data-testid="preview-panel">
      {/* Main preview area */}
      <div
        ref={containerRef}
        className={`flex-1 overflow-hidden relative bg-black ${cursorClass}`}
        onWheel={handlers.onWheel}
        onMouseDown={handlers.onMouseDown}
        onDoubleClick={handleDoubleClick}
      >
        {/* Zoom controls */}
        <div className="absolute top-2 left-2 flex gap-1 z-20">
          <button
            onClick={fitToWindow}
            className="px-2 py-1 bg-gray-800/80 hover:bg-gray-700 rounded text-xs text-white"
            data-testid="zoom-fit-btn"
          >
            Fit
          </button>
          <button
            onClick={zoomTo100}
            className="px-2 py-1 bg-gray-800/80 hover:bg-gray-700 rounded text-xs text-white"
            data-testid="zoom-100-btn"
          >
            100%
          </button>
        </div>

        {/* Blurred placeholder while loading */}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <canvas
              ref={placeholderCanvasRef}
              className="max-w-full max-h-full object-contain"
              style={{ filter: 'blur(4px)' }}
            />
          </div>
        )}

        {/* Full-size image */}
        {imageUrl && (
          <img
            src={imageUrl}
            alt=""
            onLoad={handleImageLoad}
            style={{
              transform: `scale(${zoom}) translate(${panX}px, ${panY}px)`,
              transformOrigin: '0 0',
              willChange: 'transform',
            }}
            className="max-w-none select-none"
            draggable={false}
          />
        )}
      </div>

      {/* Filmstrip */}
      <Filmstrip
        images={images}
        activeImageId={imageId}
        onSelect={onNavigate}
        getThumbnail={getThumbnail}
        requestThumbnail={requestThumbnail}
      />
    </div>
  );
}
