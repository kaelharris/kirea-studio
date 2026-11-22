import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import { MediaImage } from "./MediaImage";

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 8;
const ZOOM_STEP = 1.25;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

interface ZoomableImageProps {
  src: string;
  alt: string;
  naturalWidth: number;
  naturalHeight: number;
  className?: string;
  onLoadFailure?: () => void;
}

export const ZoomableImage: React.FC<ZoomableImageProps> = ({
  src,
  alt,
  naturalWidth,
  naturalHeight,
  className = "",
  onLoadFailure,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [dims, setDims] = useState({
    width: naturalWidth || 1,
    height: naturalHeight || 1,
  });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [fitMode, setFitMode] = useState(true);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);

  const fitScale = (() => {
    if (!containerSize.width || !containerSize.height) return 1;
    return Math.min(
      containerSize.width / dims.width,
      containerSize.height / dims.height,
      1
    );
  })();

  const clampPan = useCallback(
    (candidate: { x: number; y: number }, atZoom: number) => {
      const maxX = Math.max(0, (dims.width * atZoom - containerSize.width) / 2);
      const maxY = Math.max(0, (dims.height * atZoom - containerSize.height) / 2);
      return {
        x: clamp(candidate.x, -maxX, maxX),
        y: clamp(candidate.y, -maxY, maxY),
      };
    },
    [containerSize.height, containerSize.width, dims.height, dims.width]
  );

  const resetToFit = useCallback(() => {
    setZoom(fitScale);
    setPan({ x: 0, y: 0 });
    setFitMode(true);
  }, [fitScale]);

  const applyZoom = useCallback(
    (nextZoom: number, anchor?: { x: number; y: number }) => {
      const bounded = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
      setZoom((currentZoom) => {
        if (anchor) {
          const imageX = (anchor.x - pan.x) / currentZoom;
          const imageY = (anchor.y - pan.y) / currentZoom;
          setPan(
            clampPan(
              {
                x: anchor.x - imageX * bounded,
                y: anchor.y - imageY * bounded,
              },
              bounded
            )
          );
        } else {
          setPan((current) => clampPan(current, bounded));
        }
        return bounded;
      });
      setFitMode(false);
    },
    [clampPan, pan.x, pan.y]
  );

  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const update = () =>
      setContainerSize({ width: node.clientWidth, height: node.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setDims({
      width: naturalWidth || 1,
      height: naturalHeight || 1,
    });
  }, [naturalWidth, naturalHeight, src]);

  useEffect(() => {
    resetToFit();
    // Fit on mount, image change, and container resize; manual zoom is preserved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, containerSize.width, containerSize.height]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = node.getBoundingClientRect();
      const anchor = {
        x: event.clientX - rect.left - rect.width / 2,
        y: event.clientY - rect.top - rect.height / 2,
      };
      const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      setZoom((current) => {
        const bounded = clamp(current * factor, MIN_ZOOM, MAX_ZOOM);
        setPan((currentPan) => {
          const imageX = (anchor.x - currentPan.x) / current;
          const imageY = (anchor.y - currentPan.y) / current;
          return clampPan(
            {
              x: anchor.x - imageX * bounded,
              y: anchor.y - imageY * bounded,
            },
            bounded
          );
        });
        return bounded;
      });
      setFitMode(false);
    };
    node.addEventListener("wheel", handleWheel, { passive: false });
    return () => node.removeEventListener("wheel", handleWheel);
  }, [clampPan]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        applyZoom(zoom * ZOOM_STEP);
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        applyZoom(zoom / ZOOM_STEP);
      } else if (event.key === "0") {
        event.preventDefault();
        resetToFit();
      } else if (event.key === "1") {
        event.preventDefault();
        applyZoom(1);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [applyZoom, resetToFit, zoom]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: pan.x,
      originY: pan.y,
      moved: false,
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    setPan(
      clampPan({ x: drag.originX + dx, y: drag.originY + dy }, zoom)
    );
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const node = containerRef.current;
    if (!node) return;
    if (!fitMode) {
      resetToFit();
      return;
    }
    const rect = node.getBoundingClientRect();
    applyZoom(1, {
      x: event.clientX - rect.left - rect.width / 2,
      y: event.clientY - rect.top - rect.height / 2,
    });
  };

  const percent = Math.round(zoom * 100);
  const canPan = dims.width * zoom > containerSize.width + 1 || dims.height * zoom > containerSize.height + 1;

  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={handleDoubleClick}
      className={`relative w-full h-full flex items-center justify-center overflow-hidden touch-none select-none ${
        canPan ? "cursor-grab active:cursor-grabbing" : "cursor-default"
      } ${className}`}
      role="group"
      aria-label="Zoomable image viewer"
    >
      <div
        style={{
          width: dims.width * zoom,
          height: dims.height * zoom,
          transform: `translate3d(${pan.x}px, ${pan.y}px, 0)`,
          imageRendering: zoom >= 1.5 ? "pixelated" : "auto",
          flex: "0 0 auto",
        }}
        className="will-change-transform"
      >
        <MediaImage
          src={src}
          alt={alt}
          draggable={false}
          onLoad={(event) => {
            const img = event.currentTarget;
            if (img.naturalWidth > 0 && img.naturalHeight > 0) {
              setDims({ width: img.naturalWidth, height: img.naturalHeight });
            }
          }}
          onLoadFailure={onLoadFailure}
          className="w-full h-full rounded-lg shadow-2xl"
        />
      </div>

      <div
        className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1 px-1.5 py-1 rounded-full bg-black/70 border border-white/15 backdrop-blur-md shadow-lg"
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => applyZoom(zoom / ZOOM_STEP)}
          disabled={zoom <= MIN_ZOOM + 0.0001}
          aria-label="Zoom out"
          title="Zoom out (-)"
          className="p-1.5 rounded-full text-white/85 hover:bg-white/15 disabled:opacity-35 transition-colors cursor-pointer"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <span className="min-w-[52px] text-center font-mono text-[11px] text-white tabular-nums">
          {percent}%
        </span>
        <button
          type="button"
          onClick={() => applyZoom(zoom * ZOOM_STEP)}
          disabled={zoom >= MAX_ZOOM - 0.0001}
          aria-label="Zoom in"
          title="Zoom in (+)"
          className="p-1.5 rounded-full text-white/85 hover:bg-white/15 disabled:opacity-35 transition-colors cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
        <span className="w-px h-4 bg-white/20 mx-0.5" />
        <button
          type="button"
          onClick={resetToFit}
          aria-label="Fit image to window"
          title="Fit to window (0)"
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold transition-colors cursor-pointer ${
            fitMode ? "bg-white/20 text-white" : "text-white/75 hover:bg-white/15"
          }`}
        >
          <Maximize2 className="w-3 h-3" />
          Fit
        </button>
        <button
          type="button"
          onClick={() => applyZoom(1)}
          aria-label="Actual size (100%)"
          title="Actual size (1)"
          className={`px-2 py-1 rounded-full text-[11px] font-semibold transition-colors cursor-pointer ${
            !fitMode && Math.abs(zoom - 1) < 0.001
              ? "bg-white/20 text-white"
              : "text-white/75 hover:bg-white/15"
          }`}
        >
          1:1
        </button>
      </div>
    </div>
  );
};
