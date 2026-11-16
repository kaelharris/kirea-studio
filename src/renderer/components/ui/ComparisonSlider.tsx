import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Eye, SlidersHorizontal, SplitSquareVertical } from "lucide-react";

interface ComparisonSliderProps {
  beforeSrc: string;
  afterSrc: string;
  beforeLabel?: string;
  afterLabel?: string;
  className?: string;
  initialPosition?: number; // 0 - 100
  aspectRatio?: string;
}

export const ComparisonSlider: React.FC<ComparisonSliderProps> = ({
  beforeSrc,
  afterSrc,
  beforeLabel = "Original",
  afterLabel = "Upscaled",
  className = "",
  initialPosition = 50,
}) => {
  const [position, setPosition] = useState(initialPosition);
  const [isDragging, setIsDragging] = useState(false);
  const [mode, setMode] = useState<"slider" | "before" | "after">("slider");
  const [holdingBefore, setHoldingBefore] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const updatePosition = useCallback((clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    const x = clientX - rect.left;
    const percent = Math.min(100, Math.max(0, (x / rect.width) * 100));
    setPosition(percent);
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    updatePosition(e.clientX);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches[0]) {
      setIsDragging(true);
      updatePosition(e.touches[0].clientX);
    }
  };

  useEffect(() => {
    if (!isDragging) return;

    const onMouseMove = (e: MouseEvent) => {
      updatePosition(e.clientX);
    };

    const onMouseUp = () => {
      setIsDragging(false);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches[0]) {
        updatePosition(e.touches[0].clientX);
      }
    };

    const onTouchEnd = () => {
      setIsDragging(false);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("touchmove", onTouchMove);
    window.addEventListener("touchend", onTouchEnd);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [isDragging, updatePosition]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 2;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setPosition((p) => Math.max(0, p - step));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setPosition((p) => Math.min(100, p + step));
    } else if (e.key === "Home") {
      e.preventDefault();
      setPosition(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setPosition(100);
    }
  };

  // Determine effective display position based on mode / hold
  const effectivePosition = holdingBefore
    ? 100
    : mode === "before"
      ? 100
      : mode === "after"
        ? 0
        : position;

  return (
    <div className={`relative flex flex-col items-center justify-center w-full h-full select-none ${className}`}>
      {/* Visual Canvas Container */}
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        className="relative w-full h-full max-h-full max-w-full flex items-center justify-center overflow-hidden cursor-ew-resize group"
      >
        {/* Base Layer: After (Upscaled) Image */}
        <img
          src={afterSrc}
          alt={afterLabel}
          draggable={false}
          className="absolute inset-0 w-full h-full object-contain object-center pointer-events-none"
        />

        {/* Top Clipped Layer: Before (Original) Image */}
        <div
          className="absolute inset-0 w-full h-full pointer-events-none"
          style={{
            clipPath: `inset(0 ${100 - effectivePosition}% 0 0)`,
            WebkitClipPath: `inset(0 ${100 - effectivePosition}% 0 0)`,
          }}
        >
          <img
            src={beforeSrc}
            alt={beforeLabel}
            draggable={false}
            className="w-full h-full object-contain object-center"
          />
        </div>

        {/* Divider Line & Handle (visible in slider mode) */}
        {mode === "slider" && !holdingBefore && (
          <div
            className="absolute top-0 bottom-0 pointer-events-none -translate-x-1/2 z-20 flex items-center justify-center"
            style={{ left: `${effectivePosition}%` }}
          >
            {/* Vertical Line */}
            <div className="w-[2px] h-full bg-white shadow-[0_0_8px_rgba(0,0,0,0.8)]" />

            {/* Draggable Circle Handle */}
            <div
              tabIndex={0}
              role="slider"
              aria-label="Before and after comparison slider"
              aria-valuenow={Math.round(position)}
              aria-valuemin={0}
              aria-valuemax={100}
              onKeyDown={handleKeyDown}
              className="absolute w-8 h-8 rounded-full bg-black/80 border-2 border-white text-white flex items-center justify-center shadow-2xl backdrop-blur cursor-ew-resize group-hover:scale-110 active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <ChevronLeft className="w-3.5 h-3.5 -mr-1" />
              <ChevronRight className="w-3.5 h-3.5 -ml-1" />
            </div>
          </div>
        )}

        {/* Floating Badges */}
        <div className="pointer-events-none absolute top-4 left-4 z-20 flex items-center gap-1.5 rounded-full bg-black/75 px-3 py-1 text-xs font-semibold text-white backdrop-blur shadow">
          <span className="h-2 w-2 rounded-full bg-amber-400" />
          <span>{beforeLabel}</span>
          {mode === "slider" && <span className="opacity-60 tabular-nums">{Math.round(effectivePosition)}%</span>}
        </div>

        <div className="pointer-events-none absolute top-4 right-4 z-20 flex items-center gap-1.5 rounded-full bg-black/75 px-3 py-1 text-xs font-semibold text-white backdrop-blur shadow">
          <span className="h-2 w-2 rounded-full bg-accent" />
          <span>{afterLabel}</span>
          {mode === "slider" && <span className="opacity-60 tabular-nums">{Math.round(100 - effectivePosition)}%</span>}
        </div>
      </div>

      {/* Bottom Mode Toolbar */}
      <div className="shrink-0 pt-3 pb-1 flex items-center gap-2 z-30">
        <div className="flex items-center rounded-lg border border-border bg-black/60 p-0.5 backdrop-blur text-xs">
          <button
            type="button"
            onClick={() => setMode("slider")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md font-medium transition-colors ${
              mode === "slider" ? "bg-accent text-white shadow-sm" : "text-fg-muted hover:text-fg"
            }`}
          >
            <SplitSquareVertical className="w-3.5 h-3.5" />
            Split Slider
          </button>
          <button
            type="button"
            onClick={() => setMode("before")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md font-medium transition-colors ${
              mode === "before" ? "bg-accent text-white shadow-sm" : "text-fg-muted hover:text-fg"
            }`}
          >
            {beforeLabel} Only
          </button>
          <button
            type="button"
            onClick={() => setMode("after")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md font-medium transition-colors ${
              mode === "after" ? "bg-accent text-white shadow-sm" : "text-fg-muted hover:text-fg"
            }`}
          >
            {afterLabel} Only
          </button>
        </div>

        {/* Hold to Peek Before button */}
        <button
          type="button"
          onMouseDown={() => setHoldingBefore(true)}
          onMouseUp={() => setHoldingBefore(false)}
          onMouseLeave={() => setHoldingBefore(false)}
          onTouchStart={() => setHoldingBefore(true)}
          onTouchEnd={() => setHoldingBefore(false)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-black/60 backdrop-blur text-xs font-medium transition-colors ${
            holdingBefore ? "bg-amber-500/80 text-white border-amber-400" : "text-fg-muted hover:text-fg"
          }`}
          title="Press and hold to view the original source image"
        >
          <Eye className="w-3.5 h-3.5" />
          Hold to Peek Original
        </button>
      </div>
    </div>
  );
};
