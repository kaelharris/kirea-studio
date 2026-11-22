import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Brush,
  Copy,
  Eraser,
  Expand,
  Maximize2,
  Minus,
  Move,
  Plus,
  RotateCcw,
  RotateCw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  Badge,
  Button,
  SliderField,
  useContextMenu,
  type ContextMenuItem,
} from "../ui/Primitives";
import { ComparisonSlider } from "../ui/ComparisonSlider";
import { toMediaUrl } from "../../utils/format";
import type { StudioWorkflowMode } from "./WorkflowSelector";

interface EditingCanvasProps {
  imageSrc: string;
  sourceImagePath?: string | null;
  mode: StudioWorkflowMode;
  width?: number;
  height?: number;
  onMaskChange?: (maskDataUrl: string | null) => void;
  onOutpaintParamsChange?: (params: { top: number; bottom: number; left: number; right: number }) => void;
  onFullscreen?: () => void;
  canCompare?: boolean;
}

/**
 * Exports a lossless binary PNG mask from the drawing canvas:
 * White (#FFFFFF / 255) = regenerate (inpainting area)
 * Black (#000000 / 0) = preserve original source pixels
 */
function serializeBinaryMask(sourceCanvas: HTMLCanvasElement): string | null {
  if (sourceCanvas.width === 0 || sourceCanvas.height === 0) return null;
  const offscreen = document.createElement("canvas");
  offscreen.width = sourceCanvas.width;
  offscreen.height = sourceCanvas.height;
  const offCtx = offscreen.getContext("2d");
  if (!offCtx) return null;

  // Fill solid black background (preserve)
  offCtx.fillStyle = "#000000";
  offCtx.fillRect(0, 0, offscreen.width, offscreen.height);

  const srcCtx = sourceCanvas.getContext("2d");
  if (!srcCtx) return null;
  const imgData = srcCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const srcPixels = imgData.data;

  const outImgData = offCtx.createImageData(offscreen.width, offscreen.height);
  const outPixels = outImgData.data;

  let hasDrawnPixels = false;
  for (let i = 0; i < srcPixels.length; i += 4) {
    const alpha = srcPixels[i + 3] ?? 0;
    if (alpha > 10) {
      hasDrawnPixels = true;
      outPixels[i] = 255;
      outPixels[i + 1] = 255;
      outPixels[i + 2] = 255;
      outPixels[i + 3] = 255;
    } else {
      outPixels[i] = 0;
      outPixels[i + 1] = 0;
      outPixels[i + 2] = 0;
      outPixels[i + 3] = 255;
    }
  }

  if (!hasDrawnPixels) {
    return null;
  }
  offCtx.putImageData(outImgData, 0, 0);
  return offscreen.toDataURL("image/png");
}

export const EditingCanvas: React.FC<EditingCanvasProps> = ({
  imageSrc,
  sourceImagePath,
  mode,
  width = 1024,
  height = 1024,
  onMaskChange,
  onOutpaintParamsChange,
  onFullscreen,
  canCompare = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageElementRef = useRef<HTMLImageElement>(null);

  // Zoom and pan state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });

  // Inpaint brush state
  const [tool, setTool] = useState<"brush" | "eraser">("brush");
  const [brushSize, setBrushSize] = useState(32);
  const [isDrawing, setIsDrawing] = useState(false);
  const [undoStack, setUndoStack] = useState<ImageData[]>([]);
  const [redoStack, setRedoStack] = useState<ImageData[]>([]);
  const [showComparison, setShowComparison] = useState(false);

  // Outpaint border padding state (in pixels)
  const [outpaintPadding, setOutpaintPadding] = useState({
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  });

  // Reset zoom & pan when image changes
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setUndoStack([]);
    setRedoStack([]);
    setShowComparison(false);
  }, [imageSrc]);

  const emitMask = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !onMaskChange) return;
    const binaryDataUrl = serializeBinaryMask(canvas);
    onMaskChange(binaryDataUrl);
  }, [onMaskChange]);

  // Initialize or clear inpaint mask canvas
  const clearMask = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setUndoStack([]);
    setRedoStack([]);
    if (onMaskChange) onMaskChange(null);
  }, [onMaskChange]);

  const saveCanvasState = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    setUndoStack((prev) => [...prev.slice(-20), snapshot]);
    setRedoStack([]);
  };

  const handleUndo = () => {
    const canvas = canvasRef.current;
    if (!canvas || undoStack.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const current = ctx.getImageData(0, 0, canvas.width, canvas.height);
    setRedoStack((prev) => [...prev, current]);

    const prev = undoStack[undoStack.length - 1];
    setUndoStack((stack) => stack.slice(0, -1));
    if (prev) {
      ctx.putImageData(prev, 0, 0);
      emitMask();
    }
  };

  const handleRedo = () => {
    const canvas = canvasRef.current;
    if (!canvas || redoStack.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((stack) => stack.slice(0, -1));
    if (next) {
      saveCanvasState();
      ctx.putImageData(next, 0, 0);
      emitMask();
    }
  };

  const handleInvertMask = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    saveCanvasState();

    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      // Invert alpha / white mask
      const alpha = data[i + 3] ?? 0;
      data[i] = 255;
      data[i + 1] = 50;
      data[i + 2] = 50;
      data[i + 3] = alpha > 50 ? 0 : 180;
    }
    ctx.putImageData(imgData, 0, 0);
    emitMask();
  };

  // Drawing mouse handlers for Inpaint mask
  const getCanvasCoordinates = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (mode !== "inpaint") return;
    if (e.button === 1 || e.shiftKey) {
      // Pan with middle click or shift
      setIsPanning(true);
      panStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
      return;
    }
    if (e.button !== 0) return;

    saveCanvasState();
    setIsDrawing(true);
    const { x, y } = getCanvasCoordinates(e);
    drawMask(x, y);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPanning) {
      setPan({
        x: e.clientX - panStartRef.current.x,
        y: e.clientY - panStartRef.current.y,
      });
      return;
    }
    if (!isDrawing || mode !== "inpaint") return;
    const { x, y } = getCanvasCoordinates(e);
    drawMask(x, y);
  };

  const handleMouseUp = () => {
    if (isDrawing) {
      setIsDrawing(false);
      emitMask();
    }
    if (isPanning) setIsPanning(false);
  };

  const drawMask = (x: number, y: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.save();
    if (tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath();
      ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(235, 60, 60, 0.65)"; // Semi-transparent ruby mask
      ctx.beginPath();
      ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  };

  // Zoom wheel handling
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.1 : -0.1;
      setZoom((prev) => Math.min(3, Math.max(0.4, prev + delta)));
    }
  };

  const handleUpdateOutpaint = (direction: "top" | "bottom" | "left" | "right", amount: number) => {
    setOutpaintPadding((prev) => {
      const updated = {
        ...prev,
        [direction]: Math.max(0, Math.min(512, prev[direction] + amount)),
      };
      if (onOutpaintParamsChange) onOutpaintParamsChange(updated);
      return updated;
    });
  };

  const { showContextMenu } = useContextMenu();

  const handleCanvasContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const items: ContextMenuItem[] = [
        {
          id: "canvas-reset-zoom",
          label: "Reset Zoom (100%)",
          icon: <RotateCcw className="w-3.5 h-3.5" />,
          onClick: () => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          },
        },
        {
          id: "canvas-center",
          label: "Center Artwork",
          icon: <Move className="w-3.5 h-3.5" />,
          onClick: () => setPan({ x: 0, y: 0 }),
        },
        {
          id: "canvas-copy-dims",
          label: `Copy Dimensions (${width} × ${height})`,
          icon: <Copy className="w-3.5 h-3.5" />,
          onClick: () => {
            void navigator.clipboard.writeText(`${width}x${height}`);
          },
          separator: mode === "inpaint" || mode === "outpaint",
        },
      ];

      if (mode === "inpaint") {
        items.push(
          {
            id: "mask-undo",
            label: "Undo Brush Stroke",
            icon: <Undo2 className="w-3.5 h-3.5" />,
            disabled: undoStack.length === 0,
            disabledReason: "No brush actions to undo",
            shortcut: "Ctrl+Z",
            onClick: handleUndo,
          },
          {
            id: "mask-redo",
            label: "Redo Brush Stroke",
            icon: <RotateCw className="w-3.5 h-3.5" />,
            disabled: redoStack.length === 0,
            disabledReason: "No brush actions to redo",
            shortcut: "Ctrl+Y",
            onClick: handleRedo,
          },
          {
            id: "mask-invert",
            label: "Invert Inpaint Mask",
            icon: <Sparkles className="w-3.5 h-3.5" />,
            onClick: handleInvertMask,
          },
          {
            id: "mask-clear",
            label: "Clear All Mask",
            icon: <Eraser className="w-3.5 h-3.5" />,
            destructive: true,
            onClick: clearMask,
          }
        );
      } else if (mode === "outpaint") {
        items.push(
          {
            id: "outpaint-expand-all",
            label: "Expand All Sides (+64px)",
            icon: <Expand className="w-3.5 h-3.5" />,
            onClick: () => {
              setOutpaintPadding((prev) => {
                const next = {
                  top: Math.min(512, prev.top + 64),
                  bottom: Math.min(512, prev.bottom + 64),
                  left: Math.min(512, prev.left + 64),
                  right: Math.min(512, prev.right + 64),
                };
                if (onOutpaintParamsChange) onOutpaintParamsChange(next);
                return next;
              });
            },
          },
          {
            id: "outpaint-reset",
            label: "Reset Boundaries",
            icon: <RotateCcw className="w-3.5 h-3.5" />,
            destructive: true,
            onClick: () => {
              const reset = { top: 0, bottom: 0, left: 0, right: 0 };
              setOutpaintPadding(reset);
              if (onOutpaintParamsChange) onOutpaintParamsChange(reset);
            },
          }
        );
      }

      showContextMenu({
        x: e.clientX,
        y: e.clientY,
        title: `${mode.toUpperCase()} Canvas`,
        items,
      });
    },
    [
      width,
      height,
      mode,
      undoStack.length,
      redoStack.length,
      handleUndo,
      handleRedo,
      handleInvertMask,
      clearMask,
      onOutpaintParamsChange,
      showContextMenu,
    ]
  );

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      onContextMenu={handleCanvasContextMenu}
      className="relative flex-1 min-h-0 flex flex-col bg-well overflow-hidden select-none"
    >
      {/* Top Floating Control Bar */}
      <div className="absolute top-3 left-3 right-3 flex items-center justify-between gap-2 z-20 pointer-events-none">
        {/* Left mode pill */}
        <div className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1 text-xs text-white backdrop-blur-md border border-white/15 shadow-lg">
          <Badge tone={mode === "inpaint" ? "accent" : mode === "outpaint" ? "creative" : "neutral"}>
            {mode.toUpperCase()}
          </Badge>
          <span className="font-mono text-[11px] tabular-nums text-white/80">
            {width}×{height}px
          </span>
        </div>

        {/* Right tools (Zoom, Fullscreen, Compare) */}
        <div className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-black/60 px-2 py-1 text-white backdrop-blur-md border border-white/15 shadow-lg">
          {canCompare && sourceImagePath && (
            <button
              type="button"
              onClick={() => setShowComparison((p) => !p)}
              className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold transition-all ${
                showComparison ? "bg-accent text-white" : "hover:bg-white/20 text-white/80"
              }`}
              title="Toggle interactive comparison slider"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span>Compare</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.4, z - 0.15))}
            className="rounded-full p-1.5 hover:bg-white/20 text-white/80 hover:text-white transition-colors"
            title="Zoom Out (Ctrl + Scroll)"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <span className="font-mono text-[11px] tabular-nums px-1 text-white/80">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(3, z + 0.15))}
            className="rounded-full p-1.5 hover:bg-white/20 text-white/80 hover:text-white transition-colors"
            title="Zoom In (Ctrl + Scroll)"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
            className="rounded-full px-2 py-1 text-[11px] hover:bg-white/20 text-white/80 hover:text-white transition-colors"
            title="Reset Zoom & Pan"
          >
            Fit
          </button>
          {onFullscreen && (
            <button
              type="button"
              onClick={onFullscreen}
              className="rounded-full p-1.5 hover:bg-white/20 text-white/80 hover:text-white transition-colors"
              title="Fullscreen View"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* INPAINT TOOLBAR (Left floating toolbar when in inpaint mode) */}
      {mode === "inpaint" && (
        <div className="absolute left-3 top-16 z-20 flex flex-col gap-2 rounded-2xl bg-surface/95 p-2 border border-border shadow-2xl backdrop-blur-md animate-[kirea-panel-in_150ms_ease-out]">
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => setTool("brush")}
              aria-pressed={tool === "brush"}
              title="Mask Brush"
              className={`p-2 rounded-xl transition-all cursor-pointer ${
                tool === "brush" ? "bg-accent text-white shadow-sm" : "text-fg-muted hover:bg-surface-subtle hover:text-fg"
              }`}
            >
              <Brush className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setTool("eraser")}
              aria-pressed={tool === "eraser"}
              title="Mask Eraser"
              className={`p-2 rounded-xl transition-all cursor-pointer ${
                tool === "eraser" ? "bg-accent text-white shadow-sm" : "text-fg-muted hover:bg-surface-subtle hover:text-fg"
              }`}
            >
              <Eraser className="h-4 w-4" />
            </button>
          </div>

          <div className="h-px bg-border my-0.5" />

          {/* Brush Size Picker */}
          <div className="flex flex-col items-center gap-1 py-1" title={`Brush size: ${brushSize}px`}>
            <span className="font-mono text-[10px] text-fg-subtle">{brushSize}</span>
            <input
              type="range"
              min={6}
              max={120}
              step={2}
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              className="h-20 w-1.5 appearance-none bg-surface-subtle rounded-full cursor-pointer [writing-mode:bt-lr] [-webkit-appearance:slider-vertical]"
            />
          </div>

          <div className="h-px bg-border my-0.5" />

          {/* Undo / Redo / Invert / Clear */}
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={handleUndo}
              disabled={undoStack.length === 0}
              title="Undo Mask Stroke"
              className="p-2 rounded-xl text-fg-muted hover:bg-surface-subtle hover:text-fg disabled:opacity-30 transition-colors"
            >
              <Undo2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={handleInvertMask}
              title="Invert Mask"
              className="p-2 rounded-xl text-fg-muted hover:bg-surface-subtle hover:text-fg transition-colors"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={clearMask}
              title="Clear Mask"
              className="p-2 rounded-xl text-fg-muted hover:bg-surface-subtle hover:text-danger transition-colors"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* OUTPAINT TOOLBAR (Expansion directions when in outpaint mode) */}
      {mode === "outpaint" && (
        <div className="absolute left-3 top-16 z-20 flex flex-col gap-2 rounded-2xl bg-surface/95 p-3 border border-border shadow-2xl backdrop-blur-md animate-[kirea-panel-in_150ms_ease-out] text-xs">
          <p className="font-semibold text-fg mb-1">Outpaint Canvas</p>
          <div className="grid grid-cols-3 gap-1.5 items-center justify-items-center w-28">
            <div />
            <Button
              size="sm"
              variant={outpaintPadding.top > 0 ? "accent" : "secondary"}
              onClick={() => handleUpdateOutpaint("top", 128)}
              title="Extend Top (+128px)"
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </Button>
            <div />

            <Button
              size="sm"
              variant={outpaintPadding.left > 0 ? "accent" : "secondary"}
              onClick={() => handleUpdateOutpaint("left", 128)}
              title="Extend Left (+128px)"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="font-mono text-[10px] text-fg-subtle">Pad</span>
            <Button
              size="sm"
              variant={outpaintPadding.right > 0 ? "accent" : "secondary"}
              onClick={() => handleUpdateOutpaint("right", 128)}
              title="Extend Right (+128px)"
            >
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>

            <div />
            <Button
              size="sm"
              variant={outpaintPadding.bottom > 0 ? "accent" : "secondary"}
              onClick={() => handleUpdateOutpaint("bottom", 128)}
              title="Extend Bottom (+128px)"
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </Button>
            <div />
          </div>

          <div className="mt-2 pt-2 border-t border-border flex items-center justify-between text-[11px] text-fg-subtle">
            <span>
              +{outpaintPadding.left + outpaintPadding.right}×{outpaintPadding.top + outpaintPadding.bottom}px
            </span>
            <button
              type="button"
              onClick={() => {
                setOutpaintPadding({ top: 0, bottom: 0, left: 0, right: 0 });
                if (onOutpaintParamsChange) {
                  onOutpaintParamsChange({ top: 0, bottom: 0, left: 0, right: 0 });
                }
              }}
              className="text-danger hover:underline cursor-pointer"
            >
              Reset
            </button>
          </div>
        </div>
      )}

      {/* Main Artwork Stage & Interactive Canvas */}
      <div
        className="flex-1 flex items-center justify-center p-4 overflow-hidden"
        style={{
          cursor: isPanning ? "grabbing" : mode === "inpaint" ? "crosshair" : "default",
        }}
      >
        {showComparison && canCompare && sourceImagePath ? (
          <div className="w-full h-full max-h-full flex items-center justify-center">
            <ComparisonSlider
              beforeSrc={toMediaUrl(sourceImagePath)}
              afterSrc={toMediaUrl(imageSrc)}
              beforeLabel="Original Image"
              afterLabel="Derived Result"
              className="max-h-full max-w-full"
            />
          </div>
        ) : (
          <div
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "center center",
              transition: isPanning || isDrawing ? "none" : "transform 150ms ease-out",
            }}
            className="relative flex items-center justify-center max-h-full max-w-full shadow-2xl"
          >
            {/* Base Image */}
            <img
              ref={imageElementRef}
              src={toMediaUrl(imageSrc)}
              alt="Workspace image"
              draggable={false}
              onLoad={() => {
                const canvas = canvasRef.current;
                const img = imageElementRef.current;
                if (canvas && img) {
                  canvas.width = img.naturalWidth || width;
                  canvas.height = img.naturalHeight || height;
                }
              }}
              className="max-h-[min(74vh,800px)] w-auto max-w-full object-contain rounded-lg border border-border-strong select-none pointer-events-none"
            />

            {/* Inpaint Drawing Overlay Canvas */}
            {mode === "inpaint" && (
              <canvas
                ref={canvasRef}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                className="absolute inset-0 h-full w-full rounded-lg cursor-crosshair z-10"
              />
            )}

            {/* Outpaint Boundary Visual Guides */}
            {mode === "outpaint" && (
              <div
                style={{
                  top: `-${outpaintPadding.top}px`,
                  bottom: `-${outpaintPadding.bottom}px`,
                  left: `-${outpaintPadding.left}px`,
                  right: `-${outpaintPadding.right}px`,
                }}
                className="absolute border-2 border-dashed border-accent pointer-events-none rounded-lg bg-accent-soft/10 transition-all duration-150"
              >
                <span className="absolute top-1 left-2 font-mono text-[10px] text-accent font-semibold px-1.5 py-0.5 rounded bg-surface/90 shadow">
                  Expanded Bounds: {width + outpaintPadding.left + outpaintPadding.right}×
                  {height + outpaintPadding.top + outpaintPadding.bottom}px
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
