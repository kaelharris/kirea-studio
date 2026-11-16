import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

export interface StudioPaths {
  userDataDir: string;
  dbPath: string;
  logsDir: string;
  cacheDir: string;
  tempDir: string;
  defaultOutputDir: string;
  defaultDownloadsDir: string;
  defaultManagedRuntimeDir: string;
  defaultManagedModelsDir: string;
  inputUploadCacheDir: string;
  modelPreviewCacheDir: string;
  charactersDir: string;
  pixelAssetsDir: string;
  pixelExportsDir: string;
  pixelAiTempDir: string;
}

export function resolveStudioPaths(): StudioPaths {
  const userDataDir = app.getPath("userData");
  const picturesDir = app.getPath("pictures");

  const paths: StudioPaths = {
    userDataDir,
    dbPath: path.join(userDataDir, "kirea-studio.db"),
    logsDir: path.join(userDataDir, "logs"),
    cacheDir: path.join(userDataDir, "cache"),
    tempDir: path.join(userDataDir, "temp"),
    defaultOutputDir: path.join(picturesDir, "Kirea Studio"),
    defaultDownloadsDir: path.join(userDataDir, "downloads"),
    defaultManagedRuntimeDir: path.join(userDataDir, "runtime", "comfyui-managed"),
    defaultManagedModelsDir: path.join(userDataDir, "models"),
    inputUploadCacheDir: path.join(userDataDir, "cache", "inputs"),
    modelPreviewCacheDir: path.join(userDataDir, "model-previews"),
    charactersDir: path.join(userDataDir, "characters"),
    pixelAssetsDir: path.join(userDataDir, "pixel-assets"),
    pixelExportsDir: path.join(userDataDir, "pixel-exports"),
    pixelAiTempDir: path.join(userDataDir, "temp", "pixel-ai"),
  };

  for (const dir of [
    paths.userDataDir,
    paths.logsDir,
    paths.cacheDir,
    paths.tempDir,
    paths.defaultOutputDir,
    paths.defaultDownloadsDir,
    paths.defaultManagedModelsDir,
    paths.inputUploadCacheDir,
    paths.modelPreviewCacheDir,
    paths.charactersDir,
    paths.pixelAssetsDir,
    paths.pixelExportsDir,
    paths.pixelAiTempDir,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return paths;
}

