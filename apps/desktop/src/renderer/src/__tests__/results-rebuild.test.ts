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
        qualityScore: 81,
        qualitySubscores: { sharpness: 90, exposure: 70, contrast: 80, noise: 60 },
        rotation: 90,
      },
      'b.jpg': {
        qualityScore: 12,
      },
    },
  };
}

describe('rebuildResults', () => {
  it('carries every per-image field forward for kept images', () => {
    // Regression for the bug where the delete path listed only four of the six
    // fields, stripping qualitySubscores and rotation from every remaining
    // image in the folder on a single Delete keypress.
    const results = makeResults();
    const rebuilt = rebuildResults(results, ['a.jpg']);

    expect(rebuilt.images['a.jpg']).toEqual({
      qualityScore: 81,
      qualitySubscores: { sharpness: 90, exposure: 70, contrast: 80, noise: 60 },
      rotation: 90,
    });
  });

  it('drops images that are not in keepNames', () => {
    const rebuilt = rebuildResults(makeResults(), ['a.jpg']);

    expect(Object.keys(rebuilt.images)).toEqual(['a.jpg']);
    expect(rebuilt.images['b.jpg']).toBeUndefined();
  });

  it('does not invent an entry for a name with no stored record', () => {
    // Nothing is known about the image, and an empty record would only be noise
    // in the file — every field of ImageResult is optional.
    const rebuilt = rebuildResults(makeResults(), ['new.jpg']);

    expect(rebuilt.images['new.jpg']).toBeUndefined();
  });

  it('preserves the file-level metadata', () => {
    const results = makeResults();
    const rebuilt = rebuildResults(results, ['a.jpg']);

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

    // Scores are only ever set, never cleared, so they keep falling back to the
    // value on disk.
    expect(projected.images['a.jpg']!.qualityScore).toBe(81);
    expect(projected.images['a.jpg']!.qualitySubscores).toEqual({
      sharpness: 90,
      exposure: 70,
      contrast: 80,
      noise: 60,
    });
  });

  it('does not touch an image that is not in the projected list', () => {
    // b.jpg is on disk but outside `images`; its entry survives via the spread.
    const projected = projectFolderResults(makeResults(), '/photos', [A], empty);

    expect(projected.images['b.jpg']!.qualityScore).toBe(12);
  });

  it('never records a rating — the image file is the authority for that', () => {
    const projected = projectFolderResults(makeResults(), '/photos', [A], empty);

    expect(projected.images['a.jpg']).not.toHaveProperty('rating');
  });
});
