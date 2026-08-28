import { describe, it, expect } from 'vitest';
import { fitWithin, fitToBox, THUMB_MAX_EDGE } from '../lib/thumbnail-geometry';

describe('fitWithin', () => {
  it('fits a landscape source to the long edge', () => {
    expect(fitWithin(6000, 4000, 512)).toEqual({ width: 512, height: 341 });
  });

  it('fits a portrait source to the long edge', () => {
    expect(fitWithin(4000, 6000, 512)).toEqual({ width: 341, height: 512 });
  });

  it('leaves a square source square', () => {
    expect(fitWithin(4000, 4000, 512)).toEqual({ width: 512, height: 512 });
  });

  it('never upscales a source smaller than the box', () => {
    // The old cover-crop maths blew this up to a full square and cached it.
    expect(fitWithin(100, 80, 512)).toEqual({ width: 100, height: 80 });
  });

  it('guards against zero and negative input', () => {
    expect(fitWithin(0, 0, 512)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(100, 100, 0)).toEqual({ width: 0, height: 0 });
  });

  it('exposes a long edge that covers the largest grid cell unscaled', () => {
    // The 'large' preset draws into a 292px box (300 minus border and gap), so
    // anything at or below that is upscaled even at devicePixelRatio 1 — which
    // is exactly what 256 used to do.
    expect(THUMB_MAX_EDGE).toBe(512);
    expect(THUMB_MAX_EDGE).toBeGreaterThan(292);
  });
});

describe('fitToBox', () => {
  /**
   * `fitRotated` until the rotation parameter went away with pending rotations —
   * a rotation is a change to the file's EXIF Orientation tag now, and the
   * bitmap reaches the cell already turned. The four angle cases it used to
   * cover are gone with it; what is left is the box maths, and both properties
   * that were load-bearing in the old function still are: the longest edge lands
   * exactly on the box, and the box may be larger than the bitmap.
   */
  it('scales a landscape thumbnail into the box', () => {
    expect(fitToBox(256, 171, 192)).toEqual({ width: 192, height: 128 });
  });

  it('scales a portrait thumbnail into the box, keeping it portrait', () => {
    expect(fitToBox(171, 256, 192)).toEqual({ width: 128, height: 192 });
  });

  it('fills the cell with a square thumbnail rather than letterboxing it', () => {
    expect(fitToBox(256, 256, 192)).toEqual({ width: 192, height: 192 });
  });

  it('upscales into a box larger than the thumbnail, which is the HiDPI case', () => {
    // The caller passes PHYSICAL pixels: the 'large' 292px box is 584px at
    // devicePixelRatio 2, above THUMB_MAX_EDGE. Clamping here would letterbox
    // every cell on a scaled display instead of resampling by ~1.14x. This is
    // the one thing that distinguishes it from fitWithin, so it is asserted
    // against fitWithin's clamped answer.
    expect(fitToBox(512, 341, 584)).toEqual({ width: 584, height: 389 });
    expect(fitWithin(512, 341, 584)).toEqual({ width: 512, height: 341 });
  });

  it('guards against zero input', () => {
    expect(fitToBox(0, 0, 192)).toEqual({ width: 0, height: 0 });
    expect(fitToBox(256, 171, 0)).toEqual({ width: 0, height: 0 });
  });
});
