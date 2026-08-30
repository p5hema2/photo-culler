/**
 * The rename contract.
 *
 * Lives here rather than in `@photo-culler/image-utils`, where the planner that
 * produces it lives, for one structural reason: image-utils depends on this
 * package, so a type declared there cannot appear in an IPC signature. The
 * planner imports these back.
 */

export type RenameAction =
  /** Moves, or gets a new name, or both. */
  | 'rename'
  /** Already sits at exactly this path under exactly this name. */
  | 'unchanged'
  /** No plausible timestamp on any rung — left completely alone. */
  | 'no-date'
  /** Byte-identical to a file already holding the target name. Left alone. */
  | 'duplicate'
  /** Cannot be named safely. Left alone, with a reason the user can read. */
  | 'blocked';

/**
 * Why a file is being carried along with the photo it belongs to.
 *
 * None of these are files the app itself lists — the scanner admits stills and
 * videos and nothing else — which is exactly why they need naming: renaming a
 * JPEG and leaving `IMG_1234.ARW` behind dissolves the pair Lightroom, Capture
 * One and Bridge all identify BY STEM, permanently and silently.
 */
export type RenameCompanionKind =
  /** Same stem, different extension: the RAW, a `.THM`, an `.LRV`, an `.AAE`. */
  | 'stem'
  /** `IMG_1234.ARW.xmp` — a sidecar named after the whole filename. */
  | 'sidecar'
  /** `._IMG_1234.JPG` — the macOS resource fork every exFAT card collects. */
  | 'appledouble';

export interface RenamePlanEntry {
  src: string;
  srcFolder: string;
  srcName: string;
  /** Where it ends up. Equal to `srcFolder` unless DCIM consolidation moved it. */
  targetFolder: string;
  targetName: string;
  targetPath: string;
  action: RenameAction;
  /** Which rung of the tag ladder named it. Null when nothing did. */
  tag: string | null;
  /** Present whenever `action` is not 'rename' or 'unchanged'. */
  reason?: string;
  /**
   * Set on an entry the user never selected, which is moving only because the
   * photo it belongs to is. Holds that photo's source path.
   */
  companionOf?: string;
  companionKind?: RenameCompanionKind;
}

export interface RenamePlan {
  entries: RenamePlanEntry[];
  /** Count per action, so a preview does not have to re-tally. */
  counts: Record<RenameAction, number>;
  /** Every directory a file leaves or arrives in. */
  touchedFolders: string[];
}

/** What the user right-clicked on. */
export type RenameTarget =
  /** Exactly these files, plus whatever travels with them by stem. */
  | { kind: 'files'; paths: string[] }
  /** Everything media the app can see in this directory. */
  | { kind: 'folder'; folder: string; recursive: boolean };

export interface RenameRequest {
  target: RenameTarget;
  /**
   * Lift files out of subfolders of a `DCIM` directory into that directory.
   * The only structural change a rename is allowed to make.
   */
  consolidateDcim: boolean;
}

export interface RenamePlanResult {
  plan: RenamePlan | null;
  /** Set when the plan could not be computed at all. */
  error?: string;
}

/** One file's outcome, reported individually — Windows can refuse any single one. */
export interface RenameOutcome {
  src: string;
  targetPath: string;
  ok: boolean;
  error?: string;
}

export interface RenameExecuteResult {
  outcomes: RenameOutcome[];
  renamed: number;
  failed: number;
  /** Results files whose records were re-keyed, for the renderer to reload. */
  resultsFilesTouched: string[];
  error?: string;
}
