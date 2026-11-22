import { describe, expect, it } from "vitest";
import { buildComfyPromptGraph } from "../../src/main/comfy/workflow-graph-builder";
import type { GenerationRequest, ModelRecord } from "../../src/shared/types";

const mockModels: ModelRecord[] = [
  {
    id: "m1",
    name: "Animixy²_0.1.safetensors",
    category: "checkpoint",
    architecture: "illustrious",
    installed: true,
    filePath: "C:\\models\\Animixy²_0.1.safetensors",
    relativePath: "Animixy²_0.1.safetensors",
    sizeBytes: 6000000000,
    sha256: "abc",
    sourceRoot: "C:\\models",
    isDuplicate: false,
    duplicateOf: null,
    isIncomplete: false,
    compatibleWorkflows: [],
    license: null,
    description: "Illustrious model",
    lastSeenAt: "2026-01-01",
  },
];

const baseImg2ImgRequest: GenerationRequest = {
  workflowId: "i2i_sdxl_base",
  mode: "img2img",
  prompt: "beautiful anime character with golden hair",
  negativePrompt: "low quality, bad anatomy",
  checkpoint: "Animixy²_0.1.safetensors",
  vae: null,
  loras: [],
  aspectRatio: "1:1",
  width: 1024,
  height: 1024,
  steps: 25,
  cfg: 6.5,
  sampler: "dpmpp_2m",
  scheduler: "karras",
  seed: 42,
  randomSeed: false,
  batchCount: 1,
  batchSize: 1,
  outputFormat: "png",
  inputImagePath: "C:\\images\\source.png",
  denoise: 0.65,
};

describe("Native Inpainting & Outpainting Graph Compilation", () => {
  it("builds a verified Inpainting graph with ImageCompositeMasked when mask is provided", () => {
    const built = buildComfyPromptGraph({
      request: {
        ...baseImg2ImgRequest,
        maskGrowBy: 8,
      },
      uploadedInputFilename: "source_image.png",
      uploadedMaskFilename: "inpaint_mask.png",
      availableModels: mockModels,
      filenamePrefix: "test_inpaint",
    });

    const graph = built.graph;

    // Verify source and mask loaders
    expect(graph["11"]).toBeDefined();
    expect(graph["11"]?.class_type).toBe("LoadImage");
    expect(graph["11"]?.inputs?.image).toBe("source_image.png");

    expect(graph["13"]).toBeDefined();
    expect(graph["13"]?.class_type).toBe("LoadImage");
    expect(graph["13"]?.inputs?.image).toBe("inpaint_mask.png");

    // Verify mask conversion
    expect(graph["15"]).toBeDefined();
    expect(graph["15"]?.class_type).toBe("ImageToMask");
    expect(graph["15"]?.inputs?.channel).toBe("red");

    // Verify inpaint VAE encode
    expect(graph["5"]).toBeDefined();
    expect(graph["5"]?.class_type).toBe("VAEEncodeForInpaint");
    expect(graph["5"]?.inputs?.pixels).toEqual(["12", 0]);
    expect(graph["5"]?.inputs?.mask).toEqual(["15", 0]);
    expect(graph["5"]?.inputs?.grow_mask_by).toBe(8);

    // Verify KSampler receives inpaint latent
    expect(graph["3"]).toBeDefined();
    expect(graph["3"]?.class_type).toBe("KSampler");
    expect(graph["3"]?.inputs?.latent_image).toEqual(["5", 0]);
    expect(graph["3"]?.inputs?.denoise).toBe(0.65);

    // Verify VAEDecode
    expect(graph["8"]).toBeDefined();
    expect(graph["8"]?.class_type).toBe("VAEDecode");

    // Verify ImageCompositeMasked for 100% preservation of unmasked pixels
    expect(graph["16"]).toBeDefined();
    expect(graph["16"]?.class_type).toBe("ImageCompositeMasked");
    expect(graph["16"]?.inputs?.destination).toEqual(["12", 0]);
    expect(graph["16"]?.inputs?.source).toEqual(["8", 0]);
    expect(graph["16"]?.inputs?.mask).toEqual(["15", 0]);

    // Verify SaveImage receives composite output
    expect(graph["9"]).toBeDefined();
    expect(graph["9"]?.class_type).toBe("SaveImage");
    expect(graph["9"]?.inputs?.images).toEqual(["16", 0]);
  });

  it("builds a verified Outpainting graph with ImagePadForOutpaint and boundary snapping", () => {
    const built = buildComfyPromptGraph({
      request: {
        ...baseImg2ImgRequest,
        outpaintPadding: {
          top: 120, // Should snap to 120 (multiple of 8)
          bottom: 64,
          left: 130, // Should snap to 128 (multiple of 8)
          right: 0,
        },
      },
      uploadedInputFilename: "source_image.png",
      availableModels: mockModels,
      filenamePrefix: "test_outpaint",
    });

    const graph = built.graph;

    // Verify source image loader
    expect(graph["11"]).toBeDefined();
    expect(graph["11"]?.class_type).toBe("LoadImage");

    // Verify ImagePadForOutpaint with snapped dimensions and feathering
    expect(graph["12"]).toBeDefined();
    expect(graph["12"]?.class_type).toBe("ImagePadForOutpaint");
    expect(graph["12"]?.inputs?.image).toEqual(["11", 0]);
    expect(graph["12"]?.inputs?.top).toBe(120);
    expect(graph["12"]?.inputs?.bottom).toBe(64);
    expect(graph["12"]?.inputs?.left).toBe(128); // 130 snapped to step 8
    expect(graph["12"]?.inputs?.right).toBe(0);
    expect(graph["12"]?.inputs?.feathering).toBe(40);

    // Verify VAEEncodeForInpaint uses padded image [0] and generated mask [1]
    expect(graph["5"]).toBeDefined();
    expect(graph["5"]?.class_type).toBe("VAEEncodeForInpaint");
    expect(graph["5"]?.inputs?.pixels).toEqual(["12", 0]);
    expect(graph["5"]?.inputs?.mask).toEqual(["12", 1]);

    // Verify KSampler
    expect(graph["3"]).toBeDefined();
    expect(graph["3"]?.class_type).toBe("KSampler");
    expect(graph["3"]?.inputs?.latent_image).toEqual(["5", 0]);

    // Verify ImageCompositeMasked preserves the padded interior
    expect(graph["16"]).toBeDefined();
    expect(graph["16"]?.class_type).toBe("ImageCompositeMasked");
    expect(graph["16"]?.inputs?.destination).toEqual(["12", 0]);
    expect(graph["16"]?.inputs?.source).toEqual(["8", 0]);
    expect(graph["16"]?.inputs?.mask).toEqual(["12", 1]);

    // Verify SaveImage
    expect(graph["9"]).toBeDefined();
    expect(graph["9"]?.inputs?.images).toEqual(["16", 0]);
  });
});
