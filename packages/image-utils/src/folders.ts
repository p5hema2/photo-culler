import type { ImageFileInfo } from '@photo-culler/types';
import { groupByTimestamp, type PhotoGroup } from './grouping';

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
 * Folder order follows the first image of each folder, so it inherits whatever
 * sort the user chose rather than imposing an alphabetical one.
 *
 * Group ids are namespaced with the folder path: `groupByTimestamp` numbers
 * them from zero per call, and the virtualizer needs keys that stay unique once
 * several folders are on screen at once.
 */
export function groupByFolder(
  images: ImageFileInfo[],
  thresholdMs: number,
  rootPath: string,
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
  return sections;
}
