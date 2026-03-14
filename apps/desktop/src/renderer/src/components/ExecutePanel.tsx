import { useState, useMemo, useCallback } from 'react';
import type { Classification } from '../hooks/usePhotoStore';

export type DeleteMode = 'trash' | 'permanent';

export interface ExecuteOptions {
  deleteMode: DeleteMode;
  movePicks: boolean;
}

export interface ExecuteResult {
  trashedCount: number;
  movedCount: number;
  failedPaths: Array<{ path: string; error: string }>;
}

interface ExecutePanelProps {
  classifications: Record<string, Classification>;
  isOpen: boolean;
  onClose: () => void;
  onExecute: (options: ExecuteOptions) => Promise<ExecuteResult>;
}

export function ExecutePanel({
  classifications,
  isOpen,
  onClose,
  onExecute,
}: ExecutePanelProps): React.JSX.Element | null {
  const [deleteMode, setDeleteMode] = useState<DeleteMode>('trash');
  const [movePicks, setMovePicks] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [result, setResult] = useState<ExecuteResult | null>(null);

  const counts = useMemo(() => {
    const summary = { keep: 0, review: 0, delete: 0 };
    for (const cls of Object.values(classifications)) {
      summary[cls]++;
    }
    return summary;
  }, [classifications]);

  const handleExecuteClick = useCallback(() => {
    setShowConfirm(true);
  }, []);

  const handleConfirm = useCallback(async () => {
    setShowConfirm(false);
    setIsExecuting(true);
    try {
      const res = await onExecute({ deleteMode, movePicks });
      setResult(res);
    } catch {
      setResult({ trashedCount: 0, movedCount: 0, failedPaths: [{ path: '', error: 'Unexpected error' }] });
    } finally {
      setIsExecuting(false);
    }
  }, [onExecute, deleteMode, movePicks]);

  const handleDone = useCallback(() => {
    setResult(null);
    setShowConfirm(false);
    onClose();
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      data-testid="execute-panel-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isExecuting) onClose();
      }}
    >
      <div className="bg-gray-800 rounded-lg shadow-xl p-6 w-[480px] max-w-[90vw]" data-testid="execute-panel">
        {/* Result view */}
        {result ? (
          <div>
            <h2 className="text-lg font-semibold mb-4">Execution Complete</h2>

            <div className="space-y-2 mb-6 text-sm">
              {result.trashedCount > 0 && (
                <p className="text-green-400">
                  {result.trashedCount} image{result.trashedCount !== 1 ? 's' : ''}{' '}
                  {deleteMode === 'trash' ? 'moved to trash' : 'permanently deleted'}
                </p>
              )}
              {result.movedCount > 0 && (
                <p className="text-green-400">
                  {result.movedCount} image{result.movedCount !== 1 ? 's' : ''} moved to picks/
                </p>
              )}
              {result.failedPaths.length > 0 && (
                <div>
                  <p className="text-red-400 mb-1">
                    {result.failedPaths.length} file{result.failedPaths.length !== 1 ? 's' : ''} failed:
                  </p>
                  <ul className="text-xs text-red-300 space-y-0.5 max-h-32 overflow-y-auto">
                    {result.failedPaths.map((f, i) => (
                      <li key={i}>{f.path}: {f.error}</li>
                    ))}
                  </ul>
                </div>
              )}
              {result.trashedCount === 0 && result.movedCount === 0 && result.failedPaths.length === 0 && (
                <p className="text-gray-400">No actions were performed.</p>
              )}
            </div>

            <div className="flex justify-end">
              <button
                onClick={handleDone}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium transition-colors"
                data-testid="execute-done-btn"
              >
                Done
              </button>
            </div>
          </div>
        ) : showConfirm ? (
          /* Confirmation view */
          <div>
            <h2 className="text-lg font-semibold mb-4 text-yellow-400">Confirm Execution</h2>

            <div className="space-y-2 mb-6 text-sm">
              {counts.delete > 0 && (
                <p>
                  {deleteMode === 'trash' ? (
                    <>Move <span className="text-red-400 font-medium">{counts.delete}</span> image{counts.delete !== 1 ? 's' : ''} to trash?</>
                  ) : (
                    <span className="text-red-400 font-medium">
                      Permanently delete {counts.delete} image{counts.delete !== 1 ? 's' : ''}? This cannot be undone!
                    </span>
                  )}
                </p>
              )}
              {movePicks && counts.keep > 0 && (
                <p>
                  Move <span className="text-green-400 font-medium">{counts.keep}</span> keep image{counts.keep !== 1 ? 's' : ''} to picks/ subfolder?
                </p>
              )}
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded text-sm font-medium transition-colors"
                data-testid="execute-back-btn"
              >
                Back
              </button>
              <button
                onClick={handleConfirm}
                className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                  deleteMode === 'permanent'
                    ? 'bg-red-700 hover:bg-red-600'
                    : 'bg-red-600 hover:bg-red-700'
                }`}
                data-testid="execute-confirm-btn"
              >
                {deleteMode === 'permanent' ? 'Permanently Delete' : 'Move to Trash'}
              </button>
            </div>
          </div>
        ) : (
          /* Options view */
          <div>
            <h2 className="text-lg font-semibold mb-4">Execute Actions</h2>

            {/* Classification summary */}
            <div className="mb-6 space-y-1.5 text-sm">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-green-500 inline-block" />
                <span>{counts.keep} image{counts.keep !== 1 ? 's' : ''} marked as Keep</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-yellow-500 inline-block" />
                <span>{counts.review} image{counts.review !== 1 ? 's' : ''} marked as Review</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-red-500 inline-block" />
                <span>{counts.delete} image{counts.delete !== 1 ? 's' : ''} marked as Delete</span>
              </div>
            </div>

            {/* Delete mode selection */}
            <div className="mb-4">
              <p className="text-sm font-medium text-gray-300 mb-2">Action for &apos;delete&apos; images:</p>
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer text-sm" data-testid="mode-trash">
                  <input
                    type="radio"
                    name="deleteMode"
                    value="trash"
                    checked={deleteMode === 'trash'}
                    onChange={() => setDeleteMode('trash')}
                    className="accent-blue-500"
                  />
                  <span>Move to OS Trash</span>
                  <span className="text-gray-500 text-xs">(recoverable)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-sm" data-testid="mode-permanent">
                  <input
                    type="radio"
                    name="deleteMode"
                    value="permanent"
                    checked={deleteMode === 'permanent'}
                    onChange={() => setDeleteMode('permanent')}
                    className="accent-red-500"
                  />
                  <span className="text-red-400">Permanently delete</span>
                  <span className="text-red-500 text-xs">(cannot be undone!)</span>
                </label>
              </div>
            </div>

            {/* Move picks checkbox */}
            <div className="mb-6">
              <label className="flex items-center gap-2 cursor-pointer text-sm" data-testid="move-picks-checkbox">
                <input
                  type="checkbox"
                  checked={movePicks}
                  onChange={(e) => setMovePicks(e.target.checked)}
                  className="accent-green-500"
                />
                <span>Move &apos;keep&apos; images to picks/ subfolder</span>
                {counts.keep > 0 && (
                  <span className="text-gray-500 text-xs">({counts.keep} image{counts.keep !== 1 ? 's' : ''})</span>
                )}
              </label>
            </div>

            {/* Action buttons */}
            <div className="flex justify-end gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded text-sm font-medium transition-colors"
                data-testid="execute-cancel-btn"
              >
                Cancel
              </button>
              <button
                onClick={handleExecuteClick}
                disabled={counts.delete === 0 && !(movePicks && counts.keep > 0)}
                className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                  counts.delete === 0 && !(movePicks && counts.keep > 0)
                    ? 'bg-gray-600 cursor-not-allowed text-gray-400'
                    : 'bg-red-600 hover:bg-red-700'
                }`}
                data-testid="execute-action-btn"
              >
                Execute
              </button>
            </div>
          </div>
        )}

        {/* Loading overlay */}
        {isExecuting && (
          <div className="absolute inset-0 bg-gray-800/90 rounded-lg flex items-center justify-center" data-testid="execute-loading">
            <div className="text-center">
              <div className="w-8 h-8 border-2 border-gray-600 border-t-blue-500 rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm text-gray-300">Executing...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
