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
import { detectHardwareStats } from "./hardware/gpu-detector";
import { registerIpcHandlers } from "./ipc/register-handlers";
import { JobOrchestrator } from "./jobs/job-orchestrator";
import { StudioLogger } from "./logger";
import { ModelScanner } from "./models/model-scanner";
import { resolveStudioPaths, type StudioPaths } from "./paths";
import { isPathInsideAnyRoot } from "./security";

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
const SPLASH_MIN_VISIBLE_MS = 1600;
const SPLASH_EXIT_FADE_MS = 220;
let isQuitting = false;
let cleanupFn: (() => Promise<void>) | null = null;

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
  return splash;
}

function dismissSplashWithCrossFade(): void {
  const splash = splashWindow;
  splashWindow = null;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }

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
  currentSettings = {
    ...currentSettings,
    civitaiApiKeySet: civitaiKeyStore.hasKey(),
  };

  const runtime = new ComfyRuntimeManager(paths, currentSettings, logger);
  const modelScanner = new ModelScanner(logger);
  const downloadManager = new DownloadManager(repo, logger);
  const civitaiClient = new CivitaiClient({
    getApiKey: () => civitaiKeyStore.getKey(),
    logger,
  });
  const civitaiDownloadManager = new CivitaiDownloadManager({
    logger,
    previewCacheDir: path.join(paths.cacheDir, "civitai-previews"),
  });
  let cachedModels: ModelRecord[] = repo.listModels();
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

  const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? null;
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
    jobOrchestrator,
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
    const holdMs = splashShownAt
      ? Math.max(0, SPLASH_MIN_VISIBLE_MS - (Date.now() - splashShownAt))
      : 0;
    setTimeout(dismissSplashWithCrossFade, holdMs);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl);
  } else {
    await mainWindow.loadFile(expectedHtmlPath);
  }

  // Background startup tasks (read-only GPU probe, initial model scan, passive ComfyUI probe)
  void (async () => {
    try {
      const hw = await detectHardwareStats([
        currentSettings.outputDirectory,
        currentSettings.downloadDirectory,
        currentSettings.externalComfyPath,
        currentSettings.managedComfyPath,
      ]);
      vramTotalMB = hw.vramTotalMB;

      const connState = await runtime.testConnection();
      if (connState.status !== "connected" && currentSettings.autoStartRuntime && connState.isConfiguredPathValid) {
        try {
          await runtime.startRuntime();
        } catch (err) {
          logger.warn("startup", "Auto-start ComfyUI failed", String(err));
        }
      }

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
    await runtime.stopRuntime().catch(() => undefined);
    studioDb.close();
    logger.info("shutdown", "Kirea Studio shut down cleanly.");
  };
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
  event.preventDefault();
  isQuitting = true;
  const fallbackTimer = setTimeout(() => {
    app.exit(0);
  }, 2500);
  fallbackTimer.unref();
  void (async () => {
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

