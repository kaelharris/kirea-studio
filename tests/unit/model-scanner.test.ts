import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ModelScanner,
  parseComfyExtraModelPathsYaml,
  sniffSafetensorsArchitecture,
} from "../../src/main/models/model-scanner";
import { isGenerationSupportedArchitecture } from "../../src/shared/model-utils";
import type { AppSettings } from "../../src/shared/types";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-scanner-"));
  tempDirs.push(dir);
  return dir;
}

function makeScanSettings(root: string, externalComfyPath: string): AppSettings {
  return {
    runtimeMode: "external",
    externalComfyPath,
    comfyHost: "127.0.0.1",
    comfyPort: 8188,
    pixelBackendHost: "127.0.0.1",
    pixelBackendPort: 8189,
    pixelBackendWorkflowRoot: "",
    managedComfyPath: path.join(root, "managed_runtime"),
    autoStartRuntime: false,
    outputDirectory: path.join(root, "out"),
    extraModelDirs: [],
    downloadDirectory: path.join(root, "dl"),
    cacheDirectory: path.join(root, "cache"),
    tempDirectory: path.join(root, "tmp"),
    performanceProfile: "balanced",
    maxActiveJobs: 1,
    defaultBatchSize: 1,
    enableMemoryWarnings: true,
    theme: "dark",
    galleryLayout: "comfortable",
    startupPage: "home",
    defaultSampler: "dpmpp_2m",
    defaultScheduler: "karras",
    defaultSteps: 24,
    defaultCfg: 6.5,
    defaultOutputFormat: "png",
    checkUpdatesAutomatically: true,
    nsfwFilter: true,
    civitaiApiKeySet: false,
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("ModelScanner & YAML extra model paths parser", () => {
  it("classifies architectures from safetensors header tensor signatures", () => {
    const dir = makeTempDir();
    const writeHeader = (
      name: string,
      keys: string[],
      shape: number[] = [1]
    ): string => {
      const header = JSON.stringify(
        Object.fromEntries(
          keys.map((key) => [key, { dtype: "F16", shape, data_offsets: [0, 2] }])
        )
      );
      const head = Buffer.alloc(8);
      head.writeBigUInt64LE(BigInt(Buffer.byteLength(header)), 0);
      const filePath = path.join(dir, name);
      fs.writeFileSync(filePath, Buffer.concat([head, Buffer.from(header)]));
      return filePath;
    };

    expect(
      sniffSafetensorsArchitecture(
        writeHeader("anima.safetensors", [
          "model.diffusion_model.blocks.0.adaln_modulation_cross_attn.linear.weight",
        ])
      )
    ).toBe("anima");
    expect(
      sniffSafetensorsArchitecture(
        writeHeader("anima-blocks.safetensors", [
          "lora_unet_blocks_0_cross_attn_k_proj.lora_down.weight",
        ])
      )
    ).toBe("anima");
    expect(
      sniffSafetensorsArchitecture(
        writeHeader("anima-te.safetensors", [
          "lora_te_layers_0_mlp_down_proj.lora_down.weight",
        ])
      )
    ).toBe("anima");
    expect(
      sniffSafetensorsArchitecture(
        writeHeader("z.safetensors", ["lora_unet_layers_0_adaLN_modulation.1.weight"])
      )
    ).toBe("z_image");
    expect(
      sniffSafetensorsArchitecture(
        writeHeader("z-dit.safetensors", [
          "cap_embedder.0.weight",
          "context_refiner.0.attention.qkv.weight",
        ])
      )
    ).toBe("z_image");
    expect(
      sniffSafetensorsArchitecture(
        writeHeader("krea.safetensors", ["blocks.0.attn.gate.weight"])
      )
    ).toBe("krea2");
    expect(
      sniffSafetensorsArchitecture(
        writeHeader("flux.safetensors", ["double_blocks.0.img_attn.qkv.weight"])
      )
    ).toBe("flux");
    expect(
      sniffSafetensorsArchitecture(
        writeHeader("sdxl.safetensors", ["conditioner.embedders.1.model.ln_final.weight"])
      )
    ).toBe("sdxl");
    expect(
      sniffSafetensorsArchitecture(
        writeHeader("sd15.safetensors", ["conditioner.embedders.0.transformer.text_model.weight"])
      )
    ).toBe("sd15");
    expect(
      sniffSafetensorsArchitecture(
        writeHeader(
          "sdxl-diffusers-lora.safetensors",
          ["lora_unet_down_blocks_1_attentions_0_transformer_blocks_0_attn2_to_k.lora_down.weight"],
          [64, 2048]
        )
      )
    ).toBe("sdxl");
    expect(
      sniffSafetensorsArchitecture(
        writeHeader(
          "sd15-diffusers-lora.safetensors",
          ["lora_unet_down_blocks_0_attentions_0_transformer_blocks_0_attn2_to_k.lora_down.weight"],
          [32, 768]
        )
      )
    ).toBe("sd15");
    expect(
      sniffSafetensorsArchitecture(
        writeHeader("plain.safetensors", ["model.diffusion_model.input_blocks.0.weight"])
      )
    ).toBeNull();
  });

  it("parses ComfyUI extra_model_paths.yaml multiline and base_path entries", () => {
    const yaml = `
a1111:
    base_path: C:/SharedModels
    checkpoints: models/Stable-diffusion
    loras: |
      models/Lora
      models/LyCORIS
    vae: models/VAE
`;
    const parsed = parseComfyExtraModelPathsYaml(yaml, "C:\\Comfy");
    expect(parsed.byCategory.checkpoint).toContain(
      path.normalize("C:/SharedModels/models/Stable-diffusion")
    );
    expect(parsed.byCategory.lora).toHaveLength(2);
    expect(parsed.byCategory.vae).toContain(
      path.normalize("C:/SharedModels/models/VAE")
    );
  });

  it("scans checkpoints/loras, ignores placeholders, detects duplicates and incomplete files", async () => {
    const root = makeTempDir();
    const externalComfy = path.join(root, "ext_comfy");
    const managedModels = path.join(root, "managed_models");

    fs.mkdirSync(path.join(externalComfy, "models", "checkpoints", "SDXL"), { recursive: true });
    fs.mkdirSync(path.join(externalComfy, "models", "loras"), { recursive: true });
    fs.mkdirSync(path.join(managedModels, "checkpoints"), { recursive: true });

    // 0-byte placeholder should be skipped
    fs.writeFileSync(
      path.join(externalComfy, "models", "checkpoints", "put_checkpoints_here"),
      ""
    );

    const payload = Buffer.alloc(1024, 7);
    fs.writeFileSync(
      path.join(externalComfy, "models", "checkpoints", "SDXL", "novaAnimeXL_v1.safetensors"),
      payload
    );
    // Exact duplicate filename + size in managed models dir
    fs.writeFileSync(
      path.join(managedModels, "checkpoints", "novaAnimeXL_v1.safetensors"),
      payload
    );
    // Partial download file
    fs.writeFileSync(
      path.join(externalComfy, "models", "loras", "style_lora.safetensors.part"),
      Buffer.alloc(256, 3)
    );

    const settings: AppSettings = {
      runtimeMode: "external",
      externalComfyPath: externalComfy,
      comfyHost: "127.0.0.1",
      comfyPort: 8188,
      pixelBackendHost: "127.0.0.1",
      pixelBackendPort: 8189,
      pixelBackendWorkflowRoot: "",
      managedComfyPath: path.join(root, "managed_runtime"),
      autoStartRuntime: false,
      outputDirectory: path.join(root, "out"),
      extraModelDirs: [],
      downloadDirectory: path.join(root, "dl"),
      cacheDirectory: path.join(root, "cache"),
      tempDirectory: path.join(root, "tmp"),
      performanceProfile: "balanced",
      maxActiveJobs: 1,
      defaultBatchSize: 1,
      enableMemoryWarnings: true,
      theme: "dark",
      galleryLayout: "comfortable",
      startupPage: "home",
      defaultSampler: "dpmpp_2m",
      defaultScheduler: "karras",
      defaultSteps: 24,
      defaultCfg: 6.5,
      defaultOutputFormat: "png",
      checkUpdatesAutomatically: true,
      nsfwFilter: true,
      civitaiApiKeySet: false,
    };

    const scanner = new ModelScanner();
    const models = await scanner.scanAll(settings, managedModels, null);

    const placeholders = models.filter((m) => m.name.includes("put_checkpoints_here"));
    expect(placeholders).toHaveLength(0);

    const sdxlModels = models.filter((m) => m.name === "novaAnimeXL_v1");
    expect(sdxlModels).toHaveLength(2);
    expect(sdxlModels.some((m) => m.isDuplicate)).toBe(true);

    const partial = models.find((m) => m.isIncomplete);
    expect(partial).toBeDefined();
    expect(partial?.installed).toBe(false);
  });

  it("reads .json sidecars for description, base model, trigger words, and relative previews", async () => {
    const root = makeTempDir();
    const externalComfy = path.join(root, "ext_comfy");
    const managedModels = path.join(root, "managed_models");
    const checkpointDir = path.join(externalComfy, "models", "checkpoints");

    fs.mkdirSync(checkpointDir, { recursive: true });
    fs.mkdirSync(managedModels, { recursive: true });

    const modelPath = path.join(checkpointDir, "mysteryMix.safetensors");
    fs.writeFileSync(modelPath, Buffer.alloc(2048, 1));
    fs.writeFileSync(path.join(checkpointDir, "cover.png"), Buffer.alloc(64, 2));
    fs.writeFileSync(
      path.join(checkpointDir, "mysteryMix.json"),
      JSON.stringify({
        description: "<p>Great <b>model</b> for portraits</p>",
        baseModel: "SDXL 1.0",
        trainedWords: ["mystery sty", "soft glow"],
        previewPath: "cover.png",
      })
    );

    const scanner = new ModelScanner();
    const models = await scanner.scanAll(
      makeScanSettings(root, externalComfy),
      managedModels,
      null
    );
    const record = models.find((m) => m.name === "mysteryMix");
    expect(record).toBeDefined();
    expect(record?.architecture).toBe("sdxl");
    expect(record?.description).toBe("Great model for portraits");
    expect(record?.discovery?.description).toBe("Great model for portraits");
    expect(record?.discovery?.triggerWords).toEqual(["mystery sty", "soft glow"]);
    expect(record?.discovery?.baseModel).toBe("SDXL 1.0");
    expect(record?.discovery?.previewPath).toBe(
      path.normalize(path.join(checkpointDir, "cover.png"))
    );
    expect(record?.compatibleWorkflows).toContain("t2i_sdxl_base");
  });

  it("reads .civitai.info sidecars with alternate keys and comma-separated triggers", async () => {
    const root = makeTempDir();
    const externalComfy = path.join(root, "ext_comfy");
    const managedModels = path.join(root, "managed_models");
    const checkpointDir = path.join(externalComfy, "models", "checkpoints");

    fs.mkdirSync(checkpointDir, { recursive: true });
    fs.mkdirSync(managedModels, { recursive: true });

    fs.writeFileSync(
      path.join(checkpointDir, "legacyBrush.safetensors"),
      Buffer.alloc(2048, 3)
    );
    fs.writeFileSync(
      path.join(checkpointDir, "legacyBrush.civitai.info"),
      JSON.stringify({
        modelDescription: "<div>Ink &amp; wash style</div>",
        base_model: "SD 1.5",
        trigger_words: "alpha, beta",
      })
    );

    const scanner = new ModelScanner();
    const models = await scanner.scanAll(
      makeScanSettings(root, externalComfy),
      managedModels,
      null
    );
    const record = models.find((m) => m.name === "legacyBrush");
    expect(record).toBeDefined();
    expect(record?.architecture).toBe("sd15");
    expect(record?.discovery?.description).toBe("Ink &amp; wash style");
    expect(record?.discovery?.triggerWords).toEqual(["alpha", "beta"]);
    expect(record?.compatibleWorkflows).toContain("i2i_sd15_base");
  });

  it("discovers an adjacent <stem>.preview image without any sidecar JSON", async () => {
    const root = makeTempDir();
    const externalComfy = path.join(root, "ext_comfy");
    const managedModels = path.join(root, "managed_models");
    const loraDir = path.join(externalComfy, "models", "loras");

    fs.mkdirSync(loraDir, { recursive: true });
    fs.mkdirSync(managedModels, { recursive: true });

    fs.writeFileSync(path.join(loraDir, "brushStroke.safetensors"), Buffer.alloc(1024, 4));
    fs.writeFileSync(path.join(loraDir, "brushStroke.preview.png"), Buffer.alloc(48, 5));

    const scanner = new ModelScanner();
    const models = await scanner.scanAll(
      makeScanSettings(root, externalComfy),
      managedModels,
      null
    );
    const record = models.find((m) => m.name === "brushStroke");
    expect(record).toBeDefined();
    expect(record?.discovery?.previewPath).toBe(
      path.normalize(path.join(loraDir, "brushStroke.preview.png"))
    );
    expect(record?.discovery?.description).toBeNull();
  });

  it("labels Flux checkpoints without claiming generation support", async () => {
    const root = makeTempDir();
    const externalComfy = path.join(root, "ext_comfy");
    const managedModels = path.join(root, "managed_models");
    const checkpointDir = path.join(externalComfy, "models", "checkpoints");

    fs.mkdirSync(checkpointDir, { recursive: true });
    fs.mkdirSync(managedModels, { recursive: true });

    fs.writeFileSync(path.join(checkpointDir, "flux1-dev.safetensors"), Buffer.alloc(4096, 9));

    const scanner = new ModelScanner();
    const models = await scanner.scanAll(
      makeScanSettings(root, externalComfy),
      managedModels,
      null
    );
    const record = models.find((m) => m.name === "flux1-dev");
    expect(record).toBeDefined();
    expect(record?.architecture).toBe("flux");
    expect(record?.compatibleWorkflows).toEqual([]);
    expect(isGenerationSupportedArchitecture("flux")).toBe(false);
  });
});

