import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Circle,
  Copy,
  Crop,
  Download,
  Eraser,
  Grid3X3,
  Hand,
  Layers,
  Maximize2,
  Minus,
  MousePointer2,
  PaintBucket,
  Pencil,
  Pipette,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Square,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import type {
  PixelAssetDetail,
  PixelAssetRecord,
  PixelCharacter,
  PixelFrameInput,
  PixelSavedPalette,
} from "../../../shared/pixel-types";
import { Badge, Button, Card, EmptyState, Input, Select } from "../ui/Primitives";
import { PixelField, checkerStyle } from "./pixel-ui";

type EditorTool =
  | "pencil"
  | "eraser"
  | "picker"
  | "fill"
  | "line"
  | "rect"
  | "ellipse"
  | "select"
  | "move"
  | "crop"
  | "pan";

interface EditorFrameState {
  id: string;
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
  characters: PixelCharacter[];
  detail: PixelAssetDetail | null;
  selectedAssetId: string;
  initialFrameIndex: number;
  onSelectAsset: (id: string) => void;
  onSaveFrames: (
    assetId: string,
    frames: PixelFrameInput[],
    dimensions?: { width: number; height: number },
    palette?: string[]
  ) => Promise<void>;
  onSavePalette: (assetId: string, palette: string[]) => Promise<void>;
  onOpenCharacter?: (characterId: string) => void;
  onToast: (message: string, tone?: "info" | "error") => void;
}

const TOOLS: Array<{ id: EditorTool; label: string; icon: React.ReactNode; shortcut: string }> = [
  { id: "pencil", label: "Pencil", icon: <Pencil className="w-3.5 h-3.5" />, shortcut: "B" },
  { id: "eraser", label: "Eraser", icon: <Eraser className="w-3.5 h-3.5" />, shortcut: "E" },
  { id: "picker", label: "Picker", icon: <Pipette className="w-3.5 h-3.5" />, shortcut: "I" },
  { id: "fill", label: "Fill", icon: <PaintBucket className="w-3.5 h-3.5" />, shortcut: "G" },
  { id: "line", label: "Line", icon: <Minus className="w-3.5 h-3.5" />, shortcut: "L" },
  { id: "rect", label: "Rectangle", icon: <Square className="w-3.5 h-3.5" />, shortcut: "R" },
  { id: "ellipse", label: "Ellipse", icon: <Circle className="w-3.5 h-3.5" />, shortcut: "O" },
  { id: "select", label: "Select", icon: <MousePointer2 className="w-3.5 h-3.5" />, shortcut: "M" },
  { id: "move", label: "Move", icon: <Maximize2 className="w-3.5 h-3.5" />, shortcut: "V" },
  { id: "crop", label: "Crop", icon: <Crop className="w-3.5 h-3.5" />, shortcut: "C" },
  { id: "pan", label: "Pan", icon: <Hand className="w-3.5 h-3.5" />, shortcut: "H" },
];

const SHORTCUT_TOOL: Record<string, EditorTool> = {
  b: "pencil",
  e: "eraser",
  i: "picker",
  g: "fill",
  l: "line",
  r: "rect",
  o: "ellipse",
  m: "select",
  v: "move",
  c: "crop",
  h: "pan",
};

const DEFAULT_PALETTE = ["#191920", "#4F7BFC", "#e8c9ae", "#d9c9a8", "#f2dc93", "#f7f3e8"];

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

function drawRect(
  data: ImageData,
  from: { x: number; y: number },
  to: { x: number; y: number },
  rgba: [number, number, number, number],
  brush: number,
  filled: boolean
): void {
  const left = Math.max(0, Math.min(from.x, to.x));
  const right = Math.min(data.width - 1, Math.max(from.x, to.x));
  const top = Math.max(0, Math.min(from.y, to.y));
  const bottom = Math.min(data.height - 1, Math.max(from.y, to.y));
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const edge = x === left || x === right || y === top || y === bottom;
      if (filled || edge) writePixel(data, x, y, rgba, brush);
    }
  }
}

function drawEllipse(
  data: ImageData,
  from: { x: number; y: number },
  to: { x: number; y: number },
  rgba: [number, number, number, number],
  brush: number,
  filled: boolean
): void {
  const left = Math.max(0, Math.min(from.x, to.x));
  const right = Math.min(data.width - 1, Math.max(from.x, to.x));
  const top = Math.max(0, Math.min(from.y, to.y));
  const bottom = Math.min(data.height - 1, Math.max(from.y, to.y));
  const cx = (left + right + 1) / 2;
  const cy = (top + bottom + 1) / 2;
  const rx = Math.max(0.5, (right - left + 1) / 2);
  const ry = Math.max(0.5, (bottom - top + 1) / 2);
  const inside = (x: number, y: number): boolean =>
    ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1;
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      if (!inside(x, y)) continue;
      const edge =
        !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      if (filled || edge) writePixel(data, x, y, rgba, brush);
    }
  }
}

function hexKey(r: number, g: number, b: number, a: number): string {
  return rgbaToHex(r, g, b, a).toLowerCase();
}

function rgbKey(hex: string): string {
  const [r, g, b] = hexToRgba(hex);
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function replaceColors(
  data: ImageData,
  mapping: Map<string, [number, number, number]>
): void {
  if (!mapping.size) return;
  for (let offset = 0; offset < data.data.length; offset += 4) {
    if (data.data[offset + 3] === 0) continue;
    const key = `#${data.data[offset]!.toString(16).padStart(2, "0")}${data.data[offset + 1]!
      .toString(16)
      .padStart(2, "0")}${data.data[offset + 2]!.toString(16).padStart(2, "0")}`;
    const target = mapping.get(key);
    if (!target) continue;
    data.data[offset] = target[0];
    data.data[offset + 1] = target[1];
    data.data[offset + 2] = target[2];
  }
}

function collectUsedColors(frames: EditorFrameState[]): Array<{ hex: string; count: number }> {
  const counts = new Map<string, number>();
  for (const frame of frames) {
    const pixels = frame.data.data;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (pixels[offset + 3] === 0) continue;
      const key = hexKey(
        pixels[offset]!,
        pixels[offset + 1]!,
        pixels[offset + 2]!,
        pixels[offset + 3]!
      );
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([hex, count]) => ({ hex, count }))
    .sort((a, b) => b.count - a.count || a.hex.localeCompare(b.hex));
}

function uniqueFrameName(name: string, frames: EditorFrameState[]): string {
  const used = new Set(frames.map((frame) => frame.name));
  if (!used.has(name)) return name;
  let suffix = 2;
  while (used.has(`${name}_${suffix}`)) suffix += 1;
  return `${name}_${suffix}`;
}

function clearRegion(data: ImageData, rect: SelectionRect): void {  const transparent: [number, number, number, number] = [0, 0, 0, 0];
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

const PixelCanvasPreview: React.FC<{
  data: ImageData;
  scale?: number;
  className?: string;
}> = ({ data, scale = 4, className }) => {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = data.width * scale;
    canvas.height = data.height * scale;
    const context = canvas.getContext("2d")!;
    context.imageSmoothingEnabled = false;
    const source = imageDataToCanvas(data);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
  }, [data, scale]);
  return (
    <canvas
      ref={ref}
      className={className}
      style={{ imageRendering: "pixelated", width: data.width * scale, height: data.height * scale }}
    />
  );
};

export const PixelEditorPanel: React.FC<PixelEditorProps> = ({
  assets,
  characters,
  detail,
  selectedAssetId,
  initialFrameIndex,
  onSelectAsset,
  onSaveFrames,
  onSavePalette,
  onOpenCharacter,
  onToast,
}) => {
  const [dims, setDims] = useState({ w: 32, h: 32 });
  const [frames, setFrames] = useState<EditorFrameState[]>([]);
  const [baseline, setBaseline] = useState<EditorFrameState[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [tool, setTool] = useState<EditorTool>("pencil");
  const [color, setColor] = useState("#191920");
  const [brush, setBrush] = useState(1);
  const [filled, setFilled] = useState(false);
  const [zoom, setZoom] = useState(8);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [showGrid, setShowGrid] = useState(true);
  const [checker, setChecker] = useState(true);
  const [onion, setOnion] = useState(false);
  const [compare, setCompare] = useState(false);
  const [selection, setSelection] = useState<SelectionRect | null>(null);
  const [resizeDraft, setResizeDraft] = useState({ w: 32, h: 32 });
  const [undoStack, setUndoStack] = useState<EditorSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<EditorSnapshot[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dimensionChanged, setDimensionChanged] = useState(false);
  const [loading, setLoading] = useState(false);
  const [palette, setPalette] = useState<string[]>([]);
  const [paletteDirty, setPaletteDirty] = useState(false);
  const [replaceFrom, setReplaceFrom] = useState("");
  const [replaceTo, setReplaceTo] = useState("#ffffff");
  const [replaceScope, setReplaceScope] = useState<"frame" | "all">("all");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [previewMapping, setPreviewMapping] = useState(false);
  const [savedPalettes, setSavedPalettes] = useState<PixelSavedPalette[]>([]);
  const [paletteName, setPaletteName] = useState("");
  const [paletteBusy, setPaletteBusy] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokeRef = useRef<{ buffer: ImageData; last: { x: number; y: number } } | null>(null);
  const shapeRef = useRef<{
    base: ImageData;
    start: { x: number; y: number };
    tool: "line" | "rect" | "ellipse";
  } | null>(null);
  const selectRef = useRef<{ start: { x: number; y: number }; last: { x: number; y: number } } | null>(null);
  const moveRef = useRef<{
    base: ImageData;
    region: ImageData;
    from: { x: number; y: number };
    origin: SelectionRect;
  } | null>(null);
  const panRef = useRef<{
    start: { x: number; y: number };
    origin: { x: number; y: number };
  } | null>(null);
  const paletteFileRef = useRef<HTMLInputElement | null>(null);

  const unsaved = dirty || paletteDirty;

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
              id: frame.id,
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
            id: frame.id,
            name: frame.name,
            durationMs: frame.durationMs,
            data: context.getImageData(0, 0, detail.width, detail.height),
          });
        }
        if (cancelled) return;
        setDims({ w: detail.width, h: detail.height });
        setResizeDraft({ w: detail.width, h: detail.height });
        setFrames(loaded);
        setBaseline(loaded.map((frame) => ({ ...frame, data: cloneImageData(frame.data) })));
        setActiveIndex(Math.min(initialFrameIndex, Math.max(0, loaded.length - 1)));
        setUndoStack([]);
        setRedoStack([]);
        setSelection(null);
        setDirty(false);
        setDimensionChanged(false);
        setPalette(detail.palette);
        setPaletteDirty(false);
        setMapping({});
        setPreviewMapping(false);
        setPan({ x: 0, y: 0 });
        setReplaceFrom(detail.palette[0] ?? "#191920");
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
  }, [detail?.id, detail?.version]);

  useEffect(() => {
    let cancelled = false;
    const loadPalettes = async (): Promise<void> => {
      try {
        const entries = await window.kirea.listPixelPalettes();
        if (!cancelled) setSavedPalettes(entries);
      } catch {
        // The palette library is an enhancement; editing still works without it.
      }
    };
    void loadPalettes();
    return () => {
      cancelled = true;
    };
  }, []);

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
    if (tool === "pan" || event.button === 1) {
      panRef.current = { start: { x: event.clientX, y: event.clientY }, origin: pan };
      return;
    }
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
    if (tool === "line" || tool === "rect" || tool === "ellipse") {
      pushUndo();
      shapeRef.current = {
        base: cloneImageData(currentFrame.data),
        start: point,
        tool,
      };
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
    if (panRef.current) {
      const { start, origin } = panRef.current;
      setPan({
        x: origin.x + event.clientX - start.x,
        y: origin.y + event.clientY - start.y,
      });
      return;
    }
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
    if (shapeRef.current) {
      const { base, start, tool: shape } = shapeRef.current;
      const next = cloneImageData(base);
      const rgba = hexToRgba(color);
      if (shape === "line") drawLine(next, start, point, rgba, brush);
      else if (shape === "rect") drawRect(next, start, point, rgba, brush, filled);
      else drawEllipse(next, start, point, rgba, brush, filled);
      setFrames((prev) =>
        prev.map((frame, index) =>
          index === activeIndex ? { ...frame, data: next } : frame
        )
      );
      setSelection(
        shape === "line"
          ? normalizeSelection(start, point, dims.w, dims.h)
          : {
              x: Math.max(0, Math.min(start.x, point.x)),
              y: Math.max(0, Math.min(start.y, point.y)),
              w: Math.min(dims.w, Math.abs(point.x - start.x) + 1),
              h: Math.min(dims.h, Math.abs(point.y - start.y) + 1),
            }
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
    shapeRef.current = null;
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
    panRef.current = null;
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

  const usedColors = useMemo(() => collectUsedColors(frames), [frames]);
  const outsideColors = useMemo(() => {
    const allowed = new Set(palette.map(rgbKey));
    return usedColors.filter((entry) => !allowed.has(rgbKey(entry.hex)));
  }, [usedColors, palette]);
  const activeBaseline = useMemo(() => {
    if (!currentFrame) return null;
    return (
      baseline.find((frame) => frame.id === currentFrame.id) ??
      baseline.find((frame) => frame.name === currentFrame.name) ??
      null
    );
  }, [baseline, currentFrame]);
  const siblings = useMemo(
    () =>
      detail?.characterId
        ? assets.filter(
            (asset) => asset.characterId === detail.characterId && asset.id !== detail.id
          )
        : [],
    [assets, detail?.characterId, detail?.id]
  );
  const character = useMemo(
    () => characters.find((entry) => entry.id === detail?.characterId) ?? null,
    [characters, detail?.characterId]
  );
  const mappingEntries = useMemo(
    () =>
      usedColors
        .filter((entry) => {
          const target = mapping[entry.hex];
          return target && rgbKey(target) !== rgbKey(entry.hex);
        })
        .map((entry) => ({ ...entry, target: mapping[entry.hex]! })),
    [usedColors, mapping]
  );
  const mappedPreviewUrl = useMemo(() => {
    if (!previewMapping || !currentFrame || !mappingEntries.length) return "";
    const map = new Map<string, [number, number, number]>();
    for (const entry of mappingEntries) {
      const [r, g, b] = hexToRgba(entry.target);
      map.set(rgbKey(entry.hex), [r, g, b]);
    }
    const copy = cloneImageData(currentFrame.data);
    replaceColors(copy, map);
    return imageDataToDataUrl(copy);
  }, [previewMapping, currentFrame, mappingEntries]);

  const addPaletteColor = (hex = color): void => {
    if (!/^#?[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(hex)) {
      onToast("Enter a 6 or 8 digit hex colour.", "error");
      return;
    }
    const normalized = hex.startsWith("#") ? hex.toLowerCase() : `#${hex.toLowerCase()}`;
    if (palette.some((entry) => rgbKey(entry) === rgbKey(normalized))) {
      onToast("That colour is already in the palette.", "info");
      return;
    }
    if (palette.length >= 64) {
      onToast("A palette can hold at most 64 colours.", "error");
      return;
    }
    setPalette((prev) => [...prev, normalized]);
    setPaletteDirty(true);
  };

  const removePaletteColor = (index: number): void => {
    if (palette.length <= 1) {
      onToast("Keep at least one palette colour.", "error");
      return;
    }
    setPalette((prev) => prev.filter((_, entryIndex) => entryIndex !== index));
    setPaletteDirty(true);
  };

  const updatePaletteColor = (index: number, value: string): void => {
    if (!/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(value)) return;
    setPalette((prev) =>
      prev.map((entry, entryIndex) => (entryIndex === index ? value.toLowerCase() : entry))
    );
    setPaletteDirty(true);
  };

  const replaceAcrossFrames = (mapping: Map<string, [number, number, number]>): void => {
    if (!mapping.size) {
      onToast("No colours to replace.", "info");
      return;
    }
    pushUndo();
    setFrames((prev) =>
      prev.map((frame, index) => {
        if (replaceScope === "frame" && index !== activeIndex) return frame;
        const next = cloneImageData(frame.data);
        replaceColors(next, mapping);
        return { ...frame, data: next };
      })
    );
    setDirty(true);
    setPreviewMapping(false);
  };

  const applyColorReplacement = (): void => {
    if (!/^#?[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(replaceFrom)) {
      onToast("Choose a valid colour to replace.", "error");
      return;
    }
    const [r, g, b] = hexToRgba(replaceTo);
    replaceAcrossFrames(new Map([[rgbKey(replaceFrom), [r, g, b]]]));
  };

  const applyMapping = (): void => {
    if (!mappingEntries.length) {
      onToast("Set at least one mapped colour.", "info");
      return;
    }
    const map = new Map<string, [number, number, number]>();
    for (const entry of mappingEntries) {
      const [r, g, b] = hexToRgba(entry.target);
      map.set(rgbKey(entry.hex), [r, g, b]);
    }
    replaceAcrossFrames(map);
  };

  const duplicateFrame = (): void => {
    if (!currentFrame) return;
    pushUndo();
    const copy: EditorFrameState = {
      id: crypto.randomUUID(),
      name: uniqueFrameName(`${currentFrame.name}_copy`, frames),
      durationMs: currentFrame.durationMs,
      data: cloneImageData(currentFrame.data),
    };
    setFrames((prev) => {
      const next = [...prev];
      next.splice(activeIndex + 1, 0, copy);
      return next;
    });
    setActiveIndex((index) => index + 1);
    setDirty(true);
  };

  const revertFrame = (): void => {
    if (!activeBaseline) return;
    pushUndo();
    setFrames((prev) =>
      prev.map((frame, index) =>
        index === activeIndex
          ? { ...frame, data: cloneImageData(activeBaseline.data) }
          : frame
      )
    );
    setDirty(true);
    onToast(`Reverted ${activeBaseline.name} to its saved version.`, "info");
  };

  const exportPalette = (): void => {
    const blob = new Blob([JSON.stringify({ name: detail?.name ?? "palette", colors: palette }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${(detail?.name ?? "palette").replace(/[^a-z0-9-_]+/gi, "-").toLowerCase()}-palette.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const importPalette = async (file: File): Promise<void> => {
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const source = Array.isArray(parsed)
        ? parsed
        : typeof parsed === "object" && parsed && Array.isArray((parsed as { colors?: unknown }).colors)
          ? (parsed as { colors: unknown[] }).colors
          : null;
      if (!source) throw new Error("Expected a JSON array of colours or a palette object.");
      const colors = source
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => (entry.startsWith("#") ? entry : `#${entry}`))
        .filter((entry) => /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(entry));
      const deduped = [...new Map(colors.map((entry) => [rgbKey(entry), entry.toLowerCase()])).values()];
      if (!deduped.length) throw new Error("The palette file has no valid hex colours.");
      setPalette(deduped.slice(0, 64));
      setPaletteDirty(true);
      onToast(`Imported ${Math.min(deduped.length, 64)} palette colours.`, "info");
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Could not import the palette.", "error");
    }
  };

  const savePaletteToLibrary = async (): Promise<void> => {
    if (!paletteName.trim()) {
      onToast("Name the palette before saving it.", "error");
      return;
    }
    setPaletteBusy(true);
    try {
      const entry = await window.kirea.savePixelPalette({
        name: paletteName.trim(),
        colors: palette,
      });
      setSavedPalettes((prev) => [entry, ...prev.filter((item) => item.id !== entry.id)]);
      setPaletteName("");
      onToast(`Saved “${entry.name}” to the palette library.`, "info");
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Could not save the palette.", "error");
    } finally {
      setPaletteBusy(false);
    }
  };

  const loadPaletteFromLibrary = (entry: PixelSavedPalette): void => {
    setPalette(entry.colors);
    setPaletteDirty(true);
    onToast(`Loaded “${entry.name}”. Apply a mapping to recolour existing pixels.`, "info");
  };

  const deletePaletteFromLibrary = async (entry: PixelSavedPalette): Promise<void> => {
    try {
      await window.kirea.deletePixelPalette(entry.id);
      setSavedPalettes((prev) => prev.filter((item) => item.id !== entry.id));
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Could not delete the palette.", "error");
    }
  };

  const save = async (): Promise<void> => {
    if (!detail || !frames.length) return;
    setSaving(true);
    try {
      if (dirty || dimensionChanged) {
        const payload: PixelFrameInput[] = frames.map((frame, index) => ({
          id: frame.id,
          index,
          name: frame.name || `frame_${index + 1}`,
          durationMs: frame.durationMs,
          dataUrl: imageDataToDataUrl(frame.data),
        }));
        await onSaveFrames(
          detail.id,
          payload,
          dimensionChanged ? { width: dims.w, height: dims.h } : undefined,
          palette
        );
        setBaseline(frames.map((frame) => ({ ...frame, data: cloneImageData(frame.data) })));
      } else {
        await onSavePalette(detail.id, palette);
      }
      setDirty(false);
      setPaletteDirty(false);
      setDimensionChanged(false);
      setUndoStack([]);
      setRedoStack([]);
      onToast(
        dirty || dimensionChanged
          ? `Saved a new version of ${detail.name}.`
          : `Saved the palette for ${detail.name}.`,
        "info"
      );
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Could not save the asset.", "error");
    } finally {
      setSaving(false);
    }
  };

  const paletteColors = palette.length ? palette : DEFAULT_PALETTE;

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
          <Badge tone={unsaved ? "warning" : "success"}>{unsaved ? "Unsaved" : "Saved"}</Badge>
          <Badge tone="sand">v{detail.version}</Badge>
          <Badge tone="neutral">{palette.length} colours</Badge>
          {compare && activeBaseline ? <Badge tone="warning">Comparing</Badge> : null}
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
              disabled={!unsaved || loading}
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
              <Button
                size="sm"
                variant="ghost"
                onClick={() => addPaletteColor(color)}
                aria-label="Add the current colour to the asset palette"
                title="Add to palette"
              >
                <Plus className="w-3.5 h-3.5" />
              </Button>
            </div>
            <div className="grid grid-cols-6 gap-1 mt-1.5">
              {paletteColors.map((entry, paletteIndex) => (
                <button
                  key={`${entry}-${paletteIndex}`}
                  type="button"
                  aria-label={`Use ${entry}`}
                  onClick={() => {
                    setColor(entry);
                    if (!replaceFrom) setReplaceFrom(entry);
                  }}
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
              aria-pressed={filled}
              onClick={() => setFilled((prev) => !prev)}
              className={filled ? "border-accent text-fg justify-start" : "justify-start"}
              disabled={tool !== "rect" && tool !== "ellipse"}
              title="Rectangle and ellipse shapes fill their interior"
            >
              <Square className="w-3.5 h-3.5" /> Filled shapes
            </Button>
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
              aria-pressed={checker}
              onClick={() => setChecker((prev) => !prev)}
              className={checker ? "border-accent text-fg justify-start" : "justify-start"}
            >
              <Grid3X3 className="w-3.5 h-3.5" /> Transparency
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
          <p className="text-[10px] text-fg-faint leading-relaxed">
            Shape tools draw pixel-exact previews while dragging. Filled mode applies to rectangle
            and ellipse.
          </p>
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
                  <option key={frame.id} value={index}>
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
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-fg-faint">Zoom</span>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Zoom out"
                onClick={() => setZoom((value) => Math.max(1, value - (value > 8 ? 4 : 2)))}
              >
                <Minus className="w-3.5 h-3.5" />
              </Button>
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
              <Button
                size="sm"
                variant="ghost"
                aria-label="Zoom in"
                onClick={() => setZoom((value) => Math.min(32, value + (value >= 8 ? 4 : 2)))}
              >
                <Plus className="w-3.5 h-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Reset pan"
                title="Centre canvas"
                onClick={() => setPan({ x: 0, y: 0 })}
                disabled={!pan.x && !pan.y}
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          <div
            className="relative rounded-lg border border-border overflow-hidden flex items-center justify-center p-4"
            style={{
              ...(checker ? checkerStyle(Math.max(4, zoom / 2)) : { background: "#0b0b10" }),
              maxHeight: 520,
              minHeight: 200,
            }}
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
                onAuxClick={(event) => {
                  if (event.button === 1) event.preventDefault();
                }}
                className="shrink-0 touch-none shadow-[0_0_0_1px_rgba(127,127,127,0.35)]"
                style={{
                  width: dims.w * zoom,
                  height: dims.h * zoom,
                  transform: `translate(${pan.x}px, ${pan.y}px)`,
                  imageRendering: "pixelated",
                  cursor:
                    tool === "pan"
                      ? "grab"
                      : tool === "picker"
                        ? "crosshair"
                        : tool === "move"
                          ? "move"
                          : tool === "select" || tool === "crop" || tool === "line" ||
                              tool === "rect" || tool === "ellipse"
                            ? "crosshair"
                            : "cell",
                }}
                aria-label="Pixel canvas"
              />
            )}
          </div>

          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {frames.map((frame, index) => {
              const original = baseline.find(
                (entry) => entry.id === frame.id || entry.name === frame.name
              );
              const changed = original
                ? original.data.data.some((value, offset) => value !== frame.data.data[offset])
                : true;
              return (
                <button
                  key={frame.id}
                  type="button"
                  onClick={() => setActiveIndex(index)}
                  aria-pressed={index === activeIndex}
                  className={`shrink-0 rounded border p-0.5 ${
                    index === activeIndex
                      ? "border-accent ring-1 ring-accent"
                      : "border-border hover:border-border-strong"
                  }`}
                  style={checker ? checkerStyle(3) : undefined}
                  title={`${frame.name} · ${frame.durationMs} ms${changed ? " · edited" : ""}`}
                >
                  <PixelCanvasPreview data={frame.data} scale={2} />
                  <span className="block max-w-14 truncate text-[9px] text-fg-muted px-0.5">
                    {index + 1}
                    {changed ? " •" : ""}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-fg-faint">
            Draw at native resolution. Eraser paints transparency; the grid appears from 6× zoom.
            Shortcuts: B pencil · E eraser · I picker · G fill · L line · R rectangle · O ellipse ·
            M select · V move · C crop · H pan · Ctrl+Z undo.
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
            <span className="label-mono text-fg-muted">Frame</span>
            <div className="flex flex-col gap-1.5">
              <Button size="sm" variant="secondary" onClick={duplicateFrame}>
                <Copy className="w-3.5 h-3.5" /> Duplicate frame
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={!activeBaseline}
                onClick={revertFrame}
              >
                <RotateCcw className="w-3.5 h-3.5" /> Revert frame
              </Button>
              <Button
                size="sm"
                variant="utility"
                aria-pressed={compare}
                disabled={!activeBaseline}
                onClick={() => setCompare((prev) => !prev)}
              >
                <Layers className="w-3.5 h-3.5" /> Compare with saved
              </Button>
            </div>
            {compare && activeBaseline && currentFrame ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <span className="text-[10px] text-fg-faint">Saved</span>
                  <div className="rounded border border-border p-1" style={checker ? checkerStyle(4) : undefined}>
                    <PixelCanvasPreview
                      data={activeBaseline.data}
                      scale={Math.max(1, Math.min(4, Math.floor(120 / dims.w)))}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] text-fg-faint">Editing</span>
                  <div className="rounded border border-accent/60 p-1" style={checker ? checkerStyle(4) : undefined}>
                    <PixelCanvasPreview
                      data={currentFrame.data}
                      scale={Math.max(1, Math.min(4, Math.floor(120 / dims.w)))}
                    />
                  </div>
                </div>
              </div>
            ) : null}
            <p className="text-[10px] text-fg-faint leading-relaxed">
              Duplicate adds a frame in this asset. Revert replaces only the active frame with its
              last saved pixels.
            </p>
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

          <div className="border-t border-border pt-3 space-y-2 text-[11px]">
            <span className="label-mono text-fg-muted">Identity</span>
            <div className="flex justify-between gap-2">
              <span className="text-fg-muted">Character</span>
              <span className="text-fg truncate">{character?.name ?? "Unassigned"}</span>
            </div>
            {character && onOpenCharacter ? (
              <Button
                size="sm"
                variant="ghost"
                className="w-full justify-start"
                onClick={() => onOpenCharacter(character.id)}
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Open character
              </Button>
            ) : null}
            {detail.parentAssetId ? (
              <Button
                size="sm"
                variant="ghost"
                className="w-full justify-start"
                onClick={() => onSelectAsset(detail.parentAssetId!)}
              >
                <Layers className="w-3.5 h-3.5" /> Open parent asset
              </Button>
            ) : null}
            <div className="flex justify-between gap-2">
              <span className="text-fg-muted">Engine</span>
              <span className="font-mono text-fg">{detail.engine}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-fg-muted">Seed</span>
              <span className="font-mono text-fg">{detail.seed ?? "—"}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-fg-muted">Clips</span>
              <span className="text-fg truncate">
                {Object.keys(detail.animations ?? {}).join(", ") || "None"}
              </span>
            </div>
          </div>
        </Card>
      </div>

      {character || siblings.length ? (
        <Card className="p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="label-mono text-fg-muted">Character directions</span>
            <span className="text-[11px] text-fg-faint">
              {character ? character.name : "Directional assets"} · editing one direction does not
              change its siblings or the identity reference.
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {[detail, ...siblings].map((asset) => {
              const current = asset.id === detail.id;
              return (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => {
                    if (!current) onSelectAsset(asset.id);
                  }}
                  className={`rounded-lg border p-2 text-left transition-colors ${
                    current ? "border-accent bg-accent-soft/40" : "border-border hover:border-border-strong"
                  }`}
                  aria-pressed={current}
                >
                  <div className="h-24 rounded border border-border flex items-center justify-center overflow-hidden" style={checkerStyle(4)}>
                    {current && currentFrame ? (
                      <PixelCanvasPreview
                        data={currentFrame.data}
                        scale={Math.max(1, Math.min(4, Math.floor(88 / dims.w)))}
                      />
                    ) : asset.previewDataUrl ? (
                      <img
                        src={asset.previewDataUrl}
                        alt={asset.name}
                        className="max-h-20 max-w-full"
                        style={{ imageRendering: "pixelated" }}
                      />
                    ) : (
                      <span className="text-[10px] text-fg-faint">No preview</span>
                    )}
                  </div>
                  <div className="mt-1 text-[11px] text-fg truncate">{asset.name}</div>
                  <div className="text-[10px] text-fg-faint">
                    {current ? "Editing now" : `v${asset.version}`} · {asset.width}×{asset.height}
                  </div>
                </button>
              );
            })}
          </div>
        </Card>
      ) : null}

      <Card className="p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <span className="label-mono text-fg-muted">Palette</span>
            <p className="text-[10px] text-fg-faint mt-1">
              Palette edits preserve pixel alpha. Recolouring only happens when you apply a
              replacement or mapping.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone="neutral">{palette.length} palette</Badge>
            <Badge tone={outsideColors.length ? "warning" : "success"}>
              {outsideColors.length} outside
            </Badge>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-2 min-w-0">
            <span className="text-[11px] font-medium text-fg">Asset palette</span>
            <div className="grid grid-cols-2 gap-2">
              {palette.map((entry, index) => (
                <div key={`${entry}-${index}`} className="flex items-center gap-1.5 min-w-0">
                  <input
                    type="color"
                    value={entry.slice(0, 7)}
                    onChange={(event) => updatePaletteColor(index, event.target.value)}
                    className="w-7 h-7 shrink-0 rounded border border-border bg-transparent cursor-pointer"
                    aria-label={`Edit palette colour ${index + 1}`}
                  />
                  <span className="font-mono text-[10px] text-fg-muted truncate">{entry}</span>
                  <button
                    type="button"
                    onClick={() => removePaletteColor(index)}
                    className="ml-auto shrink-0 text-fg-faint hover:text-fg"
                    aria-label={`Remove ${entry}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5 pt-1">
              <Button size="sm" variant="utility" onClick={() => addPaletteColor()}>
                <Plus className="w-3.5 h-3.5" /> Add current
              </Button>
              <Button
                size="sm"
                variant="utility"
                onClick={() => paletteFileRef.current?.click()}
              >
                <Upload className="w-3.5 h-3.5" /> Import
              </Button>
              <Button size="sm" variant="utility" onClick={exportPalette}>
                <Download className="w-3.5 h-3.5" /> Export
              </Button>
              <input
                ref={paletteFileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importPalette(file);
                  event.target.value = "";
                }}
              />
            </div>
            <p className="text-[10px] text-fg-faint leading-relaxed">
              Palette metadata saves as its own version when no pixels changed. Original generated
              colours are never quantized automatically.
            </p>
          </div>

          <div className="space-y-2 min-w-0">
            <span className="text-[11px] font-medium text-fg">Colours in this sprite</span>
            <div className="max-h-48 overflow-auto rounded border border-border divide-y divide-border">
              {usedColors.slice(0, 40).map((entry) => {
                const outside = outsideColors.some((color) => color.hex === entry.hex);
                return (
                  <div key={entry.hex} className="flex items-center gap-2 px-2 py-1">
                    <span
                      className="w-4 h-4 rounded-sm border border-border shrink-0"
                      style={{ backgroundColor: entry.hex }}
                    />
                    <span className="font-mono text-[10px] text-fg">{entry.hex}</span>
                    <span className="ml-auto text-[10px] text-fg-faint">{entry.count}px</span>
                    {outside ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-5 px-1 text-[10px]"
                        onClick={() => addPaletteColor(entry.hex)}
                      >
                        Add
                      </Button>
                    ) : null}
                  </div>
                );
              })}
              {!usedColors.length ? (
                <p className="p-2 text-[10px] text-fg-faint">The sprite is fully transparent.</p>
              ) : null}
            </div>
            <p className="text-[10px] text-fg-faint leading-relaxed">
              Out-of-palette colours are listed, not removed. Add them or map them deliberately.
            </p>
          </div>

          <div className="space-y-3 min-w-0">
            <div className="space-y-1.5">
              <span className="text-[11px] font-medium text-fg">Global replace</span>
              <div className="grid grid-cols-[1fr_auto] gap-1.5 items-center">
                <Select
                  value={replaceFrom}
                  onChange={(event) => setReplaceFrom(event.target.value)}
                >
                  <option value="">Choose source…</option>
                  {paletteColors.map((entry) => (
                    <option key={`p-${entry}`} value={entry}>
                      Palette {entry}
                    </option>
                  ))}
                  {usedColors.map((entry) => (
                    <option key={`u-${entry.hex}`} value={entry.hex}>
                      Used {entry.hex} ({entry.count})
                    </option>
                  ))}
                </Select>
                <input
                  type="color"
                  value={replaceTo.slice(0, 7)}
                  onChange={(event) => setReplaceTo(event.target.value)}
                  className="w-8 h-8 rounded border border-border bg-transparent cursor-pointer"
                  aria-label="Replacement colour"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <Select
                  className="w-32"
                  value={replaceScope}
                  onChange={(event) =>
                    setReplaceScope(event.target.value === "frame" ? "frame" : "all")
                  }
                >
                  <option value="all">All frames</option>
                  <option value="frame">Active frame</option>
                </Select>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!replaceFrom}
                  onClick={applyColorReplacement}
                >
                  Replace
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <span className="text-[11px] font-medium text-fg">Mapping</span>
              <div className="max-h-28 overflow-auto rounded border border-border divide-y divide-border">
                {usedColors.slice(0, 16).map((entry) => (
                  <div key={`map-${entry.hex}`} className="flex items-center gap-2 px-2 py-1">
                    <span
                      className="w-3.5 h-3.5 rounded-sm border border-border shrink-0"
                      style={{ backgroundColor: entry.hex }}
                    />
                    <span className="font-mono text-[10px] text-fg-muted truncate">{entry.hex}</span>
                    <input
                      type="color"
                      value={(mapping[entry.hex] ?? entry.hex).slice(0, 7)}
                      onChange={(event) =>
                        setMapping((prev) => ({ ...prev, [entry.hex]: event.target.value }))
                      }
                      className="ml-auto w-6 h-6 rounded border border-border bg-transparent cursor-pointer"
                      aria-label={`Map ${entry.hex} to a new colour`}
                    />
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  size="sm"
                  variant="utility"
                  disabled={!mappingEntries.length}
                  onClick={() => setPreviewMapping((prev) => !prev)}
                  aria-pressed={previewMapping}
                >
                  {previewMapping ? "Hide preview" : "Preview mapping"}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!mappingEntries.length}
                  onClick={applyMapping}
                >
                  Apply mapping
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!mappingEntries.length}
                  onClick={() => {
                    setMapping({});
                    setPreviewMapping(false);
                  }}
                >
                  Reset
                </Button>
              </div>
              {previewMapping && mappedPreviewUrl ? (
                <div
                  className="rounded border border-accent/60 p-2 flex items-center justify-center"
                  style={checkerStyle(6)}
                >
                  <img
                    src={mappedPreviewUrl}
                    alt="Palette mapping preview"
                    style={{
                      imageRendering: "pixelated",
                      width: dims.w * Math.max(1, Math.min(4, Math.floor(120 / dims.w))),
                    }}
                  />
                </div>
              ) : (
                <p className="text-[10px] text-fg-faint">
                  {mappingEntries.length
                    ? `${mappingEntries.length} colour${mappingEntries.length === 1 ? "" : "s"} will change.`
                    : "Choose target colours to preview a recolour before applying it."}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="border-t border-border pt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-medium text-fg">Saved palettes</span>
            <Input
              className="w-48"
              placeholder="Palette name"
              value={paletteName}
              onChange={(event) => setPaletteName(event.target.value)}
              maxLength={80}
            />
            <Button
              size="sm"
              variant="utility"
              loading={paletteBusy}
              disabled={!paletteName.trim()}
              onClick={() => void savePaletteToLibrary()}
            >
              <Save className="w-3.5 h-3.5" /> Save to library
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {savedPalettes.map((entry) => (
              <span
                key={entry.id}
                className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-1"
              >
                <button
                  type="button"
                  className="flex items-center gap-1 text-[10px] text-fg hover:text-accent"
                  onClick={() => loadPaletteFromLibrary(entry)}
                  title={`${entry.name}: ${entry.colors.join(", ")}`}
                >
                  {entry.colors.slice(0, 6).map((swatch, index) => (
                    <span
                      key={`${swatch}-${index}`}
                      className="w-2.5 h-2.5 rounded-sm border border-border"
                      style={{ backgroundColor: swatch }}
                    />
                  ))}
                  <span className="ml-1 max-w-28 truncate">{entry.name}</span>
                </button>
                <button
                  type="button"
                  className="text-fg-faint hover:text-fg"
                  onClick={() => void deletePaletteFromLibrary(entry)}
                  aria-label={`Delete palette ${entry.name}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            {!savedPalettes.length ? (
              <p className="text-[10px] text-fg-faint">
                No saved palettes yet. Palettes are available across characters and projects.
              </p>
            ) : null}
          </div>
        </div>
      </Card>
    </div>
  );
};
