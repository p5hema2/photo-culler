import { useRef, useEffect } from 'react';
import type { ImageFileInfo } from '@photo-culler/types';
import type { FocusOrigin } from '../lib/focus-scroll';
import { clickModifier } from '../lib/selection';
import type { SelectionClickModifier } from '../lib/selection';
import { appUrlFor } from '../lib/app-url';
import { fitToBox, THUMB_MAX_EDGE } from '../lib/thumbnail-geometry';
import { isVideoFile, isPlayableVideo, extensionOf } from '@photo-culler/image-utils/media';
import { StarRating } from './StarRating';
import type { StarRatingSize } from './StarRating';

type ThumbnailStatus = ImageBitmap | 'loading' | 'error';

interface ThumbnailCellProps {
  image: ImageFileInfo;
  cellSize: number;
  rating: number | undefined;
  qualityScore?: number;
  isFocused: boolean;
  /**
   * Whether this cell is part of the batch that rating and deletion act on.
   * Absent in the two strips, which show one image at a time and select nothing.
   */
  isSelected?: boolean;
  /**
   * Focus this cell. The origin travels with it because the containing view
   * scrolls the focused cell into place, and must not do that when the pointer
   * is what moved the focus — see FocusOrigin.
   *
   * The modifier says what the click means for the selection. Callers with no
   * selection to speak of — the loupe strip, the filmstrip — simply take one
   * argument and ignore it.
   */
  onFocus: (origin: FocusOrigin, modifier: SelectionClickModifier) => void;
  /** Absent where the cell only shows the rating — the two strips, see starsForCell. */
  onRate?: (rating: number) => void;
  getThumbnail: (id: string) => ThumbnailStatus;
  requestThumbnail: (id: string, url: string, size: number, groupIndex?: number) => void;
  groupIndex: number;
}

/**
 * How the stars render at this cell size.
 *
 * The drawable box is `cellSize - 8`, so the 120px small preset leaves 112px for
 * five targets — 22px each, with the filename badge overhead. Below the medium
 * preset, and in both strips, the stars therefore only *show* the rating; the
 * 0-5 hotkeys set it there.
 */
function starsForCell(cellSize: number): { size: StarRatingSize; interactive: boolean } {
  if (cellSize >= 300) return { size: 'lg', interactive: true };
  if (cellSize >= 200) return { size: 'md', interactive: true };
  return { size: 'sm', interactive: false };
}

export function ThumbnailCell({
  image,
  cellSize,
  rating,
  qualityScore,
  isFocused,
  isSelected = false,
  onFocus,
  onRate,
  getThumbnail,
  requestThumbnail,
  groupIndex,
}: ThumbnailCellProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const thumbnail = getThumbnail(image.path);
  /**
   * Read during render, not inside the effect, so it lands in the dependency
   * list: moving the window to a display with a different scale factor (or
   * zooming) changes it, and the canvas has to be rebuilt at the new density.
   */
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  // Request thumbnail if not yet requested
  useEffect(() => {
    if (thumbnail === 'loading') {
      // app-url.ts owns this format; it is the other end of main/protocol.ts.
      requestThumbnail(image.path, appUrlFor(image.path), THUMB_MAX_EDGE, groupIndex);
    }
  }, [image.path, thumbnail, requestThumbnail, groupIndex]);

  // Draw bitmap to canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || thumbnail === 'loading' || thumbnail === 'error') return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    /**
     * A bitmap the cache has already closed.
     *
     * `storeBitmap` evicts the least recently used entry once the cache is over
     * MAX_CACHED_BITMAPS, and closing it detaches it. The eviction bumps the
     * render version so the cell re-renders as 'loading' — but THIS effect can
     * still run once more with the value it captured, and `drawImage` on a
     * detached bitmap throws `InvalidStateError`, which unmounts the whole
     * grid. A closed ImageBitmap reports zero dimensions, which is the only
     * way to ask.
     *
     * Bailing leaves the pixels already on the canvas, which is exactly what
     * the eviction comment promises happens.
     */
    if (thumbnail.width === 0 || thumbnail.height === 0) return;

    // Account for the image box's 4px inset on each side = 8px total
    const box = cellSize - 8;
    const size = fitToBox(thumbnail.width, thumbnail.height, box * dpr);

    // The canvas takes the bitmap's own footprint, so a portrait thumbnail gets
    // a portrait canvas rather than overflowing a square one. The bitmap already
    // arrives EXIF-oriented — see the worker's createImageBitmap call — so there
    // is nothing left for the cell to turn.
    //
    // The backing store is sized in PHYSICAL pixels and scaled back down via
    // CSS. Without that division the element would lay out at `box * dpr` CSS
    // px and blow the cell apart; without the multiplication the thumbnail
    // would be resampled to CSS pixels and stay soft on any scaled display,
    // however large it was generated.
    canvas.width = size.width;
    canvas.height = size.height;
    canvas.style.width = `${size.width / dpr}px`;
    canvas.style.height = `${size.height / dpr}px`;

    ctx.clearRect(0, 0, size.width, size.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(thumbnail, 0, 0, size.width, size.height);
  }, [thumbnail, cellSize, dpr]);

  const stars = starsForCell(cellSize);
  /**
   * Videos carry no stars.
   *
   * Not a layout decision: a rating lives in the file, and writing one into an
   * MP4 means ExifTool rewriting the whole container — seconds and gigabytes
   * per keypress on a real clip. So videos are never rated, which also means
   * Execute can never reach one: its range starts at 1 and an unrated file is
   * 0. Deleting a video is the Delete key, deliberately and one dialog at a
   * time.
   */
  const isVideo = isVideoFile(image.name);
  // Five empty stars on every unrated cell would be noise where they cannot be
  // clicked anyway; where they can, they are the affordance.
  const showStars = !isVideo && (stars.interactive || (rating ?? 0) > 0);
  /**
   * A video the app lists but cannot draw a frame from.
   *
   * Either the container has no decoder here (AVI, MKV, MTS, M2TS, 3GP — see
   * PLAYABLE_VIDEO_EXTENSIONS) or the decode failed. Both get the same tile,
   * because both mean the same thing to the user: the file is there, it can be
   * renamed and deleted, there is just no picture.
   */
  const videoWithoutPoster = isVideo && (thumbnail === 'error' || !isPlayableVideo(image.name));

  return (
    <div
      // select-none because Shift-click is a range selection here: left to
      // itself the browser would also drag a text selection across the badges.
      className="relative cursor-pointer flex-shrink-0 select-none"
      style={{ width: cellSize, height: cellSize }}
      // Dragging a cell onto a folder header moves the selection there.
      // PhotoGrid catches the dragstart by delegation and settles the batch
      // first, the same way a right click does — see handleCellDragStart.
      draggable
      onClick={(e) => onFocus('click', clickModifier(e))}
      data-image-path={image.path}
      data-testid="thumbnail-cell"
      role="gridcell"
      aria-selected={isSelected}
      tabIndex={isFocused ? 0 : -1}
    >
      {/* Filename badge */}
      <div className="absolute top-1 left-1 z-10 bg-black/60 px-1 rounded text-[9px] font-mono text-gray-300 max-w-[70%] truncate">
        {image.name}
      </div>
      {/* Quality score badge, top-right — the bottom edge belongs to the stars */}
      {qualityScore != null && (
        <div
          className={`absolute top-1 right-1 z-10 bg-black/60 px-1 rounded text-[10px] font-mono ${
            qualityScore >= 60
              ? 'text-green-400'
              : qualityScore >= 35
                ? 'text-yellow-400'
                : 'text-red-400'
          }`}
        >
          {qualityScore}%
        </div>
      )}
      {/* Focus ring as outline, offset outwards so it never eats into the box */}
      <div
        className={`absolute inset-0 ${isFocused ? 'outline-3 outline-blue-400 outline outline-offset-2' : ''}`}
      />
      {/*
        The image box. Its 4px inset on every side IS the `cellSize - 8` the
        drawing effect above assumes, and the cell's overall square is what the
        grid's row model positions — neither may change size here.
      */}
      <div className="absolute inset-1 bg-gray-900 overflow-hidden flex items-center justify-center">
        {thumbnail === 'loading' && (
          <div
            className="absolute inset-0 bg-gray-700 animate-pulse"
            data-testid="thumbnail-loading"
          />
        )}
        {videoWithoutPoster && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-gray-800"
            data-testid="thumbnail-video-placeholder"
          >
            <svg
              className="w-8 h-8 text-gray-500"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <rect x="2.5" y="5" width="19" height="14" rx="1.5" />
              <line x1="7" y1="5" x2="7" y2="19" />
              <line x1="17" y1="5" x2="17" y2="19" />
              <line x1="2.5" y1="9.5" x2="7" y2="9.5" />
              <line x1="2.5" y1="14.5" x2="7" y2="14.5" />
              <line x1="17" y1="9.5" x2="21.5" y2="9.5" />
              <line x1="17" y1="14.5" x2="21.5" y2="14.5" />
            </svg>
            <span className="text-[10px] font-mono uppercase tracking-wide text-gray-400">
              {extensionOf(image.name)}
            </span>
          </div>
        )}
        {thumbnail === 'error' && !isVideo && (
          <div
            className="absolute inset-0 flex items-center justify-center bg-gray-700"
            data-testid="thumbnail-error"
          >
            <svg
              className="w-8 h-8 text-gray-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z"
              />
              <line x1="4" y1="4" x2="20" y2="20" stroke="currentColor" strokeWidth={1.5} />
            </svg>
          </div>
        )}
        {thumbnail !== 'loading' && thumbnail !== 'error' && (
          <canvas ref={canvasRef} className="block max-w-full max-h-full" />
        )}
        {/*
          A poster frame is indistinguishable from a photo without this, and the
          difference matters: the 0-5 keys do nothing on a video, and Execute
          can never reach one.
        */}
        {isVideo && !videoWithoutPoster && (
          <div
            className="absolute bottom-1 right-1 z-10 flex items-center gap-0.5 rounded bg-black/65 px-1 py-0.5"
            data-testid="cell-video-badge"
          >
            <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 12 12" fill="currentColor">
              <path d="M3 1.5 L10 6 L3 10.5 Z" />
            </svg>
            <span className="text-[9px] font-mono uppercase text-gray-200">
              {extensionOf(image.name)}
            </span>
          </div>
        )}
        {showStars && (
          <div
            className="absolute bottom-1 left-1/2 -translate-x-1/2 z-10 bg-black/60 rounded px-1"
            data-testid="cell-stars"
            // A star names ONE image, so it is a plain click on that image
            // whatever modifier is held — it focuses and selects just this cell,
            // then rates it. Left to bubble into the cell's own handler, a
            // Shift-click on a star would rate this photo while range-selecting
            // a hundred others, and a Ctrl-click would rate the very image it
            // had just removed from the selection.
            onClick={(e) => {
              e.stopPropagation();
              onFocus('click', 'plain');
            }}
          >
            <StarRating
              rating={rating}
              onRate={onRate}
              interactive={stars.interactive}
              size={stars.size}
            />
          </div>
        )}
      </div>
      {/*
        Selection marker. A filled frame INSIDE the box, where the focus ring is
        an outline outside it — the two say different things and have to look
        it, because a cell is often both. Last in the DOM so it paints over the
        thumbnail, and inert so it never eats the click.
      */}
      {isSelected && (
        <div
          className="absolute inset-1 pointer-events-none border-2 border-white/85 bg-white/10"
          data-testid="cell-selected"
        />
      )}
    </div>
  );
}
