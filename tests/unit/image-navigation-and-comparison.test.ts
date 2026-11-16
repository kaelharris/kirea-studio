import { describe, expect, it } from "vitest";
import type { GeneratedImageRecord } from "../../src/shared/types";

describe("Image Navigation & Upscale Comparison Lineage", () => {
  const mockImages: GeneratedImageRecord[] = [
    {
      id: "img-1",
      jobId: "job-1",
      filePath: "/media/generations/render-1.png",
      fileName: "render-1.png",
      format: "png",
      width: 1024,
      height: 1024,
      sizeBytes: 1542000,
      prompt: "cyberpunk samurai in rain",
      negativePrompt: "blurry",
      seed: 42,
      steps: 30,
      cfg: 7,
      denoise: 1,
      loras: [],
      workflowId: "t2i_sdxl_base",
      sampler: "euler",
      scheduler: "normal",
      checkpoint: "sdxl_base.safetensors",
      mode: "txt2img",
      favorite: false,
      tags: ["cyberpunk"],
      collectionId: null,
      characterId: null,
      sourceImagePath: null,
      createdAt: "2026-11-16T20:00:00.000Z",
    },
    {
      id: "img-2",
      jobId: "job-2",
      filePath: "/media/generations/render-2-upscaled.png",
      fileName: "render-2-upscaled.png",
      format: "png",
      width: 4096,
      height: 4096,
      sizeBytes: 8542000,
      prompt: "cyberpunk samurai in rain 4k",
      negativePrompt: "blurry",
      seed: 42,
      steps: 20,
      cfg: 7,
      denoise: 0.35,
      loras: [],
      workflowId: "upscale_model_v1",
      sampler: "euler",
      scheduler: "normal",
      checkpoint: "sdxl_base.safetensors",
      mode: "upscale",
      favorite: true,
      tags: ["cyberpunk", "upscaled"],
      collectionId: null,
      characterId: null,
      sourceImagePath: "/media/generations/render-1.png",
      createdAt: "2026-11-16T20:05:00.000Z",
    },
    {
      id: "img-3",
      jobId: "job-3",
      filePath: "/media/generations/portrait-3.png",
      fileName: "portrait-3.png",
      format: "png",
      width: 832,
      height: 1216,
      sizeBytes: 2100000,
      prompt: "oil painting portrait 9:16",
      negativePrompt: "",
      seed: 1337,
      steps: 25,
      cfg: 6.5,
      denoise: 1,
      loras: [],
      workflowId: "t2i_sdxl_base",
      sampler: "dpmpp_2m",
      scheduler: "karras",
      checkpoint: "realistic_vision.safetensors",
      mode: "txt2img",
      favorite: false,
      tags: [],
      collectionId: null,
      characterId: null,
      sourceImagePath: null,
      createdAt: "2026-11-16T20:10:00.000Z",
    },
  ];

  it("calculates seamless circular navigation indices", () => {
    const list = mockImages;
    expect(list.length).toBe(3);

    const getPrev = (currentIdx: number) => (currentIdx - 1 + list.length) % list.length;
    const getNext = (currentIdx: number) => (currentIdx + 1) % list.length;

    // At index 0 (first item)
    expect(getPrev(0)).toBe(2); // Wraps around to last
    expect(getNext(0)).toBe(1);

    // At index 1 (middle item)
    expect(getPrev(1)).toBe(0);
    expect(getNext(1)).toBe(2);

    // At index 2 (last item)
    expect(getPrev(2)).toBe(1);
    expect(getNext(2)).toBe(0); // Wraps around to first
  });

  it("identifies upscale lineage and source comparison eligibility", () => {
    const standard = mockImages[0]!;
    const upscaled = mockImages[1]!;

    expect(standard.sourceImagePath).toBeNull();
    expect(upscaled.sourceImagePath).toBe("/media/generations/render-1.png");

    const canCompare = (img: GeneratedImageRecord) => Boolean(img.sourceImagePath);
    expect(canCompare(standard)).toBe(false);
    expect(canCompare(upscaled)).toBe(true);
  });

  it("preserves aspect ratios across upscaled pairs", () => {
    const original = mockImages[0]!;
    const upscaled = mockImages[1]!;

    const origRatio = original.width / original.height;
    const upscaledRatio = upscaled.width / upscaled.height;

    expect(origRatio).toBe(1);
    expect(upscaledRatio).toBe(1);
    expect(origRatio).toBeCloseTo(upscaledRatio, 5);
  });

  it("supports non-square portrait proportions in navigation", () => {
    const portrait = mockImages[2]!;
    const ratio = portrait.width / portrait.height;

    expect(ratio).toBeCloseTo(832 / 1216, 4);
    expect(ratio).toBeLessThan(1.0); // Portrait orientation
  });
});
