import { useEffect, useRef, useMemo } from 'react';
import type { OverlaySettings, OverlayActions } from '../hooks/useOverlaySettings';
import type { DetailedMetadataState } from '../hooks/useDetailedMetadata';
import type { QualitySubscores } from '@photo-culler/types';
import type { FolderSection } from '@photo-culler/image-utils/folders';
import type { PhotoGroup } from '@photo-culler/image-utils/grouping';
import { ThumbnailCell } from './ThumbnailCell';
import { DetailImageViewer } from './DetailImageViewer';
import { centerElementHorizontally } from '../lib/focus-scroll';
import { usePointerFocus } from '../hooks/usePointerFocus';

type ThumbnailStatus = ImageBitmap | 'loading' | 'error';

export interface DetailViewProps {
  folders: FolderSection[];
  focusedImageId: string | null;
  ratings: Record<string, number>;
  qualityScores: Record<string, number>;
  qualitySubscores: Record<string, QualitySubscores>;
  rotations: Record<string, number>;
  onImageFocus: (path: string) => void;
  onRate: (imagePath: string, rating: number) => void;
  getThumbnail: (id: string) => ThumbnailStatus;
  requestThumbnail: (id: string, url: string, size: number) => void;
  overlaySettings: OverlaySettings;
  overlayActions: OverlayActions;
  detailedMeta: DetailedMetadataState;
}

// ─── Grouped Filmstrip (horizontal) ─────────────────────────────────

const LOUPE_THUMB_SIZE = 72;

function LoupeFilmstrip({
  groups,
  focusedImageId,
  ratings,
  qualityScores,
  rotations,
  onImageFocus,
  getThumbnail,
  requestThumbnail,
}: {
  groups: PhotoGroup[];
  focusedImageId: string | null;
  ratings: Record<string, number>;
  qualityScores: Record<string, number>;
  rotations: Record<string, number>;
  onImageFocus: (path: string) => void;
  getThumbnail: (id: string) => ThumbnailStatus;
  requestThumbnail: (id: string, url: string, size: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { handleImageFocus, consumePointerFocus } = usePointerFocus(onImageFocus);

  /** Keep the focused image in the middle of the strip. */
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !focusedImageId) return;
    // The pointer put the cell where the user wanted it — see FocusOrigin.
    if (consumePointerFocus(focusedImageId)) return;

    const el = container.querySelector<HTMLElement>(
      `[data-image-path="${CSS.escape(focusedImageId)}"]`,
    );
    if (el) centerElementHorizontally(container, el);
  }, [focusedImageId, consumePointerFocus]);

  return (
    <div
      ref={containerRef}
      className="flex-shrink-0 bg-gray-900 border-t border-gray-700 flex items-center overflow-x-auto px-2 gap-1"
      style={{ height: LOUPE_THUMB_SIZE + 24 }}
      data-testid="loupe-filmstrip"
    >
      {groups.map((group, gi) => (
        <div key={group.id} className="flex items-center gap-1 flex-shrink-0">
          {gi > 0 && <div className="w-px h-16 bg-gray-600 mx-1 flex-shrink-0" />}
          <div className="flex flex-col items-center justify-center flex-shrink-0 w-6">
            <span className="text-[9px] text-gray-500 font-mono leading-tight">
              {group.images.length}
            </span>
          </div>
          {group.images.map((image) => (
            <div key={image.path} className="flex-shrink-0">
              <ThumbnailCell
                image={image}
                cellSize={LOUPE_THUMB_SIZE}
                rating={ratings[image.path]}
                qualityScore={qualityScores[image.path]}
                rotation={rotations[image.path]}
                isFocused={image.path === focusedImageId}
                onFocus={(origin) => handleImageFocus(image.path, origin)}
                getThumbnail={getThumbnail}
                requestThumbnail={requestThumbnail}
                groupIndex={gi}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Main LoupeView ──────────────────────────────────────────────────

export function LoupeView(props: DetailViewProps): React.JSX.Element {
  const {
    folders,
    focusedImageId,
    ratings,
    qualityScores,
    qualitySubscores,
    rotations,
    onImageFocus,
    onRate,
    getThumbnail,
    requestThumbnail,
    overlaySettings,
    overlayActions,
    detailedMeta,
  } = props;

  const flatImages = useMemo(
    () => folders.flatMap((section) => section.groups.flatMap((g) => g.images)),
    [folders],
  );
  /** The strip is a flat ribbon — folder structure is a grid-view concern. */
  const stripGroups = useMemo(() => folders.flatMap((section) => section.groups), [folders]);

  const focusedImage = useMemo(() => {
    if (!focusedImageId) return null;
    return flatImages.find((img) => img.path === focusedImageId) ?? null;
  }, [focusedImageId, flatImages]);

  const focusedRating = useMemo(() => {
    if (!focusedImage) return 0;
    return ratings[focusedImage.path] ?? 0;
  }, [focusedImage, ratings]);

  const focusedRotation = useMemo(() => {
    if (!focusedImage) return 0;
    return rotations[focusedImage.path] ?? 0;
  }, [focusedImage, rotations]);

  if (!focusedImageId) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
        Focus an image to view in loupe mode
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" data-testid="loupe-view">
      <DetailImageViewer
        focusedImageId={focusedImageId}
        focusedImage={focusedImage}
        focusedRating={focusedRating}
        focusedRotation={focusedRotation}
        onRate={onRate}
        qualityScores={qualityScores}
        qualitySubscores={qualitySubscores}
        allImages={flatImages}
        getThumbnail={getThumbnail}
        overlaySettings={overlaySettings}
        overlayActions={overlayActions}
        detailedMeta={detailedMeta}
      />

      <LoupeFilmstrip
        groups={stripGroups}
        focusedImageId={focusedImageId}
        ratings={ratings}
        qualityScores={qualityScores}
        rotations={rotations}
        onImageFocus={onImageFocus}
        getThumbnail={getThumbnail}
        requestThumbnail={requestThumbnail}
      />
    </div>
  );
}
