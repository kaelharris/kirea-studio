import type {
  AppSettings,
  CharacterProfile,
  CharacterProfileInput,
  CharacterReference,
  CharacterReferenceRole,
  CollectionRecord,
  DownloadTask,
  GeneratedImageRecord,
  GeneratedVideoRecord,
  GenerationJob,
  GenerationMode,
  LoraRecipe,
  LoraRecipeInput,
  ModelCategory,
  ModelMetadataPatch,
  ModelRecord,
  PromptRecord,
  Story,
  StoryCanvas,
  StoryCanvasInput,
  StoryCanvasItemInput,
  StoryExportKind,
  StoryExportRecord,
  StoryInput,
  StorySceneCastInput,
  StorySceneInput,
  WorkflowTemplate,
} from "../../shared/types";
import type { StudioDatabase } from "./database";
import { CharactersRepository } from "./repos/characters-repo";
import { GenerationsRepository } from "./repos/generations-repo";
import { ModelsRepository } from "./repos/models-repo";
import { PixelRepository } from "./repos/pixel-repo";
import { StoriesRepository } from "./repos/stories-repo";
import { safeParseJson } from "./repo-mappers";

export class StudioRepository {
  readonly models: ModelsRepository;
  readonly characters: CharactersRepository;
  readonly stories: StoriesRepository;
  readonly generations: GenerationsRepository;
  readonly pixel: PixelRepository;

  constructor(private readonly studioDb: StudioDatabase) {
    this.models = new ModelsRepository(studioDb);
    this.characters = new CharactersRepository(studioDb);
    this.generations = new GenerationsRepository(studioDb, (job) =>
      this.stories.syncStorySceneFromJob(job)
    );
    this.stories = new StoriesRepository(studioDb, this.generations);
    this.pixel = new PixelRepository(studioDb);
  }

  getSettings(defaults: AppSettings): AppSettings {
    const row = this.studioDb.db
      .prepare("SELECT value_json FROM settings WHERE key = ?")
      .get("app_settings") as { value_json: string } | undefined;
    if (!row) return { ...defaults };
    const parsed = safeParseJson<Partial<AppSettings>>(row.value_json, {});
    return { ...defaults, ...parsed };
  }

  saveSettings(partial: Partial<AppSettings>, defaults: AppSettings): AppSettings {
    const next = { ...this.getSettings(defaults), ...partial };
    const now = new Date().toISOString();
    this.studioDb.db
      .prepare(
        `INSERT INTO settings (key, value_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
      )
      .run("app_settings", JSON.stringify(next), now);
    return next;
  }

  upsertWorkflowMetadata(templates: WorkflowTemplate[]): void {
    const stmt = this.studioDb.db.prepare(
      `INSERT INTO workflows (id, version, name, description, mode, metadata_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         version = excluded.version,
         name = excluded.name,
         description = excluded.description,
         mode = excluded.mode,
         metadata_json = excluded.metadata_json,
         updated_at = excluded.updated_at`
    );
    const now = new Date().toISOString();
    const tx = this.studioDb.db.transaction(() => {
      for (const wf of templates) {
        stmt.run(
          wf.id,
          wf.version,
          wf.name,
          wf.description,
          wf.mode,
          JSON.stringify(wf),
          now
        );
      }
    });
    tx();
  }

  // Models & LoRA Recipes & Downloads
  replaceScannedModels = (models: ModelRecord[]): void => this.models.replaceScannedModels(models);
  listModels = (category?: ModelCategory): ModelRecord[] => this.models.listModels(category);
  getModelById = (modelId: string): ModelRecord | null => this.models.getModelById(modelId);
  updateModelMetadata = (modelId: string, patch: ModelMetadataPatch): ModelRecord =>
    this.models.updateModelMetadata(modelId, patch);
  deleteModelRecord = (filePath: string): void => this.models.deleteModelRecord(filePath);
  listLoraRecipes = (): LoraRecipe[] => this.models.listLoraRecipes();
  saveLoraRecipe = (input: LoraRecipeInput): LoraRecipe => this.models.saveLoraRecipe(input);
  deleteLoraRecipe = (id: string): void => this.models.deleteLoraRecipe(id);
  markLoraRecipeUsed = (id: string): void => this.models.markLoraRecipeUsed(id);
  upsertDownload = (task: DownloadTask): void => this.models.upsertDownload(task);
  listDownloads = (limit = 50): DownloadTask[] => this.models.listDownloads(limit);

  // Characters
  listCharacters = (): CharacterProfile[] => this.characters.listCharacters();
  getCharacterById = (id: string): CharacterProfile | null => this.characters.getCharacterById(id);
  saveCharacter = (input: CharacterProfileInput): CharacterProfile =>
    this.characters.saveCharacter(input);
  deleteCharacter = (id: string): boolean => this.characters.deleteCharacter(id);
  addCharacterReference: CharactersRepository["addCharacterReference"] = (input) =>
    this.characters.addCharacterReference(input);
  updateCharacterReference: CharactersRepository["updateCharacterReference"] = (
    characterId,
    refId,
    patch
  ) => this.characters.updateCharacterReference(characterId, refId, patch);
  removeCharacterReference = (characterId: string, refId: string): CharacterReference | null =>
    this.characters.removeCharacterReference(characterId, refId);
  markCharacterUsed = (id: string): void => this.characters.markCharacterUsed(id);

  // Stories & Canvases
  listStories = (): Story[] => this.stories.listStories();
  getStoryById = (id: string): Story | null => this.stories.getStoryById(id);
  saveStory = (input: StoryInput): Story => this.stories.saveStory(input);
  deleteStory = (id: string): boolean => this.stories.deleteStory(id);
  saveStoryScene = (input: StorySceneInput): Story => this.stories.saveStoryScene(input);
  deleteStoryScene = (storyId: string, sceneId: string): Story | null =>
    this.stories.deleteStoryScene(storyId, sceneId);
  reorderStoryScenes = (storyId: string, sceneIds: string[]): Story | null =>
    this.stories.reorderStoryScenes(storyId, sceneIds);
  setStorySceneCast = (
    storyId: string,
    sceneId: string,
    cast: StorySceneCastInput[]
  ): Story | null => this.stories.setStorySceneCast(storyId, sceneId, cast);
  selectStorySceneImage = (
    storyId: string,
    sceneId: string,
    imageId: string | null
  ): Story | null => this.stories.selectStorySceneImage(storyId, sceneId, imageId);
  markStoryInProgress = (storyId: string): void => this.stories.markStoryInProgress(storyId);
  listCanvases = (storyId?: string): StoryCanvas[] => this.stories.listCanvases(storyId);
  getCanvasById = (id: string): StoryCanvas | null => this.stories.getCanvasById(id);
  saveCanvas = (input: StoryCanvasInput): StoryCanvas => this.stories.saveCanvas(input);
  deleteCanvas = (id: string): boolean => this.stories.deleteCanvas(id);
  saveCanvasItem = (input: StoryCanvasItemInput): StoryCanvas => this.stories.saveCanvasItem(input);
  deleteCanvasItem = (canvasId: string, itemId: string): StoryCanvas | null =>
    this.stories.deleteCanvasItem(canvasId, itemId);
  reorderCanvasItems = (canvasId: string, itemIds: string[]): StoryCanvas | null =>
    this.stories.reorderCanvasItems(canvasId, itemIds);
  syncCanvasFromStory = (canvasId: string): StoryCanvas | null =>
    this.stories.syncCanvasFromStory(canvasId);
  recordStoryExport: StoriesRepository["recordStoryExport"] = (input) =>
    this.stories.recordStoryExport(input);
  listStoryExports = (storyId?: string, limit = 100): StoryExportRecord[] =>
    this.stories.listStoryExports(storyId, limit);

  // Generations, Images, Collections & Prompts
  upsertJob = (job: GenerationJob): void => this.generations.upsertJob(job);
  listJobs = (limit = 150): GenerationJob[] => this.generations.listJobs(limit);
  getJobById = (id: string): GenerationJob | null => this.generations.getJobById(id);
  recordCompletedGenerationTx: GenerationsRepository["recordCompletedGenerationTx"] = (
    job,
    images,
    storyContext
  ) => this.generations.recordCompletedGenerationTx(job, images, storyContext);
  listImages: GenerationsRepository["listImages"] = (filters) => this.generations.listImages(filters);
  getImageById = (id: string): GeneratedImageRecord | null => this.generations.getImageById(id);
  toggleImageFavorite = (id: string): GeneratedImageRecord | null =>
    this.generations.toggleImageFavorite(id);
  updateImageMetadata: GenerationsRepository["updateImageMetadata"] = (id, updates) =>
    this.generations.updateImageMetadata(id, updates);
  deleteImage = (id: string): void => this.generations.deleteImage(id);
  listCollections = (): CollectionRecord[] => this.generations.listCollections();
  createCollection = (id: string, name: string, description = ""): CollectionRecord =>
    this.generations.createCollection(id, name, description);
  deleteCollection = (id: string): void => this.generations.deleteCollection(id);
  listPrompts = (limit = 50): PromptRecord[] => this.generations.listPrompts(limit);
  savePrompt = (record: PromptRecord): PromptRecord => this.generations.savePrompt(record);
  deletePrompt = (id: string): void => this.generations.deletePrompt(id);

  // Video generations
  recordCompletedVideoTx: GenerationsRepository["recordCompletedVideoTx"] = (
    job,
    videos,
    promptContext
  ) => this.generations.recordCompletedVideoTx(job, videos, promptContext);
  listVideos = (limit = 100): GeneratedVideoRecord[] => this.generations.listVideos(limit);
  getVideoById = (id: string): GeneratedVideoRecord | null => this.generations.getVideoById(id);
  toggleVideoFavorite = (id: string): GeneratedVideoRecord | null =>
    this.generations.toggleVideoFavorite(id);
  deleteVideo = (id: string): void => this.generations.deleteVideo(id);
}
