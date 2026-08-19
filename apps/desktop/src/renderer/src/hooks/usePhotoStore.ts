import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type {
  ImageFileInfo,
  ResultsFile,
  SessionConfig,
  QualitySubscores,
} from '@photo-culler/types';
import { sortImages } from '@photo-culler/image-utils/sorting';
import type { SortField, SortDirection } from '@photo-culler/image-utils/sorting';
import { groupByTimestamp } from '@photo-culler/image-utils/grouping';
import type { PhotoGroup } from '@photo-culler/image-utils/grouping';
import { loadResults, saveResults, rebuildResults } from '../lib/results';
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
  qualityScores: Record<string, number>;
  qualitySubscores: Record<string, QualitySubscores>;
  filterScoreRange: { min: number; max: number } | null;
  scoringProgress: { completed: number; total: number };
  rotations: Record<string, number>;
}

export type Classification = 'keep' | 'review' | 'delete' | null;

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
  qualityScores: {},
  qualitySubscores: {},
  filterScoreRange: null,
  scoringProgress: { completed: 0, total: 0 },
  rotations: {},
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
  trashImages: (paths: string[]) => Promise<void>;
  setQualityScore: (filename: string, score: number, subscores?: QualitySubscores) => void;
  setFilterScoreRange: (range: { min: number; max: number } | null) => void;
  setScoringProgress: (progress: { completed: number; total: number }) => void;
  rotateImage: (filename: string, direction: 'cw' | 'ccw') => void;
  cancelPendingSave: () => void;
}

export function usePhotoStore(): PhotoStoreAPI {
  const [state, setState] = useState<PhotoState>(initialState);
  const thumbnailWorker = useThumbnailWorker();
  const exifExtractor = useExifExtractor();
  const resultsRef = useRef<ResultsFile | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const stateRef = useRef(state);
  /**
   * Incremented on every openFolder. A save queued under an older epoch belongs
   * to the folder we have since left and must never be written.
   */
  const openEpochRef = useRef(0);
  const pendingSaveRef = useRef<{
    folderPath: string;
    classifications: Record<string, Classification>;
    epoch: number;
  } | null>(null);

  // Keep stateRef in sync
  stateRef.current = state;

  // Track mounted state
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** Project current state onto the results file and write it. */
  const writeResults = useCallback(
    (folderPath: string, classifications: Record<string, Classification>) => {
      if (!resultsRef.current) return;
      const currentState = stateRef.current;
      const existing = resultsRef.current.images;
      // Union of known keys: a partial classifications map must never delete
      // entries (and with them their cached EXIF) from the results file.
      const names = new Set([...Object.keys(existing), ...Object.keys(classifications)]);
      const updated: ResultsFile = {
        ...resultsRef.current,
        images: Object.fromEntries(
          [...names].map((k) => [
            k,
            {
              classification: classifications[k] ?? existing[k]?.classification ?? null,
              userOverride: existing[k]?.userOverride ?? false,
              qualityScore: currentState.qualityScores[k] ?? existing[k]?.qualityScore,
              qualitySubscores: currentState.qualitySubscores[k] ?? existing[k]?.qualitySubscores,
              rotation: currentState.rotations[k] ?? existing[k]?.rotation,
              exif: existing[k]?.exif,
            },
          ]),
        ),
      };
      resultsRef.current = updated;
      saveResults(folderPath, updated);
    },
    [],
  );

  // Debounced save
  const scheduleSave = useCallback(
    (folderPath: string, classifications: Record<string, Classification>) => {
      pendingSaveRef.current = { folderPath, classifications, epoch: openEpochRef.current };
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        const pending = pendingSaveRef.current;
        pendingSaveRef.current = null;
        if (!pending) return;
        // The previous folder's EXIF/scoring workers keep delivering after a
        // folder switch. Writing their queued save now would target the NEW
        // folder's file with the old folder's data.
        if (pending.epoch !== openEpochRef.current) return;
        writeResults(pending.folderPath, pending.classifications);
      }, 500);
    },
    [writeResults],
  );

  /**
   * Write a queued save immediately instead of waiting out the debounce.
   * Deliberately ignores the epoch: this runs while leaving a folder, to get
   * that folder's last edits to disk before its epoch is retired.
   */
  const flushPendingSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const pending = pendingSaveRef.current;
    pendingSaveRef.current = null;
    if (pending) writeResults(pending.folderPath, pending.classifications);
  }, [writeResults]);

  /**
   * Drop a queued save without writing it.
   * Rescan deletes the results file on purpose — a pending debounced write
   * would otherwise fire afterwards and restore the data we just discarded.
   */
  const cancelPendingSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    pendingSaveRef.current = null;
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

  // Exif progress is read directly from the hook — no sync needed.
  // Overwrite the state field at return time to avoid stale values without triggering re-renders.
  const exifProgress = exifExtractor.progress;

  const openFolder = useCallback(
    async (folderPath: string) => {
      // Get the outgoing folder's last edits to disk, then retire its epoch so
      // its still-running workers cannot write into the new folder's file.
      // resultsRef is nulled for the duration of the load: state below is reset
      // to empty and only repopulated after two awaited IPC round trips, and a
      // save landing in that window would persist images: {}.
      flushPendingSave();
      openEpochRef.current += 1;
      resultsRef.current = null;

      setState((prev) => ({
        ...prev,
        isLoading: true,
        error: null,
        folderPath,
        images: [],
        classifications: {},
        focusedImageId: null,
        qualityScores: {},
        qualitySubscores: {},
        filterScoreRange: null,
        scoringProgress: { completed: 0, total: 0 },
      }));

      thumbnailWorker.clearAll();

      try {
        const images = await window.api.scanFolder(folderPath);

        // Load existing results
        const results = await loadResults(folderPath);
        const classifications: Record<string, Classification> = {};
        const qualityScores: Record<string, number> = {};
        const qualitySubscores: Record<string, QualitySubscores> = {};
        const rotations: Record<string, number> = {};

        const imagesNeedingExif: typeof images = [];
        for (const img of images) {
          if (results?.images[img.name]) {
            classifications[img.name] = results.images[img.name].classification;
            if (results.images[img.name].qualityScore != null) {
              qualityScores[img.name] = results.images[img.name].qualityScore!;
            }
            if (results.images[img.name].qualitySubscores) {
              qualitySubscores[img.name] = results.images[img.name].qualitySubscores!;
            }
            if (results.images[img.name].rotation) {
              rotations[img.name] = results.images[img.name].rotation!;
            }
            // Apply cached EXIF data if available
            const cachedExif = results.images[img.name].exif;
            if (cachedExif) {
              if (cachedExif.dateTaken != null) img.dateTaken = cachedExif.dateTaken;
              if (cachedExif.dateTakenLocal != null) img.dateTakenLocal = cachedExif.dateTakenLocal;
              if (cachedExif.timezoneOffset != null) img.timezoneOffset = cachedExif.timezoneOffset;
              if (cachedExif.width != null) img.width = cachedExif.width;
              if (cachedExif.height != null) img.height = cachedExif.height;
              if (cachedExif.cameraMake != null) img.cameraMake = cachedExif.cameraMake;
              if (cachedExif.cameraModel != null) img.cameraModel = cachedExif.cameraModel;
              if (cachedExif.lensModel != null) img.lensModel = cachedExif.lensModel;
              if (cachedExif.focalLength != null) img.focalLength = cachedExif.focalLength;
              if (cachedExif.aperture != null) img.aperture = cachedExif.aperture;
              if (cachedExif.shutterSpeed != null) img.shutterSpeed = cachedExif.shutterSpeed;
              if (cachedExif.iso != null) img.iso = cachedExif.iso;
              if (cachedExif.exposureCompensation != null)
                img.exposureCompensation = cachedExif.exposureCompensation;
              if (cachedExif.flash != null) img.flash = cachedExif.flash;
              if (cachedExif.whiteBalance != null) img.whiteBalance = cachedExif.whiteBalance;
              if (cachedExif.meteringMode != null) img.meteringMode = cachedExif.meteringMode;
              if (cachedExif.exposureProgram != null)
                img.exposureProgram = cachedExif.exposureProgram;
              if (cachedExif.colorSpace != null) img.colorSpace = cachedExif.colorSpace;
            } else {
              imagesNeedingExif.push(img);
            }
          } else {
            classifications[img.name] = null;
            imagesNeedingExif.push(img);
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
          qualitySubscores,
          rotations,
          isLoading: false,
          focusedImageId: images.length > 0 ? images[0]!.path : null,
        }));

        // Trigger EXIF extraction only for images without cached EXIF data
        exifExtractor.extractAll(
          imagesNeedingExif.map((img) => ({ path: img.path })),
          (path, metadata) => {
            if (!mountedRef.current) return;

            // Cache EXIF data in the results ref for persistence
            const filename = images.find((img) => img.path === path)?.name;
            if (filename && resultsRef.current) {
              const exifData = {
                dateTaken: metadata.dateTaken ?? undefined,
                dateTakenLocal: metadata.dateTakenLocal ?? undefined,
                timezoneOffset: metadata.timezoneOffset ?? undefined,
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
              };
              resultsRef.current = {
                ...resultsRef.current,
                images: {
                  ...resultsRef.current.images,
                  [filename]: {
                    ...resultsRef.current.images[filename],
                    exif: exifData,
                  },
                },
              };
              // Trigger debounced save so EXIF cache persists
              if (stateRef.current.folderPath) {
                scheduleSave(stateRef.current.folderPath, stateRef.current.classifications);
              }
            }

            setState((prev) => ({
              ...prev,
              images: prev.images.map((img) =>
                img.path === path
                  ? {
                      ...img,
                      dateTaken: metadata.dateTaken ?? undefined,
                      dateTakenLocal: metadata.dateTakenLocal ?? undefined,
                      timezoneOffset: metadata.timezoneOffset ?? undefined,
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
    [thumbnailWorker, exifExtractor, scheduleSave, flushPendingSave],
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
                  qualitySubscores: resultsRef.current.images[filename]?.qualitySubscores,
                  rotation: resultsRef.current.images[filename]?.rotation,
                  exif: resultsRef.current.images[filename]?.exif,
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
          current === null
            ? 'keep'
            : current === 'keep'
              ? 'review'
              : current === 'review'
                ? 'delete'
                : null;
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
                  qualitySubscores: resultsRef.current.images[filename]?.qualitySubscores,
                  rotation: resultsRef.current.images[filename]?.rotation,
                  exif: resultsRef.current.images[filename]?.exif,
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

  const setFilterClassification = useCallback(
    (classification: Classification | 'unclassified' | null) => {
      setState((prev) => ({ ...prev, filterClassification: classification }));
    },
    [],
  );

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

  const executeActions = useCallback(async (options: ExecuteOptions): Promise<ExecuteResult> => {
    const current = stateRef.current;
    if (!current.folderPath) {
      return { trashedCount: 0, movedCount: 0, rotatedCount: 0, failedPaths: [] };
    }

    const folderPath = current.folderPath;
    const executeResult: ExecuteResult = {
      trashedCount: 0,
      movedCount: 0,
      rotatedCount: 0,
      failedPaths: [],
    };

    // Only operate on currently visible (filtered) images
    const visibleImages = filteredImagesRef.current;

    // Apply rotations to files on disk if requested
    if (options.applyRotations) {
      const rotatedFiles = visibleImages
        .filter((img) => (current.rotations[img.name] ?? 0) !== 0)
        .map((img) => ({ path: img.path, name: img.name, degrees: current.rotations[img.name]! }));

      if (rotatedFiles.length > 0) {
        const rotateResult = await window.api.rotateFiles(
          rotatedFiles.map((f) => ({ path: f.path, degrees: f.degrees })),
        );
        executeResult.failedPaths.push(...rotateResult.failed);
        executeResult.rotatedCount = rotateResult.succeeded.length;

        // Clear rotation state for successfully rotated images
        const rotatedSet = new Set(rotateResult.succeeded);
        setState((prev) => {
          const newRotations = { ...prev.rotations };
          for (const file of rotatedFiles) {
            if (rotatedSet.has(file.path)) {
              delete newRotations[file.name];
            }
          }
          return { ...prev, rotations: newRotations };
        });

        // Also clear rotation in resultsRef
        if (resultsRef.current) {
          for (const file of rotatedFiles) {
            if (rotatedSet.has(file.path) && resultsRef.current.images[file.name]) {
              delete resultsRef.current.images[file.name].rotation;
            }
          }
        }

        // The file on disk changed, so its cached thumbnail is now wrong.
        // Deliberately after the rotation state is cleared: invalidating first
        // would let the cell redraw the freshly rotated file with the old
        // rotation still applied, double-rotating it.
        for (const filePath of rotatedSet) {
          thumbnailWorkerRef.current.invalidate(filePath);
        }
      }
    }

    // Get paths of delete-classified images (within visible set only)
    const deletePaths = visibleImages
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

    // Move keep images to picks/ if requested (within visible set only)
    let moveSucceeded: string[] = [];
    if (options.movePicks) {
      const keepPaths = visibleImages
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
      // Build new results from remaining images.
      // Only deletions prune an entry. A moved pick keeps its record: the file
      // still exists under picks/, scanFolder reads that folder too, and the
      // results map is keyed by filename — so its classification, scores and
      // cached EXIF survive the move and are found again on the next open.
      const remainingClassifications: Record<string, Classification> = {};
      for (const img of stateRef.current.images) {
        if (!succeededDeletePaths.has(img.path)) {
          remainingClassifications[img.name] = stateRef.current.classifications[img.name] ?? null;
        }
      }

      resultsRef.current = rebuildResults(
        resultsRef.current,
        Object.keys(remainingClassifications),
        remainingClassifications,
      );
      await saveResults(folderPath, resultsRef.current);
    }

    return executeResult;
  }, []);

  const trashImages = useCallback(async (paths: string[]) => {
    if (paths.length === 0) return;

    const result = await window.api.trashFiles(paths);
    const trashedSet = new Set(result.succeeded);
    if (trashedSet.size === 0) return;

    setState((prev) => {
      const nextImages = prev.images.filter((img) => !trashedSet.has(img.path));
      const nextClassifications = { ...prev.classifications };

      for (const img of prev.images) {
        if (trashedSet.has(img.path)) {
          delete nextClassifications[img.name];
        }
      }

      // Advance focus if current focus was trashed
      let nextFocused = prev.focusedImageId;
      if (prev.focusedImageId && trashedSet.has(prev.focusedImageId)) {
        const oldIndex = prev.images.findIndex((img) => img.path === prev.focusedImageId);
        const nextImg = nextImages[oldIndex] ?? nextImages[oldIndex - 1] ?? null;
        nextFocused = nextImg?.path ?? null;
      }

      return {
        ...prev,
        images: nextImages,
        classifications: nextClassifications,
        focusedImageId: nextFocused,
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
      resultsRef.current = rebuildResults(
        resultsRef.current,
        Object.keys(remainingClassifications),
        remainingClassifications,
      );
      await saveResults(current.folderPath, resultsRef.current);
    }
  }, []);

  const setQualityScore = useCallback(
    (filename: string, score: number, subscores?: QualitySubscores) => {
      setState((prev) => {
        const newQualityScores = { ...prev.qualityScores, [filename]: score };
        const newQualitySubscores = subscores
          ? { ...prev.qualitySubscores, [filename]: subscores }
          : prev.qualitySubscores;

        // Update results ref (score only — classification is user-driven)
        if (resultsRef.current) {
          const existing = resultsRef.current.images[filename];
          resultsRef.current = {
            ...resultsRef.current,
            images: {
              ...resultsRef.current.images,
              [filename]: {
                classification: existing?.classification ?? null,
                userOverride: existing?.userOverride ?? false,
                qualityScore: score,
                qualitySubscores: subscores ?? existing?.qualitySubscores,
                rotation: existing?.rotation,
                exif: existing?.exif,
              },
            },
          };
        }

        return {
          ...prev,
          qualityScores: newQualityScores,
          qualitySubscores: newQualitySubscores,
        };
      });

      // Persist the score. Without this the only writes came from the EXIF
      // callbacks, whose debounce window closes ~500ms after the last one —
      // long before scoring (which starts 2s after open) finishes. Scores then
      // lived only in memory and the whole analysis re-ran on the next open.
      const folderPath = stateRef.current.folderPath;
      if (folderPath) {
        scheduleSave(folderPath, stateRef.current.classifications);
      }
    },
    [scheduleSave],
  );

  const setFilterScoreRange = useCallback((range: { min: number; max: number } | null) => {
    setState((prev) => ({ ...prev, filterScoreRange: range }));
  }, []);

  const setScoringProgress = useCallback((progress: { completed: number; total: number }) => {
    setState((prev) => {
      if (
        prev.scoringProgress.completed === progress.completed &&
        prev.scoringProgress.total === progress.total
      ) {
        return prev; // No change — skip re-render
      }
      return { ...prev, scoringProgress: progress };
    });
  }, []);

  const rotateImage = useCallback(
    (filename: string, direction: 'cw' | 'ccw') => {
      const delta = direction === 'cw' ? 90 : -90;
      setState((prev) => {
        const current = prev.rotations[filename] ?? 0;
        const next = (current + delta + 360) % 360;

        // Persist to results ref
        if (resultsRef.current) {
          resultsRef.current = {
            ...resultsRef.current,
            images: {
              ...resultsRef.current.images,
              [filename]: {
                ...resultsRef.current.images[filename],
                rotation: next || undefined,
              },
            },
          };
        }

        if (prev.folderPath) {
          scheduleSave(prev.folderPath, prev.classifications);
        }

        return {
          ...prev,
          rotations: { ...prev.rotations, [filename]: next },
        };
      });
    },
    [scheduleSave],
  );

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

    // Score range filter
    if (state.filterScoreRange != null) {
      const { min, max } = state.filterScoreRange;
      result = result.filter((img) => {
        const score = state.qualityScores[img.name];
        if (score == null) return false;
        return score >= min && score <= max;
      });
    }

    // Search query
    if (state.searchQuery.trim()) {
      const query = state.searchQuery.toLowerCase().trim();
      result = result.filter((img) => img.name.toLowerCase().includes(query));
    }

    return result;
  }, [
    state.images,
    state.filterExtensions,
    state.filterClassification,
    state.filterScoreRange,
    state.qualityScores,
    state.searchQuery,
    state.classifications,
  ]);

  // Keep a ref to filteredImages for use in callbacks (e.g., executeActions)
  const filteredImagesRef = useRef(filteredImages);
  filteredImagesRef.current = filteredImages;
  const thumbnailWorkerRef = useRef(thumbnailWorker);
  thumbnailWorkerRef.current = thumbnailWorker;

  const sortedImages = useMemo(() => {
    // When sorting by qualityScore, sort by timestamp first so grouping works correctly
    if (state.sortField === 'qualityScore') {
      return sortImages(filteredImages, 'dateTaken', 'asc', {
        qualityScores: state.qualityScores,
      });
    }
    return sortImages(filteredImages, state.sortField, state.sortDirection, {
      qualityScores: state.qualityScores,
    });
  }, [filteredImages, state.sortField, state.sortDirection, state.qualityScores]);

  const groups = useMemo(() => {
    const baseGroups = groupByTimestamp(sortedImages, state.groupingThresholdMs);

    // When sorting by qualityScore, sort groups by best score and images within groups by score
    if (state.sortField === 'qualityScore') {
      const qualityScores = state.qualityScores;
      const direction = state.sortDirection;

      // Sort images within each group by score
      for (const group of baseGroups) {
        group.images.sort((a, b) => {
          const scoreA = qualityScores[a.name] ?? -1;
          const scoreB = qualityScores[b.name] ?? -1;
          return direction === 'desc' ? scoreB - scoreA : scoreA - scoreB;
        });
      }

      // Sort groups by best (max) score within group
      baseGroups.sort((a, b) => {
        const maxA = Math.max(...a.images.map((img) => qualityScores[img.name] ?? -1));
        const maxB = Math.max(...b.images.map((img) => qualityScores[img.name] ?? -1));
        return direction === 'desc' ? maxB - maxA : maxA - maxB;
      });
    }

    return baseGroups;
  }, [
    sortedImages,
    state.groupingThresholdMs,
    state.sortField,
    state.sortDirection,
    state.qualityScores,
  ]);

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
        if (false && session.lastFolderPath) {
          // Disabled: always start blank
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

  // Override exifProgress from hook directly (avoids setState loop)
  const stateWithProgress = { ...state, exifProgress };

  return {
    state: stateWithProgress,
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
    trashImages,
    setQualityScore,
    setFilterScoreRange,
    setScoringProgress,
    rotateImage,
    cancelPendingSave,
  };
}

export type { SortField, SortDirection, PhotoGroup };
