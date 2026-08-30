import { describe, it, expect } from 'vitest';
import type { ImageFileInfo } from '@photo-culler/types';
import { groupByFolder } from '../folders';
import { buildFolderTree, visibleNodes, allNodes, isAtOrBelow, rollUpCounts } from '../tree';

function img(folder: string, name: string): ImageFileInfo {
  return {
    path: `${folder}/${name}`,
    name,
    folder,
    extension: 'jpg',
    size: 1000,
    lastModified: 1000,
    dateTaken: 1000,
  };
}

/** Sections the way the store produces them, so the tree is fed real input. */
function sectionsOf(images: ImageFileInfo[], root: string) {
  return groupByFolder(images, 5000, root);
}

/** `path (depth) own/total` for every node, in render order. */
function shape(nodes: ReturnType<typeof visibleNodes>, root: string): string[] {
  return nodes.map(
    (n) =>
      `${'  '.repeat(n.depth)}${n.path === root ? n.path : n.name} ${n.ownCount}/${n.totalCount}`,
  );
}

const ROOT = '/shoots';

describe('buildFolderTree', () => {
  it('nests instead of flattening the path into the label', () => {
    // The 1.8.0 grid showed one row reading 'Festival/DCIM/100_PANA'.
    const images = [img('/shoots/Festival/DCIM/100_PANA', 'a.jpg')];
    const tree = buildFolderTree(sectionsOf(images, ROOT), [], ROOT);

    expect(shape(visibleNodes(tree, new Set()), ROOT)).toEqual([
      '/shoots 0/1',
      '  Festival 0/1',
      '    DCIM 0/1',
      '      100_PANA 1/1',
    ]);
  });

  it('synthesises the ancestors nobody named', () => {
    // Only the leaf carries images and only the leaf is in the directory list;
    // the tree still has to be connected.
    const images = [img('/shoots/a/b/c', 'x.jpg')];
    const tree = buildFolderTree(sectionsOf(images, ROOT), ['/shoots/a/b/c'], ROOT);
    expect(allNodes(tree).map((n) => n.path)).toEqual([
      '/shoots',
      '/shoots/a',
      '/shoots/a/b',
      '/shoots/a/b/c',
    ]);
  });

  it('keeps a folder that holds no images anywhere below it', () => {
    // Without this there would be nowhere to drop a moved file, and a folder
    // the user just created would vanish the moment it was made.
    const images = [img('/shoots/full', 'x.jpg')];
    const tree = buildFolderTree(sectionsOf(images, ROOT), ['/shoots/empty'], ROOT);
    const names = visibleNodes(tree, new Set()).map((n) => n.name);
    expect(names).toContain('empty');
    const empty = allNodes(tree).find((n) => n.name === 'empty');
    expect(empty?.section).toBeNull();
    expect(empty?.totalCount).toBe(0);
  });

  it('counts own images separately from the subtree total', () => {
    const images = [
      img('/shoots/Festival', 'cover.jpg'),
      img('/shoots/Festival/DCIM', 'a.jpg'),
      img('/shoots/Festival/DCIM', 'b.jpg'),
      img('/shoots/Festival/DCIM/100_PANA', 'c.jpg'),
    ];
    const tree = buildFolderTree(sectionsOf(images, ROOT), [], ROOT);

    expect(shape(visibleNodes(tree, new Set()), ROOT)).toEqual([
      '/shoots 0/4',
      '  Festival 1/4',
      '    DCIM 2/3',
      '      100_PANA 1/1',
    ]);
  });

  it('orders siblings naturally', () => {
    const tree = buildFolderTree(
      [],
      ['/shoots/100_PANA', '/shoots/9_PANA', '/shoots/10_PANA'],
      ROOT,
    );
    expect(tree[0]!.children.map((c) => c.name)).toEqual(['9_PANA', '10_PANA', '100_PANA']);
  });

  it('reverses SIBLINGS for descending, never children above parents', () => {
    // A flat list could simply be reversed; a tree cannot. Descending means the
    // only thing it can mean here.
    const images = [img('/shoots/a/deep', 'x.jpg'), img('/shoots/b', 'y.jpg')];
    const sections = sectionsOf(images, ROOT);

    const asc = shape(visibleNodes(buildFolderTree(sections, [], ROOT, 'asc'), new Set()), ROOT);
    const desc = shape(visibleNodes(buildFolderTree(sections, [], ROOT, 'desc'), new Set()), ROOT);

    expect(asc).toEqual(['/shoots 0/2', '  a 0/1', '    deep 1/1', '  b 1/1']);
    expect(desc).toEqual(['/shoots 0/2', '  b 1/1', '  a 0/1', '    deep 1/1']);
  });

  it('ignores a folder outside the opened root', () => {
    const tree = buildFolderTree([], ['/elsewhere/x'], ROOT);
    expect(allNodes(tree).map((n) => n.path)).toEqual(['/shoots']);
  });

  it('treats the two separators and letter case as one folder', () => {
    // A Windows scan can hand back either separator, and NTFS says DCIM and
    // dcim are the same directory. Two nodes for one folder would give it two
    // collapse states and two drop targets.
    const tree = buildFolderTree([], ['C:\\shoots\\DCIM', 'C:/shoots/dcim'], 'C:\\shoots');
    expect(tree[0]!.children).toHaveLength(1);
  });

  it('gives the root its own last segment as a name', () => {
    const tree = buildFolderTree([], [], '/shoots/2026');
    expect(tree[0]).toMatchObject({ name: '2026', depth: 0 });
  });

  it('returns just the root for an empty scan', () => {
    expect(buildFolderTree([], [], ROOT).map((n) => n.path)).toEqual([ROOT]);
  });
});

describe('visibleNodes', () => {
  const images = [
    img('/shoots/Festival/DCIM/100_PANA', 'a.jpg'),
    img('/shoots/Festival/DCIM/101_PANA', 'b.jpg'),
    img('/shoots/Other', 'c.jpg'),
  ];
  const tree = buildFolderTree(sectionsOf(images, ROOT), [], ROOT);

  it('hides a collapsed node\u2019s whole subtree, not just its images', () => {
    // The behavioural difference from the flat list: there, collapsing one
    // section could not hide another.
    const names = visibleNodes(tree, new Set(['/shoots/Festival'])).map((n) => n.name);
    expect(names).toEqual(['shoots', 'Festival', 'Other']);
  });

  it('still shows the collapsed node itself', () => {
    const names = visibleNodes(tree, new Set(['/shoots/Festival/DCIM'])).map((n) => n.name);
    expect(names).toContain('DCIM');
    expect(names).not.toContain('100_PANA');
  });

  it('collapsing the root leaves exactly the root', () => {
    expect(visibleNodes(tree, new Set([ROOT])).map((n) => n.path)).toEqual([ROOT]);
  });

  it('shows everything when nothing is collapsed', () => {
    expect(visibleNodes(tree, new Set())).toHaveLength(allNodes(tree).length);
  });
});

describe('isAtOrBelow', () => {
  it('is true for the folder itself', () => {
    expect(isAtOrBelow('/a/b', '/a/b')).toBe(true);
  });

  it('is true for a descendant', () => {
    expect(isAtOrBelow('/a/b/c', '/a/b')).toBe(true);
  });

  it('is false for a sibling and for an ancestor', () => {
    expect(isAtOrBelow('/a/bc', '/a/b')).toBe(false);
    expect(isAtOrBelow('/a', '/a/b')).toBe(false);
  });

  it('ignores separator and case, as the filesystem does', () => {
    expect(isAtOrBelow('C:/A/B/c', 'C:\\a\\b')).toBe(true);
  });
});

describe('rollUpCounts', () => {
  const images = [
    img('/shoots/Festival', 'cover.jpg'),
    img('/shoots/Festival/DCIM', 'a.jpg'),
    img('/shoots/Festival/DCIM', 'b.jpg'),
    img('/shoots/Festival/DCIM/100_PANA', 'c.jpg'),
  ];
  const tree = buildFolderTree(sectionsOf(images, ROOT), [], ROOT);

  /** Every image scoreable and thumbable, which is the all-stills case. */
  const allPossible = (perFolder: Record<string, number>) =>
    Object.fromEntries(
      Object.entries(perFolder).map(([k, n]) => [k, { scoreable: n, thumbable: n }]),
    );

  it('sums a folder and everything below it', () => {
    const counts = rollUpCounts(tree, {
      '/shoots/Festival': { scoreable: 1, thumbable: 1 },
      '/shoots/Festival/DCIM': { scoreable: 2, thumbable: 2, scored: 2 },
      '/shoots/Festival/DCIM/100_PANA': { scoreable: 1, thumbable: 1, scored: 1 },
    });
    expect(counts.get('/shoots')).toMatchObject({ images: 4, scored: 3 });
    expect(counts.get('/shoots/Festival')).toMatchObject({ images: 4, scored: 3 });
    expect(counts.get('/shoots/Festival/DCIM')).toMatchObject({ images: 3, scored: 3 });
    expect(counts.get('/shoots/Festival/DCIM/100_PANA')).toMatchObject({ images: 1, scored: 1 });
  });

  it('reads zero for a folder nobody has touched', () => {
    const counts = rollUpCounts(tree, {});
    expect(counts.get('/shoots')).toEqual({
      images: 4,
      scored: 0,
      scoreable: 0,
      thumbs: 0,
      thumbable: 0,
    });
  });

  it('measures each counter against what is POSSIBLE, not the image count', () => {
    // One of the four is a video: never scored, so the score denominator is 3,
    // and a finished folder reads 3/3 rather than sitting at 3/4 for ever.
    const counts = rollUpCounts(tree, {
      '/shoots/Festival': { scoreable: 1, thumbable: 1, scored: 1, thumbs: 1 },
      '/shoots/Festival/DCIM': { scoreable: 1, thumbable: 2, scored: 1, thumbs: 2 },
      '/shoots/Festival/DCIM/100_PANA': { scoreable: 1, thumbable: 1, scored: 1, thumbs: 1 },
    });
    const root = counts.get('/shoots')!;
    expect(root.images).toBe(4);
    expect(`${root.scored}/${root.scoreable}`).toBe('3/3');
    expect(`${root.thumbs}/${root.thumbable}`).toBe('4/4');
  });

  it('never reports more done than are possible', () => {
    // A thumbnail outlives its image until the next vacuum, and a results file
    // can hold a score for a file a filter has removed. 41/40 is a bug report.
    const counts = rollUpCounts(tree, {
      ...allPossible({
        '/shoots/Festival': 1,
        '/shoots/Festival/DCIM': 2,
        '/shoots/Festival/DCIM/100_PANA': 1,
      }),
      '/shoots': { scored: 99, thumbs: 99 },
    });
    expect(counts.get('/shoots')!.scored).toBe(4);
    expect(counts.get('/shoots')!.thumbs).toBe(4);
  });

  it('covers every node in the tree', () => {
    const counts = rollUpCounts(tree, {});
    for (const node of allNodes(tree)) expect(counts.has(node.path)).toBe(true);
  });
});
