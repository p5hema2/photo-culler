/**
 * Thumbnail generation Web Worker.
 * Receives image data as ArrayBuffer, generates 256x256 center-cropped JPEG
 * thumbnails using createImageBitmap + OffscreenCanvas, and transfers back as ImageBitmap.
 *
 * The main thread handles fetching (which requires app:// protocol access)
 * and passes raw image data to the worker for heavy processing.
 */

export interface ThumbnailRequest {
  id: string;
  buffer: ArrayBuffer;
  mimeType: string;
  size: number;
}

export interface ThumbnailResponse {
  id: string;
  bitmap?: ImageBitmap;
  jpegBuffer?: ArrayBuffer;
  error?: boolean;
}

self.onmessage = async (event: MessageEvent<ThumbnailRequest>) => {
  const { id, buffer, mimeType, size } = event.data;

  try {
    const blob = new Blob([buffer], { type: mimeType });
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
    const jpegBuffer = await thumbnailBlob.arrayBuffer();
    const thumbnailBitmap = await createImageBitmap(thumbnailBlob);

    self.postMessage(
      { id, bitmap: thumbnailBitmap, jpegBuffer } as ThumbnailResponse,
      { transfer: [thumbnailBitmap, jpegBuffer] },
    );
  } catch {
    self.postMessage({ id, error: true } as ThumbnailResponse);
  }
};
