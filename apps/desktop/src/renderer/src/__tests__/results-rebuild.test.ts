import { describe, it, expect } from 'vitest';
import type { ResultsFile } from '@photo-culler/types';
import { rebuildResults } from '../lib/results';

function makeResults(): ResultsFile {
  return {
    version: 1,
    folderPath: '/photos',
    updatedAt: '2026-01-01T00:00:00.000Z',
    images: {
      'a.jpg': {
        classification: 'keep',
        userOverride: true,
        qualityScore: 81,
        qualitySubscores: { sharpness: 90, exposure: 70, contrast: 80, noise: 60 },
        rotation: 90,
        exif: { iso: 160, cameraModel: 'DC-S5D' },
      },
      'b.jpg': {
        classification: 'delete',
        userOverride: false,
        qualityScore: 12,
      },
    },
  };
}

describe('rebuildResults', () => {
  it('carries every per-image field forward for kept images', () => {
    // Regression for the bug where trashImages listed only four of the six
    // fields, stripping qualitySubscores and rotation from every remaining
    // image in the folder on a single Delete keypress.
    const results = makeResults();
    const rebuilt = rebuildResults(results, ['a.jpg'], { 'a.jpg': 'keep' });

    expect(rebuilt.images['a.jpg']).toEqual({
      classification: 'keep',
      userOverride: true,
      qualityScore: 81,
      qualitySubscores: { sharpness: 90, exposure: 70, contrast: 80, noise: 60 },
      rotation: 90,
      exif: { iso: 160, cameraModel: 'DC-S5D' },
    });
  });

  it('drops images that are not in keepNames', () => {
    const rebuilt = rebuildResults(makeResults(), ['a.jpg'], { 'a.jpg': 'keep' });

    expect(Object.keys(rebuilt.images)).toEqual(['a.jpg']);
    expect(rebuilt.images['b.jpg']).toBeUndefined();
  });

  it('applies the incoming classification over the stored one', () => {
    const rebuilt = rebuildResults(makeResults(), ['a.jpg'], { 'a.jpg': 'review' });

    expect(rebuilt.images['a.jpg']!.classification).toBe('review');
    // ...without disturbing the other fields
    expect(rebuilt.images['a.jpg']!.rotation).toBe(90);
  });

  it('falls back to the stored classification when none is supplied', () => {
    const rebuilt = rebuildResults(makeResults(), ['a.jpg'], {});

    expect(rebuilt.images['a.jpg']!.classification).toBe('keep');
  });

  it('creates a null-classified entry for a name with no stored record', () => {
    const rebuilt = rebuildResults(makeResults(), ['new.jpg'], {});

    expect(rebuilt.images['new.jpg']).toEqual({ classification: null, userOverride: false });
  });

  it('preserves the file-level metadata', () => {
    const results = makeResults();
    const rebuilt = rebuildResults(results, ['a.jpg'], {});

    expect(rebuilt.version).toBe(1);
    expect(rebuilt.folderPath).toBe('/photos');
  });
});
