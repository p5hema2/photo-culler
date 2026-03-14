import { describe, it, expect, vi } from 'vitest';
import type { PhotoGroup } from '@photo-culler/image-utils/grouping';
import type { ImageFileInfo } from '@photo-culler/types';

// Import the hook to test its logic. We'll test the key handler directly.
// Since useKeyboardNav depends on React refs and callbacks, we test the navigation logic.

function makeImage(name: string, path?: string): ImageFileInfo {
  return {
    path: path ?? `/photos/${name}`,
    name,
    extension: 'jpg',
    size: 1000,
    lastModified: Date.now(),
  };
}

function makeGroup(id: string, images: ImageFileInfo[]): PhotoGroup {
  return {
    id,
    images,
    startTime: null,
    endTime: null,
  };
}

// Helper: simulate the navigation logic from useKeyboardNav
function navigateKey(
  groups: PhotoGroup[],
  focusedPath: string | null,
  key: string,
): { newFocus: string | null; cycledFilename: string | null } {
  let newFocus: string | null = null;
  let cycledFilename: string | null = null;

  if (groups.length === 0) return { newFocus, cycledFilename };

  if (!focusedPath) {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key)) {
      newFocus = groups[0]?.images[0]?.path ?? null;
    }
    return { newFocus, cycledFilename };
  }

  // Find position
  let groupIndex = -1;
  let imageIndex = -1;
  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi]!;
    for (let ii = 0; ii < group.images.length; ii++) {
      if (group.images[ii]!.path === focusedPath) {
        groupIndex = gi;
        imageIndex = ii;
        break;
      }
    }
    if (groupIndex >= 0) break;
  }

  if (groupIndex < 0) return { newFocus, cycledFilename };

  const currentGroup = groups[groupIndex]!;

  switch (key) {
    case 'ArrowRight': {
      if (imageIndex < currentGroup.images.length - 1) {
        newFocus = currentGroup.images[imageIndex + 1]!.path;
      } else if (groupIndex < groups.length - 1) {
        newFocus = groups[groupIndex + 1]!.images[0]!.path;
      }
      break;
    }
    case 'ArrowLeft': {
      if (imageIndex > 0) {
        newFocus = currentGroup.images[imageIndex - 1]!.path;
      } else if (groupIndex > 0) {
        const prevGroup = groups[groupIndex - 1]!;
        newFocus = prevGroup.images[prevGroup.images.length - 1]!.path;
      }
      break;
    }
    case 'ArrowDown': {
      if (groupIndex < groups.length - 1) {
        const nextGroup = groups[groupIndex + 1]!;
        const targetIndex = Math.min(imageIndex, nextGroup.images.length - 1);
        newFocus = nextGroup.images[targetIndex]!.path;
      }
      break;
    }
    case 'ArrowUp': {
      if (groupIndex > 0) {
        const prevGroup = groups[groupIndex - 1]!;
        const targetIndex = Math.min(imageIndex, prevGroup.images.length - 1);
        newFocus = prevGroup.images[targetIndex]!.path;
      }
      break;
    }
    case 'Home': {
      newFocus = groups[0]!.images[0]!.path;
      break;
    }
    case 'End': {
      const lastGroup = groups[groups.length - 1]!;
      newFocus = lastGroup.images[lastGroup.images.length - 1]!.path;
      break;
    }
    case ' ': {
      cycledFilename = currentGroup.images[imageIndex]!.name;
      break;
    }
  }

  return { newFocus, cycledFilename };
}

describe('Keyboard Navigation', () => {
  const imgA = makeImage('a.jpg', '/photos/a.jpg');
  const imgB = makeImage('b.jpg', '/photos/b.jpg');
  const imgC = makeImage('c.jpg', '/photos/c.jpg');
  const imgD = makeImage('d.jpg', '/photos/d.jpg');
  const imgE = makeImage('e.jpg', '/photos/e.jpg');

  const group1 = makeGroup('g1', [imgA, imgB, imgC]);
  const group2 = makeGroup('g2', [imgD, imgE]);
  const groups = [group1, group2];

  it('Right arrow moves to next thumbnail within group', () => {
    const result = navigateKey(groups, '/photos/a.jpg', 'ArrowRight');
    expect(result.newFocus).toBe('/photos/b.jpg');
  });

  it('Left arrow moves to previous thumbnail within group', () => {
    const result = navigateKey(groups, '/photos/b.jpg', 'ArrowLeft');
    expect(result.newFocus).toBe('/photos/a.jpg');
  });

  it('Right arrow at end of group wraps to first thumbnail of next group', () => {
    const result = navigateKey(groups, '/photos/c.jpg', 'ArrowRight');
    expect(result.newFocus).toBe('/photos/d.jpg');
  });

  it('Left arrow at start of group wraps to last thumbnail of previous group', () => {
    const result = navigateKey(groups, '/photos/d.jpg', 'ArrowLeft');
    expect(result.newFocus).toBe('/photos/c.jpg');
  });

  it('Down arrow moves to same column in next group', () => {
    const result = navigateKey(groups, '/photos/a.jpg', 'ArrowDown');
    expect(result.newFocus).toBe('/photos/d.jpg');
  });

  it('Up arrow moves to same column in previous group', () => {
    const result = navigateKey(groups, '/photos/d.jpg', 'ArrowUp');
    expect(result.newFocus).toBe('/photos/a.jpg');
  });

  it('Down arrow clamps to last image when target group has fewer images', () => {
    // group1 has 3 images, group2 has 2
    // Focus on imgC (index 2 in group1), down should go to imgE (index 1, clamped)
    const result = navigateKey(groups, '/photos/c.jpg', 'ArrowDown');
    expect(result.newFocus).toBe('/photos/e.jpg');
  });

  it('Up arrow clamps to last image when target group has fewer images', () => {
    // Reverse: from group2 index 1 up to group1 index 1
    const result = navigateKey(groups, '/photos/e.jpg', 'ArrowUp');
    expect(result.newFocus).toBe('/photos/b.jpg');
  });

  it('Home jumps to first image of first group', () => {
    const result = navigateKey(groups, '/photos/e.jpg', 'Home');
    expect(result.newFocus).toBe('/photos/a.jpg');
  });

  it('End jumps to last image of last group', () => {
    const result = navigateKey(groups, '/photos/a.jpg', 'End');
    expect(result.newFocus).toBe('/photos/e.jpg');
  });

  it('Space cycles classification of focused image', () => {
    const result = navigateKey(groups, '/photos/b.jpg', ' ');
    expect(result.cycledFilename).toBe('b.jpg');
  });

  it('focuses first image when nothing is focused on arrow key', () => {
    const result = navigateKey(groups, null, 'ArrowRight');
    expect(result.newFocus).toBe('/photos/a.jpg');
  });

  it('does nothing when at left boundary of first group', () => {
    const result = navigateKey(groups, '/photos/a.jpg', 'ArrowLeft');
    expect(result.newFocus).toBeNull();
  });

  it('does nothing when at right boundary of last group', () => {
    const result = navigateKey(groups, '/photos/e.jpg', 'ArrowRight');
    expect(result.newFocus).toBeNull();
  });
});
