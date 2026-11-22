import { describe, expect, it } from "vitest";
import {
  assessHuggingFaceArchitecture,
  detectHuggingFaceFormat,
  detectHuggingFaceQuantization,
  isDiffusersShardPath,
  isDiffusersWeightPath,
  isHuggingFaceWeightFile,
  isSafeRepoFilePath,
  normalizeHuggingFaceRepoId,
} from "../../src/shared/huggingface";
import { HuggingFaceClient } from "../../src/main/huggingface/hf-client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function emptyResponse(status: number): Response {
  return new Response("", { status });
}

function repoFetcher(raw: Record<string, unknown>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/models/")) return jsonResponse(raw);
    if (url.endsWith("/README.md")) {
      return new Response("---\nlicense: apache-2.0\n---\n# Test\n\n![preview](preview.png)");
    }
    if (url.endsWith("/config.json")) return jsonResponse({ model_type: "t2v" });
    return emptyResponse(404);
  }) as typeof fetch;
}

function safetensorsBuffer(keys: string[]): Buffer {
  const header = JSON.stringify(
    Object.fromEntries(
      keys.map((key, index) => [key, { dtype: "BF16", shape: [1], data_offsets: [index, index + 1] }])
    )
  );
  const headerBytes = Buffer.from(header, "utf8");
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(headerBytes.length));
  return Buffer.concat([length, headerBytes]);
}

function probeFetcher(
  file: Buffer,
  onRange?: (range: string | undefined) => void
): typeof fetch {
  return (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const range = new Headers(init?.headers).get("range") ?? undefined;
    onRange?.(range);
    if (range === "bytes=0-7") {
      return new Response(Uint8Array.from(file.subarray(0, 8)), {
        status: 206,
        headers: { "Content-Length": "8", "Content-Range": `bytes 0-7/${file.length}` },
      });
    }
    const headerLength = Number(file.readBigUInt64LE(0));
    return new Response(Uint8Array.from(file.subarray(8, 8 + headerLength)), {
      status: 206,
      headers: {
        "Content-Length": String(headerLength),
        "Content-Range": `bytes 8-${8 + headerLength - 1}/${file.length}`,
      },
    });
  }) as typeof fetch;
}

describe("Hugging Face repository identifiers", () => {
  it("accepts owner/repo and huggingface.co URLs but rejects other hosts", () => {
    expect(normalizeHuggingFaceRepoId("Wan-AI/Wan2.1-T2V-1.3B")).toBe(
      "Wan-AI/Wan2.1-T2V-1.3B"
    );
    expect(
      normalizeHuggingFaceRepoId("https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged")
    ).toBe("Comfy-Org/Wan_2.1_ComfyUI_repackaged");
    expect(
      normalizeHuggingFaceRepoId(
        "https://huggingface.co/Lightricks/LTX-Video/tree/main/ltxv-2b-0.9.8-distilled.safetensors"
      )
    ).toBe("Lightricks/LTX-Video");
    expect(normalizeHuggingFaceRepoId("https://example.com/Wan-AI/Wan2.1-T2V-1.3B")).toBeNull();
    expect(normalizeHuggingFaceRepoId("../etc/passwd")).toBeNull();
    expect(normalizeHuggingFaceRepoId("owner")).toBeNull();
  });

  it("rejects traversal, absolute, and backslash paths", () => {
    expect(isSafeRepoFilePath("split_files/diffusion_models/model.safetensors")).toBe(true);
    expect(isSafeRepoFilePath("../model.safetensors")).toBe(false);
    expect(isSafeRepoFilePath("/model.safetensors")).toBe(false);
    expect(isSafeRepoFilePath("folder\\model.safetensors")).toBe(false);
    expect(isSafeRepoFilePath("folder//model.safetensors")).toBe(false);
  });
});

describe("Hugging Face weight format rules", () => {
  it.each([
    ["diffusion_pytorch_model.safetensors", true],
    ["transformer/diffusion_pytorch_model-00001-of-00002.safetensors", true],
    ["text_encoder/model-00001-of-00005.safetensors", true],
    ["vae/diffusion_pytorch_model.safetensors", true],
    ["split_files/diffusion_models/wan2.1_t2v_1.3B_fp16.safetensors", false],
    ["ltxv-2b-0.9.8-distilled.safetensors", false],
    ["split_files/vae/wan_2.1_vae.safetensors", false],
  ])("classifies %s as diffusers=%s", (filePath, expected) => {
    expect(isDiffusersWeightPath(filePath)).toBe(expected);
    if (expected) expect(detectHuggingFaceFormat(filePath)).toBe("diffusers");
  });

  it("marks only sharded/nested pipeline components as non-selectable shards", () => {
    expect(isDiffusersShardPath("transformer/diffusion_pytorch_model-00001-of-00002.safetensors")).toBe(true);
    expect(isDiffusersShardPath("text_encoder/model.safetensors")).toBe(true);
    expect(isDiffusersShardPath("diffusion_pytorch_model.safetensors")).toBe(false);
    expect(isHuggingFaceWeightFile("diffusion_pytorch_model.safetensors")).toBe(true);
    expect(
      isHuggingFaceWeightFile("transformer/diffusion_pytorch_model-00001-of-00002.safetensors")
    ).toBe(false);
  });

  it("detects supported quantization labels", () => {
    expect(detectHuggingFaceQuantization("wan2.1_t2v_1.3B_fp16.safetensors")).toBe("FP16");
    expect(detectHuggingFaceQuantization("wan2.1_t2v_1.3B_bf16.safetensors")).toBe("BF16");
    expect(detectHuggingFaceQuantization("wan2.1_t2v_1.3B_fp8_e4m3fn.safetensors")).toBe("FP8");
    expect(detectHuggingFaceQuantization("model-q4_k_m.gguf")).toBe("Q4_K_M");
  });
});

describe("Hugging Face architecture assessment", () => {
  it("allows only the shipped Wan 2.1 1.3B T2V variant", () => {
    expect(
      assessHuggingFaceArchitecture({
        repoId: "Comfy-Org/Wan_2.1_ComfyUI_repackaged",
        pipelineTag: "text-to-video",
        tags: ["comfyui"],
        filePath: "split_files/diffusion_models/wan2.1_t2v_1.3B_fp16.safetensors",
      })
    ).toMatchObject({ runnable: true, workflowId: "t2v_wan21_1_3b" });

    expect(
      assessHuggingFaceArchitecture({
        repoId: "Comfy-Org/Wan_2.1_ComfyUI_repackaged",
        pipelineTag: "text-to-video",
        tags: ["comfyui"],
        filePath: "split_files/diffusion_models/wan2.1_fun_camera_v1.1_1.3B_bf16.safetensors",
      })
    ).toMatchObject({ runnable: false });

    expect(
      assessHuggingFaceArchitecture({
        repoId: "Wan-AI/Wan2.1-I2V-14B-720P",
        pipelineTag: "image-to-video",
        tags: [],
        filePath: "wan2.1_i2v_14B_fp16.safetensors",
      })
    ).toMatchObject({ runnable: false });
  });

  it("allows LTX 2B and rejects 13B, LoRA, and upscaler files", () => {
    expect(
      assessHuggingFaceArchitecture({
        repoId: "Lightricks/LTX-Video",
        pipelineTag: "text-to-video",
        tags: [],
        filePath: "ltxv-2b-0.9.8-distilled.safetensors",
      })
    ).toMatchObject({ runnable: true, workflowId: "t2v_ltx_2b" });

    expect(
      assessHuggingFaceArchitecture({
        repoId: "Lightricks/LTX-Video",
        pipelineTag: "text-to-video",
        tags: [],
        filePath: "ltxv-13b-0.9.8-distilled.safetensors",
      })
    ).toMatchObject({ runnable: false });

    expect(
      assessHuggingFaceArchitecture({
        repoId: "Lightricks/LTX-2.5",
        pipelineTag: "text-to-video",
        tags: ["ltx-2.5"],
        filePath: "diffusion_models/ltx-2.5-22b-dev-transformer-bf16.safetensors",
      })
    ).toMatchObject({ runnable: false });

    expect(
      assessHuggingFaceArchitecture({
        repoId: "unsloth/LTX-2.3-GGUF",
        pipelineTag: "text-to-video",
        tags: ["gguf"],
        filePath: "distilled-1.1/ltx-2.3-22b-distilled-1.1-BF16.gguf",
      })
    ).toMatchObject({ runnable: false });

    expect(
      assessHuggingFaceArchitecture({
        repoId: "Lightricks/LTX-Video",
        pipelineTag: "text-to-video",
        tags: [],
        filePath: "ltxv-2b-0.9.8-distilled-lora128.safetensors",
      })
    ).toMatchObject({ runnable: false });

    expect(
      assessHuggingFaceArchitecture({
        repoId: "Lightricks/LTX-Video",
        pipelineTag: "text-to-video",
        tags: [],
        filePath: "ltxv-spatial-upscaler-0.9.8.safetensors",
      })
    ).toMatchObject({ runnable: false });
  });

  it("keeps unsupported video architectures visible but not runnable", () => {
    expect(
      assessHuggingFaceArchitecture({
        repoId: "hunyuanvideo-community/HunyuanVideo",
        pipelineTag: "text-to-video",
        tags: ["hunyuan-video"],
        filePath: "hunyuan_video_t2v.safetensors",
      })
    ).toMatchObject({ architecture: "unknown", runnable: false });
  });
});

describe("HuggingFaceClient repository mapping", () => {
  it("selects the Wan 1.3B T2V file from a mixed ComfyUI repackaged repository", async () => {
    const fetcher = repoFetcher({
      id: "Comfy-Org/Wan_2.1_ComfyUI_repackaged",
      tags: ["comfyui", "wan2.1"],
      pipeline_tag: "text-to-video",
      siblings: [
        { rfilename: "README.md", size: 100 },
        { rfilename: "split_files/diffusion_models/wan2.1_fun_camera_v1.1_1.3B_bf16.safetensors", size: 2_800_000_000 },
        { rfilename: "split_files/diffusion_models/wan2.1_t2v_1.3B_fp16.safetensors", size: 2_900_000_000, lfs: { oid: "a".repeat(64), size: 2_900_000_000 } },
        { rfilename: "split_files/diffusion_models/wan2.1_t2v_14B_fp16.safetensors", size: 28_000_000_000 },
        { rfilename: "split_files/vae/wan_2.1_vae.safetensors", size: 250_000_000 },
        { rfilename: "split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors", size: 6_700_000_000 },
      ],
    });
    const client = new HuggingFaceClient({ getToken: () => null, fetcher });
    const details = await client.getRepoDetails("Comfy-Org/Wan_2.1_ComfyUI_repackaged");

    const primary = details.files.find((file) => file.primary);
    expect(primary?.path).toBe(
      "split_files/diffusion_models/wan2.1_t2v_1.3B_fp16.safetensors"
    );
    expect(primary?.kind).toBe("diffusion_model");
    expect(primary?.sha256).toBe("a".repeat(64));
    expect(details.runnable).toBe(true);
    expect(details.workflowId).toBe("t2v_wan21_1_3b");
  });

  it("does not claim a raw Diffusers transformer as runnable", async () => {
    const client = new HuggingFaceClient({
      getToken: () => null,
      fetcher: repoFetcher({
        id: "Wan-AI/Wan2.1-T2V-1.3B",
        tags: ["diffusers", "t2v"],
        pipeline_tag: "text-to-video",
        siblings: [
          { rfilename: "diffusion_pytorch_model.safetensors", size: 5_680_000_000 },
          { rfilename: "Wan2.1_VAE.pth", size: 250_000_000 },
          { rfilename: "models_t5_umt5-xxl-enc-bf16.pth", size: 11_000_000_000 },
        ],
      }),
    });
    const details = await client.getRepoDetails("Wan-AI/Wan2.1-T2V-1.3B");

    expect(details.runnable).toBe(false);
    expect(details.workflowId).toBeNull();
    expect(details.supportReason).toContain("Diffusers-format");
    expect(details.files.find((file) => file.primary)?.format).toBe("diffusers");
  });

  it("leaves sharded Diffusers pipelines with no selectable main weight", async () => {
    const client = new HuggingFaceClient({
      getToken: () => null,
      fetcher: repoFetcher({
        id: "Wan-AI/Wan2.1-T2V-1.3B-Diffusers",
        tags: ["diffusers"],
        pipeline_tag: "text-to-video",
        siblings: [
          { rfilename: "model_index.json", size: 500 },
          { rfilename: "transformer/diffusion_pytorch_model-00001-of-00002.safetensors", size: 3_000_000_000 },
          { rfilename: "transformer/diffusion_pytorch_model-00002-of-00002.safetensors", size: 2_700_000_000 },
          { rfilename: "text_encoder/model-00001-of-00005.safetensors", size: 2_000_000_000 },
          { rfilename: "vae/diffusion_pytorch_model.safetensors", size: 250_000_000 },
        ],
      }),
    });
    const details = await client.getRepoDetails("Wan-AI/Wan2.1-T2V-1.3B-Diffusers");

    expect(details.files.some((file) => file.primary)).toBe(false);
    expect(details.files.some((file) => file.selectable)).toBe(false);
    expect(details.runnable).toBe(false);
    expect(details.supportReason).toContain("Diffusers-format");
  });
});

describe("HuggingFaceClient safetensors probing", () => {
  it("reads only the header and recognizes native ComfyUI keys", async () => {
    const file = safetensorsBuffer([
      "model.diffusion_model.blocks.0.self_attn.q.weight",
      "model.diffusion_model.patch_embedding.weight",
      "model.diffusion_model.vae.decoder.conv_in.weight",
    ]);
    const ranges: Array<string | undefined> = [];
    const client = new HuggingFaceClient({
      getToken: () => null,
      fetcher: probeFetcher(file, (range) => ranges.push(range)),
    });
    const probe = await client.probeSafetensors(
      "Comfy-Org/Wan_2.1_ComfyUI_repackaged",
      "main",
      "split_files/diffusion_models/wan2.1_t2v_1.3B_fp16.safetensors"
    );

    expect(probe.ok).toBe(true);
    expect(probe.nativeFormat).toBe("comfyui");
    expect(probe.tensorCount).toBe(3);
    expect(ranges).toHaveLength(2);
    expect(ranges[0]).toBe("bytes=0-7");
  });

  it("recognizes bare Diffusers transformer keys", async () => {
    const file = safetensorsBuffer([
      "blocks.0.self_attn.q.weight",
      "blocks.0.cross_attn.k.weight",
      "patch_embedding.weight",
    ]);
    const client = new HuggingFaceClient({
      getToken: () => null,
      fetcher: probeFetcher(file),
    });
    const probe = await client.probeSafetensors(
      "Wan-AI/Wan2.1-T2V-1.3B",
      "main",
      "diffusion_pytorch_model.safetensors"
    );

    expect(probe.ok).toBe(true);
    expect(probe.nativeFormat).toBe("diffusers");
  });

  it("cancels instead of downloading when the server ignores Range", async () => {
    const client = new HuggingFaceClient({
      getToken: () => null,
      fetcher: (async () =>
        new Response(new Uint8Array(1), {
          status: 200,
          headers: { "Content-Length": String(100 * 1024 * 1024) },
        })) as typeof fetch,
    });
    const probe = await client.probeSafetensors(
      "Wan-AI/Wan2.1-T2V-1.3B",
      "main",
      "diffusion_pytorch_model.safetensors"
    );

    expect(probe.ok).toBe(false);
    expect(probe.reason).toContain("ignored the Range");
  });
});
