import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { usePhotoStore } from './hooks/usePhotoStore';
import type { Classification } from './hooks/usePhotoStore';
import { useKeyboardNav } from './hooks/useKeyboardNav';
import { useScoringWorker } from './hooks/useScoringWorker';
import { DropZone } from './components/DropZone';
import { Toolbar } from './components/Toolbar';
import { PhotoGrid } from './components/PhotoGrid';
import { EmptyState } from './components/EmptyState';
import { ExecutePanel } from './components/ExecutePanel';
import { InfoPanel } from './components/InfoPanel';
import { LoupeView } from './components/LoupeView';
import { FilmstripView } from './components/FilmstripView';
import { ShortcutsTutorial } from './components/ShortcutsTutorial';

function WelcomeState({ onOpenFolder }: { onOpenFolder: () => void }): React.JSX.Element {
  return (
    <div
      className="flex flex-col items-center justify-center h-full text-gray-400"
      data-testid="welcome-state"
    >
      <svg
        className="w-20 h-20 mb-6 text-gray-600"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1}
          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
        />
      </svg>
      <p className="text-lg mb-4">Select a folder or drag one here to start</p>
      <button
        onClick={onOpenFolder}
        className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg text-lg font-medium text-white transition-colors"
        data-testid="welcome-open-btn"
      >
        Open Folder
      </button>
    </div>
  );
}

function LoadingState({
  progress,
}: {
  progress?: { completed: number; total: number };
}): React.JSX.Element {
  return (
    <div
      className="flex flex-col items-center justify-center h-full text-gray-400"
      data-testid="loading-state"
    >
      <div className="w-8 h-8 border-2 border-gray-600 border-t-blue-500 rounded-full animate-spin mb-4" />
      <p className="text-lg">Scanning folder...</p>
      {progress && progress.total > 0 && (
        <p className="text-sm text-gray-500 mt-2">
          {progress.completed}/{progress.total} files processed
        </p>
      )}
    </div>
  );
}

function App(): React.JSX.Element {
  const store = usePhotoStore();
  const { state, groups, thumbnailWorker } = store;
  const scoringWorker = useScoringWorker();
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const scoringTriggeredRef = useRef<string | null>(null);
  const [showExecutePanel, setShowExecutePanel] = useState(false);
  const [infoPanelOpen, setInfoPanelOpen] = useState(true);
  const [showFocusPeaking, setShowFocusPeaking] = useState(false);
  const [showClipping, setShowClipping] = useState(false);
  const [selectOnHover, setSelectOnHover] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [viewLayout, setViewLayout] = useState<'default' | 'loupe' | 'filmstrip'>('default');

  const sortedFlatImages = useMemo(() => groups.flatMap((g) => g.images), [groups]);

  const handleTrashFocused = useCallback(() => {
    if (state.focusedImageId) {
      store.trashImages([state.focusedImageId]);
    }
  }, [store, state.focusedImageId]);

  useKeyboardNav({
    groups,
    focusedImageId: state.focusedImageId,
    onFocusChange: store.setFocusedImage,
    onCycleClassification: store.cycleClassification,
    onSetClassification: store.setClassification,
    containerRef: gridContainerRef,
    onTrashFocused: handleTrashFocused,
    sortedFlatImages,
    thumbnailSize: state.thumbnailSize,
    onRotate: store.rotateImage,
    viewLayout,
  });

  const handleSelectFolder = useCallback(async () => {
    const folder = await window.api.selectFolder();
    if (folder) {
      store.openFolder(folder);
    }
  }, [store]);

  const handleRescan = useCallback(async () => {
    if (state.folderPath) {
      await window.api.saveResults(state.folderPath, '');
      scoringTriggeredRef.current = null;
      store.openFolder(state.folderPath);
    }
  }, [state.folderPath, store]);

  // Listen for Cmd+O from menu (only available in Electron via contextBridge)
  useEffect(() => {
    if (!window.menuEvents) return;
    window.menuEvents.onOpenFolder((folderPath: string) => {
      store.openFolder(folderPath);
    });
    return () => {
      window.menuEvents?.removeOpenFolderListener();
    };
  }, [store]);

  // ? key opens shortcuts tutorial, V key toggles layout
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setShowShortcuts((prev) => !prev);
      }
      if (e.key === 'v' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        setViewLayout((prev) =>
          prev === 'default' ? 'loupe' : prev === 'loupe' ? 'filmstrip' : 'default',
        );
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, []);

  const handleImageClick = useCallback(
    (filename: string) => {
      store.cycleClassification(filename);
    },
    [store],
  );

  const handleOpenExecute = useCallback(() => {
    setShowExecutePanel(true);
  }, []);

  const handleCloseExecute = useCallback(() => {
    setShowExecutePanel(false);
  }, []);

  const handleToggleInfoPanel = useCallback(() => {
    setInfoPanelOpen((prev) => !prev);
  }, []);

  const handleCycleViewLayout = useCallback(() => {
    setViewLayout((prev) =>
      prev === 'default' ? 'loupe' : prev === 'loupe' ? 'filmstrip' : 'default',
    );
  }, []);

  const handleToggleFocusPeaking = useCallback(() => {
    setShowFocusPeaking((prev) => !prev);
  }, []);

  const handleToggleClipping = useCallback(() => {
    setShowClipping((prev) => !prev);
  }, []);

  // Focus the container after folder loads so keyboard nav works immediately
  useEffect(() => {
    if (!state.isLoading && state.images.length > 0 && gridContainerRef.current) {
      gridContainerRef.current.focus();
    }
  }, [state.isLoading, state.images.length]);

  // Reset scoring trigger when folder changes
  useEffect(() => {
    scoringTriggeredRef.current = null;
  }, [state.folderPath]);

  // Trigger quality scoring after folder opens, with a 2-second delay
  // Uses stateRef inside timeout to avoid dependency on state.images (which changes during EXIF extraction)
  const storeRef = useRef(store);
  storeRef.current = store;
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (!state.folderPath || state.isLoading) {
      return;
    }

    if (scoringTriggeredRef.current === state.folderPath) {
      return;
    }

    scoringTriggeredRef.current = state.folderPath;

    const timer = setTimeout(() => {
      const currentState = stateRef.current;
      const unscoredFiles = currentState.images
        .filter((img) => currentState.qualityScores[img.name] == null)
        .map((img) => ({ path: img.path, name: img.name }));

      console.log(
        `[scoring] ${unscoredFiles.length}/${currentState.images.length} images need scoring`,
      );

      if (unscoredFiles.length === 0) return;

      console.log(`[scoring] Starting scoring for ${unscoredFiles.length} images`);
      scoringWorker.scoreAll(unscoredFiles, (filename, score, subscores) => {
        storeRef.current.setQualityScore(filename, score, subscores);
      });
    }, 2000);

    return () => clearTimeout(timer);
  }, [state.folderPath, state.isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scoring progress read directly from hook — no sync needed
  const scoringProgress = scoringWorker.progress;

  const totalCount = store.filteredImages.length;

  // Filtered classifications — only for visible (filtered) images
  const filteredClassifications = useMemo(() => {
    const result: Record<string, Classification> = {};
    for (const img of store.filteredImages) {
      result[img.name] = state.classifications[img.name] ?? null;
    }
    return result;
  }, [store.filteredImages, state.classifications]);

  // Count classified images for the Execute button (filtered only)
  const deleteCount = useMemo(() => {
    return Object.values(filteredClassifications).filter((c) => c === 'delete').length;
  }, [filteredClassifications]);

  const keepCount = useMemo(() => {
    return Object.values(filteredClassifications).filter((c) => c === 'keep').length;
  }, [filteredClassifications]);

  // Find the focused image object
  const focusedImage = useMemo(() => {
    if (!state.focusedImageId) return null;
    return state.images.find((img) => img.path === state.focusedImageId) ?? null;
  }, [state.focusedImageId, state.images]);

  const focusedClassification = useMemo(() => {
    if (!focusedImage) return null;
    return state.classifications[focusedImage.name] ?? null;
  }, [focusedImage, state.classifications]);

  const focusedQualityScore = useMemo(() => {
    if (!focusedImage) return undefined;
    return state.qualityScores[focusedImage.name];
  }, [focusedImage, state.qualityScores]);

  const focusedQualitySubscores = useMemo(() => {
    if (!focusedImage) return undefined;
    return state.qualitySubscores[focusedImage.name];
  }, [focusedImage, state.qualitySubscores]);

  const focusedRotation = useMemo(() => {
    if (!focusedImage) return 0;
    return state.rotations[focusedImage.name] ?? 0;
  }, [focusedImage, state.rotations]);

  const renderContent = (): React.JSX.Element => {
    if (state.isLoading) {
      return <LoadingState progress={state.exifProgress} />;
    }
    if (!state.folderPath) {
      return <WelcomeState onOpenFolder={handleSelectFolder} />;
    }
    if (groups.length === 0) {
      return <EmptyState />;
    }
    if (viewLayout === 'loupe' || viewLayout === 'filmstrip') {
      const DetailView = viewLayout === 'loupe' ? LoupeView : FilmstripView;
      return (
        <DetailView
          groups={groups}
          focusedImageId={state.focusedImageId}
          classifications={state.classifications}
          qualityScores={state.qualityScores}
          qualitySubscores={state.qualitySubscores}
          rotations={state.rotations}
          selectOnHover={selectOnHover}
          onImageClick={handleImageClick}
          onImageFocus={store.setFocusedImage}
          onCycleClassification={store.cycleClassification}
          getThumbnail={thumbnailWorker.getThumbnail}
          requestThumbnail={thumbnailWorker.requestThumbnail}
          showFocusPeaking={showFocusPeaking}
          showClipping={showClipping}
        />
      );
    }
    return (
      <PhotoGrid
        groups={groups}
        classifications={state.classifications}
        qualityScores={state.qualityScores}
        rotations={state.rotations}
        thumbnailSize={state.thumbnailSize}
        focusedImageId={state.focusedImageId}
        selectOnHover={selectOnHover}
        onImageClick={handleImageClick}
        onImageFocus={store.setFocusedImage}
        onCycleClassification={store.cycleClassification}
        getThumbnail={thumbnailWorker.getThumbnail}
        requestThumbnail={thumbnailWorker.requestThumbnail}
        setLastModified={thumbnailWorker.setLastModified}
        updateVisibleRange={thumbnailWorker.updateVisibleRange}
      />
    );
  };

  return (
    <DropZone onFolderDrop={store.openFolder}>
      <div
        className="flex flex-col h-screen bg-gray-900 text-white outline-none"
        ref={gridContainerRef}
        tabIndex={-1}
      >
        <Toolbar
          sortField={state.sortField}
          sortDirection={state.sortDirection}
          filterExtensions={state.filterExtensions}
          filterClassification={state.filterClassification}
          searchQuery={state.searchQuery}
          thumbnailSize={state.thumbnailSize}
          groupingThresholdMs={state.groupingThresholdMs}
          exifProgress={state.exifProgress}
          deleteCount={deleteCount}
          keepCount={keepCount}
          totalCount={totalCount}
          folderPath={state.folderPath}
          onSelectFolder={handleSelectFolder}
          onRescan={handleRescan}
          onSortFieldChange={store.setSortField}
          onSortDirectionChange={store.setSortDirection}
          onFilterExtensionsChange={store.setFilterExtensions}
          onFilterClassificationChange={store.setFilterClassification}
          onSearchQueryChange={store.setSearchQuery}
          onThumbnailSizeChange={store.setThumbnailSize}
          onGroupingThresholdChange={store.setGroupingThresholdMs}
          filterScoreRange={state.filterScoreRange}
          scoringProgress={scoringProgress}
          onFilterScoreRangeChange={store.setFilterScoreRange}
          selectOnHover={selectOnHover}
          onToggleSelectMode={() => setSelectOnHover((prev) => !prev)}
          viewLayout={viewLayout}
          onCycleViewLayout={handleCycleViewLayout}
          onSetViewLayout={setViewLayout}
          onExecute={handleOpenExecute}
          onShowShortcuts={() => setShowShortcuts(true)}
        />

        {/* Error banner */}
        {state.error && (
          <div
            className="bg-red-900 text-red-200 px-4 py-2 text-sm flex items-center justify-between"
            data-testid="error-banner"
          >
            <span>{state.error}</span>
            <button onClick={store.clearError} className="text-red-400 hover:text-red-200 ml-4">
              Dismiss
            </button>
          </div>
        )}

        <div className="flex-1 overflow-hidden relative flex">
          <div className="flex-1 overflow-hidden">{renderContent()}</div>
          {viewLayout === 'default' && (
            <InfoPanel
              image={focusedImage}
              classification={focusedClassification}
              qualityScore={focusedQualityScore}
              qualitySubscores={focusedQualitySubscores}
              rotation={focusedRotation}
              isOpen={infoPanelOpen}
              onToggle={handleToggleInfoPanel}
              showFocusPeaking={showFocusPeaking}
              onToggleFocusPeaking={handleToggleFocusPeaking}
              showClipping={showClipping}
              onToggleClipping={handleToggleClipping}
            />
          )}
        </div>
      </div>

      <ExecutePanel
        classifications={filteredClassifications}
        rotatedCount={Object.values(state.rotations).filter((r) => r !== 0).length}
        isOpen={showExecutePanel}
        onClose={handleCloseExecute}
        onExecute={store.executeActions}
      />

      <ShortcutsTutorial isOpen={showShortcuts} onClose={() => setShowShortcuts(false)} />
    </DropZone>
  );
}

export default App;
