import { describe, it, expect } from 'vitest';
import { fitWithin, fitRotated, THUMB_MAX_EDGE } from '../lib/thumbnail-geometry';

describe('fitWithin', () => {
  it('fits a landscape source to the long edge', () => {
    expect(fitWithin(6000, 4000, 256)).toEqual({ width: 256, height: 171 });
  });

  it('fits a portrait source to the long edge', () => {
    expect(fitWithin(4000, 6000, 256)).toEqual({ width: 171, height: 256 });
  });

  it('leaves a square source square', () => {
    expect(fitWithin(4000, 4000, 256)).toEqual({ width: 256, height: 256 });
  });

  it('never upscales a source smaller than the box', () => {
    // The old cover-crop maths blew this up to 256x256 and cached the result.
    expect(fitWithin(100, 80, 256)).toEqual({ width: 100, height: 80 });
  });

  it('guards against zero and negative input', () => {
    expect(fitWithin(0, 0, 256)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(100, 100, 0)).toEqual({ width: 0, height: 0 });
  });

  it('exposes the default long edge', () => {
    expect(THUMB_MAX_EDGE).toBe(256);
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

  it('renders an already-cached square thumbnail exactly as before', () => {
    // Guards the migration: v1 cache entries are 256x256, and must still fill
    // the cell identically once the contain maths lands.
    const r = fitRotated(256, 256, 192, 0);
    expect(r.canvas).toEqual({ width: 192, height: 192 });
    expect(r.draw).toEqual({ width: 192, height: 192 });
  });

  it('guards against zero input', () => {
    expect(fitRotated(0, 0, 192, 0).canvas).toEqual({ width: 0, height: 0 });
  });
});
