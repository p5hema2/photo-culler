import { useState, useEffect, useRef } from 'react';
import type { ImageFileInfo } from '@photo-culler/types';
import type { Classification } from './ThumbnailCell';

interface InfoPanelProps {
  image: ImageFileInfo | null;
  classification: Classification;
  isOpen: boolean;
  onToggle: () => void;
}

const CLASSIFICATION_BADGES: Record<Classification, { label: string; className: string }> = {
  keep: { label: 'Keep', className: 'bg-green-900 text-green-300 border-green-500' },
  review: { label: 'Review', className: 'bg-yellow-900 text-yellow-300 border-yellow-500' },
  delete: { label: 'Delete', className: 'bg-red-900 text-red-300 border-red-500' },
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString();
}

export function InfoPanel({
  image,
  classification,
  isOpen,
  onToggle,
}: InfoPanelProps): React.JSX.Element {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const prevPathRef = useRef<string | null>(null);

  // Load large preview via IPC
  useEffect(() => {
    if (!isOpen || !image) {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
      }
      prevPathRef.current = null;
      return;
    }

    // Skip if same image
    if (prevPathRef.current === image.path) return;
    prevPathRef.current = image.path;

    let cancelled = false;

    const loadPreview = async (): Promise<void> => {
      setLoadingPreview(true);
      try {
        const buffer = await window.api.readFile(image.path);
        if (cancelled) return;

        const ext = image.extension.toLowerCase();
        const mimeMap: Record<string, string> = {
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          png: 'image/png',
          webp: 'image/webp',
          tiff: 'image/tiff',
          tif: 'image/tiff',
        };
        const mimeType = mimeMap[ext] ?? 'image/jpeg';
        const blob = new Blob([buffer], { type: mimeType });
        const url = URL.createObjectURL(blob);

        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }

        // Revoke old URL
        if (previewUrl) {
          URL.revokeObjectURL(previewUrl);
        }

        setPreviewUrl(url);
      } catch {
        if (!cancelled) {
          setPreviewUrl(null);
        }
      } finally {
        if (!cancelled) {
          setLoadingPreview(false);
        }
      }
    };

    loadPreview();

    return () => {
      cancelled = true;
    };
  }, [isOpen, image?.path]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const badge = CLASSIFICATION_BADGES[classification];

  // Compute quick stats
  const megapixels =
    image?.width && image?.height
      ? ((image.width * image.height) / 1_000_000).toFixed(1)
      : null;
  const aspectRatio =
    image?.width && image?.height
      ? (() => {
          const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
          const d = gcd(image.width!, image.height!);
          return `${image.width! / d}:${image.height! / d}`;
        })()
      : null;

  return (
    <>
      {/* Toggle button — always visible */}
      <button
        onClick={onToggle}
        className="absolute top-2 right-2 z-10 px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded text-gray-300 transition-colors"
        data-testid="info-panel-toggle"
        title={isOpen ? 'Hide info panel' : 'Show info panel'}
      >
        {isOpen ? 'Info \u25B6' : '\u25C0 Info'}
      </button>

      {isOpen && (
        <div
          className="w-80 flex-shrink-0 bg-gray-850 border-l border-gray-700 overflow-y-auto flex flex-col"
          style={{ backgroundColor: '#1a1d23' }}
          data-testid="info-panel"
        >
          {!image ? (
            <div className="flex items-center justify-center h-full text-gray-500 text-sm px-4 text-center">
              Select an image to see details
            </div>
          ) : (
            <div className="flex flex-col">
              {/* Large preview */}
              <div className="relative w-full aspect-square bg-gray-800">
                {loadingPreview && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-6 h-6 border-2 border-gray-600 border-t-blue-500 rounded-full animate-spin" />
                  </div>
                )}
                {previewUrl && (
                  <img
                    src={previewUrl}
                    alt={image.name}
                    className="w-full h-full object-contain"
                    data-testid="info-panel-preview"
                  />
                )}
              </div>

              {/* Info content */}
              <div className="p-4 flex flex-col gap-3">
                {/* Filename */}
                <h2
                  className="text-sm font-semibold text-white truncate"
                  title={image.name}
                  data-testid="info-panel-filename"
                >
                  {image.name}
                </h2>

                {/* Classification badge */}
                <div>
                  <span
                    className={`inline-block px-2 py-0.5 text-xs rounded border ${badge.className}`}
                    data-testid="info-panel-classification"
                  >
                    {badge.label}
                  </span>
                </div>

                {/* File metadata */}
                <div className="flex flex-col gap-1.5 text-xs text-gray-400">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Size</span>
                    <span>{formatFileSize(image.size)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Extension</span>
                    <span className="uppercase">{image.extension}</span>
                  </div>
                  {image.width && image.height && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Dimensions</span>
                      <span>{image.width} x {image.height}</span>
                    </div>
                  )}
                  {image.dateTaken && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Date Taken</span>
                      <span>{formatDate(image.dateTaken)}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-gray-500">Modified</span>
                    <span>{formatDate(image.lastModified)}</span>
                  </div>
                </div>

                {/* Quick stats */}
                {(megapixels || aspectRatio) && (
                  <div className="border-t border-gray-700 pt-2 flex flex-col gap-1.5 text-xs text-gray-400">
                    {megapixels && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Megapixels</span>
                        <span>{megapixels} MP</span>
                      </div>
                    )}
                    {aspectRatio && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Aspect Ratio</span>
                        <span>{aspectRatio}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
