import { describe, it, expect } from 'vitest';
import {
  ORIENTATION_NORMAL,
  ROTATE_DIRECTIONS,
  nextOrientation,
  normalizeOrientation,
  orientationSwapsAxes,
} from '../orientation';

/** Every legal value, so a table change cannot quietly drop one. */
const ALL = [1, 2, 3, 4, 5, 6, 7, 8];

/** 1, 3, 6, 8 are un-mirrored; 2, 4, 5, 7 carry a reflection. */
const MIRRORED = [2, 4, 5, 7];

describe('nextOrientation', () => {
  it('steps clockwise through both cycles', () => {
    const expected: Record<number, number> = { 1: 6, 6: 3, 3: 8, 8: 1, 2: 7, 7: 4, 4: 5, 5: 2 };
    for (const from of ALL) {
      expect(nextOrientation(from, 'cw')).toBe(expected[from]);
    }
  });

  it('steps counter-clockwise through both cycles read backwards', () => {
    const expected: Record<number, number> = { 6: 1, 3: 6, 8: 3, 1: 8, 7: 2, 4: 7, 5: 4, 2: 5 };
    for (const from of ALL) {
      expect(nextOrientation(from, 'ccw')).toBe(expected[from]);
    }
  });

  it('returns to the start after four turns, either way', () => {
    for (const direction of ROTATE_DIRECTIONS) {
      for (const from of ALL) {
        let value = from;
        for (let i = 0; i < 4; i++) value = nextOrientation(value, direction);
        expect(value).toBe(from);
      }
    }
  });

  it('is its own inverse across the two directions', () => {
    for (const from of ALL) {
      expect(nextOrientation(nextOrientation(from, 'cw'), 'ccw')).toBe(from);
      expect(nextOrientation(nextOrientation(from, 'ccw'), 'cw')).toBe(from);
    }
  });

  it('keeps a mirrored value mirrored', () => {
    // The whole reason the second cycle exists. A photo deliberately flipped in
    // another tool must not come back un-flipped from a rotation — that is a
    // silent edit the user never asked for and cannot see the cause of.
    for (const from of MIRRORED) {
      for (const direction of ROTATE_DIRECTIONS) {
        expect(MIRRORED).toContain(nextOrientation(from, direction));
      }
    }
  });

  it('keeps an un-mirrored value un-mirrored', () => {
    for (const from of ALL.filter((v) => !MIRRORED.includes(v))) {
      for (const direction of ROTATE_DIRECTIONS) {
        expect(MIRRORED).not.toContain(nextOrientation(from, direction));
      }
    }
  });

  it('treats anything outside 1-8 as normal', () => {
    // A file with no orientation tag at all is the common case here, and it
    // must rotate to 6 rather than refusing.
    for (const junk of [undefined, null, 0, 9, -1, 2.5, NaN, Infinity, '', 'six', {}, []]) {
      expect(nextOrientation(junk, 'cw')).toBe(nextOrientation(ORIENTATION_NORMAL, 'cw'));
      expect(nextOrientation(junk, 'ccw')).toBe(nextOrientation(ORIENTATION_NORMAL, 'ccw'));
    }
    expect(nextOrientation(undefined, 'cw')).toBe(6);
    expect(nextOrientation(undefined, 'ccw')).toBe(8);
  });
});

describe('normalizeOrientation', () => {
  it('passes every legal value through untouched', () => {
    for (const value of ALL) expect(normalizeOrientation(value)).toBe(value);
  });

  it('accepts the numeric string exiftool can hand back', () => {
    expect(normalizeOrientation('6')).toBe(6);
    expect(normalizeOrientation(' 8 ')).toBe(8);
  });

  it('collapses everything else to 1', () => {
    for (const junk of [undefined, null, 0, 9, -1, 2.5, NaN, '', 'Rotate 90 CW', {}]) {
      expect(normalizeOrientation(junk)).toBe(ORIENTATION_NORMAL);
    }
  });
});

describe('orientationSwapsAxes', () => {
  it('is true for exactly the quarter-turn values', () => {
    for (const value of ALL) {
      expect(orientationSwapsAxes(value)).toBe([5, 6, 7, 8].includes(value));
    }
  });

  it('treats an unknown value as normal, so no axes swap', () => {
    for (const junk of [undefined, null, 0, 9, 'sideways']) {
      expect(orientationSwapsAxes(junk)).toBe(false);
    }
  });
});
