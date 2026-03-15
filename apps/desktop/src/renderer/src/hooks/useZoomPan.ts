import { useState, useCallback, useEffect, useRef } from 'react';

interface UseZoomPanOptions {
  imageWidth: number;
  imageHeight: number;
  containerRef: React.RefObject<HTMLElement | null>;
}

interface UseZoomPanReturn {
  zoom: number;
  panX: number;
  panY: number;
  isDragging: boolean;
  handlers: {
    onWheel: (e: React.WheelEvent) => void;
    onMouseDown: (e: React.MouseEvent) => void;
  };
  resetZoom: () => void;
  zoomTo100: () => void;
  fitToWindow: () => void;
}

interface ZoomPanState {
  zoom: number;
  panX: number;
  panY: number;
  fitZoom: number;
  isDragging: boolean;
}

export function useZoomPan({
  imageWidth,
  imageHeight,
  containerRef,
}: UseZoomPanOptions): UseZoomPanReturn {
  const [state, setState] = useState<ZoomPanState>({
    zoom: 1,
    panX: 0,
    panY: 0,
    fitZoom: 1,
    isDragging: false,
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  const dragStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const rafRef = useRef<number | null>(null);

  // Calculate fit-to-window zoom
  const calcFitZoom = useCallback((): number => {
    const container = containerRef.current;
    if (!container || imageWidth === 0 || imageHeight === 0) return 1;
    const rect = container.getBoundingClientRect();
    return Math.min(rect.width / imageWidth, rect.height / imageHeight);
  }, [containerRef, imageWidth, imageHeight]);

  // Center pan for a given zoom level
  const calcCenterPan = useCallback(
    (zoom: number): { panX: number; panY: number } => {
      const container = containerRef.current;
      if (!container || imageWidth === 0 || imageHeight === 0) return { panX: 0, panY: 0 };
      const rect = container.getBoundingClientRect();
      const scaledW = imageWidth * zoom;
      const scaledH = imageHeight * zoom;
      return {
        panX: (rect.width - scaledW) / 2 / zoom,
        panY: (rect.height - scaledH) / 2 / zoom,
      };
    },
    [containerRef, imageWidth, imageHeight],
  );

  // Fit to window
  const fitToWindow = useCallback(() => {
    const fitZ = calcFitZoom();
    const center = calcCenterPan(fitZ);
    setState({
      zoom: fitZ,
      panX: center.panX,
      panY: center.panY,
      fitZoom: fitZ,
      isDragging: false,
    });
  }, [calcFitZoom, calcCenterPan]);

  const resetZoom = fitToWindow;

  // Zoom to 100%
  const zoomTo100 = useCallback(() => {
    const fitZ = calcFitZoom();
    const center = calcCenterPan(1);
    setState({
      zoom: 1,
      panX: center.panX,
      panY: center.panY,
      fitZoom: fitZ,
      isDragging: false,
    });
  }, [calcFitZoom, calcCenterPan]);

  // ResizeObserver to recalculate fitZoom on container resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      const newFitZoom = calcFitZoom();
      setState((prev) => {
        // If currently at fit zoom, update zoom to match new fit
        const wasFitted = Math.abs(prev.zoom - prev.fitZoom) < 0.001;
        if (wasFitted) {
          const center = calcCenterPan(newFitZoom);
          return {
            ...prev,
            zoom: newFitZoom,
            fitZoom: newFitZoom,
            panX: center.panX,
            panY: center.panY,
          };
        }
        return { ...prev, fitZoom: newFitZoom };
      });
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef, calcFitZoom, calcCenterPan]);

  // Initialize fit zoom when image dimensions change
  useEffect(() => {
    if (imageWidth > 0 && imageHeight > 0) {
      fitToWindow();
    }
  }, [imageWidth, imageHeight]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll-to-zoom handler
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const current = stateRef.current;
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;

      const zoomFactor = 1 - e.deltaY * 0.001;
      const newZoom = Math.max(current.fitZoom * 0.5, Math.min(10, current.zoom * zoomFactor));

      // Zoom toward cursor: keep the point under the cursor fixed
      const factor = newZoom / current.zoom;
      const newPanX = cursorX / newZoom - factor * (cursorX / current.zoom - current.panX);
      const newPanY = cursorY / newZoom - factor * (cursorY / current.zoom - current.panY);

      setState((prev) => ({
        ...prev,
        zoom: newZoom,
        panX: newPanX,
        panY: newPanY,
      }));
    },
    [containerRef],
  );

  // Pan: mousedown handler
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const current = stateRef.current;
      // Only allow pan when zoomed beyond fit
      if (current.zoom <= current.fitZoom) return;
      e.preventDefault();
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        panX: current.panX,
        panY: current.panY,
      };
      setState((prev) => ({ ...prev, isDragging: true }));
    },
    [],
  );

  // Document-level mousemove and mouseup for pan
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent): void => {
      const drag = dragStartRef.current;
      if (!drag) return;

      const current = stateRef.current;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;

      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        setState((prev) => ({
          ...prev,
          panX: drag.panX + dx / current.zoom,
          panY: drag.panY + dy / current.zoom,
        }));
      });
    };

    const handleMouseUp = (): void => {
      if (dragStartRef.current) {
        dragStartRef.current = null;
        setState((prev) => ({ ...prev, isDragging: false }));
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return {
    zoom: state.zoom,
    panX: state.panX,
    panY: state.panY,
    isDragging: state.isDragging,
    handlers: {
      onWheel,
      onMouseDown,
    },
    resetZoom,
    zoomTo100,
    fitToWindow,
  };
}
