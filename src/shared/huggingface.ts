import type { ModelArchitecture, ModelCategory } from "./types";

export type HuggingFaceCompatibilityStatus =
  | "COMPATIBLE"
  | "CONDITIONAL"
  | "INCOMPATIBLE"
  | "UNKNOWN";

export type HuggingFaceCheckCategory =
  | "architecture"
  | "loader"
  | "dependencies"
  | "hardware"
  | "disk"
  | "duplicate"
  | "auth"
  | "metadata";

export type HuggingFaceCheckStatus = "pass" | "warn" | "fail" | "unknown";

export interface HuggingFaceCheck {
  id: string;
  category: HuggingFaceCheckCategory;
  status: HuggingFaceCheckStatus;
  title: string;
  detail: string;
}

export type HuggingFaceFileKind =
  | "diffusion_model"
  | "checkpoint"
  | "vae"
  | "text_encoder"
  | "lora"
  | "config"
  | "other";

export interface HuggingFaceFile {
  path: string;
  sizeBytes: number;
  sha256: string | null;
  format: string;
  quantization: string | null;
  kind: HuggingFaceFileKind;
  selectable: boolean;
  /** True when this file is the most likely standalone model weight. */
  primary: boolean;
}

export interface HuggingFaceRepoSummary {
  id: string;
  author: string | null;
  downloads: number;
  likes: number;
  pipelineTag: string | null;
  tags: string[];
  lastModified: string | null;
  gated: "auto" | "manual" | false;
  private: boolean;
  license: string | null;
  thumbnailUrl: string | null;
  architecture: ModelArchitecture;
  architectureLabel: string;
  runnable: boolean;
  supportReason: string;
  workflowId: string | null;
}

export interface HuggingFaceRepoDetails extends HuggingFaceRepoSummary {
  revision: string;
  description: string | null;
  cardData: Record<string, unknown> | null;
  config: Record<string, unknown> | null;
  modelIndex: Record<string, unknown> | null;
  files: HuggingFaceFile[];
  requiredComponents: Array<{
    category: ModelCategory;
    fileName: string;
    label: string;
    approxSizeGB: number;
    installed: boolean;
    availableInRepo: boolean;
  }>;
}

export interface HuggingFaceSearchQuery {
  query?: string;
  task?: "all" | "text-to-video" | "image-to-video";
  architecture?: "all" | "wan_video" | "ltx_video" | "other";
  sort?: "downloads" | "likes" | "lastModified";
  limit?: number;
  cursor?: string | null;
}

export interface HuggingFaceSearchResult {
  items: HuggingFaceRepoSummary[];
  nextCursor: string | null;
}

export interface HuggingFaceCompatibilityRequest {
  repoId: string;
  revision?: string;
  selectedPaths: string[];
}

export interface HuggingFaceDetectedHardware {
  gpuName: string;
  vramTotalMB: number;
  vramFreeMB: number;
  systemRamTotalMB: number;
  systemRamFreeMB: number;
  diskFreeGB: number | null;
  comfyVersion: string | null;
  runtimeConnected: boolean;
}

export interface HuggingFaceRequirements {
  workflowId: string | null;
  workflowName: string | null;
  minVramMB: number;
  recommendedVramMB: number;
  estimatedPeakVramMB: number;
  estimatedRamGB: number;
  downloadBytes: number;
  requiredFreeBytes: number;
  suggestedPreset: { width: number; height: number; frameCount: number } | null;
}

export interface HuggingFaceCompatibilityReport {
  status: HuggingFaceCompatibilityStatus;
  summary: string;
  checks: HuggingFaceCheck[];
  architecture: ModelArchitecture;
  workflowId: string | null;
  workflowName: string | null;
  detected: HuggingFaceDetectedHardware;
  requirements: HuggingFaceRequirements;
  selectedFiles: HuggingFaceFile[];
  missingComponents: Array<{
    category: ModelCategory;
    fileName: string;
    label: string;
    approxSizeGB: number;
  }>;
  missingNodes: string[];
  recommendations: string[];
  blockingReasons: string[];
  duplicateOf: string | null;
  evaluatedAt: string;
}

export interface HuggingFaceStartFile {
  path: string;
  category: ModelCategory;
}

export interface HuggingFaceStartRequest {
  repoId: string;
  revision?: string;
  files: HuggingFaceStartFile[];
  acknowledgeConditional?: boolean;
  override?: boolean;
}

export interface HuggingFaceConnectionTest {
  ok: boolean;
  authenticated: boolean;
  username: string | null;
  message: string;
}

export const HF_COMPATIBILITY_LABELS: Record<HuggingFaceCompatibilityStatus, string> = {
  COMPATIBLE: "Compatible",
  CONDITIONAL: "Conditional",
  INCOMPATIBLE: "Incompatible",
  UNKNOWN: "Unknown",
};

export function huggingFaceRepoUrl(repoId: string): string {
  return `https://huggingface.co/${repoId}`;
}

/**
 * Accepts `owner/repo`, a huggingface.co URL, or a URL with /tree/<rev>/... and
 * returns the canonical `owner/repo` id. Rejects anything else.
 */
export function normalizeHuggingFaceRepoId(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;

  let candidate = value;
  try {
    if (/^https?:\/\//i.test(value)) {
      const url = new URL(value);
      if (!/(^|\.)huggingface\.co$/i.test(url.hostname)) return null;
      candidate = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    }
  } catch {
    return null;
  }

  candidate = candidate.replace(/[?#].*$/, "").replace(/\/+$/, "");
  const parts = candidate.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0]!;
  const repo = parts[1]!;
  const id = `${owner}/${repo}`;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(owner)) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(repo)) return null;
  return id;
}

export function isSafeRepoFilePath(filePath: string): boolean {
  if (!filePath || filePath.length > 512) return false;
  if (filePath.startsWith("/") || filePath.includes("\\") || filePath.includes("\0")) {
    return false;
  }
  const segments = filePath.split("/");
  return segments.every(
    (segment) =>
      segment.length > 0 &&
      segment !== "." &&
      segment !== ".." &&
      /^[A-Za-z0-9][A-Za-z0-9 ._()\-+]*$/.test(segment)
  );
}

export function detectHuggingFaceQuantization(fileName: string): string | null {
  const value = fileName.toLowerCase();
  if (/q[2-8]_k(_[sml])?|gguf/.test(value)) {
    const match = value.match(/q[2-8]_k(_[sml])?/);
    return match ? match[0].toUpperCase() : "GGUF";
  }
  if (/int8|int4|nvfp4|fp4/.test(value)) {
    const match = value.match(/int8|int4|nvfp4|fp4/);
    return match ? match[0].toUpperCase() : null;
  }
  if (/fp8|f8_e4m3|e4m3|e5m2/.test(value)) return "FP8";
  if (/bf16|bfloat16/.test(value)) return "BF16";
  if (/fp16|f16/.test(value)) return "FP16";
  if (/fp32|f32/.test(value)) return "FP32";
  return null;
}

export function isUnsupportedHuggingFaceQuantization(quantization: string | null): boolean {
  if (!quantization) return false;
  return /GGUF|Q[2-8]|INT[248]|FP4|NVFP4/i.test(quantization);
}

export function detectHuggingFaceFormat(fileName: string): string {
  if (isDiffusersWeightPath(fileName)) return "diffusers";
  const ext = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (!ext) return "unknown";
  if (ext === "safetensors") return "safetensors";
  if (ext === "gguf") return "gguf";
  if (ext === "ckpt" || ext === "pt" || ext === "pth" || ext === "bin") return ext;
  if (ext === "json") return "json";
  return ext;
}

/**
 * Diffusers repositories store a pipeline as a directory tree (model_index.json,
 * transformer/, vae/, sharded weights). Kirea's shipped ComfyUI loaders take one
 * self-contained checkpoint/UNET file, so these paths cannot be loaded as-is.
 */
export function isDiffusersWeightPath(filePath: string): boolean {
  const value = filePath.replace(/\\/g, "/").toLowerCase();
  if (/(^|\/)diffusion_pytorch_model(-\d+-of-\d+)?\.(safetensors|bin)$/.test(value)) {
    return true;
  }
  if (/^(transformer|unet)\//.test(value) && /\.(safetensors|bin)$/.test(value)) {
    return true;
  }
  if (/^text_encoder\/model(-\d+-of-\d+)?\.(safetensors|bin)$/.test(value)) {
    return true;
  }
  if (/^vae\/(diffusion_pytorch_model|model)(-\d+-of-\d+)?\.(safetensors|bin)$/.test(value)) {
    return true;
  }
  return false;
}

export function isDiffusersShardPath(filePath: string): boolean {
  const value = filePath.replace(/\\/g, "/").toLowerCase();
  if (/(^|\/)diffusion_pytorch_model-\d+-of-\d+\.(safetensors|bin)$/.test(value)) {
    return true;
  }
  return /^(transformer|unet|text_encoder|vae)\//.test(value) && /\.(safetensors|bin)$/.test(value);
}

export function classifyHuggingFaceFile(filePath: string): HuggingFaceFileKind {
  const value = filePath.toLowerCase();
  const base = value.split("/").pop() ?? value;
  if (base === "config.json" || base === "model_index.json" || base.endsWith(".json")) {
    return "config";
  }
  if (/\.(safetensors|ckpt|pt|pth|bin|gguf)$/.test(base)) {
    if (/lora/.test(value)) return "lora";
    if (/(^|[\/_\-])vae([\/_\-.]|$)|(^|\/)ae\.safetensors$|qwen_image_vae/.test(value)) {
      return "vae";
    }
    if (/text_encoder|text-encoder|umt5|t5xxl|clip_|clip\./.test(value)) {
      return "text_encoder";
    }
    if (/diffusion_models?\/|(^|\/)unet\/|wan2\.1|wan_2\.1|diffusion_pytorch_model/.test(value)) {
      return "diffusion_model";
    }
    if (/checkpoints?\/|ltx|checkpoint/.test(value)) return "checkpoint";
    return "other";
  }
  return "other";
}

export function isHuggingFaceWeightFile(filePath: string): boolean {
  if (isDiffusersShardPath(filePath)) return false;
  const kind = classifyHuggingFaceFile(filePath);
  return (
    kind === "diffusion_model" ||
    kind === "checkpoint" ||
    kind === "vae" ||
    kind === "text_encoder" ||
    kind === "lora"
  );
}

export interface HuggingFaceArchitectureAssessment {
  architecture: ModelArchitecture;
  label: string;
  runnable: boolean;
  reason: string;
  workflowId: string | null;
}

/**
 * Deliberately conservative: the first release only recognizes models that
 * map to a workflow Kirea actually ships and has validated:
 * - Wan 2.1 1.3B text-to-video (t2v_wan21_1_3b)
 * - LTX-Video 2B text-to-video / image-to-video (t2v_ltx_2b, i2v_ltx_2b)
 */
export function assessHuggingFaceArchitecture(input: {
  repoId: string;
  pipelineTag: string | null;
  tags: string[];
  filePath: string | null;
  config?: Record<string, unknown> | null;
  modelIndex?: Record<string, unknown> | null;
}): HuggingFaceArchitectureAssessment {
  const combined = [
    input.repoId,
    input.pipelineTag ?? "",
    input.tags.join(" "),
    input.filePath ?? "",
    JSON.stringify(input.config ?? {}),
    JSON.stringify(input.modelIndex ?? {}),
  ]
    .join(" ")
    .toLowerCase();

  const variantBlob = [input.repoId, input.filePath ?? ""].join(" ").toLowerCase();
  const isI2V =
    /image[-_ ]?to[-_ ]?video|\bi2v\b/.test(`${variantBlob} ${input.pipelineTag ?? ""}`) ||
    /i2v/.test(input.repoId.toLowerCase());
  const isWan = /wan[._-]?2\.?[12]|wan2|wan-2/.test(combined);
  const isLtx = /ltx[-_ ]?video|ltxv|ltx-2/.test(combined);
  const is14B = /(^|[^0-9])(14b|14-b|14000m)(?![0-9])/.test(variantBlob);
  const is13B = /(^|[^0-9])(1\.3b|1_3b|1-3b|1300m)(?![0-9])/.test(variantBlob);
  const is2B = /(^|[^0-9])2b(?![0-9a-z])|(^|[^0-9])2-b(?![0-9a-z])|(^|[^0-9])2000m(?![0-9])/.test(
    variantBlob
  );
  const isLargeLtx = /(^|[^0-9])(13b|14b|19b|20b|22b)(?![0-9])/.test(variantBlob);
  const isLtxNextGen = /ltx[-_ ]?2(\.\d+)?(?![0-9a-z])/.test(variantBlob);
  const isWan22 = /wan[._-]?2\.2|wan2\.2|wan22/.test(variantBlob);
  const isWanSpecial =
    /\bfun\b|fun[._-]?camera|vace|control|flf2v|magref|inpaint|\binp\b|infinitetalk|animate|s2v/.test(
      variantBlob
    );

  if (isWan) {
    if (isWan22) {
      return {
        architecture: "wan_video",
        label: "Wan Video",
        runnable: false,
        reason:
          "This is a Wan 2.2 repository. Kirea's validated workflow targets Wan 2.1 1.3B and does not claim support for Wan 2.2.",
        workflowId: null,
      };
    }
    if (isWanSpecial) {
      return {
        architecture: "wan_video",
        label: "Wan Video",
        runnable: false,
        reason:
          "This is a Wan Fun/VACE/Control or other specialized variant, not the Wan 2.1 1.3B text-to-video model that Kirea's shipped workflow targets.",
        workflowId: null,
      };
    }
    if (isI2V) {
      return {
        architecture: "wan_video",
        label: "Wan Video",
        runnable: false,
        reason:
          "This repository is an image-to-video Wan variant. Kirea currently ships only the Wan 2.1 1.3B text-to-video workflow.",
        workflowId: null,
      };
    }
    if (is14B) {
      return {
        architecture: "wan_video",
        label: "Wan Video",
        runnable: false,
        reason:
          "This is a Wan 14B model. Kirea's validated workflow targets Wan 2.1 1.3B and does not claim support for 14B VRAM requirements.",
        workflowId: null,
      };
    }
    if (!is13B) {
      return {
        architecture: "wan_video",
        label: "Wan Video",
        runnable: false,
        reason:
          "Kirea can only size Wan support from a 1.3B checkpoint; this repository does not identify a 1.3B T2V variant.",
        workflowId: null,
      };
    }
    return {
      architecture: "wan_video",
      label: "Wan Video",
      runnable: true,
      reason: "Wan 2.1 1.3B text-to-video maps to Kirea's installed Wan workflow.",
      workflowId: "t2v_wan21_1_3b",
    };
  }

  if (isLtx) {
    if (isLtxNextGen) {
      return {
        architecture: "ltx_video",
        label: "LTX Video",
        runnable: false,
        reason:
          "This is an LTX-2.x generation model. Kirea's shipped workflows target the earlier LTX-Video 2B checkpoints and do not claim support for LTX-2.x.",
        workflowId: null,
      };
    }
    if (/upscaler|spatial[-_]?upscaler|temporal[-_]?upscaler/.test(variantBlob)) {
      return {
        architecture: "ltx_video",
        label: "LTX Video",
        runnable: false,
        reason:
          "This file is an LTX upscaler, not the LTX-Video 2B base model. Kirea's shipped LTX workflows load the base checkpoint.",
        workflowId: null,
      };
    }
    if (/lora/.test(variantBlob)) {
      return {
        architecture: "ltx_video",
        label: "LTX Video",
        runnable: false,
        reason:
          "This file is an LTX LoRA. Kirea's shipped LTX workflows do not enable external LoRAs.",
        workflowId: null,
      };
    }
    if (is14B || isLargeLtx || (!is2B && /0\.9\.8/.test(variantBlob))) {
      return {
        architecture: "ltx_video",
        label: "LTX Video",
        runnable: false,
        reason:
          "This is a larger LTX-Video variant. Kirea's validated workflow targets the 2B model.",
        workflowId: null,
      };
    }
    if (!is2B) {
      return {
        architecture: "ltx_video",
        label: "LTX Video",
        runnable: false,
        reason:
          "Kirea only supports the LTX-Video 2B family; this file does not identify a 2B variant.",
        workflowId: null,
      };
    }
    return {
      architecture: "ltx_video",
      label: "LTX Video",
      runnable: true,
      reason: "LTX-Video 2B maps to Kirea's installed LTX workflows.",
      workflowId: isI2V ? "i2v_ltx_2b" : "t2v_ltx_2b",
    };
  }

  if (/hunyuan.?video|mochi|cogvideo|animate.?diff|svd|stable.?video/.test(combined)) {
    return {
      architecture: "unknown",
      label: "Unsupported video architecture",
      runnable: false,
      reason:
        "Kirea has no shipped, validated ComfyUI workflow for this video architecture. Weights remain visible for discovery only.",
      workflowId: null,
    };
  }

  return {
    architecture: "unknown",
    label: "Unclassified",
    runnable: false,
    reason:
      "Kirea could not identify a shipped workflow for this repository. Compatibility cannot be claimed from metadata alone.",
    workflowId: null,
  };
}

export function workflowLabelForId(workflowId: string | null): string | null {
  if (workflowId === "t2v_wan21_1_3b") return "Wan 2.1 1.3B Text-to-Video";
  if (workflowId === "t2v_ltx_2b") return "LTX-Video 2B Text-to-Video";
  if (workflowId === "i2v_ltx_2b") return "LTX-Video 2B Image-to-Video";
  return null;
}
