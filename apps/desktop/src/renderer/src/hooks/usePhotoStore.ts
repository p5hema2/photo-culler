import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { ImageFileInfo, ResultsFile, SessionConfig } from '@photo-culler/types';
import { sortImages } from '@photo-culler/image-utils/sorting';
import type { SortField, SortDirection } from '@photo-culler/image-utils/sorting';
import { groupByTimestamp } from '@photo-culler/image-utils/grouping';
import type { PhotoGroup } from '@photo-culler/image-utils/grouping';
import { loadResults, saveResults } from '../lib/results';
import { useExifExtractor } from './useExifExtractor';
import { useThumbnailWorker } from './useThumbnailWorker';
import type { ExecuteOptions, ExecuteResult } from '../components/ExecutePanel';

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
  executeActions: (options: ExecuteOptions) => Promise<ExecuteResult>;
}

export function usePhotoStore(): PhotoStoreAPI {
  const [state, setState] = useState<PhotoState>(initialState);
  const thumbnailWorker = useThumbnailWorker();
  const exifExtractor = useExifExtractor();
  const resultsRef = useRef<ResultsFile | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const stateRef = useRef(state);

  // Keep stateRef in sync
  stateRef.current = state;

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

  // Flush save on beforeunload
  useEffect(() => {
    const handleBeforeUnload = (): void => {
      if (saveTimerRef.current && resultsRef.current && stateRef.current.folderPath) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        // Best-effort save -- IPC call fires but page may unload before completion
        saveResults(stateRef.current.folderPath, resultsRef.current);
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
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

  const executeActions = useCallback(
    async (options: ExecuteOptions): Promise<ExecuteResult> => {
      const current = stateRef.current;
      if (!current.folderPath) {
        return { trashedCount: 0, movedCount: 0, failedPaths: [] };
      }

      const folderPath = current.folderPath;
      const executeResult: ExecuteResult = { trashedCount: 0, movedCount: 0, failedPaths: [] };

      // Get paths of delete-classified images
      const deletePaths = current.images
        .filter((img) => (current.classifications[img.name] ?? 'review') === 'delete')
        .map((img) => img.path);

      // Execute delete/trash
      if (deletePaths.length > 0) {
        const deleteResult =
          options.deleteMode === 'trash'
            ? await window.api.trashFiles(deletePaths)
            : await window.api.deleteFiles(deletePaths);

        executeResult.trashedCount = deleteResult.succeeded.length;
        executeResult.failedPaths.push(...deleteResult.failed);
      }

      // Move keep images to picks/ if requested
      let moveSucceeded: string[] = [];
      if (options.movePicks) {
        const keepPaths = current.images
          .filter((img) => (current.classifications[img.name] ?? 'review') === 'keep')
          .map((img) => img.path);

        if (keepPaths.length > 0) {
          const moveResult = await window.api.moveToPicks(folderPath, keepPaths);
          executeResult.movedCount = moveResult.succeeded.length;
          executeResult.failedPaths.push(...moveResult.failed);
          moveSucceeded = moveResult.succeeded;
        }
      }

      // Collect paths that were successfully processed (not in failedPaths)
      const failedPathSet = new Set(executeResult.failedPaths.map((f) => f.path));
      const succeededDeletePaths = new Set(deletePaths.filter((p) => !failedPathSet.has(p)));
      const succeededMovePaths = new Set(moveSucceeded);

      // Remove succeeded images from state
      setState((prev) => {
        const nextImages = prev.images.filter(
          (img) => !succeededDeletePaths.has(img.path) && !succeededMovePaths.has(img.path),
        );
        const nextClassifications = { ...prev.classifications };
        for (const img of prev.images) {
          if (succeededDeletePaths.has(img.path) || succeededMovePaths.has(img.path)) {
            delete nextClassifications[img.name];
          }
        }
        return { ...prev, images: nextImages, classifications: nextClassifications };
      });

      // Cancel any pending debounced save
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }

      // Save updated results file immediately (not debounced)
      if (resultsRef.current) {
        // Build new results from remaining images
        const remainingClassifications: Record<string, Classification> = {};
        for (const img of stateRef.current.images) {
          if (!succeededDeletePaths.has(img.path) && !succeededMovePaths.has(img.path)) {
            remainingClassifications[img.name] = stateRef.current.classifications[img.name] ?? 'review';
          }
        }

        resultsRef.current = {
          ...resultsRef.current,
          images: Object.fromEntries(
            Object.entries(remainingClassifications).map(([k, v]) => [
              k,
              {
                classification: v,
                userOverride: resultsRef.current?.images[k]?.userOverride ?? false,
                qualityScore: resultsRef.current?.images[k]?.qualityScore,
              },
            ]),
          ),
        };
        await saveResults(folderPath, resultsRef.current);
      }

      return executeResult;
    },
    [],
  );

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
    executeActions,
  };
}

export { THUMBNAIL_SIZE_MAP };
export type { SortField, SortDirection, PhotoGroup };
