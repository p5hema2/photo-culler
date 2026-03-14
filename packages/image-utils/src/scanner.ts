import { readdir, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import type { ImageFileInfo } from '@photo-culler/types';

const SUPPORTED_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.tiff',
  '.tif',
  '.webp',
]);

const EXCLUDED_FILES = new Set(['photo-culler-results.json']);

/**
 * Scan a folder for supported image files.
 * Includes images from the main folder and a `picks/` subfolder if it exists.
 */
export async function scanFolder(folderPath: string): Promise<ImageFileInfo[]> {
  const images: ImageFileInfo[] = [];

  // Scan main folder
  const mainImages = await scanDirectory(folderPath);
  images.push(...mainImages);

  // Scan picks/ subfolder (ignore if it doesn't exist)
  try {
    const picksPath = join(folderPath, 'picks');
    const picksImages = await scanDirectory(picksPath);
    images.push(...picksImages);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }

  return images;
}

async function scanDirectory(dirPath: string): Promise<ImageFileInfo[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const images: ImageFileInfo[] = [];

  for (const entry of entries) {
    // Skip non-files
    if (!entry.isFile()) continue;

    // Skip hidden files
    if (entry.name.startsWith('.')) continue;

    // Skip excluded files
    if (EXCLUDED_FILES.has(entry.name)) continue;

    // Check extension (case-insensitive)
    const ext = extname(entry.name).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) continue;

    const filePath = join(dirPath, entry.name);
    const stats = await stat(filePath);

    images.push({
      path: filePath,
      name: entry.name,
      extension: ext.slice(1), // remove leading dot
      size: stats.size,
      lastModified: stats.mtimeMs,
    });
  }

  return images;
}
