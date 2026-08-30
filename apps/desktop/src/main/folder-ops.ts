/**
 * Creating, counting and deleting folders.
 *
 * The counting half exists only to serve the deleting half. A recursive folder
 * delete is the most destructive thing this app can do — more than Execute,
 * which is bounded by a star range, and more than the Delete key, which names
 * the images it is about to remove — so the confirmation behind it has to quote
 * a number the app actually walked, not one derived from the photos it happens
 * to display. A folder holding 40 JPEGs may hold 40 RAW files, 40 sidecars and
 * 40 AppleDouble twins the scanner never listed, and every one of them goes.
 */

import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { FolderOpResult, FolderStats } from '@photo-culler/types';
import { isMediaFile } from '@photo-culler/image-utils/media';
import { validateComponent } from '@photo-culler/image-utils/naming';
import { isAtOrBelow } from '@photo-culler/image-utils/tree';

/** Same ceiling the scanner uses, so a walk cannot run away with a symlink loop. */
const MAX_DIRECTORIES = 2000;

/**
 * Create one subfolder.
 *
 * The name goes through `validateComponent` — the same check the rename planner
 * applies to a generated filename — because this one is free text, which is the
 * more dangerous of the two. Not `recursive: true`: the user asked for one
 * folder, and quietly creating a chain of them from a name with a slash in it
 * is not what they typed.
 */
export async function createFolder(parentPath: string, name: string): Promise<FolderOpResult> {
  const trimmed = name.trim();
  const invalid = validateComponent(trimmed);
  if (invalid) return { ok: false, error: `Unzulässiger Ordnername (${invalid})` };

  const target = path.join(parentPath, trimmed);
  try {
    await mkdir(target);
    return { ok: true, path: target };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EEXIST')
      return { ok: false, error: 'Es gibt hier schon einen Ordner mit diesem Namen.' };
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Walk a folder and total up what is in it, hidden entries included. */
export async function statFolder(folderPath: string): Promise<FolderStats> {
  let files = 0;
  let directories = 0;
  let bytes = 0;
  let mediaFiles = 0;
  let visited = 0;

  /**
   * `insideHidden` is what keeps the thumbnail cache out of the MEDIA count.
   *
   * Every file is counted and its bytes totalled, hidden or not — all of it is
   * about to be deleted and the user is being told how much. But
   * `.photo-culler-thumbs` is full of `.webp` files, and `isMediaFile` says yes
   * to those, so without this the dialog would claim the app displays four
   * photos where it displays two. The scanner skips hidden entries; this
   * applies the same rule to the same question.
   */
  const walk = async (dir: string, insideHidden: boolean): Promise<void> => {
    if (visited >= MAX_DIRECTORIES) return;
    visited += 1;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const hidden = insideHidden || entry.name.startsWith('.');
      if (entry.isDirectory()) {
        directories += 1;
        await walk(full, hidden);
        continue;
      }
      if (!entry.isFile()) continue;
      files += 1;
      if (!hidden && isMediaFile(entry.name)) mediaFiles += 1;
      try {
        bytes += (await stat(full)).size;
      } catch {
        // Vanished between readdir and stat. It is not there to be deleted.
      }
    }
  };

  try {
    await walk(folderPath, false);
  } catch (err) {
    return {
      files,
      directories,
      bytes,
      mediaFiles,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  return { files, directories, bytes, mediaFiles };
}

/**
 * Delete a folder and everything below it, permanently.
 *
 * Three refusals before anything happens, and none of them is redundant with
 * the renderer's own gating — the renderer decides what to OFFER, this decides
 * what to DO, and the two are allowed to be told apart:
 *
 * - outside the opened tree: a path that does not sit under `root` is either a
 *   bug or a stale menu, and neither is a reason to delete a stranger's folder;
 * - the root itself: the app would be left pointing at nothing, and "close the
 *   folder" is not what the user asked for;
 * - not a directory: a file has its own delete path, with its own confirmation.
 */
export async function deleteFolder(folderPath: string, root: string): Promise<FolderOpResult> {
  if (!path.isAbsolute(folderPath) || !path.isAbsolute(root)) {
    return { ok: false, error: 'Nur absolute Pfade.' };
  }
  if (!isAtOrBelow(folderPath, root)) {
    return { ok: false, error: 'Der Ordner liegt außerhalb des geöffneten Baums.' };
  }
  if (isAtOrBelow(root, folderPath)) {
    return { ok: false, error: 'Der geöffnete Ordner selbst kann nicht gelöscht werden.' };
  }

  try {
    const info = await stat(folderPath);
    if (!info.isDirectory()) return { ok: false, error: 'Das ist kein Ordner.' };
  } catch {
    return { ok: false, error: 'Der Ordner existiert nicht mehr.' };
  }

  try {
    await rm(folderPath, { recursive: true, force: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
