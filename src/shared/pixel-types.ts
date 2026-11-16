export type PixelKind =
  | "character"
  | "creature"
  | "weapon"
  | "item"
  | "object"
  | "tileset"
  | "environment"
  | "effect";

export type PixelEngineKind = "pixelbolt" | "comfyui" | "imported";
export type PixelDirection = "front" | "back" | "side";

export type PixelExportFormat =
  | "png"
  | "sheet"
  | "gif"
  | "apng"
  | "zip"
  | "godot"
  | "unity"
  | "phaser";

export interface PixelPalettePreset {
  id: string;
  name: string;
  ink: string;
  garment: string;
  skin: string;
  hair: string;
  accent: string;
}

export const PIXEL_PALETTES: PixelPalettePreset[] = [
  {
    id: "kirea",
    name: "Kirea",
    ink: "#191920",
    garment: "#4f7bfc",
    skin: "#e8c9ae",
    hair: "#d9c9a8",
    accent: "#f2dc93",
  },
  {
    id: "ember",
    name: "Ember",
    ink: "#241318",
    garment: "#b8452f",
    skin: "#f0c9a8",
    hair: "#3a2030",
    accent: "#f2b544",
  },
  {
    id: "forest",
    name: "Forest",
    ink: "#14201a",
    garment: "#3f7a4f",
    skin: "#d9b48f",
    hair: "#2d4436",
    accent: "#c9e6a0",
  },
  {
    id: "neon",
    name: "Neon",
    ink: "#0d0f1a",
    garment: "#2b2f4a",
    skin: "#d8b8d8",
    hair: "#5a3f7a",
    accent: "#ff4fa3",
  },
  {
    id: "mono",
    name: "Mono",
    ink: "#141414",
    garment: "#6e6e6e",
    skin: "#c9c9c9",
    hair: "#8a8a8a",
    accent: "#f2f2f2",
  },
];

export const PIXEL_KIND_LABELS: Record<PixelKind, string> = {
  character: "Character",
  creature: "Creature",
  weapon: "Weapon",
  item: "Item",
  object: "Object",
  tileset: "Tileset",
  environment: "Environment",
  effect: "Effect",
};

export const PIXEL_SIZE_PRESETS = [16, 32, 48, 64, 96, 128];

export interface PixelProject {
  id: string;
  name: string;
  description: string;
  width: number;
  height: number;
  paletteJson: string;
  createdAt: string;
  updatedAt: string;
}

export interface PixelProjectInput {
  id?: string;
  name: string;
  description?: string;
  width?: number;
  height?: number;
}

export interface PixelCharacter {
  id: string;
  projectId: string;
  name: string;
  description: string;
  seed: number;
  paletteId: string;
  referenceAssetId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PixelCharacterInput {
  id?: string;
  projectId: string;
  name: string;
  description?: string;
  seed?: number;
  paletteId?: string;
  referenceAssetId?: string | null;
}

export interface PixelAssetRecord {
  id: string;
  projectId: string;
  characterId: string | null;
  name: string;
  kind: PixelKind;
  engine: PixelEngineKind;
  width: number;
  height: number;
  frameCount: number;
  prompt: string;
  seed: number | null;
  paletteId: string;
  palette: string[];
  previewDataUrl: string;
  previewPath: string;
  sheetPath: string | null;
  recipeJson: string;
  parentAssetId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface PixelFrameRecord {
  id: string;
  index: number;
  name: string;
  durationMs: number;
  dataUrl: string;
}

export interface PixelAnimationRecord {
  frames: number[];
  loop: boolean;
  duration: number;
}

export interface PixelAssetDetail extends PixelAssetRecord {
  frames: PixelFrameRecord[];
  animations: Record<string, PixelAnimationRecord>;
  generation: import("./pixel-ai-types").PixelAiGenerationMetadata | null;
}

export interface PixelAssetVersion {
  id: string;
  assetId: string;
  version: number;
  previewDataUrl: string;
  createdAt: string;
}

export interface PixelSavedPalette {
  id: string;
  name: string;
  colors: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PixelSavedPaletteInput {
  id?: string;
  name: string;
  colors: string[];
}

export interface PixelFrameInput {
  id?: string;
  index: number;
  name: string;
  durationMs: number;
  dataUrl: string;
}

export interface PixelAnimationInput {
  name: string;
  frames: string[];
  loop: boolean;
}

export interface PixelGenerateInput {
  projectId: string;
  characterId?: string | null;
  kind: PixelKind;
  name: string;
  width: number;
  height: number;
  paletteId: string;
  seed: number;
  direction?: PixelDirection;
  prompt?: string;
}

export interface PixelImportInput {
  projectId: string;
  imageId: string;
  name: string;
  width: number;
  height: number;
  paletteId: string;
  transparent?: boolean;
}

export interface PixelExportOptions {
  scale?: number;
  animation?: string;
  frameIndex?: number;
}

export interface PixelAssetFilters {
  projectId?: string;
  characterId?: string;
  kind?: PixelKind;
  search?: string;
}

export interface PixelExportResult {
  format: PixelExportFormat;
  filePath: string;
  width: number;
  height: number;
  frameCount: number;
  note?: string;
}

export interface SpriteKilnWorkflowReport {
  file: string;
  title: string;
  nodeCount: number;
  nodeTypes: string[];
  modelFiles: string[];
  customNodeTypes: string[];
  runnable: boolean;
  reason: string | null;
}

export interface SpriteKilnReport {
  available: boolean;
  rootPath: string;
  workflows: SpriteKilnWorkflowReport[];
  message: string;
}
