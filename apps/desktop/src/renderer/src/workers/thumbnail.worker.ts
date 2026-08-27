/**
 * Thumbnail generation Web Worker.
 * Receives image data as ArrayBuffer, generates aspect-preserving WebP
 * thumbnails using createImageBitmap + OffscreenCanvas, and transfers back as ImageBitmap.
 *
 * The main thread handles fetching (which requires app:// protocol access)
 * and passes raw image data to the worker for heavy processing.
 */
import { fitWithin, THUMB_MIME, THUMB_QUALITY } from '../lib/thumbnail-geometry';

export interface ThumbnailRequest {
  id: string;
  buffer: ArrayBuffer;
  mimeType: string;
  /**
   * Longest edge in px. The output is `size` on its long side and
   * proportionally smaller on the short side — it is NOT a square edge.
   */
  size: number;
  /** Generation counter, echoed back so the host can drop stale responses. */
  epoch?: number;
}

export interface ThumbnailResponse {
  id: string;
  bitmap?: ImageBitmap;
  /** Encoded thumbnail for the disk cache — WebP, see THUMB_MIME. */
  thumbBuffer?: ArrayBuffer;
  error?: boolean;
  epoch?: number;
}

self.onmessage = async (event: MessageEvent<ThumbnailRequest>) => {
  const { id, buffer, mimeType, size, epoch } = event.data;

  try {
    const blob = new Blob([buffer], { type: mimeType });
    // Explicit, though it is Chromium's default: this decides whether a
    // portrait-EXIF file yields 256x171 or 171x256, and the full-size <img> in
    // DetailImageViewer always honours EXIF orientation. If these two disagree,
    // the thumbnail and the preview disagree about which way is up.
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });

    // object-fit: contain — preserve the aspect ratio instead of centre-cropping
    // to a square, which misrepresented the framing of every non-square photo.
    const { width: tw, height: th } = fitWithin(bitmap.width, bitmap.height, size);

    const canvas = new OffscreenCanvas(tw, th);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      throw new Error('Could not get 2d context');
    }

    // A single 6000 -> 512 downscale aliases badly at the default quality, and
    // the artefact is more visible on a letterboxed thumb than on a cropped one.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, tw, th);
    bitmap.close();

    const thumbnailBlob = await canvas.convertToBlob({
      type: THUMB_MIME,
      quality: THUMB_QUALITY,
    });
    const thumbBuffer = await thumbnailBlob.arrayBuffer();
    const thumbnailBitmap = await createImageBitmap(thumbnailBlob);

    self.postMessage({ id, bitmap: thumbnailBitmap, thumbBuffer, epoch } as ThumbnailResponse, {
      transfer: [thumbnailBitmap, thumbBuffer],
    });
  } catch {
    self.postMessage({ id, error: true, epoch } as ThumbnailResponse);
  }
};
