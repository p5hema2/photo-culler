import { describe, it, expect } from 'vitest';
import { mapExifTags } from '../metadata';
import { clampRating, isInRatingRange, MAX_RATING, MIN_RATING } from '../rating';

describe('mapExifTags — capture time', () => {
  it('reads the camera wall clock as UTC, not as local time', () => {
    // Regression guard for the DST bug: `new Date('2026:03:29 02:44:00')` reads
    // the string in the system timezone, and on a spring-forward night 02:44
    // becomes 03:44. Date.UTC cannot do that.
    const meta = mapExifTags({ DateTimeOriginal: '2026:03:29 02:44:00' });

    expect(meta.dateTakenLocal).toBe(Date.UTC(2026, 2, 29, 2, 44, 0));
  });

  it('subtracts the recorded offset to get a true UTC sort key', () => {
    const meta = mapExifTags({
      DateTimeOriginal: '2026:08:27 14:00:00',
      OffsetTimeOriginal: '+02:00',
    });

    expect(meta.timezoneOffset).toBe('+02:00');
    expect(meta.dateTaken).toBe(Date.UTC(2026, 7, 27, 12, 0, 0));
    // Display value stays the camera's wall clock.
    expect(meta.dateTakenLocal).toBe(Date.UTC(2026, 7, 27, 14, 0, 0));
  });

  it('handles a negative offset', () => {
    const meta = mapExifTags({
      DateTimeOriginal: '2026:08:27 14:00:00',
      OffsetTimeOriginal: '-05:00',
    });

    expect(meta.dateTaken).toBe(Date.UTC(2026, 7, 27, 19, 0, 0));
  });

  it('falls back to local time when no offset is recorded', () => {
    const meta = mapExifTags({ DateTimeOriginal: '2026:08:27 14:00:00' });

    expect(meta.dateTaken).toBe(meta.dateTakenLocal);
    expect(meta.timezoneOffset).toBeUndefined();
  });

  it('ignores a malformed date and a malformed offset', () => {
    expect(mapExifTags({ DateTimeOriginal: 'not a date' }).dateTakenLocal).toBeUndefined();
    const meta = mapExifTags({ DateTimeOriginal: '2026:08:27 14:00:00', OffsetTimeOriginal: '+2' });
    expect(meta.timezoneOffset).toBeUndefined();
    expect(meta.dateTaken).toBe(meta.dateTakenLocal);
  });
});

describe('mapExifTags — exposure fields', () => {
  it('formats a sub-second shutter speed as a fraction', () => {
    expect(mapExifTags({ ExposureTime: 0.004 }).shutterSpeed).toBe('1/250');
  });

  it('formats a long exposure in seconds', () => {
    expect(mapExifTags({ ExposureTime: 2 }).shutterSpeed).toBe('2s');
    expect(mapExifTags({ ExposureTime: 1.5 }).shutterSpeed).toBe('1.5s');
  });

  it('does not divide by zero on a bogus exposure time', () => {
    expect(mapExifTags({ ExposureTime: 0 }).shutterSpeed).toBeUndefined();
  });

  it('reads bit 0 of the flash bitmask', () => {
    expect(mapExifTags({ Flash: 0 }).flash).toBe('No flash');
    expect(mapExifTags({ Flash: 1 }).flash).toBe('Fired');
    expect(mapExifTags({ Flash: 0x19 }).flash).toBe('Fired');
    expect(mapExifTags({ Flash: 'Off, did not fire' }).flash).toBe('Off, did not fire');
  });

  it('names known enum values and passes unknown ones through', () => {
    expect(mapExifTags({ MeteringMode: 5 }).meteringMode).toBe('Multi-segment');
    expect(mapExifTags({ MeteringMode: 42 }).meteringMode).toBe('Mode 42');
    expect(mapExifTags({ ColorSpace: 0xffff }).colorSpace).toBe('Uncalibrated');
  });

  it('prefers the primary tag and falls back to the alias', () => {
    expect(mapExifTags({ ISOSpeedRatings: 400 }).iso).toBe(400);
    expect(mapExifTags({ ISO: 200, ISOSpeedRatings: 400 }).iso).toBe(200);
    expect(mapExifTags({ FocalLengthIn35mmFormat: 50 }).focalLength).toBe(50);
  });

  it('drops empty and whitespace-only strings', () => {
    expect(mapExifTags({ Make: '   ' }).cameraMake).toBeUndefined();
    expect(mapExifTags({ Make: '  Panasonic ' }).cameraMake).toBe('Panasonic');
  });

  it('returns an empty object for a file with no metadata', () => {
    expect(mapExifTags(undefined)).toEqual({});
    expect(mapExifTags(null)).toEqual({});
  });
});

describe('clampRating', () => {
  it('passes a valid rating through', () => {
    for (const r of [0, 1, 2, 3, 4, 5]) expect(clampRating(r)).toBe(r);
  });

  it('collapses a rejected (-1) rating to unrated, never to the delete bucket', () => {
    // xmp:Rating = -1 is Adobe's "rejected". Mapping it to 1 would inherit
    // another tool's verdict AND queue the photo for deletion.
    expect(clampRating(-1)).toBe(MIN_RATING);
    expect(clampRating(-99)).toBe(MIN_RATING);
  });

  it('rounds a fractional rating, because xmp:Rating is declared real', () => {
    expect(clampRating(2.5)).toBe(3);
    expect(clampRating(2.4)).toBe(2);
  });

  it('clamps above the maximum', () => {
    expect(clampRating(9)).toBe(MAX_RATING);
  });

  it('accepts a numeric string, as XMP text nodes deliver', () => {
    expect(clampRating('4')).toBe(4);
  });

  it('reports nothing known for input that is not a number', () => {
    for (const v of [undefined, null, '', 'abc', NaN, Infinity, {}, []]) {
      expect(clampRating(v)).toBeUndefined();
    }
  });
});

describe('isInRatingRange', () => {
  it('treats an absent rating as unrated', () => {
    expect(isInRatingRange(undefined, { min: 0, max: 0 })).toBe(true);
    expect(isInRatingRange(undefined, { min: 1, max: 5 })).toBe(false);
  });

  it('never includes an unrated image in the default 1-1 delete range', () => {
    // The safety property of starting the range at 1: an image has to be
    // actively rated before it can be deleted.
    expect(isInRatingRange(0, { min: 1, max: 1 })).toBe(false);
    expect(isInRatingRange(1, { min: 1, max: 1 })).toBe(true);
    expect(isInRatingRange(2, { min: 1, max: 1 })).toBe(false);
  });

  it('is inclusive on both ends', () => {
    expect(isInRatingRange(1, { min: 1, max: 3 })).toBe(true);
    expect(isInRatingRange(3, { min: 1, max: 3 })).toBe(true);
    expect(isInRatingRange(4, { min: 1, max: 3 })).toBe(false);
  });
});
