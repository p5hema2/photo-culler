/**
 * EXIF extraction Web Worker.
 * Receives image data as ArrayBuffers, extracts DateTimeOriginal using exifr,
 * and streams results back one at a time.
 *
 * The main thread handles file reading via IPC and passes raw buffers here.
 */
import * as exifr from 'exifr';

export interface ExifFileData {
  path: string;
  buffer: ArrayBuffer;
}

export interface ExifRequest {
  file: ExifFileData;
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
  const { file } = event.data;

  try {
    const parsed = await exifr.parse(file.buffer, {
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
};
