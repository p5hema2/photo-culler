import { useState, useEffect, useRef } from 'react';
import type { ImageFileInfo, QualitySubscores } from '@photo-culler/types';
import type { Classification } from './ThumbnailCell';
import { Histogram } from './Histogram';
import { useZoomPan } from '../hooks/useZoomPan';
import { FocusPeakingOverlay } from './FocusPeakingOverlay';
import { ExposureClippingOverlay } from './ExposureClippingOverlay';
import { RotatedImageStage } from './RotatedImageStage';
import { AfPointOverlay } from './AfPointOverlay';
import { OverlayControls } from './OverlayControls';
import { CollapsibleSection } from './CollapsibleSection';
import type { OverlaySettings, OverlayActions } from '../hooks/useOverlaySettings';
import type { DetailedMetadataState } from '../hooks/useDetailedMetadata';

interface InfoPanelProps {
  image: ImageFileInfo | null;
  classification: Classification;
  qualityScore?: number;
  qualitySubscores?: QualitySubscores;
  rotation?: number;
  isOpen: boolean;
  onToggle: () => void;
  overlaySettings: OverlaySettings;
  overlayActions: OverlayActions;
  detailedMeta: DetailedMetadataState;
}

const CLASSIFICATION_BADGES: Record<string, { label: string; className: string }> = {
  keep: { label: 'Keep', className: 'bg-green-900 text-green-300 border-green-500' },
  review: { label: 'Review', className: 'bg-yellow-900 text-yellow-300 border-yellow-500' },
  delete: { label: 'Delete', className: 'bg-red-900 text-red-300 border-red-500' },
  null: { label: 'Unscored', className: 'bg-gray-700 text-gray-400 border-gray-500' },
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString();
}

function formatDateLocal(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { timeZone: 'UTC' });
}

/** Map common UTC offsets to timezone abbreviations */
function offsetToLabel(offset: string): string {
  const labels: Record<string, string> = {
    '+00:00': 'UTC',
    '-00:00': 'UTC',
    '+01:00': 'CET',
    '+02:00': 'CEST',
    '+03:00': 'MSK',
    '+04:00': 'GST',
    '+05:00': 'PKT',
    '+05:30': 'IST',
    '+07:00': 'ICT',
    '+08:00': 'CST',
    '+09:00': 'JST',
    '+10:00': 'AEST',
    '-05:00': 'EST',
    '-04:00': 'EDT',
    '-06:00': 'CST',
    '-07:00': 'MST',
    '-08:00': 'PST',
  };
  return labels[offset] ?? `UTC${offset}`;
}

const SUBSCORE_TOOLTIPS: Record<keyof QualitySubscores, string> = {
  sharpness: 'Laplacian variance — measures edge detail and focus quality (weight: 40%)',
  exposure: 'Luminance analysis — penalizes over/underexposure and clipped pixels (weight: 25%)',
  contrast: 'Luminance std deviation — optimal range is 40–80 stddev (weight: 20%)',
  noise: 'Flat-region variance — lower noise in smooth areas = higher score (weight: 15%)',
};

const SUBSCORE_LABELS: Record<keyof QualitySubscores, string> = {
  sharpness: 'Sharpness',
  exposure: 'Exposure',
  contrast: 'Contrast',
  noise: 'Noise',
};

const SUBSCORE_WEIGHTS: Record<keyof QualitySubscores, number> = {
  sharpness: 0.4,
  exposure: 0.25,
  contrast: 0.2,
  noise: 0.15,
};

function scoreColor(score: number): string {
  if (score >= 60) return 'bg-green-500';
  if (score >= 35) return 'bg-yellow-500';
  return 'bg-red-500';
}

function scoreTextColor(score: number): string {
  if (score >= 60) return 'text-green-400';
  if (score >= 35) return 'text-yellow-400';
  return 'text-red-400';
}

export function InfoPanel({
  image,
  classification,
  qualityScore,
  qualitySubscores,
  rotation = 0,
  isOpen,
  onToggle,
  overlaySettings,
  overlayActions,
  detailedMeta,
}: InfoPanelProps): React.JSX.Element {
  const { showFocusPeaking, showClipping, showAfPoint, focusPeakingThreshold } = overlaySettings;
  const focus = detailedMeta.status === 'ready' ? detailedMeta.data.focus : null;
  const lens = detailedMeta.status === 'ready' ? detailedMeta.data.lens : null;
  const extraTags = detailedMeta.status === 'ready' ? detailedMeta.data.tags : [];
  const afPoint = focus?.regions.find((r) => r.kind === 'af-point') ?? null;
  const faceCount =
    focus?.facesDetected ?? focus?.regions.filter((r) => r.kind === 'face').length ?? 0;
  const [tagFilter, setTagFilter] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const previewImgRef = useRef<HTMLImageElement | null>(null);
  const [previewImgElement, setPreviewImgElement] = useState<HTMLImageElement | null>(null);
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const zoomPan = useZoomPan({
    imageWidth: imageDimensions.width,
    imageHeight: imageDimensions.height,
    containerRef,
  });

  // Reset zoom when image changes
  useEffect(() => {
    zoomPan.resetZoom();
  }, [image?.path]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load large preview via IPC — runs on every image change
  useEffect(() => {
    setPreviewImgElement(null);

    if (!isOpen || !image) {
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return;
    }

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

        setPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
      } catch {
        if (!cancelled) {
          setPreviewUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return null;
          });
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
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, []);

  const badge = CLASSIFICATION_BADGES[String(classification)] ?? CLASSIFICATION_BADGES['null'];

  // Compute quick stats
  const megapixels =
    image?.width && image?.height ? ((image.width * image.height) / 1_000_000).toFixed(1) : null;
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
          className="flex-shrink-0 bg-gray-850 border-l border-gray-700 flex flex-col h-full overflow-hidden"
          style={{ backgroundColor: '#1a1d23', width: '50%', minWidth: '400px', maxWidth: '60%' }}
          data-testid="info-panel"
        >
          {!image ? (
            <div className="flex items-center justify-center h-full text-gray-500 text-sm px-4 text-center">
              Select an image to see details
            </div>
          ) : (
            <div className="flex flex-col h-full overflow-hidden">
              {/* Large preview with zoom/pan — takes remaining space */}
              <div
                ref={containerRef}
                className="relative w-full bg-black overflow-hidden flex-1 min-h-0"
                onWheel={zoomPan.handlers.onWheel}
                onMouseDown={zoomPan.handlers.onMouseDown}
              >
                {loadingPreview && (
                  <div className="absolute inset-0 flex items-center justify-center z-10">
                    <div className="w-6 h-6 border-2 border-gray-600 border-t-blue-500 rounded-full animate-spin" />
                  </div>
                )}
                {previewUrl && (
                  <div
                    style={{
                      transform: `scale(${zoomPan.zoom}) translate(${zoomPan.panX}px, ${zoomPan.panY}px)`,
                      transformOrigin: '0 0',
                      willChange: 'transform',
                      position: 'relative',
                      display: 'inline-block',
                    }}
                  >
                    <RotatedImageStage
                      width={imageDimensions.width}
                      height={imageDimensions.height}
                      rotation={rotation ?? 0}
                    >
                      <img
                        ref={(el) => {
                          previewImgRef.current = el;
                        }}
                        src={previewUrl}
                        alt={image.name}
                        className="max-w-none select-none"
                        crossOrigin="anonymous"
                        draggable={false}
                        data-testid="info-panel-preview"
                        onLoad={() => {
                          const el = previewImgRef.current;
                          if (el) {
                            setImageDimensions({
                              width: el.naturalWidth,
                              height: el.naturalHeight,
                            });
                          }
                          setPreviewImgElement(previewImgRef.current);
                        }}
                      />
                      {showFocusPeaking && (
                        <FocusPeakingOverlay
                          imageUrl={previewUrl}
                          imageDimensions={imageDimensions}
                          visible={showFocusPeaking}
                          threshold={focusPeakingThreshold}
                        />
                      )}
                      {showClipping && (
                        <ExposureClippingOverlay
                          imageUrl={previewUrl}
                          imageDimensions={imageDimensions}
                          visible={showClipping}
                        />
                      )}
                      {showAfPoint && (
                        <AfPointOverlay
                          focus={focus}
                          imageDimensions={imageDimensions}
                          zoom={zoomPan.zoom}
                          visible={showAfPoint}
                        />
                      )}
                    </RotatedImageStage>
                  </div>
                )}
                {/* Zoom controls */}
                <div className="absolute top-2 left-2 flex gap-1 z-20">
                  <button
                    onClick={zoomPan.fitToWindow}
                    className="px-2 py-1 bg-gray-800/80 hover:bg-gray-700 rounded text-xs text-white"
                  >
                    Fit
                  </button>
                  <button
                    onClick={zoomPan.zoomTo100}
                    className="px-2 py-1 bg-gray-800/80 hover:bg-gray-700 rounded text-xs text-white"
                  >
                    100%
                  </button>
                </div>
              </div>

              {/* Info section — fixed height, no shrink */}
              <div className="flex-shrink-0 overflow-y-auto" style={{ scrollbarGutter: 'stable' }}>
                {/* RGB Histogram — fixed height to prevent layout shift */}
                <div className="px-5 pt-3" style={{ height: '92px' }}>
                  <Histogram imageElement={previewImgElement} />
                </div>

                {/* Overlay toggles — kept mounted so the layout does not jump
                    while the preview loads */}
                <div className="px-5 pt-3">
                  <OverlayControls
                    settings={overlaySettings}
                    actions={overlayActions}
                    surface="panel"
                    afAvailable={detailedMeta.status !== 'unsupported'}
                  />
                </div>

                {/* Info content */}
                <div className="p-5 pr-3 flex flex-col gap-4">
                  {/* Header: filename + badge */}
                  <div className="flex items-center gap-3">
                    <h2
                      className="text-base font-semibold text-white truncate flex-1"
                      title={image.name}
                      data-testid="info-panel-filename"
                    >
                      {image.name}
                    </h2>
                    <span
                      className={`inline-block px-2 py-0.5 text-xs rounded border flex-shrink-0 ${badge.className}`}
                      data-testid="info-panel-classification"
                    >
                      {badge.label}
                    </span>
                  </div>

                  {/* Quality score with subscores */}
                  {qualityScore != null && (
                    <div className="flex flex-col gap-2" data-testid="info-panel-score">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-sm font-mono font-semibold ${scoreTextColor(qualityScore)}`}
                          title="Weighted composite: 40% sharpness + 25% exposure + 20% contrast + 15% noise"
                        >
                          Score: {qualityScore}%
                        </span>
                      </div>
                      {qualitySubscores && (
                        <div className="flex flex-col gap-1.5">
                          {(Object.keys(SUBSCORE_LABELS) as Array<keyof QualitySubscores>).map(
                            (key) => (
                              <div
                                key={key}
                                className="flex items-center gap-2"
                                title={SUBSCORE_TOOLTIPS[key]}
                              >
                                <span className="text-[10px] text-gray-500 w-16 text-right flex-shrink-0">
                                  {SUBSCORE_LABELS[key]}
                                </span>
                                <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full ${scoreColor(qualitySubscores[key])}`}
                                    style={{ width: `${qualitySubscores[key]}%` }}
                                  />
                                </div>
                                <span
                                  className={`text-[10px] font-mono w-7 text-right flex-shrink-0 ${scoreTextColor(qualitySubscores[key])}`}
                                >
                                  {qualitySubscores[key]}
                                </span>
                                <span className="text-[9px] text-gray-600 w-6 text-right flex-shrink-0">
                                  ×{SUBSCORE_WEIGHTS[key].toFixed(2).slice(1)}
                                </span>
                              </div>
                            ),
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Exposure summary bar — full width */}
                  {(image.aperture || image.shutterSpeed || image.iso || image.focalLength) && (
                    <div className="flex gap-4 text-sm text-white font-mono py-1.5 px-3 bg-gray-800 rounded">
                      {image.aperture && <span>f/{image.aperture}</span>}
                      {image.shutterSpeed && <span>{image.shutterSpeed}</span>}
                      {image.iso && <span>ISO {image.iso}</span>}
                      {image.focalLength && <span>{image.focalLength}mm</span>}
                      {image.exposureCompensation != null && image.exposureCompensation !== 0 && (
                        <span>
                          {image.exposureCompensation > 0 ? '+' : ''}
                          {image.exposureCompensation.toFixed(1)} EV
                        </span>
                      )}
                    </div>
                  )}

                  {/* Details, behind disclosures. The panel opens on the
                      histogram, score and exposure line; everything else is
                      one click away. */}
                  <CollapsibleSection title="Focus" testId="info-section-focus-group">
                    <div className="flex flex-col gap-3 text-xs text-gray-400">
                      {/* Focus — from the maker note via exiftool. Sits next to
                            the lens info it relates to. */}
                      {(focus || lens?.id || detailedMeta.status === 'loading') && (
                        <div className="flex flex-col gap-1.5" data-testid="info-panel-focus">
                          <div className="text-gray-500 uppercase tracking-wider text-[10px] font-semibold">
                            Focus
                          </div>
                          {detailedMeta.status === 'loading' && (
                            <div className="text-gray-600 animate-pulse">Reading…</div>
                          )}
                          {focus?.modeLabel && (
                            <div
                              className="flex justify-between"
                              data-testid="info-panel-focus-mode"
                            >
                              <span className="text-gray-500">Mode</span>
                              <span className="text-right">{focus.modeLabel}</span>
                            </div>
                          )}
                          {focus?.areaMode && (
                            <div className="flex justify-between" data-testid="info-panel-af-area">
                              <span className="text-gray-500">AF Area</span>
                              <span className="text-right">{focus.areaMode}</span>
                            </div>
                          )}
                          {focus?.subjectDetection && (
                            <div className="flex justify-between">
                              <span className="text-gray-500">Subject</span>
                              <span className="text-right">{focus.subjectDetection}</span>
                            </div>
                          )}
                          {afPoint && (
                            <div className="flex justify-between" data-testid="info-panel-af-point">
                              <span className="text-gray-500">AF Point</span>
                              <span className="text-right font-mono">
                                {Math.round(afPoint.rect.cx * 100)}%,{' '}
                                {Math.round(afPoint.rect.cy * 100)}%
                              </span>
                            </div>
                          )}
                          {faceCount > 0 && (
                            <div className="flex justify-between" data-testid="info-panel-faces">
                              <span className="text-gray-500">Faces</span>
                              <span className="text-right">{faceCount}</span>
                            </div>
                          )}
                          {focus?.assistLamp && (
                            <div className="flex justify-between">
                              <span className="text-gray-500">AF Assist</span>
                              <span className="text-right">{focus.assistLamp}</span>
                            </div>
                          )}
                          {lens?.id && (
                            <div className="flex justify-between">
                              <span className="text-gray-500">Lens ID</span>
                              <span className="text-right max-w-[70%] truncate" title={lens.id}>
                                {lens.id}
                              </span>
                            </div>
                          )}
                          {lens?.serial && (
                            <div className="flex justify-between">
                              <span className="text-gray-500">Lens S/N</span>
                              <span className="text-right font-mono">{lens.serial}</span>
                            </div>
                          )}
                          {detailedMeta.status === 'unsupported' && (
                            <div className="text-gray-600">
                              No focus data (manual focus or unsupported camera)
                            </div>
                          )}
                          {detailedMeta.status === 'error' && (
                            <div className="text-gray-600">Could not read metadata</div>
                          )}
                        </div>
                      )}
                    </div>
                  </CollapsibleSection>

                  <CollapsibleSection title="Camera" testId="info-section-camera">
                    <div className="flex flex-col gap-3 text-xs text-gray-400">
                      {/* Camera & Lens */}
                      {(image.cameraMake || image.cameraModel || image.lensModel) && (
                        <div className="flex flex-col gap-1.5">
                          <div className="text-gray-500 uppercase tracking-wider text-[10px] font-semibold">
                            Camera
                          </div>
                          {(image.cameraMake || image.cameraModel) && (
                            <div className="flex justify-between">
                              <span className="text-gray-500">Body</span>
                              <span className="text-right">
                                {[image.cameraMake, image.cameraModel].filter(Boolean).join(' ')}
                              </span>
                            </div>
                          )}
                          {image.lensModel && (
                            <div className="flex justify-between">
                              <span className="text-gray-500">Lens</span>
                              <span
                                className="text-right max-w-[70%] truncate"
                                title={image.lensModel}
                              >
                                {image.lensModel}
                              </span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Exposure Details */}
                      {(image.exposureProgram ||
                        image.meteringMode ||
                        image.flash ||
                        image.whiteBalance) && (
                        <div className="flex flex-col gap-1.5">
                          <div className="text-gray-500 uppercase tracking-wider text-[10px] font-semibold">
                            Settings
                          </div>
                          {image.exposureProgram && (
                            <div className="flex justify-between">
                              <span className="text-gray-500">Program</span>
                              <span>{image.exposureProgram}</span>
                            </div>
                          )}
                          {image.meteringMode && (
                            <div className="flex justify-between">
                              <span className="text-gray-500">Metering</span>
                              <span>{image.meteringMode}</span>
                            </div>
                          )}
                          {image.flash && (
                            <div className="flex justify-between">
                              <span className="text-gray-500">Flash</span>
                              <span>{image.flash}</span>
                            </div>
                          )}
                          {image.whiteBalance && (
                            <div className="flex justify-between">
                              <span className="text-gray-500">WB</span>
                              <span>{image.whiteBalance}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </CollapsibleSection>

                  <CollapsibleSection title="File" testId="info-section-file">
                    <div className="flex flex-col gap-3 text-xs text-gray-400">
                      <div className="flex flex-col gap-1.5">
                        <div className="text-gray-500 uppercase tracking-wider text-[10px] font-semibold">
                          File
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Size</span>
                          <span>{formatFileSize(image.size)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Format</span>
                          <span className="uppercase">{image.extension}</span>
                        </div>
                        {image.width && image.height && (
                          <div className="flex justify-between">
                            <span className="text-gray-500">Dimensions</span>
                            <span>
                              {image.width} x {image.height}
                            </span>
                          </div>
                        )}
                        {megapixels && (
                          <div className="flex justify-between">
                            <span className="text-gray-500">Megapixels</span>
                            <span>{megapixels} MP</span>
                          </div>
                        )}
                        {aspectRatio && (
                          <div className="flex justify-between">
                            <span className="text-gray-500">Ratio</span>
                            <span>{aspectRatio}</span>
                          </div>
                        )}
                        {image.colorSpace && (
                          <div className="flex justify-between">
                            <span className="text-gray-500">Color</span>
                            <span>{image.colorSpace}</span>
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <div className="text-gray-500 uppercase tracking-wider text-[10px] font-semibold">
                          Dates
                        </div>
                        {(image.dateTakenLocal ?? image.dateTaken) != null && (
                          <div className="flex justify-between">
                            <span className="text-gray-500">Taken</span>
                            <span>
                              {formatDateLocal(image.dateTakenLocal ?? image.dateTaken!)}
                              {image.timezoneOffset && (
                                <span className="text-gray-500 ml-1 text-[10px]">
                                  {offsetToLabel(image.timezoneOffset)}
                                </span>
                              )}
                            </span>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span className="text-gray-500">Modified</span>
                          <span>
                            {formatDate(image.lastModified)}
                            <span className="text-gray-500 ml-1 text-[10px]">
                              {offsetToLabel(
                                (() => {
                                  const off = -new Date(image.lastModified).getTimezoneOffset();
                                  const sign = off >= 0 ? '+' : '-';
                                  const h = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0');
                                  const m = String(Math.abs(off) % 60).padStart(2, '0');
                                  return `${sign}${h}:${m}`;
                                })(),
                              )}
                            </span>
                          </span>
                        </div>
                      </div>
                    </div>
                  </CollapsibleSection>

                  {/* All metadata — height-capped: the info section is
                      flex-shrink-0, so an uncapped 300-tag dump would grow
                      without bound and crush the preview above it. */}
                  {extraTags.length > 0 && (
                    <CollapsibleSection
                      title="All metadata"
                      badge={extraTags.length}
                      testId="info-section-all-tags"
                    >
                      <div className="flex flex-col gap-1.5">
                        <input
                          value={tagFilter}
                          onChange={(e) => setTagFilter(e.target.value)}
                          placeholder="Filter tags…"
                          className="px-2 py-1 text-xs bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                          data-testid="info-panel-tag-filter"
                        />
                        <div
                          className="max-h-64 overflow-y-auto flex flex-col gap-1 text-xs text-gray-400 pr-3"
                          style={{ scrollbarGutter: 'stable' }}
                          data-testid="info-panel-all-tags"
                        >
                          {extraTags
                            .filter((t) =>
                              tagFilter
                                ? `${t.group}:${t.name}`
                                    .toLowerCase()
                                    .includes(tagFilter.toLowerCase())
                                : true,
                            )
                            .map((t) => (
                              <div
                                key={`${t.group}:${t.name}`}
                                className="flex justify-between gap-2"
                              >
                                <span
                                  className="text-gray-500 truncate"
                                  title={`${t.group}:${t.name}`}
                                >
                                  {t.name}
                                </span>
                                <span className="text-right max-w-[55%] truncate" title={t.value}>
                                  {t.value}
                                </span>
                              </div>
                            ))}
                        </div>
                      </div>
                    </CollapsibleSection>
                  )}
                </div>
              </div>
              {/* end flex-shrink-0 info section */}
            </div>
          )}
        </div>
      )}
    </>
  );
}
