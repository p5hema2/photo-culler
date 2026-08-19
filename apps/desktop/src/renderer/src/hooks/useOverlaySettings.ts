import { useState, useCallback, useEffect } from 'react';

export interface OverlaySettings {
  showFocusPeaking: boolean;
  showClipping: boolean;
  showAfPoint: boolean;
  focusPeakingThreshold: number;
}

export interface OverlayActions {
  toggleFocusPeaking: () => void;
  toggleClipping: () => void;
  toggleAfPoint: () => void;
  setFocusPeakingThreshold: (value: number) => void;
}

/** Sobel magnitudes on 8-bit input reach ~1442, so 30 flagged nearly everything. */
export const PEAKING_THRESHOLD_MIN = 10;
export const PEAKING_THRESHOLD_MAX = 250;
export const PEAKING_THRESHOLD_STEP = 5;

const DEFAULTS: OverlaySettings = {
  showFocusPeaking: false,
  showClipping: false,
  showAfPoint: false,
  focusPeakingThreshold: 80,
};

/**
 * Overlay visibility and tuning, persisted in the session store.
 *
 * Deliberately separate from usePhotoStore: these are view preferences with no
 * relationship to the folder/results/epoch machinery, and keeping them out
 * means dragging the threshold slider does not re-render the whole photo tree.
 */
export function useOverlaySettings(): { settings: OverlaySettings; actions: OverlayActions } {
  const [settings, setSettings] = useState<OverlaySettings>(DEFAULTS);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const session = await window.api.getSession();
        if (cancelled) return;
        setSettings({
          showFocusPeaking: session.showFocusPeaking ?? DEFAULTS.showFocusPeaking,
          showClipping: session.showClipping ?? DEFAULTS.showClipping,
          showAfPoint: session.showAfPoint ?? DEFAULTS.showAfPoint,
          focusPeakingThreshold: session.focusPeakingThreshold ?? DEFAULTS.focusPeakingThreshold,
        });
      } catch {
        // Keep the defaults; overlays are decorative, never block on this.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Apply locally and write back; the store merges partials. */
  const patch = useCallback((partial: Partial<OverlaySettings>) => {
    setSettings((prev) => ({ ...prev, ...partial }));
    void window.api.setSession(partial).catch(() => {
      // Persisting a preference is best-effort.
    });
  }, []);

  const actions: OverlayActions = {
    toggleFocusPeaking: useCallback(
      () =>
        setSettings((prev) => {
          const next = { ...prev, showFocusPeaking: !prev.showFocusPeaking };
          void window.api.setSession({ showFocusPeaking: next.showFocusPeaking }).catch(() => {});
          return next;
        }),
      [],
    ),
    toggleClipping: useCallback(
      () =>
        setSettings((prev) => {
          const next = { ...prev, showClipping: !prev.showClipping };
          void window.api.setSession({ showClipping: next.showClipping }).catch(() => {});
          return next;
        }),
      [],
    ),
    toggleAfPoint: useCallback(
      () =>
        setSettings((prev) => {
          const next = { ...prev, showAfPoint: !prev.showAfPoint };
          void window.api.setSession({ showAfPoint: next.showAfPoint }).catch(() => {});
          return next;
        }),
      [],
    ),
    setFocusPeakingThreshold: useCallback(
      (value: number) => patch({ focusPeakingThreshold: value }),
      [patch],
    ),
  };

  return { settings, actions };
}
