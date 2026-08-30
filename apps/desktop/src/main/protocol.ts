import { protocol, net } from 'electron';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { extensionOf, isVideoFile } from '@photo-culler/image-utils/media';

/**
 * Register custom app:// scheme as privileged.
 * MUST be called BEFORE app.whenReady().
 */
export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, stream: true } },
  ]);
}

/**
 * Content types for the media a `<video>` element may be handed.
 *
 * `video/quicktime` is deliberately absent: Chromium can decode what is inside
 * a typical MOV but refuses a source declared with that type, so a MOV must be
 * announced as `video/mp4`. Same table as `videoMimeType` in image-utils, and
 * for the same reason — see the note there.
 */
const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/mp4',
  webm: 'video/webm',
};

function contentTypeOf(filePath: string): string {
  return CONTENT_TYPES[extensionOf(filePath)] ?? 'application/octet-stream';
}

/** `bytes=START-END`, either end optional. Anything else is not a range we serve. */
function parseRange(header: string, size: number): { start: number; end: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;

  const [, rawStart, rawEnd] = m;
  if (!rawStart && !rawEnd) return null;

  // `bytes=-500` means the LAST 500 bytes, not "up to byte 500".
  const start = rawStart ? Number(rawStart) : Math.max(0, size - Number(rawEnd));
  const end = rawStart ? (rawEnd ? Math.min(Number(rawEnd), size - 1) : size - 1) : size - 1;

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start > end || start >= size) return null;
  return { start, end };
}

/**
 * Serve local files to the renderer.
 *
 * ## Why this answers Range requests by hand
 *
 * `net.fetch('file://…')` streams a whole file and says nothing about ranges,
 * which is fine for an image and useless for a video: Chromium's media stack
 * will not seek in a resource it cannot request a slice of, so `currentTime = 1`
 * on a 2 GB clip either does nothing or buffers the entire file into memory
 * first. Both the poster-frame extraction and the loupe's player depend on
 * seeking, so the 206 path below is load-bearing rather than an optimisation.
 *
 * `Accept-Ranges: bytes` on the plain response is the half that makes Chromium
 * ask at all — without it, it never sends a Range header and the 206 branch is
 * dead code.
 *
 * ## Why it is not the whole story
 *
 * Images do NOT come through here. `useFullImage` reads them over `READ_FILE`,
 * which takes the per-path file lock — the one thing standing between a
 * thumbnail read and exiftool's rename-over-the-original on Windows. A video is
 * different: it is never written by this app (no rating, no rotation), so there
 * is nothing to serialise against, and streaming it is the only way to avoid
 * pulling gigabytes through IPC.
 */
export function registerProtocolHandlers(): void {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    // URL format: app://file/path/to/image.jpg — see `appUrlFor` in the
    // renderer, which is the other end of this format.
    // pathname gives /path/to/image.jpg with each segment percent-encoded.
    let filePath = decodeURIComponent(url.pathname);
    // A URL path always starts with a slash, so a Windows path arrives as
    // `/C:/photos/a.jpg`. Left in place, `path.normalize` turns that into
    // `\C:\photos\a.jpg`, which resolves to nothing.
    if (/^\/[A-Za-z]:[\\/]/.test(filePath)) filePath = filePath.slice(1);
    const normalized = path.normalize(filePath);

    const rangeHeader = request.headers.get('range');
    if (!rangeHeader || !isVideoFile(normalized)) {
      const response = await net.fetch(pathToFileURL(normalized).toString());
      // Announce range support so the media stack asks next time. Only for
      // video: an image is fetched once, whole, and the extra header would
      // just invite a pointless second request.
      if (isVideoFile(normalized)) {
        const headers = new Headers(response.headers);
        headers.set('Accept-Ranges', 'bytes');
        headers.set('Content-Type', contentTypeOf(normalized));
        return new Response(response.body, { status: response.status, headers });
      }
      return response;
    }

    let size: number;
    try {
      size = (await stat(normalized)).size;
    } catch {
      return new Response(null, { status: 404 });
    }

    const range = parseRange(rangeHeader, size);
    if (!range) {
      // The spec's answer to an unsatisfiable range, and the one that makes
      // Chromium retry without one rather than give up on the file.
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${size}` },
      });
    }

    const stream = createReadStream(normalized, { start: range.start, end: range.end });
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: {
        'Content-Type': contentTypeOf(normalized),
        'Content-Length': String(range.end - range.start + 1),
        'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
        'Accept-Ranges': 'bytes',
      },
    });
  });
}
