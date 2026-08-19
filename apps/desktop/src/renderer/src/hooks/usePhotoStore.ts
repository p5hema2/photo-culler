import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type {
  ImageFileInfo,
  ResultsFile,
  SessionConfig,
  QualitySubscores,
} from '@photo-culler/types';
import { sortImages } from '@photo-culler/image-utils/sorting';
import type { SortField, SortDirection } from '@photo-culler/image-utils/sorting';
import type { PhotoGroup } from '@photo-culler/image-utils/grouping';
import { groupByFolder, foldersOf } from '@photo-culler/image-utils/folders';
import type { FolderSection } from '@photo-culler/image-utils/folders';
import {
  loadAllResults,
  saveResults,
  emptyResults,
  projectFolderResults,
  rebuildResults,
} from '../lib/results';
import { useExifExtractor } from './useExifExtractor';
import { useThumbnailWorker } from './useThumbnailWorker';
import type { ExecuteOptions, ExecuteResult } from '../components/ExecutePanel';
import type { ClassificationFilter } from '../lib/filters';
import { matchesClassificationFilter } from '../lib/filters';

export interface PhotoState {
  folderPath: string | null;
  images: ImageFileInfo[];
  classifications: Record<string, Classification>;
  sortField: SortField;
  sortDirection: SortDirection;
  filterExtensions: Set<string>;
  filterClassifications: Set<ClassificationFilter>;
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
  filterClassifications: new Set<ClassificationFilter>(),
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
  /** Folder sections, each with its own timestamp groups. */
  folders: FolderSection[];
  filteredImages: ImageFileInfo[];
  thumbnailWorker: ReturnType<typeof useThumbnailWorker>;
  openFolder: (folderPath: string) => Promise<void>;
  setClassification: (imagePath: string, classification: Classification) => void;
  cycleClassification: (imagePath: string) => void;
  setSortField: (field: SortField) => void;
  setSortDirection: (direction: SortDirection) => void;
  setFilterExtensions: (extensions: Set<string>) => void;
  setFilterClassifications: (classifications: Set<ClassificationFilter>) => void;
  setSearchQuery: (query: string) => void;
  setThumbnailSize: (size: 'small' | 'medium' | 'large') => void;
  setGroupingThresholdMs: (ms: number) => void;
  setFocusedImage: (path: string | null) => void;
  clearError: () => void;
  executeActions: (options: ExecuteOptions) => Promise<ExecuteResult>;
  trashImages: (paths: string[]) => Promise<void>;
  setQualityScore: (imagePath: string, score: number, subscores?: QualitySubscores) => void;
  setFilterScoreRange: (range: { min: number; max: number } | null) => void;
  setScoringProgress: (progress: { completed: number; total: number }) => void;
  rotateImage: (imagePath: string, direction: 'cw' | 'ccw') => void;
  cancelPendingSave: () => void;
  /**
   * Drop in-memory records for images that are no longer on disk, mirroring
   * what the main process just removed from the files.
   */
  pruneLoadedResults: () => void;
}

export function usePhotoStore(): PhotoStoreAPI {
  const [state, setState] = useState<PhotoState>(initialState);
  const thumbnailWorker = useThumbnailWorker();
  const exifExtractor = useExifExtractor();
  /**
   * One results file per directory, keyed by absolute directory path. Opening a
   * parent folder pulls in every shoot below it, and each keeps its own
   * `.photo-culler-results.json` beside its photos.
   */
  const resultsRef = useRef<Map<string, ResultsFile>>(new Map());
  /** Folders whose on-disk file no longer matches state. */
  const dirtyFoldersRef = useRef<Set<string>>(new Set());
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const stateRef = useRef(state);
  /**
   * Incremented on every openFolder. A save queued under an older epoch belongs
   * to the tree we have since left and must never be written.
   */
  const openEpochRef = useRef(0);
  const pendingEpochRef = useRef(0);

  // Keep stateRef in sync
  stateRef.current = state;

  // Track mounted state
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /**
   * Project current state onto one folder's file and write it.
   *
   * State is keyed by absolute path; the file on disk stays keyed by bare
   * filename, which is only unambiguous because there is one file per folder.
   */
  const writeFolder = useCallback((folderPath: string) => {
    const current = stateRef.current;
    const existing = resultsRef.current.get(folderPath) ?? emptyResults(folderPath);
    const folderImages = current.images.filter((img) => img.folder === folderPath);
    const updated = projectFolderResults(existing, folderPath, folderImages, current);
    resultsRef.current.set(folderPath, updated);
    void saveResults(folderPath, updated);
  }, []);

  /** Write every folder that has pending changes. */
  const writeDirtyFolders = useCallback(() => {
    const dirty = [...dirtyFoldersRef.current];
    dirtyFoldersRef.current.clear();
    for (const folderPath of dirty) writeFolder(folderPath);
  }, [writeFolder]);

  /**
   * Note that a folder changed and schedule a write.
   *
   * Folder-level rather than image-level: a burst of classifications in one
   * shoot collapses into a single file write, and edits spread across shoots
   * still each land in the right file.
   */
  const markDirty = useCallback(
    (folderPath: string | undefined) => {
      if (!folderPath) return;
      dirtyFoldersRef.current.add(folderPath);
      pendingEpochRef.current = openEpochRef.current;

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        // The previous tree's EXIF and scoring workers keep delivering after a
        // folder switch. Writing their queued save now would target the new
        // tree's files with the old tree's data.
        if (pendingEpochRef.current !== openEpochRef.current) {
          dirtyFoldersRef.current.clear();
          return;
        }
        writeDirtyFolders();
      }, 500);
    },
    [writeDirtyFolders],
  );

  /**
   * Write queued changes immediately instead of waiting out the debounce.
   * Deliberately ignores the epoch: this runs while leaving a tree, to get its
   * last edits to disk before the epoch is retired.
   */
  const flushPendingSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    writeDirtyFolders();
  }, [writeDirtyFolders]);

  /**
   * Drop queued changes without writing them.
   * Rescan deletes the results files on purpose — a pending debounced write
   * would otherwise fire afterwards and restore the data we just discarded.
   */
  const cancelPendingSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    dirtyFoldersRef.current.clear();
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
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        // Best-effort — the IPC calls fire but the page may unload first.
        writeDirtyFolders();
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [writeDirtyFolders]);

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
      resultsRef.current = new Map();

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

        // One results file per folder in the tree, loaded in parallel.
        const folders = foldersOf(images);
        const allResults = await loadAllResults(folders);

        // Keyed by absolute PATH, not filename: with subfolders in play the
        // same basename can occur in several shoots, and name keying would
        // silently merge two different photos.
        const classifications: Record<string, Classification> = {};
        const qualityScores: Record<string, number> = {};
        const qualitySubscores: Record<string, QualitySubscores> = {};
        const rotations: Record<string, number> = {};

        const imagesNeedingExif: typeof images = [];
        for (const img of images) {
          const stored = allResults.get(img.folder)?.images[img.name];
          if (!stored) {
            classifications[img.path] = null;
            imagesNeedingExif.push(img);
            continue;
          }

          classifications[img.path] = stored.classification;
          if (stored.qualityScore != null) qualityScores[img.path] = stored.qualityScore;
          if (stored.qualitySubscores) qualitySubscores[img.path] = stored.qualitySubscores;
          if (stored.rotation) rotations[img.path] = stored.rotation;

          const cachedExif = stored.exif;
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
        }

        // Every folder gets an entry, so a shoot that has never been culled
        // still has somewhere to record into.
        for (const folder of folders) {
          resultsRef.current.set(folder, allResults.get(folder) ?? emptyResults(folder));
        }

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

            // Cache EXIF in the file belonging to this image's own folder
            const source = images.find((img) => img.path === path);
            const folderResults = source ? resultsRef.current.get(source.folder) : undefined;
            if (source && folderResults) {
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
              resultsRef.current.set(source.folder, {
                ...folderResults,
                images: {
                  ...folderResults.images,
                  [source.name]: { ...folderResults.images[source.name], exif: exifData },
                },
              });
              markDirty(source.folder);
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
    [thumbnailWorker, exifExtractor, markDirty, flushPendingSave],
  );

  /** Look up which folder an image belongs to, for dirty-marking. */
  const folderOf = useCallback((imagePath: string): string | undefined => {
    return stateRef.current.images.find((img) => img.path === imagePath)?.folder;
  }, []);

  const setClassification = useCallback(
    (imagePath: string, classification: Classification) => {
      setState((prev) => ({
        ...prev,
        classifications: { ...prev.classifications, [imagePath]: classification },
      }));
      markDirty(folderOf(imagePath));
    },
    [folderOf, markDirty],
  );

  const cycleClassification = useCallback(
    (imagePath: string) => {
      setState((prev) => {
        const current = prev.classifications[imagePath] ?? null;
        // review -> keep -> delete -> review
        const next: Classification =
          current === null
            ? 'review'
            : current === 'review'
              ? 'keep'
              : current === 'keep'
                ? 'delete'
                : 'review';
        return { ...prev, classifications: { ...prev.classifications, [imagePath]: next } };
      });
      markDirty(folderOf(imagePath));
    },
    [folderOf, markDirty],
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

  const setFilterClassifications = useCallback((classifications: Set<ClassificationFilter>) => {
    setState((prev) => ({ ...prev, filterClassifications: classifications }));
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
          .filter((img) => (current.rotations[img.path] ?? 0) !== 0)
          .map((img) => ({
            path: img.path,
            folder: img.folder,
            degrees: current.rotations[img.path]!,
          }));

        if (rotatedFiles.length > 0) {
          const rotateResult = await window.api.rotateFiles(
            rotatedFiles.map((f) => ({ path: f.path, degrees: f.degrees })),
          );
          executeResult.failedPaths.push(...rotateResult.failed);
          executeResult.rotatedCount = rotateResult.succeeded.length;

          // Clear rotation state for successfully rotated images
          const rotatedSet = new Set<string>(rotateResult.succeeded);
          setState((prev) => {
            const newRotations = { ...prev.rotations };
            for (const file of rotatedFiles) {
              if (rotatedSet.has(file.path)) {
                delete newRotations[file.path];
              }
            }
            return { ...prev, rotations: newRotations };
          });

          // The projection reads rotations from state, which we just cleared, so
          // marking the affected folders dirty is enough to drop them on disk.
          for (const file of rotatedFiles) {
            if (rotatedSet.has(file.path)) markDirty(file.folder);
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
        .filter((img) => (current.classifications[img.path] ?? null) === 'delete')
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
          .filter((img) => (current.classifications[img.path] ?? null) === 'keep')
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
            delete nextClassifications[img.path];
          }
        }
        return { ...prev, images: nextImages, classifications: nextClassifications };
      });

      // Cancel any pending debounced save
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }

      // Rewrite each affected folder's file immediately (not debounced).
      // Only deletions prune an entry: a moved pick keeps its record, because the
      // file still exists under picks/ and the scanner attributes it back to this
      // same folder.
      const remaining = stateRef.current.images.filter(
        (img) => !succeededDeletePaths.has(img.path),
      );
      const touched = new Set<string>();
      for (const path of succeededDeletePaths) {
        const folder = current.images.find((img) => img.path === path)?.folder;
        if (folder) touched.add(folder);
      }

      for (const folderPath of touched) {
        const existing = resultsRef.current.get(folderPath);
        if (!existing) continue;
        const keepNames = remaining
          .filter((img) => img.folder === folderPath)
          .map((img) => img.name);
        const byName: Record<string, Classification> = {};
        for (const img of remaining) {
          if (img.folder === folderPath) {
            byName[img.name] = stateRef.current.classifications[img.path] ?? null;
          }
        }
        const rebuilt = rebuildResults(existing, keepNames, byName);
        resultsRef.current.set(folderPath, rebuilt);
        await saveResults(folderPath, rebuilt);
      }

      return executeResult;
      // markDirty is referentially stable (writeFolder has no deps), so naming it
      // here does not change this callback's identity.
    },
    [markDirty],
  );

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
          delete nextClassifications[img.path];
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
    const remaining = current.images.filter((img) => !trashedSet.has(img.path));
    const touched = new Set<string>();
    for (const img of current.images) {
      if (trashedSet.has(img.path)) touched.add(img.folder);
    }

    for (const folderPath of touched) {
      const existing = resultsRef.current.get(folderPath);
      if (!existing) continue;
      const keepNames = remaining.filter((img) => img.folder === folderPath).map((img) => img.name);
      const byName: Record<string, Classification> = {};
      for (const img of remaining) {
        if (img.folder === folderPath) byName[img.name] = current.classifications[img.path] ?? null;
      }
      const rebuilt = rebuildResults(existing, keepNames, byName);
      resultsRef.current.set(folderPath, rebuilt);
      await saveResults(folderPath, rebuilt);
    }
  }, []);

  const pruneLoadedResults = useCallback(() => {
    const current = stateRef.current;
    // The renderer's own folder attribution already matches the main process's
    // rule — picks/ images report their parent — so a folder's images are
    // exactly the entries its file may keep.
    const namesByFolder = new Map<string, Set<string>>();
    for (const img of current.images) {
      const set = namesByFolder.get(img.folder);
      if (set) set.add(img.name);
      else namesByFolder.set(img.folder, new Set([img.name]));
    }

    for (const [folderPath, results] of resultsRef.current) {
      const keep = namesByFolder.get(folderPath) ?? new Set<string>();
      const pruned: typeof results.images = {};
      for (const [name, entry] of Object.entries(results.images)) {
        if (keep.has(name)) pruned[name] = entry;
      }
      resultsRef.current.set(folderPath, { ...results, images: pruned });
    }
  }, []);

  const setQualityScore = useCallback(
    (imagePath: string, score: number, subscores?: QualitySubscores) => {
      setState((prev) => ({
        ...prev,
        qualityScores: { ...prev.qualityScores, [imagePath]: score },
        qualitySubscores: subscores
          ? { ...prev.qualitySubscores, [imagePath]: subscores }
          : prev.qualitySubscores,
      }));
      markDirty(folderOf(imagePath));
    },
    [folderOf, markDirty],
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
    (imagePath: string, direction: 'cw' | 'ccw') => {
      setState((prev) => {
        const current = prev.rotations[imagePath] ?? 0;
        const delta = direction === 'cw' ? 90 : -90;
        const next = (((current + delta) % 360) + 360) % 360;
        return { ...prev, rotations: { ...prev.rotations, [imagePath]: next } };
      });
      markDirty(folderOf(imagePath));
    },
    [folderOf, markDirty],
  );
  // Derived state
  const filteredImages = useMemo(() => {
    let result = state.images;

    // Extension filter
    if (state.filterExtensions.size > 0) {
      result = result.filter((img) => state.filterExtensions.has(img.extension.toLowerCase()));
    }

    // Classification filter — any of the selected buckets, none selected means all
    if (state.filterClassifications.size > 0) {
      result = result.filter((img) =>
        matchesClassificationFilter(state.classifications[img.path], state.filterClassifications),
      );
    }

    // Score range filter
    if (state.filterScoreRange != null) {
      const { min, max } = state.filterScoreRange;
      result = result.filter((img) => {
        const score = state.qualityScores[img.path];
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
    state.filterClassifications,
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

  /**
   * Folder sections, each holding its own timestamp groups.
   *
   * Two levels rather than one: a shoot is the unit the user thinks in, but
   * burst detection is what makes a shoot reviewable, so folders wrap groups
   * instead of replacing them.
   */
  const folders = useMemo(() => {
    const sections = groupByFolder(sortedImages, state.groupingThresholdMs, state.folderPath ?? '');

    // When sorting by quality, order images within a group and groups within a
    // folder by score. Folder order still follows the image sort.
    if (state.sortField === 'qualityScore') {
      const qualityScores = state.qualityScores;
      const direction = state.sortDirection;

      for (const section of sections) {
        for (const group of section.groups) {
          group.images.sort((a, b) => {
            const scoreA = qualityScores[a.path] ?? -1;
            const scoreB = qualityScores[b.path] ?? -1;
            return direction === 'desc' ? scoreB - scoreA : scoreA - scoreB;
          });
        }
        section.groups.sort((a, b) => {
          const maxA = Math.max(...a.images.map((img) => qualityScores[img.path] ?? -1));
          const maxB = Math.max(...b.images.map((img) => qualityScores[img.path] ?? -1));
          return direction === 'desc' ? maxB - maxA : maxA - maxB;
        });
      }
    }

    return sections;
  }, [
    sortedImages,
    state.folderPath,
    state.groupingThresholdMs,
    state.sortField,
    state.sortDirection,
    state.qualityScores,
  ]);

  const foldersRef = useRef(folders);
  foldersRef.current = folders;

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
    folders,
    filteredImages,
    thumbnailWorker,
    openFolder,
    setClassification,
    cycleClassification,
    setSortField,
    setSortDirection,
    setFilterExtensions,
    setFilterClassifications,
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
    pruneLoadedResults,
  };
}

export type { SortField, SortDirection, PhotoGroup };
