import { describe, expect, it } from "vitest";
import {
  calculateDimensionsForAspect,
  calculateHiresDimensions,
  formatAspectRatio,
  IMAGE_UPSCALER_LANCZOS,
  inferModelArchitecture,
  LATENT_UPSCALER_BISLERP,
  resolveCustomDimensions,
  resolveDimensionsForAspect,
  snapDimension,
} from "../../src/shared/aspect-ratios";
import {
  buildComfyPromptGraph,
  validateGenerationRequest,
} from "../../src/main/comfy/workflow-registry";
import {
  evaluateLoraCompatibility,
  resolveAutoVaeName,
} from "../../src/shared/model-utils";
import type { GenerationRequest, ModelRecord } from "../../src/shared/types";

const SAMPLE_MODELS: ModelRecord[] = [
  {
    id: "m_sdxl",
    name: "illustriousXL_v2",
    relativePath: "illustrious\\illustriousXL_v2.safetensors",
    filePath: "C:\\models\\checkpoints\\illustrious\\illustriousXL_v2.safetensors",
    category: "checkpoint",
    architecture: "illustrious",
    sizeBytes: 6_800_000_000,
    sha256: null,
    sourceRoot: "C:\\models\\checkpoints",
    isDuplicate: false,
    duplicateOf: null,
    isIncomplete: false,
    compatibleWorkflows: ["t2i_sdxl_base", "i2i_sdxl_base"],
    license: null,
    description: null,
    installed: true,
    lastSeenAt: "2026-11-11T00:00:00Z",
  },
  {
    id: "m_sd15",
    name: "v1-5-pruned-emaonly-fp16",
    relativePath: "v1-5-pruned-emaonly-fp16.safetensors",
    filePath: "C:\\models\\checkpoints\\v1-5-pruned-emaonly-fp16.safetensors",
    category: "checkpoint",
    architecture: "sd15",
    sizeBytes: 2_132_000_000,
    sha256: null,
    sourceRoot: "C:\\models\\checkpoints",
    isDuplicate: false,
    duplicateOf: null,
    isIncomplete: false,
    compatibleWorkflows: ["t2i_sd15_base", "i2i_sd15_base"],
    license: null,
    description: null,
    installed: true,
    lastSeenAt: "2026-11-11T00:00:00Z",
  },
  {
    id: "m_ltx",
    name: "ltxv-2b-0.9.8-distilled",
    relativePath: "ltxv-2b-0.9.8-distilled.safetensors",
    filePath: "C:\\models\\checkpoints\\ltxv-2b-0.9.8-distilled.safetensors",
    category: "checkpoint",
    architecture: "ltx_video",
    sizeBytes: 5_000_000_000,
    sha256: null,
    sourceRoot: "C:\\models\\checkpoints",
    isDuplicate: false,
    duplicateOf: null,
    isIncomplete: false,
    compatibleWorkflows: [],
    license: null,
    description: null,
    installed: true,
    lastSeenAt: "2026-11-11T00:00:00Z",
  },
  {
    id: "m_lora_sd15",
    name: "lcm_sd15_lora",
    relativePath: "lcm_sd15_lora.safetensors",
    filePath: "C:\\models\\loras\\lcm_sd15_lora.safetensors",
    category: "lora",
    architecture: "sd15",
    sizeBytes: 135_000_000,
    sha256: null,
    sourceRoot: "C:\\models\\loras",
    isDuplicate: false,
    duplicateOf: null,
    isIncomplete: false,
    compatibleWorkflows: ["t2i_sd15_base"],
    license: null,
    description: null,
    installed: true,
    lastSeenAt: "2026-11-11T00:00:00Z",
  },
  {
    id: "m_z_unet",
    name: "z_image_turbo_bf16",
    relativePath: "z_image_turbo_bf16.safetensors",
    filePath: "C:\\models\\diffusion_models\\z_image_turbo_bf16.safetensors",
    category: "diffusion_model",
    architecture: "z_image",
    sizeBytes: 12_000_000_000,
    sha256: null,
    sourceRoot: "C:\\models\\diffusion_models",
    isDuplicate: false,
    duplicateOf: null,
    isIncomplete: false,
    compatibleWorkflows: ["t2i_z_image_turbo"],
    license: null,
    description: null,
    installed: true,
    lastSeenAt: "2026-11-11T00:00:00Z",
  },
  {
    id: "m_z_clip",
    name: "qwen_3_4b",
    relativePath: "qwen_3_4b.safetensors",
    filePath: "C:\\models\\text_encoders\\qwen_3_4b.safetensors",
    category: "text_encoder",
    architecture: "unknown",
    sizeBytes: 4_000_000_000,
    sha256: null,
    sourceRoot: "C:\\models\\text_encoders",
    isDuplicate: false,
    duplicateOf: null,
    isIncomplete: false,
    compatibleWorkflows: [],
    license: null,
    description: null,
    installed: true,
    lastSeenAt: "2026-11-11T00:00:00Z",
  },
  {
    id: "m_z_vae",
    name: "ae",
    relativePath: "ae.safetensors",
    filePath: "C:\\models\\vae\\ae.safetensors",
    category: "vae",
    architecture: "unknown",
    sizeBytes: 335_000_000,
    sha256: null,
    sourceRoot: "C:\\models\\vae",
    isDuplicate: false,
    duplicateOf: null,
    isIncomplete: false,
    compatibleWorkflows: [],
    license: null,
    description: null,
    installed: true,
    lastSeenAt: "2026-11-11T00:00:00Z",
  },
  {
    id: "m_upscale",
    name: "RealESRGAN_x4plus_anime_6B",
    relativePath: "RealESRGAN_x4plus_anime_6B.pth",
    filePath: "C:\\models\\upscale_models\\RealESRGAN_x4plus_anime_6B.pth",
    category: "upscale",
    architecture: "unknown",
    sizeBytes: 17_938_799,
    sha256: null,
    sourceRoot: "C:\\models\\upscale_models",
    isDuplicate: false,
    duplicateOf: null,
    isIncomplete: false,
    compatibleWorkflows: ["upscale_model_v1"],
    license: null,
    description: null,
    installed: true,
    lastSeenAt: "2026-11-11T00:00:00Z",
  },
];

function makeBaseReq(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    workflowId: "t2i_sdxl_base",
    mode: "txt2img",
    prompt: "sunset cathedral",
    negativePrompt: "blurry",
    checkpoint: "illustrious\\illustriousXL_v2.safetensors",
    vae: null,
    loras: [],
    aspectRatio: "16:9",
    width: 1344,
    height: 768,
    steps: 24,
    cfg: 6.5,
    sampler: "dpmpp_2m",
    scheduler: "karras",
    seed: 101,
    randomSeed: false,
    batchCount: 1,
    batchSize: 1,
    outputFormat: "png",
    inputImagePath: null,
    denoise: 1,
    ...overrides,
  };
}

describe("Aspect ratios & architecture inference", () => {
  it("computes snapped dimensions per architecture and performance profile", () => {
    expect(calculateDimensionsForAspect("16:9", "sdxl", "balanced")).toEqual({
      width: 1344,
      height: 768,
    });
    expect(calculateDimensionsForAspect("16:9", "sdxl", "memory_saver")).toEqual({
      width: 1152,
      height: 640,
    });
    expect(calculateDimensionsForAspect("1:1", "sd15", "balanced")).toEqual({
      width: 512,
      height: 512,
    });
    expect(snapDimension(1027, 8, 512, 1536)).toBe(1024);
  });

  it("supports 21:9 and custom frames without cropping the request", () => {
    const wide = resolveDimensionsForAspect("21:9", "sdxl", "balanced", {
      minDim: 512,
      maxDim: 1536,
      dimStep: 8,
    });
    expect(wide.width).toBe(1344);
    expect(wide.height).toBe(576);
    expect(wide.width / wide.height).toBeCloseTo(21 / 9, 5);
    expect(wide.notes).toHaveLength(0);
    expect(formatAspectRatio(wide.width, wide.height)).toBe("7:3");

    const custom = resolveCustomDimensions(1003, 997, {
      minDim: 512,
      maxDim: 1536,
      dimStep: 64,
    });
    expect(custom.width).toBe(1024);
    expect(custom.height).toBe(1024);
    expect(custom.snapped).toBe(true);
    expect(custom.notes.some((note) => note.includes("64px"))).toBe(true);
  });

  it("re-fits model-native buckets that fall outside the selected workflow", () => {
    const limited = resolveDimensionsForAspect("16:9", "sdxl", "quality", {
      minDim: 512,
      maxDim: 1024,
      dimStep: 8,
    });
    expect(limited.width).toBeLessThanOrEqual(1024);
    expect(limited.height).toBeLessThanOrEqual(1024);
    expect(limited.width / limited.height).toBeCloseTo(16 / 9, 2);
    expect(limited.clamped).toBe(true);
    expect(limited.notes.length).toBeGreaterThan(0);
  });

  it("explains configurations the workflow cannot represent", () => {
    const impossible = resolveDimensionsForAspect("21:9", "sdxl", "balanced", {
      minDim: 1024,
      maxDim: 1536,
      dimStep: 8,
    });
    expect(impossible.width).toBeLessThanOrEqual(1536);
    expect(impossible.height).toBeGreaterThanOrEqual(1024);
    expect(impossible.deviation).toBeGreaterThan(0.2);
    expect(impossible.notes[0]).toContain("cannot represent 21:9");
  });

  it("clamps custom dimensions to the workflow range instead of passing them through", () => {
    const clamped = resolveCustomDimensions(4096, 300, {
      minDim: 512,
      maxDim: 1536,
      dimStep: 8,
    });
    expect(clamped.width).toBe(1536);
    expect(clamped.height).toBe(512);
    expect(clamped.clamped).toBe(true);
  });

  it("infers common local model architectures accurately", () => {
    expect(inferModelArchitecture("ltxv-2b-0.9.8-distilled.safetensors")).toBe("ltx_video");
    expect(inferModelArchitecture("z_image_turbo_bf16.safetensors")).toBe("z_image");
    expect(inferModelArchitecture("novaAnimeXL_ilV150.safetensors")).toBe("illustrious");
    expect(inferModelArchitecture("v1-5-pruned-emaonly-fp16.safetensors")).toBe("sd15");
  });
});

describe("Workflow validation & prompt graph compilation", () => {
  it("rejects video checkpoints and missing Img2Img inputs", () => {
    const ltxIssues = validateGenerationRequest(
      makeBaseReq({ checkpoint: "ltxv-2b-0.9.8-distilled.safetensors" }),
      SAMPLE_MODELS,
      "balanced",
      16384
    );
    expect(ltxIssues.some((i) => i.severity === "error" && i.field === "checkpoint")).toBe(true);

    const i2iIssues = validateGenerationRequest(
      makeBaseReq({
        workflowId: "i2i_sdxl_base",
        mode: "img2img",
        inputImagePath: null,
      }),
      SAMPLE_MODELS,
      "balanced",
      16384
    );
    expect(i2iIssues.some((i) => i.severity === "error" && i.field === "inputImagePath")).toBe(true);
  });

  it("blocks incompatible LoRAs for the active checkpoint architecture", () => {
    const issues = validateGenerationRequest(
      makeBaseReq({
        loras: [{ name: "lcm_sd15_lora.safetensors", strengthModel: 0.8, strengthClip: 0.8 }],
      }),
      SAMPLE_MODELS,
      "balanced",
      16384
    );
    expect(issues.some((i) => i.severity === "error" && i.field === "loras")).toBe(true);
  });

  it("builds valid SDXL + LoRA chain graph and Z-Image split UNET graph", () => {
    const sdxlBuilt = buildComfyPromptGraph({
      request: makeBaseReq({
        loras: [{ name: "lcm_sd15_lora.safetensors", strengthModel: 0.75, strengthClip: 0.75 }],
      }),
      availableModels: SAMPLE_MODELS,
      filenamePrefix: "test_run",
    });

    expect(sdxlBuilt.graph["4"]?.class_type).toBe("CheckpointLoaderSimple");
    expect(sdxlBuilt.graph["20"]?.class_type).toBe("LoraLoader");
    // Prompt encoders should rewire to last LoRA node ID "20"
    expect((sdxlBuilt.graph["6"]?.inputs.clip as unknown[])[0]).toBe("20");
    expect((sdxlBuilt.graph["3"]?.inputs.model as unknown[])[0]).toBe("20");

    const zBuilt = buildComfyPromptGraph({
      request: makeBaseReq({
        workflowId: "t2i_z_image_turbo",
        checkpoint: "z_image_turbo_bf16.safetensors",
        steps: 8,
        cfg: 1.0,
        sampler: "res_multistep",
        scheduler: "simple",
      }),
      availableModels: SAMPLE_MODELS,
      filenamePrefix: "test_z",
    });

    expect(zBuilt.graph["28"]?.class_type).toBe("UNETLoader");
    expect(zBuilt.graph["30"]?.class_type).toBe("CLIPLoader");
    expect(zBuilt.graph["11"]?.class_type).toBe("ModelSamplingAuraFlow");
    expect(zBuilt.graph["33"]?.class_type).toBe("ConditioningZeroOut");
  });

  it("validates standalone upscale requests and computes hires dimensions cleanly", () => {
    expect(calculateHiresDimensions(512, 512, 1.5, 8)).toEqual({ width: 768, height: 768 });
    expect(calculateHiresDimensions(832, 1216, 1.5, 16)).toEqual({ width: 1248, height: 1824 });

    const missingInput = validateGenerationRequest(
      makeBaseReq({
        workflowId: "upscale_model_v1",
        mode: "upscale",
        prompt: "",
        checkpoint: "",
        inputImagePath: null,
        upscale: { upscaler: "RealESRGAN_x4plus_anime_6B.pth", scale: 4 },
      }),
      SAMPLE_MODELS,
      "balanced",
      16384
    );
    expect(missingInput.some((i) => i.severity === "error" && i.field === "inputImagePath")).toBe(true);
    expect(missingInput.some((i) => i.field === "prompt" || i.field === "checkpoint")).toBe(false);

    const missingUpscaler = validateGenerationRequest(
      makeBaseReq({
        workflowId: "upscale_model_v1",
        mode: "upscale",
        prompt: "",
        checkpoint: "",
        inputImagePath: "C:\\img.png",
        upscale: { upscaler: "NonExistent.pth", scale: 4 },
      }),
      SAMPLE_MODELS,
      "balanced",
      16384
    );
    expect(missingUpscaler.some((i) => i.severity === "error" && i.field === "upscale")).toBe(true);

    const hiresVramWarn = validateGenerationRequest(
      makeBaseReq({
        width: 1024,
        height: 1024,
        batchSize: 2,
        hiresFix: {
          enabled: true,
          upscaler: "RealESRGAN_x4plus_anime_6B.pth",
          scale: 2.0,
          steps: 12,
          denoise: 0.4,
        },
      }),
      SAMPLE_MODELS,
      "balanced",
      16376
    );
    expect(hiresVramWarn.some((i) => i.severity === "warning" && i.field === "hiresFix")).toBe(true);
  });

  it("builds standalone upscale graphs for 4x, 2x downscale, and fallback Lanczos", () => {
    const built4x = buildComfyPromptGraph({
      request: makeBaseReq({
        workflowId: "upscale_model_v1",
        mode: "upscale",
        prompt: "",
        checkpoint: "",
        upscale: { upscaler: "RealESRGAN_x4plus_anime_6B.pth", scale: 4 },
      }),
      uploadedInputFilename: "src.png",
      availableModels: SAMPLE_MODELS,
    });
    expect(built4x.graph["14"]?.class_type).toBe("UpscaleModelLoader");
    expect(built4x.graph["15"]?.class_type).toBe("ImageUpscaleWithModel");
    expect(built4x.graph["16"]).toBeUndefined();
    expect((built4x.graph["9"]?.inputs.images as unknown[])[0]).toBe("15");

    const built2x = buildComfyPromptGraph({
      request: makeBaseReq({
        workflowId: "upscale_model_v1",
        mode: "upscale",
        prompt: "",
        checkpoint: "",
        upscale: { upscaler: "RealESRGAN_x4plus_anime_6B.pth", scale: 2 },
      }),
      uploadedInputFilename: "src.png",
      availableModels: SAMPLE_MODELS,
    });
    expect(built2x.graph["16"]?.class_type).toBe("ImageScaleBy");
    expect(built2x.graph["16"]?.inputs.scale_by).toBe(0.5);
    expect((built2x.graph["9"]?.inputs.images as unknown[])[0]).toBe("16");

    const builtFallback = buildComfyPromptGraph({
      request: makeBaseReq({
        workflowId: "upscale_model_v1",
        mode: "upscale",
        prompt: "",
        checkpoint: "",
        upscale: { upscaler: IMAGE_UPSCALER_LANCZOS, scale: 3 },
      }),
      uploadedInputFilename: "src.png",
      availableModels: SAMPLE_MODELS,
      supportsUpscaleModel: false,
    });
    expect(builtFallback.graph["14"]).toBeUndefined();
    expect(builtFallback.graph["16"]?.inputs.scale_by).toBe(3);
  });

  it("attaches model-guided and latent 2-pass High-Res Fix without node ID collisions across SDXL and Z-Image", () => {
    const sdxlHires = buildComfyPromptGraph({
      request: makeBaseReq({
        width: 1024,
        height: 1024,
        hiresFix: {
          enabled: true,
          upscaler: "RealESRGAN_x4plus_anime_6B.pth",
          scale: 1.5,
          steps: 14,
          denoise: 0.42,
        },
      }),
      availableModels: SAMPLE_MODELS,
    });
    expect(sdxlHires.graph["91"]?.class_type).toBe("VAEDecode");
    expect(sdxlHires.graph["92"]?.class_type).toBe("UpscaleModelLoader");
    expect(sdxlHires.graph["93"]?.class_type).toBe("ImageUpscaleWithModel");
    expect(sdxlHires.graph["94"]?.inputs.width).toBe(1536);
    expect(sdxlHires.graph["94"]?.inputs.height).toBe(1536);
    expect(sdxlHires.graph["95"]?.class_type).toBe("VAEEncode");
    expect(sdxlHires.graph["96"]?.class_type).toBe("KSampler");
    expect(sdxlHires.graph["96"]?.inputs.steps).toBe(14);
    expect(sdxlHires.graph["96"]?.inputs.denoise).toBe(0.42);
    expect((sdxlHires.graph["8"]?.inputs.samples as unknown[])[0]).toBe("96");

    const zHiresLatent = buildComfyPromptGraph({
      request: makeBaseReq({
        workflowId: "t2i_z_image_turbo",
        checkpoint: "z_image_turbo_bf16.safetensors",
        width: 1024,
        height: 1024,
        steps: 8,
        cfg: 1.0,
        sampler: "res_multistep",
        scheduler: "simple",
        hiresFix: {
          enabled: true,
          upscaler: LATENT_UPSCALER_BISLERP,
          scale: 1.5,
          steps: 6,
          denoise: 0.35,
        },
      }),
      availableModels: SAMPLE_MODELS,
    });
    // Preserves Z-Image CLIPLoader #30 cleanly while adding LatentUpscale #90 + Pass 2 KSampler #96
    expect(zHiresLatent.graph["30"]?.class_type).toBe("CLIPLoader");
    expect(zHiresLatent.graph["90"]?.class_type).toBe("LatentUpscale");
    expect(zHiresLatent.graph["90"]?.inputs.upscale_method).toBe("bislerp");
    expect(zHiresLatent.graph["90"]?.inputs.width).toBe(1536);
    expect((zHiresLatent.graph["96"]?.inputs.positive as unknown[])[0]).toBe("27");
    expect((zHiresLatent.graph["96"]?.inputs.negative as unknown[])[0]).toBe("33");
    expect((zHiresLatent.graph["8"]?.inputs.samples as unknown[])[0]).toBe("96");
    expect((zHiresLatent.graph["8"]?.inputs.vae as unknown[])[0]).toBe("29");
  });

  it("validates and builds the Anima split-DiT graph with model-only LoRAs", () => {
    const animaModels: ModelRecord[] = [
      {
        ...SAMPLE_MODELS[0]!,
        id: "m_anima",
        name: "novaAnimeAM_v1",
        relativePath: "anima\\novaAnimeAM_v1.safetensors",
        category: "diffusion_model",
        architecture: "anima",
        compatibleWorkflows: ["t2i_anima_base", "i2i_anima_base"],
      },
      {
        ...SAMPLE_MODELS[0]!,
        id: "m_anima_clip",
        name: "qwen_3_06b_base",
        relativePath: "qwen_3_06b_base.safetensors",
        category: "text_encoder",
        architecture: "anima",
        compatibleWorkflows: [],
      },
      {
        ...SAMPLE_MODELS[0]!,
        id: "m_anima_vae",
        name: "qwen_image_vae",
        relativePath: "qwen_image_vae.safetensors",
        category: "vae",
        architecture: "anima",
        compatibleWorkflows: [],
      },
      {
        ...SAMPLE_MODELS[0]!,
        id: "m_anima_lora",
        name: "anima_style",
        relativePath: "anima_style.safetensors",
        category: "lora",
        architecture: "anima",
        compatibleWorkflows: ["t2i_anima_base"],
      },
    ];

    const request = makeBaseReq({
      workflowId: "t2i_anima_base",
      checkpoint: "anima\\novaAnimeAM_v1.safetensors",
      negativePrompt: "",
      loras: [
        { name: "anima_style.safetensors", strengthModel: 0.8, strengthClip: 0.8 },
      ],
    });

    const issues = validateGenerationRequest(
      request,
      animaModels,
      "balanced",
      16384
    );
    expect(issues.filter((issue) => issue.severity === "error")).toHaveLength(0);

    const built = buildComfyPromptGraph({
      request,
      availableModels: animaModels,
    });
    expect(built.graph["28"]?.class_type).toBe("UNETLoader");
    expect(built.graph["30"]?.class_type).toBe("CLIPLoader");
    expect(built.graph["30"]?.inputs.type).toBe("stable_diffusion");
    expect(built.graph["29"]?.class_type).toBe("VAELoader");
    expect(built.graph["40"]?.class_type).toBe("LoraLoaderModelOnly");
    expect((built.graph["3"]?.inputs.model as unknown[])[0]).toBe("40");
    expect(built.graph["7"]?.inputs.text).toContain("worst quality");
    expect((built.graph["8"]?.inputs.vae as unknown[])[0]).toBe("29");
  });

  it("builds the Alchemy Refiner upscale graph with creativity denoise", () => {
    const built = buildComfyPromptGraph({
      request: makeBaseReq({
        workflowId: "upscale_refiner_v1",
        mode: "upscale",
        inputImagePath: "C:\\input\\source.png",
        upscale: {
          upscaler: "RealESRGAN_x4plus_anime_6B.pth",
          scale: 2,
          pipeline: "refiner",
          preset: "anime_crisp",
          creativity: 0.42,
          steps: 18,
        },
      }),
      uploadedInputFilename: "kirea_source.png",
      availableModels: SAMPLE_MODELS,
    });

    expect(built.graph["11"]?.class_type).toBe("LoadImage");
    expect(built.graph["14"]?.class_type).toBe("UpscaleModelLoader");
    expect(built.graph["15"]?.class_type).toBe("ImageUpscaleWithModel");
    expect(built.graph["16"]?.class_type).toBe("ImageScale");
    expect(built.graph["16"]?.inputs.width).toBe(2688);
    expect(built.graph["16"]?.inputs.height).toBe(1536);
    expect(built.graph["4"]?.class_type).toBe("CheckpointLoaderSimple");
    expect(built.graph["17"]?.class_type).toBe("VAEEncode");
    expect(built.graph["18"]?.class_type).toBe("KSampler");
    expect(built.graph["18"]?.inputs.denoise).toBe(0.42);
    expect(built.graph["18"]?.inputs.steps).toBe(18);
    expect(built.graph["18"]?.inputs.sampler_name).toBe("dpmpp_2m_sde");
    expect(built.graph["18"]?.inputs.scheduler).toBe("karras");
  });

  it("enforces the strict LoRA compatibility matrix and auto VAE mapping", () => {
    expect(evaluateLoraCompatibility("anima", "anima").compatible).toBe(true);
    expect(evaluateLoraCompatibility("pony", "pony").compatible).toBe(true);
    expect(evaluateLoraCompatibility("sd15", "sd15").compatible).toBe(true);
    expect(evaluateLoraCompatibility("z_image", "z_image").compatible).toBe(true);

    expect(evaluateLoraCompatibility("sdxl", "illustrious").level).toBe("cross-paired");
    expect(evaluateLoraCompatibility("illustrious", "sdxl").compatible).toBe(true);

    expect(evaluateLoraCompatibility("pony", "illustrious").compatible).toBe(false);
    expect(evaluateLoraCompatibility("pony", "sdxl").compatible).toBe(false);
    expect(evaluateLoraCompatibility("anima", "sdxl").compatible).toBe(false);
    expect(evaluateLoraCompatibility("sd15", "sdxl").compatible).toBe(false);

    expect(
      resolveAutoVaeName("anima", [
        { name: "qwen_image_vae", relativePath: "vae\\qwen_image_vae.safetensors" },
      ])
    ).toBe("vae\\qwen_image_vae.safetensors");
    expect(
      resolveAutoVaeName("sd15", [
        { name: "vae-ft-mse-840000-ema-pruned", relativePath: "vae\\vae-ft-mse-840000-ema-pruned.safetensors" },
      ])
    ).toBe("vae\\vae-ft-mse-840000-ema-pruned.safetensors");
    expect(
      resolveAutoVaeName("z_image", [
        { name: "ae", relativePath: "vae\\ae.safetensors" },
      ])
    ).toBe("vae\\ae.safetensors");
  });
});
