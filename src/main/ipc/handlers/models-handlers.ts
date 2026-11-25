import { dialog } from "electron";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { IPC_CHANNELS } from "../../../shared/ipc-channels";
import {
  evaluateEmbeddingCompatibility,
  evaluateLoraCompatibility,
  resolveEffectivePreviewPath,
} from "../../../shared/model-utils";
import { CURATED_MODEL_CATALOG } from "../../../shared/presets";
import type { ModelArchitecture, ModelCategory } from "../../../shared/types";
import { resolveCivitaiModelsRoot } from "../../civitai/download-manager";
import { isAllowedLoopbackHost, isPathInsideAnyRoot } from "../../security";
import {
  CivitaiSearchSchema,
  CivitaiStartDownloadSchema,
  LoraRecipeInputSchema,
  ModelCategorySchema,
  ModelMetadataPatchSchema,
  type HandlerContext,
  type IpcRegistrarHandle,
} from "../schemas";

export function registerModelsHandlers(
  ctx: HandlerContext,
  handle: IpcRegistrarHandle
): void {
  // --- Models & Catalog ---
  handle(IPC_CHANNELS.MODELS_SCAN, async () => {
    const state = ctx.runtime.getState();
    const scanned = await ctx.modelScanner.scanAll(
      ctx.getSettings(),
      ctx.paths.defaultManagedModelsDir,
      state.status === "connected" ? ctx.runtime.getApiClient() : null
    );
    ctx.repo.replaceScannedModels(scanned);
    const enriched = ctx.repo.listModels();
    ctx.setCachedModels(enriched);
    return enriched;
  });

  handle(IPC_CHANNELS.MODELS_LIST, (_event, categoryRaw?: unknown) => {
    const category = categoryRaw !== undefined ? (ModelCategorySchema.parse(categoryRaw) as ModelCategory) : undefined;
    return ctx.repo.listModels(category);
  });

  const pruneModelPreviewCache = async (
    modelId: string,
    deletedFilePath: string,
    isManagedPath: boolean
  ): Promise<void> => {
    try {
      if (fs.existsSync(ctx.paths.modelPreviewCacheDir)) {
        const cacheEntries = await fs.promises.readdir(ctx.paths.modelPreviewCacheDir);
        const thumbPrefix = `${modelId}-`;
        await Promise.all(
          cacheEntries
            .filter((name) => name.startsWith(thumbPrefix) && name.endsWith(".webp"))
            .map((name) =>
              fs.promises
                .rm(path.join(ctx.paths.modelPreviewCacheDir, name), { force: true })
                .catch(() => undefined)
            )
        );

        const originalsDir = path.join(ctx.paths.modelPreviewCacheDir, "originals");
        if (fs.existsSync(originalsDir)) {
          const origEntries = await fs.promises.readdir(originalsDir);
          await Promise.all(
            origEntries
              .filter((name) => name === modelId || name.startsWith(`${modelId}.`))
              .map((name) =>
                fs.promises
                  .rm(path.join(originalsDir, name), { force: true })
                  .catch(() => undefined)
              )
          );
        }
      }

      if (isManagedPath) {
        const stem = path.join(
          path.dirname(deletedFilePath),
          path.basename(deletedFilePath, path.extname(deletedFilePath))
        );
        const adjacentSidecars = [
          `${stem}.civitai.info`,
          `${stem}.preview.png`,
          `${stem}.preview.jpg`,
          `${stem}.preview.jpeg`,
          `${stem}.preview.webp`,
        ];
        await Promise.all(
          adjacentSidecars.map((candidate) =>
            fs.promises.rm(candidate, { force: true }).catch(() => undefined)
          )
        );
      }
    } catch {
      // Non-fatal cleanup
    }
  };

  handle(IPC_CHANNELS.MODELS_DELETE, async (_event, filePathRaw: string) => {
    const filePath = z.string().min(1).max(1024).parse(filePathRaw);
    const resolved = path.resolve(filePath);
    // Strict safeguard: never delete files inside external user ComfyUI installs
    const isManagedPath = isPathInsideAnyRoot(resolved, [
      ctx.paths.defaultManagedModelsDir,
      ctx.paths.defaultDownloadsDir,
    ]);
    if (!isManagedPath) {
      throw new Error(
        "Refused to delete external ComfyUI model file. Kirea Studio only deletes models stored inside its own managed directories."
      );
    }
    const matchingModels = ctx.repo
      .listModels()
      .filter((m) => path.resolve(m.filePath).toLowerCase() === resolved.toLowerCase());
    if (fs.existsSync(resolved)) {
      await fs.promises.rm(resolved, { force: true });
    }
    for (const model of matchingModels) {
      await pruneModelPreviewCache(model.id, resolved, true);
    }
    ctx.repo.deleteModelRecord(filePath);
    ctx.setCachedModels(ctx.repo.listModels());
  });

  handle(IPC_CHANNELS.MODELS_CATALOG, () => CURATED_MODEL_CATALOG);

  handle(
    IPC_CHANNELS.MODELS_UPDATE_METADATA,
    (_event, modelIdRaw: string, patchRaw: unknown) => {
      const modelId = z.string().min(1).max(64).parse(modelIdRaw);
      const patch = ModelMetadataPatchSchema.parse(patchRaw);
      if (patch.previewPath) {
        const resolved = path.resolve(patch.previewPath);
        if (
          !isPathInsideAnyRoot(resolved, [
            ctx.paths.modelPreviewCacheDir,
            ctx.paths.userDataDir,
          ])
        ) {
          throw new Error(
            "Custom previews must live inside the Kirea Studio app data directory."
          );
        }
      }
      const updated = ctx.repo.updateModelMetadata(modelId, patch);
      ctx.setCachedModels(ctx.repo.listModels());
      return updated;
    }
  );

  handle(IPC_CHANNELS.MODELS_GET_PREVIEW, async (_event, modelIdRaw: string) => {
    const modelId = z.string().min(1).max(64).parse(modelIdRaw);
    const model = ctx.repo.getModelById(modelId);
    if (!model) throw new Error(`Unknown model id: ${modelId}`);

    const previewPath = resolveEffectivePreviewPath(model);
    if (!previewPath) return null;

    const resolved = path.resolve(previewPath);
    if (
      !isPathInsideAnyRoot(resolved, [
        model.sourceRoot,
        ctx.paths.modelPreviewCacheDir,
        ctx.paths.userDataDir,
      ])
    ) {
      return null;
    }
    if (!fs.existsSync(resolved)) return null;

    try {
      const stat = await fs.promises.stat(resolved);
      const cachePath = path.join(
        ctx.paths.modelPreviewCacheDir,
        `${model.id}-${Math.round(stat.mtimeMs)}.webp`
      );
      if (!fs.existsSync(cachePath)) {
        await sharp(resolved)
          .rotate()
          .resize({ width: 720, height: 720, fit: "inside", withoutEnlargement: true })
          .webp({ quality: 82 })
          .toFile(cachePath);
      }
      const buf = await fs.promises.readFile(cachePath);
      return `data:image/webp;base64,${buf.toString("base64")}`;
    } catch (err) {
      ctx.logger.warn("models", `Failed to render preview for ${model.name}`, String(err));
      return null;
    }
  });

  handle(IPC_CHANNELS.MODELS_IMPORT_PREVIEW, async (_event, modelIdRaw: string, sourcePathRaw?: unknown) => {
    const modelId = z.string().min(1).max(64).parse(modelIdRaw);
    const model = ctx.repo.getModelById(modelId);
    if (!model) throw new Error(`Unknown model id: ${modelId}`);

    let source: string;
    if (typeof sourcePathRaw === "string" && sourcePathRaw.trim()) {
      source = path.resolve(sourcePathRaw.trim());
      if (!fs.existsSync(source)) {
        throw new Error(`Source preview image not found: ${source}`);
      }
    } else {
      const win = ctx.getMainWindow();
      const res = await dialog.showOpenDialog(win ?? undefined!, {
        title: `Choose preview image for ${model.name}`,
        properties: ["openFile"],
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
      });
      if (res.canceled || res.filePaths.length === 0) return null;
      source = path.resolve(res.filePaths[0]!);
    }

    const ext = path.extname(source).toLowerCase();
    if (![".png", ".jpg", ".jpeg", ".webp"].includes(ext)) {
      throw new Error("Unsupported image format for model preview.");
    }

    const originalsDir = path.join(ctx.paths.modelPreviewCacheDir, "originals");
    await fs.promises.mkdir(originalsDir, { recursive: true });
    const targetFilename = `${modelId}${ext}`;

    // 1. Clean up old webp thumbnails and any stale original with a different extension
    if (fs.existsSync(ctx.paths.modelPreviewCacheDir)) {
      const cacheEntries = await fs.promises.readdir(ctx.paths.modelPreviewCacheDir);
      const thumbPrefix = `${modelId}-`;
      await Promise.all(
        cacheEntries
          .filter((name) => name.startsWith(thumbPrefix) && name.endsWith(".webp"))
          .map((name) =>
            fs.promises
              .rm(path.join(ctx.paths.modelPreviewCacheDir, name), { force: true })
              .catch(() => undefined)
          )
      );

      const origEntries = await fs.promises.readdir(originalsDir);
      await Promise.all(
        origEntries
          .filter(
            (name) =>
              (name === modelId || name.startsWith(`${modelId}.`)) &&
              name !== targetFilename
          )
          .map((name) =>
            fs.promises
              .rm(path.join(originalsDir, name), { force: true })
              .catch(() => undefined)
          )
      );
    }

    // 2. Copy the new preview image into originals
    const destination = path.join(originalsDir, targetFilename);
    await fs.promises.copyFile(source, destination);

    // 3. Pre-generate the cached webp thumbnail immediately so getModelPreview succeeds instantaneously
    try {
      const stat = await fs.promises.stat(destination);
      const cachePath = path.join(
        ctx.paths.modelPreviewCacheDir,
        `${modelId}-${Math.round(stat.mtimeMs)}.webp`
      );
      await sharp(destination)
        .rotate()
        .resize({ width: 720, height: 720, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82 })
        .toFile(cachePath);
    } catch (sharpErr) {
      ctx.logger.warn("models", `Pre-generating preview thumbnail failed: ${String(sharpErr)}`);
    }

    // 4. Update model metadata
    const updated = ctx.repo.updateModelMetadata(modelId, {
      previewMode: "custom",
      previewPath: destination,
    });
    ctx.setCachedModels(ctx.repo.listModels());
    return updated;
  });

  // --- LoRA Recipes ---
  handle(IPC_CHANNELS.RECIPES_LIST, () => ctx.repo.listLoraRecipes());

  handle(IPC_CHANNELS.RECIPES_SAVE, (_event, inputRaw: unknown) => {
    const input = LoraRecipeInputSchema.parse(inputRaw);
    return ctx.repo.saveLoraRecipe(input);
  });

  handle(IPC_CHANNELS.RECIPES_DELETE, (_event, idRaw: string) => {
    const id = z.string().min(1).max(64).parse(idRaw);
    ctx.repo.deleteLoraRecipe(id);
  });


  // --- Downloads ---
  handle(IPC_CHANNELS.DOWNLOADS_LIST, () => ctx.downloadManager.listDownloads());

  handle(IPC_CHANNELS.DOWNLOADS_START_MODEL, async (_event, catalogIdRaw: string) => {
    const catalogId = z.string().min(1).max(100).parse(catalogIdRaw);
    const item = CURATED_MODEL_CATALOG.find((c) => c.id === catalogId);
    if (!item) {
      throw new Error(`Unknown catalog item '${catalogId}'.`);
    }
    const settings = ctx.getSettings();
    const modelsRoot = resolveCivitaiModelsRoot(settings, ctx.paths.defaultManagedModelsDir);
    const targetPath = path.join(
      modelsRoot,
      item.targetSubdir,
      item.fileName
    );
    return ctx.downloadManager.startDownload({
      id: `model_${item.id}`,
      kind: "model",
      title: item.name,
      url: item.downloadUrl,
      targetPath,
      category: item.category,
      sourceName: item.sourceName,
      licenseName: item.licenseName,
      expectedSha256: item.sha256 || null,
      expectedBytes: item.sizeBytes,
    });
  });

  handle(IPC_CHANNELS.DOWNLOADS_PAUSE, (_event, idRaw: string) =>
    ctx.downloadManager.pauseDownload(z.string().min(1).max(100).parse(idRaw))
  );
  handle(IPC_CHANNELS.DOWNLOADS_RESUME, (_event, idRaw: string) =>
    ctx.downloadManager.resumeDownload(z.string().min(1).max(100).parse(idRaw))
  );
  handle(IPC_CHANNELS.DOWNLOADS_CANCEL, (_event, idRaw: string) =>
    ctx.downloadManager.cancelDownload(z.string().min(1).max(100).parse(idRaw))
  );
  handle(IPC_CHANNELS.DOWNLOADS_CLEAR_COMPLETED, () =>
    ctx.downloadManager.clearCompleted()
  );

  // --- Civitai Hub ---
  handle(IPC_CHANNELS.CIVITAI_SEARCH_MODELS, async (_event, queryRaw: unknown) => {
    const parsed = CivitaiSearchSchema.parse(queryRaw ?? {});
    const settings = ctx.getSettings();
    return ctx.civitaiClient.searchModels(
      {
        ...parsed,
        nsfw: settings.nsfwFilter ? false : parsed.nsfw === true,
      },
      ctx.getCachedModels()
    );
  });

  handle(IPC_CHANNELS.CIVITAI_GET_MODEL_DETAILS, async (_event, modelIdRaw: unknown) => {
    const modelId = z.number().int().positive().parse(modelIdRaw);
    return ctx.civitaiClient.getModelDetails(modelId, ctx.getCachedModels());
  });

  handle(IPC_CHANNELS.CIVITAI_START_DOWNLOAD, async (_event, requestRaw: unknown) => {
    const { modelId, versionId, targetArchitecture } = CivitaiStartDownloadSchema.parse(requestRaw);
    const model = await ctx.civitaiClient.getModelDetails(
      modelId,
      ctx.getCachedModels()
    );
    const version = model.versions.find((candidate) => candidate.id === versionId);
    if (!version) {
      throw new Error(
        `Civitai version ${versionId} is not available for model ${modelId}.`
      );
    }
    if (!version.downloadable) {
      throw new Error(
        `Civitai version ${versionId} has no downloadable file; it may be unavailable or restricted.`
      );
    }

    // Backend compatibility enforcement: prevent incompatible LoRAs/Embeddings from being installed for the wrong target
    if (targetArchitecture && targetArchitecture !== "unknown") {
      const targetArch = targetArchitecture as ModelArchitecture;
      if (model.type === "LORA") {
        const check = evaluateLoraCompatibility(version.architecture, targetArch);
        if (!check.compatible) {
          throw new Error(`Incompatible LoRA: ${check.message}`);
        }
      } else if (model.type === "TextualInversion") {
        const check = evaluateEmbeddingCompatibility(version.architecture, targetArch);
        if (!check.compatible) {
          throw new Error(`Incompatible Embedding: ${check.message}`);
        }
      }
    }

    return ctx.civitaiDownloadManager.start({
      model,
      version,
      apiKey: ctx.civitaiKeyStore.getKey(),
      settings: ctx.getSettings(),
      managedModelsDir: ctx.paths.defaultManagedModelsDir,
    });
  });

  handle(IPC_CHANNELS.CIVITAI_PAUSE_DOWNLOAD, (_event, idRaw: unknown) =>
    ctx.civitaiDownloadManager.pauseDownload(z.string().min(1).max(120).parse(idRaw))
  );

  handle(IPC_CHANNELS.CIVITAI_RESUME_DOWNLOAD, (_event, idRaw: unknown) =>
    ctx.civitaiDownloadManager.resumeDownload(z.string().min(1).max(120).parse(idRaw))
  );

  handle(IPC_CHANNELS.CIVITAI_CANCEL_DOWNLOAD, (_event, idRaw: unknown) =>
    ctx.civitaiDownloadManager.cancelDownload(z.string().min(1).max(120).parse(idRaw))
  );

  handle(IPC_CHANNELS.CIVITAI_RETRY_DOWNLOAD, (_event, idRaw: unknown) =>
    ctx.civitaiDownloadManager.retryDownload(z.string().min(1).max(120).parse(idRaw))
  );

  handle(IPC_CHANNELS.CIVITAI_LIST_DOWNLOADS, () =>
    ctx.civitaiDownloadManager.listDownloads()
  );

  handle(IPC_CHANNELS.CIVITAI_CLEAR_DOWNLOADS, () =>
    ctx.civitaiDownloadManager.clearCompleted()
  );

  handle(IPC_CHANNELS.CIVITAI_SET_API_KEY, (_event, apiKeyRaw: unknown) => {
    const apiKey = z.string().max(512).parse(apiKeyRaw);
    const hasApiKey = ctx.civitaiKeyStore.setKey(apiKey);
    ctx.setSettings({ ...ctx.getSettings(), civitaiApiKeySet: hasApiKey });
    return { hasApiKey };
  });

  handle(IPC_CHANNELS.CIVITAI_TEST_CONNECTION, () =>
    ctx.civitaiClient.testConnection()
  );

}
