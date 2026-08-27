import { useState } from 'react';
import { clampRating, MAX_RATING, RATING_VALUES } from '@photo-culler/image-utils/rating';

/**
 * The five clickable values. RATING_VALUES leads with 0, which is the *absence*
 * of a star rather than one of them — 0 is set by clicking the star that is
 * already lit, or by the 0 hotkey.
 */
const STAR_VALUES = RATING_VALUES.filter((value) => value > 0);

export type StarRatingSize = 'sm' | 'md' | 'lg';

/** Star edge, gap between stars, and the padding that turns a star into a target. */
const METRICS: Record<StarRatingSize, { star: number; gap: number; pad: number }> = {
  sm: { star: 10, gap: 1, pad: 1 },
  md: { star: 16, gap: 2, pad: 4 },
  lg: { star: 20, gap: 3, pad: 4 },
};

const STAR_PATH =
  'M12 2.4l2.94 5.96 6.58.96-4.76 4.64 1.12 6.56L12 17.38l-5.88 3.14 1.12-6.56L2.48 9.32l6.58-.96z';

function Star({ filled, px }: { filled: boolean; px: number }): React.JSX.Element {
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={`block drop-shadow-[0_0_1px_rgba(0,0,0,0.9)] ${
        filled ? 'text-amber-400' : 'text-gray-500/70'
      }`}
    >
      <path d={STAR_PATH} />
    </svg>
  );
}

interface StarRatingProps {
  /**
   * The image's rating. Clamped, because the file on disk is the authority and
   * may legally hold -1 or 2.5 — and an unguarded index blanks the window.
   */
  rating: number | undefined;
  /** Ignored unless `interactive`. Called with 0 when the lit star is clicked again. */
  onRate?: (rating: number) => void;
  interactive: boolean;
  size: StarRatingSize;
  /**
   * Radiogroup semantics with real tab stops. Off by default, because the grid
   * is one `role=grid` with a single tab stop: five focusable buttons per cell,
   * mounting and unmounting as the virtualizer scrolls, would bury it. Turn it
   * on in a panel, where the control is the only one of its kind.
   */
  focusable?: boolean;
}

export function StarRating({
  rating,
  onRate,
  interactive,
  size,
  focusable = false,
}: StarRatingProps): React.JSX.Element {
  const [hovered, setHovered] = useState(0);

  const value = clampRating(rating) ?? 0;
  const { star, gap, pad } = METRICS[size];
  const label = `${value} of ${MAX_RATING} stars`;

  if (!interactive) {
    return (
      <div
        className="flex items-center"
        style={{ gap }}
        role="img"
        aria-label={label}
        data-testid="star-rating"
      >
        {STAR_VALUES.map((n) => (
          <Star key={n} filled={n <= value} px={star} />
        ))}
      </div>
    );
  }

  // Hovering previews what the click would set, which is also the only cue that
  // re-clicking the lit star clears the rating: that one previews as unset.
  const preview = hovered === 0 ? value : hovered === value ? 0 : hovered;

  return (
    <div
      className="flex items-center"
      style={{ gap }}
      // Without tab stops the five buttons are not a widget an assistive tech
      // can operate, so the group announces the value instead and the 0-5
      // hotkeys are the keyboard path.
      role={focusable ? 'radiogroup' : 'img'}
      aria-label={focusable ? 'Rating' : label}
      onMouseLeave={() => setHovered(0)}
      data-testid="star-rating"
    >
      {STAR_VALUES.map((n) => (
        <button
          key={n}
          type="button"
          tabIndex={focusable ? 0 : -1}
          role={focusable ? 'radio' : undefined}
          aria-checked={focusable ? n === value : undefined}
          aria-label={focusable ? `${n} star${n === 1 ? '' : 's'}` : undefined}
          className="flex items-center cursor-pointer"
          style={{ padding: pad }}
          onMouseEnter={() => setHovered(n)}
          onClick={() => onRate?.(n === value ? 0 : n)}
          data-rating={n}
        >
          <Star filled={n <= preview} px={star} />
        </button>
      ))}
    </div>
  );
}
