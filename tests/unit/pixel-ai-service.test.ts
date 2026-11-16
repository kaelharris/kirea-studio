import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StudioLogger } from "../../src/main/logger";
import { PixelAiService, type PixelAiProvider } from "../../src/main/pixel/ai/pixel-ai-service";
import type { PixelService } from "../../src/main/pixel/pixel-service";
import type { PixelAiGenerationResult } from "../../src/main/pixel/ai/spritekiln-provider";
import type {
  PixelAiBackendStatus,
  PixelAiCapabilityStatus,
  PixelAiGenerateInput,
  PixelAiGenerationMetadata,
} from "../../src/shared/pixel-ai-types";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-pixel-ai-service-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

const READY_STATUS: PixelAiBackendStatus = {
  state: "ready",
  message: "ready",
  configured: true,
  reachable: true,
  apiUrl: "http://127.0.0.1:8190",
  comfyVersion: "0.41.0",
  pythonVersion: "3.12.4",
  pytorchVersion: "2.7.1",
  workflowRoot: "C:\\spritekiln",
  workflowRootSource: "configured",
  capabilities: [],
  hardware: null,
  warnings: [],
  checkedAt: new Date(0).toISOString(),
};

const TEXT_CAPABILITY: PixelAiCapabilityStatus = {
  id: "text_to_pixel",
  label: "Text to pixel art",
  mode: "text",
  workflowFile: "01_text_to_pixel_art.api.json",
  ready: true,
  unverified: false,
  requirements: [],
  notes: [],
};

const REFERENCE_CAPABILITY: PixelAiCapabilityStatus = {
  id: "reference_to_pixel",
  label: "Reference-guided",
  mode: "reference",
  workflowFile: "03_reference_to_pixel_art.api.json",
  ready: false,
  unverified: true,
  requirements: [
    {
      kind: "model",
      name: "flux-2-klein-4b.safetensors",
      state: "missing",
      detail:
        "Missing flux-2-klein-4b.safetensors. Place it in models/diffusion_models/ of the dedicated ComfyUI, then restart ComfyUI.",
    },
  ],
  notes: [],
};

const METADATA: PixelAiGenerationMetadata = {
  backend: "spritekiln",
  backendVersion: "0.41.0",
  workflowId: "text_to_pixel",
  workflowFile: "01_text_to_pixel_art.api.json",
  model: "z_image_turbo.safetensors",
  prompt: "a knight",
  negativePrompt: "",
  seed: 7,
  width: 32,
  height: 32,
  paletteId: "kirea",
  palette: ["#191920", "#4f7bfc", "#e8c9ae", "#d9c9a8", "#f2dc93"],
  style: "game asset",
  timestamp: new Date(0).toISOString(),
  promptId: "prompt-1",
  reference: null,
  settings: {},
  notes: ["Negative prompts are stored but not applied."],
};

const RESULT: PixelAiGenerationResult = {
  png: Buffer.from("png"),
  width: 32,
  height: 32,
  promptId: "prompt-1",
  metadata: METADATA,
};

const INPUT: PixelAiGenerateInput = {
  projectId: "project-1",
  kind: "character",
  name: "AI knight",
  mode: "text",
  prompt: "a knight",
  width: 32,
  height: 32,
  paletteId: "kirea",
  seed: 7,
};

function createHarness(provider: Partial<PixelAiProvider>, importResult = { id: "asset-1" }) {
  const root = makeTempDir();
  const importGeneratedPng = vi.fn(async () => importResult as never);
  const pixels = { importGeneratedPng } as unknown as PixelService;
  const logger = new StudioLogger(path.join(root, "logs"));
  const stub: PixelAiProvider = {
    getStatus: vi.fn(async () => READY_STATUS),
    testConnection: vi.fn(async () => ({
      ok: true,
      apiUrl: "http://127.0.0.1:8190",
      comfyVersion: "0.41.0",
      message: "ok",
    })),
    generate: vi.fn(async () => RESULT),
    generateDirections: vi.fn(async () => ({
      images: [],
      promptId: "prompt-1",
      metadata: METADATA,
    })),
    cancelPrompt: vi.fn(async () => undefined),
    ...provider,
  };
  const service = new PixelAiService(pixels, stub, logger);
  return { service, provider: stub, importGeneratedPng };
}

describe("PixelAiService", () => {
  it("imports a completed generation and exposes the asset id and warnings", async () => {
    const { service, importGeneratedPng } = createHarness({
      generate: vi.fn(async (_jobId, _input, progress) => {
        progress({ promptId: "prompt-1", stage: "Sampling", value: 2, max: 4 });
        return RESULT;
      }),
    });

    const started = service.startJob(INPUT);
    const finished = await service.waitForJob(started.id);

    expect(finished.status).toBe("completed");
    expect(finished.assetId).toBe("asset-1");
    expect(finished.warnings).toEqual(["Negative prompts are stored but not applied."]);
    expect(importGeneratedPng).toHaveBeenCalledTimes(1);
    expect(importGeneratedPng).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        name: "AI knight",
        png: RESULT.png,
        generation: METADATA,
      })
    );
    expect(service.listJobs()[0]?.id).toBe(started.id);
  });

  it("passes character and parent lineage through to the imported asset", async () => {
    const { service, importGeneratedPng } = createHarness({});

    const started = service.startJob({
      ...INPUT,
      characterId: "character-1",
      parentAssetId: "asset-identity",
    });
    const finished = await service.waitForJob(started.id);

    expect(finished.status).toBe("completed");
    expect(importGeneratedPng).toHaveBeenCalledWith(
      expect.objectContaining({
        characterId: "character-1",
        parentAssetId: "asset-identity",
      })
    );
  });

  it("rejects a second job while one is active", async () => {
    const { service } = createHarness({
      generate: vi.fn(
        (_jobId, _input, _progress, signal) =>
          new Promise<PixelAiGenerationResult>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new Error("aborted")));
          })
      ),
    });

    const first = service.startJob(INPUT);
    expect(() => service.startJob(INPUT)).toThrow(/already running/i);

    await service.cancelJob(first.id);
    const finished = await service.waitForJob(first.id);
    expect(finished.status).toBe("cancelled");
    expect(finished.error).toBeNull();
  });

  it("fails fast with the readiness message when the backend is not ready", async () => {
    const generate = vi.fn(async () => RESULT);
    const { service } = createHarness({
      getStatus: vi.fn(async () => ({
        ...READY_STATUS,
        state: "setup_required" as const,
        message: "nodes are missing",
      })),
      generate,
    });

    const started = service.startJob(INPUT);
    const finished = await service.waitForJob(started.id);

    expect(finished.status).toBe("failed");
    expect(finished.error).toBe("nodes are missing");
    expect(generate).not.toHaveBeenCalled();
  });

  it("runs a ready workflow when another workflow is missing models", async () => {
    const generate = vi.fn(async () => RESULT);
    const { service } = createHarness({
      getStatus: vi.fn(async () => ({
        ...READY_STATUS,
        state: "setup_required" as const,
        message: "models are missing",
        capabilities: [TEXT_CAPABILITY, REFERENCE_CAPABILITY],
      })),
      generate,
    });

    const started = service.startJob(INPUT);
    const finished = await service.waitForJob(started.id);

    expect(finished.status).toBe("completed");
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("blocks only the workflow whose own models are missing and explains where they go", async () => {
    const generate = vi.fn(async () => RESULT);
    const { service } = createHarness({
      getStatus: vi.fn(async () => ({
        ...READY_STATUS,
        state: "setup_required" as const,
        message: "models are missing",
        capabilities: [TEXT_CAPABILITY, REFERENCE_CAPABILITY],
      })),
      generate,
    });

    const started = service.startJob({
      ...INPUT,
      mode: "reference",
      reference: { subject: { kind: "dataUrl", dataUrl: "data:image/png;base64,AAAA" } },
    });
    const finished = await service.waitForJob(started.id);

    expect(finished.status).toBe("failed");
    expect(finished.error).toContain("flux-2-klein-4b.safetensors");
    expect(finished.error).toContain("models/diffusion_models/");
    expect(generate).not.toHaveBeenCalled();
  });

  it("forwards cancellation to the backend prompt", async () => {
    let markSeen: () => void = () => undefined;
    const seen = new Promise<void>((resolve) => {
      markSeen = resolve;
    });
    const cancelPrompt = vi.fn(async () => undefined);

    const { service } = createHarness({
      cancelPrompt,
      generate: vi.fn(
        (_jobId, _input, progress, signal) =>
          new Promise<PixelAiGenerationResult>((_resolve, reject) => {
            progress({ promptId: "prompt-9", stage: "Sampling" });
            markSeen();
            signal.addEventListener("abort", () => reject(new Error("aborted")));
          })
      ),
    });

    const started = service.startJob(INPUT);
    await seen;
    expect(await service.cancelJob(started.id)).toBe(true);
    expect(cancelPrompt).toHaveBeenCalledWith("prompt-9");

    const finished = await service.waitForJob(started.id);
    expect(finished.status).toBe("cancelled");
  });

  it("marks failed backend errors as failed jobs", async () => {
    const { service } = createHarness({
      generate: vi.fn(async () => {
        throw new Error("ComfyUI execution failed: CUDA out of memory");
      }),
    });

    const started = service.startJob(INPUT);
    const finished = await service.waitForJob(started.id);

    expect(finished.status).toBe("failed");
    expect(finished.error).toContain("CUDA out of memory");
  });

  it("imports every directional frame with its label and lineage", async () => {
    const { service, importGeneratedPng } = createHarness({
      generateDirections: vi.fn(async () => ({
        images: [
          { label: "S", png: Buffer.from("s"), width: 32, height: 32 },
          { label: "E", png: Buffer.from("e"), width: 32, height: 32 },
        ],
        promptId: "prompt-dir",
        metadata: {
          ...METADATA,
          workflowId: "directional_set" as const,
          workflowFile: "06_rotate_8_directions.api.json",
        },
      })),
    });

    const started = service.startJob({
      ...INPUT,
      mode: "directions",
      directionCount: 4,
      parentAssetId: "asset-ref",
      reference: { subject: { kind: "asset", assetId: "asset-ref" } },
    });
    const finished = await service.waitForJob(started.id);

    expect(finished.status).toBe("completed");
    expect(importGeneratedPng).toHaveBeenCalledTimes(2);
    expect(importGeneratedPng).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        name: "AI knight · S",
        parentAssetId: "asset-ref",
        generation: expect.objectContaining({
          settings: expect.objectContaining({ direction: "S", directions: 4 }),
        }),
      })
    );
    expect(finished.assetId).toBe("asset-1");
    expect(finished.assetIds).toEqual(["asset-1", "asset-1"]);
  });

  it("validates mode-specific requirements before queueing", async () => {
    const { service } = createHarness({});
    expect(() => service.startJob({ ...INPUT, width: 4 })).toThrow(/8 and 256/);
    expect(() => service.startJob({ ...INPUT, mode: "image" })).toThrow(/source image/i);
    expect(() =>
      service.startJob({ ...INPUT, mode: "reference", reference: undefined })
    ).toThrow(/subject reference/i);
    expect(() => service.startJob({ ...INPUT, mode: "inpaint" })).toThrow(/sprite to edit/i);
    expect(() => service.startJob({ ...INPUT, mode: "directions" })).toThrow(/front-facing/i);
    expect(() =>
      service.startJob({
        ...INPUT,
        mode: "directions",
        directionCount: 3 as 4,
        reference: { subject: { kind: "asset", assetId: "asset-ref" } },
      })
    ).toThrow(/4 or 8 directions/i);
    expect(service.listJobs()).toHaveLength(0);
  });
});
