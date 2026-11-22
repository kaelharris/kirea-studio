import type {
  HuggingFaceConnectionTest,
  HuggingFaceFile,
  HuggingFaceFileKind,
  HuggingFaceRepoDetails,
  HuggingFaceRepoSummary,
  HuggingFaceSearchQuery,
  HuggingFaceSearchResult,
} from "../../shared/huggingface";
import {
  assessHuggingFaceArchitecture,
  classifyHuggingFaceFile,
  detectHuggingFaceFormat,
  detectHuggingFaceQuantization,
  isDiffusersShardPath,
  isDiffusersWeightPath,
  isSafeRepoFilePath,
  isUnsupportedHuggingFaceQuantization,
  normalizeHuggingFaceRepoId,
} from "../../shared/huggingface";
import type { ModelArchitecture } from "../../shared/types";
import type { StudioLogger } from "../logger";

export const HUGGINGFACE_API_BASE = "https://huggingface.co";
const USER_AGENT = "KireaStudio/1.0.4 (Windows Desktop)";
const MAX_TEXT_BYTES = 512 * 1024;
const MAX_SAFETENSORS_HEADER_BYTES = 16 * 1024 * 1024;

interface RawSibling {
  rfilename?: string;
  size?: number;
  blobId?: string | null;
  lfs?: { oid?: string | null; size?: number | null } | null;
}

interface RawModel {
  id?: string;
  modelId?: string;
  author?: string | null;
  downloads?: number | null;
  likes?: number | null;
  pipeline_tag?: string | null;
  tags?: string[] | null;
  lastModified?: string | null;
  gated?: boolean | string | null;
  private?: boolean | null;
  cardData?: Record<string, unknown> | null;
  config?: Record<string, unknown> | null;
  siblings?: RawSibling[] | null;
  sha?: string | null;
}

export interface HuggingFaceClientOptions {
  getToken: () => string | null;
  fetcher?: typeof fetch;
  logger?: StudioLogger;
}

export interface SafetensorsProbe {
  ok: boolean;
  reason: string | null;
  tensorCount: number;
  dtypes: Record<string, number>;
  hasKrea2Signature: boolean;
  hasWanSignature: boolean;
  hasLtxSignature: boolean;
  /**
   * ComfyUI-native diffusion weights use the `model.diffusion_model.` prefix.
   * Raw Diffusers transformers use bare `blocks.*` / `transformer_blocks.*`.
   */
  nativeFormat: "comfyui" | "diffusers" | "unknown";
  metadata: Record<string, string> | null;
}

function hfResolveUrl(repoId: string, revision: string, filePath: string): string {
  const encodedPath = filePath
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `${HUGGINGFACE_API_BASE}/${repoId}/resolve/${encodeURIComponent(
    revision
  )}/${encodedPath}`;
}

function sanitizeErrorDetail(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 240);
}

async function readErrorDetail(response: Response): Promise<string | null> {
  try {
    const text = (await response.text()).trim();
    if (!text) return null;
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const message = parsed.error ?? parsed.message;
      if (typeof message === "string" && message.trim()) {
        return sanitizeErrorDetail(message);
      }
    } catch {
      // fall through
    }
    return sanitizeErrorDetail(text);
  } catch {
    return null;
  }
}

function normalizeGated(value: RawModel["gated"]): "auto" | "manual" | false {
  if (value === "auto" || value === "manual") return value;
  return false;
}

function extractLicense(raw: RawModel): string | null {
  const cardLicense = raw.cardData?.license;
  if (typeof cardLicense === "string" && cardLicense.trim()) return cardLicense.trim();
  const tag = (raw.tags ?? []).find((entry) => entry.toLowerCase().startsWith("license:"));
  if (tag) return tag.slice("license:".length).trim() || null;
  return null;
}

function stripMarkdown(value: string): string {
  return value
    .replace(/^---[\s\S]*?---\s*/, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;?/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:39|x27);/gi, "'")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_>{}\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractFirstImage(readme: string, repoId: string, revision: string): string | null {
  const markdown = readme.match(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/);
  const html = readme.match(/<img[^>]+src=["']([^"']+)["']/i);
  const candidate = markdown?.[1] ?? html?.[1];
  if (!candidate) return null;
  if (/^https?:\/\//i.test(candidate)) return candidate;
  if (candidate.startsWith("data:")) return null;
  const clean = candidate.replace(/^\.\//, "");
  const encoded = clean
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `${HUGGINGFACE_API_BASE}/${repoId}/resolve/${encodeURIComponent(revision)}/${encoded}`;
}

function isMainWeight(file: HuggingFaceFile): boolean {
  return file.selectable && (file.kind === "checkpoint" || file.kind === "diffusion_model");
}

function pickPrimaryFile(files: HuggingFaceFile[], repoId: string): HuggingFaceFile | null {
  const weights = files.filter(isMainWeight);
  if (weights.length === 0) return null;
  const id = repoId.toLowerCase();
  const isWan = id.includes("wan") || weights.some((file) => /wan/i.test(file.path));
  const isLtx = id.includes("ltx") || weights.some((file) => /ltx/i.test(file.path));

  const scored = weights
    .map((file) => {
      const value = file.path.toLowerCase();
      let score = 0;
      if (isDiffusersWeightPath(file.path)) score -= 100;
      if (isWan) {
        if (/1\.3b|1_3b|1-3b|1300m/.test(value)) score += 100;
        if (/t2v|text[-_]?to[-_]?video/.test(value)) score += 60;
        if (/fp16|bf16/.test(value)) score += 10;
        if (/i2v|image[-_]?to[-_]?video/.test(value)) score -= 120;
        if (/\bfun\b|vace|control|flf2v|magref|inpaint|\binp\b|infinitetalk|animate|s2v/.test(value)) {
          score -= 120;
        }
        if (/14b|720p/.test(value)) score -= 120;
      } else if (isLtx) {
        if (/2b|2-b|2000m/.test(value)) score += 100;
        if (/0\.9\.[5-9]/.test(value)) score += 10;
        if (/13b|14b|upscaler|lora/.test(value)) score -= 120;
      }
      return { file, score };
    })
    .sort((a, b) => b.score - a.score || b.file.sizeBytes - a.file.sizeBytes);

  return scored[0]?.file ?? null;
}

function formatUnsupportedReason(file: HuggingFaceFile | null): string | null {
  if (file && isDiffusersWeightPath(file.path)) {
    return "This repository exposes Diffusers-format weights (a transformer/diffusion_pytorch_model file or a sharded pipeline). Kirea's UNETLoader and CheckpointLoaderSimple require a single ComfyUI-format safetensors/checkpoint file, so it cannot be loaded as-is.";
  }
  if (file && isUnsupportedHuggingFaceQuantization(file.quantization)) {
    return `This file is quantized as ${file.quantization}. Kirea's shipped loaders use safetensors FP16/BF16/FP8, not GGUF or INT quantized checkpoints, so it cannot be run without a custom loader.`;
  }
  return null;
}

function mapFiles(raw: RawModel): HuggingFaceFile[] {
  const siblings = Array.isArray(raw.siblings) ? raw.siblings : [];
  const files: HuggingFaceFile[] = [];
  for (const sibling of siblings) {
    const filePath = (sibling.rfilename ?? "").trim();
    if (!filePath || !isSafeRepoFilePath(filePath)) continue;
    const diffusersShard = isDiffusersShardPath(filePath);
    let kind: HuggingFaceFileKind = classifyHuggingFaceFile(filePath);
    if (
      !diffusersShard &&
      kind === "other" &&
      /\.(safetensors|gguf|ckpt|pt|pth|bin)$/i.test(filePath)
    ) {
      kind = /wan|unet|diffusion/i.test(filePath) ? "diffusion_model" : "checkpoint";
    }
    if (diffusersShard) kind = "other";
    const isWeight =
      !diffusersShard &&
      (kind === "diffusion_model" ||
        kind === "checkpoint" ||
        kind === "vae" ||
        kind === "text_encoder" ||
        kind === "lora");
    if (
      kind === "other" &&
      !diffusersShard &&
      !/\.(safetensors|gguf|ckpt|pt|pth|bin)$/i.test(filePath)
    ) {
      // Ignore images/docs/tokenizers entirely; configs are kept for context.
      continue;
    }
    const sha256 =
      typeof sibling.lfs?.oid === "string" && /^[a-f0-9]{64}$/i.test(sibling.lfs.oid)
        ? sibling.lfs.oid.toLowerCase()
        : null;
    const sizeBytes = Math.max(
      0,
      Number(sibling.size ?? sibling.lfs?.size ?? 0) || 0
    );
    files.push({
      path: filePath,
      sizeBytes,
      sha256,
      format: detectHuggingFaceFormat(filePath),
      quantization: detectHuggingFaceQuantization(filePath),
      kind,
      selectable: isWeight,
      primary: false,
    });
  }

  const primary = pickPrimaryFile(files, raw.id ?? raw.modelId ?? "");
  if (primary) primary.primary = true;
  return files.sort((a, b) => {
    if (a.primary !== b.primary) return a.primary ? -1 : 1;
    if (a.selectable !== b.selectable) return a.selectable ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
}

function mapSummary(raw: RawModel): HuggingFaceRepoSummary | null {
  const id = (raw.id ?? raw.modelId ?? "").trim();
  if (!id) return null;
  const tags = Array.isArray(raw.tags)
    ? raw.tags.filter((tag): tag is string => typeof tag === "string")
    : [];
  const files = mapFiles(raw);
  const primary = files.find((file) => file.primary) ?? null;
  const assessment = assessHuggingFaceArchitecture({
    repoId: id,
    pipelineTag: raw.pipeline_tag ?? null,
    tags,
    filePath: primary?.path ?? null,
    config: raw.config ?? null,
  });
  const formatReason = formatUnsupportedReason(primary);
  const diffusersOnly =
    !primary && files.some((file) => isDiffusersWeightPath(file.path));
  const shardedOnly =
    diffusersOnly &&
    files.some((file) => isDiffusersShardPath(file.path));
  const finalReason = formatReason
    ? formatReason
    : shardedOnly
      ? "This repository contains only sharded Diffusers-format weights. Kirea's ComfyUI loaders require one self-contained single-file checkpoint; choose a ComfyUI repackaged repository."
      : diffusersOnly
        ? "This repository contains Diffusers-format weights but no standalone ComfyUI single-file checkpoint that Kirea can load."
        : assessment.reason;
  return {
    id,
    author: (raw.author ?? id.split("/")[0] ?? null) || null,
    downloads: Math.max(0, Number(raw.downloads ?? 0) || 0),
    likes: Math.max(0, Number(raw.likes ?? 0) || 0),
    pipelineTag: (raw.pipeline_tag ?? "").trim() || null,
    tags: tags.slice(0, 24),
    lastModified: raw.lastModified ?? null,
    gated: normalizeGated(raw.gated),
    private: raw.private === true,
    license: extractLicense(raw),
    thumbnailUrl: null,
    architecture: assessment.architecture,
    architectureLabel: assessment.label,
    runnable: assessment.runnable && !formatReason && !shardedOnly && !diffusersOnly,
    supportReason: finalReason,
    workflowId:
      formatReason || shardedOnly || diffusersOnly ? null : assessment.workflowId,
  };
}

export class HuggingFaceClient {
  constructor(private readonly options: HuggingFaceClientOptions) {}

  private get fetcher(): typeof fetch {
    return this.options.fetcher ?? fetch;
  }

  private authHeaders(): Record<string, string> {
    const token = this.options.getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  private async requestJson(
    url: string,
    timeoutMs = 15000
  ): Promise<{ response: Response; data: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetcher(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
          ...this.authHeaders(),
        },
        redirect: "follow",
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        const detail = sanitizeErrorDetail(text);
        throw new Error(
          `Hugging Face request failed (HTTP ${response.status})${
            detail ? `: ${detail}` : "."
          }`
        );
      }
      return { response, data: text ? (JSON.parse(text) as unknown) : null };
    } finally {
      clearTimeout(timer);
    }
  }

  async searchModels(query: HuggingFaceSearchQuery): Promise<HuggingFaceSearchResult> {
    const limit = Math.min(50, Math.max(1, Math.floor(query.limit ?? 24)));
    const params = new URLSearchParams();
    let search = (query.query ?? "").trim();
    if (!search && query.architecture === "wan_video") search = "wan";
    if (!search && query.architecture === "ltx_video") search = "ltx video";
    if (search) params.set("search", search);
    if (query.task && query.task !== "all") params.set("filter", query.task);
    params.set("sort", query.sort ?? "downloads");
    params.set("direction", "-1");
    params.set("limit", String(limit));
    params.set("full", "true");
    if (query.cursor) params.set("cursor", query.cursor);

    const { response, data } = await this.requestJson(
      `${HUGGINGFACE_API_BASE}/api/models?${params.toString()}`
    );
    const items = Array.isArray(data) ? (data as RawModel[]) : [];
    let mapped = items
      .map(mapSummary)
      .filter((item): item is HuggingFaceRepoSummary => item !== null);

    if (query.architecture && query.architecture !== "all") {
      mapped = mapped.filter((item) =>
        query.architecture === "other"
          ? item.architecture === "unknown"
          : item.architecture === query.architecture
      );
    }

    return {
      items: mapped,
      nextCursor: parseNextCursor(response.headers.get("link")),
    };
  }

  async getRepoDetails(repoIdRaw: string, revisionRaw?: string): Promise<HuggingFaceRepoDetails> {
    const repoId = normalizeHuggingFaceRepoId(repoIdRaw);
    if (!repoId) {
      throw new Error("Enter a Hugging Face repository ID or URL such as 'Wan-AI/Wan2.1-T2V-1.3B'.");
    }
    const revision = normalizeRevision(revisionRaw);
    const { data } = await this.requestJson(
      `${HUGGINGFACE_API_BASE}/api/models/${repoId}?blobs=true`,
      20000
    );
    if (!data || typeof data !== "object") {
      throw new Error(`Hugging Face returned no metadata for '${repoId}'.`);
    }
    const raw = data as RawModel;
    raw.id = raw.id ?? repoId;
    const summary = mapSummary(raw);
    if (!summary) throw new Error(`Hugging Face returned an invalid repository for '${repoId}'.`);

    const files = mapFiles(raw);
    const primary = files.find((file) => file.primary) ?? null;
    const assessment = assessHuggingFaceArchitecture({
      repoId,
      pipelineTag: summary.pipelineTag,
      tags: summary.tags,
      filePath: primary?.path ?? null,
      config: raw.config ?? null,
    });
    const formatReason = formatUnsupportedReason(primary);
    const diffusersOnly =
      !primary && files.some((file) => isDiffusersWeightPath(file.path));
    const formatReasonFinal =
      formatReason ??
      (diffusersOnly
        ? "This repository contains only Diffusers-format weights and no standalone ComfyUI single-file checkpoint. Kirea's loaders cannot assemble a sharded Diffusers pipeline; use a ComfyUI repackaged repository instead."
        : null);

    const [readme, config, modelIndex] = await Promise.all([
      this.readTextFile(repoId, revision, "README.md"),
      this.readTextFile(repoId, revision, "config.json"),
      this.readTextFile(repoId, revision, "model_index.json"),
    ]);

    return {
      ...summary,
      architecture: assessment.architecture,
      architectureLabel: assessment.label,
      runnable: assessment.runnable && !formatReasonFinal,
      supportReason: formatReasonFinal ?? assessment.reason,
      workflowId: formatReasonFinal ? null : assessment.workflowId,
      revision,
      description: readme ? stripMarkdown(readme).slice(0, 6000) : null,
      cardData: raw.cardData ?? null,
      config: parseJsonObject(config),
      modelIndex: parseJsonObject(modelIndex),
      files,
      thumbnailUrl: readme ? extractFirstImage(readme, repoId, revision) : null,
      requiredComponents: [],
    };
  }

  async readTextFile(
    repoId: string,
    revision: string,
    filePath: string
  ): Promise<string | null> {
    if (!isSafeRepoFilePath(filePath)) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await this.fetcher(hfResolveUrl(repoId, revision, filePath), {
        headers: {
          "User-Agent": USER_AGENT,
          ...this.authHeaders(),
        },
        redirect: "follow",
        signal: controller.signal,
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return null;
      }
      const length = Number(response.headers.get("content-length") ?? "0");
      if (length > MAX_TEXT_BYTES) {
        await response.body?.cancel().catch(() => undefined);
        return null;
      }
      const text = await response.text();
      return text.length > MAX_TEXT_BYTES ? text.slice(0, MAX_TEXT_BYTES) : text;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Reads only the safetensors header with HTTP Range requests. If a server
   * ignores Range and starts the full weight file, the body is cancelled
   * immediately instead of being downloaded.
   */
  async probeSafetensors(
    repoId: string,
    revision: string,
    filePath: string
  ): Promise<SafetensorsProbe> {
    const empty: SafetensorsProbe = {
      ok: false,
      reason: null,
      tensorCount: 0,
      dtypes: {},
      hasKrea2Signature: false,
      hasWanSignature: false,
      hasLtxSignature: false,
      nativeFormat: "unknown",
      metadata: null,
    };
    if (!isSafeRepoFilePath(filePath) || !/\.safetensors$/i.test(filePath)) {
      return { ...empty, reason: "Not a safetensors file." };
    }
    const url = hfResolveUrl(repoId, revision, filePath);
    const first = await this.fetchRange(url, "bytes=0-7");
    if (!first.ok) return { ...empty, reason: first.reason };
    if (first.bytes.length !== 8) {
      return { ...empty, reason: "Safetensors header is too short." };
    }
    const headerLength = Number(first.bytes.readBigUInt64LE(0));
    if (
      !Number.isFinite(headerLength) ||
      headerLength <= 1 ||
      headerLength > MAX_SAFETENSORS_HEADER_BYTES
    ) {
      return { ...empty, reason: "Safetensors header length is invalid or too large." };
    }
    const header = await this.fetchRange(url, `bytes=8-${8 + headerLength - 1}`);
    if (!header.ok) return { ...empty, reason: header.reason };
    if (header.bytes.length !== headerLength) {
      return { ...empty, reason: "Safetensors header was truncated by the server." };
    }

    try {
      const parsed = JSON.parse(header.bytes.toString("utf8")) as Record<string, unknown>;
      const dtypes: Record<string, number> = {};
      let tensorCount = 0;
      const keys: string[] = [];
      for (const [key, value] of Object.entries(parsed)) {
        if (key === "__metadata__") continue;
        tensorCount += 1;
        keys.push(key);
        const dtype = (value as { dtype?: unknown } | null)?.dtype;
        if (typeof dtype === "string") {
          dtypes[dtype] = (dtypes[dtype] ?? 0) + 1;
        }
      }
      const keyBlob = keys.join(" ").toLowerCase();
      const prefixed = keys.filter((key) => key.startsWith("model.diffusion_model.")).length;
      const bare = keys.filter((key) =>
        /^(blocks|transformer_blocks|single_transformer_blocks|double_blocks)\./.test(key)
      ).length;
      const nativeFormat: SafetensorsProbe["nativeFormat"] =
        prefixed > 0 && prefixed >= bare ? "comfyui" : bare > 0 ? "diffusers" : "unknown";
      const metadataRaw = parsed.__metadata__;
      const metadata =
        metadataRaw && typeof metadataRaw === "object"
          ? Object.fromEntries(
              Object.entries(metadataRaw as Record<string, unknown>).map(([k, v]) => [
                k,
                String(v),
              ])
            )
          : null;
      return {
        ok: tensorCount > 0,
        reason: tensorCount > 0 ? null : "No tensors found in the header.",
        tensorCount,
        dtypes,
        hasKrea2Signature: keyBlob.includes("txtfusion.projector.weight"),
        hasWanSignature: /blocks\.\d+\.self_attn/.test(keyBlob) && keyBlob.includes("patch_embedding"),
        hasLtxSignature: keyBlob.includes("adaln_single") || keyBlob.includes("caption_projection"),
        nativeFormat,
        metadata,
      };
    } catch {
      return { ...empty, reason: "Safetensors header is not valid JSON." };
    }
  }

  private async fetchRange(
    url: string,
    range: string
  ): Promise<{ ok: true; bytes: Buffer } | { ok: false; reason: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await this.fetcher(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Range: range,
          ...this.authHeaders(),
        },
        redirect: "follow",
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel().catch(() => undefined);
        return {
          ok: false,
          reason:
            response.status === 401
              ? "Hugging Face requires a valid token for this file."
              : "Hugging Face refused access; the repository may be gated or restricted.",
        };
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return { ok: false, reason: `Hugging Face returned HTTP ${response.status}.` };
      }
      const length = Number(response.headers.get("content-length") ?? "0");
      if (response.status !== 206 && length > MAX_SAFETENSORS_HEADER_BYTES) {
        await response.body?.cancel().catch(() => undefined);
        return {
          ok: false,
          reason: "The server ignored the Range request; weights were not downloaded.",
        };
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > MAX_SAFETENSORS_HEADER_BYTES) {
        return {
          ok: false,
          reason: "The server returned more data than the safetensors header allows.",
        };
      }
      return { ok: true, bytes: buffer };
    } catch (err) {
      return {
        ok: false,
        reason: err instanceof Error ? err.message : "Safetensors probe failed.",
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async testConnection(): Promise<HuggingFaceConnectionTest> {
    const token = this.options.getToken();
    if (!token) {
      return {
        ok: true,
        authenticated: false,
        username: null,
        message: "Anonymous browsing works. Add a token for gated repositories.",
      };
    }
    try {
      const { data } = await this.requestJson(`${HUGGINGFACE_API_BASE}/api/whoami-v2`, 12000);
      const record = (data ?? {}) as Record<string, unknown>;
      const username =
        typeof record.name === "string"
          ? record.name
          : typeof record.preferred_username === "string"
            ? record.preferred_username
            : null;
      return {
        ok: true,
        authenticated: true,
        username,
        message: username
          ? `Authenticated as ${username}.`
          : "Token accepted by Hugging Face.",
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Token verification failed.";
      this.options.logger?.warn("huggingface", "Token verification failed");
      return {
        ok: false,
        authenticated: false,
        username: null,
        message: message.includes("401")
          ? "Hugging Face rejected the token (HTTP 401)."
          : message,
      };
    }
  }
}

function normalizeRevision(raw: string | undefined): string {
  const value = (raw ?? "main").trim();
  if (!value) return "main";
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(value)) return "main";
  return value;
}

function parseJsonObject(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseNextCursor(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const next = linkHeader
    .split(",")
    .map((part) => part.trim())
    .find((part) => /rel="?next"?/.test(part));
  if (!next) return null;
  const match = next.match(/[?&]cursor=([^&>]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

/** Exposed for tests and for stable task ids. */
export function huggingFaceFileUrl(
  repoId: string,
  revision: string,
  filePath: string
): string {
  return hfResolveUrl(repoId, revision, filePath);
}
