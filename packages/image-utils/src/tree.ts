/**
 * The folder tree the grid renders.
 *
 * Up to 1.8.0 the grid showed a FLAT list of sections, each labelled with its
 * path relative to the opened root — so a card came out as one row reading
 * `2026-07-03 - Heidewitzka Festival/DCIM/100_PANA`. That is a path, not a
 * structure: it cannot be collapsed at the shoot level, it has nowhere to hang
 * a "new subfolder" action, and every level of nesting makes the label longer
 * rather than the layout deeper.
 *
 * This module builds the real thing. It stays pure and DOM-free — the renderer
 * reaches it by deep alias — and it deliberately does NOT flatten to rows:
 * PhotoGrid's virtualizer needs one flat array and owns that translation, for
 * the reasons CLAUDE.md records.
 */

import { compare } from 'natural-orderby';
import type { FolderSection } from './folders';
import type { SortDirection } from './sorting';

export interface FolderNode {
  /** Absolute directory path — the stable identity, used for state and results. */
  path: string;
  /**
   * This folder's own name, for the indented label. The ROOT keeps its full
   * last segment; everything below shows one segment only, because the tree
   * already says where it sits.
   */
  name: string;
  /** Levels below the opened root. The root itself is 0. */
  depth: number;
  /** Direct children, in sibling order. */
  children: FolderNode[];
  /**
   * The images sitting directly in this folder, already grouped.
   *
   * Null for a folder that holds none of its own — a shoot directory above a
   * `DCIM`, or one the user has just created. Those are branches, and they are
   * exactly why the tree cannot be derived from the images alone.
   */
  section: FolderSection | null;
  /** Images directly in this folder. */
  ownCount: number;
  /** Images in this folder and every folder below it. */
  totalCount: number;
}

/** Split on either separator, dropping empty segments. */
function segmentsOf(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean);
}

/**
 * A comparison key for a path.
 *
 * Separators are normalised so a scan that mixed them cannot produce two nodes
 * for one directory, and the case is folded because NTFS and APFS treat
 * `DCIM` and `dcim` as the same folder. The ORIGINAL string is what the node
 * carries — it is the key `collapsedFolders`, the results file and every IPC
 * call use, and lower-casing that would break all three.
 */
function keyOf(path: string): string {
  return segmentsOf(path).join('/').toLowerCase();
}

/**
 * Build the tree of every folder at or below `rootPath`.
 *
 * `directories` is the walk's own list, not something derived from the images:
 * a folder with no photos anywhere below it has to appear, or there would be
 * nowhere to drop a moved file and a freshly created subfolder would vanish
 * the moment it was made.
 *
 * Ancestors missing from both inputs are synthesised, so a directory list that
 * names only leaves still produces a connected tree rather than a forest.
 *
 * `direction` reverses SIBLINGS, not the whole list. Descending cannot mean
 * "children before parents" — that is not a tree — so it means what it can
 * mean, and the nesting survives it.
 */
export function buildFolderTree(
  sections: readonly FolderSection[],
  directories: readonly string[],
  rootPath: string,
  direction: SortDirection = 'asc',
): FolderNode[] {
  const rootKey = keyOf(rootPath);
  const rootDepth = segmentsOf(rootPath).length;

  const sectionByKey = new Map<string, FolderSection>();
  for (const section of sections) sectionByKey.set(keyOf(section.path), section);

  /** Every folder that must exist, by key, remembering the path it came with. */
  const paths = new Map<string, string>();
  const remember = (path: string): void => {
    const key = keyOf(path);
    // Outside the opened tree: a results file from elsewhere, or a stray. The
    // grid has no place to draw it.
    if (key !== rootKey && !key.startsWith(`${rootKey}/`)) return;
    if (!paths.has(key)) paths.set(key, path);
  };

  remember(rootPath);
  for (const directory of directories) remember(directory);
  for (const section of sections) remember(section.path);

  // Synthesise any ancestor nobody named, so the tree is connected. Iterating a
  // snapshot because `remember` adds to the same map.
  //
  // By TRIMMING the original string rather than re-joining its segments: a
  // rebuilt `/shoots/a` comes back as `shoots/a` — the leading separator is not
  // a segment — and a path that no longer matches is a node whose parent lookup
  // fails, which silently turns every level into its own root and makes
  // collapsing hide nothing.
  for (const path of [...paths.values()]) {
    let current = path;
    for (;;) {
      const cut = Math.max(current.lastIndexOf('/'), current.lastIndexOf('\\'));
      if (cut <= 0) break;
      current = current.slice(0, cut);
      if (keyOf(current).length < rootKey.length) break;
      remember(current);
    }
  }

  const nodes = new Map<string, FolderNode>();
  for (const [key, path] of paths) {
    const parts = segmentsOf(path);
    const section = sectionByKey.get(key) ?? null;
    nodes.set(key, {
      path,
      // The root shows its own last segment; a synthesised ancestor may have
      // lost its original casing, which is why the path is what identifies it.
      name: parts[parts.length - 1] ?? path,
      depth: parts.length - rootDepth,
      children: [],
      section,
      ownCount: section?.imageCount ?? 0,
      totalCount: 0,
    });
  }

  const roots: FolderNode[] = [];
  for (const [key, node] of nodes) {
    if (key === rootKey) {
      roots.push(node);
      continue;
    }
    const parentKey = key.slice(0, key.lastIndexOf('/'));
    const parent = nodes.get(parentKey);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const naturalCompare = compare({ order: 'asc' });
  const sortChildren = (node: FolderNode): number => {
    node.children.sort((a, b) => naturalCompare(a.name, b.name));
    if (direction === 'desc') node.children.reverse();
    let total = node.ownCount;
    for (const child of node.children) total += sortChildren(child);
    node.totalCount = total;
    return total;
  };

  roots.sort((a, b) => naturalCompare(a.name, b.name));
  if (direction === 'desc') roots.reverse();
  for (const root of roots) sortChildren(root);

  return roots;
}

/**
 * The tree in render order, depth first, with collapsed subtrees left out.
 *
 * A collapsed node still appears — it is what the user clicks to reopen it —
 * but nothing below it does. That is the whole behavioural difference from the
 * flat list, where collapsing one section could not hide another.
 */
export function visibleNodes(
  roots: readonly FolderNode[],
  collapsed: ReadonlySet<string>,
): FolderNode[] {
  const out: FolderNode[] = [];
  const walk = (node: FolderNode): void => {
    out.push(node);
    if (collapsed.has(node.path)) return;
    for (const child of node.children) walk(child);
  };
  for (const root of roots) walk(root);
  return out;
}

/** Depth-first over the whole tree, collapse ignored. */
export function allNodes(roots: readonly FolderNode[]): FolderNode[] {
  const out: FolderNode[] = [];
  const walk = (node: FolderNode): void => {
    out.push(node);
    for (const child of node.children) walk(child);
  };
  for (const root of roots) walk(root);
  return out;
}

/**
 * Whether `candidate` is `folder` itself or sits below it.
 *
 * Used by the two operations that must refuse to eat their own tail: moving a
 * folder's files into itself, and deleting a folder that contains the one the
 * cursor is in.
 */
export function isAtOrBelow(candidate: string, folder: string): boolean {
  const a = keyOf(candidate);
  const b = keyOf(folder);
  return a === b || a.startsWith(`${b}/`);
}

/**
 * What one directory contributes to its own header, before the roll-up.
 *
 * Each pair carries its OWN denominator rather than sharing the image count,
 * because not every file can reach every state. A video is never scored, and a
 * container Chromium cannot demux never gets a poster frame — so a counter
 * measured against the plain image count would sit at 25/28 for ever and read
 * as an unfinished job that is in fact finished.
 */
export interface FolderOwnCounts {
  scored: number;
  /** Files that CAN be scored: stills. */
  scoreable: number;
  thumbs: number;
  /** Files that CAN have a thumbnail: stills, plus videos with a decoder. */
  thumbable: number;
}

/** What a folder header reports, summed over the folder and everything below it. */
export interface FolderCounts {
  /** Images here and below — the same number as `FolderNode.totalCount`. */
  images: number;
  scored: number;
  scoreable: number;
  thumbs: number;
  thumbable: number;
}

/**
 * Roll per-directory tallies up the tree.
 *
 * The counters moved off the toolbar and onto the folder headers in 1.8.1, and
 * a header has to answer for its whole subtree — a collapsed shoot showing only
 * the handful of images sitting loose in its own directory would be worse than
 * no number at all.
 *
 * Both inputs are keyed by the DIRECTORY a file sits in, which is what the
 * renderer can cheaply bucket: a quality score is keyed by image path, and a
 * generated thumbnail is too. Directories absent from either map count as zero,
 * so a folder nobody has scrolled past simply reads 0.
 */
export function rollUpCounts(
  roots: readonly FolderNode[],
  own: Readonly<Record<string, Partial<FolderOwnCounts>>>,
): Map<string, FolderCounts> {
  const out = new Map<string, FolderCounts>();

  const walk = (node: FolderNode): FolderCounts => {
    const mine = own[node.path] ?? {};
    const counts: FolderCounts = {
      images: node.ownCount,
      scored: mine.scored ?? 0,
      scoreable: mine.scoreable ?? 0,
      thumbs: mine.thumbs ?? 0,
      thumbable: mine.thumbable ?? 0,
    };
    for (const child of node.children) {
      const below = walk(child);
      counts.images += below.images;
      counts.scored += below.scored;
      counts.scoreable += below.scoreable;
      counts.thumbs += below.thumbs;
      counts.thumbable += below.thumbable;
    }
    // Clamped: a thumbnail can outlive the image it was made from until the
    // next vacuum, and a results file can hold a score for a file a filter has
    // removed from the list. A counter reading 41/40 is a bug report.
    counts.scored = Math.min(counts.scored, counts.scoreable);
    counts.thumbs = Math.min(counts.thumbs, counts.thumbable);
    out.set(node.path, counts);
    return counts;
  };

  for (const root of roots) walk(root);
  return out;
}
