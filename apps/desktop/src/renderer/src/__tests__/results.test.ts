import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ResultsFile, ElectronAPI } from '@photo-culler/types';

// Mock window.api
const mockApi: Partial<ElectronAPI> = {
  loadResults: vi.fn(),
  saveResults: vi.fn(),
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  (globalThis as unknown as { window: { api: Partial<ElectronAPI> } }).window = {
    api: mockApi,
  };
});

afterEach(() => {
  vi.useRealTimers();
});

// Import after mocks are set up -- dynamic import to avoid hoisting issues
async function getResultsModule() {
  // Clear module cache to get fresh imports with current mocks
  return await import('../lib/results');
}

const validResults: ResultsFile = {
  version: 1,
  folderPath: '/Users/test/photos',
  updatedAt: '2026-01-01T00:00:00.000Z',
  images: {
    'IMG_001.jpg': {
      classification: 'keep',
      userOverride: false,
      qualityScore: 0.9,
    },
  },
};

describe('loadResults', () => {
  it('parses valid JSON into ResultsFile', async () => {
    const mod = await getResultsModule();
    vi.mocked(mockApi.loadResults!).mockResolvedValue(JSON.stringify(validResults));

    const result = await mod.loadResults('/Users/test/photos');
    expect(result).toEqual(validResults);
    expect(mockApi.loadResults).toHaveBeenCalledWith('/Users/test/photos');
  });

  it('returns null when no file exists', async () => {
    const mod = await getResultsModule();
    vi.mocked(mockApi.loadResults!).mockResolvedValue(null);

    const result = await mod.loadResults('/Users/test/photos');
    expect(result).toBeNull();
  });

  it('returns null on invalid JSON (graceful degradation)', async () => {
    const mod = await getResultsModule();
    vi.mocked(mockApi.loadResults!).mockResolvedValue('not valid json {{{');

    const result = await mod.loadResults('/Users/test/photos');
    expect(result).toBeNull();
  });

  it('returns null on valid JSON with wrong schema', async () => {
    const mod = await getResultsModule();
    vi.mocked(mockApi.loadResults!).mockResolvedValue(JSON.stringify({ foo: 'bar' }));

    const result = await mod.loadResults('/Users/test/photos');
    expect(result).toBeNull();
  });
});

describe('saveResults', () => {
  it('serializes ResultsFile to JSON with correct structure', async () => {
    const mod = await getResultsModule();
    vi.mocked(mockApi.saveResults!).mockResolvedValue(undefined);

    await mod.saveResults('/Users/test/photos', validResults);

    expect(mockApi.saveResults).toHaveBeenCalledTimes(1);
    const [folderPath, data] = vi.mocked(mockApi.saveResults!).mock.calls[0];
    expect(folderPath).toBe('/Users/test/photos');

    const parsed = JSON.parse(data);
    expect(parsed.version).toBe(1);
    expect(parsed.folderPath).toBe('/Users/test/photos');
    expect(parsed.updatedAt).toBeDefined();
    expect(parsed.images['IMG_001.jpg'].classification).toBe('keep');
  });

  it('updates the timestamp on save', async () => {
    const mod = await getResultsModule();
    vi.mocked(mockApi.saveResults!).mockResolvedValue(undefined);

    const now = new Date('2026-03-14T12:00:00.000Z');
    vi.setSystemTime(now);

    await mod.saveResults('/Users/test/photos', validResults);

    const [, data] = vi.mocked(mockApi.saveResults!).mock.calls[0];
    const parsed = JSON.parse(data);
    expect(parsed.updatedAt).toBe('2026-03-14T12:00:00.000Z');
  });
});

describe('useDebouncedSave', () => {
  it('triggers save after delay, not immediately', async () => {
    const mod = await getResultsModule();
    vi.mocked(mockApi.saveResults!).mockResolvedValue(undefined);

    renderHook(() => mod.useDebouncedSave('/Users/test/photos', validResults, 500));

    // Should not have saved immediately
    expect(mockApi.saveResults).not.toHaveBeenCalled();

    // Advance timer
    vi.advanceTimersByTime(500);

    expect(mockApi.saveResults).toHaveBeenCalledTimes(1);
  });

  it('coalesces multiple rapid changes into single save', async () => {
    const mod = await getResultsModule();
    vi.mocked(mockApi.saveResults!).mockResolvedValue(undefined);

    const { rerender } = renderHook(
      ({ results }) => mod.useDebouncedSave('/Users/test/photos', results, 500),
      { initialProps: { results: validResults } },
    );

    // Make rapid changes
    const updated1 = { ...validResults, updatedAt: '2026-01-02T00:00:00.000Z' };
    rerender({ results: updated1 });

    vi.advanceTimersByTime(200);

    const updated2 = { ...validResults, updatedAt: '2026-01-03T00:00:00.000Z' };
    rerender({ results: updated2 });

    vi.advanceTimersByTime(200);

    // Still should not have saved (timer was reset)
    expect(mockApi.saveResults).not.toHaveBeenCalled();

    // Wait for full delay after last change
    vi.advanceTimersByTime(300);

    expect(mockApi.saveResults).toHaveBeenCalledTimes(1);
  });

  it('flushes on unmount', async () => {
    const mod = await getResultsModule();
    vi.mocked(mockApi.saveResults!).mockResolvedValue(undefined);

    const { unmount } = renderHook(() =>
      mod.useDebouncedSave('/Users/test/photos', validResults, 500),
    );

    // Should not have saved yet
    expect(mockApi.saveResults).not.toHaveBeenCalled();

    // Unmount should flush
    unmount();

    expect(mockApi.saveResults).toHaveBeenCalledTimes(1);
  });
});
