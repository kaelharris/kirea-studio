import { describe, expect, it } from "vitest";
import {
  imageWorkflowLabel,
  imageWorkflowLabels,
  jobStateLabel,
} from "../../src/shared/image-labels";
import {
  MOSS_MODEL_VARIANTS,
  isMossWorkflowReady,
  missingMossRequirements,
  mossDependencyStatus,
  mossRequirementsFor,
} from "../../src/shared/moss-image";
import type { ModelCategory } from "../../src/shared/types";

describe("image workflow labels", () => {
  it("derives labels only from persisted mode and workflow provenance", () => {
    expect(imageWorkflowLabel({ mode: "txt2img", workflowId: "t2i_sdxl_base" }).label).toBe(
      "Txt2Img"
    );
    expect(imageWorkflowLabel({ mode: "img2img", workflowId: "i2i_anima_base" }).label).toBe(
      "Img2Img"
    );
    expect(imageWorkflowLabel({ mode: "upscale", workflowId: "upscale_model_v1" }).label).toBe(
      "Upscaled"
    );
    expect(imageWorkflowLabel({ mode: "txt2img", workflowId: "t2i_moss_image" }).label).toBe(
      "MOSS-Image"
    );
    expect(
      imageWorkflowLabel({ mode: "txt2img", workflowId: "t2i_moss_image_layout" }).label
    ).toBe("MOSS-Image");
    expect(imageWorkflowLabel({ mode: "img2img", workflowId: "custom_inpaint_v2" }).label).toBe(
      "Inpaint"
    );
    expect(imageWorkflowLabel({ mode: "img2img", workflowId: "custom_outpaint" }).label).toBe(
      "Outpaint"
    );
    expect(imageWorkflowLabel({ mode: "img2img", workflowId: "my_controlnet" }).label).toBe(
      "ControlNet"
    );
  });

  it("does not infer operations from dimensions or unknown workflows", () => {
    const wide = imageWorkflowLabel({ mode: "txt2img", workflowId: "unknown_flow" });
    expect(wide.label).toBe("Txt2Img");
    expect(wide.workflowId).toBe("unknown_flow");
  });

  it("accumulates labels across a persisted operation lineage", () => {
    const labels = imageWorkflowLabels({
      mode: "img2img",
      workflowId: "i2i_moss_image_edit",
      operations: [
        {
          id: "op1",
          imageId: "img_edited",
          sequence: 0,
          operation: "moss_image",
          workflowId: "t2i_moss_image",
          workflowVersion: "1.0.0",
          checkpoint: "moss_image_sft_int8_convrot.safetensors",
          prompt: "portrait",
          seed: 1,
          parameters: {},
          parentImageId: null,
          createdAt: "2026-11-17T10:00:00.000Z",
        },
        {
          id: "op2",
          imageId: "img_edited",
          sequence: 1,
          operation: "upscale",
          workflowId: "upscale_model_v1",
          workflowVersion: "1.0.0",
          checkpoint: "moss_image_sft_int8_convrot.safetensors",
          prompt: "portrait",
          seed: 1,
          parameters: {},
          parentImageId: "img_root",
          createdAt: "2026-11-17T10:01:00.000Z",
        },
        {
          id: "op3",
          imageId: "img_edited",
          sequence: 2,
          operation: "image_edit",
          workflowId: "i2i_moss_image_edit",
          workflowVersion: "1.0.0",
          checkpoint: "moss_image_sft_int8_convrot.safetensors",
          prompt: "portrait",
          seed: 1,
          parameters: {},
          parentImageId: "img_upscaled",
          createdAt: "2026-11-17T10:02:00.000Z",
        },
      ],
    });
    expect(labels.map((label) => label.label)).toEqual([
      "MOSS-Image",
      "Upscaled",
      "Image Edited",
    ]);
  });

  it("maps processing states to visible labels", () => {
    expect(jobStateLabel("RUNNING")?.label).toBe("Generating");
    expect(jobStateLabel("PROCESSING_OUTPUT")?.label).toBe("Finalizing");
    expect(jobStateLabel("FAILED")?.tone).toBe("danger");
    expect(jobStateLabel("IDLE")).toBeNull();
  });
});

const model = (
  name: string,
  category: ModelCategory,
  installed = true,
  architecture: "moss_image" | "unknown" = "unknown"
) => ({
  name,
  relativePath: `${category}/${name}.safetensors`,
  category,
  installed,
  architecture,
});

describe("MOSS-Image dependency manifest", () => {
  const diffusion = model("moss_image_sft_bf16", "diffusion_model", true, "moss_image");
  const encoder = model("qwen3.5-9b", "text_encoder");
  const vae = model("flux2-vae_small", "vae");
  const complete = [diffusion, encoder, vae];

  it("is ready only when diffusion model, text encoder, and VAE are installed", () => {
    expect(isMossWorkflowReady(complete)).toBe(true);
    expect(missingMossRequirements(complete)).toEqual([]);

    expect(isMossWorkflowReady([diffusion, encoder])).toBe(false);
    expect(missingMossRequirements([diffusion, encoder])[0]).toContain(
      "FLUX.2 small VAE"
    );
  });

  it("treats a complete manifest without the optional LoRAs as ready", () => {
    const statuses = mossDependencyStatus(complete);
    const optional = statuses.filter((s) => !s.dependency.required);
    expect(optional.every((s) => !s.installed)).toBe(true);
    expect(isMossWorkflowReady(complete)).toBe(true);
  });

  it("ignores uninstalled matches", () => {
    expect(
      isMossWorkflowReady([
        model("moss_image_sft_bf16", "diffusion_model", false, "moss_image"),
        encoder,
        vae,
      ])
    ).toBe(false);
  });

  it("recognizes the exact Comfy-Org template filenames", () => {
    expect(
      isMossWorkflowReady([
        model("moss_image_sft_int8_convrot", "diffusion_model", true, "moss_image"),
        model("qwen3.5_9b_w4a8_gptq", "text_encoder"),
        model("flux2-vae_small", "vae"),
      ])
    ).toBe(true);
  });

  it("keeps Base-only installs from unlocking SFT workflows and vice versa", () => {
    const baseDiffusion = model(
      "moss_image_base_int8_convrot",
      "diffusion_model",
      true,
      "moss_image"
    );
    expect(isMossWorkflowReady([baseDiffusion, encoder, vae], "t2i_moss_image_base")).toBe(
      true
    );
    expect(isMossWorkflowReady([baseDiffusion, encoder, vae], "t2i_moss_image")).toBe(
      false
    );
    expect(missingMossRequirements([baseDiffusion, encoder, vae], "t2i_moss_image")).toEqual([
      "MOSS-Image SFT diffusion model",
    ]);
  });

  it("requires the matching adapter LoRA for edit and control workflows", () => {
    expect(isMossWorkflowReady(complete, "i2i_moss_image_edit")).toBe(false);
    expect(mossRequirementsFor("i2i_moss_image_edit")).toContain("moss-edit-lora");
    expect(mossRequirementsFor("i2i_moss_image_color_control")).toContain(
      "moss-color-depth-lora"
    );

    const withEditLora = [
      ...complete,
      model("moss_image_edit_lora_rank_64_bf16", "lora"),
    ];
    expect(isMossWorkflowReady(withEditLora, "i2i_moss_image_edit")).toBe(true);
    expect(isMossWorkflowReady(withEditLora, "i2i_moss_image_color_control")).toBe(
      false
    );

    const withControlLora = [
      ...complete,
      model("moss_image_color_depth_control", "lora"),
    ];
    expect(isMossWorkflowReady(withControlLora, "i2i_moss_image_depth_control")).toBe(
      true
    );
  });
});

describe("MOSS model variant manifest", () => {
  it("publishes unique official artifacts with complete download metadata", () => {
    expect(new Set(MOSS_MODEL_VARIANTS.map((variant) => variant.id)).size).toBe(
      MOSS_MODEL_VARIANTS.length
    );
    expect(new Set(MOSS_MODEL_VARIANTS.map((variant) => variant.relativePath)).size).toBe(
      MOSS_MODEL_VARIANTS.length
    );

    for (const variant of MOSS_MODEL_VARIANTS) {
      expect(variant.sizeBytes).toBeGreaterThan(0);
      expect(variant.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(variant.downloadUrl).toBe(
        `https://huggingface.co/Comfy-Org/MOSS-Image/resolve/main/${variant.relativePath}`
      );
      expect(variant.relativePath.startsWith(`${variant.targetSubdir}/`)).toBe(true);
      expect(variant.fileName).toBe(variant.relativePath.split("/").pop());
      expect(variant.sourceUrl).toBe("https://huggingface.co/Comfy-Org/MOSS-Image");
    }
  });

  it("covers SFT and Base in INT8 and BF16 plus one encoder and VAE per workflow set", () => {
    const byComponent = (componentId: string) =>
      MOSS_MODEL_VARIANTS.filter((variant) => variant.componentId === componentId);
    expect(byComponent("moss-sft")).toHaveLength(2);
    expect(byComponent("moss-base")).toHaveLength(2);
    expect(byComponent("moss-encoder")).toHaveLength(3);
    expect(byComponent("moss-vae")).toHaveLength(1);
    expect(byComponent("moss-edit-lora")).toHaveLength(1);
    expect(byComponent("moss-color-depth-lora")).toHaveLength(1);
  });
});
