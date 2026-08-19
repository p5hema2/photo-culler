import { useState, useEffect, useRef, useCallback } from 'react';
import type { OverlaySettings, OverlayActions } from '../hooks/useOverlaySettings';
import {
  PEAKING_THRESHOLD_MIN,
  PEAKING_THRESHOLD_MAX,
  PEAKING_THRESHOLD_STEP,
} from '../hooks/useOverlaySettings';

/**
 * `panel` reproduces the InfoPanel's opaque pills. `hud` is for the floating
 * cluster over the loupe/filmstrip image, where an opaque grey pill on top of a
 * photo reads as a rendering bug — it matches the existing MetadataOverlay's
 * translucent, blurred treatment instead.
 */
type Surface = 'panel' | 'hud';
type Accent = 'cyan' | 'red' | 'amber';

const BASE = 'px-3 py-1 text-xs rounded-full border transition-colors';

const ACTIVE: Record<Surface, Record<Accent, string>> = {
  panel: {
    cyan: 'bg-cyan-900 text-cyan-300 border-cyan-500',
    red: 'bg-red-900 text-red-300 border-red-500',
    amber: 'bg-amber-900 text-amber-300 border-amber-500',
  },
  hud: {
    cyan: 'bg-cyan-900/85 text-cyan-300 border-cyan-500 backdrop-blur-sm',
    red: 'bg-red-900/85 text-red-300 border-red-500 backdrop-blur-sm',
    amber: 'bg-amber-900/85 text-amber-300 border-amber-500 backdrop-blur-sm',
  },
};

const INACTIVE: Record<Surface, string> = {
  panel: 'bg-gray-800 text-gray-400 border-gray-600 hover:border-gray-500',
  hud: 'bg-gray-800/80 text-gray-300 border-gray-600/70 hover:border-gray-500 backdrop-blur-sm',
};

export function OverlayTogglePill({
  label,
  active,
  accent,
  surface,
  onClick,
  testId,
  title,
}: {
  label: string;
  active: boolean;
  accent: Accent;
  surface: Surface;
  onClick: () => void;
  testId: string;
  title?: string;
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`${BASE} ${active ? ACTIVE[surface][accent] : INACTIVE[surface]}`}
      data-testid={testId}
      title={title}
    >
      {label}
    </button>
  );
}

interface OverlayControlsProps {
  settings: OverlaySettings;
  actions: OverlayActions;
  surface: Surface;
  /** Hide the AF pill when the focused image carries no AF data. */
  afAvailable?: boolean;
}

/**
 * The overlay toggles, defined once so grid, loupe and filmstrip stay in sync.
 * Previously these lived only inside InfoPanel, which unmounts outside the grid
 * layout — so there was no way to toggle an overlay from loupe or filmstrip.
 */
export function OverlayControls({
  settings,
  actions,
  surface,
  afAvailable = true,
}: OverlayControlsProps): React.JSX.Element {
  // Local value so the slider thumb tracks the pointer; the commit is debounced.
  const [localThreshold, setLocalThreshold] = useState(settings.focusPeakingThreshold);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocalThreshold(settings.focusPeakingThreshold);
  }, [settings.focusPeakingThreshold]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleThreshold = useCallback(
    (value: number) => {
      setLocalThreshold(value);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        actions.setFocusPeakingThreshold(value);
      }, 150);
    },
    [actions],
  );

  return (
    <div className="flex flex-col gap-1" data-testid="overlay-controls">
      <div className="flex gap-2 flex-wrap">
        <OverlayTogglePill
          label="Focus Peaking"
          active={settings.showFocusPeaking}
          accent="cyan"
          surface={surface}
          onClick={actions.toggleFocusPeaking}
          testId="toggle-focus-peaking"
          title="Highlight in-focus edges (P)"
        />
        <OverlayTogglePill
          label="Clipping"
          active={settings.showClipping}
          accent="red"
          surface={surface}
          onClick={actions.toggleClipping}
          testId="toggle-clipping"
          title="Highlight blown highlights and crushed shadows (C)"
        />
        {afAvailable && (
          <OverlayTogglePill
            label="AF Point"
            active={settings.showAfPoint}
            accent="amber"
            surface={surface}
            onClick={actions.toggleAfPoint}
            testId="toggle-af-point"
            title="Show where the camera focused (A)"
          />
        )}
      </div>

      {settings.showFocusPeaking && (
        <>
          <div
            className={`text-[10px] uppercase tracking-wider px-1 mt-1 ${
              surface === 'hud' ? 'text-gray-300' : 'text-gray-500'
            }`}
          >
            Peaking threshold: {localThreshold}
          </div>
          <input
            type="range"
            min={PEAKING_THRESHOLD_MIN}
            max={PEAKING_THRESHOLD_MAX}
            step={PEAKING_THRESHOLD_STEP}
            value={localThreshold}
            onChange={(e) => handleThreshold(Number(e.target.value))}
            className="w-full accent-cyan-500"
            data-testid="focus-peaking-threshold"
          />
        </>
      )}
    </div>
  );
}
