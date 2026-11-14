import type {
  CanvasCaptionMode,
  CanvasFit,
  CanvasOverlay,
  CanvasOverlayKind,
  CanvasPageSize,
  CanvasTemplate,
  GeneratedImageRecord,
  Story,
  StoryCanvas,
  StoryCanvasItem,
  StoryScene,
} from "./types";

export const CANVAS_TEMPLATE_LABELS: Record<CanvasTemplate, string> = {
  grid_2x3: "2×3 Grid",
  grid_3x3: "3×3 Grid",
  filmstrip: "Filmstrip",
  freeform: "Freeform",
};

export const CANVAS_PAGE_SIZE_LABELS: Record<CanvasPageSize, string> = {
  a4_portrait: "A4 portrait",
  a4_landscape: "A4 landscape",
  letter: "Letter",
  square: "Square",
  custom: "Custom",
};

export const CANVAS_CAPTION_MODE_LABELS: Record<CanvasCaptionMode, string> = {
  none: "No captions",
  scene_title: "Scene title",
  synopsis: "Synopsis",
  prompt: "Prompt",
};

export const CANVAS_OVERLAY_KIND_LABELS: Record<CanvasOverlayKind, string> = {
  speech: "Speech",
  thought: "Thought",
  narration: "Narration",
  text: "Text",
};

export const CANVAS_FIT_LABELS: Record<CanvasFit, string> = {
  cover: "Cover",
  contain: "Contain",
};

export const CANVAS_TEMPLATES: CanvasTemplate[] = [
  "grid_2x3",
  "grid_3x3",
  "filmstrip",
  "freeform",
];

export const CANVAS_PAGE_SIZES: CanvasPageSize[] = [
  "a4_portrait",
  "a4_landscape",
  "letter",
  "square",
  "custom",
];

export const CANVAS_CAPTION_MODES: CanvasCaptionMode[] = [
  "none",
  "scene_title",
  "synopsis",
  "prompt",
];

export const CANVAS_OVERLAY_KINDS: CanvasOverlayKind[] = [
  "speech",
  "thought",
  "narration",
  "text",
];

export const CANVAS_PAGE_DIMENSIONS: Record<
  Exclude<CanvasPageSize, "custom">,
  { width: number; height: number }
> = {
  a4_portrait: { width: 794, height: 1123 },
  a4_landscape: { width: 1123, height: 794 },
  letter: { width: 816, height: 1056 },
  square: { width: 1080, height: 1080 },
};

export const CANVAS_MIN_PAGE_DIMENSION = 320;
export const CANVAS_MAX_PAGE_DIMENSION = 4096;
export const CANVAS_MIN_MARGIN = 0;
export const CANVAS_MAX_MARGIN = 240;
export const CANVAS_MIN_GUTTER = 0;
export const CANVAS_MAX_GUTTER = 120;

export interface CanvasGrid {
  columns: number;
  rows: number;
}

export interface CanvasSlot {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasLayoutPanel {
  item: StoryCanvasItem;
  pageIndex: number;
  pagePosition: number;
  slot: CanvasSlot;
  caption: string;
  scene: StoryScene | null;
}

export interface CanvasPageLayout {
  index: number;
  width: number;
  height: number;
  panels: CanvasLayoutPanel[];
}

export interface CanvasSyncPanel {
  sceneId: string;
  imageId: string | null;
  caption: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function resolveCanvasPageDimensions(
  pageSize: CanvasPageSize,
  customWidth?: number | null,
  customHeight?: number | null
): { width: number; height: number } {
  if (pageSize === "custom") {
    const fallback = CANVAS_PAGE_DIMENSIONS.a4_landscape;
    const width = Number.isFinite(customWidth)
      ? Math.round(
          clamp(
            customWidth as number,
            CANVAS_MIN_PAGE_DIMENSION,
            CANVAS_MAX_PAGE_DIMENSION
          )
        )
      : fallback.width;
    const height = Number.isFinite(customHeight)
      ? Math.round(
          clamp(
            customHeight as number,
            CANVAS_MIN_PAGE_DIMENSION,
            CANVAS_MAX_PAGE_DIMENSION
          )
        )
      : fallback.height;
    return { width, height };
  }
  return CANVAS_PAGE_DIMENSIONS[pageSize] ?? CANVAS_PAGE_DIMENSIONS.a4_landscape;
}

export function canvasGridFor(
  template: CanvasTemplate,
  pageWidth: number,
  pageHeight: number
): CanvasGrid {
  switch (template) {
    case "grid_3x3":
      return { columns: 3, rows: 3 };
    case "filmstrip":
      return pageWidth >= pageHeight
        ? { columns: 4, rows: 1 }
        : { columns: 1, rows: 4 };
    case "freeform":
      return { columns: 2, rows: 3 };
    case "grid_2x3":
    default:
      return { columns: 2, rows: 3 };
  }
}

export function canvasPanelsPerPage(
  template: CanvasTemplate,
  pageWidth: number,
  pageHeight: number
): number {
  const grid = canvasGridFor(template, pageWidth, pageHeight);
  return grid.columns * grid.rows;
}

export function computeCanvasSlots(
  pageWidth: number,
  pageHeight: number,
  margin: number,
  gutter: number,
  grid: CanvasGrid
): CanvasSlot[] {
  const safeMargin = Math.max(0, margin);
  const safeGutter = Math.max(0, gutter);
  const contentWidth = Math.max(1, pageWidth - safeMargin * 2);
  const contentHeight = Math.max(1, pageHeight - safeMargin * 2);
  const cellWidth = Math.max(
    1,
    (contentWidth - safeGutter * (grid.columns - 1)) / grid.columns
  );
  const cellHeight = Math.max(
    1,
    (contentHeight - safeGutter * (grid.rows - 1)) / grid.rows
  );

  const slots: CanvasSlot[] = [];
  for (let row = 0; row < grid.rows; row += 1) {
    for (let column = 0; column < grid.columns; column += 1) {
      slots.push({
        x: safeMargin + column * (cellWidth + safeGutter),
        y: safeMargin + row * (cellHeight + safeGutter),
        width: cellWidth,
        height: cellHeight,
      });
    }
  }
  return slots;
}

function freeformSlot(
  item: StoryCanvasItem,
  pageWidth: number,
  pageHeight: number,
  margin: number,
  fallback: CanvasSlot
): CanvasSlot {
  const hasGeometry =
    item.x !== null &&
    item.y !== null &&
    item.width !== null &&
    item.height !== null &&
    Number.isFinite(item.x) &&
    Number.isFinite(item.y) &&
    Number.isFinite(item.width) &&
    Number.isFinite(item.height) &&
    (item.width as number) > 0 &&
    (item.height as number) > 0;
  if (!hasGeometry) return fallback;

  const contentWidth = Math.max(1, pageWidth - margin * 2);
  const contentHeight = Math.max(1, pageHeight - margin * 2);
  const x = clamp(item.x as number, 0, 1);
  const y = clamp(item.y as number, 0, 1);
  const width = clamp(item.width as number, 0.02, 1 - x);
  const height = clamp(item.height as number, 0.02, 1 - y);
  return {
    x: margin + x * contentWidth,
    y: margin + y * contentHeight,
    width: width * contentWidth,
    height: height * contentHeight,
  };
}

export function resolveCanvasCaption(
  captionMode: CanvasCaptionMode,
  item: Pick<StoryCanvasItem, "captionOverride">,
  scene: StoryScene | null
): string {
  const override = item.captionOverride.trim();
  if (override) return override;
  if (captionMode === "none" || !scene) return "";
  switch (captionMode) {
    case "synopsis":
      return scene.synopsis.trim() || scene.title.trim();
    case "prompt":
      return scene.prompt.trim() || scene.synopsis.trim() || scene.title.trim();
    case "scene_title":
    default:
      return scene.title.trim();
  }
}

export function buildCanvasPages(
  canvas: Pick<
    StoryCanvas,
    | "template"
    | "pageWidth"
    | "pageHeight"
    | "margin"
    | "gutter"
    | "captionMode"
  >,
  items: StoryCanvasItem[],
  scenes: StoryScene[]
): CanvasPageLayout[] {
  if (items.length === 0) return [];

  const sceneById = new Map(scenes.map((scene) => [scene.id, scene]));
  const ordered = [...items].sort((a, b) => a.position - b.position);
  const perPage = canvasPanelsPerPage(
    canvas.template,
    canvas.pageWidth,
    canvas.pageHeight
  );
  const grid = canvasGridFor(canvas.template, canvas.pageWidth, canvas.pageHeight);
  const gridSlots = computeCanvasSlots(
    canvas.pageWidth,
    canvas.pageHeight,
    canvas.margin,
    canvas.gutter,
    grid
  );

  const pages: CanvasPageLayout[] = [];
  for (let start = 0; start < ordered.length; start += perPage) {
    const pageIndex = pages.length;
    const pageItems = ordered.slice(start, start + perPage);
    const panels: CanvasLayoutPanel[] = pageItems.map((item, pagePosition) => {
      const scene = item.sceneId ? sceneById.get(item.sceneId) ?? null : null;
      const fallback = gridSlots[pagePosition] ?? gridSlots[0]!;
      const slot =
        canvas.template === "freeform"
          ? freeformSlot(item, canvas.pageWidth, canvas.pageHeight, canvas.margin, fallback)
          : fallback;
      return {
        item,
        pageIndex,
        pagePosition,
        slot,
        caption: resolveCanvasCaption(canvas.captionMode, item, scene),
        scene,
      };
    });
    pages.push({
      index: pageIndex,
      width: canvas.pageWidth,
      height: canvas.pageHeight,
      panels,
    });
  }
  return pages;
}

export function normalizeCanvasOverlays(raw: unknown): CanvasOverlay[] {
  if (!Array.isArray(raw)) return [];
  const overlays: CanvasOverlay[] = [];
  for (const value of raw) {
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    const text = typeof record.text === "string" ? record.text.trim() : "";
    if (!text) continue;
    const kind = CANVAS_OVERLAY_KINDS.includes(
      record.kind as CanvasOverlayKind
    )
      ? (record.kind as CanvasOverlayKind)
      : "text";
    const speaker =
      typeof record.speaker === "string" ? record.speaker.trim() : "";
    const x = Number(record.x);
    const y = Number(record.y);
    overlays.push({
      id:
        typeof record.id === "string" && record.id.trim()
          ? record.id.trim().slice(0, 64)
          : `overlay_${overlays.length + 1}`,
      kind,
      ...(speaker ? { speaker } : {}),
      text,
      x: Number.isFinite(x) ? clamp(x, 0, 1) : 0.5,
      y: Number.isFinite(y) ? clamp(y, 0, 1) : 0.5,
    });
  }
  return overlays;
}

/**
 * Mirrors a story's scene order into canvas panels. Selected scene images win;
 * otherwise the newest render for the scene is used.
 */
export function buildCanvasSyncPanels(
  story: Pick<Story, "scenes">,
  images: GeneratedImageRecord[]
): CanvasSyncPanel[] {
  const latestByScene = new Map<string, GeneratedImageRecord>();
  for (const image of images) {
    if (!image.storySceneId) continue;
    if (!latestByScene.has(image.storySceneId)) {
      latestByScene.set(image.storySceneId, image);
    }
  }

  return story.scenes.map((scene) => ({
    sceneId: scene.id,
    imageId: scene.selectedImageId ?? latestByScene.get(scene.id)?.id ?? null,
    caption: scene.synopsis.trim() || scene.title.trim(),
  }));
}
