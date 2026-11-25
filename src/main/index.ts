import {
  app,
  BrowserWindow,
  Menu,
  nativeImage,
  net,
  protocol,
  type MenuItemConstructorOptions,
} from "electron";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { IPC_CHANNELS } from "../shared/ipc-channels";
import type { AppSettings, ModelRecord } from "../shared/types";
import { CivitaiClient } from "./civitai/civitai-client";
import { CivitaiDownloadManager } from "./civitai/download-manager";
import { CivitaiKeyStore } from "./civitai/secure-key-store";
import { ComfyRuntimeManager, discoverExistingComfyPaths } from "./comfy/runtime-manager";
import { WORKFLOW_TEMPLATES } from "./comfy/workflow-registry";
import { StudioDatabase } from "./db/database";
import { StudioRepository } from "./db/repositories";
import { DownloadManager } from "./downloads/download-manager";
import { HuggingFaceClient } from "./huggingface/hf-client";
import { HuggingFaceService } from "./huggingface/hf-service";
import { HuggingFaceTokenStore } from "./huggingface/token-store";
import { detectHardwareStats } from "./hardware/gpu-detector";
import { registerIpcHandlers } from "./ipc/register-handlers";
import { shutdownTraining } from "./ipc/handlers/stories-handlers";
import { JobOrchestrator } from "./jobs/job-orchestrator";
import { StudioLogger } from "./logger";
import { ModelScanner } from "./models/model-scanner";
import { resolveStudioPaths, type StudioPaths } from "./paths";
import { isPathInsideAnyRoot } from "./security";
import {
  getSplashPresentation,
  shouldRevealMainWindow,
} from "./startup/splash-gate";
import { reconcileInterruptedTrainingJobs } from "./training/training-manager";
import { createElectronUpdaterHandle } from "./updater/electron-updater-adapter";
import { createFileUpdatePreferenceStore } from "./updater/update-preference-store";
import { UpdateService } from "./updater/update-service";

const ACTIVE_JOB_STATUSES = new Set([
  "IDLE",
  "VALIDATING",
  "SUBMITTING",
  "QUEUED",
  "RUNNING",
  "PROCESSING_OUTPUT",
]);

protocol.registerSchemesAsPrivileged([
  {
    scheme: "kirea-media",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: false,
    },
  },
]);

const SINGLE_LOCK = app.requestSingleInstanceLock();
if (!SINGLE_LOCK) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
let splashShownAt = 0;
let splashRevealTimer: NodeJS.Timeout | null = null;
let splashDismissed = false;
let mainWindowReady = false;
let runtimeStartupFinished = false;
let openAnywayRequested = false;
const SPLASH_MIN_VISIBLE_MS = 1600;
const SPLASH_EXIT_FADE_MS = 220;
let isQuitting = false;
let cleanupFn: (() => Promise<void>) | null = null;
let updateService: UpdateService | null = null;

function buildDefaultSettings(paths: StudioPaths, firstDetectedComfyPath: string): AppSettings {
  return {
    runtimeMode: "external",
    externalComfyPath: firstDetectedComfyPath,
    comfyHost: "127.0.0.1",
    comfyPort: 8188,
    pixelBackendHost: "127.0.0.1",
    pixelBackendPort: 8189,
    pixelBackendWorkflowRoot: "",
    managedComfyPath: paths.defaultManagedRuntimeDir,
    autoStartRuntime: false,
    outputDirectory: paths.defaultOutputDir,
    extraModelDirs: [],
    downloadDirectory: paths.defaultDownloadsDir,
    cacheDirectory: paths.cacheDir,
    tempDirectory: paths.tempDir,
    performanceProfile: "balanced",
    maxActiveJobs: 1,
    defaultBatchSize: 1,
    enableMemoryWarnings: true,
    theme: "dark",
    galleryLayout: "comfortable",
    startupPage: "home",
    defaultSampler: "dpmpp_2m",
    defaultScheduler: "karras",
    defaultSteps: 24,
    defaultCfg: 6.5,
    defaultOutputFormat: "png",
    checkUpdatesAutomatically: true,
    nsfwFilter: true,
    civitaiApiKeySet: false,
    huggingfaceTokenSet: false,
  };
}

function resolveAppIcon(): Electron.NativeImage | undefined {
  const candidates = [
    path.join(app.getAppPath(), "assets", "brand", "kirea-icon-256.png"),
    path.join(__dirname, "../../assets/brand/kirea-icon-256.png"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const img = nativeImage.createFromPath(p);
      if (!img.isEmpty()) return img;
    }
  }
  return undefined;
}

function resolveSplashHtmlPath(): string | null {
  const candidates = [
    path.join(app.getAppPath(), "src", "splash.html"),
    path.join(__dirname, "../../src/splash.html"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function createSplashWindow(): BrowserWindow | null {
  const htmlPath = resolveSplashHtmlPath();
  if (!htmlPath) return null;

  const splash = new BrowserWindow({
    width: 640,
    height: 360,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    center: true,
    show: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  splash.setMenuBarVisibility(false);
  splash.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  void splash.loadFile(htmlPath).catch(() => {
    if (!splash.isDestroyed()) splash.close();
  });
  splash.once("closed", () => {
    if (splashWindow === splash) splashWindow = null;
    if (splashDismissed) return;
    openAnywayRequested = true;
    if (mainWindowReady) revealMainWindow();
  });
  return splash;
}

function revealMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }
}

function updateSplashFromRuntime(runtime: ComfyRuntimeManager): void {
  const splash = splashWindow;
  if (!splash || splash.isDestroyed() || splash.webContents.isLoading()) return;
  const state = runtime.getState();
  const presentation = getSplashPresentation(
    state.status,
    state.lastError,
    state.isConfiguredPathValid
  );
  void splash.webContents
    .executeJavaScript(`window.kireaSplash?.update(${JSON.stringify(presentation)})`, true)
    .catch(() => undefined);
}

function maybeDismissSplash(runtime: ComfyRuntimeManager): void {
  if (!mainWindow || mainWindow.isDestroyed() || splashDismissed) return;
  const minimumVisibleElapsed =
    !splashShownAt || Date.now() - splashShownAt >= SPLASH_MIN_VISIBLE_MS;
  const gateState = {
    mainWindowReady,
    minimumVisibleElapsed,
    runtimeStartupFinished,
    runtimeStatus: runtime.getState().status,
    openAnywayRequested,
  };

  if (!shouldRevealMainWindow(gateState)) {
    const readyAfterHold = shouldRevealMainWindow({
      ...gateState,
      minimumVisibleElapsed: true,
    });
    if (readyAfterHold && !splashRevealTimer) {
      const holdMs = Math.max(0, SPLASH_MIN_VISIBLE_MS - (Date.now() - splashShownAt));
      splashRevealTimer = setTimeout(() => {
        splashRevealTimer = null;
        maybeDismissSplash(runtime);
      }, holdMs);
    }
    return;
  }

  if (splashRevealTimer) {
    clearTimeout(splashRevealTimer);
    splashRevealTimer = null;
  }
  dismissSplashWithCrossFade();
}

function dismissSplashWithCrossFade(): void {
  if (splashDismissed) return;
  splashDismissed = true;
  const splash = splashWindow;
  splashWindow = null;

  revealMainWindow();

  if (!splash || splash.isDestroyed()) return;
  if (splash.webContents.isDestroyed() || splash.webContents.isLoading()) {
    splash.close();
    return;
  }

  // Raise the splash above the freshly shown main window so it can dissolve over it
  splash.setIgnoreMouseEvents(true);
  splash.setAlwaysOnTop(true);
  splash.moveTop();

  const closeSplash = (): void => {
    if (!splash.isDestroyed()) splash.close();
  };

  const fadeScript = `(() => {
    const frame = document.querySelector(".frame");
    if (!frame) return false;
    frame.style.transition = "opacity ${SPLASH_EXIT_FADE_MS}ms ease";
    void frame.offsetWidth;
    frame.style.opacity = "0";
    return true;
  })()`;

  splash.webContents
    .executeJavaScript(fadeScript, true)
    .then((started: boolean) => {
      if (!started) closeSplash();
    })
    .catch(closeSplash);

  setTimeout(closeSplash, SPLASH_EXIT_FADE_MS + 160);
}

function buildNativeMenu(logsDir: string, getWin: () => BrowserWindow | null): void {
  const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
  const template: MenuItemConstructorOptions[] = [
    {
      label: "File",
      submenu: [
        { role: "quit", label: "Exit Kirea Studio" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        ...(isDev ? ([{ type: "separator" }, { role: "toggleDevTools" }] as MenuItemConstructorOptions[]) : []),
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Open Logs Directory",
          click: () => {
            void import("electron").then(({ shell }) => shell.openPath(logsDir));
          },
        },
        ...(isDev
          ? ([
              {
                label: "Toggle Developer Tools",
                accelerator: "Ctrl+Shift+I",
                click: () => {
                  getWin()?.webContents.toggleDevTools();
                },
              },
            ] as MenuItemConstructorOptions[])
          : []),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function bootstrapApplication(): Promise<void> {
  if (process.platform === "win32") {
    app.setAppUserModelId("com.kireastudio.desktop");
  }

  const icon = resolveAppIcon();
  splashWindow = createSplashWindow();
  if (splashWindow) splashShownAt = Date.now();

  const paths = resolveStudioPaths();
  const logger = new StudioLogger(paths.logsDir);
  logger.info("startup", `Kirea Studio v${app.getVersion()} booting`, {
    userData: paths.userDataDir,
    electron: process.versions.electron,
  });

  const studioDb = new StudioDatabase(paths.dbPath);
  if (studioDb.recoveredFromCorruption) {
    logger.warn("db", "Recovered corrupted SQLite database and re-initialized clean schema.");
  }
  const repo = new StudioRepository(studioDb);
  repo.upsertWorkflowMetadata(WORKFLOW_TEMPLATES);
  reconcileInterruptedTrainingJobs(repo, logger);

  const detectedComfy = discoverExistingComfyPaths();
  const defaultSettings = buildDefaultSettings(paths, detectedComfy[0] ?? "");
  let currentSettings = repo.getSettings(defaultSettings);

  // If user never had an external path stored and we newly detected one, pre-populate without touching it
  if (!currentSettings.externalComfyPath && detectedComfy[0]) {
    currentSettings = repo.saveSettings(
      { externalComfyPath: detectedComfy[0] },
      defaultSettings
    );
  }
  await fs.promises.mkdir(currentSettings.outputDirectory, { recursive: true });

  const civitaiKeyStore = new CivitaiKeyStore(paths.userDataDir);
  const huggingFaceTokenStore = new HuggingFaceTokenStore(paths.userDataDir);
  currentSettings = {
    ...currentSettings,
    civitaiApiKeySet: civitaiKeyStore.hasKey(),
    huggingfaceTokenSet: huggingFaceTokenStore.hasToken(),
  };

  const runtime = new ComfyRuntimeManager(paths, currentSettings, logger);
  const modelScanner = new ModelScanner(logger);
  const downloadManager = new DownloadManager(repo, logger, {
    headerProvider: (task) => {
      if (task.sourceName !== "huggingface") return null;
      const token = huggingFaceTokenStore.getToken();
      return token ? { Authorization: `Bearer ${token}` } : null;
    },
  });
  const civitaiClient = new CivitaiClient({
    getApiKey: () => civitaiKeyStore.getKey(),
    logger,
  });
  const civitaiDownloadManager = new CivitaiDownloadManager({
    logger,
    previewCacheDir: path.join(paths.cacheDir, "civitai-previews"),
    persistPath: path.join(paths.cacheDir, "civitai-downloads.json"),
  });
  let cachedModels: ModelRecord[] = repo.listModels();
  const huggingFaceClient = new HuggingFaceClient({
    getToken: () => huggingFaceTokenStore.getToken(),
    logger,
  });
  const huggingFaceService = new HuggingFaceService({
    client: huggingFaceClient,
    downloadManager,
    logger,
    getSettings: () => currentSettings,
    getModels: () => cachedModels,
    getRuntime: () => ({
      status: runtime.getState().status,
      comfyVersion: runtime.getState().comfyVersion,
      api: runtime.getState().status === "connected" ? runtime.getApiClient() : null,
    }),
    managedModelsDir: paths.defaultManagedModelsDir,
  });
  let vramTotalMB = 0;
  const approvedInputFiles = new Set<string>();

  const jobOrchestrator = new JobOrchestrator(
    repo,
    runtime,
    () => currentSettings,
    () => cachedModels,
    () => vramTotalMB,
    logger
  );

  const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? null;
  updateService = new UpdateService({
    logger,
    store: createFileUpdatePreferenceStore(paths.userDataDir),
    getCurrentVersion: () => app.getVersion(),
    isEnabled: () =>
      app.isPackaged &&
      !devServerUrl &&
      process.env.KIREA_DISABLE_UPDATES !== "1",
    getAutomaticChecksEnabled: () => currentSettings.checkUpdatesAutomatically,
    getActiveJobCount: () =>
      jobOrchestrator
        .listJobs()
        .filter((job) => ACTIVE_JOB_STATUSES.has(job.status)).length,
    beforeInstall: async () => {
      if (cleanupFn) {
        await cleanupFn();
        return;
      }
      await runtime.stopRuntime().catch(() => undefined);
      studioDb.close();
    },
    createAdapter: () => createElectronUpdaterHandle(logger),
  });

  // Register custom kirea-media:// image protocol scoped strictly to studio outputs & user-picked inputs
  protocol.handle("kirea-media", (request) => {
    try {
      const parsed = new URL(request.url);
      const rawPath = parsed.searchParams.get("p");
      if (!rawPath) {
        return new Response("Missing path parameter", { status: 400 });
      }
      const resolved = path.resolve(rawPath);
      const allowed =
        approvedInputFiles.has(resolved.toLowerCase()) ||
        isPathInsideAnyRoot(resolved, [
          currentSettings.outputDirectory,
          paths.defaultOutputDir,
          paths.inputUploadCacheDir,
          paths.cacheDir,
          paths.charactersDir,
          paths.pixelAssetsDir,
          paths.pixelExportsDir,
          paths.modelPreviewCacheDir,
          paths.defaultManagedModelsDir,
          currentSettings.externalComfyPath,
          currentSettings.managedComfyPath,
        ]);

      if (!allowed) {
        return new Response("Forbidden path", { status: 403 });
      }

      const ext = path.extname(resolved).toLowerCase();
      const allowedExt = [
        ".png",
        ".jpg",
        ".jpeg",
        ".webp",
        ".mp4",
        ".m4v",
        ".webm",
        ".mkv",
        ".mov",
      ];
      if (!allowedExt.includes(ext)) {
        return new Response("Unsupported extension", { status: 400 });
      }

      return net.fetch(url.pathToFileURL(resolved).toString());
    } catch {
      return new Response("Invalid media request", { status: 400 });
    }
  });

  const devServerOrigin = devServerUrl ? new URL(devServerUrl).origin : null;
  const expectedHtmlPath = path.join(app.getAppPath(), "dist", "index.html");

  registerIpcHandlers({
    paths,
    repo,
    defaultSettings,
    getSettings: () => currentSettings,
    setSettings: (s) => {
      currentSettings = s;
    },
    runtime,
    modelScanner,
    getCachedModels: () => cachedModels,
    setCachedModels: (m) => {
      cachedModels = m;
    },
    downloadManager,
    civitaiClient,
    civitaiDownloadManager,
    civitaiKeyStore,
    huggingFaceService,
    huggingFaceTokenStore,
    jobOrchestrator,
    updateService,
    logger,
    getVramTotalMB: () => vramTotalMB,
    setVramTotalMB: (v) => {
      vramTotalMB = v;
    },
    approvedInputFiles,
    getMainWindow: () => mainWindow,
    expectedHtmlPath,
    devServerOrigin,
  });

  buildNativeMenu(paths.logsDir, () => mainWindow);

  // Forward Main -> Renderer push events safely
  const pushToRenderer = (channel: string, payload: unknown): void => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, payload);
    }
  };

  runtime.on("stateChanged", (state) => {
    updateSplashFromRuntime(runtime);
    maybeDismissSplash(runtime);
    pushToRenderer(IPC_CHANNELS.EVENT_RUNTIME_CHANGED, state);
  });
  jobOrchestrator.on("jobUpdated", (job) => {
    pushToRenderer(IPC_CHANNELS.EVENT_JOB_UPDATED, job);
  });
  jobOrchestrator.on("imageCreated", (img) => {
    pushToRenderer(IPC_CHANNELS.EVENT_IMAGE_CREATED, img);
  });
  jobOrchestrator.on("videoCreated", (video) => {
    pushToRenderer(IPC_CHANNELS.EVENT_VIDEO_CREATED, video);
  });
  downloadManager.on("updated", (task) => {
    pushToRenderer(IPC_CHANNELS.EVENT_DOWNLOAD_UPDATED, task);
    if (task.status === "completed" && task.kind === "model") {
      void modelScanner
        .scanAll(
          currentSettings,
          paths.defaultManagedModelsDir,
          runtime.getState().status === "connected" ? runtime.getApiClient() : null
        )
        .then((models) => {
          repo.replaceScannedModels(models);
          cachedModels = repo.listModels();
        });
    }
  });

  civitaiDownloadManager.on("progress", (task) => {
    pushToRenderer(IPC_CHANNELS.EVENT_CIVITAI_DOWNLOAD_PROGRESS, task);
  });

  civitaiDownloadManager.on("completed", () => {
    void modelScanner
      .scanAll(
        currentSettings,
        paths.defaultManagedModelsDir,
        runtime.getState().status === "connected" ? runtime.getApiClient() : null
      )
      .then((models) => {
        repo.replaceScannedModels(models);
        cachedModels = repo.listModels();
      });
  });

  updateService.on("stateChanged", (state) => {
    pushToRenderer(IPC_CHANNELS.EVENT_UPDATE_STATE_CHANGED, state);
  });

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    title: "Kirea Studio",
    backgroundColor: "#0c0f16",
    icon,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    const allowedPrefix = devServerOrigin ?? url.pathToFileURL(expectedHtmlPath).toString();
    if (!targetUrl.startsWith(allowedPrefix)) {
      event.preventDefault();
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindowReady = true;
    maybeDismissSplash(runtime);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl);
  } else {
    await mainWindow.loadFile(expectedHtmlPath);
  }

  const runtimeStartupPromise = (async () => {
    try {
      updateSplashFromRuntime(runtime);
      const connection = await runtime.testConnection();
      if (connection.status !== "connected") {
        if (!connection.isConfiguredPathValid) {
          throw new Error("No local ComfyUI installation is configured.");
        }
        await runtime.startRuntime();
      }
    } catch (err) {
      logger.warn("startup", "ComfyUI startup failed", String(err));
    } finally {
      runtimeStartupFinished = true;
      updateSplashFromRuntime(runtime);
      maybeDismissSplash(runtime);
    }
  })();

  // Background startup tasks (read-only GPU probe and initial model scan)
  void (async () => {
    try {
      const hw = await detectHardwareStats([
        currentSettings.outputDirectory,
        currentSettings.downloadDirectory,
        currentSettings.externalComfyPath,
        currentSettings.managedComfyPath,
      ]);
      vramTotalMB = hw.vramTotalMB;

      await runtimeStartupPromise;
      const liveApi =
        runtime.getState().status === "connected" ? runtime.getApiClient() : null;
      const scanned = await modelScanner.scanAll(
        currentSettings,
        paths.defaultManagedModelsDir,
        liveApi
      );
      repo.replaceScannedModels(scanned);
      cachedModels = repo.listModels();
    } catch (err) {
      logger.warn("startup", "Background initialization warning", String(err));
    }
  })();

  cleanupFn = async () => {
    jobOrchestrator.prepareShutdown();
    civitaiDownloadManager.prepareShutdown();
    shutdownTraining();
    await runtime.stopRuntime().catch(() => undefined);
    studioDb.close();
    logger.info("shutdown", "Kirea Studio shut down cleanly.");
  };

  // Update checks never block startup; the service waits for the first idle window.
  updateService.scheduleAutomaticChecks();
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  if (isQuitting) return;
  // electron-updater already ran the cleanup callback before quitAndInstall.
  if (updateService?.isInstalling()) return;
  event.preventDefault();
  isQuitting = true;
  const fallbackTimer = setTimeout(() => {
    app.exit(0);
  }, 2500);
  fallbackTimer.unref();
  void (async () => {
    shutdownTraining();
    if (cleanupFn) {
      await cleanupFn().catch(() => undefined);
    }
    clearTimeout(fallbackTimer);
    app.exit(0);
  })();
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught main process exception:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled main process rejection:", reason);
});

if (SINGLE_LOCK) {
  app.whenReady().then(() => {
    void bootstrapApplication().catch((err) => {
      console.error("Failed to bootstrap Kirea Studio:", err);
      app.exit(1);
    });
  });
}

