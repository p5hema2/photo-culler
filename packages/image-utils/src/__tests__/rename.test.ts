import { describe, it, expect } from 'vitest';
import {
  consolidationTarget,
  joinPath,
  planMoves,
  planRenames,
  type RenameSource,
  type PlanRenamesOptions,
} from '../rename';

/* ------------------------------------------------------------------ helpers -- */

function src(path: string, tags: Record<string, string> = {}): RenameSource {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return { path, folder: path.slice(0, cut), name: path.slice(cut + 1), tags };
}

/** Every source, plus any extra paths, as the directory listings the planner needs. */
function listingOf(paths: readonly string[]): Map<string, Map<string, string>> {
  const dirs = new Map<string, Map<string, string>>();
  for (const p of paths) {
    const cut = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
    const dir = p.slice(0, cut);
    const name = p.slice(cut + 1);
    const bucket = dirs.get(dir) ?? new Map<string, string>();
    bucket.set(name.toLowerCase(), p);
    dirs.set(dir, bucket);
  }
  return dirs;
}

/** Content key from a table, so collisions are declared rather than simulated. */
function keyer(table: Record<string, string> = {}) {
  return async (path: string): Promise<string> => table[path] ?? `key-${path}`;
}

function opts(
  paths: readonly string[],
  over: Partial<PlanRenamesOptions> = {},
): PlanRenamesOptions {
  return {
    consolidateDcim: false,
    listing: listingOf(paths),
    contentKey: keyer(),
    ...over,
  };
}

const DATE = (s: string): Record<string, string> => ({ DateTimeOriginal: s });

/* ------------------------------------------------------------------- tests -- */

describe('consolidationTarget', () => {
  it('lifts a file out of a DCIM subfolder into DCIM itself', () => {
    expect(consolidationTarget('E:\\DCIM\\100_PANA')).toBe('E:\\DCIM');
    expect(consolidationTarget('/Volumes/CARD/DCIM/101MSDCF')).toBe('/Volumes/CARD/DCIM');
  });

  it('leaves a file already in DCIM where it is', () => {
    expect(consolidationTarget('E:\\DCIM')).toBe('E:\\DCIM');
  });

  it('is case-insensitive, because cameras disagree', () => {
    expect(consolidationTarget('/card/dcim/100')).toBe('/card/dcim');
    expect(consolidationTarget('/card/Dcim/100')).toBe('/card/Dcim');
  });

  it('matches whole segments only', () => {
    expect(consolidationTarget('/photos/MYDCIM/100')).toBe('/photos/MYDCIM/100');
    expect(consolidationTarget('/photos/DCIMX/100')).toBe('/photos/DCIMX/100');
    expect(consolidationTarget('/photos/XDCIM/100')).toBe('/photos/XDCIM/100');
  });

  it('leaves an ordinary tree completely alone', () => {
    expect(consolidationTarget('/photos/2025/concert/day2')).toBe('/photos/2025/concert/day2');
  });

  it('takes the OUTERMOST DCIM, so one pass collapses the whole card', () => {
    expect(consolidationTarget('/x/DCIM/a/DCIM/b')).toBe('/x/DCIM');
  });

  it('handles a UNC path', () => {
    expect(consolidationTarget('\\\\nas\\share\\DCIM\\100_PANA')).toBe('\\\\nas\\share\\DCIM');
  });

  it('is idempotent', () => {
    const once = consolidationTarget('E:\\DCIM\\100_PANA');
    expect(consolidationTarget(once)).toBe(once);
  });
});

describe('joinPath', () => {
  it('keeps the separator the folder already uses', () => {
    expect(joinPath('C:\\a\\b', 'x.jpg')).toBe('C:\\a\\b\\x.jpg');
    expect(joinPath('/a/b', 'x.jpg')).toBe('/a/b/x.jpg');
  });

  it('does not double a trailing separator', () => {
    expect(joinPath('/a/b/', 'x.jpg')).toBe('/a/b/x.jpg');
  });
});

describe('planRenames — the basic rename', () => {
  it('renames to the capture time and lower-cases the extension', () => {
    const s = [src('/d/P1000001.JPG', DATE('2025:08:24 14:30:12'))];
    return planRenames(s, opts(['/d/P1000001.JPG'])).then((plan) => {
      expect(plan.entries[0]).toMatchObject({
        action: 'rename',
        targetName: '2025-08-24 14-30-12-000.jpg',
        targetPath: '/d/2025-08-24 14-30-12-000.jpg',
        tag: 'DateTimeOriginal',
      });
    });
  });

  it('reports a file that already has its correct name as unchanged', async () => {
    const path = '/d/2025-08-24 14-30-12-000.jpg';
    const plan = await planRenames([src(path, DATE('2025:08:24 14:30:12'))], opts([path]));
    expect(plan.entries[0]!.action).toBe('unchanged');
    expect(plan.counts.rename).toBe(0);
  });

  it('is idempotent — planning over the result of a plan changes nothing', async () => {
    const first = await planRenames(
      [src('/d/P1000001.JPG', DATE('2025:08:24 14:30:12'))],
      opts(['/d/P1000001.JPG']),
    );
    const renamed = first.entries[0]!.targetPath;
    const second = await planRenames([src(renamed, DATE('2025:08:24 14:30:12'))], opts([renamed]));
    expect(second.counts.rename).toBe(0);
    expect(second.entries[0]!.action).toBe('unchanged');
  });

  it('leaves a file with no plausible date completely alone', async () => {
    const plan = await planRenames(
      [src('/d/scan.jpg', { DateTimeOriginal: '0000:00:00 00:00:00' })],
      opts(['/d/scan.jpg']),
    );
    expect(plan.entries[0]).toMatchObject({
      action: 'no-date',
      targetPath: '/d/scan.jpg',
      targetName: 'scan.jpg',
    });
  });

  it('names a video from MediaCreateDate', async () => {
    const plan = await planRenames(
      [src('/d/C0001.MP4', { MediaCreateDate: '2025:08:24 15:00:00' })],
      opts(['/d/C0001.MP4']),
    );
    expect(plan.entries[0]!.targetName).toBe('2025-08-24 15-00-00-000.mp4');
  });

  it('returns entries in the caller order, not the allocation order', async () => {
    const paths = ['/d/z.jpg', '/d/a.jpg'];
    const plan = await planRenames(
      [src(paths[0]!, DATE('2025:01:01 10:00:00')), src(paths[1]!, DATE('2025:01:01 11:00:00'))],
      opts(paths),
    );
    expect(plan.entries.map((e) => e.src)).toEqual(paths);
  });
});

describe('planRenames — extension case', () => {
  it('lower-cases an extension that is already correctly stemmed', async () => {
    // The regression that made this worth a test block of its own. A pure case
    // change is a target that, compared case-insensitively, IS its own source —
    // and `assertNoOverlap` used to read that as a cycle and THROW, so one
    // already-renamed `.JPG` anywhere in a folder discarded the entire plan.
    // Which is the second run over a library, i.e. every run after the first.
    const path = '/d/2025-08-24 14-30-12-000.JPG';
    const plan = await planRenames([src(path, DATE('2025:08:24 14:30:12'))], opts([path]));
    expect(plan.entries[0]).toMatchObject({
      action: 'rename',
      targetName: '2025-08-24 14-30-12-000.jpg',
    });
    expect(plan.counts.rename).toBe(1);
    // And NOT via the collision path: the file holding the name is itself.
    expect(plan.entries[0]!.targetName).not.toContain('~');
  });

  it('does not read a pure case change as a cycle, even with companions', async () => {
    const jpg = '/d/2025-08-24 14-30-12-000.JPG';
    const raw = '/d/2025-08-24 14-30-12-000.ARW';
    const xmp = '/d/2025-08-24 14-30-12-000.ARW.xmp';
    const plan = await planRenames([src(jpg, DATE('2025:08:24 14:30:12'))], opts([jpg, raw, xmp]));
    expect(plan.entries.map((e) => e.targetName)).toEqual([
      '2025-08-24 14-30-12-000.jpg',
      '2025-08-24 14-30-12-000.arw',
      '2025-08-24 14-30-12-000.arw.xmp',
    ]);
  });

  it('lower-cases what travels with the photo, or the pair reads inconsistently', async () => {
    const jpg = '/d/P1000001.JPG';
    const plan = await planRenames(
      [src(jpg, DATE('2025:08:24 14:30:12'))],
      opts([jpg, '/d/P1000001.ARW', '/d/P1000001.ARW.xmp', '/d/._P1000001.JPG']),
    );
    expect(plan.entries.map((e) => e.targetName).sort()).toEqual([
      '._2025-08-24 14-30-12-000.jpg',
      '2025-08-24 14-30-12-000.arw',
      '2025-08-24 14-30-12-000.arw.xmp',
      '2025-08-24 14-30-12-000.jpg',
    ]);
  });

  it('leaves a lower-case extension alone', async () => {
    const path = '/d/2025-08-24 14-30-12-000.jpg';
    const plan = await planRenames([src(path, DATE('2025:08:24 14:30:12'))], opts([path]));
    expect(plan.entries[0]!.action).toBe('unchanged');
  });
});

describe('planRenames — RAW + JPEG pairs', () => {
  it('gives both members the same base name', async () => {
    const paths = ['/d/P1000001.JPG', '/d/P1000001.RW2'];
    const plan = await planRenames(
      [src(paths[0]!, DATE('2025:08:24 14:30:12')), src(paths[1]!, DATE('2025:08:24 14:30:12'))],
      opts(paths),
    );
    const names = plan.entries.map((e) => e.targetName);
    expect(names).toEqual(['2025-08-24 14-30-12-000.jpg', '2025-08-24 14-30-12-000.rw2']);
  });

  it('names the pair from its dated member when the other has no date', async () => {
    // The Perl would leave the RW2 behind here. Splitting a pair is worse than
    // trusting one member's clock.
    const paths = ['/d/P1000001.JPG', '/d/P1000001.RW2'];
    const plan = await planRenames(
      [src(paths[0]!, DATE('2025:08:24 14:30:12')), src(paths[1]!, {})],
      opts(paths),
    );
    expect(plan.entries.map((e) => e.targetName)).toEqual([
      '2025-08-24 14-30-12-000.jpg',
      '2025-08-24 14-30-12-000.rw2',
    ]);
    expect(plan.counts['no-date']).toBe(0);
  });

  it('marks the whole pair no-date only when neither member has one', async () => {
    const paths = ['/d/x.JPG', '/d/x.RW2'];
    const plan = await planRenames([src(paths[0]!, {}), src(paths[1]!, {})], opts(paths));
    expect(plan.counts['no-date']).toBe(2);
  });

  it('takes the earliest stamp, and within a second the largest fraction', async () => {
    const paths = ['/d/a.JPG', '/d/a.RW2'];
    const plan = await planRenames(
      [
        src(paths[0]!, { SubSecDateTimeOriginal: '2025:08:24 14:30:12.100' }),
        src(paths[1]!, { SubSecDateTimeOriginal: '2025:08:24 14:30:12.900' }),
      ],
      opts(paths),
    );
    expect(plan.entries[0]!.targetName).toBe('2025-08-24 14-30-12-900.jpg');
  });

  it('gives both members the SAME collision suffix', async () => {
    const paths = ['/d/a.JPG', '/d/a.RW2'];
    const occupied = '/d/2025-08-24 14-30-12-000.JPG';
    const plan = await planRenames(
      [src(paths[0]!, DATE('2025:08:24 14:30:12')), src(paths[1]!, DATE('2025:08:24 14:30:12'))],
      opts([...paths, occupied], { contentKey: keyer({ [paths[0]!]: 'abcdef01' }) }),
    );
    const names = plan.entries.map((e) => e.targetName);
    expect(names).toEqual(['2025-08-24 14-30-12-000~abcd.jpg', '2025-08-24 14-30-12-000~abcd.rw2']);
  });
});

describe('planRenames — collisions', () => {
  it('adds a content-hash suffix when a different file holds the name', async () => {
    const mine = '/d/P1.JPG';
    const occupied = '/d/2025-08-24 14-30-12-000.JPG';
    const plan = await planRenames(
      [src(mine, DATE('2025:08:24 14:30:12'))],
      opts([mine, occupied], { contentKey: keyer({ [mine]: 'deadbeef', [occupied]: 'other' }) }),
    );
    expect(plan.entries[0]!.targetName).toBe('2025-08-24 14-30-12-000~dead.jpg');
  });

  it('leaves a byte-identical duplicate where it is rather than deleting it', async () => {
    const mine = '/d/sub/P1.JPG';
    const occupied = '/d/2025-08-24 14-30-12-000.JPG';
    const plan = await planRenames(
      [src(mine, DATE('2025:08:24 14:30:12'))],
      opts([mine, occupied], {
        consolidateDcim: false,
        contentKey: keyer({ [mine]: 'same', [occupied]: 'same' }),
      }),
    );
    // Same folder in this case, so the collision is real.
    expect(plan.entries[0]!.action).toBe('rename');
  });

  it('reports a same-folder byte-identical duplicate as duplicate, untouched', async () => {
    const mine = '/d/P1.JPG';
    const occupied = '/d/2025-08-24 14-30-12-000.JPG';
    const plan = await planRenames(
      [src(mine, DATE('2025:08:24 14:30:12'))],
      opts([mine, occupied], { contentKey: keyer({ [mine]: 'same', [occupied]: 'same' }) }),
    );
    expect(plan.entries[0]).toMatchObject({ action: 'duplicate', targetPath: mine });
  });

  it('two different files shot in the same second do not collide with each other', async () => {
    const a = '/d/A.JPG';
    const b = '/d/B.JPG';
    const plan = await planRenames(
      [src(a, DATE('2025:08:24 14:30:12')), src(b, DATE('2025:08:24 14:30:12'))],
      opts([a, b], { contentKey: keyer({ [a]: 'aaaa1111', [b]: 'bbbb2222' }) }),
    );
    const names = plan.entries.map((e) => e.targetName);
    expect(new Set(names).size).toBe(2);
    expect(names).toContain('2025-08-24 14-30-12-000.jpg');
    expect(names.some((n) => n.includes('~'))).toBe(true);
  });

  it('counts a name taken by a NON-media file too', async () => {
    // The listing must be the whole directory, or the plan would overwrite a
    // sidecar that happens to sit on the target name.
    const mine = '/d/P1.JPG';
    const note = '/d/2025-08-24 14-30-12-000.JPG';
    const plan = await planRenames(
      [src(mine, DATE('2025:08:24 14:30:12'))],
      opts([mine, note], { contentKey: keyer({ [mine]: 'ffff0000', [note]: 'zzz' }) }),
    );
    expect(plan.entries[0]!.targetName).toBe('2025-08-24 14-30-12-000~ffff.jpg');
  });

  it('treats names case-insensitively, as Windows does', async () => {
    const mine = '/d/P1.jpg';
    const occupied = '/d/2025-08-24 14-30-12-000.JPG';
    const plan = await planRenames(
      [src(mine, DATE('2025:08:24 14:30:12'))],
      opts([mine, occupied], { contentKey: keyer({ [mine]: '1234abcd', [occupied]: 'other' }) }),
    );
    expect(plan.entries[0]!.targetName).toBe('2025-08-24 14-30-12-000~1234.jpg');
  });

  it('is deterministic — the same input yields the same suffixes twice', async () => {
    const paths = ['/d/b.JPG', '/d/a.JPG', '/d/c.JPG'];
    const table = { '/d/a.JPG': 'aaaa0000', '/d/b.JPG': 'bbbb0000', '/d/c.JPG': 'cccc0000' };
    const build = (): Promise<
      ReturnType<typeof planRenames> extends Promise<infer T> ? T : never
    > =>
      planRenames(
        paths.map((p) => src(p, DATE('2025:08:24 14:30:12'))),
        opts(paths, { contentKey: keyer(table) }),
      );
    const [first, second] = await Promise.all([build(), build()]);
    expect(first.entries.map((e) => e.targetName)).toEqual(second.entries.map((e) => e.targetName));
  });
});

describe('planRenames — DCIM consolidation', () => {
  it('lifts files out of camera bucket folders into DCIM', async () => {
    const paths = ['/card/DCIM/100_PANA/P1.JPG', '/card/DCIM/101_PANA/P2.JPG'];
    const plan = await planRenames(
      [src(paths[0]!, DATE('2025:08:24 14:30:12')), src(paths[1]!, DATE('2025:08:24 15:00:00'))],
      opts(paths, { consolidateDcim: true }),
    );
    expect(plan.entries.map((e) => e.targetPath)).toEqual([
      '/card/DCIM/2025-08-24 14-30-12-000.jpg',
      '/card/DCIM/2025-08-24 15-00-00-000.jpg',
    ]);
  });

  it('keeps two cards\u2019 identically named files apart', async () => {
    // Both are P1000001.JPG, one second apart, from different bucket folders.
    const paths = ['/card/DCIM/100_PANA/P1000001.JPG', '/card/DCIM/101_PANA/P1000001.JPG'];
    const plan = await planRenames(
      [src(paths[0]!, DATE('2025:08:24 14:30:12')), src(paths[1]!, DATE('2025:08:24 14:30:13'))],
      opts(paths, { consolidateDcim: true }),
    );
    const targets = plan.entries.map((e) => e.targetPath);
    expect(new Set(targets).size).toBe(2);
  });

  it('does not move anything when consolidation is off', async () => {
    const paths = ['/card/DCIM/100_PANA/P1.JPG'];
    const plan = await planRenames(
      [src(paths[0]!, DATE('2025:08:24 14:30:12'))],
      opts(paths, { consolidateDcim: false }),
    );
    expect(plan.entries[0]!.targetFolder).toBe('/card/DCIM/100_PANA');
  });

  it('never touches the structure of an ordinary tree, even with consolidation on', async () => {
    const paths = ['/photos/2025/concert/day2/x.JPG'];
    const plan = await planRenames(
      [src(paths[0]!, DATE('2025:08:24 14:30:12'))],
      opts(paths, { consolidateDcim: true }),
    );
    expect(plan.entries[0]!.targetFolder).toBe('/photos/2025/concert/day2');
  });

  it('respects a name already occupied in the DCIM folder it moves into', async () => {
    const mine = '/card/DCIM/100_PANA/P1.JPG';
    const sitting = '/card/DCIM/2025-08-24 14-30-12-000.JPG';
    const plan = await planRenames(
      [src(mine, DATE('2025:08:24 14:30:12'))],
      opts([mine, sitting], {
        consolidateDcim: true,
        contentKey: keyer({ [mine]: '99887766', [sitting]: 'other' }),
      }),
    );
    expect(plan.entries[0]!.targetName).toBe('2025-08-24 14-30-12-000~9988.jpg');
  });

  it('reports both the source and the target folder as touched', async () => {
    const paths = ['/card/DCIM/100_PANA/P1.JPG'];
    const plan = await planRenames(
      [src(paths[0]!, DATE('2025:08:24 14:30:12'))],
      opts(paths, { consolidateDcim: true }),
    );
    expect(new Set(plan.touchedFolders)).toEqual(new Set(['/card/DCIM/100_PANA', '/card/DCIM']));
  });
});

describe('planRenames — the safety post-condition', () => {
  it('never targets a path another entry currently occupies', async () => {
    // A already sits on the name B wants, and A is itself moving away. The
    // namespace is not released, so B is suffixed rather than racing A.
    const a = '/d/2025-08-24 14-30-13-000.JPG';
    const b = '/d/P2.JPG';
    const plan = await planRenames(
      [src(a, DATE('2025:08:24 14:30:14')), src(b, DATE('2025:08:24 14:30:13'))],
      opts([a, b], { contentKey: keyer({ [a]: 'aaaa1111', [b]: 'bbbb2222' }) }),
    );

    const sources = new Set(plan.entries.map((e) => e.src.toLowerCase()));
    for (const entry of plan.entries) {
      if (entry.action !== 'rename') continue;
      expect(sources.has(entry.targetPath.toLowerCase()) && entry.targetPath !== entry.src).toBe(
        false,
      );
    }
  });

  it('produces a target set with no duplicates', async () => {
    const paths = Array.from({ length: 12 }, (_, i) => `/d/IMG_${i}.JPG`);
    const table = Object.fromEntries(paths.map((p, i) => [p, `${i}`.padStart(8, 'f')]));
    const plan = await planRenames(
      // Every file claims the very same second, so every one after the first collides.
      paths.map((p) => src(p, DATE('2025:08:24 14:30:12'))),
      opts(paths, { contentKey: keyer(table) }),
    );
    const targets = plan.entries.map((e) => e.targetPath.toLowerCase());
    expect(new Set(targets).size).toBe(targets.length);
  });

  it('tallies counts that add up to the number of sources', async () => {
    const paths = ['/d/a.JPG', '/d/b.JPG', '/d/c.JPG'];
    const plan = await planRenames(
      [
        src(paths[0]!, DATE('2025:08:24 14:30:12')),
        src(paths[1]!, {}),
        src(paths[2]!, DATE('2025:08:24 14:30:14')),
      ],
      opts(paths),
    );
    const total = Object.values(plan.counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(3);
    expect(plan.entries).toHaveLength(3);
  });

  it('handles an empty source list', async () => {
    const plan = await planRenames([], opts([]));
    expect(plan.entries).toEqual([]);
    expect(plan.touchedFolders).toEqual([]);
  });
});

describe('planMoves', () => {
  const DEST = '/dest';

  /** Options for a move: the source folder plus the destination must be listed. */
  function moveOpts(paths: readonly string[], over: Partial<PlanRenamesOptions> = {}) {
    const listing = listingOf(paths);
    if (!listing.has(DEST)) listing.set(DEST, new Map());
    return { listing, contentKey: keyer(), ...over };
  }

  it('moves a file and keeps its name', async () => {
    const p = '/d/P1000001.JPG';
    const plan = await planMoves([src(p)], DEST, moveOpts([p]));
    expect(plan.entries[0]).toMatchObject({
      action: 'rename',
      targetPath: '/dest/P1000001.jpg',
      targetName: 'P1000001.jpg',
      tag: null,
    });
  });

  it('lower-cases the extension of a moved file too', async () => {
    // A move keeps the STEM and generates the rest, so the same rule applies —
    // otherwise dragging a file into a folder would leave the one shouting
    // extension in a folder full of quiet ones.
    const p = '/d/IMG_1.JPG';
    const plan = await planMoves([src(p)], DEST, moveOpts([p]));
    expect(plan.entries[0]!.targetName).toBe('IMG_1.jpg');
  });

  it('needs no timestamp at all', async () => {
    // The whole point of the split: a move keeps the name, so a file with no
    // readable date still moves. planRenames would report it 'no-date'.
    const p = '/d/undated.jpg';
    const plan = await planMoves([src(p, {})], DEST, moveOpts([p]));
    expect(plan.counts['no-date']).toBe(0);
    expect(plan.counts.rename).toBe(1);
  });

  it('reports a file already in the target as unchanged', async () => {
    const p = '/dest/already.jpg';
    const plan = await planMoves([src(p)], DEST, moveOpts([p]));
    expect(plan.entries[0]!.action).toBe('unchanged');
    expect(plan.counts.rename).toBe(0);
  });

  it('moves only the half of a mixed selection that has somewhere to go', async () => {
    const here = '/dest/here.jpg';
    const there = '/d/there.JPG';
    const plan = await planMoves([src(here), src(there)], DEST, moveOpts([here, there]));
    expect(plan.counts).toMatchObject({ unchanged: 1, rename: 1 });
  });

  it('suffixes a name the target already holds, rather than overwriting it', async () => {
    const mine = '/d/IMG_1.JPG';
    const sitting = '/dest/IMG_1.JPG';
    const plan = await planMoves(
      [src(mine)],
      DEST,
      moveOpts([mine, sitting], {
        contentKey: keyer({ [mine]: 'abcd1234', [sitting]: 'other' }),
      }),
    );
    expect(plan.entries[0]!.targetName).toBe('IMG_1~abcd.jpg');
  });

  it('leaves a byte-identical duplicate where it is', async () => {
    const mine = '/d/IMG_1.JPG';
    const sitting = '/dest/IMG_1.JPG';
    const plan = await planMoves(
      [src(mine)],
      DEST,
      moveOpts([mine, sitting], { contentKey: keyer({ [mine]: 'same', [sitting]: 'same' }) }),
    );
    expect(plan.entries[0]).toMatchObject({ action: 'duplicate', targetPath: mine });
  });

  it('keeps a RAW and its JPEG on the same suffix', async () => {
    const jpg = '/d/IMG_1.JPG';
    const raw = '/d/IMG_1.RW2';
    const sitting = '/dest/IMG_1.JPG';
    const plan = await planMoves(
      [src(jpg), src(raw)],
      DEST,
      moveOpts([jpg, raw, sitting], {
        contentKey: keyer({ [jpg]: 'beef0000', [sitting]: 'other' }),
      }),
    );
    expect(plan.entries.map((e) => e.targetName)).toEqual(['IMG_1~beef.jpg', 'IMG_1~beef.rw2']);
  });

  it('takes companions the app cannot see along', async () => {
    const jpg = '/d/IMG_1.JPG';
    const plan = await planMoves(
      [src(jpg)],
      DEST,
      moveOpts([jpg, '/d/IMG_1.RW2', '/d/IMG_1.RW2.xmp', '/d/._IMG_1.JPG']),
    );
    expect(plan.entries.map((e) => e.targetName).sort()).toEqual([
      '._IMG_1.jpg',
      'IMG_1.jpg',
      'IMG_1.rw2',
      'IMG_1.rw2.xmp',
    ]);
    expect(plan.entries.every((e) => e.targetFolder === DEST)).toBe(true);
  });

  it('merges two folders without letting either overwrite the other', async () => {
    // Both cards wrote P1000001.JPG. Neither may land on the other.
    const a = '/cardA/P1000001.JPG';
    const b = '/cardB/P1000001.JPG';
    const plan = await planMoves(
      [src(a), src(b)],
      DEST,
      moveOpts([a, b], { contentKey: keyer({ [a]: 'aaaa1111', [b]: 'bbbb2222' }) }),
    );
    const targets = plan.entries.map((e) => e.targetPath);
    expect(new Set(targets).size).toBe(2);
    expect(plan.counts.rename).toBe(2);
  });

  it('reports both folders as touched', async () => {
    const p = '/d/x.JPG';
    const plan = await planMoves([src(p)], DEST, moveOpts([p]));
    expect(new Set(plan.touchedFolders)).toEqual(new Set(['/d', DEST]));
  });

  it('handles an empty source list', async () => {
    const plan = await planMoves([], DEST, moveOpts([]));
    expect(plan.entries).toEqual([]);
  });
});
