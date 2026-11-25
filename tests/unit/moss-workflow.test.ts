import { describe, expect, it } from "vitest";
import {
  buildComfyPromptGraph,
  validateGenerationRequest,
} from "../../src/main/comfy/workflow-registry";
import {
  classifyMossLora,
  classifyMossModel,
  missingMossRequirements,
  mossDependencyStatus,
  validateMossLayoutJson,
} from "../../src/shared/moss-image";
import { enhancePromptWithDanbooru } from "../../src/renderer/components/create/DanbooruEnhancer";
import type { GenerationRequest, ModelRecord } from "../../src/shared/types";

const MOSS_SAMPLE_MODELS: ModelRecord[] = [
  {
    id: "m_moss_sft",
    name: "moss_image_sft_fp8",
    relativePath: "moss_image_sft_fp8.safetensors",
    filePath: "C:\\models\\diffusion_models\\moss_image_sft_fp8.safetensors",
    category: "diffusion_model",
    architecture: "moss_image",
    sizeBytes: 15_000_000_000,
    sha256: null,
    sourceRoot: "C:\\models\\diffusion_models",
    isDuplicate: false,
    duplicateOf: null,
    isIncomplete: false,
    compatibleWorkflows: ["t2i_moss_image", "t2i_moss_image_layout"],
    license: null,
    description: null,
    installed: true,
    lastSeenAt: "2026-11-21T00:00:00Z",
  },
  {
    id: "m_moss_base",
    name: "moss_image_base_fp8",
    relativePath: "moss_image_base_fp8.safetensors",
    filePath: "C:\\models\\diffusion_models\\moss_image_base_fp8.safetensors",
    category: "diffusion_model",
    architecture: "moss_image",
    sizeBytes: 15_000_000_000,
    sha256: null,
    sourceRoot: "C:\\models\\diffusion_models",
    isDuplicate: false,
    duplicateOf: null,
    isIncomplete: false,
    compatibleWorkflows: ["t2i_moss_image_base"],
    license: null,
    description: null,
    installed: true,
    lastSeenAt: "2026-11-21T00:00:00Z",
  },
  {
    id: "m_moss_custom",
    name: "cyberpunk_moss_finetune_v1",
    relativePath: "cyberpunk_moss_finetune_v1.safetensors",
    filePath: "C:\\models\\diffusion_models\\cyberpunk_moss_finetune_v1.safetensors",
    category: "diffusion_model",
    architecture: "moss_image",
    sizeBytes: 15_000_000_000,
    sha256: null,
    sourceRoot: "C:\\models\\diffusion_models",
    isDuplicate: false,
    duplicateOf: null,
    isIncomplete: false,
    compatibleWorkflows: ["t2i_moss_image"],
    license: null,
    description: null,
    installed: true,
    lastSeenAt: "2026-11-21T00:00:00Z",
  },
  {
    id: "m_moss_clip",
    name: "qwen3.5_9b_w4a8_gptq.safetensors",
    relativePath: "qwen3.5_9b_w4a8_gptq.safetensors",
    filePath: "C:\\models\\text_encoders\\qwen3.5_9b_w4a8_gptq.safetensors",
    category: "text_encoder",
    architecture: "unknown",
    sizeBytes: 7_300_000_000,
    sha256: null,
    sourceRoot: "C:\\models\\text_encoders",
    isDuplicate: false,
    duplicateOf: null,
    isIncomplete: false,
    compatibleWorkflows: [],
    license: null,
    description: null,
    installed: true,
    lastSeenAt: "2026-11-21T00:00:00Z",
  },
  {
    id: "m_moss_vae",
    name: "flux2-vae_small",
    relativePath: "flux2-vae_small.safetensors",
    filePath: "C:\\models\\vae\\flux2-vae_small.safetensors",
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
    lastSeenAt: "2026-11-21T00:00:00Z",
  },
  {
    id: "m_moss_lora_model_only",
    name: "moss_cyberpunk_adapter",
    relativePath: "moss_cyberpunk_adapter.safetensors",
    filePath: "C:\\models\\loras\\moss_cyberpunk_adapter.safetensors",
    category: "lora",
    architecture: "moss_image",
    sizeBytes: 250_000_000,
    sha256: null,
    sourceRoot: "C:\\models\\loras",
    isDuplicate: false,
    duplicateOf: null,
    isIncomplete: false,
    compatibleWorkflows: [],
    license: null,
    description: null,
    installed: true,
    lastSeenAt: "2026-11-21T00:00:00Z",
  },
];

const BASE_MOSS_REQ: GenerationRequest = {
  mode: "txt2img",
  checkpoint: "moss_image_sft_fp8.safetensors",
  workflowId: "t2i_moss_image",
  prompt: "A neon lit city street in Tokyo at midnight",
  negativePrompt: "",
  vae: null,
  loras: [],
  aspectRatio: "1:1",
  width: 1024,
  height: 1024,
  steps: 28,
  cfg: 2.5,
  sampler: "euler",
  scheduler: "simple",
  seed: 12345,
  randomSeed: false,
  batchCount: 1,
  batchSize: 1,
  outputFormat: "png",
  inputImagePath: null,
  denoise: 1.0,
};

describe("MOSS-Image Architecture & Workflow Tests", () => {
  it("classifies MOSS models correctly based on names and architecture", () => {
    expect(
      classifyMossModel({
        name: "moss_image_sft_fp8.safetensors",
        relativePath: "moss_image_sft_fp8.safetensors",
        architecture: "moss_image",
      }).kind
    ).toBe("moss_sft");

    expect(
      classifyMossModel({
        name: "moss_image_base_bf16.safetensors",
        relativePath: "moss_image_base_bf16.safetensors",
        architecture: "moss_image",
      }).kind
    ).toBe("moss_base");

    expect(
      classifyMossModel({
        name: "my_cool_moss_finetune.safetensors",
        relativePath: "my_cool_moss_finetune.safetensors",
        architecture: "moss_image",
      }).kind
    ).toBe("moss_custom_finetune");

    expect(
      classifyMossModel({
        name: "anime_sdxl_model.safetensors",
        relativePath: "anime_sdxl_model.safetensors",
        architecture: "sdxl",
      }).kind
    ).toBe("incompatible");
  });

  it("checks MOSS dependency status including custom fine-tunes", () => {
    const statuses = mossDependencyStatus(MOSS_SAMPLE_MODELS, "t2i_moss_image");
    expect(statuses.every((s) => s.installed)).toBe(true);

    const missing = missingMossRequirements(MOSS_SAMPLE_MODELS, "t2i_moss_image");
    expect(missing).toHaveLength(0);

    // If VAE is missing
    const withoutVae = MOSS_SAMPLE_MODELS.filter((m) => m.category !== "vae");
    const missingWithNoVae = missingMossRequirements(withoutVae, "t2i_moss_image");
    expect(missingWithNoVae.some((d) => d.includes("moss-vae") || d.includes("VAE"))).toBe(true);
  });

  it("classifies MOSS LoRAs and determines loader node", () => {
    const modelOnlyLora = classifyMossLora({
      name: "moss_style_lora.safetensors",
      relativePath: "moss_style_lora.safetensors",
      architecture: "moss_image",
    });
    expect(modelOnlyLora.compatible).toBe(true);
    expect(modelOnlyLora.loaderType).toBe("LoraLoaderModelOnly");

    const incompatibleLora = classifyMossLora({
      name: "sd15_detailer.safetensors",
      relativePath: "sd15_detailer.safetensors",
      architecture: "sd15",
    });
    expect(incompatibleLora.compatible).toBe(false);
  });

  it("validates MOSS layout JSON structures properly", () => {
    // Valid full layout
    const fullLayout = JSON.stringify({
      summary: "A warrior standing on the left and a dragon on the right",
      items: [
        { label: "warrior", caption: "a noble warrior with silver armor", bbox: [0.1, 0.2, 0.4, 0.8] },
        { label: "dragon", caption: "a massive red dragon breathing embers", bbox: [0.6, 0.1, 0.95, 0.9] },
      ],
    });
    const fullResult = validateMossLayoutJson(fullLayout);
    expect(fullResult.valid).toBe(true);
    expect(fullResult.format).toBe("full_layout");
    expect(fullResult.itemCount).toBe(2);

    // Valid elements array
    const elementsArray = JSON.stringify([
      { type: "subject", desc: "a cybernetic wolf", bbox: [0.2, 0.3, 0.8, 0.7] },
    ]);
    const arrayResult = validateMossLayoutJson(elementsArray);
    expect(arrayResult.valid).toBe(true);
    expect(arrayResult.format).toBe("elements");
    expect(arrayResult.itemCount).toBe(1);

    // Malformed JSON
    const malformed = validateMossLayoutJson("{ invalid json");
    expect(malformed.valid).toBe(false);
    expect(malformed.format).toBe("invalid");
  });

  it("preserves MOSS prompt natural language and structured JSON without Danbooru corruption", () => {
    const jsonPrompt = JSON.stringify({
      summary: "Cinematic portrait in neon rain",
      items: [{ label: "subject", caption: "cybernetic female runner", bbox: [0.2, 0.1, 0.8, 0.9] }],
    });
    const enhancedJson = enhancePromptWithDanbooru(jsonPrompt, "moss_image");
    expect(enhancedJson.enhancedPrompt).toBe(jsonPrompt);
    expect(enhancedJson.modelQualityPrefix).toHaveLength(0);

    const naturalPrompt = "A majestic crystal palace sitting atop a snow-covered mountain at twilight";
    const enhancedNatural = enhancePromptWithDanbooru(naturalPrompt, "moss_image");
    // MOSS does not inject Danbooru anime tags like 1girl, masterpiece, score_9
    expect(enhancedNatural.enhancedPrompt).toContain(naturalPrompt);
    expect(enhancedNatural.enhancedPrompt).toContain("cinematic lighting");
    expect(enhancedNatural.tags).toHaveLength(0);
  });

  it("enforces MOSS resolution multiples of 16 in validation", () => {
    const validIssues = validateGenerationRequest(BASE_MOSS_REQ, MOSS_SAMPLE_MODELS, "balanced", 16384);
    expect(validIssues.filter((i) => i.severity === "error")).toHaveLength(0);

    // Non-multiple of 16 (e.g. 1020)
    const invalidReq: GenerationRequest = {
      ...BASE_MOSS_REQ,
      width: 1020,
    };
    const invalidIssues = validateGenerationRequest(invalidReq, MOSS_SAMPLE_MODELS, "balanced", 16384);
    expect(
      invalidIssues.some((i) => i.message.includes("multiples of 16"))
    ).toBe(true);
  });

  it("compiles official native MOSS ComfyUI graph with SkipLayerGuidanceDiTSimple and EmptyFlux2LatentImage", () => {
    const req: GenerationRequest = {
      ...BASE_MOSS_REQ,
      prompt: "A hyper-detailed landscape of floating islands",
      loras: [
        {
          name: "moss_cyberpunk_adapter.safetensors",
          strengthModel: 0.8,
          strengthClip: 1.0,
        },
      ],
    };

    const { graph } = buildComfyPromptGraph({ request: req, availableModels: MOSS_SAMPLE_MODELS });

    // UNETLoader
    expect(graph["28"]).toBeDefined();
    expect(graph["28"]?.class_type).toBe("UNETLoader");
    expect(graph["28"]?.inputs.unet_name).toBe("moss_image_sft_fp8.safetensors");

    // CLIPLoader with type "moss_image"
    expect(graph["30"]).toBeDefined();
    expect(graph["30"]?.class_type).toBe("CLIPLoader");
    expect(graph["30"]?.inputs.type).toBe("moss_image");

    // VAELoader
    expect(graph["29"]).toBeDefined();
    expect(graph["29"]?.class_type).toBe("VAELoader");

    // LoRA loader (node 40)
    expect(graph["40"]).toBeDefined();
    expect(graph["40"]?.class_type).toBe("LoraLoaderModelOnly");
    expect(graph["40"]?.inputs.strength_model).toBe(0.8);

    // SkipLayerGuidanceDiTSimple (node 31)
    expect(graph["31"]).toBeDefined();
    expect(graph["31"]?.class_type).toBe("SkipLayerGuidanceDiTSimple");
    expect(graph["31"]?.inputs.single_layers).toBe("22");
    expect(graph["31"]?.inputs.start_percent).toBe(0);
    expect(graph["31"]?.inputs.end_percent).toBe(0.5);

    // EmptyFlux2LatentImage (node 13)
    expect(graph["13"]).toBeDefined();
    expect(graph["13"]?.class_type).toBe("EmptyFlux2LatentImage");

    // KSampler (node 3)
    expect(graph["3"]).toBeDefined();
    expect(graph["3"]?.class_type).toBe("KSampler");
    expect(graph["3"]?.inputs.steps).toBe(28);
    expect(graph["3"]?.inputs.cfg).toBe(2.5);
    expect(graph["3"]?.inputs.sampler_name).toBe("euler");
    expect(graph["3"]?.inputs.scheduler).toBe("simple");
  });

  it("compiles MOSS Turbo 4-step graph and auto-injects distilled LoRA with CFG 1.0", () => {
    const turboReq: GenerationRequest = {
      ...BASE_MOSS_REQ,
      workflowId: "t2i_moss_image_turbo",
      steps: 4,
      cfg: 1.0,
      sampler: "euler",
      scheduler: "simple",
      loras: [],
    };

    const { graph } = buildComfyPromptGraph({
      request: turboReq,
      availableModels: [
        ...MOSS_SAMPLE_MODELS,
        {
          id: "m_moss_turbo_lora",
          name: "moss_image_sft_4_steps_lora_v2_600_avg_rank_72_bf16",
          relativePath: "moss_image_sft_4_steps_lora_v2_600_avg_rank_72_bf16.safetensors",
          filePath: "C:\\models\\loras\\moss_image\\moss_image_sft_4_steps_lora_v2_600_avg_rank_72_bf16.safetensors",
          category: "lora",
          architecture: "moss_image",
          sizeBytes: 380_000_000,
          sha256: null,
          sourceRoot: "C:\\models\\loras",
          isDuplicate: false,
          duplicateOf: null,
          isIncomplete: false,
          compatibleWorkflows: ["t2i_moss_image_turbo"],
          license: null,
          description: null,
          installed: true,
          lastSeenAt: "2026-11-21T00:00:00Z",
        },
      ],
    });

    // Auto-injected 4-step turbo LoRA
    expect(graph["4_turbo"]).toBeDefined();
    expect(graph["4_turbo"]?.class_type).toBe("LoraLoaderModelOnly");
    expect(graph["4_turbo"]?.inputs.strength_model).toBe(1.0);
    expect(graph["4_turbo"]?.inputs.lora_name).toContain("4_steps_lora");

    // KSampler configured for fast 4-step single pass
    expect(graph["3"]?.inputs.steps).toBe(4);
    expect(graph["3"]?.inputs.cfg).toBe(1.0);
    expect(graph["3"]?.inputs.sampler_name).toBe("euler");
    expect(graph["3"]?.inputs.scheduler).toBe("simple");
  });

  it("strictly rejects pairing a MOSS checkpoint with an Anima workflow", () => {
    const invalidReq: GenerationRequest = {
      mode: "txt2img",
      workflowId: "t2i_anima_base",
      checkpoint: "PornMaster_Moss_MIX_V2_int8_convrot.safetensors",
      prompt: "masterpiece, anime girl",
      negativePrompt: "",
      width: 1024,
      height: 1024,
      steps: 28,
      cfg: 2.5,
      seed: 42,
      sampler: "euler",
      scheduler: "simple",
      denoise: 1,
      loras: [],
      vae: null,
      aspectRatio: "1:1",
      randomSeed: false,
      batchCount: 1,
      batchSize: 1,
      outputFormat: "png",
      inputImagePath: null,
    };

    const issues = validateGenerationRequest(
      invalidReq,
      [
        ...MOSS_SAMPLE_MODELS,
        {
          id: "m_moss_mix",
          name: "PornMaster_Moss_MIX_V2_int8_convrot",
          relativePath: "PornMaster_Moss_MIX_V2_int8_convrot.safetensors",
          filePath: "C:\\models\\diffusion_models\\PornMaster_Moss_MIX_V2_int8_convrot.safetensors",
          category: "diffusion_model",
          architecture: "moss_image",
          sizeBytes: 15_000_000_000,
          sha256: null,
          sourceRoot: "C:\\models\\diffusion_models",
          isDuplicate: false,
          duplicateOf: null,
          isIncomplete: false,
          compatibleWorkflows: ["t2i_moss_image"],
          license: null,
          description: null,
          installed: true,
          lastSeenAt: "2026-11-21T00:00:00Z",
        },
      ],
      "balanced",
      16384
    );

    expect(
      issues.some(
        (i) =>
          i.severity === "error" &&
          i.message.includes("incompatible with workflow 'Anima Split-DiT Text-to-Image'")
      )
    ).toBe(true);
  });
});
