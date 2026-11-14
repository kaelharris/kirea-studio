import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { KireaDesktopApi } from "../shared/api";

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => {
    cb(payload);
  };
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const api: KireaDesktopApi = {
  // App & diagnostics
  getDiagnostics: () => ipcRenderer.invoke("app:getDiagnostics"),
  exportLogs: () => ipcRenderer.invoke("app:exportLogs"),
  openPath: (targetPath) => ipcRenderer.invoke("app:openPath", targetPath),
  openExternalUrl: (url) => ipcRenderer.invoke("app:openExternal", url),
  pickDirectory: (title) => ipcRenderer.invoke("app:pickDirectory", title),
  pickImage: () => ipcRenderer.invoke("app:pickImage"),
  getFileDataUrl: (filePath) => ipcRenderer.invoke("app:getFileDataUrl", filePath),

  // Settings
  getSettings: () => ipcRenderer.invoke("settings:get"),
  updateSettings: (partial) => ipcRenderer.invoke("settings:update", partial),

  // Hardware & runtime
  getHardwareStats: () => ipcRenderer.invoke("hardware:getStats"),
  getRuntimeState: () => ipcRenderer.invoke("runtime:getState"),
  discoverRuntime: () => ipcRenderer.invoke("runtime:discover"),
  testRuntimeConnection: () => ipcRenderer.invoke("runtime:testConnection"),
  startRuntime: (mode) => ipcRenderer.invoke("runtime:start", mode),
  stopRuntime: () => ipcRenderer.invoke("runtime:stop"),
  getRuntimeLogs: () => ipcRenderer.invoke("runtime:getLogs"),
  checkRuntimeRelease: () => ipcRenderer.invoke("models:checkRuntimeRelease"),
  installManagedRuntime: () => ipcRenderer.invoke("runtime:installManaged"),

  // Models & catalog
  scanModels: () => ipcRenderer.invoke("models:scan"),
  listModels: (category) => ipcRenderer.invoke("models:list", category),
  deleteModel: (filePath) => ipcRenderer.invoke("models:delete", filePath),
  updateModelMetadata: (modelId, patch) =>
    ipcRenderer.invoke("models:updateMetadata", modelId, patch),
  getModelPreview: (modelId) => ipcRenderer.invoke("models:getPreview", modelId),
  importModelPreview: (modelId) => ipcRenderer.invoke("models:importPreview", modelId),
  getCuratedCatalog: () => ipcRenderer.invoke("models:catalog"),

  // LoRA recipes
  listLoraRecipes: () => ipcRenderer.invoke("recipes:list"),
  saveLoraRecipe: (input) => ipcRenderer.invoke("recipes:save", input),
  deleteLoraRecipe: (id) => ipcRenderer.invoke("recipes:delete", id),

  // Characters
  listCharacters: () => ipcRenderer.invoke("characters:list"),
  saveCharacter: (input) => ipcRenderer.invoke("characters:save", input),
  deleteCharacter: (id) => ipcRenderer.invoke("characters:delete", id),
  pickCharacterReference: (characterId, role) =>
    ipcRenderer.invoke("characters:pickReference", characterId, role),
  addCharacterReferenceFromImage: (characterId, imageId, role, caption) =>
    ipcRenderer.invoke("characters:addLibraryReference", characterId, imageId, role, caption),
  updateCharacterReference: (characterId, referenceId, patch) =>
    ipcRenderer.invoke("characters:updateReference", characterId, referenceId, patch),
  removeCharacterReference: (characterId, referenceId) =>
    ipcRenderer.invoke("characters:removeReference", characterId, referenceId),
  getCharacterPreview: (characterId) =>
    ipcRenderer.invoke("characters:getPreview", characterId),

  // Stories
  listStories: () => ipcRenderer.invoke("stories:list"),
  getStory: (id) => ipcRenderer.invoke("stories:get", id),
  saveStory: (input) => ipcRenderer.invoke("stories:save", input),
  deleteStory: (id) => ipcRenderer.invoke("stories:delete", id),
  saveStoryScene: (input) => ipcRenderer.invoke("stories:saveScene", input),
  deleteStoryScene: (storyId, sceneId) =>
    ipcRenderer.invoke("stories:deleteScene", storyId, sceneId),
  reorderStoryScenes: (storyId, sceneIds) =>
    ipcRenderer.invoke("stories:reorderScenes", storyId, sceneIds),
  setStorySceneCast: (storyId, sceneId, cast) =>
    ipcRenderer.invoke("stories:setSceneCast", storyId, sceneId, cast),
  selectStorySceneImage: (storyId, sceneId, imageId) =>
    ipcRenderer.invoke("stories:selectSceneImage", storyId, sceneId, imageId),
  planStoryScene: (storyId, sceneId) =>
    ipcRenderer.invoke("stories:planScene", storyId, sceneId),
  generateStoryScene: (storyId, sceneId) =>
    ipcRenderer.invoke("stories:generateScene", storyId, sceneId),
  generateStory: (storyId) =>
    ipcRenderer.invoke("stories:generateStory", storyId),

  // Story canvases & exports
  listCanvases: (storyId) => ipcRenderer.invoke("canvas:list", storyId),
  saveCanvas: (input) => ipcRenderer.invoke("canvas:save", input),
  deleteCanvas: (id) => ipcRenderer.invoke("canvas:delete", id),
  saveCanvasItem: (input) => ipcRenderer.invoke("canvas:saveItem", input),
  deleteCanvasItem: (canvasId, itemId) =>
    ipcRenderer.invoke("canvas:deleteItem", canvasId, itemId),
  reorderCanvasItems: (canvasId, itemIds) =>
    ipcRenderer.invoke("canvas:reorderItems", canvasId, itemIds),
  syncCanvas: (canvasId) => ipcRenderer.invoke("canvas:sync", canvasId),
  exportCanvasPng: (canvasId) => ipcRenderer.invoke("canvas:exportPng", canvasId),
  exportCanvasPdf: (canvasId) => ipcRenderer.invoke("canvas:exportPdf", canvasId),
  openCanvasExportFolder: (storyId) =>
    ipcRenderer.invoke("canvas:openExportFolder", storyId),
  listStoryExports: (storyId) => ipcRenderer.invoke("exports:list", storyId),

  // Downloads
  listDownloads: () => ipcRenderer.invoke("downloads:list"),
  startModelDownload: (catalogItemId) => ipcRenderer.invoke("downloads:startModel", catalogItemId),
  pauseDownload: (id) => ipcRenderer.invoke("downloads:pause", id),
  resumeDownload: (id) => ipcRenderer.invoke("downloads:resume", id),
  cancelDownload: (id) => ipcRenderer.invoke("downloads:cancel", id),

  // Civitai Hub
  searchCivitaiModels: (query) => ipcRenderer.invoke("civitai:searchModels", query),
  getCivitaiModelDetails: (modelId) =>
    ipcRenderer.invoke("civitai:getModelDetails", modelId),
  startCivitaiDownload: (modelId, versionId) =>
    ipcRenderer.invoke("civitai:startDownload", { modelId, versionId }),
  cancelCivitaiDownload: (id) => ipcRenderer.invoke("civitai:cancelDownload", id),
  retryCivitaiDownload: (id) => ipcRenderer.invoke("civitai:retryDownload", id),
  listCivitaiDownloads: () => ipcRenderer.invoke("civitai:listDownloads"),
  setCivitaiApiKey: (apiKey) => ipcRenderer.invoke("civitai:setApiKey", apiKey),
  testCivitaiConnection: () => ipcRenderer.invoke("civitai:testConnection"),

  // Workflows & generation
  listWorkflows: () => ipcRenderer.invoke("workflows:list"),
  getSamplersAndSchedulers: () => ipcRenderer.invoke("workflows:getSamplers"),
  validateJob: (req) => ipcRenderer.invoke("jobs:validate", req),
  submitJob: (req) => ipcRenderer.invoke("jobs:submit", req),
  listJobs: () => ipcRenderer.invoke("jobs:list"),
  cancelJob: (jobId) => ipcRenderer.invoke("jobs:cancel", jobId),
  retryJob: (jobId) => ipcRenderer.invoke("jobs:retry", jobId),

  // Library, collections & prompts
  listImages: (filters) => ipcRenderer.invoke("library:list", filters),
  toggleImageFavorite: (id) => ipcRenderer.invoke("library:toggleFavorite", id),
  updateImageMeta: (id, updates) => ipcRenderer.invoke("library:updateMeta", id, updates),
  deleteImage: (id) => ipcRenderer.invoke("library:delete", id),
  exportImage: (id, format, stripMetadata) =>
    ipcRenderer.invoke("library:export", id, format, stripMetadata),
  listCollections: () => ipcRenderer.invoke("collections:list"),
  createCollection: (name, description) =>
    ipcRenderer.invoke("collections:create", name, description),
  deleteCollection: (id) => ipcRenderer.invoke("collections:delete", id),
  listPrompts: () => ipcRenderer.invoke("prompts:list"),
  savePrompt: (record) => ipcRenderer.invoke("prompts:save", record),
  deletePrompt: (id) => ipcRenderer.invoke("prompts:delete", id),

  // Pixel Studio
  listPixelProjects: () => ipcRenderer.invoke("pixel:listProjects"),
  savePixelProject: (input) => ipcRenderer.invoke("pixel:saveProject", input),
  deletePixelProject: (id) => ipcRenderer.invoke("pixel:deleteProject", id),
  listPixelCharacters: (projectId) => ipcRenderer.invoke("pixel:listCharacters", projectId),
  savePixelCharacter: (input) => ipcRenderer.invoke("pixel:saveCharacter", input),
  deletePixelCharacter: (id) => ipcRenderer.invoke("pixel:deleteCharacter", id),
  generatePixelCharacterViews: (characterId, seed, width, height) =>
    ipcRenderer.invoke("pixel:generateCharacterViews", characterId, seed, width, height),
  listPixelAssets: (filters) => ipcRenderer.invoke("pixel:listAssets", filters),
  getPixelAsset: (id) => ipcRenderer.invoke("pixel:getAsset", id),
  generatePixelAsset: (input) => ipcRenderer.invoke("pixel:generateAsset", input),
  importPixelAsset: (input) => ipcRenderer.invoke("pixel:importAsset", input),
  savePixelAssetFrames: (assetId, frames, dimensions) =>
    ipcRenderer.invoke("pixel:saveFrames", { assetId, frames, ...(dimensions ?? {}) }),
  listPixelAssetVersions: (assetId) => ipcRenderer.invoke("pixel:listVersions", assetId),
  renamePixelAsset: (id, name) => ipcRenderer.invoke("pixel:renameAsset", id, name),
  duplicatePixelAsset: (id, name) => ipcRenderer.invoke("pixel:duplicateAsset", id, name),
  deletePixelAsset: (id) => ipcRenderer.invoke("pixel:deleteAsset", id),
  exportPixelAsset: (id, format, options) =>
    ipcRenderer.invoke("pixel:exportAsset", { assetId: id, format, options }),
  openPixelExportFolder: (assetId) =>
    ipcRenderer.invoke("pixel:openExportFolder", assetId),
  pickPixelReferenceImage: () => ipcRenderer.invoke("pixel:pickImage"),
  getSpriteKilnReport: () => ipcRenderer.invoke("pixel:spriteKilnReport"),

  // Push events
  onRuntimeChanged: (cb) => subscribe("event:runtimeChanged", cb),
  onJobUpdated: (cb) => subscribe("event:jobUpdated", cb),
  onDownloadUpdated: (cb) => subscribe("event:downloadUpdated", cb),
  onCivitaiDownloadProgress: (cb) =>
    subscribe("event:civitaiDownloadProgress", cb),
  onImageCreated: (cb) => subscribe("event:imageCreated", cb),
};

contextBridge.exposeInMainWorld("kirea", api);

