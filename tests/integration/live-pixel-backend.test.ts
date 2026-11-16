import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ComfyApiClient } from "../../src/main/comfy/comfy-adapter";
import type { ComfyRuntimeManager } from "../../src/main/comfy/runtime-manager";
import { StudioDatabase } from "../../src/main/db/database";
import { StudioRepository } from "../../src/main/db/repositories";
import { StudioLogger } from "../../src/main/logger";
import { PixelAiService } from "../../src/main/pixel/ai/pixel-ai-service";
import { SpriteKilnProvider } from "../../src/main/pixel/ai/spritekiln-provider";
import { PixelService } from "../../src/main/pixel/pixel-service";
import type { StudioPaths } from "../../src/main/paths";
import type { AppSettings } from "../../src/shared/types";
import type { PixelAiBackendStatus, PixelAiGenerateInput } from "../../src/shared/pixel-ai-types";

// Opt-in: run against an isolated SpriteKiln ComfyUI at KIREA_PIXEL_PORT (default 8189).
const LIVE = process.env.KIREA_PIXEL_LIVE === "1";
const PORT = Number(process.env.KIREA_PIXEL_PORT ?? 8189);

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function readSprite(pngPath: string): Promise<{
  mask: Uint8Array;
  colors: Set<string>;
  width: number;
  height: number;
}> {
  const { data, info } = await sharp(pngPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const mask = new Uint8Array(info.width * info.height);
  const colors = new Set<string>();
  for (let index = 0; index < mask.length; index += 1) {
    const offset = index * 4;
    if (data[offset + 3]! > 8) {
      mask[index] = 1;
      colors.add(`${data[offset]},${data[offset + 1]},${data[offset + 2]}`);
    }
  }
  return { mask, colors, width: info.width, height: info.height };
}

function silhouetteIou(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) return 0;
  let intersection = 0;
  let union = 0;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] || b[index]) union += 1;
    if (a[index] && b[index]) intersection += 1;
  }
  return union === 0 ? 0 : intersection / union;
}

function paletteOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const color of a) if (b.has(color)) shared += 1;
  return shared / Math.max(a.size, b.size);
}

function mirrorMask(mask: Uint8Array, width: number, height: number): Uint8Array {
  const flipped = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      flipped[y * width + x] = mask[y * width + (width - 1 - x)]!;
    }
  }
  return flipped;
}

interface StatsSample {
  vramFreeBytes: number;
  ramFreeBytes: number;
}

function createPaths(root: string): StudioPaths {
  return {
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
}

describe("Live SpriteKiln pixel backend", () => {
  let root = "";
  let paths: StudioPaths;
  let db: StudioDatabase;
  let repo: StudioRepository;
  let logger: StudioLogger;
  let api: ComfyApiClient;
  let provider: SpriteKilnProvider;
  let service: PixelAiService;
  let pixels: PixelService;
  let projectId = "";

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-live-pixel-"));
    paths = createPaths(root);
    for (const dir of [
      paths.logsDir,
      paths.pixelAiTempDir,
      paths.pixelAssetsDir,
      paths.pixelExportsDir,
    ]) {
      fs.mkdirSync(dir, { recursive: true });
    }
    db = new StudioDatabase(paths.dbPath);
    repo = new StudioRepository(db);
    logger = new StudioLogger(paths.logsDir);
    const settings = {
      pixelBackendHost: "127.0.0.1",
      pixelBackendPort: PORT,
      pixelBackendWorkflowRoot: "",
    } as unknown as AppSettings;
    api = new ComfyApiClient(`http://127.0.0.1:${PORT}`);
    provider = new SpriteKilnProvider(paths, repo, () => settings, logger);
    pixels = new PixelService(paths, repo, {} as unknown as ComfyRuntimeManager, logger);
    service = new PixelAiService(pixels, provider, logger);
    projectId = pixels.listProjects()[0]!.id;
  });

  afterAll(() => {
    service?.dispose();
    try {
      db?.close();
    } catch {
      // already closed
    }
    if (root) fs.rmSync(root, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 });
  });

  async function runMeasured<T>(
    fn: () => Promise<T>
  ): Promise<{ value: T; durationMs: number; minFree: StatsSample; samples: number }> {
    const samples: StatsSample[] = [];
    let running = true;
    const poll = (async () => {
      while (running) {
        try {
          const stats = await api.getSystemStats();
          samples.push({
            vramFreeBytes: Number(stats.devices?.[0]?.vram_free ?? 0),
            ramFreeBytes: Number(stats.system?.ram_free ?? 0),
          });
        } catch {
          // Backend busy; keep sampling.
        }
        await delay(400);
      }
    })();
    const started = Date.now();
    try {
      const value = await fn();
      return {
        value,
        durationMs: Date.now() - started,
        minFree: samples.reduce<StatsSample>(
          (acc, sample) => ({
            vramFreeBytes: Math.min(acc.vramFreeBytes, sample.vramFreeBytes),
            ramFreeBytes: Math.min(acc.ramFreeBytes, sample.ramFreeBytes),
          }),
          { vramFreeBytes: Number.POSITIVE_INFINITY, ramFreeBytes: Number.POSITIVE_INFINITY }
        ),
        samples: samples.length,
      };
    } finally {
      running = false;
      await poll;
    }
  }

  function input(overrides: Partial<PixelAiGenerateInput>): PixelAiGenerateInput {
    return {
      projectId,
      kind: "character",
      name: "Live sprite",
      mode: "text",
      prompt: "a small blue knight, side view, crisp pixel art",
      width: 32,
      height: 32,
      paletteId: "kirea",
      seed: 424242,
      style: "game asset",
      steps: 4,
      ...overrides,
    };
  }

  async function runJob(payload: PixelAiGenerateInput) {
    const started = service.startJob(payload);
    const job = await service.waitForJob(started.id);
    return job;
  }

  it.skipIf(!LIVE)("reports the exact capability gaps on the isolated backend", async () => {
    const status: PixelAiBackendStatus = await provider.getStatus();
    console.log(
      "PIXEL_STATUS",
      JSON.stringify({
        state: status.state,
        version: status.comfyVersion,
        capabilities: status.capabilities.map((capability) => ({
          id: capability.id,
          ready: capability.ready,
          unverified: capability.unverified,
          missing: capability.requirements
            .filter((requirement) => requirement.state === "missing")
            .map((requirement) => requirement.name),
          unverifiedRequirements: capability.requirements
            .filter((requirement) => requirement.state === "unverified")
            .map((requirement) => requirement.name),
        })),
        message: status.message,
      })
    );
    expect(status.reachable).toBe(true);
    expect(status.comfyVersion).toBeTruthy();
    const text = status.capabilities.find((capability) => capability.id === "text_to_pixel");
    expect(text && (text.ready || text.unverified)).toBe(true);
    for (const id of [
      "text_to_pixel",
      "image_to_pixel_direct",
      "image_to_pixel_ai",
      "reference_to_pixel",
      "inpaint_pixel",
      "directional_set",
    ]) {
      const capability = status.capabilities.find((entry) => entry.id === id);
      expect(capability, `missing capability ${id}`).toBeTruthy();
      expect(
        capability!.requirements.filter((requirement) => requirement.state === "missing"),
        `missing requirements for ${id}`
      ).toEqual([]);
      expect(capability!.ready || capability!.unverified, `${id} not ready`).toBe(true);
    }
  });

  it.skipIf(!LIVE)(
    "generates, imports and preserves provenance for text-to-pixel (cold and warm)",
    async () => {
      const cold = await runMeasured(() =>
        runJob(input({ name: "Live text cold", seed: 424242 }))
      );
      expect(cold.value.status).toBe("completed");
      expect(cold.value.assetId).toBeTruthy();
      const coldAsset = await service.getJob(cold.value.id);
      const detail = await provider.getStatus();
      const vramTotal = detail.hardware?.devices[0]?.vramTotalBytes ?? 0;
      console.log(
        "PIXEL_TEXT_COLD",
        JSON.stringify({
          durationMs: cold.durationMs,
          peakVramBytes: vramTotal - cold.minFree.vramFreeBytes,
          minFreeVramBytes: cold.minFree.vramFreeBytes,
          minFreeRamBytes: cold.minFree.ramFreeBytes,
          samples: cold.samples,
          assetId: coldAsset.assetId,
        })
      );

      const asset = await pixels.getAsset(cold.value.assetId!);
      expect(asset.generation?.backend).toBe("spritekiln");
      expect(asset.generation?.workflowId).toBe("text_to_pixel");
      expect(asset.generation?.workflowFile).toBe("01_text_to_pixel_art.api.json");
      expect(asset.generation?.model).toContain("z_image_turbo");
      expect(asset.generation?.seed).toBe(424242);
      expect(asset.generation?.prompt).toContain("blue knight");
      expect(asset.generation?.backendVersion).toBeTruthy();
      expect(asset.generation?.promptId).toBeTruthy();
      const sidecar = path.join(
        paths.pixelAssetsDir,
        cold.value.assetId!,
        "versions",
        "1",
        "generation.json"
      );
      expect(fs.existsSync(sidecar)).toBe(true);
      const saved = JSON.parse(fs.readFileSync(sidecar, "utf8")) as Record<string, unknown>;
      expect(saved.provider ?? saved.backend).toBe("spritekiln");
      expect(fs.existsSync(asset.previewPath)).toBe(true);
      const meta = await sharp(asset.previewPath).metadata();
      expect(meta.width).toBe(32);
      expect(meta.height).toBe(32);

      const warm = await runMeasured(() =>
        runJob(input({ name: "Live text warm", seed: 424243 }))
      );
      expect(warm.value.status).toBe("completed");
      console.log(
        "PIXEL_TEXT_WARM",
        JSON.stringify({
          durationMs: warm.durationMs,
          peakVramBytes: vramTotal - warm.minFree.vramFreeBytes,
          minFreeVramBytes: warm.minFree.vramFreeBytes,
          minFreeRamBytes: warm.minFree.ramFreeBytes,
        })
      );
    },
    900_000
  );

  it.skipIf(!LIVE)(
    "converts an uploaded image directly and redraws it with the model",
    async () => {
      const source = await sharp({
        create: { width: 64, height: 64, channels: 4, background: { r: 220, g: 60, b: 60, alpha: 1 } },
      })
        .png()
        .toBuffer();
      const dataUrl = `data:image/png;base64,${source.toString("base64")}`;

      const direct = await runMeasured(() =>
        runJob(
          input({
            name: "Live image direct",
            mode: "image",
            conversion: "direct",
            prompt: "",
            image: { kind: "dataUrl", dataUrl, fileName: "source.png" },
          })
        )
      );
      expect(direct.value.status).toBe("completed");
      const directAsset = await pixels.getAsset(direct.value.assetId!);
      expect(directAsset.generation?.workflowId).toBe("image_to_pixel_direct");
      const vramTotal = (await provider.getStatus()).hardware?.devices[0]?.vramTotalBytes ?? 0;
      console.log(
        "PIXEL_IMAGE_DIRECT",
        JSON.stringify({
          durationMs: direct.durationMs,
          peakVramBytes: vramTotal - direct.minFree.vramFreeBytes,
          minFreeRamBytes: direct.minFree.ramFreeBytes,
        })
      );

      const redraw = await runMeasured(() =>
        runJob(
          input({
            name: "Live image redraw",
            mode: "image",
            conversion: "ai",
            prompt: "a red slime creature, side view",
            strength: 0.6,
            image: { kind: "dataUrl", dataUrl, fileName: "source.png" },
          })
        )
      );
      expect(redraw.value.status).toBe("completed");
      const redrawAsset = await pixels.getAsset(redraw.value.assetId!);
      expect(redrawAsset.generation?.workflowId).toBe("image_to_pixel_ai");
      expect(redrawAsset.generation?.settings.strength).toBe(0.6);
      console.log(
        "PIXEL_IMAGE_REDRAW",
        JSON.stringify({
          durationMs: redraw.durationMs,
          peakVramBytes: vramTotal - redraw.minFree.vramFreeBytes,
          minFreeRamBytes: redraw.minFree.ramFreeBytes,
        })
      );
    },
    900_000
  );

  it.skipIf(!LIVE)("cancels a running text job and clears the backend queue", async () => {
    const started = service.startJob(
      input({
        name: "Live cancel",
        width: 128,
        height: 128,
        steps: 30,
        longSide: 1024,
        seed: 999,
        transparent: false,
      })
    );

    const promptId = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("No prompt id received before timeout.")), 300_000);
      const onUpdate = (job: { id: string; promptId: string | null }) => {
        if (job.id !== started.id) return;
        if (job.promptId) {
          clearTimeout(timer);
          service.removeListener("jobUpdated", onUpdate);
          resolve(job.promptId);
        }
      };
      service.on("jobUpdated", onUpdate);
    });

    const cancelled = await service.cancelJob(started.id);
    expect(cancelled).toBe(true);
    const finished = await service.waitForJob(started.id);
    expect(finished.status).toBe("cancelled");
    expect(finished.error).toBeNull();
    console.log("PIXEL_CANCEL", JSON.stringify({ promptId }));

    await delay(1500);
    const queue = await api.getQueue();
    const entries = [...queue.queue_running, ...queue.queue_pending];
    expect(entries.some((entry) => entry[1] === promptId)).toBe(false);
  }, 600_000);

  it.skipIf(!LIVE)(
    "generates and imports a reference-guided sprite",
    async () => {
      const source = await sharp({
        create: { width: 32, height: 32, channels: 4, background: { r: 40, g: 120, b: 220, alpha: 1 } },
      })
        .png()
        .toBuffer();
      const dataUrl = `data:image/png;base64,${source.toString("base64")}`;

      const run = await runMeasured(() =>
        runJob(
          input({
            name: "Live reference",
            mode: "reference",
            prompt: "a blue knight, side view",
            strength: 0.7,
            seed: 515151,
            reference: { subject: { kind: "dataUrl", dataUrl, fileName: "ref.png" } },
          })
        )
      );
      expect(run.value.status).toBe("completed");
      expect(run.value.assetId).toBeTruthy();
      const asset = await pixels.getAsset(run.value.assetId!);
      expect(asset.generation?.workflowId).toBe("reference_to_pixel");
      expect(asset.generation?.workflowFile).toBe("03_reference_to_pixel_art.api.json");
      expect(asset.generation?.model).toContain("flux-2-klein-4b");
      expect(asset.generation?.seed).toBe(515151);
      expect(asset.generation?.reference?.subject).toBeTruthy();
      expect(asset.generation?.settings.referenceStrength).toBe(0.7);
      expect(asset.generation?.promptId).toBeTruthy();
      expect(fs.existsSync(asset.previewPath)).toBe(true);
      const meta = await sharp(asset.previewPath).metadata();
      expect(meta.width).toBe(32);
      expect(meta.height).toBe(32);

      const sidecar = path.join(
        paths.pixelAssetsDir,
        run.value.assetId!,
        "versions",
        "1",
        "generation.json"
      );
      expect(fs.existsSync(sidecar)).toBe(true);

      const vramTotal = (await provider.getStatus()).hardware?.devices[0]?.vramTotalBytes ?? 0;
      console.log(
        "PIXEL_REFERENCE",
        JSON.stringify({
          durationMs: run.durationMs,
          peakVramBytes: vramTotal - run.minFree.vramFreeBytes,
          minFreeRamBytes: run.minFree.ramFreeBytes,
          assetId: run.value.assetId,
        })
      );
    },
    900_000
  );

  it.skipIf(!LIVE)(
    "generates and imports a localized inpaint edit",
    async () => {
      const source = await sharp({
        create: { width: 32, height: 32, channels: 4, background: { r: 60, g: 160, b: 90, alpha: 1 } },
      })
        .png()
        .toBuffer();
      const dataUrl = `data:image/png;base64,${source.toString("base64")}`;

      const run = await runMeasured(() =>
        runJob(
          input({
            name: "Live inpaint",
            mode: "inpaint",
            prompt: "add a silver helmet",
            seed: 616161,
            inpaint: {
              base: { kind: "dataUrl", dataUrl, fileName: "base.png" },
              region: { x: 8, y: 8, width: 16, height: 16 },
            },
          })
        )
      );
      expect(run.value.status).toBe("completed");
      expect(run.value.assetId).toBeTruthy();
      const asset = await pixels.getAsset(run.value.assetId!);
      expect(asset.generation?.workflowId).toBe("inpaint_pixel");
      expect(asset.generation?.workflowFile).toBe("05_inpaint_pixel_art.api.json");
      expect(asset.generation?.seed).toBe(616161);
      expect(asset.generation?.settings.region).toBe("8,8,16,16");
      expect(asset.generation?.promptId).toBeTruthy();
      expect(fs.existsSync(asset.previewPath)).toBe(true);
      const meta = await sharp(asset.previewPath).metadata();
      expect(meta.width).toBe(32);
      expect(meta.height).toBe(32);

      const sidecar = path.join(
        paths.pixelAssetsDir,
        run.value.assetId!,
        "versions",
        "1",
        "generation.json"
      );
      expect(fs.existsSync(sidecar)).toBe(true);

      const vramTotal = (await provider.getStatus()).hardware?.devices[0]?.vramTotalBytes ?? 0;
      console.log(
        "PIXEL_INPAINT",
        JSON.stringify({
          durationMs: run.durationMs,
          peakVramBytes: vramTotal - run.minFree.vramFreeBytes,
          minFreeRamBytes: run.minFree.ramFreeBytes,
          assetId: run.value.assetId,
        })
      );
    },
    900_000
  );

  it.skipIf(!LIVE)(
    "keeps a saved character identity across reference-guided variations",
    async () => {
      const identityRun = await runJob(
        input({
          name: "Live identity",
          mode: "text",
          prompt:
            "a courier in a patched blue coat, short dark hair, scar over the left brow, front view",
          seed: 717171,
          style: "character (front, RPG)",
          width: 32,
          height: 32,
        })
      );
      expect(identityRun.status).toBe("completed");
      expect(identityRun.assetId).toBeTruthy();
      const identity = await pixels.getAsset(identityRun.assetId!);

      const character = pixels.saveCharacter({
        projectId,
        name: "Live courier",
        description: "courier in a patched blue coat, short dark hair, scar over the left brow",
        seed: 717171,
        paletteId: "kirea",
        referenceAssetId: identity.id,
      });

      const variationA = await runJob(
        input({
          name: "Live courier red cloak",
          characterId: character.id,
          parentAssetId: identity.id,
          mode: "reference",
          prompt: "the same courier wearing a red cloak",
          strength: 0.7,
          seed: 818181,
          reference: { subject: { kind: "asset", assetId: identity.id } },
        })
      );
      const variationB = await runJob(
        input({
          name: "Live courier lantern",
          characterId: character.id,
          parentAssetId: identity.id,
          mode: "reference",
          prompt: "the same courier carrying a brass lantern",
          strength: 0.7,
          seed: 919191,
          reference: { subject: { kind: "asset", assetId: identity.id } },
        })
      );
      expect(variationA.status).toBe("completed");
      expect(variationB.status).toBe("completed");

      const assetA = await pixels.getAsset(variationA.assetId!);
      const assetB = await pixels.getAsset(variationB.assetId!);
      for (const asset of [assetA, assetB]) {
        expect(asset.characterId).toBe(character.id);
        expect(asset.parentAssetId).toBe(identity.id);
        expect(asset.generation?.workflowId).toBe("reference_to_pixel");
        expect(asset.generation?.reference?.subject).toBeTruthy();
        expect(asset.generation?.seed).toBe(asset === assetA ? 818181 : 919191);
        const meta = await sharp(asset.previewPath).metadata();
        expect(meta.width).toBe(32);
        expect(meta.height).toBe(32);
      }

      const base = await readSprite(identity.previewPath);
      const spriteA = await readSprite(assetA.previewPath);
      const spriteB = await readSprite(assetB.previewPath);
      const metrics = {
        characterId: character.id,
        identityVsA: silhouetteIou(base.mask, spriteA.mask),
        identityVsB: silhouetteIou(base.mask, spriteB.mask),
        aVsB: silhouetteIou(spriteA.mask, spriteB.mask),
        paletteIdentityVsA: paletteOverlap(base.colors, spriteA.colors),
        paletteIdentityVsB: paletteOverlap(base.colors, spriteB.colors),
        paletteAVsB: paletteOverlap(spriteA.colors, spriteB.colors),
        colors: { identity: base.colors.size, a: spriteA.colors.size, b: spriteB.colors.size },
      };
      console.log("PIXEL_IDENTITY", JSON.stringify(metrics));
      expect(metrics.identityVsA).toBeGreaterThanOrEqual(0.5);
      expect(metrics.identityVsB).toBeGreaterThanOrEqual(0.5);
      expect(metrics.aVsB).toBeGreaterThanOrEqual(0.5);
    },
    900_000
  );

  it.skipIf(!LIVE)(
    "rotates a saved identity into linked four- and eight-direction sets",
    async () => {
      const identityRun = await runJob(
        input({
          name: "Live direction source",
          mode: "text",
          prompt: "a courier in a patched blue coat, short dark hair, front view",
          seed: 717171,
          style: "character (front, RPG)",
        })
      );
      expect(identityRun.status).toBe("completed");
      const identity = await pixels.getAsset(identityRun.assetId!);
      const character = pixels.saveCharacter({
        projectId,
        name: "Live direction courier",
        description: "courier in a patched blue coat, short dark hair",
        seed: 717171,
        paletteId: "kirea",
        referenceAssetId: identity.id,
      });

      const run = await runMeasured(() =>
        runJob(
          input({
            name: "Live courier directions",
            characterId: character.id,
            parentAssetId: identity.id,
            mode: "directions",
            prompt: "the same courier, directional set",
            seed: 717171,
            directionCount: 4,
            reference: { subject: { kind: "asset", assetId: identity.id } },
          })
        )
      );
      expect(run.value.status).toBe("completed");
      expect(run.value.assetIds).toHaveLength(4);
      expect(run.value.error).toBeNull();

      const details = await Promise.all(
        run.value.assetIds.map((assetId) => pixels.getAsset(assetId))
      );
      expect(details.map((asset) => asset.name.split(" · ").pop())).toEqual([
        "S",
        "E",
        "N",
        "W",
      ]);
      for (const [index, asset] of details.entries()) {
        expect(asset.characterId).toBe(character.id);
        expect(asset.parentAssetId).toBe(identity.id);
        expect(asset.generation?.workflowId).toBe("directional_set");
        expect(asset.generation?.workflowFile).toBe("06_rotate_8_directions.api.json");
        expect(asset.generation?.seed).toBe(717171);
        expect(asset.generation?.settings.direction).toBe(["S", "E", "N", "W"][index]);
        expect(asset.generation?.settings.directions).toBe(4);
        const meta = await sharp(asset.previewPath).metadata();
        expect(meta.width).toBe(32);
        expect(meta.height).toBe(32);
        const sidecar = path.join(
          paths.pixelAssetsDir,
          asset.id,
          "versions",
          "1",
          "generation.json"
        );
        expect(fs.existsSync(sidecar)).toBe(true);
      }

      const sprites = await Promise.all(details.map((asset) => readSprite(asset.previewPath)));
      const mirroredEast = mirrorMask(sprites[1]!.mask, sprites[1]!.width, sprites[1]!.height);
      const metrics = {
        durationMs: run.durationMs,
        peakVramBytes:
          ((await provider.getStatus()).hardware?.devices[0]?.vramTotalBytes ?? 0) -
          run.minFree.vramFreeBytes,
        silhouetteVsSource: sprites.map((sprite) => silhouetteIou(sprite.mask, sprites[0]!.mask)),
        westMirrorsEast: silhouetteIou(sprites[3]!.mask, mirroredEast),
        paletteOverlapWithSource: sprites.map((sprite) =>
          paletteOverlap(sprite.colors, sprites[0]!.colors)
        ),
        colors: sprites.map((sprite) => sprite.colors.size),
      };
      console.log("PIXEL_DIRECTIONS", JSON.stringify(metrics));
      expect(metrics.westMirrorsEast).toBeGreaterThanOrEqual(0.99);
      expect(metrics.silhouetteVsSource[1]).toBeLessThan(0.98);
      expect(metrics.paletteOverlapWithSource[1]).toBeGreaterThanOrEqual(0.5);
      expect(metrics.paletteOverlapWithSource[2]).toBeGreaterThanOrEqual(0.5);

      const eight = await runMeasured(() =>
        runJob(
          input({
            name: "Live courier directions 8",
            characterId: character.id,
            parentAssetId: identity.id,
            mode: "directions",
            prompt: "the same courier, eight-direction set",
            seed: 717171,
            directionCount: 8,
            reference: { subject: { kind: "asset", assetId: identity.id } },
          })
        )
      );
      expect(eight.value.status).toBe("completed");
      expect(eight.value.assetIds).toHaveLength(8);
      const details8 = await Promise.all(
        eight.value.assetIds.map((assetId) => pixels.getAsset(assetId))
      );
      expect(details8.map((asset) => asset.name.split(" · ").pop())).toEqual([
        "S",
        "SE",
        "E",
        "NE",
        "N",
        "NW",
        "W",
        "SW",
      ]);
      for (const asset of details8) {
        expect(asset.characterId).toBe(character.id);
        expect(asset.parentAssetId).toBe(identity.id);
        expect(asset.generation?.settings.directions).toBe(8);
        expect(fs.existsSync(asset.previewPath)).toBe(true);
      }

      const sprites8 = await Promise.all(details8.map((asset) => readSprite(asset.previewPath)));
      const mirrors = [
        silhouetteIou(sprites8[5]!.mask, mirrorMask(sprites8[3]!.mask, sprites8[3]!.width, sprites8[3]!.height)),
        silhouetteIou(sprites8[6]!.mask, mirrorMask(sprites8[2]!.mask, sprites8[2]!.width, sprites8[2]!.height)),
        silhouetteIou(sprites8[7]!.mask, mirrorMask(sprites8[1]!.mask, sprites8[1]!.width, sprites8[1]!.height)),
      ];
      console.log(
        "PIXEL_DIRECTIONS_8",
        JSON.stringify({
          durationMs: eight.durationMs,
          peakVramBytes:
            ((await provider.getStatus()).hardware?.devices[0]?.vramTotalBytes ?? 0) -
            eight.minFree.vramFreeBytes,
          mirrorIou: mirrors,
          colors: sprites8.map((sprite) => sprite.colors.size),
        })
      );
      expect(mirrors.every((value) => value >= 0.99)).toBe(true);
    },
    900_000
  );
});
