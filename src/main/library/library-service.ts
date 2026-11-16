import fs from "node:fs";
import path from "node:path";
import type { StudioRepository } from "../db/repositories";
import type { StudioPaths } from "../paths";
import { isPathInsideAnyRoot } from "../security";
import type { GeneratedImageRecord, GeneratedVideoRecord } from "../../shared/types";
import {
  LIBRARY_MEDIA_TYPES,
  type LibraryAnimationItem,
  type LibraryBatchCollectionResult,
  type LibraryBatchDeleteResult,
  type LibraryBatchExportResult,
  type LibraryBatchFavoriteResult,
  type LibraryCharacterItem,
  type LibraryImageItem,
  type LibraryMediaFilter,
  type LibraryMediaItem,
  type LibraryMediaQuery,
  type LibraryMediaResult,
  type LibraryMediaType,
  type LibraryPixelAnimationSummary,
  type LibraryPixelItem,
  type LibraryVideoItem,
} from "../../shared/library";
import type { PixelRecipe } from "../../shared/pixel-recipe";

export type UnifiedLibraryQuery = LibraryMediaQuery;
export type UnifiedLibraryResult = LibraryMediaResult;

/**
 * Read-only aggregation over every existing media repository. Each repository
 * stays the source of truth; nothing is copied, migrated or duplicated.
 */
export class UnifiedLibraryService {
  constructor(
    private readonly repo: StudioRepository,
    private readonly paths: StudioPaths
  ) {}

  list(query: UnifiedLibraryQuery = {}): UnifiedLibraryResult {
    const all = this.collectAll();
    const models = this.collectModels(all);
    const filtered = this.applyQuery(all, query);
    const counts = this.countByType(this.applyQuery(all, { ...query, mediaType: "all" }));
    const requestedType = query.mediaType ?? "all";
    const items =
      requestedType === "all"
        ? filtered.filter((item) => item.mediaType !== "animation")
        : filtered.filter((item) => item.mediaType === requestedType);
    return { items, counts, models };
  }

  private collectModels(items: LibraryMediaItem[]): string[] {
    const set = new Set<string>();
    for (const item of items) {
      if (item.model && item.model.trim()) {
        set.add(item.model.trim());
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }

  async batchDelete(
    itemIds: string[],
    allowedRoots: string[] = []
  ): Promise<LibraryBatchDeleteResult> {
    const deletedIds: string[] = [];
    const failedIds: string[] = [];

    for (const id of itemIds) {
      try {
        const colonIdx = id.indexOf(":");
        if (colonIdx === -1) {
          failedIds.push(id);
          continue;
        }
        const mediaType = id.slice(0, colonIdx);
        const sourceId = id.slice(colonIdx + 1);

        if (mediaType === "image") {
          const img = this.repo.getImageById(sourceId);
          if (img) {
            if (
              allowedRoots.length > 0 &&
              isPathInsideAnyRoot(img.filePath, allowedRoots) &&
              fs.existsSync(img.filePath)
            ) {
              await fs.promises.rm(img.filePath, { force: true }).catch(() => undefined);
            }
            this.repo.deleteImage(sourceId);
            deletedIds.push(id);
          } else {
            failedIds.push(id);
          }
        } else if (mediaType === "video") {
          const video = this.repo.getVideoById(sourceId);
          if (video) {
            if (
              allowedRoots.length > 0 &&
              isPathInsideAnyRoot(video.filePath, allowedRoots) &&
              fs.existsSync(video.filePath)
            ) {
              await fs.promises.rm(video.filePath, { force: true }).catch(() => undefined);
              await fs.promises.rm(`${video.filePath}.json`, { force: true }).catch(() => undefined);
            }
            this.repo.deleteVideo(sourceId);
            deletedIds.push(id);
          } else {
            failedIds.push(id);
          }
        } else if (mediaType === "pixel") {
          const deleted = this.repo.pixel.deleteAsset(sourceId);
          if (deleted) {
            deletedIds.push(id);
          } else {
            failedIds.push(id);
          }
        } else if (mediaType === "character") {
          const deleted = this.repo.deleteCharacter(sourceId);
          if (deleted) {
            deletedIds.push(id);
          } else {
            failedIds.push(id);
          }
        } else {
          failedIds.push(id);
        }
      } catch {
        failedIds.push(id);
      }
    }

    return { deletedIds, failedIds };
  }

  async batchExport(
    itemIds: string[],
    destinationDir: string
  ): Promise<LibraryBatchExportResult> {
    if (!fs.existsSync(destinationDir) || !fs.statSync(destinationDir).isDirectory()) {
      throw new Error("Target destination directory does not exist or is not a directory.");
    }

    let exportedCount = 0;
    for (const id of itemIds) {
      try {
        const colonIdx = id.indexOf(":");
        if (colonIdx === -1) continue;
        const mediaType = id.slice(0, colonIdx);
        const sourceId = id.slice(colonIdx + 1);

        if (mediaType === "image") {
          const img = this.repo.getImageById(sourceId);
          if (img && fs.existsSync(img.filePath)) {
            const destPath = getUniqueDestinationPath(destinationDir, img.fileName);
            await fs.promises.copyFile(img.filePath, destPath);
            exportedCount++;
          }
        } else if (mediaType === "video") {
          const video = this.repo.getVideoById(sourceId);
          if (video && fs.existsSync(video.filePath)) {
            const destPath = getUniqueDestinationPath(destinationDir, video.fileName);
            await fs.promises.copyFile(video.filePath, destPath);
            exportedCount++;
          }
        } else if (mediaType === "pixel") {
          const asset = this.repo.pixel.getAsset(sourceId);
          if (asset?.previewPath && fs.existsSync(asset.previewPath)) {
            const base = `${sanitizeFileName(asset.name || "pixel_asset")}.png`;
            const destPath = getUniqueDestinationPath(destinationDir, base);
            await fs.promises.copyFile(asset.previewPath, destPath);
            exportedCount++;
          }
        } else if (mediaType === "character") {
          const char = this.repo.getCharacterById(sourceId);
          if (char && char.references.length > 0) {
            const primary =
              char.references.find((ref) => ref.role === "primary") ?? char.references[0];
            if (primary && fs.existsSync(primary.filePath)) {
              const ext = path.extname(primary.filePath) || ".png";
              const base = `${sanitizeFileName(char.name || "character")}${ext}`;
              const destPath = getUniqueDestinationPath(destinationDir, base);
              await fs.promises.copyFile(primary.filePath, destPath);
              exportedCount++;
            }
          }
        }
      } catch {
        // Continue batch export on individual item error
      }
    }

    return { exportedCount, destinationDir };
  }

  batchSetCollection(
    itemIds: string[],
    collectionId: string | null
  ): LibraryBatchCollectionResult {
    let updatedCount = 0;
    for (const id of itemIds) {
      if (id.startsWith("image:")) {
        const sourceId = id.slice(6);
        this.repo.updateImageMetadata(sourceId, { collectionId });
        updatedCount++;
      }
    }
    return { updatedCount };
  }

  async batchSetFavorite(
    itemIds: string[],
    favorite: boolean
  ): Promise<LibraryBatchFavoriteResult> {
    let updatedCount = 0;
    for (const id of itemIds) {
      const colonIdx = id.indexOf(":");
      if (colonIdx === -1) continue;
      const mediaType = id.slice(0, colonIdx);
      const sourceId = id.slice(colonIdx + 1);

      if (mediaType === "image") {
        const img = this.repo.getImageById(sourceId);
        if (img && img.favorite !== favorite) {
          this.repo.toggleImageFavorite(sourceId);
          updatedCount++;
        }
      } else if (mediaType === "video") {
        const video = this.repo.getVideoById(sourceId);
        if (video && video.favorite !== favorite) {
          this.repo.toggleVideoFavorite(sourceId);
          updatedCount++;
        }
      } else if (mediaType === "character") {
        const char = this.repo.getCharacterById(sourceId);
        if (char && char.favorite !== favorite) {
          this.repo.saveCharacter({ ...char, favorite });
          updatedCount++;
        }
      }
    }
    return { updatedCount };
  }

  private collectAll(): LibraryMediaItem[] {
    const images = this.repo.listImages({}).map((image) => this.mapImage(image));
    const videos = this.repo.listVideos(500).map((video) => this.mapVideo(video));

    const pixelCharacters = new Map(
      this.repo.pixel.listCharacters().map((character) => [character.id, character.name])
    );
    const pixelAssets = this.repo.pixel.listAssets();
    const pixels: LibraryPixelItem[] = [];
    const animations: LibraryAnimationItem[] = [];
    for (const asset of pixelAssets) {
      const characterName = asset.characterId
        ? pixelCharacters.get(asset.characterId) ?? null
        : null;
      const recipe = parseRecipe(asset.recipeJson);
      const previewAvailable = Boolean(asset.previewPath) && fs.existsSync(asset.previewPath);

      pixels.push({
        id: `pixel:${asset.id}`,
        mediaType: "pixel",
        sourceId: asset.id,
        title: asset.name,
        description: asset.prompt,
        thumbnailPath: previewAvailable ? asset.previewPath : null,
        mediaPath: previewAvailable ? asset.previewPath : null,
        width: asset.width,
        height: asset.height,
        model: null,
        workflowId: null,
        tags: [],
        favorite: false,
        favoriteSupported: false,
        collectionId: null,
        createdAt: asset.createdAt,
        updatedAt: asset.updatedAt,
        available: previewAvailable,
        workspace: "pixel",
        pixel: asset,
        pixelKind: asset.kind,
        characterId: asset.characterId,
        characterName,
        direction: null,
        version: asset.version,
        frameCount: asset.frameCount,
        animations: summarizeAnimations(recipe),
      });

      if (!recipe) continue;
      const frameDurations = new Map(
        recipe.frames.map((frame) => [frame.name, frame.duration] as const)
      );
      for (const [name, animation] of Object.entries(recipe.animations ?? {})) {
        if (!animation || !Array.isArray(animation.frames) || animation.frames.length === 0) {
          continue;
        }
        const durationMs = animation.frames.reduce(
          (total, frameName) => total + (frameDurations.get(frameName) ?? 0),
          0
        );
        animations.push({
          id: `animation:${asset.id}:${name}`,
          mediaType: "animation",
          sourceId: asset.id,
          title: `${asset.name} — ${name}`,
          description: asset.prompt,
          thumbnailPath: previewAvailable ? asset.previewPath : null,
          mediaPath: null,
          width: asset.width,
          height: asset.height,
          model: null,
          workflowId: null,
          tags: [],
          favorite: false,
          favoriteSupported: false,
          collectionId: null,
          createdAt: asset.createdAt,
          updatedAt: asset.updatedAt,
          available: previewAvailable,
          workspace: "pixel",
          pixel: asset,
          animationName: name,
          pixelKind: asset.kind,
          characterId: asset.characterId,
          characterName,
          frameCount: animation.frames.length,
          durationMs,
          loop: animation.loop !== false,
        });
      }
    }

    const characters: LibraryCharacterItem[] = this.repo.listCharacters().map((character) => {
      const thumbnail =
        character.references.find((reference) => reference.role === "primary") ??
        character.references[0] ??
        null;
      const available = Boolean(thumbnail?.filePath) && fs.existsSync(thumbnail!.filePath);
      return {
        id: `character:${character.id}`,
        mediaType: "character",
        sourceId: character.id,
        title: character.name,
        description: character.description,
        thumbnailPath: available ? thumbnail!.filePath : null,
        mediaPath: available ? thumbnail!.filePath : null,
        width: null,
        height: null,
        model: character.checkpointName,
        workflowId: null,
        tags: character.tags,
        favorite: character.favorite,
        favoriteSupported: true,
        collectionId: null,
        createdAt: character.createdAt,
        updatedAt: character.updatedAt,
        available,
        workspace: "characters",
        character,
        referenceCount: character.references.length,
        architecture: character.architecture,
      };
    });

    return [...images, ...videos, ...pixels, ...characters, ...animations];
  }

  private mapImage(image: GeneratedImageRecord): LibraryImageItem {
    const available = fs.existsSync(image.filePath);
    return {
      id: `image:${image.id}`,
      mediaType: "image",
      sourceId: image.id,
      title: summarizePrompt(image.prompt) || image.fileName,
      description: image.prompt,
      thumbnailPath: available ? image.filePath : null,
      mediaPath: available ? image.filePath : null,
      width: image.width,
      height: image.height,
      model: image.checkpoint,
      workflowId: image.workflowId,
      tags: image.tags,
      favorite: image.favorite,
      favoriteSupported: true,
      collectionId: image.collectionId,
      createdAt: image.createdAt,
      updatedAt: image.createdAt,
      available,
      workspace: "create",
      image,
    };
  }

  private mapVideo(video: GeneratedVideoRecord): LibraryVideoItem {
    const available = fs.existsSync(video.filePath);
    return {
      id: `video:${video.id}`,
      mediaType: "video",
      sourceId: video.id,
      title: summarizePrompt(video.prompt) || video.fileName,
      description: video.prompt,
      thumbnailPath: available ? video.filePath : null,
      mediaPath: available ? video.filePath : null,
      width: video.width,
      height: video.height,
      model: video.checkpoint,
      workflowId: video.workflowId,
      tags: video.tags,
      favorite: video.favorite,
      favoriteSupported: true,
      collectionId: null,
      createdAt: video.createdAt,
      updatedAt: video.createdAt,
      available,
      workspace: "video",
      video,
      durationSeconds: video.durationSeconds,
      fps: video.fps,
      frameCount: video.frameCount,
    };
  }

  private applyQuery(items: LibraryMediaItem[], query: UnifiedLibraryQuery): LibraryMediaItem[] {
    const search = query.search?.trim().toLowerCase();
    const collectionId = query.collectionId ?? null;
    const model = query.model?.trim().toLowerCase();
    const aspectRatio = query.aspectRatio;

    const result = items.filter((item) => {
      if (query.favoriteOnly && (!item.favoriteSupported || !item.favorite)) return false;
      if (collectionId && item.collectionId !== collectionId) return false;
      if (model && model !== "all") {
        if (!item.model || !item.model.toLowerCase().includes(model)) return false;
      }
      if (aspectRatio && aspectRatio !== "all") {
        if (!item.width || !item.height) return false;
        if (aspectRatio === "landscape" && item.width <= item.height) return false;
        if (aspectRatio === "portrait" && item.height <= item.width) return false;
        if (aspectRatio === "square" && item.width !== item.height) return false;
      }
      if (search && !matchesSearch(item, search)) return false;
      return true;
    });

    if (query.sortBy === "name") {
      result.sort((a, b) => a.title.localeCompare(b.title));
    } else if (query.sortBy === "oldest") {
      result.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    } else {
      result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    return result;
  }

  private countByType(items: LibraryMediaItem[]): Record<LibraryMediaFilter, number> {
    const counts = Object.fromEntries(
      LIBRARY_MEDIA_TYPES.map((type) => [type, 0])
    ) as Record<LibraryMediaFilter, number>;
    for (const item of items) {
      counts[item.mediaType] += 1;
      if (item.mediaType !== "animation") counts.all += 1;
    }
    return counts;
  }
}

function matchesSearch(item: LibraryMediaItem, search: string): boolean {
  const haystack: Array<string | null | undefined> = [
    item.title,
    item.description,
    item.model,
    "characterName" in item ? item.characterName : undefined,
    item.mediaType === "animation" ? item.animationName : undefined,
    ...item.tags,
  ];
  return haystack.some((value) => value?.toLowerCase().includes(search));
}

function summarizePrompt(prompt: string): string {
  const firstLine = prompt.trim().split(/\r?\n/)[0]?.trim() ?? "";
  return firstLine.length > 90 ? `${firstLine.slice(0, 87)}…` : firstLine;
}

function parseRecipe(recipeJson: string): PixelRecipe | null {
  if (!recipeJson) return null;
  try {
    const parsed = JSON.parse(recipeJson) as Partial<PixelRecipe>;
    if (!parsed || !Array.isArray(parsed.frames)) return null;
    return parsed as PixelRecipe;
  } catch {
    return null;
  }
}

function summarizeAnimations(recipe: PixelRecipe | null): LibraryPixelAnimationSummary[] {
  if (!recipe) return [];
  const frameDurations = new Map(recipe.frames.map((frame) => [frame.name, frame.duration] as const));
  return Object.entries(recipe.animations ?? {}).flatMap(([name, animation]) => {
    if (!animation || !Array.isArray(animation.frames) || animation.frames.length === 0) {
      return [];
    }
    return [
      {
        name,
        frameCount: animation.frames.length,
        durationMs: animation.frames.reduce(
          (total, frameName) => total + (frameDurations.get(frameName) ?? 0),
          0
        ),
        loop: animation.loop !== false,
      },
    ];
  });
}

function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim() || "asset";
}

function getUniqueDestinationPath(destDir: string, baseName: string): string {
  const ext = path.extname(baseName);
  const stem = path.basename(baseName, ext);
  let candidate = path.join(destDir, baseName);
  let counter = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(destDir, `${stem} (${counter})${ext}`);
    counter++;
  }
  return candidate;
}

export type { LibraryMediaType };
