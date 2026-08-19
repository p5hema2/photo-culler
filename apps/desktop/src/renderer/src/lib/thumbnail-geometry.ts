/**
 * Pure geometry for thumbnail generation and display.
 *
 * Kept free of DOM and canvas APIs so it can be unit-tested — the crop maths
 * used to live inline in the worker and in ThumbnailCell, where jsdom cannot
 * reach it.
 */

export interface Size {
  width: number;
  height: number;
}

/** Longest edge, in px, of a generated thumbnail. */
export const THUMB_MAX_EDGE = 256;

/**
 * `object-fit: contain` — scale to fit inside a square of `maxEdge` while
 * preserving aspect ratio.
 *
 * Clamped at scale 1 so a source smaller than the box is never upscaled into
 * the cache. The previous cover-crop maths blew a 100x80 image up to 256x256
 * and stored the result.
 */
export function fitWithin(width: number, height: number, maxEdge: number): Size {
  if (!(width > 0) || !(height > 0) || !(maxEdge > 0)) {
    return { width: 0, height: 0 };
  }
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export interface RotatedFit {
  /** On-screen footprint AFTER rotation — the canvas element's size. */
  canvas: Size;
  /** Size to draw the bitmap at, in its own pre-rotation axes. */
  draw: Size;
  /** Normalised rotation in radians. */
  radians: number;
}

/**
 * Layout for drawing a bitmap rotated by a multiple of 90 degrees, centred in a
 * square box of `box` px.
 *
 * Unlike `fitWithin` this DOES allow upscaling: a 256px thumbnail is expected
 * to fill a 292px `large` cell, which is the existing behaviour.
 *
 * The caller draws uniformly for all four angles:
 *   translate(canvas.width / 2, canvas.height / 2)
 *   rotate(radians)
 *   drawImage(bmp, -draw.width / 2, -draw.height / 2, draw.width, draw.height)
 */
export function fitRotated(
  bitmapWidth: number,
  bitmapHeight: number,
  box: number,
  rotation: number,
): RotatedFit {
  if (!(bitmapWidth > 0) || !(bitmapHeight > 0) || !(box > 0)) {
    return { canvas: { width: 0, height: 0 }, draw: { width: 0, height: 0 }, radians: 0 };
  }

  const deg = (((Math.round(rotation / 90) * 90) % 360) + 360) % 360;
  const swap = deg === 90 || deg === 270;

  // Footprint after rotation, in the bitmap's own units.
  const outerW = swap ? bitmapHeight : bitmapWidth;
  const outerH = swap ? bitmapWidth : bitmapHeight;

  const scale = Math.min(box / outerW, box / outerH);

  return {
    canvas: {
      width: Math.max(1, Math.round(outerW * scale)),
      height: Math.max(1, Math.round(outerH * scale)),
    },
    draw: {
      width: Math.max(1, Math.round(bitmapWidth * scale)),
      height: Math.max(1, Math.round(bitmapHeight * scale)),
    },
    radians: (deg * Math.PI) / 180,
  };
}
