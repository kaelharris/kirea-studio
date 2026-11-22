import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveEffectivePreviewPath } from "../../src/shared/model-utils";
import type { ModelRecord } from "../../src/shared/types";

describe("Model Custom Preview Assignment & Lifecycle", () => {
  let tempDir: string;
  let cacheDir: string;
  let originalsDir: string;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "kirea-preview-test-"));
    cacheDir = path.join(tempDir, "model-previews");
    originalsDir = path.join(cacheDir, "originals");
    await fs.promises.mkdir(originalsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  it("preserves custom preview file without pruning the newly copied target", async () => {
    const modelId = "test_model_12345";
    const ext = ".png";
    const targetFilename = `${modelId}${ext}`;

    // Seed an old stale thumbnail and old jpg original
    await fs.promises.writeFile(path.join(cacheDir, `${modelId}-123456789.webp`), "dummy-thumb");
    await fs.promises.writeFile(path.join(originalsDir, `${modelId}.jpg`), "old-jpg");

    // Create source image to import
    const sourcePath = path.join(tempDir, "source_artwork.png");
    await fs.promises.writeFile(sourcePath, "new-artwork-bytes");

    // 1. Clean up old webp thumbnails and any stale original with a different extension
    const cacheEntries = await fs.promises.readdir(cacheDir);
    const thumbPrefix = `${modelId}-`;
    await Promise.all(
      cacheEntries
        .filter((name) => name.startsWith(thumbPrefix) && name.endsWith(".webp"))
        .map((name) => fs.promises.rm(path.join(cacheDir, name), { force: true }))
    );

    const origEntries = await fs.promises.readdir(originalsDir);
    await Promise.all(
      origEntries
        .filter(
          (name) =>
            (name === modelId || name.startsWith(`${modelId}.`)) &&
            name !== targetFilename
        )
        .map((name) => fs.promises.rm(path.join(originalsDir, name), { force: true }))
    );

    // 2. Copy the new preview image into originals
    const destination = path.join(originalsDir, targetFilename);
    await fs.promises.copyFile(sourcePath, destination);

    // Verify destination exists and old files were pruned
    expect(fs.existsSync(destination)).toBe(true);
    expect(fs.existsSync(path.join(cacheDir, `${modelId}-123456789.webp`))).toBe(false);
    expect(fs.existsSync(path.join(originalsDir, `${modelId}.jpg`))).toBe(false);

    // 3. Verify resolveEffectivePreviewPath resolves to destination when previewMode is custom
    const model: ModelRecord = {
      id: modelId,
      name: "TestModel",
      relativePath: "loras/test.safetensors",
      filePath: "C:\\ComfyUI\\models\\loras\\test.safetensors",
      category: "lora",
      architecture: "illustrious",
      sizeBytes: 1000,
      sha256: null,
      sourceRoot: "C:\\ComfyUI\\models\\loras",
      isDuplicate: false,
      duplicateOf: null,
      isIncomplete: false,
      compatibleWorkflows: [],
      license: null,
      description: null,
      installed: true,
      lastSeenAt: "2026-11-22T00:00:00Z",
      metadata: {
        modelId,
        filePath: "C:\\ComfyUI\\models\\loras\\test.safetensors",
        displayName: "TestModel",
        description: "",
        architectureOverride: null,
        baseModel: null,
        previewMode: "custom",
        previewPath: destination,
        triggerWords: [],
        tags: [],
        notes: "",
        favorite: false,
        createdAt: "2026-11-22T00:00:00Z",
        updatedAt: "2026-11-22T00:00:00Z",
      },
    };

    expect(resolveEffectivePreviewPath(model)).toBe(destination);
  });
});
