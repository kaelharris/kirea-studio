import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import {
  exportImageToDestination,
  extractPngTextChunks,
  getCollisionFreeFilePath,
  injectPngTextChunk,
  saveGeneratedImage,
} from "../../src/main/images/image-exporter";

const tempDirs: string[] = [];

afterEach(() => {
  sharp.cache(false);
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true, maxRetries: 6, retryDelay: 50 });
  }
});

describe("Image exporter & PNG metadata injection", () => {
  it("preserves PNG text chunks alongside kirea_meta and avoids file overwrites", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-img-"));
    tempDirs.push(dir);

    const basePng = await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 3,
        background: { r: 30, g: 80, b: 200 },
      },
    })
      .png()
      .toBuffer();

    const withComfyPrompt = injectPngTextChunk(
      basePng,
      "prompt",
      JSON.stringify({ "3": { class_type: "KSampler" } })
    );

    const meta = {
      app: "Kirea Studio" as const,
      version: "1.0.0",
      jobId: "job_abc",
      workflowId: "t2i_sd15_base",
      workflowVersion: "1.0.0",
      mode: "txt2img",
      prompt: "cobalt prism light",
      negativePrompt: "blur",
      checkpoint: "sd15.safetensors",
      vae: null,
      loras: [],
      seed: 9876,
      width: 64,
      height: 64,
      steps: 10,
      cfg: 7,
      sampler: "euler",
      scheduler: "normal",
      denoise: 1,
      createdAt: "2026-11-11T12:00:00.000Z",
    };

    const savedPng = await saveGeneratedImage(withComfyPrompt, dir, "png", meta, 0);
    expect(savedPng.width).toBe(64);
    expect(savedPng.height).toBe(64);

    const diskPng = fs.readFileSync(savedPng.filePath);
    const chunks = extractPngTextChunks(diskPng);
    expect(chunks.prompt).toContain("KSampler");
    expect(JSON.parse(chunks.kirea_meta!).seed).toBe(9876);

    // Collision-free path increments cleanly
    const c1 = path.join(dir, "sample.png");
    fs.writeFileSync(c1, "x");
    const c2 = getCollisionFreeFilePath(c1);
    expect(path.basename(c2)).toBe("sample-1.png");

    // WebP conversion & metadata stripping
    const webpExport = await exportImageToDestination(
      savedPng.filePath,
      path.join(dir, "clean-export.webp"),
      "webp",
      true
    );
    expect(fs.existsSync(webpExport)).toBe(true);
    const webpBuf = fs.readFileSync(webpExport);
    const webpMeta = await sharp(webpBuf).metadata();
    expect(webpMeta.format).toBe("webp");
    expect(webpMeta.exif).toBeUndefined();
  });
});
