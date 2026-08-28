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
 * The `reloadToken` the entries in `cache` were read at.
 *
 * The third path-keyed cache a rotation has to reach. A rotation rewrites a
 * file's EXIF Orientation under an UNCHANGED path, and one field in here is read
 * through it: `focusInfo.exifOrientation`, which is what `AfPointOverlay` maps
 * the AF box into the displayed frame with. Left stale, the photo turns (the
 * `<img>` is re-read for the same reason) and the box stays where it was — 90
 * degrees out, on the one overlay whose whole job is being in the right place.
 *
 * Cleared wholesale rather than per path, matching `fileRevision`'s own
 * reasoning: a rotation is roughly one keypress in 3000, so re-reading the
 * handful of entries the loupe has visited is cheaper than tracking which path
 * moved.
 */
let cacheToken = 0;

/**
 * Deep metadata for the focused image, read on demand.
 *
 * Debounced because arrow-key scrubbing at ~30 keys/s must spawn one exiftool
 * read for the image you land on, not thirty. `ipcRenderer.invoke` cannot be
 * aborted, so late responses are dropped instead: a monotonic request counter
 * plus the echoed `path` guard against a slow read for image A overwriting the
 * state of image B.
 *
 * `reloadToken` is `usePhotoStore`'s `fileRevision`: bumping it drops the cache,
 * because a rotation changes what this hook would read without changing the key
 * it is stored under.
 */
export function useDetailedMetadata(
  path: string | null,
  enabled: boolean,
  reloadToken = 0,
): DetailedMetadataState {
  const [state, setState] = useState<DetailedMetadataState>({ status: 'idle' });
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (reloadToken !== cacheToken) {
      cacheToken = reloadToken;
      cache.clear();
    }

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
  }, [path, enabled, reloadToken]);

  return state;
}
