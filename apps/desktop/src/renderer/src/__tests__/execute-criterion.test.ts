import { describe, it, expect } from 'vitest';
import type { ImageFileInfo } from '@photo-culler/types';
import { MAX_RATING, isInRatingRange } from '@photo-culler/image-utils/rating';
import type { RatingRange } from '../lib/filters';
import { DEFAULT_DELETE_RANGE } from '../hooks/usePhotoStore';

/**
 * What Execute would delete, mirroring the selection step of `executeActions`.
 *
 * Two things are restated from the store on purpose, because they are the whole
 * criterion: the window's floor is forced to 1, and the candidates are the
 * FILTERED images rather than everything in the folder. The range test itself
 * calls the real predicate.
 */
function deleteTargets(
  visibleImages: ImageFileInfo[],
  ratings: Record<string, number>,
  deleteRange: RatingRange,
): string[] {
  const window: RatingRange = { min: Math.max(1, deleteRange.min), max: deleteRange.max };
  return visibleImages
    .filter((img) => isInRatingRange(ratings[img.path], window))
    .map((img) => img.path);
}

function makeImage(name: string): ImageFileInfo {
  return {
    path: `/photos/${name}`,
    name,
    folder: '/photos',
    extension: 'jpg',
    size: 1000,
    lastModified: 0,
  };
}

const images = ['unrated.jpg', 'one.jpg', 'two.jpg', 'three.jpg', 'four.jpg', 'five.jpg'].map(
  makeImage,
);

/** One image per rating, plus one the user has not rated at all. */
const ratings: Record<string, number> = {
  '/photos/unrated.jpg': 0,
  '/photos/one.jpg': 1,
  '/photos/two.jpg': 2,
  '/photos/three.jpg': 3,
  '/photos/four.jpg': 4,
  '/photos/five.jpg': 5,
};

describe('the Execute delete criterion', () => {
  it('deletes only one-star images at the default range', () => {
    expect(deleteTargets(images, ratings, DEFAULT_DELETE_RANGE)).toEqual(['/photos/one.jpg']);
  });

  it('deletes the whole inclusive window, both ends included', () => {
    expect(deleteTargets(images, ratings, { min: 1, max: 3 })).toEqual([
      '/photos/one.jpg',
      '/photos/two.jpg',
      '/photos/three.jpg',
    ]);
  });

  it('never deletes an unrated image, whatever the panel asks for', () => {
    // The safety property of the feature: the window starts at one star, so
    // "select all, execute" cannot wipe a shoot nobody has rated yet. 0 is not
    // a low score — it means no decision has been made.
    for (const min of [-1, 0]) {
      const targets = deleteTargets(images, ratings, { min, max: MAX_RATING });
      expect(targets).not.toContain('/photos/unrated.jpg');
      expect(targets).toHaveLength(5);
    }
  });

  it('treats an image with no rating entry as unrated rather than as zero-and-deletable', () => {
    const noRatings = deleteTargets(images, {}, { min: 1, max: MAX_RATING });
    expect(noRatings).toEqual([]);
  });

  it('operates on the filtered set, not the whole folder', () => {
    // Execute deliberately follows the toolbar: what is visible is what it can
    // act on, which is how a user restricts it to one folder or one extension.
    const visible = images.filter((img) => img.name !== 'one.jpg');
    expect(deleteTargets(visible, ratings, { min: 1, max: 2 })).toEqual(['/photos/two.jpg']);
  });

  it('deletes nothing when the filtered set is empty', () => {
    expect(deleteTargets([], ratings, { min: 1, max: MAX_RATING })).toEqual([]);
  });
});
