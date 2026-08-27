import { describe, it, expect, vi } from 'vitest';
import { centeredScrollOffset, setScrollTop } from '../lib/focus-scroll';

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

describe('setScrollTop', () => {
  it('assigns the offset', () => {
    const container = document.createElement('div');
    setScrollTop(container, 250);
    expect(container.scrollTop).toBe(250);
  });

  it('leaves the container alone when it is already at the offset', () => {
    // jsdom does not lay out, so scrollTop only ever holds what we assigned.
    // The guard is what keeps a redundant re-centre from firing a scroll event.
    const container = document.createElement('div');
    const setter = vi.fn();
    Object.defineProperty(container, 'scrollTop', { get: () => 0, set: setter });

    setScrollTop(container, 0);
    expect(setter).not.toHaveBeenCalled();

    setScrollTop(container, 40);
    expect(setter).toHaveBeenCalledWith(40);
  });
});
