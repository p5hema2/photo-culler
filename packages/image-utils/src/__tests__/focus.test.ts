import { describe, it, expect } from 'vitest';
import type { FocusInfo, NormRect } from '@photo-culler/types';
import { detectVendor, mapFocusTags, orientFocusInfo } from '../focus';

/** A minimal Panasonic tag bag, as exiftool -G1 -json would return it. */
function panasonicTags(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    'IFD0:Make': 'Panasonic',
    'IFD0:Model': 'DC-S5D',
    'IFD0:Orientation': 1,
    'ExifIFD:ImageWidth': 6000,
    'ExifIFD:ImageHeight': 4000,
    'Panasonic:FocusMode': 'AF-C',
    'Panasonic:AFAreaMode': 'Face Detect',
    'Panasonic:AFPointPosition': '0.5 0.4',
    'Panasonic:AFAreaSize': '0.05 0.07',
    ...extra,
  };
}

describe('detectVendor', () => {
  it('reads the maker-note group name from -G1 keys', () => {
    expect(detectVendor({ 'Panasonic:FocusMode': 'AF-C' })).toBe('panasonic');
    expect(detectVendor({ 'Canon:FocusMode': 'One-shot AF' })).toBe('canon');
  });

  it('falls back to Make when no group prefix is present', () => {
    expect(detectVendor({ Make: 'NIKON CORPORATION' })).toBe('nikon');
  });

  it('maps Leica bodies to panasonic, since they write Panasonic maker notes', () => {
    expect(detectVendor({ Make: 'LEICA CAMERA AG' })).toBe('panasonic');
  });

  it('returns unknown for an unrecognised camera', () => {
    expect(detectVendor({ Make: 'Acme Optics' })).toBe('unknown');
  });
});

describe('mapFocusTags — Panasonic', () => {
  it('reads the AF point as a normalized centre plus size', () => {
    const { vendor, focus } = mapFocusTags(panasonicTags());

    expect(vendor).toBe('panasonic');
    const af = focus!.regions.find((r) => r.kind === 'af-point');
    expect(af).toMatchObject({
      primary: true,
      precision: 'exact',
      rect: { cx: 0.5, cy: 0.4, w: 0.05, h: 0.07 },
    });
  });

  it('collapses the vendor focus mode onto a neutral kind', () => {
    expect(mapFocusTags(panasonicTags()).focus!.mode).toBe('af-c');
    expect(mapFocusTags(panasonicTags({ 'Panasonic:FocusMode': 'AF-S' })).focus!.mode).toBe('af-s');
    expect(mapFocusTags(panasonicTags({ 'Panasonic:FocusMode': 'Manual' })).focus!.mode).toBe(
      'manual',
    );
    // The raw label is kept for display.
    expect(mapFocusTags(panasonicTags()).focus!.modeLabel).toBe('AF-C');
  });

  it('treats the "n/a" sentinel as no AF point', () => {
    // 4294967295/1024 — written for manual focus.
    const { focus } = mapFocusTags(
      panasonicTags({
        'Panasonic:FocusMode': 'Manual',
        'Panasonic:AFPointPosition': '4194303.9990234375 4194303.9990234375',
        'Panasonic:AFAreaSize': '4194303.9990234375 4194303.9990234375',
      }),
    );

    expect(focus!.mode).toBe('manual');
    expect(focus!.regions.find((r) => r.kind === 'af-point')).toBeUndefined();
  });

  it('treats the "none" sentinel as no AF point', () => {
    const { focus } = mapFocusTags(
      panasonicTags({ 'Panasonic:AFPointPosition': '16777216 16777216' }),
    );
    expect(focus!.regions.find((r) => r.kind === 'af-point')).toBeUndefined();
  });

  it('rejects any component outside 0..1', () => {
    const { focus } = mapFocusTags(panasonicTags({ 'Panasonic:AFPointPosition': '0.5 1.4' }));
    expect(focus!.regions.find((r) => r.kind === 'af-point')).toBeUndefined();
  });

  it('keeps the AF point when only the size is unavailable, as a zero-size rect', () => {
    const { focus } = mapFocusTags(
      panasonicTags({ 'Panasonic:AFAreaSize': '4194303.9990234375 4194303.9990234375' }),
    );
    const af = focus!.regions.find((r) => r.kind === 'af-point')!;
    expect(af.rect).toEqual({ cx: 0.5, cy: 0.4, w: 0, h: 0 });
  });

  it('normalizes face boxes against a 320px-wide reference frame', () => {
    // 6000x4000 sensor -> refW 320, refH 320 * (4000/6000) = 213.33
    const { focus } = mapFocusTags(
      panasonicTags({
        'Panasonic:NumFacePositions': 1,
        'Panasonic:Face1Position': '160 106.6667 32 32',
      }),
    );

    const face = focus!.regions.find((r) => r.kind === 'face')!;
    expect(face.precision).toBe('approx');
    expect(face.primary).toBe(false);
    expect(face.rect.cx).toBeCloseTo(0.5, 4);
    expect(face.rect.cy).toBeCloseTo(0.5, 4);
    expect(face.rect.w).toBeCloseTo(0.1, 4);
  });

  it('emits no face regions when the sensor dimensions are unknown', () => {
    const tags = panasonicTags({
      'Panasonic:NumFacePositions': 1,
      'Panasonic:Face1Position': '160 107 32 32',
    });
    delete tags['ExifIFD:ImageWidth'];
    delete tags['ExifIFD:ImageHeight'];

    const { focus } = mapFocusTags(tags);
    expect(focus!.regions.filter((r) => r.kind === 'face')).toHaveLength(0);
  });

  it('reads lens identity from the maker note', () => {
    const { lens } = mapFocusTags(
      panasonicTags({
        'Panasonic:LensType': 'LUMIX S 18/F1.8',
        'Panasonic:LensSerialNumber': '101023',
      }),
    );
    expect(lens).toMatchObject({ id: 'LUMIX S 18/F1.8', serial: '101023' });
  });
});

describe('mapFocusTags — unsupported vendors', () => {
  it('returns null focus rather than guessing', () => {
    const { vendor, focus } = mapFocusTags({ Make: 'Canon', 'Canon:FocusMode': 'One-shot AF' });
    expect(vendor).toBe('canon');
    expect(focus).toBeNull();
  });

  it('still surfaces the plain EXIF lens name', () => {
    const { lens } = mapFocusTags({ Make: 'Canon', LensModel: 'RF50mm F1.2 L USM' });
    expect(lens?.model).toBe('RF50mm F1.2 L USM');
  });
});

describe('orientFocusInfo', () => {
  /** A rect at the top-left corner, so each transform is unambiguous. */
  const corner: NormRect = { cx: 0, cy: 0, w: 0.1, h: 0.2 };

  function withOrientation(orientation: number): FocusInfo {
    return {
      frame: 'sensor',
      exifOrientation: orientation,
      mode: 'af-c',
      modeLabel: 'AF-C',
      areaMode: null,
      subjectDetection: null,
      assistLamp: null,
      facesDetected: null,
      regions: [{ kind: 'af-point', rect: corner, primary: true, precision: 'exact' }],
    };
  }

  const CASES: Array<[number, { cx: number; cy: number; w: number; h: number }]> = [
    [1, { cx: 0, cy: 0, w: 0.1, h: 0.2 }],
    [2, { cx: 1, cy: 0, w: 0.1, h: 0.2 }],
    [3, { cx: 1, cy: 1, w: 0.1, h: 0.2 }],
    [4, { cx: 0, cy: 1, w: 0.1, h: 0.2 }],
    // 5-8 transpose the frame, so width and height swap.
    [5, { cx: 0, cy: 0, w: 0.2, h: 0.1 }],
    [6, { cx: 1, cy: 0, w: 0.2, h: 0.1 }],
    [7, { cx: 1, cy: 1, w: 0.2, h: 0.1 }],
    [8, { cx: 0, cy: 1, w: 0.2, h: 0.1 }],
  ];

  it.each(CASES)('maps the top-left corner correctly for orientation %i', (orientation, want) => {
    const out = orientFocusInfo(withOrientation(orientation));
    expect(out.frame).toBe('displayed');
    expect(out.regions[0]!.rect).toEqual(want);
  });

  it('is idempotent — a displayed frame is returned untouched', () => {
    const once = orientFocusInfo(withOrientation(6));
    const twice = orientFocusInfo(once);
    expect(twice).toBe(once);
    expect(twice.regions[0]!.rect).toEqual({ cx: 1, cy: 0, w: 0.2, h: 0.1 });
  });

  it('treats a missing orientation as 1', () => {
    const info = { ...withOrientation(1), exifOrientation: null };
    expect(orientFocusInfo(info).regions[0]!.rect).toEqual(corner);
  });
});
