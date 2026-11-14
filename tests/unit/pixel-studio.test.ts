import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import type { ComfyRuntimeManager } from "../../src/main/comfy/runtime-manager";
import { StudioDatabase } from "../../src/main/db/database";
import { StudioRepository } from "../../src/main/db/repositories";
import { StudioLogger } from "../../src/main/logger";
import type { StudioPaths } from "../../src/main/paths";
import { PixelService } from "../../src/main/pixel/pixel-service";

const tempDirs: string[] = [];
const databases: StudioDatabase[] = [];

function makeHarness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-pixel-"));
  tempDirs.push(root);
  const paths: StudioPaths = {
    userDataDir: root,
    dbPath: path.join(root, "studio.db"),
    logsDir: path.join(root, "logs"),
    cacheDir: path.join(root, "cache"),
    tempDir: path.join(root, "temp"),
    defaultOutputDir: path.join(root, "outputs"),
    defaultDownloadsDir: path.join(root, "downloads"),
    defaultManagedRuntimeDir: path.join(root, "runtime"),
    defaultManagedModelsDir: path.join(root, "models"),
    inputUploadCacheDir: path.join(root, "inputs"),
    modelPreviewCacheDir: path.join(root, "previews"),
    charactersDir: path.join(root, "characters"),
    pixelAssetsDir: path.join(root, "pixel-assets"),
    pixelExportsDir: path.join(root, "pixel-exports"),
  };
  for (const dir of Object.values(paths)) {
    if (typeof dir === "string" && path.extname(dir) === "") fs.mkdirSync(dir, { recursive: true });
  }
  const db = new StudioDatabase(paths.dbPath);
  databases.push(db);
  const repo = new StudioRepository(db);
  const logger = new StudioLogger(paths.logsDir);
  const runtime = {
    getApiClient: () => ({
      getAllObjectInfo: async () => {
        throw new Error("runtime offline");
      },
    }),
  } as unknown as ComfyRuntimeManager;
  const service = new PixelService(paths, repo, runtime, logger);
  return { root, paths, db, repo, service };
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("PixelService", () => {
  it("creates a default project, generates a real animated character, and persists frames", async () => {
    const { paths, service } = makeHarness();
    const projects = service.listProjects();
    expect(projects).toHaveLength(1);
    const project = projects[0]!;

    const detail = await service.generateAsset({
      projectId: project.id,
      kind: "character",
      name: "Rune Knight",
      width: 32,
      height: 32,
      paletteId: "kirea",
      seed: 42,
      direction: "front",
    });

    expect(detail.frameCount).toBe(8);
    expect(detail.frames).toHaveLength(8);
    expect(detail.frames[0]!.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect(detail.previewDataUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect(Object.keys(detail.animations)).toEqual(["idle", "walk", "attack"]);
    expect(detail.animations.walk!.frames).toEqual([2, 3, 4, 5]);
    for (const frame of detail.frames) {
      expect(fs.existsSync(path.join(paths.pixelAssetsDir, detail.id, `frame_${String(frame.index).padStart(3, "0")}.png`))).toBe(true);
    }
  });

  it("re-saves edited frames as a new version with real pixel data", async () => {
    const { service } = makeHarness();
    const project = service.listProjects()[0]!;
    const detail = await service.generateAsset({
      projectId: project.id,
      kind: "creature",
      name: "Moss Slime",
      width: 32,
      height: 32,
      paletteId: "forest",
      seed: 7,
    });
    const edited = await service.saveFrames(detail.id, detail.frames);
    expect(edited.version).toBe(2);
    expect(edited.frames).toHaveLength(detail.frames.length);
    const recipe = JSON.parse(edited.recipeJson) as {
      frames: Array<{ pixels?: Array<{ x: number; y: number; color: string }> }>;
    };
    expect(recipe.frames[0]!.pixels!.length).toBeGreaterThan(0);
    expect(detail.frames[0]!.dataUrl).toBe(edited.frames[0]!.dataUrl);
  });

  it("records a preview-bearing version row for every save", async () => {
    const { service } = makeHarness();
    const project = service.listProjects()[0]!;
    const detail = await service.generateAsset({
      projectId: project.id,
      kind: "item",
      name: "Ember Flask",
      width: 24,
      height: 24,
      paletteId: "kirea",
      seed: 5,
    });
    expect(await service.listVersions(detail.id)).toHaveLength(1);
    await service.saveFrames(detail.id, detail.frames);
    const versions = await service.listVersions(detail.id);
    expect(versions.map((entry) => entry.version)).toEqual([2, 1]);
    expect(versions[0]!.previewDataUrl.startsWith("data:image/png;base64,")).toBe(true);
    await expect(service.listVersions("missing")).rejects.toThrow("not found");
  });

  it("re-renders at a new size when a save changes dimensions", async () => {
    const { service } = makeHarness();
    const project = service.listProjects()[0]!;
    const detail = await service.generateAsset({
      projectId: project.id,
      kind: "object",
      name: "Stone Pillar",
      width: 16,
      height: 16,
      paletteId: "forest",
      seed: 3,
    });
    const scaled = await Promise.all(
      detail.frames.map(async (frame) => {
        const png = await sharp(Buffer.from(frame.dataUrl.split(",")[1]!, "base64"))
          .resize(32, 32, { kernel: "nearest" })
          .png()
          .toBuffer();
        return { ...frame, dataUrl: `data:image/png;base64,${png.toString("base64")}` };
      })
    );
    const resized = await service.saveFrames(detail.id, scaled, { width: 32, height: 32 });
    expect(resized.width).toBe(32);
    expect(resized.height).toBe(32);
    const recipe = JSON.parse(resized.recipeJson) as { width: number; height: number };
    expect(recipe.width).toBe(32);
    expect(recipe.height).toBe(32);
    await expect(service.saveFrames(detail.id, detail.frames, { width: 32, height: 32 })).rejects.toThrow(
      "expected 32×32"
    );
    await expect(service.saveFrames(detail.id, scaled, { width: 4, height: 32 })).rejects.toThrow(
      "between 8 and 256"
    );
  });

  it("exports sprite sheets, GIFs, and ZIP bundles with real files", async () => {
    const { service } = makeHarness();
    const project = service.listProjects()[0]!;
    const detail = await service.generateAsset({
      projectId: project.id,
      kind: "effect",
      name: "Spark Burst",
      width: 32,
      height: 32,
      paletteId: "neon",
      seed: 11,
    });
    const sheet = await service.exportAsset(detail.id, "sheet");
    expect(fs.statSync(sheet.filePath).size).toBeGreaterThan(100);
    const gif = await service.exportAsset(detail.id, "gif", { scale: 4 });
    expect(fs.statSync(gif.filePath).size).toBeGreaterThan(100);
    expect(gif.frameCount).toBe(6);
    const zip = await service.exportAsset(detail.id, "zip");
    expect(fs.statSync(zip.filePath).size).toBeGreaterThan(200);
    const phaser = await service.exportAsset(detail.id, "phaser");
    const atlas = JSON.parse(fs.readFileSync(phaser.filePath, "utf8")) as {
      frames: Record<string, unknown>;
      animations: Record<string, unknown>;
    };
    expect(Object.keys(atlas.frames)).toHaveLength(6);
    expect(Object.keys(atlas.animations)).toContain("burst");
  });
});
