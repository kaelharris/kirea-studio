import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type {
  PixelAnimationInput,
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
  PixelSavedPalette,
  PixelSavedPaletteInput,
  SpriteKilnReport,
  SpriteKilnWorkflowReport,
} from "../../shared/pixel-types";
import { PIXEL_KIND_LABELS } from "../../shared/pixel-types";
import {
  DEFAULT_PACKAGE_OUTPUTS,
  DEFAULT_SHEET_LAYOUT,
  type PixelPackageOutputs,
  type PixelPackagePlan,
  type PixelPackageProgress,
  type PixelPackageRequest,
  type PixelPackageResult,
  type PixelPackageScope,
  type PixelPackageSummary,
  type PixelSheetLayout,
} from "../../shared/pixel-package-types";
import type { PixelAiGenerationMetadata } from "../../shared/pixel-ai-types";
import { buildPackage, PackageCancelledError, type BuiltPackage } from "./export/package-builder";
import { verifyPackage } from "./export/package-verify";
import { writePackage } from "./export/package-writer";
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
const GENERATION_SIDECAR = "generation.json";

export class PixelService extends EventEmitter {
  private readonly packageJobs = new Map<string, AbortController>();
  private appVersionPromise: Promise<string> | null = null;

  constructor(
    private readonly paths: StudioPaths,
    private readonly repo: StudioRepository,
    private readonly runtime: ComfyRuntimeManager,
    private readonly logger: StudioLogger
  ) {
    super();
  }

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

  async importGeneratedPng(input: {
    projectId: string;
    characterId?: string | null;
    parentAssetId?: string | null;
    name: string;
    kind: PixelAssetRecord["kind"];
    prompt: string;
    seed: number;
    paletteId: string;
    png: Buffer;
    width: number;
    height: number;
    generation: PixelAiGenerationMetadata;
  }): Promise<PixelAssetDetail> {
    const project = this.repo.pixel.getProject(input.projectId);
    if (!project) throw new Error("Pixel project not found.");
    this.assertSize(input.width, input.height);
    if (input.characterId) {
      const character = this.repo.pixel.getCharacter(input.characterId);
      if (!character || character.projectId !== project.id) {
        throw new Error("Character not found in this project.");
      }
    }
    if (input.parentAssetId) {
      const parent = this.repo.pixel.getAsset(input.parentAssetId);
      if (!parent || parent.projectId !== project.id) {
        throw new Error("Parent asset not found in this project.");
      }
    }
    const engine = await loadPixelEngine();
    const pixels = buildPixelsFromImage(engine, input.png, input.width, input.height);
    if (!pixels.length) throw new Error("The generated image became fully transparent.");
    const preset = getPalettePreset(input.paletteId);
    const recipe: PixelRecipe = {
      version: 1,
      name: slugify(input.name),
      width: input.width,
      height: input.height,
      palette: buildPalette(preset),
      frames: [{ name: "generated", duration: 400, pixels }],
      animations: { idle: { frames: ["generated"] } },
      sheet: { columns: 1, padding: 0, scale: input.width <= 32 ? 4 : 2 },
    };
    return this.persistNewAsset({
      projectId: project.id,
      characterId: input.characterId ?? null,
      name: input.name.trim() || "AI pixel asset",
      kind: input.kind,
      engine: "comfyui",
      prompt: input.prompt,
      seed: input.seed,
      paletteId: input.paletteId,
      recipe,
      parentAssetId: input.parentAssetId ?? null,
      generation: input.generation,
    });
  }

  async saveFrames(
    assetId: string,
    frames: PixelFrameInput[],
    dimensions?: { width: number; height: number },
    options?: {
      palette?: string[];
      animations?: Record<string, { frames: string[]; loop?: boolean }>;
    }
  ): Promise<PixelAssetDetail> {
    const asset = this.repo.pixel.getAsset(assetId);
    if (!asset) throw new Error("Pixel asset not found.");
    if (!frames.length) throw new Error("At least one frame is required.");
    const width = dimensions?.width ?? asset.width;
    const height = dimensions?.height ?? asset.height;
    this.assertSize(width, height);
    const palette = options?.palette
      ? normalizePalette(options.palette)
      : asset.palette.length
        ? asset.palette
        : paletteColors(getPalettePreset(asset.paletteId));
    const existing = this.repo.pixel.getFrames(assetId);
    const engine = await loadPixelEngine();
    const previous = JSON.parse(asset.recipeJson) as PixelRecipe;
    const ordered = [...frames].sort((a, b) => a.index - b.index);
    const existingById = new Map(existing.filter((frame) => frame.id).map((frame) => [frame.id, frame]));
    const usedIds = new Set<string>();
    const usedNames = new Set<string>();
    const nextFrames: NonNullable<PixelRecipe["frames"]> = [];
    const nextIds: string[] = [];
    const renamed = new Map<string, string>();
    for (const [index, frame] of ordered.entries()) {
      const buffer = await dataUrlToPng(frame.dataUrl);
      const id = this.resolveFrameId(frame, usedIds);
      const name = uniqueFrameName(frame.name.trim() || `frame_${index + 1}`, usedNames);
      const original = existingById.get(id);
      if (original && !renamed.has(original.name)) renamed.set(original.name, name);
      nextIds.push(id);
      nextFrames.push({
        name,
        duration: Math.max(1, Math.min(60000, Math.round(frame.durationMs))),
        pixels: buildPixelsFromImage(engine, buffer, width, height),
      });
    }
    const animations: NonNullable<PixelRecipe["animations"]> = {};
    const sourceAnimations = options?.animations ?? previous.animations ?? {};
    for (const [name, animation] of Object.entries(sourceAnimations)) {
      const mapped = animation.frames
        .map((frameName) => renamed.get(frameName) ?? frameName)
        .filter((frameName) => nextFrames.some((frame) => frame.name === frameName));
      if (mapped.length) animations[name] = { frames: mapped, loop: animation.loop };
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
    const version = asset.version + 1;
    const directory = this.assetDirectory(asset.id);
    const finalDirectory = this.versionDirectory(asset.id, version);
    await this.assertVersionSlot(asset.id, version);
    const staging = this.stagingDirectory(asset.id);
    let committed = false;
    try {
      const staged = await writeRenderFiles(engine, render, staging, slugify(asset.name));
      await fs
        .copyFile(
          path.join(this.versionDirectory(asset.id, asset.version), GENERATION_SIDECAR),
          path.join(staging, GENERATION_SIDECAR)
        )
        .catch(() => undefined);
      await fs.mkdir(path.dirname(finalDirectory), { recursive: true });
      await fs.rename(staging, finalDirectory);
      committed = true;
      const written = rebaseRenderFiles(staged, staging, finalDirectory);
      this.repo.pixel.replaceFrames(
        asset.id,
        render.frames.map((frame, index) => ({
          id: nextIds[index]!,
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
          palette,
        }
      );
    } catch (error) {
      if (committed) {
        await fs.rm(finalDirectory, { recursive: true, force: true }).catch(() => undefined);
      }
      throw error;
    } finally {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
    }
    await this.removeLegacyFrameFiles(directory);
    if (existing.length !== render.frames.length) {
      this.logger.log(
        "INFO",
        "pixel",
        `Asset ${asset.name} frame count changed from ${existing.length} to ${render.frames.length}`
      );
    }
    return this.buildDetail(asset.id);
  }

  async saveAnimations(
    assetId: string,
    animations: PixelAnimationInput[]
  ): Promise<PixelAssetDetail> {
    const asset = this.repo.pixel.getAsset(assetId);
    if (!asset) throw new Error("Pixel asset not found.");
    if (!animations.length) throw new Error("At least one animation clip is required.");
    if (animations.length > 64) throw new Error("An asset supports at most 64 animation clips.");
    const frames = this.repo.pixel.getFrames(assetId);
    if (!frames.length) throw new Error("This asset has no frames to animate.");
    const validNames = new Set(frames.map((frame) => frame.name));
    const usedNames = new Set<string>();
    const next: NonNullable<PixelRecipe["animations"]> = {};
    for (const animation of animations) {
      const name = animation.name.trim().slice(0, 60);
      if (!name) throw new Error("Every animation clip needs a name.");
      if (usedNames.has(name.toLowerCase())) {
        throw new Error(`Animation clip "${name}" is defined twice.`);
      }
      usedNames.add(name.toLowerCase());
      const seen = new Set<string>();
      const clipFrames: string[] = [];
      for (const frameName of animation.frames) {
        if (!validNames.has(frameName)) {
          throw new Error(`Animation clip "${name}" references a missing frame "${frameName}".`);
        }
        if (!seen.has(frameName)) {
          seen.add(frameName);
          clipFrames.push(frameName);
        }
      }
      if (!clipFrames.length) throw new Error(`Animation clip "${name}" has no frames.`);
      next[name] = { frames: clipFrames, loop: animation.loop };
    }
    const recipe = JSON.parse(asset.recipeJson) as PixelRecipe;
    recipe.animations = next;
    this.repo.pixel.updateRecipe(assetId, JSON.stringify(recipe), asset.version + 1);
    return this.buildDetail(assetId);
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

  async saveAssetPalette(assetId: string, colors: string[]): Promise<PixelAssetDetail> {
    const asset = this.repo.pixel.getAsset(assetId);
    if (!asset) throw new Error("Pixel asset not found.");
    const palette = normalizePalette(colors);
    this.repo.pixel.updatePalette(assetId, palette, asset.version + 1);
    return this.buildDetail(assetId);
  }

  async getAssetVersion(assetId: string, version: number): Promise<PixelAssetDetail> {
    const asset = this.repo.pixel.getAsset(assetId);
    if (!asset) throw new Error("Pixel asset not found.");
    const row = this.repo.pixel.getVersion(assetId, version);
    if (!row) throw new Error(`Version ${version} does not exist for this asset.`);
    const recipe = JSON.parse(row.recipeJson) as PixelRecipe;
    let framesDirectory = path.dirname(row.previewPath);
    if (!fsSync.existsSync(path.join(framesDirectory, "frame_000.png"))) {
      for (let candidate = version; candidate >= 1; candidate -= 1) {
        const directory = this.versionDirectory(assetId, candidate);
        if (fsSync.existsSync(path.join(directory, "frame_000.png"))) {
          framesDirectory = directory;
          break;
        }
      }
    }
    const frames = await Promise.all(
      recipe.frames.map(async (frame, index) => {
        const filePath = path.join(
          framesDirectory,
          `frame_${String(index).padStart(3, "0")}.png`
        );
        const dataUrl = await readFileDataUrl(filePath).catch(() => "");
        if (!dataUrl) {
          throw new Error(
            `Version ${version} is missing frame file ${path.basename(filePath)}.`
          );
        }
        return {
          id: `${assetId}:${version}:${index}`,
          index,
          name: frame.name,
          durationMs: frame.duration,
          dataUrl,
        };
      })
    );
    const nameToIndex = new Map(frames.map((frame) => [frame.name, frame.index]));
    const animations: Record<string, PixelAnimationRecord> = {};
    for (const [name, animation] of Object.entries(recipe.animations ?? {})) {
      const indices = animation.frames
        .map((frameName) => nameToIndex.get(frameName))
        .filter((index): index is number => index !== undefined);
      if (!indices.length) continue;
      animations[name] = {
        frames: indices,
        loop: animation.loop !== false,
        duration: indices.reduce((sum, index) => sum + (frames[index]?.durationMs ?? 100), 0),
      };
    }
    return {
      ...asset,
      version,
      width: recipe.width,
      height: recipe.height,
      palette: row.palette.length ? row.palette : asset.palette,
      previewDataUrl: await readFileDataUrl(row.previewPath).catch(() => ""),
      frames,
      animations,
      generation: await this.readGeneration(assetId, version),
    };
  }

  async restoreVersion(assetId: string, version: number): Promise<PixelAssetDetail> {
    const target = await this.getAssetVersion(assetId, version);
    const current = this.repo.pixel.getFrames(assetId);
    const idsByName = new Map(current.map((frame) => [frame.name, frame.id]));
    const inputs: PixelFrameInput[] = target.frames.map((frame, index) => ({
      id:
        current[index]?.name === frame.name
          ? current[index]!.id
          : idsByName.get(frame.name),
      index,
      name: frame.name,
      durationMs: frame.durationMs,
      dataUrl: frame.dataUrl,
    }));
    const targetRecipe = JSON.parse(target.recipeJson) as PixelRecipe;
    const restored = await this.saveFrames(
      assetId,
      inputs,
      { width: target.width, height: target.height },
      {
        palette: target.palette,
        animations: targetRecipe.animations,
      }
    );
    this.logger.log(
      "INFO",
      "pixel",
      `Restored ${target.name} to version ${version} as version ${restored.version}`
    );
    return restored;
  }

  listPaletteLibrary(): PixelSavedPalette[] {
    return this.repo.pixel.listPalettes();
  }

  savePaletteLibraryEntry(input: PixelSavedPaletteInput): PixelSavedPalette {
    const name = input.name.trim().slice(0, 80);
    if (!name) throw new Error("A palette needs a name.");
    return this.repo.pixel.savePalette({
      id: input.id,
      name,
      colors: normalizePalette(input.colors),
    });
  }

  deletePaletteLibraryEntry(id: string): boolean {
    return this.repo.pixel.deletePalette(id);
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
    const directory = this.versionDirectory(newId, 1);
    const previewPath = path.join(directory, "preview.png");
    const sheetPath = path.join(directory, "sheet.png");
    try {
      await fs.mkdir(directory, { recursive: true });
      const copied: Array<{ id: string; index: number; name: string; durationMs: number; filePath: string }> = [];
      for (const frame of frames) {
        const target = path.join(directory, path.basename(frame.filePath));
        await fs.copyFile(frame.filePath, target);
        copied.push({ ...frame, id: randomUUID(), filePath: target });
      }
      let sheetCopied = false;
      await fs.copyFile(asset.previewPath, previewPath);
      await fs
        .copyFile(
          path.join(this.versionDirectory(id, asset.version), GENERATION_SIDECAR),
          path.join(directory, GENERATION_SIDECAR)
        )
        .catch(() => undefined);
      if (asset.sheetPath) {
        await fs.copyFile(asset.sheetPath, sheetPath)
          .then(() => {
            sheetCopied = true;
          })
          .catch(() => undefined);
      }
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
          sheetPath: sheetCopied ? sheetPath : null,
          parentAssetId: id,
        },
        copied
      );
    } catch (error) {
      await this.removeAssetDirectory(newId);
      throw error;
    }
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
        const built = await this.buildLegacyPackage(asset, "generic", scale);
        const entries = new Map<string, Uint8Array>();
        for (const [relative, data] of built.files) entries.set(`${built.root}/${relative}`, data);
        const filePath = path.join(outputDir, `${slug}.zip`);
        await fs.writeFile(filePath, engine.createZip(entries));
        result = {
          format,
          filePath,
          width: built.sheetSize?.width ?? render.width * scale,
          height: built.sheetSize?.height ?? render.height * scale,
          frameCount: built.summary.frames,
          note: legacyNote(built),
        };
        break;
      }
      case "godot": {
        const built = await this.writeLegacyPackage(asset, "godot", scale);
        result = {
          format,
          filePath: path.join(built.folder, built.info.resource as string),
          width: built.sheetSize?.width ?? render.width * scale,
          height: built.sheetSize?.height ?? render.height * scale,
          frameCount: built.summary.frames,
          note: legacyNote(built),
        };
        break;
      }
      case "unity": {
        const built = await this.writeLegacyPackage(asset, "unity", scale);
        result = {
          format,
          filePath: path.join(built.folder, built.info.animations as string),
          width: built.sheetSize?.width ?? render.width * scale,
          height: built.sheetSize?.height ?? render.height * scale,
          frameCount: built.summary.frames,
          note: legacyNote(built),
        };
        break;
      }
      case "phaser": {
        const built = await this.writeLegacyPackage(asset, "phaser", scale);
        result = {
          format,
          filePath: path.join(built.folder, built.info.atlas as string),
          width: built.sheetSize?.width ?? render.width * scale,
          height: built.sheetSize?.height ?? render.height * scale,
          frameCount: built.summary.frames,
          note: legacyNote(built),
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

  async planPackage(input: PixelPackageRequest): Promise<PixelPackagePlan> {
    const request = normalizePackageRequest(input);
    const destination = this.packageDestination(request);
    const built = await buildPackage(await this.packageContext(), { ...request, destination });
    return this.toPlan(request, built, destination);
  }

  async exportPackage(input: PixelPackageRequest): Promise<PixelPackageResult> {
    const jobId = input.jobId ?? randomUUID();
    const request = normalizePackageRequest({ ...input, jobId });
    const destination = this.packageDestination(request);
    const controller = new AbortController();
    this.packageJobs.set(jobId, controller);
    const emit = (stage: PixelPackageProgress["stage"], done: number, total: number, message: string): void => {
      this.emit("pixelPackageProgress", { jobId, stage, done, total, message } satisfies PixelPackageProgress);
    };
    try {
      const engine = await loadPixelEngine();
      const context = await this.packageContext(engine);
      emit("collect", 0, 1, "Reading sprites");
      const built = await buildPackage(context, { ...request, destination }, {
        signal: controller.signal,
        onProgress: emit,
      });
      const plan = this.toPlan(request, built, destination);
      if (plan.blocked) {
        const first = plan.issues.find((issue) => issue.severity === "error");
        throw new Error(first?.message ?? "The package has errors and was not written.");
      }
      emit("write", 0, built.files.size, "Writing files");
      const written = await writePackage(built.files, {
        engine,
        destination,
        container: request.container,
        root: built.summary.root,
        signal: controller.signal,
      });
      emit("verify", 0, written.entries.size, "Checking the written package");
      const verification = verifyPackage(written.entries, {
        engine,
        expected: built.expected,
        root: written.root,
      });
      if (!verification.ok) {
        await fs.rm(written.filePath, { recursive: true, force: true }).catch(() => undefined);
        throw new Error(
          `The package failed verification and was removed: ${verification.problems.slice(0, 4).join(" ")}`
        );
      }
      const resolved: PixelPackagePlan = { ...plan, summary: { ...plan.summary, root: written.root } };
      emit("done", 1, 1, `Wrote ${path.basename(written.filePath)}`);
      this.logger.log(
        "INFO",
        "pixel",
        `Exported ${written.root} as a ${request.container} pixel package (${plan.files.length} files, ${verification.checkedImages} images and ${verification.checkedRegions} sheet regions verified).`
      );
      return { filePath: written.filePath, container: request.container, plan: resolved, verification };
    } catch (error) {
      if (error instanceof PackageCancelledError || controller.signal.aborted) {
        emit("cancelled", 0, 1, "Export cancelled");
        throw new Error("The export was cancelled.");
      }
      emit("failed", 0, 1, error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      this.packageJobs.delete(jobId);
    }
  }

  cancelPackage(jobId: string): boolean {
    const controller = this.packageJobs.get(jobId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  private packageDestination(request: PixelPackageRequest): string {
    return request.destination
      ? path.resolve(request.destination)
      : path.join(this.paths.pixelExportsDir, "packages");
  }

  private async packageContext(engine?: Awaited<ReturnType<typeof loadPixelEngine>>) {
    return {
      paths: this.paths,
      repo: this.repo,
      engine: engine ?? (await loadPixelEngine()),
      appVersion: await this.resolveAppVersion(),
    };
  }

  private resolveAppVersion(): Promise<string> {
    if (!this.appVersionPromise) {
      this.appVersionPromise = (async () => {
        try {
          const electron = (await import("electron")) as { app?: { getVersion?: () => string } };
          const version = electron.app?.getVersion?.();
          if (version) return version;
        } catch {
          // Not running inside Electron, e.g. unit tests.
        }
        try {
          const parsed = JSON.parse(
            await fs.readFile(path.join(process.cwd(), "package.json"), "utf8")
          ) as { version?: unknown };
          if (typeof parsed.version === "string") return parsed.version;
        } catch {
          // Fall through to the placeholder below.
        }
        return "unknown";
      })();
    }
    return this.appVersionPromise;
  }

  private toPlan(request: PixelPackageRequest, built: BuiltPackage, destination: string): PixelPackagePlan {
    const files = [...built.files.entries()].map(([file, data]) => ({
      ...(built.meta.get(file) ?? { kind: "provenance" as const }),
      path: file,
      bytes: data.length,
    }));
    return {
      request,
      summary: built.summary,
      files,
      issues: built.issues,
      blocked: built.issues.some((issue) => issue.severity === "error"),
      totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
      preview: built.preview,
      destination,
    };
  }

  private legacyRequest(asset: PixelAssetRecord, preset: "generic" | "godot" | "unity" | "phaser", scale: number): PixelPackageRequest {
    return normalizePackageRequest({
      scope: "asset",
      assetId: asset.id,
      preset,
      container: "folder",
      scale,
      layout: { ...DEFAULT_SHEET_LAYOUT },
      outputs: {
        frames: true,
        stills: true,
        combinedSheet: true,
        animationSheets: false,
        directionSheets: false,
        gif: false,
        apng: false,
      },
      background: null,
      pivot: "center",
      pixelsPerUnit: 100,
      destination: path.join(this.paths.pixelExportsDir, asset.id),
    });
  }

  private async buildLegacyPackage(
    asset: PixelAssetRecord,
    preset: "generic" | "godot" | "unity" | "phaser",
    scale: number
  ): Promise<LegacyPackage> {
    const request = this.legacyRequest(asset, preset, scale);
    const built = await buildPackage(await this.packageContext(), request);
    const failure = built.issues.find((issue) => issue.severity === "error");
    if (failure) throw new Error(failure.message);
    let sheetSize: { width: number; height: number } | null = null;
    for (const [file, meta] of built.meta) {
      if (meta.kind === "sheet" && file.startsWith("spritesheets/") && file.split("/").length === 2) {
        sheetSize = { width: meta.width ?? 0, height: meta.height ?? 0 };
        break;
      }
    }
    return {
      root: built.summary.root,
      folder: "",
      files: built.files,
      summary: built.summary,
      sheetSize,
      info: built.engines[preset] ?? {},
      warnings: built.issues.filter((issue) => issue.severity === "warning").map((issue) => issue.message),
    };
  }

  private async writeLegacyPackage(
    asset: PixelAssetRecord,
    preset: "godot" | "unity" | "phaser",
    scale: number
  ): Promise<LegacyPackage> {
    const built = await this.buildLegacyPackage(asset, preset, scale);
    const written = await writePackage(built.files, {
      engine: await loadPixelEngine(),
      destination: path.join(this.paths.pixelExportsDir, asset.id),
      container: "folder",
      root: built.root,
    });
    return { ...built, root: written.root, folder: written.filePath };
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
    generation?: PixelAiGenerationMetadata | null;
  }): Promise<PixelAssetDetail> {
    const engineModule = await loadPixelEngine();
    const render = await renderRecipe(input.recipe);
    const id = randomUUID();
    const finalDirectory = this.versionDirectory(id, 1);
    const staging = this.stagingDirectory(id);
    let committed = false;
    try {
      const staged = await writeRenderFiles(engineModule, render, staging, slugify(input.name));
      if (input.generation) {
        await fs.writeFile(
          path.join(staging, GENERATION_SIDECAR),
          JSON.stringify(input.generation, null, 2),
          { flush: true }
        );
      }
      await fs.mkdir(path.dirname(finalDirectory), { recursive: true });
      await fs.rename(staging, finalDirectory);
      committed = true;
      const written = rebaseRenderFiles(staged, staging, finalDirectory);
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
          id: randomUUID(),
          index,
          name: frame.name,
          durationMs: frame.duration,
          filePath: written.framePaths[index]!,
        }))
      );
    } catch (error) {
      if (committed) {
        await this.removeAssetDirectory(id);
      }
      throw error;
    } finally {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
    }
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
        id: row.id,
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
      generation: await this.readGeneration(asset.id, asset.version),
    };
  }

  private async readGeneration(
    assetId: string,
    version: number
  ): Promise<PixelAiGenerationMetadata | null> {
    const candidates = [
      path.join(this.versionDirectory(assetId, version), GENERATION_SIDECAR),
      path.join(this.assetDirectory(assetId), GENERATION_SIDECAR),
    ];
    for (const file of candidates) {
      try {
        const parsed = JSON.parse(await fs.readFile(file, "utf8")) as unknown;
        if (
          parsed &&
          typeof parsed === "object" &&
          (parsed as { backend?: unknown }).backend === "spritekiln"
        ) {
          return parsed as PixelAiGenerationMetadata;
        }
      } catch {
        // Try the next location.
      }
    }
    return null;
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

  private versionDirectory(assetId: string, version: number): string {
    return path.join(this.assetDirectory(assetId), "versions", String(version));
  }

  private stagingDirectory(assetId: string): string {
    return path.join(this.assetDirectory(assetId), `.staging-${randomUUID()}`);
  }

  private async assertVersionSlot(assetId: string, version: number): Promise<void> {
    const directory = this.versionDirectory(assetId, version);
    if (!fsSync.existsSync(directory)) return;
    if (this.repo.pixel.hasVersion(assetId, version)) {
      throw new Error(`Version ${version} already exists; reload the asset and try again.`);
    }
    // A crash between the atomic directory move and the database commit leaves an
    // unreferenced version directory behind; it is safe to discard.
    await fs.rm(directory, { recursive: true, force: true });
  }

  private resolveFrameId(frame: PixelFrameInput, usedIds: Set<string>): string {
    const requested = frame.id?.trim();
    const id = requested && !usedIds.has(requested) ? requested : randomUUID();
    usedIds.add(id);
    return id;
  }

  private async removeAssetDirectory(id: string): Promise<void> {
    const directory = path.resolve(this.assetDirectory(id));
    const root = path.resolve(this.paths.pixelAssetsDir);
    if (!directory.startsWith(root + path.sep)) return;
    await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }

  private async removeLegacyFrameFiles(directory: string): Promise<void> {
    const entries = await fs.readdir(directory).catch(() => [] as string[]);
    await Promise.all(
      entries
        .filter((entry) => /^frame_\d+\.png$/.test(entry))
        .map((entry) => fs.rm(path.join(directory, entry), { force: true }).catch(() => undefined))
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

function rebaseRenderFiles(
  written: { framePaths: string[]; previewPath: string; sheetPath: string },
  fromDirectory: string,
  toDirectory: string
): { framePaths: string[]; previewPath: string; sheetPath: string } {
  const rebase = (filePath: string): string =>
    path.join(toDirectory, path.relative(fromDirectory, filePath));
  return {
    framePaths: written.framePaths.map(rebase),
    previewPath: rebase(written.previewPath),
    sheetPath: rebase(written.sheetPath),
  };
}

function uniqueFrameName(raw: string, used: Set<string>): string {
  const base = raw.trim() || "frame";
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate.toLowerCase())) {
    const marker = `_${suffix}`;
    candidate = `${base.slice(0, Math.max(1, 60 - marker.length))}${marker}`;
    suffix += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function normalizePalette(colors: string[]): string[] {
  if (!Array.isArray(colors) || colors.length === 0) {
    throw new Error("A palette needs at least one colour.");
  }
  if (colors.length > 64) throw new Error("A palette supports at most 64 colours.");
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const entry of colors) {
    const value = String(entry).trim().toLowerCase();
    if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(value)) {
      throw new Error(`Palette colour "${entry}" is not a hex colour.`);
    }
    if (seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
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

interface LegacyPackage {
  root: string;
  folder: string;
  files: Map<string, Buffer>;
  summary: PixelPackageSummary;
  sheetSize: { width: number; height: number } | null;
  info: Record<string, unknown>;
  warnings: string[];
}

function legacyNote(built: LegacyPackage): string | undefined {
  if (built.warnings.length) return built.warnings.slice(0, 3).join(" ");
  const approximate = built.info.approximateTiming;
  return Array.isArray(approximate) && approximate.length
    ? `Godot keeps fractional frame times for: ${approximate.join(", ")}.`
    : undefined;
}

const PACKAGE_SCOPES: PixelPackageScope[] = ["asset", "animation", "character", "project"];

function normalizePackageRequest(input: PixelPackageRequest): PixelPackageRequest {
  if (!PACKAGE_SCOPES.includes(input.scope)) {
    throw new Error(`Unknown pixel package scope: ${String(input.scope)}`);
  }
  if (!["generic", "godot", "unity", "phaser"].includes(input.preset)) {
    throw new Error(`Unknown pixel package preset: ${String(input.preset)}`);
  }
  if (input.container !== "zip" && input.container !== "folder") {
    throw new Error(`Unknown pixel package container: ${String(input.container)}`);
  }
  if (input.pivot !== "center" && input.pivot !== "bottom-center" && input.pivot !== "top-left") {
    throw new Error(`Unknown pivot: ${String(input.pivot)}`);
  }
  if (!Number.isInteger(input.scale) || input.scale < 1 || input.scale > 8) {
    throw new Error("Packages export at a whole-number scale from 1 to 8.");
  }
  if (!Number.isFinite(input.pixelsPerUnit) || input.pixelsPerUnit < 1 || input.pixelsPerUnit > 10000) {
    throw new Error("Pixels per unit must be between 1 and 10000.");
  }
  if (input.version !== undefined && (!Number.isInteger(input.version) || input.version < 1)) {
    throw new Error("Pick a version number of 1 or higher.");
  }
  if (input.scope === "asset" && !input.assetId) throw new Error("Choose the asset to export.");
  if (input.scope === "character" && !input.characterId) throw new Error("Choose the character to export.");
  if (input.scope === "project" && !input.projectId) throw new Error("Choose the project to export.");
  if (input.scope === "animation") {
    if (!input.animation?.trim()) throw new Error("Choose the animation to export.");
    if (!input.characterId && !input.assetId) throw new Error("Choose the sprite or character whose animation to export.");
  }
  const background = input.background?.trim() || null;
  if (background && !/^#[0-9a-f]{6}$/i.test(background)) {
    throw new Error("The background colour must look like #1a1a2e.");
  }
  const source = input.layout ?? DEFAULT_SHEET_LAYOUT;
  const layout: PixelSheetLayout = {
    columns: clampInt(source.columns, 0, 64, DEFAULT_SHEET_LAYOUT.columns),
    rows: clampInt(source.rows, 0, 64, DEFAULT_SHEET_LAYOUT.rows),
    padding: clampInt(source.padding, 0, 64, DEFAULT_SHEET_LAYOUT.padding),
    spacing: clampInt(source.spacing, 0, 64, DEFAULT_SHEET_LAYOUT.spacing),
    extrude: clampInt(source.extrude, 0, 8, DEFAULT_SHEET_LAYOUT.extrude),
    trim: Boolean(source.trim),
    uniformFrames: Boolean(source.uniformFrames),
    maxSize: clampInt(source.maxSize, 64, 16384, DEFAULT_SHEET_LAYOUT.maxSize),
  };
  const outputs: PixelPackageOutputs = { ...DEFAULT_PACKAGE_OUTPUTS, ...(input.outputs ?? {}) };
  return { ...input, background, layout, outputs, destination: input.destination?.trim() || null };
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}
