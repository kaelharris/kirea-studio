import { app, dialog, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { IPC_CHANNELS } from "../../../shared/ipc-channels";
import { detectHardwareStats } from "../../hardware/gpu-detector";
import { assertSafeExternalUrl, isPathInsideAnyRoot } from "../../security";
import {
  PartialSettingsSchema,
  RuntimeModeSchema,
  type HandlerContext,
  type IpcRegistrarHandle,
} from "../schemas";

export function registerAppRuntimeHandlers(
  ctx: HandlerContext,
  handle: IpcRegistrarHandle
): void {
  const getAllowedOpenRoots = (): string[] => {
    const s = ctx.getSettings();
    return [
      ctx.paths.userDataDir,
      ctx.paths.logsDir,
      ctx.paths.defaultOutputDir,
      ctx.paths.defaultManagedModelsDir,
      ctx.paths.defaultManagedRuntimeDir,
      s.outputDirectory,
      s.downloadDirectory,
      s.externalComfyPath,
      s.managedComfyPath,
      ...s.extraModelDirs,
    ].filter(Boolean);
  };

  // --- App & Diagnostics ---
  handle(IPC_CHANNELS.APP_GET_DIAGNOSTICS, () => {
    const s = ctx.getSettings();
    return {
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      nodeVersion: process.versions.node,
      userDataPath: ctx.paths.userDataDir,
      logsPath: ctx.logger.getFilePath(),
      dbPath: ctx.paths.dbPath,
      outputDirectory: s.outputDirectory,
      recentLogs: ctx.logger.getRecent(150),
    };
  });

  handle(IPC_CHANNELS.APP_EXPORT_LOGS, async () => {
    const win = ctx.getMainWindow();
    const res = await dialog.showSaveDialog(win ?? undefined!, {
      title: "Export Kirea Studio Diagnostics Logs",
      defaultPath: path.join(app.getPath("desktop"), `kirea-studio-logs-${Date.now()}.txt`),
      filters: [{ name: "Text Logs", extensions: ["txt", "log"] }],
    });
    if (res.canceled || !res.filePath) return null;
    const payload = [
      `Kirea Studio Diagnostics Export — ${new Date().toISOString()}`,
      `App Version: ${app.getVersion()} | Electron: ${process.versions.electron}`,
      "--- Application Logs ---",
      ...ctx.logger.getRecent(300),
      "--- Runtime Logs ---",
      ...ctx.runtime.getLogs(),
    ].join("\n");
    await fs.promises.writeFile(res.filePath, payload, "utf8");
    return res.filePath;
  });

  handle(IPC_CHANNELS.APP_OPEN_PATH, async (_event, targetPathRaw: string) => {
    const targetPath = z.string().min(1).max(1024).parse(targetPathRaw);
    const resolved = path.resolve(targetPath);
    const allowed = getAllowedOpenRoots();
    if (!isPathInsideAnyRoot(resolved, allowed)) {
      throw new Error("Blocked attempt to open path outside authorized studio directories.");
    }
    if (!fs.existsSync(resolved)) {
      throw new Error("Path does not exist on disk.");
    }
    const stat = fs.statSync(resolved);
    if (stat.isFile()) {
      shell.showItemInFolder(resolved);
    } else {
      const errMsg = await shell.openPath(resolved);
      if (errMsg) throw new Error(errMsg);
    }
  });

  handle(IPC_CHANNELS.APP_OPEN_EXTERNAL, async (_event, rawUrl: string) => {
    const safeUrl = assertSafeExternalUrl(z.string().min(1).max(2048).parse(rawUrl));
    if (safeUrl.protocol !== "https:") {
      throw new Error("Only HTTPS external links may be opened from Kirea Studio.");
    }
    await shell.openExternal(safeUrl.toString());
  });

  handle(IPC_CHANNELS.APP_PICK_DIRECTORY, async (_event, title?: string) => {
    const win = ctx.getMainWindow();
    const res = await dialog.showOpenDialog(win ?? undefined!, {
      title: typeof title === "string" && title ? title : "Select Directory",
      properties: ["openDirectory", "createDirectory"],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0]!;
  });

  handle(IPC_CHANNELS.APP_PICK_IMAGE, async () => {
    const win = ctx.getMainWindow();
    const res = await dialog.showOpenDialog(win ?? undefined!, {
      title: "Select Input Image",
      properties: ["openFile"],
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    const selected = path.resolve(res.filePaths[0]!);
    ctx.approvedInputFiles.add(selected.toLowerCase());
    return selected;
  });

  handle(IPC_CHANNELS.APP_GET_FILE_DATA_URL, async (_event, filePathRaw: string) => {
    const filePath = z.string().min(1).max(1024).parse(filePathRaw);
    const resolved = path.resolve(filePath);
    const s = ctx.getSettings();
    const isApproved =
      ctx.approvedInputFiles.has(resolved.toLowerCase()) ||
      isPathInsideAnyRoot(resolved, [
        s.outputDirectory,
        ctx.paths.defaultOutputDir,
        ctx.paths.inputUploadCacheDir,
        ctx.paths.cacheDir,
      ]);
    if (!isApproved) {
      throw new Error("Unauthorized image path access rejected.");
    }
    const ext = path.extname(resolved).toLowerCase();
    const mime =
      ext === ".jpg" || ext === ".jpeg"
        ? "image/jpeg"
        : ext === ".webp"
          ? "image/webp"
          : ext === ".png"
            ? "image/png"
            : null;
    if (!mime) {
      throw new Error("Unsupported image extension.");
    }
    const buf = await fs.promises.readFile(resolved);
    return `data:${mime};base64,${buf.toString("base64")}`;
  });

  // --- Settings ---
  handle(IPC_CHANNELS.SETTINGS_GET, () => ({
    ...ctx.getSettings(),
    civitaiApiKeySet: ctx.civitaiKeyStore.hasKey(),
  }));

  handle(IPC_CHANNELS.SETTINGS_UPDATE, async (_event, partialRaw: unknown) => {
    const partial = PartialSettingsSchema.parse(partialRaw);
    const saved = {
      ...ctx.repo.saveSettings(partial, ctx.defaultSettings),
      civitaiApiKeySet: ctx.civitaiKeyStore.hasKey(),
    };
    ctx.setSettings(saved);
    ctx.runtime.applySettings(saved);
    if (partial.outputDirectory) {
      await fs.promises.mkdir(saved.outputDirectory, { recursive: true });
    }
    if (
      partial.externalComfyPath !== undefined ||
      partial.managedComfyPath !== undefined ||
      partial.extraModelDirs !== undefined ||
      partial.runtimeMode !== undefined
    ) {
      const scanned = await ctx.modelScanner.scanAll(
        saved,
        ctx.paths.defaultManagedModelsDir,
        ctx.runtime.getState().status === "connected" ? ctx.runtime.getApiClient() : null
      );
      ctx.repo.replaceScannedModels(scanned);
      ctx.setCachedModels(ctx.repo.listModels());
    }
    return saved;
  });

  // --- Hardware & Runtime ---
  handle(IPC_CHANNELS.HARDWARE_GET_STATS, async () => {
    const s = ctx.getSettings();
    const stats = await detectHardwareStats([
      s.outputDirectory,
      s.downloadDirectory,
      s.managedComfyPath,
      s.externalComfyPath,
    ]);
    if (stats.vramTotalMB > 0) {
      ctx.setVramTotalMB(stats.vramTotalMB);
    }
    return stats;
  });

  handle(IPC_CHANNELS.RUNTIME_GET_STATE, () => ctx.runtime.getState());
  handle(IPC_CHANNELS.RUNTIME_DISCOVER, () => ctx.runtime.refreshDiscovery());
  handle(IPC_CHANNELS.RUNTIME_TEST_CONNECTION, async () => {
    const state = await ctx.runtime.testConnection();
    if (state.status === "connected") {
      const scanned = await ctx.modelScanner.scanAll(
        ctx.getSettings(),
        ctx.paths.defaultManagedModelsDir,
        ctx.runtime.getApiClient()
      );
      ctx.repo.replaceScannedModels(scanned);
      ctx.setCachedModels(ctx.repo.listModels());
    }
    return state;
  });

  handle(IPC_CHANNELS.RUNTIME_START, async (_event, modeRaw?: unknown) => {
    const mode = modeRaw !== undefined ? RuntimeModeSchema.parse(modeRaw) : undefined;
    const state = await ctx.runtime.startRuntime(mode, ctx.getSettings().performanceProfile);
    if (state.status === "connected") {
      const scanned = await ctx.modelScanner.scanAll(
        ctx.getSettings(),
        ctx.paths.defaultManagedModelsDir,
        ctx.runtime.getApiClient()
      );
      ctx.repo.replaceScannedModels(scanned);
      ctx.setCachedModels(ctx.repo.listModels());
    }
    return state;
  });

  handle(IPC_CHANNELS.RUNTIME_STOP, () => ctx.runtime.stopRuntime());
  handle(IPC_CHANNELS.RUNTIME_GET_LOGS, () => ctx.runtime.getLogs());
  handle(IPC_CHANNELS.MODELS_CHECK_UPDATES, () => ctx.runtime.checkLatestOfficialRelease());
  handle(IPC_CHANNELS.RUNTIME_INSTALL_MANAGED, () =>
    ctx.runtime.installManagedRuntime(ctx.downloadManager)
  );

}
