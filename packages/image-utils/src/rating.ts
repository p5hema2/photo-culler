/**
 * The star-rating contract, shared by both processes.
 *
 * Deliberately its own module with NO imports: the renderer needs `clampRating`
 * for the star control, and `metadata.ts` — the other obvious home — imports
 * exifr at module scope. Deep-importing this from the renderer must not drag a
 * ~96 kB metadata parser into the browser bundle.
 */

export const MIN_RATING = 0;
export const MAX_RATING = 5;

/** Every value a rating can take, unrated first. Order is the UI's order. */
export const RATING_VALUES = [0, 1, 2, 3, 4, 5] as const;

/**
 * Force whatever a file holds into a drawable integer 0-5.
 *
 * The XMP spec declares `xmp:Rating` as a *real*, and Adobe writes -1 for
 * "rejected", so 2.5 and -1 are both legal on disk. The star control must never
 * receive a value it cannot draw: the app has no ErrorBoundary, so a bad index
 * blanks the whole window rather than degrading one cell.
 *
 * A negative (rejected) rating collapses to 0 = unrated, NOT to 1. One star is
 * the delete bucket, and inheriting another tool's reject flag must never queue
 * a photo for deletion.
 *
 * Returns undefined only for input that is not a number at all — that means
 * "nothing known", which is different from a known 0.
 */
export function clampRating(value: unknown): number | undefined {
  let n: unknown = value;
  if (typeof value === 'string') {
    // Number('') is 0, so an empty XMP text node would otherwise read as an
    // explicit "unrated" rather than as nothing known.
    const text = value.trim();
    if (text === '') return undefined;
    n = Number(text);
  }
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
  if (n < MIN_RATING) return MIN_RATING;
  return Math.min(MAX_RATING, Math.round(n));
}

/** True when the rating falls inside the inclusive delete range. */
export function isInRatingRange(
  rating: number | undefined,
  range: { min: number; max: number },
): boolean {
  const r = rating ?? MIN_RATING;
  return r >= range.min && r <= range.max;
}
