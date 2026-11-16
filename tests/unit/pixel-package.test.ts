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
import {
  buildPackage,
  PackageCancelledError,
  type PackageBuildContext,
} from "../../src/main/pixel/export/package-builder";
import { verifyPackage } from "../../src/main/pixel/export/package-verify";
import { readPackage, writePackage } from "../../src/main/pixel/export/package-writer";
import { samePixels } from "../../src/main/pixel/export/sheet-packer";
import { loadPixelEngine, type PixelboltModule } from "../../src/main/pixel/pixel-engine";
import { PixelService } from "../../src/main/pixel/pixel-service";
import type {
  PixelPackagePlan,
  PixelPackageRequest,
  PixelPackageResult,
} from "../../src/shared/pixel-package-types";
import {
  DEFAULT_PACKAGE_OUTPUTS,
  DEFAULT_SHEET_LAYOUT,
  PIXEL_DIRECTIONS,
} from "../../src/shared/pixel-package-types";
import type { PixelAssetDetail, PixelFrameInput } from "../../src/shared/pixel-types";

const tempDirs: string[] = [];
const databases: StudioDatabase[] = [];

interface Harness {
  root: string;
  paths: StudioPaths;
  service: PixelService;
  repo: StudioRepository;
}

function makeHarness(): Harness {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-package-"));
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
  return { root, paths, service: new PixelService(paths, repo, runtime, logger), repo };
}

function frameDirectory(paths: StudioPaths, assetId: string, version: number): string {
  return path.join(paths.pixelAssetsDir, assetId, "versions", String(version));
}

function request(
  overrides: Partial<PixelPackageRequest> & Pick<PixelPackageRequest, "scope">
): PixelPackageRequest {
  return {
    preset: "generic",
    container: "zip",
    scale: 1,
    layout: { ...DEFAULT_SHEET_LAYOUT },
    outputs: { ...DEFAULT_PACKAGE_OUTPUTS },
    background: null,
    pivot: "bottom-center",
    pixelsPerUnit: 100,
    destination: null,
    ...overrides,
  };
}

interface SheetFrame {
  frame: { x: number; y: number; w: number; h: number };
  trimmed: boolean;
  spriteSourceSize: { x: number; y: number; w: number; h: number };
  sourceSize: { w: number; h: number };
  duration: number;
  pivot: { x: number; y: number };
  kirea: { frameId: string; index: number; name: string; slot: string; direction: string | null };
}

interface SheetJson {
  frames: Record<string, SheetFrame>;
  animations: Record<
    string,
    { frames: string[]; durations: number[]; loop: boolean; fps: number; direction: string | null }
  >;
  meta: {
    image: string;
    format: string;
    scale: string;
    size: { w: number; h: number };
    layout: { columns: number; rows: number; cell: { w: number; h: number } };
  };
}

interface ManifestAnimation {
  key: string;
  name: string;
  assetId: string;
  slot: string;
  direction: string | null;
  loop: boolean;
  fps: number;
  frameCount: number;
  totalDurationMs: number;
  frames: Array<{ frameId: string; sheetKey: string; durationMs: number }>;
  files: string[];
  preview: { gif?: string; apng?: string } | null;
  missingFrames: string[];
  synthesized: boolean;
}

interface ManifestAsset {
  id: string;
  key: string;
  slot: string;
  name: string;
  version: number;
  latestVersion: number;
  isLatest: boolean;
  direction: string | null;
  directionSource: string | null;
  canvas: { w: number; h: number };
  exported: { w: number; h: number };
  transparency: { mode: string; partialAlpha: boolean };
  still: string | null;
  recipe: string | null;
  generation: string | null;
  frames: Array<{
    id: string;
    idSource: string;
    index: number;
    name: string;
    durationMs: number;
    sheetKey: string;
  }>;
  looseFrames: string[];
}

interface Manifest {
  schema: string;
  schemaVersion: number;
  scope: string;
  preset: string;
  character: { id: string; name: string } | null;
  project: { id: string; name: string } | null;
  export: {
    scale: number;
    pivot: string;
    pixelsPerUnit: number;
    background: string | null;
    layout: Record<string, unknown>;
    filtering: string;
    transparency: { mode: string; partialAlpha: boolean };
    animationFilter: string | null;
  };
  assets: ManifestAsset[];
  animations: ManifestAnimation[];
  directions: Array<{
    direction: string;
    assetId: string;
    still: string | null;
    animations: string[];
    sheet: string | null;
  }>;
  sheets: Array<{
    path: string;
    json: string;
    kind: "combined" | "animation" | "direction";
    width: number;
    height: number;
    columns: number;
    rows: number;
    cell: { w: number; h: number };
    frames: number;
  }>;
  engines: {
    godot: { validated: string; resource: string; scene: string; animations: string[] } | null;
    unity:
      | {
          validated: string;
          spriteMeta: string;
          animations: string;
          clipsFolder: string;
          sprites: string[];
          clips: string[];
          pixelsPerUnit: number;
        }
      | null;
    phaser:
      | {
          validated: string;
          atlas: string;
          animations: string;
          textureKey: string;
          animationKeys: string[];
        }
      | null;
    combinedSheet: string | null;
  };
  issues: Array<{ code: string; message: string }>;
  files: Array<{ path: string; bytes: number; sha256: string }>;
}

function jsonOf<T>(entries: Map<string, Buffer>, file: string): T {
  const bytes = entries.get(file);
  if (!bytes) throw new Error(`${file} is missing from ${[...entries.keys()].join(", ")}`);
  return JSON.parse(bytes.toString("utf8")) as T;
}

async function openPackage(result: PixelPackageResult): Promise<Map<string, Buffer>> {
  return readPackage(result.filePath, result.container, result.plan.summary.root);
}

function manifestOf(entries: Map<string, Buffer>): Manifest {
  for (const name of ["project.json", "character.json", "asset.json"]) {
    if (entries.has(name)) return jsonOf<Manifest>(entries, name);
  }
  throw new Error(`No package manifest in ${[...entries.keys()].join(", ")}`);
}

function sheetOf(entries: Map<string, Buffer>, manifest: Manifest, kind = "combined"): SheetJson {
  const sheet = manifest.sheets.find((entry) => entry.kind === kind);
  if (!sheet) throw new Error(`No ${kind} sheet (${manifest.sheets.map((entry) => entry.kind).join(", ")})`);
  return jsonOf<SheetJson>(entries, sheet.json);
}

function overlapping(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function frameFileFor(manifest: Manifest, sheetKey: string): string {
  for (const animation of manifest.animations) {
    const index = animation.frames.findIndex((frame) => frame.sheetKey === sheetKey);
    if (index >= 0) return animation.files[index]!;
  }
  for (const asset of manifest.assets) {
    const index = asset.frames.findIndex((frame) => frame.sheetKey === sheetKey);
    if (index >= 0) {
      const loose = asset.looseFrames[index];
      if (loose) return loose;
    }
  }
  throw new Error(`No exported PNG found for sheet key ${sheetKey}`);
}

async function contextFor(harness: Harness, engine: PixelboltModule): Promise<PackageBuildContext> {
  return { paths: harness.paths, repo: harness.repo, engine, appVersion: "test" };
}

async function verifyExport(result: PixelPackageResult, engine: PixelboltModule): Promise<Map<string, Buffer>> {
  expect(result.verification.ok, result.verification.problems.join(" | ")).toBe(true);
  const entries = await openPackage(result);
  const second = verifyPackage(entries, { engine, root: result.plan.summary.root });
  expect(second.ok, second.problems.join(" | ")).toBe(true);
  const manifest = manifestOf(entries);
  for (const file of manifest.files) {
    const bytes = entries.get(file.path);
    expect(bytes, `${file.path} is missing from the package`).toBeTruthy();
    expect(bytes!.length).toBe(file.bytes);
  }
  expect(fs.existsSync(result.filePath)).toBe(true);
  expect(fs.statSync(result.filePath).size).toBeGreaterThan(200);
  return entries;
}

async function transparentFrames(detail: PixelAssetDetail): Promise<PixelFrameInput[]> {
  return Promise.all(
    detail.frames.map(async (frame, index) => {
      const png = await sharp({
        create: {
          width: detail.width,
          height: detail.height,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .composite([
          {
            input: {
              create: {
                width: 8,
                height: 8,
                channels: 4,
                background: { r: 200 - index * 10, g: 40 + index * 5, b: 90, alpha: 1 },
              },
            },
            left: 12,
            top: 18,
          },
        ])
        .png()
        .toBuffer();
      return {
        id: frame.id,
        index,
        name: frame.name,
        durationMs: frame.durationMs,
        dataUrl: `data:image/png;base64,${png.toString("base64")}`,
      };
    })
  );
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("game-ready pixel packages", () => {
  it("workflow A: exports one edited sprite with exact geometry and untouched sources", async () => {
    const harness = makeHarness();
    const { paths, service } = harness;
    const project = service.listProjects()[0]!;
    const detail = await service.generateAsset({
      projectId: project.id,
      kind: "character",
      name: "Ember Bloom",
      width: 32,
      height: 32,
      paletteId: "neon",
      seed: 14,
    });
    const sourceDir = frameDirectory(paths, detail.id, detail.version);
    const sourcePng = fs.readFileSync(path.join(sourceDir, "frame_000.png"));
    const sourceMtime = fs.statSync(path.join(sourceDir, "frame_000.png")).mtimeMs;

    const plan: PixelPackagePlan = await service.planPackage(
      request({ scope: "asset", assetId: detail.id })
    );
    expect(plan.blocked).toBe(false);
    expect(plan.summary.assets).toBe(1);
    expect(plan.summary.frames).toBe(detail.frames.length);
    expect(plan.summary.sheets).toBe(1);
    expect(plan.preview).not.toBeNull();
    expect(plan.files.some((file) => file.path === "asset.json")).toBe(true);

    const result = await service.exportPackage(request({ scope: "asset", assetId: detail.id }));
    const engine = await loadPixelEngine();
    const entries = await verifyExport(result, engine);
    const manifest = manifestOf(entries);

    expect(manifest.schema).toBe("kirea.pixel-package");
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.scope).toBe("asset");
    expect(manifest.preset).toBe("generic");
    expect(manifest.export.filtering).toBe("nearest-neighbour");
    const asset = manifest.assets[0]!;
    expect(asset.version).toBe(detail.version);
    expect(asset.isLatest).toBe(true);
    expect(asset.canvas).toEqual({ w: 32, h: 32 });
    expect(asset.exported).toEqual({ w: 32, h: 32 });
    expect(asset.transparency.mode).toBe("alpha");
    expect(asset.frames.map((frame) => frame.id)).toEqual(detail.frames.map((frame) => frame.id));
    expect(asset.frames.map((frame) => frame.durationMs)).toEqual(
      detail.frames.map((frame) => frame.durationMs)
    );
    expect(asset.recipe).toBe("metadata/recipes/ember-bloom.v1.json");

    const sheet = sheetOf(entries, manifest);
    expect(Object.keys(sheet.frames)).toHaveLength(detail.frames.length);
    expect(sheet.meta.image).toBe("ember-bloom.png");
    const decoded = engine.decodePNG(entries.get("spritesheets/ember-bloom.png")!);
    expect(decoded.width).toBe(sheet.meta.size.w);
    expect(decoded.height).toBe(sheet.meta.size.h);
    const rects = Object.entries(sheet.frames).map(([key, frame]) => {
      expect(frame.frame.w).toBe(32);
      expect(frame.frame.h).toBe(32);
      expect(frame.kirea.name).toBe(asset.frames.find((entry) => entry.sheetKey === key)!.name);
      return { key, rect: frame.frame };
    });
    for (let index = 0; index < rects.length; index++) {
      const rect = rects[index]!.rect;
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.w).toBeLessThanOrEqual(decoded.width);
      expect(rect.y + rect.h).toBeLessThanOrEqual(decoded.height);
      for (let other = index + 1; other < rects.length; other++) {
        expect(overlapping(rect, rects[other]!.rect)).toBe(false);
      }
    }
    const firstSheetKey = asset.frames[0]!.sheetKey;
    const firstFile = frameFileFor(manifest, firstSheetKey);
    const exportedFrame = engine.decodePNG(entries.get(firstFile)!);
    const sourceFrame = engine.decodePNG(sourcePng);
    expect(samePixels(exportedFrame, sourceFrame)).toBe(true);

    expect(fs.readFileSync(path.join(sourceDir, "frame_000.png")).equals(sourcePng)).toBe(true);
    expect(fs.statSync(path.join(sourceDir, "frame_000.png")).mtimeMs).toBe(sourceMtime);
    expect((await service.getAsset(detail.id)).version).toBe(detail.version);
  });

  it("keeps animation order, loop flags, timing and GIF/APNG previews", async () => {
    const harness = makeHarness();
    const { service } = harness;
    const project = service.listProjects()[0]!;
    const detail = await service.generateAsset({
      projectId: project.id,
      kind: "character",
      name: "Case Walker",
      width: 32,
      height: 32,
      paletteId: "kirea",
      seed: 33,
      direction: "front",
    });
    const result = await service.exportPackage(
      request({
        scope: "asset",
        assetId: detail.id,
        outputs: { ...DEFAULT_PACKAGE_OUTPUTS, gif: true, apng: true },
      })
    );
    const entries = await verifyExport(result, await loadPixelEngine());
    const manifest = manifestOf(entries);

    expect(manifest.animations.map((animation) => animation.name)).toEqual(
      Object.keys(detail.animations)
    );
    for (const animation of manifest.animations) {
      const recipe = detail.animations[animation.name]!;
      const expectedFrames = recipe.frames.map((index) => detail.frames[index]!);
      expect(animation.frames.map((frame) => frame.frameId)).toEqual(
        expectedFrames.map((frame) => frame.id)
      );
      expect(animation.frames.map((frame) => frame.durationMs)).toEqual(
        expectedFrames.map((frame) => frame.durationMs)
      );
      expect(animation.loop).toBe(recipe.loop);
      expect(animation.totalDurationMs).toBe(
        expectedFrames.reduce((sum, frame) => sum + frame.durationMs, 0)
      );
      const expectedFps = (expectedFrames.length * 1000) / animation.totalDurationMs;
      expect(animation.fps).toBeCloseTo(expectedFps, 2);
      expect(animation.preview?.gif).toBeTruthy();
      expect(animation.preview?.apng).toBeTruthy();
      expect(entries.get(animation.preview!.gif!)!.subarray(0, 3).toString("ascii")).toBe("GIF");
      expect(entries.get(animation.preview!.apng!)!.subarray(1, 4).toString("ascii")).toBe("PNG");
    }
    const walkManifest = manifest.animations.find((animation) => animation.name === "walk")!;
    const sheet = sheetOf(entries, manifest);
    const walk = sheet.animations.walk!;
    expect(walk.loop).toBe(true);
    expect(walk.frames).toEqual(walkManifest.frames.map((frame) => frame.sheetKey));
    expect(walk.durations).toEqual(walkManifest.frames.map((frame) => frame.durationMs));
    expect(sheet.animations.jump!.loop).toBe(false);
    expect(sheet.animations.death!.frames).toEqual(
      manifest.animations.find((animation) => animation.name === "death")!.frames.map(
        (frame) => frame.sheetKey
      )
    );
  });

  it("exports a single animation scope without the other clips", async () => {
    const harness = makeHarness();
    const { service } = harness;
    const project = service.listProjects()[0]!;
    const detail = await service.generateAsset({
      projectId: project.id,
      kind: "character",
      name: "Clip Picker",
      width: 32,
      height: 32,
      paletteId: "ember",
      seed: 8,
    });
    const result = await service.exportPackage(
      request({ scope: "animation", assetId: detail.id, animation: "walk" })
    );
    const entries = await verifyExport(result, await loadPixelEngine());
    const manifest = manifestOf(entries);
    expect(result.plan.summary.root).toBe("clip-picker-walk");
    expect(manifest.export.animationFilter).toBe("walk");
    expect(manifest.animations.map((animation) => animation.key)).toEqual(["walk"]);
    expect(manifest.assets[0]!.frames.map((frame) => frame.name)).toEqual([
      "walk_1",
      "walk_2",
      "walk_3",
      "walk_4",
    ]);
    expect(manifest.assets[0]!.looseFrames).toEqual([]);
    expect([...entries.keys()].filter((file) => file.startsWith("animations/"))).toEqual(
      [...entries.keys()].filter((file) => file.startsWith("animations/walk/"))
    );
    expect(sheetOf(entries, manifest).animations.walk).toBeTruthy();
  });

  it("workflow B: gives eight directions their own slots, folders and sheets", async () => {
    const harness = makeHarness();
    const { paths, service } = harness;
    const project = service.listProjects()[0]!;
    const character = service.saveCharacter({
      projectId: project.id,
      name: "Wayfinder",
      seed: 77,
      paletteId: "forest",
    });
    for (const code of ["S", "SE", "E", "NE", "N", "NW", "W", "SW"]) {
      const detail = await service.generateAsset({
        projectId: project.id,
        characterId: character.id,
        kind: "character",
        name: `Wayfinder ${code}`,
        width: 24,
        height: 24,
        paletteId: "forest",
        seed: 77,
      });
      fs.writeFileSync(
        path.join(frameDirectory(paths, detail.id, detail.version), "generation.json"),
        JSON.stringify({ backend: "spritekiln", settings: { direction: code } }, null, 2)
      );
    }

    const result = await service.exportPackage(
      request({
        scope: "character",
        characterId: character.id,
        outputs: { ...DEFAULT_PACKAGE_OUTPUTS, directionSheets: true },
      })
    );
    expect(result.plan.summary.root).toBe("wayfinder");
    const entries = await verifyExport(result, await loadPixelEngine());
    const manifest = jsonOf<Manifest>(entries, "character.json");

    expect(manifest.scope).toBe("character");
    expect(manifest.character?.id).toBe(character.id);
    expect(manifest.assets).toHaveLength(8);
    expect(manifest.directions.map((entry) => entry.direction)).toEqual([...PIXEL_DIRECTIONS]);
    for (const direction of PIXEL_DIRECTIONS) {
      const record = manifest.directions.find((entry) => entry.direction === direction)!;
      const asset = manifest.assets.find((entry) => entry.id === record.assetId)!;
      expect(record.still).toBe(`directions/${direction}/${asset.key}.png`);
      expect(asset.still).toBe(record.still);
      expect(entries.has(asset.still!)).toBe(true);
      expect(record.sheet).toBe(`spritesheets/directions/${direction}.png`);
      expect(entries.has(`spritesheets/directions/${direction}.png`)).toBe(true);
      const directionSheet = jsonOf<SheetJson>(entries, `spritesheets/directions/${direction}.json`);
      expect(Object.keys(directionSheet.frames).length).toBe(20);
      expect(record.animations).toContain(`idle_${direction}`);
    }
    for (const asset of manifest.assets) {
      expect(asset.directionSource).toBe("generation");
      expect(asset.slot).toBe(asset.direction);
      expect(asset.generation).toBe(`metadata/generation/${asset.key}.json`);
      expect(entries.has(asset.generation!)).toBe(true);
    }
    expect(manifest.animations.some((animation) => animation.key === "idle_south")).toBe(true);
    expect(manifest.animations.some((animation) => animation.key === "idle_south-west")).toBe(true);
    expect(entries.has("animations/idle/south/000_idle_1.png")).toBe(true);
    expect(entries.has("animations/idle/south-west/000_idle_1.png")).toBe(true);
  });

  it("preserves alpha, flattens backgrounds and scales by nearest neighbour", async () => {
    const harness = makeHarness();
    const { service } = harness;
    const project = service.listProjects()[0]!;
    const generated = await service.generateAsset({
      projectId: project.id,
      kind: "item",
      name: "Glass Token",
      width: 32,
      height: 32,
      paletteId: "mono",
      seed: 4,
    });
    const detail = await service.saveFrames(generated.id, await transparentFrames(generated));
    const engine = await loadPixelEngine();

    const transparent = await service.exportPackage(
      request({ scope: "asset", assetId: detail.id, scale: 2 })
    );
    const alphaEntries = await verifyExport(transparent, engine);
    const alphaManifest = manifestOf(alphaEntries);
    expect(alphaManifest.export.scale).toBe(2);
    expect(alphaManifest.export.transparency.mode).toBe("alpha");
    expect(alphaManifest.assets[0]!.canvas).toEqual({ w: 32, h: 32 });
    expect(alphaManifest.assets[0]!.exported).toEqual({ w: 64, h: 64 });
    const alphaSheet = sheetOf(alphaEntries, alphaManifest);
    const alphaImage = engine.decodePNG(
      alphaEntries.get(alphaManifest.sheets.find((sheet) => sheet.kind === "combined")!.path)!
    );
    expect(alphaImage.width).toBe(alphaSheet.meta.size.w);
    expect(alphaSheet.meta.scale).toBe("2");
    const firstRect = Object.values(alphaSheet.frames)[0]!.frame;
    expect(firstRect.w).toBe(64);
    expect(alphaImage.data[((firstRect.y + 1) * alphaImage.width + firstRect.x + 1) * 4 + 3]).toBe(0);
    const spriteX = firstRect.x + 32;
    const spriteY = firstRect.y + 44;
    expect(alphaImage.data[(spriteY * alphaImage.width + spriteX) * 4 + 3]).toBe(255);
    const pixel = (x: number, y: number): number[] => [
      ...alphaImage.data.subarray((y * alphaImage.width + x) * 4, (y * alphaImage.width + x) * 4 + 4),
    ];
    for (let y = 0; y < 6; y++) {
      for (let x = 0; x < 6; x++) {
        expect(pixel(x * 2 + 1, y * 2)).toEqual(pixel(x * 2, y * 2));
        expect(pixel(x * 2, y * 2 + 1)).toEqual(pixel(x * 2, y * 2));
        expect(pixel(x * 2 + 1, y * 2 + 1)).toEqual(pixel(x * 2, y * 2));
      }
    }

    const flattened = await service.exportPackage(
      request({ scope: "asset", assetId: detail.id, background: "#102030" })
    );
    const flatEntries = await verifyExport(flattened, engine);
    const flatManifest = manifestOf(flatEntries);
    expect(flatManifest.export.background).toBe("#102030");
    expect(flatManifest.export.transparency.mode).toBe("opaque");
    const flatSheet = sheetOf(flatEntries, flatManifest);
    const flatImage = engine.decodePNG(
      flatEntries.get(flatManifest.sheets.find((sheet) => sheet.kind === "combined")!.path)!
    );
    expect(flatImage.data[3]).toBe(255);
    expect([...flatImage.data.subarray(0, 4)]).toEqual([16, 32, 48, 255]);
    for (let alpha = 3; alpha < flatImage.data.length; alpha += 4) {
      expect(flatImage.data[alpha]).toBe(255);
    }
  });

  it("packs padding, spacing, extrude, trim and uniform cells inside the sheet", async () => {
    const harness = makeHarness();
    const { service } = harness;
    const project = service.listProjects()[0]!;
    const generated = await service.generateAsset({
      projectId: project.id,
      kind: "object",
      name: "Loose Crate",
      width: 32,
      height: 32,
      paletteId: "forest",
      seed: 9,
    });
    const detail = await service.saveFrames(generated.id, await transparentFrames(generated));
    const engine = await loadPixelEngine();
    const layout = {
      ...DEFAULT_SHEET_LAYOUT,
      columns: 4,
      padding: 2,
      spacing: 3,
      extrude: 1,
      trim: true,
      uniformFrames: true,
      maxSize: 4096,
    };
    const result = await service.exportPackage(
      request({ scope: "asset", assetId: detail.id, layout })
    );
    const entries = await verifyExport(result, engine);
    const manifest = manifestOf(entries);
    expect(manifest.export.layout).toMatchObject({
      columns: 4,
      padding: 2,
      spacing: 3,
      extrude: 1,
      trim: true,
      uniformFrames: true,
    });
    const sheet = sheetOf(entries, manifest);
    const combined = manifest.sheets.find((entry) => entry.kind === "combined")!;
    expect(combined.columns).toBe(4);
    expect(combined.cell.w).toBe(10);
    expect(combined.cell.h).toBe(10);
    expect(sheet.meta.layout.cell.w).toBe(10);
    const rects = Object.entries(sheet.frames).map(([key, frame]) => {
      expect(frame.trimmed).toBe(true);
      expect(frame.spriteSourceSize).toEqual({ x: 12, y: 18, w: 8, h: 8 });
      expect(frame.sourceSize).toEqual({ w: 32, h: 32 });
      expect(frame.frame.x).toBeGreaterThanOrEqual(layout.padding + layout.extrude);
      expect(frame.frame.y).toBeGreaterThanOrEqual(layout.padding + layout.extrude);
      expect(frame.frame.x + frame.frame.w).toBeLessThanOrEqual(
        sheet.meta.size.w - layout.padding - layout.extrude
      );
      expect(frame.frame.y + frame.frame.h).toBeLessThanOrEqual(
        sheet.meta.size.h - layout.padding - layout.extrude
      );
      return { key, rect: frame.frame };
    });
    const pitch = combined.cell.w + layout.spacing;
    for (const { rect } of rects) {
      expect((rect.x - layout.padding - layout.extrude) % pitch).toBe(0);
      expect((rect.y - layout.padding - layout.extrude) % (combined.cell.h + layout.spacing)).toBe(0);
    }
    for (let index = 0; index < rects.length; index++) {
      for (let other = index + 1; other < rects.length; other++) {
        expect(overlapping(rects[index]!.rect, rects[other]!.rect)).toBe(false);
      }
    }
    const image = engine.decodePNG(entries.get(combined.path)!);
    const first = rects[0]!.rect;
    const check = (x: number, y: number): [number, number, number, number] => [
      ...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4),
    ] as [number, number, number, number];
    expect(check(first.x - 1, first.y)).toEqual(check(first.x, first.y));
    expect(check(first.x + first.w, first.y)).toEqual(check(first.x + first.w - 1, first.y));
  });

  it("workflow G: reopens a ZIP, re-verifies every reference and is deterministic", async () => {
    const harness = makeHarness();
    const { service, paths, repo } = harness;
    const project = service.listProjects()[0]!;
    const detail = await service.generateAsset({
      projectId: project.id,
      kind: "character",
      name: "Repeatable Hero",
      width: 16,
      height: 16,
      paletteId: "ember",
      seed: 21,
    });
    const fullOutputs = {
      frames: true,
      stills: true,
      combinedSheet: true,
      animationSheets: true,
      directionSheets: true,
      gif: true,
      apng: true,
    };
    const result = await service.exportPackage(
      request({ scope: "asset", assetId: detail.id, outputs: fullOutputs })
    );
    const engine = await loadPixelEngine();
    const entries = await verifyExport(result, engine);
    const manifest = manifestOf(entries);
    const reread = await readPackage(result.filePath, result.container, result.plan.summary.root);
    expect(reread.size).toBe(entries.size);
    for (const [file, bytes] of entries) expect(reread.get(file)!.equals(bytes)).toBe(true);

    for (const asset of manifest.assets) {
      expect(entries.has(asset.still!)).toBe(true);
      expect(entries.has(asset.recipe!)).toBe(true);
      if (asset.generation) expect(entries.has(asset.generation)).toBe(true);
    }
    for (const animation of manifest.animations) {
      expect(animation.files.length).toBe(animation.frameCount);
      for (const file of animation.files) expect(entries.has(file)).toBe(true);
      if (animation.preview?.gif) expect(entries.has(animation.preview.gif)).toBe(true);
      if (animation.preview?.apng) expect(entries.has(animation.preview.apng)).toBe(true);
    }
    for (const sheet of manifest.sheets) {
      expect(entries.has(sheet.path)).toBe(true);
      expect(entries.has(sheet.json)).toBe(true);
      const parsed = jsonOf<SheetJson>(entries, sheet.json);
      expect(Object.keys(parsed.frames).length).toBe(sheet.frames);
      const image = engine.decodePNG(entries.get(sheet.path)!);
      expect(image.width).toBe(sheet.width);
      expect(image.height).toBe(sheet.height);
      for (const frame of Object.values(parsed.frames)) {
        expect(frame.frame.x + frame.frame.w).toBeLessThanOrEqual(image.width);
        expect(frame.frame.y + frame.frame.h).toBeLessThanOrEqual(image.height);
      }
    }

    const ctx = await contextFor(harness, engine);
    const firstBuild = await buildPackage(
      ctx,
      request({ scope: "asset", assetId: detail.id, outputs: fullOutputs })
    );
    const secondBuild = await buildPackage(
      ctx,
      request({ scope: "asset", assetId: detail.id, outputs: fullOutputs })
    );
    expect(secondBuild.summary.root).toBe(firstBuild.summary.root);
    expect(secondBuild.files.size).toBe(firstBuild.files.size);
    for (const [file, bytes] of firstBuild.files) {
      expect(bytes.equals(secondBuild.files.get(file)!), `${file} is not deterministic`).toBe(true);
    }
    expect(firstBuild.files.size).toBe(entries.size);
    expect(repo.pixel.getFrames(detail.id).length).toBe(detail.frames.length);
    expect(fs.existsSync(paths.pixelExportsDir)).toBe(true);
  });

  it("workflow D: writes a Godot package labelled structure-only", async () => {
    const harness = makeHarness();
    const { service } = harness;
    const project = service.listProjects()[0]!;
    const detail = await service.generateAsset({
      projectId: project.id,
      kind: "creature",
      name: "Godot Slime",
      width: 32,
      height: 32,
      paletteId: "forest",
      seed: 12,
    });
    const result = await service.exportPackage(
      request({ scope: "asset", assetId: detail.id, preset: "godot" })
    );
    expect(result.plan.summary.root).toBe("godot-slime-godot");
    const engine = await loadPixelEngine();
    const entries = await verifyExport(result, engine);
    const manifest = manifestOf(entries);
    expect(manifest.preset).toBe("godot");
    expect(manifest.engines.godot?.validated).toBe("structure-only");
    expect(manifest.engines.godot?.resource).toBe("spritesheets/godot-slime.tres");
    expect(manifest.engines.godot?.scene).toBe("godot-slime.tscn");
    expect(manifest.engines.combinedSheet).toBe("spritesheets/godot-slime.png");
    const tres = entries.get("spritesheets/godot-slime.tres")!.toString("utf8");
    expect(tres.startsWith('[gd_resource type="SpriteFrames" format=3]')).toBe(true);
    expect(tres).toContain('path="godot-slime.png"');
    expect(tres).toMatch(/region = Rect2\(/);
    expect(tres).toMatch(/^animations = \[/m);
    expect(tres).toContain('"speed":');
    const scene = entries.get("godot-slime.tscn")!.toString("utf8");
    expect(scene.startsWith("[gd_scene")).toBe(true);
    expect(scene).toContain('type="AnimatedSprite2D"');
    expect(scene).toContain('path="spritesheets/godot-slime.tres"');
    expect(scene).toContain("centered = false");
    const image = engine.decodePNG(entries.get("spritesheets/godot-slime.png")!);
    const sheet = sheetOf(entries, manifest);
    for (const match of tres.matchAll(/region = Rect2\(([^)]+)\)/g)) {
      const [x, y, w, h] = match[1]!.split(",").map((value) => Number(value.trim()));
      expect(x! + w!).toBeLessThanOrEqual(image.width);
      expect(y! + h!).toBeLessThanOrEqual(image.height);
    }
    expect(manifest.engines.godot?.animations).toEqual(Object.keys(sheet.animations));
    expect(manifest.engines.godot?.animations).toContain("idle");
  });

  it("builds Unity and Phaser artifacts that reference real frames", async () => {
    const harness = makeHarness();
    const { service } = harness;
    const project = service.listProjects()[0]!;
    const detail = await service.generateAsset({
      projectId: project.id,
      kind: "character",
      name: "Engine Hero",
      width: 32,
      height: 32,
      paletteId: "kirea",
      seed: 41,
    });
    const engine = await loadPixelEngine();

    const unity = await service.exportPackage(
      request({ scope: "asset", assetId: detail.id, preset: "unity", scale: 2, pixelsPerUnit: 32 })
    );
    expect(unity.plan.summary.root).toBe("engine-hero-unity");
    const unityEntries = await verifyExport(unity, engine);
    const unityManifest = manifestOf(unityEntries);
    expect(unityManifest.engines.unity?.validated).toBe("structure-only");
    expect(unityManifest.engines.unity?.spriteMeta).toBe("spritesheets/engine-hero.png.meta");
    expect(unityManifest.engines.unity?.animations).toBe(
      "spritesheets/engine-hero.unity-animations.json"
    );
    expect(unityManifest.engines.unity?.clipsFolder).toBe("spritesheets/engine-hero_clips");
    expect(unityManifest.engines.unity?.pixelsPerUnit).toBe(64);
    const meta = unityEntries.get("spritesheets/engine-hero.png.meta")!.toString("utf8");
    expect(meta.startsWith("fileFormatVersion: 2")).toBe(true);
    expect(meta).toContain("textureType: 8");
    expect(meta).toContain("spriteMode: 2");
    expect(meta).toContain("filterMode: 0");
    expect(meta).toContain("textureCompression: 0");
    expect(meta).toContain("spritePixelsToUnits: 64");
    expect(meta).toContain("nameFileIdTable:");
    const unityAnims = jsonOf<{
      schema: string;
      texture: string;
      pixelsPerUnit: number;
      animations: Array<{ name: string; loop: boolean; frames: Array<{ sprite: string; durationMs: number }> }>;
    }>(unityEntries, "spritesheets/engine-hero.unity-animations.json");
    expect(unityAnims.schema).toBe("kirea.unity-animations");
    expect(unityAnims.texture).toBe("engine-hero.png");
    expect(unityAnims.pixelsPerUnit).toBe(64);
    const spriteNames = new Set(
      [...meta.matchAll(/^  - first:\n {6}\d+: \d+\n {4}second: (.+)$/gm)].map((match) => {
        const raw = match[1]!.trim();
        return raw.startsWith('"') ? (JSON.parse(raw) as string) : raw;
      })
    );
    expect(spriteNames.size).toBe(Object.keys(sheetOf(unityEntries, unityManifest).frames).length);
    for (const clip of unityAnims.animations) {
      expect(clip.frames.length).toBeGreaterThan(0);
      for (const frame of clip.frames) {
        expect(spriteNames.has(frame.sprite), `${frame.sprite} has no Unity sprite`).toBe(true);
        expect(frame.durationMs).toBeGreaterThan(0);
      }
    }
    expect(unityManifest.engines.unity?.clips).toEqual(unityAnims.animations.map((clip) => clip.name));
    const scriptName = [...unityEntries.keys()].find((file) =>
      /^Editor\/KireaPixelImport_[0-9a-f]+\.cs$/.test(file)
    );
    expect(scriptName).toBeTruthy();
    const script = unityEntries.get(scriptName!)!.toString("utf8");
    expect(script).toContain("Build Pixel Animations");
    expect(script).toContain(".unity-animations.json");

    const phaser = await service.exportPackage(
      request({ scope: "asset", assetId: detail.id, preset: "phaser" })
    );
    expect(phaser.plan.summary.root).toBe("engine-hero-phaser");
    const phaserEntries = await verifyExport(phaser, engine);
    const phaserManifest = manifestOf(phaserEntries);
    expect(phaserManifest.engines.phaser?.validated).toBe("structure-only");
    expect(phaserManifest.engines.phaser?.textureKey).toBe("engine-hero");
    expect(phaserManifest.engines.phaser?.atlas).toBe("spritesheets/engine-hero.json");
    expect(phaserManifest.engines.phaser?.animations).toBe("spritesheets/engine-hero.anims.json");
    const atlas = jsonOf<SheetJson>(phaserEntries, "spritesheets/engine-hero.json");
    const anims = jsonOf<{
      schema: string;
      texture: string;
      atlas: string;
      scale: number;
      anims: Array<{
        key: string;
        type: string;
        repeat: number;
        frames: Array<{ key: string; frame: string; duration: number }>;
      }>;
    }>(phaserEntries, "spritesheets/engine-hero.anims.json");
    expect(atlas.meta.image).toBe("engine-hero.png");
    expect(anims.schema).toBe("kirea.phaser-animations");
    expect(anims.texture).toBe("engine-hero.png");
    expect(anims.atlas).toBe("engine-hero.json");
    expect(phaserManifest.engines.phaser?.animationKeys).toEqual(anims.anims.map((anim) => anim.key));
    for (const anim of anims.anims) {
      expect(anim.type).toBe("frame");
      expect(anim.frames.length).toBeGreaterThan(0);
      const manifestAnimation = phaserManifest.animations.find((entry) => entry.key === anim.key)!;
      expect(anim.repeat).toBe(manifestAnimation.loop ? -1 : 0);
      for (const frame of anim.frames) {
        expect(frame.key).toBe("engine-hero");
        expect(atlas.frames[frame.frame]).toBeTruthy();
        expect(frame.duration).toBeGreaterThan(0);
      }
      expect(anim.frames.map((frame) => frame.frame)).toEqual(
        manifestAnimation.frames.map((frame) => frame.sheetKey)
      );
    }
  });

  it("exports a historical version without touching the current one", async () => {
    const harness = makeHarness();
    const { service, paths } = harness;
    const project = service.listProjects()[0]!;
    const detail = await service.generateAsset({
      projectId: project.id,
      kind: "character",
      name: "Time Keeper",
      width: 32,
      height: 32,
      paletteId: "kirea",
      seed: 55,
      direction: "front",
    });
    const v1Bytes = fs.readFileSync(path.join(frameDirectory(paths, detail.id, 1), "frame_000.png"));
    const edited = await service.saveFrames(
      detail.id,
      detail.frames.map((frame) => ({ ...frame }))
    );
    expect(edited.version).toBe(2);
    const v2Bytes = fs.readFileSync(path.join(frameDirectory(paths, detail.id, 2), "frame_000.png"));

    const result = await service.exportPackage(
      request({ scope: "asset", assetId: detail.id, version: 1 })
    );
    expect(result.plan.summary.root).toBe("time-keeper-v1");
    const engine = await loadPixelEngine();
    const entries = await verifyExport(result, engine);
    const manifest = manifestOf(entries);
    const asset = manifest.assets[0]!;
    expect(asset.version).toBe(1);
    expect(asset.latestVersion).toBe(2);
    expect(asset.isLatest).toBe(false);
    expect(asset.frames[0]!.idSource).toBe("version-position");
    expect(asset.frames[0]!.id).toBe(`${detail.id}:1:0`);
    const exportedFrame = engine.decodePNG(
      entries.get(frameFileFor(manifest, asset.frames[0]!.sheetKey))!
    );
    const originalFrame = engine.decodePNG(v1Bytes);
    expect(samePixels(exportedFrame, originalFrame)).toBe(true);
    expect(fs.readFileSync(path.join(frameDirectory(paths, detail.id, 2), "frame_000.png")).equals(v2Bytes)).toBe(true);
    expect((await service.getAsset(detail.id)).version).toBe(2);
    const v2Export = await service.exportPackage(
      request({ scope: "asset", assetId: detail.id })
    );
    const v2Entries = await verifyExport(v2Export, engine);
    const v2Manifest = manifestOf(v2Entries);
    expect(v2Manifest.assets[0]!.isLatest).toBe(true);
    expect(v2Manifest.assets[0]!.version).toBe(2);
  });

  it("blocks missing frames and writes nothing", async () => {
    const harness = makeHarness();
    const { service, paths } = harness;
    const project = service.listProjects()[0]!;
    const detail = await service.generateAsset({
      projectId: project.id,
      kind: "character",
      name: "Broken Frame",
      width: 16,
      height: 16,
      paletteId: "neon",
      seed: 2,
    });
    fs.rmSync(path.join(frameDirectory(paths, detail.id, detail.version), "frame_003.png"));
    const plan = await service.planPackage(request({ scope: "asset", assetId: detail.id }));
    expect(plan.blocked).toBe(true);
    expect(plan.files).toHaveLength(0);
    expect(plan.issues.some((issue) => issue.code === "frame-file-missing")).toBe(true);
    await expect(
      service.exportPackage(request({ scope: "asset", assetId: detail.id }))
    ).rejects.toThrow(/missing frame 4/i);
    const packages = path.join(paths.pixelExportsDir, "packages");
    const written = fs.existsSync(packages) ? fs.readdirSync(packages) : [];
    expect(written.filter((name) => name.endsWith(".zip"))).toHaveLength(0);
  });

  it("cancels packing and writing without leaving partial output", async () => {
    const harness = makeHarness();
    const { service, paths } = harness;
    const project = service.listProjects()[0]!;
    const detail = await service.generateAsset({
      projectId: project.id,
      kind: "item",
      name: "Cancel Token",
      width: 16,
      height: 16,
      paletteId: "mono",
      seed: 1,
    });
    const engine = await loadPixelEngine();
    const ctx = await contextFor(harness, engine);
    const preAborted = new AbortController();
    preAborted.abort();
    await expect(
      buildPackage(ctx, request({ scope: "asset", assetId: detail.id }), {
        signal: preAborted.signal,
      })
    ).rejects.toBeInstanceOf(PackageCancelledError);

    const controller = new AbortController();
    await expect(
      buildPackage(ctx, request({ scope: "asset", assetId: detail.id }), {
        signal: controller.signal,
        onProgress: () => controller.abort(),
      })
    ).rejects.toBeInstanceOf(PackageCancelledError);

    const built = await buildPackage(ctx, request({ scope: "asset", assetId: detail.id }));
    const destination = path.join(paths.pixelExportsDir, "cancel-test");
    fs.mkdirSync(destination, { recursive: true });
    const writeAbort = new AbortController();
    writeAbort.abort();
    await expect(
      writePackage(built.files, {
        engine,
        destination,
        container: "zip",
        root: built.summary.root,
        signal: writeAbort.signal,
      })
    ).rejects.toBeInstanceOf(PackageCancelledError);
    expect(fs.readdirSync(destination)).toHaveLength(0);
    expect(service.cancelPackage("00000000-0000-4000-8000-000000000000")).toBe(false);
  });

  it("never overwrites an existing package and supports folder output", async () => {
    const harness = makeHarness();
    const { service } = harness;
    const project = service.listProjects()[0]!;
    const detail = await service.generateAsset({
      projectId: project.id,
      kind: "object",
      name: "Twice Packed",
      width: 16,
      height: 16,
      paletteId: "forest",
      seed: 6,
    });
    const first = await service.exportPackage(request({ scope: "asset", assetId: detail.id }));
    const firstBytes = fs.readFileSync(first.filePath);
    const second = await service.exportPackage(request({ scope: "asset", assetId: detail.id }));
    expect(second.filePath).not.toBe(first.filePath);
    expect(second.plan.summary.root).toBe(`${first.plan.summary.root}-2`);
    expect(fs.readFileSync(first.filePath).equals(firstBytes)).toBe(true);
    expect(fs.existsSync(second.filePath)).toBe(true);
    const folder = await service.exportPackage(
      request({ scope: "asset", assetId: detail.id, container: "folder" })
    );
    expect(folder.container).toBe("folder");
    expect(fs.statSync(folder.filePath).isDirectory()).toBe(true);
    const entries = await openPackage(folder);
    expect(entries.size).toBeGreaterThan(0);
    expect(manifestOf(entries).assets[0]!.id).toBe(detail.id);
  });

  it("workflow C: project scope groups characters and loose assets", async () => {
    const harness = makeHarness();
    const { service } = harness;
    const project = service.listProjects()[0]!;
    const character = service.saveCharacter({
      projectId: project.id,
      name: "Lantern Keeper",
      seed: 88,
      paletteId: "ember",
    });
    await service.generateAsset({
      projectId: project.id,
      characterId: character.id,
      kind: "character",
      name: "Lantern Keeper Front",
      width: 24,
      height: 24,
      paletteId: "ember",
      seed: 88,
    });
    const loose = await service.generateAsset({
      projectId: project.id,
      kind: "item",
      name: "Loose Lantern",
      width: 16,
      height: 16,
      paletteId: "ember",
      seed: 3,
    });

    const result = await service.exportPackage(
      request({ scope: "project", projectId: project.id })
    );
    expect(result.plan.summary.root).toBe("first-pixel-project");
    const engine = await loadPixelEngine();
    const entries = await verifyExport(result, engine);
    const projectManifest = jsonOf<{
      schema: string;
      scope: string;
      groups: Array<{
        kind: string;
        key: string;
        path: string;
        manifest: string;
        manifestSha256: string;
        assets: string[];
        animations: string[];
      }>;
      files: Array<{ path: string; bytes: number; sha256: string }>;
    }>(entries, "project.json");
    expect(projectManifest.schema).toBe("kirea.pixel-package");
    expect(projectManifest.scope).toBe("project");
    expect(projectManifest.groups.map((group) => group.kind)).toEqual(["character", "asset"]);
    expect(projectManifest.groups.map((group) => group.path)).toEqual([
      "characters/lantern-keeper",
      "assets/loose-lantern",
    ]);
    for (const group of projectManifest.groups) {
      expect(entries.has(group.manifest)).toBe(true);
      const manifest = jsonOf<Manifest>(entries, group.manifest);
      expect(manifest.files.length).toBeGreaterThan(0);
      for (const file of manifest.files) {
        expect(entries.has(`${group.path}/${file.path}`)).toBe(true);
      }
      for (const assetId of group.assets) {
        expect(manifest.assets.some((asset) => asset.id === assetId)).toBe(true);
      }
      if (group.kind === "character") {
        expect(manifest.character?.id).toBe(character.id);
        expect(manifest.scope).toBe("project");
      } else {
        expect(manifest.character).toBeNull();
        expect(group.assets).toEqual([loose.id]);
      }
    }
    expect(entries.has("README.txt")).toBe(true);
    expect(projectManifest.files.some((file) => file.path === "README.txt")).toBe(true);
    const groupFiles = projectManifest.files.filter((file) => file.path !== "README.txt");
    expect(groupFiles.every((file) => !file.path.startsWith("characters/") && !file.path.startsWith("assets/"))).toBe(true);
  });

  it("reports the plan without writing and clamps invalid layout values", async () => {
    const harness = makeHarness();
    const { service, paths } = harness;
    const project = service.listProjects()[0]!;
    const detail = await service.generateAsset({
      projectId: project.id,
      kind: "weapon",
      name: "Plan Only",
      width: 16,
      height: 16,
      paletteId: "mono",
      seed: 10,
    });
    const plan = await service.planPackage(
      request({
        scope: "asset",
        assetId: detail.id,
        layout: { ...DEFAULT_SHEET_LAYOUT, columns: 999, padding: -5, maxSize: 999999 },
      })
    );
    expect(plan.request.layout.columns).toBe(64);
    expect(plan.request.layout.padding).toBe(0);
    expect(plan.request.layout.maxSize).toBe(16384);
    expect(plan.destination).toBe(path.join(paths.pixelExportsDir, "packages"));
    expect(plan.totalBytes).toBeGreaterThan(0);
    const packages = path.join(paths.pixelExportsDir, "packages");
    expect(fs.existsSync(packages) ? fs.readdirSync(packages).length : 0).toBe(0);

    const missing = await service.planPackage(
      request({ scope: "asset", assetId: "does-not-exist" })
    );
    expect(missing.blocked).toBe(true);
    expect(missing.issues.some((issue) => issue.code === "asset-not-found")).toBe(true);
    await expect(service.planPackage(request({ scope: "character" }))).rejects.toThrow(
      /choose the character/i
    );
  });
});
