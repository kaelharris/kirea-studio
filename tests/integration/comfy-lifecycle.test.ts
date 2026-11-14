import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { ComfyRuntimeManager } from "../../src/main/comfy/runtime-manager";
import { WORKFLOW_TEMPLATES } from "../../src/main/comfy/workflow-registry";
import { StudioDatabase } from "../../src/main/db/database";
import { StudioRepository } from "../../src/main/db/repositories";
import { extractPngTextChunks } from "../../src/main/images/image-exporter";
import { JobOrchestrator } from "../../src/main/jobs/job-orchestrator";
import { StudioLogger } from "../../src/main/logger";
import type { StudioPaths } from "../../src/main/paths";
import type { AppSettings, GenerationRequest, ModelRecord } from "../../src/shared/types";

interface MockScenario {
  mode: "success" | "slow_for_cancel" | "cuda_oom" | "ws_drop_then_success";
  hasUpscaleModelNode: boolean;
}

async function createMockComfyServer(pngFixture: Buffer) {
  const scenario: MockScenario = { mode: "success", hasUpscaleModelNode: true };
  let uploadedCount = 0;
  let interruptedCount = 0;
  let lastSubmittedPrompt: Record<string, { class_type: string; inputs: Record<string, unknown> }> | null = null;
  const history = new Map<string, unknown>();
  const sockets = new Map<string, WebSocket>();

  const server = http.createServer((req, res) => {
    const reqUrl = new URL(req.url ?? "/", "http://127.0.0.1");

    if (req.method === "GET" && reqUrl.pathname === "/system_stats") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          system: {
            os: "nt",
            ram_total: 32 * 1024 ** 3,
            ram_free: 16 * 1024 ** 3,
            comfyui_version: "0.45.2-mock",
            python_version: "3.13.12",
            pytorch_version: "2.12.1+cu130",
          },
          devices: [
            {
              name: "cuda:0 NVIDIA GeForce RTX 4070 Ti SUPER",
              type: "cuda",
              index: 0,
              vram_total: 16 * 1024 ** 3,
              vram_free: 15 * 1024 ** 3,
            },
          ],
        })
      );
      return;
    }

    if (req.method === "GET" && reqUrl.pathname === "/object_info/UpscaleModelLoader") {
      if (scenario.hasUpscaleModelNode) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ UpscaleModelLoader: { input: { required: {} } } }));
      } else {
        res.writeHead(404);
        res.end();
      }
      return;
    }

    if (req.method === "GET" && reqUrl.pathname === "/object_info") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          KSampler: {
            input: {
              required: {
                sampler_name: [["euler", "dpmpp_2m"]],
                scheduler: [["normal", "karras"]],
              },
            },
          },
        })
      );
      return;
    }

    if (req.method === "GET" && reqUrl.pathname === "/queue") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ queue_running: [], queue_pending: [] }));
      return;
    }

    if (req.method === "POST" && reqUrl.pathname === "/upload/image") {
      req.on("data", () => undefined);
      req.on("end", () => {
        uploadedCount++;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            name: `uploaded_${uploadedCount}.png`,
            subfolder: "",
            type: "input",
          })
        );
      });
      return;
    }

    if (req.method === "POST" && reqUrl.pathname === "/interrupt") {
      interruptedCount++;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
      return;
    }

    if (req.method === "POST" && reqUrl.pathname === "/prompt") {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          prompt: Record<string, { class_type: string; inputs: Record<string, unknown> }>;
          client_id: string;
        };
        lastSubmittedPrompt = body.prompt;
        const promptId = `pid_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ prompt_id: promptId, number: 1, node_errors: {} }));

        const ws = sockets.get(body.client_id) ?? Array.from(sockets.values())[0];

        if (scenario.mode === "cuda_oom") {
          setTimeout(() => {
            ws?.send(
              JSON.stringify({
                type: "execution_error",
                data: {
                  prompt_id: promptId,
                  node_id: "3",
                  node_type: "KSampler",
                  exception_message: "CUDA out of memory. Tried to allocate 2.00 GiB",
                  exception_type: "OutOfMemoryError",
                },
              })
            );
          }, 40);
          return;
        }

        if (scenario.mode === "slow_for_cancel") {
          setTimeout(() => {
            ws?.send(JSON.stringify({ type: "execution_start", data: { prompt_id: promptId } }));
            ws?.send(
              JSON.stringify({
                type: "progress",
                data: { prompt_id: promptId, value: 1, max: 20, node: "3" },
              })
            );
          }, 30);
          return;
        }

        if (scenario.mode === "ws_drop_then_success") {
          setTimeout(() => {
            ws?.send(JSON.stringify({ type: "execution_start", data: { prompt_id: promptId } }));
            ws?.close();
          }, 30);
          setTimeout(() => {
            history.set(promptId, {
              outputs: {
                "9": {
                  images: [{ filename: "mock_ws_recover.png", subfolder: "", type: "output" }],
                },
              },
              status: { status_str: "success", completed: true },
            });
          }, 120);
          return;
        }

        // Standard happy path with binary preview + progress + execution_success
        setTimeout(() => {
          ws?.send(JSON.stringify({ type: "execution_start", data: { prompt_id: promptId } }));
          ws?.send(
            JSON.stringify({
              type: "progress",
              data: { prompt_id: promptId, value: 4, max: 8, node: "3" },
            })
          );
          // Binary preview frame (type 1 = event PREVIEW_IMAGE, type 2 = PNG format + payload)
          const header = Buffer.alloc(8);
          header.writeUInt32BE(1, 0);
          header.writeUInt32BE(2, 4);
          ws?.send(Buffer.concat([header, pngFixture]));

          history.set(promptId, {
            outputs: {
              "9": {
                images: [{ filename: "mock_out.png", subfolder: "", type: "output" }],
              },
            },
            status: { status_str: "success", completed: true },
          });

          ws?.send(JSON.stringify({ type: "execution_success", data: { prompt_id: promptId } }));
        }, 60);
      });
      return;
    }

    if (req.method === "GET" && reqUrl.pathname.startsWith("/history/")) {
      const pid = decodeURIComponent(reqUrl.pathname.replace("/history/", ""));
      const entry = history.get(pid);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(entry ? { [pid]: entry } : {}));
      return;
    }

    if (req.method === "GET" && reqUrl.pathname === "/view") {
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(pngFixture);
      return;
    }

    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (ws, req) => {
    const parsed = new URL(req.url ?? "/ws", "http://127.0.0.1");
    const cid = parsed.searchParams.get("clientId") ?? "default";
    sockets.set(cid, ws);
    ws.send(JSON.stringify({ type: "status", data: { status: { exec_info: { queue_remaining: 0 } } } }));
    ws.on("close", () => {
      sockets.delete(cid);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as { port: number }).port;

  return {
    port,
    scenario,
    getCounters: () => ({ uploadedCount, interruptedCount, lastSubmittedPrompt }),
    close: async () => {
      wss.clients.forEach((c) => c.close());
      await new Promise<void>((r) => wss.close(() => r()));
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()!();
  }
});

const SAMPLE_MODELS: ModelRecord[] = [
  {
    id: "m1",
    name: "test_sd15",
    relativePath: "test_sd15.safetensors",
    filePath: "C:\\mock\\test_sd15.safetensors",
    category: "checkpoint",
    architecture: "sd15",
    sizeBytes: 2_000_000_000,
    sha256: null,
    sourceRoot: "C:\\mock",
    isDuplicate: false,
    duplicateOf: null,
    isIncomplete: false,
    compatibleWorkflows: ["t2i_sd15_base", "i2i_sd15_base"],
    license: null,
    description: null,
    installed: true,
    lastSeenAt: "2026-11-11T00:00:00Z",
  },
  {
    id: "m_upscale",
    name: "RealESRGAN_x4plus_anime_6B",
    relativePath: "RealESRGAN_x4plus_anime_6B.pth",
    filePath: "C:\\mock\\RealESRGAN_x4plus_anime_6B.pth",
    category: "upscale",
    architecture: "unknown",
    sizeBytes: 17_938_799,
    sha256: null,
    sourceRoot: "C:\\mock",
    isDuplicate: false,
    duplicateOf: null,
    isIncomplete: false,
    compatibleWorkflows: ["upscale_model_v1"],
    license: null,
    description: null,
    installed: true,
    lastSeenAt: "2026-11-11T00:00:00Z",
  },
];

describe("ComfyUI HTTP/WS Integration Lifecycle", () => {
  it("completes txt2img, img2img upload, cancel interrupt, OOM classification, and WS drop recovery", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-int-"));
    const paths: StudioPaths = {
      userDataDir: tmp,
      dbPath: path.join(tmp, "studio.db"),
      logsDir: path.join(tmp, "logs"),
      cacheDir: path.join(tmp, "cache"),
      tempDir: path.join(tmp, "temp"),
      defaultOutputDir: path.join(tmp, "outputs"),
      defaultDownloadsDir: path.join(tmp, "downloads"),
      defaultManagedRuntimeDir: path.join(tmp, "runtime"),
      defaultManagedModelsDir: path.join(tmp, "models"),
      inputUploadCacheDir: path.join(tmp, "inputs"),
      modelPreviewCacheDir: path.join(tmp, "model-previews"),
      charactersDir: path.join(tmp, "characters"),
    };
    fs.mkdirSync(paths.logsDir, { recursive: true });
    fs.mkdirSync(paths.defaultOutputDir, { recursive: true });

    const pngFixture = await sharp({
      create: { width: 128, height: 128, channels: 3, background: { r: 20, g: 130, b: 220 } },
    })
      .png()
      .toBuffer();

    const mock = await createMockComfyServer(pngFixture);
    const logger = new StudioLogger(paths.logsDir);
    const db = new StudioDatabase(paths.dbPath);
    const repo = new StudioRepository(db);
    repo.upsertWorkflowMetadata(WORKFLOW_TEMPLATES);

    const settings: AppSettings = {
      runtimeMode: "external",
      externalComfyPath: "",
      comfyHost: "127.0.0.1",
      comfyPort: mock.port,
      managedComfyPath: paths.defaultManagedRuntimeDir,
      autoStartRuntime: false,
      outputDirectory: paths.defaultOutputDir,
      extraModelDirs: [],
      downloadDirectory: paths.defaultDownloadsDir,
      cacheDirectory: paths.cacheDir,
      tempDirectory: paths.tempDir,
      performanceProfile: "balanced",
      maxActiveJobs: 1,
      defaultBatchSize: 1,
      enableMemoryWarnings: true,
      theme: "dark",
      galleryLayout: "comfortable",
      startupPage: "home",
      defaultSampler: "euler",
      defaultScheduler: "normal",
      defaultSteps: 8,
      defaultCfg: 7,
      defaultOutputFormat: "png",
      checkUpdatesAutomatically: true,
      nsfwFilter: true,
      civitaiApiKeySet: false,
    };

    const runtime = new ComfyRuntimeManager(paths, settings, logger);
    const orchestrator = new JobOrchestrator(
      repo,
      runtime,
      () => settings,
      () => SAMPLE_MODELS,
      () => 16384,
      logger
    );

    cleanups.push(async () => {
      await runtime.stopRuntime();
      db.close();
      await mock.close();
      fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    });

    const waitForTerminalJob = (jobId: string) =>
      new Promise<{ status: string; errorKind: string; outputPaths: string[]; previewDataUrl: string | null }>(
        (resolve) => {
          let latestPreview: string | null = null;
          const handler = (updated: {
            id: string;
            status: string;
            errorKind: string;
            outputPaths: string[];
            previewDataUrl: string | null;
          }) => {
            if (updated.id !== jobId) return;
            if (updated.previewDataUrl) latestPreview = updated.previewDataUrl;
            if (
              updated.status === "COMPLETED" ||
              updated.status === "FAILED" ||
              updated.status === "CANCELLED"
            ) {
              orchestrator.removeListener("jobUpdated", handler);
              resolve({ ...updated, previewDataUrl: latestPreview ?? updated.previewDataUrl });
            }
          };
          orchestrator.on("jobUpdated", handler);
        }
      );

    // 1. Connect runtime & verify system telemetry + WS
    const rtState = await runtime.testConnection();
    expect(rtState.status).toBe("connected");
    expect(rtState.comfyVersion).toBe("0.45.2-mock");

    // 2. txt2img happy path + PNG metadata + DB persistence
    const t2iReq: GenerationRequest = {
      workflowId: "t2i_sd15_base",
      mode: "txt2img",
      prompt: "prism sunrise mountains",
      negativePrompt: "blur",
      checkpoint: "test_sd15.safetensors",
      vae: null,
      loras: [],
      aspectRatio: "1:1",
      width: 512,
      height: 512,
      steps: 8,
      cfg: 7,
      sampler: "euler",
      scheduler: "normal",
      seed: 4242,
      randomSeed: false,
      batchCount: 1,
      batchSize: 1,
      outputFormat: "png",
      inputImagePath: null,
      denoise: 1,
    };

    const [t2iJob] = await orchestrator.submit(t2iReq);
    const done1 = await waitForTerminalJob(t2iJob!.id);
    expect(done1.status).toBe("COMPLETED");
    expect(done1.previewDataUrl).toContain("data:image/png;base64,");
    expect(fs.existsSync(done1.outputPaths[0]!)).toBe(true);

    const pngChunks = extractPngTextChunks(fs.readFileSync(done1.outputPaths[0]!));
    expect(JSON.parse(pngChunks.kirea_meta!).seed).toBe(4242);

    // 3. img2img upload flow
    const inputImg = path.join(tmp, "seed-input.png");
    fs.writeFileSync(inputImg, pngFixture);
    const [i2iJob] = await orchestrator.submit({
      ...t2iReq,
      workflowId: "i2i_sd15_base",
      mode: "img2img",
      inputImagePath: inputImg,
      denoise: 0.45,
    });
    const done2 = await waitForTerminalJob(i2iJob!.id);
    expect(done2.status).toBe("COMPLETED");
    expect(mock.getCounters().uploadedCount).toBe(1);
    expect(mock.getCounters().lastSubmittedPrompt?.["11"]?.inputs.image).toBe("uploaded_1.png");

    // 4. Cancellation triggers /interrupt
    mock.scenario.mode = "slow_for_cancel";
    const [cancelTarget] = await orchestrator.submit(t2iReq);
    setTimeout(() => void orchestrator.cancelJob(cancelTarget!.id), 80);
    const cancelledDone = await waitForTerminalJob(cancelTarget!.id);
    expect(cancelledDone.status).toBe("CANCELLED");
    expect(mock.getCounters().interruptedCount).toBeGreaterThanOrEqual(1);

    // 5. CUDA OOM classification
    mock.scenario.mode = "cuda_oom";
    const [oomTarget] = await orchestrator.submit(t2iReq);
    const oomDone = await waitForTerminalJob(oomTarget!.id);
    expect(oomDone.status).toBe("FAILED");
    expect(oomDone.errorKind).toBe("CUDA_OOM");

    // 6. WS drop recovery via HTTP /history polling
    await runtime.testConnection();
    mock.scenario.mode = "ws_drop_then_success";
    const [wsDropJob] = await orchestrator.submit(t2iReq);
    const wsDropDone = await waitForTerminalJob(wsDropJob!.id);
    expect(wsDropDone.status).toBe("COMPLETED");

    // 7. Standalone upscale mode (stock AI upscaler graph + prompt history non-pollution)
    mock.scenario.mode = "success";
    mock.scenario.hasUpscaleModelNode = true;
    const promptCountBeforeUpscale = repo.listPrompts().length;
    const [upscaleJob] = await orchestrator.submit({
      ...t2iReq,
      workflowId: "upscale_model_v1",
      mode: "upscale",
      prompt: "",
      checkpoint: "",
      inputImagePath: inputImg,
      upscale: { upscaler: "RealESRGAN_x4plus_anime_6B.pth", scale: 2 },
    });
    const upscaleDone = await waitForTerminalJob(upscaleJob!.id);
    expect(upscaleDone.status).toBe("COMPLETED");
    expect(mock.getCounters().lastSubmittedPrompt?.["14"]?.class_type).toBe("UpscaleModelLoader");
    expect(mock.getCounters().lastSubmittedPrompt?.["16"]?.inputs.scale_by).toBe(0.5);
    expect(repo.listPrompts().length).toBe(promptCountBeforeUpscale);

    // 8. Feature-detected fallback when UpscaleModelLoader node is unavailable
    mock.scenario.hasUpscaleModelNode = false;
    const [fallbackJob] = await orchestrator.submit({
      ...t2iReq,
      workflowId: "upscale_model_v1",
      mode: "upscale",
      prompt: "",
      checkpoint: "",
      inputImagePath: inputImg,
      upscale: { upscaler: "RealESRGAN_x4plus_anime_6B.pth", scale: 2 },
    });
    const fallbackDone = await waitForTerminalJob(fallbackJob!.id);
    expect(fallbackDone.status).toBe("COMPLETED");
    expect(mock.getCounters().lastSubmittedPrompt?.["14"]).toBeUndefined();
    expect(mock.getCounters().lastSubmittedPrompt?.["16"]?.class_type).toBe("ImageScaleBy");
    expect(mock.getCounters().lastSubmittedPrompt?.["16"]?.inputs.scale_by).toBe(2);

    // Verify persistence across DB close + reopen
    db.close();
    const dbReopened = new StudioDatabase(paths.dbPath);
    const repoReopened = new StudioRepository(dbReopened);
    expect(repoReopened.listImages()).toHaveLength(5);
    dbReopened.close();
  });
});

