import { describe, it, expect } from 'vitest';
import type { ImageFileInfo, ResultsFile } from '@photo-culler/types';
import { projectFolderResults, rebuildResults } from '../lib/results';

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

describe('projectFolderResults', () => {
  const A: ImageFileInfo = {
    path: '/photos/a.jpg',
    name: 'a.jpg',
    folder: '/photos',
    extension: 'jpg',
    size: 100,
    lastModified: 1,
  };

  /** Nothing in state at all — the shape openFolder produces for a fresh folder. */
  const empty = {
    classifications: {},
    qualityScores: {},
    qualitySubscores: {},
    rotations: {},
  };

  it('clears a rotation that state no longer holds', () => {
    // Regression for a live bug: Execute applied the rotation to disk, deleted
    // it from state and marked the folder dirty — but the projection read
    // `state.rotations[path] ?? prior?.rotation`, so the old 90 came straight
    // back from the file. The next open then re-applied a visual 90 degrees on
    // top of the already physically rotated image.
    const projected = projectFolderResults(makeResults(), '/photos', [A], empty);

    expect(projected.images['a.jpg']!.rotation).toBeUndefined();
  });

  it('keeps a rotation that state does hold', () => {
    const projected = projectFolderResults(makeResults(), '/photos', [A], {
      ...empty,
      rotations: { '/photos/a.jpg': 180 },
    });

    expect(projected.images['a.jpg']!.rotation).toBe(180);
  });

  it('leaves the other fields of the projected image alone', () => {
    const projected = projectFolderResults(makeResults(), '/photos', [A], empty);

    // Scores and cached EXIF are only ever set, never cleared, so they keep
    // falling back to the value on disk.
    expect(projected.images['a.jpg']!.qualityScore).toBe(81);
    expect(projected.images['a.jpg']!.exif).toEqual({ iso: 160, cameraModel: 'DC-S5D' });
  });

  it('does not touch an image that is not in the projected list', () => {
    // b.jpg is on disk but outside `images`; its entry survives via the spread.
    const projected = projectFolderResults(makeResults(), '/photos', [A], empty);

    expect(projected.images['b.jpg']!.qualityScore).toBe(12);
  });
});
