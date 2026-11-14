import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { z } from "zod";
import type { AppSettings, ModelRecord } from "../../shared/types";
import type { CivitaiClient } from "../civitai/civitai-client";
import type { CivitaiDownloadManager } from "../civitai/download-manager";
import type { CivitaiKeyStore } from "../civitai/secure-key-store";
import type { ComfyRuntimeManager } from "../comfy/runtime-manager";
import type { StudioRepository } from "../db/repositories";
import type { DownloadManager } from "../downloads/download-manager";
import type { JobOrchestrator } from "../jobs/job-orchestrator";
import type { StudioLogger } from "../logger";
import type { ModelScanner } from "../models/model-scanner";
import type { StudioPaths } from "../paths";
import { isAllowedLoopbackHost } from "../security";

export const RuntimeModeSchema = z.enum(["external", "managed"]);
export const PerformanceProfileSchema = z.enum(["balanced", "quality", "memory_saver"]);
export const OutputFormatSchema = z.enum(["png", "jpeg", "webp"]);
export const NavSectionSchema = z.enum([
  "home",
  "explore",
  "create",
  "library",
  "characters",
  "stories",
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
  "ltx_video",
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
    seed: z.number().int().min(0).max(4294967295).optional(),
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

export const GenerationRequestSchema = z.object({
  workflowId: z.string().min(1).max(100),
  mode: z.enum(["txt2img", "img2img", "upscale"]),
  prompt: z.string().max(10000),
  negativePrompt: z.string().max(10000),
  checkpoint: z.string().max(512),
  vae: z.string().max(512).nullable(),
  loras: z.array(LoraSelectionSchema).max(6),
  aspectRatio: z.string().min(1).max(32),
  width: z.number().int().min(64).max(4096),
  height: z.number().int().min(64).max(4096),
  steps: z.number().int().min(1).max(150),
  cfg: z.number().min(0.5).max(30),
  sampler: z.string().min(1).max(100),
  scheduler: z.string().min(1).max(100),
  seed: z.number().int().min(0).max(4294967295),
  randomSeed: z.boolean(),
  batchCount: z.number().int().min(1).max(8),
  batchSize: z.number().int().min(1).max(4),
  outputFormat: OutputFormatSchema,
  inputImagePath: z.string().max(1024).nullable(),
  denoise: z.number().min(0.05).max(1.0),
  hiresFix: HiresFixSchema.optional(),
  upscale: UpscaleConfigSchema.optional(),
  characterId: z.string().max(64).nullable().optional(),
  loraRecipeId: z.string().max(64).nullable().optional(),
  storyId: z.string().max(64).nullable().optional(),
  storySceneId: z.string().max(64).nullable().optional(),
});

export const LibraryFiltersSchema = z
  .object({
    search: z.string().max(200).optional(),
    favoriteOnly: z.boolean().optional(),
    collectionId: z.string().max(100).nullable().optional(),
    sortBy: z.enum(["newest", "oldest", "name"]).optional(),
  })
  .optional();

export const CharacterReferenceRoleSchema = z.enum([
  "primary",
  "secondary",
  "expression",
  "outfit",
  "pose",
]);

export const CharacterReferenceUpdateInputSchema = z
  .object({
    id: z.string().min(1).max(64),
    role: CharacterReferenceRoleSchema,
    caption: z.string().max(500).optional(),
    weight: z.number().min(0).max(1).optional(),
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
  })
  .strict();

export const CharacterReferencePatchSchema = z
  .object({
    role: CharacterReferenceRoleSchema.optional(),
    caption: z.string().max(500).optional(),
    weight: z.number().min(0).max(1).optional(),
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
    type: z.enum(["Checkpoint", "LORA", "VAE", "Upscaler"]).nullable().optional(),
    baseModel: z
      .enum(["SD 1.5", "SDXL 1.0", "Illustrious", "Pony", "Anima", "Flux.1 D"])
      .nullable()
      .optional(),
    sort: z.enum(["Most Downloaded", "Highest Rated", "Newest"]).optional(),
    nsfw: z.boolean().optional(),
    cursor: z.string().max(2048).nullable().optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

export const CivitaiStartDownloadSchema = z
  .object({
    modelId: z.number().int().positive(),
    versionId: z.number().int().positive(),
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
  jobOrchestrator: JobOrchestrator;
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
