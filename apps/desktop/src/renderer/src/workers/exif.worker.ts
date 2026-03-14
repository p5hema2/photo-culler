/**
 * EXIF extraction Web Worker.
 * Receives a batch of files, extracts DateTimeOriginal using exifr,
 * and streams results back one at a time.
 */
import * as exifr from 'exifr';

export interface ExifRequest {
  files: Array<{ path: string; url: string }>;
}

export interface ExifResult {
  path: string;
  dateTaken: number | null;
  width: number | null;
  height: number | null;
}

export interface ExifDone {
  done: true;
}

export type ExifResponse = ExifResult | ExifDone;

self.onmessage = async (event: MessageEvent<ExifRequest>) => {
  const { files } = event.data;

  for (const file of files) {
    try {
      const response = await fetch(file.url);
      if (!response.ok) {
        throw new Error(`Fetch failed: ${response.status}`);
      }

      const buffer = await response.arrayBuffer();
      const parsed = await exifr.parse(buffer, {
        pick: ['DateTimeOriginal', 'ImageWidth', 'ImageHeight'],
        translateValues: false,
      });

      let dateTaken: number | null = null;
      if (parsed?.DateTimeOriginal) {
        const dt = parsed.DateTimeOriginal;
        dateTaken = dt instanceof Date ? dt.getTime() : new Date(dt).getTime();
        if (isNaN(dateTaken)) dateTaken = null;
      }

      const width: number | null = parsed?.ImageWidth ?? null;
      const height: number | null = parsed?.ImageHeight ?? null;

      self.postMessage({ path: file.path, dateTaken, width, height } as ExifResult);
    } catch {
      self.postMessage({
        path: file.path,
        dateTaken: null,
        width: null,
        height: null,
      } as ExifResult);
    }
  }

  self.postMessage({ done: true } as ExifDone);
};
