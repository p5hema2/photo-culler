/**
 * One representative frame of a video, in the thumbnail cache's own format.
 *
 * ## Why this is on the main thread and not in the thumbnail worker
 *
 * A Web Worker has no `HTMLVideoElement` and no `document`, and there is no
 * decoder in a worker that will open an MP4 container. Every other thumbnail in
 * this app is produced in `thumbnail.worker.ts`; this one cannot be, and that
 * asymmetry is the reason for the concurrency limit below — nothing else here
 * competes with the UI for the main thread.
 *
 * ## Why it streams over app:// instead of reading the file
 *
 * `READ_FILE` pulls the whole file through IPC as an ArrayBuffer, which is the
 * right shape for a 6 MB JPEG and catastrophic for a 2 GB clip. The `app://`
 * handler answers Range requests specifically so `<video>` can seek without
 * buffering the file, so a poster frame costs one seek and a few decoded
 * frames. If seeking ever stops working, that handler is the first place to
 * look — without `Accept-Ranges` Chromium never asks for a range at all.
 *
 * ## What it cannot do
 *
 * Only containers Chromium can demux: MP4, M4V, MOV and WebM. AVI, MKV, MTS,
 * M2TS and 3GP are listed, renamed and deleted like anything else, but they get
 * a placeholder tile rather than a frame. Producing one for them needs ffmpeg,
 * and every off-the-shelf ffmpeg npm package turned out to be either GPLv3 with
 * unobtainable corresponding source or outright `--enable-nonfree`. See
 * CLAUDE.md.
 */

import { fitWithin, THUMB_MIME, THUMB_QUALITY } from './thumbnail-geometry';

export interface VideoPoster {
  /** The thumbnail itself, already scaled — same contract as the worker's. */
  bitmap: ImageBitmap;
  /** WebP bytes for the disk cache, byte-identical in format to an image's. */
  thumbBuffer: ArrayBuffer;
  /** Clip length in seconds, or null when the container did not say. */
  duration: number | null;
}

/**
 * Where in the clip to grab the frame.
 *
 * Not frame 0: a great many clips open on black, on a fade, or mid
 * autoexposure. One second is past all three for most cameras and is still
 * inside the first keyframe interval, so the seek is nearly free.
 */
const SEEK_SECONDS = 1;

/**
 * How long to wait for one poster frame before giving up.
 *
 * Generous, because the first frame of a clip on a spinning disk or a network
 * share involves a seek and a probe. A hang here is invisible — the cell just
 * stays in its loading state — so the timeout is what turns it into a
 * placeholder the user can at least understand.
 */
const TIMEOUT_MS = 20_000;

/**
 * Video decodes running at once.
 *
 * Two, and low on purpose. Each one holds a decoder, a demuxer and a frame
 * buffer, and they run on the MAIN thread beside React — the thumbnail worker
 * pool's `hardwareConcurrency` sizing is for work that is off it. Two is also
 * what keeps a folder of clips from monopolising the disk that the image
 * sweep is reading from.
 */
const MAX_CONCURRENT = 2;

let active = 0;
const waiting: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active += 1;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
  active += 1;
}

function release(): void {
  active -= 1;
  waiting.shift()?.();
}

/** Resolve on `event`, reject on `error` or when the deadline passes. */
function once(video: HTMLVideoElement, event: string, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const done = (): void => {
      video.removeEventListener(event, onEvent);
      video.removeEventListener('error', onError);
      signal.removeEventListener('abort', onAbort);
    };
    const onEvent = (): void => {
      done();
      resolve();
    };
    const onError = (): void => {
      done();
      reject(new Error(`video ${event}: ${video.error?.message ?? 'decode failed'}`));
    };
    const onAbort = (): void => {
      done();
      reject(new Error(`video ${event}: timed out`));
    };
    video.addEventListener(event, onEvent, { once: true });
    video.addEventListener('error', onError, { once: true });
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Decode one frame of `url` and encode it as a thumbnail.
 *
 * `maxEdge` is the thumbnail's longest edge, exactly as the worker uses it, so
 * a cached video poster and a cached photo thumbnail are the same kind of file
 * and the cache needs no second format marker.
 */
export async function extractVideoPoster(url: string, maxEdge: number): Promise<VideoPoster> {
  await acquire();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const video = document.createElement('video');

  try {
    // Muted and inline: some Chromium paths refuse to load media that could
    // autoplay with sound, and nothing here ever plays.
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    video.src = url;

    await once(video, 'loadedmetadata', controller.signal);

    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;

    // Seek short of the end for a clip shorter than SEEK_SECONDS, and not at
    // all when the duration is unknown — an unseekable stream would otherwise
    // wait for a 'seeked' that never fires, until the timeout.
    if (duration !== null) {
      const target = duration > SEEK_SECONDS ? SEEK_SECONDS : duration / 2;
      video.currentTime = target;
      await once(video, 'seeked', controller.signal);
    } else {
      await once(video, 'loadeddata', controller.signal);
    }

    // videoWidth is the DISPLAYED size: Chromium has already applied the
    // container's rotation matrix, which is what makes a portrait phone clip
    // come out portrait. The EXIF-orientation equivalent for stills is handled
    // by `imageOrientation: 'from-image'` in the worker — same problem, two
    // different mechanisms, and both have to be asked for.
    if (!video.videoWidth || !video.videoHeight) {
      throw new Error('video reported no frame size');
    }

    const frame = await createImageBitmap(video);
    const { width, height } = fitWithin(frame.width, frame.height, maxEdge);

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      frame.close();
      throw new Error('Could not get 2d context');
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(frame, 0, 0, width, height);
    frame.close();

    const blob = await canvas.convertToBlob({ type: THUMB_MIME, quality: THUMB_QUALITY });
    const thumbBuffer = await blob.arrayBuffer();
    const bitmap = await createImageBitmap(blob);

    return { bitmap, thumbBuffer, duration };
  } finally {
    clearTimeout(timer);
    // Detach before dropping the reference. Chromium keeps the network request
    // and the decoder alive for an element that still has a src, and a folder
    // of clips would otherwise leave one per file running until GC.
    video.removeAttribute('src');
    video.load();
    release();
  }
}
