/**
 * The EXIF orientation table, shared by both processes.
 *
 * Deliberately its own module with NO imports, like `rating.ts`: the main
 * process needs `nextOrientation` to compute the one byte it writes into a
 * photo, and anything reasoning about display dimensions needs
 * `orientationSwapsAxes`. Neither should drag `node:fs` or a metadata parser
 * along, which is what importing from `scanner.ts` or `metadata.ts` would do.
 *
 * Rotation in this app *is* this table. There is no pending-rotation state and
 * no re-encode: turning a photo means writing a different value into its EXIF
 * Orientation tag, and the decode path applies it —
 * `createImageBitmap(…, { imageOrientation: 'from-image' })` in the thumbnail
 * worker, the same rule in the detail view.
 */

/** No transform: the stored pixels are the displayed pixels. */
export const ORIENTATION_NORMAL = 1;

/** Every direction a rotation can take. */
export const ROTATE_DIRECTIONS = ['cw', 'ccw'] as const;

/** Which way a rotation turns the photo, as the user sees it. */
export type RotateDirection = (typeof ROTATE_DIRECTIONS)[number];

/**
 * The eight legal values, each read as the transform that maps stored pixels to
 * displayed ones:
 *
 *   1 = normal            2 = mirror horizontal
 *   6 = rotate 90 CW      7 = mirror horizontal + rotate 90 CW
 *   3 = rotate 180        4 = mirror vertical
 *   8 = rotate 270 CW     5 = mirror horizontal + rotate 270 CW
 *
 * Under a quarter turn they form two disjoint four-cycles, because rotating can
 * neither add nor remove a reflection:
 *
 *   1 -> 6 -> 3 -> 8 -> 1   and   2 -> 7 -> 4 -> 5 -> 2
 *
 * The mirrored cycle has to be here even though a camera only ever writes 1, 3,
 * 6 or 8: a file flipped in another tool carries 2, 4, 5 or 7, and a rotation
 * that fell back to the un-mirrored cycle would silently un-mirror it.
 *
 * The listed order is the direction the user sees, and for the mirrored cycle
 * that is worth deriving rather than assuming, since a reflection reverses
 * handedness. It works out because ExifTool's labels apply the mirror first:
 * value 2 is M, one further quarter turn is R90∘M, and that is exactly what
 * value 7 ("mirror horizontal and rotate 90 CW") names. Counter-clockwise is
 * each cycle read backwards.
 */
const CW_CYCLES: readonly (readonly [number, number, number, number])[] = [
  [1, 6, 3, 8],
  [2, 7, 4, 5],
];

/** The four values whose display frame is a quarter turn from the stored one. */
const SWAPPED_AXES: readonly number[] = [5, 6, 7, 8];

/**
 * Force whatever a file holds into one of the eight legal values.
 *
 * Absent, 0, 9, a float, a string, a Buffer — all become 1. A missing
 * orientation genuinely does mean "normal", and junk is not worth refusing a
 * rotation over: treating it as 1 makes the next turn write a legal value
 * again, which is the only way out of a bad tag that the user has.
 */
export function normalizeOrientation(value: unknown): number {
  const n = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 8) {
    return ORIENTATION_NORMAL;
  }
  return n;
}

/**
 * The orientation to write after turning `current` one quarter turn.
 *
 * Total: every input has an answer, so no caller has to decide what to do about
 * a file carrying something outside 1-8.
 */
export function nextOrientation(current: unknown, direction: RotateDirection): number {
  const from = normalizeOrientation(current);
  // `from` is 1-8, and each of those appears exactly once across the two
  // cycles, so both lookups are total — hence the assertions.
  const cycle = CW_CYCLES.find((c) => c.includes(from))!;
  // +3 rather than -1, so the modulo never sees a negative index.
  return cycle[(cycle.indexOf(from) + (direction === 'cw' ? 1 : 3)) % 4]!;
}

/**
 * True when the display frame is a quarter turn from the stored one — 6000x4000
 * on disk shown as 4000x6000.
 *
 * A decoded bitmap already has the oriented dimensions, so this is only for
 * code working from an EXIF width/height pair before any decode happens.
 */
export function orientationSwapsAxes(value: unknown): boolean {
  return SWAPPED_AXES.includes(normalizeOrientation(value));
}
