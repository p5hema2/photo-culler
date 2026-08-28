import { useCallback, useEffect, useRef, useState } from 'react';

const mimeMap: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  heic: 'image/jpeg',
};

/** Container type for the Blob an original is wrapped in before decoding. */
export function mimeForPath(path: string): string {
  const dot = path.lastIndexOf('.');
  const ext = dot >= 0 ? path.slice(dot + 1).toLowerCase() : '';
  return mimeMap[ext] ?? 'image/jpeg';
}

export interface FullImage {
  /** Object URL of a full-resolution original, or null before the first read lands. */
  url: string | null;
  /**
   * Path `url` was read from. It LAGS `path` while a read is in flight, because
   * the image on screen is kept until the next one is ready. Callers compare the
   * two to tell "this is the photo you asked for" from "this is the last one".
   */
  urlPath: string | null;
  /** A read for `path` is scheduled or outstanding. */
  isLoading: boolean;
}

export interface UseFullImageOptions {
  /**
   * Paths worth reading ahead — in practice the +/-1 neighbours in visible
   * order. They double as the keep set: anything cached and not named here is
   * revoked, which is what bounds the cache and what clears the previous
   * folder's URLs once focus lands in a new one.
   */
  neighbours?: string[];
  /**
   * Delay before a read starts, so key repeat costs one read instead of one per
   * keypress. A cache hit ignores it — nothing is read, so nothing is waited on.
   *
   * The read itself is NOT abortable: `ipcRenderer.invoke` has no cancellation,
   * so a request already sent runs to completion and only its result is
   * dropped. Delaying the send is therefore the only way to not pay for an
   * image the user is scrolling past — and at 6.2 MB average off a spinning
   * disk, paying for it is what makes the next keypress wait.
   */
  debounceMs?: number;
  /**
   * Bumped by the caller when the BYTES behind a path may have changed under it.
   *
   * A rotation is the case that needs it: it rewrites the file's EXIF
   * Orientation tag in place, so the path is identical and nothing here would
   * otherwise notice — the URL on screen and every prefetched neighbour were
   * decoded from the old bytes, and the browser has already applied the old
   * orientation to them. A change to this value releases the lot and re-reads
   * the focused image.
   */
  reloadToken?: number;
}

/**
 * The full-resolution original for one image, with its neighbours read ahead.
 *
 * Extracted from the loupe, which has always prefetched and therefore always
 * felt quicker on an arrow key than the grid did — the grid's info panel read
 * 6.2 MB on the keypress itself. Both mount this now.
 *
 * Object-URL ownership is exclusive and that is the whole safety story: a URL
 * lives either in `cacheRef` or in `shownRef`, never both, so nothing is revoked
 * twice and nothing is dropped unrevoked. Getting it wrong leaks a whole
 * original — 6 MB a keypress.
 */
export function useFullImage(path: string | null, options: UseFullImageOptions = {}): FullImage {
  const { neighbours = [], debounceMs = 0, reloadToken = 0 } = options;

  const [state, setState] = useState<FullImage>({ url: null, urlPath: null, isLoading: false });

  /** Prefetched originals that are not on screen. */
  const cacheRef = useRef<Map<string, string>>(new Map());
  /** The original the caller is currently rendering. */
  const shownRef = useRef<{ path: string; url: string } | null>(null);
  /** Reads already sent, so a prefetch is never issued twice for one path. */
  const inflightRef = useRef<Set<string>>(new Set());
  /**
   * `isLoading`, but readable inside the same commit that sets it. The prefetch
   * effect runs immediately after the load effect on a focus change, and at that
   * point the state it rendered with still says "idle" — gating on it alone let
   * the neighbours be requested ahead of the image being waited for.
   */
  const loadingRef = useRef(false);
  /**
   * Bumped on every wholesale release. A read that resolves against an old
   * epoch belongs to a folder we have left: it revokes its URL instead of
   * storing it.
   */
  const epochRef = useRef(0);
  /** The `reloadToken` the URLs we hold were read under. */
  const reloadRef = useRef(reloadToken);

  /**
   * Read every render so the prefetch effect can use the current list without
   * taking the array's identity as a dependency — callers build it inline.
   */
  const neighboursRef = useRef(neighbours);
  neighboursRef.current = neighbours;
  // Serialised rather than joined: no two different lists can then collide on
  // one key, whatever separator character a path happens to contain.
  const neighbourKey = JSON.stringify(neighbours);

  const releaseAll = useCallback(() => {
    epochRef.current += 1;
    for (const url of cacheRef.current.values()) URL.revokeObjectURL(url);
    cacheRef.current.clear();
    if (shownRef.current) URL.revokeObjectURL(shownRef.current.url);
    shownRef.current = null;
  }, []);

  /** Hand a freshly read original to the caller and take ownership of it. */
  const show = useCallback((forPath: string, url: string) => {
    loadingRef.current = false;
    const previous = shownRef.current;
    shownRef.current = { path: forPath, url };
    if (previous) {
      // The image being left is usually the neighbour we walk back to, so it
      // moves into the cache rather than being revoked; the prune in the
      // prefetch effect is what bounds that.
      if (previous.path !== forPath && !cacheRef.current.has(previous.path)) {
        cacheRef.current.set(previous.path, previous.url);
      } else {
        URL.revokeObjectURL(previous.url);
      }
    }
    setState({ url, urlPath: forPath, isLoading: false });
  }, []);

  // Load the focused original.
  useEffect(() => {
    if (reloadRef.current !== reloadToken) {
      reloadRef.current = reloadToken;
      // Every URL we hold was decoded from bytes that have since changed. State
      // is deliberately NOT cleared with them: revoking an object URL does not
      // un-paint the <img> already showing it, so the caller keeps the picture
      // it has until the re-read lands, rather than blanking for the ~100 ms a
      // 6.2 MB original takes. shownRef is null afterwards, so the two early
      // returns below fall through to that read.
      releaseAll();
    }

    if (!path) {
      loadingRef.current = false;
      releaseAll();
      setState({ url: null, urlPath: null, isLoading: false });
      return;
    }

    if (shownRef.current?.path === path) {
      loadingRef.current = false;
      setState((prev) => (prev.isLoading ? { ...prev, isLoading: false } : prev));
      return;
    }

    const cached = cacheRef.current.get(path);
    if (cached) {
      // Ownership transfers out of the cache, so a later prune cannot revoke a
      // URL the caller is still rendering.
      cacheRef.current.delete(path);
      show(path, cached);
      return;
    }

    const epoch = epochRef.current;
    let cancelled = false;
    loadingRef.current = true;
    setState((prev) => ({ ...prev, isLoading: true }));

    const timer = setTimeout(() => {
      inflightRef.current.add(path);
      void (async () => {
        try {
          const buffer = await window.api.readFile(path);
          const url = URL.createObjectURL(new Blob([buffer], { type: mimeForPath(path) }));
          if (cancelled || epoch !== epochRef.current) {
            URL.revokeObjectURL(url);
            return;
          }
          show(path, url);
        } catch {
          if (cancelled || epoch !== epochRef.current) return;
          // An unreadable original must not leave the previous photo on screen
          // under this one's filename.
          if (shownRef.current) {
            URL.revokeObjectURL(shownRef.current.url);
            shownRef.current = null;
          }
          loadingRef.current = false;
          setState({ url: null, urlPath: null, isLoading: false });
        } finally {
          inflightRef.current.delete(path);
        }
      })();
    }, debounceMs);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [path, debounceMs, reloadToken, show, releaseAll]);

  // Prune to the keep set, then read the neighbours. Gated on the visible read
  // having landed: a prefetch that overtakes it would put the image the user is
  // waiting for behind two others on a disk that manages ~7 files/s.
  useEffect(() => {
    if (!path || state.isLoading || loadingRef.current) return;

    const wanted = neighboursRef.current;
    const keep = new Set([path, ...wanted]);
    for (const [key, url] of cacheRef.current) {
      if (keep.has(key)) continue;
      URL.revokeObjectURL(url);
      cacheRef.current.delete(key);
    }

    const epoch = epochRef.current;
    for (const neighbour of wanted) {
      if (neighbour === path || neighbour === shownRef.current?.path) continue;
      if (cacheRef.current.has(neighbour) || inflightRef.current.has(neighbour)) continue;
      inflightRef.current.add(neighbour);
      void (async () => {
        try {
          const buffer = await window.api.readFile(neighbour);
          const url = URL.createObjectURL(new Blob([buffer], { type: mimeForPath(neighbour) }));
          // The user may have arrived at this image in the meantime, in which
          // case its own read owns the URL on screen and this one is surplus.
          if (
            epoch !== epochRef.current ||
            cacheRef.current.has(neighbour) ||
            shownRef.current?.path === neighbour
          ) {
            URL.revokeObjectURL(url);
            return;
          }
          cacheRef.current.set(neighbour, url);
        } catch {
          /* A failed prefetch costs nothing — the visible read reports it. */
        } finally {
          inflightRef.current.delete(neighbour);
        }
      })();
    }
    // neighbourKey stands in for the neighbours array, whose identity changes
    // every render.
  }, [path, state.isLoading, neighbourKey]);

  // Unmount: everything goes, including reads still in flight.
  useEffect(() => releaseAll, [releaseAll]);

  return state;
}
