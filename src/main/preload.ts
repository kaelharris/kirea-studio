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

  // Application updates
  getUpdateState: () => ipcRenderer.invoke("update:getState"),
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  downloadUpdate: () => ipcRenderer.invoke("update:download"),
  cancelUpdateDownload: () => ipcRenderer.invoke("update:cancelDownload"),
  dismissUpdate: () => ipcRenderer.invoke("update:dismiss"),
  setUpdateChannel: (channel) => ipcRenderer.invoke("update:setChannel", channel),
  installUpdate: (force) => ipcRenderer.invoke("update:install", force ?? false),

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
  importModelPreview: (modelId, sourceFilePath) =>
    ipcRenderer.invoke("models:importPreview", modelId, sourceFilePath),
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
  startCivitaiDownload: (modelId, versionId, targetArchitecture) =>
    ipcRenderer.invoke("civitai:startDownload", { modelId, versionId, targetArchitecture }),
  pauseCivitaiDownload: (id) => ipcRenderer.invoke("civitai:pauseDownload", id),
  resumeCivitaiDownload: (id) => ipcRenderer.invoke("civitai:resumeDownload", id),
  cancelCivitaiDownload: (id) => ipcRenderer.invoke("civitai:cancelDownload", id),
  retryCivitaiDownload: (id) => ipcRenderer.invoke("civitai:retryDownload", id),
  listCivitaiDownloads: () => ipcRenderer.invoke("civitai:listDownloads"),
  setCivitaiApiKey: (apiKey) => ipcRenderer.invoke("civitai:setApiKey", apiKey),
  testCivitaiConnection: () => ipcRenderer.invoke("civitai:testConnection"),
  searchCivitaiWorkflows: (query) =>
    ipcRenderer.invoke("civitai:searchWorkflows", query),
  getCivitaiWorkflowDetails: (modelId) =>
    ipcRenderer.invoke("civitai:getWorkflowDetails", modelId),
  prepareCivitaiWorkflowImport: (request) =>
    ipcRenderer.invoke("civitai:prepareWorkflowImport", request),

  // Hugging Face Hub
  searchHuggingFaceModels: (query) =>
    ipcRenderer.invoke("huggingface:search", query),
  getHuggingFaceRepo: (repoId, revision) =>
    ipcRenderer.invoke("huggingface:getRepo", { repoId, revision }),
  checkHuggingFaceCompatibility: (request) =>
    ipcRenderer.invoke("huggingface:checkCompatibility", request),
  startHuggingFaceDownloads: (request) =>
    ipcRenderer.invoke("huggingface:startDownloads", request),
  setHuggingFaceToken: (token) => ipcRenderer.invoke("huggingface:setToken", token),
  testHuggingFaceConnection: () =>
    ipcRenderer.invoke("huggingface:testConnection"),

  // Workflows & generation
  listWorkflows: () => ipcRenderer.invoke("workflows:list"),
  getSamplersAndSchedulers: () => ipcRenderer.invoke("workflows:getSamplers"),
  analyzeWorkflowUrl: (url) => ipcRenderer.invoke("workflows:analyzeImportUrl", url),
  analyzeWorkflowFile: () => ipcRenderer.invoke("workflows:analyzeImportFile"),
  analyzeWorkflowArchiveFile: () => ipcRenderer.invoke("workflows:analyzeArchiveFile"),
  installWorkflowImport: (previewId) => ipcRenderer.invoke("workflows:installImport", previewId),
  listInstalledWorkflows: () => ipcRenderer.invoke("workflows:listInstalled"),
  revealInstalledWorkflow: (filePath) => ipcRenderer.invoke("workflows:revealInstalled", filePath),
  removeInstalledWorkflow: (filePath) => ipcRenderer.invoke("workflows:removeInstalled", filePath),
  revalidateInstalledWorkflow: (filePath) =>
    ipcRenderer.invoke("workflows:revalidateInstalled", filePath),
  reimportInstalledWorkflow: (filePath) =>
    ipcRenderer.invoke("workflows:reimportInstalled", filePath),
  validateJob: (req) => ipcRenderer.invoke("jobs:validate", req),
  submitJob: (req) => ipcRenderer.invoke("jobs:submit", req),
  listJobs: () => ipcRenderer.invoke("jobs:list"),
  cancelJob: (jobId) => ipcRenderer.invoke("jobs:cancel", jobId),
  retryJob: (jobId) => ipcRenderer.invoke("jobs:retry", jobId),

  // Library, collections & prompts
  listLibraryMedia: (query) => ipcRenderer.invoke("library:listMedia", query),
  listImages: (filters) => ipcRenderer.invoke("library:list", filters),
  toggleImageFavorite: (id) => ipcRenderer.invoke("library:toggleFavorite", id),
  updateImageMeta: (id, updates) => ipcRenderer.invoke("library:updateMeta", id, updates),
  deleteImage: (id) => ipcRenderer.invoke("library:delete", id),
  exportImage: (id, format, stripMetadata) =>
    ipcRenderer.invoke("library:export", id, format, stripMetadata),
  batchDeleteLibraryMedia: (ids) => ipcRenderer.invoke("library:batchDelete", ids),
  batchExportLibraryMedia: (ids, destinationDir) =>
    ipcRenderer.invoke("library:batchExport", ids, destinationDir),
  batchSetLibraryCollection: (ids, collectionId) =>
    ipcRenderer.invoke("library:batchSetCollection", ids, collectionId),
  batchSetLibraryFavorite: (ids, favorite) =>
    ipcRenderer.invoke("library:batchFavorite", ids, favorite),
  listVideos: () => ipcRenderer.invoke("videos:list"),
  toggleVideoFavorite: (id) => ipcRenderer.invoke("videos:toggleFavorite", id),
  deleteVideo: (id) => ipcRenderer.invoke("videos:delete", id),
  exportVideo: (id) => ipcRenderer.invoke("videos:export", id),
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
  savePixelAssetFrames: (assetId, frames, dimensions, palette) =>
    ipcRenderer.invoke("pixel:saveFrames", {
      assetId,
      frames,
      ...(dimensions ?? {}),
      ...(palette ? { palette } : {}),
    }),
  savePixelAssetAnimations: (assetId, animations) =>
    ipcRenderer.invoke("pixel:saveAnimations", { assetId, animations }),
  savePixelAssetPalette: (assetId, palette) =>
    ipcRenderer.invoke("pixel:savePalette", { assetId, palette }),
  listPixelAssetVersions: (assetId) => ipcRenderer.invoke("pixel:listVersions", assetId),
  getPixelAssetVersion: (assetId, version) =>
    ipcRenderer.invoke("pixel:getVersion", { assetId, version }),
  restorePixelAssetVersion: (assetId, version) =>
    ipcRenderer.invoke("pixel:restoreVersion", { assetId, version }),
  listPixelPalettes: () => ipcRenderer.invoke("pixel:listPalettes"),
  savePixelPalette: (input) => ipcRenderer.invoke("pixel:savePaletteRecord", input),
  deletePixelPalette: (id) => ipcRenderer.invoke("pixel:deletePaletteRecord", id),
  renamePixelAsset: (id, name) => ipcRenderer.invoke("pixel:renameAsset", id, name),
  duplicatePixelAsset: (id, name) => ipcRenderer.invoke("pixel:duplicateAsset", id, name),
  deletePixelAsset: (id) => ipcRenderer.invoke("pixel:deleteAsset", id),
  exportPixelAsset: (id, format, options) =>
    ipcRenderer.invoke("pixel:exportAsset", { assetId: id, format, options }),
  openPixelExportFolder: (assetId) =>
    ipcRenderer.invoke("pixel:openExportFolder", assetId),
  pickPixelReferenceImage: () => ipcRenderer.invoke("pixel:pickImage"),
  planPixelPackage: (request) => ipcRenderer.invoke("pixel:packagePlan", request),
  exportPixelPackage: (request) => ipcRenderer.invoke("pixel:packageExport", request),
  cancelPixelPackage: (jobId) => ipcRenderer.invoke("pixel:packageCancel", jobId),
  pickPixelPackageDestination: () =>
    ipcRenderer.invoke("pixel:packagePickDestination"),
  revealPixelPackage: (targetPath) =>
    ipcRenderer.invoke("pixel:packageReveal", targetPath),
  getSpriteKilnReport: () => ipcRenderer.invoke("pixel:spriteKilnReport"),
  getPixelAiStatus: () => ipcRenderer.invoke("pixel:aiStatus"),
  testPixelAiConnection: () => ipcRenderer.invoke("pixel:aiTestConnection"),
  generatePixelAi: (input) => ipcRenderer.invoke("pixel:aiGenerate", input),
  cancelPixelAiJob: (jobId) => ipcRenderer.invoke("pixel:aiCancel", jobId),
  getPixelAiJob: (jobId) => ipcRenderer.invoke("pixel:aiGetJob", jobId),
  listPixelAiJobs: () => ipcRenderer.invoke("pixel:aiListJobs"),

  // Push events
  onRuntimeChanged: (cb) => subscribe("event:runtimeChanged", cb),
  onJobUpdated: (cb) => subscribe("event:jobUpdated", cb),
  onDownloadUpdated: (cb) => subscribe("event:downloadUpdated", cb),
  onCivitaiDownloadProgress: (cb) =>
    subscribe("event:civitaiDownloadProgress", cb),
  onImageCreated: (cb) => subscribe("event:imageCreated", cb),
  onVideoCreated: (cb) => subscribe("event:videoCreated", cb),
  onPixelAiJobUpdated: (cb) => subscribe("event:pixelAiJobUpdated", cb),
  onPixelPackageProgress: (cb) => subscribe("event:pixelPackageProgress", cb),
  onUpdateStateChanged: (cb) => subscribe("event:updateStateChanged", cb),
};

contextBridge.exposeInMainWorld("kirea", api);

