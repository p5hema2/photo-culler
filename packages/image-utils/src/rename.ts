/**
 * Turning capture times into a rename plan.
 *
 * Ported from `allocate_names` in H:\rename-by-date\lib\rename-by-date.pl, with
 * one change of purpose: that tool COPIES a card into a fresh event folder,
 * this one renames IN PLACE. The naming rules are identical on purpose — a
 * folder processed by either tool must be indistinguishable — but in-place work
 * has failure modes an import does not, and those are what most of the comments
 * below are about.
 *
 * Pure: no fs, no exiftool. The two impure inputs — what is already in a target
 * directory, and the bytes behind a colliding file — are injected.
 */

import type {
  RenameAction,
  RenameCompanionKind,
  RenamePlan,
  RenamePlanEntry,
} from '@photo-culler/types';
import {
  nameFromTags,
  splitBasename,
  validateComponent,
  type TimestampTag,
  type TimestampTags,
} from './naming';

export type { RenameAction, RenameCompanionKind, RenamePlan, RenamePlanEntry };

/** One file the caller wants renamed, with the tags exiftool read for it. */
export interface RenameSource {
  /** Absolute path as it is now. */
  path: string;
  /** Absolute directory it sits in — always `dirname(path)`. */
  folder: string;
  /** Basename as it is now. */
  name: string;
  /** Raw timestamp tag values. An empty object is legal and means "no date". */
  tags: TimestampTags;
}

export interface PlanRenamesOptions {
  /**
   * Move files out of subfolders of a `DCIM` directory into that directory.
   *
   * The ONLY structural change this module is allowed to make. Everything else
   * stays exactly where it is — a rename is not a reorganisation.
   */
  consolidateDcim: boolean;
  /**
   * Everything currently in a directory, as `lowercased basename -> absolute
   * path`.
   *
   * Must be the FULL listing, not just the media files, for two independent
   * reasons: a sidecar or a stray `.DS_Store` occupies a name just as
   * effectively as a photo does, and the companion pass below reads this same
   * listing to find the RAW and the XMP that have to travel with the JPEG.
   *
   * A directory the caller did not list is treated as empty, which is correct
   * only for a directory that does not exist yet.
   */
  listing: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /**
   * Short, stable digest of a file's identity — the Perl uses MD5 of the size
   * plus the first 64 kB. Called ONLY on a name collision, which is rare, so
   * its cost does not sit on the main path.
   */
  contentKey: (path: string) => Promise<string>;
  /**
   * Carry stem-paired files the app cannot see — the RAW, the XMP sidecar, the
   * AppleDouble twin — along with the photo they belong to. Default true.
   *
   * Turning this off is data loss with extra steps: see RenameCompanionKind.
   */
  companions?: boolean;
  /**
   * Refuse a target path longer than this many characters.
   *
   * Windows stops at MAX_PATH = 260 unless long paths are enabled, and Node 20+
   * does not auto-prefix `\\?\`. The generated stem is 23 characters plus the
   * extension, which is usually LONGER than the camera name it replaces
   * (`P1000123.JPG` is 12), so a deep tree that works today can be pushed over
   * the limit by the rename. The caller should also leave room for the
   * thumbnail cache path, which adds `\.photo-culler-thumbs\` and
   * `.thumb.webp` — 32 characters — on top; the failure otherwise surfaces as
   * "thumbnails stopped working", not as "that name was too long".
   *
   * Omitted means no limit, which is right on macOS and Linux.
   */
  maxTargetPathLength?: number;
}

/**
 * The directory a file should end up in.
 *
 * Returns the OUTERMOST ancestor named `DCIM` when there is one, so a whole
 * card collapses into a single folder in one pass rather than needing one pass
 * per nesting level. Matching is case-insensitive because a card formatted by
 * one camera writes `DCIM` and by another `dcim`, and whole-segment only, so
 * `MYDCIM` and `DCIMX` are ordinary folders.
 *
 * Returns `folder` unchanged when no `DCIM` ancestor exists — which is the
 * common case and the one that makes "do not touch the folder structure" true.
 */
export function consolidationTarget(folder: string): string {
  const m = /^(.*?[\\/]dcim)(?=[\\/]|$)/i.exec(folder);
  return m ? m[1]! : folder;
}

const EMPTY_LISTING: ReadonlyMap<string, string> = new Map();

/** The stamp a member contributed, or null when its file carries no date. */
interface MemberStamp {
  name: string;
  epoch: number;
  ms: number;
  tag: TimestampTag;
}

interface Member {
  source: RenameSource;
  ext: string;
  stamp: MemberStamp | null;
}

/** Members of one group, which must all end up sharing a base name. */
interface Group {
  key: string;
  stem: string;
  srcFolder: string;
  targetFolder: string;
  members: Member[];
}

/**
 * Compute the full plan without touching anything.
 *
 * ## The property that makes execution simple
 *
 * The namespace of each target directory is seeded with everything already in
 * it, and a name is NEVER released — not even when the file holding it is
 * itself about to move away. That costs an occasional unnecessary `~hash`
 * suffix in the rare case where two files swap names, and it buys the
 * invariant that:
 *
 *   > no entry's target path is ever equal to another entry's source path,
 *   > and no two entries share a target path.
 *
 * So there are no rename cycles, no file is ever overwritten, and the executor
 * is a plain loop rather than a two-phase temp-name dance. `assertNoOverlap`
 * checks it rather than trusting it, because the cost of being wrong is a
 * silently destroyed photo — `fs.rename` replaces its destination without a
 * word on every platform this ships to.
 *
 * ## Why collisions get a content hash and not a counter
 *
 * Straight from the Perl, and it applies here twice over. A counter is handed
 * out in directory-listing order, which is the filesystem's (name-ordered on
 * NTFS, hash-ordered on ext4), and it shifts when a file is deleted — so a
 * photo inherits the position, and in this app the CULL VERDICT, of another.
 * A content hash is a pure function of the bytes.
 */
export async function planRenames(
  sources: readonly RenameSource[],
  options: PlanRenamesOptions,
): Promise<RenamePlan> {
  const { consolidateDcim, listing, contentKey, companions = true, maxTargetPathLength } = options;

  const entries: RenamePlanEntry[] = [];
  const groups = new Map<string, Group>();
  const sourcePaths = new Set(sources.map((s) => s.path.toLowerCase()));

  // --- 1. Bucket by (source folder, stem) ------------------------------------
  // A shot's RAW and JPEG must get the same base name AND the same suffix, or
  // the .RW2 would later point at a different photo than the .JPG beside it.
  // Grouping on the SOURCE folder is what keeps two cards' `P1000001` apart
  // even when consolidation is about to land them in one directory.
  //
  // Grouping happens BEFORE the date lookup, which is where this diverges from
  // the Perl: that tool splits dated from undated first, so a RAW whose date
  // exiftool could not read would be left behind while its JPEG was renamed —
  // the exact outcome the grouping exists to prevent. Here one dated member is
  // enough to name the whole group, and only a group where NO member carries a
  // date comes out as 'no-date'.
  for (const source of sources) {
    const targetFolder = consolidateDcim ? consolidationTarget(source.folder) : source.folder;
    const found = nameFromTags(source.tags);
    const { stem, ext } = splitBasename(source.name);
    const key = `${source.folder}\u0000${stem}`;
    const group =
      groups.get(key) ??
      ({ key, stem, srcFolder: source.folder, targetFolder, members: [] } as Group);
    group.members.push({
      source,
      ext,
      stamp: found
        ? { name: found.stamp.name, epoch: found.stamp.epoch, ms: found.stamp.ms, tag: found.tag }
        : null,
    });
    groups.set(key, group);
  }

  // Longest-stem-wins, per folder, so `IMG_1.2.xmp` attaches to the source
  // whose stem is `IMG_1.2` rather than to the one whose stem is `IMG_1`.
  const stemsByFolder = new Map<string, string[]>();
  for (const group of groups.values()) {
    const list = stemsByFolder.get(group.srcFolder) ?? [];
    list.push(group.stem);
    stemsByFolder.set(group.srcFolder, list);
  }
  for (const list of stemsByFolder.values()) list.sort((a, b) => b.length - a.length);

  // --- 2. Seed each target directory's namespace -----------------------------
  const taken = new Map<string, Map<string, string>>();
  const namespaceFor = (folder: string): Map<string, string> => {
    let ns = taken.get(folder);
    if (!ns) {
      ns = new Map(listing.get(folder) ?? EMPTY_LISTING);
      taken.set(folder, ns);
    }
    return ns;
  };

  // --- 3. Allocate, group by group ------------------------------------------
  // Sorted so the plan is a pure function of its inputs: two runs over the same
  // directory must produce the same suffixes, or a retry after a failure would
  // rename half the folder differently.
  for (const key of [...groups.keys()].sort()) {
    const group = groups.get(key)!;
    const ns = namespaceFor(group.targetFolder);

    // Earliest wins, and within one second the LARGEST fraction — the Perl's
    // rule, kept verbatim so both tools pick the same member of a pair.
    const dated = group.members
      .filter((m): m is Member & { stamp: MemberStamp } => m.stamp !== null)
      .sort((a, b) => a.stamp.epoch - b.stamp.epoch || b.stamp.ms - a.stamp.ms);

    if (dated.length === 0) {
      for (const member of group.members) {
        entries.push(
          leaveAlone(member.source, 'no-date', 'kein brauchbarer Zeitstempel in der Datei'),
        );
      }
      continue;
    }

    const base = dated[0]!.stamp.name;
    const groupTag: string = dated[0]!.stamp.tag;
    /** The photo a companion is said to belong to. */
    const primary = dated[0]!.source.path;

    // Does any member collide? If one does they ALL take the same suffix, so
    // the pair does not come apart.
    let suffix = '';
    let duplicateOf: string | null = null;

    for (const member of group.members) {
      const candidate = `${base}${member.ext ? '.' + member.ext : ''}`;
      const holder = ns.get(candidate.toLowerCase());
      if (!holder) continue;
      if (holder === member.source.path) continue; // already sits there

      const [holderKey, memberKey] = await Promise.all([
        contentKey(holder),
        contentKey(member.source.path),
      ]);
      if (holderKey === memberKey) {
        duplicateOf = holder;
        continue;
      }
      suffix = '~' + memberKey.slice(0, 4);
    }

    const stemName = base + suffix;
    let groupRenames = false;

    for (const member of group.members) {
      const { source, ext } = member;

      if (duplicateOf && !suffix) {
        entries.push(
          leaveAlone(source, 'duplicate', `inhaltsgleich mit ${duplicateOf} — bleibt liegen`),
        );
        continue;
      }

      const entry = allocate(source, stemName + (ext ? '.' + ext : ''), group.targetFolder, ns, {
        tag: groupTag,
        maxTargetPathLength,
      });
      entries.push(entry);
      if (entry.action === 'rename') groupRenames = true;
    }

    // --- 4. Whatever travels with the photo ---------------------------------
    // Only when something actually moved: a folder already correctly named must
    // not drag its sidecars through a no-op rename.
    if (!companions || !groupRenames) continue;

    for (const found of companionsOf(group, listing, sourcePaths, stemsByFolder)) {
      const entry = allocate(
        { path: found.path, folder: group.srcFolder, name: found.name, tags: {} },
        found.prefix + stemName + found.tail,
        group.targetFolder,
        ns,
        {
          tag: groupTag,
          companionOf: primary,
          companionKind: found.kind,
          maxTargetPathLength,
        },
      );
      entries.push(entry);
    }
  }

  // Back into the caller's order, so the preview lines up with the grid.
  // Companions have no place in that order and follow the photo they belong to.
  const order = new Map(sources.map((s, i) => [s.path, i]));
  const rank = (e: RenamePlanEntry): number =>
    order.get(e.companionOf ?? e.src) ?? Number.MAX_SAFE_INTEGER;
  entries.sort((a, b) => rank(a) - rank(b) || (a.companionOf ? 1 : 0) - (b.companionOf ? 1 : 0));

  assertNoOverlap(entries);

  const counts: Record<RenameAction, number> = {
    rename: 0,
    unchanged: 0,
    'no-date': 0,
    duplicate: 0,
    blocked: 0,
  };
  const touched = new Set<string>();
  for (const entry of entries) {
    counts[entry.action] += 1;
    if (entry.action === 'rename') {
      touched.add(entry.targetFolder);
      touched.add(entry.srcFolder);
    }
  }

  return { entries, counts, touchedFolders: [...touched] };
}

/* ---------------------------------------------------------------- internals -- */

/** An entry for a file that stays exactly where it is. */
function leaveAlone(source: RenameSource, action: RenameAction, reason: string): RenamePlanEntry {
  return {
    src: source.path,
    srcFolder: source.folder,
    srcName: source.name,
    targetFolder: source.folder,
    targetName: source.name,
    targetPath: source.path,
    action,
    tag: null,
    reason,
  };
}

interface AllocateExtras {
  tag: string | null;
  companionOf?: string;
  companionKind?: RenameCompanionKind;
  maxTargetPathLength?: number;
}

/**
 * Claim one target name, or explain why it cannot be claimed.
 *
 * Mutates `ns` on success — that is what stops the next group from claiming the
 * same name, and it is why this must run in a deterministic order.
 */
function allocate(
  source: RenameSource,
  targetName: string,
  targetFolder: string,
  ns: Map<string, string>,
  extras: AllocateExtras,
): RenamePlanEntry {
  const stay = (action: RenameAction, reason: string): RenamePlanEntry => ({
    ...leaveAlone(source, action, reason),
    companionOf: extras.companionOf,
    companionKind: extras.companionKind,
  });

  const invalid = validateComponent(targetName);
  if (invalid) return stay('blocked', `unzulässiger Dateiname (${invalid})`);

  const targetPath = joinPath(targetFolder, targetName);
  if (extras.maxTargetPathLength !== undefined && targetPath.length > extras.maxTargetPathLength) {
    return stay('blocked', `Zielpfad zu lang (${targetPath.length} Zeichen)`);
  }

  const holder = ns.get(targetName.toLowerCase());
  if (holder && holder !== source.path) {
    // Only reachable when the hash suffix itself collided, which needs two
    // files with the same capture time AND the same size AND the same first
    // 64 kB that are still not the same file. Report it rather than inventing
    // a second disambiguator nobody could predict.
    return stay('blocked', `Zielname ${targetName} ist schon vergeben`);
  }

  ns.set(targetName.toLowerCase(), targetPath);
  return {
    src: source.path,
    srcFolder: source.folder,
    srcName: source.name,
    targetFolder,
    targetName,
    targetPath,
    action: targetPath === source.path ? 'unchanged' : 'rename',
    tag: extras.tag,
    companionOf: extras.companionOf,
    companionKind: extras.companionKind,
  };
}

interface Companion {
  path: string;
  name: string;
  /** `'._'` for an AppleDouble twin, empty otherwise. Re-attached verbatim. */
  prefix: string;
  /** Everything after the stem, e.g. `.ARW`, `.ARW.xmp`. Re-attached verbatim. */
  tail: string;
  kind: RenameCompanionKind;
}

/**
 * Files beside the photo that share its stem and must move with it.
 *
 * Three shapes, all matched on the stem plus a literal dot so that `IMG_1` does
 * not swallow `IMG_12.JPG`:
 *
 *   `IMG_1234.ARW`      -> stem         (the RAW, a .THM, an .LRV, an .AAE)
 *   `IMG_1234.ARW.xmp`  -> sidecar      (named after the whole filename)
 *   `._IMG_1234.JPG`    -> appledouble  (macOS resource fork on an exFAT card)
 *
 * Anything already in `sourcePaths` is skipped: it is a photo or video in its
 * own right and has its own entry. And a candidate is only offered to the group
 * with the LONGEST matching stem, so a sidecar cannot follow the wrong photo.
 */
function companionsOf(
  group: Group,
  listing: ReadonlyMap<string, ReadonlyMap<string, string>>,
  sourcePaths: ReadonlySet<string>,
  stemsByFolder: ReadonlyMap<string, readonly string[]>,
): Companion[] {
  const dir = listing.get(group.srcFolder);
  if (!dir) return [];

  const stems = stemsByFolder.get(group.srcFolder) ?? [];
  const found: Companion[] = [];

  for (const path of dir.values()) {
    if (sourcePaths.has(path.toLowerCase())) continue;

    const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
    const apple = name.startsWith('._');
    const bare = apple ? name.slice(2) : name;

    // Longest stem wins, and it has to be THIS group's.
    const owner = stems.find((s) => bare === s || bare.startsWith(s + '.'));
    if (owner !== group.stem) continue;

    const tail = bare.slice(group.stem.length);
    const kind: RenameCompanionKind = apple
      ? 'appledouble'
      : tail.indexOf('.', 1) === -1
        ? 'stem'
        : 'sidecar';

    found.push({ path, name, prefix: apple ? '._' : '', tail, kind });
  }

  // Sorted by name so the plan is a pure function of its inputs — a directory
  // listing's order is the filesystem's, and it differs between NTFS and ext4.
  found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return found;
}

/**
 * The plan's safety post-condition, checked rather than assumed.
 *
 * Throws instead of returning an error, because every branch that could break
 * this is a bug in this file — there is no user input that reaches it. A
 * violation means a rename would land on top of a photo.
 */
function assertNoOverlap(entries: readonly RenamePlanEntry[]): void {
  const moving = entries.filter((e) => e.action === 'rename');
  const targets = new Set<string>();

  for (const entry of moving) {
    const key = entry.targetPath.toLowerCase();
    if (targets.has(key)) {
      throw new Error(`rename plan is not injective: two files target ${entry.targetPath}`);
    }
    targets.add(key);
  }

  for (const entry of entries) {
    if (entry.action === 'rename') continue;
    if (targets.has(entry.src.toLowerCase())) {
      throw new Error(`rename plan would overwrite a file it leaves in place: ${entry.src}`);
    }
  }
  for (const entry of moving) {
    if (targets.has(entry.src.toLowerCase())) {
      throw new Error(`rename plan has a cycle through ${entry.src}`);
    }
  }
}

/** Join a directory and a basename with the separator the directory already uses. */
export function joinPath(folder: string, name: string): string {
  const sep = folder.includes('\\') && !folder.includes('/') ? '\\' : '/';
  return folder.replace(/[\\/]+$/, '') + sep + name;
}
