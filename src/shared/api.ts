import type {
  CivitaiConnectionTest,
  CivitaiDownloadTask,
  CivitaiModelSummary,
  CivitaiSearchQuery,
  CivitaiSearchResult,
} from "./civitai";
import type {
  HuggingFaceCompatibilityReport,
  HuggingFaceCompatibilityRequest,
  HuggingFaceConnectionTest,
  HuggingFaceRepoDetails,
  HuggingFaceSearchQuery,
  HuggingFaceSearchResult,
  HuggingFaceStartRequest,
} from "./huggingface";
import type {
  PixelAiBackendStatus,
  PixelAiConnectionTest,
  PixelAiGenerateInput,
  PixelAiJob,
} from "./pixel-ai-types";
import type {
  PixelAssetDetail,
  PixelAssetFilters,
  PixelAnimationInput,
  PixelAssetRecord,
  PixelAssetVersion,
  PixelCharacter,
  PixelCharacterInput,
  PixelExportFormat,
  PixelExportOptions,
  PixelExportResult,
  PixelFrameInput,
  PixelGenerateInput,
  PixelImportInput,
  PixelProject,
  PixelProjectInput,
  PixelSavedPalette,
  PixelSavedPaletteInput,
  SpriteKilnReport,
} from "./pixel-types";
import type {
  PixelPackagePlan,
  PixelPackageProgress,
  PixelPackageRequest,
  PixelPackageResult,
} from "./pixel-package-types";
import type {
  AppDiagnostics,
  AppSettings,
  CharacterAdapter,
  CharacterIdentityCore,
  CharacterKnowledge,
  CharacterOutfit,
  CharacterProfile,
  CharacterProfileInput,
  CharacterReferenceApproval,
  CharacterReferenceCategory,
  CharacterReferenceRole,
  CharacterTrainingConfig,
  CharacterTrainingJob,
  CharacterTrainingTelemetry,
  VisionModelStatus,
  VisualTag,
  CollectionRecord,
  CuratedModelCatalogItem,
  DatasetValidationReport,
  DownloadTask,
  GeneratedImageRecord,
  GeneratedVideoRecord,
  GenerationJob,
  GenerationRequest,
  GpuStats,
  LoraRecipe,
  LoraRecipeInput,
  ModelArchitecture,
  ModelCategory,
  ModelMetadataPatch,
  ModelRecord,
  OutputFormat,
  PromptRecord,
  RuntimeMode,
  RuntimeState,
  Story,
  StoryCanvas,
  StoryCanvasInput,
  StoryCanvasItemInput,
  StoryExportRecord,
  StoryExportResult,
  StoryInput,
  StorySceneCastInput,
  StorySceneInput,
  StoryScenePlan,
  TrainingPreflightResult,
  ValidationIssue,
  WorkflowTemplate,
} from "./types";
import type {
  InstalledWorkflowFile,
  WorkflowArchivePreview,
  WorkflowFileAnalysisResult,
  WorkflowImportReport,
  WorkflowInstallResult,
  WorkflowRevalidationResult,
} from "./workflow-import";
import type {
  UpdateChannel,
  UpdateInstallResult,
  UpdateState,
} from "./update-types";
import type {
  CivitaiWorkflowImportPreview,
  CivitaiWorkflowImportRequest,
  CivitaiWorkflowSearchQuery,
  CivitaiWorkflowSearchResult,
  CivitaiWorkflowSummary,
} from "./civitai-workflows";
import type {
  LibraryBatchCollectionResult,
  LibraryBatchDeleteResult,
  LibraryBatchExportResult,
  LibraryBatchFavoriteResult,
  LibraryMediaQuery,
  LibraryMediaResult,
} from "./library";

export interface RuntimeReleaseInfo {
  tagName: string;
  assetName: string;
  downloadUrl: string;
  sizeBytes: number;
  sha256: string | null;
  releaseUrl: string;
  publishedAt: string;
  compatibilityNote: string;
}

export interface LibraryFilters {
  search?: string;
  favoriteOnly?: boolean;
  collectionId?: string | null;
  sortBy?: "newest" | "oldest" | "name";
}

export interface KireaDesktopApi {
  // App & diagnostics
  getDiagnostics(): Promise<AppDiagnostics>;
  exportLogs(): Promise<string | null>;
  openPath(targetPath: string): Promise<void>;
  openExternalUrl(url: string): Promise<void>;
  pickDirectory(title?: string): Promise<string | null>;
  pickImage(): Promise<string | null>;
  getFileDataUrl(filePath: string): Promise<string>;

  // Settings
  getSettings(): Promise<AppSettings>;
  updateSettings(partial: Partial<AppSettings>): Promise<AppSettings>;

  // Application updates
  getUpdateState(): Promise<UpdateState>;
  checkForUpdates(): Promise<UpdateState>;
  downloadUpdate(): Promise<UpdateState>;
  cancelUpdateDownload(): Promise<UpdateState>;
  dismissUpdate(): Promise<UpdateState>;
  setUpdateChannel(channel: UpdateChannel): Promise<UpdateState>;
  installUpdate(force?: boolean): Promise<UpdateInstallResult>;
  onUpdateStateChanged(cb: (state: UpdateState) => void): () => void;

  // Hardware & runtime
  getHardwareStats(): Promise<GpuStats>;
  getRuntimeState(): Promise<RuntimeState>;
  discoverRuntime(): Promise<RuntimeState>;
  testRuntimeConnection(): Promise<RuntimeState>;
  startRuntime(mode?: RuntimeMode): Promise<RuntimeState>;
  stopRuntime(): Promise<RuntimeState>;
  getRuntimeLogs(): Promise<string[]>;
  checkRuntimeRelease(): Promise<RuntimeReleaseInfo>;
  installManagedRuntime(): Promise<{ downloadTaskId: string; release: RuntimeReleaseInfo }>;

  // Models & catalog
  scanModels(): Promise<ModelRecord[]>;
  listModels(category?: ModelCategory): Promise<ModelRecord[]>;
  deleteModel(filePath: string): Promise<void>;
  updateModelMetadata(modelId: string, patch: ModelMetadataPatch): Promise<ModelRecord>;
  getModelPreview(modelId: string): Promise<string | null>;
  importModelPreview(modelId: string, sourceFilePath?: string): Promise<ModelRecord | null>;
  getCuratedCatalog(): Promise<CuratedModelCatalogItem[]>;

  // LoRA recipes
  listLoraRecipes(): Promise<LoraRecipe[]>;
  saveLoraRecipe(input: LoraRecipeInput): Promise<LoraRecipe>;
  deleteLoraRecipe(id: string): Promise<void>;

  // Characters
  listCharacters(): Promise<CharacterProfile[]>;
  saveCharacter(input: CharacterProfileInput): Promise<CharacterProfile>;
  deleteCharacter(id: string): Promise<boolean>;
  pickCharacterReference(
    characterId: string,
    role?: CharacterReferenceRole
  ): Promise<CharacterProfile | null>;
  addCharacterReferenceFromImage(
    characterId: string,
    imageId: string,
    role?: CharacterReferenceRole,
    caption?: string
  ): Promise<CharacterProfile | null>;
  updateCharacterReference(
    characterId: string,
    referenceId: string,
    patch: {
      role?: CharacterReferenceRole;
      caption?: string;
      weight?: number;
      category?: CharacterReferenceCategory;
      approvalStatus?: CharacterReferenceApproval;
      associatedOutfitId?: string | null;
      includedInTraining?: boolean;
      suggestedTags?: VisualTag[];
      imageHash?: string | null;
    }
  ): Promise<CharacterProfile | null>;
  removeCharacterReference(
    characterId: string,
    referenceId: string
  ): Promise<CharacterProfile | null>;
  getCharacterPreview(characterId: string): Promise<string | null>;
  saveCharacterDna(
    characterId: string,
    dna: Partial<CharacterIdentityCore>,
    knowledge?: Partial<CharacterKnowledge>
  ): Promise<CharacterProfile>;
  listCharacterOutfits(characterId: string): Promise<CharacterOutfit[]>;
  saveCharacterOutfit(
    outfit: Omit<CharacterOutfit, "createdAt" | "updatedAt">
  ): Promise<CharacterOutfit>;
  deleteCharacterOutfit(
    characterId: string,
    outfitId: string
  ): Promise<boolean>;
  listCharacterAdapters(characterId: string): Promise<CharacterAdapter[]>;
  saveCharacterAdapter(
    adapter: Omit<CharacterAdapter, "createdAt" | "updatedAt">
  ): Promise<CharacterAdapter>;
  deleteCharacterAdapter(
    characterId: string,
    adapterId: string
  ): Promise<boolean>;
  cropCharacterReference(
    characterId: string,
    referenceId: string,
    crop: {
      left: number;
      top: number;
      width: number;
      height: number;
      category?: CharacterReferenceCategory;
      caption?: string;
    }
  ): Promise<CharacterProfile | null>;
  validateCharacterDataset(
    characterId: string
  ): Promise<DatasetValidationReport>;
  exportCharacterDataset(
    characterId: string,
    exportDir?: string
  ): Promise<{ success: boolean; exportPath: string; count: number }>;
  preflightCharacterTraining(
    characterId: string,
    config?: Partial<CharacterTrainingConfig>
  ): Promise<TrainingPreflightResult>;
  startCharacterTraining(
    characterId: string,
    config: CharacterTrainingConfig
  ): Promise<CharacterTrainingJob>;
  cancelCharacterTraining(jobId: string): Promise<boolean>;
  listCharacterTrainingJobs(
    characterId: string
  ): Promise<CharacterTrainingJob[]>;
  interrogateCharacterReferenceTags(
    characterId: string,
    referenceIds?: string[]
  ): Promise<CharacterProfile>;
  updateCharacterReferenceTags(
    characterId: string,
    referenceId: string,
    tags: VisualTag[]
  ): Promise<CharacterProfile>;
  getVisionModelStatus(): Promise<VisionModelStatus>;

  // Stories
  listStories(): Promise<Story[]>;
  getStory(id: string): Promise<Story | null>;
  saveStory(input: StoryInput): Promise<Story>;
  deleteStory(id: string): Promise<boolean>;
  saveStoryScene(input: StorySceneInput): Promise<Story>;
  deleteStoryScene(storyId: string, sceneId: string): Promise<Story | null>;
  reorderStoryScenes(storyId: string, sceneIds: string[]): Promise<Story | null>;
  setStorySceneCast(
    storyId: string,
    sceneId: string,
    cast: StorySceneCastInput[]
  ): Promise<Story | null>;
  selectStorySceneImage(
    storyId: string,
    sceneId: string,
    imageId: string | null
  ): Promise<Story | null>;
  planStoryScene(storyId: string, sceneId: string): Promise<StoryScenePlan>;
  generateStoryScene(storyId: string, sceneId: string): Promise<GenerationJob[]>;
  generateStory(storyId: string): Promise<GenerationJob[]>;

  // Story canvases & exports
  listCanvases(storyId?: string): Promise<StoryCanvas[]>;
  saveCanvas(input: StoryCanvasInput): Promise<StoryCanvas>;
  deleteCanvas(id: string): Promise<boolean>;
  saveCanvasItem(input: StoryCanvasItemInput): Promise<StoryCanvas>;
  deleteCanvasItem(canvasId: string, itemId: string): Promise<StoryCanvas | null>;
  reorderCanvasItems(
    canvasId: string,
    itemIds: string[]
  ): Promise<StoryCanvas | null>;
  syncCanvas(canvasId: string): Promise<StoryCanvas | null>;
  exportCanvasPng(canvasId: string): Promise<StoryExportResult | null>;
  exportCanvasPdf(canvasId: string): Promise<StoryExportResult | null>;
  openCanvasExportFolder(storyId: string): Promise<string>;
  listStoryExports(storyId?: string): Promise<StoryExportRecord[]>;

  // Downloads
  listDownloads(): Promise<DownloadTask[]>;
  startModelDownload(catalogItemId: string): Promise<DownloadTask>;
  pauseDownload(id: string): Promise<boolean>;
  resumeDownload(id: string): Promise<DownloadTask | null>;
  cancelDownload(id: string): Promise<boolean>;
  clearCompletedDownloads(): Promise<number>;

  // Civitai Hub
  searchCivitaiModels(query: CivitaiSearchQuery): Promise<CivitaiSearchResult>;
  getCivitaiModelDetails(modelId: number): Promise<CivitaiModelSummary>;
  startCivitaiDownload(modelId: number, versionId: number, targetArchitecture?: ModelArchitecture): Promise<CivitaiDownloadTask>;
  pauseCivitaiDownload(id: string): Promise<boolean>;
  resumeCivitaiDownload(id: string): Promise<CivitaiDownloadTask | null>;
  cancelCivitaiDownload(id: string): Promise<boolean>;
  retryCivitaiDownload(id: string): Promise<CivitaiDownloadTask | null>;
  listCivitaiDownloads(): Promise<CivitaiDownloadTask[]>;
  clearCompletedCivitaiDownloads(): Promise<number>;
  clearDownloadHistory(): Promise<{ generic: number; civitai: number }>;
  setCivitaiApiKey(apiKey: string): Promise<{ hasApiKey: boolean }>;
  testCivitaiConnection(): Promise<CivitaiConnectionTest>;

  // Hugging Face Hub
  searchHuggingFaceModels(query: HuggingFaceSearchQuery): Promise<HuggingFaceSearchResult>;
  getHuggingFaceRepo(repoId: string, revision?: string): Promise<HuggingFaceRepoDetails>;
  checkHuggingFaceCompatibility(
    request: HuggingFaceCompatibilityRequest
  ): Promise<HuggingFaceCompatibilityReport>;
  startHuggingFaceDownloads(request: HuggingFaceStartRequest): Promise<DownloadTask[]>;
  setHuggingFaceToken(token: string): Promise<{ hasToken: boolean }>;
  testHuggingFaceConnection(): Promise<HuggingFaceConnectionTest>;
  searchCivitaiWorkflows(
    query: CivitaiWorkflowSearchQuery
  ): Promise<CivitaiWorkflowSearchResult>;
  getCivitaiWorkflowDetails(modelId: number): Promise<CivitaiWorkflowSummary>;
  prepareCivitaiWorkflowImport(
    request: CivitaiWorkflowImportRequest
  ): Promise<CivitaiWorkflowImportPreview>;

  // Workflows & generation
  listWorkflows(): Promise<WorkflowTemplate[]>;
  getSamplersAndSchedulers(): Promise<{ samplers: string[]; schedulers: string[] }>;
  analyzeWorkflowUrl(url: string): Promise<WorkflowImportReport>;
  analyzeWorkflowFile(): Promise<WorkflowFileAnalysisResult | null>;
  analyzeWorkflowArchiveFile(): Promise<WorkflowArchivePreview | null>;
  installWorkflowImport(previewId: string): Promise<WorkflowInstallResult>;
  listInstalledWorkflows(): Promise<InstalledWorkflowFile[]>;
  revealInstalledWorkflow(filePath: string): Promise<void>;
  removeInstalledWorkflow(filePath: string): Promise<boolean>;
  revalidateInstalledWorkflow(filePath: string): Promise<WorkflowRevalidationResult>;
  reimportInstalledWorkflow(filePath: string): Promise<WorkflowImportReport>;
  validateJob(req: GenerationRequest): Promise<ValidationIssue[]>;
  submitJob(req: GenerationRequest): Promise<GenerationJob[]>;
  listJobs(): Promise<GenerationJob[]>;
  cancelJob(jobId: string): Promise<boolean>;
  retryJob(jobId: string): Promise<GenerationJob[]>;
  deleteJob(jobId: string): Promise<boolean>;
  deleteJobs(jobIds: string[]): Promise<number>;

  // Library, collections & prompts
  listLibraryMedia(query?: LibraryMediaQuery): Promise<LibraryMediaResult>;
  listImages(filters?: LibraryFilters): Promise<GeneratedImageRecord[]>;
  toggleImageFavorite(id: string): Promise<GeneratedImageRecord | null>;
  updateImageMeta(
    id: string,
    updates: { tags?: string[]; collectionId?: string | null }
  ): Promise<void>;
  deleteImage(id: string): Promise<void>;
  exportImage(id: string, format: OutputFormat, stripMetadata: boolean): Promise<string | null>;
  batchDeleteLibraryMedia(ids: string[]): Promise<LibraryBatchDeleteResult>;
  batchExportLibraryMedia(ids: string[], destinationDir: string): Promise<LibraryBatchExportResult>;
  batchSetLibraryCollection(ids: string[], collectionId: string | null): Promise<LibraryBatchCollectionResult>;
  batchSetLibraryFavorite(ids: string[], favorite: boolean): Promise<LibraryBatchFavoriteResult>;
  listVideos(): Promise<GeneratedVideoRecord[]>;
  toggleVideoFavorite(id: string): Promise<GeneratedVideoRecord | null>;
  deleteVideo(id: string): Promise<void>;
  exportVideo(id: string): Promise<string | null>;
  listCollections(): Promise<CollectionRecord[]>;
  createCollection(name: string, description?: string): Promise<CollectionRecord>;
  deleteCollection(id: string): Promise<void>;
  listPrompts(): Promise<PromptRecord[]>;
  savePrompt(record: {
    id?: string;
    title: string;
    prompt: string;
    negativePrompt: string;
    tags?: string[];
    favorite?: boolean;
  }): Promise<PromptRecord>;
  deletePrompt(id: string): Promise<void>;

  // Pixel Studio
  listPixelProjects(): Promise<PixelProject[]>;
  savePixelProject(input: PixelProjectInput): Promise<PixelProject>;
  deletePixelProject(id: string): Promise<boolean>;
  listPixelCharacters(projectId?: string): Promise<PixelCharacter[]>;
  savePixelCharacter(input: PixelCharacterInput): Promise<PixelCharacter>;
  deletePixelCharacter(id: string): Promise<boolean>;
  generatePixelCharacterViews(
    characterId: string,
    seed?: number,
    width?: number,
    height?: number
  ): Promise<PixelAssetDetail[]>;
  listPixelAssets(filters?: PixelAssetFilters): Promise<PixelAssetRecord[]>;
  getPixelAsset(id: string): Promise<PixelAssetDetail>;
  generatePixelAsset(input: PixelGenerateInput): Promise<PixelAssetDetail>;
  importPixelAsset(input: PixelImportInput): Promise<PixelAssetDetail>;
  savePixelAssetFrames(
    assetId: string,
    frames: PixelFrameInput[],
    dimensions?: { width: number; height: number },
    palette?: string[]
  ): Promise<PixelAssetDetail>;
  savePixelAssetAnimations(
    assetId: string,
    animations: PixelAnimationInput[]
  ): Promise<PixelAssetDetail>;
  savePixelAssetPalette(assetId: string, palette: string[]): Promise<PixelAssetDetail>;
  listPixelAssetVersions(assetId: string): Promise<PixelAssetVersion[]>;
  getPixelAssetVersion(assetId: string, version: number): Promise<PixelAssetDetail>;
  restorePixelAssetVersion(assetId: string, version: number): Promise<PixelAssetDetail>;
  listPixelPalettes(): Promise<PixelSavedPalette[]>;
  savePixelPalette(input: PixelSavedPaletteInput): Promise<PixelSavedPalette>;
  deletePixelPalette(id: string): Promise<boolean>;
  renamePixelAsset(id: string, name: string): Promise<PixelAssetRecord>;
  duplicatePixelAsset(id: string, name?: string): Promise<PixelAssetDetail>;
  deletePixelAsset(id: string): Promise<boolean>;
  exportPixelAsset(
    id: string,
    format: PixelExportFormat,
    options?: PixelExportOptions
  ): Promise<PixelExportResult>;
  openPixelExportFolder(assetId: string): Promise<string>;
  pickPixelReferenceImage(): Promise<string | null>;
  planPixelPackage(request: PixelPackageRequest): Promise<PixelPackagePlan>;
  exportPixelPackage(request: PixelPackageRequest): Promise<PixelPackageResult>;
  cancelPixelPackage(jobId: string): Promise<boolean>;
  pickPixelPackageDestination(): Promise<string | null>;
  revealPixelPackage(targetPath: string): Promise<void>;
  getSpriteKilnReport(): Promise<SpriteKilnReport>;
  getPixelAiStatus(): Promise<PixelAiBackendStatus>;
  testPixelAiConnection(): Promise<PixelAiConnectionTest>;
  generatePixelAi(input: PixelAiGenerateInput): Promise<PixelAiJob>;
  cancelPixelAiJob(jobId: string): Promise<boolean>;
  getPixelAiJob(jobId: string): Promise<PixelAiJob>;
  listPixelAiJobs(): Promise<PixelAiJob[]>;

  // Event listeners (returning unsubscribe function)
  onRuntimeChanged(cb: (state: RuntimeState) => void): () => void;
  onJobUpdated(cb: (job: GenerationJob) => void): () => void;
  onDownloadUpdated(cb: (task: DownloadTask) => void): () => void;
  onCivitaiDownloadProgress(cb: (task: CivitaiDownloadTask) => void): () => void;
  onImageCreated(cb: (image: GeneratedImageRecord) => void): () => void;
  onVideoCreated(cb: (video: GeneratedVideoRecord) => void): () => void;
  onPixelAiJobUpdated(cb: (job: PixelAiJob) => void): () => void;
  onPixelPackageProgress(cb: (progress: PixelPackageProgress) => void): () => void;
  onTrainingProgress(
    cb: (payload: { jobId: string; step: number; maxSteps: number; epoch?: number; loss?: number | null }) => void
  ): () => void;
  onTrainingLog(cb: (payload: { jobId: string; line: string }) => void): () => void;
  onTrainingCompleted(
    cb: (payload: { jobId: string; status: string; adapterId?: string | null; error?: string }) => void
  ): () => void;
  onTrainingTelemetry(
    cb: (telemetry: CharacterTrainingTelemetry) => void
  ): () => void;
  onVisionTaggingProgress(
    cb: (payload: { current: number; total: number; referenceId: string; status: "analyzing" | "completed" | "error" }) => void
  ): () => void;
}

declare global {
  interface Window {
    kirea: KireaDesktopApi;
  }
}

