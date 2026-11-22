import { describe, expect, it } from "vitest";
import {
  buildComfyPromptGraph,
  validateGenerationRequest,
} from "../../src/main/comfy/workflow-registry";
import { WORKFLOW_TEMPLATES } from "../../src/main/comfy/workflow-templates";
import type { GenerationRequest, ModelRecord } from "../../src/shared/types";

const ILLUSTRIOUS_SAMPLE_MODELS: ModelRecord[] = [
  {
    id: "m_illustrious_base",
    name: "Animixy²",
    relativePath: "Animixy².safetensors",
    filePath: "C:\\models\\checkpoints\\Animixy².safetensors",
    category: "checkpoint",
    architecture: "illustrious",
    sizeBytes: 6_800_000_000,
    sha256: null,
    sourceRoot: "C:\\models\\checkpoints",
    isDuplicate: false,
    duplicateOf: null,
    isIncomplete: false,
    compatibleWorkflows: ["t2i_illustrious_base", "i2i_illustrious_base", "t2i_sdxl_base"],
    license: null,
    description: null,
    installed: true,
    lastSeenAt: "2026-11-21T00:00:00Z",
  },
  {
    id: "m_sdxl_base",
    name: "sd_xl_base_1.0",
    relativePath: "sd_xl_base_1.0.safetensors",
    filePath: "C:\\models\\checkpoints\\sd_xl_base_1.0.safetensors",
    category: "checkpoint",
    architecture: "sdxl",
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
    lastSeenAt: "2026-11-21T00:00:00Z",
  },
  ...Array.from({ length: 12 }, (_, i) => ({
    id: `m_lora_${i + 1}`,
    name: `illustrious_lora_${i + 1}`,
    relativePath: `illustrious_lora_${i + 1}.safetensors`,
    filePath: `C:\\models\\loras\\illustrious_lora_${i + 1}.safetensors`,
    category: "lora" as const,
    architecture: "illustrious" as const,
    sizeBytes: 150_000_000,
    sha256: null,
    sourceRoot: "C:\\models\\loras",
    isDuplicate: false,
    duplicateOf: null,
    isIncomplete: false,
    compatibleWorkflows: ["t2i_illustrious_base", "t2i_sdxl_base"],
    license: null,
    description: null,
    installed: true,
    lastSeenAt: "2026-11-21T00:00:00Z",
  })),
];

const BASE_ILLUSTRIOUS_REQ: GenerationRequest = {
  mode: "txt2img",
  checkpoint: "Animixy².safetensors",
  workflowId: "t2i_illustrious_base",
  prompt: "masterpiece, 1girl, smiling, solo",
  negativePrompt: "low quality, worst quality",
  vae: null,
  loras: [],
  aspectRatio: "1:1",
  width: 1024,
  height: 1024,
  steps: 28,
  cfg: 7.0,
  sampler: "euler",
  scheduler: "normal",
  seed: 42,
  randomSeed: false,
  batchCount: 1,
  batchSize: 1,
  outputFormat: "png",
  inputImagePath: null,
  denoise: 1.0,
};

describe("Illustrious 10-LoRA Expansion & Deterministic Chaining", () => {
  it("registers dedicated Illustrious workflows with maxLoras: 10", () => {
    const t2iIll = WORKFLOW_TEMPLATES.find((w) => w.id === "t2i_illustrious_base");
    expect(t2iIll).toBeDefined();
    expect(t2iIll?.maxLoras).toBe(10);
    expect(t2iIll?.supportedArchitectures).toContain("illustrious");
    expect(t2iIll?.defaults.steps).toBe(28);
    expect(t2iIll?.defaults.cfg).toBe(7.0);

    const i2iIll = WORKFLOW_TEMPLATES.find((w) => w.id === "i2i_illustrious_base");
    expect(i2iIll).toBeDefined();
    expect(i2iIll?.maxLoras).toBe(10);
    expect(i2iIll?.supportedArchitectures).toContain("illustrious");
  });

  it("validates up to 10 LoRAs on Illustrious workflows and rejects 11+", () => {
    const makeReq = (count: number, workflowId = "t2i_illustrious_base"): GenerationRequest => ({
      ...BASE_ILLUSTRIOUS_REQ,
      workflowId,
      loras: Array.from({ length: count }, (_, i) => ({
        name: `illustrious_lora_${i + 1}.safetensors`,
        strengthModel: 0.8,
        strengthClip: 0.8,
      })),
    });

    // 0, 1, 4, 8, 10 LoRAs should all pass validation
    for (const count of [0, 1, 4, 8, 10]) {
      const issues = validateGenerationRequest(makeReq(count), ILLUSTRIOUS_SAMPLE_MODELS, "balanced", 16384);
      expect(issues.filter((i) => i.severity === "error")).toHaveLength(0);
    }

    // 11 LoRAs should fail validation
    const issues11 = validateGenerationRequest(makeReq(11), ILLUSTRIOUS_SAMPLE_MODELS, "balanced", 16384);
    const loraError = issues11.find((i) => i.message.includes("supports at most 10 LoRAs"));
    expect(loraError).toBeDefined();
  });

  it("keeps standard SDXL maxLoras strictly at 4 for non-Illustrious models", () => {
    const reqSdxl: GenerationRequest = {
      ...BASE_ILLUSTRIOUS_REQ,
      checkpoint: "sd_xl_base_1.0.safetensors",
      workflowId: "t2i_sdxl_base",
      loras: Array.from({ length: 5 }, (_, i) => ({
        name: `illustrious_lora_${i + 1}.safetensors`,
        strengthModel: 0.8,
        strengthClip: 0.8,
      })),
    };

    const issues = validateGenerationRequest(reqSdxl, ILLUSTRIOUS_SAMPLE_MODELS, "balanced", 16384);
    const loraError = issues.find((i) => i.message.includes("supports at most 4 LoRAs"));
    expect(loraError).toBeDefined();
  });

  it("compiles deterministic sequential chains for 10 LoRAs without node collisions", () => {
    const loras = Array.from({ length: 10 }, (_, i) => ({
      name: `illustrious_lora_${i + 1}.safetensors`,
      strengthModel: 0.5 + i * 0.05,
      strengthClip: 0.6 + i * 0.03,
    }));

    const req: GenerationRequest = {
      ...BASE_ILLUSTRIOUS_REQ,
      prompt: "masterpiece, 1girl, vibrant sunset, kimono",
      negativePrompt: "worst quality",
      seed: 9999,
      loras,
    };

    const { graph } = buildComfyPromptGraph({ request: req, availableModels: ILLUSTRIOUS_SAMPLE_MODELS });

    // CheckpointLoader is node 4
    expect(graph["4"]).toBeDefined();
    expect(graph["4"]?.class_type).toBe("CheckpointLoaderSimple");

    // All 10 LoRAs (nodes 20 to 29) must exist and be chained sequentially
    for (let i = 0; i < 10; i++) {
      const nodeId = `2${i}`;
      expect(graph[nodeId]).toBeDefined();
      expect(graph[nodeId]?.class_type).toBe("LoraLoader");
      expect(graph[nodeId]?.inputs.lora_name).toBe(`illustrious_lora_${i + 1}.safetensors`);
      expect(Number(graph[nodeId]?.inputs.strength_model)).toBeCloseTo(0.5 + i * 0.05);
      expect(Number(graph[nodeId]?.inputs.strength_clip)).toBeCloseTo(0.6 + i * 0.03);

      if (i === 0) {
        // First LoRA connects to CheckpointLoaderSimple (node 4)
        expect(graph[nodeId]?.inputs.model).toEqual(["4", 0]);
        expect(graph[nodeId]?.inputs.clip).toEqual(["4", 1]);
      } else {
        // Subsequent LoRAs connect to previous LoRA
        const prevNodeId = `2${i - 1}`;
        expect(graph[nodeId]?.inputs.model).toEqual([prevNodeId, 0]);
        expect(graph[nodeId]?.inputs.clip).toEqual([prevNodeId, 1]);
      }
    }

    // Positive and negative CLIP prompts must connect to the 10th LoRA ("29", 1)
    expect(graph["6"]?.inputs.clip).toEqual(["29", 1]);
    expect(graph["7"]?.inputs.clip).toEqual(["29", 1]);

    // KSampler (node 3) must receive the 10th LoRA's model output ("29", 0)
    expect(graph["3"]?.inputs.model).toEqual(["29", 0]);
  });

  it("preserves backward compatibility for 0, 1, and 4 LoRA configurations", () => {
    // 0 LoRAs
    const req0: GenerationRequest = {
      ...BASE_ILLUSTRIOUS_REQ,
      loras: [],
    };
    const { graph: graph0 } = buildComfyPromptGraph({ request: req0, availableModels: ILLUSTRIOUS_SAMPLE_MODELS });
    expect(graph0["3"]?.inputs.model).toEqual(["4", 0]);
    expect(graph0["6"]?.inputs.clip).toEqual(["4", 1]);

    // 4 LoRAs
    const req4: GenerationRequest = {
      ...BASE_ILLUSTRIOUS_REQ,
      loras: Array.from({ length: 4 }, (_, i) => ({
        name: `illustrious_lora_${i + 1}.safetensors`,
        strengthModel: 0.8,
        strengthClip: 0.8,
      })),
    };
    const { graph: graph4 } = buildComfyPromptGraph({ request: req4, availableModels: ILLUSTRIOUS_SAMPLE_MODELS });
    expect(graph4["20"]).toBeDefined();
    expect(graph4["21"]).toBeDefined();
    expect(graph4["22"]).toBeDefined();
    expect(graph4["23"]).toBeDefined();
    expect(graph4["24"]).toBeUndefined();
    expect(graph4["3"]?.inputs.model).toEqual(["23", 0]);
    expect(graph4["6"]?.inputs.clip).toEqual(["23", 1]);
  });
});
