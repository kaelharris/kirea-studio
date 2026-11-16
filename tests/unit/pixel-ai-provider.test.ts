import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComfyApiError, type ComfyApiClient } from "../../src/main/comfy/comfy-adapter";
import type { ComfyWsClient } from "../../src/main/comfy/comfy-ws";
import type { ComfyPromptGraph } from "../../src/main/comfy/comfy-types";
import { StudioDatabase } from "../../src/main/db/database";
import { StudioRepository } from "../../src/main/db/repositories";
import { StudioLogger } from "../../src/main/logger";
import type { StudioPaths } from "../../src/main/paths";
import {
  PixelAiCancelledError,
  SpriteKilnProvider,
} from "../../src/main/pixel/ai/spritekiln-provider";
import type { PixelAiGenerateInput } from "../../src/shared/pixel-ai-types";
import type { AppSettings } from "../../src/shared/types";

const tempDirs: string[] = [];
const databases: StudioDatabase[] = [];

const TEXT_WORKFLOW = "01_text_to_pixel_art.api.json";
const IMAGE_WORKFLOW = "02_image_to_pixel_art.api.json";
const REFERENCE_WORKFLOW = "03_reference_to_pixel_art.api.json";
const INPAINT_WORKFLOW = "05_inpaint_pixel_art.api.json";
const DIRECTION_WORKFLOW = "06_rotate_8_directions.api.json";

type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

function node(classType: string, inputs: Record<string, unknown>) {
  return { class_type: classType, inputs };
}

const TEXT_GRAPH: Graph = {
  "1": node("UNETLoader", { unet_name: "z_image_turbo.safetensors", weight_dtype: "default" }),
  "2": node("SK_StylePreset", {
    subject: "",
    style: "game asset",
    model: "z_image (pixel LoRA)",
    art_width: 512,
    art_height: 512,
    colors: 16,
    background: "white",
    long_side: 1024,
    extra: "",
  }),
  "11": node("KSampler", { seed: 0, steps: 8, model: ["1", 0], positive: ["2", 0] }),
  "18": node("SK_Palette", { image: ["11", 0], source: "auto", colors: 16 }),
  "20": node("SK_SavePixelArt", { images: ["18", 0], filename_prefix: "spritekiln/x" }),
};

const IMAGE_GRAPH: Graph = {
  "2": node("LoadImage", { image: "input.png" }),
  "3": node("PrimitiveInt", { value: 32 }),
  "4": node("PrimitiveInt", { value: 32 }),
  "5": node("PrimitiveInt", { value: 16 }),
  "7": node("SK_Palette", { image: ["2", 0], source: "auto", colors: 16 }),
  "8": node("SK_SavePixelArt", { images: ["7", 0], filename_prefix: "spritekiln/x" }),
  "16": node("CLIPTextEncode", { text: "pixel art", clip: ["2", 0] }),
  "18": node("KSampler", {
    seed: 0,
    steps: 8,
    denoise: 0.6,
    positive: ["16", 0],
    model: ["2", 0],
  }),
  "22": node("SK_Palette", { image: ["18", 0], source: "auto", colors: 16 }),
  "23": node("SK_SavePixelArt", { images: ["22", 0], filename_prefix: "spritekiln/x" }),
};

const REFERENCE_GRAPH: Graph = {
  "2": node("SK_StylePreset", {
    subject: "",
    style: "game asset",
    model: "flux2 klein (pixel LoRA)",
    art_width: 512,
    art_height: 512,
    colors: 16,
    background: "white",
    long_side: 1024,
  }),
  "4": node("LoraLoaderModelOnly", {
    lora_name: "pixel_lora.safetensors",
    strength_model: 0.7,
    model: ["2", 0],
  }),
  "7": node("LoadImage", { image: "subject.png" }),
  "8": node("LoadImage", { image: "style.png" }),
  "19": node("RandomNoise", { noise_seed: 0 }),
  "31": node("SK_Palette", { image: ["8", 0], source: "auto", colors: 16 }),
  "33": node("SK_SavePixelArt", {
    images: ["31", 0],
    model: ["4", 0],
    noise: ["19", 0],
    subject: ["7", 0],
    filename_prefix: "spritekiln/x",
  }),
};

const INPAINT_GRAPH: Graph = {
  "2": node("LoadImage", { image: "base.png" }),
  "4": node("SK_RegionMask", { x: 0, y: 0, width: 8, height: 8, grow: 1 }),
  "5": node("SK_ToCanvas", { long_side: 1024, image: ["2", 0] }),
  "12": node("CLIPTextEncode", { text: "", image: ["5", 0] }),
  "16": node("RandomNoise", { noise_seed: 0, positive: ["12", 0] }),
  "23": node("SK_PixelPerfect", { width: 32, height: 32, image: ["16", 0], mask: ["4", 0] }),
  "25": node("SK_Palette", { image: ["23", 0], source: "auto", colors: 16 }),
  "27": node("SK_SavePixelArt", { images: ["25", 0], filename_prefix: "spritekiln/x" }),
};

const DIRECTION_GRAPH: Graph = {
  "1": node("UNETLoader", { unet_name: "z_image_turbo.safetensors", weight_dtype: "default" }),
  "2": node("LoadImage", { image: "front.png" }),
  "4": node("SK_ToCanvas", { long_side: 1024, image: ["2", 0] }),
  "5": node("SK_DirectionPrompts", { directions: "8", image: ["4", 0] }),
  "15": node("RandomNoise", { noise_seed: 0 }),
  "22": node("SK_PixelPerfect", { width: 64, height: 64, image: ["15", 0] }),
  "24": node("SK_Palette", { image: ["22", 0], source: "auto", colors: 16 }),
  "26": node("SK_SavePixelArt", {
    images: ["24", 0],
    model: ["1", 0],
    filename_prefix: "spritekiln/x",
  }),
};

const ALL_GRAPHS = [TEXT_GRAPH, IMAGE_GRAPH, REFERENCE_GRAPH, INPAINT_GRAPH, DIRECTION_GRAPH];

const SYSTEM_STATS = {
  system: {
    comfyui_version: "0.41.0",
    python_version: "3.12.4",
    pytorch_version: "2.7.1",
    ram_total: 34_359_738_368,
    ram_free: 16_000_000_000,
  },
  devices: [
    {
      name: "NVIDIA GeForce RTX 4070 Ti SUPER",
      type: "cuda",
      vram_total: 17_179_869_184,
      vram_free: 15_000_000_000,
    },
  ],
};

function buildObjectInfo(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const info: Record<string, unknown> = {};
  for (const graph of ALL_GRAPHS) {
    for (const value of Object.values(graph)) {
      info[value.class_type] = {};
    }
  }
  info.UNETLoader = {
    input: { required: { unet_name: [["z_image_turbo.safetensors", "other.safetensors"]] } },
  };
  info.LoraLoaderModelOnly = {
    input: { required: { lora_name: [["pixel_lora.safetensors"]] } },
  };
  return { ...info, ...overrides };
}

function createTempPaths(): StayPathsWithRoot {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-pixel-ai-"));
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
  fs.mkdirSync(paths.pixelAiTempDir, { recursive: true });
  return { root, paths };
}

interface StayPathsWithRoot {
  root: string;
  paths: StudioPaths;
}

function writeWorkflowFiles(root: string): void {
  const dir = path.join(root, "workflows", "api");
  fs.mkdirSync(dir, { recursive: true });
  const files: Array<[string, Graph]> = [
    [TEXT_WORKFLOW, TEXT_GRAPH],
    [IMAGE_WORKFLOW, IMAGE_GRAPH],
    [REFERENCE_WORKFLOW, REFERENCE_GRAPH],
    [INPAINT_WORKFLOW, INPAINT_GRAPH],
    [DIRECTION_WORKFLOW, DIRECTION_GRAPH],
  ];
  for (const [file, graph] of files) {
    fs.writeFileSync(path.join(dir, file), JSON.stringify(graph), "utf8");
  }
}

function createHarness(options: { workflows?: boolean } = {}): {
  root: string;
  paths: StudioPaths;
  repo: StudioRepository;
  logger: StudioLogger;
  provider: (
    overrides?: Partial<AppSettings>,
    providerOverrides?: { api?: unknown; ws?: unknown; timeoutMs?: number; pollMs?: number }
  ) => SpriteKilnProvider;
  settings: (overrides?: Partial<AppSettings>) => AppSettings;
} {
  const { root, paths } = createTempPaths();
  if (options.workflows !== false) writeWorkflowFiles(root);
  const db = new StudioDatabase(paths.dbPath);
  databases.push(db);
  const repo = new StudioRepository(db);
  const logger = new StudioLogger(paths.logsDir);

  const baseSettings: AppSettings = {
    runtimeMode: "external",
    externalComfyPath: "",
    comfyHost: "127.0.0.1",
    comfyPort: 8188,
    pixelBackendHost: "127.0.0.1",
    pixelBackendPort: 8190,
    pixelBackendWorkflowRoot: root,
    managedComfyPath: "",
    autoStartRuntime: false,
    outputDirectory: paths.defaultOutputDir,
    extraModelDirs: [],
    downloadDirectory: paths.defaultDownloadsDir,
    cacheDirectory: paths.cacheDir,
    tempDirectory: paths.tempDir,
    performanceProfile: "balanced",
    autoScanModels: true,
    scanOnStartup: true,
    previewQuality: "medium",
    theme: "dark",
    confirmDelete: true,
    maxParallelJobs: 1,
    keepInputsInCache: true,
    civitaiApiKeySet: false,
    onboardingComplete: true,
    lastSelectedModel: "",
    lastSelectedWorkflow: "",
  } as unknown as AppSettings;

  const settings = (overrides?: Partial<AppSettings>): AppSettings => ({
    ...baseSettings,
    ...overrides,
  });

  const provider = (
    overrides?: Partial<AppSettings>,
    providerOverrides: {
      api?: unknown;
      ws?: unknown;
      timeoutMs?: number;
      pollMs?: number;
    } = {}
  ): SpriteKilnProvider => {
    const current = settings(overrides);
    return new SpriteKilnProvider(paths, repo, () => current, logger, {
      createApiClient: () => (providerOverrides.api ?? {}) as ComfyApiClient,
      createWsClient: () => (providerOverrides.ws ?? new FakeWs()) as unknown as ComfyWsClient,
      timeoutMs: providerOverrides.timeoutMs,
      pollMs: providerOverrides.pollMs,
    });
  };

  return { root, paths, repo, logger, provider, settings };
}

class FakeWs extends EventEmitter {
  connected = false;
  connect(): void {
    this.connected = true;
    this.emit("connection", true);
  }
  disconnect(): void {
    this.connected = false;
  }
}

async function tinyPng(color = { r: 255, g: 0, b: 0, alpha: 1 }): Promise<Buffer> {
  return sharp({ create: { width: 2, height: 2, channels: 4, background: color } })
    .png()
    .toBuffer();
}

function dataUrl(png: Buffer): string {
  return `data:image/png;base64,${png.toString("base64")}`;
}

function createApi(options: {
  stats?: unknown;
  objectInfo?: unknown;
  history?: unknown;
  queue?: unknown;
  submit?: (graph: ComfyPromptGraph) => unknown;
  statsError?: Error;
}) {
  const submitted: ComfyPromptGraph[] = [];
  let uploads = 0;
  const api = {
    getSystemStats: vi.fn(async () => {
      if (options.statsError) throw options.statsError;
      return options.stats ?? SYSTEM_STATS;
    }),
    getAllObjectInfo: vi.fn(async () => options.objectInfo ?? buildObjectInfo()),
    submitPrompt: vi.fn(async (graph: ComfyPromptGraph) => {
      submitted.push(JSON.parse(JSON.stringify(graph)));
      return options.submit?.(graph) ?? { prompt_id: "prompt-1", number: 1, node_errors: {} };
    }),
    getQueue: vi.fn(async () => options.queue ?? { queue_running: [], queue_pending: [] }),
    getHistory: vi.fn(async () => options.history ?? null),
    fetchOutputBuffer: vi.fn(async () => tinyPng()),
    uploadImage: vi.fn(async () => ({
      name: `uploaded-${++uploads}.png`,
      subfolder: "",
      type: "input",
    })),
    deleteQueueItems: vi.fn(async () => undefined),
    interrupt: vi.fn(async () => undefined),
    getWsUrl: vi.fn(() => "ws://127.0.0.1:8190/ws"),
  };
  return { api, submitted };
}

function successHistory(saveNode: string): unknown {
  return {
    status: { status_str: "success", completed: true, messages: [] },
    outputs: {
      [saveNode]: {
        images: [
          { filename: "kirea_1.png", subfolder: "spritekiln", type: "output" },
          { filename: "kirea_1_x4.png", subfolder: "spritekiln", type: "output" },
        ],
      },
    },
  };
}

function multiHistory(saveNode: string, count: number): unknown {
  return {
    status: { status_str: "success", completed: true, messages: [] },
    outputs: {
      [saveNode]: {
        images: Array.from({ length: count }, (_, index) => ({
          filename: `kirea_1_f0${index}.png`,
          subfolder: "spritekiln",
          type: "output",
        })),
      },
    },
  };
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

const baseInput: PixelAiGenerateInput = {
  projectId: "project",
  kind: "character",
  name: "Test sprite",
  mode: "text",
  prompt: "a small knight",
  width: 32,
  height: 32,
  paletteId: "kirea",
  seed: 1234,
  style: "game asset",
};

describe("SpriteKilnProvider.getStatus", () => {
  it("reports ready when the backend, nodes, models and workflows check out", async () => {
    const harness = createHarness();
    const { api } = createApi({});
    const status = await harness.provider(undefined, { api }).getStatus();
    expect(status.state).toBe("ready");
    expect(status.reachable).toBe(true);
    expect(status.comfyVersion).toBe("0.41.0");
    expect(status.capabilities).toHaveLength(6);
    expect(status.capabilities.every((capability) => capability.ready)).toBe(true);
    expect(status.hardware?.devices[0]?.vramTotalBytes).toBe(17_179_869_184);
  });

  it("reports setup_required when a referenced model is absent from the loader enum", async () => {
    const harness = createHarness();
    const { api } = createApi({
      objectInfo: buildObjectInfo({
        UNETLoader: {
          input: { required: { unet_name: [["other.safetensors"]] } },
        },
      }),
    });
    const status = await harness.provider(undefined, { api }).getStatus();
    expect(status.state).toBe("setup_required");
    const requirement = status.capabilities
      .flatMap((capability) => capability.requirements)
      .find((entry) => entry.kind === "model" && entry.name === "z_image_turbo.safetensors");
    expect(requirement?.state).toBe("missing");
    expect(requirement?.detail).toContain("models/diffusion_models/");
    expect(requirement?.detail).toContain("z_image_turbo.safetensors");
    expect(status.message).toContain("z_image_turbo.safetensors");
    expect(status.message).toContain("restart");
  });

  it("reports unverified when a loader exposes no enumerable model list", async () => {
    const harness = createHarness();
    const { api } = createApi({
      objectInfo: buildObjectInfo({ LoraLoaderModelOnly: {} }),
    });
    const status = await harness.provider(undefined, { api }).getStatus();
    expect(status.state).toBe("unverified");
    const capability = status.capabilities.find((entry) => entry.id === "reference_to_pixel");
    expect(capability?.unverified).toBe(true);
    expect(capability?.ready).toBe(false);
  });

  it("reports unreachable when the dedicated backend cannot be reached", async () => {
    const harness = createHarness();
    const { api } = createApi({ statsError: new Error("ECONNREFUSED") });
    const status = await harness.provider(undefined, { api }).getStatus();
    expect(status.state).toBe("unreachable");
    expect(status.reachable).toBe(false);
    expect(status.message).toContain("not reachable");
  });

  it("reports workflows_missing when the configured checkout has no API workflows", async () => {
    const harness = createHarness({ workflows: false });
    const { api } = createApi({});
    const status = await harness.provider(undefined, { api }).getStatus();
    expect(status.state).toBe("workflows_missing");
    expect(status.capabilities.every((capability) => !capability.ready)).toBe(true);
  });

  it("rejects non-loopback backend hosts without touching the primary runtime", async () => {
    const harness = createHarness();
    const { api } = createApi({});
    const settings = harness.settings();
    const status = await harness
      .provider({ pixelBackendHost: "192.168.1.50" }, { api })
      .getStatus();
    expect(status.state).toBe("setup_required");
    expect(status.configured).toBe(false);
    expect(status.message).toContain("loopback");
    expect(settings.comfyHost).toBe("127.0.0.1");
    expect(settings.comfyPort).toBe(8188);
  });
});

describe("SpriteKilnProvider.generate", () => {
  it("builds a text-to-pixel graph with prompt, seed, palette, style and output node", async () => {
    const harness = createHarness();
    const { api, submitted } = createApi({ history: successHistory("20") });
    const provider = harness.provider(undefined, { api });

    const result = await provider.generate(
      "job-1",
      { ...baseInput, negativePrompt: "blurry", steps: 12, longSide: 1536, transparent: true },
      () => undefined,
      new AbortController().signal
    );

    const graph = submitted[0] as unknown as Graph;
    expect(graph["2"]!.inputs.subject).toBe("a small knight");
    expect(graph["2"]!.inputs.style).toBe("game asset");
    expect(graph["2"]!.inputs.model).toBe("z_image (pixel LoRA)");
    expect(graph["2"]!.inputs.art_width).toBe(32);
    expect(graph["2"]!.inputs.background).toBe("white");
    expect(graph["2"]!.inputs.long_side).toBe(1536);
    expect(graph["11"]!.inputs.seed).toBe(1234);
    expect(graph["11"]!.inputs.steps).toBe(12);
    expect(graph["18"]!.inputs.source).toBe("hex");
    expect(graph["20"]!.inputs.filename_prefix).toMatch(/^spritekiln\/kirea_/);
    expect(graph["20"]!.inputs.as_animation).toBe(false);

    expect(result.width).toBe(32);
    expect(result.height).toBe(32);
    expect(result.metadata.backend).toBe("spritekiln");
    expect(result.metadata.workflowId).toBe("text_to_pixel");
    expect(result.metadata.negativePrompt).toBe("blurry");
    expect(result.metadata.seed).toBe(1234);
    expect(result.metadata.model).toBe("z_image_turbo.safetensors");
    expect(result.metadata.palette.length).toBeGreaterThanOrEqual(5);
    expect(result.metadata.palette.every((color) => /^#[0-9a-f]{6}$/i.test(color))).toBe(true);
    expect(graph["18"]!.inputs.hex_palette).toBe(result.metadata.palette.join(" "));
    expect(result.metadata.notes.join(" ")).toContain("Negative prompts are stored but not applied");
  });

  it("converts an uploaded image directly through the palette node", async () => {
    const harness = createHarness();
    const { api, submitted } = createApi({ history: successHistory("8") });
    const provider = harness.provider(undefined, { api });
    const png = await tinyPng({ r: 0, g: 128, b: 255, alpha: 1 });

    const result = await provider.generate(
      "job-2",
      {
        ...baseInput,
        mode: "image",
        prompt: "",
        conversion: "direct",
        image: { kind: "dataUrl", dataUrl: dataUrl(png), fileName: "source.png" },
      },
      () => undefined,
      new AbortController().signal
    );

    const graph = submitted[0] as unknown as Graph;
    expect(graph["2"]!.inputs.image).toBe("uploaded-1.png");
    expect(graph["3"]!.inputs.value).toBe(32);
    expect(graph["4"]!.inputs.value).toBe(32);
    expect(graph["7"]!.inputs.source).toBe("hex");
    expect(result.metadata.workflowId).toBe("image_to_pixel_direct");
    expect(result.metadata.notes.join(" ")).toContain("Direct conversion preserves the source alpha");
    expect(fs.readdirSync(harness.paths.pixelAiTempDir)).toHaveLength(0);
  });

  it("redraws an image with prompt, seed and denoise strength", async () => {
    const harness = createHarness();
    const { api, submitted } = createApi({ history: successHistory("23") });
    const provider = harness.provider(undefined, { api });
    const png = await tinyPng({ r: 10, g: 20, b: 30, alpha: 1 });

    await provider.generate(
      "job-3",
      {
        ...baseInput,
        mode: "image",
        conversion: "ai",
        prompt: "turn this into a mage",
        strength: 0.35,
        steps: 10,
        image: { kind: "dataUrl", dataUrl: dataUrl(png) },
      },
      () => undefined,
      new AbortController().signal
    );

    const graph = submitted[0] as unknown as Graph;
    expect(graph["16"]!.inputs.text).toBe("turn this into a mage");
    expect(graph["18"]!.inputs.seed).toBe(1234);
    expect(graph["18"]!.inputs.denoise).toBe(0.35);
    expect(graph["22"]!.inputs.source).toBe("hex");
  });

  it("reuses the subject image as the style reference and records reference metadata", async () => {
    const harness = createHarness();
    const { api, submitted } = createApi({ history: successHistory("33") });
    const provider = harness.provider(undefined, { api });
    const png = await tinyPng({ r: 200, g: 100, b: 50, alpha: 1 });

    const result = await provider.generate(
      "job-4",
      {
        ...baseInput,
        mode: "reference",
        prompt: "a cyber knight",
        style: "16-bit (SNES / Mega Drive)",
        reference: { subject: { kind: "dataUrl", dataUrl: dataUrl(png) } },
        strength: 1.2,
      },
      () => undefined,
      new AbortController().signal
    );

    const graph = submitted[0] as unknown as Graph;
    expect(graph["2"]!.inputs.subject).toBe("a cyber knight");
    expect(graph["2"]!.inputs.style).toBe("16-bit (SNES / Mega Drive)");
    expect(graph["4"]!.inputs.strength_model).toBe(1.2);
    expect(graph["7"]!.inputs.image).not.toBe(graph["8"]!.inputs.image);
    expect(result.metadata.reference?.subject).toEqual({ source: "upload", label: "uploaded image" });
    expect(result.metadata.notes.join(" ")).toContain("No style reference was supplied");
  });

  it("maps an inpaint request to the rectangle mask workflow", async () => {
    const harness = createHarness();
    const { api, submitted } = createApi({ history: successHistory("27") });
    const provider = harness.provider(undefined, { api });
    const png = await tinyPng({ r: 30, g: 60, b: 90, alpha: 1 });

    await provider.generate(
      "job-5",
      {
        ...baseInput,
        mode: "inpaint",
        prompt: "add a glowing gem",
        inpaint: {
          base: { kind: "dataUrl", dataUrl: dataUrl(png) },
          region: { x: 4, y: 5, width: 10, height: 12, grow: 2 },
        },
      },
      () => undefined,
      new AbortController().signal
    );

    const graph = submitted[0] as unknown as Graph;
    expect(graph["4"]!.inputs).toMatchObject({ x: 4, y: 5, width: 10, height: 12, grow: 2 });
    expect(graph["12"]!.inputs.text).toBe("add a glowing gem");
    expect(graph["23"]!.inputs.width).toBe(32);
    expect(graph["23"]!.inputs.height).toBe(32);
  });

  it("does not submit when the signal is already aborted", async () => {
    const harness = createHarness();
    const { api, submitted } = createApi({});
    const provider = harness.provider(undefined, { api });
    const controller = new AbortController();
    controller.abort();

    await expect(
      provider.generate("job-6", baseInput, () => undefined, controller.signal)
    ).rejects.toBeInstanceOf(PixelAiCancelledError);
    expect(submitted).toHaveLength(0);
  });

  it("cancels a submitted prompt when the job is aborted mid-run", async () => {
    const harness = createHarness();
    const { api } = createApi({ history: null });
    const provider = harness.provider(undefined, { api });
    const controller = new AbortController();

    const pending = provider.generate(
      "job-7",
      baseInput,
      (progress) => {
        if (progress.promptId) controller.abort();
      },
      controller.signal
    );

    await expect(pending).rejects.toBeInstanceOf(PixelAiCancelledError);
    expect(api.deleteQueueItems).toHaveBeenCalledWith(["prompt-1"]);
    expect(api.interrupt).toHaveBeenCalledWith("prompt-1");
  });

  it("times out when ComfyUI never produces history output", async () => {
    const harness = createHarness();
    const { api } = createApi({
      history: null,
      queue: { queue_running: [["0", "prompt-1", {}, {}, {}]], queue_pending: [] },
    });
    const provider = harness.provider(undefined, { api, timeoutMs: 80, pollMs: 10 });

    await expect(
      provider.generate("job-8", baseInput, () => undefined, new AbortController().signal)
    ).rejects.toThrow(/timed out/i);
  });

  it("surfaces execution errors reported by the backend", async () => {
    const harness = createHarness();
    const { api } = createApi({
      history: {
        status: { status_str: "error", completed: false, messages: [["execution_error", { exception_message: "CUDA out of memory" }]] },
        outputs: {},
      },
    });
    const provider = harness.provider(undefined, { api });

    await expect(
      provider.generate("job-9", baseInput, () => undefined, new AbortController().signal)
    ).rejects.toThrow("CUDA out of memory");
  });

  it("reports which node rejected the workflow and how to fix it", async () => {
    const harness = createHarness();
    const { api } = createApi({
      submit: () => ({
        prompt_id: null,
        node_errors: {
          "3": {
            class_type: "UNETLoader",
            errors: [
              {
                message: "Value not in list",
                details: "unet_name: 'flux-2-klein-4b.safetensors' not in list",
              },
            ],
          },
        },
      }),
    });
    const provider = harness.provider(undefined, { api });

    const pending = provider.generate(
      "job-10",
      baseInput,
      () => undefined,
      new AbortController().signal
    );

    await expect(pending).rejects.toThrow(/UNETLoader/);
    await expect(pending).rejects.toThrow(/flux-2-klein-4b\.safetensors/);
    await expect(pending).rejects.toThrow(/model and node/);
  });

  it("parses HTTP 400 node errors into a readable rejection message", async () => {
    const harness = createHarness();
    const { api } = createApi({
      submit: () => {
        throw new ComfyApiError(
          "ComfyUI POST /prompt failed (400)",
          400,
          JSON.stringify({
            error: { type: "prompt_outputs_failed_validation" },
            node_errors: {
              "7": {
                class_type: "LoraLoaderModelOnly",
                errors: [
                  {
                    message: "Value not in list",
                    details:
                      "lora_name: 'spritekiln_klein_pixel_art.safetensors' not in list",
                  },
                ],
              },
            },
          })
        );
      },
    });
    const provider = harness.provider(undefined, { api });

    await expect(
      provider.generate("job-11", baseInput, () => undefined, new AbortController().signal)
    ).rejects.toThrow(/ComfyUI rejected the workflow: LoraLoaderModelOnly: .*spritekiln_klein_pixel_art/);
  });
});

describe("SpriteKilnProvider.generateDirections", () => {
  it("configures workflow 06 and returns one labelled image per direction", async () => {
    const harness = createHarness();
    const { api, submitted } = createApi({ history: multiHistory("26", 4) });
    const provider = harness.provider(undefined, { api });
    const source = await tinyPng();

    const result = await provider.generateDirections(
      "job-dir",
      {
        ...baseInput,
        mode: "directions",
        directionCount: 4,
        reference: { subject: { kind: "dataUrl", dataUrl: dataUrl(source) } },
      },
      () => undefined,
      new AbortController().signal
    );

    expect(result.images.map((image) => image.label)).toEqual(["S", "E", "N", "W"]);
    expect(result.images.every((image) => image.png.length > 0)).toBe(true);
    expect(result.metadata.workflowId).toBe("directional_set");
    expect(result.metadata.reference?.subject.source).toBe("upload");

    const graph = submitted[0]!;
    expect(graph["5"]?.inputs.directions).toBe("4");
    expect(graph["5"]?.inputs.mirror_west).toBe(true);
    expect(graph["22"]?.inputs.width).toBe(32);
    expect(graph["24"]?.inputs.hex_palette).toContain("#191920");
    expect(graph["26"]?.inputs.as_animation).toBe(false);
  });

  it("refuses a direction result with the wrong number of frames", async () => {
    const harness = createHarness();
    const { api } = createApi({ history: multiHistory("26", 3) });
    const provider = harness.provider(undefined, { api });
    const source = await tinyPng();

    await expect(
      provider.generateDirections(
        "job-dir",
        {
          ...baseInput,
          mode: "directions",
          directionCount: 4,
          reference: { subject: { kind: "dataUrl", dataUrl: dataUrl(source) } },
        },
        () => undefined,
        new AbortController().signal
      )
    ).rejects.toThrow(/returned 3 direction images; expected 4/);
  });
});
