import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import type {
  AppSettings,
  GeneratedImageRecord,
  GeneratedVideoRecord,
  GenerationJob,
  GenerationRequest,
  JobErrorKind,
  ModelRecord,
  ValidationIssue,
} from "../../shared/types";
import type { ComfyRuntimeManager } from "../comfy/runtime-manager";
import type { ComfyWsErrorEvent, ComfyWsExecutingEvent, ComfyWsProgressEvent } from "../comfy/comfy-ws";
import { IMAGE_UPSCALER_LANCZOS, isLatentUpscaler } from "../../shared/aspect-ratios";
import {
  buildComfyPromptGraph,
  getWorkflowById,
  validateGenerationRequest,
} from "../comfy/workflow-registry";
import type { StudioRepository } from "../db/repositories";
import { getDiskFreeGBMap } from "../hardware/gpu-detector";
import { saveGeneratedImage } from "../images/image-exporter";
import { saveGeneratedVideo } from "../videos/video-exporter";
import { isVideoMode, resolveVideoFrameCount } from "../../shared/video-utils";
import type { StudioLogger } from "../logger";

export function classifyComfyError(rawMessage: string): JobErrorKind {
  const lower = rawMessage.toLowerCase();
  if (
    lower.includes("out of memory") ||
    lower.includes("cuda error") ||
    lower.includes("allocation on device") ||
    lower.includes("cudnn_status_alloc_failed") ||
    lower.includes("vram")
  ) {
    return "CUDA_OOM";
  }
  if (
    lower.includes("not in list") ||
    lower.includes("value_not_in_list") ||
    lower.includes("missing_model") ||
    (lower.includes("not found") &&
      (lower.includes("checkpoint") ||
        lower.includes("lora") ||
        lower.includes("vae") ||
        lower.includes("unet") ||
        lower.includes("clip") ||
        lower.includes("safetensors") ||
        lower.includes("ckpt")))
  ) {
    return "MISSING_MODEL";
  }
  if (lower.includes("interrupt") || lower.includes("cancel")) {
    return "CANCELLED";
  }
  if (
    lower.includes("econnrefused") ||
    lower.includes("fetch failed") ||
    lower.includes("socket hang up") ||
    lower.includes("connection reset")
  ) {
    return "RUNTIME_CRASH";
  }
  if (lower.includes("websocket") || lower.includes("ws_disconnected")) {
    return "WS_DISCONNECTED";
  }
  return "UNKNOWN";
}

function summarizeNodeErrors(nodeErrors: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [nodeId, detail] of Object.entries(nodeErrors)) {
    if (detail && typeof detail === "object") {
      const rec = detail as Record<string, unknown>;
      const classType = String(rec.class_type ?? "Node");
      const errs = Array.isArray(rec.errors) ? rec.errors : [];
      const msgs = errs
        .map((e) =>
          e && typeof e === "object"
            ? String((e as Record<string, unknown>).details || (e as Record<string, unknown>).message || "")
            : String(e)
        )
        .filter(Boolean);
      parts.push(`${classType} (#${nodeId}): ${msgs.join("; ") || JSON.stringify(detail)}`);
    } else {
      parts.push(`Node #${nodeId}: ${String(detail)}`);
    }
  }
  return parts.join(" | ");
}

export class JobOrchestrator extends EventEmitter {
  private readonly jobs = new Map<string, GenerationJob>();
  private readonly pendingIds: string[] = [];
  private activeJobId: string | null = null;
  private activePromptId: string | null = null;
  private cancelledIds = new Set<string>();
  private readonly deletedJobIds = new Set<string>();
  private isProcessingLoop = false;

  private activeWaiter: {
    resolve: () => void;
    reject: (err: Error) => void;
  } | null = null;

  constructor(
    private readonly repo: StudioRepository,
    private readonly runtime: ComfyRuntimeManager,
    private getSettings: () => AppSettings,
    private getModels: () => ModelRecord[],
    private getVramTotalMB: () => number,
    private readonly logger: StudioLogger
  ) {
    super();
    this.reconcileInterruptedJobsOnStartup();
    this.bindWebSocketListeners();
  }

  private reconcileInterruptedJobsOnStartup(): void {
    const stored = this.repo.listJobs(150);
    for (const job of stored) {
      // Terminal decisions are authoritative, even if related output rows exist.
      if (
        job.status === "COMPLETED" ||
        job.status === "FAILED" ||
        job.status === "CANCELLED"
      ) {
        this.jobs.set(job.id, job);
        continue;
      }

      // 1. If outputs exist in the database for this job, it completed successfully!
      if (this.repo.hasOutputsForJob?.(job.id)) {
        const completedJob: GenerationJob = {
          ...job,
          status: "COMPLETED",
          errorKind: "NONE",
          errorMessage: null,
          progressStep: job.progressMax || job.settings?.steps || 1,
          completedAt: job.completedAt ?? new Date().toISOString(),
        };
        this.repo.upsertJob(completedJob);
        this.jobs.set(completedJob.id, completedJob);
        this.logger.info("jobs", `Reconciled completed job ${job.id} from existing outputs.`);
        continue;
      }

      // 2. Genuinely interrupted / pending jobs from prior sessions:
      // Mark as interrupted in history. Do NOT auto-retry, resubmit or pop up repeated alerts.
      if (
        job.status === "IDLE" ||
        job.status === "VALIDATING" ||
        job.status === "SUBMITTING" ||
        job.status === "QUEUED" ||
        job.status === "RUNNING" ||
        job.status === "PROCESSING_OUTPUT"
      ) {
        const reconciled: GenerationJob = {
          ...job,
          status: "FAILED",
          errorKind: "CANCELLED",
          errorMessage: "Interrupted when application previously closed.",
          completedAt: job.completedAt ?? new Date().toISOString(),
          startupInterrupted: true,
        };
        this.repo.upsertJob(reconciled);
        this.jobs.set(reconciled.id, reconciled);
        this.logger.info("jobs", `Reconciled orphaned job ${job.id} as interrupted.`);
      } else {
        this.jobs.set(job.id, job);
      }
    }
  }

  private bindWebSocketListeners(): void {
    const ws = this.runtime.getWsClient();

    ws.on("execution_start", ({ promptId }: { promptId?: string }) => {
      const job = this.matchActiveJob(promptId);
      if (!job) return;
      if (job.status === "QUEUED" || job.status === "SUBMITTING") {
        this.commitJob({
          ...job,
          status: "RUNNING",
          startedAt: job.startedAt ?? new Date().toISOString(),
        });
      }
    });

    ws.on("executing", ({ promptId, node }: ComfyWsExecutingEvent) => {
      const job = this.matchActiveJob(promptId);
      if (!job) return;
      // Do not allow late execution events to overwrite completed or output-processing jobs
      if (
        job.status === "COMPLETED" ||
        job.status === "PROCESSING_OUTPUT" ||
        job.status === "FAILED" ||
        job.status === "CANCELLED"
      ) {
        return;
      }
      if (node === null) {
        // ComfyUI signals end of node graph execution with executing node=null
        return;
      }
      this.commitJob({
        ...job,
        status: "RUNNING",
        startedAt: job.startedAt ?? new Date().toISOString(),
        currentNode: node,
      });
    });

    ws.on("progress", ({ promptId, value, max, node }: ComfyWsProgressEvent) => {
      const job = this.matchActiveJob(promptId);
      if (!job) return;
      // Do not allow late progress events to overwrite completed or output-processing jobs
      if (
        job.status === "COMPLETED" ||
        job.status === "PROCESSING_OUTPUT" ||
        job.status === "FAILED" ||
        job.status === "CANCELLED"
      ) {
        return;
      }
      this.commitJob({
        ...job,
        status: "RUNNING",
        startedAt: job.startedAt ?? new Date().toISOString(),
        progressStep: value,
        progressMax: max,
        currentNode: node ?? job.currentNode,
      });
    });

    ws.on("preview", ({ promptId, dataUrl }: { promptId?: string; dataUrl: string }) => {
      const job = this.matchActiveJob(promptId);
      if (!job) return;
      this.commitJob({
        ...job,
        previewDataUrl: dataUrl,
      });
    });

    ws.on("execution_success", ({ promptId }: { promptId?: string }) => {
      const job = this.matchActiveJob(promptId);
      if (!job || !this.activeWaiter) return;
      this.activeWaiter.resolve();
    });

    ws.on("execution_interrupted", ({ promptId }: { promptId?: string }) => {
      const job = this.matchActiveJob(promptId);
      if (!job || !this.activeWaiter) return;
      this.activeWaiter.reject(new Error("Execution interrupted by user."));
    });

    ws.on("execution_error", (errEvent: ComfyWsErrorEvent) => {
      const job = this.matchActiveJob(errEvent.promptId);
      if (!job || !this.activeWaiter) return;
      const prefix = errEvent.nodeType ? `${errEvent.nodeType}: ` : "";
      this.activeWaiter.reject(
        new Error(`${prefix}${errEvent.exceptionMessage || "ComfyUI execution error"}`)
      );
    });
  }

  private matchActiveJob(promptId?: string): GenerationJob | null {
    if (!this.activeJobId) return null;
    if (promptId && this.activePromptId && promptId !== this.activePromptId) {
      return null;
    }
    return this.jobs.get(this.activeJobId) ?? null;
  }

  validate(req: GenerationRequest): ValidationIssue[] {
    const settings = this.getSettings();
    return validateGenerationRequest(
      req,
      this.getModels(),
      settings.performanceProfile,
      this.getVramTotalMB()
    );
  }

  listJobs(): GenerationJob[] {
    return Array.from(this.jobs.values()).sort((a, b) =>
      b.submittedAt.localeCompare(a.submittedAt)
    );
  }

  async submit(req: GenerationRequest): Promise<GenerationJob[]> {
    const validation = this.validate(req);
    const errors = validation.filter((v) => v.severity === "error");
    if (errors.length > 0) {
      throw new Error(errors.map((e) => e.message).join(" "));
    }

    const wf = getWorkflowById(req.workflowId);
    if (!wf) {
      throw new Error(`Unknown workflow '${req.workflowId}'.`);
    }

    const total = Math.max(1, Math.min(8, req.batchCount || 1));
    const created: GenerationJob[] = [];
    const isRandom = req.seed === -1 || req.randomSeed;
    const baseSeed = isRandom
      ? Math.floor(Math.random() * 4294967295)
      : Math.max(0, Math.floor(req.seed));

    for (let i = 0; i < total; i++) {
      const jobSeed = isRandom
        ? Math.floor(Math.random() * 4294967295)
        : baseSeed + i;
      const perJobReq: GenerationRequest = {
        ...req,
        seed: jobSeed,
        randomSeed: false,
        batchCount: 1,
      };

      const isUpscale = perJobReq.mode === "upscale";
      const displayCheckpoint = isUpscale
        ? perJobReq.upscale?.upscaler || IMAGE_UPSCALER_LANCZOS
        : perJobReq.checkpoint;
      const displayPrompt = isUpscale
        ? `AI Upscale ${perJobReq.upscale?.scale ?? 4}× (${displayCheckpoint})`
        : perJobReq.prompt;
      const initialProgressMax = isUpscale ? 1 : perJobReq.steps;

      const job: GenerationJob = {
        id: `job_${crypto.randomUUID().slice(0, 12)}`,
        promptId: null,
        status: "IDLE",
        errorKind: "NONE",
        errorMessage: null,
        prompt: displayPrompt,
        negativePrompt: isUpscale ? "" : perJobReq.negativePrompt,
        checkpoint: displayCheckpoint,
        workflowId: wf.id,
        workflowVersion: wf.version,
        mode: perJobReq.mode,
        settings: perJobReq,
        progressStep: 0,
        progressMax: initialProgressMax,
        currentNode: null,
        previewDataUrl: null,
        outputPaths: [],
        submittedAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
        batchIndex: i + 1,
        batchTotal: total,
        characterId: perJobReq.characterId ?? null,
        loraRecipeId: perJobReq.loraRecipeId ?? null,
        storyId: perJobReq.storyId ?? null,
        storySceneId: perJobReq.storySceneId ?? null,
      };

      this.commitJob(job);
      this.pendingIds.push(job.id);
      created.push({ ...job });
    }

    if (req.characterId) {
      this.repo.markCharacterUsed(req.characterId);
    }
    if (req.loraRecipeId) {
      this.repo.markLoraRecipeUsed(req.loraRecipeId);
    }

    void this.processQueueLoop();
    return created;
  }

  async cancelJob(jobId: string): Promise<boolean> {
    if (this.deletedJobIds.has(jobId)) return false;
    const job = this.jobs.get(jobId);
    if (!job) return false;

    if (
      job.status === "COMPLETED" ||
      job.status === "FAILED" ||
      job.status === "CANCELLED"
    ) {
      return false;
    }

    this.cancelledIds.add(jobId);

    const pendingIdx = this.pendingIds.indexOf(jobId);
    if (pendingIdx >= 0) {
      this.pendingIds.splice(pendingIdx, 1);
      this.commitJob({
        ...job,
        status: "CANCELLED",
        errorKind: "CANCELLED",
        errorMessage: "Cancelled before starting.",
        completedAt: new Date().toISOString(),
      });
      return true;
    }

    if (this.activeJobId === jobId) {
      const api = this.runtime.getApiClient();
      await Promise.allSettled([
        api.interrupt(this.activePromptId ?? undefined),
        this.activePromptId ? api.deleteQueueItems([this.activePromptId]) : Promise.resolve(),
      ]);
      this.activeWaiter?.reject(new Error("Cancelled by user."));
      return true;
    }

    return false;
  }

  async retryJob(jobId: string): Promise<GenerationJob[]> {
    const prev = this.jobs.get(jobId);
    if (!prev) {
      throw new Error(`Job '${jobId}' not found.`);
    }
    return this.submit({
      ...prev.settings,
      workflowId: prev.settings?.workflowId || prev.workflowId,
      checkpoint: prev.settings?.checkpoint || prev.checkpoint,
      prompt: prev.settings?.prompt || prev.prompt,
      negativePrompt: prev.settings?.negativePrompt || prev.negativePrompt,
      batchCount: 1,
    });
  }

  deleteJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);

    // Start cancellation first. Any asynchronous cancellation write is tombstoned
    // before it can run because SQLite deletion below is synchronous.
    if (this.pendingIds.includes(jobId) || this.activeJobId === jobId) {
      void this.cancelJob(jobId);
    }

    const dbDeleted = this.repo.deleteJob?.(jobId) ?? false;
    if (!job && !dbDeleted) {
      return false;
    }

    this.deletedJobIds.add(jobId);
    const pendingIdx = this.pendingIds.indexOf(jobId);
    if (pendingIdx !== -1) {
      this.pendingIds.splice(pendingIdx, 1);
    }

    this.jobs.delete(jobId);
    this.emit("jobDeleted", jobId);
    return true;
  }

  deleteJobs(jobIds: string[]): number {
    const uniqueIds = [...new Set(jobIds)];
    if (uniqueIds.length === 0) return 0;

    const existingIds = uniqueIds.filter(
      (id) => this.jobs.has(id) || Boolean(this.repo.getJobById?.(id))
    );
    for (const id of existingIds) {
      if (this.pendingIds.includes(id) || this.activeJobId === id) {
        void this.cancelJob(id);
      }
    }

    const dbDeletedCount = this.repo.deleteJobs?.(uniqueIds) ?? 0;
    const memoryDeletedCount = uniqueIds.filter((id) => this.jobs.has(id)).length;
    const removedCount = this.repo.getJobById
      ? existingIds.filter((id) => !this.repo.getJobById(id)).length
      : Math.max(dbDeletedCount, memoryDeletedCount);

    for (const id of existingIds) {
      this.deletedJobIds.add(id);
      const pendingIdx = this.pendingIds.indexOf(id);
      if (pendingIdx !== -1) {
        this.pendingIds.splice(pendingIdx, 1);
      }
      this.jobs.delete(id);
      this.emit("jobDeleted", id);
    }

    return Math.min(uniqueIds.length, removedCount);
  }

  prepareShutdown(): void {
    if (this.activeWaiter) {
      this.activeWaiter.reject(new Error("Application is shutting down."));
      this.activeWaiter = null;
    }
    for (const pendingId of this.pendingIds) {
      const job = this.jobs.get(pendingId);
      if (job && (job.status === "QUEUED" || job.status === "SUBMITTING" || job.status === "IDLE")) {
        const cancelledJob: GenerationJob = {
          ...job,
          status: "CANCELLED",
          errorKind: "CANCELLED",
          errorMessage: "Application exited while job was pending.",
          completedAt: new Date().toISOString(),
          startupInterrupted: true,
        };
        this.commitJob(cancelledJob);
      }
    }
    this.pendingIds.length = 0;
  }

  private commitJob(job: GenerationJob): void {
    if (this.deletedJobIds.has(job.id)) return;
    const current = this.jobs.get(job.id);
    // Invariant: Once COMPLETED, a job must never transition back to any non-terminal state
    if (current?.status === "COMPLETED" && job.status !== "COMPLETED") {
      this.logger.warn("jobs", `Prevented downgrade of completed job ${job.id} to ${job.status}`);
      return;
    }
    const snapshot: GenerationJob = {
      ...job,
      outputPaths: [...job.outputPaths],
    };
    this.jobs.set(snapshot.id, snapshot);
    this.repo.upsertJob(snapshot);
    this.emit("jobUpdated", snapshot);
  }

  private async processQueueLoop(): Promise<void> {
    if (this.isProcessingLoop) return;
    this.isProcessingLoop = true;

    try {
      while (this.pendingIds.length > 0) {
        const nextId = this.pendingIds.shift()!;
        if (this.cancelledIds.has(nextId)) continue;
        await this.executeSingleJob(nextId);
      }
    } finally {
      this.isProcessingLoop = false;
    }
  }

  private async executeSingleJob(jobId: string): Promise<void> {
    let job = this.jobs.get(jobId);
    if (!job || this.deletedJobIds.has(jobId)) return;

    this.activeJobId = jobId;
    this.activePromptId = null;

    const failJob = (kind: JobErrorKind, message: string): void => {
      if (this.deletedJobIds.has(jobId)) return;
      const latest = this.jobs.get(jobId) ?? job!;
      const finalStatus = kind === "CANCELLED" ? "CANCELLED" : "FAILED";
      this.commitJob({
        ...latest,
        status: finalStatus,
        errorKind: kind,
        errorMessage: message,
        completedAt: new Date().toISOString(),
      });
      this.logger.warn("jobs", `Job ${jobId} ended with ${finalStatus} (${kind}): ${message}`);
    };

    try {
      // Phase 1: VALIDATING
      job = { ...job, status: "VALIDATING" };
      this.commitJob(job);

      const settings = this.getSettings();
      const models = this.getModels();
      const issues = validateGenerationRequest(
        job.settings,
        models,
        settings.performanceProfile,
        this.getVramTotalMB()
      );
      const blocking = issues.filter((i) => i.severity === "error");
      if (blocking.length > 0) {
        failJob("VALIDATION_FAILED", blocking.map((b) => b.message).join(" "));
        return;
      }

      // Check free disk space in outputDirectory (>= 50 MB)
      const freeDisk = await getDiskFreeGBMap([settings.outputDirectory]);
      const freeVal = Object.values(freeDisk)[0];
      if (typeof freeVal === "number" && freeVal < 0.05) {
        failJob("VALIDATION_FAILED", `Output drive has less than 50 MB free (${freeVal} GB).`);
        return;
      }

      // Ensure runtime is reachable
      let runtimeState = this.runtime.getState();
      if (runtimeState.status !== "connected") {
        runtimeState = await this.runtime.testConnection();
      }
      if (runtimeState.status !== "connected") {
        if (settings.autoStartRuntime && runtimeState.isConfiguredPathValid) {
          runtimeState = await this.runtime.startRuntime();
        } else {
          failJob(
            "RUNTIME_CRASH",
            "ComfyUI runtime is not running. Start or connect ComfyUI from the top status bar or Settings."
          );
          return;
        }
      }

      if (this.cancelledIds.has(jobId)) {
        failJob("CANCELLED", "Cancelled by user.");
        return;
      }

      // Phase 2: SUBMITTING
      job = { ...this.jobs.get(jobId)!, status: "SUBMITTING" };
      this.commitJob(job);

      const api = this.runtime.getApiClient();
      let uploadedInputName: string | undefined;
      let uploadedMaskName: string | undefined;

      if (
        job.mode === "img2img" ||
        job.mode === "upscale" ||
        job.mode === "i2v"
      ) {
        if (!job.settings.inputImagePath || !fs.existsSync(job.settings.inputImagePath)) {
          failJob(
            "VALIDATION_FAILED",
            `Input image file does not exist for ${job.mode === "upscale" ? "Upscale" : job.mode === "i2v" ? "Image-to-Video" : "Image-to-Image"}.`
          );
          return;
        }
        const uploadRes = await api.uploadImage(job.settings.inputImagePath, true);
        uploadedInputName = uploadRes.subfolder
          ? `${uploadRes.subfolder}/${uploadRes.name}`
          : uploadRes.name;

        // Upload inpainting mask if present
        if (job.settings.maskDataUrl) {
          try {
            const rawBase64 = job.settings.maskDataUrl.replace(/^data:image\/\w+;base64,/, "");
            const maskBuf = Buffer.from(rawBase64, "base64");
            const maskUploadRes = await api.uploadImageBuffer(
              maskBuf,
              `kirea_mask_${job.id}.png`,
              "image/png",
              true
            );
            uploadedMaskName = maskUploadRes.subfolder
              ? `${maskUploadRes.subfolder}/${maskUploadRes.name}`
              : maskUploadRes.name;
          } catch (uploadErr) {
            failJob(
              "VALIDATION_FAILED",
              `Failed to upload inpainting mask: ${uploadErr instanceof Error ? uploadErr.message : String(uploadErr)}`
            );
            return;
          }
        } else if (job.settings.maskPath && fs.existsSync(job.settings.maskPath)) {
          try {
            const maskUploadRes = await api.uploadImage(job.settings.maskPath, true);
            uploadedMaskName = maskUploadRes.subfolder
              ? `${maskUploadRes.subfolder}/${maskUploadRes.name}`
              : maskUploadRes.name;
          } catch (uploadErr) {
            failJob(
              "VALIDATION_FAILED",
              `Failed to upload inpainting mask file: ${uploadErr instanceof Error ? uploadErr.message : String(uploadErr)}`
            );
            return;
          }
        }
      }

      const videoTemplate = getWorkflowById(job.workflowId)?.video;
      if (videoTemplate) {
        const requiredNodes =
          job.mode === "i2v"
            ? ["CreateVideo", "SaveVideo", "LTXVImgToVideo"]
            : ["CreateVideo", "SaveVideo"];
        for (const nodeClass of requiredNodes) {
          if (!(await api.hasNode(nodeClass))) {
            failJob(
              "VALIDATION_FAILED",
              `ComfyUI does not expose the '${nodeClass}' node required by '${job.workflowId}'. Update ComfyUI to a version with native video nodes (0.3.30+).`
            );
            return;
          }
        }
      }

      const needsUpscaleModel =
        (job.mode === "upscale" && job.settings.upscale?.upscaler !== IMAGE_UPSCALER_LANCZOS) ||
        Boolean(job.settings.hiresFix?.enabled && !isLatentUpscaler(job.settings.hiresFix.upscaler));
      const supportsUpscaleModel = needsUpscaleModel
        ? await api.hasNode("UpscaleModelLoader")
        : true;
      if (needsUpscaleModel && !supportsUpscaleModel) {
        this.logger.warn(
          "jobs",
          `Job ${jobId}: ComfyUI lacks UpscaleModelLoader node; falling back to built-in resize.`
        );
      }

      const built = buildComfyPromptGraph({
        request: job.settings,
        uploadedInputFilename: uploadedInputName,
        uploadedMaskFilename: uploadedMaskName,
        availableModels: models,
        filenamePrefix: `kirea_${jobId}`,
        supportsUpscaleModel,
      });

      const submitRes = await api.submitPrompt(built.graph, this.runtime.getClientId());
      if (submitRes.node_errors && Object.keys(submitRes.node_errors).length > 0) {
        const msg = summarizeNodeErrors(submitRes.node_errors);
        failJob(classifyComfyError(msg), msg);
        return;
      }
      if (submitRes.error?.message) {
        const msg = `${submitRes.error.message}${submitRes.error.details ? `: ${submitRes.error.details}` : ""}`;
        failJob(classifyComfyError(msg), msg);
        return;
      }

      this.activePromptId = submitRes.prompt_id;
      job = {
        ...this.jobs.get(jobId)!,
        promptId: submitRes.prompt_id,
        status: "QUEUED",
        settings: {
          ...job.settings,
          seed: built.resolvedSeed,
        },
      };
      this.commitJob(job);

      // Phase 3: QUEUED / RUNNING (WS events + resilient HTTP /history polling)
      await this.waitForComfyExecution(
        jobId,
        submitRes.prompt_id,
        built.template.outputNodeId,
        isVideoMode(job.mode) ? 45 * 60 * 1000 : 15 * 60 * 1000
      );

      if (this.cancelledIds.has(jobId)) {
        failJob("CANCELLED", "Cancelled by user.");
        return;
      }

      // Phase 4: PROCESSING_OUTPUT
      job = {
        ...this.jobs.get(jobId)!,
        status: "PROCESSING_OUTPUT",
      };
      this.commitJob(job);

      const historyEntry = await this.fetchHistoryWithShortRetry(submitRes.prompt_id);
      if (!historyEntry) {
        failJob("MISSING_OUTPUT", "ComfyUI completed execution but history entry was missing.");
        return;
      }

      if (historyEntry.status?.status_str === "error") {
        const errDetails = JSON.stringify(historyEntry.status.messages ?? []);
        failJob(classifyComfyError(errDetails), `ComfyUI reported execution error: ${errDetails}`);
        return;
      }

      const outputsObj = historyEntry.outputs ?? {};
      const preferredNode = outputsObj[built.template.outputNodeId];
      const allOutputImages = preferredNode?.images?.length
        ? preferredNode.images
        : Object.values(outputsObj).flatMap((nodeOut) => nodeOut?.images ?? []);

      const finalOutputImages = allOutputImages.filter((i) => i.type === "output");
      const targetOutputs =
        finalOutputImages.length > 0
          ? finalOutputImages
          : allOutputImages.filter((i) => i.type === "temp");

      if (targetOutputs.length === 0) {
        failJob(
          "MISSING_OUTPUT",
          isVideoMode(job.mode)
            ? "ComfyUI finished without producing any output video files."
            : "ComfyUI finished without producing any output image files."
        );
        return;
      }

      const createdAt = new Date().toISOString();
      const savedPaths: string[] = [];

      const promptSnippet = job.prompt.trim();
      const titleSnippet =
        promptSnippet.slice(0, 48) + (promptSnippet.length > 48 ? "…" : "");
      const promptRecord =
        job.mode === "upscale" || !promptSnippet
          ? null
          : {
              id: `pr_${crypto.randomUUID().slice(0, 10)}`,
              title: titleSnippet || "Untitled Prompt",
              prompt: job.prompt,
              negativePrompt: job.negativePrompt,
            };

      if (isVideoMode(job.mode)) {
        const videoOutputs = targetOutputs.filter((out) =>
          [".mp4", ".m4v", ".webm"].includes(
            out.filename.slice(out.filename.lastIndexOf(".")).toLowerCase()
          )
        );
        if (videoOutputs.length === 0) {
          failJob(
            "MISSING_OUTPUT",
            `ComfyUI finished without producing an MP4 or WebM video (got: ${targetOutputs
              .map((out) => out.filename)
              .join(", ")}).`
          );
          return;
        }

        const spec = built.template.video;
        const frames = spec
          ? resolveVideoFrameCount(
              job.settings.video?.durationSeconds ?? spec.defaultFrameCount / spec.fps,
              spec
            )
          : null;
        const fps = spec?.fps ?? job.settings.video?.fps ?? 16;
        const frameCount = frames?.frameCount ?? job.settings.video?.frameCount ?? 0;
        const durationSeconds =
          frames?.durationSeconds ?? job.settings.video?.durationSeconds ?? 0;

        const savedVideos: GeneratedVideoRecord[] = [];
        for (let idx = 0; idx < videoOutputs.length; idx++) {
          const outVid = videoOutputs[idx]!;
          const rawVideo = await api.fetchOutputBuffer(
            outVid.filename,
            outVid.subfolder,
            outVid.type
          );
          const saved = await saveGeneratedVideo(
            rawVideo,
            outVid.filename,
            settings.outputDirectory,
            {
              app: "Kirea Studio",
              version: "1.0.0",
              jobId: job.id,
              workflowId: built.template.id,
              workflowVersion: built.template.version,
              mode: job.mode,
              prompt: job.prompt,
              negativePrompt: job.negativePrompt,
              checkpoint: job.checkpoint,
              loras: job.settings.loras,
              seed: built.resolvedSeed,
              width: job.settings.width,
              height: job.settings.height,
              steps: job.settings.steps,
              cfg: job.settings.cfg,
              sampler: job.settings.sampler,
              scheduler: job.settings.scheduler,
              denoise: job.settings.denoise,
              durationSeconds,
              fps,
              frameCount,
              createdAt,
            },
            idx
          );

          savedPaths.push(saved.filePath);
          savedVideos.push({
            id: `vid_${crypto.randomUUID().slice(0, 12)}`,
            jobId: job.id,
            filePath: saved.filePath,
            fileName: saved.fileName,
            container: saved.container,
            width: saved.width,
            height: saved.height,
            sizeBytes: saved.sizeBytes,
            durationSeconds: saved.durationSeconds,
            fps: saved.fps,
            frameCount: saved.frameCount,
            prompt: job.prompt,
            negativePrompt: job.negativePrompt,
            seed: built.resolvedSeed,
            checkpoint: job.checkpoint,
            loras: job.settings.loras,
            workflowId: built.template.id,
            sampler: job.settings.sampler,
            scheduler: job.settings.scheduler,
            steps: job.settings.steps,
            cfg: job.settings.cfg,
            denoise: job.settings.denoise,
            mode: job.mode,
            favorite: false,
            tags: [],
            createdAt,
          });
        }

        const completedMax = job.settings.steps;
        const completedJob: GenerationJob = {
          ...this.jobs.get(jobId)!,
          status: "COMPLETED",
          errorKind: "NONE",
          errorMessage: null,
          progressStep: completedMax,
          progressMax: completedMax,
          currentNode: null,
          outputPaths: savedPaths,
          completedAt: createdAt,
        };

        if (this.deletedJobIds.has(jobId)) return;
        this.repo.recordCompletedVideoTx(completedJob, savedVideos, promptRecord);
        this.activePromptId = null;
        this.jobs.set(completedJob.id, completedJob);
        this.emit("jobUpdated", { ...completedJob });
        for (const rec of savedVideos) {
          this.emit("videoCreated", rec);
        }
        this.logger.info("jobs", `Job ${jobId} completed (${savedVideos.length} video(s)).`);
        return;
      }

      const savedRecords: GeneratedImageRecord[] = [];
      for (let idx = 0; idx < targetOutputs.length; idx++) {
        const outImg = targetOutputs[idx]!;
        const rawPng = await api.fetchOutputBuffer(outImg.filename, outImg.subfolder, outImg.type);
        const saved = await saveGeneratedImage(
          rawPng,
          settings.outputDirectory,
          job.settings.outputFormat,
          {
            app: "Kirea Studio",
            version: "1.0.0",
            jobId: job.id,
            workflowId: built.template.id,
            workflowVersion: built.template.version,
            mode: job.mode,
            prompt: job.prompt,
            negativePrompt: job.negativePrompt,
            checkpoint: job.checkpoint,
            vae: job.settings.vae,
            loras: job.settings.loras,
            seed: built.resolvedSeed,
            width: job.settings.width,
            height: job.settings.height,
            steps: job.settings.steps,
            cfg: job.settings.cfg,
            sampler: job.settings.sampler,
            scheduler: job.settings.scheduler,
            denoise: job.settings.denoise,
            ...(job.settings.hiresFix ? { hiresFix: job.settings.hiresFix } : {}),
            ...(job.settings.upscale ? { upscale: job.settings.upscale } : {}),
            createdAt,
          },
          idx
        );

        savedPaths.push(saved.filePath);
        savedRecords.push({
          id: `img_${crypto.randomUUID().slice(0, 12)}`,
          jobId: job.id,
          filePath: saved.filePath,
          fileName: saved.fileName,
          format: saved.format,
          width: saved.width,
          height: saved.height,
          sizeBytes: saved.sizeBytes,
          prompt: job.prompt,
          negativePrompt: job.negativePrompt,
          seed: built.resolvedSeed,
          checkpoint: job.checkpoint,
          loras: job.settings.loras,
          workflowId: built.template.id,
          sampler: job.settings.sampler,
          scheduler: job.settings.scheduler,
          steps: job.settings.steps,
          cfg: job.settings.cfg,
          denoise: job.settings.denoise,
          mode: job.mode,
          favorite: false,
          tags: [],
          collectionId: null,
          createdAt,
          sourceImagePath: job.settings.inputImagePath || null,
        });
      }

      // Phase 5: COMPLETED
      const completedMax = job.mode === "upscale" ? 1 : job.settings.steps;
      const completedJob: GenerationJob = {
        ...this.jobs.get(jobId)!,
        status: "COMPLETED",
        errorKind: "NONE",
        errorMessage: null,
        progressStep: completedMax,
        progressMax: completedMax,
        currentNode: null,
        outputPaths: savedPaths,
        completedAt: createdAt,
      };

      if (this.deletedJobIds.has(jobId)) return;
      this.repo.recordCompletedGenerationTx(completedJob, savedRecords, promptRecord);
      this.activePromptId = null;

      this.jobs.set(completedJob.id, completedJob);
      this.emit("jobUpdated", { ...completedJob });
      for (const rec of savedRecords) {
        this.emit("imageCreated", rec);
      }
      this.logger.info("jobs", `Job ${jobId} completed (${savedRecords.length} image(s)).`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const kind = this.cancelledIds.has(jobId) ? "CANCELLED" : classifyComfyError(msg);
      failJob(kind, msg);
    } finally {
      this.activeJobId = null;
      this.activePromptId = null;
      this.activeWaiter = null;
      this.cancelledIds.delete(jobId);
    }
  }

  private async waitForComfyExecution(
    jobId: string,
    promptId: string,
    _outputNodeId: string,
    timeoutMs: number
  ): Promise<void> {
    const api = this.runtime.getApiClient();

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let pollTimer: NodeJS.Timeout | null = null;
      const hardTimeout = setTimeout(() => {
        const minutes = Math.round(timeoutMs / 60000);
        finish(new Error(`Generation timed out after ${minutes} minutes.`));
      }, timeoutMs);

      const cleanup = (): void => {
        if (pollTimer) clearInterval(pollTimer);
        clearTimeout(hardTimeout);
        this.activeWaiter = null;
      };

      const finish = (err?: Error): void => {
        if (settled) return;
        settled = true;
        cleanup();
        if (err) reject(err);
        else resolve();
      };

      this.activeWaiter = {
        resolve: () => finish(),
        reject: (err: Error) => finish(err),
      };

      // Resilient fallback polling in case WS misses a packet or drops momentarily
      const pollStatus = async (): Promise<void> => {
        if (settled) return;
        if (this.cancelledIds.has(jobId)) {
          finish(new Error("Cancelled by user."));
          return;
        }
        try {
          const entry = await api.getHistory(promptId);
          if (entry) {
            if (entry.status?.status_str === "error") {
              const details = JSON.stringify(entry.status.messages ?? []);
              finish(new Error(details || "ComfyUI execution failed."));
              return;
            }
            if (
              entry.status?.completed === true ||
              (entry.outputs && Object.keys(entry.outputs).length > 0)
            ) {
              finish();
              return;
            }
          }

          const queue = await api.getQueue();
          const isRunning = queue.queue_running.some((item) => item[1] === promptId);
          const currentJob = this.jobs.get(jobId);
          if (isRunning && currentJob && currentJob.status === "QUEUED") {
            this.commitJob({
              ...currentJob,
              status: "RUNNING",
              startedAt: currentJob.startedAt ?? new Date().toISOString(),
            });
          }
        } catch {
          // Transient poll hiccup tolerated until hard timeout or WS event
        }
      };

      pollTimer = setInterval(() => {
        void pollStatus();
      }, 1200);
    });
  }

  private async fetchHistoryWithShortRetry(promptId: string) {
    const api = this.runtime.getApiClient();
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const entry = await api.getHistory(promptId);
        if (entry?.outputs && Object.keys(entry.outputs).length > 0) {
          return entry;
        }
        if (attempt >= 2 && entry) {
          return entry;
        }
      } catch {
        // retry shortly
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    return null;
  }
}
