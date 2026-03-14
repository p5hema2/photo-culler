import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted to declare the mock data before vi.mock gets hoisted
const { mockStoreData } = vi.hoisted(() => {
  const mockStoreData: Record<string, unknown> = {};
  return { mockStoreData };
});

vi.mock('electron-store', () => {
  return {
    default: class MockStore {
      private defaults: Record<string, unknown>;

      constructor(opts?: { defaults?: Record<string, unknown> }) {
        this.defaults = opts?.defaults ?? {};
        for (const [key, value] of Object.entries(this.defaults)) {
          if (!(key in mockStoreData)) {
            mockStoreData[key] = value;
          }
        }
      }

      get(key: string): unknown {
        return key in mockStoreData ? mockStoreData[key] : this.defaults[key];
      }

      set(keyOrObj: string | Record<string, unknown>, value?: unknown): void {
        if (typeof keyOrObj === 'object') {
          for (const [k, v] of Object.entries(keyOrObj)) {
            mockStoreData[k] = v;
          }
        } else {
          mockStoreData[keyOrObj] = value;
        }
      }
    },
  };
});

// Import after mock is set up
import { getSession, updateSession } from '../store';

describe('store', () => {
  beforeEach(() => {
    for (const key of Object.keys(mockStoreData)) {
      delete mockStoreData[key];
    }
    mockStoreData['thumbnailSize'] = 'medium';
    mockStoreData['groupingThresholdMs'] = 5000;
  });

  describe('getSession', () => {
    it('returns default config', () => {
      const session = getSession();
      expect(session).toEqual({
        lastFolderPath: undefined,
        thumbnailSize: 'medium',
        groupingThresholdMs: 5000,
      });
    });

    it('returns stored values when set', () => {
      mockStoreData['lastFolderPath'] = '/some/path';
      mockStoreData['thumbnailSize'] = 'large';

      const session = getSession();
      expect(session.lastFolderPath).toBe('/some/path');
      expect(session.thumbnailSize).toBe('large');
      expect(session.groupingThresholdMs).toBe(5000);
    });
  });

  describe('updateSession', () => {
    it('updates thumbnailSize without clobbering other fields', () => {
      updateSession({ thumbnailSize: 'large' });

      const session = getSession();
      expect(session.thumbnailSize).toBe('large');
      expect(session.groupingThresholdMs).toBe(5000);
    });

    it('persists lastFolderPath', () => {
      updateSession({ lastFolderPath: '/some/path' });

      const session = getSession();
      expect(session.lastFolderPath).toBe('/some/path');
      expect(session.thumbnailSize).toBe('medium');
    });

    it('partial updates do not clobber unrelated fields', () => {
      updateSession({ thumbnailSize: 'small' });
      updateSession({ groupingThresholdMs: 10000 });

      const session = getSession();
      expect(session.thumbnailSize).toBe('small');
      expect(session.groupingThresholdMs).toBe(10000);
    });

    it('updates multiple fields at once', () => {
      updateSession({
        lastFolderPath: '/photos',
        thumbnailSize: 'large',
        groupingThresholdMs: 2000,
      });

      const session = getSession();
      expect(session.lastFolderPath).toBe('/photos');
      expect(session.thumbnailSize).toBe('large');
      expect(session.groupingThresholdMs).toBe(2000);
    });
  });
});
