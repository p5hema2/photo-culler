import { compare } from 'natural-orderby';
import type { ImageFileInfo } from '@photo-culler/types';
import { groupByTimestamp, type PhotoGroup } from './grouping';
import type { SortDirection } from './sorting';

/**
 * Folder-aware view of a scanned tree.
 *
 * Pure and DOM-free on purpose: the renderer must not reach the package barrel,
 * which pulls in the fs-backed scanner. Import this module by its deep path.
 */

export interface FolderSection {
  /** Absolute directory path — the stable identity used for state and results. */
  path: string;
  /** Path relative to the opened root, for display. */
  label: string;
  /** Timestamp groups within this folder, in sort order. */
  groups: PhotoGroup[];
  /** Total images in this folder, regardless of how they group. */
  imageCount: number;
}

/**
 * Display label for a folder: its path relative to the opened root, or the
 * root's own last segment when they are the same directory.
 */
export function folderLabel(folderPath: string, rootPath: string): string {
  const base = (p: string): string => {
    const parts = p.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] ?? p;
  };

  if (folderPath === rootPath) return base(rootPath);

  const root = rootPath.replace(/[\\/]+$/, '');
  if (folderPath.startsWith(root)) {
    const rel = folderPath.slice(root.length).replace(/^[\\/]+/, '');
    return rel.replace(/\\/g, '/') || base(rootPath);
  }
  return folderPath;
}

/** Split a path on either separator, dropping empty segments. */
function segmentsOf(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean);
}

/**
 * Order two directory paths by name, SEGMENT BY SEGMENT.
 *
 * Comparing the paths as whole strings looks equivalent and is not: `' '` (0x20)
 * sorts before `'/'` (0x2f), so `/root/a b` would land between `/root/a` and
 * `/root/a/z` and lift a sibling folder in between a parent and its own child.
 * Segment-wise comparison keeps every subtree contiguous, which is the whole
 * point of showing a tree.
 *
 * A path that is a prefix of another sorts first, so a parent folder's own
 * images appear above its subfolders' sections.
 *
 * Natural, not lexicographic — `100_PANA` before `101_PANA` before `1000_PANA`,
 * and `DCIM/9` before `DCIM/10`. Same comparator `sortImages` uses, so folder
 * names and file names order by one rule rather than two.
 */
export function compareFolderPaths(a: string, b: string): number {
  const naturalCompare = compare({ order: 'asc' });
  const left = segmentsOf(a);
  const right = segmentsOf(b);
  const shared = Math.min(left.length, right.length);

  for (let i = 0; i < shared; i++) {
    const cmp = naturalCompare(left[i]!, right[i]!);
    if (cmp !== 0) return cmp;
  }
  return left.length - right.length;
}

/** Distinct folders, in the order their first image appears. */
export function foldersOf(images: ImageFileInfo[]): string[] {
  const seen = new Set<string>();
  const folders: string[] = [];
  for (const image of images) {
    if (seen.has(image.folder)) continue;
    seen.add(image.folder);
    folders.push(image.folder);
  }
  return folders;
}

/**
 * Split pre-sorted images into folder sections, each holding the timestamp
 * groups the grid already knows how to render.
 *
 * **Folder order is the folder's own NAME**, segment by segment, not the
 * position of its first image. Up to 1.7.0 it was the latter — sections
 * inherited whatever sort the images were in — which reads fine for one card
 * but scrambles a parent holding several shoots the moment two folders
 * interleave in time. A shoot is a place in a tree, so the tree decides.
 *
 * `direction` reverses the whole list rather than flipping the comparator, so
 * descending is the exact mirror of ascending and a subtree stays contiguous in
 * both. Images WITHIN a section keep the order they arrived in, which is
 * already the user's chosen sort.
 *
 * Group ids are namespaced with the folder path: `groupByTimestamp` numbers
 * them from zero per call, and the virtualizer needs keys that stay unique once
 * several folders are on screen at once.
 */
export function groupByFolder(
  images: ImageFileInfo[],
  thresholdMs: number,
  rootPath: string,
  direction: SortDirection = 'asc',
): FolderSection[] {
  if (images.length === 0) return [];

  const byFolder = new Map<string, ImageFileInfo[]>();
  for (const image of images) {
    const bucket = byFolder.get(image.folder);
    if (bucket) bucket.push(image);
    else byFolder.set(image.folder, [image]);
  }

  const sections: FolderSection[] = [];
  for (const [folderPath, folderImages] of byFolder) {
    sections.push({
      path: folderPath,
      label: folderLabel(folderPath, rootPath),
      groups: groupByTimestamp(folderImages, thresholdMs).map((group) => ({
        ...group,
        id: `${folderPath}::${group.id}`,
      })),
      imageCount: folderImages.length,
    });
  }

  sections.sort((a, b) => compareFolderPaths(a.path, b.path));
  if (direction === 'desc') sections.reverse();
  return sections;
}
