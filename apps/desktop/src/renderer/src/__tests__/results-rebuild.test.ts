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
    // fields, stripping qualitySubscores and the pending rotation from every
    // remaining image in the folder on a single Delete keypress. Those six
    // fields are two now — the keep/review/delete classification went with the
    // rating rewrite, the pending rotation with this change — and the guard
    // holds either way, because the spread is what makes it independent of the
    // field list.
    const results = makeResults();
    const rebuilt = rebuildResults(results, ['a.jpg']);

    expect(rebuilt.images['a.jpg']).toEqual({
      qualityScore: 81,
      qualitySubscores: { sharpness: 90, exposure: 70, contrast: 80, noise: 60 },
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
  };

  it('never writes a rotation — the image file itself is the authority for that', () => {
    // This replaces two tests whose bug is now structurally impossible rather
    // than merely fixed, so the history is worth keeping. It was: Execute
    // applied a pending rotation to disk, deleted it from state and marked the
    // folder dirty — but the projection read
    // `state.rotations[path] ?? prior?.rotation`, so the old 90 came straight
    // back off the file and the next open re-applied a visual quarter turn on
    // top of the image it had just physically rotated. The pair pinned the fix
    // from both sides: absence in state had to mean "cleared", presence had to
    // be written.
    //
    // A rotation is now a change to the image's own EXIF Orientation tag,
    // applied on the keypress. Nothing is pending, `ResultsProjection` has no
    // `rotations` map to read and `ImageResult` no field to write, so what is
    // left to guard is that the field does not come back: reintroducing it would
    // show up here as `rotation: undefined`, which counts as present.
    //
    // A `rotation` left in an existing 1.6.x file does survive, through the
    // spread of `prior` — that spread is deliberate (it is what stops a future
    // field being dropped by omission) and an ignored key is not worth a
    // migration.
    const projected = projectFolderResults(makeResults(), '/photos', [A], empty);

    expect(projected.images['a.jpg']).not.toHaveProperty('rotation');
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
