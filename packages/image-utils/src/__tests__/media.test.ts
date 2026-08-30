import { describe, it, expect } from 'vitest';
import {
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  PLAYABLE_VIDEO_EXTENSIONS,
  extensionOf,
  mediaKindOf,
  isMediaFile,
  isVideoFile,
  isPlayableVideo,
  videoMimeType,
} from '../media';

describe('extensionOf', () => {
  it('takes the last dot and lower-cases', () => {
    expect(extensionOf('P1000001.JPG')).toBe('jpg');
    expect(extensionOf('a.b.c.MOV')).toBe('mov');
  });

  it('accepts a bare extension, with or without a dot', () => {
    expect(extensionOf('jpg')).toBe('jpg');
    expect(extensionOf('.JPG')).toBe('jpg');
  });

  it('treats a name with no dot as its own extension', () => {
    // Not a media file either way, so the only requirement is that it does not
    // throw and does not accidentally match something.
    expect(isMediaFile('README')).toBe(false);
  });
});

describe('mediaKindOf', () => {
  it.each(['jpg', 'jpeg', 'png', 'tiff', 'tif', 'webp'])('calls %s an image', (ext) => {
    expect(mediaKindOf(`x.${ext}`)).toBe('image');
  });

  it.each(['mp4', 'mov', 'm4v', 'avi', 'mkv', 'mts', 'm2ts', '3gp', 'webm'])(
    'calls %s a video',
    (ext) => {
      expect(mediaKindOf(`x.${ext}`)).toBe('video');
    },
  );

  it.each(['pdf', 'txt', 'json', 'xmp', 'arw', 'rw2', 'cr3', 'aae', 'thm', 'lrv'])(
    'calls %s neither',
    (ext) => {
      expect(mediaKindOf(`x.${ext}`)).toBeNull();
    },
  );

  it('ignores case', () => {
    expect(mediaKindOf('C0001.MP4')).toBe('video');
    expect(mediaKindOf('P1.JPEG')).toBe('image');
  });
});

describe('the two sets', () => {
  it('do not overlap', () => {
    for (const ext of VIDEO_EXTENSIONS) {
      expect(IMAGE_EXTENSIONS.has(ext)).toBe(false);
    }
  });

  it('carry the video half of rename-by-date\u2019s @EXT list, so both tools agree', () => {
    // H:\rename-by-date\lib\rename-by-date.pl:14 — mp4 mov m4v avi mkv mts
    // m2ts 3gp. webm is this app's one addition and is documented as such.
    for (const ext of ['mp4', 'mov', 'm4v', 'avi', 'mkv', 'mts', 'm2ts', '3gp']) {
      expect(VIDEO_EXTENSIONS.has(ext)).toBe(true);
    }
  });

  it('hold every playable container inside the video set', () => {
    for (const ext of PLAYABLE_VIDEO_EXTENSIONS) {
      expect(VIDEO_EXTENSIONS.has(ext)).toBe(true);
    }
  });
});

describe('isPlayableVideo', () => {
  it.each(['mp4', 'm4v', 'mov', 'webm'])('says Chromium can play %s', (ext) => {
    expect(isPlayableVideo(`x.${ext}`)).toBe(true);
  });

  it.each(['avi', 'mkv', 'mts', 'm2ts', '3gp'])('says Chromium cannot play %s', (ext) => {
    // Listed and renamed, but a <video> pointed at one shows a silent black
    // frame rather than erroring — the detail view shows the poster instead.
    expect(isVideoFile(`x.${ext}`)).toBe(true);
    expect(isPlayableVideo(`x.${ext}`)).toBe(false);
  });

  it('is false for an image', () => {
    expect(isPlayableVideo('x.jpg')).toBe(false);
  });
});

describe('videoMimeType', () => {
  it('labels a MOV as video/mp4, not video/quicktime', () => {
    // Chromium refuses a source typed video/quicktime outright, even when it
    // can decode what is inside.
    expect(videoMimeType('clip.mov')).toBe('video/mp4');
  });

  it('maps the rest of the playable set', () => {
    expect(videoMimeType('a.mp4')).toBe('video/mp4');
    expect(videoMimeType('a.m4v')).toBe('video/mp4');
    expect(videoMimeType('a.webm')).toBe('video/webm');
  });

  it('returns null for a container Chromium cannot play', () => {
    expect(videoMimeType('a.mkv')).toBeNull();
    expect(videoMimeType('a.mts')).toBeNull();
  });

  it('returns null for an image', () => {
    expect(videoMimeType('a.jpg')).toBeNull();
  });
});
