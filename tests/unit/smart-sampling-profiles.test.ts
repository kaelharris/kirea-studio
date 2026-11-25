import { describe, expect, it } from "vitest";
import {
  detectModelVariant,
  findSamplingProfile,
  isProfileCustomized,
  MODEL_SAMPLING_PROFILES,
  validateSamplingProfileSupport,
} from "../../src/shared/sampling-profiles";

describe("Smart Sampling Profiles Registry", () => {
  it("detects model variants accurately from names and paths", () => {
    expect(detectModelVariant("sd_xl_turbo_1.0_fp16.safetensors")).toBe("turbo");
    expect(detectModelVariant("sdxl_lightning_8step.safetensors")).toBe("lightning");
    expect(detectModelVariant("flux1-schnell.safetensors")).toBe("schnell");
    expect(detectModelVariant("flux1-dev-fp8.safetensors")).toBe("dev");
    expect(detectModelVariant("moss_image_sft_instruct.safetensors")).toBe("sft");
    expect(detectModelVariant("krea2_raw_photo.safetensors")).toBe("raw");
    expect(detectModelVariant("krea_turbo_realtime.safetensors")).toBe("turbo");
    expect(detectModelVariant("z_image_turbo_checkpoint.safetensors")).toBe("turbo");
    expect(detectModelVariant("wan2.1_i2v_480p_14B.safetensors")).toBe("v2.1");
    expect(detectModelVariant("illustrious_xl_v0.1.safetensors")).toBe("base");
  });

  it("retrieves official profiles for SDXL Base, Turbo, and Lightning with proper locked settings", () => {
    const sdxlBase = findSamplingProfile("sdxl", "base", "txt2img");
    expect(sdxlBase.id).toBe("sdxl_base_txt2img");
    expect(sdxlBase.sampling.steps).toBe(24);
    expect(sdxlBase.sampling.sampler).toBe("dpmpp_2m");
    expect(sdxlBase.sampling.scheduler).toBe("karras");
    expect(sdxlBase.sampling.cfg).toBe(6.5);
    expect(sdxlBase.provenance.confidence).toBe("official");

    const sdxlTurbo = findSamplingProfile("sdxl", "turbo", "txt2img");
    expect(sdxlTurbo.id).toBe("sdxl_turbo_txt2img");
    expect(sdxlTurbo.sampling.steps).toBe(4);
    expect(sdxlTurbo.sampling.cfg).toBe(1.0);
    expect(sdxlTurbo.lockedParameters).toContain("cfg");

    const sdxlLightning = findSamplingProfile("sdxl", "lightning", "txt2img");
    expect(sdxlLightning.id).toBe("sdxl_lightning_txt2img");
    expect(sdxlLightning.sampling.steps).toBe(8);
    expect(sdxlLightning.sampling.scheduler).toBe("sgm_uniform");
  });

  it("retrieves distinct profiles for Illustrious and Pony", () => {
    const ill = findSamplingProfile("illustrious", "base", "txt2img");
    expect(ill.sampling.steps).toBe(28);
    expect(ill.sampling.sampler).toBe("euler");
    expect(ill.sampling.scheduler).toBe("normal");
    expect(ill.sampling.cfg).toBe(7.0);

    const pony = findSamplingProfile("pony", "base", "txt2img");
    expect(pony.sampling.steps).toBe(25);
    expect(pony.sampling.sampler).toBe("euler_ancestral");
    expect(pony.sampling.scheduler).toBe("normal");
    expect(pony.sampling.cfg).toBe(7.0);
  });

  it("retrieves Flux Dev and Schnell profiles with appropriate guidance and locked steps", () => {
    const fluxDev = findSamplingProfile("flux", "dev", "txt2img");
    expect(fluxDev.sampling.steps).toBe(25);
    expect(fluxDev.sampling.guidance).toBe(3.5);
    expect(fluxDev.sampling.cfg).toBe(1.0);
    expect(fluxDev.lockedParameters).toContain("cfg");

    const fluxSchnell = findSamplingProfile("flux", "schnell", "txt2img");
    expect(fluxSchnell.sampling.steps).toBe(4);
    expect(fluxSchnell.sampling.guidance).toBe(1.0);
    expect(fluxSchnell.lockedParameters).toContain("steps");
    expect(fluxSchnell.lockedParameters).toContain("cfg");
  });

  it("supports task-specific differentiation between txt2img and img2img", () => {
    const sdxlTxt = findSamplingProfile("sdxl", "base", "txt2img");
    const sdxlImg = findSamplingProfile("sdxl", "base", "img2img");

    expect(sdxlTxt.sampling.denoise).toBe(1.0);
    expect(sdxlImg.sampling.denoise).toBe(0.65);
    expect(sdxlImg.task).toBe("img2img");

    const mossTxt = findSamplingProfile("moss_image", "sft", "txt2img");
    const mossEdit = findSamplingProfile("moss_image", "sft", "img2img");
    expect(mossTxt.workflowId).toBe("t2i_moss_image");
    expect(mossEdit.workflowId).toBe("i2i_moss_image_edit");
    expect(mossEdit.sampling.denoise).toBe(0.70);
  });

  it("provides Krea 2 image-to-image profiles for raw and turbo variants", () => {
    const raw = findSamplingProfile("krea2", "raw", "img2img");
    expect(raw.id).toBe("krea2_raw_img2img");
    expect(raw.workflowId).toBe("i2i_krea2_base");
    expect(raw.task).toBe("img2img");
    expect(raw.sampling.denoise).toBe(0.65);

    const turbo = findSamplingProfile("krea2", "turbo", "img2img");
    expect(turbo.id).toBe("krea2_turbo_img2img");
    expect(turbo.workflowId).toBe("i2i_krea2_base");
    expect(turbo.task).toBe("img2img");
    expect(turbo.sampling.steps).toBe(8);
    expect(turbo.sampling.denoise).toBe(0.65);
  });

  it.each([
    ["flux", "dev", "img2img"],
    ["pony", "base", "inpaint"],
    ["unknown-family", "base", "outpaint"],
    ["unknown-family", "base", "upscale"],
  ])("uses an img2img-safe fallback for %s %s %s", (family, variant, task) => {
    const profile = findSamplingProfile(family, variant, task);

    expect(profile.task).toBe("img2img");
    expect(profile.sampling.denoise).toBeTypeOf("number");
    expect(profile.sampling.denoise!).toBeLessThan(1.0);
  });

  it("validates runtime support against available samplers and schedulers from ComfyUI", () => {
    const profile = findSamplingProfile("illustrious", "base", "txt2img");

    const validResult = validateSamplingProfileSupport(
      profile,
      ["euler", "dpmpp_2m", "ddim"],
      ["normal", "karras", "simple"]
    );
    expect(validResult.supported).toBe(true);
    expect(validResult.missingSamplers).toHaveLength(0);

    const invalidResult = validateSamplingProfileSupport(
      profile,
      ["dpmpp_2m"], // Missing 'euler'
      ["karras"]    // Missing 'normal'
    );
    expect(invalidResult.supported).toBe(false);
    expect(invalidResult.missingSamplers).toContain("euler");
    expect(invalidResult.missingSchedulers).toContain("normal");
  });

  it("detects when user settings have been customized compared to recommended profile", () => {
    const profile = findSamplingProfile("sdxl", "base", "txt2img");

    const exactMatch = {
      steps: 24,
      sampler: "dpmpp_2m",
      scheduler: "karras",
      cfg: 6.5,
    };
    expect(isProfileCustomized(profile, exactMatch)).toBe(false);

    const customSteps = {
      ...exactMatch,
      steps: 32,
    };
    expect(isProfileCustomized(profile, customSteps)).toBe(true);

    const customSampler = {
      ...exactMatch,
      sampler: "euler",
    };
    expect(isProfileCustomized(profile, customSampler)).toBe(true);
  });
});
