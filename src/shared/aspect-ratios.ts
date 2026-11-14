import type { ModelArchitecture, PerformanceProfile } from "./types";

export interface AspectRatioPreset {
  id: string;
  label: string;
  ratioW: number;
  ratioH: number;
}

export const ASPECT_RATIOS: AspectRatioPreset[] = [
  { id: "1:1", label: "1:1 Square", ratioW: 1, ratioH: 1 },
  { id: "3:2", label: "3:2 Photo", ratioW: 3, ratioH: 2 },
  { id: "2:3", label: "2:3 Portrait", ratioW: 2, ratioH: 3 },
  { id: "4:3", label: "4:3 Classic", ratioW: 4, ratioH: 3 },
  { id: "3:4", label: "3:4 Editorial", ratioW: 3, ratioH: 4 },
  { id: "16:9", label: "16:9 Cinema", ratioW: 16, ratioH: 9 },
  { id: "9:16", label: "9:16 Vertical", ratioW: 9, ratioH: 16 },
];

const SD15_DIMENSIONS: Record<string, [number, number]> = {
  "1:1": [512, 512],
  "3:2": [768, 512],
  "2:3": [512, 768],
  "4:3": [680, 512],
  "3:4": [512, 680],
  "16:9": [912, 512],
  "9:16": [512, 912],
};

const SDXL_DIMENSIONS: Record<string, [number, number]> = {
  "1:1": [1024, 1024],
  "3:2": [1216, 832],
  "2:3": [832, 1216],
  "4:3": [1152, 896],
  "3:4": [896, 1152],
  "16:9": [1344, 768],
  "9:16": [768, 1344],
};

const SDXL_MEMORY_SAVER_DIMENSIONS: Record<string, [number, number]> = {
  "1:1": [896, 896],
  "3:2": [1088, 704],
  "2:3": [704, 1088],
  "4:3": [1024, 768],
  "3:4": [768, 1024],
  "16:9": [1152, 640],
  "9:16": [640, 1152],
};

const SDXL_QUALITY_DIMENSIONS: Record<string, [number, number]> = {
  "1:1": [1152, 1152],
  "3:2": [1344, 896],
  "2:3": [896, 1344],
  "4:3": [1216, 960],
  "3:4": [960, 1216],
  "16:9": [1472, 832],
  "9:16": [832, 1472],
};

export function snapDimension(value: number, multiple = 8, min = 256, max = 2048): number {
  const clamped = Math.max(min, Math.min(max, Math.round(value)));
  return Math.round(clamped / multiple) * multiple;
}

export const LATENT_UPSCALER_BISLERP = "latent_bislerp";
export const LATENT_UPSCALER_BICUBIC = "latent_bicubic";
export const IMAGE_UPSCALER_LANCZOS = "lanczos";

export function isLatentUpscaler(upscaler: string): boolean {
  return upscaler === LATENT_UPSCALER_BISLERP || upscaler === LATENT_UPSCALER_BICUBIC;
}

export function calculateHiresDimensions(
  baseWidth: number,
  baseHeight: number,
  scale: number,
  dimStep = 8,
  minDim = 256,
  maxDim = 4096
): { width: number; height: number } {
  return {
    width: snapDimension(Math.round(baseWidth * scale), dimStep, minDim, maxDim),
    height: snapDimension(Math.round(baseHeight * scale), dimStep, minDim, maxDim),
  };
}

export function calculateDimensionsForAspect(
  aspectRatioId: string,
  architecture: ModelArchitecture,
  profile: PerformanceProfile
): { width: number; height: number } {
  const isSd15 = architecture === "sd15";
  let table = SDXL_DIMENSIONS;
  if (isSd15) {
    table = SD15_DIMENSIONS;
  } else if (profile === "memory_saver") {
    table = SDXL_MEMORY_SAVER_DIMENSIONS;
  } else if (profile === "quality") {
    table = SDXL_QUALITY_DIMENSIONS;
  }

  const pair = table[aspectRatioId];
  if (pair) {
    return { width: pair[0], height: pair[1] };
  }
  return isSd15 ? { width: 512, height: 512 } : { width: 1024, height: 1024 };
}

export function inferModelArchitecture(filename: string): ModelArchitecture {
  const lower = filename.toLowerCase();
  if (lower.includes("ltxv") || lower.includes("ltx-")) return "ltx_video";
  if (
    lower.includes("z_image") ||
    lower.includes("z-image") ||
    lower.includes("z_turbo") ||
    lower.includes("zturbo") ||
    lower.includes("zimage") ||
    lower.includes("-izt-") ||
    lower.includes("_izt_")
  ) {
    return "z_image";
  }
  if (lower.includes("krea")) return "krea2";
  if (
    /(^|[._\-\s])anima([._\-\s]|$)/.test(lower) ||
    lower.includes("anima_base") ||
    lower.includes("animabase")
  ) {
    return "anima";
  }
  if (
    lower.includes("atomico") ||
    lower.includes("dinamus") ||
    lower.includes("novaanimeam")
  ) {
    return "anima";
  }
  if (
    lower.includes("illustrious") ||
    lower.includes("ilxl") ||
    lower.includes("ixl") ||
    lower.includes("_ilv")
  ) {
    return "illustrious";
  }
  if (lower.includes("pony")) return "pony";
  if (lower.includes("flux") || lower.includes("t5xxl")) return "flux";
  if (
    lower.includes("v1-5") ||
    lower.includes("sd15") ||
    lower.includes("sd1.5") ||
    lower.includes("1.5")
  ) {
    return "sd15";
  }
  if (
    lower.includes("xl") ||
    lower.includes("juggernaut") ||
    lower.includes("prisma") ||
    lower.includes("miraimix") ||
    lower.includes("gemcollection") ||
    lower.includes("stein") ||
    lower.includes("jiko")
  ) {
    return "sdxl";
  }
  return "unknown";
}
