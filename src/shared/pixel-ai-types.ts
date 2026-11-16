import type { PixelKind } from "./pixel-types";

export type PixelAiMode = "text" | "image" | "reference" | "inpaint" | "directions";

export type PixelAiJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type PixelAiRequirementState = "available" | "missing" | "unverified";

export interface PixelAiRequirement {
  kind: "node" | "model" | "workflow";
  name: string;
  state: PixelAiRequirementState;
  detail: string | null;
}

export type PixelAiCapabilityId =
  | "text_to_pixel"
  | "image_to_pixel_direct"
  | "image_to_pixel_ai"
  | "reference_to_pixel"
  | "inpaint_pixel"
  | "directional_set";

export interface PixelAiCapabilityStatus {
  id: PixelAiCapabilityId;
  label: string;
  mode: PixelAiMode;
  workflowFile: string;
  ready: boolean;
  unverified: boolean;
  requirements: PixelAiRequirement[];
  notes: string[];
}

export interface PixelAiHardwareInfo {
  devices: Array<{
    name: string;
    type: string;
    vramTotalBytes: number;
    vramFreeBytes: number;
  }>;
  ramTotalBytes: number | null;
  ramFreeBytes: number | null;
  warnings: string[];
}

export type PixelAiBackendState =
  | "ready"
  | "unverified"
  | "setup_required"
  | "unreachable"
  | "workflows_missing";

export interface PixelAiBackendStatus {
  state: PixelAiBackendState;
  message: string;
  configured: boolean;
  reachable: boolean;
  apiUrl: string;
  comfyVersion: string | null;
  pythonVersion: string | null;
  pytorchVersion: string | null;
  workflowRoot: string;
  workflowRootSource: "configured" | "bundled" | "missing";
  capabilities: PixelAiCapabilityStatus[];
  hardware: PixelAiHardwareInfo | null;
  warnings: string[];
  checkedAt: string;
}

export interface PixelAiAssetImageInput {
  kind: "asset";
  assetId: string;
  frameIndex?: number;
}

export interface PixelAiDataUrlImageInput {
  kind: "dataUrl";
  dataUrl: string;
  fileName?: string;
}

export type PixelAiImageInput = PixelAiAssetImageInput | PixelAiDataUrlImageInput;

export interface PixelAiInpaintRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  grow?: number;
}

export interface PixelAiGenerateInput {
  projectId: string;
  characterId?: string | null;
  parentAssetId?: string | null;
  kind: PixelKind;
  name: string;
  mode: PixelAiMode;
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  paletteId: string;
  seed?: number;
  style?: string;
  transparent?: boolean;
  steps?: number;
  longSide?: number;
  /** image mode: direct = palette/quantise only, ai = semantic redraw */
  conversion?: "direct" | "ai";
  /** reference mode LoRA strength, 0-2 */
  strength?: number;
  /** directions mode: 4 = S/E/N/W, 8 = clockwise from S */
  directionCount?: 4 | 8;
  image?: PixelAiImageInput;
  reference?: {
    subject: PixelAiImageInput;
    style?: PixelAiImageInput;
  };
  inpaint?: {
    base: PixelAiImageInput;
    region: PixelAiInpaintRegion;
  };
}

export interface PixelAiReferenceMetadata {
  subject: { source: "asset" | "upload"; label: string };
  style: { source: "asset" | "upload"; label: string } | null;
}

export interface PixelAiGenerationMetadata {
  backend: "spritekiln";
  backendVersion: string | null;
  workflowId: PixelAiCapabilityId;
  workflowFile: string;
  model: string;
  prompt: string;
  negativePrompt: string;
  seed: number;
  width: number;
  height: number;
  paletteId: string;
  palette: string[];
  style: string | null;
  timestamp: string;
  promptId: string;
  reference: PixelAiReferenceMetadata | null;
  settings: Record<string, string | number | boolean>;
  notes: string[];
}

export interface PixelAiJob {
  id: string;
  projectId: string;
  mode: PixelAiMode;
  name: string;
  status: PixelAiJobStatus;
  stage: string;
  progress: number | null;
  progressMax: number | null;
  promptId: string | null;
  error: string | null;
  assetId: string | null;
  assetIds: string[];
  warnings: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PixelAiConnectionTest {
  ok: boolean;
  apiUrl: string;
  comfyVersion: string | null;
  message: string;
}

export const SPRITEKILN_STYLES = [
  "default",
  "8-bit (NES)",
  "16-bit (SNES / Mega Drive)",
  "GBA (32-bit handheld)",
  "32-bit (PS1 / Saturn / arcade)",
  "HD-2D character (Octopath-like)",
  "HD-2D portrait",
  "high-detail modern (indie)",
  "arcade fighter (large sprite)",
  "simple / flat",
  "detailed",
  "game asset",
  "character (side view)",
  "character (front, RPG)",
  "character (top-down)",
  "character turnaround",
  "monster / creature",
  "boss (large)",
  "portrait",
  "item / icon",
  "item sheet",
  "skill icon",
  "VFX / effect",
  "UI element",
  "texture (tileable)",
  "environment / background",
  "isometric",
  "isometric asset",
  "top-down map",
  "top-down asset",
  "1-bit",
  "low-res / tiny",
  "block texture (MC-style)",
  "inventory item (MC-style)",
  "painterly",
  "anime / cel",
  "raw prompt",
] as const;
