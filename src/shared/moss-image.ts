import type { ModelArchitecture, ModelCategory } from "./types";

export const MOSS_IMAGE_WORKFLOW_ID = "t2i_moss_image";

export const MOSS_IMAGE_WORKFLOW_IDS = [
  "t2i_moss_image",
  "t2i_moss_image_turbo",
  "t2i_moss_image_base",
  "t2i_moss_image_layout",
  "i2i_moss_image_edit",
  "i2i_moss_image_color_control",
  "i2i_moss_image_depth_control",
] as const;

export type MossImageWorkflowId = (typeof MOSS_IMAGE_WORKFLOW_IDS)[number];

export function isMossWorkflow(workflowId: string): workflowId is MossImageWorkflowId {
  return (MOSS_IMAGE_WORKFLOW_IDS as readonly string[]).includes(workflowId);
}

export type MossComponentId =
  | "moss-sft"
  | "moss-base"
  | "moss-encoder"
  | "moss-vae"
  | "moss-edit-lora"
  | "moss-color-depth-lora";

export interface MossImageDependency {
  id: MossComponentId;
  label: string;
  category: ModelCategory;
  targetSubdir: string;
  required: boolean;
  /** ComfyUI loader that consumes this artifact. */
  loader: string;
  matches: (nameOrPath: string) => boolean;
}

const lower = (value: string): string => value.replace(/\\/g, "/").toLowerCase();

const isSftDiffusion = (value: string): boolean =>
  lower(value).includes("moss_image_sft_");
const isBaseDiffusion = (value: string): boolean =>
  lower(value).includes("moss_image_base_");
const isQwen35NineB = (value: string): boolean => {
  const v = lower(value);
  return (
    v.includes("qwen3.5_9b") ||
    v.includes("qwen3.5-9b") ||
    v.includes("qwen3_5_9b") ||
    v.includes("qwen35_9b")
  );
};
const isFlux2SmallVae = (value: string): boolean => {
  const v = lower(value);
  return (
    v.includes("flux2-vae_small") ||
    v.includes("flux2_vae_small") ||
    v.includes("flux2-vae-small")
  );
};

/** Component-level requirements shared by every MOSS-Image workflow. */
export const MOSS_IMAGE_DEPENDENCIES: MossImageDependency[] = [
  {
    id: "moss-sft",
    label: "MOSS-Image SFT diffusion model",
    category: "diffusion_model",
    targetSubdir: "diffusion_models",
    required: true,
    loader: "UNETLoader",
    matches: isSftDiffusion,
  },
  {
    id: "moss-base",
    label: "MOSS-Image Base diffusion model",
    category: "diffusion_model",
    targetSubdir: "diffusion_models",
    required: true,
    loader: "UNETLoader",
    matches: isBaseDiffusion,
  },
  {
    id: "moss-encoder",
    label: "Qwen3.5-9B text encoder",
    category: "text_encoder",
    targetSubdir: "text_encoders",
    required: true,
    loader: "CLIPLoader (type moss_image)",
    matches: isQwen35NineB,
  },
  {
    id: "moss-vae",
    label: "FLUX.2 small VAE",
    category: "vae",
    targetSubdir: "vae",
    required: true,
    loader: "VAELoader",
    matches: isFlux2SmallVae,
  },
  {
    id: "moss-edit-lora",
    label: "MOSS-Image Edit LoRA",
    category: "lora",
    targetSubdir: "loras",
    required: false,
    loader: "LoraLoaderModelOnly",
    matches: (value) => {
      const v = lower(value);
      return v.includes("moss") && v.includes("edit") && v.includes("lora");
    },
  },
  {
    id: "moss-color-depth-lora",
    label: "MOSS-Image Color/Depth Control LoRA",
    category: "lora",
    targetSubdir: "loras",
    required: false,
    loader: "LoraLoaderModelOnly + MOSSImageControl",
    matches: (value) => {
      const v = lower(value);
      return v.includes("moss") && v.includes("color") && v.includes("depth");
    },
  },
];

const MOSS_REQUIREMENTS: Record<MossImageWorkflowId, MossComponentId[]> = {
  t2i_moss_image: ["moss-sft", "moss-encoder", "moss-vae"],
  t2i_moss_image_turbo: ["moss-sft", "moss-encoder", "moss-vae"],
  t2i_moss_image_base: ["moss-base", "moss-encoder", "moss-vae"],
  t2i_moss_image_layout: ["moss-sft", "moss-encoder", "moss-vae"],
  i2i_moss_image_edit: ["moss-sft", "moss-encoder", "moss-vae", "moss-edit-lora"],
  i2i_moss_image_color_control: [
    "moss-sft",
    "moss-encoder",
    "moss-vae",
    "moss-color-depth-lora",
  ],
  i2i_moss_image_depth_control: [
    "moss-sft",
    "moss-encoder",
    "moss-vae",
    "moss-color-depth-lora",
  ],
};

export function mossRequirementsFor(workflowId: string): MossComponentId[] {
  return isMossWorkflow(workflowId) ? MOSS_REQUIREMENTS[workflowId] : [];
}

export interface MossModelVariant {
  id: string;
  componentId: MossComponentId;
  label: string;
  description: string;
  fileName: string;
  relativePath: string;
  category: ModelCategory;
  architecture: ModelArchitecture;
  targetSubdir: string;
  sizeBytes: number;
  sha256: string;
  downloadUrl: string;
  sourceUrl: string;
  recommended?: boolean;
  /** Workflows that consume this exact variant when it is selected. */
  workflowIds: MossImageWorkflowId[];
}

const MOSS_SOURCE_URL = "https://huggingface.co/Comfy-Org/MOSS-Image";
const MOSS_RESOLVE_BASE = `${MOSS_SOURCE_URL}/resolve/main`;

function variant(input: {
  id: string;
  componentId: MossComponentId;
  label: string;
  description: string;
  relativePath: string;
  category: ModelCategory;
  sizeBytes: number;
  sha256: string;
  recommended?: boolean;
  workflowIds: MossImageWorkflowId[];
}): MossModelVariant {
  return {
    ...input,
    fileName: input.relativePath.split("/").pop() ?? input.relativePath,
    architecture: "moss_image",
    targetSubdir: input.relativePath.split("/")[0] ?? "",
    downloadUrl: `${MOSS_RESOLVE_BASE}/${input.relativePath}`,
    sourceUrl: MOSS_SOURCE_URL,
  };
}

/**
 * Official Comfy-Org/MOSS-Image repository artifacts. Sizes and SHA-256 values
 * were read from Hugging Face LFS metadata on 2026-11-17.
 */
export const MOSS_MODEL_VARIANTS: MossModelVariant[] = [
  variant({
    id: "moss-sft-int8",
    componentId: "moss-sft",
    label: "MOSS-Image SFT — INT8 ConvRot",
    description:
      "Instruction-tuned checkpoint in the 5.04 GB INT8 format used by ComfyUI's official templates. Recommended for 16 GB GPUs.",
    relativePath: "diffusion_models/moss_image_sft_int8_convrot.safetensors",
    category: "diffusion_model",
    sizeBytes: 5413698958,
    sha256: "b4d1475bc7eeffd7b809e82ea13a1fba1fb85c4e18365af3813722faa5c0fe4f",
    recommended: true,
    workflowIds: [
      "t2i_moss_image",
      "t2i_moss_image_layout",
      "i2i_moss_image_edit",
      "i2i_moss_image_color_control",
      "i2i_moss_image_depth_control",
    ],
  }),
  variant({
    id: "moss-sft-bf16",
    componentId: "moss-sft",
    label: "MOSS-Image SFT — BF16",
    description:
      "Full-precision instruction-tuned checkpoint (10.16 GB). Higher quality but needs ComfyUI offloading on a 16 GB GPU.",
    relativePath: "diffusion_models/moss_image_sft_bf16.safetensors",
    category: "diffusion_model",
    sizeBytes: 10164655808,
    sha256: "f96738d8116d78b7316b57c663d8c98591ddafab7488f48e3099b7655e34ab6f",
    workflowIds: [
      "t2i_moss_image",
      "t2i_moss_image_layout",
      "i2i_moss_image_edit",
      "i2i_moss_image_color_control",
      "i2i_moss_image_depth_control",
    ],
  }),
  variant({
    id: "moss-base-int8",
    componentId: "moss-base",
    label: "MOSS-Image Base — INT8 ConvRot",
    description:
      "Base checkpoint (5.04 GB) without CFG distillation; intended for community LoRAs and the Base T2I workflow.",
    relativePath: "diffusion_models/moss_image_base_int8_convrot.safetensors",
    category: "diffusion_model",
    sizeBytes: 5413698958,
    sha256: "f601c1e1161915fb3fea003da0c1782e374dd960fbb3978bc0e4e3fa1f2d8e6f",
    recommended: true,
    workflowIds: ["t2i_moss_image_base"],
  }),
  variant({
    id: "moss-base-bf16",
    componentId: "moss-base",
    label: "MOSS-Image Base — BF16",
    description:
      "Full-precision Base checkpoint (10.16 GB). Requires offloading on a 16 GB GPU.",
    relativePath: "diffusion_models/moss_image_base_bf16.safetensors",
    category: "diffusion_model",
    sizeBytes: 10164655808,
    sha256: "cacd158728a1fb9e57c408a922b54752ec71fceb566b3821269927964e62b41f",
    workflowIds: ["t2i_moss_image_base"],
  }),
  variant({
    id: "moss-encoder-w4a8",
    componentId: "moss-encoder",
    label: "Qwen3.5-9B Text Encoder — W4A8 GPTQ",
    description:
      "7.34 GB quantized MOSS text encoder used by the official SFT, Base, Layout and Edit templates.",
    relativePath: "text_encoders/qwen3.5_9b_w4a8_gptq.safetensors",
    category: "text_encoder",
    sizeBytes: 7343591088,
    sha256: "4cc6a1543ad2061806da46f35f90cadb4801dcba246c44782cf42ec0feb6407c",
    recommended: true,
    workflowIds: [...MOSS_IMAGE_WORKFLOW_IDS],
  }),
  variant({
    id: "moss-encoder-int8",
    componentId: "moss-encoder",
    label: "Qwen3.5-9B Text Encoder — INT8 ConvRot",
    description:
      "9.75 GB encoder used by the official color/depth-control template. Also valid for T2I and edit.",
    relativePath: "text_encoders/qwen3.5_9b_int8_convrot.safetensors",
    category: "text_encoder",
    sizeBytes: 9748121532,
    sha256: "32e3787472f708fa5f83624acbf5ef23f7fc89c439e05065ea57cfe5a97f025a",
    workflowIds: [...MOSS_IMAGE_WORKFLOW_IDS],
  }),
  variant({
    id: "moss-encoder-bf16",
    componentId: "moss-encoder",
    label: "Qwen3.5-9B Text Encoder — BF16",
    description:
      "19.31 GB full-precision encoder. Not recommended on 16 GB VRAM; included for completeness.",
    relativePath: "text_encoders/qwen3.5_9b_bf16.safetensors",
    category: "text_encoder",
    sizeBytes: 19306312328,
    sha256: "7e6e9f08d598f829cb940e60ac0c698e1f1c27a47daffd7e598cd78c78b4cc53",
    workflowIds: [...MOSS_IMAGE_WORKFLOW_IDS],
  }),
  variant({
    id: "moss-vae-small",
    componentId: "moss-vae",
    label: "FLUX.2 Small VAE",
    description:
      "249.5 MB VAE required by every MOSS-Image workflow. The full FLUX.2 VAE is not a substitute in the official graph.",
    relativePath: "vae/flux2-vae_small.safetensors",
    category: "vae",
    sizeBytes: 249521340,
    sha256: "d8d52ba036475f5fb07c8b435e176d3d97ebfa82f0d1a1c317f9cc1e25bd013b",
    recommended: true,
    workflowIds: [...MOSS_IMAGE_WORKFLOW_IDS],
  }),
  variant({
    id: "moss-edit-lora",
    componentId: "moss-edit-lora",
    label: "MOSS-Image Edit LoRA (Rank 64)",
    description:
      "297 MB reference-image editing adapter used by the official MOSS-Image Edit workflow.",
    relativePath: "loras/moss_image_edit_lora_rank_64_bf16.safetensors",
    category: "lora",
    sizeBytes: 297382216,
    sha256: "17a48b8c605dcffdedb92a2b887d18cf316505be90802717669fb6556098dcdf",
    recommended: true,
    workflowIds: ["i2i_moss_image_edit"],
  }),
  variant({
    id: "moss-color-depth-lora",
    componentId: "moss-color-depth-lora",
    label: "MOSS-Image Color/Depth Control LoRA",
    description:
      "313 MB control adapter for flat color-region maps and depth maps.",
    relativePath: "loras/moss_image_color_depth_control.safetensors",
    category: "lora",
    sizeBytes: 313063368,
    sha256: "e5c0c3efd05e4269207a39de6005798f14c90c6687c89c54eaffe4b76c43a763",
    recommended: true,
    workflowIds: [
      "i2i_moss_image_color_control",
      "i2i_moss_image_depth_control",
    ],
  }),
];

export interface ScannedModel {
  installed: boolean;
  category: ModelCategory;
  name: string;
  relativePath: string;
  architecture?: ModelArchitecture;
}

const haystack = (model: ScannedModel): string =>
  `${model.name} ${model.relativePath}`.replace(/\\/g, "/").toLowerCase();

export interface MossDependencyStatus {
  dependency: MossImageDependency;
  installed: boolean;
  matchedModel: string | null;
}

export function mossDependencyStatus(
  models: ScannedModel[],
  workflowId: string = MOSS_IMAGE_WORKFLOW_ID
): MossDependencyStatus[] {
  const requiredIds = new Set(mossRequirementsFor(workflowId));
  return MOSS_IMAGE_DEPENDENCIES.filter(
    (dependency) => dependency.required || requiredIds.has(dependency.id)
  ).map((dependency) => {
    const match = models.find(
      (model) =>
        model.installed &&
        model.category === dependency.category &&
        (dependency.matches(haystack(model)) ||
          (dependency.id === "moss-sft" &&
            model.architecture === "moss_image" &&
            !isBaseDiffusion(haystack(model))) ||
          (dependency.id === "moss-base" &&
            model.architecture === "moss_image" &&
            isBaseDiffusion(haystack(model))))
    );
    return {
      dependency,
      installed: Boolean(match),
      matchedModel: match?.relativePath ?? null,
    };
  });
}

export function missingMossRequirements(
  models: ScannedModel[],
  workflowId: string = MOSS_IMAGE_WORKFLOW_ID
): string[] {
  const requiredIds = new Set(mossRequirementsFor(workflowId));
  return mossDependencyStatus(models, workflowId)
    .filter(
      (status) =>
        requiredIds.has(status.dependency.id) && !status.installed
    )
    .map((status) => status.dependency.label);
}

export function isMossWorkflowReady(
  models: ScannedModel[],
  workflowId: string = MOSS_IMAGE_WORKFLOW_ID
): boolean {
  return missingMossRequirements(models, workflowId).length === 0;
}

export function isMossImageModel(model: ScannedModel): boolean {
  return model.architecture === "moss_image" || haystack(model).includes("moss");
}

export type MossModelVariantKind =
  | "moss_sft"
  | "moss_base"
  | "moss_custom_finetune"
  | "moss_unknown"
  | "incompatible";

export interface MossVariantClassification {
  kind: MossModelVariantKind;
  label: string;
  compatible: boolean;
  reason?: string;
  recommendedWorkflowId: MossImageWorkflowId;
}

/**
 * Distinguishes official MOSS Base, MOSS SFT, community fine-tunes,
 * unverified checkpoints, and known incompatible architectures.
 */
export function classifyMossModel(
  model: {
    name: string;
    relativePath: string;
    architecture?: ModelArchitecture;
    metadata?: { architectureOverride?: ModelArchitecture | null } | null;
  },
  tensorKeys?: string[] | string | null
): MossVariantClassification {
  const effectiveArch = model.metadata?.architectureOverride || model.architecture;
  const h = `${model.name} ${model.relativePath}`.replace(/\\/g, "/").toLowerCase();

  // If architecture is explicitly not moss_image and no override
  if (effectiveArch && effectiveArch !== "moss_image") {
    return {
      kind: "incompatible",
      label: "Incompatible Architecture",
      compatible: false,
      reason: `Model architecture '${effectiveArch}' is incompatible with MOSS-Image loader pipeline.`,
      recommendedWorkflowId: "t2i_moss_image",
    };
  }

  // Check tensor keys if provided
  const keysStr = Array.isArray(tensorKeys) ? tensorKeys.join(" ").toLowerCase() : (tensorKeys?.toLowerCase() ?? "");
  const hasMossTensors =
    keysStr.includes("shared_block_modulation") ||
    keysStr.includes("layers.0.proj.ffn_up_gate") ||
    keysStr.includes("video_embedder");

  if (!effectiveArch) {
    if (hasMossTensors) {
      // Recognized via tensor signature despite missing metadata
      if (isBaseDiffusion(h)) {
        return {
          kind: "moss_base",
          label: "MOSS-Image Base",
          compatible: true,
          recommendedWorkflowId: "t2i_moss_image_base",
        };
      }
      if (isSftDiffusion(h)) {
        return {
          kind: "moss_sft",
          label: "MOSS-Image SFT",
          compatible: true,
          recommendedWorkflowId: "t2i_moss_image",
        };
      }
      return {
        kind: "moss_custom_finetune",
        label: "MOSS Custom Fine-tune",
        compatible: true,
        recommendedWorkflowId: "t2i_moss_image",
      };
    }

    if (h.includes("moss")) {
      return {
        kind: "moss_unknown",
        label: "Unknown MOSS Checkpoint",
        compatible: false,
        reason:
          "Filename contains 'MOSS' but safetensors tensor keys or architecture metadata have not been verified.",
        recommendedWorkflowId: "t2i_moss_image",
      };
    }

    return {
      kind: "incompatible",
      label: "Incompatible Model",
      compatible: false,
      reason: "Not recognized as a MOSS-Image compatible checkpoint.",
      recommendedWorkflowId: "t2i_moss_image",
    };
  }

  // At this point, effectiveArch === "moss_image"
  if (isBaseDiffusion(h)) {
    return {
      kind: "moss_base",
      label: "MOSS-Image Base",
      compatible: true,
      recommendedWorkflowId: "t2i_moss_image_base",
    };
  }

  if (isSftDiffusion(h)) {
    return {
      kind: "moss_sft",
      label: "MOSS-Image SFT",
      compatible: true,
      recommendedWorkflowId: "t2i_moss_image",
    };
  }

  // Community MOSS fine-tune or merge
  return {
    kind: "moss_custom_finetune",
    label: "MOSS Custom Fine-tune",
    compatible: true,
    recommendedWorkflowId: "t2i_moss_image",
  };
}

export type MossLoraTarget = "model_only" | "model_and_clip" | "incompatible";

export interface MossLoraClassification {
  target: MossLoraTarget;
  compatible: boolean;
  loaderType: "LoraLoaderModelOnly" | "LoraLoader";
  reason?: string;
}

/**
 * Architecture-aware MOSS LoRA classifier. Selects the appropriate ComfyUI
 * loader node (`LoraLoaderModelOnly` vs `LoraLoader`) based on adapter target modules.
 */
export function classifyMossLora(
  model: {
    name: string;
    relativePath: string;
    architecture?: ModelArchitecture;
  },
  tensorKeys?: string[] | string | null
): MossLoraClassification {
  if (model.architecture && model.architecture !== "moss_image" && model.architecture !== "unknown") {
    return {
      target: "incompatible",
      compatible: false,
      loaderType: "LoraLoaderModelOnly",
      reason: `LoRA architecture '${model.architecture}' is incompatible with MOSS-Image models.`,
    };
  }

  const keysStr = Array.isArray(tensorKeys) ? tensorKeys.join(" ").toLowerCase() : (tensorKeys?.toLowerCase() ?? "");
  const h = `${model.name} ${model.relativePath}`.replace(/\\/g, "/").toLowerCase();

  // If known keys exist and explicitly target text encoder / CLIP
  const hasClipKeys =
    keysStr.includes("lora_te") ||
    keysStr.includes("qwen") ||
    keysStr.includes("text_encoder") ||
    keysStr.includes("text_embedder");

  if (hasClipKeys) {
    return {
      target: "model_and_clip",
      compatible: true,
      loaderType: "LoraLoader",
    };
  }

  // Standard MOSS transformer LoRAs (and MOSS edit LoRA) target the diffusion model
  return {
    target: "model_only",
    compatible: model.architecture === "moss_image" || h.includes("moss"),
    loaderType: "LoraLoaderModelOnly",
  };
}

export interface MossLayoutValidationResult {
  valid: boolean;
  format: "full_layout" | "elements" | "invalid";
  error?: string;
  itemCount: number;
}

/**
 * Validates structured JSON for MOSS layout prompts. Supports both:
 * 1. Full MOSS Layout format (`summary` + `items` array with centralized coordinates)
 * 2. Bounding-box elements array (`[ { type, desc, bbox: [y0, x0, y1, x1] } ]`)
 */
export function validateMossLayoutJson(rawJson: string): MossLayoutValidationResult {
  const trimmed = rawJson.trim();
  if (!trimmed) {
    return { valid: true, format: "elements", itemCount: 0 };
  }

  try {
    const parsed = JSON.parse(trimmed);

    // Case 1: Full MOSS layout object
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      if (Array.isArray(parsed.items)) {
        for (let i = 0; i < parsed.items.length; i++) {
          const item = parsed.items[i];
          if (!item || typeof item !== "object") {
            return {
              valid: false,
              format: "invalid",
              error: `Item at index ${i} is not a valid object.`,
              itemCount: 0,
            };
          }
          if (!item.label || typeof item.label !== "string") {
            return {
              valid: false,
              format: "invalid",
              error: `Item at index ${i} is missing a string 'label' ("character" | "object" | "text").`,
              itemCount: 0,
            };
          }
          if (!Array.isArray(item.bbox) || item.bbox.length !== 4) {
            return {
              valid: false,
              format: "invalid",
              error: `Item at index ${i} ('${item.label}') must have a 4-number 'bbox' [y0, x0, y1, x1].`,
              itemCount: 0,
            };
          }
          if (!item.bbox.every((n: unknown) => typeof n === "number" && Number.isFinite(n))) {
            return {
              valid: false,
              format: "invalid",
              error: `Item at index ${i} has non-numeric coordinates in 'bbox'.`,
              itemCount: 0,
            };
          }
        }
        return {
          valid: true,
          format: "full_layout",
          itemCount: parsed.items.length,
        };
      }
    }

    // Case 2: Elements array
    if (Array.isArray(parsed)) {
      for (let i = 0; i < parsed.length; i++) {
        const el = parsed[i];
        if (!el || typeof el !== "object") {
          return {
            valid: false,
            format: "invalid",
            error: `Element at index ${i} is not a valid object.`,
            itemCount: 0,
          };
        }
        if (!Array.isArray(el.bbox) || el.bbox.length !== 4) {
          return {
            valid: false,
            format: "invalid",
            error: `Element at index ${i} must have a 4-number 'bbox' [y0, x0, y1, x1].`,
            itemCount: 0,
          };
        }
      }
      return {
        valid: true,
        format: "elements",
        itemCount: parsed.length,
      };
    }

    return {
      valid: false,
      format: "invalid",
      error: "Expected either a MOSS layout object with 'items' array or an array of bounding box elements.",
      itemCount: 0,
    };
  } catch (err) {
    return {
      valid: false,
      format: "invalid",
      error: `Invalid JSON syntax: ${err instanceof Error ? err.message : String(err)}`,
      itemCount: 0,
    };
  }
}
