import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { ImageFileInfo, QualitySubscores } from '@photo-culler/types';
import type { Classification } from './ThumbnailCell';
import { useZoomPan } from '../hooks/useZoomPan';
import { FocusPeakingOverlay } from './FocusPeakingOverlay';
import { ExposureClippingOverlay } from './ExposureClippingOverlay';

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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function scoreTextColor(score: number): string {
  if (score >= 60) return 'text-green-400';
  if (score >= 35) return 'text-yellow-400';
  return 'text-red-400';
}

// ─── Metadata Overlay ────────────────────────────────────────────────

export function MetadataOverlay({
  image,
  classification,
  qualityScore,
  qualitySubscores,
  rotation,
}: {
  image: ImageFileInfo;
  classification: Classification;
  qualityScore?: number;
  qualitySubscores?: QualitySubscores;
  rotation: number;
}) {
  const badge =
    classification === 'keep'
      ? { label: 'Keep', cls: 'bg-green-900/80 text-green-300 border-green-500' }
      : classification === 'review'
        ? { label: 'Review', cls: 'bg-yellow-900/80 text-yellow-300 border-yellow-500' }
        : classification === 'delete'
          ? { label: 'Delete', cls: 'bg-red-900/80 text-red-300 border-red-500' }
          : { label: 'Unscored', cls: 'bg-gray-700/80 text-gray-400 border-gray-500' };

  return (
    <div className="absolute bottom-2 left-2 z-30 bg-black/70 backdrop-blur-sm rounded-lg px-4 py-3 text-white text-xs max-w-sm pointer-events-none select-none">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="font-semibold text-sm truncate">{image.name}</span>
        <span className={`px-1.5 py-0.5 rounded border text-[10px] flex-shrink-0 ${badge.cls}`}>
          {badge.label}
        </span>
      </div>

      {(image.aperture || image.shutterSpeed || image.iso || image.focalLength) && (
        <div className="flex gap-3 text-gray-300 font-mono mb-1">
          {image.aperture && <span>f/{image.aperture}</span>}
          {image.shutterSpeed && <span>{image.shutterSpeed}</span>}
          {image.iso && <span>ISO {image.iso}</span>}
          {image.focalLength && <span>{image.focalLength}mm</span>}
          {image.exposureCompensation != null && image.exposureCompensation !== 0 && (
            <span>
              {image.exposureCompensation > 0 ? '+' : ''}
              {image.exposureCompensation.toFixed(1)} EV
            </span>
          )}
        </div>
      )}

      <div className="flex gap-3 text-gray-400">
        {qualityScore != null && (
          <span className={`font-mono font-semibold ${scoreTextColor(qualityScore)}`}>
            {qualityScore}%
          </span>
        )}
        {image.width && image.height && (
          <span>
            {image.width}×{image.height}
          </span>
        )}
        <span>{formatFileSize(image.size)}</span>
        {(image.cameraMake || image.cameraModel) && (
          <span className="truncate">
            {[image.cameraMake, image.cameraModel].filter(Boolean).join(' ')}
          </span>
        )}
        {rotation !== 0 && <span>↻{rotation}°</span>}
      </div>
    </div>
  );
}

// ─── Detail Image Viewer ─────────────────────────────────────────────

type ThumbnailStatus = ImageBitmap | 'loading' | 'error';

interface DetailImageViewerProps {
  focusedImageId: string | null;
  focusedImage: ImageFileInfo | null;
  focusedClassification: Classification;
  focusedRotation: number;
  qualityScores: Record<string, number>;
  qualitySubscores: Record<string, QualitySubscores>;
  allImages: ImageFileInfo[];
  getThumbnail: (id: string) => ThumbnailStatus;
  showFocusPeaking: boolean;
  showClipping: boolean;
}

export function DetailImageViewer({
  focusedImageId,
  focusedImage,
  focusedClassification,
  focusedRotation,
  qualityScores,
  qualitySubscores,
  allImages,
  getThumbnail,
  showFocusPeaking,
  showClipping,
}: DetailImageViewerProps): React.JSX.Element {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const [showMetadata, setShowMetadata] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const placeholderCanvasRef = useRef<HTMLCanvasElement>(null);
  const preloadCacheRef = useRef<Map<string, string>>(new Map());

  const { zoom, panX, panY, isDragging, handlers, resetZoom, zoomTo100, fitToWindow } = useZoomPan({
    imageWidth: imageDimensions.width,
    imageHeight: imageDimensions.height,
    containerRef,
  });

  // Toggle metadata with 'I' key
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (e.key === 'i' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setShowMetadata((prev) => !prev);
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, []);

  // Draw blurred placeholder
  useEffect(() => {
    const canvas = placeholderCanvasRef.current;
    if (!canvas || !isLoading || !focusedImageId) return;
    const thumb = getThumbnail(focusedImageId);
    if (thumb === 'loading' || thumb === 'error') return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = thumb.width;
    canvas.height = thumb.height;
    ctx.drawImage(thumb, 0, 0);
  }, [focusedImageId, isLoading, getThumbnail]);

  // Load full-size image
  useEffect(() => {
    if (!focusedImageId) {
      setImageUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    const cache = preloadCacheRef.current;
    const cached = cache.get(focusedImageId);
    if (cached) {
      // Transfer ownership from cache to imageUrl — remove from cache
      // so the cache can't revoke a URL that imageUrl is still using.
      cache.delete(focusedImageId);
      setImageUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return cached;
      });
      setIsLoading(false);
      return;
    }

    const load = async (): Promise<void> => {
      try {
        const buffer = await window.api.readFile(focusedImageId);
        if (cancelled) return;
        const ext = getExtension(focusedImageId);
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
        if (!cancelled) setIsLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [focusedImageId]);

  // Fit image to window when focused image or dimensions change.
  // Using fitToWindow (not resetZoom) in deps ensures we re-fit after
  // handleImageLoad updates imageDimensions, even for same-size images.
  useEffect(() => {
    fitToWindow();
  }, [focusedImageId, fitToWindow]);

  // Preload adjacent images
  useEffect(() => {
    if (isLoading || !focusedImageId) return;
    const idx = allImages.findIndex((img) => img.path === focusedImageId);
    if (idx === -1) return;

    const toPreload: string[] = [];
    if (idx > 0) toPreload.push(allImages[idx - 1]!.path);
    if (idx < allImages.length - 1) toPreload.push(allImages[idx + 1]!.path);

    const cache = preloadCacheRef.current;
    for (const path of toPreload) {
      if (cache.has(path)) continue;
      if (cache.size >= 3) {
        const keep = new Set([focusedImageId, ...toPreload]);
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
          cache.set(path, URL.createObjectURL(blob));
        } catch {
          /* non-critical */
        }
      };
      preload();
    }
  }, [focusedImageId, isLoading, allImages]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const url of preloadCacheRef.current.values()) URL.revokeObjectURL(url);
      preloadCacheRef.current.clear();
    };
  }, []);

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

  const handleDoubleClick = useCallback(() => {
    const isFitted =
      Math.abs(
        zoom -
          (containerRef.current
            ? Math.min(
                containerRef.current.getBoundingClientRect().width / imageDimensions.width,
                containerRef.current.getBoundingClientRect().height / imageDimensions.height,
              )
            : 1),
      ) < 0.01;
    if (isFitted) zoomTo100();
    else fitToWindow();
  }, [zoom, imageDimensions, zoomTo100, fitToWindow]);

  const cursorClass = isDragging
    ? 'cursor-grabbing'
    : zoom >
        (containerRef.current
          ? Math.min(
              containerRef.current.getBoundingClientRect().width / (imageDimensions.width || 1),
              containerRef.current.getBoundingClientRect().height / (imageDimensions.height || 1),
            )
          : 1)
      ? 'cursor-grab'
      : 'cursor-zoom-in';

  return (
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
        >
          Fit
        </button>
        <button
          onClick={zoomTo100}
          className="px-2 py-1 bg-gray-800/80 hover:bg-gray-700 rounded text-xs text-white"
        >
          100%
        </button>
        <button
          onClick={() => setShowMetadata((p) => !p)}
          className={`px-2 py-1 rounded text-xs transition-colors ${
            showMetadata
              ? 'bg-blue-600/80 hover:bg-blue-500 text-white'
              : 'bg-gray-800/80 hover:bg-gray-700 text-gray-400'
          }`}
          title="Toggle metadata overlay (I)"
        >
          Info
        </button>
      </div>

      {/* Blurred placeholder */}
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
        <div
          style={{
            transform: `scale(${zoom}) translate(${panX}px, ${panY}px)`,
            transformOrigin: '0 0',
            willChange: 'transform',
            position: 'relative',
            display: 'inline-block',
          }}
        >
          <img
            src={imageUrl}
            alt=""
            onLoad={handleImageLoad}
            className="max-w-none select-none"
            style={focusedRotation ? { transform: `rotate(${focusedRotation}deg)` } : undefined}
            draggable={false}
          />
          {showFocusPeaking && (
            <FocusPeakingOverlay
              imageUrl={imageUrl}
              imageDimensions={imageDimensions}
              visible={showFocusPeaking}
            />
          )}
          {showClipping && (
            <ExposureClippingOverlay
              imageUrl={imageUrl}
              imageDimensions={imageDimensions}
              visible={showClipping}
            />
          )}
        </div>
      )}

      {/* Metadata overlay */}
      {showMetadata && focusedImage && (
        <MetadataOverlay
          image={focusedImage}
          classification={focusedClassification}
          qualityScore={qualityScores[focusedImage.name]}
          qualitySubscores={qualitySubscores[focusedImage.name]}
          rotation={focusedRotation}
        />
      )}
    </div>
  );
}
