/**
 * What counts as media, and which half of it a file belongs to.
 *
 * Deliberately NOT a field on `ImageFileInfo`. The extension is already carried
 * there, already lower-cased and already dot-free, so a `kind` field would be a
 * second copy of the same fact that could drift from it — and every one of the
 * app's maps is keyed by path, so there is no cheap place to keep such a field
 * honest. Ask this module instead.
 *
 * Pure and DOM-free; imported by the scanner in the main process and by the
 * renderer through its deep alias.
 */

/**
 * Stills the app can decode, score and rate.
 *
 * Unchanged from before video support: the thumbnail worker's
 * `createImageBitmap` and the browser's `<img>` handle all of these, and the
 * scoring worker's pixel loops assume a single frame.
 */
export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  'jpg',
  'jpeg',
  'png',
  'tiff',
  'tif',
  'webp',
]);

/**
 * Video containers the app lists, thumbnails and renames.
 *
 * This is `@EXT`'s video half from H:\rename-by-date\lib\rename-by-date.pl:14,
 * so the two tools agree on what a video is and a folder cannot come out
 * half-renamed. `webm` is the one addition — Chromium plays it natively and it
 * would be odd to show a file the app refuses to rename.
 *
 * Being in this set says nothing about whether Chromium can PLAY the file; see
 * PLAYABLE_VIDEO_EXTENSIONS. The poster frame comes from ffmpeg either way.
 */
export const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set([
  'mp4',
  'mov',
  'm4v',
  'avi',
  'mkv',
  'mts',
  'm2ts',
  '3gp',
  'webm',
]);

/**
 * The subset a `<video>` element can actually play in Electron.
 *
 * Electron's official builds ship Chromium's proprietary codecs, so H.264/AAC
 * in MP4, M4V and MOV work, as does WebM. The rest — AVI, MKV, MTS, M2TS, 3GP —
 * are containers Chromium never learned, and pointing a `<video>` at one gives
 * a silent black frame rather than an error. The detail view checks this and
 * shows the poster frame with a note instead of a player that does nothing.
 *
 * MTS/M2TS deserve their own mention: the codec inside is usually H.264, which
 * Chromium can decode. It is the MPEG-2 TRANSPORT STREAM wrapper it refuses.
 */
export const PLAYABLE_VIDEO_EXTENSIONS: ReadonlySet<string> = new Set([
  'mp4',
  'm4v',
  'mov',
  'webm',
]);

export type MediaKind = 'image' | 'video';

/** Normalise anything filename-shaped to a bare lower-case extension. */
export function extensionOf(nameOrExtension: string): string {
  const dot = nameOrExtension.lastIndexOf('.');
  const ext = dot === -1 ? nameOrExtension : nameOrExtension.slice(dot + 1);
  return ext.toLowerCase();
}

/** Which half of the media set a file belongs to, or null if it is neither. */
export function mediaKindOf(nameOrExtension: string): MediaKind | null {
  const ext = extensionOf(nameOrExtension);
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  return null;
}

/** True for anything the scanner should list. */
export function isMediaFile(nameOrExtension: string): boolean {
  return mediaKindOf(nameOrExtension) !== null;
}

/**
 * True for a video.
 *
 * The single question the renderer asks most: a video gets a poster frame
 * rather than a decode, no quality score, no rotation and no star rating.
 */
export function isVideoFile(nameOrExtension: string): boolean {
  return VIDEO_EXTENSIONS.has(extensionOf(nameOrExtension));
}

/** True for a video a `<video>` element can play here. */
export function isPlayableVideo(nameOrExtension: string): boolean {
  return PLAYABLE_VIDEO_EXTENSIONS.has(extensionOf(nameOrExtension));
}

/**
 * MIME type for a `<video>` source, or null when Chromium cannot play it.
 *
 * `video/quicktime` is deliberately NOT used for `.mov`: Chromium plays a MOV
 * whose codec it knows, but only when the type says `video/mp4` — the
 * QuickTime type makes it refuse the source outright.
 */
export function videoMimeType(nameOrExtension: string): string | null {
  const ext = extensionOf(nameOrExtension);
  if (ext === 'webm') return 'video/webm';
  if (ext === 'mp4' || ext === 'm4v' || ext === 'mov') return 'video/mp4';
  return null;
}
