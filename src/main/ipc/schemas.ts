import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { z } from "zod";
import type { AppSettings, ModelRecord } from "../../shared/types";
import {
  DEFAULT_PACKAGE_OUTPUTS,
  DEFAULT_SHEET_LAYOUT,
} from "../../shared/pixel-package-types";
import type { CivitaiClient } from "../civitai/civitai-client";
import type { CivitaiDownloadManager } from "../civitai/download-manager";
import type { CivitaiKeyStore } from "../civitai/secure-key-store";
import type { ComfyRuntimeManager } from "../comfy/runtime-manager";
import type { StudioRepository } from "../db/repositories";
import type { DownloadManager } from "../downloads/download-manager";
import type { HuggingFaceTokenStore } from "../huggingface/token-store";
import type { HuggingFaceService } from "../huggingface/hf-service";
import type { JobOrchestrator } from "../jobs/job-orchestrator";
import type { StudioLogger } from "../logger";
import type { ModelScanner } from "../models/model-scanner";
import type { StudioPaths } from "../paths";
import { PIXEL_ASSET_ID_PATTERN } from "../pixel/pixel-export-path";
import { isAllowedLoopbackHost } from "../security";
import type { UpdateService } from "../updater/update-service";

export const RuntimeModeSchema = z.enum(["external", "managed"]);
export const UpdateChannelSchema = z.enum(["stable", "prerelease"]);
export const PerformanceProfileSchema = z.enum(["balanced", "quality", "memory_saver"]);
export const OutputFormatSchema = z.enum(["png", "jpeg", "webp"]);
export const NavSectionSchema = z.enum([
  "home",
  "explore",
  "create",
  "video",
  "library",
  "characters",
  "stories",
  "pixel",
  "models",
  "workflows",
  "queue",
  "settings",
]);
export const ModelCategorySchema = z.enum([
  "checkpoint",
  "lora",
  "vae",
  "embedding",
  "controlnet",
  "upscale",
  "diffusion_model",
  "text_encoder",
]);

export const ModelArchitectureSchema = z.enum([
  "sd15",
  "sdxl",
  "illustrious",
  "pony",
  "flux",
  "z_image",
  "anima",
  "moss_image",
  "krea2",
  "ltx_video",
  "wan_video",
  "unknown",
]);

export const ModelMetadataPatchSchema = z
  .object({
    displayName: z.string().max(200).nullable().optional(),
    description: z.string().max(10000).optional(),
    architectureOverride: ModelArchitectureSchema.nullable().optional(),
    baseModel: z.string().max(200).nullable().optional(),
    previewMode: z.enum(["auto", "custom", "none"]).optional(),
    previewPath: z.string().max(1024).nullable().optional(),
    triggerWords: z.array(z.string().max(200)).max(64).optional(),
    tags: z.array(z.string().max(64)).max(32).optional(),
    notes: z.string().max(10000).optional(),
    favorite: z.boolean().optional(),
  })
  .strict();

export const LoraRecipeSettingsSchema = z
  .object({
    aspectRatio: z.string().max(32).optional(),
    width: z.number().int().min(64).max(4096).optional(),
    height: z.number().int().min(64).max(4096).optional(),
    steps: z.number().int().min(1).max(150).optional(),
    cfg: z.number().min(0.5).max(30).optional(),
    sampler: z.string().max(100).optional(),
    scheduler: z.string().max(100).optional(),
    seed: z.number().int().min(-1).max(4294967295).optional(),
    denoise: z.number().min(0.05).max(1.0).optional(),
    batchCount: z.number().int().min(1).max(8).optional(),
    outputFormat: z.enum(["png", "jpeg", "webp"]).optional(),
  })
  .strict();

export const LoraRecipeItemInputSchema = z
  .object({
    loraPath: z.string().min(1).max(1024),
    loraName: z.string().max(512).optional(),
    architecture: ModelArchitectureSchema.optional(),
    strengthModel: z.number().min(-2).max(2).optional(),
    strengthClip: z.number().min(-2).max(2).optional(),
    enabled: z.boolean().optional(),
    triggerWords: z.array(z.string().max(200)).max(64).optional(),
  })
  .strict();

export const LoraRecipeInputSchema = z
  .object({
    id: z.string().max(64).optional(),
    name: z.string().min(1).max(200),
    description: z.string().max(5000).optional(),
    mode: z.enum(["txt2img", "img2img", "upscale"]).optional(),
    workflowId: z.string().max(100).nullable().optional(),
    architecture: ModelArchitectureSchema.optional(),
    checkpointPath: z.string().max(1024).nullable().optional(),
    checkpointName: z.string().max(512).nullable().optional(),
    basePrompt: z.string().max(10000).optional(),
    negativePrompt: z.string().max(10000).optional(),
    settings: LoraRecipeSettingsSchema.optional(),
    coverImagePath: z.string().max(1024).nullable().optional(),
    tags: z.array(z.string().max(64)).max(32).optional(),
    favorite: z.boolean().optional(),
    items: z.array(LoraRecipeItemInputSchema).max(16),
  })
  .strict();

export const PartialSettingsSchema = z
  .object({
    runtimeMode: RuntimeModeSchema.optional(),
    externalComfyPath: z.string().max(1024).optional(),
    comfyHost: z
      .string()
      .refine((v) => isAllowedLoopbackHost(v), "Only loopback ComfyUI hosts are permitted.")
      .optional(),
    comfyPort: z.number().int().min(1024).max(65535).optional(),
    pixelBackendHost: z
      .string()
      .refine((v) => isAllowedLoopbackHost(v), "Only loopback Pixel backend hosts are permitted.")
      .optional(),
    pixelBackendPort: z.number().int().min(1024).max(65535).optional(),
    pixelBackendWorkflowRoot: z.string().max(1024).optional(),
    managedComfyPath: z.string().max(1024).optional(),
    autoStartRuntime: z.boolean().optional(),
    outputDirectory: z.string().min(1).max(1024).optional(),
    extraModelDirs: z.array(z.string().max(1024)).max(24).optional(),
    downloadDirectory: z.string().min(1).max(1024).optional(),
    cacheDirectory: z.string().min(1).max(1024).optional(),
    tempDirectory: z.string().min(1).max(1024).optional(),
    performanceProfile: PerformanceProfileSchema.optional(),
    maxActiveJobs: z.number().int().min(1).max(2).optional(),
    defaultBatchSize: z.number().int().min(1).max(4).optional(),
    enableMemoryWarnings: z.boolean().optional(),
    theme: z.enum(["dark", "light", "system"]).optional(),
    galleryLayout: z.enum(["comfortable", "compact"]).optional(),
    startupPage: NavSectionSchema.optional(),
    defaultSampler: z.string().min(1).max(100).optional(),
    defaultScheduler: z.string().min(1).max(100).optional(),
    defaultSteps: z.number().int().min(1).max(150).optional(),
    defaultCfg: z.number().min(0.5).max(30).optional(),
    defaultOutputFormat: OutputFormatSchema.optional(),
    checkUpdatesAutomatically: z.boolean().optional(),
    nsfwFilter: z.boolean().optional(),
  })
  .strict();

export const LoraSelectionSchema = z.object({
  name: z.string().min(1).max(512),
  strengthModel: z.number().min(-2).max(2),
  strengthClip: z.number().min(-2).max(2),
});

export const HiresFixSchema = z.object({
  enabled: z.boolean(),
  upscaler: z.string().min(1).max(512),
  scale: z.number().min(1.1).max(2.5),
  steps: z.number().int().min(1).max(60),
  denoise: z.number().min(0.05).max(0.95),
  pipeline: z.enum(["latent", "refiner"]).optional(),
  creativity: z.number().min(0.05).max(1.0).optional(),
});

export const UpscaleConfigSchema = z.object({
  upscaler: z.string().max(512),
  scale: z.number().min(1.25).max(4.0),
  pipeline: z.enum(["crisp", "refiner"]).optional(),
  preset: z
    .enum(["anime_crisp", "universal_ultrasharp", "smooth_illustration"])
    .optional(),
  creativity: z.number().min(0.05).max(1.0).optional(),
  steps: z.number().int().min(1).max(80).optional(),
  checkpoint: z.string().max(512).nullable().optional(),
});

export const VideoGenerationSettingsSchema = z.object({
  fps: z.number().min(1).max(120),
  frameCount: z.number().int().min(1).max(1000),
  durationSeconds: z.number().min(0.1).max(120),
  format: z.enum(["mp4", "webm"]),
});

export const GenerationRequestSchema = z.object({
  workflowId: z.string().min(1).max(100),
  mode: z.enum(["txt2img", "img2img", "upscale", "t2v", "i2v"]),
  prompt: z.string().max(10000),
  negativePrompt: z.string().max(10000),
  checkpoint: z.string().max(512),
  vae: z.string().max(512).nullable(),
  loras: z.array(LoraSelectionSchema).max(16),
  aspectRatio: z.string().min(1).max(32),
  width: z.number().int().min(64).max(4096),
  height: z.number().int().min(64).max(4096),
  steps: z.number().int().min(1).max(150),
  cfg: z.number().min(0.5).max(30),
  sampler: z.string().min(1).max(100),
  scheduler: z.string().min(1).max(100),
  seed: z.number().int().min(-1).max(4294967295),
  randomSeed: z.boolean(),
  batchCount: z.number().int().min(1).max(8),
  batchSize: z.number().int().min(1).max(4),
  outputFormat: OutputFormatSchema,
  inputImagePath: z.string().max(1024).nullable(),
  denoise: z.number().min(0.05).max(1.0),
  maskDataUrl: z.string().max(20000000).nullable().optional(),
  maskPath: z.string().max(1024).nullable().optional(),
  maskGrowBy: z.number().int().min(0).max(64).optional(),
  outpaintPadding: z
    .object({
      top: z.number().int().min(0).max(4096),
      bottom: z.number().int().min(0).max(4096),
      left: z.number().int().min(0).max(4096),
      right: z.number().int().min(0).max(4096),
    })
    .nullable()
    .optional(),
  layoutJson: z.string().max(100000).nullable().optional(),
  video: VideoGenerationSettingsSchema.optional(),
  hiresFix: HiresFixSchema.optional(),
  upscale: UpscaleConfigSchema.optional(),
  characterId: z.string().max(64).nullable().optional(),
  loraRecipeId: z.string().max(64).nullable().optional(),
  storyId: z.string().max(64).nullable().optional(),
  storySceneId: z.string().max(64).nullable().optional(),
});

export const WorkflowImportUrlSchema = z.object({
  url: z.string().trim().min(8).max(2048),
  allowCivitaiRedirect: z.boolean().optional(),
});

export const WorkflowImportInstallSchema = z.object({
  previewId: z.string().min(8).max(128),
});

export const WorkflowImportRevealSchema = z.object({
  filePath: z.string().min(1).max(2048),
});

export const WorkflowInstalledFileSchema = z.object({
  filePath: z.string().min(1).max(2048),
});

export const LibraryFiltersSchema = z
  .object({
    search: z.string().max(200).optional(),
    favoriteOnly: z.boolean().optional(),
    collectionId: z.string().max(100).nullable().optional(),
    sortBy: z.enum(["newest", "oldest", "name"]).optional(),
  })
  .optional();

export const LibraryMediaQuerySchema = z
  .object({
    mediaType: z.enum(["all", "image", "video", "pixel", "character", "animation"]).optional(),
    search: z.string().max(200).optional(),
    favoriteOnly: z.boolean().optional(),
    collectionId: z.string().max(100).nullable().optional(),
    sortBy: z.enum(["newest", "oldest", "name"]).optional(),
    model: z.string().max(200).optional(),
    aspectRatio: z.enum(["all", "landscape", "portrait", "square"]).optional(),
  })
  .strict()
  .optional();

export const LibraryBatchDeleteSchema = z.array(z.string().min(1).max(256)).max(500);

export const LibraryBatchExportSchema = z
  .object({
    ids: z.array(z.string().min(1).max(256)).max(500),
    destinationDir: z.string().min(1).max(1024),
  })
  .strict();

export const LibraryBatchSetCollectionSchema = z
  .object({
    ids: z.array(z.string().min(1).max(256)).max(500),
    collectionId: z.string().max(100).nullable(),
  })
  .strict();

export const LibraryBatchFavoriteSchema = z
  .object({
    ids: z.array(z.string().min(1).max(256)).max(500),
    favorite: z.boolean(),
  })
  .strict();

export const CharacterReferenceRoleSchema = z.enum([
  "primary",
  "secondary",
  "expression",
  "outfit",
  "pose",
]);

export const CharacterReferenceCategorySchema = z.enum([
  "canonical_face",
  "front_view",
  "three_quarter",
  "side_profile",
  "full_body",
  "expression",
  "pose",
  "clothing_variant",
  "approved_artwork",
  "other",
]);

export const CharacterReferenceApprovalSchema = z.enum([
  "approved",
  "pending",
  "rejected",
]);

export const VisualTagCategorySchema = z.enum([
  "identity",
  "clothing",
  "pose_expression",
  "environment",
]);

export const VisualTagApprovalSchema = z.enum([
  "approved",
  "rejected",
  "pending",
]);

export const VisualTagSchema = z
  .object({
    id: z.string().min(1).max(64),
    tag: z.string().min(1).max(200),
    category: VisualTagCategorySchema,
    confidence: z.number().min(0).max(1),
    approvalStatus: VisualTagApprovalSchema,
    source: z.enum(["wd14_neural", "visual_heuristic", "manual"]),
  })
  .strict();

export const CharacterReferenceCropInputSchema = z
  .object({
    left: z.number().int().min(0),
    top: z.number().int().min(0),
    width: z.number().int().min(1),
    height: z.number().int().min(1),
    category: CharacterReferenceCategorySchema.optional(),
    caption: z.string().max(500).optional(),
  })
  .strict();

export const CharacterIdentityCoreSchema = z
  .object({
    triggerToken: z.string().max(200).optional(),
    gender: z.string().max(100).optional(),
    ageCategory: z.string().max(100).optional(),
    species: z.string().max(100).optional(),
    archetype: z.string().max(100).optional(),
    hairColor: z.string().max(100).optional(),
    hairStyle: z.string().max(200).optional(),
    eyeColor: z.string().max(100).optional(),
    skinTone: z.string().max(100).optional(),
    facialCharacteristics: z.string().max(1000).optional(),
    distinctiveFeatures: z.array(z.string().max(200)).max(64).optional(),
    bodyCharacteristics: z.string().max(1000).optional(),
    signatureAccessories: z.array(z.string().max(200)).max(64).optional(),
    canonicalDescription: z.string().max(5000).optional(),
    fixedTraits: z.array(z.string().max(200)).max(64).optional(),
    variableTraits: z.array(z.string().max(200)).max(64).optional(),
    preferredStyle: z.string().max(200).optional(),
    negativeConstraints: z.string().max(5000).optional(),
    dnaLocked: z.boolean().optional(),
  })
  .strict();

export const CharacterKnowledgeSchema = z
  .object({
    personality: z.string().max(2000).optional(),
    speechStyle: z.string().max(1000).optional(),
    background: z.string().max(5000).optional(),
    history: z.string().max(5000).optional(),
    relationships: z
      .array(
        z.object({
          target: z.string().max(200),
          relation: z.string().max(100),
          notes: z.string().max(1000),
        })
      )
      .max(32)
      .optional(),
    motivations: z.string().max(2000).optional(),
    likes: z.array(z.string().max(200)).max(64).optional(),
    dislikes: z.array(z.string().max(200)).max(64).optional(),
    rules: z.array(z.string().max(500)).max(64).optional(),
    worldbuilding: z.string().max(5000).optional(),
    dialogueExamples: z
      .array(
        z.object({
          context: z.string().max(500),
          quote: z.string().max(1000),
        })
      )
      .max(32)
      .optional(),
  })
  .strict();

export const CharacterOutfitInputSchema = z
  .object({
    id: z.string().max(64).optional(),
    characterId: z.string().min(1).max(64),
    name: z.string().trim().min(1).max(200),
    description: z.string().max(2000).optional(),
    promptTokens: z.array(z.string().max(200)).max(64).optional(),
    isDefault: z.boolean().optional(),
    previewImagePath: z.string().nullable().optional(),
  })
  .strict();

export const CharacterAdapterInputSchema = z
  .object({
    id: z.string().max(64).optional(),
    characterId: z.string().min(1).max(64),
    baseModelFamily: z.string().min(1).max(100),
    checkpointPath: z.string().nullable().optional(),
    checkpointName: z.string().nullable().optional(),
    triggerToken: z.string().min(1).max(200),
    fileLocation: z.string().min(1),
    datasetVersion: z.string().nullable().optional(),
    rank: z.number().int().min(1).max(256).optional(),
    alpha: z.number().min(1).max(256).optional(),
    recommendedStrength: z.number().min(0).max(2).optional(),
    status: z.enum(["trained", "validating", "active", "disabled"]).optional(),
  })
  .strict();

export const CharacterTrainingConfigSchema = z
  .object({
    baseModelFamily: z.enum(["sdxl", "illustrious", "pony"]),
    baseCheckpointPath: z.string().min(1).max(1024),
    triggerToken: z.string().min(1).max(200),
    datasetId: z.string().optional(),
    datasetVersion: z.string().optional(),
    rank: z.number().int().min(1).max(256),
    alpha: z.number().min(1).max(256),
    learningRate: z.number().positive(),
    epochs: z.number().int().min(1).max(1000),
    batchSize: z.number().int().min(1).max(32),
    resolution: z.number().int().min(256).max(2048),
    gradientAccumulationSteps: z.number().int().min(1).max(64).optional(),
    gradientCheckpointing: z.boolean().optional(),
    precision: z.enum(["fp16", "bf16", "fp32"]).optional(),
    outputDirectory: z.string().min(1).max(1024).optional(),
    saveEveryNEpochs: z.number().int().min(1).max(1000).optional(),
  })
  .strict();

export const CharacterReferenceUpdateInputSchema = z
  .object({
    id: z.string().min(1).max(64),
    role: CharacterReferenceRoleSchema.optional(),
    caption: z.string().max(500).optional(),
    weight: z.number().min(0).max(1).optional(),
    category: CharacterReferenceCategorySchema.optional(),
    approvalStatus: CharacterReferenceApprovalSchema.optional(),
    associatedOutfitId: z.string().nullable().optional(),
    includedInTraining: z.boolean().optional(),
    suggestedTags: z.array(VisualTagSchema).optional(),
    imageHash: z.string().nullable().optional(),
  })
  .strict();

export const CharacterProfileInputSchema = z
  .object({
    id: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/, "Invalid character identifier.")
      .optional(),
    name: z.string().trim().min(1).max(200),
    description: z.string().max(10000).optional(),
    appearance: z.string().max(5000).optional(),
    clothing: z.string().max(5000).optional(),
    promptPrefix: z.string().max(5000).optional(),
    negativePrompt: z.string().max(10000).optional(),
    triggerWords: z.array(z.string().max(200)).max(64).optional(),
    architecture: ModelArchitectureSchema.optional(),
    checkpointPath: z.string().max(1024).nullable().optional(),
    checkpointName: z.string().max(512).nullable().optional(),
    loraRecipeId: z.string().max(64).nullable().optional(),
    referenceMode: z.enum(["none", "img2img", "ipadapter", "controlnet"]).optional(),
    referenceWeight: z.number().min(0).max(1).optional(),
    referenceStart: z.number().min(0).max(1).optional(),
    referenceEnd: z.number().min(0).max(1).optional(),
    tags: z.array(z.string().max(64)).max(32).optional(),
    favorite: z.boolean().optional(),
    references: z.array(CharacterReferenceUpdateInputSchema).max(32).optional(),

    // Character DNA
    dna: CharacterIdentityCoreSchema.partial().optional(),
    knowledge: CharacterKnowledgeSchema.partial().optional(),
    activeAdapterId: z.string().max(64).nullable().optional(),
    activeOutfitId: z.string().max(64).nullable().optional(),
  })
  .strict();

export const CharacterProfilePatchSchema = CharacterProfileInputSchema.extend({
  id: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/, "Invalid character identifier."),
  name: z.string().trim().min(1).max(200).optional(),
}).strict();

export const CharacterReferencePatchSchema = z
  .object({
    role: CharacterReferenceRoleSchema.optional(),
    caption: z.string().max(500).optional(),
    weight: z.number().min(0).max(1).optional(),
    category: CharacterReferenceCategorySchema.optional(),
    approvalStatus: CharacterReferenceApprovalSchema.optional(),
    associatedOutfitId: z.string().nullable().optional(),
    includedInTraining: z.boolean().optional(),
    suggestedTags: z.array(VisualTagSchema).optional(),
    imageHash: z.string().nullable().optional(),
  })
  .strict();

export const StoryStatusSchema = z.enum(["draft", "in_progress", "complete"]);
export const StoryCastRoleSchema = z.enum(["lead", "supporting", "cameo"]);
export const StoryCastInputSchema = z
  .object({
    characterId: z.string().min(1).max(64),
    storyRole: StoryCastRoleSchema.optional(),
  })
  .strict();

export const StoryInputSchema = z
  .object({
    id: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/, "Invalid story identifier.")
      .optional(),
    title: z.string().trim().min(1).max(200),
    logline: z.string().max(5000).optional(),
    stylePrompt: z.string().max(10000).optional(),
    negativePrompt: z.string().max(10000).optional(),
    defaultCharacterId: z.string().max(64).nullable().optional(),
    defaultCheckpointPath: z.string().max(1024).nullable().optional(),
    defaultLoraRecipeId: z.string().max(64).nullable().optional(),
    coverSceneId: z.string().max(64).nullable().optional(),
    status: StoryStatusSchema.optional(),
    tags: z.array(z.string().max(64)).max(32).optional(),
    favorite: z.boolean().optional(),
    cast: z.array(StoryCastInputSchema).max(64).optional(),
  })
  .strict();

export const StorySceneCastInputSchema = z
  .object({
    characterId: z.string().min(1).max(64),
    roleHint: z.string().max(200).optional(),
  })
  .strict();

export const CanvasTemplateSchema = z.enum([
  "grid_2x3",
  "grid_3x3",
  "filmstrip",
  "freeform",
]);
export const CanvasPageSizeSchema = z.enum([
  "a4_portrait",
  "a4_landscape",
  "letter",
  "square",
  "custom",
]);
export const CanvasCaptionModeSchema = z.enum([
  "none",
  "scene_title",
  "synopsis",
  "prompt",
]);
export const CanvasOverlayKindSchema = z.enum([
  "speech",
  "thought",
  "narration",
  "text",
]);
export const CanvasOverlaySchema = z
  .object({
    id: z.string().min(1).max(64),
    kind: CanvasOverlayKindSchema,
    speaker: z.string().max(200).optional(),
    text: z.string().trim().min(1).max(2000),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  })
  .strict();
export const StoryCanvasInputSchema = z
  .object({
    id: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/, "Invalid canvas identifier.")
      .optional(),
    storyId: z.string().min(1).max(64),
    name: z.string().trim().min(1).max(200),
    template: CanvasTemplateSchema.optional(),
    pageSize: CanvasPageSizeSchema.optional(),
    pageWidth: z.number().int().min(320).max(4096).optional(),
    pageHeight: z.number().int().min(320).max(4096).optional(),
    margin: z.number().int().min(0).max(240).optional(),
    gutter: z.number().int().min(0).max(120).optional(),
    background: z
      .string()
      .regex(/^#[0-9a-f]{3,6}$/i, "Background must be a hex color.")
      .optional(),
    captionMode: CanvasCaptionModeSchema.optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export const StoryCanvasItemInputSchema = z
  .object({
    id: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/, "Invalid panel identifier.")
      .optional(),
    canvasId: z.string().min(1).max(64),
    sceneId: z.string().min(1).max(64).nullable().optional(),
    imageId: z.string().min(1).max(100).nullable().optional(),
    position: z.number().int().min(0).max(1000).optional(),
    x: z.number().min(0).max(1).nullable().optional(),
    y: z.number().min(0).max(1).nullable().optional(),
    width: z.number().min(0.02).max(1).nullable().optional(),
    height: z.number().min(0.02).max(1).nullable().optional(),
    fit: z.enum(["cover", "contain"]).optional(),
    captionOverride: z.string().max(500).optional(),
    overlays: z.array(CanvasOverlaySchema).max(24).optional(),
  })
  .strict();

export const StorySceneInputSchema = z
  .object({
    id: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/, "Invalid scene identifier.")
      .optional(),
    storyId: z.string().min(1).max(64),
    title: z.string().max(200).optional(),
    synopsis: z.string().max(5000).optional(),
    prompt: z.string().max(10000).optional(),
    negativePrompt: z.string().max(10000).optional(),
    checkpointPath: z.string().max(1024).nullable().optional(),
    loraRecipeId: z.string().max(64).nullable().optional(),
    aspectRatio: z.string().max(32).nullable().optional(),
    width: z.number().int().min(64).max(4096).nullable().optional(),
    height: z.number().int().min(64).max(4096).nullable().optional(),
    steps: z.number().int().min(1).max(150).nullable().optional(),
    cfg: z.number().min(0.5).max(30).nullable().optional(),
    sampler: z.string().max(100).nullable().optional(),
    scheduler: z.string().max(100).nullable().optional(),
    seed: z.number().int().min(-1).max(4294967295).optional(),
    denoise: z.number().min(0.05).max(1.0).nullable().optional(),
    referenceModeOverride: z
      .enum(["none", "img2img", "ipadapter", "controlnet"])
      .nullable()
      .optional(),
    batchCount: z.number().int().min(1).max(8).optional(),
    cast: z.array(StorySceneCastInputSchema).max(64).optional(),
  })
  .strict();

export const CivitaiSearchSchema = z
  .object({
    query: z.string().max(200).optional(),
    type: z.string().trim().max(100).nullable().optional(),
    types: z.string().trim().max(100).nullable().optional(),
    baseModel: z.string().trim().max(120).nullable().optional(),
    baseModels: z
      .union([
        z.string().trim().max(120),
        z.array(z.string().trim().max(120)),
      ])
      .nullable()
      .optional(),
    tag: z.string().trim().max(100).nullable().optional(),
    page: z.number().int().min(1).optional(),
    sort: z
      .enum([
        "Most Downloaded",
        "Most Liked",
        "Most Discussed",
        "Highest Rated",
        "Newest",
      ])
      .optional(),
    period: z.enum(["Day", "Week", "Month", "Year", "AllTime"]).optional(),
    nsfw: z.boolean().optional(),
    cursor: z.string().max(2048).nullable().optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

export const CivitaiStartDownloadSchema = z
  .object({
    modelId: z.number().int().positive(),
    versionId: z.number().int().positive(),
    targetArchitecture: z.string().optional(),
  })
  .strict();

export const HuggingFaceRepoIdSchema = z.string().trim().min(3).max(220);
export const HuggingFaceRevisionSchema = z.string().trim().max(120).optional();

export const HuggingFaceSearchSchema = z
  .object({
    query: z.string().max(200).optional(),
    task: z.enum(["all", "text-to-video", "image-to-video"]).optional(),
    architecture: z.enum(["all", "wan_video", "ltx_video", "other"]).optional(),
    sort: z.enum(["downloads", "likes", "lastModified"]).optional(),
    limit: z.number().int().min(1).max(50).optional(),
    cursor: z.string().max(4096).nullable().optional(),
  })
  .strict();

export const HuggingFaceRepoRequestSchema = z
  .object({
    repoId: HuggingFaceRepoIdSchema,
    revision: HuggingFaceRevisionSchema,
  })
  .strict();

export const HuggingFaceCompatibilityRequestSchema = z
  .object({
    repoId: HuggingFaceRepoIdSchema,
    revision: HuggingFaceRevisionSchema,
    selectedPaths: z.array(z.string().min(1).max(512)).min(1).max(64),
  })
  .strict();

export const HuggingFaceStartFileSchema = z
  .object({
    path: z.string().min(1).max(512),
    category: ModelCategorySchema,
  })
  .strict();

export const HuggingFaceStartRequestSchema = z
  .object({
    repoId: HuggingFaceRepoIdSchema,
    revision: HuggingFaceRevisionSchema,
    files: z.array(HuggingFaceStartFileSchema).min(1).max(32),
    acknowledgeConditional: z.boolean().optional(),
    override: z.boolean().optional(),
  })
  .strict();

export const HuggingFaceTokenSchema = z.string().max(512);

export const CivitaiWorkflowSearchSchema = z
  .object({
    query: z.string().max(200).optional(),
    category: z
      .enum([
        "image-generation",
        "image-editing",
        "inpainting",
        "upscaling",
        "animation",
        "video-generation",
        "other",
      ])
      .nullable()
      .optional(),
    sort: z
      .enum(["Most Downloaded", "Highest Rated", "Newest"])
      .optional(),
    nsfw: z.boolean().optional(),
    cursor: z.string().max(2048).nullable().optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

export const CivitaiWorkflowIdSchema = z.number().int().positive();

export const CivitaiWorkflowImportSchema = z
  .object({
    modelId: z.number().int().positive(),
    versionId: z.number().int().positive(),
  })
  .strict();

export const PixelKindSchema = z.enum([
  "character",
  "creature",
  "weapon",
  "item",
  "object",
  "tileset",
  "environment",
  "effect",
]);

export const PixelPaletteIdSchema = z.enum(["kirea", "ember", "forest", "neon", "mono"]);
export const PixelDirectionSchema = z.enum(["front", "back", "side"]);
export const PixelExportFormatSchema = z.enum([
  "png",
  "sheet",
  "gif",
  "apng",
  "zip",
  "godot",
  "unity",
  "phaser",
]);
export const PixelIdSchema = z.string().min(1).max(64);
export const PixelFrameIdSchema = z
  .string()
  .regex(PIXEL_ASSET_ID_PATTERN, "Invalid pixel frame identifier.");

export const PixelProjectInputSchema = z
  .object({
    id: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/, "Invalid pixel project identifier.")
      .optional(),
    name: z.string().trim().min(1).max(120),
    description: z.string().max(2000).optional(),
    width: z.number().int().min(8).max(256).optional(),
    height: z.number().int().min(8).max(256).optional(),
  })
  .strict();

export const PixelCharacterInputSchema = z
  .object({
    id: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/, "Invalid pixel character identifier.")
      .optional(),
    projectId: PixelIdSchema,
    name: z.string().trim().min(1).max(120),
    description: z.string().max(4000).optional(),
    seed: z.number().int().min(-1).max(4294967295).optional(),
    paletteId: PixelPaletteIdSchema.optional(),
    referenceAssetId: z.string().max(64).nullable().optional(),
  })
  .strict();

export const PixelGenerateSchema = z
  .object({
    projectId: PixelIdSchema,
    characterId: z.string().max(64).nullable().optional(),
    kind: PixelKindSchema,
    name: z.string().trim().min(1).max(120),
    width: z.number().int().min(8).max(256),
    height: z.number().int().min(8).max(256),
    paletteId: PixelPaletteIdSchema,
    seed: z.number().int().min(-1).max(4294967295),
    direction: PixelDirectionSchema.optional(),
    prompt: z.string().max(4000).optional(),
  })
  .strict();

export const PixelImportSchema = z
  .object({
    projectId: PixelIdSchema,
    imageId: z.string().min(1).max(100),
    name: z.string().trim().min(1).max(120),
    width: z.number().int().min(8).max(256),
    height: z.number().int().min(8).max(256),
    paletteId: PixelPaletteIdSchema,
    transparent: z.boolean().optional(),
  })
  .strict();

export const PixelFrameInputSchema = z
  .object({
    id: PixelFrameIdSchema.optional(),
    index: z.number().int().min(0).max(255),
    name: z.string().trim().min(1).max(60),
    durationMs: z.number().int().min(1).max(60000),
    dataUrl: z
      .string()
      .max(16_000_000)
      .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, "Frame must be a base64 PNG."),
  })
  .strict();

export const PixelSaveFramesSchema = z
  .object({
    assetId: PixelIdSchema,
    frames: z.array(PixelFrameInputSchema).min(1).max(256),
    width: z.number().int().min(8).max(256).optional(),
    height: z.number().int().min(8).max(256).optional(),
    palette: z
      .array(z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/))
      .min(1)
      .max(64)
      .optional(),
  })
  .strict();

export const PixelSavePaletteSchema = z
  .object({
    assetId: PixelIdSchema,
    palette: z
      .array(z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/))
      .min(1)
      .max(64),
  })
  .strict();

export const PixelPaletteRecordSchema = z
  .object({
    id: PixelIdSchema.optional(),
    name: z.string().trim().min(1).max(80),
    colors: z
      .array(z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/))
      .min(1)
      .max(64),
  })
  .strict();

export const PixelVersionRequestSchema = z
  .object({
    assetId: PixelIdSchema,
    version: z.number().int().min(1).max(100000),
  })
  .strict();

export const PixelSaveAnimationsSchema = z
  .object({
    assetId: PixelIdSchema,
    animations: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(60),
            frames: z.array(z.string().trim().min(1).max(60)).min(1).max(256),
            loop: z.boolean(),
          })
          .strict()
      )
      .min(1)
      .max(64),
  })
  .strict();

export const PixelExportRequestSchema = z
  .object({
    assetId: PixelIdSchema,
    format: PixelExportFormatSchema,
    options: z
      .object({
        scale: z.number().int().min(1).max(8).optional(),
        animation: z.string().max(60).optional(),
        frameIndex: z.number().int().min(0).max(255).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const PixelPackageLayoutSchema = z
  .object({
    columns: z.number().int().min(0).max(256),
    rows: z.number().int().min(0).max(256),
    padding: z.number().int().min(0).max(64),
    spacing: z.number().int().min(0).max(64),
    extrude: z.number().int().min(0).max(8),
    trim: z.boolean(),
    uniformFrames: z.boolean(),
    maxSize: z.number().int().min(64).max(16384),
  })
  .strict();

export const PixelPackageOutputsSchema = z
  .object({
    frames: z.boolean(),
    stills: z.boolean(),
    combinedSheet: z.boolean(),
    animationSheets: z.boolean(),
    directionSheets: z.boolean(),
    gif: z.boolean(),
    apng: z.boolean(),
  })
  .strict();

export const PixelPackageRequestSchema = z
  .object({
    jobId: z.string().uuid().optional(),
    scope: z.enum(["asset", "animation", "character", "project"]),
    projectId: PixelIdSchema.optional(),
    characterId: PixelIdSchema.optional(),
    assetId: PixelIdSchema.optional(),
    animation: z.string().trim().min(1).max(60).optional(),
    version: z.number().int().min(1).max(100000).optional(),
    preset: z.enum(["generic", "godot", "unity", "phaser"]).default("generic"),
    container: z.enum(["zip", "folder"]).default("zip"),
    scale: z.number().int().min(1).max(8).default(1),
    layout: PixelPackageLayoutSchema.default({ ...DEFAULT_SHEET_LAYOUT }),
    outputs: PixelPackageOutputsSchema.default({ ...DEFAULT_PACKAGE_OUTPUTS }),
    background: z
      .string()
      .regex(/^#[0-9a-f]{6}$/, "Background must be a #rrggbb colour.")
      .nullable()
      .default(null),
    pivot: z.enum(["center", "bottom-center", "top-left"]).default("bottom-center"),
    pixelsPerUnit: z.number().int().min(1).max(10000).default(100),
    destination: z.string().max(1024).nullable().default(null),
  })
  .strict();

export const PixelPackageJobSchema = z.string().uuid();

export const PixelPackageRevealSchema = z.string().trim().min(1).max(1024);

export const PixelAssetFiltersSchema = z
  .object({
    projectId: PixelIdSchema.optional(),
    characterId: PixelIdSchema.optional(),
    kind: PixelKindSchema.optional(),
    search: z.string().max(120).optional(),
  })
  .strict()
  .optional();

const PixelAiImageInputSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("asset"),
      assetId: PixelIdSchema,
      frameIndex: z.number().int().min(0).max(255).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("dataUrl"),
      dataUrl: z
        .string()
        .max(28_000_000)
        .regex(
          /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/,
          "Images must be PNG, JPEG or WebP data URLs."
        ),
      fileName: z.string().max(255).optional(),
    })
    .strict(),
]);

const PixelAiInpaintRegionSchema = z
  .object({
    x: z.number().int().min(0).max(255),
    y: z.number().int().min(0).max(255),
    width: z.number().int().min(1).max(256),
    height: z.number().int().min(1).max(256),
    grow: z.number().int().min(0).max(8).optional(),
  })
  .strict();

export const PixelAiGenerateSchema = z
  .object({
    projectId: PixelIdSchema,
    characterId: z.string().max(64).nullable().optional(),
    parentAssetId: z.string().max(64).nullable().optional(),
    kind: PixelKindSchema,
    name: z.string().trim().min(1).max(120),
    mode: z.enum(["text", "image", "reference", "inpaint", "directions"]),
    prompt: z.string().max(10000),
    negativePrompt: z.string().max(10000).optional(),
    width: z.number().int().min(8).max(256),
    height: z.number().int().min(8).max(256),
    paletteId: PixelPaletteIdSchema,
    seed: z.number().int().min(-1).max(4294967295).optional(),
    style: z.string().max(64).optional(),
    transparent: z.boolean().optional(),
    steps: z.number().int().min(1).max(60).optional(),
    longSide: z.number().int().min(512).max(2048).optional(),
    conversion: z.enum(["direct", "ai"]).optional(),
    strength: z.number().min(0).max(2).optional(),
    directionCount: z.union([z.literal(4), z.literal(8)]).optional(),
    image: PixelAiImageInputSchema.optional(),
    reference: z
      .object({
        subject: PixelAiImageInputSchema,
        style: PixelAiImageInputSchema.optional(),
      })
      .strict()
      .optional(),
    inpaint: z
      .object({
        base: PixelAiImageInputSchema,
        region: PixelAiInpaintRegionSchema,
      })
      .strict()
      .optional(),
  })
  .strict();

export interface HandlerContext {
  paths: StudioPaths;
  repo: StudioRepository;
  defaultSettings: AppSettings;
  getSettings: () => AppSettings;
  setSettings: (s: AppSettings) => void;
  runtime: ComfyRuntimeManager;
  modelScanner: ModelScanner;
  getCachedModels: () => ModelRecord[];
  setCachedModels: (models: ModelRecord[]) => void;
  downloadManager: DownloadManager;
  civitaiClient: CivitaiClient;
  civitaiDownloadManager: CivitaiDownloadManager;
  civitaiKeyStore: CivitaiKeyStore;
  huggingFaceService: HuggingFaceService;
  huggingFaceTokenStore: HuggingFaceTokenStore;
  jobOrchestrator: JobOrchestrator;
  updateService: UpdateService;
  logger: StudioLogger;
  getVramTotalMB: () => number;
  setVramTotalMB: (v: number) => void;
  approvedInputFiles: Set<string>;
  getMainWindow: () => BrowserWindow | null;
  expectedHtmlPath: string;
  devServerOrigin: string | null;
}

export type IpcRegistrarHandle = <Args extends unknown[], Result>(
  channel: string,
  fn: (event: IpcMainInvokeEvent, ...args: Args) => Promise<Result> | Result
) => void;
