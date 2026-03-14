/**
 * Thumbnail generation Web Worker.
 * Receives image URLs, generates 256x256 center-cropped JPEG thumbnails
 * using createImageBitmap + OffscreenCanvas, and transfers back as ImageBitmap.
 */

export interface ThumbnailRequest {
  id: string;
  url: string;
  size: number;
}

export interface ThumbnailResponse {
  id: string;
  bitmap?: ImageBitmap;
  error?: boolean;
}

self.onmessage = async (event: MessageEvent<ThumbnailRequest>) => {
  const { id, url, size } = event.data;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Fetch failed: ${response.status}`);
    }

    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);

    // Center-crop with object-fit:cover math
    const scale = Math.max(size / bitmap.width, size / bitmap.height);
    const sw = size / scale;
    const sh = size / scale;
    const sx = (bitmap.width - sw) / 2;
    const sy = (bitmap.height - sh) / 2;

    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      throw new Error('Could not get 2d context');
    }

    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, size, size);
    bitmap.close();

    const thumbnailBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
    const thumbnailBitmap = await createImageBitmap(thumbnailBlob);

    self.postMessage({ id, bitmap: thumbnailBitmap } as ThumbnailResponse, {
      transfer: [thumbnailBitmap],
    });
  } catch {
    self.postMessage({ id, error: true } as ThumbnailResponse);
  }
};
