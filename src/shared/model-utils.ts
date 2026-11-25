import type {
  ModelArchitecture,
  ModelRecord,
  ModelMetadata,
  ModelDiscovery,
  ModelSource,
} from "./types";

export const ARCHITECTURE_LABELS: Record<ModelArchitecture, string> = {
  sd15: "SD 1.5",
  sdxl: "SDXL",
  illustrious: "Illustrious",
  pony: "Pony",
  flux: "Flux",
  z_image: "Z-Image Turbo",
  anima: "Anima",
  moss_image: "MOSS-Image",
  krea2: "Krea 2",
  ltx_video: "LTX Video",
  wan_video: "Wan Video",
  unknown: "Unknown",
};

export const ARCHITECTURE_HINTS: Record<ModelArchitecture, string> = {
  sd15: "512–768 px native. LoRAs are only compatible with SD 1.5 checkpoints.",
  sdxl: "1024 px native. SDXL LoRAs share the SDXL family.",
  illustrious: "SDXL-based anime architecture; SDXL-family LoRAs may apply.",
  pony: "SDXL-based; use Pony-tuned LoRAs for best results.",
  flux: "Flux workflow not shipped yet. Label and preview only for now.",
  z_image: "Turbo distilled model. Keep steps low (4–8) with CFG near 1.",
  anima:
    "Split DiT (UNET + Qwen3 text encoder + qwen_image_vae). 1024 px, ~30 steps, CFG 4, euler/simple.",
  moss_image:
    "MOSS-Image split pipeline: diffusion model + Qwen3.5-9B text encoder + FLUX.2 small VAE. 1024 px, 25 steps, CFG 2.5, er_sde/simple.",
  krea2:
    "Krea 2 diffusion model: 1024 px, 4–30 steps, Qwen3-VL-4B text encoder + AE VAE.",
  ltx_video: "Video checkpoint. Not usable in the image generation studio.",
  wan_video: "Wan video diffusion model. Not usable in the image generation studio.",
  unknown: "Architecture could not be inferred from the filename, metadata, or tensor header.",
};

/** Architectures that are labeled but cannot yet be rendered by shipped image workflows. */
export const UNSUPPORTED_GENERATION_ARCHITECTURES: ModelArchitecture[] = [
  "flux",
  "ltx_video",
  "wan_video",
];

const ARCHITECTURE_FAMILY: Record<ModelArchitecture, string> = {
  sd15: "sd15",
  sdxl: "sdxl",
  illustrious: "sdxl",
  pony: "sdxl",
  flux: "flux",
  z_image: "z_image",
  anima: "anima",
  moss_image: "moss_image",
  krea2: "krea2",
  ltx_video: "ltx_video",
  wan_video: "wan_video",
  unknown: "unknown",
};

export interface EffectiveModelInfo {
  name: string;
  description: string;
  architecture: ModelArchitecture;
  baseModel: string | null;
  triggerWords: string[];
  previewPath: string | null;
  hasUserMetadata: boolean;
}

function pickMetadata(model: ModelRecord): ModelMetadata | null {
  return model.metadata ?? null;
}

function pickDiscovery(model: ModelRecord): ModelDiscovery | null {
  return model.discovery ?? null;
}

export function getEffectiveArchitecture(model: ModelRecord): ModelArchitecture {
  const metadata = pickMetadata(model);
  if (metadata?.architectureOverride) return metadata.architectureOverride;
  return model.architecture;
}

/** Turns a checkpoint filename into a readable label without changing its path. */
export function humanizeModelName(raw: string): string {
  const base = raw.replace(/\\/g, "/").split("/").pop() ?? raw;
  // Chained suffixes also cover partially downloaded files (e.g. `.safetensors.part`).
  const withoutExt = base.replace(
    /(?:\.(?:safetensors|ckpt|pt|pth|bin|gguf|part))+$/i,
    ""
  );
  const spaced = withoutExt.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return spaced || withoutExt;
}

export function getModelDisplayName(model: {
  name: string;
  metadata?: { displayName?: string | null } | null;
  discovery?: {
    source?: Pick<ModelSource, "modelName"> | null;
    embeddedTitle?: string | null;
  } | null;
}): string {
  const displayName = model.metadata?.displayName?.trim();
  if (displayName) return displayName;

  const sourceName = model.discovery?.source?.modelName?.trim();
  if (sourceName) return sourceName;

  const embeddedTitle = model.discovery?.embeddedTitle?.trim();
  if (embeddedTitle) {
    const humanized = humanizeModelName(model.name);
    // Embedded titles sometimes carry a typo or drop a version suffix; keep the
    // filename when the two are effectively the same name.
    return isNearlySameModelName(embeddedTitle, humanized) ? humanized : embeddedTitle;
  }

  return humanizeModelName(model.name);
}

function compactModelName(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function isNearlySameModelName(a: string, b: string): boolean {
  const left = compactModelName(a);
  const right = compactModelName(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (Math.abs(left.length - right.length) > 2) return false;
  return editDistanceWithin(left, right, 2);
}

function editDistanceWithin(a: string, b: string, limit: number): boolean {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost
      );
    }
    previous = current;
  }
  return (previous[b.length] ?? limit + 1) <= limit;
}

/** Resolves a checkpoint/LoRA reference stored in a job or draft to its display name. */
export function getModelRefDisplayName(
  models: ModelRecord[],
  ref: string | null | undefined
): string {
  if (!ref) return "";
  const normalized = ref.replace(/\\/g, "/").toLowerCase();
  const baseStem = pathBasename(normalized).replace(
    /\.(?:safetensors|ckpt|pt|pth|bin|gguf|part)$/i,
    ""
  );
  const model = models.find((candidate) => {
    const relative = candidate.relativePath.replace(/\\/g, "/").toLowerCase();
    return (
      relative === normalized ||
      candidate.filePath.replace(/\\/g, "/").toLowerCase() === normalized ||
      candidate.name.toLowerCase() === baseStem
    );
  });
  return model ? getModelDisplayName(model) : humanizeModelName(ref);
}

function pathBasename(raw: string): string {
  return raw.replace(/\\/g, "/").split("/").pop() ?? raw;
}

const GENERIC_EMBEDDED_TITLES = new Set([
  "lora",
  "model",
  "checkpoint",
  "unknown",
  "none",
  "untitled",
  "safetensors",
]);

export function normalizeModelTitle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/<[^>]+>/g, " ")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, "")
    .trim();
  if (!cleaned || cleaned.length > 160) return null;
  const lower = cleaned.toLowerCase();
  if (GENERIC_EMBEDDED_TITLES.has(lower)) return null;
  if (/^epoch(?:[ _-]*\d+)?$/i.test(cleaned)) return null;
  if (/^training[ _-]/i.test(cleaned)) return null;
  if (/^my[ _-]first[ _-]lora/i.test(cleaned)) return null;
  if (/^[0-9a-f]{8,}$/i.test(cleaned) || /^\d+$/.test(cleaned)) return null;
  if (/^copy(?:[ _-]|$)/i.test(cleaned)) return null;
  return cleaned;
}

export function getEffectiveModelInfo(model: ModelRecord): EffectiveModelInfo {
  const metadata = pickMetadata(model);
  const discovery = pickDiscovery(model);
  const hasUserMetadata = Boolean(metadata && metadata.updatedAt);

  const name = getModelDisplayName(model);

  const description =
    (hasUserMetadata ? metadata?.description?.trim() : "") ||
    model.description?.trim() ||
    discovery?.description?.trim() ||
    "";

  const architecture = getEffectiveArchitecture(model);

  const baseModel =
    metadata?.baseModel?.trim() || discovery?.baseModel?.trim() || null;

  const triggerWords =
    metadata && metadata.triggerWords.length > 0
      ? metadata.triggerWords
      : discovery?.triggerWords ?? [];

  const previewPath = resolveEffectivePreviewPath(model);

  return {
    name,
    description,
    architecture,
    baseModel,
    triggerWords,
    previewPath,
    hasUserMetadata,
  };
}

export function resolveEffectivePreviewPath(model: ModelRecord): string | null {
  const metadata = pickMetadata(model);
  const discovery = pickDiscovery(model);
  const mode = metadata?.previewMode ?? "auto";
  if (mode === "none") return null;
  if (mode === "custom") return metadata?.previewPath || null;
  return discovery?.previewPath || metadata?.previewPath || null;
}

export function architectureFamily(
  architecture: ModelArchitecture
): string {
  return ARCHITECTURE_FAMILY[architecture] ?? "unknown";
}

/**
 * Compatibility mirrors the runtime: unknown architectures are treated as
 * compatible (we can only warn when we know better), while known families must
 * match.
 */
export function areArchitecturesCompatible(
  a: ModelArchitecture,
  b: ModelArchitecture
): boolean {
  if (a === "unknown" || b === "unknown") return true;
  return architectureFamily(a) === architectureFamily(b);
}

export function isGenerationSupportedArchitecture(
  architecture: ModelArchitecture
): boolean {
  return !UNSUPPORTED_GENERATION_ARCHITECTURES.includes(architecture);
}

export function architectureBadgeTone(
  architecture: ModelArchitecture
): "neutral" | "accent" | "success" | "warning" | "danger" {
  switch (architecture) {
    case "sdxl":
    case "illustrious":
    case "pony":
    case "krea2":
      return "accent";
    case "sd15":
    case "z_image":
    case "anima":
    case "moss_image":
      return "success";
    case "flux":
      return "warning";
    case "ltx_video":
    case "wan_video":
      return "danger";
    default:
      return "neutral";
  }
}

export type LoraCompatibilityLevel =
  | "compatible"
  | "cross-paired"
  | "incompatible"
  | "unknown";

export interface LoraCompatibility {
  level: LoraCompatibilityLevel;
  compatible: boolean;
  message: string;
}

/**
 * Strict LoRA matrix approved for Kirea:
 * - exact architecture match is always compatible;
 * - sdxl ↔ illustrious is allowed (flagged as cross-paired);
 * - pony is NOT compatible with sdxl/illustrious;
 * - every other cross-architecture combination is incompatible.
 */
export function evaluateLoraCompatibility(
  loraArch: ModelArchitecture,
  baseArch: ModelArchitecture
): LoraCompatibility {
  if (loraArch === "unknown" || baseArch === "unknown") {
    return {
      level: "unknown",
      compatible: false,
      message: "Architecture unknown; missing metadata to verify LoRA compatibility.",
    };
  }
  if (loraArch === baseArch) {
    return { level: "compatible", compatible: true, message: "Exact architecture match." };
  }
  if (
    (loraArch === "sdxl" && baseArch === "illustrious") ||
    (loraArch === "illustrious" && baseArch === "sdxl")
  ) {
    return {
      level: "cross-paired",
      compatible: true,
      message: "SDXL-family cross-pair; usually applies cleanly.",
    };
  }
  return {
    level: "incompatible",
    compatible: false,
    message: `${ARCHITECTURE_LABELS[loraArch]} LoRAs cannot be applied to ${ARCHITECTURE_LABELS[baseArch]}.`,
  };
}

export interface EmbeddingCompatibility {
  level: "compatible" | "cross-paired" | "unknown" | "incompatible";
  compatible: boolean;
  message: string;
}

/**
 * Dedicated Embedding / Textual Inversion compatibility check.
 * Embeddings are architectural token vectors and must strictly match target family.
 */
export function evaluateEmbeddingCompatibility(
  embeddingArch: ModelArchitecture,
  baseArch: ModelArchitecture
): EmbeddingCompatibility {
  if (embeddingArch === "unknown" || baseArch === "unknown") {
    return {
      level: "unknown",
      compatible: false,
      message: "Architecture unknown; missing metadata to verify Embedding compatibility.",
    };
  }
  if (embeddingArch === baseArch) {
    return { level: "compatible", compatible: true, message: "Exact architecture match." };
  }
  if (
    (embeddingArch === "sdxl" && baseArch === "illustrious") ||
    (embeddingArch === "illustrious" && baseArch === "sdxl")
  ) {
    return {
      level: "cross-paired",
      compatible: true,
      message: "SDXL-family compatible embedding; vectors align with SDXL text encoders.",
    };
  }
  return {
    level: "incompatible",
    compatible: false,
    message: `${ARCHITECTURE_LABELS[embeddingArch]} embeddings cannot be used with ${ARCHITECTURE_LABELS[baseArch]} models.`,
  };
}

export const VAE_AUTO = "auto";
export const VAE_EMBEDDED = "embedded";

const AUTO_VAE_CANDIDATES: Partial<Record<ModelArchitecture, string[]>> = {
  sdxl: ["sdxl_vae_fp16fix", "sdxl_vae", "sdxl-vae"],
  illustrious: ["sdxl_vae_fp16fix", "sdxl_vae", "sdxl-vae"],
  pony: ["sdxl_vae_fp16fix", "sdxl_vae", "sdxl-vae"],
  sd15: ["vae-ft-mse-840000-ema-pruned", "vae-ft-mse", "kl-f8-anime2", "blessed2"],
  anima: ["qwen_image_vae"],
  z_image: ["ae.safetensors"],
  moss_image: ["flux2-vae_small", "flux2_vae_small", "flux2-vae"],
  flux: ["ae.safetensors"],
  krea2: ["ae.safetensors"],
};

type VaeLookupModel = Pick<ModelRecord, "name" | "relativePath">;

function modelBasename(model: VaeLookupModel): string {
  const rel = model.relativePath.replace(/\\/g, "/");
  return (rel.split("/").pop() ?? model.name).toLowerCase();
}

/** Resolves the recommended VAE installed in the vault for an architecture. */
export function resolveAutoVaeName(
  architecture: ModelArchitecture,
  vaeModels: VaeLookupModel[]
): string | null {
  const candidates = AUTO_VAE_CANDIDATES[architecture];
  if (!candidates) return null;
  for (const candidate of candidates) {
    const hit = vaeModels.find((vae) => {
      const base = modelBasename(vae);
      const stem = base.replace(/\.[^.]+$/, "");
      return (
        base === candidate ||
        stem === candidate ||
        base === `${candidate}.safetensors` ||
        base.includes(candidate)
      );
    });
    if (hit) return hit.relativePath;
  }
  return null;
}

export function isVaeCompatibleWithArchitecture(
  vaeArch: ModelArchitecture,
  baseArch: ModelArchitecture
): boolean {
  if (vaeArch === "unknown" || baseArch === "unknown") return true;
  if (vaeArch === baseArch) return true;
  // Flux-family models (Flux, Z-Image, Krea 2) share the AE autoencoder, which
  // the scanner labels "flux".
  if (
    (vaeArch === "flux" || vaeArch === "z_image" || vaeArch === "krea2") &&
    (baseArch === "flux" || baseArch === "z_image" || baseArch === "krea2")
  ) {
    return true;
  }
  return (
    (vaeArch === "sdxl" || vaeArch === "illustrious" || vaeArch === "pony") &&
    (baseArch === "sdxl" || baseArch === "illustrious" || baseArch === "pony")
  );
}

export interface UpscalePresetDefinition {
  id: "anime_crisp" | "universal_ultrasharp" | "smooth_illustration";
  label: string;
  description: string;
  upscalerFile: string;
  creativity: number;
}

export const UPSCALE_PRESETS: UpscalePresetDefinition[] = [
  {
    id: "anime_crisp",
    label: "Anime Crisp",
    description: "4× AnimeSharp, subtle refiner pass. Best for clean line art and cel shading.",
    upscalerFile: "4x-AnimeSharp.pth",
    creativity: 0.28,
  },
  {
    id: "universal_ultrasharp",
    label: "Universal UltraSharp",
    description: "4× UltraSharp, balanced refiner pass. Best all-round photo and illustration result.",
    upscalerFile: "4x-UltraSharp.pth",
    creativity: 0.35,
  },
  {
    id: "smooth_illustration",
    label: "Smooth Illustration",
    description: "4× NMKD-Siax, soft refiner pass. Best for painterly gradients and soft shading.",
    upscalerFile: "4x_NMKD-Siax_200k.pth",
    creativity: 0.3,
  },
];

export function findPresetUpscaler(
  presetId: string | undefined,
  upscaleModels: Array<Pick<ModelRecord, "name" | "relativePath">>
): string | null {
  const preset = UPSCALE_PRESETS.find((candidate) => candidate.id === presetId);
  if (!preset) return null;
  const hit = upscaleModels.find((model) => {
    const base = modelBasename(model);
    return base === preset.upscalerFile.toLowerCase() || base.includes(preset.upscalerFile.toLowerCase().replace(/\.pth$/, ""));
  });
  return hit?.relativePath ?? null;
}
