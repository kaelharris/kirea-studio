export const IPC_CHANNELS = {
  // App & diagnostics
  APP_GET_DIAGNOSTICS: "app:getDiagnostics",
  APP_EXPORT_LOGS: "app:exportLogs",
  APP_OPEN_PATH: "app:openPath",
  APP_OPEN_EXTERNAL: "app:openExternal",
  APP_PICK_DIRECTORY: "app:pickDirectory",
  APP_PICK_IMAGE: "app:pickImage",
  APP_GET_FILE_DATA_URL: "app:getFileDataUrl",

  // Settings
  SETTINGS_GET: "settings:get",
  SETTINGS_UPDATE: "settings:update",

  // Hardware & Runtime
  HARDWARE_GET_STATS: "hardware:getStats",
  RUNTIME_GET_STATE: "runtime:getState",
  RUNTIME_DISCOVER: "runtime:discover",
  RUNTIME_TEST_CONNECTION: "runtime:testConnection",
  RUNTIME_START: "runtime:start",
  RUNTIME_STOP: "runtime:stop",
  RUNTIME_GET_LOGS: "runtime:getLogs",
  RUNTIME_INSTALL_MANAGED: "runtime:installManaged",

  // Models & Catalog
  MODELS_SCAN: "models:scan",
  MODELS_LIST: "models:list",
  MODELS_DELETE: "models:delete",
  MODELS_CATALOG: "models:catalog",
  MODELS_CHECK_UPDATES: "models:checkRuntimeRelease",
  MODELS_UPDATE_METADATA: "models:updateMetadata",
  MODELS_GET_PREVIEW: "models:getPreview",
  MODELS_IMPORT_PREVIEW: "models:importPreview",

  // LoRA recipes
  RECIPES_LIST: "recipes:list",
  RECIPES_SAVE: "recipes:save",
  RECIPES_DELETE: "recipes:delete",

  // Characters
  CHARACTERS_LIST: "characters:list",
  CHARACTERS_SAVE: "characters:save",
  CHARACTERS_DELETE: "characters:delete",
  CHARACTERS_PICK_REFERENCE: "characters:pickReference",
  CHARACTERS_ADD_LIBRARY_REFERENCE: "characters:addLibraryReference",
  CHARACTERS_UPDATE_REFERENCE: "characters:updateReference",
  CHARACTERS_REMOVE_REFERENCE: "characters:removeReference",
  CHARACTERS_GET_PREVIEW: "characters:getPreview",

  // Stories
  STORIES_LIST: "stories:list",
  STORIES_GET: "stories:get",
  STORIES_SAVE: "stories:save",
  STORIES_DELETE: "stories:delete",
  STORIES_SAVE_SCENE: "stories:saveScene",
  STORIES_DELETE_SCENE: "stories:deleteScene",
  STORIES_REORDER_SCENES: "stories:reorderScenes",
  STORIES_SET_SCENE_CAST: "stories:setSceneCast",
  STORIES_SELECT_SCENE_IMAGE: "stories:selectSceneImage",
  STORIES_PLAN_SCENE: "stories:planScene",
  STORIES_GENERATE_SCENE: "stories:generateScene",
  STORIES_GENERATE_STORY: "stories:generateStory",

  CANVASES_LIST: "canvas:list",
  CANVASES_SAVE: "canvas:save",
  CANVASES_DELETE: "canvas:delete",
  CANVASES_SAVE_ITEM: "canvas:saveItem",
  CANVASES_DELETE_ITEM: "canvas:deleteItem",
  CANVASES_REORDER_ITEMS: "canvas:reorderItems",
  CANVASES_SYNC: "canvas:sync",
  CANVASES_EXPORT_PNG: "canvas:exportPng",
  CANVASES_EXPORT_PDF: "canvas:exportPdf",
  CANVASES_OPEN_EXPORT_FOLDER: "canvas:openExportFolder",

  EXPORTS_LIST: "exports:list",

  // Downloads
  DOWNLOADS_LIST: "downloads:list",
  DOWNLOADS_START_MODEL: "downloads:startModel",
  DOWNLOADS_PAUSE: "downloads:pause",
  DOWNLOADS_RESUME: "downloads:resume",
  DOWNLOADS_CANCEL: "downloads:cancel",

  // Civitai Hub
  CIVITAI_SEARCH_MODELS: "civitai:searchModels",
  CIVITAI_GET_MODEL_DETAILS: "civitai:getModelDetails",
  CIVITAI_START_DOWNLOAD: "civitai:startDownload",
  CIVITAI_CANCEL_DOWNLOAD: "civitai:cancelDownload",
  CIVITAI_RETRY_DOWNLOAD: "civitai:retryDownload",
  CIVITAI_LIST_DOWNLOADS: "civitai:listDownloads",
  CIVITAI_SET_API_KEY: "civitai:setApiKey",
  CIVITAI_TEST_CONNECTION: "civitai:testConnection",

  // Workflows & Generation
  WORKFLOWS_LIST: "workflows:list",
  WORKFLOWS_GET_SAMPLERS: "workflows:getSamplers",
  JOBS_VALIDATE: "jobs:validate",
  JOBS_SUBMIT: "jobs:submit",
  JOBS_LIST: "jobs:list",
  JOBS_CANCEL: "jobs:cancel",
  JOBS_RETRY: "jobs:retry",

  // Library, Prompts & Collections
  LIBRARY_LIST: "library:list",
  LIBRARY_TOGGLE_FAVORITE: "library:toggleFavorite",
  LIBRARY_UPDATE_META: "library:updateMeta",
  LIBRARY_DELETE: "library:delete",
  LIBRARY_EXPORT: "library:export",
  COLLECTIONS_LIST: "collections:list",
  COLLECTIONS_CREATE: "collections:create",
  COLLECTIONS_DELETE: "collections:delete",
  PROMPTS_LIST: "prompts:list",
  PROMPTS_SAVE: "prompts:save",
  PROMPTS_DELETE: "prompts:delete",

  // Pixel Studio
  PIXEL_PROJECTS_LIST: "pixel:listProjects",
  PIXEL_PROJECTS_SAVE: "pixel:saveProject",
  PIXEL_PROJECTS_DELETE: "pixel:deleteProject",
  PIXEL_CHARACTERS_LIST: "pixel:listCharacters",
  PIXEL_CHARACTERS_SAVE: "pixel:saveCharacter",
  PIXEL_CHARACTERS_DELETE: "pixel:deleteCharacter",
  PIXEL_CHARACTERS_GENERATE_VIEWS: "pixel:generateCharacterViews",
  PIXEL_ASSETS_LIST: "pixel:listAssets",
  PIXEL_ASSETS_GET: "pixel:getAsset",
  PIXEL_ASSETS_GENERATE: "pixel:generateAsset",
  PIXEL_ASSETS_IMPORT: "pixel:importAsset",
  PIXEL_ASSETS_SAVE_FRAMES: "pixel:saveFrames",
  PIXEL_ASSETS_VERSIONS: "pixel:listVersions",
  PIXEL_ASSETS_RENAME: "pixel:renameAsset",
  PIXEL_ASSETS_DUPLICATE: "pixel:duplicateAsset",
  PIXEL_ASSETS_DELETE: "pixel:deleteAsset",
  PIXEL_ASSETS_EXPORT: "pixel:exportAsset",
  PIXEL_ASSETS_OPEN_EXPORT: "pixel:openExportFolder",
  PIXEL_ASSETS_PICK_IMAGE: "pixel:pickImage",
  PIXEL_SPRITEKILN_REPORT: "pixel:spriteKilnReport",

  // Main -> Renderer push events
  EVENT_RUNTIME_CHANGED: "event:runtimeChanged",
  EVENT_JOB_UPDATED: "event:jobUpdated",
  EVENT_DOWNLOAD_UPDATED: "event:downloadUpdated",
  EVENT_CIVITAI_DOWNLOAD_PROGRESS: "event:civitaiDownloadProgress",
  EVENT_IMAGE_CREATED: "event:imageCreated",
} as const;
