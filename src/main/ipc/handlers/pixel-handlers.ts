import { dialog, shell } from "electron";
import { z } from "zod";
import { IPC_CHANNELS } from "../../../shared/ipc-channels";
import { PixelAiService } from "../../pixel/ai/pixel-ai-service";
import { SpriteKilnProvider } from "../../pixel/ai/spritekiln-provider";
import { resolvePixelExportDirectory } from "../../pixel/pixel-export-path";
import { PixelService } from "../../pixel/pixel-service";
import {
  PixelAiGenerateSchema,
  PixelAssetFiltersSchema,
  PixelCharacterInputSchema,
  PixelExportRequestSchema,
  PixelGenerateSchema,
  PixelIdSchema,
  PixelImportSchema,
  PixelPaletteRecordSchema,
  PixelPackageJobSchema,
  PixelPackageRevealSchema,
  PixelPackageRequestSchema,
  PixelProjectInputSchema,
  PixelSaveAnimationsSchema,
  PixelSaveFramesSchema,
  PixelSavePaletteSchema,
  PixelVersionRequestSchema,
  type HandlerContext,
  type IpcRegistrarHandle,
} from "../schemas";

export function registerPixelHandlers(ctx: HandlerContext, handle: IpcRegistrarHandle): void {
  const service = new PixelService(ctx.paths, ctx.repo, ctx.runtime, ctx.logger);
  const aiProvider = new SpriteKilnProvider(
    ctx.paths,
    ctx.repo,
    ctx.getSettings,
    ctx.logger
  );
  const aiService = new PixelAiService(service, aiProvider, ctx.logger);
  aiService.on("jobUpdated", (job) => {
    const window = ctx.getMainWindow();
    if (window && !window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.EVENT_PIXEL_AI_JOB_UPDATED, job);
    }
  });
  service.on("pixelPackageProgress", (progress) => {
    const window = ctx.getMainWindow();
    if (window && !window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.EVENT_PIXEL_PACKAGE_PROGRESS, progress);
    }
  });

  handle(IPC_CHANNELS.PIXEL_PROJECTS_LIST, () => service.listProjects());

  handle(IPC_CHANNELS.PIXEL_PROJECTS_SAVE, (_event, inputRaw: unknown) =>
    service.saveProject(PixelProjectInputSchema.parse(inputRaw))
  );

  handle(IPC_CHANNELS.PIXEL_PROJECTS_DELETE, (_event, idRaw: unknown) =>
    service.deleteProject(PixelIdSchema.parse(idRaw))
  );

  handle(IPC_CHANNELS.PIXEL_CHARACTERS_LIST, (_event, projectIdRaw: unknown) =>
    service.listCharacters(
      projectIdRaw === undefined || projectIdRaw === null
        ? undefined
        : PixelIdSchema.parse(projectIdRaw)
    )
  );

  handle(IPC_CHANNELS.PIXEL_CHARACTERS_SAVE, (_event, inputRaw: unknown) =>
    service.saveCharacter(PixelCharacterInputSchema.parse(inputRaw))
  );

  handle(IPC_CHANNELS.PIXEL_CHARACTERS_DELETE, (_event, idRaw: unknown) =>
    service.deleteCharacter(PixelIdSchema.parse(idRaw))
  );

  handle(
    IPC_CHANNELS.PIXEL_CHARACTERS_GENERATE_VIEWS,
    (_event, characterIdRaw: unknown, seedRaw: unknown, widthRaw: unknown, heightRaw: unknown) =>
      service.generateCharacterViews(
        PixelIdSchema.parse(characterIdRaw),
        seedRaw === undefined || seedRaw === null
          ? undefined
          : z.number().int().min(0).max(4294967295).parse(seedRaw),
        widthRaw === undefined ? 32 : z.number().int().min(8).max(256).parse(widthRaw),
        heightRaw === undefined ? 32 : z.number().int().min(8).max(256).parse(heightRaw)
      )
  );

  handle(IPC_CHANNELS.PIXEL_ASSETS_LIST, (_event, filtersRaw: unknown) =>
    service.listAssets(PixelAssetFiltersSchema.parse(filtersRaw))
  );

  handle(IPC_CHANNELS.PIXEL_ASSETS_GET, (_event, idRaw: unknown) =>
    service.getAsset(PixelIdSchema.parse(idRaw))
  );

  handle(IPC_CHANNELS.PIXEL_ASSETS_GENERATE, (_event, inputRaw: unknown) =>
    service.generateAsset(PixelGenerateSchema.parse(inputRaw))
  );

  handle(IPC_CHANNELS.PIXEL_ASSETS_IMPORT, (_event, inputRaw: unknown) =>
    service.importLibraryImage(PixelImportSchema.parse(inputRaw))
  );

  handle(IPC_CHANNELS.PIXEL_ASSETS_SAVE_FRAMES, (_event, payloadRaw: unknown) => {
    const payload = PixelSaveFramesSchema.parse(payloadRaw);
    const dimensions =
      payload.width !== undefined && payload.height !== undefined
        ? { width: payload.width, height: payload.height }
        : undefined;
    return service.saveFrames(payload.assetId, payload.frames, dimensions, {
      palette: payload.palette,
    });
  });

  handle(IPC_CHANNELS.PIXEL_ASSETS_SAVE_ANIMATIONS, (_event, payloadRaw: unknown) => {
    const payload = PixelSaveAnimationsSchema.parse(payloadRaw);
    return service.saveAnimations(payload.assetId, payload.animations);
  });

  handle(IPC_CHANNELS.PIXEL_ASSETS_SAVE_PALETTE, (_event, payloadRaw: unknown) => {
    const payload = PixelSavePaletteSchema.parse(payloadRaw);
    return service.saveAssetPalette(payload.assetId, payload.palette);
  });

  handle(IPC_CHANNELS.PIXEL_ASSETS_VERSIONS, (_event, idRaw: unknown) =>
    service.listVersions(PixelIdSchema.parse(idRaw))
  );

  handle(IPC_CHANNELS.PIXEL_ASSETS_GET_VERSION, (_event, payloadRaw: unknown) => {
    const payload = PixelVersionRequestSchema.parse(payloadRaw);
    return service.getAssetVersion(payload.assetId, payload.version);
  });

  handle(IPC_CHANNELS.PIXEL_ASSETS_RESTORE_VERSION, (_event, payloadRaw: unknown) => {
    const payload = PixelVersionRequestSchema.parse(payloadRaw);
    return service.restoreVersion(payload.assetId, payload.version);
  });

  handle(IPC_CHANNELS.PIXEL_PALETTES_LIST, () => service.listPaletteLibrary());

  handle(IPC_CHANNELS.PIXEL_PALETTES_SAVE, (_event, inputRaw: unknown) =>
    service.savePaletteLibraryEntry(PixelPaletteRecordSchema.parse(inputRaw))
  );

  handle(IPC_CHANNELS.PIXEL_PALETTES_DELETE, (_event, idRaw: unknown) =>
    service.deletePaletteLibraryEntry(PixelIdSchema.parse(idRaw))
  );

  handle(IPC_CHANNELS.PIXEL_ASSETS_RENAME, (_event, idRaw: unknown, nameRaw: unknown) =>
    service.renameAsset(PixelIdSchema.parse(idRaw), z.string().trim().min(1).max(120).parse(nameRaw))
  );

  handle(
    IPC_CHANNELS.PIXEL_ASSETS_DUPLICATE,
    (_event, idRaw: unknown, nameRaw: unknown) =>
      service.duplicateAsset(
        PixelIdSchema.parse(idRaw),
        nameRaw === undefined || nameRaw === null
          ? undefined
          : z.string().trim().min(1).max(120).parse(nameRaw)
      )
  );

  handle(IPC_CHANNELS.PIXEL_ASSETS_DELETE, (_event, idRaw: unknown) =>
    service.deleteAsset(PixelIdSchema.parse(idRaw))
  );

  handle(IPC_CHANNELS.PIXEL_ASSETS_EXPORT, async (_event, payloadRaw: unknown) => {
    const payload = PixelExportRequestSchema.parse(payloadRaw);
    const result = await service.exportAsset(payload.assetId, payload.format, payload.options ?? {});
    return result;
  });

  handle(IPC_CHANNELS.PIXEL_SPRITEKILN_REPORT, () => service.getSpriteKilnReport());

  handle(IPC_CHANNELS.PIXEL_AI_STATUS, () => aiService.getStatus());
  handle(IPC_CHANNELS.PIXEL_AI_TEST_CONNECTION, () => aiService.testConnection());
  handle(IPC_CHANNELS.PIXEL_AI_GENERATE, (_event, inputRaw: unknown) =>
    aiService.startJob(PixelAiGenerateSchema.parse(inputRaw))
  );
  handle(IPC_CHANNELS.PIXEL_AI_CANCEL, (_event, jobIdRaw: unknown) =>
    aiService.cancelJob(z.string().uuid().parse(jobIdRaw))
  );
  handle(IPC_CHANNELS.PIXEL_AI_GET_JOB, (_event, jobIdRaw: unknown) =>
    aiService.getJob(z.string().uuid().parse(jobIdRaw))
  );
  handle(IPC_CHANNELS.PIXEL_AI_LIST_JOBS, () => aiService.listJobs());

  handle(IPC_CHANNELS.PIXEL_ASSETS_OPEN_EXPORT, async (_event, assetIdRaw: unknown) => {
    const target = resolvePixelExportDirectory(ctx.paths.pixelExportsDir, assetIdRaw);
    const error = await shell.openPath(target);
    return error ? "" : target;
  });

  handle(IPC_CHANNELS.PIXEL_ASSETS_PICK_IMAGE, async () => {
    const window = ctx.getMainWindow();
    const options = {
      title: "Import a reference image",
      properties: ["openFile" as const],
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
    };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
  });

  handle(IPC_CHANNELS.PIXEL_PACKAGE_PLAN, (_event, inputRaw: unknown) =>
    service.planPackage(PixelPackageRequestSchema.parse(inputRaw))
  );

  handle(IPC_CHANNELS.PIXEL_PACKAGE_EXPORT, (_event, inputRaw: unknown) =>
    service.exportPackage(PixelPackageRequestSchema.parse(inputRaw))
  );

  handle(IPC_CHANNELS.PIXEL_PACKAGE_CANCEL, (_event, jobIdRaw: unknown) =>
    service.cancelPackage(PixelPackageJobSchema.parse(jobIdRaw))
  );

  handle(IPC_CHANNELS.PIXEL_PACKAGE_PICK_DESTINATION, async () => {
    const window = ctx.getMainWindow();
    const options = {
      title: "Choose a package destination",
      defaultPath: ctx.paths.pixelExportsDir,
      properties: ["openDirectory" as const, "createDirectory" as const],
    };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
  });

  handle(IPC_CHANNELS.PIXEL_PACKAGE_REVEAL, async (_event, targetRaw: unknown) => {
    const target = PixelPackageRevealSchema.parse(targetRaw);
    if (target.toLowerCase().endsWith(".zip")) {
      shell.showItemInFolder(target);
    } else {
      await shell.openPath(target);
    }
  });
}
