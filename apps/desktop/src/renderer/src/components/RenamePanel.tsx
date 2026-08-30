import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  RenameExecuteResult,
  RenamePlan,
  RenamePlanEntry,
  RenameRequest,
} from '@photo-culler/types';

/**
 * The rename preview.
 *
 * Modelled on `ExecutePanel` on purpose: renaming is the second operation in
 * this app that changes a user's files irreversibly, and the two should not
 * look different. It shows what WILL happen before anything does, because a
 * rename moves files the user never selected — the RAW beside the JPEG, the
 * XMP sidecar carrying someone's Lightroom edits — and there is no undo stack.
 *
 * The plan on screen IS the plan that runs. `planRename` returns it, this panel
 * renders it, `applyRename` executes that same object; nothing recomputes in
 * between, so what the user approved is what happens.
 */

/**
 * The two operations this panel previews.
 *
 * One panel rather than two because they produce the SAME plan and are carried
 * out by the same executor — a move is a rename that keeps the basename — so a
 * second dialog would be a second place for the confirmation wording, the
 * failure list and the companion column to drift.
 */
export type PendingPlan =
  | { kind: 'rename'; request: RenameRequest }
  | { kind: 'move'; paths: string[]; targetFolder: string };

interface RenamePanelProps {
  /** What the user asked for. Null closes the panel. */
  pending: PendingPlan | null;
  /** Compute the plan. Writes nothing. */
  onPlan: (
    pending: PendingPlan,
    consolidateDcim: boolean,
  ) => Promise<{ plan: RenamePlan | null; error?: string }>;
  onApply: (plan: RenamePlan) => Promise<RenameExecuteResult | null>;
  onClose: () => void;
}

/** Rows shown before the list is cut off. */
const PREVIEW_ROWS = 200;

const ACTION_LABEL: Record<RenamePlanEntry['action'], string> = {
  rename: 'wird umbenannt',
  unchanged: 'heißt schon richtig',
  'no-date': 'kein Datum in der Datei',
  duplicate: 'inhaltsgleiches Duplikat',
  blocked: 'blockiert',
};

const COMPANION_LABEL: Record<NonNullable<RenamePlanEntry['companionKind']>, string> = {
  stem: 'RAW / Beidatei',
  sidecar: 'XMP-Sidecar',
  appledouble: 'macOS-Zwilling',
};

export function RenamePanel({
  pending,
  onPlan,
  onApply,
  onClose,
}: RenamePanelProps): React.JSX.Element | null {
  const isMove = pending?.kind === 'move';
  const [consolidateDcim, setConsolidateDcim] = useState(true);
  const [plan, setPlan] = useState<RenamePlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPlanning, setIsPlanning] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<RenameExecuteResult | null>(null);

  /**
   * `onPlan` through a ref, so the effect below depends only on the two inputs
   * that actually change the plan.
   *
   * Belt and braces with App's own memoisation: planning reads tags with
   * exiftool and takes seconds on a real folder, and an effect that re-runs on
   * a callback's identity would abandon and restart that work on every render —
   * which during a scan is every metadata batch, so the preview would never
   * settle and its confirm button would never enable.
   */
  const onPlanRef = useRef(onPlan);
  onPlanRef.current = onPlan;

  // Re-plan whenever the target or the consolidation switch changes. The plan is
  // a pure function of the two plus what is on disk, so there is nothing to
  // reconcile — the previous one is simply replaced.
  useEffect(() => {
    if (!pending) {
      setPlan(null);
      setError(null);
      setResult(null);
      return;
    }
    let cancelled = false;
    setIsPlanning(true);
    setError(null);
    void onPlanRef
      .current(pending, consolidateDcim)
      .then((outcome) => {
        if (cancelled) return;
        setPlan(outcome.plan);
        setError(outcome.error ?? null);
      })
      .finally(() => {
        if (!cancelled) setIsPlanning(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pending, consolidateDcim]);

  const moving = useMemo(() => plan?.entries.filter((e) => e.action === 'rename') ?? [], [plan]);
  const problems = useMemo(
    () => plan?.entries.filter((e) => e.action === 'blocked' || e.action === 'duplicate') ?? [],
    [plan],
  );

  const handleApply = useCallback(async () => {
    if (!plan) return;
    setIsRunning(true);
    try {
      setResult(await onApply(plan));
    } finally {
      setIsRunning(false);
    }
  }, [plan, onApply]);

  useEffect(() => {
    if (!pending) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (!isRunning) onClose();
    };
    // Capture, like the context menu: the grid takes focus back on mouseenter,
    // so a handler bound to this element would stop hearing Escape.
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [pending, isRunning, onClose]);

  if (!pending) return null;

  const scopeLabel =
    pending.kind === 'move'
      ? `${pending.paths.length} Datei${pending.paths.length === 1 ? '' : 'en'} nach ${baseName(pending.targetFolder)}`
      : pending.request.target.kind === 'files'
        ? `${pending.request.target.paths.length} ausgewählte Datei${pending.request.target.paths.length === 1 ? '' : 'en'}`
        : pending.request.target.recursive
          ? 'Ordner mit Unterordnern'
          : 'Ordner';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-label={isMove ? 'Dateien verschieben' : 'Dateien umbenennen'}
      data-testid="rename-panel"
      onClick={() => {
        if (!isRunning) onClose();
      }}
    >
      <div
        className="bg-gray-800 rounded-lg shadow-xl p-6 w-[720px] max-w-[92vw]"
        onClick={(e) => e.stopPropagation()}
      >
        {result ? (
          <>
            <h2 className="text-lg font-semibold mb-4">
              {isMove ? 'Verschieben abgeschlossen' : 'Umbenennen abgeschlossen'}
            </h2>
            <div className="space-y-2 mb-6 text-sm">
              <p className="text-green-400">
                {result.renamed} Datei{result.renamed === 1 ? '' : 'en'}{' '}
                {isMove ? 'verschoben' : 'umbenannt'}
              </p>
              {result.failed > 0 && (
                <>
                  <p className="text-red-400 mb-1">
                    {result.failed} fehlgeschlagen — die Datei war vermutlich geöffnet
                  </p>
                  <ul
                    className="text-xs text-red-300 space-y-0.5 max-h-40 overflow-y-auto font-mono"
                    data-testid="rename-failures"
                  >
                    {result.outcomes
                      .filter((o) => !o.ok)
                      .map((o) => (
                        <li key={o.src}>
                          {baseName(o.src)}: {o.error}
                        </li>
                      ))}
                  </ul>
                </>
              )}
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium transition-colors"
              >
                Schließen
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold mb-1">
              {isMove ? 'In einen anderen Ordner verschieben' : 'Nach Aufnahmezeit umbenennen'}
            </h2>
            <p className="text-xs text-gray-500 mb-4">
              {scopeLabel}
              {isMove ? (
                <> · Namen bleiben; nur bei Konflikt kommt ein Inhalts-Suffix dazu</>
              ) : (
                <>
                  {' '}
                  · Format <span className="font-mono">JJJJ-MM-TT SS-MM-SS-mmm</span>, identisch zu
                  rename-by-date
                </>
              )}
            </p>

            {!isMove && (
              <label className="flex items-start gap-2 mb-4 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={consolidateDcim}
                  onChange={(e) => setConsolidateDcim(e.target.checked)}
                  className="mt-0.5"
                  data-testid="rename-consolidate-dcim"
                />
                <span>
                  Unterordner unter <span className="font-mono">DCIM</span> zusammenführen
                  <span className="block text-xs text-gray-500">
                    Verschiebt Dateien aus <span className="font-mono">DCIM/100_PANA</span> direkt
                    nach <span className="font-mono">DCIM</span>. Die einzige Strukturänderung, die
                    ein Umbenennen vornimmt — alles andere bleibt, wo es liegt.
                  </span>
                </span>
              </label>
            )}

            {isPlanning && (
              <p className="text-sm text-gray-400 mb-4" data-testid="rename-planning">
                Plan wird berechnet — die Aufnahmezeiten werden aus den Dateien gelesen…
              </p>
            )}

            {error && (
              <p className="text-sm text-red-400 mb-4" data-testid="rename-error">
                {error}
              </p>
            )}

            {plan && !isPlanning && (
              <>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-sm">
                  <Count
                    label={isMove ? 'verschieben' : 'umbenennen'}
                    value={plan.counts.rename}
                    tone="text-green-400"
                  />
                  <Count
                    label={isMove ? 'liegen schon dort' : 'unverändert'}
                    value={plan.counts.unchanged}
                  />
                  {!isMove && <Count label="ohne Datum" value={plan.counts['no-date']} />}
                  <Count label="Duplikate" value={plan.counts.duplicate} tone="text-yellow-400" />
                  <Count label="blockiert" value={plan.counts.blocked} tone="text-red-400" />
                </div>

                <div className="border border-gray-700 rounded max-h-64 overflow-y-auto mb-4">
                  {moving.length === 0 ? (
                    <p className="p-3 text-sm text-gray-500">
                      Nichts umzubenennen — alle Dateien heißen bereits richtig oder tragen kein
                      brauchbares Datum.
                    </p>
                  ) : (
                    <table className="w-full text-xs font-mono">
                      <tbody>
                        {moving.slice(0, PREVIEW_ROWS).map((entry) => (
                          <tr key={entry.src} className="border-b border-gray-700/50 last:border-0">
                            <td className="px-2 py-1 text-gray-400 truncate max-w-[240px]">
                              {entry.srcName}
                            </td>
                            <td className="px-1 text-gray-600">→</td>
                            <td className="px-2 py-1 text-gray-200 truncate max-w-[280px]">
                              {entry.targetName}
                            </td>
                            <td className="px-2 py-1 text-[10px] text-gray-500 whitespace-nowrap">
                              {entry.companionKind
                                ? COMPANION_LABEL[entry.companionKind]
                                : entry.srcFolder !== entry.targetFolder
                                  ? // The destination's own name, not a
                                    // hardcoded 'DCIM': a rename can only ever
                                    // move a file into a DCIM folder, but a
                                    // move goes wherever the user picked.
                                    `→ ${baseName(entry.targetFolder)}`
                                  : ''}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {moving.length > PREVIEW_ROWS && (
                    <p className="px-2 py-1 text-[11px] text-gray-500">
                      … und {moving.length - PREVIEW_ROWS} weitere
                    </p>
                  )}
                </div>

                {problems.length > 0 && (
                  <details className="mb-4">
                    <summary className="text-xs text-yellow-400 cursor-pointer">
                      {problems.length} Datei{problems.length === 1 ? '' : 'en'} bleibt liegen
                    </summary>
                    <ul className="mt-2 text-[11px] text-gray-400 space-y-0.5 max-h-32 overflow-y-auto font-mono">
                      {problems.map((entry) => (
                        <li key={entry.src}>
                          {entry.srcName} — {entry.reason ?? ACTION_LABEL[entry.action]}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            )}

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={isRunning}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 disabled:opacity-50 rounded text-sm font-medium transition-colors"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={handleApply}
                disabled={isRunning || isPlanning || moving.length === 0}
                data-testid="rename-apply"
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded text-sm font-medium transition-colors"
              >
                {isRunning
                  ? isMove
                    ? 'Wird verschoben…'
                    : 'Wird umbenannt…'
                  : `${moving.length} Datei${moving.length === 1 ? '' : 'en'} ${
                      isMove ? 'verschieben' : 'umbenennen'
                    }`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Count({
  label,
  value,
  tone = 'text-gray-300',
}: {
  label: string;
  value: number;
  tone?: string;
}): React.JSX.Element | null {
  if (value === 0) return null;
  return (
    <span className={tone}>
      <span className="font-mono">{value}</span> {label}
    </span>
  );
}

function baseName(filePath: string): string {
  return filePath.slice(Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')) + 1);
}
