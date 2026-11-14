import type {
  CanvasCaptionMode,
  CanvasFit,
  CanvasOverlayKind,
  CanvasPageSize,
  CanvasTemplate,
  StoryCanvas,
} from "../../../shared/types";

export interface CanvasFormState {
  name: string;
  template: CanvasTemplate;
  pageSize: CanvasPageSize;
  captionMode: CanvasCaptionMode;
  margin: string;
  gutter: string;
  background: string;
  pageWidth: string;
  pageHeight: string;
}

export interface PanelFormState {
  sceneId: string;
  imageId: string;
  fit: CanvasFit;
  captionOverride: string;
}

export interface OverlayFormState {
  id: string | null;
  kind: CanvasOverlayKind;
  speaker: string;
  text: string;
  x: number;
  y: number;
}

export function nextCanvasName(canvases: StoryCanvas[]): string {
  if (!canvases.some((canvas) => canvas.name === "Storyboard")) {
    return "Storyboard";
  }
  let index = 2;
  while (canvases.some((canvas) => canvas.name === `Storyboard ${index}`)) {
    index += 1;
  }
  return `Storyboard ${index}`;
}

export function newOverlayForm(): OverlayFormState {
  return {
    id: null,
    kind: "speech",
    speaker: "",
    text: "",
    x: 0.5,
    y: 0.25,
  };
}

export function overlayId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  return `ov_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function overlayClass(kind: CanvasOverlayKind): string {
  switch (kind) {
    case "thought":
      return "bg-sky-50/95 text-slate-900 border border-dashed border-slate-500/60 rounded-xl italic";
    case "narration":
      return "bg-black/80 text-amber-100 border-l-2 border-amber-300/80 rounded-sm";
    case "text":
      return "bg-transparent text-white font-semibold drop-shadow-md text-center";
    case "speech":
    default:
      return "bg-white/95 text-slate-900 border border-black/15 rounded-lg shadow-lg";
  }
}
