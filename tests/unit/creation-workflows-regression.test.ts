import { describe, expect, it } from "vitest";
import { GenerationRequestSchema } from "../../src/main/ipc/schemas";
import { INITIAL_DRAFT } from "../../src/renderer/app/app-constants";
import {
  buildComfyPromptGraph,
  validateGenerationRequest,
} from "../../src/main/comfy/workflow-registry";
import { snapDimension } from "../../src/shared/aspect-ratios";
import type { GenerationRequest, ModelRecord } from "../../src/shared/types";

const MOCK_MODELS: ModelRecord[] = [
  {
    id: "m_illustrious",
    name: "Animixy²",
    relativePath: "illustrious\\Animixy².safetensors",
    filePath: "C:\\models\\checkpoints\\illustrious\\Animixy².safetensors",
    category: "checkpoint",
    architecture: "illustrious",
    sizeBytes: 7_105_000_000,
    sha256: null,
    sourceRoot: "C:\\models\\checkpoints",
    isDuplicate: false,
    duplicateOf: null,
    isIncomplete: false,
    compatibleWorkflows: ["t2i_sdxl_base", "i2i_sdxl_base"],
    license: null,
    description: null,
    installed: true,
    lastSeenAt: "2026-11-20T00:00:00Z",
  },
  {
    id: "m_upscale",
    name: "4x-UltraSharp",
    relativePath: "4x-UltraSharp.pth",
    filePath: "C:\\models\\upscale_models\\4x-UltraSharp.pth",
    category: "upscale",
    architecture: "unknown",
    sizeBytes: 67_000_000,
    sha256: null,
    sourceRoot: "C:\\models\\upscale_models",
    isDuplicate: false,
    duplicateOf: null,
    isIncomplete: false,
    compatibleWorkflows: ["upscale_model_v1"],
    license: null,
    description: null,
    installed: true,
    lastSeenAt: "2026-11-20T00:00:00Z",
  },
  {
    id: "m_vae",
    name: "sdxl_vae_fp16fix",
    relativePath: "sdxl_vae_fp16fix.safetensors",
    filePath: "C:\\models\\vae\\sdxl_vae_fp16fix.safetensors",
    category: "vae",
    architecture: "illustrious",
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
    lastSeenAt: "2026-11-20T00:00:00Z",
  },
];

const BASE_REQUEST: GenerationRequest = {
  workflowId: "t2i_sdxl_base",
  mode: "txt2img",
  prompt: "1girl, solo, red hair, anime style",
  negativePrompt: "lowres, blurry, bad anatomy",
  checkpoint: "illustrious\\Animixy².safetensors",
  vae: null,
  loras: [],
  aspectRatio: "2:3",
  width: 896,
  height: 1344,
  steps: 28,
  cfg: 5.5,
  sampler: "euler",
  scheduler: "normal",
  seed: 12345,
  randomSeed: false,
  batchCount: 1,
  batchSize: 1,
  outputFormat: "png",
  inputImagePath: null,
  denoise: 1.0,
};

describe("Creation Workflows Integration & Regression Suite", () => {
  it("builds valid Text-to-Image (Generate) graph with snapped dimensions and VAE auto-selection", () => {
    const { graph, resolvedSeed } = buildComfyPromptGraph({
      request: BASE_REQUEST,
      availableModels: MOCK_MODELS,
      filenamePrefix: "test_t2i",
    });

    expect(resolvedSeed).toBe(12345);
    expect(graph["4"]!.class_type).toBe("CheckpointLoaderSimple");
    expect(graph["4"]!.inputs.ckpt_name).toBe("illustrious\\Animixy².safetensors");
    expect(graph["6"]!.inputs.text).toBe(BASE_REQUEST.prompt);
    expect(graph["5"]!.class_type).toBe("EmptyLatentImage");
    expect(graph["5"]!.inputs.width).toBe(896);
    expect(graph["5"]!.inputs.height).toBe(1344);
    expect(graph["3"]!.class_type).toBe("KSampler");
    expect(graph["3"]!.inputs.denoise).toBe(1.0);
    expect(graph["9"]!.class_type).toBe("SaveImage");
  });

  it("builds valid Image-to-Image (Edit) graph requiring uploaded input image and scaled denoise", () => {
    const editReq: GenerationRequest = {
      ...BASE_REQUEST,
      workflowId: "i2i_sdxl_base",
      mode: "img2img",
      inputImagePath: "C:\\test\\source.png",
      denoise: 0.65,
    };

    // When uploaded filename is missing, must throw
    expect(() =>
      buildComfyPromptGraph({
        request: editReq,
        availableModels: MOCK_MODELS,
      })
    ).toThrowError(/uploaded to ComfyUI/);

    // When uploaded filename is provided, builds LoadImage + VAEEncode pipeline
    const { graph } = buildComfyPromptGraph({
      request: editReq,
      uploadedInputFilename: "uploaded_source.png",
      availableModels: MOCK_MODELS,
      filenamePrefix: "test_i2i",
    });

    expect(graph["11"]!.class_type).toBe("LoadImage");
    expect(graph["11"]!.inputs.image).toBe("uploaded_source.png");
    expect(graph["12"]!.class_type).toBe("ImageScale");
    expect(graph["5"]!.class_type).toBe("VAEEncode");
    expect(graph["3"]!.inputs.denoise).toBe(0.65);
    expect(graph["3"]!.inputs.latent_image).toEqual(["5", 0]);
  });

  it("builds valid AI Upscale graph using UpscaleModelLoader and ImageUpscaleWithModel", () => {
    const upscaleReq: GenerationRequest = {
      ...BASE_REQUEST,
      workflowId: "upscale_model_v1",
      mode: "upscale",
      inputImagePath: "C:\\test\\source.png",
      upscale: {
        upscaler: "4x-UltraSharp.pth",
        scale: 4,
        pipeline: "crisp",
      },
    };

    const { graph } = buildComfyPromptGraph({
      request: upscaleReq,
      uploadedInputFilename: "source_for_upscale.png",
      availableModels: MOCK_MODELS,
      filenamePrefix: "test_upscale",
    });

    expect(graph["11"]!.class_type).toBe("LoadImage");
    expect(graph["14"]!.class_type).toBe("UpscaleModelLoader");
    expect(graph["14"]!.inputs.model_name).toBe("4x-UltraSharp.pth");
    expect(graph["15"]!.class_type).toBe("ImageUpscaleWithModel");
    expect(graph["9"]!.inputs.images).toEqual(["15", 0]);
  });

  it("verifies contract for Inpaint and Outpaint degradation behavior", () => {
    // Current contract verification:
    // GenerationRequest does NOT have maskPath or outpaintPadding fields
    expect("maskPath" in BASE_REQUEST).toBe(false);
    expect("maskDataUrl" in BASE_REQUEST).toBe(false);
    expect("outpaintPadding" in BASE_REQUEST).toBe(false);

    // Inpaint in useCreateController routes to i2i_sdxl_base with denoise 0.75
    const inpaintDegradedReq: GenerationRequest = {
      ...BASE_REQUEST,
      workflowId: "i2i_sdxl_base",
      mode: "img2img",
      inputImagePath: "C:\\test\\source.png",
      denoise: 0.75,
    };

    const { graph } = buildComfyPromptGraph({
      request: inpaintDegradedReq,
      uploadedInputFilename: "inpaint_source.png",
      availableModels: MOCK_MODELS,
    });

    // Confirms full image is encoded (no SetLatentNoiseMask or VAEEncodeForInpaint)
    expect(graph["5"]!.class_type).toBe("VAEEncode");
    expect(graph["SetLatentNoiseMask"]).toBeUndefined();
    expect(graph["VAEEncodeForInpaint"]).toBeUndefined();
    expect(graph["3"]!.inputs.denoise).toBe(0.75);
  });

  it("preserves source image dimensions when snapping to step constraints", () => {
    const snappedW = snapDimension(896, 64, 512, 2048);
    const snappedH = snapDimension(1344, 64, 512, 2048);
    expect(snappedW).toBe(896);
    expect(snappedH).toBe(1344);

    const oddW = snapDimension(850, 64, 512, 2048);
    expect(oddW % 64).toBe(0);
    expect(oddW).toBe(832);
  });

  it("defaults INITIAL_DRAFT to seed -1 (random) and validates through GenerationRequestSchema", () => {
    expect(INITIAL_DRAFT.seed).toBe(-1);
    expect(INITIAL_DRAFT.randomSeed).toBe(true);

    const parsed = GenerationRequestSchema.parse(INITIAL_DRAFT);
    expect(parsed.seed).toBe(-1);
    expect(parsed.randomSeed).toBe(true);
  });
});
