import type { PhotoGroup } from '@photo-culler/image-utils/grouping';
import type { ImageFileInfo } from '@photo-culler/types';
import type { SelectionClickModifier } from '../lib/selection';
import { ThumbnailCell } from './ThumbnailCell';

/**
 * Height of the group's time-range header, pinned rather than left to the text.
 *
 * PhotoGrid's virtualizer budgets exactly this much for it, and positions cells
 * from the row's top edge — an unpinned header that rendered shorter would put
 * every cell a few pixels above where the row model says it is.
 */
export const HEADER_HEIGHT = 32;

interface GroupRowProps {
  group: PhotoGroup;
  cellSize: number;
  ratings: Record<string, number>;
  qualityScores: Record<string, number>;
  rotations: Record<string, number>;
  focusedImageId: string | null;
  /** The batch rating and deletion act on. Membership, not order. */
  selection: ReadonlySet<string>;
  /**
   * A cell was clicked. The origin FocusOrigin carries elsewhere is fixed here —
   * a grid cell can only ever be clicked — so PhotoGrid supplies it.
   */
  onImageClick: (path: string, modifier: SelectionClickModifier) => void;
  onRate: (imagePath: string, rating: number) => void;
  getThumbnail: (id: string) => ImageBitmap | 'loading' | 'error';
  requestThumbnail: (id: string, url: string, size: number, groupIndex?: number) => void;
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

/** How far the series has been culled — 0 is unrated, so an unrated one does not count. */
function getRatingSummary(images: ImageFileInfo[], ratings: Record<string, number>): string {
  const rated = images.filter((img) => (ratings[img.path] ?? 0) > 0).length;
  return rated > 0 ? `${rated} rated` : '';
}

export function GroupRow({
  group,
  cellSize,
  ratings,
  qualityScores,
  rotations,
  focusedImageId,
  selection,
  onImageClick,
  onRate,
  getThumbnail,
  requestThumbnail,
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
  const summary = getRatingSummary(group.images, ratings);

  return (
    <div data-testid="group-row" data-group-id={group.id}>
      {/* Group header */}
      <div
        className="text-xs text-gray-400 px-2 flex items-center gap-2"
        style={{ height: HEADER_HEIGHT }}
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
            rating={ratings[image.path]}
            qualityScore={qualityScores[image.path]}
            rotation={rotations[image.path]}
            isFocused={focusedImageId === image.path}
            isSelected={selection.has(image.path)}
            onFocus={(_origin, modifier) => onImageClick(image.path, modifier)}
            onRate={(rating) => onRate(image.path, rating)}
            getThumbnail={getThumbnail}
            requestThumbnail={requestThumbnail}
            groupIndex={groupIndex}
          />
        ))}
      </div>

      {/* Divider */}
      <div className="border-t border-gray-700 mx-2 mt-2" />
    </div>
  );
}
