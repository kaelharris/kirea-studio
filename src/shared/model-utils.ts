import type {
  ModelArchitecture,
  ModelRecord,
  ModelMetadata,
  ModelDiscovery,
} from "./types";

export const ARCHITECTURE_LABELS: Record<ModelArchitecture, string> = {
  sd15: "SD 1.5",
  sdxl: "SDXL",
  illustrious: "Illustrious",
  pony: "Pony",
  flux: "Flux",
  z_image: "Z-Image Turbo",
  anima: "Anima",
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
  krea2: "Krea 2 diffusion model. Label and preview only; generation workflow is not shipped yet.",
  ltx_video: "Video checkpoint. Not usable in the image generation studio.",
  wan_video: "Wan video diffusion model. Not usable in the image generation studio.",
  unknown: "Architecture could not be inferred from the filename, metadata, or tensor header.",
};

/** Architectures that are labeled but cannot yet be rendered by shipped image workflows. */
export const UNSUPPORTED_GENERATION_ARCHITECTURES: ModelArchitecture[] = [
  "flux",
  "krea2",
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

export function getEffectiveModelInfo(model: ModelRecord): EffectiveModelInfo {
  const metadata = pickMetadata(model);
  const discovery = pickDiscovery(model);
  const hasUserMetadata = Boolean(metadata && metadata.updatedAt);

  const displayName = metadata?.displayName?.trim();
  const name = displayName || model.name;

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
      return "accent";
    case "sd15":
    case "z_image":
    case "anima":
      return "success";
    case "flux":
    case "krea2":
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
      compatible: true,
      message: "Architecture unknown; compatibility could not be verified.",
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

export const VAE_AUTO = "auto";
export const VAE_EMBEDDED = "embedded";

const AUTO_VAE_CANDIDATES: Partial<Record<ModelArchitecture, string[]>> = {
  sdxl: ["sdxl_vae_fp16fix", "sdxl_vae", "sdxl-vae"],
  illustrious: ["sdxl_vae_fp16fix", "sdxl_vae", "sdxl-vae"],
  pony: ["sdxl_vae_fp16fix", "sdxl_vae", "sdxl-vae"],
  sd15: ["vae-ft-mse-840000-ema-pruned", "vae-ft-mse", "kl-f8-anime2", "blessed2"],
  anima: ["qwen_image_vae"],
  z_image: ["ae.safetensors"],
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
