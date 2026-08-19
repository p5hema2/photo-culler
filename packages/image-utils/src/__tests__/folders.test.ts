import { describe, it, expect } from 'vitest';
import type { ImageFileInfo } from '@photo-culler/types';
import { folderLabel, foldersOf, groupByFolder } from '../folders';

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

  it('keeps folder order following the image sort, not the alphabet', () => {
    const images = [img('/root/zulu', 'z.jpg', 1000), img('/root/alpha', 'a.jpg', 2000)];
    expect(groupByFolder(images, 5000, '/root').map((s) => s.label)).toEqual(['zulu', 'alpha']);
  });

  it('labels the root folder itself by its basename', () => {
    const sections = groupByFolder([img('/root', 'r.jpg', 1000)], 5000, '/root');
    expect(sections[0]!.label).toBe('root');
  });

  it('returns nothing for no images', () => {
    expect(groupByFolder([], 5000, '/root')).toEqual([]);
  });
});
