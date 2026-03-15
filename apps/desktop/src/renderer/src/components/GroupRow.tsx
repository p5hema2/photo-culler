import type { PhotoGroup } from '@photo-culler/image-utils/grouping';
import type { ImageFileInfo } from '@photo-culler/types';
import { ThumbnailCell } from './ThumbnailCell';
import type { Classification } from './ThumbnailCell';

interface GroupRowProps {
  group: PhotoGroup;
  cellSize: number;
  classifications: Record<string, Classification>;
  focusedImageId: string | null;
  selectedImages: Set<string>;
  onImageClick: (filename: string) => void;
  onImageHover: (path: string) => void;
  onToggleSelect: (path: string) => void;
  onRangeSelect: (path: string) => void;
  onOpenPreview: (path: string) => void;
  getThumbnail: (id: string) => ImageBitmap | 'loading' | 'error';
  requestThumbnail: (id: string, url: string, size: number, groupIndex?: number) => void;
  setLastModified?: (id: string, lastModified: number) => void;
  groupIndex: number;
}

function formatTime(ms: number): string {
  const date = new Date(ms);
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function getClassificationSummary(
  images: ImageFileInfo[],
  classifications: Record<string, Classification>,
): string {
  const counts = { keep: 0, review: 0, delete: 0 };
  for (const img of images) {
    const cls = classifications[img.name] ?? 'review';
    counts[cls]++;
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
  focusedImageId,
  selectedImages,
  onImageClick,
  onImageHover,
  onToggleSelect,
  onRangeSelect,
  onOpenPreview,
  getThumbnail,
  requestThumbnail,
  setLastModified,
  groupIndex,
}: GroupRowProps): React.JSX.Element {
  const photoCount = group.images.length;
  const timeRange =
    group.startTime != null && group.endTime != null
      ? group.startTime === group.endTime
        ? formatTime(group.startTime)
        : `${formatTime(group.startTime)} -- ${formatTime(group.endTime)}`
      : '';
  const summary = getClassificationSummary(group.images, classifications);

  return (
    <div data-testid="group-row" data-group-id={group.id}>
      {/* Group header */}
      <div className="text-xs text-gray-400 px-2 py-1 flex items-center gap-2" data-testid="group-header">
        <span>
          Series: {photoCount} photo{photoCount !== 1 ? 's' : ''}
          {timeRange && ` \u00B7 ${timeRange}`}
        </span>
        {summary && (
          <span className="text-gray-500">({summary})</span>
        )}
      </div>

      {/* Thumbnail grid */}
      <div className="flex flex-wrap gap-2 px-1" role="row">
        {group.images.map((image) => (
          <ThumbnailCell
            key={image.path}
            image={image}
            cellSize={cellSize}
            classification={classifications[image.name] ?? 'review'}
            isFocused={focusedImageId === image.path}
            isSelected={selectedImages.has(image.path)}
            onClick={() => onImageClick(image.name)}
            onHover={() => onImageHover(image.path)}
            onToggleSelect={onToggleSelect}
            onRangeSelect={onRangeSelect}
            onOpenPreview={onOpenPreview}
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
