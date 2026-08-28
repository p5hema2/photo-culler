import { useEffect, useRef, useMemo } from 'react';
import { ThumbnailCell } from './ThumbnailCell';
import { DetailImageViewer } from './DetailImageViewer';
import { centerElementVertically } from '../lib/focus-scroll';
import { usePointerFocus } from '../hooks/usePointerFocus';
import type { PhotoGroup } from '@photo-culler/image-utils/grouping';
import type { DetailViewProps } from './LoupeView';

type ThumbnailStatus = ImageBitmap | 'loading' | 'error';

// ─── Vertical Filmstrip (left column) ───────────────────────────────

const FILMSTRIP_THUMB_SIZE = 100;

function VerticalFilmstrip({
  groups,
  focusedImageId,
  ratings,
  qualityScores,
  onImageFocus,
  getThumbnail,
  requestThumbnail,
}: {
  groups: PhotoGroup[];
  focusedImageId: string | null;
  ratings: Record<string, number>;
  qualityScores: Record<string, number>;
  onImageFocus: (path: string) => void;
  getThumbnail: (id: string) => ThumbnailStatus;
  requestThumbnail: (id: string, url: string, size: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { handleImageFocus, consumePointerFocus } = usePointerFocus(onImageFocus);

  /** Keep the focused image in the vertical middle, the way a loupe does. */
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !focusedImageId) return;
    // The pointer put the cell where the user wanted it — see FocusOrigin.
    if (consumePointerFocus(focusedImageId)) return;

    const el = container.querySelector<HTMLElement>(
      `[data-image-path="${CSS.escape(focusedImageId)}"]`,
    );
    if (el) centerElementVertically(container, el);
  }, [focusedImageId, consumePointerFocus]);

  return (
    <div
      ref={containerRef}
      className="flex-shrink-0 bg-gray-900 border-r border-gray-700 overflow-y-auto overflow-x-hidden py-1"
      style={{ width: FILMSTRIP_THUMB_SIZE + 16 }}
      data-testid="vertical-filmstrip"
    >
      {groups.map((group, gi) => (
        <div key={group.id} className="flex flex-col items-center gap-1">
          {gi > 0 && <div className="h-px w-3/4 bg-gray-600 my-1" />}
          <div className="text-[9px] text-gray-500 font-mono leading-tight">
            {group.images.length}
          </div>
          {group.images.map((image) => (
            <div key={image.path} className="px-2">
              <ThumbnailCell
                image={image}
                cellSize={FILMSTRIP_THUMB_SIZE}
                rating={ratings[image.path]}
                qualityScore={qualityScores[image.path]}
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

// ─── Main FilmstripView ──────────────────────────────────────────────

export function FilmstripView(props: DetailViewProps): React.JSX.Element {
  const {
    folders,
    focusedImageId,
    ratings,
    qualityScores,
    qualitySubscores,
    fileRevision,
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

  if (!focusedImageId) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
        Focus an image to view in filmstrip mode
      </div>
    );
  }

  return (
    <div className="flex h-full" data-testid="filmstrip-view">
      <VerticalFilmstrip
        groups={stripGroups}
        focusedImageId={focusedImageId}
        ratings={ratings}
        qualityScores={qualityScores}
        onImageFocus={onImageFocus}
        getThumbnail={getThumbnail}
        requestThumbnail={requestThumbnail}
      />

      <DetailImageViewer
        focusedImageId={focusedImageId}
        focusedImage={focusedImage}
        focusedRating={focusedRating}
        onRate={onRate}
        qualityScores={qualityScores}
        qualitySubscores={qualitySubscores}
        fileRevision={fileRevision}
        allImages={flatImages}
        getThumbnail={getThumbnail}
        overlaySettings={overlaySettings}
        overlayActions={overlayActions}
        detailedMeta={detailedMeta}
      />
    </div>
  );
}
