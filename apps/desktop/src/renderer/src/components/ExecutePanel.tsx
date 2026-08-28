import { useState, useMemo, useCallback } from 'react';
import { MAX_RATING, isInRatingRange } from '@photo-culler/image-utils/rating';
import type { ExecuteOptions, ExecuteResult } from '../hooks/usePhotoStore';
import { DEFAULT_DELETE_RANGE } from '../hooks/usePhotoStore';

interface ExecutePanelProps {
  /**
   * Rating per absolute path for the images the filters currently show —
   * Execute operates on what is visible, so this is also the denominator of
   * every count the panel quotes.
   */
  visibleRatings: Record<string, number>;
  isOpen: boolean;
  onClose: () => void;
  onExecute: (options: ExecuteOptions) => Promise<ExecuteResult>;
}

/** "1 star" / "1-3 stars" — the range always starts at one. */
function formatDeleteRange(max: number): string {
  return max === 1 ? '1 star' : `1-${max} stars`;
}

export function ExecutePanel({
  visibleRatings,
  isOpen,
  onClose,
  onExecute,
}: ExecutePanelProps): React.JSX.Element | null {
  /**
   * The top of the delete window. The bottom is always 1: an unrated image can
   * never be deleted, and that is the safety property of the whole feature.
   */
  const [deleteMax, setDeleteMax] = useState(DEFAULT_DELETE_RANGE.max);
  const [isExecuting, setIsExecuting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [result, setResult] = useState<ExecuteResult | null>(null);

  const deleteRange = useMemo(() => ({ min: 1, max: deleteMax }), [deleteMax]);

  const visibleCount = Object.keys(visibleRatings).length;
  const deleteCount = useMemo(
    () =>
      Object.values(visibleRatings).filter((rating) => isInRatingRange(rating, deleteRange)).length,
    [visibleRatings, deleteRange],
  );

  const handleExecuteClick = useCallback(() => {
    setShowConfirm(true);
  }, []);

  const handleConfirm = useCallback(async () => {
    setShowConfirm(false);
    setIsExecuting(true);
    try {
      const res = await onExecute({ deleteRange });
      setResult(res);
    } catch {
      setResult({
        deletedCount: 0,
        failedPaths: [{ path: '', error: 'Unexpected error' }],
      });
    } finally {
      setIsExecuting(false);
    }
  }, [onExecute, deleteRange]);

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
      <div
        className="bg-gray-800 rounded-lg shadow-xl p-6 w-[480px] max-w-[90vw]"
        data-testid="execute-panel"
      >
        {/* Result view */}
        {result ? (
          <div>
            <h2 className="text-lg font-semibold mb-4">Deletion Complete</h2>

            <div className="space-y-2 mb-6 text-sm">
              {result.deletedCount > 0 && (
                <p className="text-green-400">
                  {result.deletedCount} image{result.deletedCount !== 1 ? 's' : ''} permanently
                  deleted
                </p>
              )}
              {result.failedPaths.length > 0 && (
                <div>
                  <p className="text-red-400 mb-1">
                    {result.failedPaths.length} file{result.failedPaths.length !== 1 ? 's' : ''}{' '}
                    failed:
                  </p>
                  <ul className="text-xs text-red-300 space-y-0.5 max-h-32 overflow-y-auto">
                    {result.failedPaths.map((f, i) => (
                      <li key={i}>
                        {f.path}: {f.error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {result.deletedCount === 0 && result.failedPaths.length === 0 && (
                <p className="text-gray-400">No images were deleted.</p>
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
            <h2 className="text-lg font-semibold mb-4 text-yellow-400">Confirm Deletion</h2>

            <div className="space-y-2 mb-6 text-sm">
              {deleteCount > 0 && (
                <p data-testid="execute-confirm-summary">
                  <span className="text-red-400 font-medium">
                    Permanently delete {deleteCount} of {visibleCount} visible image
                    {visibleCount !== 1 ? 's' : ''}, {formatDeleteRange(deleteMax)}?
                  </span>{' '}
                  <span className="text-gray-400">
                    The files do not go to the trash and cannot be recovered.
                  </span>
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
                  deleteCount > 0 ? 'bg-red-700 hover:bg-red-600' : 'bg-blue-600 hover:bg-blue-700'
                }`}
                data-testid="execute-confirm-btn"
              >
                Confirm
              </button>
            </div>
          </div>
        ) : (
          /* Options view */
          <div>
            <h2 className="text-lg font-semibold mb-1">Delete Rated Images</h2>
            <p className="text-xs text-gray-500 mb-5">
              Deleting is all Execute does — a rotation is written to the file the moment you press
              the key. Deletion is permanent: files are removed, not moved to the trash.
            </p>

            {/* Delete range — the bottom is fixed at one star on purpose */}
            <div className="mb-6">
              <p className="text-sm font-medium text-gray-300 mb-2">
                Delete images rated {formatDeleteRange(deleteMax)}
              </p>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-500 w-4 text-right">1</span>
                <input
                  type="range"
                  min={1}
                  max={MAX_RATING}
                  step={1}
                  value={deleteMax}
                  onChange={(e) => setDeleteMax(Number(e.target.value))}
                  className="flex-1 accent-red-500"
                  aria-label="Highest rating to delete"
                  data-testid="delete-range-slider"
                />
                <span className="text-xs text-gray-500 w-4">{deleteMax}</span>
              </div>
              <p className="text-sm mt-2" data-testid="execute-delete-summary">
                <span className={deleteCount > 0 ? 'text-red-400 font-medium' : 'text-gray-400'}>
                  {deleteCount}
                </span>{' '}
                <span className="text-gray-400">
                  of {visibleCount} visible image{visibleCount !== 1 ? 's' : ''}
                </span>
              </p>
              <p className="text-xs text-gray-600 mt-1">
                Unrated images are never deleted, whatever the range.
              </p>
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
                disabled={deleteCount === 0}
                className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                  deleteCount === 0
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
          <div
            className="absolute inset-0 bg-gray-800/90 rounded-lg flex items-center justify-center"
            data-testid="execute-loading"
          >
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
