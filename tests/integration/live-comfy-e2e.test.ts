import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  ComfyRuntimeManager,
  resolveComfyInstallLayout,
} from "../../src/main/comfy/runtime-manager";
import { WORKFLOW_TEMPLATES } from "../../src/main/comfy/workflow-registry";
import { StudioDatabase } from "../../src/main/db/database";
import { StudioRepository } from "../../src/main/db/repositories";
import { extractPngTextChunks } from "../../src/main/images/image-exporter";
import { JobOrchestrator } from "../../src/main/jobs/job-orchestrator";
import { StudioLogger } from "../../src/main/logger";
import { ModelScanner } from "../../src/main/models/model-scanner";
import type { StudioPaths } from "../../src/main/paths";
import type { AppSettings, GenerationJob } from "../../src/shared/types";

// Opt-in: point KIREA_E2E_COMFY_PATH at a local ComfyUI install to run the live generation test.
const TES_COMFY_PATH = process.env.KIREA_E2E_COMFY_PATH ?? "";

describe("Live ComfyUI Hardware E2E Verification (Isolated Read-Only TES)", () => {
  const hasTesComfy =
    fs.existsSync(TES_COMFY_PATH) && Boolean(resolveComfyInstallLayout(TES_COMFY_PATH));

  it.skipIf(!hasTesComfy)(
    "boots isolated TES ComfyUI on loopback port 18190, generates a real 512px PNG with SD1.5, embeds metadata, persists DB, and stops owned process cleanly",
    async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-live-e2e-"));
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
        pixelAssetsDir: path.join(tmp, "pixel-assets"),
        pixelExportsDir: path.join(tmp, "pixel-exports"),
      };
      fs.mkdirSync(paths.logsDir, { recursive: true });
      fs.mkdirSync(paths.defaultOutputDir, { recursive: true });
      fs.mkdirSync(paths.defaultManagedModelsDir, { recursive: true });
      fs.mkdirSync(paths.inputUploadCacheDir, { recursive: true });

      const settings: AppSettings = {
        runtimeMode: "external",
        externalComfyPath: TES_COMFY_PATH,
        comfyHost: "127.0.0.1",
        comfyPort: 18190,
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
        defaultSteps: 4,
        defaultCfg: 6.5,
        defaultOutputFormat: "png",
        checkUpdatesAutomatically: true,
        nsfwFilter: true,
        civitaiApiKeySet: false,
      };

      const logger = new StudioLogger(paths.logsDir);
      const db = new StudioDatabase(paths.dbPath);
      const repo = new StudioRepository(db);
      repo.upsertWorkflowMetadata(WORKFLOW_TEMPLATES);

      const runtime = new ComfyRuntimeManager(paths, settings, logger);
      const scanner = new ModelScanner(logger);

      try {
        const startedState = await runtime.startRuntime("external", "balanced");
        expect(startedState.status).toBe("connected");
        expect(startedState.managedOwned).toBe(true);
        expect(startedState.devices.some((d) => d.type === "cuda")).toBe(true);

        const models = await scanner.scanAll(
          settings,
          paths.defaultManagedModelsDir,
          runtime.getApiClient()
        );
        repo.replaceScannedModels(models);

        const sd15 = models.find(
          (m) => m.installed && m.category === "checkpoint" && m.architecture === "sd15"
        );
        expect(sd15).toBeDefined();

        const orchestrator = new JobOrchestrator(
          repo,
          runtime,
          () => settings,
          () => models,
          () => 16376,
          logger
        );

        const terminalPromise = () =>
          new Promise<GenerationJob>((resolve) => {
            const onUpdate = (job: GenerationJob) => {
              if (
                job.status === "COMPLETED" ||
                job.status === "FAILED" ||
                job.status === "CANCELLED"
              ) {
                orchestrator.removeListener("jobUpdated", onUpdate);
                resolve(job);
              }
            };
            orchestrator.on("jobUpdated", onUpdate);
          });

        const basePromise = terminalPromise();
        const [submitted] = await orchestrator.submit({
          workflowId: "t2i_sd15_base",
          mode: "txt2img",
          prompt: "clean cobalt studio sphere on matte slate table, soft key light",
          negativePrompt: "blurry, watermark",
          checkpoint: sd15!.relativePath,
          vae: null,
          loras: [],
          aspectRatio: "1:1",
          width: 512,
          height: 512,
          steps: 4,
          cfg: 6.5,
          sampler: "euler",
          scheduler: "normal",
          seed: 777123,
          randomSeed: false,
          batchCount: 1,
          batchSize: 1,
          outputFormat: "png",
          inputImagePath: null,
          denoise: 1,
        });

        expect(submitted).toBeDefined();
        const completed = await basePromise;
        expect(completed.status).toBe("COMPLETED");
        expect(completed.outputPaths).toHaveLength(1);

        const outPng = completed.outputPaths[0]!;
        expect(fs.existsSync(outPng)).toBe(true);
        const rawBytes = fs.readFileSync(outPng);
        // Valid PNG magic header
        expect(rawBytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");

        const chunks = extractPngTextChunks(rawBytes);
        expect(JSON.parse(chunks.kirea_meta!).seed).toBe(777123);
        expect(chunks.prompt).toBeTruthy();

        const upscaler =
          models.find(
            (m) =>
              m.installed &&
              m.category === "upscale" &&
              m.relativePath.toLowerCase().includes("anime_6b")
          ) ?? models.find((m) => m.installed && m.category === "upscale");
        expect(upscaler).toBeDefined();

        // Phase 2 Live Test A: Standalone 2x AI Upscale (512x512 -> 1024x1024)
        const upscaleWait = terminalPromise();
        await orchestrator.submit({
          workflowId: "upscale_model_v1",
          mode: "upscale",
          prompt: "",
          negativePrompt: "",
          checkpoint: "",
          vae: null,
          loras: [],
          aspectRatio: "1:1",
          width: 512,
          height: 512,
          steps: 1,
          cfg: 1,
          sampler: "euler",
          scheduler: "normal",
          seed: 777123,
          randomSeed: false,
          batchCount: 1,
          batchSize: 1,
          outputFormat: "png",
          inputImagePath: outPng,
          denoise: 1,
          upscale: { upscaler: upscaler!.relativePath, scale: 2 },
        });
        const completedUpscale = await upscaleWait;
        expect(completedUpscale.status).toBe("COMPLETED");
        const upscaleMeta = await sharp(completedUpscale.outputPaths[0]!).metadata();
        expect(upscaleMeta.width).toBe(1024);
        expect(upscaleMeta.height).toBe(1024);

        // Phase 2 Live Test B: 2-Pass High-Res Fix (512x512 -> 768x768)
        const hiresWait = terminalPromise();
        await orchestrator.submit({
          workflowId: "t2i_sd15_base",
          mode: "txt2img",
          prompt: "clean cobalt studio sphere on matte slate table, crisp reflections",
          negativePrompt: "blurry, watermark",
          checkpoint: sd15!.relativePath,
          vae: null,
          loras: [],
          aspectRatio: "1:1",
          width: 512,
          height: 512,
          steps: 4,
          cfg: 6.5,
          sampler: "euler",
          scheduler: "normal",
          seed: 777124,
          randomSeed: false,
          batchCount: 1,
          batchSize: 1,
          outputFormat: "png",
          inputImagePath: null,
          denoise: 1,
          hiresFix: {
            enabled: true,
            upscaler: upscaler!.relativePath,
            scale: 1.5,
            steps: 4,
            denoise: 0.4,
          },
        });
        const completedHires = await hiresWait;
        expect(completedHires.status).toBe("COMPLETED");
        const hiresMeta = await sharp(completedHires.outputPaths[0]!).metadata();
        expect(hiresMeta.width).toBe(768);
        expect(hiresMeta.height).toBe(768);
        const hiresChunks = extractPngTextChunks(fs.readFileSync(completedHires.outputPaths[0]!));
        expect(JSON.parse(hiresChunks.kirea_meta!).hiresFix?.enabled).toBe(true);

        db.close();
        const dbCheck = new StudioDatabase(paths.dbPath);
        const repoCheck = new StudioRepository(dbCheck);
        expect(repoCheck.listImages()).toHaveLength(3);
        expect(repoCheck.listPrompts()).toHaveLength(2);
        dbCheck.close();
      } finally {
        await runtime.stopRuntime().catch(() => undefined);
        try {
          db.close();
        } catch {
          // already closed
        }
        fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 });
      }
    },
    120_000
  );
});

