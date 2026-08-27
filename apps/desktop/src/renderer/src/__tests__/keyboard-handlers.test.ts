import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

/**
 * The signatures are spelled out because a bare `vi.fn()` types as an
 * unnarrowed `Mock<Procedure | Constructable>`, which no hook prop accepts.
 */
function makeHandlers() {
  return {
    onFocusChange: vi.fn<(path: string | null) => void>(),
    onRate: vi.fn<(imagePath: string, rating: number) => void>(),
    onDeleteFocused: vi.fn<() => void>(),
    onRotate: vi.fn<(imagePath: string, direction: 'cw' | 'ccw') => void>(),
  };
}

let handlers: ReturnType<typeof makeHandlers>;

let unmountHook: (() => void) | null = null;

afterEach(() => {
  unmountHook?.();
  unmountHook = null;
});

function mount(
  options: {
    groups?: PhotoGroup[];
    focusedImageId?: string | null;
    modalOpen?: boolean;
  } = {},
) {
  handlers = makeHandlers();

  const rendered = renderHook(() =>
    useKeyboardNav({
      groups: options.groups ?? [GROUP],
      focusedImageId: options.focusedImageId === undefined ? IMAGE.path : options.focusedImageId,
      onFocusChange: handlers.onFocusChange,
      onRate: handlers.onRate,
      containerRef: { current: document.body },
      onDeleteFocused: handlers.onDeleteFocused,
      sortedFlatImages: (options.groups ?? [GROUP]).flatMap((g) => g.images),
      thumbnailSize: 'medium',
      onRotate: handlers.onRotate,
      viewLayout: 'default',
      modalOpen: options.modalOpen ?? false,
    }),
  );
  unmountHook = rendered.unmount;
}

/** The hook listens on the container element, so dispatch there. */
function press(key: string, init: KeyboardEventInit = {}): void {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
}

describe('rating keys', () => {
  beforeEach(() => mount());

  it.each([0, 1, 2, 3, 4, 5])('key %s reports the absolute path, not the filename', (rating) => {
    press(String(rating));

    expect(handlers.onRate).toHaveBeenCalledWith(IMAGE.path, rating);
    expect(handlers.onRate).not.toHaveBeenCalledWith(IMAGE.name, rating);
  });

  it('leaves a digit outside 0-5 to whatever else wants it', () => {
    press('6');
    expect(handlers.onRate).not.toHaveBeenCalled();
  });
});

describe('a dialog in front of the grid', () => {
  beforeEach(() => mount({ modalOpen: true }));

  /**
   * The hook listens on the document, so every key still reaches it while a
   * modal is up — and one of them deletes a photo the user cannot even see.
   */
  it('ignores Delete', () => {
    press('Delete');
    expect(handlers.onDeleteFocused).not.toHaveBeenCalled();
  });

  it('ignores rating and navigation keys', () => {
    press('3');
    press('ArrowRight');
    expect(handlers.onRate).not.toHaveBeenCalled();
    expect(handlers.onFocusChange).not.toHaveBeenCalled();
  });
});

describe('Delete', () => {
  beforeEach(() => mount());

  it('asks the caller to delete the focused image', () => {
    press('Delete');
    expect(handlers.onDeleteFocused).toHaveBeenCalledTimes(1);
  });

  it('Backspace does the same', () => {
    press('Backspace');
    expect(handlers.onDeleteFocused).toHaveBeenCalledTimes(1);
  });
});

describe('rotation keys', () => {
  beforeEach(() => mount());

  it('Alt+ArrowRight rotates clockwise by absolute path', () => {
    press('ArrowRight', { altKey: true });
    expect(handlers.onRotate).toHaveBeenCalledWith(IMAGE.path, 'cw');
  });

  it('Alt+ArrowLeft rotates counter-clockwise by absolute path', () => {
    press('ArrowLeft', { altKey: true });
    expect(handlers.onRotate).toHaveBeenCalledWith(IMAGE.path, 'ccw');
  });
});

describe('focus that is no longer on screen', () => {
  const VISIBLE = makeImage('/photos/eventB', 'VISIBLE.JPG');
  const VISIBLE_GROUP: PhotoGroup = { id: 'g1', images: [VISIBLE], startTime: 2, endTime: 2 };

  /** Dispatch and report whether the handler swallowed the key. */
  function pressCancelable(key: string): boolean {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    return event.defaultPrevented;
  }

  beforeEach(() => {
    // The focused image belongs to a folder the user has collapsed, so it is
    // absent from the visible groups.
    mount({ groups: [VISIBLE_GROUP], focusedImageId: '/photos/collapsed/HIDDEN.JPG' });
  });

  it('recovers onto the first visible image instead of doing nothing', () => {
    pressCancelable('ArrowRight');
    expect(handlers.onFocusChange).toHaveBeenCalledWith(VISIBLE.path);
  });

  it('swallows the key, so the browser does not scroll the gallery instead', () => {
    // This is the actual reported symptom: navigation appeared dead and the
    // gallery scrolled, because the handler returned without preventDefault.
    expect(pressCancelable('ArrowRight')).toBe(true);
    expect(pressCancelable('ArrowDown')).toBe(true);
    expect(pressCancelable('Home')).toBe(true);
    expect(pressCancelable(' ')).toBe(true);
  });

  it('does not rate an image it cannot find', () => {
    expect(pressCancelable('1')).toBe(false);
    expect(handlers.onRate).not.toHaveBeenCalled();
  });
});

describe('where the handler listens', () => {
  beforeEach(() => mount());

  it('responds even when focus is outside the app container', () => {
    // The original report: focus lands on document.body — a click on empty
    // chrome, a closed dialog — and a container-scoped listener never sees the
    // key, so the browser scrolls the grid instead of navigating it.
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowUp',
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves typing in a text field alone', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);

    for (const key of ['ArrowUp', 'ArrowDown', '1', ' ']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      input.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }

    expect(handlers.onFocusChange).not.toHaveBeenCalled();
    expect(handlers.onRate).not.toHaveBeenCalled();
    input.remove();
  });

  it('leaves typing in a textarea alone', () => {
    const area = document.createElement('textarea');
    document.body.appendChild(area);

    const event = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true });
    area.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    area.remove();
  });
});
