import { describe, it, expect } from 'vitest';
import type { ImageFileInfo } from '@photo-culler/types';
import { folderLabel, foldersOf, groupByFolder, compareFolderPaths } from '../folders';

function img(folder: string, name: string, dateTaken: number): ImageFileInfo {
  return {
    path: `${folder}/${name}`,
    name,
    folder,
    extension: 'jpg',
    size: 1000,
    lastModified: dateTaken,
    dateTaken,
  };
}

describe('folderLabel', () => {
  it('uses the root basename when the folder IS the root', () => {
    expect(folderLabel('/photos/2026', '/photos/2026')).toBe('2026');
  });

  it('shows the path relative to the root for subfolders', () => {
    expect(folderLabel('/photos/2026/concert', '/photos/2026')).toBe('concert');
    expect(folderLabel('/photos/2026/concert/day2', '/photos/2026')).toBe('concert/day2');
  });

  it('normalises Windows separators for display', () => {
    expect(folderLabel('C:\\photos\\2026\\concert', 'C:\\photos\\2026')).toBe('concert');
  });

  it('tolerates a trailing separator on the root', () => {
    expect(folderLabel('/photos/2026/concert', '/photos/2026/')).toBe('concert');
  });

  it('falls back to the full path when the folder is outside the root', () => {
    expect(folderLabel('/elsewhere/x', '/photos')).toBe('/elsewhere/x');
  });
});

describe('foldersOf', () => {
  it('lists distinct folders in first-appearance order', () => {
    const images = [
      img('/root/b', 'b1.jpg', 1000),
      img('/root/a', 'a1.jpg', 2000),
      img('/root/b', 'b2.jpg', 3000),
    ];
    expect(foldersOf(images)).toEqual(['/root/b', '/root/a']);
  });

  it('returns nothing for no images', () => {
    expect(foldersOf([])).toEqual([]);
  });
});

describe('compareFolderPaths', () => {
  it('sorts a prefix path before the paths it is a prefix of', () => {
    expect(compareFolderPaths('/a', '/a/b')).toBeLessThan(0);
    expect(compareFolderPaths('/a/b', '/a')).toBeGreaterThan(0);
  });

  it('is zero for the same path', () => {
    expect(compareFolderPaths('/a/b', '/a/b')).toBe(0);
  });

  it('treats the two separators as equivalent', () => {
    expect(compareFolderPaths('C:\\a\\b', 'C:/a/b')).toBe(0);
  });

  it('ignores repeated and trailing separators', () => {
    expect(compareFolderPaths('/a//b/', '/a/b')).toBe(0);
  });

  it('produces a total order a sort can rely on', () => {
    const paths = ['/r/b/2', '/r/a', '/r/b', '/r/b/10', '/r/b/1', '/r/a b'];
    expect([...paths].sort(compareFolderPaths)).toEqual([
      '/r/a',
      '/r/a b',
      '/r/b',
      '/r/b/1',
      '/r/b/2',
      '/r/b/10',
    ]);
  });
});

describe('groupByFolder', () => {
  it('splits images into one section per folder, each with its own groups', () => {
    const images = [
      img('/root/eventA', 'a1.jpg', 1000),
      img('/root/eventA', 'a2.jpg', 2000),
      // far apart in time, so a second burst within the same folder
      img('/root/eventA', 'a3.jpg', 500_000),
      img('/root/eventB', 'b1.jpg', 1000),
    ];

    const sections = groupByFolder(images, 5000, '/root');

    expect(sections.map((s) => s.label)).toEqual(['eventA', 'eventB']);
    expect(sections[0]!.imageCount).toBe(3);
    // Burst detection still applies inside a folder — that is the whole point
    // of nesting groups under folders rather than replacing them.
    expect(sections[0]!.groups).toHaveLength(2);
    expect(sections[1]!.groups).toHaveLength(1);
  });

  it('namespaces group ids by folder so the virtualizer keys stay unique', () => {
    const images = [img('/root/a', 'a.jpg', 1000), img('/root/b', 'b.jpg', 1000)];
    const sections = groupByFolder(images, 5000, '/root');

    const ids = sections.flatMap((s) => s.groups.map((g) => g.id));
    // groupByTimestamp numbers from zero per call, so both would be 'group-0'.
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toContain('/root/a');
  });

  it('orders folders by NAME, not by where their first image landed', () => {
    // Up to 1.7.0 this asserted the opposite — sections inherited the image
    // sort, so this case produced ['zulu', 'alpha']. It reads fine for one card
    // and scrambles a parent holding several shoots.
    const images = [img('/root/zulu', 'z.jpg', 1000), img('/root/alpha', 'a.jpg', 2000)];
    expect(groupByFolder(images, 5000, '/root').map((s) => s.label)).toEqual(['alpha', 'zulu']);
  });

  it('orders folder names naturally, so 100_PANA precedes 1000_PANA', () => {
    const images = [
      img('/root/1000_PANA', 'a.jpg', 1000),
      img('/root/9_PANA', 'b.jpg', 1000),
      img('/root/100_PANA', 'c.jpg', 1000),
    ];
    expect(groupByFolder(images, 5000, '/root').map((s) => s.label)).toEqual([
      '9_PANA',
      '100_PANA',
      '1000_PANA',
    ]);
  });

  it('keeps a subtree contiguous — a sibling never lands between parent and child', () => {
    // The trap this guards: ' ' (0x20) sorts before '/' (0x2f), so a plain
    // string compare puts '/root/a b' between '/root/a' and '/root/a/z'.
    const images = [
      img('/root/a/z', 'x.jpg', 1000),
      img('/root/a b', 'y.jpg', 1000),
      img('/root/a', 'w.jpg', 1000),
    ];
    expect(groupByFolder(images, 5000, '/root').map((s) => s.label)).toEqual(['a', 'a/z', 'a b']);
  });

  it('puts a parent folder above its own subfolders', () => {
    const images = [img('/root/dcim/100_PANA', 'a.jpg', 1000), img('/root/dcim', 'b.jpg', 1000)];
    expect(groupByFolder(images, 5000, '/root').map((s) => s.label)).toEqual([
      'dcim',
      'dcim/100_PANA',
    ]);
  });

  it('descending is the exact mirror of ascending', () => {
    const images = [
      img('/root/c', 'c.jpg', 1000),
      img('/root/a', 'a.jpg', 1000),
      img('/root/b', 'b.jpg', 1000),
    ];
    const asc = groupByFolder(images, 5000, '/root', 'asc').map((s) => s.label);
    const desc = groupByFolder(images, 5000, '/root', 'desc').map((s) => s.label);
    expect(asc).toEqual(['a', 'b', 'c']);
    expect(desc).toEqual([...asc].reverse());
  });

  it('defaults to ascending when no direction is given', () => {
    const images = [img('/root/b', 'b.jpg', 1000), img('/root/a', 'a.jpg', 1000)];
    expect(groupByFolder(images, 5000, '/root').map((s) => s.label)).toEqual(
      groupByFolder(images, 5000, '/root', 'asc').map((s) => s.label),
    );
  });

  it('leaves the image order inside a section alone', () => {
    // The direction has already been applied to the images by sortImages; a
    // section must not reverse them a second time.
    const images = [
      img('/root/a', 'a3.jpg', 1000),
      img('/root/a', 'a1.jpg', 1000),
      img('/root/a', 'a2.jpg', 1000),
    ];
    const [section] = groupByFolder(images, 5000, '/root', 'desc');
    expect(section!.groups.flatMap((g) => g.images.map((i) => i.name))).toEqual([
      'a3.jpg',
      'a1.jpg',
      'a2.jpg',
    ]);
  });

  it('orders Windows paths the same way as POSIX ones', () => {
    const images = [img('C:\\root\\zulu', 'z.jpg', 1000), img('C:\\root\\alpha', 'a.jpg', 1000)];
    expect(groupByFolder(images, 5000, 'C:\\root').map((s) => s.label)).toEqual(['alpha', 'zulu']);
  });

  it('labels the root folder itself by its basename', () => {
    const sections = groupByFolder([img('/root', 'r.jpg', 1000)], 5000, '/root');
    expect(sections[0]!.label).toBe('root');
  });

  it('returns nothing for no images', () => {
    expect(groupByFolder([], 5000, '/root')).toEqual([]);
  });
});
