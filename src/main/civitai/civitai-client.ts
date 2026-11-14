import path from "node:path";
import type {
  CivitaiConnectionTest,
  CivitaiModelSummary,
  CivitaiModelType,
  CivitaiSearchQuery,
  CivitaiSearchResult,
  CivitaiVersion,
} from "../../shared/civitai";
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
}

interface RawCivitaiImage {
  url?: string | null;
}

interface RawCivitaiVersion {
  id: number;
  name?: string | null;
  baseModel?: string | null;
  description?: string | null;
  publishedAt?: string | null;
  trainedWords?: string[] | null;
  files?: RawCivitaiFile[] | null;
  images?: RawCivitaiImage[] | null;
}

export interface RawCivitaiModel {
  id: number;
  name?: string | null;
  type?: string | null;
  nsfw?: boolean | null;
  description?: string | null;
  tags?: string[] | null;
  creator?: { username?: string | null; name?: string | null } | null;
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

function pickFile(files: RawCivitaiFile[] | null | undefined): RawCivitaiFile | null {
  if (!Array.isArray(files)) return null;
  const usable = files.filter((file): file is RawCivitaiFile => Boolean(file));
  return (
    usable.find((file) =>
      /\.(safetensors|ckpt|pt|pth|bin|gguf)$/i.test(file.name ?? "")
    ) ??
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
  const downloadUrl =
    (file?.downloadUrl ?? "").trim() || `${CIVITAI_DOWNLOAD_BASE}/${raw.id}`;
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
    fileName,
    downloadUrl,
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
