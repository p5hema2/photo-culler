import { MAX_RATING, MIN_RATING, clampRating } from '@photo-culler/image-utils/rating';

/**
 * Which ratings the grid is showing: an inclusive 0-5 window.
 *
 * A range rather than a set of chips, because ratings are ordered — "3 and up"
 * and "the ones I have not decided on yet" are both a contiguous span, and a
 * two-handle slider says them in one gesture. `min: 0` includes unrated, since
 * unrated and 0 stars are the same thing.
 */
export interface RatingRange {
  min: number;
  max: number;
}

/** No filtering at all — every image, unrated included. */
export const FULL_RATING_RANGE: RatingRange = { min: MIN_RATING, max: MAX_RATING };

/** Whether a range lets everything through, i.e. the filter is effectively off. */
export function isFullRatingRange(range: RatingRange): boolean {
  return range.min <= MIN_RATING && range.max >= MAX_RATING;
}

/**
 * Force a range into a drawable, non-inverted 0-5 window.
 *
 * The two handles of a slider can be dragged past each other, and a min above
 * max would silently show nothing at all rather than reading as a mistake.
 */
export function normalizeRatingRange(range: RatingRange): RatingRange {
  const min = clampRating(range.min) ?? MIN_RATING;
  const max = clampRating(range.max) ?? MAX_RATING;
  return min <= max ? { min, max } : { min: max, max: min };
}
