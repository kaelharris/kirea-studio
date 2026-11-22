import { describe, expect, it } from "vitest";
import type {
  HuggingFaceFile,
  HuggingFaceFileKind,
  HuggingFaceRepoDetails,
} from "../../src/shared/huggingface";
import type { GpuStats, ModelCategory, ModelRecord } from "../../src/shared/types";
import { evaluateHuggingFaceCompatibility, type CompatibilityInput } from "../../src/main/huggingface/compatibility";
import type { SafetensorsProbe } from "../../src/main/huggingface/hf-client";
import { getWorkflowById } from "../../src/main/comfy/workflow-templates";

function makeFile(
  filePath: string,
  overrides: Partial<HuggingFaceFile> = {}
): HuggingFaceFile {
  const kind: HuggingFaceFileKind = overrides.kind ?? "diffusion_model";
  return {
    path: filePath,
    sizeBytes: 2_900_000_000,
    sha256: null,
    format: "safetensors",
    quantization: "FP16",
    kind,
    selectable: true,
    primary: false,
    ...overrides,
  };
}

function makeDetails(
  files: HuggingFaceFile[],
  overrides: Partial<HuggingFaceRepoDetails> = {}
): HuggingFaceRepoDetails {
  return {
    id: "Comfy-Org/Wan_2.1_ComfyUI_repackaged",
    author: "Comfy-Org",
    downloads: 10,
    likes: 1,
    pipelineTag: "text-to-video",
    tags: ["comfyui", "wan2.1"],
    lastModified: null,
    gated: false,
    private: false,
    license: "apache-2.0",
    thumbnailUrl: null,
    architecture: "wan_video",
    architectureLabel: "Wan Video",
    runnable: true,
    supportReason: "Wan 2.1 1.3B text-to-video maps to Kirea's installed Wan workflow.",
    workflowId: "t2v_wan21_1_3b",
    revision: "main",
    description: null,
    cardData: null,
    config: {},
    modelIndex: null,
    files,
    requiredComponents: [],
    ...overrides,
  };
}

function nativeProbe(overrides: Partial<SafetensorsProbe> = {}): SafetensorsProbe {
  return {
    ok: true,
    reason: null,
    tensorCount: 825,
    dtypes: { BF16: 825 },
    hasKrea2Signature: false,
    hasWanSignature: true,
    hasLtxSignature: false,
    nativeFormat: "comfyui",
    metadata: null,
    ...overrides,
  };
}

function makeHardware(overrides: Partial<GpuStats> = {}): GpuStats {
  return {
    available: true,
    name: "NVIDIA GeForce RTX 4080",
    driverVersion: "1",
    cudaVersion: "12.8",
    vramTotalMB: 16_384,
    vramFreeMB: 15_000,
    vramUsedMB: 1_384,
    systemRamTotalMB: 65_536,
    systemRamFreeMB: 48_000,
    diskFreeGB: { "C:": 500 },
    recommendedMaxBatch: 1,
    advisories: [],
    ...overrides,
  };
}

function makeInstalledModel(
  name: string,
  category: ModelCategory,
  overrides: Partial<ModelRecord> = {}
): ModelRecord {
  return {
    id: `model_${name}`,
    name,
    relativePath: name,
    filePath: `C:\\Comfy\\models\\${category}\\${name}`,
    category,
    architecture: "wan_video",
    sizeBytes: 1,
    sha256: null,
    sourceRoot: "C:\\Comfy\\models",
    isDuplicate: false,
    duplicateOf: null,
    isIncomplete: false,
    compatibleWorkflows: [],
    license: null,
    description: null,
    installed: true,
    lastSeenAt: "2026-11-17T00:00:00.000Z",
    ...overrides,
  };
}

function runtimeFor(workflowId: string) {
  const template = getWorkflowById(workflowId)!;
  return {
    connected: true,
    comfyVersion: "0.45.2",
    nodeClasses: new Set(template.requiredNodes),
  };
}

const WAN_PRIMARY = makeFile(
  "split_files/diffusion_models/wan2.1_t2v_1.3B_fp16.safetensors",
  { primary: true }
);
const WAN_TEXT_ENCODER = makeFile(
  "split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors",
  { kind: "text_encoder", quantization: "FP8", sizeBytes: 6_700_000_000 }
);
const WAN_VAE = makeFile("split_files/vae/wan_2.1_vae.safetensors", {
  kind: "vae",
  quantization: null,
  sizeBytes: 250_000_000,
});

const WAN_COMPONENTS = [
  makeInstalledModel("umt5_xxl_fp8_e4m3fn_scaled.safetensors", "text_encoder"),
  makeInstalledModel("wan_2.1_vae.safetensors", "vae"),
];

function baseInput(
  files: HuggingFaceFile[],
  overrides: Partial<CompatibilityInput> = {}
): CompatibilityInput {
  const details = makeDetails(files);
  return {
    details,
    selectedPaths: files.map((file) => file.path),
    hardware: makeHardware(),
    runtime: runtimeFor("t2v_wan21_1_3b"),
    installedModels: WAN_COMPONENTS,
    diskFreeBytes: 500 * 1024 ** 3,
    probe: nativeProbe(),
    ...overrides,
  };
}

describe("Hugging Face compatibility engine", () => {
  it("marks a native Wan 1.3B T2V file with installed companions compatible", () => {
    const report = evaluateHuggingFaceCompatibility(
      baseInput([WAN_PRIMARY, WAN_TEXT_ENCODER, WAN_VAE])
    );

    expect(report.status).toBe("COMPATIBLE");
    expect(report.workflowId).toBe("t2v_wan21_1_3b");
    expect(report.missingNodes).toEqual([]);
    expect(report.missingComponents).toEqual([]);
    expect(report.checks.find((check) => check.id === "format")?.status).toBeUndefined();
  });

  it("blocks a Diffusers transformer with an exact loader reason", () => {
    const diffusersPrimary = makeFile("diffusion_pytorch_model.safetensors", {
      primary: true,
      format: "diffusers",
      quantization: null,
      sizeBytes: 5_680_000_000,
    });
    const report = evaluateHuggingFaceCompatibility(
      baseInput([diffusersPrimary, WAN_TEXT_ENCODER, WAN_VAE], {
        probe: nativeProbe({ nativeFormat: "diffusers", hasWanSignature: false }),
      })
    );

    expect(report.status).toBe("INCOMPATIBLE");
    const format = report.checks.find((check) => check.id === "format");
    expect(format?.status).toBe("fail");
    expect(format?.detail).toContain("UNETLoader");
    expect(report.blockingReasons.join(" ")).toContain("Diffusers-format");
  });

  it("blocks downloads when total VRAM is below the workflow minimum", () => {
    const report = evaluateHuggingFaceCompatibility(
      baseInput([WAN_PRIMARY, WAN_TEXT_ENCODER, WAN_VAE], {
        hardware: makeHardware({ vramTotalMB: 6_144, vramFreeMB: 6_000 }),
      })
    );

    expect(report.status).toBe("INCOMPATIBLE");
    expect(report.checks.find((check) => check.id === "vram")?.status).toBe("fail");
  });

  it("treats missing ComfyUI nodes as a hard block", () => {
    const report = evaluateHuggingFaceCompatibility(
      baseInput([WAN_PRIMARY, WAN_TEXT_ENCODER, WAN_VAE], {
        runtime: { connected: true, comfyVersion: "0.45.2", nodeClasses: new Set<string>() },
      })
    );

    expect(report.status).toBe("INCOMPATIBLE");
    expect(report.missingNodes).toContain("UNETLoader");
  });

  it("makes missing companion components conditional, not compatible", () => {
    const report = evaluateHuggingFaceCompatibility(
      baseInput([WAN_PRIMARY], { installedModels: [] })
    );

    expect(report.status).toBe("CONDITIONAL");
    expect(report.missingComponents.map((component) => component.fileName)).toEqual([
      "umt5_xxl_fp8_e4m3fn_scaled.safetensors",
      "wan_2.1_vae.safetensors",
    ]);
  });

  it("blocks insufficient disk space", () => {
    const report = evaluateHuggingFaceCompatibility(
      baseInput([WAN_PRIMARY, WAN_TEXT_ENCODER, WAN_VAE], {
        diskFreeBytes: 1024 ** 3,
      })
    );

    expect(report.status).toBe("INCOMPATIBLE");
    expect(report.checks.find((check) => check.id === "disk")?.status).toBe("fail");
  });

  it("blocks unsupported architectures", () => {
    const hunyuan = makeFile("hunyuan_video_t2v.safetensors", {
      primary: true,
      kind: "checkpoint",
    });
    const report = evaluateHuggingFaceCompatibility(
      baseInput([hunyuan], {
        details: makeDetails([hunyuan], {
          id: "hunyuanvideo-community/HunyuanVideo",
          architecture: "unknown",
          architectureLabel: "Unsupported video architecture",
          workflowId: null,
          runnable: false,
          tags: ["hunyuan-video"],
        }),
        runtime: { connected: true, comfyVersion: "0.45.2", nodeClasses: new Set<string>() },
        installedModels: [],
        probe: nativeProbe({ hasWanSignature: false }),
      })
    );

    expect(report.status).toBe("INCOMPATIBLE");
    expect(report.checks.find((check) => check.id === "architecture")?.status).toBe("fail");
  });

  it("reports UNKNOWN when the ComfyUI runtime cannot be inspected", () => {
    const report = evaluateHuggingFaceCompatibility(
      baseInput([WAN_PRIMARY, WAN_TEXT_ENCODER, WAN_VAE], {
        runtime: { connected: false, comfyVersion: null, nodeClasses: null },
      })
    );

    expect(report.status).toBe("UNKNOWN");
    expect(report.checks.find((check) => check.id === "nodes")?.status).toBe("unknown");
  });

  it("rejects GGUF/quantized weights the shipped loaders cannot use", () => {
    const gguf = makeFile("wan2.1_t2v_1.3B-Q4_K_M.gguf", {
      primary: true,
      format: "gguf",
      quantization: "Q4_K_M",
    });
    const report = evaluateHuggingFaceCompatibility(
      baseInput([gguf, WAN_TEXT_ENCODER, WAN_VAE], { probe: null })
    );

    expect(report.status).toBe("INCOMPATIBLE");
    expect(report.checks.find((check) => check.id === "quantization")?.status).toBe("fail");
  });

  it("flags duplicates without changing an otherwise compatible result", () => {
    const installed = makeInstalledModel(
      "wan2.1_t2v_1.3B_fp16.safetensors",
      "diffusion_model",
      { sha256: "b".repeat(64), sizeBytes: WAN_PRIMARY.sizeBytes }
    );
    const primary = makeFile(WAN_PRIMARY.path, {
      primary: true,
      sha256: "b".repeat(64),
    });
    const report = evaluateHuggingFaceCompatibility(
      baseInput([primary, WAN_TEXT_ENCODER, WAN_VAE], {
        installedModels: [...WAN_COMPONENTS, installed],
      })
    );

    expect(report.status).toBe("COMPATIBLE");
    expect(report.duplicateOf).toBe("wan2.1_t2v_1.3B_fp16.safetensors");
    expect(report.checks.find((check) => check.id === "duplicate")?.status).toBe("warn");
  });

  it("requires a main model file, not only companion components", () => {
    const report = evaluateHuggingFaceCompatibility(
      baseInput([WAN_TEXT_ENCODER, WAN_VAE])
    );

    expect(report.status).toBe("INCOMPATIBLE");
    expect(report.checks.find((check) => check.id === "weights")?.title).toBe(
      "No main model file selected"
    );
  });

  it("blocks selecting two main model weights at once", () => {
    const wan14b = makeFile(
      "split_files/diffusion_models/wan2.1_t2v_14B_fp16.safetensors",
      { sizeBytes: 28_000_000_000 }
    );
    const report = evaluateHuggingFaceCompatibility(
      baseInput([WAN_PRIMARY, wan14b, WAN_TEXT_ENCODER, WAN_VAE])
    );

    expect(report.status).toBe("INCOMPATIBLE");
    expect(report.checks.find((check) => check.id === "architecture")?.title).toBe(
      "Multiple main model files selected"
    );
  });

  it("blocks an unsupported companion quantization", () => {
    const ggufEncoder = makeFile("t5xxl-Q4_K_M.gguf", {
      kind: "text_encoder",
      format: "gguf",
      quantization: "Q4_K_M",
      sizeBytes: 3_000_000_000,
    });
    const report = evaluateHuggingFaceCompatibility(
      baseInput([WAN_PRIMARY, ggufEncoder, WAN_VAE])
    );

    expect(report.status).toBe("INCOMPATIBLE");
    expect(
      report.checks.find((check) => check.id === "quantization_companion")?.status
    ).toBe("fail");
  });

  it("accepts the native LTX 2B checkpoint with installed T5", () => {
    const ltxPrimary = makeFile("ltxv-2b-0.9.8-distilled.safetensors", {
      primary: true,
      kind: "checkpoint",
      sizeBytes: 9_500_000_000,
    });
    const t5 = makeFile("t5xxl_fp16.safetensors", {
      kind: "text_encoder",
      quantization: "FP16",
      sizeBytes: 10_500_000_000,
    });
    const ltxDetails = makeDetails([ltxPrimary, t5], {
      id: "Lightricks/LTX-Video",
      architecture: "ltx_video",
      architectureLabel: "LTX Video",
      workflowId: "t2v_ltx_2b",
      tags: ["ltx-video"],
      pipelineTag: "text-to-video",
    });
    const report = evaluateHuggingFaceCompatibility({
      details: ltxDetails,
      selectedPaths: [ltxPrimary.path, t5.path],
      hardware: makeHardware(),
      runtime: runtimeFor("t2v_ltx_2b"),
      installedModels: [makeInstalledModel("t5xxl_fp16.safetensors", "text_encoder")],
      diskFreeBytes: 500 * 1024 ** 3,
      probe: nativeProbe({ hasWanSignature: false, hasLtxSignature: true }),
    });

    expect(report.status).toBe("COMPATIBLE");
    expect(report.workflowId).toBe("t2v_ltx_2b");
    expect(report.missingComponents).toEqual([]);
  });
});
