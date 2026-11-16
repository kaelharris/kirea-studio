import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComfyRuntimeManager } from "../../src/main/comfy/runtime-manager";
import { StudioDatabase } from "../../src/main/db/database";
import { StudioRepository } from "../../src/main/db/repositories";
import { StudioLogger } from "../../src/main/logger";
import type { StudioPaths } from "../../src/main/paths";
import { PixelService } from "../../src/main/pixel/pixel-service";
import type {
  PixelAssetDetail,
  PixelAssetRecord,
  PixelFrameInput,
} from "../../src/shared/pixel-types";

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
    pixelAiTempDir: path.join(root, "pixel-ai-temp"),
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
  const reopen = (): PixelService => {
    db.close();
    const reopened = new StudioDatabase(paths.dbPath);
    databases.push(reopened);
    return new PixelService(paths, new StudioRepository(reopened), runtime, logger);
  };
  return { root, paths, db, repo, service, reopen };
}

function framePaths(paths: StudioPaths, assetId: string, version: number): string {
  return path.join(paths.pixelAssetsDir, assetId, "versions", String(version));
}

async function solidFrame(
  detail: PixelAssetDetail,
  frame: PixelFrameInput,
  color: string
): Promise<PixelFrameInput> {
  const png = await sharp({
    create: {
      width: detail.width,
      height: detail.height,
      channels: 4,
      background: color,
    },
  })
    .png()
    .toBuffer();
  return { ...frame, dataUrl: `data:image/png;base64,${png.toString("base64")}` };
}

async function framePixels(
  dataUrl: string
): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(Buffer.from(dataUrl.split(",")[1]!, "base64"))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function withIndexes(frames: PixelAssetDetail["frames"]): PixelFrameInput[] {
  return frames.map((frame, index) => ({
    id: frame.id,
    index,
    name: frame.name,
    durationMs: frame.durationMs,
    dataUrl: frame.dataUrl,
  }));
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

    expect(detail.frameCount).toBe(20);
    expect(detail.frames).toHaveLength(20);
    expect(detail.frames[0]!.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect(detail.previewDataUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect(Object.keys(detail.animations)).toEqual([
      "idle",
      "walk",
      "run",
      "attack",
      "jump",
      "hurt",
      "death",
    ]);
    expect(detail.animations.walk!.frames).toEqual([2, 3, 4, 5]);
    expect(detail.animations.attack!.frames).toEqual([6, 7]);
    expect(detail.animations.run!.frames).toEqual([8, 9, 10, 11]);
    expect(detail.animations.jump!.loop).toBe(false);
    expect(detail.animations.death!.frames).toEqual([17, 18, 19]);
    for (const frame of detail.frames) {
      expect(
        fs.existsSync(
          path.join(
            framePaths(paths, detail.id, 1),
            `frame_${String(frame.index).padStart(3, "0")}.png`
          )
        )
      ).toBe(true);
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

  it("keeps frame ids and artwork stable through reorder, rename, duplicate, delete, and reload", async () => {
    const harness = makeHarness();
    const { paths, service } = harness;
    const project = service.listProjects()[0]!;
    const detail = await service.generateAsset({
      projectId: project.id,
      kind: "character",
      name: "Frame Identity",
      width: 32,
      height: 32,
      paletteId: "kirea",
      seed: 21,
      direction: "front",
    });
    const original = new Map(detail.frames.map((frame) => [frame.id, frame.dataUrl]));
    const walkIds = detail.animations.walk!.frames.map((index) => detail.frames[index]!.id);
    expect(new Set(original.keys()).size).toBe(detail.frames.length);

    const order = [2, 0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
    const reordered = order.map((sourceIndex, index) => ({
      ...withIndexes(detail.frames)[sourceIndex]!,
      index,
    }));
    const v2 = await service.saveFrames(detail.id, reordered);
    expect(v2.version).toBe(2);
    for (const frame of v2.frames) expect(frame.dataUrl).toBe(original.get(frame.id));
    expect(v2.animations.walk!.frames.map((index) => v2.frames[index]!.id)).toEqual(walkIds);

    const renamedId = walkIds[1]!;
    const renamed = withIndexes(v2.frames).map((frame) =>
      frame.id === renamedId ? { ...frame, name: "Walk_Renamed" } : frame
    );
    const v3 = await service.saveFrames(detail.id, renamed);
    expect(v3.frames.find((frame) => frame.id === renamedId)!.name).toBe("Walk_Renamed");
    expect(v3.animations.walk!.frames.map((index) => v3.frames[index]!.id)).toEqual(walkIds);

    const duplicateSource = withIndexes(v3.frames)[0]!;
    const duplicateId = randomUUID();
    const duplicated = [
      ...withIndexes(v3.frames),
      {
        ...duplicateSource,
        id: duplicateId,
        index: v3.frames.length,
        name: `${duplicateSource.name}_copy`,
      },
    ];
    const v4 = await service.saveFrames(detail.id, duplicated);
    expect(v4.frames).toHaveLength(v3.frames.length + 1);
    expect(v4.frames.filter((frame) => frame.id === duplicateId)).toHaveLength(1);
    expect(v4.animations.walk!.frames.map((index) => v4.frames[index]!.id)).toEqual(walkIds);

    const deletedId = v4.frames[0]!.id;
    const remaining = withIndexes(v4.frames).filter((frame) => frame.id !== deletedId);
    const v5 = await service.saveFrames(detail.id, remaining);
    expect(v5.frames.some((frame) => frame.id === deletedId)).toBe(false);
    expect(v5.frames).toHaveLength(v4.frames.length - 1);
    for (const frame of v5.frames) {
      expect(frame.dataUrl).toBe(original.get(frame.id) ?? v4.frames.find((entry) => entry.id === frame.id)!.dataUrl);
    }

    const reopened = harness.reopen();
    const reloaded = await reopened.getAsset(detail.id);
    expect(reloaded.frames.map((frame) => frame.id)).toEqual(v5.frames.map((frame) => frame.id));
    expect(reloaded.frames.map((frame) => frame.dataUrl)).toEqual(
      v5.frames.map((frame) => frame.dataUrl)
    );
    expect(fs.existsSync(framePaths(paths, detail.id, 5))).toBe(true);
  });

  it("edits animation clips without touching frame artwork or version folders", async () => {
    const harness = makeHarness();
    const { paths, service } = harness;
    const project = service.listProjects()[0]!;
    const detail = await service.generateAsset({
      projectId: project.id,
      kind: "character",
      name: "Clip Smith",
      width: 32,
      height: 32,
      paletteId: "kirea",
      seed: 19,
      direction: "front",
    });
    const originalArtwork = detail.frames.map((frame) => frame.dataUrl);

    const saved = await service.saveAnimations(detail.id, [
      { name: "walk", frames: ["walk_1", "walk_2", "walk_3", "walk_4"], loop: false },
      { name: "custom", frames: ["idle_1", "walk_1", "walk_1"], loop: true },
    ]);
    expect(saved.version).toBe(2);
    expect(Object.keys(saved.animations)).toEqual(["walk", "custom"]);
    expect(saved.animations.walk!.frames).toEqual([2, 3, 4, 5]);
    expect(saved.animations.walk!.loop).toBe(false);
    expect(saved.animations.custom!.frames).toEqual([0, 2]);
    expect(saved.animations.custom!.loop).toBe(true);
    expect(saved.animations.custom!.duration).toBe(
      detail.frames[0]!.durationMs + detail.frames[2]!.durationMs
    );
    expect(saved.frames.map((frame) => frame.dataUrl)).toEqual(originalArtwork);
    expect(fs.existsSync(framePaths(paths, detail.id, 2))).toBe(false);

    const gif = await service.exportAsset(detail.id, "gif", { animation: "custom" });
    expect(gif.frameCount).toBe(2);

    await expect(
      service.saveAnimations(detail.id, [
        { name: "broken", frames: ["missing_frame"], loop: true },
      ])
    ).rejects.toThrow("missing frame");
    await expect(
      service.saveAnimations(detail.id, [
        { name: "walk", frames: ["walk_1"], loop: true },
        { name: "WALK", frames: ["walk_2"], loop: true },
      ])
    ).rejects.toThrow("defined twice");
    await expect(service.saveAnimations(detail.id, [])).rejects.toThrow(
      "At least one animation clip"
    );
    expect((await service.getAsset(detail.id)).version).toBe(2);

    const reopened = harness.reopen();
    const reloaded = await reopened.getAsset(detail.id);
    expect(reloaded.version).toBe(2);
    expect(Object.keys(reloaded.animations)).toEqual(["walk", "custom"]);
    expect(reloaded.animations.walk!.loop).toBe(false);
    expect(reloaded.animations.custom!.frames).toEqual([0, 2]);

    const withFrames = await reopened.saveFrames(detail.id, withIndexes(reloaded.frames));
    expect(withFrames.version).toBe(3);
    expect(withFrames.animations.custom!.frames).toEqual([0, 2]);
    expect(withFrames.animations.walk!.loop).toBe(false);
    expect(fs.existsSync(framePaths(paths, detail.id, 3))).toBe(true);
  });

  it("assigns fresh ids instead of reusing array positions when a payload omits them", async () => {
    const harness = makeHarness();
    const { service } = harness;
    const project = service.listProjects()[0]!;
    const detail = await service.generateAsset({
      projectId: project.id,
      kind: "item",
      name: "Legacy Payload",
      width: 16,
      height: 16,
      paletteId: "kirea",
      seed: 33,
    });
    const previousIds = new Set(detail.frames.map((frame) => frame.id));
    const legacyPayload = withIndexes(detail.frames).map((frame) => ({
      index: frame.index,
      name: frame.name,
      durationMs: frame.durationMs,
      dataUrl: frame.dataUrl,
    }));
    const saved = await service.saveFrames(detail.id, legacyPayload);
    expect(saved.frames.every((frame) => !previousIds.has(frame.id))).toBe(true);
    expect(new Set(saved.frames.map((frame) => frame.id)).size).toBe(saved.frames.length);
    const reusedNames = new Set(saved.frames.map((frame) => frame.name));
    for (const animation of Object.values(saved.animations)) {
      for (const index of animation.frames) expect(reusedNames.has(saved.frames[index]!.name)).toBe(true);
    }
  });

  it("gives every saved version an immutable preview across saves and restarts", async () => {
    const harness = makeHarness();
    const { paths, service } = harness;
    const project = service.listProjects()[0]!;
    const detail = await service.generateAsset({
      projectId: project.id,
      kind: "item",
      name: "Version Flask",
      width: 16,
      height: 16,
      paletteId: "kirea",
      seed: 4,
    });
    const v1Versions = await service.listVersions(detail.id);
    expect(v1Versions.map((entry) => entry.version)).toEqual([1]);
    const v1Preview = v1Versions[0]!.previewDataUrl;
    const v1File = path.join(framePaths(paths, detail.id, 1), "preview.png");
    expect(v1Preview).toBe(`data:image/png;base64,${fs.readFileSync(v1File).toString("base64")}`);

    const redFrame = await solidFrame(detail, withIndexes(detail.frames)[0]!, "#ff0000");
    await service.saveFrames(detail.id, [redFrame]);
    const v2Versions = await service.listVersions(detail.id);
    expect(v2Versions.map((entry) => entry.version)).toEqual([2, 1]);
    const v2Preview = v2Versions[0]!.previewDataUrl;
    expect(v2Preview).not.toBe(v1Preview);
    expect(v2Versions[1]!.previewDataUrl).toBe(v1Preview);

    const blueFrame = await solidFrame(detail, withIndexes(detail.frames)[0]!, "#0000ff");
    await service.saveFrames(detail.id, [blueFrame]);
    const v3Versions = await service.listVersions(detail.id);
    expect(v3Versions.map((entry) => entry.version)).toEqual([3, 2, 1]);
    expect(v3Versions[0]!.previewDataUrl).not.toBe(v2Preview);
    expect(v3Versions[1]!.previewDataUrl).toBe(v2Preview);
    expect(v3Versions[2]!.previewDataUrl).toBe(v1Preview);
    for (const version of [1, 2, 3]) {
      expect(fs.existsSync(path.join(framePaths(paths, detail.id, version), "preview.png"))).toBe(
        true
      );
    }
    const rows = harness.repo.pixel.listVersions(detail.id);
    expect(rows.map((row) => path.basename(path.dirname(row.previewPath)))).toEqual(["3", "2", "1"]);

    const reopened = harness.reopen();
    const afterRestart = await reopened.listVersions(detail.id);
    expect(afterRestart.map((entry) => entry.previewDataUrl)).toEqual(
      v3Versions.map((entry) => entry.previewDataUrl)
    );
  });

  it("retains the previous version when a staged file write fails", async () => {
    const harness = makeHarness();
    const { paths, service } = harness;
    const project = service.listProjects()[0]!;
    const detail = await service.generateAsset({
      projectId: project.id,
      kind: "effect",
      name: "Write Failure",
      width: 16,
      height: 16,
      paletteId: "neon",
      seed: 8,
    });
    const before = await service.getAsset(detail.id);
    const writeSpy = vi
      .spyOn(fsPromises, "writeFile")
      .mockRejectedValueOnce(new Error("disk full"));
    try {
      await expect(service.saveFrames(detail.id, withIndexes(before.frames))).rejects.toThrow(
        "disk full"
      );
    } finally {
      writeSpy.mockRestore();
    }
    const after = await service.getAsset(detail.id);
    expect(after.version).toBe(before.version);
    expect(after.frames.map((frame) => frame.dataUrl)).toEqual(
      before.frames.map((frame) => frame.dataUrl)
    );
    expect(fs.existsSync(framePaths(paths, detail.id, before.version + 1))).toBe(false);
    expect(
      fs.readdirSync(path.join(paths.pixelAssetsDir, detail.id)).filter((entry) =>
        entry.startsWith(".staging-")
      )
    ).toEqual([]);
  });

  it("retains previous files and removes the new version when the database commit fails", async () => {
    const harness = makeHarness();
    const { paths, service, repo } = harness;
    const project = service.listProjects()[0]!;
    const detail = await service.generateAsset({
      projectId: project.id,
      kind: "object",
      name: "Commit Failure",
      width: 16,
      height: 16,
      paletteId: "forest",
      seed: 9,
    });
    const before = await service.getAsset(detail.id);
    const previewPath = path.join(framePaths(paths, detail.id, before.version), "preview.png");
    const previewBytes = fs.readFileSync(previewPath);
    const commitSpy = vi.spyOn(repo.pixel, "replaceFrames").mockImplementationOnce(() => {
      throw new Error("database is locked");
    });
    try {
      await expect(service.saveFrames(detail.id, withIndexes(before.frames))).rejects.toThrow(
        "database is locked"
      );
    } finally {
      commitSpy.mockRestore();
    }
    const after = await service.getAsset(detail.id);
    expect(after.version).toBe(before.version);
    expect(fs.readFileSync(previewPath)).toEqual(previewBytes);
    expect(after.frames.map((frame) => frame.dataUrl)).toEqual(
      before.frames.map((frame) => frame.dataUrl)
    );
    expect(fs.existsSync(framePaths(paths, detail.id, before.version + 1))).toBe(false);
    expect(
      fs.readdirSync(path.join(paths.pixelAssetsDir, detail.id)).filter((entry) =>
        entry.startsWith(".staging-")
      )
    ).toEqual([]);

    const retried = await service.saveFrames(detail.id, withIndexes(after.frames));
    expect(retried.version).toBe(before.version + 1);
    expect(retried.frames.map((frame) => frame.dataUrl)).toEqual(
      before.frames.map((frame) => frame.dataUrl)
    );
  });

  it("links an imported generation to a parent asset and rejects a parent from another project", async () => {
    const { service } = makeHarness();
    const project = service.listProjects()[0]!;
    const identity = await service.generateAsset({
      projectId: project.id,
      kind: "character",
      name: "Identity",
      width: 16,
      height: 16,
      paletteId: "kirea",
      seed: 5,
    });
    const png = await sharp({
      create: {
        width: 16,
        height: 16,
        channels: 4,
        background: { r: 30, g: 60, b: 200, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const generation = {
      backend: "spritekiln" as const,
      backendVersion: "0.41.0",
      workflowId: "reference_to_pixel" as const,
      workflowFile: "03_reference_to_pixel_art.api.json",
      model: "flux-2-klein-4b.safetensors",
      prompt: "same character in a red cloak",
      negativePrompt: "",
      seed: 9,
      width: 16,
      height: 16,
      paletteId: "kirea",
      palette: ["#191920", "#4f7bfc", "#e8c9ae", "#d9c9a8", "#f2dc93"],
      style: "character (front, RPG)",
      timestamp: new Date(0).toISOString(),
      promptId: "prompt-9",
      reference: {
        subject: { source: "asset" as const, label: "Identity" },
        style: null,
      },
      settings: { referenceStrength: 0.7 },
      notes: [],
    };

    const variation = await service.importGeneratedPng({
      projectId: project.id,
      parentAssetId: identity.id,
      name: "Identity variation",
      kind: "character",
      prompt: "same character in a red cloak",
      seed: 9,
      paletteId: "kirea",
      png,
      width: 16,
      height: 16,
      generation,
    });
    expect(variation.parentAssetId).toBe(identity.id);
    expect(variation.generation).toEqual(generation);

    const otherProject = service.saveProject({ name: "Other" });
    await expect(
      service.importGeneratedPng({
        projectId: otherProject.id,
        parentAssetId: identity.id,
        name: "Cross-project variation",
        kind: "character",
        prompt: "same character",
        seed: 10,
        paletteId: "kirea",
        png,
        width: 16,
        height: 16,
        generation,
      })
    ).rejects.toThrow("Parent asset not found in this project.");
  });

  it("imports a generated PNG with AI metadata and keeps it across versions", async () => {
    const { paths, service } = makeHarness();
    const project = service.listProjects()[0]!;
    const png = await sharp({
      create: {
        width: 16,
        height: 16,
        channels: 4,
        background: { r: 20, g: 40, b: 220, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const generation = {
      backend: "spritekiln" as const,
      backendVersion: "0.41.0",
      workflowId: "text_to_pixel" as const,
      workflowFile: "01_text_to_pixel_art.api.json",
      model: "z_image_turbo.safetensors",
      prompt: "a blue slime",
      negativePrompt: "",
      seed: 77,
      width: 16,
      height: 16,
      paletteId: "kirea",
      palette: ["#191920", "#4f7bfc", "#e8c9ae", "#d9c9a8", "#f2dc93"],
      style: "game asset",
      timestamp: new Date(0).toISOString(),
      promptId: "prompt-77",
      reference: null,
      settings: { steps: 8, transparent: true },
      notes: ["Negative prompts are stored but not applied."],
    };

    const imported = await service.importGeneratedPng({
      projectId: project.id,
      name: "AI Slime",
      kind: "creature",
      prompt: "a blue slime",
      seed: 77,
      paletteId: "kirea",
      png,
      width: 16,
      height: 16,
      generation,
    });

    expect(imported.engine).toBe("comfyui");
    expect(imported.generation).toEqual(generation);
    expect(imported.frameCount).toBe(1);
    expect(imported.frames[0]?.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect(
      fs.existsSync(
        path.join(framePaths(paths, imported.id, 1), "generation.json")
      )
    ).toBe(true);

    const edited = await service.saveFrames(
      imported.id,
      withIndexes((await service.getAsset(imported.id)).frames)
    );
    expect(edited.version).toBe(2);
    expect(edited.generation).toEqual(generation);
    expect(
      fs.existsSync(path.join(framePaths(paths, imported.id, 2), "generation.json"))
    ).toBe(true);
  });

  it("round-trips palette and pixel edits through a saved version and restart (Workflow A)", async () => {
    const harness = makeHarness();
    const { service } = harness;
    const project = service.listProjects()[0]!;
    const detail = await service.generateAsset({
      projectId: project.id,
      kind: "character",
      name: "Workflow A",
      width: 16,
      height: 16,
      paletteId: "kirea",
      seed: 101,
      direction: "front",
    });
    const originalFirst = await framePixels(detail.frames[0]!.dataUrl);
    const next = withIndexes(detail.frames);
    const edited = await solidFrame(detail, next[0]!, "#ff00ff");
    next[0] = edited;
    const palette = [...detail.palette, "#FF00FF"];
    const v2 = await service.saveFrames(detail.id, next, undefined, { palette });

    expect(v2.version).toBe(2);
    expect(v2.palette).toEqual([...detail.palette, "#ff00ff"]);
    const editedPixels = await framePixels(edited.dataUrl);
    expect((await framePixels(v2.frames[0]!.dataUrl)).data.equals(editedPixels.data)).toBe(true);

    const version1 = await service.getAssetVersion(detail.id, 1);
    const version2 = await service.getAssetVersion(detail.id, 2);
    expect(version1.palette).toEqual(detail.palette);
    expect(version2.palette).toEqual([...detail.palette, "#ff00ff"]);
    expect((await framePixels(version1.frames[0]!.dataUrl)).data.equals(originalFirst.data)).toBe(
      true
    );
    expect((await framePixels(version2.frames[0]!.dataUrl)).data.equals(editedPixels.data)).toBe(
      true
    );

    const reopened = harness.reopen();
    const reloaded = await reopened.getAsset(detail.id);
    expect(reloaded.version).toBe(2);
    expect(reloaded.palette).toEqual([...detail.palette, "#ff00ff"]);
    expect((await reopened.listVersions(detail.id)).map((entry) => entry.version)).toEqual([2, 1]);
    expect((await reopened.getAssetVersion(detail.id, 1)).frames).toHaveLength(
      detail.frames.length
    );
  });

  it("edits one animation frame without changing other frames or clip membership (Workflow B)", async () => {
    const harness = makeHarness();
    const { service } = harness;
    const project = service.listProjects()[0]!;
    const detail = await service.generateAsset({
      projectId: project.id,
      kind: "character",
      name: "Workflow B",
      width: 16,
      height: 16,
      paletteId: "kirea",
      seed: 202,
      direction: "front",
    });
    const walkIndices = [...detail.animations.walk!.frames];
    const targetIndex = walkIndices[1]!;
    const targetFrame = detail.frames[targetIndex]!;
    const next = withIndexes(detail.frames);
    next[targetIndex] = await solidFrame(detail, next[targetIndex]!, "#00ff00");
    const v2 = await service.saveFrames(detail.id, next);

    expect(v2.animations.walk!.frames).toEqual(walkIndices);
    expect(v2.frames[targetIndex]!.id).toBe(targetFrame.id);
    const changedPixels = await framePixels(v2.frames[targetIndex]!.dataUrl);
    const changedReference = await framePixels(next[targetIndex]!.dataUrl);
    expect(changedPixels.data.equals(changedReference.data)).toBe(true);
    for (let index = 0; index < detail.frames.length; index += 1) {
      if (index === targetIndex) continue;
      const before = await framePixels(detail.frames[index]!.dataUrl);
      const after = await framePixels(v2.frames[index]!.dataUrl);
      expect(after.data.equals(before.data)).toBe(true);
      expect(v2.frames[index]!.dataUrl).toBe(detail.frames[index]!.dataUrl);
    }

    const reopened = harness.reopen();
    const reloaded = await reopened.getAsset(detail.id);
    expect(reloaded.animations.walk!.frames).toEqual(walkIndices);
    expect(reloaded.animations.walk!.duration).toBe(detail.animations.walk!.duration);
    expect((await reopened.getAssetVersion(detail.id, 1)).frames[targetIndex]!.dataUrl).toBe(
      detail.frames[targetIndex]!.dataUrl
    );
  });

  it("edits a directional asset without changing siblings or character lineage (Workflow C)", async () => {
    const harness = makeHarness();
    const { service } = harness;
    const project = service.listProjects()[0]!;
    const character = service.saveCharacter({
      projectId: project.id,
      name: "Direction Hero",
      seed: 303,
      paletteId: "kirea",
    });
    const front = await service.generateAsset({
      projectId: project.id,
      characterId: character.id,
      kind: "character",
      name: "Direction Hero front",
      width: 16,
      height: 16,
      paletteId: "kirea",
      seed: 303,
      direction: "front",
    });
    const back = await service.generateAsset({
      projectId: project.id,
      characterId: character.id,
      kind: "character",
      name: "Direction Hero back",
      width: 16,
      height: 16,
      paletteId: "kirea",
      seed: 303,
      direction: "back",
    });
    const backBefore = await service.getAsset(back.id);
    const next = withIndexes(front.frames).map((frame, index) =>
      index === 0 ? { ...frame } : frame
    );
    next[0] = await solidFrame(front, next[0]!, "#0000ff");
    const edited = await service.saveFrames(front.id, next);

    expect(edited.characterId).toBe(character.id);
    expect(edited.parentAssetId).toBeNull();
    const backAfter = await service.getAsset(back.id);
    expect(backAfter.version).toBe(1);
    expect(backAfter.updatedAt).toBe(backBefore.updatedAt);
    expect(backAfter.frames.map((frame) => frame.dataUrl)).toEqual(
      backBefore.frames.map((frame) => frame.dataUrl)
    );

    const reopened = harness.reopen();
    const reloadedFront = await reopened.getAsset(front.id);
    const reloadedBack = await reopened.getAsset(back.id);
    expect(reloadedFront.characterId).toBe(character.id);
    expect(reloadedBack.characterId).toBe(character.id);
    expect(reloadedBack.version).toBe(1);
  });

  it("restores an earlier version as a new version while keeping newer versions (Workflow D)", async () => {
    const harness = makeHarness();
    const { service } = harness;
    const project = service.listProjects()[0]!;
    const detail = await service.generateAsset({
      projectId: project.id,
      kind: "effect",
      name: "Workflow D",
      width: 16,
      height: 16,
      paletteId: "neon",
      seed: 404,
    });
    const originalFirst = await framePixels(detail.frames[0]!.dataUrl);

    const v2Frames = withIndexes(detail.frames);
    v2Frames.push(
      await solidFrame(
        detail,
        {
          index: v2Frames.length,
          name: "red_extra",
          durationMs: 90,
          dataUrl: detail.frames[0]!.dataUrl,
        },
        "#ff0000"
      )
    );
    const v2 = await service.saveFrames(detail.id, v2Frames);
    expect(v2.frames).toHaveLength(detail.frames.length + 1);

    const transparent = await sharp({
      create: { width: 8, height: 8, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const v3 = await service.saveFrames(
      detail.id,
      [
        {
          id: v2.frames[0]!.id,
          index: 0,
          name: "transparent",
          durationMs: 120,
          dataUrl: `data:image/png;base64,${transparent.toString("base64")}`,
        },
      ],
      { width: 8, height: 8 }
    );
    expect(v3.width).toBe(8);
    expect(v3.height).toBe(8);

    const restored = await service.restoreVersion(detail.id, 1);
    expect(restored.version).toBe(4);
    expect(restored.width).toBe(16);
    expect(restored.height).toBe(16);
    expect(restored.frames).toHaveLength(detail.frames.length);
    expect(restored.palette).toEqual(detail.palette);
    expect((await framePixels(restored.frames[0]!.dataUrl)).data.equals(originalFirst.data)).toBe(
      true
    );

    const versions = await service.listVersions(detail.id);
    expect(versions.map((entry) => entry.version)).toEqual([4, 3, 2, 1]);
    const version3 = await service.getAssetVersion(detail.id, 3);
    expect(version3.width).toBe(8);
    expect(version3.height).toBe(8);
    const transparentPixels = await framePixels(version3.frames[0]!.dataUrl);
    expect(transparentPixels.width).toBe(8);
    expect([...transparentPixels.data].filter((_, index) => index % 4 === 3).every((alpha) => alpha === 0)).toBe(
      true
    );

    const reopened = harness.reopen();
    expect((await reopened.listVersions(detail.id)).map((entry) => entry.version)).toEqual([
      4, 3, 2, 1,
    ]);
    expect((await reopened.getAssetVersion(detail.id, 2)).frames).toHaveLength(
      detail.frames.length + 1
    );
    expect((await reopened.getAsset(detail.id)).version).toBe(4);
  });

  it("saves palette-only changes as a version without rewriting frame files", async () => {
    const harness = makeHarness();
    const { paths, service } = harness;
    const project = service.listProjects()[0]!;
    const detail = await service.generateAsset({
      projectId: project.id,
      kind: "item",
      name: "Palette Only",
      width: 16,
      height: 16,
      paletteId: "kirea",
      seed: 505,
    });
    const beforePreview = detail.previewDataUrl;
    const nextPalette = detail.palette.map((color, index) =>
      index === detail.palette.length - 1 ? "#123456" : color
    );
    const saved = await service.saveAssetPalette(detail.id, nextPalette);
    expect(saved.version).toBe(2);
    expect(saved.palette).toEqual(nextPalette);
    expect(saved.previewDataUrl).toBe(beforePreview);
    expect(fs.existsSync(framePaths(paths, detail.id, 2))).toBe(false);
    const version = await service.getAssetVersion(detail.id, 2);
    expect(version.palette).toEqual(nextPalette);
    expect(version.frames.map((frame) => frame.dataUrl)).toEqual(
      detail.frames.map((frame) => frame.dataUrl)
    );

    const reopened = harness.reopen();
    expect((await reopened.getAsset(detail.id)).palette).toEqual(nextPalette);
  });

  it("stores reusable palettes in the library across restarts", async () => {
    const harness = makeHarness();
    const { service } = harness;
    const created = service.savePaletteLibraryEntry({
      name: "  Shared Accent  ",
      colors: ["#FF00FF", "#ff00ff", "#00ff00ff"],
    });
    expect(created.name).toBe("Shared Accent");
    expect(created.colors).toEqual(["#ff00ff", "#00ff00ff"]);
    expect(service.listPaletteLibrary().map((entry) => entry.id)).toContain(created.id);
    expect(() =>
      service.savePaletteLibraryEntry({ name: "Bad", colors: ["not-a-colour"] })
    ).toThrow("not a hex colour");
    expect(() => service.savePaletteLibraryEntry({ name: " ", colors: ["#000000"] })).toThrow(
      "needs a name"
    );

    const updated = service.savePaletteLibraryEntry({
      id: created.id,
      name: "Shared Accent v2",
      colors: ["#000000", "#ffffff"],
    });
    expect(updated.id).toBe(created.id);
    expect(updated.colors).toEqual(["#000000", "#ffffff"]);

    const reopened = harness.reopen();
    const reloaded = reopened.listPaletteLibrary();
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0]!.name).toBe("Shared Accent v2");
    expect(reopened.deletePaletteLibraryEntry(created.id)).toBe(true);
    expect(reopened.listPaletteLibrary()).toHaveLength(0);
  });

  it("keeps the previous version intact when a palette save fails", async () => {
    const { service, repo } = makeHarness();
    const project = service.listProjects()[0]!;
    const detail = await service.generateAsset({
      projectId: project.id,
      kind: "object",
      name: "Palette Failure",
      width: 16,
      height: 16,
      paletteId: "forest",
      seed: 606,
    });
    const updateSpy = vi.spyOn(repo.pixel, "updatePalette").mockImplementationOnce(() => {
      throw new Error("palette write failed");
    });
    try {
      await expect(service.saveAssetPalette(detail.id, ["#abcdef"])).rejects.toThrow(
        "palette write failed"
      );
    } finally {
      updateSpy.mockRestore();
    }
    const after = await service.getAsset(detail.id);
    expect(after.version).toBe(1);
    expect(after.palette).toEqual(detail.palette);
    expect((await service.listVersions(detail.id)).map((entry) => entry.version)).toEqual([1]);
  });
});
