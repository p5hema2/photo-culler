import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScoringWorker } from '../hooks/useScoringWorker';
import type { QualitySubscores } from '@photo-culler/types';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event?: unknown) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  constructor() {
    FakeWorker.instances.push(this);
  }
}

type ScoreCall = [string, number, QualitySubscores];

let readFile: ReturnType<typeof vi.fn>;

beforeEach(() => {
  FakeWorker.instances = [];
  (globalThis as unknown as { Worker: unknown }).Worker = FakeWorker;
  readFile = vi.fn();
  (globalThis as unknown as { window: { api: unknown } }).window.api = { readFile };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useScoringWorker', () => {
  it('reports the score the worker returns', async () => {
    readFile.mockResolvedValue(new ArrayBuffer(8));
    const calls: ScoreCall[] = [];

    const { result } = renderHook(() => useScoringWorker());

    await act(async () => {
      result.current.scoreAll([{ path: '/A/good.jpg', name: 'good.jpg' }], (n, s, sub) =>
        calls.push([n, s, sub]),
      );
    });

    const worker = FakeWorker.instances[0]!;
    await act(async () => {
      worker.onmessage?.({
        data: {
          path: '/A/good.jpg',
          qualityScore: 77,
          sharpness: 70,
          exposure: 80,
          contrast: 75,
          noise: 83,
        },
      });
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe('good.jpg');
    expect(calls[0]![1]).toBe(77);
  });

  it('reports NO score when the file cannot be read, so it is retried later', async () => {
    // Regression guard: this branch used to fabricate a neutral score of 50.
    // Scores are now persisted, and App.tsx skips any image that already has
    // one — so a placeholder would make a transient read failure permanent.
    readFile.mockRejectedValue(new Error('EBUSY: file locked'));
    const calls: ScoreCall[] = [];

    const { result } = renderHook(() => useScoringWorker());

    await act(async () => {
      result.current.scoreAll([{ path: '/A/locked.jpg', name: 'locked.jpg' }], (n, s, sub) =>
        calls.push([n, s, sub]),
      );
    });

    expect(calls).toEqual([]);
  });

  it('still finishes the run when a read fails, leaving nothing in flight', async () => {
    readFile.mockRejectedValue(new Error('EBUSY: file locked'));
    const calls: ScoreCall[] = [];

    const { result } = renderHook(() => useScoringWorker());

    await act(async () => {
      result.current.scoreAll([{ path: '/A/locked.jpg', name: 'locked.jpg' }], (n, s, sub) =>
        calls.push([n, s, sub]),
      );
    });

    expect(result.current.isScoring).toBe(false);
    expect(FakeWorker.instances[0]!.terminate).toHaveBeenCalled();
  });
});
