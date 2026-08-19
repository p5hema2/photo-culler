import { useState, useEffect, useRef } from 'react';
import type { DetailedMetadata } from '@photo-culler/types';

export type DetailedMetadataState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: DetailedMetadata }
  | { status: 'unsupported' }
  | { status: 'error'; message: string };

/** Module-level so arrowing back to an image repaints without a loading flash. */
const cache = new Map<string, DetailedMetadata | null>();
const MAX_CACHE = 50;

/**
 * Deep metadata for the focused image, read on demand.
 *
 * Debounced because arrow-key scrubbing at ~30 keys/s must spawn one exiftool
 * read for the image you land on, not thirty. `ipcRenderer.invoke` cannot be
 * aborted, so late responses are dropped instead: a monotonic request counter
 * plus the echoed `path` guard against a slow read for image A overwriting the
 * state of image B.
 */
export function useDetailedMetadata(path: string | null, enabled: boolean): DetailedMetadataState {
  const [state, setState] = useState<DetailedMetadataState>({ status: 'idle' });
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!path || !enabled) {
      setState({ status: 'idle' });
      return;
    }

    const cached = cache.get(path);
    if (cached !== undefined) {
      setState(cached ? { status: 'ready', data: cached } : { status: 'unsupported' });
      return;
    }

    const requestId = ++requestIdRef.current;
    let cancelled = false;
    setState({ status: 'loading' });

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const data = await window.api.readDetailedMetadata(path);
          if (cancelled || requestId !== requestIdRef.current) return;

          cache.set(path, data);
          if (cache.size > MAX_CACHE) {
            const oldest = cache.keys().next().value;
            if (oldest !== undefined) cache.delete(oldest);
          }

          // Belt and braces: the payload echoes its own path.
          if (data && data.path !== path) return;
          setState(data ? { status: 'ready', data } : { status: 'unsupported' });
        } catch (err) {
          if (cancelled || requestId !== requestIdRef.current) return;
          setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
        }
      })();
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [path, enabled]);

  return state;
}
