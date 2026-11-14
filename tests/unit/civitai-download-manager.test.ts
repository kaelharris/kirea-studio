import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CivitaiDownloadManager,
  buildCivitaiSidecar,
  resolveCivitaiTargetPath,
  sanitizeModelFileName,
} from "../../src/main/civitai/download-manager";
import type { CivitaiModelSummary, CivitaiVersion } from "../../src/shared/civitai";
import type { AppSettings } from "../../src/shared/types";

const tempDirs: string[] = [];
const openServers: http.Server[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-civitai-"));
  tempDirs.push(dir);
  return dir;
}

function makeSettings(): AppSettings {
  return {
    runtimeMode: "external",
    externalComfyPath: "",
    comfyHost: "127.0.0.1",
    comfyPort: 8188,
    managedComfyPath: "",
    autoStartRuntime: false,
    outputDirectory: "",
    extraModelDirs: [],
    downloadDirectory: "",
    cacheDirectory: "",
    tempDirectory: "",
    performanceProfile: "balanced",
    maxActiveJobs: 1,
    defaultBatchSize: 1,
    enableMemoryWarnings: true,
    theme: "dark",
    galleryLayout: "comfortable",
    startupPage: "home",
    defaultSampler: "dpmpp_2m",
    defaultScheduler: "karras",
    defaultSteps: 24,
    defaultCfg: 6.5,
    defaultOutputFormat: "png",
    checkUpdatesAutomatically: true,
    nsfwFilter: true,
    civitaiApiKeySet: false,
  };
}

function makeModel(): CivitaiModelSummary {
  return {
    id: 501,
    name: "Test LoRA",
    creator: "artist",
    type: "LORA",
    nsfw: false,
    description: "A test LoRA for unit coverage.",
    tags: [],
    stats: { downloads: 1, thumbsUp: 2, rating: 3 },
    versions: [],
    primaryPreviewUrl: null,
    installed: false,
  };
}

function makeVersion(
  downloadUrl: string,
  overrides: Partial<CivitaiVersion> = {}
): CivitaiVersion {
  return {
    id: 201,
    name: "v1.0",
    baseModel: "SDXL 1.0",
    architecture: "sdxl",
    fileName: "test-lora.safetensors",
    downloadUrl,
    sizeBytes: 0,
    sha256: null,
    trainedWords: ["test trigger"],
    releaseNotes: null,
    primaryPreviewUrl: null,
    sampleImageUrls: [],
    publishedAt: null,
    installed: false,
    ...overrides,
  };
}

async function listen(
  handler: http.RequestListener
): Promise<{ baseUrl: string; server: http.Server }> {
  const server = http.createServer(handler);
  openServers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not expose a TCP port.");
  }
  return { baseUrl: `http://127.0.0.1:${address.port}`, server };
}

async function closeServer(server: http.Server): Promise<void> {
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

afterEach(async () => {
  while (openServers.length > 0) {
    const server = openServers.pop()!;
    if (server.listening) await closeServer(server);
  }
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("Civitai download path helpers", () => {
  it("sanitizes file names while preserving safe model extensions", () => {
    expect(sanitizeModelFileName("..\\evil/na<me>.safetensors", "fallback")).toBe(
      "na_me_.safetensors"
    );
    expect(sanitizeModelFileName("my model", "fallback-model")).toBe(
      "my model.safetensors"
    );
    expect(sanitizeModelFileName("", "fallback-model")).toBe(
      "fallback-model.safetensors"
    );
  });

  it("places checkpoints and LoRAs in architecture subfolders", () => {
    const root = "C:\\vault\\models";
    expect(
      resolveCivitaiTargetPath(root, "Checkpoint", "illustrious", "model.safetensors")
    ).toBe(path.join(root, "checkpoints", "illustrious", "model.safetensors"));
    expect(
      resolveCivitaiTargetPath(root, "LORA", "pony", "style.safetensors")
    ).toBe(path.join(root, "loras", "pony", "style.safetensors"));
    expect(
      resolveCivitaiTargetPath(root, "Checkpoint", "unknown", "model.safetensors")
    ).toBe(path.join(root, "checkpoints", "model.safetensors"));
    expect(resolveCivitaiTargetPath(root, "VAE", "sdxl", "vae.safetensors")).toBe(
      path.join(root, "vae", "vae.safetensors")
    );
    expect(
      resolveCivitaiTargetPath(root, "Upscaler", "sdxl", "up.safetensors")
    ).toBe(path.join(root, "upscale_models", "up.safetensors"));
  });

  it("builds a .civitai.info sidecar payload with trigger words and provenance", () => {
    const sidecar = buildCivitaiSidecar(
      {
        modelId: 501,
        versionId: 201,
        modelName: "Test LoRA",
        versionName: "v1.0",
        baseModel: "SDXL 1.0",
        trainedWords: ["test trigger"],
        description: "desc",
        sha256: "abc123",
      },
      "2026-11-12T00:00:00.000Z"
    );

    expect(sidecar).toMatchObject({
      source: "civitai",
      modelId: 501,
      modelVersionId: 201,
      modelName: "Test LoRA",
      name: "v1.0",
      baseModel: "SDXL 1.0",
      trainedWords: ["test trigger"],
      description: "desc",
      sha256: "abc123",
      modelUrl: "https://civitai.com/models/501?modelVersionId=201",
      downloadedAt: "2026-11-12T00:00:00.000Z",
    });
  });
});

describe("CivitaiDownloadManager transfers", () => {
  it("installs a verified file, writes sidecar and preview, and removes .part", async () => {
    const tempDir = makeTempDir();
    const modelsRoot = path.join(tempDir, "models");
    const previewCacheDir = path.join(tempDir, "cache");
    const payload = Buffer.alloc(64 * 1024, 7);
    const previewBytes = Buffer.from("RIFFxxxxWEBP-preview");

    const { baseUrl, server } = await listen((req, res) => {
      if (req.url?.startsWith("/preview")) {
        res.writeHead(200, {
          "content-type": "image/webp",
          "content-length": previewBytes.length,
        });
        res.end(previewBytes);
        return;
      }
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": payload.length,
      });
      res.end(payload);
    });

    try {
      const manager = new CivitaiDownloadManager({
        allowLoopbackHttpForTests: true,
        previewCacheDir,
      });
      const version = makeVersion(`${baseUrl}/file`, {
        sizeBytes: payload.length,
        primaryPreviewUrl: `${baseUrl}/preview`,
      });
      const started = manager.start({
        model: makeModel(),
        version,
        apiKey: null,
        settings: makeSettings(),
        managedModelsDir: modelsRoot,
      });

      expect(started.targetPath).toBe(
        path.join(modelsRoot, "loras", "sdxl", "test-lora.safetensors")
      );

      const finished = await manager.waitForTask(started.id);
      expect(finished?.status).toBe("completed");
      expect(finished?.downloadedBytes).toBe(payload.length);

      const targetPath = path.join(
        modelsRoot,
        "loras",
        "sdxl",
        "test-lora.safetensors"
      );
      expect(fs.existsSync(targetPath)).toBe(true);
      expect(fs.readFileSync(targetPath).equals(payload)).toBe(true);
      expect(fs.existsSync(`${targetPath}.part`)).toBe(false);

      const sidecarPath = path.join(
        modelsRoot,
        "loras",
        "sdxl",
        "test-lora.civitai.info"
      );
      const sidecar = JSON.parse(fs.readFileSync(sidecarPath, "utf8")) as Record<
        string,
        unknown
      >;
      expect(sidecar).toMatchObject({
        source: "civitai",
        modelId: 501,
        modelVersionId: 201,
        modelName: "Test LoRA",
        baseModel: "SDXL 1.0",
        trainedWords: ["test trigger"],
        description: "A test LoRA for unit coverage.",
      });

      const localPreview = path.join(
        modelsRoot,
        "loras",
        "sdxl",
        "test-lora.preview.webp"
      );
      expect(fs.existsSync(localPreview)).toBe(true);
      expect(fs.readFileSync(localPreview).equals(previewBytes)).toBe(true);
      expect(
        fs.existsSync(path.join(previewCacheDir, "civitai-201.webp"))
      ).toBe(true);

      expect(manager.listDownloads()).toHaveLength(1);
      expect(manager.getTask(started.id)?.status).toBe("completed");
    } finally {
      await closeServer(server);
    }
  });

  it("deletes the .part file when cancelled mid-transfer", async () => {
    const tempDir = makeTempDir();
    const modelsRoot = path.join(tempDir, "models");
    const { baseUrl, server } = await listen((req, res) => {
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": 64 * 1024 * 1024,
      });
      res.write(Buffer.alloc(32 * 1024, 1));
      const timer = setInterval(() => {
        if (!res.writableEnded) res.write(Buffer.alloc(16 * 1024, 2));
      }, 50);
      req.on("close", () => clearInterval(timer));
    });

    try {
      const manager = new CivitaiDownloadManager({
        allowLoopbackHttpForTests: true,
      });
      const version = makeVersion(`${baseUrl}/file`, { sizeBytes: 64 * 1024 * 1024 });
      const started = manager.start({
        model: makeModel(),
        version,
        apiKey: null,
        settings: makeSettings(),
        managedModelsDir: modelsRoot,
      });

      await new Promise<void>((resolve) => {
        const onProgress = (task: { id: string; status: string; downloadedBytes: number }) => {
          if (
            task.id === started.id &&
            task.status === "downloading" &&
            task.downloadedBytes > 0
          ) {
            manager.off("progress", onProgress);
            expect(manager.cancelDownload(started.id)).toBe(true);
            resolve();
          }
        };
        manager.on("progress", onProgress);
        setTimeout(() => {
          manager.off("progress", onProgress);
          resolve();
        }, 4000);
      });

      const finished = await manager.waitForTask(started.id);
      expect(finished?.status).toBe("cancelled");

      const targetPath = path.join(
        modelsRoot,
        "loras",
        "sdxl",
        "test-lora.safetensors"
      );
      expect(fs.existsSync(targetPath)).toBe(false);
      expect(fs.existsSync(`${targetPath}.part`)).toBe(false);
    } finally {
      await closeServer(server);
    }
  }, 15000);

  it("rejects a SHA-256 mismatch and leaves no target or .part file", async () => {
    const tempDir = makeTempDir();
    const modelsRoot = path.join(tempDir, "models");
    const payload = Buffer.alloc(4096, 9);
    const { baseUrl, server } = await listen((req, res) => {
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": payload.length,
      });
      res.end(payload);
    });

    try {
      const manager = new CivitaiDownloadManager({
        allowLoopbackHttpForTests: true,
      });
      const version = makeVersion(`${baseUrl}/file`, {
        sizeBytes: payload.length,
        sha256: "0".repeat(64),
      });
      const started = manager.start({
        model: makeModel(),
        version,
        apiKey: null,
        settings: makeSettings(),
        managedModelsDir: modelsRoot,
      });

      const finished = await manager.waitForTask(started.id);
      expect(finished?.status).toBe("failed");
      expect(finished?.error).toMatch(/SHA-256 verification failed/i);

      const targetPath = path.join(
        modelsRoot,
        "loras",
        "sdxl",
        "test-lora.safetensors"
      );
      expect(fs.existsSync(targetPath)).toBe(false);
      expect(fs.existsSync(`${targetPath}.part`)).toBe(false);
      expect(
        fs.existsSync(path.join(modelsRoot, "loras", "sdxl", "test-lora.civitai.info"))
      ).toBe(false);
    } finally {
      await closeServer(server);
    }
  });

  it("reuses the existing task when the same version is already downloading", async () => {
    const tempDir = makeTempDir();
    const modelsRoot = path.join(tempDir, "models");
    const { baseUrl, server } = await listen((req, res) => {
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": 1024 * 1024,
      });
      res.write(Buffer.alloc(1024, 1));
      const timer = setInterval(() => {
        if (!res.writableEnded) res.write(Buffer.alloc(1024, 1));
      }, 100);
      req.on("close", () => clearInterval(timer));
    });

    try {
      const manager = new CivitaiDownloadManager({
        allowLoopbackHttpForTests: true,
      });
      const version = makeVersion(`${baseUrl}/file`, { sizeBytes: 1024 * 1024 });
      const input = {
        model: makeModel(),
        version,
        apiKey: null,
        settings: makeSettings(),
        managedModelsDir: modelsRoot,
      };

      const first = manager.start(input);
      const second = manager.start(input);
      expect(second.id).toBe(first.id);

      manager.cancelDownload(first.id);
      const finished = await manager.waitForTask(first.id);
      expect(finished?.status).toBe("cancelled");
      expect(manager.listDownloads()).toHaveLength(1);
    } finally {
      await closeServer(server);
    }
  });

  it("strips Authorization headers on cross-origin redirects and blocks unsafe preview protocols", async () => {
    const tempDir = makeTempDir();
    const modelsRoot = path.join(tempDir, "models");
    const payload = Buffer.alloc(2048, 5);
    const seenCdnAuth: Array<string | undefined> = [];
    const seenOriginAuth: Array<string | undefined> = [];

    const cdn = await listen((req, res) => {
      seenCdnAuth.push(req.headers.authorization);
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": payload.length,
      });
      res.end(payload);
    });

    const origin = await listen((req, res) => {
      seenOriginAuth.push(req.headers.authorization);
      res.writeHead(302, { location: `${cdn.baseUrl}/signed-blob` });
      res.end();
    });

    try {
      const manager = new CivitaiDownloadManager({
        allowLoopbackHttpForTests: true,
      });
      const version = makeVersion(`${origin.baseUrl}/download`, {
        sizeBytes: payload.length,
        primaryPreviewUrl: "file:///C:/Windows/win.ini",
      });
      const started = manager.start({
        model: makeModel(),
        version,
        apiKey: "secret_token_xyz",
        settings: makeSettings(),
        managedModelsDir: modelsRoot,
      });

      const finished = await manager.waitForTask(started.id);
      expect(finished?.status).toBe("completed");
      expect(seenOriginAuth).toEqual(["Bearer secret_token_xyz"]);
      expect(seenCdnAuth).toEqual([undefined]);
      expect(
        fs.existsSync(
          path.join(modelsRoot, "loras", "sdxl", "test-lora.preview.png")
        )
      ).toBe(false);
    } finally {
      await closeServer(origin.server);
      await closeServer(cdn.server);
    }
  });
});
