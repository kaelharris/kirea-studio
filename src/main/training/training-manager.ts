import { execFile, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import type {
  CharacterAdapter,
  CharacterProfile,
  CharacterTrainingConfig,
  CharacterTrainingJob,
  CharacterTrainingTelemetry,
  TrainingPreflightResult,
} from "../../shared/types";
import { DatasetBuilder } from "../characters/dataset-builder";
import type { StudioRepository } from "../db/repositories";
import { detectHardwareStats, getDiskFreeGBMap } from "../hardware/gpu-detector";
import type { StudioLogger } from "../logger";
import type { StudioPaths } from "../paths";
import { isPathInsideAnyRoot } from "../security";

const SUPPORTED_BASE_MODEL_FAMILIES = new Set(["sdxl", "illustrious", "pony"]);
const FORCE_KILL_DELAY_MS = 4000;
const PROCESS_TERMINATION_TIMEOUT_MS = 8000;
const MAX_SAFETENSORS_HEADER_BYTES = 50_000_000;

function sanitizeOutputName(value: string): string {
  const sanitized = value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 128)
    .replace(/^_+|_+$/g, "");
  return sanitized || "character_lora";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSafetensorsHeader(filePath: string): {
  header: Record<string, unknown>;
  dataBytes: number;
} {
  const fd = fs.openSync(filePath, "r");
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size <= 8) {
      throw new Error("Safetensors output is empty or is not a regular file.");
    }

    const lengthBuffer = Buffer.alloc(8);
    if (fs.readSync(fd, lengthBuffer, 0, 8, 0) !== 8) {
      throw new Error("Safetensors output has a truncated header length.");
    }
    const headerLength = Number(lengthBuffer.readBigUInt64LE(0));
    if (
      !Number.isSafeInteger(headerLength) ||
      headerLength <= 2 ||
      headerLength > MAX_SAFETENSORS_HEADER_BYTES ||
      headerLength > stat.size - 8
    ) {
      throw new Error("Safetensors output has an invalid header length.");
    }

    const headerBuffer = Buffer.alloc(headerLength);
    if (fs.readSync(fd, headerBuffer, 0, headerLength, 8) !== headerLength) {
      throw new Error("Safetensors output has a truncated JSON header.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(headerBuffer.toString("utf8"));
    } catch {
      throw new Error("Safetensors output does not contain a valid JSON header.");
    }
    if (!isRecord(parsed)) {
      throw new Error("Safetensors output header must be a JSON object.");
    }

    return {
      header: parsed,
      dataBytes: stat.size - 8 - headerLength,
    };
  } finally {
    fs.closeSync(fd);
  }
}

function validateSafetensorsFile(filePath: string): void {
  const { header, dataBytes } = readSafetensorsHeader(filePath);
  const tensors = Object.entries(header).filter(([name]) => name !== "__metadata__");
  if (tensors.length === 0) {
    throw new Error("Safetensors output header contains no tensor entries.");
  }

  let hasNonemptyTensor = false;
  for (const [name, descriptor] of tensors) {
    if (!name || !isRecord(descriptor)) {
      throw new Error("Safetensors output contains an invalid tensor descriptor.");
    }
    const { dtype, shape, data_offsets: dataOffsets } = descriptor;
    if (
      typeof dtype !== "string" ||
      dtype.length === 0 ||
      !Array.isArray(shape) ||
      !shape.every((dimension) => Number.isSafeInteger(dimension) && dimension >= 0) ||
      !Array.isArray(dataOffsets) ||
      dataOffsets.length !== 2
    ) {
      throw new Error(`Safetensors tensor ${name} has an invalid descriptor.`);
    }
    const [start, end] = dataOffsets;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      end > dataBytes
    ) {
      throw new Error(`Safetensors tensor ${name} has invalid data offsets.`);
    }
    if (end > start) hasNonemptyTensor = true;
  }

  if (!hasNonemptyTensor) {
    throw new Error("Safetensors output contains no nonempty tensor data.");
  }
}

export function reconcileInterruptedTrainingJobs(
  repo: StudioRepository,
  logger: StudioLogger
): number {
  const interrupted = repo
    .listTrainingJobs()
    .filter((job) => job.status === "RUNNING" || job.status === "QUEUED");
  const completedAt = new Date().toISOString();

  for (const job of interrupted) {
    repo.saveTrainingJob({
      ...job,
      status: "FAILED",
      adapterId: null,
      errorMessage: "Training was interrupted by an application restart.",
      completedAt,
    });
  }

  if (interrupted.length > 0) {
    logger.info(
      "training",
      `Reconciled ${interrupted.length} interrupted training job(s) as FAILED.`
    );
  }
  return interrupted.length;
}

export class TrainingManager {
  private activeProcess: ChildProcess | null = null;
  private activeJobId: string | null = null;
  private activeJob: CharacterTrainingJob | null = null;
  private activeTempDatasetDir: string | null = null;
  private forceKillTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private lossHistory: Array<{ step: number; loss: number }> = [];
  private smoothedLoss = 0;
  private stepDurations: number[] = [];
  private lastSavedCheckpointPath: string | null = null;

  constructor(
    private readonly repo: StudioRepository,
    private readonly paths: StudioPaths,
    private readonly logger: StudioLogger,
    private readonly emitEvent: (channel: string, payload: unknown) => void
  ) {}

  /**
   * Discovers a local Python environment. PyTorch availability is verified by
   * the bounded preflight import check rather than inferred from a path.
   */
  resolvePythonPath(): string {
    const pythonExe = process.platform === "win32" ? "python.exe" : "python";
    const venvPython = (venv: string) =>
      path.join(venv, process.platform === "win32" ? "Scripts" : "bin", pythonExe);
    const candidates = [
      process.env.KIREA_TRAINING_PYTHON,
      process.env.VIRTUAL_ENV ? venvPython(process.env.VIRTUAL_ENV) : null,
      venvPython(path.join(process.cwd(), "external", "sd-scripts-venv")),
      (process as any).resourcesPath
        ? venvPython(path.join((process as any).resourcesPath, "sd-scripts-venv"))
        : null,
      "python",
    ].filter((candidate): candidate is string => Boolean(candidate));

    for (const candidate of candidates) {
      if (candidate === "python" || fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return "python";
  }

  private resolveAdapterPath(): string | null {
    const candidates = [
      (process as any).resourcesPath
        ? path.join((process as any).resourcesPath, "training", "sd_scripts_adapter.py")
        : null,
      path.join(process.cwd(), "external", "training", "sd_scripts_adapter.py"),
      path.join(__dirname, "../../external/training/sd_scripts_adapter.py"),
      path.join(__dirname, "../../../external/training/sd_scripts_adapter.py"),
    ].filter((candidate): candidate is string => Boolean(candidate));
    return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
  }

  private resolveSdScriptsPath(adapterPath: string | null): string | null {
    const candidates = [
      (process as any).resourcesPath
        ? path.join((process as any).resourcesPath, "sd-scripts", "sdxl_train_network.py")
        : null,
      adapterPath
        ? path.resolve(path.dirname(adapterPath), "../sd-scripts/sdxl_train_network.py")
        : null,
      path.join(process.cwd(), "external", "sd-scripts", "sdxl_train_network.py"),
      path.join(__dirname, "../../external/sd-scripts/sdxl_train_network.py"),
      path.join(__dirname, "../../../external/sd-scripts/sdxl_train_network.py"),
    ].filter((candidate): candidate is string => Boolean(candidate));
    return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
  }

  private checkTorchRuntime(
    pythonPath: string
  ): Promise<{ version: string | null; error: string | null }> {
    return new Promise((resolve) => {
      try {
        execFile(
          pythonPath,
          ["-c", "import torch; print(torch.__version__)"],
          { timeout: 10_000, windowsHide: true, maxBuffer: 64 * 1024 },
          (error, stdout, stderr) => {
            if (error) {
              const detail = String(stderr || error.message).trim();
              resolve({
                version: null,
                error: detail || "Python runtime or PyTorch import failed.",
              });
              return;
            }
            const version = String(stdout).trim();
            resolve({
              version: /^\d+\.\d+(?:\.\d+)?(?:[+].*)?$/.test(version)
                ? version
                : null,
              error: null,
            });
          }
        );
      } catch (error) {
        resolve({
          version: null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  private resolveOutputDir(
    character: CharacterProfile,
    config: Pick<CharacterTrainingConfig, "outputDirectory">
  ): string {
    const approvedRoot = path.resolve(this.paths.defaultManagedModelsDir);
    const requestedDir = config.outputDirectory?.trim();
    const outputDir = path.resolve(
      requestedDir ||
        path.join(approvedRoot, "loras", "characters", sanitizeOutputName(character.name))
    );
    if (!isPathInsideAnyRoot(outputDir, [approvedRoot])) {
      throw new Error("Training outputDirectory must be inside the managed models directory.");
    }
    return outputDir;
  }

  private inspectBaseCheckpoint(checkpointPath: string): {
    advisories: string[];
    blocker: string | null;
  } {
    const advisories: string[] = [];
    if (!checkpointPath.toLowerCase().endsWith(".safetensors")) {
      return { advisories, blocker: null };
    }

    const fd = fs.openSync(checkpointPath, "r");
    try {
      const lengthBuffer = Buffer.alloc(8);
      if (fs.readSync(fd, lengthBuffer, 0, 8, 0) !== 8) {
        return { advisories, blocker: "Selected checkpoint has a truncated safetensors header." };
      }
      const headerLength = Number(lengthBuffer.readBigUInt64LE(0));
      const fileSize = fs.fstatSync(fd).size;
      if (
        !Number.isSafeInteger(headerLength) ||
        headerLength <= 2 ||
        headerLength > MAX_SAFETENSORS_HEADER_BYTES ||
        headerLength > fileSize - 8
      ) {
        return { advisories, blocker: "Selected checkpoint has an invalid safetensors header." };
      }
      const headerBuffer = Buffer.alloc(headerLength);
      if (fs.readSync(fd, headerBuffer, 0, headerLength, 8) !== headerLength) {
        return { advisories, blocker: "Selected checkpoint has a truncated safetensors header." };
      }
      const header = headerBuffer.toString("utf8");
      if (!header.includes("model.diffusion_model.")) {
        return {
          advisories,
          blocker: "Selected checkpoint does not contain SDXL UNet architecture tensors.",
        };
      }
      if (!header.includes("first_stage_model.")) {
        advisories.push("Checkpoint is missing embedded VAE; external SDXL VAE will be required.");
      }
      if (
        !header.includes("conditioner.embedders.0.") ||
        !header.includes("conditioner.embedders.1.")
      ) {
        advisories.push("Checkpoint is missing one or both embedded CLIP text encoders.");
      }
      return { advisories, blocker: null };
    } finally {
      fs.closeSync(fd);
    }
  }

  /**
   * Preflight checks before training starts. This never launches training; the
   * only Python subprocess is a bounded torch import/version probe.
   */
  async preflightTraining(
    characterId: string,
    configPartial?: Partial<CharacterTrainingConfig>
  ): Promise<TrainingPreflightResult> {
    const character = this.repo.getCharacterById(characterId);
    if (!character) {
      throw new Error(`Character ${characterId} not found.`);
    }

    const blockers: string[] = [];
    const advisories: string[] = [];
    const hw = await detectHardwareStats([this.paths.defaultManagedModelsDir]);
    const pythonPath = this.resolvePythonPath();
    const diskMap = await getDiskFreeGBMap([this.paths.defaultManagedModelsDir, os.homedir()]);
    const diskFreeGB = Object.values(diskMap)[0] ?? 25;
    const adapterPath = this.resolveAdapterPath();
    const sdScriptsPath = this.resolveSdScriptsPath(adapterPath);

    if (!adapterPath) {
      blockers.push("The sd-scripts training adapter was not found.");
    }
    if (!sdScriptsPath) {
      blockers.push("The sd-scripts sdxl_train_network.py entry point was not found.");
    }
    if (
      configPartial?.baseModelFamily &&
      !SUPPORTED_BASE_MODEL_FAMILIES.has(configPartial.baseModelFamily)
    ) {
      blockers.push(`Unsupported SDXL base model family: ${configPartial.baseModelFamily}`);
    }
    if (configPartial?.outputDirectory) {
      try {
        this.resolveOutputDir(character, configPartial);
      } catch (error) {
        blockers.push(error instanceof Error ? error.message : String(error));
      }
    }

    const datasetItems = DatasetBuilder.buildDatasetItems(character, true);
    const selectedCount = datasetItems.filter((item) => item.selected).length;
    const candidateCheckpoint =
      configPartial?.baseCheckpointPath || character.checkpointPath || null;
    const modelAvailable = candidateCheckpoint
      ? fs.existsSync(candidateCheckpoint)
      : false;

    if (!candidateCheckpoint) {
      blockers.push("A base model checkpoint must be configured on the character or training config.");
    } else if (!modelAvailable) {
      blockers.push(`Base model checkpoint not found: ${candidateCheckpoint}`);
    } else {
      try {
        const inspection = this.inspectBaseCheckpoint(candidateCheckpoint);
        if (inspection.blocker) blockers.push(inspection.blocker);
        advisories.push(...inspection.advisories);
      } catch (error) {
        this.logger.warn(
          "training",
          `Could not inspect checkpoint header: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (!hw.available) {
      blockers.push("No CUDA-compatible GPU detected. Character LoRA training requires an NVIDIA GPU.");
    } else if (hw.vramTotalMB < 12000) {
      advisories.push(
        `VRAM is ${Math.round(hw.vramTotalMB / 1024)} GB. Training with batch size 1 and fp16 precision is recommended.`
      );
    }
    if (diskFreeGB < 8) {
      blockers.push(
        `Output drive has only ${diskFreeGB} GB free. At least 8 GB is required for dataset preparation and model weights.`
      );
    }
    if (selectedCount < 2) {
      blockers.push(
        `Character has only ${selectedCount} approved reference image(s). At least 2 approved references are required.`
      );
    } else if (selectedCount < 6) {
      advisories.push(
        `Character has ${selectedCount} references. 6 to 15 diverse images provide the best likeness without overfitting.`
      );
    }

    const torchRuntime = await this.checkTorchRuntime(pythonPath);
    const backendAvailable = torchRuntime.version !== null;
    if (!backendAvailable) {
      blockers.push(
        `Python training runtime or PyTorch import check failed: ${torchRuntime.error ?? "unknown error"}`
      );
    }

    const triggerToken =
      configPartial?.triggerToken ||
      character.dna?.triggerToken ||
      character.triggerWords[0] ||
      `kirea_${character.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
    const recommendedPreset: CharacterTrainingConfig = {
      baseModelFamily: configPartial?.baseModelFamily || "illustrious",
      baseCheckpointPath: candidateCheckpoint ?? "",
      triggerToken,
      rank: 16,
      alpha: 16,
      learningRate: 1e-4,
      epochs: 10,
      batchSize: 1,
      resolution: 1024,
      gradientAccumulationSteps: 1,
      gradientCheckpointing: true,
      precision: "fp16",
    };

    return {
      ready: blockers.length === 0,
      canTrain: blockers.length === 0,
      gpuName: hw.name,
      vramTotalMB: hw.vramTotalMB,
      vramFreeMB: hw.vramFreeMB,
      systemRamMB: hw.systemRamTotalMB,
      diskFreeGB,
      modelAvailable,
      modelPath: candidateCheckpoint,
      datasetValid: selectedCount >= 2,
      datasetImageCount: selectedCount,
      backendAvailable,
      pythonPath,
      torchVersion: torchRuntime.version,
      cudaAvailable: hw.available,
      blockers,
      advisories,
      recommendedPreset,
    };
  }

  private clearForceKillTimer(): void {
    if (this.forceKillTimer) {
      clearTimeout(this.forceKillTimer);
      this.forceKillTimer = null;
    }
  }

  private terminateProcess(proc: ChildProcess): void {
    this.clearForceKillTimer();
    this.forceKillTimer = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        // The process already exited.
      }
    }, FORCE_KILL_DELAY_MS);
    this.forceKillTimer.unref();

    const gracefulFallback = (): void => {
      try {
        proc.kill("SIGTERM");
      } catch {
        // The process already exited.
      }
    };

    if (process.platform === "win32" && proc.pid) {
      try {
        execFile(
          "taskkill",
          ["/PID", String(proc.pid), "/T", "/F"],
          { timeout: PROCESS_TERMINATION_TIMEOUT_MS, windowsHide: true },
          (error) => {
            if (error) gracefulFallback();
          }
        );
      } catch {
        gracefulFallback();
      }
    } else {
      gracefulFallback();
    }
  }

  private releaseReservation(jobId: string, proc?: ChildProcess | null): void {
    if (this.activeJobId !== jobId) return;
    if (proc && this.activeProcess !== proc) return;
    this.activeProcess = null;
    this.activeJobId = null;
    this.activeJob = null;
    this.activeTempDatasetDir = null;
    this.clearForceKillTimer();
  }

  private cleanupTempDataset(directory: string | null): void {
    if (!directory) return;
    void fs.promises.rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }

  private failJob(job: CharacterTrainingJob, error: unknown): void {
    if (job.status !== "RUNNING" && job.status !== "QUEUED") return;
    job.status = "FAILED";
    job.completedAt = new Date().toISOString();
    job.errorMessage = error instanceof Error ? error.message : String(error);
    this.repo.saveTrainingJob(job);
    this.emitEvent("characters:trainingFailed", {
      jobId: job.id,
      error: job.errorMessage,
    });
  }

  private markCancelled(job: CharacterTrainingJob): boolean {
    if (job.status !== "RUNNING" && job.status !== "QUEUED") return false;
    job.status = "CANCELLED";
    job.completedAt = new Date().toISOString();
    job.errorMessage = "Training cancelled by user.";
    if (this.lastSavedCheckpointPath) {
      job.outputAdapterPath = this.lastSavedCheckpointPath;
    }
    this.repo.saveTrainingJob(job);
    this.emitEvent("characters:trainingCancelled", { jobId: job.id });
    return true;
  }

  private validateCompletedOutput(
    reportedPath: string,
    outputDir: string,
    expectedOutputPath: string
  ): string {
    const resolvedPath = path.resolve(reportedPath);
    if (!isPathInsideAnyRoot(resolvedPath, [outputDir])) {
      throw new Error("Training output is outside the approved output directory.");
    }
    if (resolvedPath !== expectedOutputPath) {
      throw new Error("Training output does not match the approved output name.");
    }
    if (path.extname(resolvedPath).toLowerCase() !== ".safetensors") {
      throw new Error("Training output is not a safetensors file.");
    }
    const stat = fs.statSync(resolvedPath);
    if (!stat.isFile() || stat.size <= 0) {
      throw new Error("Training output is missing, empty, or not a regular file.");
    }
    const realOutputDir = fs.realpathSync(outputDir);
    const realOutputPath = fs.realpathSync(resolvedPath);
    if (!isPathInsideAnyRoot(realOutputPath, [realOutputDir])) {
      throw new Error("Training output resolves outside the approved output directory.");
    }
    validateSafetensorsFile(resolvedPath);
    return resolvedPath;
  }

  private registerCompletedAdapter(
    job: CharacterTrainingJob,
    character: CharacterProfile,
    outputPath: string
  ): void {
    const adapter: Omit<CharacterAdapter, "createdAt" | "updatedAt"> = {
      id: `adap_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      characterId: character.id,
      baseModelFamily: job.config.baseModelFamily,
      checkpointPath: job.config.baseCheckpointPath,
      triggerToken: job.config.triggerToken,
      fileLocation: outputPath,
      trainingConfig: job.config,
      datasetVersion: "v1.0",
      rank: job.config.rank,
      alpha: job.config.alpha,
      recommendedStrength: 0.85,
      status: "trained",
      validationImages: [],
    };
    const savedAdapter = this.repo.saveAdapter(adapter);
    job.status = "COMPLETED";
    job.adapterId = savedAdapter.id;
    job.completedAt = new Date().toISOString();
    job.outputAdapterPath = outputPath;
    this.lastSavedCheckpointPath = outputPath;
    this.repo.saveTrainingJob(job);

    this.emitEvent("characters:trainingComplete", {
      jobId: job.id,
      adapter: savedAdapter,
    });
    this.emitEvent("event:trainingCompleted", {
      jobId: job.id,
      status: "COMPLETED",
      adapterId: savedAdapter.id,
    });
    this.logger.info(
      "training",
      `LoRA training finished for ${character.name}: ${outputPath}`
    );
  }

  private handleAdapterMessage(
    job: CharacterTrainingJob,
    character: CharacterProfile,
    parsed: Record<string, unknown>,
    outputDir: string,
    expectedOutputPath: string
  ): void {
    if (this.activeJobId !== job.id || this.disposed) return;
    if (job.status !== "RUNNING" && job.status !== "QUEUED") return;

    const eventType = String(parsed.type || parsed.status || "");
    const config = job.config;
    if (eventType === "step" || parsed.status === "training") {
      const step = Number(parsed.step ?? 0);
      const max = Number(parsed.total_steps ?? parsed.max_steps ?? job.progressMax);
      const rawLoss =
        typeof parsed.loss === "number" && !isNaN(parsed.loss)
          ? parsed.loss
          : (job.loss ?? 0.25);
      const loss = Number(rawLoss.toFixed(6));
      const epoch = Number(parsed.epoch ?? 1);
      const totalEpochs = Number(parsed.total_epochs ?? job.totalEpochs ?? config.epochs);
      const learningRate = Number(parsed.learning_rate ?? config.learningRate ?? 1e-4);
      const elapsedMs = Number(parsed.elapsed_ms ?? 50);

      if (this.smoothedLoss === 0) {
        this.smoothedLoss = loss;
      } else {
        this.smoothedLoss = 0.1 * loss + 0.9 * this.smoothedLoss;
      }
      this.lossHistory.push({ step, loss });
      if (this.lossHistory.length > 1000) this.lossHistory.shift();
      this.stepDurations.push(elapsedMs);
      if (this.stepDurations.length > 50) this.stepDurations.shift();
      const avgDurationMs =
        this.stepDurations.reduce((total, duration) => total + duration, 0) /
        this.stepDurations.length;
      const remainingSteps = Math.max(0, max - step);
      const estimatedRemainingMs = Math.round(avgDurationMs * remainingSteps);

      job.progressStep = step;
      job.progressMax = max;
      job.currentEpoch = epoch;
      job.totalEpochs = totalEpochs;
      job.loss = loss;
      this.repo.saveTrainingJob(job);

      const telemetry: CharacterTrainingTelemetry = {
        trainingId: job.id,
        step,
        totalSteps: max,
        epoch,
        totalEpochs,
        loss,
        smoothedLoss: Number(this.smoothedLoss.toFixed(6)),
        learningRate,
        elapsedMs,
        estimatedRemainingMs,
        lossHistory: [...this.lossHistory],
      };
      this.emitEvent("event:trainingTelemetry", telemetry);
      this.emitEvent("characters:trainingProgress", {
        jobId: job.id,
        step,
        max,
        loss,
        epoch,
        smoothedLoss: this.smoothedLoss,
        estimatedRemainingMs,
      });
      this.emitEvent("event:trainingProgress", {
        jobId: job.id,
        step,
        maxSteps: max,
        epoch,
        loss,
      });
      return;
    }

    if (eventType === "checkpoint_saved") {
      const checkpointPath = String(parsed.path || "");
      if (!checkpointPath) return;
      const resolvedCheckpoint = path.resolve(checkpointPath);
      if (!isPathInsideAnyRoot(resolvedCheckpoint, [outputDir])) {
        throw new Error("Training checkpoint is outside the approved output directory.");
      }
      if (path.extname(resolvedCheckpoint).toLowerCase() !== ".safetensors") {
        throw new Error("Training checkpoint is not a safetensors file.");
      }
      this.lastSavedCheckpointPath = resolvedCheckpoint;
      job.outputAdapterPath = resolvedCheckpoint;
      this.repo.saveTrainingJob(job);
      this.logger.info("training", `Intermediate checkpoint saved: ${resolvedCheckpoint}`);
      return;
    }

    if (eventType === "completed") {
      const reportedPath = String(parsed.output_path || expectedOutputPath);
      const outputPath = this.validateCompletedOutput(
        reportedPath,
        outputDir,
        expectedOutputPath
      );
      this.registerCompletedAdapter(job, character, outputPath);
      return;
    }

    if (eventType === "cancelled") {
      this.markCancelled(job);
      return;
    }

    if (eventType === "failed") {
      this.failJob(job, String(parsed.error || "Training failed"));
    }
  }

  private attachProcessListeners(
    child: ChildProcess,
    job: CharacterTrainingJob,
    character: CharacterProfile,
    tempDatasetDir: string,
    outputDir: string,
    expectedOutputPath: string
  ): void {
    if (!child.stdout) {
      throw new Error("Training process did not provide a stdout stream.");
    }
    const stdoutReader = readline.createInterface({ input: child.stdout });
    stdoutReader.on("line", (line) => {
      if (this.activeJobId !== job.id || this.disposed) return;
      try {
        if (line.startsWith("{") && line.endsWith("}")) {
          const parsed = JSON.parse(line) as unknown;
          if (isRecord(parsed)) {
            this.handleAdapterMessage(
              job,
              character,
              parsed,
              outputDir,
              expectedOutputPath
            );
            return;
          }
        }
        job.logsText += `${line}\n`;
        this.emitEvent("characters:trainingLog", { jobId: job.id, line });
        this.emitEvent("event:trainingLog", { jobId: job.id, line });
      } catch (error) {
        this.failJob(job, error);
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      if (this.activeJobId !== job.id || this.disposed) return;
      const text = chunk.toString();
      job.logsText += text;
      this.emitEvent("characters:trainingLog", { jobId: job.id, line: text });
      this.emitEvent("event:trainingLog", { jobId: job.id, line: text });
    });

    child.once("error", (error) => {
      this.failJob(job, error);
      if (job.status !== "CANCELLED") {
        this.releaseReservation(job.id, child);
        this.cleanupTempDataset(tempDatasetDir);
      }
    });

    child.once("close", (code) => {
      if (job.status === "RUNNING" || job.status === "QUEUED") {
        this.failJob(
          job,
          code === 0
            ? "Training process exited without reporting a validated completion."
            : `Training process exited with code ${code}`
        );
      }
      this.releaseReservation(job.id, child);
      this.cleanupTempDataset(tempDatasetDir);
    });
  }

  /**
   * Starts a real managed local character LoRA training process.
   */
  async startTraining(
    characterId: string,
    config: CharacterTrainingConfig
  ): Promise<CharacterTrainingJob> {
    if (this.disposed) {
      throw new Error("TrainingManager has been disposed after application shutdown.");
    }
    if (this.activeJobId !== null || this.activeProcess !== null) {
      throw new Error("A training job is already currently running. Please wait or cancel the current job.");
    }

    const jobId = `train_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    // This assignment is deliberately synchronous and precedes every await.
    this.activeJobId = jobId;
    let job: CharacterTrainingJob | null = null;
    let tempDatasetDir: string | null = null;
    let child: ChildProcess | null = null;

    try {
      const character = this.repo.getCharacterById(characterId);
      if (!character) {
        throw new Error(`Character ${characterId} not found.`);
      }
      if (!SUPPORTED_BASE_MODEL_FAMILIES.has(config.baseModelFamily)) {
        throw new Error(`Unsupported SDXL base model family: ${config.baseModelFamily}`);
      }
      const baseCheckpointPath = config.baseCheckpointPath || character.checkpointPath;
      if (!baseCheckpointPath) {
        throw new Error("A base model checkpoint must be configured on the character or training config.");
      }
      const normalizedConfig: CharacterTrainingConfig = {
        ...config,
        baseCheckpointPath,
      };
      const outputDir = this.resolveOutputDir(character, normalizedConfig);
      const outputName = sanitizeOutputName(
        `${sanitizeOutputName(character.name)}_${normalizedConfig.baseModelFamily}_lora`
      );
      const expectedOutputPath = path.resolve(outputDir, `${outputName}.safetensors`);
      if (!isPathInsideAnyRoot(expectedOutputPath, [outputDir])) {
        throw new Error("Training output name resolves outside the approved output directory.");
      }

      const datasetItems = DatasetBuilder.buildDatasetItems(character, true);
      const now = new Date().toISOString();
      job = {
        id: jobId,
        characterId,
        adapterId: null,
        baseModelFamily: normalizedConfig.baseModelFamily,
        status: "QUEUED",
        progressStep: 0,
        progressMax:
          normalizedConfig.epochs * Math.ceil(datasetItems.length / normalizedConfig.batchSize),
        currentEpoch: 1,
        totalEpochs: normalizedConfig.epochs,
        loss: 0.25,
        config: normalizedConfig,
        errorMessage: null,
        logsText: "",
        outputAdapterPath: expectedOutputPath,
        submittedAt: now,
        startedAt: null,
      };
      this.activeJob = job;
      this.repo.saveTrainingJob(job);

      const preflight = await this.preflightTraining(characterId, normalizedConfig);
      if (this.disposed || this.activeJobId !== jobId) {
        throw new Error("Training startup was cancelled by application shutdown.");
      }
      if (!preflight.ready) {
        throw new Error(`Cannot start training: ${preflight.blockers.join("; ")}`);
      }

      const tempRoot = this.paths.tempDir || os.tmpdir();
      tempDatasetDir = path.join(
        path.resolve(tempRoot),
        "kirea-train-datasets",
        sanitizeOutputName(characterId),
        jobId
      );
      this.activeTempDatasetDir = tempDatasetDir;
      await DatasetBuilder.exportDatasetToDisk(
        tempDatasetDir,
        datasetItems,
        character.name
      );
      if (this.disposed || this.activeJobId !== jobId) {
        throw new Error("Training startup was cancelled by application shutdown.");
      }
      await fs.promises.mkdir(outputDir, { recursive: true });

      const scriptPath = this.resolveAdapterPath();
      if (!scriptPath) {
        throw new Error("The sd-scripts training adapter was not found.");
      }
      const pythonExe = preflight.pythonPath || this.resolvePythonPath();
      const args = [
        scriptPath,
        "--dataset_dir", tempDatasetDir,
        "--output_dir", outputDir,
        "--output_name", outputName,
        "--base_model_path", normalizedConfig.baseCheckpointPath,
        "--trigger_token", normalizedConfig.triggerToken,
        "--base_model_family", normalizedConfig.baseModelFamily,
        "--rank", String(normalizedConfig.rank ?? 16),
        "--alpha", String(normalizedConfig.alpha ?? 16),
        "--learning_rate", String(normalizedConfig.learningRate ?? 1e-4),
        "--epochs", String(normalizedConfig.epochs ?? 10),
        "--batch_size", String(normalizedConfig.batchSize ?? 1),
        "--resolution", String(normalizedConfig.resolution ?? 1024),
        "--gradient_accumulation_steps", String(normalizedConfig.gradientAccumulationSteps ?? 1),
        "--gradient_checkpointing", String(normalizedConfig.gradientCheckpointing ?? true),
        "--save_every_n_epochs", String(normalizedConfig.saveEveryNEpochs ?? 0),
        "--precision", normalizedConfig.precision || "fp16",
      ];

      job.status = "RUNNING";
      job.startedAt = new Date().toISOString();
      job.logsText = `[INIT] Training job ${jobId} started for ${character.name} (${normalizedConfig.triggerToken})\n`;
      this.repo.saveTrainingJob(job);
      this.lossHistory = [];
      this.smoothedLoss = 0;
      this.stepDurations = [];
      this.lastSavedCheckpointPath = null;

      this.logger.info("training", `Spawning: ${pythonExe} ${args.join(" ")}`);
      child = spawn(pythonExe, args, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      this.activeProcess = child;
      this.attachProcessListeners(
        child,
        job,
        character,
        tempDatasetDir,
        outputDir,
        expectedOutputPath
      );
      return job;
    } catch (error) {
      try {
        if (child) this.terminateProcess(child);
        if (job) this.failJob(job, error);
      } finally {
        this.releaseReservation(jobId, child);
        this.cleanupTempDataset(tempDatasetDir);
      }
      throw error;
    }
  }

  /**
   * Cancels the active process while retaining the reservation until close.
   */
  cancelTraining(jobId: string): boolean {
    if (!this.activeProcess || this.activeJobId !== jobId) return false;
    const job = this.activeJob ?? this.repo.getTrainingJob(jobId);
    if (!job || !this.markCancelled(job)) return false;
    this.terminateProcess(this.activeProcess);
    return true;
  }

  /**
   * Terminates owned training before the repository is closed on shutdown.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const jobId = this.activeJobId;
    const proc = this.activeProcess;
    const tempDatasetDir = this.activeTempDatasetDir;

    if (jobId && this.activeJob) {
      this.failJob(this.activeJob, "Training was interrupted by application shutdown.");
    }
    if (proc) this.terminateProcess(proc);
    this.releaseReservation(jobId ?? "", proc);
    this.cleanupTempDataset(tempDatasetDir);
  }
}
