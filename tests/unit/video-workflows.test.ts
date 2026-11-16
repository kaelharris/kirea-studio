import { describe, expect, it } from "vitest";
import {
  resolveVideoDimensions,
} from "../../src/shared/aspect-ratios";
import {
  buildComfyPromptGraph,
  getWorkflowById,
  WORKFLOW_TEMPLATES,
  validateGenerationRequest,
} from "../../src/main/comfy/workflow-registry";
import {
  resolveVideoFrameCount,
  videoDurationOptions,
} from "../../src/shared/video-utils";
import type {
  GenerationRequest,
  ModelRecord,
  WorkflowTemplate,
} from "../../src/shared/types";

const TEMPLATES = WORKFLOW_TEMPLATES as WorkflowTemplate[];

function template(id: string): WorkflowTemplate {
  const found = TEMPLATES.find((wf) => wf.id === id);
  if (!found) throw new Error(`Missing template ${id}`);
  return found;
}

const WAN = template("t2v_wan21_1_3b");
const LTX_T2V = template("t2v_ltx_2b");
const LTX_I2V = template("i2v_ltx_2b");

function model(overrides: Partial<ModelRecord>): ModelRecord {
  return {
    id: overrides.id ?? "m_video",
    name: "model",
    relativePath: "model.safetensors",
    filePath: "C:\\models\\model.safetensors",
    category: "checkpoint",
    architecture: "unknown",
    sizeBytes: 1_000_000_000,
    sha256: null,
    sourceRoot: "C:\\models",
    isDuplicate: false,
    duplicateOf: null,
    isIncomplete: false,
    compatibleWorkflows: [],
    license: null,
    description: null,
    installed: true,
    lastSeenAt: "2026-11-15T00:00:00Z",
    ...overrides,
  };
}

const WAN_PRIMARY = model({
  id: "m_wan",
  name: "wan2.1_t2v_1.3B_fp16",
  relativePath: "wan2.1_t2v_1.3B_fp16.safetensors",
  category: "diffusion_model",
  architecture: "wan_video",
  compatibleWorkflows: ["t2v_wan21_1_3b"],
});
const WAN_TEXT_ENCODER = model({
  id: "m_wan_te",
  name: "umt5_xxl_fp8_e4m3fn_scaled",
  relativePath: "umt5_xxl_fp8_e4m3fn_scaled.safetensors",
  category: "text_encoder",
  architecture: "unknown",
});
const WAN_VAE = model({
  id: "m_wan_vae",
  name: "wan_2.1_vae",
  relativePath: "wan_2.1_vae.safetensors",
  category: "vae",
  architecture: "unknown",
});

const LTX_PRIMARY = model({
  id: "m_ltx",
  name: "ltx-video-2b-v0.9.5",
  relativePath: "ltx-video-2b-v0.9.5.safetensors",
  category: "checkpoint",
  architecture: "ltx_video",
  compatibleWorkflows: ["t2v_ltx_2b", "i2v_ltx_2b"],
});
const LTX_TEXT_ENCODER = model({
  id: "m_ltx_te",
  name: "t5xxl_fp16",
  relativePath: "t5xxl_fp16.safetensors",
  category: "text_encoder",
  architecture: "unknown",
});

function videoRequest(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    workflowId: "t2v_wan21_1_3b",
    mode: "t2v",
    prompt: "a slow dolly through a rain-soaked alley",
    negativePrompt: "blurry, watermark",
    checkpoint: WAN_PRIMARY.relativePath,
    vae: null,
    loras: [],
    aspectRatio: "16:9",
    width: 832,
    height: 480,
    steps: 30,
    cfg: 6,
    sampler: "uni_pc",
    scheduler: "simple",
    seed: 7,
    randomSeed: false,
    batchCount: 1,
    batchSize: 1,
    outputFormat: "png",
    inputImagePath: null,
    denoise: 1,
    video: { fps: 16, frameCount: 33, durationSeconds: 2.0625, format: "mp4" },
    ...overrides,
  };
}

describe("Video frame grids", () => {
  it("snaps durations to the 1 + 4n Wan grid and 1 + 8n LTX grid", () => {
    const wanSpec = WAN.video!;
    expect(resolveVideoFrameCount(2, wanSpec)).toMatchObject({
      frameCount: 33,
      snapped: true,
    });
    expect(resolveVideoFrameCount(10, wanSpec)).toMatchObject({
      frameCount: 81,
      clamped: true,
    });

    const ltxSpec = LTX_T2V.video!;
    expect(resolveVideoFrameCount(4, ltxSpec)).toMatchObject({
      frameCount: 97,
      snapped: true,
    });
    expect(resolveVideoFrameCount(0.1, ltxSpec).frameCount).toBe(25);

    const options = videoDurationOptions(wanSpec);
    expect(options[0]).toBeCloseTo(17 / 16, 2);
    expect(options[options.length - 1]).toBeCloseTo(81 / 16, 2);
  });
});

describe("Video dimension resolution", () => {
  it("uses model-validated presets verbatim", () => {
    const dims = resolveVideoDimensions("16:9", WAN);
    expect(dims).toMatchObject({ width: 832, height: 480, validated: true });
    expect(resolveVideoDimensions("9:16", WAN)).toMatchObject({
      width: 480,
      height: 832,
      validated: true,
    });
  });

  it("fits other ratios to the workflow grid without cropping", () => {
    const dims = resolveVideoDimensions("4:3", WAN);
    expect(dims.validated).toBe(false);
    expect(dims.width % WAN.dimStep).toBe(0);
    expect(dims.height % WAN.dimStep).toBe(0);
    expect(dims.width).toBeLessThanOrEqual(WAN.maxDim);
    expect(dims.height).toBeGreaterThanOrEqual(WAN.minDim);
    expect(Math.abs(dims.width / dims.height - 4 / 3)).toBeLessThan(0.02);
    expect(dims.notes.length).toBeGreaterThan(0);
  });

  it("clamps custom dimensions into the workflow bounds", () => {
    const dims = resolveVideoDimensions("custom", {
      ...WAN,
      defaults: { ...WAN.defaults, width: 4096, height: 100 },
    });
    expect(dims.width).toBeLessThanOrEqual(WAN.maxDim);
    expect(dims.height).toBeGreaterThanOrEqual(WAN.minDim);
    expect(dims.clamped).toBe(true);
  });
});

describe("Video validation", () => {
  it("reports the exact missing companion files for a Wan workflow", () => {
    const issues = validateGenerationRequest(
      videoRequest(),
      [WAN_PRIMARY],
      "balanced",
      16384
    );
    const messages = issues.filter((i) => i.severity === "error").map((i) => i.message);
    expect(messages.some((m) => m.includes("umt5_xxl_fp8_e4m3fn_scaled.safetensors"))).toBe(
      true
    );
    expect(messages.some((m) => m.includes("wan_2.1_vae.safetensors"))).toBe(true);
    expect(messages.some((m) => m.includes("text_encoders"))).toBe(true);
  });

  it("accepts a fully installed Wan setup and blocks Image-to-Video without a source", () => {
    const installed = [WAN_PRIMARY, WAN_TEXT_ENCODER, WAN_VAE];
    expect(
      validateGenerationRequest(videoRequest(), installed, "balanced", 16384).filter(
        (i) => i.severity === "error"
      )
    ).toHaveLength(0);

    const lowVram = validateGenerationRequest(
      videoRequest(),
      installed,
      "balanced",
      4096
    );
    expect(lowVram.some((i) => i.severity === "error" && i.field === "video")).toBe(true);

    const i2v = validateGenerationRequest(
      videoRequest({
        workflowId: "i2v_ltx_2b",
        mode: "i2v",
        checkpoint: LTX_PRIMARY.relativePath,
        width: 768,
        height: 512,
        sampler: "euler",
        scheduler: "normal",
        cfg: 3,
        video: { fps: 24, frameCount: 97, durationSeconds: 4.0, format: "mp4" },
        inputImagePath: null,
      }),
      [LTX_PRIMARY, LTX_TEXT_ENCODER],
      "balanced",
      16384
    );
    expect(i2v.some((i) => i.severity === "error" && i.field === "inputImagePath")).toBe(
      true
    );
  });
});

describe("Video prompt graphs", () => {
  it("builds the Wan 2.1 1.3B T2V chain with native video save nodes", () => {
    const built = buildComfyPromptGraph({
      request: videoRequest(),
      availableModels: [WAN_PRIMARY, WAN_TEXT_ENCODER, WAN_VAE],
      filenamePrefix: "kirea_test",
    });
    const g = built.graph;
    expect(g["1"]?.class_type).toBe("UNETLoader");
    expect(g["1"]?.inputs.unet_name).toBe(WAN_PRIMARY.relativePath);
    expect(g["2"]?.class_type).toBe("CLIPLoader");
    expect(g["2"]?.inputs.type).toBe("wan");
    expect(g["7"]?.class_type).toBe("EmptyHunyuanLatentVideo");
    expect(g["7"]?.inputs.length).toBe(33);
    expect(g["7"]?.inputs.width).toBe(832);
    expect(g["10"]?.class_type).toBe("CreateVideo");
    expect(g["10"]?.inputs.fps).toBe(16);
    expect(g["11"]?.class_type).toBe("SaveVideo");
    expect(g["11"]?.inputs.format).toBe("mp4");
    expect(built.template.outputNodeId).toBe("11");
  });

  it("builds LTX T2V and Image-to-Video graphs with checkpoint VAE and image conditioning", () => {
    const t2v = buildComfyPromptGraph({
      request: videoRequest({
        workflowId: "t2v_ltx_2b",
        checkpoint: LTX_PRIMARY.relativePath,
        width: 768,
        height: 512,
        sampler: "euler",
        scheduler: "normal",
        cfg: 3,
        video: { fps: 24, frameCount: 97, durationSeconds: 4.0, format: "webm" },
      }),
      availableModels: [LTX_PRIMARY, LTX_TEXT_ENCODER],
      filenamePrefix: "kirea_ltx",
    });
    expect(t2v.graph["1"]?.class_type).toBe("CheckpointLoaderSimple");
    expect(t2v.graph["2"]?.inputs.type).toBe("ltxv");
    expect(t2v.graph["5"]?.class_type).toBe("EmptyLTXVLatentVideo");
    expect(t2v.graph["5"]?.inputs.length).toBe(97);
    expect(t2v.graph["6"]?.class_type).toBe("LTXVConditioning");
    expect(t2v.graph["6"]?.inputs.frame_rate).toBe(24);
    expect((t2v.graph["8"]?.inputs.vae as unknown[])[0]).toBe("1");
    expect(t2v.graph["10"]?.inputs.format).toBe("webm");

    const i2v = buildComfyPromptGraph({
      request: videoRequest({
        workflowId: "i2v_ltx_2b",
        mode: "i2v",
        checkpoint: LTX_PRIMARY.relativePath,
        inputImagePath: "C:\\inputs\\start.png",
        width: 768,
        height: 512,
        sampler: "euler",
        scheduler: "normal",
        cfg: 3,
        video: { fps: 24, frameCount: 97, durationSeconds: 4.0, format: "mp4" },
      }),
      uploadedInputFilename: "kirea_start.png",
      availableModels: [LTX_PRIMARY, LTX_TEXT_ENCODER],
      filenamePrefix: "kirea_i2v",
    });
    expect(i2v.graph["5"]?.class_type).toBe("LoadImage");
    expect(i2v.graph["6"]?.class_type).toBe("ImageScale");
    expect(i2v.graph["7"]?.class_type).toBe("LTXVImgToVideo");
    expect((i2v.graph["7"]?.inputs.image as unknown[])[0]).toBe("6");
    expect(i2v.graph["7"]?.inputs.length).toBe(97);
    expect(i2v.graph["11"]?.class_type).toBe("SaveVideo");
    expect(getWorkflowById("i2v_ltx_2b")?.mode).toBe("i2v");
  });
});
