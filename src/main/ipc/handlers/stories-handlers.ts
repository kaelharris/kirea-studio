import { app, dialog, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { storySlug } from "../../../shared/canvas-html";
import { getCharacterCoverReference } from "../../../shared/character-utils";
import { IPC_CHANNELS } from "../../../shared/ipc-channels";
import { buildStoryScenePlan, type StoryPlanDefaults } from "../../../shared/story-utils";
import type {
  GenerationJob,
  GenerationRequest,
  StoryExportResult,
  StoryScenePlan,
} from "../../../shared/types";
import { CharacterStorage } from "../../characters/character-storage";
import { WORKFLOW_TEMPLATES } from "../../comfy/workflow-registry";
import { isPathInsideAnyRoot } from "../../security";
import {
  exportCanvasPdf,
  exportCanvasPng,
  resolveStoryExportDir,
} from "../../stories/canvas-exporter";
import {
  CharacterProfileInputSchema,
  CharacterReferencePatchSchema,
  CharacterReferenceRoleSchema,
  StoryCanvasInputSchema,
  StoryCanvasItemInputSchema,
  StoryInputSchema,
  StorySceneCastInputSchema,
  StorySceneInputSchema,
  type HandlerContext,
  type IpcRegistrarHandle,
} from "../schemas";

export function registerStoriesHandlers(
  ctx: HandlerContext,
  handle: IpcRegistrarHandle
): void {
  const characterStorage = new CharacterStorage(ctx.paths.charactersDir);

  // --- Characters ---
  handle(IPC_CHANNELS.CHARACTERS_LIST, () => ctx.repo.listCharacters());

  handle(IPC_CHANNELS.CHARACTERS_SAVE, (_event, inputRaw: unknown) => {
    const input = CharacterProfileInputSchema.parse(inputRaw);
    return ctx.repo.saveCharacter(input);
  });

  handle(IPC_CHANNELS.CHARACTERS_DELETE, async (_event, idRaw: string) => {
    const id = z.string().min(1).max(64).parse(idRaw);
    const deleted = ctx.repo.deleteCharacter(id);
    if (deleted) {
      await characterStorage.removeCharacterFiles(id);
    }
    return deleted;
  });

  handle(
    IPC_CHANNELS.CHARACTERS_PICK_REFERENCE,
    async (_event, characterIdRaw: string, roleRaw?: unknown) => {
      const characterId = z.string().min(1).max(64).parse(characterIdRaw);
      const character = ctx.repo.getCharacterById(characterId);
      if (!character) throw new Error(`Unknown character id: ${characterId}`);
      const role =
        roleRaw !== undefined
          ? CharacterReferenceRoleSchema.parse(roleRaw)
          : "secondary";

      const win = ctx.getMainWindow();
      const res = await dialog.showOpenDialog(win ?? undefined!, {
        title: `Add reference for ${character.name}`,
        properties: ["openFile"],
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
      });
      if (res.canceled || res.filePaths.length === 0) return null;

      const source = path.resolve(res.filePaths[0]!);
      const imported = await characterStorage.importFromFile(characterId, source);
      try {
        ctx.repo.addCharacterReference({
          characterId,
          filePath: imported.filePath,
          sourcePath: source,
          role,
          caption: "",
        });
      } catch (err) {
        await characterStorage.removeReferenceFile(imported.filePath);
        throw err;
      }
      return ctx.repo.getCharacterById(characterId);
    }
  );

  handle(
    IPC_CHANNELS.CHARACTERS_ADD_LIBRARY_REFERENCE,
    async (
      _event,
      characterIdRaw: string,
      imageIdRaw: string,
      roleRaw?: unknown,
      captionRaw?: unknown
    ) => {
      const characterId = z.string().min(1).max(64).parse(characterIdRaw);
      const imageId = z.string().min(1).max(100).parse(imageIdRaw);
      if (!ctx.repo.getCharacterById(characterId)) {
        throw new Error(`Unknown character id: ${characterId}`);
      }
      const role =
        roleRaw !== undefined
          ? CharacterReferenceRoleSchema.parse(roleRaw)
          : "secondary";
      const caption =
        captionRaw !== undefined ? z.string().max(500).parse(captionRaw) : "";

      const image = ctx.repo.getImageById(imageId);
      if (!image) throw new Error("Source image was not found in the library.");
      const s = ctx.getSettings();
      if (
        !isPathInsideAnyRoot(image.filePath, [
          s.outputDirectory,
          ctx.paths.defaultOutputDir,
        ])
      ) {
        throw new Error("Refusing to import an image outside authorized output folders.");
      }

      const imported = await characterStorage.importFromFile(characterId, image.filePath);
      try {
        ctx.repo.addCharacterReference({
          characterId,
          filePath: imported.filePath,
          sourcePath: image.filePath,
          role,
          caption,
        });
      } catch (err) {
        await characterStorage.removeReferenceFile(imported.filePath);
        throw err;
      }
      return ctx.repo.getCharacterById(characterId);
    }
  );

  handle(
    IPC_CHANNELS.CHARACTERS_UPDATE_REFERENCE,
    (_event, characterIdRaw: string, referenceIdRaw: string, patchRaw: unknown) => {
      const characterId = z.string().min(1).max(64).parse(characterIdRaw);
      const referenceId = z.string().min(1).max(64).parse(referenceIdRaw);
      const patch = CharacterReferencePatchSchema.parse(patchRaw);
      const updated = ctx.repo.updateCharacterReference(
        characterId,
        referenceId,
        patch
      );
      if (!updated) return null;
      return ctx.repo.getCharacterById(characterId);
    }
  );

  handle(
    IPC_CHANNELS.CHARACTERS_REMOVE_REFERENCE,
    async (_event, characterIdRaw: string, referenceIdRaw: string) => {
      const characterId = z.string().min(1).max(64).parse(characterIdRaw);
      const referenceId = z.string().min(1).max(64).parse(referenceIdRaw);
      const removed = ctx.repo.removeCharacterReference(characterId, referenceId);
      if (!removed) return null;
      await characterStorage.removeReferenceFile(removed.filePath);
      return ctx.repo.getCharacterById(characterId);
    }
  );

  handle(IPC_CHANNELS.CHARACTERS_GET_PREVIEW, async (_event, idRaw: string) => {
    const id = z.string().min(1).max(64).parse(idRaw);
    const character = ctx.repo.getCharacterById(id);
    if (!character) return null;
    const cover = getCharacterCoverReference(character);
    if (!cover) return null;
    return characterStorage.readPreviewDataUrl(cover.filePath);
  });

  // --- Stories ---
  const storyPlanDefaults = (): StoryPlanDefaults => {
    const settings = ctx.getSettings();
    return {
      width: 1024,
      height: 1024,
      steps: settings.defaultSteps,
      cfg: settings.defaultCfg,
      sampler: settings.defaultSampler,
      scheduler: settings.defaultScheduler,
      aspectRatio: "1:1",
      outputFormat: settings.defaultOutputFormat,
      performanceProfile: settings.performanceProfile,
    };
  };

  const buildStoryPlan = (storyId: string, sceneId: string) => {
    const story = ctx.repo.getStoryById(storyId);
    if (!story) throw new Error(`Unknown story id: ${storyId}`);
    const scene = story.scenes.find((candidate) => candidate.id === sceneId);
    if (!scene) throw new Error(`Scene ${sceneId} is not part of this story.`);

    const cachedModels = ctx.getCachedModels();
    return buildStoryScenePlan({
      story,
      scene,
      characters: ctx.repo.listCharacters(),
      recipes: ctx.repo.listLoraRecipes(),
      models: cachedModels.length > 0 ? cachedModels : ctx.repo.listModels(),
      workflows: WORKFLOW_TEMPLATES,
      defaults: storyPlanDefaults(),
      referenceFileExists: (filePath) => fs.existsSync(filePath),
    });
  };

  const planToRequest = (plan: StoryScenePlan): GenerationRequest => {
    const settings = ctx.getSettings();
    return {
      workflowId: plan.workflowId,
      mode: plan.mode,
      prompt: plan.prompt,
      negativePrompt: plan.negativePrompt,
      checkpoint: plan.checkpoint,
      vae: null,
      loras: plan.loras,
      aspectRatio: plan.aspectRatio,
      width: plan.width,
      height: plan.height,
      steps: plan.steps,
      cfg: plan.cfg,
      sampler: plan.sampler,
      scheduler: plan.scheduler,
      seed: plan.seed,
      randomSeed: plan.randomSeed,
      batchCount: plan.batchCount,
      batchSize: settings.defaultBatchSize,
      outputFormat: settings.defaultOutputFormat,
      inputImagePath: plan.inputImagePath,
      denoise: plan.denoise,
      characterId: plan.characterId,
      loraRecipeId: plan.loraRecipeId,
      storyId: plan.storyId,
      storySceneId: plan.sceneId,
    };
  };

  handle(IPC_CHANNELS.STORIES_LIST, () => ctx.repo.listStories());

  handle(IPC_CHANNELS.STORIES_GET, (_event, idRaw: string) =>
    ctx.repo.getStoryById(z.string().min(1).max(64).parse(idRaw))
  );

  handle(IPC_CHANNELS.STORIES_SAVE, (_event, inputRaw: unknown) => {
    const input = StoryInputSchema.parse(inputRaw);
    return ctx.repo.saveStory(input);
  });

  handle(IPC_CHANNELS.STORIES_DELETE, (_event, idRaw: string) =>
    ctx.repo.deleteStory(z.string().min(1).max(64).parse(idRaw))
  );

  handle(IPC_CHANNELS.STORIES_SAVE_SCENE, (_event, inputRaw: unknown) => {
    const input = StorySceneInputSchema.parse(inputRaw);
    return ctx.repo.saveStoryScene(input);
  });

  handle(IPC_CHANNELS.STORIES_DELETE_SCENE, (_event, storyIdRaw: string, sceneIdRaw: string) =>
    ctx.repo.deleteStoryScene(
      z.string().min(1).max(64).parse(storyIdRaw),
      z.string().min(1).max(64).parse(sceneIdRaw)
    )
  );

  handle(IPC_CHANNELS.STORIES_REORDER_SCENES, (_event, storyIdRaw: string, sceneIdsRaw: unknown) => {
    const storyId = z.string().min(1).max(64).parse(storyIdRaw);
    const sceneIds = z.array(z.string().min(1).max(64)).max(500).parse(sceneIdsRaw);
    return ctx.repo.reorderStoryScenes(storyId, sceneIds);
  });

  handle(IPC_CHANNELS.STORIES_SET_SCENE_CAST, (_event, storyIdRaw: string, sceneIdRaw: string, castRaw: unknown) => {
    const storyId = z.string().min(1).max(64).parse(storyIdRaw);
    const sceneId = z.string().min(1).max(64).parse(sceneIdRaw);
    const cast = z.array(StorySceneCastInputSchema).max(64).parse(castRaw);
    return ctx.repo.setStorySceneCast(storyId, sceneId, cast);
  });

  handle(
    IPC_CHANNELS.STORIES_SELECT_SCENE_IMAGE,
    (_event, storyIdRaw: string, sceneIdRaw: string, imageIdRaw: unknown) => {
      const storyId = z.string().min(1).max(64).parse(storyIdRaw);
      const sceneId = z.string().min(1).max(64).parse(sceneIdRaw);
      const imageId =
        imageIdRaw === null || imageIdRaw === undefined
          ? null
          : z.string().min(1).max(100).parse(imageIdRaw);
      return ctx.repo.selectStorySceneImage(storyId, sceneId, imageId);
    }
  );

  handle(IPC_CHANNELS.STORIES_PLAN_SCENE, (_event, storyIdRaw: string, sceneIdRaw: string) => {
    const storyId = z.string().min(1).max(64).parse(storyIdRaw);
    const sceneId = z.string().min(1).max(64).parse(sceneIdRaw);
    return buildStoryPlan(storyId, sceneId);
  });

  handle(IPC_CHANNELS.STORIES_GENERATE_SCENE, async (_event, storyIdRaw: string, sceneIdRaw: string) => {
    const storyId = z.string().min(1).max(64).parse(storyIdRaw);
    const sceneId = z.string().min(1).max(64).parse(sceneIdRaw);
    const plan = buildStoryPlan(storyId, sceneId);
    if (plan.blockingIssues.length > 0) {
      throw new Error(plan.blockingIssues.join(" "));
    }
    ctx.repo.markStoryInProgress(storyId);
    return ctx.jobOrchestrator.submit(planToRequest(plan));
  });

  handle(IPC_CHANNELS.STORIES_GENERATE_STORY, async (_event, storyIdRaw: string) => {
    const storyId = z.string().min(1).max(64).parse(storyIdRaw);
    const story = ctx.repo.getStoryById(storyId);
    if (!story) throw new Error(`Unknown story id: ${storyId}`);
    if (story.scenes.length === 0) {
      throw new Error("This story has no scenes to generate yet.");
    }

    const requests: GenerationRequest[] = [];
    for (const scene of story.scenes) {
      const plan = buildStoryPlan(storyId, scene.id);
      if (plan.blockingIssues.length > 0) {
        throw new Error(
          `Scene "${scene.title}": ${plan.blockingIssues.join(" ")}`
        );
      }
      requests.push(planToRequest(plan));
    }

    ctx.repo.markStoryInProgress(storyId);
    const jobs: GenerationJob[] = [];
    for (const request of requests) {
      jobs.push(...(await ctx.jobOrchestrator.submit(request)));
    }
    return jobs;
  });

  // --- Story Canvas & Export ---
  const canvasAllowedRoots = (): string[] => {
    const settings = ctx.getSettings();
    return [
      settings.outputDirectory,
      ctx.paths.defaultOutputDir,
      ctx.paths.charactersDir,
      ctx.paths.inputUploadCacheDir,
      ctx.paths.cacheDir,
    ].filter(Boolean);
  };

  const buildCanvasExportInput = (canvasId: string) => {
    const canvas = ctx.repo.getCanvasById(canvasId);
    if (!canvas) throw new Error(`Unknown canvas id: ${canvasId}`);
    const story = ctx.repo.getStoryById(canvas.storyId);
    if (!story) throw new Error(`Unknown story id: ${canvas.storyId}`);

    const imageById = new Map(
      ctx.repo.listImages().map((image) => [image.id, image])
    );
    for (const item of canvas.items) {
      if (item.imageId && !imageById.has(item.imageId)) {
        const image = ctx.repo.getImageById(item.imageId);
        if (image) imageById.set(image.id, image);
      }
    }

    return {
      canvas,
      story,
      input: {
        canvas,
        storyTitle: story.title,
        scenes: story.scenes,
        images: [...imageById.values()],
        allowedRoots: canvasAllowedRoots(),
      },
    };
  };

  handle(IPC_CHANNELS.CANVASES_LIST, (_event, storyIdRaw?: unknown) => {
    const storyId =
      storyIdRaw === undefined || storyIdRaw === null
        ? undefined
        : z.string().min(1).max(64).parse(storyIdRaw);
    return ctx.repo.listCanvases(storyId);
  });

  handle(IPC_CHANNELS.CANVASES_SAVE, (_event, inputRaw: unknown) => {
    const input = StoryCanvasInputSchema.parse(inputRaw);
    return ctx.repo.saveCanvas(input);
  });

  handle(IPC_CHANNELS.CANVASES_DELETE, (_event, idRaw: string) =>
    ctx.repo.deleteCanvas(z.string().min(1).max(64).parse(idRaw))
  );

  handle(IPC_CHANNELS.CANVASES_SAVE_ITEM, (_event, inputRaw: unknown) => {
    const input = StoryCanvasItemInputSchema.parse(inputRaw);
    return ctx.repo.saveCanvasItem(input);
  });

  handle(
    IPC_CHANNELS.CANVASES_DELETE_ITEM,
    (_event, canvasIdRaw: string, itemIdRaw: string) =>
      ctx.repo.deleteCanvasItem(
        z.string().min(1).max(64).parse(canvasIdRaw),
        z.string().min(1).max(64).parse(itemIdRaw)
      )
  );

  handle(
    IPC_CHANNELS.CANVASES_REORDER_ITEMS,
    (_event, canvasIdRaw: string, itemIdsRaw: unknown) => {
      const canvasId = z.string().min(1).max(64).parse(canvasIdRaw);
      const itemIds = z
        .array(z.string().min(1).max(64))
        .max(500)
        .parse(itemIdsRaw);
      return ctx.repo.reorderCanvasItems(canvasId, itemIds);
    }
  );

  handle(IPC_CHANNELS.CANVASES_SYNC, (_event, canvasIdRaw: string) =>
    ctx.repo.syncCanvasFromStory(z.string().min(1).max(64).parse(canvasIdRaw))
  );

  handle(IPC_CHANNELS.CANVASES_EXPORT_PNG, async (_event, canvasIdRaw: string) => {
    const canvasId = z.string().min(1).max(64).parse(canvasIdRaw);
    const { canvas, story, input } = buildCanvasExportInput(canvasId);
    const pictures = app.getPath("pictures");
    const defaultDir = resolveStoryExportDir(pictures, story.title);
    const picked = await dialog.showOpenDialog(ctx.getMainWindow() ?? undefined!, {
      title: "Export Storyboard as PNG",
      defaultPath: defaultDir,
      buttonLabel: "Export here",
      properties: ["openDirectory", "createDirectory"],
    });
    if (picked.canceled || !picked.filePaths[0]) return null;

    const outputDir = picked.filePaths[0];
    const exported = await exportCanvasPng(input, outputDir);
    for (const file of exported.files) {
      const stat = await fs.promises.stat(file.filePath);
      ctx.repo.recordStoryExport({
        storyId: story.id,
        canvasId: canvas.id,
        kind: "png",
        filePath: file.filePath,
        width: exported.width,
        height: exported.height,
        pageCount: exported.pageCount,
        sizeBytes: stat.size,
        settings: {
          pageIndex: file.pageIndex,
          template: canvas.template,
          pageSize: canvas.pageSize,
          captionMode: canvas.captionMode,
        },
      });
    }

    void shell.openPath(outputDir);
    const result: StoryExportResult = {
      kind: "png",
      files: exported.files.map((file) => file.filePath),
      outputDir,
      width: exported.width,
      height: exported.height,
      pageCount: exported.pageCount,
    };
    return result;
  });

  handle(IPC_CHANNELS.CANVASES_EXPORT_PDF, async (_event, canvasIdRaw: string) => {
    const canvasId = z.string().min(1).max(64).parse(canvasIdRaw);
    const { canvas, story, input } = buildCanvasExportInput(canvasId);
    const pictures = app.getPath("pictures");
    const defaultDir = resolveStoryExportDir(pictures, story.title);
    const picked = await dialog.showSaveDialog(ctx.getMainWindow() ?? undefined!, {
      title: "Export Storyboard as PDF",
      defaultPath: path.join(defaultDir, `${storySlug(story.title)}.pdf`),
      filters: [{ name: "PDF Document", extensions: ["pdf"] }],
    });
    if (picked.canceled || !picked.filePath) return null;

    const exported = await exportCanvasPdf(input, picked.filePath);
    const stat = await fs.promises.stat(picked.filePath);
    ctx.repo.recordStoryExport({
      storyId: story.id,
      canvasId: canvas.id,
      kind: "pdf",
      filePath: picked.filePath,
      width: exported.width,
      height: exported.height,
      pageCount: exported.pageCount,
      sizeBytes: stat.size,
      settings: {
        template: canvas.template,
        pageSize: canvas.pageSize,
        captionMode: canvas.captionMode,
      },
    });

    const result: StoryExportResult = {
      kind: "pdf",
      files: [picked.filePath],
      outputDir: path.dirname(picked.filePath),
      width: exported.width,
      height: exported.height,
      pageCount: exported.pageCount,
    };
    return result;
  });

  handle(
    IPC_CHANNELS.CANVASES_OPEN_EXPORT_FOLDER,
    async (_event, storyIdRaw: string) => {
      const storyId = z.string().min(1).max(64).parse(storyIdRaw);
      const story = ctx.repo.getStoryById(storyId);
      if (!story) throw new Error(`Unknown story id: ${storyId}`);
      const target = resolveStoryExportDir(app.getPath("pictures"), story.title);
      await fs.promises.mkdir(target, { recursive: true });
      const error = await shell.openPath(target);
      if (error) throw new Error(error);
      return target;
    }
  );

  handle(IPC_CHANNELS.EXPORTS_LIST, (_event, storyIdRaw?: unknown) => {
    const storyId =
      storyIdRaw === undefined || storyIdRaw === null
        ? undefined
        : z.string().min(1).max(64).parse(storyIdRaw);
    return ctx.repo.listStoryExports(storyId);
  });

}
