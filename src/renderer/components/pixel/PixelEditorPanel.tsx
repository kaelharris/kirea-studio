import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Crop,
  Eraser,
  Grid3X3,
  Layers,
  Maximize2,
  MousePointer2,
  PaintBucket,
  Pencil,
  Pipette,
  Redo2,
  Save,
  Undo2,
} from "lucide-react";
import type {
  PixelAssetDetail,
  PixelAssetRecord,
  PixelFrameInput,
} from "../../../shared/pixel-types";
import { Badge, Button, Card, EmptyState, Input, Select } from "../ui/Primitives";
import { PixelField, checkerStyle } from "./pixel-ui";

type EditorTool = "pencil" | "eraser" | "picker" | "fill" | "select" | "move" | "crop";

interface EditorFrameState {
  name: string;
  durationMs: number;
  data: ImageData;
}

interface EditorSnapshot {
  width: number;
  height: number;
  activeIndex: number;
  frames: EditorFrameState[];
}

interface SelectionRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface PixelEditorProps {
  assets: PixelAssetRecord[];
  detail: PixelAssetDetail | null;
  selectedAssetId: string;
  initialFrameIndex: number;
  onSelectAsset: (id: string) => void;
  onSaveFrames: (
    assetId: string,
    frames: PixelFrameInput[],
    dimensions?: { width: number; height: number }
  ) => Promise<void>;
  onToast: (message: string, tone?: "info" | "error") => void;
}

const TOOLS: Array<{ id: EditorTool; label: string; icon: React.ReactNode; shortcut: string }> = [
  { id: "pencil", label: "Pencil", icon: <Pencil className="w-3.5 h-3.5" />, shortcut: "B" },
  { id: "eraser", label: "Eraser", icon: <Eraser className="w-3.5 h-3.5" />, shortcut: "E" },
  { id: "picker", label: "Picker", icon: <Pipette className="w-3.5 h-3.5" />, shortcut: "I" },
  { id: "fill", label: "Fill", icon: <PaintBucket className="w-3.5 h-3.5" />, shortcut: "G" },
  { id: "select", label: "Select", icon: <MousePointer2 className="w-3.5 h-3.5" />, shortcut: "M" },
  { id: "move", label: "Move", icon: <Maximize2 className="w-3.5 h-3.5" />, shortcut: "V" },
  { id: "crop", label: "Crop", icon: <Crop className="w-3.5 h-3.5" />, shortcut: "C" },
];

const SHORTCUT_TOOL: Record<string, EditorTool> = {
  b: "pencil",
  e: "eraser",
  i: "picker",
  g: "fill",
  m: "select",
  v: "move",
  c: "crop",
};

function cloneImageData(data: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(data.data), data.width, data.height);
}

function blankImageData(width: number, height: number): ImageData {
  return new ImageData(width, height);
}

function imageDataToCanvas(data: ImageData): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = data.width;
  canvas.height = data.height;
  canvas.getContext("2d")!.putImageData(data, 0, 0);
  return canvas;
}

function imageDataToDataUrl(data: ImageData): string {
  return imageDataToCanvas(data).toDataURL("image/png");
}

function scaleImageData(data: ImageData, width: number, height: number): ImageData {
  const source = imageDataToCanvas(data);
  const target = document.createElement("canvas");
  target.width = width;
  target.height = height;
  const context = target.getContext("2d")!;
  context.imageSmoothingEnabled = false;
  context.drawImage(source, 0, 0, width, height);
  return context.getImageData(0, 0, width, height);
}

function cropImageData(
  data: ImageData,
  x: number,
  y: number,
  width: number,
  height: number
): ImageData {
  const source = imageDataToCanvas(data);
  const target = document.createElement("canvas");
  target.width = width;
  target.height = height;
  const context = target.getContext("2d")!;
  context.imageSmoothingEnabled = false;
  context.drawImage(source, -x, -y);
  return context.getImageData(0, 0, width, height);
}

function hexToRgba(hex: string): [number, number, number, number] {
  const value = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(value)) {
    return [0, 0, 0, 255];
  }
  const alpha = value.length === 8 ? parseInt(value.slice(6, 8), 16) : 255;
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
    alpha,
  ];
}

function rgbaToHex(r: number, g: number, b: number, a: number): string {
  const channel = (value: number): string => value.toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}${a === 255 ? "" : channel(a)}`;
}

function readPixel(data: ImageData, x: number, y: number): [number, number, number, number] {
  if (x < 0 || y < 0 || x >= data.width || y >= data.height) return [0, 0, 0, 0];
  const offset = (y * data.width + x) * 4;
  return [data.data[offset]!, data.data[offset + 1]!, data.data[offset + 2]!, data.data[offset + 3]!];
}

function writePixel(
  data: ImageData,
  x: number,
  y: number,
  rgba: [number, number, number, number],
  brush: number
): void {
  for (let dy = 0; dy < brush; dy++) {
    for (let dx = 0; dx < brush; dx++) {
      const px = x + dx;
      const py = y + dy;
      if (px < 0 || py < 0 || px >= data.width || py >= data.height) continue;
      const offset = (py * data.width + px) * 4;
      data.data[offset] = rgba[0];
      data.data[offset + 1] = rgba[1];
      data.data[offset + 2] = rgba[2];
      data.data[offset + 3] = rgba[3];
    }
  }
}

function drawLine(
  data: ImageData,
  from: { x: number; y: number },
  to: { x: number; y: number },
  rgba: [number, number, number, number],
  brush: number
): void {
  let x0 = from.x;
  let y0 = from.y;
  const x1 = to.x;
  const y1 = to.y;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  for (;;) {
    writePixel(data, x0, y0, rgba, brush);
    if (x0 === x1 && y0 === y1) break;
    const doubled = 2 * error;
    if (doubled >= dy) {
      error += dy;
      x0 += sx;
    }
    if (doubled <= dx) {
      error += dx;
      y0 += sy;
    }
  }
}

function floodFill(data: ImageData, x: number, y: number, rgba: [number, number, number, number]): void {
  if (x < 0 || y < 0 || x >= data.width || y >= data.height) return;
  const target = readPixel(data, x, y);
  if (
    target[0] === rgba[0] &&
    target[1] === rgba[1] &&
    target[2] === rgba[2] &&
    target[3] === rgba[3]
  ) {
    return;
  }
  const matches = (px: number, py: number): boolean => {
    const candidate = readPixel(data, px, py);
    return (
      candidate[0] === target[0] &&
      candidate[1] === target[1] &&
      candidate[2] === target[2] &&
      candidate[3] === target[3]
    );
  };
  const stack: Array<[number, number]> = [[x, y]];
  while (stack.length) {
    const [cx, cy] = stack.pop()!;
    if (!matches(cx, cy)) continue;
    writePixel(data, cx, cy, rgba, 1);
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
  }
}

function clearRegion(data: ImageData, rect: SelectionRect): void {
  const transparent: [number, number, number, number] = [0, 0, 0, 0];
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      writePixel(data, x, y, transparent, 1);
    }
  }
}

function extractRegion(data: ImageData, rect: SelectionRect): ImageData {
  const region = new ImageData(Math.max(1, rect.w), Math.max(1, rect.h));
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      const rgba = readPixel(data, rect.x + x, rect.y + y);
      writePixel(region, x, y, rgba, 1);
    }
  }
  return region;
}

function blitRegion(
  target: ImageData,
  region: ImageData,
  x: number,
  y: number
): void {
  for (let sy = 0; sy < region.height; sy++) {
    for (let sx = 0; sx < region.width; sx++) {
      const rgba = readPixel(region, sx, sy);
      if (rgba[3] === 0) continue;
      writePixel(target, x + sx, y + sy, rgba, 1);
    }
  }
}

function normalizeSelection(
  a: { x: number; y: number },
  b: { x: number; y: number },
  width: number,
  height: number
): SelectionRect {
  const left = Math.max(0, Math.min(a.x, b.x));
  const top = Math.max(0, Math.min(a.y, b.y));
  const right = Math.min(width, Math.max(a.x, b.x) + 1);
  const bottom = Math.min(height, Math.max(a.y, b.y) + 1);
  return { x: left, y: top, w: Math.max(1, right - left), h: Math.max(1, bottom - top) };
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not decode a frame."));
    image.src = dataUrl;
  });
}

export const PixelEditorPanel: React.FC<PixelEditorProps> = ({
  assets,
  detail,
  selectedAssetId,
  initialFrameIndex,
  onSelectAsset,
  onSaveFrames,
  onToast,
}) => {
  const [dims, setDims] = useState({ w: 32, h: 32 });
  const [frames, setFrames] = useState<EditorFrameState[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [tool, setTool] = useState<EditorTool>("pencil");
  const [color, setColor] = useState("#191920");
  const [brush, setBrush] = useState(1);
  const [zoom, setZoom] = useState(8);
  const [showGrid, setShowGrid] = useState(true);
  const [onion, setOnion] = useState(false);
  const [selection, setSelection] = useState<SelectionRect | null>(null);
  const [resizeDraft, setResizeDraft] = useState({ w: 32, h: 32 });
  const [undoStack, setUndoStack] = useState<EditorSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<EditorSnapshot[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dimensionChanged, setDimensionChanged] = useState(false);
  const [loading, setLoading] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokeRef = useRef<{ buffer: ImageData; last: { x: number; y: number } } | null>(null);
  const selectRef = useRef<{ start: { x: number; y: number }; last: { x: number; y: number } } | null>(null);
  const moveRef = useRef<{
    base: ImageData;
    region: ImageData;
    from: { x: number; y: number };
    origin: SelectionRect;
  } | null>(null);

  const assetOptions = useMemo(
    () => assets.filter((asset) => asset.frameCount > 0),
    [assets]
  );

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      if (!detail) {
        setFrames([]);
        return;
      }
      setLoading(true);
      try {
        const loaded: EditorFrameState[] = [];
        for (const frame of detail.frames) {
          if (!frame.dataUrl) {
            loaded.push({
              name: frame.name,
              durationMs: frame.durationMs,
              data: blankImageData(detail.width, detail.height),
            });
            continue;
          }
          const image = await loadImage(frame.dataUrl);
          const canvas = document.createElement("canvas");
          canvas.width = detail.width;
          canvas.height = detail.height;
          const context = canvas.getContext("2d")!;
          context.imageSmoothingEnabled = false;
          context.drawImage(image, 0, 0, detail.width, detail.height);
          loaded.push({
            name: frame.name,
            durationMs: frame.durationMs,
            data: context.getImageData(0, 0, detail.width, detail.height),
          });
        }
        if (cancelled) return;
        setDims({ w: detail.width, h: detail.height });
        setResizeDraft({ w: detail.width, h: detail.height });
        setFrames(loaded);
        setActiveIndex(Math.min(initialFrameIndex, Math.max(0, loaded.length - 1)));
        setUndoStack([]);
        setRedoStack([]);
        setSelection(null);
        setDirty(false);
        setDimensionChanged(false);
        setColor(detail.palette[0] ?? "#191920");
      } catch (error) {
        if (!cancelled) {
          onToast(error instanceof Error ? error.message : "Could not open the editor.", "error");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.id]);

  useEffect(() => {
    if (frames.length && initialFrameIndex < frames.length) {
      setActiveIndex(initialFrameIndex);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFrameIndex]);

  const currentFrame = frames[activeIndex] ?? null;

  const snapshot = useCallback(
    (): EditorSnapshot => ({
      width: dims.w,
      height: dims.h,
      activeIndex,
      frames: frames.map((frame) => ({ ...frame, data: cloneImageData(frame.data) })),
    }),
    [dims, activeIndex, frames]
  );

  const pushUndo = useCallback((): void => {
    setUndoStack((prev) => [...prev.slice(-29), snapshot()]);
    setRedoStack([]);
  }, [snapshot]);

  const restore = (entry: EditorSnapshot): void => {
    setDims({ w: entry.width, h: entry.height });
    setResizeDraft({ w: entry.width, h: entry.height });
    setFrames(entry.frames.map((frame) => ({ ...frame, data: cloneImageData(frame.data) })));
    setActiveIndex(Math.min(entry.activeIndex, entry.frames.length - 1));
    setSelection(null);
    setDimensionChanged(true);
    setDirty(true);
  };

  const undo = (): void => {
    if (!undoStack.length) return;
    const previous = undoStack[undoStack.length - 1]!;
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((redoEntries) => [...redoEntries.slice(-29), snapshot()]);
    restore(previous);
  };

  const redo = (): void => {
    if (!redoStack.length) return;
    const next = redoStack[redoStack.length - 1]!;
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((undoEntries) => [...undoEntries.slice(-29), snapshot()]);
    restore(next);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
        return;
      }
      const shortcut = SHORTCUT_TOOL[event.key.toLowerCase()];
      if (shortcut && !event.ctrlKey && !event.metaKey && !event.altKey) {
        setTool(shortcut);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !currentFrame) return;
    canvas.width = dims.w * zoom;
    canvas.height = dims.h * zoom;
    const context = canvas.getContext("2d")!;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = false;

    const paint = (data: ImageData, alpha: number): void => {
      const source = imageDataToCanvas(data);
      context.globalAlpha = alpha;
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      context.globalAlpha = 1;
    };

    if (onion && frames.length > 1) {
      const previous = frames[(activeIndex - 1 + frames.length) % frames.length];
      const next = frames[(activeIndex + 1) % frames.length];
      if (previous) paint(previous.data, 0.25);
      if (next) paint(next.data, 0.1);
    }
    paint(currentFrame.data, 1);

    if (showGrid && zoom >= 6) {
      context.strokeStyle = "rgba(127,127,127,0.28)";
      context.lineWidth = 1;
      context.beginPath();
      for (let x = 0; x <= dims.w; x++) {
        context.moveTo(x * zoom + 0.5, 0);
        context.lineTo(x * zoom + 0.5, canvas.height);
      }
      for (let y = 0; y <= dims.h; y++) {
        context.moveTo(0, y * zoom + 0.5);
        context.lineTo(canvas.width, y * zoom + 0.5);
      }
      context.stroke();
    }

    if (selection) {
      context.strokeStyle = "#4F7BFC";
      context.lineWidth = 1;
      context.setLineDash([4, 3]);
      context.strokeRect(
        selection.x * zoom + 0.5,
        selection.y * zoom + 0.5,
        selection.w * zoom - 1,
        selection.h * zoom - 1
      );
      context.setLineDash([]);
    }
  }, [frames, activeIndex, dims, zoom, showGrid, onion, selection, currentFrame]);

  const applyFrame = (nextData: ImageData): void => {
    setFrames((prev) =>
      prev.map((frame, index) =>
        index === activeIndex ? { ...frame, data: nextData } : frame
      )
    );
    setDirty(true);
  };

  const toPixel = (event: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.floor(((event.clientX - rect.left) / rect.width) * dims.w),
      y: Math.floor(((event.clientY - rect.top) / rect.height) * dims.h),
    };
  };

  const insideSelection = (x: number, y: number): boolean =>
    !!selection &&
    x >= selection.x &&
    y >= selection.y &&
    x < selection.x + selection.w &&
    y < selection.y + selection.h;

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!currentFrame) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = toPixel(event);
    if (tool === "pencil" || tool === "eraser") {
      pushUndo();
      const buffer = cloneImageData(currentFrame.data);
      const rgba: [number, number, number, number] =
        tool === "eraser" ? [0, 0, 0, 0] : hexToRgba(color);
      writePixel(buffer, point.x, point.y, rgba, brush);
      strokeRef.current = { buffer, last: point };
      applyFrame(buffer);
      return;
    }
    if (tool === "picker") {
      const rgba = readPixel(currentFrame.data, point.x, point.y);
      if (rgba[3] === 0) {
        onToast("Picked a transparent pixel. Use the eraser to paint transparency.", "info");
        return;
      }
      setColor(rgbaToHex(rgba[0], rgba[1], rgba[2], rgba[3]));
      return;
    }
    if (tool === "fill") {
      pushUndo();
      const buffer = cloneImageData(currentFrame.data);
      floodFill(buffer, point.x, point.y, hexToRgba(color));
      applyFrame(buffer);
      return;
    }
    if (tool === "crop" || tool === "select") {
      selectRef.current = { start: point, last: point };
      setSelection({ x: point.x, y: point.y, w: 1, h: 1 });
      return;
    }
    if (tool === "move") {
      if (!selection || !insideSelection(point.x, point.y)) {
        onToast("Select a region with the Select tool, then drag it with Move.", "info");
        return;
      }
      pushUndo();
      moveRef.current = {
        base: cloneImageData(currentFrame.data),
        region: extractRegion(currentFrame.data, selection),
        from: point,
        origin: selection,
      };
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!currentFrame) return;
    const point = toPixel(event);
    if (strokeRef.current) {
      const { buffer, last } = strokeRef.current;
      const rgba: [number, number, number, number] =
        tool === "eraser" ? [0, 0, 0, 0] : hexToRgba(color);
      drawLine(buffer, last, point, rgba, brush);
      strokeRef.current.last = point;
      setFrames((prev) =>
        prev.map((frame, index) =>
          index === activeIndex ? { ...frame, data: buffer } : frame
        )
      );
      return;
    }
    if (selectRef.current) {
      selectRef.current.last = point;
      setSelection(normalizeSelection(selectRef.current.start, point, dims.w, dims.h));
      return;
    }
    if (moveRef.current) {
      const { base, region, from, origin } = moveRef.current;
      const dx = point.x - from.x;
      const dy = point.y - from.y;
      const next = cloneImageData(base);
      clearRegion(next, origin);
      const target = {
        x: Math.max(0, Math.min(dims.w - region.width, origin.x + dx)),
        y: Math.max(0, Math.min(dims.h - region.height, origin.y + dy)),
      };
      blitRegion(next, region, target.x, target.y);
      setSelection({ x: target.x, y: target.y, w: region.width, h: region.height });
      setFrames((prev) =>
        prev.map((frame, index) =>
          index === activeIndex ? { ...frame, data: next } : frame
        )
      );
    }
  };

  const finishStroke = (): void => {
    strokeRef.current = null;
    if (selectRef.current) {
      const { start, last } = selectRef.current;
      selectRef.current = null;
      if (tool === "crop") {
        const rect = normalizeSelection(start, last, dims.w, dims.h);
        if (rect.w > 1 || rect.h > 1) {
          applyCrop(rect);
        } else {
          setSelection(null);
        }
      }
    }
    moveRef.current = null;
  };

  const onPointerUp = (): void => {
    finishStroke();
  };

  const applyCrop = (target: SelectionRect | null = selection): void => {
    if (!target || target.w < 1 || target.h < 1) {
      onToast("Drag a crop region first.", "info");
      return;
    }
    pushUndo();
    setFrames((prev) =>
      prev.map((frame) => ({
        ...frame,
        data: cropImageData(frame.data, target.x, target.y, target.w, target.h),
      }))
    );
    setDims({ w: target.w, h: target.h });
    setResizeDraft({ w: target.w, h: target.h });
    setSelection(null);
    setDimensionChanged(true);
    setDirty(true);
    setTool("select");
    onToast(`Cropped to ${target.w}×${target.h}.`, "info");
  };

  const applyResize = (): void => {
    const w = Math.max(8, Math.min(256, Math.round(resizeDraft.w)));
    const h = Math.max(8, Math.min(256, Math.round(resizeDraft.h)));
    if (w === dims.w && h === dims.h) return;
    pushUndo();
    setFrames((prev) =>
      prev.map((frame) => ({ ...frame, data: scaleImageData(frame.data, w, h) }))
    );
    setDims({ w, h });
    setResizeDraft({ w, h });
    setSelection(null);
    setDimensionChanged(true);
    setDirty(true);
    onToast(`Resized to ${w}×${h} with nearest-neighbour sampling.`, "info");
  };

  const deleteSelection = (): void => {
    if (!selection || !currentFrame) return;
    pushUndo();
    const next = cloneImageData(currentFrame.data);
    clearRegion(next, selection);
    applyFrame(next);
  };

  const clearFrame = (): void => {
    if (!currentFrame) return;
    pushUndo();
    applyFrame(blankImageData(dims.w, dims.h));
  };

  const save = async (): Promise<void> => {
    if (!detail || !frames.length) return;
    setSaving(true);
    try {
      const payload: PixelFrameInput[] = frames.map((frame, index) => ({
        index,
        name: frame.name || `frame_${index + 1}`,
        durationMs: frame.durationMs,
        dataUrl: imageDataToDataUrl(frame.data),
      }));
      await onSaveFrames(
        detail.id,
        payload,
        dimensionChanged ? { width: dims.w, height: dims.h } : undefined
      );
      setDirty(false);
      setDimensionChanged(false);
      setUndoStack([]);
      setRedoStack([]);
      onToast(`Saved a new version of ${detail.name}.`, "info");
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Could not save the frames.", "error");
    } finally {
      setSaving(false);
    }
  };

  const paletteColors = detail?.palette?.length
    ? detail.palette
    : ["#191920", "#4F7BFC", "#e8c9ae", "#d9c9a8", "#f2dc93", "#f7f3e8"];

  if (!detail) {
    return (
      <Card className="p-4">
        <EmptyState
          icon={<Pencil />}
          title={assetOptions.length ? "Pick an asset to edit" : "Nothing to edit yet"}
          description={
            assetOptions.length
              ? "Open any generated asset. Edits are saved as new frame data and a new asset version."
              : "Generate or import an asset first. The editor works on real frame pixels at native resolution."
          }
          action={
            assetOptions.length ? (
              <Select
                className="w-72"
                value={selectedAssetId}
                onChange={(event) => onSelectAsset(event.target.value)}
              >
                <option value="">Choose an asset…</option>
                {assetOptions.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.name} · {asset.frameCount}f
                  </option>
                ))}
              </Select>
            ) : undefined
          }
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            className="w-64"
            value={detail.id}
            onChange={(event) => onSelectAsset(event.target.value)}
          >
            {assetOptions.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.name} · {asset.frameCount}f
              </option>
            ))}
          </Select>
          <Badge tone="neutral">
            {dims.w}×{dims.h}
          </Badge>
          <Badge tone={dirty ? "warning" : "success"}>{dirty ? "Unsaved" : "Saved"}</Badge>
          <Badge tone="sand">v{detail.version}</Badge>
          <span className="ml-auto flex items-center gap-1.5">
            <Button
              size="sm"
              variant="utility"
              disabled={!undoStack.length}
              onClick={undo}
              aria-label="Undo"
            >
              <Undo2 className="w-3.5 h-3.5" /> Undo
            </Button>
            <Button
              size="sm"
              variant="utility"
              disabled={!redoStack.length}
              onClick={redo}
              aria-label="Redo"
            >
              <Redo2 className="w-3.5 h-3.5" /> Redo
            </Button>
            <Button
              size="sm"
              variant="accent"
              loading={saving}
              disabled={!dirty || loading}
              onClick={() => void save()}
            >
              <Save className="w-3.5 h-3.5" /> Save version
            </Button>
          </span>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)_240px]">
        <Card className="p-3 space-y-3 self-start">
          <span className="label-mono text-fg-muted">Tools</span>
          <div className="grid grid-cols-2 gap-1.5">
            {TOOLS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setTool(entry.id)}
                aria-pressed={tool === entry.id}
                title={`${entry.label} (${entry.shortcut})`}
                className={`flex items-center gap-1.5 h-8 px-2 rounded-md border text-[11px] font-medium transition-colors ${
                  tool === entry.id
                    ? "border-accent bg-accent-soft text-fg"
                    : "border-border bg-bg text-fg-muted hover:border-border-strong hover:text-fg"
                }`}
              >
                {entry.icon}
                {entry.label}
              </button>
            ))}
          </div>

          <PixelField label="Colour">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={color.slice(0, 7)}
                onChange={(event) => setColor(event.target.value)}
                className="w-9 h-8 rounded border border-border bg-transparent cursor-pointer"
                aria-label="Drawing colour"
              />
              <Input
                value={color}
                onChange={(event) => setColor(event.target.value)}
                className="font-mono text-[11px]"
                maxLength={9}
              />
            </div>
            <div className="grid grid-cols-6 gap-1 mt-1.5">
              {paletteColors.map((entry, paletteIndex) => (
                <button
                  key={`${entry}-${paletteIndex}`}
                  type="button"
                  aria-label={`Use ${entry}`}
                  onClick={() => setColor(entry)}
                  className={`h-5 rounded-sm border ${
                    color.toLowerCase() === entry.toLowerCase()
                      ? "border-accent ring-1 ring-accent"
                      : "border-border"
                  }`}
                  style={{ backgroundColor: entry }}
                />
              ))}
            </div>
          </PixelField>

          <PixelField label="Brush">
            <div className="flex gap-1.5">
              {[1, 2, 3].map((size) => (
                <Button
                  key={size}
                  size="sm"
                  variant="utility"
                  onClick={() => setBrush(size)}
                  className={brush === size ? "border-accent text-fg" : ""}
                >
                  {size}px
                </Button>
              ))}
            </div>
          </PixelField>

          <div className="flex flex-col gap-1.5">
            <Button
              size="sm"
              variant="utility"
              aria-pressed={showGrid}
              onClick={() => setShowGrid((prev) => !prev)}
              className={showGrid ? "border-accent text-fg justify-start" : "justify-start"}
            >
              <Grid3X3 className="w-3.5 h-3.5" /> Pixel grid
            </Button>
            <Button
              size="sm"
              variant="utility"
              aria-pressed={onion}
              onClick={() => setOnion((prev) => !prev)}
              className={onion ? "border-accent text-fg justify-start" : "justify-start"}
            >
              <Layers className="w-3.5 h-3.5" /> Onion skin
            </Button>
            <Button size="sm" variant="utility" onClick={clearFrame} className="justify-start">
              <Eraser className="w-3.5 h-3.5" /> Clear frame
            </Button>
          </div>
        </Card>

        <Card className="p-3 space-y-3 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                aria-label="Previous frame"
                onClick={() => setActiveIndex((index) => Math.max(0, index - 1))}
                disabled={activeIndex === 0}
              >
                <ArrowLeft className="w-3.5 h-3.5" />
              </Button>
              <Select
                className="w-44"
                value={String(activeIndex)}
                onChange={(event) => setActiveIndex(Number(event.target.value))}
              >
                {frames.map((frame, index) => (
                  <option key={`${frame.name}-${index}`} value={index}>
                    {index + 1}. {frame.name}
                  </option>
                ))}
              </Select>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Next frame"
                onClick={() =>
                  setActiveIndex((index) => Math.min(frames.length - 1, index + 1))
                }
                disabled={activeIndex >= frames.length - 1}
              >
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-fg-faint">Zoom</span>
              <Select
                className="w-20"
                value={String(zoom)}
                onChange={(event) => setZoom(Number(event.target.value))}
              >
                {[1, 2, 4, 6, 8, 12, 16].map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}×
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div
            className="rounded-lg border border-border overflow-auto flex items-center justify-center p-4"
            style={{ ...checkerStyle(Math.max(4, zoom / 2)), maxHeight: 520 }}
          >
            {loading ? (
              <div className="h-40 flex items-center justify-center text-[11px] text-fg-muted">
                Decoding frames…
              </div>
            ) : (
              <canvas
                ref={canvasRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                className="shrink-0 touch-none"
                style={{
                  width: dims.w * zoom,
                  height: dims.h * zoom,
                  imageRendering: "pixelated",
                  cursor:
                    tool === "picker"
                      ? "crosshair"
                      : tool === "move"
                        ? "move"
                        : tool === "select" || tool === "crop"
                          ? "crosshair"
                          : "cell",
                }}
                aria-label="Pixel canvas"
              />
            )}
          </div>
          <p className="text-[11px] text-fg-faint">
            Draw at native resolution. Eraser paints transparency; the grid appears from 6× zoom.
            Shortcuts: B pencil · E eraser · I picker · G fill · M select · V move · C crop · Ctrl+Z
            undo.
          </p>
        </Card>

        <Card className="p-3 space-y-3 self-start">
          <span className="label-mono text-fg-muted">Selection</span>
          {selection ? (
            <p className="font-mono text-[11px] text-fg">
              {selection.x},{selection.y} · {selection.w}×{selection.h}
            </p>
          ) : (
            <p className="text-[11px] text-fg-faint">
              No selection. Drag with Select, Move or Crop.
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            <Button
              size="sm"
              variant="secondary"
              disabled={!selection}
              onClick={() => applyCrop()}
            >
              <Crop className="w-3.5 h-3.5" /> Crop all frames
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!selection}
              onClick={deleteSelection}
            >
              <Eraser className="w-3.5 h-3.5" /> Delete selection
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!selection}
              onClick={() => setSelection(null)}
            >
              Clear selection
            </Button>
          </div>

          <div className="border-t border-border pt-3 space-y-2">
            <span className="label-mono text-fg-muted">Resize asset</span>
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="number"
                min={8}
                max={256}
                value={resizeDraft.w}
                onChange={(event) =>
                  setResizeDraft((prev) => ({ ...prev, w: Number(event.target.value) || 8 }))
                }
              />
              <Input
                type="number"
                min={8}
                max={256}
                value={resizeDraft.h}
                onChange={(event) =>
                  setResizeDraft((prev) => ({ ...prev, h: Number(event.target.value) || 8 }))
                }
              />
            </div>
            <Button size="sm" variant="secondary" className="w-full" onClick={applyResize}>
              Apply nearest-neighbour resize
            </Button>
            <p className="text-[10px] text-fg-faint leading-relaxed">
              Crop and resize apply to every frame and are saved as a new asset version.
            </p>
          </div>

          <div className="border-t border-border pt-3 space-y-1 text-[11px]">
            <div className="flex justify-between">
              <span className="text-fg-muted">Frames</span>
              <span className="font-mono text-fg">{frames.length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-fg-muted">Frame</span>
              <span className="font-mono text-fg">
                {currentFrame?.durationMs ?? 0} ms
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-fg-muted">History</span>
              <span className="font-mono text-fg">
                {undoStack.length}/{redoStack.length}
              </span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};
