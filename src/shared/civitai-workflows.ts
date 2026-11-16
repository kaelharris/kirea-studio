import type { WorkflowImportReport } from "./workflow-import";

export type CivitaiWorkflowCategory =
  | "image-generation"
  | "image-editing"
  | "inpainting"
  | "upscaling"
  | "animation"
  | "video-generation"
  | "other";

export const CIVITAI_WORKFLOW_CATEGORIES: Array<{
  id: CivitaiWorkflowCategory;
  label: string;
}> = [
  { id: "image-generation", label: "Image generation" },
  { id: "image-editing", label: "Image editing" },
  { id: "inpainting", label: "Inpainting" },
  { id: "upscaling", label: "Upscaling" },
  { id: "animation", label: "Animation" },
  { id: "video-generation", label: "Video generation" },
  { id: "other", label: "Other" },
];

export const CIVITAI_WORKFLOW_SORTS = [
  "Most Downloaded",
  "Highest Rated",
  "Newest",
] as const;

export type CivitaiWorkflowSort = (typeof CIVITAI_WORKFLOW_SORTS)[number];

export type CivitaiWorkflowFileKind = "json" | "zip" | "unsupported";

export interface CivitaiWorkflowFile {
  id: number | null;
  fileName: string;
  fileType: string | null;
  kind: CivitaiWorkflowFileKind;
  sizeBytes: number;
  downloadUrl: string;
  sha256: string | null;
  primary: boolean;
}

export interface CivitaiWorkflowVersion {
  id: number;
  name: string;
  baseModel: string;
  publishedAt: string | null;
  description: string | null;
  previewImageUrls: string[];
  files: CivitaiWorkflowFile[];
  primaryFile: CivitaiWorkflowFile | null;
  categories: CivitaiWorkflowCategory[];
  stats: {
    downloads: number;
    thumbsUp: number;
    thumbsDown: number;
  };
  installed: boolean;
  installedFileName: string | null;
}

export interface CivitaiWorkflowSummary {
  id: number;
  name: string;
  creator: string | null;
  description: string | null;
  tags: string[];
  baseModels: string[];
  categories: CivitaiWorkflowCategory[];
  nsfw: boolean;
  stats: {
    downloads: number;
    thumbsUp: number;
    rating: number;
  };
  primaryPreviewUrl: string | null;
  versions: CivitaiWorkflowVersion[];
  installed: boolean;
  importedAt: string | null;
}

export interface CivitaiWorkflowSearchQuery {
  query?: string;
  category?: CivitaiWorkflowCategory | null;
  sort?: CivitaiWorkflowSort;
  nsfw?: boolean;
  cursor?: string | null;
  limit?: number;
}

export interface CivitaiWorkflowSearchResult {
  items: CivitaiWorkflowSummary[];
  nextCursor: string | null;
  categoryFiltered: boolean;
}

export interface CivitaiWorkflowImportRequest {
  modelId: number;
  versionId: number;
}

export interface CivitaiWorkflowArchiveCandidate {
  entryPath: string;
  fileName: string;
  sizeBytes: number;
  report: WorkflowImportReport;
}

export interface CivitaiWorkflowImportPreview {
  modelId: number;
  modelName: string;
  versionId: number;
  versionName: string;
  originalFileName: string;
  fileKind: "json" | "zip";
  report: WorkflowImportReport | null;
  candidates: CivitaiWorkflowArchiveCandidate[];
  notes: string[];
}
