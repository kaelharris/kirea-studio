import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type {
  PixelAiBackendStatus,
  PixelAiCapabilityId,
  PixelAiCapabilityStatus,
  PixelAiConnectionTest,
  PixelAiGenerateInput,
  PixelAiJob,
} from "../../../shared/pixel-ai-types";
import type { PixelAssetDetail } from "../../../shared/pixel-types";
import type { StudioLogger } from "../../logger";
import { PixelAiCancelledError, type PixelAiDirectionResult, type PixelAiGenerationResult, type PixelAiProgress } from "./spritekiln-provider";
import type { PixelService } from "../pixel-service";

export interface PixelAiProvider {
  getStatus(): Promise<PixelAiBackendStatus>;
  testConnection(): Promise<PixelAiConnectionTest>;
  generate(
    jobId: string,
    input: PixelAiGenerateInput,
    onProgress: (progress: PixelAiProgress) => void,
    signal: AbortSignal
  ): Promise<PixelAiGenerationResult>;
  generateDirections(
    jobId: string,
    input: PixelAiGenerateInput,
    onProgress: (progress: PixelAiProgress) => void,
    signal: AbortSignal
  ): Promise<PixelAiDirectionResult>;
  cancelPrompt(promptId: string): Promise<void>;
}

interface ActiveJob {
  jobId: string;
  controller: AbortController;
  promptId: string | null;
}

const MAX_RETAINED_JOBS = 30;
const PROGRESS_EMIT_INTERVAL_MS = 120;

export class PixelAiService extends EventEmitter {
  private readonly jobs = new Map<string, PixelAiJob>();
  private readonly settled = new Map<string, Promise<void>>();
  private active: ActiveJob | null = null;
  private lastEmitAt = 0;
  private emitTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly pixels: PixelService,
    private readonly provider: PixelAiProvider,
    private readonly logger: StudioLogger
  ) {
    super();
  }

  getStatus(): Promise<PixelAiBackendStatus> {
    return this.provider.getStatus();
  }

  testConnection(): Promise<PixelAiConnectionTest> {
    return this.provider.testConnection();
  }

  listJobs(): PixelAiJob[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getJob(jobId: string): PixelAiJob {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error("Pixel AI job not found.");
    return { ...job };
  }

  getActiveJob(): PixelAiJob | null {
    return this.active ? this.getJob(this.active.jobId) : null;
  }

  async waitForJob(jobId: string): Promise<PixelAiJob> {
    const promise = this.settled.get(jobId);
    if (!promise) return this.getJob(jobId);
    await promise;
    return this.getJob(jobId);
  }

  startJob(input: PixelAiGenerateInput): PixelAiJob {
    validateGenerateInput(input);
    if (this.active) {
      throw new Error(
        `A pixel generation job is already running (${this.active.jobId}). Wait for it to finish or cancel it first.`
      );
    }
    const now = new Date().toISOString();
    const job: PixelAiJob = {
      id: randomUUID(),
      projectId: input.projectId,
      mode: input.mode,
      name: input.name,
      status: "queued",
      stage: "Queued",
      progress: null,
      progressMax: null,
      promptId: null,
      error: null,
      assetId: null,
      assetIds: [],
      warnings: [],
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(job.id, job);
    const controller = new AbortController();
    const active: ActiveJob = { jobId: job.id, controller, promptId: null };
    this.active = active;
    this.pruneJobs();
    this.emitJob(job, true);

    const settle = this.run(job, active, input).finally(() => {
      if (this.active === active) this.active = null;
      this.settled.delete(job.id);
      this.emitJob(job, true);
    });
    this.settled.set(job.id, settle);
    return { ...job };
  }

  async cancelJob(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job || !this.active || this.active.jobId !== jobId) return false;
    if (job.status !== "queued" && job.status !== "running") return false;
    job.stage = "Cancelling";
    this.emitJob(job, true);
    const active = this.active;
    active.controller.abort();
    if (active.promptId) {
      await this.provider.cancelPrompt(active.promptId).catch(() => undefined);
    }
    return true;
  }

  dispose(): void {
    if (this.emitTimer) {
      clearTimeout(this.emitTimer);
      this.emitTimer = null;
    }
    void this.cancelJob(this.active?.jobId ?? "");
  }

  private async run(
    job: PixelAiJob,
    active: ActiveJob,
    input: PixelAiGenerateInput
  ): Promise<void> {
    try {
      job.status = "running";
      job.stage = "Checking pixel backend";
      this.emitJob(job, true);
      const status = await this.provider.getStatus();
      if (status.state === "workflows_missing" || status.state === "unreachable") {
        throw new Error(status.message);
      }
      const capability = status.capabilities.find(
        (entry) => entry.id === capabilityIdForInput(input)
      );
      if (capability) {
        const missing = capability.requirements.filter((entry) => entry.state === "missing");
        if (missing.length > 0 || (!capability.ready && !capability.unverified)) {
          throw new Error(capabilityFailureMessage(capability));
        }
      } else if (status.state === "setup_required") {
        throw new Error(status.message);
      }
      if (active.controller.signal.aborted) throw new PixelAiCancelledError();

      job.stage = "Generating";
      this.logger.log("INFO", "pixel", `Pixel AI job ${job.id} started (${input.mode}).`);
      if (input.mode === "directions") {
        const result = await this.provider.generateDirections(
          job.id,
          input,
          (progress) => this.applyProgress(job, active, progress),
          active.controller.signal
        );
        if (active.controller.signal.aborted) throw new PixelAiCancelledError();
        job.stage = "Importing directions";
        this.emitJob(job, true);
        const details: PixelAssetDetail[] = [];
        for (const image of result.images) {
          const detail = await this.pixels.importGeneratedPng({
            projectId: input.projectId,
            characterId: input.characterId ?? null,
            parentAssetId: input.parentAssetId ?? null,
            name: `${input.name} · ${image.label}`.slice(0, 120),
            kind: input.kind,
            prompt: input.prompt,
            seed: result.metadata.seed,
            paletteId: input.paletteId,
            png: image.png,
            width: image.width,
            height: image.height,
            generation: {
              ...result.metadata,
              settings: {
                ...result.metadata.settings,
                direction: image.label,
                directions: input.directionCount ?? 8,
              },
            },
          });
          details.push(detail);
        }
        job.assetId = details[0]?.id ?? null;
        job.assetIds = details.map((detail) => detail.id);
        job.warnings = result.metadata.notes;
        job.progress = job.progressMax ?? null;
        job.status = "completed";
        job.stage = "Completed";
        this.logger.log(
          "INFO",
          "pixel",
          `Pixel AI job ${job.id} completed as ${details.length} direction assets.`
        );
        return;
      }
      const result = await this.provider.generate(
        job.id,
        input,
        (progress) => this.applyProgress(job, active, progress),
        active.controller.signal
      );
      if (active.controller.signal.aborted) throw new PixelAiCancelledError();

      job.stage = "Importing asset";
      this.emitJob(job, true);
      const asset = await this.pixels.importGeneratedPng({
        projectId: input.projectId,
        characterId: input.characterId ?? null,
        parentAssetId: input.parentAssetId ?? null,
        name: input.name,
        kind: input.kind,
        prompt: input.prompt,
        seed: result.metadata.seed,
        paletteId: input.paletteId,
        png: result.png,
        width: result.width,
        height: result.height,
        generation: result.metadata,
      });
      job.assetId = asset.id;
      job.warnings = result.metadata.notes;
      job.progress = job.progressMax ?? null;
      job.status = "completed";
      job.stage = "Completed";
      this.logger.log(
        "INFO",
        "pixel",
        `Pixel AI job ${job.id} completed as asset ${asset.id}.`
      );
    } catch (error) {
      if (active.controller.signal.aborted || error instanceof PixelAiCancelledError) {
        job.status = "cancelled";
        job.stage = "Cancelled";
        job.error = null;
        this.logger.log("INFO", "pixel", `Pixel AI job ${job.id} cancelled.`);
      } else {
        job.status = "failed";
        job.stage = "Failed";
        job.error = error instanceof Error ? error.message : String(error);
        this.logger.warn("pixel", `Pixel AI job ${job.id} failed`, job.error);
      }
    } finally {
      job.updatedAt = new Date().toISOString();
      this.emitJob(job, true);
    }
  }

  private applyProgress(job: PixelAiJob, active: ActiveJob, progress: PixelAiProgress): void {
    if (progress.promptId) {
      job.promptId = progress.promptId;
      if (this.active === active) this.active.promptId = progress.promptId;
    }
    if (progress.stage) job.stage = progress.stage;
    if (progress.value !== undefined) {
      job.progress = progress.value;
      job.progressMax = progress.max ?? null;
    }
    this.emitJob(job, false);
  }

  private emitJob(job: PixelAiJob, immediate: boolean): void {
    job.updatedAt = new Date().toISOString();
    const now = Date.now();
    if (!immediate && now - this.lastEmitAt < PROGRESS_EMIT_INTERVAL_MS) {
      if (!this.emitTimer) {
        this.emitTimer = setTimeout(() => {
          this.emitTimer = null;
          this.emit("jobUpdated", { ...job });
        }, PROGRESS_EMIT_INTERVAL_MS);
      }
      return;
    }
    this.lastEmitAt = now;
    if (this.emitTimer) {
      clearTimeout(this.emitTimer);
      this.emitTimer = null;
    }
    this.emit("jobUpdated", { ...job });
  }

  private pruneJobs(): void {
    if (this.jobs.size <= MAX_RETAINED_JOBS) return;
    const finished = [...this.jobs.values()]
      .filter((job) => job.status !== "queued" && job.status !== "running")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    for (const job of finished.slice(MAX_RETAINED_JOBS - 10)) {
      this.jobs.delete(job.id);
    }
  }
}

function capabilityIdForInput(input: PixelAiGenerateInput): PixelAiCapabilityId {
  switch (input.mode) {
    case "text":
      return "text_to_pixel";
    case "reference":
      return "reference_to_pixel";
    case "directions":
      return "directional_set";
    case "inpaint":
      return "inpaint_pixel";
    case "image":
      return input.conversion === "ai" ? "image_to_pixel_ai" : "image_to_pixel_direct";
  }
}

function capabilityFailureMessage(capability: PixelAiCapabilityStatus): string {
  const missing = capability.requirements.filter((entry) => entry.state === "missing");
  if (missing.length === 0) {
    return `The ${capability.label} workflow is not ready in the dedicated pixel backend.`;
  }
  const names = missing.map((entry) => `${entry.kind} ${entry.name}`);
  const shown =
    names.length <= 6 ? names.join(", ") : `${names.slice(0, 6).join(", ")} (+${names.length - 6} more)`;
  const detail = missing.find((entry) => entry.detail)?.detail;
  return `The ${capability.label} workflow is not ready: ${shown}. ${
    detail ?? "Install them in the dedicated ComfyUI and restart it."
  }`;
}

function validateGenerateInput(input: PixelAiGenerateInput): void {
  if (!Number.isInteger(input.width) || !Number.isInteger(input.height)) {
    throw new Error("Pixel dimensions must be whole numbers.");
  }
  if (input.width < 8 || input.height < 8 || input.width > 256 || input.height > 256) {
    throw new Error("Pixel assets must be between 8 and 256 pixels per side.");
  }
  switch (input.mode) {
    case "text":
      if (!input.prompt.trim()) throw new Error("Enter a prompt for text-to-pixel generation.");
      break;
    case "image":
      if (!input.image) throw new Error("Choose the source image to convert.");
      break;
    case "reference":
      if (!input.reference?.subject) throw new Error("Choose a subject reference image.");
      if (!input.prompt.trim()) throw new Error("Enter a prompt that describes the desired sprite.");
      break;
    case "directions":
      if (!input.reference?.subject) throw new Error("Choose the front-facing sprite to rotate.");
      if (input.directionCount !== 4 && input.directionCount !== 8) {
        throw new Error("Directional sets support 4 or 8 directions.");
      }
      break;
    case "inpaint": {
      if (!input.inpaint?.base) throw new Error("Choose the sprite to edit.");
      if (!input.prompt.trim()) throw new Error("Describe the localized change you want.");
      const region = input.inpaint.region;
      if (!region || !Number.isFinite(region.x) || !Number.isFinite(region.y)) {
        throw new Error("Define the rectangular edit region.");
      }
      if (!(region.width > 0) || !(region.height > 0)) {
        throw new Error("The edit region must be larger than zero.");
      }
      break;
    }
  }
}
