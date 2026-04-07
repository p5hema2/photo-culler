import type { PhotoGroup } from '@photo-culler/image-utils/grouping';
import type { ImageFileInfo } from '@photo-culler/types';
import { ThumbnailCell } from './ThumbnailCell';
import type { Classification } from './ThumbnailCell';

interface GroupRowProps {
  group: PhotoGroup;
  cellSize: number;
  classifications: Record<string, Classification>;
  qualityScores: Record<string, number>;
  rotations: Record<string, number>;
  focusedImageId: string | null;
  selectedImages: Set<string>;
  selectOnHover: boolean;
  onImageClick: (filename: string) => void;
  onImageFocus: (path: string) => void;
  onCycleClassification: (filename: string) => void;
  onToggleSelect: (path: string) => void;
  onRangeSelect: (path: string) => void;
  getThumbnail: (id: string) => ImageBitmap | 'loading' | 'error';
  requestThumbnail: (id: string, url: string, size: number, groupIndex?: number) => void;
  setLastModified?: (id: string, lastModified: number) => void;
  groupIndex: number;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'UTC',
  });
}

function offsetToLabel(offset: string): string {
  const labels: Record<string, string> = {
    '+00:00': 'UTC',
    '+01:00': 'CET',
    '+02:00': 'CEST',
    '+09:00': 'JST',
    '-05:00': 'EST',
    '-08:00': 'PST',
  };
  return labels[offset] ?? `UTC${offset}`;
}

function getClassificationSummary(
  images: ImageFileInfo[],
  classifications: Record<string, Classification>,
): string {
  const counts = { keep: 0, review: 0, delete: 0, unclassified: 0 };
  for (const img of images) {
    const cls = classifications[img.name] ?? null;
    if (cls === null) {
      counts.unclassified++;
    } else {
      counts[cls]++;
    }
  }
  const parts: string[] = [];
  if (counts.keep > 0) parts.push(`${counts.keep} keep`);
  if (counts.review > 0) parts.push(`${counts.review} review`);
  if (counts.delete > 0) parts.push(`${counts.delete} delete`);
  return parts.join(' \u00B7 ');
}

export function GroupRow({
  group,
  cellSize,
  classifications,
  qualityScores,
  rotations,
  focusedImageId,
  selectedImages,
  selectOnHover,
  onImageClick,
  onImageFocus,
  onCycleClassification,
  onToggleSelect,
  onRangeSelect,
  getThumbnail,
  requestThumbnail,
  setLastModified,
  groupIndex,
}: GroupRowProps): React.JSX.Element {
  const photoCount = group.images.length;

  // Use dateTakenLocal (wall-clock time) for display, falling back to dateTaken
  const localTimes = group.images
    .map((img) => img.dateTakenLocal ?? img.dateTaken)
    .filter((t): t is number => t != null);
  const startLocal = localTimes.length > 0 ? Math.min(...localTimes) : null;
  const endLocal = localTimes.length > 0 ? Math.max(...localTimes) : null;
  const offset = group.images[0]?.timezoneOffset;
  const tzLabel = offset ? ` ${offsetToLabel(offset)}` : '';

  const timeRange =
    startLocal != null && endLocal != null
      ? startLocal === endLocal
        ? `${formatTime(startLocal)}${tzLabel}`
        : `${formatTime(startLocal)} -- ${formatTime(endLocal)}${tzLabel}`
      : '';
  const summary = getClassificationSummary(group.images, classifications);

  return (
    <div data-testid="group-row" data-group-id={group.id}>
      {/* Group header */}
      <div
        className="text-xs text-gray-400 px-2 py-1 flex items-center gap-2"
        data-testid="group-header"
      >
        <span>
          Series: {photoCount} photo{photoCount !== 1 ? 's' : ''}
          {timeRange && ` \u00B7 ${timeRange}`}
        </span>
        {summary && <span className="text-gray-500">({summary})</span>}
      </div>

      {/* Thumbnail grid */}
      <div className="flex flex-wrap gap-2 px-1" role="row">
        {group.images.map((image) => (
          <ThumbnailCell
            key={image.path}
            image={image}
            cellSize={cellSize}
            classification={classifications[image.name] ?? null}
            qualityScore={qualityScores[image.name]}
            rotation={rotations[image.name]}
            isFocused={focusedImageId === image.path}
            isSelected={selectedImages.has(image.path)}
            selectOnHover={selectOnHover}
            onClick={() => onImageClick(image.name)}
            onFocus={() => onImageFocus(image.path)}
            onCycleClassification={() => onCycleClassification(image.name)}
            onToggleSelect={onToggleSelect}
            onRangeSelect={onRangeSelect}
            getThumbnail={getThumbnail}
            requestThumbnail={requestThumbnail}
            setLastModified={setLastModified}
            groupIndex={groupIndex}
          />
        ))}
      </div>

      {/* Divider */}
      <div className="border-t border-gray-700 mx-2 mt-2" />
    </div>
  );
}
