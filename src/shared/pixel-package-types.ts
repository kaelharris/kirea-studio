export type PixelPackageScope = "asset" | "animation" | "character" | "project";
export type PixelPackagePreset = "generic" | "godot" | "unity" | "phaser";
export type PixelPackageContainer = "zip" | "folder";
export type PixelPivotPreset = "center" | "bottom-center" | "top-left";

export const PIXEL_DIRECTIONS = [
  "south",
  "south-east",
  "east",
  "north-east",
  "north",
  "north-west",
  "west",
  "south-west",
] as const;
export type PixelPackageDirection = (typeof PIXEL_DIRECTIONS)[number];

export interface PixelSheetLayout {
  /** 0 picks a column count automatically. */
  columns: number;
  /** 0 picks a row count automatically. */
  rows: number;
  /** Transparent border around the whole sheet, in exported pixels. */
  padding: number;
  /** Transparent gap between neighbouring cells, in exported pixels. */
  spacing: number;
  /** Edge pixels repeated outward around every frame. */
  extrude: number;
  trim: boolean;
  /** Pads every frame to the largest frame of the sheet (bottom-centre aligned). */
  uniformFrames: boolean;
  maxSize: number;
}

export interface PixelPackageOutputs {
  frames: boolean;
  stills: boolean;
  combinedSheet: boolean;
  animationSheets: boolean;
  directionSheets: boolean;
  gif: boolean;
  apng: boolean;
}

export interface PixelPackageRequest {
  jobId?: string;
  scope: PixelPackageScope;
  projectId?: string;
  characterId?: string;
  assetId?: string;
  animation?: string;
  version?: number;
  preset: PixelPackagePreset;
  container: PixelPackageContainer;
  scale: number;
  layout: PixelSheetLayout;
  outputs: PixelPackageOutputs;
  /** Flattens generic PNG and GIF output onto this colour; null keeps transparency. */
  background: string | null;
  pivot: PixelPivotPreset;
  pixelsPerUnit: number;
  /** Folder that receives the package; null uses KIREA's own export folder. */
  destination: string | null;
}

export type PixelPackageFileKind =
  | "manifest"
  | "frame"
  | "still"
  | "sheet"
  | "atlas"
  | "gif"
  | "apng"
  | "godot"
  | "unity"
  | "phaser"
  | "provenance"
  | "readme";

export interface PixelPackageFile {
  path: string;
  kind: PixelPackageFileKind;
  bytes: number;
  width?: number;
  height?: number;
  frames?: number;
}

export interface PixelPackageIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  assetId?: string;
  animation?: string;
}

export interface PixelPackageSummary {
  root: string;
  assets: number;
  frames: number;
  animations: number;
  directions: PixelPackageDirection[];
  sheets: number;
  versions: Array<{ assetId: string; name: string; version: number; current: boolean }>;
}

export interface PixelPackagePreview {
  label: string;
  dataUrl: string;
  width: number;
  height: number;
}

export interface PixelPackagePlan {
  request: PixelPackageRequest;
  summary: PixelPackageSummary;
  files: PixelPackageFile[];
  issues: PixelPackageIssue[];
  blocked: boolean;
  totalBytes: number;
  preview: PixelPackagePreview | null;
  destination: string;
}

export interface PixelPackageVerification {
  ok: boolean;
  checkedFiles: number;
  checkedImages: number;
  checkedRegions: number;
  checkedPixels: number;
  problems: string[];
}

export interface PixelPackageResult {
  filePath: string;
  container: PixelPackageContainer;
  plan: PixelPackagePlan;
  verification: PixelPackageVerification;
}

export interface PixelPackageProgress {
  jobId: string;
  stage: "collect" | "pack" | "encode" | "write" | "verify" | "done" | "cancelled" | "failed";
  done: number;
  total: number;
  message: string;
}

export const DEFAULT_SHEET_LAYOUT: PixelSheetLayout = {
  columns: 0,
  rows: 0,
  padding: 0,
  spacing: 0,
  extrude: 0,
  trim: false,
  uniformFrames: false,
  maxSize: 4096,
};

export const DEFAULT_PACKAGE_OUTPUTS: PixelPackageOutputs = {
  frames: true,
  stills: true,
  combinedSheet: true,
  animationSheets: false,
  directionSheets: false,
  gif: true,
  apng: false,
};
