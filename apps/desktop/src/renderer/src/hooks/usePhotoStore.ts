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
  filterClassification: Classification | 'unclassified' | null;
  searchQuery: string;
  thumbnailSize: 'small' | 'medium' | 'large';
  groupingThresholdMs: number;
  isLoading: boolean;
  exifProgress: { completed: number; total: number };
  focusedImageId: string | null;
  error: string | null;
  selectedImages: Set<string>;
  selectionAnchor: string | null;
  isPreviewMode: boolean;
  previewImageId: string | null;
  qualityScores: Record<string, number>;
  starRatings: Record<string, number>;
  filterStarRating: number | null;
  scoringProgress: { completed: number; total: number };
}

export type Classification = 'keep' | 'review' | 'delete' | null;

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
  selectedImages: new Set<string>(),
  selectionAnchor: null,
  isPreviewMode: false,
  previewImageId: null,
  qualityScores: {},
  starRatings: {},
  filterStarRating: null,
  scoringProgress: { completed: 0, total: 0 },
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
  setFilterClassification: (classification: Classification | 'unclassified' | null) => void;
  setSearchQuery: (query: string) => void;
  setThumbnailSize: (size: 'small' | 'medium' | 'large') => void;
  setGroupingThresholdMs: (ms: number) => void;
  setFocusedImage: (path: string | null) => void;
  clearError: () => void;
  executeActions: (options: ExecuteOptions) => Promise<ExecuteResult>;
  toggleSelect: (path: string) => void;
  rangeSelect: (path: string) => void;
  selectAll: () => void;
  clearSelection: () => void;
  trashImages: (paths: string[]) => Promise<void>;
  enterPreview: (path: string) => void;
  exitPreview: () => void;
  setQualityScore: (filename: string, score: number) => void;
  setStarRating: (filename: string, rating: number) => void;
  setFilterStarRating: (rating: number | null) => void;
  setScoringProgress: (progress: { completed: number; total: number }) => void;
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
        const currentState = stateRef.current;
        const updated: ResultsFile = {
          ...resultsRef.current,
          images: Object.fromEntries(
            Object.entries(classifications).map(([k, v]) => [
              k,
              {
                classification: v,
                userOverride: resultsRef.current?.images[k]?.userOverride ?? false,
                qualityScore: currentState.qualityScores[k] ?? resultsRef.current?.images[k]?.qualityScore,
                starRating: currentState.starRatings[k] ?? resultsRef.current?.images[k]?.starRating,
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
        selectedImages: new Set<string>(),
        selectionAnchor: null,
        isPreviewMode: false,
        previewImageId: null,
        qualityScores: {},
        starRatings: {},
        filterStarRating: null,
        scoringProgress: { completed: 0, total: 0 },
      }));

      thumbnailWorker.clearAll();

      try {
        const images = await window.api.scanFolder(folderPath);

        // Load existing results
        const results = await loadResults(folderPath);
        const classifications: Record<string, Classification> = {};
        const qualityScores: Record<string, number> = {};
        const starRatings: Record<string, number> = {};

        for (const img of images) {
          if (results?.images[img.name]) {
            classifications[img.name] = results.images[img.name].classification;
            if (results.images[img.name].qualityScore != null) {
              qualityScores[img.name] = results.images[img.name].qualityScore!;
            }
            if (results.images[img.name].starRating != null) {
              starRatings[img.name] = results.images[img.name].starRating!;
            }
          } else {
            classifications[img.name] = null;
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
          qualityScores,
          starRatings,
          isLoading: false,
        }));

        // Trigger EXIF extraction
        exifExtractor.extractAll(
          images.map((img) => ({ path: img.path })),
          (path, metadata) => {
            if (!mountedRef.current) return;
            setState((prev) => ({
              ...prev,
              images: prev.images.map((img) =>
                img.path === path
                  ? {
                      ...img,
                      dateTaken: metadata.dateTaken ?? undefined,
                      width: metadata.width ?? undefined,
                      height: metadata.height ?? undefined,
                      cameraMake: metadata.cameraMake ?? undefined,
                      cameraModel: metadata.cameraModel ?? undefined,
                      lensModel: metadata.lensModel ?? undefined,
                      focalLength: metadata.focalLength ?? undefined,
                      aperture: metadata.aperture ?? undefined,
                      shutterSpeed: metadata.shutterSpeed ?? undefined,
                      iso: metadata.iso ?? undefined,
                      exposureCompensation: metadata.exposureCompensation ?? undefined,
                      flash: metadata.flash ?? undefined,
                      whiteBalance: metadata.whiteBalance ?? undefined,
                      meteringMode: metadata.meteringMode ?? undefined,
                      exposureProgram: metadata.exposureProgram ?? undefined,
                      colorSpace: metadata.colorSpace ?? undefined,
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
        const current = prev.classifications[filename] ?? null;
        const next: Classification =
          current === null ? 'keep' :
          current === 'keep' ? 'review' :
          current === 'review' ? 'delete' :
          null;
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

  const setFilterClassification = useCallback((classification: Classification | 'unclassified' | null) => {
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
        .filter((img) => (current.classifications[img.name] ?? null) === 'delete')
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
          .filter((img) => (current.classifications[img.name] ?? null) === 'keep')
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
            remainingClassifications[img.name] = stateRef.current.classifications[img.name] ?? null;
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

  const toggleSelect = useCallback((path: string) => {
    setState((prev) => {
      const next = new Set(prev.selectedImages);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return {
        ...prev,
        selectedImages: next,
        selectionAnchor: next.size > 0 ? path : null,
      };
    });
  }, []);

  const rangeSelect = useCallback((path: string) => {
    setState((prev) => {
      const anchor = prev.selectionAnchor;
      if (!anchor) {
        const next = new Set(prev.selectedImages);
        next.add(path);
        return { ...prev, selectedImages: next, selectionAnchor: path };
      }
      // Find anchor and target in the same group
      const currentGroups = groupsRef.current;
      for (const group of currentGroups) {
        const anchorIdx = group.images.findIndex((img) => img.path === anchor);
        const targetIdx = group.images.findIndex((img) => img.path === path);
        if (anchorIdx !== -1 && targetIdx !== -1) {
          const [start, end] =
            anchorIdx < targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx];
          const next = new Set(prev.selectedImages);
          for (let i = start; i <= end; i++) {
            next.add(group.images[i]!.path);
          }
          return { ...prev, selectedImages: next };
        }
      }
      // Different groups -- just select the target
      const next = new Set(prev.selectedImages);
      next.add(path);
      return { ...prev, selectedImages: next, selectionAnchor: path };
    });
  }, []);

  const selectAll = useCallback(() => {
    setState((prev) => {
      // Use stateRef to access current filtered images
      const currentState = stateRef.current;
      let result = currentState.images;
      if (currentState.filterExtensions.size > 0) {
        result = result.filter((img) => currentState.filterExtensions.has(img.extension.toLowerCase()));
      }
      if (currentState.filterClassification) {
        result = result.filter(
          (img) =>
            (currentState.classifications[img.name] ?? null) === currentState.filterClassification,
        );
      }
      if (currentState.searchQuery.trim()) {
        const query = currentState.searchQuery.toLowerCase().trim();
        result = result.filter((img) => img.name.toLowerCase().includes(query));
      }
      const next = new Set(result.map((img) => img.path));
      return { ...prev, selectedImages: next };
    });
  }, []);

  const clearSelection = useCallback(() => {
    setState((prev) => ({
      ...prev,
      selectedImages: new Set<string>(),
      selectionAnchor: null,
    }));
  }, []);

  const trashImages = useCallback(async (paths: string[]) => {
    if (paths.length === 0) return;

    const result = await window.api.trashFiles(paths);
    const trashedSet = new Set(result.succeeded);
    if (trashedSet.size === 0) return;

    setState((prev) => {
      const nextImages = prev.images.filter((img) => !trashedSet.has(img.path));
      const nextClassifications = { ...prev.classifications };
      const nextSelected = new Set(prev.selectedImages);

      for (const img of prev.images) {
        if (trashedSet.has(img.path)) {
          delete nextClassifications[img.name];
          nextSelected.delete(img.path);
        }
      }

      // Advance focus if current focus was trashed
      let nextFocused = prev.focusedImageId;
      if (prev.focusedImageId && trashedSet.has(prev.focusedImageId)) {
        const oldIndex = prev.images.findIndex((img) => img.path === prev.focusedImageId);
        const nextImg = nextImages[oldIndex] ?? nextImages[oldIndex - 1] ?? null;
        nextFocused = nextImg?.path ?? null;
      }

      // Update preview if previewed image was trashed
      let nextPreviewId = prev.previewImageId;
      if (prev.previewImageId && trashedSet.has(prev.previewImageId)) {
        nextPreviewId = nextFocused;
      }

      return {
        ...prev,
        images: nextImages,
        classifications: nextClassifications,
        selectedImages: nextSelected,
        focusedImageId: nextFocused,
        previewImageId: nextPreviewId,
      };
    });

    // Save results file immediately
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    const current = stateRef.current;
    if (resultsRef.current && current.folderPath) {
      const remainingClassifications: Record<string, Classification> = {};
      for (const img of current.images) {
        if (!trashedSet.has(img.path)) {
          remainingClassifications[img.name] = current.classifications[img.name] ?? null;
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
      await saveResults(current.folderPath, resultsRef.current);
    }
  }, []);

  const enterPreview = useCallback((path: string) => {
    setState((prev) => ({
      ...prev,
      isPreviewMode: true,
      previewImageId: path,
      focusedImageId: path,
    }));
  }, []);

  const exitPreview = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isPreviewMode: false,
      previewImageId: null,
    }));
  }, []);

  const setQualityScore = useCallback(
    (filename: string, score: number) => {
      setState((prev) => {
        // Auto-assign star rating: 0-20=1, 21-40=2, 41-60=3, 61-80=4, 81-100=5
        const star = score <= 20 ? 1 : score <= 40 ? 2 : score <= 60 ? 3 : score <= 80 ? 4 : 5;

        // Auto-assign classification only if user hasn't manually overridden
        const isManualOverride = resultsRef.current?.images[filename]?.userOverride ?? false;
        let newClassification = prev.classifications[filename];
        if (!isManualOverride) {
          newClassification = score >= 60 ? 'keep' : score >= 35 ? 'review' : 'delete';
        }

        const newClassifications = { ...prev.classifications, [filename]: newClassification };
        const newQualityScores = { ...prev.qualityScores, [filename]: score };
        const newStarRatings = { ...prev.starRatings, [filename]: star };

        // Update results ref
        if (resultsRef.current) {
          resultsRef.current = {
            ...resultsRef.current,
            images: {
              ...resultsRef.current.images,
              [filename]: {
                classification: newClassification,
                userOverride: isManualOverride,
                qualityScore: score,
                starRating: star,
              },
            },
          };
        }

        if (prev.folderPath) {
          scheduleSave(prev.folderPath, newClassifications);
        }

        return {
          ...prev,
          classifications: newClassifications,
          qualityScores: newQualityScores,
          starRatings: newStarRatings,
        };
      });
    },
    [scheduleSave],
  );

  const setStarRating = useCallback(
    (filename: string, rating: number) => {
      setState((prev) => {
        const newStarRatings = { ...prev.starRatings, [filename]: rating };

        if (resultsRef.current) {
          resultsRef.current = {
            ...resultsRef.current,
            images: {
              ...resultsRef.current.images,
              [filename]: {
                ...resultsRef.current.images[filename],
                classification: prev.classifications[filename] ?? null,
                userOverride: resultsRef.current.images[filename]?.userOverride ?? false,
                starRating: rating,
              },
            },
          };
        }

        if (prev.folderPath) {
          scheduleSave(prev.folderPath, prev.classifications);
        }

        return { ...prev, starRatings: newStarRatings };
      });
    },
    [scheduleSave],
  );

  const setFilterStarRating = useCallback((rating: number | null) => {
    setState((prev) => ({ ...prev, filterStarRating: rating }));
  }, []);

  const setScoringProgress = useCallback((progress: { completed: number; total: number }) => {
    setState((prev) => ({ ...prev, scoringProgress: progress }));
  }, []);

  // Derived state
  const filteredImages = useMemo(() => {
    let result = state.images;

    // Extension filter
    if (state.filterExtensions.size > 0) {
      result = result.filter((img) => state.filterExtensions.has(img.extension.toLowerCase()));
    }

    // Classification filter
    if (state.filterClassification != null) {
      if (state.filterClassification === 'unclassified') {
        result = result.filter((img) => (state.classifications[img.name] ?? null) === null);
      } else {
        result = result.filter(
          (img) => (state.classifications[img.name] ?? null) === state.filterClassification,
        );
      }
    }

    // Star rating filter
    if (state.filterStarRating != null) {
      if (state.filterStarRating === 0) {
        // 0 = show unrated only
        result = result.filter((img) => state.starRatings[img.name] == null);
      } else {
        // N = show images with star rating >= N
        result = result.filter((img) => (state.starRatings[img.name] ?? 0) >= state.filterStarRating!);
      }
    }

    // Search query
    if (state.searchQuery.trim()) {
      const query = state.searchQuery.toLowerCase().trim();
      result = result.filter((img) => img.name.toLowerCase().includes(query));
    }

    return result;
  }, [state.images, state.filterExtensions, state.filterClassification, state.filterStarRating, state.starRatings, state.searchQuery, state.classifications]);

  const sortedImages = useMemo(() => {
    return sortImages(filteredImages, state.sortField, state.sortDirection, {
      qualityScores: state.qualityScores,
    });
  }, [filteredImages, state.sortField, state.sortDirection, state.qualityScores]);

  const groups = useMemo(() => {
    return groupByTimestamp(sortedImages, state.groupingThresholdMs);
  }, [sortedImages, state.groupingThresholdMs]);

  const groupsRef = useRef(groups);
  groupsRef.current = groups;

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
    toggleSelect,
    rangeSelect,
    selectAll,
    clearSelection,
    trashImages,
    enterPreview,
    exitPreview,
    setQualityScore,
    setStarRating,
    setFilterStarRating,
    setScoringProgress,
  };
}

export { THUMBNAIL_SIZE_MAP };
export type { SortField, SortDirection, PhotoGroup };
