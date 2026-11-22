import type { ModelArchitecture, PerformanceProfile, WorkflowTemplate } from "./types";

export interface AspectRatioPreset {
  id: string;
  label: string;
  ratioW: number;
  ratioH: number;
}

export const CUSTOM_ASPECT_ID = "custom";

export const ASPECT_RATIOS: AspectRatioPreset[] = [
  { id: "1:1", label: "1:1 Square", ratioW: 1, ratioH: 1 },
  { id: "4:3", label: "4:3 Classic", ratioW: 4, ratioH: 3 },
  { id: "3:4", label: "3:4 Editorial", ratioW: 3, ratioH: 4 },
  { id: "3:2", label: "3:2 Photo", ratioW: 3, ratioH: 2 },
  { id: "2:3", label: "2:3 Portrait", ratioW: 2, ratioH: 3 },
  { id: "16:9", label: "16:9 Cinema", ratioW: 16, ratioH: 9 },
  { id: "9:16", label: "9:16 Vertical", ratioW: 9, ratioH: 16 },
  { id: "21:9", label: "21:9 Scope", ratioW: 21, ratioH: 9 },
];

export interface DimensionBounds {
  minDim: number;
  maxDim: number;
  dimStep: number;
}

export interface DimensionResolution {
  width: number;
  height: number;
  requestedRatio: number;
  effectiveRatio: number;
  deviation: number;
  clamped: boolean;
  snapped: boolean;
  notes: string[];
}

const SD15_DIMENSIONS: Record<string, [number, number]> = {
  "1:1": [512, 512],
  "4:3": [680, 512],
  "3:4": [512, 680],
  "3:2": [768, 512],
  "2:3": [512, 768],
  "16:9": [912, 512],
  "9:16": [512, 912],
  "21:9": [896, 384],
};

const SDXL_DIMENSIONS: Record<string, [number, number]> = {
  "1:1": [1024, 1024],
  "4:3": [1152, 896],
  "3:4": [896, 1152],
  "3:2": [1216, 832],
  "2:3": [832, 1216],
  "16:9": [1344, 768],
  "9:16": [768, 1344],
  "21:9": [1344, 576],
};

const SDXL_MEMORY_SAVER_DIMENSIONS: Record<string, [number, number]> = {
  "1:1": [896, 896],
  "4:3": [1024, 768],
  "3:4": [768, 1024],
  "3:2": [1088, 704],
  "2:3": [704, 1088],
  "16:9": [1152, 640],
  "9:16": [640, 1152],
  "21:9": [1152, 496],
};

const SDXL_QUALITY_DIMENSIONS: Record<string, [number, number]> = {
  "1:1": [1152, 1152],
  "4:3": [1216, 960],
  "3:4": [960, 1216],
  "3:2": [1344, 896],
  "2:3": [896, 1344],
  "16:9": [1472, 832],
  "9:16": [832, 1472],
  "21:9": [1536, 656],
};

export function snapDimension(value: number, multiple = 8, min = 256, max = 2048): number {
  const safeMultiple = Math.max(1, Math.round(multiple));
  const safeMin = Math.min(min, max);
  const safeMax = Math.max(min, max);
  // Clamp before snapping so an off-grid minimum (e.g. 257) cannot be
  // rounded down below the workflow's own lower bound.
  const clamped = Math.max(safeMin, Math.min(safeMax, Math.round(value)));
  const snapped = Math.round(clamped / safeMultiple) * safeMultiple;
  return Math.min(safeMax, Math.max(safeMin, snapped));
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

export function dimensionBoundsFromWorkflow(
  workflow:
    | { minDim: number; maxDim: number; dimStep: number }
    | null
    | undefined
): DimensionBounds | undefined {
  if (!workflow) return undefined;
  return {
    minDim: workflow.minDim,
    maxDim: workflow.maxDim,
    dimStep: workflow.dimStep,
  };
}

function getAspectPreset(aspectRatioId: string): AspectRatioPreset | null {
  return ASPECT_RATIOS.find((preset) => preset.id === aspectRatioId) ?? null;
}

function getDimensionTable(
  architecture: ModelArchitecture,
  profile: PerformanceProfile
): Record<string, [number, number]> {
  if (architecture === "sd15") return SD15_DIMENSIONS;
  if (profile === "memory_saver") return SDXL_MEMORY_SAVER_DIMENSIONS;
  if (profile === "quality") return SDXL_QUALITY_DIMENSIONS;
  return SDXL_DIMENSIONS;
}

function getBaseSquare(architecture: ModelArchitecture, profile: PerformanceProfile): number {
  if (architecture === "sd15") return 512;
  if (profile === "memory_saver") return 896;
  if (profile === "quality") return 1152;
  return 1024;
}

function ratioDeviation(width: number, height: number, requestedRatio: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 0;
  }
  if (requestedRatio <= 0) return 0;
  return Math.abs(width / height - requestedRatio) / requestedRatio;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

/**
 * Reduces a rendered size to its exact aspect label (e.g. 1344×768 → 7:4),
 * which is what the user will actually get after workflow snapping.
 */
export function formatAspectRatio(width: number, height: number): string {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return "—";
  }
  const divisor = gcd(width, height);
  return `${Math.round(width) / divisor}:${Math.round(height) / divisor}`;
}

/**
 * Finds the workflow-valid width/height pair that stays closest to the
 * requested ratio while respecting min/max/step. Returns null when the
 * bounds cannot express the ratio at all (e.g. a 21:9 frame inside a
 * narrow 1024–1536 window).
 */
function fitRatioToBounds(
  ratio: number,
  preferredLongSide: number,
  bounds: DimensionBounds
): { width: number; height: number } | null {
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  const step = Math.max(1, Math.round(bounds.dimStep));
  const min = Math.min(bounds.minDim, bounds.maxDim);
  const max = Math.max(bounds.minDim, bounds.maxDim);
  const start = Math.max(step, Math.ceil(min / step) * step);

  let best: { width: number; height: number; error: number; distance: number } | null = null;
  for (let long = start; long <= max; long += step) {
    const short = Math.round((ratio >= 1 ? long / ratio : long * ratio) / step) * step;
    const width = ratio >= 1 ? long : short;
    const height = ratio >= 1 ? short : long;
    if (width < min || height < min || width > max || height > max) continue;

    const error = ratioDeviation(width, height, ratio);
    const distance = Math.abs(long - preferredLongSide);
    if (
      !best ||
      error < best.error - 1e-9 ||
      (Math.abs(error - best.error) <= 1e-9 && distance < best.distance)
    ) {
      best = { width, height, error, distance };
    }
  }
  return best ? { width: best.width, height: best.height } : null;
}

function buildResolution(
  width: number,
  height: number,
  requestedRatio: number,
  notes: string[],
  clamped: boolean,
  snapped: boolean
): DimensionResolution {
  return {
    width,
    height,
    requestedRatio,
    effectiveRatio: height > 0 ? width / height : 0,
    deviation: ratioDeviation(width, height, requestedRatio),
    clamped,
    snapped,
    notes,
  };
}

/**
 * Resolves a named aspect ratio to concrete dimensions for a model family and
 * performance profile, optionally constrained by the selected workflow's
 * min/max/step. Curated model-native buckets are preserved when they fit;
 * otherwise the closest valid pair is computed and explained in `notes`.
 */
export function resolveDimensionsForAspect(
  aspectRatioId: string,
  architecture: ModelArchitecture,
  profile: PerformanceProfile,
  bounds?: DimensionBounds
): DimensionResolution {
  const preset = getAspectPreset(aspectRatioId);
  const requestedRatio = preset ? preset.ratioW / preset.ratioH : 1;
  const notes: string[] = [];

  if (!preset) {
    const base = getBaseSquare(architecture, profile);
    const fallback = bounds
      ? fitRatioToBounds(1, base, bounds)
      : { width: base, height: base };
    return buildResolution(
      fallback?.width ?? base,
      fallback?.height ?? base,
      1,
      [],
      false,
      false
    );
  }

  if (!bounds) {
    const pair = getDimensionTable(architecture, profile)[aspectRatioId];
    if (pair) {
      return buildResolution(pair[0], pair[1], requestedRatio, [], false, false);
    }
  }

  const tablePair = getDimensionTable(architecture, profile)[aspectRatioId];
  const preferred = tablePair
    ? { width: tablePair[0], height: tablePair[1] }
    : (() => {
        const base = getBaseSquare(architecture, profile);
        return requestedRatio >= 1
          ? { width: base, height: Math.round(base / requestedRatio) }
          : { width: Math.round(base * requestedRatio), height: base };
      })();
  const preferredLongSide = Math.max(preferred.width, preferred.height);

  if (!bounds) {
    return buildResolution(preferred.width, preferred.height, requestedRatio, [], false, false);
  }

  const step = Math.max(1, Math.round(bounds.dimStep));
  const min = Math.min(bounds.minDim, bounds.maxDim);
  const max = Math.max(bounds.minDim, bounds.maxDim);
  const outOfRange =
    preferred.width < min ||
    preferred.height < min ||
    preferred.width > max ||
    preferred.height > max;

  if (!outOfRange) {
    const width = snapDimension(preferred.width, step, min, max);
    const height = snapDimension(preferred.height, step, min, max);
    const snapped = width !== preferred.width || height !== preferred.height;
    if (snapped && ratioDeviation(width, height, requestedRatio) > 0.02) {
      const fitted = fitRatioToBounds(requestedRatio, preferredLongSide, bounds);
      if (fitted) {
        notes.push(
          `${aspectRatioId} at this workflow's ${step}px grid resolves to ${fitted.width}×${fitted.height} (effective ${formatAspectRatio(fitted.width, fitted.height)}).`
        );
        return buildResolution(
          fitted.width,
          fitted.height,
          requestedRatio,
          notes,
          false,
          true
        );
      }
    }
    return buildResolution(width, height, requestedRatio, notes, false, snapped);
  }

  const fitted = fitRatioToBounds(requestedRatio, preferredLongSide, bounds);
  if (fitted) {
    notes.push(
      `The model-native ${aspectRatioId} bucket (${preferred.width}×${preferred.height}) falls outside this workflow's ${min}–${max}px range; using ${fitted.width}×${fitted.height} instead.`
    );
    return buildResolution(fitted.width, fitted.height, requestedRatio, notes, true, true);
  }

  const width = snapDimension(preferred.width, step, min, max);
  const height = snapDimension(preferred.height, step, min, max);
  notes.push(
    `This workflow's ${min}–${max}px range cannot represent ${aspectRatioId}. Closest valid frame is ${width}×${height} (${formatAspectRatio(width, height)}); widen the workflow limits or pick a nearer ratio.`
  );
  return buildResolution(width, height, requestedRatio, notes, true, true);
}

/**
 * Validates manually entered dimensions against the workflow's grid. Snaps
 * and clamps instead of silently accepting arbitrary values, and reports what
 * changed so the UI can explain the effective frame.
 */
export function resolveCustomDimensions(
  width: number,
  height: number,
  bounds?: DimensionBounds
): DimensionResolution {
  const b = bounds ?? { minDim: 256, maxDim: 4096, dimStep: 8 };
  const step = Math.max(1, Math.round(b.dimStep));
  const min = Math.min(b.minDim, b.maxDim);
  const max = Math.max(b.minDim, b.maxDim);
  const rawWidth = Number.isFinite(width) && width > 0 ? Math.round(width) : min;
  const rawHeight = Number.isFinite(height) && height > 0 ? Math.round(height) : min;
  const requestedRatio = rawWidth / rawHeight;

  const widthOut = rawWidth < min || rawWidth > max;
  const heightOut = rawHeight < min || rawHeight > max;
  const clamped = widthOut || heightOut;
  const snapped =
    rawWidth % step !== 0 || rawHeight % step !== 0;

  const resolvedWidth = snapDimension(rawWidth, step, min, max);
  const resolvedHeight = snapDimension(rawHeight, step, min, max);

  const notes: string[] = [];
  if (clamped) {
    notes.push(
      `Dimensions are limited to ${min}–${max}px for this workflow; using ${resolvedWidth}×${resolvedHeight}.`
    );
  }
  if (snapped) {
    notes.push(`Dimensions snap to ${step}px multiples for this workflow.`);
  }
  return buildResolution(
    resolvedWidth,
    resolvedHeight,
    requestedRatio,
    notes,
    clamped,
    snapped
  );
}

export interface VideoDimensionResolution extends DimensionResolution {
  /** True when the dimensions come from the workflow's model-validated presets. */
  validated: boolean;
}

/**
 * Resolves an aspect ratio for a video workflow. Model-validated presets are
 * used verbatim; everything else is fitted to the workflow's grid and marked
 * as unvalidated so the UI can warn without hiding the option.
 */
export function resolveVideoDimensions(
  aspectRatioId: string,
  template: Pick<WorkflowTemplate, "minDim" | "maxDim" | "dimStep" | "defaults" | "video">
): VideoDimensionResolution {
  const bounds = dimensionBoundsFromWorkflow(template);
  const spec = template.video;
  const presets = spec?.presets ?? [];
  const curated = presets.find((preset) => preset.id === aspectRatioId);
  if (curated) {
    return {
      ...buildResolution(
        curated.width,
        curated.height,
        curated.width / curated.height,
        [],
        false,
        false
      ),
      validated: true,
    };
  }

  if (aspectRatioId === CUSTOM_ASPECT_ID) {
    return {
      ...resolveCustomDimensions(template.defaults.width, template.defaults.height, bounds),
      validated: false,
    };
  }

  const preset = getAspectPreset(aspectRatioId);
  if (!preset) {
    return {
      ...resolveCustomDimensions(template.defaults.width, template.defaults.height, bounds),
      validated: false,
    };
  }

  const ratio = preset.ratioW / preset.ratioH;
  const preferredLongSide = Math.max(template.defaults.width, template.defaults.height);
  const fitted = bounds ? fitRatioToBounds(ratio, preferredLongSide, bounds) : null;
  const step = Math.max(1, Math.round(template.dimStep));
  const min = Math.min(template.minDim, template.maxDim);
  const max = Math.max(template.minDim, template.maxDim);

  if (!fitted) {
    const width = snapDimension(template.defaults.width, step, min, max);
    const height = snapDimension(template.defaults.height, step, min, max);
    return {
      ...buildResolution(
        width,
        height,
        ratio,
        [
          `This workflow's ${min}–${max}px range cannot represent ${aspectRatioId}. Closest valid frame is ${width}×${height} (${formatAspectRatio(width, height)}).`,
        ],
        true,
        true
      ),
      validated: false,
    };
  }

  const presetSummary = presets.length
    ? presets.map((p) => `${p.width}×${p.height}`).join(", ")
    : "the workflow defaults";
  return {
    ...buildResolution(
      fitted.width,
      fitted.height,
      ratio,
      [
        `${aspectRatioId} resolves to ${fitted.width}×${fitted.height}. This model is validated at ${presetSummary}; other frames are fitted to the ${step}px grid and may reduce quality.`,
      ],
      false,
      true
    ),
    validated: false,
  };
}

/**
 * Compatibility helper used by presets and non-workflow callers. Keeps the
 * curated model-native buckets exactly as they were before workflow-aware
 * resolution was introduced.
 */export function calculateDimensionsForAspect(
  aspectRatioId: string,
  architecture: ModelArchitecture,
  profile: PerformanceProfile
): { width: number; height: number } {
  const table = getDimensionTable(architecture, profile);
  const pair = table[aspectRatioId];
  if (pair) {
    return { width: pair[0], height: pair[1] };
  }
  const base = getBaseSquare(architecture, profile);
  return { width: base, height: base };
}

export function inferModelArchitecture(filename: string): ModelArchitecture {
  const lower = filename.toLowerCase();
  if (lower.includes("ltxv") || lower.includes("ltx-")) return "ltx_video";
  if (
    lower.includes("wan2.1") ||
    lower.includes("wan2.2") ||
    lower.includes("wan_2.1") ||
    lower.includes("wan_2.2") ||
    lower.includes("wan2-") ||
    lower.includes("wan21") ||
    lower.includes("wan22")
  ) {
    return "wan_video";
  }
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
  if (lower.includes("moss")) return "moss_image";
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
