import { randomUUID } from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type {
  PixelAnimationRecord,
  PixelAssetDetail,
  PixelAssetFilters,
  PixelAssetRecord,
  PixelAssetVersion,
  PixelCharacter,
  PixelCharacterInput,
  PixelExportFormat,
  PixelExportOptions,
  PixelExportResult,
  PixelFrameInput,
  PixelFrameRecord,
  PixelGenerateInput,
  PixelImportInput,
  PixelProject,
  PixelProjectInput,
  SpriteKilnReport,
  SpriteKilnWorkflowReport,
} from "../../shared/pixel-types";
import { PIXEL_KIND_LABELS } from "../../shared/pixel-types";
import {
  buildPalette,
  buildPixelRecipe,
  getPalettePreset,
  paletteColors,
  slugify,
  type PixelRecipe,
} from "../../shared/pixel-recipe";
import type { StudioRepository } from "../db/repositories";
import type { StudioLogger } from "../logger";
import type { StudioPaths } from "../paths";
import type { ComfyRuntimeManager } from "../comfy/runtime-manager";
import {
  buildPixelsFromImage,
  dataUrlToPng,
  loadPixelEngine,
  pngToDataUrl,
  readFileDataUrl,
  renderRecipe,
  writeRenderFiles,
} from "./pixel-engine";

const MAX_ASSET_SIDE = 256;

export class PixelService {
  constructor(
    private readonly paths: StudioPaths,
    private readonly repo: StudioRepository,
    private readonly runtime: ComfyRuntimeManager,
    private readonly logger: StudioLogger
  ) {}

  listProjects(): PixelProject[] {
    this.ensureDefaultProject();
    return this.repo.pixel.listProjects();
  }

  saveProject(input: PixelProjectInput): PixelProject {
    return this.repo.pixel.saveProject(input);
  }

  deleteProject(id: string): boolean {
    const assets = this.repo.pixel.listAssets({ projectId: id });
    for (const asset of assets) this.removeAssetDirectory(asset.id);
    return this.repo.pixel.deleteProject(id);
  }

  listCharacters(projectId?: string): PixelCharacter[] {
    return this.repo.pixel.listCharacters(projectId);
  }

  saveCharacter(input: PixelCharacterInput): PixelCharacter {
    const project = this.repo.pixel.getProject(input.projectId);
    if (!project) throw new Error("Project not found.");
    if (input.referenceAssetId) {
      const reference = this.repo.pixel.getAsset(input.referenceAssetId);
      if (!reference || reference.projectId !== project.id) {
        throw new Error("The reference asset must belong to the same project.");
      }
    }
    return this.repo.pixel.saveCharacter(input);
  }

  deleteCharacter(id: string): boolean {
    return this.repo.pixel.deleteCharacter(id);
  }

  listAssets(filters: PixelAssetFilters = {}): PixelAssetRecord[] {
    return this.repo.pixel.listAssets(filters).map((asset) => ({
      ...asset,
      previewDataUrl: this.readPreview(asset),
    }));
  }

  getAsset(id: string): Promise<PixelAssetDetail> {
    return this.buildDetail(id);
  }

  async generateAsset(input: PixelGenerateInput): Promise<PixelAssetDetail> {
    const project = this.repo.pixel.getProject(input.projectId);
    if (!project) throw new Error("Pixel project not found.");
    this.assertSize(input.width, input.height);
    if (input.characterId) {
      const character = this.repo.pixel.getCharacter(input.characterId);
      if (!character || character.projectId !== project.id) {
        throw new Error("Character not found in this project.");
      }
    }
    const recipe = buildPixelRecipe({
      kind: input.kind,
      name: input.name,
      width: input.width,
      height: input.height,
      paletteId: input.paletteId,
      seed: input.seed,
      direction: input.direction,
    });
    return this.persistNewAsset({
      projectId: project.id,
      characterId: input.characterId ?? null,
      name: input.name.trim() || `${PIXEL_KIND_LABELS[input.kind]} ${input.seed}`,
      kind: input.kind,
      engine: "pixelbolt",
      prompt: input.prompt?.trim() ?? "",
      seed: input.seed,
      paletteId: input.paletteId,
      recipe,
      parentAssetId: null,
    });
  }

  async generateCharacterViews(
    characterId: string,
    seed?: number,
    width = 32,
    height = 32
  ): Promise<PixelAssetDetail[]> {
    const character = this.repo.pixel.getCharacter(characterId);
    if (!character) throw new Error("Character not found.");
    const sharedSeed = seed ?? character.seed;
    const views: Array<{ suffix: string; direction: "front" | "back" | "side"; mirror: boolean }> = [
      { suffix: "Front", direction: "front", mirror: false },
      { suffix: "Back", direction: "back", mirror: false },
      { suffix: "Right", direction: "side", mirror: false },
      { suffix: "Left", direction: "side", mirror: true },
    ];
    const results: PixelAssetDetail[] = [];
    for (const view of views) {
      const recipe = buildPixelRecipe({
        kind: "character",
        name: `${character.name} ${view.suffix}`,
        width,
        height,
        paletteId: character.paletteId,
        seed: sharedSeed,
        direction: view.direction,
      });
      if (view.mirror) {
        for (const frame of recipe.frames) frame.flipX = true;
      }
      results.push(
        await this.persistNewAsset({
          projectId: character.projectId,
          characterId: character.id,
          name: `${character.name} ${view.suffix}`,
          kind: "character",
          engine: "pixelbolt",
          prompt: character.description,
          seed: sharedSeed,
          paletteId: character.paletteId,
          recipe,
          parentAssetId: null,
        })
      );
    }
    return results;
  }

  async importLibraryImage(input: PixelImportInput): Promise<PixelAssetDetail> {
    const project = this.repo.pixel.getProject(input.projectId);
    if (!project) throw new Error("Pixel project not found.");
    this.assertSize(input.width, input.height);
    const image = this.repo.getImageById(input.imageId);
    if (!image) throw new Error("Library image not found.");
    const preset = getPalettePreset(input.paletteId);
    const colors = paletteColors(preset);
    const { data, info } = await sharp(image.filePath)
      .resize(input.width, input.height, { kernel: "nearest", fit: "fill" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const transparent = input.transparent !== false;
    const corner: [number, number, number, number] | null = transparent
      ? [data[0]!, data[1]!, data[2]!, data[3]!]
      : null;
    const pixels: Array<{ x: number; y: number; color: string }> = [];
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const offset = (y * info.width + x) * 4;
        const rgba: [number, number, number, number] = [
          data[offset]!,
          data[offset + 1]!,
          data[offset + 2]!,
          data[offset + 3]!,
        ];
        if (rgba[3]! < 24) continue;
        if (corner && colorDistance(rgba, corner) < 42) continue;
        const snapped = nearestPaletteColor(rgba, colors);
        pixels.push({ x, y, color: snapped });
      }
    }
    if (!pixels.length) throw new Error("The imported image became fully transparent.");
    const recipe: PixelRecipe = {
      version: 1,
      name: slugify(input.name),
      width: input.width,
      height: input.height,
      palette: buildPalette(preset),
      frames: [{ name: "imported", duration: 400, pixels }],
      animations: { idle: { frames: ["imported"] } },
      sheet: { columns: 1, padding: 0, scale: input.width <= 32 ? 4 : 2 },
    };
    return this.persistNewAsset({
      projectId: project.id,
      characterId: null,
      name: input.name.trim() || image.fileName,
      kind: "item",
      engine: "imported",
      prompt: image.prompt,
      seed: image.seed,
      paletteId: input.paletteId,
      recipe,
      parentAssetId: null,
    });
  }

  async saveFrames(
    assetId: string,
    frames: PixelFrameInput[],
    dimensions?: { width: number; height: number }
  ): Promise<PixelAssetDetail> {
    const asset = this.repo.pixel.getAsset(assetId);
    if (!asset) throw new Error("Pixel asset not found.");
    if (!frames.length) throw new Error("At least one frame is required.");
    const width = dimensions?.width ?? asset.width;
    const height = dimensions?.height ?? asset.height;
    this.assertSize(width, height);
    const existing = this.repo.pixel.getFrames(assetId);
    const engine = await loadPixelEngine();
    const previous = JSON.parse(asset.recipeJson) as PixelRecipe;
    const ordered = [...frames].sort((a, b) => a.index - b.index);
    const nextFrames: NonNullable<PixelRecipe["frames"]> = [];
    const renamed = new Map<string, string>();
    for (const [index, frame] of ordered.entries()) {
      const buffer = await dataUrlToPng(frame.dataUrl);
      const name = frame.name.trim() || `frame_${index + 1}`;
      const original = existing[index]?.name;
      if (original) renamed.set(original, name);
      nextFrames.push({
        name,
        duration: Math.max(1, Math.min(60000, Math.round(frame.durationMs))),
        pixels: buildPixelsFromImage(engine, buffer, width, height),
      });
    }
    const animations: NonNullable<PixelRecipe["animations"]> = {};
    for (const [name, animation] of Object.entries(previous.animations ?? {})) {
      const mapped = animation.frames
        .map((frameName) => renamed.get(frameName) ?? frameName)
        .filter((frameName) => nextFrames.some((frame) => frame.name === frameName));
      if (mapped.length) animations[name] = { ...animation, frames: mapped };
    }
    if (!Object.keys(animations).length) {
      animations.idle = { frames: nextFrames.map((frame) => frame.name) };
    }
    const recipe: PixelRecipe = {
      version: 1,
      name: previous.name ?? slugify(asset.name),
      width,
      height,
      palette: previous.palette ?? buildPalette(getPalettePreset(asset.paletteId)),
      frames: nextFrames,
      animations,
      sheet: previous.sheet ?? { columns: Math.min(4, nextFrames.length), padding: 0, scale: 1 },
    };
    const render = await renderRecipe(recipe);
    const directory = this.assetDirectory(asset.id);
    await this.removeFrameFiles(directory);
    const written = await writeRenderFiles(engine, render, directory, slugify(asset.name));
    const version = asset.version + 1;
    this.repo.pixel.replaceFrames(
      asset.id,
      render.frames.map((frame, index) => ({
        index,
        name: frame.name,
        durationMs: frame.duration,
        filePath: written.framePaths[index]!,
      })),
      {
        recipeJson: JSON.stringify(recipe),
        previewPath: written.previewPath,
        sheetPath: written.sheetPath,
        frameCount: render.frames.length,
        version,
        width,
        height,
      }
    );
    if (existing.length !== render.frames.length) {
      this.logger.log(
        "INFO",
        "pixel",
        `Asset ${asset.name} frame count changed from ${existing.length} to ${render.frames.length}`
      );
    }
    return this.buildDetail(asset.id);
  }

  async listVersions(assetId: string): Promise<PixelAssetVersion[]> {
    if (!this.repo.pixel.getAsset(assetId)) throw new Error("Pixel asset not found.");
    const rows = this.repo.pixel.listVersions(assetId);
    return Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        assetId: row.assetId,
        version: row.version,
        previewDataUrl: await readFileDataUrl(row.previewPath).catch(() => ""),
        createdAt: row.createdAt,
      }))
    );
  }

  renameAsset(id: string, name: string): PixelAssetRecord {
    if (!this.repo.pixel.renameAsset(id, name)) throw new Error("Pixel asset not found.");
    const asset = this.repo.pixel.getAsset(id)!;
    return { ...asset, previewDataUrl: this.readPreview(asset) };
  }

  async duplicateAsset(id: string, name?: string): Promise<PixelAssetDetail> {
    const asset = this.repo.pixel.getAsset(id);
    if (!asset) throw new Error("Pixel asset not found.");
    const frames = this.repo.pixel.getFrames(id);
    const newId = randomUUID();
    const directory = this.assetDirectory(newId);
    await fs.mkdir(directory, { recursive: true });
    const copied: Array<{ index: number; name: string; durationMs: number; filePath: string }> = [];
    for (const frame of frames) {
      const target = path.join(directory, path.basename(frame.filePath));
      await fs.copyFile(frame.filePath, target);
      copied.push({ ...frame, filePath: target });
    }
    const previewPath = path.join(directory, "preview.png");
    const sheetPath = path.join(directory, "sheet.png");
    const oldDirectory = this.assetDirectory(id);
    await fs.copyFile(path.join(oldDirectory, "preview.png"), previewPath).catch(() => undefined);
    await fs.copyFile(path.join(oldDirectory, "sheet.png"), sheetPath).catch(() => undefined);
    this.repo.pixel.insertAsset(
      {
        id: newId,
        projectId: asset.projectId,
        characterId: asset.characterId,
        name: name?.trim() || `${asset.name} copy`,
        kind: asset.kind,
        engine: asset.engine,
        width: asset.width,
        height: asset.height,
        prompt: asset.prompt,
        seed: asset.seed,
        paletteId: asset.paletteId,
        palette: asset.palette,
        recipeJson: asset.recipeJson,
        previewPath,
        sheetPath,
        parentAssetId: id,
      },
      copied
    );
    return this.buildDetail(newId);
  }

  async deleteAsset(id: string): Promise<boolean> {
    if (!this.repo.pixel.getAsset(id)) return false;
    this.removeAssetDirectory(id);
    return this.repo.pixel.deleteAsset(id);
  }

  async exportAsset(
    id: string,
    format: PixelExportFormat,
    options: PixelExportOptions = {}
  ): Promise<PixelExportResult> {
    const asset = this.repo.pixel.getAsset(id);
    if (!asset) throw new Error("Pixel asset not found.");
    const engine = await loadPixelEngine();
    const recipe = JSON.parse(asset.recipeJson) as PixelRecipe;
    const render = await renderRecipe(recipe);
    const outputDir = path.join(this.paths.pixelExportsDir, asset.id);
    await fs.mkdir(outputDir, { recursive: true });
    const slug = slugify(asset.name);
    const scale = clampScale(options.scale);
    let result: PixelExportResult;
    switch (format) {
      case "png": {
        const index = Math.max(0, Math.min(render.frames.length - 1, options.frameIndex ?? 0));
        const frame = render.frames[index]!;
        const data =
          scale === 1
            ? frame.data
            : engine.scalePixels(frame.data, render.width, render.height, scale);
        const filePath = path.join(outputDir, `${slug}.png`);
        await fs.writeFile(filePath, engine.encodePNG(data, render.width * scale, render.height * scale));
        result = {
          format,
          filePath,
          width: render.width * scale,
          height: render.height * scale,
          frameCount: 1,
        };
        break;
      }
      case "sheet": {
        const atlas = engine.buildAtlas(render);
        const filePath = path.join(outputDir, `${slug}-sheet.png`);
        await fs.writeFile(filePath, engine.encodePNG(atlas.data, atlas.width, atlas.height));
        result = {
          format,
          filePath,
          width: atlas.width,
          height: atlas.height,
          frameCount: render.frames.length,
        };
        break;
      }
      case "gif": {
        const animation =
          options.animation && render.animations[options.animation]
            ? options.animation
            : Object.keys(render.animations)[0];
        if (!animation) throw new Error("This asset has no animation to export as GIF.");
        const gif = engine.animationGIF(render, animation, { scale });
        const filePath = path.join(outputDir, `${slug}-${animation}.gif`);
        await fs.writeFile(filePath, gif.data);
        result = {
          format,
          filePath,
          width: gif.width,
          height: gif.height,
          frameCount: gif.frames,
          note: gif.notes.length ? gif.notes.join(" ") : undefined,
        };
        break;
      }
      case "apng": {
        const animation =
          options.animation && render.animations[options.animation]
            ? options.animation
            : Object.keys(render.animations)[0];
        if (!animation) throw new Error("This asset has no animation to export as APNG.");
        const sequence = render.animations[animation]!;
        const frames = sequence.frames.map((index) => {
          const frame = render.frames[index]!;
          return {
            data:
              scale === 1
                ? frame.data
                : engine.scalePixels(frame.data, render.width, render.height, scale),
            duration: frame.duration,
          };
        });
        const filePath = path.join(outputDir, `${slug}-${animation}.png`);
        await fs.writeFile(
          filePath,
          engine.encodeAPNG(frames, render.width * scale, render.height * scale, sequence.loop)
        );
        result = {
          format,
          filePath,
          width: render.width * scale,
          height: render.height * scale,
          frameCount: frames.length,
        };
        break;
      }
      case "zip": {
        const files = new Map<string, Uint8Array>();
        render.frames.forEach((frame, index) => {
          files.set(
            `frames/${String(index).padStart(3, "0")}_${frame.name}.png`,
            engine.encodePNG(frame.data, render.width, render.height)
          );
        });
        const atlas = engine.buildAtlas(render);
        files.set(
          "sheet.png",
          engine.encodePNG(atlas.data, atlas.width, atlas.height)
        );
        files.set("recipe.json", Buffer.from(JSON.stringify(recipe, null, 2)));
        files.set(
          "metadata.json",
          Buffer.from(
            JSON.stringify(
              {
                name: asset.name,
                kind: asset.kind,
                engine: asset.engine,
                width: asset.width,
                height: asset.height,
                palette: asset.palette,
                frames: render.frames.map((frame) => ({
                  name: frame.name,
                  durationMs: frame.duration,
                })),
                animations: render.animations,
                generator: "Kirea Studio · Pixelbolt",
              },
              null,
              2
            )
          )
        );
        const filePath = path.join(outputDir, `${slug}.zip`);
        await fs.writeFile(filePath, engine.createZip(files));
        result = {
          format,
          filePath,
          width: render.width,
          height: render.height,
          frameCount: render.frames.length,
        };
        break;
      }
      case "godot": {
        const atlas = engine.buildAtlas(render);
        const sheetName = `${slug}.png`;
        await fs.writeFile(
          path.join(outputDir, sheetName),
          engine.encodePNG(atlas.data, atlas.width, atlas.height)
        );
        const tres = engine.spriteFrames(atlas.metadata, { image: sheetName });
        const filePath = path.join(outputDir, `${slug}.tres`);
        await fs.writeFile(filePath, tres.text);
        result = {
          format,
          filePath,
          width: atlas.width,
          height: atlas.height,
          frameCount: render.frames.length,
          note:
            tres.approximate.length > 0
              ? `Godot keeps fractional frame times for: ${tres.approximate.join(", ")}.`
              : undefined,
        };
        break;
      }
      case "unity": {
        const atlas = engine.buildAtlas(render);
        const sheetName = `${slug}.png`;
        await fs.writeFile(
          path.join(outputDir, sheetName),
          engine.encodePNG(atlas.data, atlas.width, atlas.height)
        );
        const filePath = path.join(outputDir, `${slug}.unity.json`);
        await fs.writeFile(
          filePath,
          JSON.stringify(
            {
              texture: sheetName,
              frames: Object.entries(atlas.metadata.frames).map(([name, entry]) => ({
                name,
                x: entry.frame.x,
                y: entry.frame.y,
                width: entry.frame.w,
                height: entry.frame.h,
                durationMs: entry.duration,
              })),
              animations: atlas.metadata.animations,
            },
            null,
            2
          )
        );
        result = {
          format,
          filePath,
          width: atlas.width,
          height: atlas.height,
          frameCount: render.frames.length,
        };
        break;
      }
      case "phaser": {
        const atlas = engine.buildAtlas(render);
        const sheetName = `${slug}.png`;
        await fs.writeFile(
          path.join(outputDir, sheetName),
          engine.encodePNG(atlas.data, atlas.width, atlas.height)
        );
        const filePath = path.join(outputDir, `${slug}.phaser.json`);
        await fs.writeFile(filePath, JSON.stringify(atlas.metadata, null, 2));
        result = {
          format,
          filePath,
          width: atlas.width,
          height: atlas.height,
          frameCount: render.frames.length,
        };
        break;
      }
      default:
        throw new Error(`Unsupported export format: ${String(format)}`);
    }
    this.repo.pixel.recordExport(asset.id, format, result, {
      scale,
      animation: options.animation ?? null,
      frameIndex: options.frameIndex ?? null,
    });
    this.logger.log("INFO", "pixel", `Exported ${asset.name} as ${format} to ${result.filePath}`);
    return result;
  }

  async getSpriteKilnReport(): Promise<SpriteKilnReport> {
    const root = this.resolveSpriteKilnRoot();
    if (!root) {
      return {
        available: false,
        rootPath: "",
        workflows: [],
        message:
          "SpriteKiln is not present. Clone it into external/pixel-engines/spritekiln to inspect its workflows.",
      };
    }
    const files = await collectWorkflowFiles(root, 0);
    const objectInfo = await this.runtime
      .getApiClient()
      .getAllObjectInfo()
      .catch(() => null);
    const installed = objectInfo ? new Set(Object.keys(objectInfo)) : null;
    const workflows: SpriteKilnWorkflowReport[] = [];
    for (const file of files.slice(0, 24)) {
      workflows.push(await inspectWorkflow(file, installed));
    }
    const runnable = workflows.filter((workflow) => workflow.runnable).length;
    return {
      available: true,
      rootPath: root,
      workflows,
      message: installed
        ? `${workflows.length} workflows inspected against the running ComfyUI; ${runnable} have every node available.`
        : `${workflows.length} workflows inspected. Connect ComfyUI to check node availability.`,
    };
  }

  private ensureDefaultProject(): void {
    if (this.repo.pixel.listProjects().length > 0) return;
    this.repo.pixel.saveProject({
      name: "First Pixel Project",
      description: "A home for your first characters, tiles and effects.",
      width: 32,
      height: 32,
    });
  }

  private async persistNewAsset(input: {
    projectId: string;
    characterId: string | null;
    name: string;
    kind: PixelAssetRecord["kind"];
    engine: PixelAssetRecord["engine"];
    prompt: string;
    seed: number;
    paletteId: string;
    recipe: PixelRecipe;
    parentAssetId: string | null;
  }): Promise<PixelAssetDetail> {
    const engineModule = await loadPixelEngine();
    const render = await renderRecipe(input.recipe);
    const id = randomUUID();
    const directory = this.assetDirectory(id);
    const written = await writeRenderFiles(engineModule, render, directory, slugify(input.name));
    this.repo.pixel.insertAsset(
      {
        id,
        projectId: input.projectId,
        characterId: input.characterId,
        name: input.name,
        kind: input.kind,
        engine: input.engine,
        width: render.width,
        height: render.height,
        prompt: input.prompt,
        seed: input.seed,
        paletteId: input.paletteId,
        palette: paletteColors(getPalettePreset(input.paletteId)),
        recipeJson: JSON.stringify(input.recipe),
        previewPath: written.previewPath,
        sheetPath: written.sheetPath,
        parentAssetId: input.parentAssetId,
      },
      render.frames.map((frame, index) => ({
        index,
        name: frame.name,
        durationMs: frame.duration,
        filePath: written.framePaths[index]!,
      }))
    );
    return this.buildDetail(id);
  }

  private async buildDetail(id: string): Promise<PixelAssetDetail> {
    const asset = this.repo.pixel.getAsset(id);
    if (!asset) throw new Error("Pixel asset not found.");
    const rows = this.repo.pixel.getFrames(id);
    const recipe = JSON.parse(asset.recipeJson) as PixelRecipe;
    const nameToIndex = new Map(rows.map((row) => [row.name, row.index]));
    const animations: Record<string, PixelAnimationRecord> = {};
    for (const [name, animation] of Object.entries(recipe.animations ?? {})) {
      const indices = animation.frames
        .map((frameName) => nameToIndex.get(frameName))
        .filter((index): index is number => index !== undefined);
      if (!indices.length) continue;
      animations[name] = {
        frames: indices,
        loop: animation.loop !== false,
        duration: indices.reduce((sum, index) => sum + (rows[index]?.durationMs ?? 100), 0),
      };
    }
    const frames: PixelFrameRecord[] = await Promise.all(
      rows.map(async (row) => ({
        index: row.index,
        name: row.name,
        durationMs: row.durationMs,
        dataUrl: await readFileDataUrl(row.filePath).catch(() => ""),
      }))
    );
    return {
      ...asset,
      previewDataUrl: this.readPreview(asset),
      frames,
      animations,
    };
  }

  private readPreview(asset: PixelAssetRecord): string {
    try {
      return pngToDataUrl(fsSync.readFileSync(asset.previewPath));
    } catch {
      return "";
    }
  }

  private assetDirectory(id: string): string {
    return path.join(this.paths.pixelAssetsDir, id);
  }

  private async removeAssetDirectory(id: string): Promise<void> {
    const directory = path.resolve(this.assetDirectory(id));
    const root = path.resolve(this.paths.pixelAssetsDir);
    if (!directory.startsWith(root + path.sep)) return;
    await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }

  private async removeFrameFiles(directory: string): Promise<void> {
    const entries = await fs.readdir(directory).catch(() => [] as string[]);
    await Promise.all(
      entries
        .filter((entry) => /^frame_\d+\.png$/.test(entry))
        .map((entry) => fs.rm(path.join(directory, entry), { force: true }))
    );
  }

  private resolveSpriteKilnRoot(): string | null {
    const candidates: string[] = [];
    try {
      const electron = require("electron") as {
        app?: { isPackaged?: boolean; getAppPath?: () => string };
      };
      const app = electron.app;
      if (app && typeof app.getAppPath === "function") {
        candidates.push(
          app.isPackaged
            ? path.join(process.resourcesPath, "pixel-engines", "spritekiln")
            : path.join(app.getAppPath(), "external", "pixel-engines", "spritekiln")
        );
      }
    } catch {
      // Not running inside Electron.
    }
    candidates.push(path.join(process.cwd(), "external", "pixel-engines", "spritekiln"));
    for (const candidate of candidates) {
      try {
        if (fsSync.existsSync(candidate)) return candidate;
      } catch {
        // Keep looking.
      }
    }
    return null;
  }

  private assertSize(width: number, height: number): void {
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 8 ||
      height < 8 ||
      width > MAX_ASSET_SIDE ||
      height > MAX_ASSET_SIDE
    ) {
      throw new Error(`Pixel assets must be between 8 and ${MAX_ASSET_SIDE} pixels per side.`);
    }
  }
}

function clampScale(value: number | undefined): number {
  if (value === undefined) return 1;
  if (!Number.isInteger(value) || value < 1 || value > 8) {
    throw new Error("Export scale must be a whole number from 1 to 8.");
  }
  return value;
}

function colorDistance(
  a: [number, number, number, number],
  b: [number, number, number, number]
): number {
  return Math.sqrt(
    (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
  );
}

function nearestPaletteColor(
  rgba: [number, number, number, number],
  palette: string[]
): string {
  let best = palette[0] ?? "#ffffff";
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const color of palette) {
    const hex = color.replace("#", "");
    const candidate: [number, number, number, number] = [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
      255,
    ];
    const distance = colorDistance(rgba, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = color;
    }
  }
  return best;
}

async function collectWorkflowFiles(root: string, depth: number): Promise<string[]> {
  if (depth > 4) return [];
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectWorkflowFiles(fullPath, depth + 1)));
      continue;
    }
    if (!entry.name.endsWith(".json")) continue;
    const text = await fs.readFile(fullPath, "utf8").catch(() => "");
    if (text.includes('"nodes"') && text.includes('"links"')) files.push(fullPath);
    if (files.length >= 40) break;
  }
  return files;
}

async function inspectWorkflow(
  file: string,
  installed: Set<string> | null
): Promise<SpriteKilnWorkflowReport> {
  const title = path.basename(file);
  try {
    const raw = JSON.parse(await fs.readFile(file, "utf8")) as {
      nodes?: Array<{ type?: string; widgets_values?: unknown[] }>;
    };
    const nodes = raw.nodes ?? [];
    const nodeTypes = [...new Set(nodes.map((node) => String(node.type ?? "")).filter(Boolean))];
    const modelFiles = new Set<string>();
    for (const node of nodes) {
      for (const value of node.widgets_values ?? []) {
        if (typeof value === "string" && /\.(safetensors|ckpt|pt|pth|bin)$/i.test(value)) {
          modelFiles.add(value);
        }
      }
    }
    const missingNodes = installed
      ? nodeTypes.filter((type) => !installed.has(type))
      : nodeTypes.filter((type) => /pixel|sprite|kiln/i.test(type));
    const runnable = installed !== null && missingNodes.length === 0;
    return {
      file,
      title,
      nodeCount: nodes.length,
      nodeTypes,
      modelFiles: [...modelFiles],
      customNodeTypes: missingNodes,
      runnable,
      reason: runnable
        ? null
        : installed
          ? `Missing nodes: ${missingNodes.join(", ") || "unknown"}`
          : "Connect ComfyUI to verify node availability.",
    };
  } catch (error) {
    return {
      file,
      title,
      nodeCount: 0,
      nodeTypes: [],
      modelFiles: [],
      customNodeTypes: [],
      runnable: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
