/**
 * Capture-time filenames, ported from H:\rename-by-date (lib/rename-by-date.pl).
 *
 * That tool is the authority for the FORMAT — it has renamed the user's archive
 * for years and its `--compare` mode is verified against 1479 real files — so
 * every rule here mirrors a rule there, and the reasons are copied across with
 * it rather than re-derived. Where this module deliberately differs it says so.
 *
 * Pure and DOM-free: no fs, no exiftool, no Buffer work beyond what the caller
 * hands in. The impure halves — reading tags and hashing bytes — are injected,
 * which is what lets the whole allocator be tested without touching a disk.
 */

/**
 * The tag ladder, HIGHEST priority first.
 *
 * Each SubSec rung sits DIRECTLY above its plain sibling. The original shell
 * script had those two swapped, so `CreateDate` outranked `SubSecCreateDate`
 * and milliseconds were silently discarded whenever the top two rungs were
 * absent — the bug the Perl rewrite exists to fix. Do not reorder.
 *
 * `FileModifyDate` is last and is a real rung, not a fallback of last resort
 * for display: a file with no capture time at all still gets a plausible name
 * from it, and the caller can see which rung was used.
 */
export const TIMESTAMP_TAGS = [
  'SubSecDateTimeOriginal',
  'DateTimeOriginal',
  'SubSecCreateDate',
  'CreateDate',
  'SubSecMediaCreateDate',
  'MediaCreateDate',
  'FileModifyDate',
] as const;

export type TimestampTag = (typeof TIMESTAMP_TAGS)[number];

/** Raw tag values as exiftool prints them, keyed by tag name. */
export type TimestampTags = Partial<Record<TimestampTag, string | undefined>>;

export interface ParsedStamp {
  /** The filename stem: `YYYY-MM-DD HH-MM-SS-fff`. */
  name: string;
  /**
   * Wall-clock seconds on a proleptic Gregorian calendar.
   *
   * Deliberately NOT a Unix timestamp and deliberately not `Date.parse`: these
   * stamps are wall-clock readings, and a DST jump would make two frames shot
   * a minute apart sort an hour apart. Only differences matter.
   */
  epoch: number;
  /** Milliseconds, 0-999, as a number. */
  ms: number;
}

/** Days before the 1st of each month in a non-leap year. */
const CUMULATIVE_DAYS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Monotone wall-clock seconds. See ParsedStamp.epoch for why this is hand-rolled
 * rather than `Date.UTC` — the answer is only that it must not consult a
 * timezone database, and `Date.UTC` would not, so this is really about matching
 * the Perl bit for bit so the two tools agree on session boundaries.
 */
export function stampEpoch(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): number {
  const leaps =
    Math.floor((year - 1) / 4) - Math.floor((year - 1) / 100) + Math.floor((year - 1) / 400);
  let days = (year - 1) * 365 + leaps + CUMULATIVE_DAYS[month - 1]! + (day - 1);
  if (month > 2 && isLeapYear(year)) days++;
  return ((days * 24 + hour) * 60 + minute) * 60 + second;
}

const STAMP_RE = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/;

/**
 * `YYYY:MM:DD HH:MM:SS(.frac)(+TZ)` -> `{ name: "YYYY-MM-DD HH-MM-SS-fff" }`.
 *
 * Two rules worth stating out loud:
 *
 * - **The timezone is discarded on purpose.** These names are wall-clock time,
 *   which is what the photographer remembers and what keeps a shoot that
 *   crossed a DST boundary reading in order.
 * - **Fractional seconds are padded on the RIGHT.** `.5` is 500 ms, not 5 ms.
 *   Padding left would put every sub-second burst in the wrong order.
 *
 * Returns null for anything implausible rather than inventing a name: exiftool
 * prints `0000:00:00 00:00:00` for an empty tag, and a camera whose clock was
 * reset reports 1970 or 2000. A file with no plausible stamp keeps its name.
 */
export function parseStamp(value: string | null | undefined): ParsedStamp | null {
  if (!value) return null;
  const m = STAMP_RE.exec(value);
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);

  if (year < 1990 || year > 2100) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  const msText = ((m[7] ?? '') + '000').slice(0, 3);
  const p2 = (n: number): string => String(n).padStart(2, '0');

  return {
    name: `${m[1]}-${p2(month)}-${p2(day)} ${p2(hour)}-${p2(minute)}-${p2(second)}-${msText}`,
    epoch: stampEpoch(year, month, day, hour, minute, second),
    ms: Number(msText),
  };
}

export interface StampSource {
  stamp: ParsedStamp;
  /** Which rung of the ladder produced it — surfaced so the plan can show it. */
  tag: TimestampTag;
}

/** The first rung of the ladder that yields a plausible stamp. */
export function nameFromTags(tags: TimestampTags): StampSource | null {
  for (const tag of TIMESTAMP_TAGS) {
    const stamp = parseStamp(tags[tag]);
    if (stamp) return { stamp, tag };
  }
  return null;
}

/* -------------------------------------------------------------- name safety -- */

const WIN_RESERVED = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
]);

/**
 * Why a single path component is not a legal filename, or null if it is.
 *
 * Generated names are safe by construction; this exists for the EXTENSION,
 * which is carried over from the source file verbatim and therefore is not.
 * macOS writes Windows-illegal names onto exFAT without complaint — `co:lon.jpg`
 * and `trail .jpg` were both created successfully in the Perl tool's research —
 * so a card formatted on a Mac can hand us a component NTFS will refuse.
 */
export function validateComponent(name: string): string | null {
  if (!name) return 'leer';
  if (/[/\\]/.test(name)) return 'enthält Schrägstrich';
  if (/[<>:"|?*]/.test(name)) return 'enthält < > : " | ? *';
  if (/[\x00-\x1f]/.test(name)) return 'enthält Steuerzeichen';
  if (/[ .]$/.test(name)) return 'endet auf Punkt oder Leerzeichen';
  const stem = /^([^.]*)/.exec(name)?.[1] ?? '';
  if (WIN_RESERVED.has(stem.toUpperCase())) return `reservierter Windows-Name (${stem})`;
  return null;
}

/**
 * Split a basename into stem and extension.
 *
 * A pure split: the extension comes back exactly as the file spells it, because
 * this also reads the SOURCE's own name. What a generated name does with it is
 * `targetExtension`'s decision, one layer up.
 */
export function splitBasename(basename: string): { stem: string; ext: string } {
  const m = /^(.*)\.([^.]+)$/.exec(basename);
  return m ? { stem: m[1]!, ext: m[2]! } : { stem: basename, ext: '' };
}

/**
 * The extension a GENERATED name carries: lower case.
 *
 * Accepts either form the planner holds — a bare extension (`JPG`) or a whole
 * dotted tail (`.ARW.xmp`, which is what a sidecar's name is made of after its
 * stem) — because both are nothing but extension, and a photo whose name is
 * lower case beside a sidecar that shouts is the inconsistency this exists to
 * prevent.
 *
 * **A deliberate divergence from H:\rename-by-date**, which reattaches
 * `$m->{ext}` verbatim (`rename-by-date.pl:466`, with `lc` used only for the
 * case-insensitive `%taken` lookup on line 454) and therefore leaves a card
 * full of `.JPG` shouting. Requested, and it costs nothing the contract
 * covers: the differential in `naming.test.ts` pins the STEM — `parse_stamp`
 * and `stamp_epoch` — and never sees an extension.
 *
 * The old objection to doing this, which the comment above used to carry, was
 * that on a case-insensitive filesystem it is an invisible second rename that
 * only surfaces when the folder reaches a Mac. It is answered rather than
 * avoided, in two places that both had to be right:
 *
 * - `renameNoReplace` skips its `open(dest, 'wx')` reservation for a pure case
 *   change, because on NTFS the destination IS the source and the reservation
 *   would report EEXIST against the very file being renamed.
 * - `assertNoOverlap` compares paths case-insensitively and had to learn that a
 *   target claimed by a file's OWN source is not a cycle. Until it did, one
 *   already-correctly-named `.JPG` threw the whole folder's plan away.
 *
 * So `2025-08-24 14-30-12-000.JPG` -> `….jpg` is a real rename that really
 * happens, not an 'unchanged' and not a crash.
 */
export function targetExtension(ext: string): string {
  return ext.toLowerCase();
}
