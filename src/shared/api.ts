import type {
  CivitaiConnectionTest,
  CivitaiDownloadTask,
  CivitaiModelSummary,
  CivitaiSearchQuery,
  CivitaiSearchResult,
} from "./civitai";
import type {
  AppDiagnostics,
  AppSettings,
  CharacterProfile,
  CharacterProfileInput,
  CharacterReferenceRole,
  CollectionRecord,
  CuratedModelCatalogItem,
  DownloadTask,
  GeneratedImageRecord,
  GenerationJob,
  GenerationRequest,
  GpuStats,
  LoraRecipe,
  LoraRecipeInput,
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
  ValidationIssue,
  WorkflowTemplate,
} from "./types";

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
  importModelPreview(modelId: string): Promise<ModelRecord | null>;
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
    patch: { role?: CharacterReferenceRole; caption?: string; weight?: number }
  ): Promise<CharacterProfile | null>;
  removeCharacterReference(
    characterId: string,
    referenceId: string
  ): Promise<CharacterProfile | null>;
  getCharacterPreview(characterId: string): Promise<string | null>;

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

  // Civitai Hub
  searchCivitaiModels(query: CivitaiSearchQuery): Promise<CivitaiSearchResult>;
  getCivitaiModelDetails(modelId: number): Promise<CivitaiModelSummary>;
  startCivitaiDownload(modelId: number, versionId: number): Promise<CivitaiDownloadTask>;
  cancelCivitaiDownload(id: string): Promise<boolean>;
  retryCivitaiDownload(id: string): Promise<CivitaiDownloadTask | null>;
  listCivitaiDownloads(): Promise<CivitaiDownloadTask[]>;
  setCivitaiApiKey(apiKey: string): Promise<{ hasApiKey: boolean }>;
  testCivitaiConnection(): Promise<CivitaiConnectionTest>;

  // Workflows & generation
  listWorkflows(): Promise<WorkflowTemplate[]>;
  getSamplersAndSchedulers(): Promise<{ samplers: string[]; schedulers: string[] }>;
  validateJob(req: GenerationRequest): Promise<ValidationIssue[]>;
  submitJob(req: GenerationRequest): Promise<GenerationJob[]>;
  listJobs(): Promise<GenerationJob[]>;
  cancelJob(jobId: string): Promise<boolean>;
  retryJob(jobId: string): Promise<GenerationJob[]>;

  // Library, collections & prompts
  listImages(filters?: LibraryFilters): Promise<GeneratedImageRecord[]>;
  toggleImageFavorite(id: string): Promise<GeneratedImageRecord | null>;
  updateImageMeta(
    id: string,
    updates: { tags?: string[]; collectionId?: string | null }
  ): Promise<void>;
  deleteImage(id: string): Promise<void>;
  exportImage(id: string, format: OutputFormat, stripMetadata: boolean): Promise<string | null>;
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

  // Event listeners (returning unsubscribe function)
  onRuntimeChanged(cb: (state: RuntimeState) => void): () => void;
  onJobUpdated(cb: (job: GenerationJob) => void): () => void;
  onDownloadUpdated(cb: (task: DownloadTask) => void): () => void;
  onCivitaiDownloadProgress(cb: (task: CivitaiDownloadTask) => void): () => void;
  onImageCreated(cb: (image: GeneratedImageRecord) => void): () => void;
}

declare global {
  interface Window {
    kirea: KireaDesktopApi;
  }
}

