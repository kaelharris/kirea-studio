export type NavSection =
  | "home"
  | "explore"
  | "create"
  | "video"
  | "characters"
  | "stories"
  | "pixel"
  | "library"
  | "models"
  | "workflows"
  | "queue"
  | "settings";

export type PerformanceProfile = "balanced" | "quality" | "memory_saver";
export type RuntimeMode = "external" | "managed";
export type RuntimeStatus =
  | "disconnected"
  | "starting"
  | "connected"
  | "error"
  | "installing";

export type OutputFormat = "png" | "jpeg" | "webp";
export type GenerationMode = "txt2img" | "img2img" | "upscale" | "t2v" | "i2v";
export type VideoContainerFormat = "mp4" | "webm";

export type ModelCategory =
  | "checkpoint"
  | "lora"
  | "vae"
  | "embedding"
  | "controlnet"
  | "upscale"
  | "diffusion_model"
  | "text_encoder";

export type ModelArchitecture =
  | "sd15"
  | "sdxl"
  | "illustrious"
  | "pony"
  | "flux"
  | "z_image"
  | "anima"
  | "krea2"
  | "ltx_video"
  | "wan_video"
  | "unknown";

export type ModelPreviewMode = "auto" | "custom" | "none";
export type CharacterReferenceMode = "none" | "img2img" | "ipadapter" | "controlnet";
export type CharacterReferenceRole = "primary" | "secondary" | "expression" | "outfit" | "pose";

export type JobLifecycleState =
  | "IDLE"
  | "VALIDATING"
  | "SUBMITTING"
  | "QUEUED"
  | "RUNNING"
  | "PROCESSING_OUTPUT"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type JobErrorKind =
  | "NONE"
  | "VALIDATION_FAILED"
  | "MISSING_MODEL"
  | "SUBMISSION_FAILED"
  | "RUNTIME_CRASH"
  | "CUDA_OOM"
  | "WS_DISCONNECTED"
  | "MISSING_OUTPUT"
  | "CANCELLED"
  | "UNKNOWN";

export interface AppSettings {
  runtimeMode: RuntimeMode;
  externalComfyPath: string;
  comfyHost: string;
  comfyPort: number;
  /** Dedicated ComfyUI host for Pixel Studio AI generation; kept separate from the main runtime. */
  pixelBackendHost: string;
  pixelBackendPort: number;
  /** Optional path to an external SpriteKiln checkout containing workflows/api. */
  pixelBackendWorkflowRoot: string;
  managedComfyPath: string;
  autoStartRuntime: boolean;
  outputDirectory: string;
  extraModelDirs: string[];
  downloadDirectory: string;
  cacheDirectory: string;
  tempDirectory: string;
  performanceProfile: PerformanceProfile;
  maxActiveJobs: number;
  defaultBatchSize: number;
  enableMemoryWarnings: boolean;
  theme: "dark" | "light" | "system";
  galleryLayout: "comfortable" | "compact";
  startupPage: NavSection;
  defaultSampler: string;
  defaultScheduler: string;
  defaultSteps: number;
  defaultCfg: number;
  defaultOutputFormat: OutputFormat;
  checkUpdatesAutomatically: boolean;
  /** Hide NSFW Civitai results by default (safe browsing). */
  nsfwFilter: boolean;
  /** Whether an encrypted Civitai API key is stored outside the settings row. */
  civitaiApiKeySet: boolean;
}

export interface GpuStats {
  available: boolean;
  name: string;
  driverVersion: string;
  cudaVersion: string;
  vramTotalMB: number;
  vramFreeMB: number;
  vramUsedMB: number;
  systemRamTotalMB: number;
  systemRamFreeMB: number;
  diskFreeGB: Record<string, number>;
  recommendedMaxBatch: number;
  advisories: string[];
}

export interface ComfyDeviceInfo {
  name: string;
  type: string;
  index: number;
  vramTotal: number;
  vramFree: number;
}

export interface RuntimeState {
  status: RuntimeStatus;
  mode: RuntimeMode;
  apiUrl: string;
  comfyVersion: string | null;
  pythonVersion: string | null;
  pytorchVersion: string | null;
  managedPid: number | null;
  managedOwned: boolean;
  detectedExternalPaths: string[];
  installedManagedPath: string | null;
  isConfiguredPathValid: boolean;
  lastError: string | null;
  devices: ComfyDeviceInfo[];
  nodeTypesCount: number;
  warnings: string[];
  wsConnected: boolean;
}

export interface ModelMetadata {
  modelId: string;
  filePath: string;
  displayName: string | null;
  description: string;
  architectureOverride: ModelArchitecture | null;
  baseModel: string | null;
  previewMode: ModelPreviewMode;
  previewPath: string | null;
  triggerWords: string[];
  tags: string[];
  notes: string;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ModelDiscovery {
  modelId: string;
  filePath: string;
  description: string | null;
  baseModel: string | null;
  previewPath: string | null;
  triggerWords: string[];
  discoveredAt: string;
}

export interface ModelMetadataPatch {
  displayName?: string | null;
  description?: string;
  architectureOverride?: ModelArchitecture | null;
  baseModel?: string | null;
  previewMode?: ModelPreviewMode;
  previewPath?: string | null;
  triggerWords?: string[];
  tags?: string[];
  notes?: string;
  favorite?: boolean;
}

export interface ModelRecord {
  id: string;
  name: string;
  relativePath: string;
  filePath: string;
  category: ModelCategory;
  architecture: ModelArchitecture;
  sizeBytes: number;
  sha256: string | null;
  sourceRoot: string;
  isDuplicate: boolean;
  duplicateOf: string | null;
  isIncomplete: boolean;
  compatibleWorkflows: string[];
  license: string | null;
  description: string | null;
  installed: boolean;
  lastSeenAt: string;
  metadata?: ModelMetadata | null;
  discovery?: ModelDiscovery | null;
}

export interface CuratedModelCatalogItem {
  id: string;
  name: string;
  fileName: string;
  category: ModelCategory;
  architecture: ModelArchitecture;
  sizeBytes: number;
  sha256: string;
  sourceName: string;
  sourceUrl: string;
  downloadUrl: string;
  licenseName: string;
  licenseUrl: string;
  description: string;
  targetSubdir: string;
}

export interface VideoAspectPreset {
  id: string;
  width: number;
  height: number;
}

/** A companion checkpoint a video workflow must load alongside the selected video model. */
export interface VideoModelRequirement {
  category: ModelCategory;
  fileName: string;
  label: string;
  approxSizeGB: number;
}

export interface VideoWorkflowSpec {
  family: "wan21_t2v" | "ltx_video";
  /** Fixed frame rate the workflow is authored for; not a free-form control. */
  fps: number;
  /** Valid frame counts are minFrames + n * frameStep. */
  minFrames: number;
  maxFrames: number;
  frameStep: number;
  defaultFrameCount: number;
  formats: VideoContainerFormat[];
  /** Model-validated aspect presets. Other ratios are fitted and flagged. */
  presets: VideoAspectPreset[];
  companionModels: VideoModelRequirement[];
  minVramMB: number;
  recommendedVramMB: number;
  notes: string;
}

export interface VideoGenerationSettings {
  fps: number;
  frameCount: number;
  durationSeconds: number;
  format: VideoContainerFormat;
}

export interface WorkflowTemplate {
  id: string;
  version: string;
  name: string;
  description: string;
  mode: GenerationMode;
  supportedArchitectures: ModelArchitecture[];
  requiredNodes: string[];
  outputNodeId: string;
  supportsLora: boolean;
  maxLoras: number;
  minDim: number;
  maxDim: number;
  dimStep: number;
  /** Present only for video workflows; image workflows leave it undefined. */
  video?: VideoWorkflowSpec;
  defaults: {
    steps: number;
    cfg: number;
    sampler: string;
    scheduler: string;
    denoise: number;
    width: number;
    height: number;
  };
  tags: string[];
}

export interface LoraSelection {
  name: string;
  strengthModel: number;
  strengthClip: number;
}

export interface LoraRecipeItem {
  position: number;
  loraPath: string;
  loraName: string;
  architecture: ModelArchitecture;
  strengthModel: number;
  strengthClip: number;
  enabled: boolean;
  triggerWords: string[];
}

export interface LoraRecipeItemInput {
  loraPath: string;
  loraName?: string;
  architecture?: ModelArchitecture;
  strengthModel?: number;
  strengthClip?: number;
  enabled?: boolean;
  triggerWords?: string[];
}

export interface LoraRecipeSettings {
  aspectRatio?: string;
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  sampler?: string;
  scheduler?: string;
  seed?: number;
  denoise?: number;
  batchCount?: number;
  outputFormat?: OutputFormat;
  hiresFix?: HiresFixConfig;
}

export interface LoraRecipe {
  id: string;
  name: string;
  description: string;
  mode: GenerationMode;
  workflowId: string | null;
  architecture: ModelArchitecture;
  checkpointPath: string | null;
  checkpointName: string | null;
  basePrompt: string;
  negativePrompt: string;
  settings: LoraRecipeSettings;
  coverImagePath: string | null;
  tags: string[];
  favorite: boolean;
  usageCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: LoraRecipeItem[];
}

export interface LoraRecipeInput {
  id?: string;
  name: string;
  description?: string;
  mode?: GenerationMode;
  workflowId?: string | null;
  architecture?: ModelArchitecture;
  checkpointPath?: string | null;
  checkpointName?: string | null;
  basePrompt?: string;
  negativePrompt?: string;
  settings?: LoraRecipeSettings;
  coverImagePath?: string | null;
  tags?: string[];
  favorite?: boolean;
  items: LoraRecipeItemInput[];
}

export interface CharacterReference {
  id: string;
  characterId: string;
  role: CharacterReferenceRole;
  filePath: string;
  sourcePath: string | null;
  caption: string;
  weight: number;
  position: number;
  createdAt: string;
}

export interface CharacterProfile {
  id: string;
  name: string;
  description: string;
  appearance: string;
  clothing: string;
  promptPrefix: string;
  negativePrompt: string;
  triggerWords: string[];
  architecture: ModelArchitecture;
  checkpointPath: string | null;
  checkpointName: string | null;
  loraRecipeId: string | null;
  referenceMode: CharacterReferenceMode;
  referenceWeight: number;
  referenceStart: number;
  referenceEnd: number;
  tags: string[];
  favorite: boolean;
  usageCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
  references: CharacterReference[];
}

export interface CharacterReferenceUpdateInput {
  id: string;
  role: CharacterReferenceRole;
  caption?: string;
  weight?: number;
}

export interface CharacterProfileInput {
  id?: string;
  name: string;
  description?: string;
  appearance?: string;
  clothing?: string;
  promptPrefix?: string;
  negativePrompt?: string;
  triggerWords?: string[];
  architecture?: ModelArchitecture;
  checkpointPath?: string | null;
  checkpointName?: string | null;
  loraRecipeId?: string | null;
  referenceMode?: CharacterReferenceMode;
  referenceWeight?: number;
  referenceStart?: number;
  referenceEnd?: number;
  tags?: string[];
  favorite?: boolean;
  references?: CharacterReferenceUpdateInput[];
}

export type StoryStatus = "draft" | "in_progress" | "complete";
export type StoryCastRole = "lead" | "supporting" | "cameo";
export type StorySceneStatus = "draft" | "queued" | "generating" | "completed" | "failed";

export interface StoryCastMember {
  characterId: string;
  position: number;
  storyRole: StoryCastRole;
}

export interface StorySceneCastMember {
  characterId: string;
  position: number;
  roleHint: string;
}

export interface StoryScene {
  id: string;
  storyId: string;
  position: number;
  title: string;
  synopsis: string;
  prompt: string;
  negativePrompt: string;
  checkpointPath: string | null;
  loraRecipeId: string | null;
  aspectRatio: string | null;
  width: number | null;
  height: number | null;
  steps: number | null;
  cfg: number | null;
  sampler: string | null;
  scheduler: string | null;
  seed: number;
  denoise: number | null;
  referenceModeOverride: CharacterReferenceMode | null;
  batchCount: number;
  status: StorySceneStatus;
  lastJobId: string | null;
  selectedImageId: string | null;
  createdAt: string;
  updatedAt: string;
  cast: StorySceneCastMember[];
}

export interface Story {
  id: string;
  title: string;
  logline: string;
  stylePrompt: string;
  negativePrompt: string;
  defaultCharacterId: string | null;
  defaultCheckpointPath: string | null;
  defaultLoraRecipeId: string | null;
  coverSceneId: string | null;
  status: StoryStatus;
  tags: string[];
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  cast: StoryCastMember[];
  scenes: StoryScene[];
}

export interface StoryCastInput {
  characterId: string;
  storyRole?: StoryCastRole;
}

export interface StoryInput {
  id?: string;
  title: string;
  logline?: string;
  stylePrompt?: string;
  negativePrompt?: string;
  defaultCharacterId?: string | null;
  defaultCheckpointPath?: string | null;
  defaultLoraRecipeId?: string | null;
  coverSceneId?: string | null;
  status?: StoryStatus;
  tags?: string[];
  favorite?: boolean;
  cast?: StoryCastInput[];
}

export interface StorySceneCastInput {
  characterId: string;
  roleHint?: string;
}

export interface StorySceneInput {
  id?: string;
  storyId: string;
  title?: string;
  synopsis?: string;
  prompt?: string;
  negativePrompt?: string;
  checkpointPath?: string | null;
  loraRecipeId?: string | null;
  aspectRatio?: string | null;
  width?: number | null;
  height?: number | null;
  steps?: number | null;
  cfg?: number | null;
  sampler?: string | null;
  scheduler?: string | null;
  seed?: number;
  denoise?: number | null;
  referenceModeOverride?: CharacterReferenceMode | null;
  batchCount?: number;
  cast?: StorySceneCastInput[];
}

export interface StoryScenePlan {
  storyId: string;
  sceneId: string;
  workflowId: string;
  mode: GenerationMode;
  prompt: string;
  negativePrompt: string;
  checkpoint: string;
  loras: LoraSelection[];
  aspectRatio: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  seed: number;
  randomSeed: boolean;
  batchCount: number;
  denoise: number;
  inputImagePath: string | null;
  characterId: string | null;
  loraRecipeId: string | null;
  architecture: ModelArchitecture;
  referenceActive: boolean;
  issues: string[];
  blockingIssues: string[];
}

export type CanvasTemplate = "grid_2x3" | "grid_3x3" | "filmstrip" | "freeform";
export type CanvasPageSize =
  | "a4_portrait"
  | "a4_landscape"
  | "letter"
  | "square"
  | "custom";
export type CanvasFit = "cover" | "contain";
export type CanvasCaptionMode = "none" | "scene_title" | "synopsis" | "prompt";
export type CanvasOverlayKind = "speech" | "thought" | "narration" | "text";

export interface CanvasOverlay {
  id: string;
  kind: CanvasOverlayKind;
  speaker?: string;
  text: string;
  /** Horizontal center within the panel, normalized 0..1. */
  x: number;
  /** Vertical center within the panel, normalized 0..1. */
  y: number;
}

export interface StoryCanvasItem {
  id: string;
  canvasId: string;
  sceneId: string | null;
  imageId: string | null;
  position: number;
  /** Freeform panel geometry, normalized 0..1 within the printable area. */
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
  fit: CanvasFit;
  captionOverride: string;
  overlays: CanvasOverlay[];
}

export interface StoryCanvas {
  id: string;
  storyId: string;
  name: string;
  template: CanvasTemplate;
  pageSize: CanvasPageSize;
  pageWidth: number;
  pageHeight: number;
  margin: number;
  gutter: number;
  background: string;
  captionMode: CanvasCaptionMode;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  items: StoryCanvasItem[];
}

export interface StoryCanvasInput {
  id?: string;
  storyId: string;
  name: string;
  template?: CanvasTemplate;
  pageSize?: CanvasPageSize;
  pageWidth?: number;
  pageHeight?: number;
  margin?: number;
  gutter?: number;
  background?: string;
  captionMode?: CanvasCaptionMode;
  settings?: Record<string, unknown>;
}

export interface StoryCanvasItemInput {
  id?: string;
  canvasId: string;
  sceneId?: string | null;
  imageId?: string | null;
  position?: number;
  x?: number | null;
  y?: number | null;
  width?: number | null;
  height?: number | null;
  fit?: CanvasFit;
  captionOverride?: string;
  overlays?: CanvasOverlay[];
}

export type StoryExportKind = "png" | "pdf";

export interface StoryExportRecord {
  id: string;
  storyId: string | null;
  canvasId: string | null;
  kind: StoryExportKind;
  filePath: string;
  width: number;
  height: number;
  pageCount: number;
  sizeBytes: number;
  settings: Record<string, unknown>;
  createdAt: string;
}

export interface StoryExportResult {
  kind: StoryExportKind;
  files: string[];
  outputDir: string;
  width: number;
  height: number;
  pageCount: number;
}

export type UpscalePipeline = "crisp" | "refiner";
export type UpscalePresetId =
  | "anime_crisp"
  | "universal_ultrasharp"
  | "smooth_illustration";

export interface HiresFixConfig {
  enabled: boolean;
  upscaler: string;
  scale: number;
  steps: number;
  denoise: number;
  pipeline?: "latent" | "refiner";
  /** Refiner pass denoise when pipeline is "refiner" (0.20–0.50). */
  creativity?: number;
}

export interface UpscaleConfig {
  upscaler: string;
  scale: number;
  pipeline?: UpscalePipeline;
  preset?: UpscalePresetId;
  /** Refiner pass denoise (0.20 subtle – 0.50 creative). */
  creativity?: number;
  steps?: number;
  /** Refiner checkpoint; falls back to the active generation checkpoint. */
  checkpoint?: string | null;
}

export interface GenerationRequest {
  workflowId: string;
  mode: GenerationMode;
  prompt: string;
  negativePrompt: string;
  checkpoint: string;
  vae: string | null;
  loras: LoraSelection[];
  aspectRatio: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  seed: number;
  randomSeed: boolean;
  batchCount: number;
  batchSize: number;
  outputFormat: OutputFormat;
  inputImagePath: string | null;
  denoise: number;
  video?: VideoGenerationSettings;
  hiresFix?: HiresFixConfig;
  upscale?: UpscaleConfig;
  characterId?: string | null;
  loraRecipeId?: string | null;
  storyId?: string | null;
  storySceneId?: string | null;
}

export interface GenerationJob {
  id: string;
  promptId: string | null;
  status: JobLifecycleState;
  errorKind: JobErrorKind;
  errorMessage: string | null;
  prompt: string;
  negativePrompt: string;
  checkpoint: string;
  workflowId: string;
  workflowVersion: string;
  mode: GenerationMode;
  settings: GenerationRequest;
  progressStep: number;
  progressMax: number;
  currentNode: string | null;
  previewDataUrl: string | null;
  outputPaths: string[];
  submittedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  batchIndex: number;
  batchTotal: number;
  characterId?: string | null;
  loraRecipeId?: string | null;
  storyId?: string | null;
  storySceneId?: string | null;
}

export interface GeneratedImageRecord {
  id: string;
  jobId: string;
  filePath: string;
  fileName: string;
  format: OutputFormat;
  width: number;
  height: number;
  sizeBytes: number;
  prompt: string;
  negativePrompt: string;
  seed: number;
  checkpoint: string;
  loras: LoraSelection[];
  workflowId: string;
  sampler: string;
  scheduler: string;
  steps: number;
  cfg: number;
  denoise: number;
  mode: GenerationMode;
  favorite: boolean;
  tags: string[];
  collectionId: string | null;
  createdAt: string;
  characterId?: string | null;
  loraRecipeId?: string | null;
  storyId?: string | null;
  storySceneId?: string | null;
}

export interface GeneratedVideoRecord {
  id: string;
  jobId: string;
  filePath: string;
  fileName: string;
  container: VideoContainerFormat;
  width: number;
  height: number;
  sizeBytes: number;
  durationSeconds: number;
  fps: number;
  frameCount: number;
  prompt: string;
  negativePrompt: string;
  seed: number;
  checkpoint: string;
  loras: LoraSelection[];
  workflowId: string;
  sampler: string;
  scheduler: string;
  steps: number;
  cfg: number;
  denoise: number;
  mode: GenerationMode;
  favorite: boolean;
  tags: string[];
  createdAt: string;
}

export interface CollectionRecord {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  imageCount: number;
}

export interface PromptRecord {
  id: string;
  title: string;
  prompt: string;
  negativePrompt: string;
  tags: string[];
  favorite: boolean;
  usageCount: number;
  lastUsedAt: string | null;
  createdAt: string;
}

export type DownloadStatus =
  | "pending"
  | "downloading"
  | "paused"
  | "verifying"
  | "extracting"
  | "completed"
  | "failed"
  | "cancelled";

export interface DownloadTask {
  id: string;
  kind: "comfy_runtime" | "model";
  title: string;
  url: string;
  targetPath: string;
  category: ModelCategory | "runtime";
  sourceName: string;
  licenseName: string;
  expectedSha256: string | null;
  actualSha256: string | null;
  totalBytes: number;
  downloadedBytes: number;
  speedBytesPerSec: number;
  etaSeconds: number | null;
  status: DownloadStatus;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface StudioPreset {
  id: string;
  title: string;
  category: string;
  description: string;
  mode: GenerationMode;
  recommendedArch: ModelArchitecture[];
  aspectRatio: string;
  prompt: string;
  negativePrompt: string;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  denoise?: number;
}

export interface ValidationIssue {
  field: string;
  severity: "warning" | "error";
  message: string;
}

export interface AppDiagnostics {
  appVersion: string;
  electronVersion: string;
  chromeVersion: string;
  nodeVersion: string;
  userDataPath: string;
  logsPath: string;
  dbPath: string;
  outputDirectory: string;
  recentLogs: string[];
}

