import type { ScanProgressState } from '../hooks/usePhotoStore';

interface LoadingStateProps {
  /** Where the scan has got to. See PhotoState.scanProgress. */
  progress: ScanProgressState;
}

/**
 * What the scan is doing, or an empty string while there is nothing to say.
 *
 * Exported because App shows the same sentence in a strip under the toolbar
 * once the grid has painted and the scan is still reading headers: it is one
 * fact and it should read the same in both places. Sentence case for that
 * reason — in the strip it stands on its own.
 */
export function scanDetail(progress: ScanProgressState): string {
  const count = (n: number): string => n.toLocaleString();

  if (progress.phase === 'walking') {
    return progress.found > 0 ? `${count(progress.found)} images found` : '';
  }
  if (progress.phase === 'metadata' && progress.found > 0) {
    return `Reading metadata ${count(progress.completed)}/${count(progress.found)}`;
  }
  return '';
}

/**
 * The blocking phase of opening a folder: the tree walk, plus the screenful of
 * EXIF headers the first frame needs.
 *
 * It reports numbers because it used to report none, and an indeterminate
 * spinner looks the same after two seconds as after twenty — which was half the
 * complaint about opening a 3470-image folder off a spinning disk. The detail
 * line holds its height whether or not it has text, so the spinner and the
 * headline do not jump when the first count arrives.
 */
export function LoadingState({ progress }: LoadingStateProps): React.JSX.Element {
  return (
    <div
      className="flex flex-col items-center justify-center h-full text-gray-400"
      data-testid="loading-state"
    >
      <div className="w-8 h-8 border-2 border-gray-600 border-t-blue-500 rounded-full animate-spin mb-4" />
      <p className="text-lg">Scanning folder...</p>
      <p className="text-sm text-gray-500 mt-2 h-5" data-testid="loading-detail">
        {scanDetail(progress)}
      </p>
    </div>
  );
}
