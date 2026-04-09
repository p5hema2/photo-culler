import { useEffect, useRef, useMemo } from 'react';
import type { PhotoGroup } from '@photo-culler/image-utils/grouping';
import type { Classification } from './ThumbnailCell';
import { ThumbnailCell } from './ThumbnailCell';
import { DetailImageViewer } from './DetailImageViewer';
import type { DetailViewProps } from './LoupeView';

type ThumbnailStatus = ImageBitmap | 'loading' | 'error';

// ─── Vertical Filmstrip (left column) ───────────────────────────────

const FILMSTRIP_THUMB_SIZE = 100;

function VerticalFilmstrip({
  groups,
  focusedImageId,
  classifications,
  qualityScores,
  rotations,
  selectOnHover,
  onImageClick,
  onImageFocus,
  onCycleClassification,
  getThumbnail,
  requestThumbnail,
}: {
  groups: PhotoGroup[];
  focusedImageId: string | null;
  classifications: Record<string, Classification>;
  qualityScores: Record<string, number>;
  rotations: Record<string, number>;
  selectOnHover: boolean;
  onImageClick: (filename: string) => void;
  onImageFocus: (path: string) => void;
  onCycleClassification: (filename: string) => void;
  getThumbnail: (id: string) => ThumbnailStatus;
  requestThumbnail: (id: string, url: string, size: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !focusedImageId) return;
    const el = container.querySelector(`[data-image-path="${CSS.escape(focusedImageId)}"]`);
    if (el) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [focusedImageId]);

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
                classification={classifications[image.name] ?? null}
                qualityScore={qualityScores[image.name]}
                rotation={rotations[image.name]}
                isFocused={image.path === focusedImageId}
                selectOnHover={selectOnHover}
                onClick={() => onImageClick(image.name)}
                onFocus={() => onImageFocus(image.path)}
                onCycleClassification={() => onCycleClassification(image.name)}
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
    groups,
    focusedImageId,
    classifications,
    qualityScores,
    qualitySubscores,
    rotations,
    selectOnHover,
    onImageClick,
    onImageFocus,
    onCycleClassification,
    getThumbnail,
    requestThumbnail,
    showFocusPeaking,
    showClipping,
  } = props;

  const flatImages = useMemo(() => groups.flatMap((g) => g.images), [groups]);

  const focusedImage = useMemo(() => {
    if (!focusedImageId) return null;
    return flatImages.find((img) => img.path === focusedImageId) ?? null;
  }, [focusedImageId, flatImages]);

  const focusedClassification = useMemo(() => {
    if (!focusedImage) return null;
    return classifications[focusedImage.name] ?? null;
  }, [focusedImage, classifications]);

  const focusedRotation = useMemo(() => {
    if (!focusedImage) return 0;
    return rotations[focusedImage.name] ?? 0;
  }, [focusedImage, rotations]);

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
        groups={groups}
        focusedImageId={focusedImageId}
        classifications={classifications}
        qualityScores={qualityScores}
        rotations={rotations}
        selectOnHover={selectOnHover}
        onImageClick={onImageClick}
        onImageFocus={onImageFocus}
        onCycleClassification={onCycleClassification}
        getThumbnail={getThumbnail}
        requestThumbnail={requestThumbnail}
      />

      <DetailImageViewer
        focusedImageId={focusedImageId}
        focusedImage={focusedImage}
        focusedClassification={focusedClassification}
        focusedRotation={focusedRotation}
        qualityScores={qualityScores}
        qualitySubscores={qualitySubscores}
        allImages={flatImages}
        getThumbnail={getThumbnail}
        showFocusPeaking={showFocusPeaking}
        showClipping={showClipping}
      />
    </div>
  );
}
