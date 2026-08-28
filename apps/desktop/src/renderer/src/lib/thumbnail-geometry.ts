/**
 * The thumbnail format contract — geometry, container, quality — plus the pure
 * maths that positions one.
 *
 * Kept free of DOM and canvas APIs so it can be unit-tested — the crop maths
 * used to live inline in the worker and in ThumbnailCell, where jsdom cannot
 * reach it. The constants live here rather than in the worker for a harder
 * reason: the worker module's body installs `self.onmessage`, so importing a
 * VALUE from it would run that on the main thread. Only its types may be
 * imported outside a `new Worker()` call.
 */

export interface Size {
  width: number;
  height: number;
}

/**
 * Longest edge, in px, of a generated thumbnail.
 *
 * Sized for the largest grid cell at a HiDPI scale factor, not for the CSS
 * pixel: the 'large' preset draws into a 292 px box, which is 584 physical px
 * at devicePixelRatio 2. The previous 256 was therefore upscaled 2.3x there
 * and looked soft on every scaled display. 512 keeps that within ~1.15x while
 * staying a quarter of the encode cost of covering DPR 2 exactly.
 */
export const THUMB_MAX_EDGE = 512;

/**
 * Container the disk cache stores, and the type the cached bytes are handed
 * back to `createImageBitmap` as.
 *
 * WebP at THUMB_QUALITY measures about half the size of JPEG q0.8 at the same
 * dimensions on photographic content, which is what pays for quadrupling the
 * pixel count above: a 512px WebP came out ~11% larger than the 256px JPEG it
 * replaced, not 4x. Heavy sensor noise inverts that — WebP's prediction has
 * nothing to work with and it loses to JPEG — so a folder of high-ISO frames
 * will cache larger than a clean one.
 *
 * Must stay in step with THUMB_SUFFIX in the main process: that suffix is the
 * only marker of the cache format, so a change here without a change there
 * would leave WebP bytes sitting behind a `.jpg` name.
 */
export const THUMB_MIME = 'image/webp';
export const THUMB_QUALITY = 0.82;

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

/**
 * Scale a bitmap so its longest edge is exactly `box`, preserving aspect ratio.
 *
 * `fitWithin` without the clamp, and the difference is the whole point: `box` is
 * a PHYSICAL pixel count — the caller multiplies the cell's CSS size by
 * devicePixelRatio — so this DOES upscale. A 512px thumbnail still has to fill a
 * 584px box on a 2x display at the 'large' preset; clamping there would
 * letterbox the cell.
 *
 * This was `fitRotated` until rotation stopped being something the renderer
 * applies: a rotation is now a change to the file's EXIF Orientation tag, and
 * `createImageBitmap(…, { imageOrientation: 'from-image' })` has already turned
 * the bitmap the right way up by the time it gets here. With the angle gone the
 * pre- and post-rotation footprints are the same size, so one Size says
 * everything there was to say.
 */
export function fitToBox(bitmapWidth: number, bitmapHeight: number, box: number): Size {
  if (!(bitmapWidth > 0) || !(bitmapHeight > 0) || !(box > 0)) {
    return { width: 0, height: 0 };
  }
  const scale = box / Math.max(bitmapWidth, bitmapHeight);
  return {
    width: Math.max(1, Math.round(bitmapWidth * scale)),
    height: Math.max(1, Math.round(bitmapHeight * scale)),
  };
}
