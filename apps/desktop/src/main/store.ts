import Store from 'electron-store';
import type { SessionConfig } from '@photo-culler/types';

const defaults: SessionConfig = {
  thumbnailSize: 'medium',
  groupingThresholdMs: 5000,
  showFocusPeaking: false,
  showClipping: false,
  showAfPoint: false,
  focusPeakingThreshold: 80,
};

const schema = {
  lastFolderPath: { type: 'string' as const },
  thumbnailSize: {
    type: 'string' as const,
    enum: ['small', 'medium', 'large'],
    default: defaults.thumbnailSize,
  },
  groupingThresholdMs: {
    type: 'number' as const,
    default: defaults.groupingThresholdMs,
  },
  showFocusPeaking: { type: 'boolean' as const, default: defaults.showFocusPeaking },
  showClipping: { type: 'boolean' as const, default: defaults.showClipping },
  showAfPoint: { type: 'boolean' as const, default: defaults.showAfPoint },
  focusPeakingThreshold: { type: 'number' as const, default: defaults.focusPeakingThreshold },
};

export const sessionStore = new Store<SessionConfig>({
  name: 'session',
  schema,
  defaults,
});

export function getSession(): SessionConfig {
  return {
    lastFolderPath: sessionStore.get('lastFolderPath'),
    thumbnailSize: sessionStore.get('thumbnailSize'),
    groupingThresholdMs: sessionStore.get('groupingThresholdMs'),
    showFocusPeaking: sessionStore.get('showFocusPeaking'),
    showClipping: sessionStore.get('showClipping'),
    showAfPoint: sessionStore.get('showAfPoint'),
    focusPeakingThreshold: sessionStore.get('focusPeakingThreshold'),
  };
}

export function updateSession(partial: Partial<SessionConfig>): void {
  const current = getSession();
  const merged = { ...current, ...partial };
  sessionStore.set(merged);
}
