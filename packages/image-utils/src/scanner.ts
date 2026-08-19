import { readdir, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import type { ImageFileInfo } from '@photo-culler/types';

const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.tiff', '.tif', '.webp']);

// Pre-1.2.0 results filename. The current name is a dotfile and so is already
// covered by the hidden-file skip below; this entry only shields folders that
// have not been migrated yet.
const EXCLUDED_FILES = new Set(['photo-culler-results.json']);

/** Subfolder that Execute moves picks into. Folded into its parent, not listed. */
const PICKS_DIR = 'picks';

/** Safety net against opening a whole drive by accident. */
const MAX_DIRECTORIES = 2000;

/**
 * Recursively scan a folder tree for supported image files.
 *
 * Every directory below `folderPath` is visited, so a user can open the parent
 * of several shoots instead of culling one folder at a time. Two rules shape
 * the result:
 *
 *  - Hidden directories are skipped, which also excludes the thumbnail cache.
 *  - A `picks/` directory is scanned, but its images are attributed to the
 *    PARENT folder. Execute moves keeps into picks/, and they should stay
 *    visible where they were culled rather than jumping to a new section.
 */
export async function scanFolder(folderPath: string): Promise<ImageFileInfo[]> {
  const images: ImageFileInfo[] = [];
  let directoriesVisited = 0;

  const walk = async (dirPath: string, attributeTo: string): Promise<void> => {
    if (directoriesVisited >= MAX_DIRECTORIES) return;
    directoriesVisited++;

    let entries;
    try {
      entries = await readdir(dirPath, { withFileTypes: true });
    } catch (err) {
      // A folder we cannot read is not a reason to abandon the whole tree;
      // only a failure on the root itself should surface to the caller.
      if (dirPath === folderPath) throw err;
      return;
    }

    const subdirectories: Array<{ path: string; attributeTo: string }> = [];

    for (const entry of entries) {
      // Skip hidden entries — covers .photo-culler-thumbs and the results file
      if (entry.name.startsWith('.')) continue;

      if (entry.isDirectory()) {
        subdirectories.push({
          path: join(dirPath, entry.name),
          // picks/ folds into whatever folder it belongs to
          attributeTo: entry.name === PICKS_DIR ? attributeTo : join(dirPath, entry.name),
        });
        continue;
      }

      if (!entry.isFile()) continue;
      if (EXCLUDED_FILES.has(entry.name)) continue;

      const ext = extname(entry.name).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(ext)) continue;

      const filePath = join(dirPath, entry.name);
      let stats;
      try {
        stats = await stat(filePath);
      } catch {
        continue; // vanished between readdir and stat
      }

      images.push({
        path: filePath,
        name: entry.name,
        folder: attributeTo,
        extension: ext.slice(1),
        size: stats.size,
        lastModified: stats.mtimeMs,
      });
    }

    for (const sub of subdirectories) {
      await walk(sub.path, sub.attributeTo);
    }
  };

  await walk(folderPath, folderPath);
  return images;
}
