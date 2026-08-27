import { describe, it, expect } from 'vitest';
import { fitWithin, fitRotated, THUMB_MAX_EDGE } from '../lib/thumbnail-geometry';

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

describe('fitRotated', () => {
  it('scales a landscape thumbnail into the box unrotated', () => {
    const r = fitRotated(256, 171, 192, 0);
    expect(r.canvas).toEqual({ width: 192, height: 128 });
    expect(r.draw).toEqual({ width: 192, height: 128 });
    expect(r.radians).toBe(0);
  });

  it('swaps the canvas footprint at 90 degrees but not the draw size', () => {
    const r = fitRotated(256, 171, 192, 90);
    expect(r.canvas).toEqual({ width: 128, height: 192 });
    expect(r.draw).toEqual({ width: 192, height: 128 });
    expect(r.radians).toBeCloseTo(Math.PI / 2);
  });

  it('keeps the footprint at 180 degrees and swaps again at 270', () => {
    expect(fitRotated(256, 171, 192, 180).canvas).toEqual({ width: 192, height: 128 });
    expect(fitRotated(256, 171, 192, 270).canvas).toEqual({ width: 128, height: 192 });
  });

  it('normalises negative and out-of-range rotations', () => {
    expect(fitRotated(256, 171, 192, -90).radians).toBeCloseTo((270 * Math.PI) / 180);
    expect(fitRotated(256, 171, 192, 450).radians).toBeCloseTo(Math.PI / 2);
  });

  it('fills the cell with a square thumbnail rather than letterboxing it', () => {
    const r = fitRotated(256, 256, 192, 0);
    expect(r.canvas).toEqual({ width: 192, height: 192 });
    expect(r.draw).toEqual({ width: 192, height: 192 });
  });

  it('upscales into a box larger than the thumbnail, which is the HiDPI case', () => {
    // The caller passes PHYSICAL pixels: the 'large' 292px box is 584px at
    // devicePixelRatio 2, above THUMB_MAX_EDGE. Clamping here would letterbox
    // every cell on a scaled display instead of resampling by ~1.14x.
    const r = fitRotated(512, 341, 584, 0);
    expect(r.canvas).toEqual({ width: 584, height: 389 });
    expect(r.draw).toEqual({ width: 584, height: 389 });
  });

  it('guards against zero input', () => {
    expect(fitRotated(0, 0, 192, 0).canvas).toEqual({ width: 0, height: 0 });
  });
});
