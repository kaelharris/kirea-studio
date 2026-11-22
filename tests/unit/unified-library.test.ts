import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StudioDatabase } from "../../src/main/db/database";
import { StudioRepository } from "../../src/main/db/repositories";
import { UnifiedLibraryService } from "../../src/main/library/library-service";
import type { StudioPaths } from "../../src/main/paths";
import type {
  CharacterProfileInput,
  GeneratedImageRecord,
  GeneratedVideoRecord,
  GenerationJob,
  GenerationRequest,
} from "../../src/shared/types";
import type { PixelAssetInsert } from "../../src/main/db/repos/pixel-repo";
import type { PixelRecipe } from "../../src/shared/pixel-recipe";
import type {
  LibraryCharacterItem,
  LibraryImageItem,
  LibraryMediaItem,
  LibraryPixelItem,
  LibraryVideoItem,
} from "../../src/shared/library";

function asImage(item: LibraryMediaItem): LibraryImageItem {
  if (item.mediaType !== "image") throw new Error(`Expected image, got ${item.mediaType}`);
  return item;
}

function asVideo(item: LibraryMediaItem): LibraryVideoItem {
  if (item.mediaType !== "video") throw new Error(`Expected video, got ${item.mediaType}`);
  return item;
}

function asPixel(item: LibraryMediaItem): LibraryPixelItem {
  if (item.mediaType !== "pixel") throw new Error(`Expected pixel, got ${item.mediaType}`);
  return item;
}

function asCharacter(item: LibraryMediaItem): LibraryCharacterItem {
  if (item.mediaType !== "character") throw new Error(`Expected character, got ${item.mediaType}`);
  return item;
}

function mustFind(items: LibraryMediaItem[], id: string): LibraryMediaItem {
  const item = items.find((entry) => entry.id === id);
  if (!item) throw new Error(`Missing library item ${id}`);
  return item;
}

const tempDirs: string[] = [];
const openDbs: StudioDatabase[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-library-"));
  tempDirs.push(dir);
  return dir;
}

function makePaths(root: string): StudioPaths {
  return {
    userDataDir: root,
    dbPath: path.join(root, "kirea-studio.db"),
    logsDir: path.join(root, "logs"),
    cacheDir: path.join(root, "cache"),
    tempDir: path.join(root, "temp"),
    defaultOutputDir: path.join(root, "outputs"),
    defaultDownloadsDir: path.join(root, "downloads"),
    defaultManagedRuntimeDir: path.join(root, "runtime"),
    defaultManagedModelsDir: path.join(root, "models"),
    inputUploadCacheDir: path.join(root, "cache", "inputs"),
    modelPreviewCacheDir: path.join(root, "model-previews"),
    charactersDir: path.join(root, "characters"),
    pixelAssetsDir: path.join(root, "pixel-assets"),
    pixelExportsDir: path.join(root, "pixel-exports"),
    pixelAiTempDir: path.join(root, "temp", "pixel-ai"),
  };
}

afterEach(() => {
  while (openDbs.length > 0) {
    openDbs.pop()!.close();
  }
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

function makeJob(overrides: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id: "job-1",
    promptId: null,
    status: "COMPLETED",
    errorKind: "NONE",
    errorMessage: null,
    prompt: "prompt",
    negativePrompt: "",
    checkpoint: "model.safetensors",
    workflowId: "t2i_sdxl_base",
    workflowVersion: "1",
    mode: "txt2img",
    settings: {} as GenerationRequest,
    progressStep: 20,
    progressMax: 20,
    currentNode: null,
    previewDataUrl: null,
    outputPaths: [],
    submittedAt: "2026-11-10T10:00:00.000Z",
    startedAt: "2026-11-10T10:00:00.000Z",
    completedAt: "2026-11-10T10:01:00.000Z",
    batchIndex: 1,
    batchTotal: 1,
    ...overrides,
  };
}

const SPRITE_RECIPE: PixelRecipe = {
  version: 1,
  name: "pixie-idle",
  width: 32,
  height: 32,
  palette: { k: "#111111", b: "#4f7bfc" },
  frames: [
    { name: "idle_1", duration: 100 },
    { name: "idle_2", duration: 150 },
    { name: "walk_1", duration: 200 },
  ],
  animations: {
    idle: { frames: ["idle_1", "idle_2"] },
    walk: { frames: ["walk_1"], loop: false },
    empty: { frames: [] },
  },
};

interface Fixture {
  repo: StudioRepository;
  db: StudioDatabase;
  service: UnifiedLibraryService;
  root: string;
  ariaId: string;
  ghostId: string;
  ariaRefPath: string;
  pixelCharacterId: string;
  missingImagePath: string;
  missingPreviewPath: string;
}

function makeFixture(): Fixture {
  const root = makeTempDir();
  const db = new StudioDatabase(":memory:");
  openDbs.push(db);
  const repo = new StudioRepository(db);
  const service = new UnifiedLibraryService(repo, makePaths(root));

  repo.createCollection("col-fav", "Favorites");

  const imageOnePath = path.join(root, "aria.png");
  const missingImagePath = path.join(root, "missing.png");
  const videoPath = path.join(root, "aria-walk.mp4");
  const previewPath = path.join(root, "pixie-preview.png");
  const missingPreviewPath = path.join(root, "missing-preview.png");
  const ariaRefPath = path.join(root, "aria-ref.png");
  const missingRefPath = path.join(root, "ghost-ref.png");
  for (const file of [imageOnePath, videoPath, previewPath, ariaRefPath]) {
    fs.writeFileSync(file, "fixture");
  }

  const imageOne: GeneratedImageRecord = {
    id: "img-1",
    jobId: "job-img-1",
    filePath: imageOnePath,
    fileName: "aria.png",
    format: "png",
    width: 1024,
    height: 1024,
    sizeBytes: 100,
    prompt: "Aria portrait with silver hair",
    negativePrompt: "blurry",
    seed: 1,
    checkpoint: "novaXL",
    loras: [],
    workflowId: "t2i_sdxl_base",
    sampler: "euler",
    scheduler: "normal",
    steps: 28,
    cfg: 6,
    denoise: 1,
    mode: "txt2img",
    favorite: true,
    tags: ["anime"],
    collectionId: "col-fav",
    createdAt: "2026-11-10T10:00:00.000Z",
  };
  const imageTwo: GeneratedImageRecord = {
    ...imageOne,
    id: "img-2",
    jobId: "job-img-2",
    filePath: missingImagePath,
    fileName: "landscape.png",
    prompt: "landscape study",
    checkpoint: "flux-dev",
    favorite: false,
    tags: [],
    collectionId: null,
    createdAt: "2026-11-12T10:00:00.000Z",
  };
  const video: GeneratedVideoRecord = {
    id: "vid-1",
    jobId: "job-vid-1",
    filePath: videoPath,
    fileName: "aria-walk.mp4",
    container: "mp4",
    width: 832,
    height: 480,
    sizeBytes: 2048,
    durationSeconds: 4.5,
    fps: 24,
    frameCount: 108,
    prompt: "Aria walk cycle",
    negativePrompt: "",
    seed: 7,
    checkpoint: "wan-video",
    loras: [],
    workflowId: "t2v_wan_base",
    sampler: "euler",
    scheduler: "normal",
    steps: 20,
    cfg: 5,
    denoise: 1,
    mode: "t2v",
    favorite: true,
    tags: ["animation"],
    createdAt: "2026-11-13T10:00:00.000Z",
  };

  repo.recordCompletedGenerationTx(makeJob({ id: "job-img-1" }), [imageOne], null);
  repo.recordCompletedGenerationTx(
    makeJob({ id: "job-img-2", submittedAt: "2026-11-12T10:00:00.000Z" }),
    [imageTwo],
    null
  );
  repo.recordCompletedVideoTx(makeJob({ id: "job-vid-1", mode: "t2v" }), [video], null);

  const project = repo.pixel.saveProject({ id: "pixel-project", name: "Pixel Demo" });
  const pixelCharacter = repo.pixel.saveCharacter({
    id: "pixel-char-1",
    projectId: project.id,
    name: "Pixie",
  });
  repo.pixel.insertAsset(
    {
      id: "asset-1",
      projectId: project.id,
      characterId: pixelCharacter.id,
      name: "Pixie idle",
      kind: "character",
      engine: "pixelbolt",
      width: 32,
      height: 32,
      prompt: "tiny knight",
      seed: 3,
      paletteId: "kirea",
      palette: ["#111111", "#4f7bfc"],
      recipeJson: JSON.stringify(SPRITE_RECIPE),
      previewPath,
      sheetPath: null,
      parentAssetId: null,
    } satisfies PixelAssetInsert,
    []
  );
  repo.pixel.insertAsset(
    {
      id: "asset-2",
      projectId: project.id,
      characterId: null,
      name: "Orphan item",
      kind: "item",
      engine: "imported",
      width: 16,
      height: 16,
      prompt: "missing preview",
      seed: null,
      paletteId: "kirea",
      palette: [],
      recipeJson: "",
      previewPath: missingPreviewPath,
      sheetPath: null,
      parentAssetId: null,
    } satisfies PixelAssetInsert,
    []
  );

  const characterInput = (
    overrides: Partial<CharacterProfileInput> = {}
  ): CharacterProfileInput => ({
    name: "Aria",
    description: "Protagonist of the demo",
    appearance: "silver hair",
    clothing: "black coat",
    promptPrefix: "kirea_aria",
    negativePrompt: "",
    triggerWords: [],
    architecture: "sdxl",
    referenceMode: "none",
    referenceWeight: 0.5,
    tags: ["hero"],
    favorite: true,
    ...overrides,
  });

  const aria = repo.saveCharacter(characterInput());
  repo.addCharacterReference({
    characterId: aria.id,
    filePath: ariaRefPath,
    role: "primary",
  });
  const ghost = repo.saveCharacter(
    characterInput({ name: "Ghost", description: "", tags: [], favorite: false })
  );
  repo.addCharacterReference({
    characterId: ghost.id,
    filePath: missingRefPath,
    role: "secondary",
  });

  return {
    repo,
    db,
    service,
    root,
    ariaId: aria.id,
    ghostId: ghost.id,
    ariaRefPath,
    pixelCharacterId: pixelCharacter.id,
    missingImagePath,
    missingPreviewPath,
  };
}

describe("Unified library aggregation", () => {
  it("returns stable, namespaced IDs and excludes derived animations from All", () => {
    const { service, ariaId, ghostId } = makeFixture();
    const result = service.list();

    const ids = result.items.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      expect.arrayContaining([
        "image:img-1",
        "image:img-2",
        "video:vid-1",
        "pixel:asset-1",
        "pixel:asset-2",
        `character:${ariaId}`,
        `character:${ghostId}`,
      ])
    );
    expect(result.items.some((item) => item.mediaType === "animation")).toBe(false);
    expect(result.items).toHaveLength(7);
    expect(result.counts).toEqual({
      all: 7,
      image: 2,
      video: 1,
      pixel: 2,
      character: 2,
      animation: 2,
    });
  });

  it("filters each media type without leaking others", () => {
    const { service } = makeFixture();

    const images = service.list({ mediaType: "image" });
    expect(images.items.map((item) => item.id)).toEqual(["image:img-2", "image:img-1"]);

    const videos = service.list({ mediaType: "video" });
    expect(videos.items).toHaveLength(1);
    const video = videos.items[0]!;
    expect(video.mediaType).toBe("video");
    if (video.mediaType === "video") {
      expect(video.durationSeconds).toBe(4.5);
      expect(video.fps).toBe(24);
      expect(video.frameCount).toBe(108);
      expect(video.video.workflowId).toBe("t2v_wan_base");
    }

    const pixels = service.list({ mediaType: "pixel" });
    expect(pixels.items).toHaveLength(2);
    const pixel = asPixel(mustFind(pixels.items, "pixel:asset-1"));
    expect(pixel.pixelKind).toBe("character");
    expect(pixel.characterName).toBe("Pixie");
    expect(pixel.direction).toBeNull();
    expect(pixel.version).toBe(1);
    expect(pixel.animations).toEqual([
      { name: "idle", frameCount: 2, durationMs: 250, loop: true },
      { name: "walk", frameCount: 1, durationMs: 200, loop: false },
    ]);

    const characters = service.list({ mediaType: "character" });
    expect(characters.items).toHaveLength(2);
    const aria = asCharacter(characters.items.find((item) => item.title === "Aria")!);
    expect(aria.workspace).toBe("characters");
    expect(aria.referenceCount).toBe(1);
    expect(aria.architecture).toBe("sdxl");
    expect(aria.favorite).toBe(true);
    expect(aria.favoriteSupported).toBe(true);
  });

  it("derives animations from pixels with durations and loop flags", () => {
    const { service, pixelCharacterId } = makeFixture();
    const result = service.list({ mediaType: "animation" });

    expect(result.items).toHaveLength(2);
    expect(result.items.map((item) => item.id).sort()).toEqual([
      "animation:asset-1:idle",
      "animation:asset-1:walk",
    ]);
    const idle = result.items.find((item) => item.mediaType === "animation" && item.animationName === "idle")!;
    if (idle.mediaType === "animation") {
      expect(idle.title).toBe("Pixie idle — idle");
      expect(idle.sourceId).toBe("asset-1");
      expect(idle.frameCount).toBe(2);
      expect(idle.durationMs).toBe(250);
      expect(idle.loop).toBe(true);
      expect(idle.characterId).toBe(pixelCharacterId);
      expect(idle.characterName).toBe("Pixie");
      expect(idle.workspace).toBe("pixel");
    }
    expect(
      result.items.find((item) => item.mediaType === "animation" && item.animationName === "walk")
    ).toMatchObject({ frameCount: 1, durationMs: 200, loop: false });
  });

  it("searches prompts, models, tags, character names, and animation names", () => {
    const { service, ariaId } = makeFixture();

    const aria = service.list({ search: " ARIA " });
    expect(aria.items.map((item) => item.id).sort()).toEqual(
      [`character:${ariaId}`, "image:img-1", "video:vid-1"].sort()
    );
    expect(aria.counts).toMatchObject({ all: 3, image: 1, video: 1, character: 1, pixel: 0, animation: 0 });

    const idle = service.list({ search: "idle" });
    expect(idle.counts).toMatchObject({ all: 1, pixel: 1, animation: 2 });

    const byTag = service.list({ search: "TINY KNIGHT" });
    expect(byTag.counts).toMatchObject({ all: 1, pixel: 1, animation: 2 });

    const byModel = service.list({ search: "wan-video" });
    expect(byModel.items.map((item) => item.id)).toEqual(["video:vid-1"]);

    const animationNames = service.list({ mediaType: "animation", search: "walk" });
    expect(animationNames.items.map((item) => item.id)).toEqual(["animation:asset-1:walk"]);
  });

  it("applies favorites only to media types that support them", () => {
    const { service, ariaId } = makeFixture();
    const result = service.list({ favoriteOnly: true });

    expect(result.items.map((item) => item.id).sort()).toEqual(
      [`character:${ariaId}`, "image:img-1", "video:vid-1"].sort()
    );
    expect(result.counts).toMatchObject({
      all: 3,
      image: 1,
      video: 1,
      character: 1,
      pixel: 0,
      animation: 0,
    });
    expect(result.items.every((item) => item.favoriteSupported && item.favorite)).toBe(true);
  });

  it("filters collections and sorts by date or name", () => {
    const { service } = makeFixture();

    const collection = service.list({ collectionId: "col-fav" });
    expect(collection.items.map((item) => item.id)).toEqual(["image:img-1"]);
    expect(collection.counts).toMatchObject({ all: 1, image: 1, video: 0 });

    const oldest = service.list({ mediaType: "image", sortBy: "oldest" });
    expect(oldest.items.map((item) => item.id)).toEqual(["image:img-1", "image:img-2"]);

    const newest = service.list({ mediaType: "image", sortBy: "newest" });
    expect(newest.items.map((item) => item.id)).toEqual(["image:img-2", "image:img-1"]);

    const byName = service.list({ mediaType: "image", sortBy: "name" });
    expect(byName.items.map((item) => item.id)).toEqual(["image:img-1", "image:img-2"]);

    const all = service.list();
    const dates = all.items.map((item) => item.createdAt);
    expect([...dates].sort((a, b) => b.localeCompare(a))).toEqual(dates);
  });

  it("marks missing files unavailable without dropping rows", () => {
    const { service, missingImagePath, missingPreviewPath, ariaRefPath } = makeFixture();
    const result = service.list();

    const missingImage = asImage(mustFind(result.items, "image:img-2"));
    expect(missingImage.available).toBe(false);
    expect(missingImage.thumbnailPath).toBeNull();
    expect(missingImage.mediaPath).toBeNull();
    expect(missingImage.image.filePath).toBe(missingImagePath);

    const presentImage = asImage(mustFind(result.items, "image:img-1"));
    expect(presentImage.available).toBe(true);
    expect(presentImage.thumbnailPath).toBe(presentImage.image.filePath);

    const missingPixel = asPixel(mustFind(result.items, "pixel:asset-2"));
    expect(missingPixel.available).toBe(false);
    expect(missingPixel.mediaPath).toBeNull();
    expect(missingPixel.pixel.previewPath).toBe(missingPreviewPath);

    const aria = asCharacter(result.items.find((item) => item.title === "Aria")!);
    expect(aria.available).toBe(true);
    expect(aria.thumbnailPath).toBe(ariaRefPath);

    const ghost = asCharacter(result.items.find((item) => item.title === "Ghost")!);
    expect(ghost.available).toBe(false);
    expect(ghost.thumbnailPath).toBeNull();
  });

  it("preserves workspace identity and original repository records", () => {
    const { service, repo } = makeFixture();
    const result = service.list();

    const image = asImage(mustFind(result.items, "image:img-1"));
    expect(image.workspace).toBe("create");
    expect(image.image).toEqual(repo.getImageById("img-1"));
    expect(image.model).toBe("novaXL");
    expect(image.workflowId).toBe("t2i_sdxl_base");
    expect(image.width).toBe(1024);

    const video = asVideo(mustFind(result.items, "video:vid-1"));
    expect(video.workspace).toBe("video");
    expect(video.video).toEqual(repo.getVideoById("vid-1"));

    const pixel = asPixel(mustFind(result.items, "pixel:asset-1"));
    expect(pixel.workspace).toBe("pixel");
    expect(pixel.pixel.id).toBe("asset-1");

    const character = asCharacter(
      result.items.find((item) => item.title === "Aria")!
    );
    expect(character.workspace).toBe("characters");
    expect(character.character.id).toBe(character.sourceId);
  });

  it("only reads from the existing repositories", () => {
    const { service, db } = makeFixture();
    const tables = [
      "generated_images",
      "generated_videos",
      "pixel_assets",
      "pixel_frames",
      "characters",
      "character_references",
    ];
    const snapshot = () =>
      Object.fromEntries(
        tables.map((table) => [
          table,
          (db.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n,
        ])
      );

    const before = snapshot();
    service.list();
    service.list({ mediaType: "animation" });
    service.list({ search: "aria", favoriteOnly: true });
    service.list({ collectionId: "col-fav", sortBy: "name" });
    expect(snapshot()).toEqual(before);
  });

  it("collects distinct models and filters by model and aspect ratio", () => {
    const { service } = makeFixture();
    const result = service.list();

    expect(result.models).toEqual(["flux-dev", "novaXL", "wan-video"]);

    const novaOnly = service.list({ model: "novaXL" });
    expect(novaOnly.items.map((i) => i.id)).toEqual(["image:img-1"]);

    const wanOnly = service.list({ model: "wan-video" });
    expect(wanOnly.items.map((i) => i.id)).toEqual(["video:vid-1"]);

    const landscape = service.list({ aspectRatio: "landscape" });
    expect(landscape.items.map((i) => i.id)).toEqual(["video:vid-1"]);

    const square = service.list({ aspectRatio: "square" });
    expect(square.items).toHaveLength(4);
    expect(new Set(square.items.map((i) => i.id))).toEqual(
      new Set(["pixel:asset-1", "pixel:asset-2", "image:img-2", "image:img-1"])
    );

    const portrait = service.list({ aspectRatio: "portrait" });
    expect(portrait.items).toHaveLength(0);
  });

  it("performs batch operations: batchDelete, batchExport, batchSetCollection, batchSetFavorite", async () => {
    const { service, repo, root } = makeFixture();

    await service.batchSetFavorite(["image:img-2", "pixel:asset-1"], true);
    const updatedImg2 = repo.getImageById("img-2");
    expect(updatedImg2?.favorite).toBe(true);

    service.batchSetCollection(["image:img-2"], "col-fav");
    const collectedImg2 = repo.getImageById("img-2");
    expect(collectedImg2?.collectionId).toBe("col-fav");

    const exportTargetDir = path.join(root, "batch-export-test");
    fs.mkdirSync(exportTargetDir, { recursive: true });
    const exportResult = await service.batchExport(["image:img-1", "video:vid-1"], exportTargetDir);
    expect(exportResult.exportedCount).toBe(2);
    expect(fs.existsSync(path.join(exportTargetDir, "aria.png"))).toBe(true);
    expect(fs.existsSync(path.join(exportTargetDir, "aria-walk.mp4"))).toBe(true);

    const deleteResult = await service.batchDelete(["image:img-1", "video:vid-1"], [root]);
    expect(deleteResult.deletedIds).toEqual(["image:img-1", "video:vid-1"]);
    expect(repo.getImageById("img-1")).toBeNull();
    expect(repo.getVideoById("vid-1")).toBeNull();
    expect(fs.existsSync(path.join(root, "aria.png"))).toBe(false);
    expect(fs.existsSync(path.join(root, "aria-walk.mp4"))).toBe(false);
  });
});
