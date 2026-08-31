import { describe, it, expect } from 'vitest';
import {
  TIMESTAMP_TAGS,
  parseStamp,
  stampEpoch,
  nameFromTags,
  validateComponent,
  splitBasename,
  targetExtension,
} from '../naming';
import { PERL_GOLDEN } from './fixtures/naming-golden';

describe('parity with the original Perl engine', () => {
  // The whole point of this module is that it produces the SAME names as
  // H:\rename-by-date, so that a folder renamed by either tool is
  // indistinguishable. That is a contract with a program outside this repo,
  // and a unit test written from the spec would only ever prove that the spec
  // and the code agree. These rows came out of the Perl itself.
  it.each(PERL_GOLDEN)('matches the Perl for %j', (input, expected) => {
    const parsed = parseStamp(input === '<EMPTY>' ? '' : input);
    const actual = parsed ? `${parsed.name}|${parsed.epoch}|${parsed.ms}` : 'UNDEF';
    expect(actual).toBe(expected);
  });

  it('covers both outcomes, so a broken parser cannot pass by returning null', () => {
    const named = PERL_GOLDEN.filter(([, out]) => out !== 'UNDEF').length;
    expect(named).toBeGreaterThan(30);
    expect(PERL_GOLDEN.length - named).toBeGreaterThan(30);
  });
});

describe('parseStamp', () => {
  it('renders exiftool colons as the filename format', () => {
    expect(parseStamp('2025:08:24 14:30:12')?.name).toBe('2025-08-24 14-30-12-000');
  });

  it('pads fractional seconds on the RIGHT — .5 is 500 ms, not 5', () => {
    expect(parseStamp('2025:08:24 14:30:12.5')?.name).toBe('2025-08-24 14-30-12-500');
    expect(parseStamp('2025:08:24 14:30:12.5')?.ms).toBe(500);
    expect(parseStamp('2025:08:24 14:30:12.05')?.ms).toBe(50);
    expect(parseStamp('2025:08:24 14:30:12.005')?.ms).toBe(5);
  });

  it('truncates fractions longer than three digits', () => {
    expect(parseStamp('2025:08:24 14:30:12.123456')?.ms).toBe(123);
  });

  it('discards the timezone — these names are wall-clock', () => {
    expect(parseStamp('2025:08:24 14:30:12+02:00')?.name).toBe('2025-08-24 14-30-12-000');
    expect(parseStamp('2025:08:24 14:30:12-07:00')?.name).toBe('2025-08-24 14-30-12-000');
  });

  it('accepts the ISO T separator as well as a space', () => {
    expect(parseStamp('2025:08:24T14:30:12')?.name).toBe('2025-08-24 14-30-12-000');
  });

  it('rejects the empty-tag zero stamp exiftool prints', () => {
    expect(parseStamp('0000:00:00 00:00:00')).toBeNull();
  });

  it('rejects a camera whose clock was reset', () => {
    expect(parseStamp('1970:01:01 00:00:00')).toBeNull();
    expect(parseStamp('1980:01:01 12:00:00')).toBeNull();
  });

  it('accepts the plausible range boundaries', () => {
    expect(parseStamp('1990:01:01 00:00:00')).not.toBeNull();
    expect(parseStamp('2100:12:31 23:59:59')).not.toBeNull();
    expect(parseStamp('2101:01:01 00:00:00')).toBeNull();
  });

  it('rejects out-of-range field values', () => {
    expect(parseStamp('2025:13:01 00:00:00')).toBeNull();
    expect(parseStamp('2025:01:32 00:00:00')).toBeNull();
    expect(parseStamp('2025:01:01 24:00:00')).toBeNull();
    expect(parseStamp('2025:01:01 00:60:00')).toBeNull();
    expect(parseStamp('2025:01:01 00:00:60')).toBeNull();
  });

  it('returns null for empty, missing and unparseable input', () => {
    expect(parseStamp('')).toBeNull();
    expect(parseStamp(undefined)).toBeNull();
    expect(parseStamp(null)).toBeNull();
    expect(parseStamp('-')).toBeNull();
    expect(parseStamp('not a date')).toBeNull();
  });
});

describe('stampEpoch', () => {
  it('is monotone across a DST boundary', () => {
    // Europe/Berlin springs forward 2025-03-30 02:00 -> 03:00. Two frames a
    // minute apart in wall-clock time must stay a minute apart here, or the
    // Perl tool's gap detection would cut a session in half.
    const before = stampEpoch(2025, 3, 30, 1, 59, 0);
    const after = stampEpoch(2025, 3, 30, 2, 0, 0);
    expect(after - before).toBe(60);
  });

  it('counts a leap day', () => {
    const feb28 = stampEpoch(2024, 2, 28, 0, 0, 0);
    const mar1 = stampEpoch(2024, 3, 1, 0, 0, 0);
    expect(mar1 - feb28).toBe(2 * 86400);
  });

  it('does not count a leap day in a non-leap year', () => {
    const feb28 = stampEpoch(2025, 2, 28, 0, 0, 0);
    const mar1 = stampEpoch(2025, 3, 1, 0, 0, 0);
    expect(mar1 - feb28).toBe(86400);
  });

  it('treats 2000 as a leap year and 1900 as not', () => {
    expect(stampEpoch(2000, 3, 1, 0, 0, 0) - stampEpoch(2000, 2, 28, 0, 0, 0)).toBe(2 * 86400);
    expect(stampEpoch(1900, 3, 1, 0, 0, 0) - stampEpoch(1900, 2, 28, 0, 0, 0)).toBe(86400);
  });

  it('advances by exactly one day across a year boundary', () => {
    expect(stampEpoch(2026, 1, 1, 0, 0, 0) - stampEpoch(2025, 12, 31, 0, 0, 0)).toBe(86400);
  });
});

describe('nameFromTags', () => {
  it('takes the first plausible rung of the ladder', () => {
    const got = nameFromTags({
      DateTimeOriginal: '2025:08:24 14:30:12',
      FileModifyDate: '2020:01:01 00:00:00',
    });
    expect(got?.tag).toBe('DateTimeOriginal');
    expect(got?.stamp.name).toBe('2025-08-24 14-30-12-000');
  });

  it('puts every SubSec rung DIRECTLY above its plain sibling', () => {
    // The original shell script had these swapped, so CreateDate outranked
    // SubSecCreateDate and the milliseconds were thrown away. Guard the order.
    expect([...TIMESTAMP_TAGS]).toEqual([
      'SubSecDateTimeOriginal',
      'DateTimeOriginal',
      'SubSecCreateDate',
      'CreateDate',
      'SubSecMediaCreateDate',
      'MediaCreateDate',
      'FileModifyDate',
    ]);
  });

  it('keeps milliseconds when only the lower rungs are present', () => {
    const got = nameFromTags({
      SubSecCreateDate: '2025:08:24 14:30:12.25',
      CreateDate: '2025:08:24 14:30:12',
    });
    expect(got?.tag).toBe('SubSecCreateDate');
    expect(got?.stamp.ms).toBe(250);
  });

  it('falls through an implausible high rung to a plausible low one', () => {
    const got = nameFromTags({
      DateTimeOriginal: '0000:00:00 00:00:00',
      FileModifyDate: '2025:08:24 14:30:12',
    });
    expect(got?.tag).toBe('FileModifyDate');
  });

  it('reaches MediaCreateDate, which is where a video usually carries its date', () => {
    const got = nameFromTags({ MediaCreateDate: '2025:08:24 14:30:12' });
    expect(got?.tag).toBe('MediaCreateDate');
    expect(got?.stamp.name).toBe('2025-08-24 14-30-12-000');
  });

  it('returns null when no rung is plausible', () => {
    expect(nameFromTags({})).toBeNull();
    expect(nameFromTags({ DateTimeOriginal: '-', FileModifyDate: '' })).toBeNull();
  });
});

describe('validateComponent', () => {
  it('accepts a generated name', () => {
    expect(validateComponent('2025-08-24 14-30-12-000.JPG')).toBeNull();
  });

  it.each([
    ['', 'empty'],
    ['a/b.jpg', 'slash'],
    ['a\\b.jpg', 'backslash'],
    ['co:lon.jpg', 'colon'],
    ['q?.jpg', 'question mark'],
    ['star*.jpg', 'asterisk'],
    ['pipe|.jpg', 'pipe'],
    ['trail .jpg ', 'trailing space'],
    ['dot.', 'trailing dot'],
    ['NUL.jpg', 'reserved device name'],
    ['com1.txt', 'reserved device name, lowercase'],
  ])('rejects %s (%s)', (name) => {
    expect(validateComponent(name)).not.toBeNull();
  });

  it('allows a reserved word that is not the whole stem', () => {
    expect(validateComponent('CONCERT.jpg')).toBeNull();
  });
});

describe('splitBasename', () => {
  it('reports the extension as the file spells it', () => {
    // A pure split — it reads a SOURCE name. Deciding what a generated name
    // does with the case is `targetExtension`'s job, below.
    expect(splitBasename('P1000001.JPG')).toEqual({ stem: 'P1000001', ext: 'JPG' });
  });

  it('splits on the LAST dot', () => {
    expect(splitBasename('a.b.c.mov')).toEqual({ stem: 'a.b.c', ext: 'mov' });
  });

  it('handles a name with no extension', () => {
    expect(splitBasename('README')).toEqual({ stem: 'README', ext: '' });
  });

  it('treats a dotfile as all stem', () => {
    // Not a case we generate, but the allocator must not turn ".hidden" into
    // an extension-only name.
    expect(splitBasename('.hidden')).toEqual({ stem: '', ext: 'hidden' });
  });
});

describe('targetExtension', () => {
  it('lower-cases a bare extension', () => {
    expect(targetExtension('JPG')).toBe('jpg');
  });

  it('lower-cases a whole dotted tail, which is what a sidecar carries', () => {
    // `IMG_1.ARW.xmp` reaches the planner as stem `IMG_1` plus this tail, so
    // both halves have to come out quiet or the pair reads inconsistently.
    expect(targetExtension('.ARW.xmp')).toBe('.arw.xmp');
  });

  it('leaves an already lower-case extension alone', () => {
    expect(targetExtension('mov')).toBe('mov');
  });

  it('has nothing to do for a file with no extension', () => {
    expect(targetExtension('')).toBe('');
  });
});
