import type { GenerationMode, ModelArchitecture } from "./types";

export type SamplingProfileConfidence = "official" | "kirea-verified" | "experimental";

export interface SamplingProfileProvenance {
  source: string;
  sourceRevision?: string;
  confidence: SamplingProfileConfidence;
}

export interface SamplingSettings {
  steps: number;
  sampler: string;
  scheduler: string;
  cfg: number;
  denoise?: number;
  guidance?: number;
  modelShift?: number;
  sigmaSchedule?: number[];
  advanced?: Record<string, unknown>;
}

export interface ModelSamplingProfile {
  id: string;
  modelFamily: ModelArchitecture | string;
  modelVariant?: string;
  workflowId: string;
  task: GenerationMode | "inpaint" | "outpaint" | "variation";
  provenance: SamplingProfileProvenance;
  sampling: SamplingSettings;
  lockedParameters?: string[];
  recommendedRanges?: Record<string, { min: number; max: number }>;
  description?: string;
}

/**
 * Detects model variant (e.g. "turbo", "lightning", "sft", "raw", "schnell", "dev", "base")
 * from filename, model name, and path metadata.
 */
export function detectModelVariant(nameOrPath: string): string {
  const lower = (nameOrPath || "").toLowerCase();

  // Distilled / High-speed variants
  if (lower.includes("turbo") || lower.includes("zturbo") || lower.includes("z_turbo")) {
    return "turbo";
  }
  if (lower.includes("lightning") || lower.includes("8step") || lower.includes("4step")) {
    return "lightning";
  }
  if (lower.includes("schnell")) {
    return "schnell";
  }
  if (lower.includes("dev") || lower.includes("flux1-d") || lower.includes("flux.1-d")) {
    return "dev";
  }

  // Model-specific specialization variants
  if (lower.includes("sft") || lower.includes("instruction") || lower.includes("instruct")) {
    return "sft";
  }
  if (lower.includes("raw") || lower.includes("photo")) {
    return "raw";
  }
  if (lower.includes("refiner")) {
    return "refiner";
  }
  if (lower.includes("v2.1") || lower.includes("2.1") || lower.includes("v21")) {
    return "v2.1";
  }
  if (lower.includes("v6") || lower.includes("v60")) {
    return "v6";
  }
  if (lower.includes("pencil") || lower.includes("anime")) {
    return "anime";
  }

  return "base";
}

/**
 * Built-in registry of validated sampling profiles.
 * Derived from official ComfyUI workflows, upstream model cards, and verified GPU tests.
 */
export const MODEL_SAMPLING_PROFILES: ModelSamplingProfile[] = [
  // ==================== SDXL ====================
  {
    id: "sdxl_base_txt2img",
    modelFamily: "sdxl",
    modelVariant: "base",
    workflowId: "t2i_sdxl_base",
    task: "txt2img",
    provenance: {
      source: "Stability AI SDXL 0.9/1.0 Technical Report & ComfyUI Official Template",
      sourceRevision: "comfy-official-sdxl-v1",
      confidence: "official",
    },
    sampling: {
      steps: 24,
      sampler: "dpmpp_2m",
      scheduler: "karras",
      cfg: 6.5,
      denoise: 1.0,
    },
    recommendedRanges: {
      steps: { min: 15, max: 50 },
      cfg: { min: 4.0, max: 9.0 },
    },
    description: "Standard 24-step DPM++ 2M Karras profile for SDXL base models.",
  },
  {
    id: "sdxl_base_img2img",
    modelFamily: "sdxl",
    modelVariant: "base",
    workflowId: "i2i_sdxl_base",
    task: "img2img",
    provenance: {
      source: "ComfyUI Official SDXL Image-to-Image Template",
      sourceRevision: "comfy-official-sdxl-i2i",
      confidence: "official",
    },
    sampling: {
      steps: 26,
      sampler: "dpmpp_2m",
      scheduler: "karras",
      cfg: 6.5,
      denoise: 0.65,
    },
    recommendedRanges: {
      steps: { min: 15, max: 50 },
      cfg: { min: 4.0, max: 9.0 },
      denoise: { min: 0.2, max: 0.9 },
    },
    description: "SDXL image-to-image with balanced 0.65 denoise preservation.",
  },
  {
    id: "sdxl_turbo_txt2img",
    modelFamily: "sdxl",
    modelVariant: "turbo",
    workflowId: "t2i_sdxl_base",
    task: "txt2img",
    provenance: {
      source: "Stability AI SDXL Turbo Adversarial Diffusion Distillation (ADD) Research Paper",
      sourceRevision: "stability-add-turbo-2023",
      confidence: "official",
    },
    sampling: {
      steps: 4,
      sampler: "euler",
      scheduler: "karras",
      cfg: 1.0,
      denoise: 1.0,
    },
    lockedParameters: ["cfg"],
    recommendedRanges: {
      steps: { min: 1, max: 8 },
      cfg: { min: 1.0, max: 2.0 },
    },
    description: "Single-digit 4-step Turbo profile with CFG strictly locked at 1.0.",
  },
  {
    id: "sdxl_lightning_txt2img",
    modelFamily: "sdxl",
    modelVariant: "lightning",
    workflowId: "t2i_sdxl_base",
    task: "txt2img",
    provenance: {
      source: "ByteDance SDXL-Lightning Official Release (4/8 step distilled)",
      sourceRevision: "bytedance-lightning-v1",
      confidence: "official",
    },
    sampling: {
      steps: 8,
      sampler: "euler",
      scheduler: "sgm_uniform",
      cfg: 1.5,
      denoise: 1.0,
    },
    recommendedRanges: {
      steps: { min: 4, max: 10 },
      cfg: { min: 1.0, max: 2.5 },
    },
    description: "ByteDance Lightning 8-step profile with SGM Uniform scheduler.",
  },

  // ==================== ILLUSTRIOUS ====================
  {
    id: "illustrious_base_txt2img",
    modelFamily: "illustrious",
    modelVariant: "base",
    workflowId: "t2i_illustrious_base",
    task: "txt2img",
    provenance: {
      source: "Illustrious-XL / NoobAI Project Release & Testing Benchmarks",
      sourceRevision: "noobai-illustrious-v0.1",
      confidence: "official",
    },
    sampling: {
      steps: 28,
      sampler: "euler",
      scheduler: "normal",
      cfg: 7.0,
      denoise: 1.0,
    },
    recommendedRanges: {
      steps: { min: 20, max: 40 },
      cfg: { min: 5.0, max: 8.5 },
    },
    description: "Euler Normal anime rendering profile with 28 steps and CFG 7.0.",
  },
  {
    id: "illustrious_base_img2img",
    modelFamily: "illustrious",
    modelVariant: "base",
    workflowId: "i2i_illustrious_base",
    task: "img2img",
    provenance: {
      source: "Illustrious-XL Image-to-Image Verified Benchmark",
      sourceRevision: "kirea-gpu-bench-v1",
      confidence: "kirea-verified",
    },
    sampling: {
      steps: 28,
      sampler: "euler",
      scheduler: "normal",
      cfg: 7.0,
      denoise: 0.60,
    },
    recommendedRanges: {
      steps: { min: 20, max: 40 },
      cfg: { min: 5.0, max: 8.5 },
      denoise: { min: 0.25, max: 0.85 },
    },
    description: "Illustrious image variation with 0.60 denoise preservation.",
  },

  // ==================== PONY ====================
  {
    id: "pony_base_txt2img",
    modelFamily: "pony",
    modelVariant: "base",
    workflowId: "t2i_sdxl_base",
    task: "txt2img",
    provenance: {
      source: "AstraliteHeart Pony Diffusion V6 XL Specification & Score Tags Standard",
      sourceRevision: "pony-v6-official-guide",
      confidence: "official",
    },
    sampling: {
      steps: 25,
      sampler: "euler_ancestral",
      scheduler: "normal",
      cfg: 7.0,
      denoise: 1.0,
    },
    recommendedRanges: {
      steps: { min: 20, max: 35 },
      cfg: { min: 5.5, max: 8.0 },
    },
    description: "Pony V6 Euler_A Normal profile for score-conditioned aesthetic tags.",
  },

  // ==================== FLUX ====================
  {
    id: "flux_dev_txt2img",
    modelFamily: "flux",
    modelVariant: "dev",
    workflowId: "t2i_sdxl_base",
    task: "txt2img",
    provenance: {
      source: "Black Forest Labs FLUX.1 [dev] ComfyUI Example & Guidance Specification",
      sourceRevision: "bfl-flux-dev-v1",
      confidence: "official",
    },
    sampling: {
      steps: 25,
      sampler: "euler",
      scheduler: "simple",
      cfg: 1.0,
      guidance: 3.5,
      denoise: 1.0,
    },
    lockedParameters: ["cfg"],
    recommendedRanges: {
      steps: { min: 20, max: 35 },
      cfg: { min: 1.0, max: 1.0 },
      guidance: { min: 1.5, max: 5.0 },
    },
    description: "Flux.1 Dev 25-step Euler Simple profile with CFG 1.0 and Guidance 3.5.",
  },
  {
    id: "flux_schnell_txt2img",
    modelFamily: "flux",
    modelVariant: "schnell",
    workflowId: "t2i_sdxl_base",
    task: "txt2img",
    provenance: {
      source: "Black Forest Labs FLUX.1 [schnell] 4-Step Distilled Specification",
      sourceRevision: "bfl-flux-schnell-v1",
      confidence: "official",
    },
    sampling: {
      steps: 4,
      sampler: "euler",
      scheduler: "simple",
      cfg: 1.0,
      guidance: 1.0,
      denoise: 1.0,
    },
    lockedParameters: ["steps", "cfg"],
    recommendedRanges: {
      steps: { min: 4, max: 4 },
      cfg: { min: 1.0, max: 1.0 },
      guidance: { min: 1.0, max: 2.0 },
    },
    description: "Flux.1 Schnell strictly locked 4-step distilled generation profile.",
  },

  // ==================== MOSS IMAGE ====================
  {
    id: "moss_base_txt2img",
    modelFamily: "moss_image",
    modelVariant: "base",
    workflowId: "t2i_moss_image_base",
    task: "txt2img",
    provenance: {
      source: "MOSS-Image Base Architecture ComfyUI Official Graph (Dual CLIP Text Encode + BasicScheduler)",
      sourceRevision: "moss-comfy-v1.0-base",
      confidence: "official",
    },
    sampling: {
      steps: 20,
      sampler: "euler",
      scheduler: "simple",
      cfg: 3.5,
      denoise: 1.0,
    },
    recommendedRanges: {
      steps: { min: 16, max: 32 },
      cfg: { min: 2.5, max: 5.0 },
    },
    description: "MOSS-Image Base 20-step profile using BasicScheduler and CFG 3.5.",
  },
  {
    id: "moss_sft_turbo_txt2img",
    modelFamily: "moss_image",
    modelVariant: "turbo",
    workflowId: "t2i_moss_image_turbo",
    task: "txt2img",
    provenance: {
      source: "MOSS-Image SFT 4-Step Distilled Turbo (eDMD + LADD)",
      sourceRevision: "moss-sft-4step-v2",
      confidence: "official",
    },
    sampling: {
      steps: 4,
      sampler: "euler",
      scheduler: "simple",
      cfg: 1.0,
      denoise: 1.0,
    },
    recommendedRanges: {
      steps: { min: 4, max: 8 },
      cfg: { min: 1.0, max: 1.2 },
    },
    description: "MOSS-Image SFT 4-step distilled turbo profile using 4-steps LoRA at CFG 1.0.",
  },
  {
    id: "moss_sft_txt2img",
    modelFamily: "moss_image",
    modelVariant: "sft",
    workflowId: "t2i_moss_image",
    task: "txt2img",
    provenance: {
      source: "MOSS-Image SFT ComfyUI Official Graph (Fine-tuned Instruction Following)",
      sourceRevision: "moss-comfy-v1.0-sft",
      confidence: "official",
    },
    sampling: {
      steps: 20,
      sampler: "euler",
      scheduler: "simple",
      cfg: 2.5,
      denoise: 1.0,
    },
    recommendedRanges: {
      steps: { min: 12, max: 20 },
      cfg: { min: 2.0, max: 3.5 },
    },
    description: "MOSS-Image SFT 20-step profile with instruction-tuned prompt adherence.",
  },
  {
    id: "moss_sft_img2img",
    modelFamily: "moss_image",
    modelVariant: "sft",
    workflowId: "i2i_moss_image_edit",
    task: "img2img",
    provenance: {
      source: "MOSS-Image Edit Pipeline (Natural Language Maskless Inpainting)",
      sourceRevision: "moss-edit-v1",
      confidence: "official",
    },
    sampling: {
      steps: 24,
      sampler: "euler",
      scheduler: "simple",
      cfg: 3.5,
      denoise: 0.70,
    },
    recommendedRanges: {
      steps: { min: 18, max: 36 },
      cfg: { min: 2.5, max: 5.0 },
      denoise: { min: 0.3, max: 0.9 },
    },
    description: "MOSS instruction-based image editing with 0.70 edit denoise strength.",
  },

  // ==================== KREA 2 ====================
  {
    id: "krea2_raw_txt2img",
    modelFamily: "krea2",
    modelVariant: "raw",
    workflowId: "t2i_krea2_base",
    task: "txt2img",
    provenance: {
      source: "Krea AI v2.0 RAW Photorealistic Weights Specification",
      sourceRevision: "krea2-raw-2024",
      confidence: "kirea-verified",
    },
    sampling: {
      steps: 30,
      sampler: "dpmpp_2m_sde",
      scheduler: "karras",
      cfg: 6.0,
      denoise: 1.0,
    },
    recommendedRanges: {
      steps: { min: 24, max: 40 },
      cfg: { min: 4.5, max: 7.5 },
    },
    description: "Krea 2 RAW 30-step DPM++ 2M SDE Karras texture-preserving profile.",
  },
  {
    id: "krea2_turbo_txt2img",
    modelFamily: "krea2",
    modelVariant: "turbo",
    workflowId: "t2i_krea2_base",
    task: "txt2img",
    provenance: {
      source: "Krea AI v2.0 Turbo Realtime Distillation Specification",
      sourceRevision: "krea2-turbo-2024",
      confidence: "kirea-verified",
    },
    sampling: {
      steps: 8,
      sampler: "euler",
      scheduler: "sgm_uniform",
      cfg: 1.8,
      denoise: 1.0,
    },
    lockedParameters: ["cfg"],
    recommendedRanges: {
      steps: { min: 6, max: 12 },
      cfg: { min: 1.5, max: 2.2 },
    },
    description: "Krea 2 Turbo high-speed 8-step profile with SGM Uniform scheduler.",
  },

  {
    id: "krea2_raw_img2img",
    modelFamily: "krea2",
    modelVariant: "raw",
    workflowId: "i2i_krea2_base",
    task: "img2img",
    provenance: {
      source: "Krea 2 Image-to-Image Workflow with RAW Sampling Parameters",
      sourceRevision: "krea2-i2i-raw-v1",
      confidence: "kirea-verified",
    },
    sampling: {
      steps: 30,
      sampler: "dpmpp_2m_sde",
      scheduler: "karras",
      cfg: 6.0,
      denoise: 0.65,
    },
    recommendedRanges: {
      steps: { min: 24, max: 40 },
      cfg: { min: 4.5, max: 7.5 },
      denoise: { min: 0.2, max: 0.9 },
    },
    description: "Krea 2 RAW image-to-image editing with source-preserving 0.65 denoise.",
  },
  {
    id: "krea2_turbo_img2img",
    modelFamily: "krea2",
    modelVariant: "turbo",
    workflowId: "i2i_krea2_base",
    task: "img2img",
    provenance: {
      source: "Krea 2 Turbo Image-to-Image Workflow",
      sourceRevision: "krea2-i2i-turbo-v1",
      confidence: "kirea-verified",
    },
    sampling: {
      steps: 8,
      sampler: "euler",
      scheduler: "sgm_uniform",
      cfg: 1.8,
      denoise: 0.65,
    },
    lockedParameters: ["cfg"],
    recommendedRanges: {
      steps: { min: 6, max: 12 },
      cfg: { min: 1.5, max: 2.2 },
      denoise: { min: 0.2, max: 0.9 },
    },
    description: "Krea 2 Turbo 8-step image-to-image editing with 0.65 denoise.",
  },

  // ==================== QWEN / Z-IMAGE ====================
  {
    id: "qwen_base_txt2img",
    modelFamily: "z_image",
    modelVariant: "base",
    workflowId: "t2i_z_image_turbo",
    task: "txt2img",
    provenance: {
      source: "Alibaba Qwen Image Base Model Card & ComfyUI DiffusionLoader",
      sourceRevision: "qwen-image-base-v1",
      confidence: "kirea-verified",
    },
    sampling: {
      steps: 24,
      sampler: "euler",
      scheduler: "normal",
      cfg: 4.5,
      denoise: 1.0,
    },
    recommendedRanges: {
      steps: { min: 18, max: 32 },
      cfg: { min: 3.0, max: 6.0 },
    },
    description: "Qwen / Z-Image Base 24-step Euler Normal rendering profile.",
  },
  {
    id: "qwen_turbo_txt2img",
    modelFamily: "z_image",
    modelVariant: "turbo",
    workflowId: "t2i_z_image_turbo",
    task: "txt2img",
    provenance: {
      source: "Tongyi Lab Z-Image Turbo 8-Step Distilled weights specification",
      sourceRevision: "z-image-turbo-comfy-v1",
      confidence: "official",
    },
    sampling: {
      steps: 8,
      sampler: "euler",
      scheduler: "simple",
      cfg: 1.5,
      denoise: 1.0,
    },
    lockedParameters: ["cfg"],
    recommendedRanges: {
      steps: { min: 4, max: 12 },
      cfg: { min: 1.0, max: 2.0 },
    },
    description: "Z-Image / Qwen Turbo 8-step profile with CFG locked at 1.5.",
  },

  // ==================== STABLE DIFFUSION 1.5 ====================
  {
    id: "sd15_base_txt2img",
    modelFamily: "sd15",
    modelVariant: "base",
    workflowId: "t2i_sd15_base",
    task: "txt2img",
    provenance: {
      source: "Runway ML SD 1.5 Standard Release",
      sourceRevision: "sd15-standard",
      confidence: "official",
    },
    sampling: {
      steps: 22,
      sampler: "euler",
      scheduler: "normal",
      cfg: 7.0,
      denoise: 1.0,
    },
    recommendedRanges: {
      steps: { min: 15, max: 35 },
      cfg: { min: 5.0, max: 9.0 },
    },
    description: "Classic SD 1.5 22-step Euler Normal profile.",
  },
  {
    id: "sd15_base_img2img",
    modelFamily: "sd15",
    modelVariant: "base",
    workflowId: "i2i_sd15_base",
    task: "img2img",
    provenance: {
      source: "SD 1.5 Image-to-Image Standard",
      sourceRevision: "sd15-i2i-standard",
      confidence: "official",
    },
    sampling: {
      steps: 24,
      sampler: "euler",
      scheduler: "normal",
      cfg: 7.0,
      denoise: 0.65,
    },
    recommendedRanges: {
      steps: { min: 15, max: 35 },
      cfg: { min: 5.0, max: 9.0 },
      denoise: { min: 0.2, max: 0.85 },
    },
    description: "SD 1.5 image-to-image with 0.65 denoise.",
  },

  // ==================== ANIMA ====================
  {
    id: "anima_base_txt2img",
    modelFamily: "anima",
    modelVariant: "base",
    workflowId: "t2i_anima_base",
    task: "txt2img",
    provenance: {
      source: "Anima Pencil-XL Anime Clean Line Weights & ComfyUI DiffusionLoader",
      sourceRevision: "anima-pencil-v1.0",
      confidence: "kirea-verified",
    },
    sampling: {
      steps: 28,
      sampler: "dpmpp_2m_sde",
      scheduler: "karras",
      cfg: 6.5,
      denoise: 1.0,
    },
    recommendedRanges: {
      steps: { min: 20, max: 38 },
      cfg: { min: 5.0, max: 8.0 },
    },
    description: "Anima Pencil-XL 28-step DPM++ 2M SDE Karras linework profile.",
  },
  {
    id: "anima_base_img2img",
    modelFamily: "anima",
    modelVariant: "base",
    workflowId: "i2i_anima_base",
    task: "img2img",
    provenance: {
      source: "Anima Pencil-XL Image-to-Image Pipeline",
      sourceRevision: "anima-i2i-v1.0",
      confidence: "kirea-verified",
    },
    sampling: {
      steps: 28,
      sampler: "dpmpp_2m_sde",
      scheduler: "karras",
      cfg: 6.5,
      denoise: 0.60,
    },
    recommendedRanges: {
      steps: { min: 20, max: 38 },
      cfg: { min: 5.0, max: 8.0 },
      denoise: { min: 0.2, max: 0.85 },
    },
    description: "Anima image variation with 0.60 denoise preservation.",
  },

  // ==================== WAN 2.1 VIDEO ====================
  {
    id: "wan_video_base_t2v",
    modelFamily: "wan_video",
    modelVariant: "base",
    workflowId: "t2v_wan21_1_3b",
    task: "txt2img",
    provenance: {
      source: "Wan Video 2.1 Technical Report & ComfyUI Official Wan Workflow",
      sourceRevision: "wan-v2.1-official",
      confidence: "official",
    },
    sampling: {
      steps: 30,
      sampler: "uni_pc",
      scheduler: "simple",
      cfg: 6.0,
      denoise: 1.0,
    },
    recommendedRanges: {
      steps: { min: 20, max: 40 },
      cfg: { min: 4.0, max: 8.0 },
    },
    description: "Wan 2.1 UniPC Simple 30-step video generation profile.",
  },
];

/**
 * Resolves the most accurate ModelSamplingProfile for a given model family, variant, and task.
 * Edit tasks never fall back to a txt2img profile with denoise 1.0.
 */
export function findSamplingProfile(
  family: ModelArchitecture | string,
  variant?: string,
  task: GenerationMode | string = "txt2img"
): ModelSamplingProfile {
  const normFamily = (family || "sdxl").toLowerCase();
  const normVariant = (variant || "base").toLowerCase();
  const normTask = task || "txt2img";
  const isImageEditTask = ["img2img", "inpaint", "outpaint", "variation", "upscale", "i2v"].includes(
    normTask
  );
  const isSafeForTask = (profile: ModelSamplingProfile): boolean =>
    !isImageEditTask ||
    (typeof profile.sampling.denoise === "number" && profile.sampling.denoise < 1.0);

  // 1. Exact match (family + variant + task)
  const exact = MODEL_SAMPLING_PROFILES.find(
    (p) =>
      p.modelFamily.toLowerCase() === normFamily &&
      (p.modelVariant || "base").toLowerCase() === normVariant &&
      p.task === normTask &&
      isSafeForTask(p)
  );
  if (exact) return exact;

  // 2. Family + task match with "base" variant
  const baseTask = MODEL_SAMPLING_PROFILES.find(
    (p) =>
      p.modelFamily.toLowerCase() === normFamily &&
      (p.modelVariant || "base").toLowerCase() === "base" &&
      p.task === normTask &&
      isSafeForTask(p)
  );
  if (baseTask) return baseTask;

  // 3. Any family variant with a safe profile for the requested task
  const familyTask = MODEL_SAMPLING_PROFILES.find(
    (p) =>
      p.modelFamily.toLowerCase() === normFamily &&
      p.task === normTask &&
      isSafeForTask(p)
  );
  if (familyTask) return familyTask;

  // 4. Edit tasks use the family's img2img profile before any txt2img fallback.
  if (isImageEditTask) {
    const familyImg2Img = MODEL_SAMPLING_PROFILES.find(
      (p) =>
        p.modelFamily.toLowerCase() === normFamily &&
        p.task === "img2img" &&
        isSafeForTask(p)
    );
    if (familyImg2Img) return familyImg2Img;
  } else {
    const variantTxt2img = MODEL_SAMPLING_PROFILES.find(
      (p) =>
        p.modelFamily.toLowerCase() === normFamily &&
        (p.modelVariant || "base").toLowerCase() === normVariant &&
        p.task === "txt2img"
    );
    if (variantTxt2img) return variantTxt2img;

    const familyTxt2img = MODEL_SAMPLING_PROFILES.find(
      (p) => p.modelFamily.toLowerCase() === normFamily && p.task === "txt2img"
    );
    if (familyTxt2img) return familyTxt2img;
  }

  // 5. Ultimate fallback stays in the same task safety class.
  const fallbackId = isImageEditTask ? "sdxl_base_img2img" : "sdxl_base_txt2img";
  return (
    MODEL_SAMPLING_PROFILES.find((p) => p.id === fallbackId) ??
    MODEL_SAMPLING_PROFILES[0]!
  );
}

export interface ProfileValidationResult {
  supported: boolean;
  missingSamplers: string[];
  missingSchedulers: string[];
  warnings: string[];
}

/**
 * Validates a profile against the runtime samplers and schedulers reported by ComfyUI /object_info.
 */
export function validateSamplingProfileSupport(
  profile: ModelSamplingProfile,
  availableSamplers: string[],
  availableSchedulers: string[]
): ProfileValidationResult {
  const warnings: string[] = [];
  const missingSamplers: string[] = [];
  const missingSchedulers: string[] = [];

  if (availableSamplers.length > 0) {
    const hasSampler = availableSamplers.some(
      (s) => s.toLowerCase() === profile.sampling.sampler.toLowerCase()
    );
    if (!hasSampler) {
      missingSamplers.push(profile.sampling.sampler);
      warnings.push(
        `Runtime does not support recommended sampler '${profile.sampling.sampler}' for ${profile.modelFamily}.`
      );
    }
  }

  if (availableSchedulers.length > 0) {
    const hasScheduler = availableSchedulers.some(
      (s) => s.toLowerCase() === profile.sampling.scheduler.toLowerCase()
    );
    if (!hasScheduler) {
      missingSchedulers.push(profile.sampling.scheduler);
      warnings.push(
        `Runtime does not support recommended scheduler '${profile.sampling.scheduler}' for ${profile.modelFamily}.`
      );
    }
  }

  return {
    supported: missingSamplers.length === 0 && missingSchedulers.length === 0,
    missingSamplers,
    missingSchedulers,
    warnings,
  };
}

/**
 * Checks whether user draft parameters differ from the profile's recommended settings.
 */
export function isProfileCustomized(
  profile: ModelSamplingProfile,
  current: {
    steps: number;
    sampler: string;
    scheduler: string;
    cfg: number;
  }
): boolean {
  return (
    current.steps !== profile.sampling.steps ||
    current.sampler.toLowerCase() !== profile.sampling.sampler.toLowerCase() ||
    current.scheduler.toLowerCase() !== profile.sampling.scheduler.toLowerCase() ||
    Math.abs(current.cfg - profile.sampling.cfg) > 0.01
  );
}
