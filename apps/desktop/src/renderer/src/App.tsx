import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { MenuCommand } from '@photo-culler/types';
import { usePhotoStore, isScanIncomplete } from './hooks/usePhotoStore';
import { useKeyboardNav } from './hooks/useKeyboardNav';
import { useScoringWorker } from './hooks/useScoringWorker';
import { useOverlaySettings } from './hooks/useOverlaySettings';
import { useDetailedMetadata } from './hooks/useDetailedMetadata';
import { DropZone } from './components/DropZone';
import { Toolbar } from './components/Toolbar';
import { PhotoGrid } from './components/PhotoGrid';
import { EmptyState } from './components/EmptyState';
import { LoadingState, scanDetail } from './components/LoadingState';
import { ExecutePanel } from './components/ExecutePanel';
import { InfoPanel } from './components/InfoPanel';
import { LoupeView } from './components/LoupeView';
import { FilmstripView } from './components/FilmstripView';
import { ShortcutsTutorial } from './components/ShortcutsTutorial';
import { ContextMenu, sharedRating } from './components/ContextMenu';
import type { ContextMenuAction } from './components/ContextMenu';

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

/**
 * Confirmation for Delete/Backspace.
 *
 * Deletion is permanent now — there is no trash step to undo it from — so the
 * key that used to be one tap away from recoverable gets a stop.
 */
function ConfirmDeleteDialog({
  count,
  onCancel,
  onConfirm,
}: {
  count: number;
  onCancel: () => void;
  onConfirm: () => void;
}): React.JSX.Element {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onConfirm();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onCancel, onConfirm]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      data-testid="confirm-delete-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="bg-gray-800 rounded-lg shadow-xl p-6 w-[420px] max-w-[90vw]"
        data-testid="confirm-delete"
      >
        <h2 className="text-lg font-semibold mb-3 text-yellow-400">Delete</h2>
        <p className="text-sm mb-6">
          <span className="text-red-400 font-medium">
            Permanently delete {count} image{count !== 1 ? 's' : ''}?
          </span>{' '}
          <span className="text-gray-400">
            The file{count !== 1 ? 's do' : ' does'} not go to the trash and cannot be recovered.
          </span>
        </p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded text-sm font-medium transition-colors"
            data-testid="confirm-delete-cancel-btn"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            autoFocus
            className="px-4 py-2 bg-red-700 hover:bg-red-600 rounded text-sm font-medium transition-colors"
            data-testid="confirm-delete-btn"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function App(): React.JSX.Element {
  const store = usePhotoStore();
  const { state, folders, thumbnailWorker } = store;
  const scoringWorker = useScoringWorker();
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const scoringTriggeredRef = useRef<string | null>(null);
  const [showExecutePanel, setShowExecutePanel] = useState(false);
  const [infoPanelOpen, setInfoPanelOpen] = useState(true);
  const [showShortcuts, setShowShortcuts] = useState(false);
  /** Paths awaiting the delete confirmation, or null when nothing is pending. */
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null);
  /** Where the context menu is open, in viewport coordinates, or null. */
  const [contextMenuAt, setContextMenuAt] = useState<{ x: number; y: number } | null>(null);
  const [viewLayout, setViewLayout] = useState<'default' | 'loupe' | 'filmstrip'>('default');

  const { settings: overlaySettings, actions: overlayActions } = useOverlaySettings();

  /** Folders the user has collapsed. Keyed by absolute directory path. */
  const [collapsedFolders, setCollapsedFolders] = useState<ReadonlySet<string>>(new Set());

  const handleToggleFolder = useCallback((folderPath: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) next.delete(folderPath);
      else next.add(folderPath);
      return next;
    });
  }, []);

  /**
   * Navigation order. Collapsed folders are skipped, so an arrow key never
   * moves focus onto a photo the user cannot see.
   */
  const sortedFlatImages = useMemo(
    () =>
      folders
        .filter((section) => !collapsedFolders.has(section.path))
        .flatMap((section) => section.groups.flatMap((g) => g.images)),
    [folders, collapsedFolders],
  );

  /**
   * The same order as absolute paths, which is what a Shift-click range spans
   * and what the selection is reconciled against.
   */
  const visibleOrder = useMemo(() => sortedFlatImages.map((img) => img.path), [sortedFlatImages]);

  /**
   * Keep the store's idea of the visible order current.
   *
   * The store cannot work this out for itself — it depends on which folders are
   * collapsed, and that lives here. This one call is what reconciles the
   * selection after a filter, a search, a sort flip, a collapse, a rescan, an
   * open or a deletion: all of them move this list.
   */
  const { syncVisibleOrder } = store;
  useEffect(() => {
    syncVisibleOrder(visibleOrder);
  }, [visibleOrder, syncVisibleOrder]);

  /** Timestamp groups of the visible folders, for grid-shaped keyboard motion. */
  const navGroups = useMemo(
    () =>
      folders
        .filter((section) => !collapsedFolders.has(section.path))
        .flatMap((section) => section.groups),
    [folders, collapsedFolders],
  );

  /**
   * Delete/Backspace takes the whole selection, which is the focused image on
   * its own when nothing else is selected.
   */
  const handleDeleteSelection = useCallback(() => {
    if (store.selectionTargets.length > 0) {
      setPendingDelete(store.selectionTargets);
    }
  }, [store.selectionTargets]);

  const handleCancelDelete = useCallback(() => {
    setPendingDelete(null);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    const paths = pendingDelete;
    setPendingDelete(null);
    if (paths) void store.deleteImages(paths);
  }, [pendingDelete, store]);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenuAt(null);
  }, []);

  /**
   * Run a context-menu item against the selection.
   *
   * Delete goes through the same confirmation as the Delete key rather than
   * straight to the store: deletion is permanent and has no undo, and a menu
   * click is no more deliberate than a keypress.
   */
  const handleContextAction = useCallback(
    (action: ContextMenuAction) => {
      setContextMenuAt(null);
      switch (action.kind) {
        case 'rate':
          store.rateSelection(action.rating);
          break;
        case 'rotate':
          for (const path of store.selectionTargets) store.rotateImage(path, action.direction);
          break;
        case 'delete':
          handleDeleteSelection();
          break;
      }
    },
    [store, handleDeleteSelection],
  );

  /**
   * Close the context menu when the ground moves under it.
   *
   * It shuts itself on Escape, an outside mousedown and a scroll, which covers
   * every dismissal a pointer can express — but the native menu reaches none of
   * those: Open Folder, Rescan and the layout commands all arrive without a
   * click in the renderer, and a menu left standing over a different folder
   * would rate or delete that folder's images. `visibleOrder` covers the rest of
   * the list — filter, search, sort, collapse, deletion — since every one of
   * them moves it, and none of them can be provoked by opening the menu.
   */
  useEffect(() => {
    setContextMenuAt(null);
  }, [state.folderPath, viewLayout, visibleOrder]);

  /**
   * Whether the context menu is actually up. It needs a batch to act on, and a
   * menu offering "Delete 0 images" is worse than no menu — so an emptied
   * selection also takes the gate below down with it, rather than trapping the
   * keyboard behind an overlay with nothing in it.
   */
  const contextMenuOpen = contextMenuAt !== null && store.selectionTargets.length > 0;

  /**
   * True while a dialog is up. Every keyboard handler in this app listens on
   * the document, so without this they all still fire behind a modal — and one
   * of them deletes a photo.
   *
   * The context menu counts: while it is open the arrow keys belong to it, and
   * a Delete aimed at its own item must not also reach the grid.
   */
  const modalOpen = showExecutePanel || showShortcuts || pendingDelete !== null || contextMenuOpen;

  useKeyboardNav({
    groups: navGroups,
    focusedImageId: state.focusedImageId,
    onFocusChange: store.setFocusedImage,
    onRate: store.setRating,
    selectedPaths: store.selectionTargets,
    containerRef: gridContainerRef,
    onDeleteFocused: handleDeleteSelection,
    sortedFlatImages,
    thumbnailSize: state.thumbnailSize,
    onRotate: store.rotateImage,
    viewLayout,
    modalOpen,
  });

  const handleSelectFolder = useCallback(async () => {
    const folder = await window.api.selectFolder();
    if (folder) {
      store.openFolder(folder);
    }
  }, [store]);

  const handleRescan = useCallback(async () => {
    if (!state.folderPath) return;
    // Drop any queued write first, or it would rewrite the file we delete
    store.cancelPendingSave();
    await window.api.clearResults(state.folderPath);
    scoringTriggeredRef.current = null;
    store.openFolder(state.folderPath);
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
      // '?' still closes the shortcuts panel — that one is handled there, with
      // a capturing listener that stops the event before it reaches here.
      if (modalOpenRef.current) return;
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
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        if (e.key === 'p') {
          e.preventDefault();
          overlayActionsRef.current.toggleFocusPeaking();
        } else if (e.key === 'c') {
          e.preventDefault();
          overlayActionsRef.current.toggleClipping();
        } else if (e.key === 'a') {
          e.preventDefault();
          overlayActionsRef.current.toggleAfPoint();
        }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, []);

  const handleOpenExecute = useCallback(() => {
    setShowExecutePanel(true);
  }, []);

  const handleCloseExecute = useCallback(() => {
    setShowExecutePanel(false);
  }, []);

  const handleToggleInfoPanel = useCallback(() => {
    setInfoPanelOpen((prev) => !prev);
  }, []);

  // Focus the container after folder loads so keyboard nav works immediately
  useEffect(() => {
    if (!state.isLoading && state.images.length > 0 && gridContainerRef.current) {
      gridContainerRef.current.focus();
    }
  }, [state.isLoading, state.images.length]);

  // Reset scoring trigger when folder changes, and stop the outgoing folder's
  // run. Without the cancel, a folder that needs no scoring never calls
  // scoreAll, so the previous folder's worker kept delivering results that were
  // then attributed to the newly opened folder.
  useEffect(() => {
    scoringTriggeredRef.current = null;
    scoringWorker.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.folderPath]);

  // Trigger quality scoring after folder opens, with a 2-second delay
  // Uses stateRef inside timeout to avoid dependency on state.images (which changes during EXIF extraction)
  const storeRef = useRef(store);
  storeRef.current = store;
  const stateRef = useRef(state);
  stateRef.current = state;

  // Native menu commands. Dispatched through refs so the listener registers
  // once — re-registering on every render would stack IPC listeners.
  const handleRescanRef = useRef(handleRescan);
  handleRescanRef.current = handleRescan;
  const overlayActionsRef = useRef(overlayActions);
  overlayActionsRef.current = overlayActions;
  const modalOpenRef = useRef(modalOpen);
  modalOpenRef.current = modalOpen;

  useEffect(() => {
    if (!window.menuEvents?.onCommand) return;
    window.menuEvents.onCommand((command: MenuCommand) => {
      switch (command) {
        case 'rescan':
          handleRescanRef.current();
          break;
        case 'execute':
          setShowExecutePanel(true);
          break;
        case 'layout:default':
          setViewLayout('default');
          break;
        case 'layout:loupe':
          setViewLayout('loupe');
          break;
        case 'layout:filmstrip':
          setViewLayout('filmstrip');
          break;
        case 'thumbnail:small':
          storeRef.current.setThumbnailSize('small');
          break;
        case 'thumbnail:medium':
          storeRef.current.setThumbnailSize('medium');
          break;
        case 'thumbnail:large':
          storeRef.current.setThumbnailSize('large');
          break;
        case 'toggle-info-panel':
          setInfoPanelOpen((prev) => !prev);
          break;
        case 'show-shortcuts':
          setShowShortcuts((prev) => !prev);
          break;
        case 'toggle-focus-peaking':
          overlayActionsRef.current.toggleFocusPeaking();
          break;
        case 'toggle-clipping':
          overlayActionsRef.current.toggleClipping();
          break;
        case 'toggle-af-point':
          overlayActionsRef.current.toggleAfPoint();
          break;
        case 'clean-up-folder': {
          const folder = stateRef.current.folderPath;
          if (!folder) break;
          void (async () => {
            try {
              // Flush first: a queued write would otherwise land after the
              // clean-up and restore the very records it just removed.
              storeRef.current.cancelPendingSave();
              const result = await window.api.cleanUpFolder(folder);
              if (!result.cancelled && result.entriesRemoved > 0) {
                storeRef.current.pruneLoadedResults();
              }
            } catch {
              // The dialog in the main process already reported anything useful.
            }
          })();
          break;
        }
      }
    });
    return () => {
      window.menuEvents?.removeCommandListener();
    };
  }, []);

  const scanIncomplete = isScanIncomplete(state.scanProgress);

  useEffect(() => {
    if (!state.folderPath || state.isLoading) {
      return;
    }

    // Also waits out the metadata pass, which now runs while the grid is up.
    // Scoring reads WHOLE files — 6.2 MB each, and 7.2 a second is all the
    // spinning disk this was measured on gives — so starting it here would put
    // that in front of the 64 kB header reads still filling in dates and
    // ratings. Scores are advisory; a date the grid groups by is not.
    if (scanIncomplete) {
      return;
    }

    if (scoringTriggeredRef.current === state.folderPath) {
      return;
    }

    scoringTriggeredRef.current = state.folderPath;

    const timer = setTimeout(() => {
      const currentState = stateRef.current;
      const unscoredFiles = currentState.images
        .filter((img) => currentState.qualityScores[img.path] == null)
        .map((img) => ({ path: img.path, name: img.name }));

      console.log(
        `[scoring] ${unscoredFiles.length}/${currentState.images.length} images need scoring`,
      );

      if (unscoredFiles.length === 0) return;

      console.log(`[scoring] Starting scoring for ${unscoredFiles.length} images`);
      const scoredFolder = currentState.folderPath;
      scoringWorker.scoreAll(unscoredFiles, (imagePath, score, subscores) => {
        // Belt-and-braces alongside cancel(): never attribute a result to a
        // folder other than the one the run was started for.
        if (stateRef.current.folderPath !== scoredFolder) return;
        storeRef.current.setQualityScore(imagePath, score, subscores);
      });
    }, 2000);

    return () => clearTimeout(timer);
  }, [state.folderPath, state.isLoading, scanIncomplete]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scoring progress read directly from hook — no sync needed
  const scoringProgress = scoringWorker.progress;

  const visibleCount = store.filteredImages.length;

  /**
   * Rating per path for the visible images only. Execute works on what the
   * filters show, so this is what its counts and its confirmation quote.
   */
  const visibleRatings = useMemo(() => {
    const result: Record<string, number> = {};
    for (const img of store.filteredImages) {
      result[img.path] = state.ratings[img.path] ?? 0;
    }
    return result;
  }, [store.filteredImages, state.ratings]);

  // Find the focused image object
  const focusedImage = useMemo(() => {
    if (!state.focusedImageId) return null;
    return state.images.find((img) => img.path === state.focusedImageId) ?? null;
  }, [state.focusedImageId, state.images]);

  const focusedRating = useMemo(() => {
    if (!focusedImage) return 0;
    return state.ratings[focusedImage.path] ?? 0;
  }, [focusedImage, state.ratings]);

  const focusedQualityScore = useMemo(() => {
    if (!focusedImage) return undefined;
    return state.qualityScores[focusedImage.path];
  }, [focusedImage, state.qualityScores]);

  const focusedQualitySubscores = useMemo(() => {
    if (!focusedImage) return undefined;
    return state.qualitySubscores[focusedImage.path];
  }, [focusedImage, state.qualitySubscores]);

  const focusedRotation = useMemo(() => {
    if (!focusedImage) return 0;
    return state.rotations[focusedImage.path] ?? 0;
  }, [focusedImage, state.rotations]);

  // Only read deep metadata when something on screen will use it — without the
  // gate every arrow key would cost an exiftool read.
  const needsDetailedMeta =
    (viewLayout === 'default' && infoPanelOpen) || overlaySettings.showAfPoint;
  const detailedMeta = useDetailedMetadata(focusedImage?.path ?? null, needsDetailedMeta);

  const renderContent = (): React.JSX.Element => {
    if (state.isLoading) {
      return <LoadingState progress={state.scanProgress} />;
    }
    if (!state.folderPath) {
      return <WelcomeState onOpenFolder={handleSelectFolder} />;
    }
    if (folders.length === 0) {
      return <EmptyState />;
    }
    if (viewLayout === 'loupe' || viewLayout === 'filmstrip') {
      const DetailView = viewLayout === 'loupe' ? LoupeView : FilmstripView;
      return (
        <DetailView
          folders={folders}
          focusedImageId={state.focusedImageId}
          ratings={state.ratings}
          qualityScores={state.qualityScores}
          qualitySubscores={state.qualitySubscores}
          rotations={state.rotations}
          onImageFocus={store.setFocusedImage}
          onRate={store.setRating}
          getThumbnail={thumbnailWorker.getThumbnail}
          requestThumbnail={thumbnailWorker.requestThumbnail}
          overlaySettings={overlaySettings}
          overlayActions={overlayActions}
          detailedMeta={detailedMeta}
        />
      );
    }
    return (
      <PhotoGrid
        folders={folders}
        collapsedFolders={collapsedFolders}
        onToggleFolder={handleToggleFolder}
        ratings={state.ratings}
        qualityScores={state.qualityScores}
        rotations={state.rotations}
        thumbnailSize={state.thumbnailSize}
        focusedImageId={state.focusedImageId}
        selection={state.selection}
        onImageSelect={store.selectImage}
        onOpenContextMenu={setContextMenuAt}
        onRate={store.setRating}
        getThumbnail={thumbnailWorker.getThumbnail}
        requestThumbnail={thumbnailWorker.requestThumbnail}
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
          sortDirection={state.sortDirection}
          filterExtensions={state.filterExtensions}
          filterRatingRange={state.filterRatingRange}
          searchQuery={state.searchQuery}
          thumbnailSize={state.thumbnailSize}
          groupingThresholdMs={state.groupingThresholdMs}
          visibleCount={visibleCount}
          selectionCount={state.selection.size}
          folderPath={state.folderPath}
          onSelectFolder={handleSelectFolder}
          onRescan={handleRescan}
          onSortDirectionChange={store.setSortDirection}
          onFilterExtensionsChange={store.setFilterExtensions}
          onFilterRatingRangeChange={store.setFilterRatingRange}
          onSearchQueryChange={store.setSearchQuery}
          onThumbnailSizeChange={store.setThumbnailSize}
          onGroupingThresholdChange={store.setGroupingThresholdMs}
          scoringProgress={scoringProgress}
          thumbnailProgress={state.thumbnailProgress}
          viewLayout={viewLayout}
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

        {/* The scan is still reading headers, and it shows: dates regroup and
            stars appear on their own for a few seconds. A count is the whole
            difference between that looking like progress and looking like a
            bug — and, unlike a spinner, it distinguishes two seconds left from
            twenty. */}
        {scanIncomplete && !state.isLoading && (
          <div
            className="bg-gray-800 text-gray-400 px-4 py-1 text-xs flex items-center gap-2 border-b border-gray-700"
            data-testid="scan-progress"
          >
            <span className="w-3 h-3 border-2 border-gray-700 border-t-blue-500 rounded-full animate-spin" />
            <span>{scanDetail(state.scanProgress)}</span>
          </div>
        )}

        <div className="flex-1 overflow-hidden relative flex">
          <div className="flex-1 overflow-hidden">{renderContent()}</div>
          {viewLayout === 'default' && (
            <InfoPanel
              image={focusedImage}
              rating={focusedRating}
              onRate={store.setRating}
              qualityScore={focusedQualityScore}
              qualitySubscores={focusedQualitySubscores}
              rotation={focusedRotation}
              isOpen={infoPanelOpen}
              onToggle={handleToggleInfoPanel}
              overlaySettings={overlaySettings}
              overlayActions={overlayActions}
              detailedMeta={detailedMeta}
            />
          )}
        </div>
      </div>

      <ExecutePanel
        visibleRatings={visibleRatings}
        rotatedCount={Object.values(state.rotations).filter((r) => r !== 0).length}
        isOpen={showExecutePanel}
        onClose={handleCloseExecute}
        onExecute={store.executeActions}
      />

      {pendingDelete !== null && (
        <ConfirmDeleteDialog
          count={pendingDelete.length}
          onCancel={handleCancelDelete}
          onConfirm={handleConfirmDelete}
        />
      )}

      {contextMenuOpen && contextMenuAt !== null && (
        <ContextMenu
          x={contextMenuAt.x}
          y={contextMenuAt.y}
          count={store.selectionTargets.length}
          rating={sharedRating(store.selectionTargets, state.ratings)}
          onAction={handleContextAction}
          onClose={handleCloseContextMenu}
        />
      )}

      <ShortcutsTutorial isOpen={showShortcuts} onClose={() => setShowShortcuts(false)} />
    </DropZone>
  );
}

export default App;
