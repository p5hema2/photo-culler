import Store from 'electron-store';
import type { SessionConfig } from '@photo-culler/types';

const defaults: SessionConfig = {
  thumbnailSize: 'medium',
  groupingThresholdMs: 5000,
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
  };
}

export function updateSession(partial: Partial<SessionConfig>): void {
  const current = getSession();
  const merged = { ...current, ...partial };
  sessionStore.set(merged);
}
