import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { ImageFileInfo, Classification, ResultsFile, SessionConfig } from '@photo-culler/types';
import { sortImages, groupByTimestamp } from '@photo-culler/image-utils';
import type { SortField, SortDirection, PhotoGroup } from '@photo-culler/image-utils';
import { loadResults, saveResults } from '../lib/results';
import { useExifExtractor } from './useExifExtractor';
import { useThumbnailWorker } from './useThumbnailWorker';

export interface PhotoState {
  folderPath: string | null;
  images: ImageFileInfo[];
  classifications: Record<string, Classification>;
  sortField: SortField;
  sortDirection: SortDirection;
  filterExtensions: Set<string>;
  filterClassification: Classification | null;
  searchQuery: string;
  thumbnailSize: 'small' | 'medium' | 'large';
  groupingThresholdMs: number;
  isLoading: boolean;
  exifProgress: { completed: number; total: number };
  focusedImageId: string | null;
  error: string | null;
}

export type Classification = 'keep' | 'review' | 'delete';

const THUMBNAIL_SIZE_MAP: Record<string, number> = {
  small: 120,
  medium: 200,
  large: 300,
};

const initialState: PhotoState = {
  folderPath: null,
  images: [],
  classifications: {},
  sortField: 'dateTaken',
  sortDirection: 'asc',
  filterExtensions: new Set<string>(),
  filterClassification: null,
  searchQuery: '',
  thumbnailSize: 'medium',
  groupingThresholdMs: 5000,
  isLoading: false,
  exifProgress: { completed: 0, total: 0 },
  focusedImageId: null,
  error: null,
};

export interface PhotoStoreAPI {
  state: PhotoState;
  groups: PhotoGroup[];
  filteredImages: ImageFileInfo[];
  thumbnailWorker: ReturnType<typeof useThumbnailWorker>;
  openFolder: (folderPath: string) => Promise<void>;
  setClassification: (filename: string, classification: Classification) => void;
  cycleClassification: (filename: string) => void;
  setSortField: (field: SortField) => void;
  setSortDirection: (direction: SortDirection) => void;
  setFilterExtensions: (extensions: Set<string>) => void;
  setFilterClassification: (classification: Classification | null) => void;
  setSearchQuery: (query: string) => void;
  setThumbnailSize: (size: 'small' | 'medium' | 'large') => void;
  setGroupingThresholdMs: (ms: number) => void;
  setFocusedImage: (path: string | null) => void;
  clearError: () => void;
}

export function usePhotoStore(): PhotoStoreAPI {
  const [state, setState] = useState<PhotoState>(initialState);
  const thumbnailWorker = useThumbnailWorker();
  const exifExtractor = useExifExtractor();
  const resultsRef = useRef<ResultsFile | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // Track mounted state
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Debounced save
  const scheduleSave = useCallback((folderPath: string, classifications: Record<string, Classification>) => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      if (resultsRef.current) {
        const updated: ResultsFile = {
          ...resultsRef.current,
          images: Object.fromEntries(
            Object.entries(classifications).map(([k, v]) => [
              k,
              {
                classification: v,
                userOverride: resultsRef.current?.images[k]?.userOverride ?? false,
                qualityScore: resultsRef.current?.images[k]?.qualityScore,
              },
            ]),
          ),
        };
        resultsRef.current = updated;
        saveResults(folderPath, updated);
      }
    }, 500);
  }, []);

  // Flush save on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  // Update exif progress from hook
  useEffect(() => {
    setState((prev) => ({
      ...prev,
      exifProgress: exifExtractor.progress,
    }));
  }, [exifExtractor.progress]);

  const openFolder = useCallback(
    async (folderPath: string) => {
      setState((prev) => ({
        ...prev,
        isLoading: true,
        error: null,
        folderPath,
        images: [],
        classifications: {},
        focusedImageId: null,
      }));

      thumbnailWorker.clearAll();

      try {
        const images = await window.api.scanFolder(folderPath);

        // Load existing results
        const results = await loadResults(folderPath);
        const classifications: Record<string, Classification> = {};

        for (const img of images) {
          if (results?.images[img.name]) {
            classifications[img.name] = results.images[img.name].classification;
          } else {
            classifications[img.name] = 'review';
          }
        }

        // Create or update results file
        resultsRef.current = results ?? {
          version: 1,
          folderPath,
          updatedAt: new Date().toISOString(),
          images: Object.fromEntries(
            Object.entries(classifications).map(([k, v]) => [
              k,
              { classification: v, userOverride: false },
            ]),
          ),
        };

        if (!mountedRef.current) return;

        setState((prev) => ({
          ...prev,
          images,
          classifications,
          isLoading: false,
        }));

        // Trigger EXIF extraction
        exifExtractor.extractAll(
          images.map((img) => ({
            path: img.path,
            url: `app://${encodeURIComponent(img.path)}`,
          })),
          (path, dateTaken, width, height) => {
            if (!mountedRef.current) return;
            setState((prev) => ({
              ...prev,
              images: prev.images.map((img) =>
                img.path === path
                  ? {
                      ...img,
                      dateTaken: dateTaken ?? undefined,
                      width: width ?? undefined,
                      height: height ?? undefined,
                    }
                  : img,
              ),
            }));
          },
        );

        // Save session
        window.api.setSession({ lastFolderPath: folderPath });
      } catch (err) {
        if (!mountedRef.current) return;
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: `Cannot access ${folderPath} -- check permissions`,
        }));
      }
    },
    [thumbnailWorker, exifExtractor],
  );

  const setClassification = useCallback(
    (filename: string, classification: Classification) => {
      setState((prev) => {
        const next = {
          ...prev,
          classifications: { ...prev.classifications, [filename]: classification },
        };
        if (prev.folderPath) {
          // Update results ref
          if (resultsRef.current) {
            resultsRef.current = {
              ...resultsRef.current,
              images: {
                ...resultsRef.current.images,
                [filename]: {
                  classification,
                  userOverride: true,
                  qualityScore: resultsRef.current.images[filename]?.qualityScore,
                },
              },
            };
          }
          scheduleSave(prev.folderPath, next.classifications);
        }
        return next;
      });
    },
    [scheduleSave],
  );

  const cycleClassification = useCallback(
    (filename: string) => {
      setState((prev) => {
        const current = prev.classifications[filename] ?? 'review';
        const cycle: Record<Classification, Classification> = {
          review: 'keep',
          keep: 'delete',
          delete: 'review',
        };
        const next = cycle[current];
        const newClassifications = { ...prev.classifications, [filename]: next };
        if (prev.folderPath) {
          if (resultsRef.current) {
            resultsRef.current = {
              ...resultsRef.current,
              images: {
                ...resultsRef.current.images,
                [filename]: {
                  classification: next,
                  userOverride: true,
                  qualityScore: resultsRef.current.images[filename]?.qualityScore,
                },
              },
            };
          }
          scheduleSave(prev.folderPath, newClassifications);
        }
        return { ...prev, classifications: newClassifications };
      });
    },
    [scheduleSave],
  );

  const setSortField = useCallback((field: SortField) => {
    setState((prev) => ({ ...prev, sortField: field }));
  }, []);

  const setSortDirection = useCallback((direction: SortDirection) => {
    setState((prev) => ({ ...prev, sortDirection: direction }));
  }, []);

  const setFilterExtensions = useCallback((extensions: Set<string>) => {
    setState((prev) => ({ ...prev, filterExtensions: extensions }));
  }, []);

  const setFilterClassification = useCallback((classification: Classification | null) => {
    setState((prev) => ({ ...prev, filterClassification: classification }));
  }, []);

  const setSearchQuery = useCallback((query: string) => {
    setState((prev) => ({ ...prev, searchQuery: query }));
  }, []);

  const setThumbnailSize = useCallback((size: 'small' | 'medium' | 'large') => {
    setState((prev) => ({ ...prev, thumbnailSize: size }));
    window.api.setSession({ thumbnailSize: size });
  }, []);

  const setGroupingThresholdMs = useCallback((ms: number) => {
    setState((prev) => ({ ...prev, groupingThresholdMs: ms }));
    window.api.setSession({ groupingThresholdMs: ms });
  }, []);

  const setFocusedImage = useCallback((path: string | null) => {
    setState((prev) => ({ ...prev, focusedImageId: path }));
  }, []);

  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  // Derived state
  const filteredImages = useMemo(() => {
    let result = state.images;

    // Extension filter
    if (state.filterExtensions.size > 0) {
      result = result.filter((img) => state.filterExtensions.has(img.extension.toLowerCase()));
    }

    // Classification filter
    if (state.filterClassification) {
      result = result.filter(
        (img) => (state.classifications[img.name] ?? 'review') === state.filterClassification,
      );
    }

    // Search query
    if (state.searchQuery.trim()) {
      const query = state.searchQuery.toLowerCase().trim();
      result = result.filter((img) => img.name.toLowerCase().includes(query));
    }

    return result;
  }, [state.images, state.filterExtensions, state.filterClassification, state.searchQuery, state.classifications]);

  const sortedImages = useMemo(() => {
    return sortImages(filteredImages, state.sortField, state.sortDirection);
  }, [filteredImages, state.sortField, state.sortDirection]);

  const groups = useMemo(() => {
    return groupByTimestamp(sortedImages, state.groupingThresholdMs);
  }, [sortedImages, state.groupingThresholdMs]);

  // Auto-open last folder on mount
  useEffect(() => {
    let cancelled = false;
    const init = async (): Promise<void> => {
      try {
        const session = await window.api.getSession();
        if (cancelled) return;
        if (session.thumbnailSize) {
          setState((prev) => ({
            ...prev,
            thumbnailSize: session.thumbnailSize,
            groupingThresholdMs: session.groupingThresholdMs ?? 5000,
          }));
        }
        if (session.lastFolderPath) {
          openFolder(session.lastFolderPath);
        }
      } catch {
        // Session not available, ignore
      }
    };
    init();
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    state,
    groups,
    filteredImages,
    thumbnailWorker,
    openFolder,
    setClassification,
    cycleClassification,
    setSortField,
    setSortDirection,
    setFilterExtensions,
    setFilterClassification,
    setSearchQuery,
    setThumbnailSize,
    setGroupingThresholdMs,
    setFocusedImage,
    clearError,
  };
}

export { THUMBNAIL_SIZE_MAP };
export type { SortField, SortDirection, PhotoGroup };
