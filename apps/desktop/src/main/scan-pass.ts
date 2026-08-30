/**
 * The deferred metadata pass, as a thing other main-process code can talk to.
 *
 * `scanFolder` returns once the tree is walked and a screenful of EXIF headers
 * is read; the rest arrives over SCAN_PROGRESS while the grid is already up. On
 * a large library that pass runs for minutes, and until 1.8.1 anything that
 * moved a file underneath it was simply forbidden — `planRename` refused while
 * `isScanIncomplete`, because the pass re-reads BY PATH and
 * `readImageMetadata` returns `{}` rather than throwing, so a renamed image
 * silently lost its date, its dimensions and its RATING for the rest of the
 * session.
 *
 * Forbidding it was the wrong shape of answer: the pass and the rename both run
 * HERE, so the rename can simply tell the pass where the files went. This
 * module is the handle that makes that possible. It holds the very
 * `ImageFileInfo` objects the pass is filling in — the array is shared, not
 * copied, which is the whole point.
 */

import type { ImageFileInfo } from '@photo-culler/types';

interface ActivePass {
  controller: AbortController;
  /**
   * The objects the pass is writing into.
   *
   * The same array `scanFolder` returned to the renderer, by reference. The
   * pass reads `image.path` at the moment it reaches that image, so rewriting
   * an entry that has not been reached yet is all it takes to redirect it.
   */
  images: ImageFileInfo[];
  /** False once the pass has finished, so callers can skip work it already did. */
  running: boolean;
}

let active: ActivePass | null = null;

/**
 * Register the pass a fresh scan is about to start, aborting any predecessor.
 *
 * Two steps rather than one because the controller is needed BEFORE the walk —
 * it is the walk's abort signal — while the array only exists after it. The
 * pass is therefore registered empty and adopts its images a moment later; in
 * between there is nothing to remap, because nothing has been read.
 */
export function startScanPass(): AbortController {
  abortScanPass();
  const controller = new AbortController();
  active = { controller, images: [], running: true };
  return controller;
}

/** Hand the pass the array it is filling in, once the walk has produced it. */
export function adoptScanImages(controller: AbortController, images: ImageFileInfo[]): void {
  if (active?.controller === controller) active.images = images;
}

/** Mark the pass finished. Its array stays reachable but nothing is reading it. */
export function finishScanPass(controller: AbortController): void {
  if (active?.controller === controller) active.running = false;
}

export function abortScanPass(): void {
  if (!active) return;
  active.controller.abort();
  active.running = false;
  active = null;
}

/** Whether a pass is still reading — i.e. whether any file may be unread. */
export function isScanPassRunning(): boolean {
  return active?.running === true;
}

/**
 * Tell the in-flight pass that files have moved.
 *
 * Rewrites `path`, `name` and `folder` on every entry the map names. Entries
 * the pass has already read are unaffected — their metadata is correct and
 * belongs to the same bytes — and entries it has not reached will be read at
 * their new location.
 *
 * The one case this cannot fix is a file being read at this exact instant:
 * `METADATA_CONCURRENCY` is 8, so at most eight images can be mid-read with the
 * old path, and those come back empty. `executeRename` closes that by re-reading
 * the renamed images itself and handing the result back, which is bounded by
 * the size of the plan rather than by the size of the library.
 */
export function remapScanPass(moves: ReadonlyMap<string, ImageFileInfo['path']>): void {
  if (!active || moves.size === 0) return;
  for (const image of active.images) {
    const to = moves.get(image.path);
    if (to === undefined) continue;
    const cut = Math.max(to.lastIndexOf('/'), to.lastIndexOf('\\'));
    image.path = to;
    image.name = to.slice(cut + 1);
    image.folder = to.slice(0, cut);
  }
}
