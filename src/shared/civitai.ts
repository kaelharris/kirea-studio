import type { ModelArchitecture } from "./types";

export type CivitaiModelType = "Checkpoint" | "LORA" | "VAE" | "Upscaler";
export type CivitaiSort = "Most Downloaded" | "Highest Rated" | "Newest";
export type CivitaiBaseModel =
  | "SD 1.5"
  | "SDXL 1.0"
  | "Illustrious"
  | "Pony"
  | "Anima"
  | "Flux.1 D";

export const CIVITAI_MODEL_TYPES: CivitaiModelType[] = [
  "Checkpoint",
  "LORA",
  "VAE",
  "Upscaler",
];

export const CIVITAI_SORTS: CivitaiSort[] = [
  "Most Downloaded",
  "Highest Rated",
  "Newest",
];

export const CIVITAI_BASE_MODELS: CivitaiBaseModel[] = [
  "Illustrious",
  "SDXL 1.0",
  "Pony",
  "SD 1.5",
  "Anima",
  "Flux.1 D",
];

export interface CivitaiVersion {
  id: number;
  name: string;
  baseModel: string;
  architecture: ModelArchitecture;
  availability: string | null;
  fileName: string;
  downloadUrl: string;
  downloadable: boolean;
  sizeBytes: number;
  sha256: string | null;
  trainedWords: string[];
  releaseNotes: string | null;
  primaryPreviewUrl: string | null;
  sampleImageUrls: string[];
  publishedAt: string | null;
  installed: boolean;
}

export interface CivitaiModelSummary {
  id: number;
  name: string;
  creator: string | null;
  type: CivitaiModelType;
  nsfw: boolean;
  description: string | null;
  tags: string[];
  stats: {
    downloads: number;
    thumbsUp: number;
    rating: number;
  };
  versions: CivitaiVersion[];
  primaryPreviewUrl: string | null;
  installed: boolean;
}

export interface CivitaiSearchQuery {
  query?: string;
  type?: CivitaiModelType | null;
  baseModel?: CivitaiBaseModel | null;
  sort?: CivitaiSort;
  nsfw?: boolean;
  cursor?: string | null;
  limit?: number;
}

export interface CivitaiSearchResult {
  items: CivitaiModelSummary[];
  nextCursor: string | null;
}

export interface CivitaiConnectionTest {
  ok: boolean;
  authenticated: boolean;
  message: string;
}

export interface CivitaiStartDownloadRequest {
  modelId: number;
  versionId: number;
}

export type CivitaiDownloadStatus =
  | "queued"
  | "downloading"
  | "verifying"
  | "finalizing"
  | "completed"
  | "failed"
  | "cancelled";

export interface CivitaiDownloadTask {
  id: string;
  modelId: number;
  versionId: number;
  modelName: string;
  versionName: string;
  architecture: ModelArchitecture;
  fileName: string;
  targetPath: string;
  totalBytes: number;
  downloadedBytes: number;
  speedBytesPerSec: number;
  etaSeconds: number | null;
  status: CivitaiDownloadStatus;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}
