import path from "node:path";
import type {
  CivitaiConnectionTest,
  CivitaiModelSummary,
  CivitaiModelType,
  CivitaiSearchQuery,
  CivitaiSearchResult,
  CivitaiVersion,
} from "../../shared/civitai";
import {
  CIVITAI_WORKFLOW_CATEGORIES,
  type CivitaiWorkflowCategory,
  type CivitaiWorkflowFile,
  type CivitaiWorkflowFileKind,
  type CivitaiWorkflowSearchQuery,
  type CivitaiWorkflowSearchResult,
  type CivitaiWorkflowSummary,
  type CivitaiWorkflowVersion,
} from "../../shared/civitai-workflows";
import type { ModelArchitecture, ModelRecord } from "../../shared/types";
import type { StudioLogger } from "../logger";

export const CIVITAI_API_BASE = "https://civitai.com/api/v1";
export const CIVITAI_DOWNLOAD_BASE = "https://civitai.com/api/download/models";

const USER_AGENT = "KireaStudio/1.0.1 (Windows Desktop)";

interface RawCivitaiFile {
  id?: number;
  name?: string | null;
  downloadUrl?: string | null;
  sizeKB?: number | null;
  hashes?: Record<string, string | null> | null;
  type?: string | null;
  primary?: boolean | null;
  metadata?: Record<string, unknown> | null;
}

interface RawCivitaiImage {
  url?: string | null;
}

interface RawCivitaiVersion {
  id: number;
  name?: string | null;
  baseModel?: string | null;
  availability?: string | null;
  description?: string | null;
  publishedAt?: string | null;
  trainedWords?: string[] | null;
  files?: RawCivitaiFile[] | null;
  images?: RawCivitaiImage[] | null;
  stats?: {
    downloadCount?: number | null;
    thumbsUpCount?: number | null;
    thumbsDownCount?: number | null;
  } | null;
}

export interface RawCivitaiModel {
  id: number;
  name?: string | null;
  type?: string | null;
  nsfw?: boolean | null;
  description?: string | null;
  tags?: string[] | null;
  creator?: { username?: string | null; name?: string | null } | null;
  baseModels?: string[] | null;
  stats?: {
    downloadCount?: number | null;
    thumbsUpCount?: number | null;
    rating?: number | null;
  } | null;
  modelVersions?: RawCivitaiVersion[] | null;
}

interface RawSearchResponse {
  items?: RawCivitaiModel[];
  metadata?: { nextCursor?: string | null } | null;
}

export interface LocalModelIndex {
  fileNames: Set<string>;
  sha256: Set<string>;
}

export interface CivitaiClientOptions {
  getApiKey: () => string | null;
  fetcher?: typeof fetch;
  logger?: StudioLogger;
}

export function buildLocalModelIndex(models: ModelRecord[]): LocalModelIndex {
  const fileNames = new Set<string>();
  const sha256 = new Set<string>();
  for (const model of models) {
    if (!model.installed) continue;
    if (model.filePath) {
      fileNames.add(path.basename(model.filePath).toLowerCase());
    }
    if (model.sha256) {
      sha256.add(model.sha256.toLowerCase());
    }
  }
  return { fileNames, sha256 };
}

export function isVersionInstalled(
  version: Pick<CivitaiVersion, "fileName" | "sha256">,
  index: LocalModelIndex
): boolean {
  if (version.sha256 && index.sha256.has(version.sha256.toLowerCase())) {
    return true;
  }
  return index.fileNames.has(path.basename(version.fileName).toLowerCase());
}

export function normalizeCivitaiBaseModel(raw: string | null | undefined): ModelArchitecture {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return "unknown";
  if (value.includes("illustrious") || value.includes("noobai")) return "illustrious";
  if (value.includes("pony")) return "pony";
  if (value.includes("flux")) return "flux";
  if (value.includes("anima")) return "anima";
  if (value.includes("z image") || value.includes("z-image") || value.includes("zimage")) {
    return "z_image";
  }
  if (
    value.includes("sd 1.5") ||
    value.includes("sd1.5") ||
    value.includes("stable diffusion 1") ||
    value === "1.5"
  ) {
    return "sd15";
  }
  if (
    value.includes("sdxl") ||
    value.includes("sd xl") ||
    value.includes("stable diffusion xl")
  ) {
    return "sdxl";
  }
  if (value.includes("sd 2") || value.includes("stable diffusion 2")) return "sdxl";
  return "unknown";
}

export function mapCivitaiType(raw: string | null | undefined): CivitaiModelType | null {
  const value = (raw ?? "").trim().toLowerCase();
  if (value.startsWith("checkpoint")) return "Checkpoint";
  if (value === "lora" || value === "locon" || value === "dora" || value === "lycoris") {
    return "LORA";
  }
  if (value === "vae") return "VAE";
  if (value === "upscaler") return "Upscaler";
  return null;
}

export function stripCivitaiHtml(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const stripped = raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return stripped.length > 0 ? stripped : null;
}

function isPrimaryModelFile(file: RawCivitaiFile): boolean {
  const type = (file.type ?? "").trim().toLowerCase();
  if (!type) return true;
  return !["vae", "config", "text encoder", "clip", "training data", "archive"].includes(
    type
  );
}

function pickFile(files: RawCivitaiFile[] | null | undefined): RawCivitaiFile | null {
  if (!Array.isArray(files)) return null;
  const usable = files.filter(
    (file): file is RawCivitaiFile =>
      Boolean(file) && /\.(safetensors|ckpt|pt|pth|bin|gguf)$/i.test(file.name ?? "")
  );
  return (
    usable.find((file) => file.primary === true && isPrimaryModelFile(file)) ??
    usable.find(isPrimaryModelFile) ??
    usable[0] ??
    null
  );
}

function mapVersion(
  raw: RawCivitaiVersion,
  index: LocalModelIndex
): CivitaiVersion | null {
  if (!raw || typeof raw.id !== "number") return null;
  const file = pickFile(raw.files);
  const fileName =
    (file?.name ?? "").trim() || `civitai-model-v${raw.id}.safetensors`;
  const downloadUrl = file
    ? (file.downloadUrl ?? "").trim() || `${CIVITAI_DOWNLOAD_BASE}/${raw.id}`
    : "";
  const baseModel = (raw.baseModel ?? "").trim();
  const images = Array.isArray(raw.images) ? raw.images : [];
  const imageUrls = images
    .map((image) => (image?.url ?? "").trim())
    .filter((url) => url.startsWith("http"));
  const sizeKB = typeof file?.sizeKB === "number" ? file.sizeKB : 0;

  const version: CivitaiVersion = {
    id: raw.id,
    name: (raw.name ?? "").trim() || `Version ${raw.id}`,
    baseModel,
    architecture: normalizeCivitaiBaseModel(baseModel),
    availability: (raw.availability ?? "").trim() || null,
    fileName,
    downloadUrl,
    downloadable: Boolean(file) && downloadUrl.length > 0,
    sizeBytes: sizeKB > 0 ? Math.round(sizeKB * 1024) : 0,
    sha256:
      (file?.hashes?.SHA256 ?? file?.hashes?.sha256 ?? null)?.toLowerCase() ?? null,
    trainedWords: Array.isArray(raw.trainedWords)
      ? raw.trainedWords.filter((word): word is string => typeof word === "string" && word.trim().length > 0)
      : [],
    releaseNotes: stripCivitaiHtml(raw.description),
    primaryPreviewUrl: imageUrls[0] ?? null,
    sampleImageUrls: imageUrls.slice(0, 6),
    publishedAt: raw.publishedAt ?? null,
    installed: false,
  };
  version.installed = isVersionInstalled(version, index);
  return version;
}

export function mapCivitaiModel(
  raw: RawCivitaiModel,
  index: LocalModelIndex
): CivitaiModelSummary | null {
  if (!raw || typeof raw.id !== "number") return null;
  const type = mapCivitaiType(raw.type);
  if (!type) return null;
  const versions = (Array.isArray(raw.modelVersions) ? raw.modelVersions : [])
    .map((version) => mapVersion(version, index))
    .filter((version): version is CivitaiVersion => version !== null)
    .slice(0, 12);
  if (versions.length === 0) return null;

  const primaryPreviewUrl =
    versions.find((version) => version.primaryPreviewUrl)?.primaryPreviewUrl ?? null;

  return {
    id: raw.id,
    name: (raw.name ?? "").trim() || `Civitai Model ${raw.id}`,
    creator: raw.creator?.username?.trim() || raw.creator?.name?.trim() || null,
    type,
    nsfw: raw.nsfw === true,
    description: stripCivitaiHtml(raw.description),
    tags: Array.isArray(raw.tags)
      ? raw.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 12)
      : [],
    stats: {
      downloads: Math.max(0, Number(raw.stats?.downloadCount ?? 0) || 0),
      thumbsUp: Math.max(0, Number(raw.stats?.thumbsUpCount ?? 0) || 0),
      rating: Math.max(0, Number(raw.stats?.rating ?? 0) || 0),
    },
    versions,
    primaryPreviewUrl,
    installed: versions.some((version) => version.installed),
  };
}

const WORKFLOW_CATEGORY_RULES: Array<{
  id: Exclude<CivitaiWorkflowCategory, "other">;
  pattern: RegExp;
}> = [
  {
    id: "inpainting",
    pattern: /\b(inpaint|inpainting|outpaint|outpainting)\b/,
  },
  {
    id: "upscaling",
    pattern: /\b(upscale|upscaler|upscaling|highres|hi-res|hires|supir|seedvr|esrgan|4x)\b/,
  },
  {
    id: "video-generation",
    pattern:
      /\b(video|t2v|i2v|img2vid|img2video|image2video|text2video|wan|hunyuan|ltx|ltxv|minimax|mochi|cogvideo|svd|framepack|veo|kling|runway)\b/,
  },
  {
    id: "animation",
    pattern:
      /\b(animatediff|animation|animated|sprite|sprites|sprite sheet|gif|flf2v|svi|interpolation|motion)\b/,
  },
  {
    id: "image-editing",
    pattern:
      /\b(img2img|i2i|image2image|editing|edit|kontext|redux|ipadapter|controlnet|refiner|detailer|adetailer|faceswap|relight)\b/,
  },
  {
    id: "image-generation",
    pattern:
      /\b(text2image|txt2img|t2i|generation|sdxl|pony|illustrious|noobai|flux|zimage|krea|anima|checkpoint|lora)\b/,
  },
];

export function detectWorkflowCategories(input: {
  name: string;
  tags?: string[];
  baseModel?: string | null;
  versionName?: string | null;
  fileNames?: string[];
}): CivitaiWorkflowCategory[] {
  const haystack = [
    input.name,
    input.versionName ?? "",
    input.baseModel ?? "",
    ...(input.tags ?? []),
    ...(input.fileNames ?? []),
  ]
    .join(" ")
    .toLowerCase();
  const matched = new Set<CivitaiWorkflowCategory>();
  for (const rule of WORKFLOW_CATEGORY_RULES) {
    if (rule.pattern.test(haystack)) matched.add(rule.id);
  }
  if (matched.size === 0) return ["other"];
  return CIVITAI_WORKFLOW_CATEGORIES.map((category) => category.id).filter((id) =>
    matched.has(id)
  );
}

function workflowFileKind(fileName: string): CivitaiWorkflowFileKind {
  if (/\.json$/i.test(fileName)) return "json";
  if (/\.zip$/i.test(fileName)) return "zip";
  return "unsupported";
}

function mapWorkflowFile(
  raw: RawCivitaiFile,
  versionId: number
): CivitaiWorkflowFile | null {
  const fileName = (raw.name ?? "").trim();
  if (!fileName) return null;
  const kind = workflowFileKind(fileName);
  const downloadUrl =
    kind === "unsupported"
      ? (raw.downloadUrl ?? "").trim()
      : (raw.downloadUrl ?? "").trim() || `${CIVITAI_DOWNLOAD_BASE}/${versionId}`;
  const sizeKB = typeof raw.sizeKB === "number" ? raw.sizeKB : 0;
  return {
    id: typeof raw.id === "number" ? raw.id : null,
    fileName,
    fileType: (raw.type ?? "").trim() || null,
    kind,
    sizeBytes: sizeKB > 0 ? Math.round(sizeKB * 1024) : 0,
    downloadUrl,
    sha256:
      (raw.hashes?.SHA256 ?? raw.hashes?.sha256 ?? null)?.toLowerCase() ?? null,
    primary: raw.primary === true,
  };
}

function mapWorkflowVersion(
  raw: RawCivitaiVersion,
  model: Pick<RawCivitaiModel, "name" | "tags">
): CivitaiWorkflowVersion | null {
  if (!raw || typeof raw.id !== "number") return null;
  const files = (Array.isArray(raw.files) ? raw.files : [])
    .map((file) => mapWorkflowFile(file, raw.id))
    .filter((file): file is CivitaiWorkflowFile => file !== null);
  if (files.length === 0) return null;
  const primaryFile =
    files.find((file) => file.kind === "json") ??
    files.find((file) => file.kind === "zip") ??
    null;
  const images = Array.isArray(raw.images) ? raw.images : [];
  const previewImageUrls = images
    .map((image) => (image?.url ?? "").trim())
    .filter((url) => url.startsWith("http"))
    .slice(0, 8);
  const baseModel = (raw.baseModel ?? "").trim();
  const categories = detectWorkflowCategories({
    name: (model.name ?? "").trim(),
    tags: Array.isArray(model.tags) ? model.tags : [],
    baseModel,
    versionName: raw.name,
    fileNames: files.map((file) => file.fileName),
  });
  return {
    id: raw.id,
    name: (raw.name ?? "").trim() || `Version ${raw.id}`,
    baseModel,
    publishedAt: raw.publishedAt ?? null,
    description: stripCivitaiHtml(raw.description),
    previewImageUrls,
    files,
    primaryFile,
    categories,
    stats: {
      downloads: Math.max(0, Number(raw.stats?.downloadCount ?? 0) || 0),
      thumbsUp: Math.max(0, Number(raw.stats?.thumbsUpCount ?? 0) || 0),
      thumbsDown: Math.max(0, Number(raw.stats?.thumbsDownCount ?? 0) || 0),
    },
    installed: false,
    installedFileName: null,
  };
}

export function mapCivitaiWorkflow(
  raw: RawCivitaiModel
): CivitaiWorkflowSummary | null {
  if (!raw || typeof raw.id !== "number") return null;
  if (raw.type && !/^workflows?$/i.test(raw.type.trim())) return null;
  const versions = (Array.isArray(raw.modelVersions) ? raw.modelVersions : [])
    .map((version) => mapWorkflowVersion(version, raw))
    .filter((version): version is CivitaiWorkflowVersion => version !== null)
    .slice(0, 20);
  if (versions.length === 0) return null;

  const tags = Array.isArray(raw.tags)
    ? raw.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 20)
    : [];
  const categories = detectWorkflowCategories({
    name: (raw.name ?? "").trim(),
    tags,
    baseModel: versions[0]?.baseModel ?? null,
    fileNames: versions[0]?.files.map((file) => file.fileName) ?? [],
  });
  const primaryPreviewUrl =
    versions.find((version) => version.previewImageUrls.length > 0)
      ?.previewImageUrls[0] ?? null;

  return {
    id: raw.id,
    name: (raw.name ?? "").trim() || `Civitai workflow ${raw.id}`,
    creator: raw.creator?.username?.trim() || raw.creator?.name?.trim() || null,
    description: stripCivitaiHtml(raw.description),
    tags,
    baseModels: Array.isArray(raw.baseModels)
      ? raw.baseModels.filter(
          (model): model is string => typeof model === "string" && model.trim().length > 0
        )
      : [],
    categories,
    nsfw: raw.nsfw === true,
    stats: {
      downloads: Math.max(0, Number(raw.stats?.downloadCount ?? 0) || 0),
      thumbsUp: Math.max(0, Number(raw.stats?.thumbsUpCount ?? 0) || 0),
      rating: Math.max(0, Number(raw.stats?.rating ?? 0) || 0),
    },
    primaryPreviewUrl,
    versions,
    installed: false,
    importedAt: null,
  };
}

export class CivitaiClient {
  constructor(private readonly options: CivitaiClientOptions) {}

  private get fetcher(): typeof fetch {
    return this.options.fetcher ?? fetch;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    };
    const apiKey = this.options.getApiKey();
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    return headers;
  }

  private async requestJson<T>(url: string, context: string): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(url, {
        headers: this.headers(),
        redirect: "follow",
      });
    } catch (err) {
      throw new Error(
        `Unable to reach Civitai while ${context}. ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new Error(
        this.options.getApiKey()
          ? "Civitai rejected the stored API key. Update it in Settings → Civitai Hub."
          : "Civitai requires an API key for this model. Add one in Settings → Civitai Hub."
      );
    }
    if (response.status === 429) {
      throw new Error("Civitai rate limit reached. Wait a moment before searching again.");
    }
    if (response.status === 404) {
      throw new Error(`Civitai could not find the requested ${context} (HTTP 404).`);
    }
    if (!response.ok) {
      throw new Error(`Civitai request failed (HTTP ${response.status} ${response.statusText}).`);
    }
    return (await response.json()) as T;
  }

  async searchModels(
    query: CivitaiSearchQuery,
    localModels: ModelRecord[] = []
  ): Promise<CivitaiSearchResult> {
    const params = new URLSearchParams();
    const limit = Math.min(Math.max(query.limit ?? 24, 1), 50);
    params.set("limit", String(limit));
    params.set("sort", query.sort ?? "Most Downloaded");
    params.set("nsfw", String(query.nsfw === true));
    if (query.query?.trim()) params.set("query", query.query.trim());
    if (query.type) params.set("types", query.type);
    if (query.baseModel) params.set("baseModels", query.baseModel);
    if (query.cursor) params.set("cursor", query.cursor);

    const payload = await this.requestJson<RawSearchResponse>(
      `${CIVITAI_API_BASE}/models?${params.toString()}`,
      "searching models"
    );
    const index = buildLocalModelIndex(localModels);
    const items = (Array.isArray(payload.items) ? payload.items : [])
      .map((item) => mapCivitaiModel(item, index))
      .filter((item): item is CivitaiModelSummary => item !== null);

    return {
      items,
      nextCursor: payload.metadata?.nextCursor ?? null,
    };
  }

  async getModelDetails(
    modelId: number,
    localModels: ModelRecord[] = []
  ): Promise<CivitaiModelSummary> {
    const payload = await this.requestJson<RawCivitaiModel>(
      `${CIVITAI_API_BASE}/models/${modelId}`,
      "loading model details"
    );
    const mapped = mapCivitaiModel(payload, buildLocalModelIndex(localModels));
    if (!mapped) {
      throw new Error(`Civitai model ${modelId} has no downloadable Checkpoint, LoRA, VAE, or Upscaler versions.`);
    }
    return mapped;
  }

  async searchWorkflows(
    query: CivitaiWorkflowSearchQuery
  ): Promise<CivitaiWorkflowSearchResult> {
    const limit = Math.min(Math.max(query.limit ?? 24, 1), 50);
    const category = query.category ?? null;
    const collected: CivitaiWorkflowSummary[] = [];
    let cursor = query.cursor?.trim() || null;
    let nextCursor: string | null = null;
    let pages = 0;

    do {
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      params.set("sort", query.sort ?? "Most Downloaded");
      params.set("nsfw", String(query.nsfw === true));
      params.set("types", "Workflows");
      if (query.query?.trim()) params.set("query", query.query.trim());
      if (cursor) params.set("cursor", cursor);

      const payload = await this.requestJson<RawSearchResponse>(
        `${CIVITAI_API_BASE}/models?${params.toString()}`,
        "searching workflows"
      );
      const batch = (Array.isArray(payload.items) ? payload.items : [])
        .map((item) => mapCivitaiWorkflow(item))
        .filter((item): item is CivitaiWorkflowSummary => item !== null);
      collected.push(
        ...batch.filter(
          (item) => !category || item.categories.includes(category)
        )
      );
      nextCursor = payload.metadata?.nextCursor ?? null;
      cursor = nextCursor;
      pages += 1;
    } while (category && collected.length < limit && cursor && pages < 4);

    const seen = new Set<number>();
    const items = collected
      .filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      })
      .slice(0, limit);

    return {
      items,
      nextCursor,
      categoryFiltered: Boolean(category),
    };
  }

  async getWorkflowDetails(modelId: number): Promise<CivitaiWorkflowSummary> {
    const payload = await this.requestJson<RawCivitaiModel>(
      `${CIVITAI_API_BASE}/models/${modelId}`,
      "loading workflow details"
    );
    const mapped = mapCivitaiWorkflow(payload);
    if (!mapped) {
      throw new Error(`Civitai workflow ${modelId} has no downloadable versions.`);
    }
    return mapped;
  }

  async testConnection(): Promise<CivitaiConnectionTest> {
    const apiKey = this.options.getApiKey();
    try {
      const response = await this.fetcher(`${CIVITAI_API_BASE}/models?limit=1`, {
        headers: this.headers(),
        redirect: "follow",
      });
      if (response.status === 401 || response.status === 403) {
        return {
          ok: false,
          authenticated: false,
          message: apiKey
            ? "Civitai rejected the stored API key."
            : "Civitai requires an API key for this request.",
        };
      }
      if (!response.ok) {
        return {
          ok: false,
          authenticated: Boolean(apiKey),
          message: `Civitai returned HTTP ${response.status}.`,
        };
      }
      return {
        ok: true,
        authenticated: Boolean(apiKey),
        message: apiKey
          ? "Authenticated. Gated and early-access models are available."
          : "Public browsing works. Add an API key to unlock gated models.",
      };
    } catch (err) {
      this.options.logger?.warn("civitai", "Connection test failed", String(err));
      return {
        ok: false,
        authenticated: Boolean(apiKey),
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
