import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { ImageFileInfo, QualitySubscores } from '@photo-culler/types';
import { StarRating } from './StarRating';
import { extensionOf, isVideoFile, videoMimeType } from '@photo-culler/image-utils/media';
import { useZoomPan } from '../hooks/useZoomPan';
import { useFullImage } from '../hooks/useFullImage';
import { appUrlFor } from '../lib/app-url';
import { FocusPeakingOverlay } from './FocusPeakingOverlay';
import { ExposureClippingOverlay } from './ExposureClippingOverlay';
import { AfPointOverlay } from './AfPointOverlay';
import { OverlayControls } from './OverlayControls';
import type { OverlaySettings, OverlayActions } from '../hooks/useOverlaySettings';
import type { DetailedMetadataState } from '../hooks/useDetailedMetadata';

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
  rating,
  qualityScore,
  qualitySubscores,
}: {
  image: ImageFileInfo;
  rating: number;
  qualityScore?: number;
  qualitySubscores?: QualitySubscores;
}) {
  return (
    <div className="absolute bottom-2 left-2 z-30 bg-black/70 backdrop-blur-sm rounded-lg px-4 py-3 text-white text-xs max-w-sm pointer-events-none select-none">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="font-semibold text-sm truncate">{image.name}</span>
        <span className="flex-shrink-0">
          <StarRating rating={rating} interactive={false} size="sm" />
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
      </div>
    </div>
  );
}

// ─── Detail Image Viewer ─────────────────────────────────────────────

type ThumbnailStatus = ImageBitmap | 'loading' | 'error';

interface DetailImageViewerProps {
  focusedImageId: string | null;
  focusedImage: ImageFileInfo | null;
  /** Star rating of the focused image, 0-5, where 0 means unrated. */
  focusedRating: number;
  /** Takes the image's ABSOLUTE PATH — renderer state is keyed by path. */
  onRate: (imagePath: string, rating: number) => void;
  qualityScores: Record<string, number>;
  qualitySubscores: Record<string, QualitySubscores>;
  /** See PhotoState.fileRevision — bumped when a rotation rewrites a file. */
  fileRevision: number;
  allImages: ImageFileInfo[];
  getThumbnail: (id: string) => ThumbnailStatus;
  overlaySettings: OverlaySettings;
  overlayActions: OverlayActions;
  detailedMeta: DetailedMetadataState;
}

export function DetailImageViewer({
  focusedImageId,
  focusedImage,
  focusedRating,
  onRate,
  qualityScores,
  qualitySubscores,
  fileRevision,
  allImages,
  getThumbnail,
  overlaySettings,
  overlayActions,
  detailedMeta,
}: DetailImageViewerProps): React.JSX.Element {
  const { showFocusPeaking, showClipping, showAfPoint, focusPeakingThreshold } = overlaySettings;
  const focus = detailedMeta.status === 'ready' ? detailedMeta.data.focus : null;
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const [showMetadata, setShowMetadata] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const placeholderCanvasRef = useRef<HTMLCanvasElement>(null);

  /** The two images an arrow key can reach from here — read ahead, not on demand. */
  /**
   * Whether the cursor is on a video, which changes almost everything below.
   *
   * A video never goes through `useFullImage`: that reads the WHOLE file over
   * IPC into a blob URL, which is right for a 6 MB photo and would pull two
   * gigabytes into memory for a clip. It streams over `app://` instead, whose
   * handler answers Range requests precisely so this can seek.
   */
  const isVideo = focusedImage !== null && isVideoFile(focusedImage.name);
  const videoUrl = isVideo && focusedImage ? appUrlFor(focusedImage.path) : null;
  const videoType = focusedImage ? videoMimeType(focusedImage.name) : null;

  const neighbours = useMemo(() => {
    if (!focusedImageId) return [];
    const idx = allImages.findIndex((img) => img.path === focusedImageId);
    if (idx === -1) return [];
    const paths: string[] = [];
    // Neighbours are read whole, so a clip beside the photo you are looking at
    // must not be prefetched.
    if (idx > 0 && !isVideoFile(allImages[idx - 1]!.name)) paths.push(allImages[idx - 1]!.path);
    if (idx < allImages.length - 1 && !isVideoFile(allImages[idx + 1]!.name)) {
      paths.push(allImages[idx + 1]!.path);
    }
    return paths;
  }, [allImages, focusedImageId]);

  // No debounce here: this view has nothing else to show, and its prefetch
  // already makes the common case a cache hit. `reloadToken` covers the one way
  // an original can change without its path changing: a rotation writes the
  // file's EXIF Orientation tag, and the bytes already read carry the old one.
  const { url: imageUrl, isLoading } = useFullImage(isVideo ? null : focusedImageId, {
    neighbours,
    reloadToken: fileRevision,
  });

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

  // Fit image to window when focused image or dimensions change.
  // Using fitToWindow (not resetZoom) in deps ensures we re-fit after
  // handleImageLoad updates imageDimensions, even for same-size images.
  useEffect(() => {
    fitToWindow();
  }, [focusedImageId, fitToWindow]);

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
      <div className="absolute top-2 left-2 flex flex-col gap-1 items-start z-20 max-w-[240px]">
        <div className="flex gap-1">
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
        {/* Overlay toggles — previously only reachable from the grid's info
            panel, which does not mount in loupe or filmstrip. */}
        <OverlayControls
          settings={overlaySettings}
          actions={overlayActions}
          surface="hud"
          afAvailable={detailedMeta.status !== 'unsupported'}
        />
      </div>

      {/* Rating. stopPropagation because the container's mousedown starts a
          pan, and a rating click is not a drag. */}
      {focusedImage && !isVideo && (
        <div
          className="absolute top-2 right-2 z-20 bg-gray-800/80 rounded px-2 py-1"
          onMouseDown={(e) => e.stopPropagation()}
          data-testid="detail-rating"
        >
          <StarRating
            rating={focusedRating}
            onRate={(value) => onRate(focusedImage.path, value)}
            interactive
            size="lg"
            focusable
          />
        </div>
      )}

      {/*
        The player.
        Placed before the still-image branch and mutually exclusive with it:
        `imageUrl` is null for a video because `useFullImage` was never asked
        for one, so the two can never both render.

        No zoom/pan wrapper and no overlays. Focus peaking, exposure clipping
        and the AF box all read pixels out of a decoded still and all describe a
        single exposure; none of them means anything on a clip, and the AF box
        in particular would be positioned from maker-note data a video does not
        carry.
      */}
      {isVideo && videoUrl && (
        <div className="flex h-full w-full items-center justify-center p-4">
          {videoType ? (
            <video
              key={videoUrl}
              src={videoUrl}
              controls
              preload="metadata"
              className="max-h-full max-w-full"
              data-testid="detail-video"
              // The container's mousedown starts a pan; the player's own
              // controls are not a drag.
              onMouseDown={(e) => e.stopPropagation()}
            />
          ) : (
            <div
              className="rounded-lg border border-gray-700 bg-gray-800/60 px-6 py-5 text-center"
              data-testid="detail-video-unsupported"
            >
              <p className="text-sm text-gray-300">{focusedImage?.name}</p>
              <p className="mt-2 max-w-sm text-xs text-gray-500">
                Für{' '}
                <span className="font-mono uppercase">{extensionOf(focusedImage?.name ?? '')}</span>{' '}
                bringt Chromium keinen Decoder mit. Die Datei lässt sich trotzdem umbenennen,
                verschieben und löschen — nur nicht hier abspielen.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Blurred placeholder */}
      {!isVideo && isLoading && (
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
            draggable={false}
          />
          {showFocusPeaking && (
            <FocusPeakingOverlay
              imageUrl={imageUrl}
              imageDimensions={imageDimensions}
              visible={showFocusPeaking}
              threshold={focusPeakingThreshold}
            />
          )}
          {showClipping && (
            <ExposureClippingOverlay
              imageUrl={imageUrl}
              imageDimensions={imageDimensions}
              visible={showClipping}
            />
          )}
          {showAfPoint && (
            <AfPointOverlay
              focus={focus}
              imageDimensions={imageDimensions}
              zoom={zoom}
              visible={showAfPoint}
            />
          )}
        </div>
      )}

      {/* Metadata overlay */}
      {showMetadata && focusedImage && (
        <MetadataOverlay
          image={focusedImage}
          rating={focusedRating}
          qualityScore={qualityScores[focusedImage.path]}
          qualitySubscores={qualitySubscores[focusedImage.path]}
        />
      )}
    </div>
  );
}
