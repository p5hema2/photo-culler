import { describe, it, expect } from 'vitest';
import { centeredScrollOffset, isHoverStale, setScrollTop } from '../lib/focus-scroll';

/** A 100px-tall thumbnail in a 600px-tall strip holding 30 of them. */
const STRIP = { itemSize: 100, viewportSize: 600, contentSize: 3000 };

describe('centeredScrollOffset', () => {
  it('puts an item in the middle of the viewport', () => {
    // Item 10 spans 1000-1100; centring it leaves 250px of strip above.
    expect(centeredScrollOffset({ ...STRIP, itemStart: 1000 })).toBe(750);
  });

  it('clamps at the start rather than scrolling into empty space', () => {
    // The first few items cannot be centred — the strip has nothing above them.
    expect(centeredScrollOffset({ ...STRIP, itemStart: 0 })).toBe(0);
    expect(centeredScrollOffset({ ...STRIP, itemStart: 100 })).toBe(0);
    expect(centeredScrollOffset({ ...STRIP, itemStart: 250 })).toBe(0);
  });

  it('clamps at the end', () => {
    // Last item: 2400 is the furthest the content can scroll.
    expect(centeredScrollOffset({ ...STRIP, itemStart: 2900 })).toBe(2400);
    expect(centeredScrollOffset({ ...STRIP, itemStart: 2650 })).toBe(2400);
  });

  it('centres the first item that has room for it', () => {
    // 250 above + 100 item + 250 below = the 600px viewport exactly.
    expect(centeredScrollOffset({ ...STRIP, itemStart: 251 })).toBe(1);
  });

  it('stays at zero when the content fits the viewport', () => {
    expect(
      centeredScrollOffset({ itemSize: 100, viewportSize: 600, contentSize: 400, itemStart: 300 }),
    ).toBe(0);
  });

  it('returns whole pixels', () => {
    expect(centeredScrollOffset({ ...STRIP, itemSize: 101, itemStart: 1000 })).toBe(751);
  });
});

/**
 * Chromium re-hovers whatever a scroll slides under a resting cursor, without a
 * mousemove. Select-on-hover would read that as a selection.
 */
describe('hover after a programmatic scroll', () => {
  const movePointer = (x: number, y: number): void => {
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y }));
  };

  it('marks hover stale when the scroll actually moves the view', () => {
    movePointer(10, 10);
    expect(isHoverStale()).toBe(false);

    setScrollTop(document.createElement('div'), 250);
    expect(isHoverStale()).toBe(true);
  });

  it('clears once the pointer really moves', () => {
    setScrollTop(document.createElement('div'), 250);
    expect(isHoverStale()).toBe(true);

    movePointer(40, 80);
    expect(isHoverStale()).toBe(false);
  });

  it('ignores a repeat mousemove at coordinates the pointer never left', () => {
    movePointer(40, 80);
    setScrollTop(document.createElement('div'), 250);

    // Blink dispatches one of these itself after a layout change.
    movePointer(40, 80);
    expect(isHoverStale()).toBe(true);
  });

  it('leaves hover alone when the container is already at the offset', () => {
    movePointer(1, 1);
    setScrollTop(document.createElement('div'), 0);
    expect(isHoverStale()).toBe(false);
  });
});
