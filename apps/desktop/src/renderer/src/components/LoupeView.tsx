import { useEffect, useRef, useMemo } from 'react';
import type { QualitySubscores } from '@photo-culler/types';
import type { PhotoGroup } from '@photo-culler/image-utils/grouping';
import type { Classification } from './ThumbnailCell';
import { ThumbnailCell } from './ThumbnailCell';
import { DetailImageViewer } from './DetailImageViewer';

type ThumbnailStatus = ImageBitmap | 'loading' | 'error';

export interface DetailViewProps {
  groups: PhotoGroup[];
  focusedImageId: string | null;
  classifications: Record<string, Classification>;
  qualityScores: Record<string, number>;
  qualitySubscores: Record<string, QualitySubscores>;
  rotations: Record<string, number>;
  selectOnHover: boolean;
  onImageClick: (filename: string) => void;
  onImageFocus: (path: string) => void;
  onCycleClassification: (filename: string) => void;
  getThumbnail: (id: string) => ThumbnailStatus;
  requestThumbnail: (id: string, url: string, size: number) => void;
  showFocusPeaking: boolean;
  showClipping: boolean;
}

// ─── Grouped Filmstrip (horizontal) ─────────────────────────────────

const LOUPE_THUMB_SIZE = 72;

function LoupeFilmstrip({
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
      el.scrollIntoView({ inline: 'center', behavior: 'smooth' });
    }
  }, [focusedImageId]);

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

// ─── Main LoupeView ──────────────────────────────────────────────────

export function LoupeView(props: DetailViewProps): React.JSX.Element {
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
        Focus an image to view in loupe mode
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" data-testid="loupe-view">
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

      <LoupeFilmstrip
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
    </div>
  );
}
