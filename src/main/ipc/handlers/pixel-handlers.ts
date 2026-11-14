import { dialog, shell } from "electron";
import path from "node:path";
import { z } from "zod";
import { IPC_CHANNELS } from "../../../shared/ipc-channels";
import { PixelService } from "../../pixel/pixel-service";
import {
  PixelAssetFiltersSchema,
  PixelCharacterInputSchema,
  PixelExportRequestSchema,
  PixelGenerateSchema,
  PixelIdSchema,
  PixelImportSchema,
  PixelProjectInputSchema,
  PixelSaveFramesSchema,
  type HandlerContext,
  type IpcRegistrarHandle,
} from "../schemas";

export function registerPixelHandlers(ctx: HandlerContext, handle: IpcRegistrarHandle): void {
  const service = new PixelService(ctx.paths, ctx.repo, ctx.runtime, ctx.logger);

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
    return service.saveFrames(payload.assetId, payload.frames, dimensions);
  });

  handle(IPC_CHANNELS.PIXEL_ASSETS_VERSIONS, (_event, idRaw: unknown) =>
    service.listVersions(PixelIdSchema.parse(idRaw))
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

  handle(IPC_CHANNELS.PIXEL_ASSETS_OPEN_EXPORT, async (_event, assetIdRaw: unknown) => {
    const assetId = PixelIdSchema.parse(assetIdRaw);
    const target = path.join(ctx.paths.pixelExportsDir, assetId);
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
}
