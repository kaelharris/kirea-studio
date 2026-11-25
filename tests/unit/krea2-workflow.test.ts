import { describe, expect, it } from "vitest";
import {
  WORKFLOW_TEMPLATES,
  getWorkflowById,
  isKrea2Workflow,
} from "../../src/main/comfy/workflow-templates";
import { buildComfyPromptGraph } from "../../src/main/comfy/workflow-graph-builder";
import { validateGenerationRequest } from "../../src/main/comfy/workflow-validation";
import {
  architectureBadgeTone,
  isGenerationSupportedArchitecture,
} from "../../src/shared/model-utils";
import { MODEL_SAMPLING_PROFILES } from "../../src/shared/sampling-profiles";
import type { GenerationRequest, ModelRecord } from "../../src/shared/types";

describe("Krea 2 Workflow Architecture", () => {
  const baseRequest: GenerationRequest = {
    mode: "txt2img",
    checkpoint: "krea2/Krea2cocoamix004.safetensors",
    workflowId: "t2i_krea2_base",
    prompt: "1girl, cinematic portrait, glowing eyes",
    negativePrompt: "worst quality, blurry",
    vae: null,
    loras: [],
    aspectRatio: "1:1",
    width: 1024,
    height: 1024,
    steps: 8,
    cfg: 1.8,
    sampler: "euler",
    scheduler: "simple",
    seed: 42,
    randomSeed: false,
    batchCount: 1,
    batchSize: 1,
    denoise: 1.0,
    outputFormat: "png",
    inputImagePath: null,
  };

  const mockModels: ModelRecord[] = [
    {
      id: "m_krea",
      name: "Krea2cocoamix004",
      relativePath: "krea2/Krea2cocoamix004.safetensors",
      filePath: "C:\\models\\checkpoints\\krea2\\Krea2cocoamix004.safetensors",
      category: "checkpoint",
      architecture: "krea2",
      installed: true,
      sizeBytes: 1000,
      sha256: null,
      sourceRoot: "",
      isDuplicate: false,
      duplicateOf: null,
      isIncomplete: false,
      compatibleWorkflows: ["t2i_krea2_base", "i2i_krea2_base"],
      license: null,
      description: null,
      lastSeenAt: "",
    },
    {
      id: "m_diff",
      name: "krea_diffusion",
      relativePath: "krea_diffusion.safetensors",
      filePath: "C:\\models\\diffusion_models\\krea_diffusion.safetensors",
      category: "diffusion_model",
      architecture: "krea2",
      installed: true,
      sizeBytes: 1000,
      sha256: null,
      sourceRoot: "",
      isDuplicate: false,
      duplicateOf: null,
      isIncomplete: false,
      compatibleWorkflows: ["t2i_krea2_base"],
      license: null,
      description: null,
      lastSeenAt: "",
    },
    {
      id: "m_clip",
      name: "qwen3vl_4b_fp8_scaled",
      relativePath: "qwen3vl_4b_fp8_scaled.safetensors",
      filePath: "C:\\models\\text_encoders\\qwen3vl_4b_fp8_scaled.safetensors",
      category: "text_encoder",
      architecture: "unknown",
      installed: true,
      sizeBytes: 1000,
      sha256: null,
      sourceRoot: "",
      isDuplicate: false,
      duplicateOf: null,
      isIncomplete: false,
      compatibleWorkflows: [],
      license: null,
      description: null,
      lastSeenAt: "",
    },
    {
      id: "m_vae",
      name: "ae",
      relativePath: "ae.safetensors",
      filePath: "C:\\models\\vae\\ae.safetensors",
      category: "vae",
      architecture: "flux",
      installed: true,
      sizeBytes: 1000,
      sha256: null,
      sourceRoot: "",
      isDuplicate: false,
      duplicateOf: null,
      isIncomplete: false,
      compatibleWorkflows: [],
      license: null,
      description: null,
      lastSeenAt: "",
    },
  ];

  it("includes t2i_krea2_base and i2i_krea2_base templates in WORKFLOW_TEMPLATES", () => {
    const t2i = getWorkflowById("t2i_krea2_base");
    expect(t2i).toBeDefined();
    expect(t2i?.name).toBe("Krea 2 Text-to-Image");
    expect(t2i?.supportedArchitectures).toContain("krea2");
    expect(t2i?.supportsLora).toBe(true);

    const i2i = getWorkflowById("i2i_krea2_base");
    expect(i2i).toBeDefined();
    expect(i2i?.name).toBe("Krea 2 Image-to-Image");
    expect(i2i?.mode).toBe("img2img");
  });

  it("isKrea2Workflow correctly identifies Krea 2 workflows", () => {
    expect(isKrea2Workflow("t2i_krea2_base")).toBe(true);
    expect(isKrea2Workflow("i2i_krea2_base")).toBe(true);
    expect(isKrea2Workflow("t2i_sdxl_base")).toBe(false);
    expect(isKrea2Workflow("t2i_anima_base")).toBe(false);
  });

  it("designates krea2 as a generation-supported architecture with accent tone", () => {
    expect(isGenerationSupportedArchitecture("krea2")).toBe(true);
    expect(architectureBadgeTone("krea2")).toBe("accent");
  });

  it("links krea2 sampling profiles to t2i_krea2_base", () => {
    const rawProfile = MODEL_SAMPLING_PROFILES.find((p) => p.id === "krea2_raw_txt2img");
    expect(rawProfile).toBeDefined();
    expect(rawProfile?.workflowId).toBe("t2i_krea2_base");

    const turboProfile = MODEL_SAMPLING_PROFILES.find((p) => p.id === "krea2_turbo_txt2img");
    expect(turboProfile).toBeDefined();
    expect(turboProfile?.workflowId).toBe("t2i_krea2_base");
  });

  it("constructs a valid ComfyUI prompt graph for t2i_krea2_base with CheckpointLoaderSimple", () => {
    const { graph } = buildComfyPromptGraph({
      request: baseRequest,
      availableModels: mockModels,
      uploadedInputFilename: undefined,
      uploadedMaskFilename: undefined,
      supportsUpscaleModel: true,
      filenamePrefix: "Kirea_Krea2",
    });

    // Node 28 is checkpoint loader (since category is checkpoint)
    expect(graph["28"]?.class_type).toBe("CheckpointLoaderSimple");
    expect(graph["28"]?.inputs.ckpt_name).toBe("krea2/Krea2cocoamix004.safetensors");

    // Node 30 is CLIPLoader with type: "krea2"
    expect(graph["30"]?.class_type).toBe("CLIPLoader");
    expect(graph["30"]?.inputs.type).toBe("krea2");
    expect(graph["30"]?.inputs.clip_name).toBe("qwen3vl_4b_fp8_scaled.safetensors");

    // Node 29 is VAELoader with ae.safetensors
    expect(graph["29"]?.class_type).toBe("VAELoader");
    expect(graph["29"]?.inputs.vae_name).toBe("ae.safetensors");

    // Node 5 is EmptySD3LatentImage (16-channel)
    expect(graph["5"]?.class_type).toBe("EmptySD3LatentImage");
    expect(graph["5"]?.inputs.width).toBe(1024);
    expect(graph["5"]?.inputs.height).toBe(1024);

    // Node 3 is KSampler connected properly
    expect(graph["3"]?.class_type).toBe("KSampler");
    expect(graph["3"]?.inputs.steps).toBe(8);
    expect(graph["3"]?.inputs.model).toEqual(["28", 0]);
    expect(graph["3"]?.inputs.latent_image).toEqual(["5", 0]);

    // Node 8 is VAEDecode
    expect(graph["8"]?.class_type).toBe("VAEDecode");
    expect(graph["8"]?.inputs.vae).toEqual(["29", 0]);

    // Node 9 is SaveImage
    expect(graph["9"]?.class_type).toBe("SaveImage");
    expect(graph["9"]?.inputs.images).toEqual(["8", 0]);
  });

  it("constructs UNETLoader when model category is diffusion_model", () => {
    const diffRequest: GenerationRequest = {
      ...baseRequest,
      checkpoint: "krea_diffusion.safetensors",
    };

    const { graph } = buildComfyPromptGraph({
      request: diffRequest,
      availableModels: mockModels,
      uploadedInputFilename: undefined,
      uploadedMaskFilename: undefined,
      supportsUpscaleModel: true,
      filenamePrefix: "Kirea_Krea2",
    });

    expect(graph["28"]?.class_type).toBe("UNETLoader");
    expect(graph["28"]?.inputs.unet_name).toBe("krea_diffusion.safetensors");
  });

  it("validates Krea 2 request and passes when dependencies are present", () => {
    const issues = validateGenerationRequest(
      baseRequest,
      mockModels,
      "balanced",
      16384
    );

    const errors = issues.filter((i) => i.severity === "error");
    expect(errors).toHaveLength(0);
  });
});
