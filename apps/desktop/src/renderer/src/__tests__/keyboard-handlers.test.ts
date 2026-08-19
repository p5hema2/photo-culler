import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ImageFileInfo } from '@photo-culler/types';
import type { PhotoGroup } from '@photo-culler/image-utils/grouping';
import { useKeyboardNav } from '../hooks/useKeyboardNav';

/**
 * These assert WHICH identifier the keyboard handlers hand back.
 *
 * Renderer state is keyed by absolute path, but every one of these callbacks
 * takes a plain `string` — so when the store moved from basename to path keys,
 * TypeScript saw `string` on both sides and stayed silent while the number
 * keys, Space and Alt+Arrow all silently stopped working. The existing
 * keyboard-nav test reimplements the navigation logic locally, so it could not
 * catch a wiring mistake either.
 */

function makeImage(folder: string, name: string): ImageFileInfo {
  return {
    path: `${folder}/${name}`,
    name,
    folder,
    extension: 'jpg',
    size: 100,
    lastModified: 1,
    dateTaken: 1,
  };
}

const IMAGE = makeImage('/photos/eventA', 'IMG_1.JPG');

const GROUP: PhotoGroup = {
  id: 'g0',
  images: [IMAGE],
  startTime: 1,
  endTime: 1,
};

let handlers: {
  onFocusChange: ReturnType<typeof vi.fn>;
  onCycleClassification: ReturnType<typeof vi.fn>;
  onSetClassification: ReturnType<typeof vi.fn>;
  onTrashFocused: ReturnType<typeof vi.fn>;
  onRotate: ReturnType<typeof vi.fn>;
};

function mount() {
  handlers = {
    onFocusChange: vi.fn(),
    onCycleClassification: vi.fn(),
    onSetClassification: vi.fn(),
    onTrashFocused: vi.fn(),
    onRotate: vi.fn(),
  };

  renderHook(() =>
    useKeyboardNav({
      groups: [GROUP],
      focusedImageId: IMAGE.path,
      onFocusChange: handlers.onFocusChange,
      onCycleClassification: handlers.onCycleClassification,
      onSetClassification: handlers.onSetClassification,
      containerRef: { current: document.body },
      onTrashFocused: handlers.onTrashFocused,
      sortedFlatImages: [IMAGE],
      thumbnailSize: 'medium',
      onRotate: handlers.onRotate,
      viewLayout: 'default',
    }),
  );
}

/** The hook listens on the container element, so dispatch there. */
function press(key: string, init: KeyboardEventInit = {}): void {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
}

beforeEach(() => {
  mount();
});

describe('classification keys', () => {
  it.each([
    ['1', 'keep'],
    ['2', 'review'],
    ['3', 'delete'],
    ['0', null],
  ] as const)('key %s reports the absolute path, not the filename', (key, classification) => {
    press(key);

    expect(handlers.onSetClassification).toHaveBeenCalledWith(IMAGE.path, classification);
    expect(handlers.onSetClassification).not.toHaveBeenCalledWith(IMAGE.name, classification);
  });

  it('Space cycles by absolute path', () => {
    press(' ');
    expect(handlers.onCycleClassification).toHaveBeenCalledWith(IMAGE.path);
  });
});

describe('rotation keys', () => {
  it('Alt+ArrowRight rotates clockwise by absolute path', () => {
    press('ArrowRight', { altKey: true });
    expect(handlers.onRotate).toHaveBeenCalledWith(IMAGE.path, 'cw');
  });

  it('Alt+ArrowLeft rotates counter-clockwise by absolute path', () => {
    press('ArrowLeft', { altKey: true });
    expect(handlers.onRotate).toHaveBeenCalledWith(IMAGE.path, 'ccw');
  });
});
