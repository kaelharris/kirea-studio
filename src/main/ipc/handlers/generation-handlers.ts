import { app, dialog } from "electron";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { IPC_CHANNELS } from "../../../shared/ipc-channels";
import { WORKFLOW_TEMPLATES } from "../../comfy/workflow-registry";
import { exportImageToDestination } from "../../images/image-exporter";
import { exportVideoToDestination } from "../../videos/video-exporter";
import { isPathInsideAnyRoot } from "../../security";
import { UnifiedLibraryService } from "../../library/library-service";
import {
  GenerationRequestSchema,
  LibraryBatchDeleteSchema,
  LibraryBatchExportSchema,
  LibraryBatchFavoriteSchema,
  LibraryBatchSetCollectionSchema,
  LibraryFiltersSchema,
  LibraryMediaQuerySchema,
  OutputFormatSchema,
  type HandlerContext,
  type IpcRegistrarHandle,
} from "../schemas";

export function registerGenerationHandlers(
  ctx: HandlerContext,
  handle: IpcRegistrarHandle
): void {
  const library = new UnifiedLibraryService(ctx.repo, ctx.paths);

  // --- Workflows & Jobs ---
  handle(IPC_CHANNELS.WORKFLOWS_LIST, () => WORKFLOW_TEMPLATES);

  handle(IPC_CHANNELS.WORKFLOWS_GET_SAMPLERS, async () => {
    if (ctx.runtime.getState().status === "connected") {
      try {
        return await ctx.runtime.getApiClient().getSamplersAndSchedulers();
      } catch {
        // Fallback cleanly to standard ComfyUI sampler defaults
      }
    }
    return {
      samplers: [
        "euler",
        "euler_ancestral",
        "dpmpp_2m",
        "dpmpp_2m_sde",
        "dpmpp_sde",
        "res_multistep",
        "ddim",
        "uni_pc",
      ],
      schedulers: ["normal", "karras", "exponential", "sgm_uniform", "simple", "ddim_uniform"],
    };
  });

  handle(IPC_CHANNELS.JOBS_VALIDATE, (_event, reqRaw: unknown) => {
    const req = GenerationRequestSchema.parse(reqRaw);
    return ctx.jobOrchestrator.validate(req);
  });

  handle(IPC_CHANNELS.JOBS_SUBMIT, async (_event, reqRaw: unknown) => {
    const req = GenerationRequestSchema.parse(reqRaw);
    return ctx.jobOrchestrator.submit(req);
  });

  handle(IPC_CHANNELS.JOBS_LIST, () => ctx.jobOrchestrator.listJobs());

  handle(IPC_CHANNELS.JOBS_CANCEL, (_event, jobIdRaw: string) =>
    ctx.jobOrchestrator.cancelJob(z.string().min(1).max(100).parse(jobIdRaw))
  );

  handle(IPC_CHANNELS.JOBS_RETRY, (_event, jobIdRaw: string) =>
    ctx.jobOrchestrator.retryJob(z.string().min(1).max(100).parse(jobIdRaw))
  );

  // --- Library, Collections & Prompts ---
  handle(IPC_CHANNELS.LIBRARY_LIST_MEDIA, (_event, queryRaw?: unknown) => {
    const query = LibraryMediaQuerySchema.parse(queryRaw);
    return library.list(query ?? {});
  });

  handle(IPC_CHANNELS.LIBRARY_LIST, (_event, filtersRaw?: unknown) => {
    const filters = LibraryFiltersSchema.parse(filtersRaw);
    return ctx.repo.listImages(filters);
  });

  handle(IPC_CHANNELS.LIBRARY_TOGGLE_FAVORITE, (_event, idRaw: string) =>
    ctx.repo.toggleImageFavorite(z.string().min(1).max(100).parse(idRaw))
  );

  handle(IPC_CHANNELS.LIBRARY_UPDATE_META, (_event, idRaw: string, updatesRaw: unknown) => {
    const id = z.string().min(1).max(100).parse(idRaw);
    const updates = z
      .object({
        tags: z.array(z.string().max(64)).max(24).optional(),
        collectionId: z.string().max(100).nullable().optional(),
      })
      .parse(updatesRaw);
    ctx.repo.updateImageMetadata(id, updates);
  });

  handle(IPC_CHANNELS.LIBRARY_DELETE, async (_event, idRaw: string) => {
    const id = z.string().min(1).max(100).parse(idRaw);
    const img = ctx.repo.getImageById(id);
    if (img) {
      const s = ctx.getSettings();
      if (
        isPathInsideAnyRoot(img.filePath, [s.outputDirectory, ctx.paths.defaultOutputDir]) &&
        fs.existsSync(img.filePath)
      ) {
        await fs.promises.rm(img.filePath, { force: true }).catch(() => undefined);
      }
      ctx.repo.deleteImage(id);
    }
  });

  handle(
    IPC_CHANNELS.LIBRARY_EXPORT,
    async (_event, idRaw: string, formatRaw: unknown, stripMetaRaw: unknown) => {
      const id = z.string().min(1).max(100).parse(idRaw);
      const format = OutputFormatSchema.parse(formatRaw);
      const stripMeta = z.boolean().parse(stripMetaRaw);

      const img = ctx.repo.getImageById(id);
      if (!img || !fs.existsSync(img.filePath)) {
        throw new Error("Source image file was not found on disk.");
      }

      const ext = format === "jpeg" ? "jpg" : format;
      const stem = path.basename(img.fileName, path.extname(img.fileName));
      const win = ctx.getMainWindow();
      const saveRes = await dialog.showSaveDialog(win ?? undefined!, {
        title: "Export Generated Image",
        defaultPath: path.join(app.getPath("pictures"), `${stem}.${ext}`),
        filters: [{ name: `${format.toUpperCase()} Image`, extensions: [ext] }],
      });
      if (saveRes.canceled || !saveRes.filePath) return null;

      return await exportImageToDestination(img.filePath, saveRes.filePath, format, stripMeta);
    }
  );

  handle(IPC_CHANNELS.LIBRARY_BATCH_DELETE, async (_event, idsRaw: unknown) => {
    const ids = LibraryBatchDeleteSchema.parse(idsRaw);
    const s = ctx.getSettings();
    return library.batchDelete(ids, [s.outputDirectory, ctx.paths.defaultOutputDir]);
  });

  handle(IPC_CHANNELS.LIBRARY_BATCH_EXPORT, async (_event, reqRaw: unknown) => {
    const req = LibraryBatchExportSchema.parse(reqRaw);
    return library.batchExport(req.ids, req.destinationDir);
  });

  handle(IPC_CHANNELS.LIBRARY_BATCH_SET_COLLECTION, (_event, reqRaw: unknown) => {
    const req = LibraryBatchSetCollectionSchema.parse(reqRaw);
    return library.batchSetCollection(req.ids, req.collectionId);
  });

  handle(IPC_CHANNELS.LIBRARY_BATCH_FAVORITE, async (_event, reqRaw: unknown) => {
    const req = LibraryBatchFavoriteSchema.parse(reqRaw);
    return library.batchSetFavorite(req.ids, req.favorite);
  });

  // --- Video library ---
  handle(IPC_CHANNELS.VIDEO_LIST, () => ctx.repo.listVideos(500));

  handle(IPC_CHANNELS.VIDEO_TOGGLE_FAVORITE, (_event, idRaw: string) =>
    ctx.repo.toggleVideoFavorite(z.string().min(1).max(100).parse(idRaw))
  );

  handle(IPC_CHANNELS.VIDEO_DELETE, async (_event, idRaw: string) => {
    const id = z.string().min(1).max(100).parse(idRaw);
    const video = ctx.repo.getVideoById(id);
    if (video) {
      const s = ctx.getSettings();
      if (
        isPathInsideAnyRoot(video.filePath, [s.outputDirectory, ctx.paths.defaultOutputDir]) &&
        fs.existsSync(video.filePath)
      ) {
        await fs.promises.rm(video.filePath, { force: true }).catch(() => undefined);
        await fs.promises
          .rm(`${video.filePath}.json`, { force: true })
          .catch(() => undefined);
      }
      ctx.repo.deleteVideo(id);
    }
  });

  handle(IPC_CHANNELS.VIDEO_EXPORT, async (_event, idRaw: string) => {
    const id = z.string().min(1).max(100).parse(idRaw);
    const video = ctx.repo.getVideoById(id);
    if (!video || !fs.existsSync(video.filePath)) {
      throw new Error("Source video file was not found on disk.");
    }

    const stem = path.basename(video.fileName, path.extname(video.fileName));
    const win = ctx.getMainWindow();
    const saveRes = await dialog.showSaveDialog(win ?? undefined!, {
      title: "Export Generated Video",
      defaultPath: path.join(app.getPath("videos"), `${stem}.${video.container}`),
      filters: [
        {
          name: video.container === "webm" ? "WebM Video" : "MP4 Video",
          extensions: [video.container],
        },
      ],
    });
    if (saveRes.canceled || !saveRes.filePath) return null;

    return await exportVideoToDestination(video.filePath, saveRes.filePath);
  });

  handle(IPC_CHANNELS.COLLECTIONS_LIST, () => ctx.repo.listCollections());

  handle(IPC_CHANNELS.COLLECTIONS_CREATE, (_event, nameRaw: unknown, descRaw?: unknown) => {
    const name = z.string().trim().min(1).max(80).parse(nameRaw);
    const desc = descRaw !== undefined ? z.string().max(300).parse(descRaw) : "";
    return ctx.repo.createCollection(`col_${crypto.randomUUID().slice(0, 10)}`, name, desc);
  });

  handle(IPC_CHANNELS.COLLECTIONS_DELETE, (_event, idRaw: string) =>
    ctx.repo.deleteCollection(z.string().min(1).max(100).parse(idRaw))
  );

  handle(IPC_CHANNELS.PROMPTS_LIST, () => ctx.repo.listPrompts(200));

  handle(IPC_CHANNELS.PROMPTS_SAVE, (_event, rawRecord: unknown) => {
    const parsed = z
      .object({
        id: z.string().max(100).optional(),
        title: z.string().trim().min(1).max(120),
        prompt: z.string().max(10000),
        negativePrompt: z.string().max(10000),
        tags: z.array(z.string().max(50)).max(20).optional(),
        favorite: z.boolean().optional(),
      })
      .parse(rawRecord);

    const now = new Date().toISOString();
    return ctx.repo.savePrompt({
      id: parsed.id || `pr_${crypto.randomUUID().slice(0, 10)}`,
      title: parsed.title,
      prompt: parsed.prompt,
      negativePrompt: parsed.negativePrompt,
      tags: parsed.tags ?? [],
      favorite: parsed.favorite ?? false,
      usageCount: 0,
      lastUsedAt: null,
      createdAt: now,
    });
  });

  handle(IPC_CHANNELS.PROMPTS_DELETE, (_event, idRaw: string) =>
    ctx.repo.deletePrompt(z.string().min(1).max(100).parse(idRaw))
  );
}
