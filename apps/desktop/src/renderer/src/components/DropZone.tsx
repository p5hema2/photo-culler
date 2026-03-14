import { useState, useCallback, useRef, useEffect } from 'react';

interface DropZoneProps {
  onFolderDrop: (folderPath: string) => void;
  children: React.ReactNode;
}

export function DropZone({ onFolderDrop, children }: DropZoneProps): React.JSX.Element {
  const [isDragOver, setIsDragOver] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const dragCounterRef = useRef(0);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, []);

  const showError = useCallback((msg: string) => {
    setErrorMessage(msg);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => {
      setErrorMessage(null);
      errorTimerRef.current = null;
    }, 3000);
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (dragCounterRef.current === 1) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDragOver(false);

      const items = e.dataTransfer.items;
      if (!items || items.length === 0) return;

      // Check if dropped item is a directory
      const item = items[0];
      if (item) {
        const entry = item.webkitGetAsEntry?.();
        if (entry?.isDirectory) {
          // Electron exposes .path on File objects
          const file = e.dataTransfer.files[0];
          if (file && 'path' in file && typeof (file as File & { path: string }).path === 'string') {
            onFolderDrop((file as File & { path: string }).path);
          }
        } else {
          showError('Drop a folder, not a file');
        }
      }
    },
    [onFolderDrop, showError],
  );

  return (
    <div
      className="relative w-full h-full"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      data-testid="drop-zone"
    >
      {children}

      {/* Drag overlay */}
      {isDragOver && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-blue-900/80"
          data-testid="drop-overlay"
        >
          <div className="text-center">
            <svg
              className="w-16 h-16 mx-auto mb-4 text-blue-300"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
              />
            </svg>
            <p className="text-xl text-blue-200 font-medium">Drop folder to open</p>
          </div>
        </div>
      )}

      {/* Error toast */}
      {errorMessage && (
        <div
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-red-800 text-red-200 rounded-lg text-sm shadow-lg"
          data-testid="drop-error"
        >
          {errorMessage}
        </div>
      )}
    </div>
  );
}
