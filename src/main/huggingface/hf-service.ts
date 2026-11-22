import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  HuggingFaceCompatibilityReport,
  HuggingFaceCompatibilityRequest,
  HuggingFaceRepoDetails,
  HuggingFaceSearchQuery,
  HuggingFaceSearchResult,
  HuggingFaceStartRequest,
} from "../../shared/huggingface";
import {
  assessHuggingFaceArchitecture,
  huggingFaceRepoUrl,
  isHuggingFaceWeightFile,
  normalizeHuggingFaceRepoId,
} from "../../shared/huggingface";
import type { AppSettings, DownloadTask, GpuStats, ModelCategory, ModelRecord } from "../../shared/types";
import {
  resolveCivitaiModelsRoot,
  sanitizeModelFileName,
} from "../civitai/download-manager";
import type { ComfyApiClient } from "../comfy/comfy-adapter";
import type { DownloadManager } from "../downloads/download-manager";
import { detectHardwareStats } from "../hardware/gpu-detector";
import type { StudioLogger } from "../logger";
import {
  categoryForSelectedFile,
  enrichHuggingFaceRepo,
  evaluateHuggingFaceCompatibility,
  type RuntimeCapabilities,
} from "./compatibility";
import { HuggingFaceClient, huggingFaceFileUrl, type SafetensorsProbe } from "./hf-client";

const CATEGORY_FOLDERS: Record<ModelCategory, string> = {
  checkpoint: "checkpoints",
  lora: "loras",
  vae: "vae",
  embedding: "embeddings",
  controlnet: "controlnet",
  upscale: "upscale_models",
  diffusion_model: "diffusion_models",
  text_encoder: "text_encoders",
};

export interface HuggingFaceServiceOptions {
  client: HuggingFaceClient;
  downloadManager: DownloadManager;
  logger: StudioLogger;
  getSettings: () => AppSettings;
  getModels: () => ModelRecord[];
  getRuntime: () => {
    status: string;
    comfyVersion: string | null;
    api: ComfyApiClient | null;
  };
  managedModelsDir: string;
}

type RepoCacheEntry = { at: number; details: HuggingFaceRepoDetails };

export class HuggingFaceService {
  private readonly repoCache = new Map<string, RepoCacheEntry>();
  private readonly probeCache = new Map<string, { at: number; probe: SafetensorsProbe }>();
  private nodeCache: { at: number; capabilities: RuntimeCapabilities } | null = null;

  constructor(private readonly options: HuggingFaceServiceOptions) {}

  search(query: HuggingFaceSearchQuery): Promise<HuggingFaceSearchResult> {
    return this.options.client.searchModels(query);
  }

  testConnection(): ReturnType<HuggingFaceClient["testConnection"]> {
    return this.options.client.testConnection();
  }

  async getRepo(repoIdRaw: string, revision?: string): Promise<HuggingFaceRepoDetails> {
    const repoId = normalizeHuggingFaceRepoId(repoIdRaw);
    if (!repoId) {
      throw new Error("Enter a Hugging Face repository ID or URL such as 'Wan-AI/Wan2.1-T2V-1.3B'.");
    }
    const key = `${repoId}@${revision ?? "main"}`;
    const cached = this.repoCache.get(key);
    if (cached && Date.now() - cached.at < 120_000) {
      return cached.details;
    }
    const details = await this.options.client.getRepoDetails(repoId, revision);
    const enriched = enrichHuggingFaceRepo(details, this.options.getModels());
    this.repoCache.set(key, { at: Date.now(), details: enriched });
    return enriched;
  }

  async checkCompatibility(
    request: HuggingFaceCompatibilityRequest,
    refresh = false
  ): Promise<HuggingFaceCompatibilityReport> {
    const details = await this.getRepo(request.repoId, request.revision);
    const selectedPaths = request.selectedPaths.filter((value, index, all) => all.indexOf(value) === index);
    if (selectedPaths.length === 0) {
      throw new Error("Select at least one file to evaluate.");
    }
    const selectedFiles = details.files.filter((file) => selectedPaths.includes(file.path));
    if (selectedFiles.length !== selectedPaths.length) {
      throw new Error("One or more selected files do not exist in this Hugging Face repository.");
    }
    if (selectedFiles.some((file) => !isHuggingFaceWeightFile(file.path))) {
      throw new Error("Only model weight files can be selected for download or compatibility.");
    }

    const primary =
      selectedFiles.find(
        (file) =>
          file.primary && (file.kind === "checkpoint" || file.kind === "diffusion_model")
      ) ??
      selectedFiles.find(
        (file) => file.kind === "checkpoint" || file.kind === "diffusion_model"
      ) ??
      null;
    const probe =
      primary && primary.format === "safetensors"
        ? await this.getSafetensorsProbe(details, primary.path)
        : null;

    const settings = this.options.getSettings();
    const modelsRoot = resolveCivitaiModelsRoot(settings, this.options.managedModelsDir);
    const hardware = await detectHardwareStats([
      settings.outputDirectory,
      settings.downloadDirectory,
      settings.externalComfyPath,
      settings.managedComfyPath,
      modelsRoot,
    ]);
    const runtime = await this.getRuntimeCapabilities(refresh);
    const diskFreeBytes = this.resolveDiskFreeBytes(hardware, modelsRoot);

    return evaluateHuggingFaceCompatibility({
      details,
      selectedPaths,
      hardware,
      runtime,
      installedModels: this.options.getModels(),
      diskFreeBytes,
      probe,
    });
  }

  async startDownloads(request: HuggingFaceStartRequest): Promise<DownloadTask[]> {
    const details = await this.getRepo(request.repoId, request.revision);
    const report = await this.checkCompatibility(
      {
        repoId: details.id,
        revision: details.revision,
        selectedPaths: request.files.map((file) => file.path),
      },
      true
    );

    if (report.status === "INCOMPATIBLE") {
      throw new Error(
        `Cannot download: ${report.blockingReasons.join(" ") || report.summary}`
      );
    }
    if (report.status === "CONDITIONAL" && !request.acknowledgeConditional) {
      throw new Error(
        "This download is conditional. Review and acknowledge the compatibility limitations first."
      );
    }
    if (report.status === "UNKNOWN" && !request.override) {
      throw new Error(
        "Compatibility could not be verified. Explicitly acknowledge the unverified state before downloading."
      );
    }
    if (report.duplicateOf && !request.override) {
      throw new Error(
        `This file is already installed as '${report.duplicateOf}'. Use the installed copy or explicitly override.`
      );
    }

    const settings = this.options.getSettings();
    const modelsRoot = resolveCivitaiModelsRoot(settings, this.options.managedModelsDir);

    const plans = request.files.map((requested) => {
      const file = details.files.find((candidate) => candidate.path === requested.path);
      if (!file) {
        throw new Error(`Repository file '${requested.path}' is no longer available.`);
      }
      if (!isHuggingFaceWeightFile(file.path)) {
        throw new Error(`'${file.path}' is not a model weight file.`);
      }
      const derivedCategory = categoryForSelectedFile(file, report.architecture);
      if (derivedCategory !== requested.category) {
        throw new Error(
          `File '${file.path}' must be installed as '${derivedCategory}', not '${requested.category}'.`
        );
      }
      const fileName = sanitizeModelFileName(
        path.basename(file.path),
        `${details.id.replace(/[\\/]/g, "-")}.safetensors`
      );
      const targetPath = path.join(modelsRoot, CATEGORY_FOLDERS[derivedCategory], fileName);
      if (fs.existsSync(targetPath)) {
        const existingBytes = fs.statSync(targetPath).size;
        if (existingBytes > 0) {
          throw new Error(
            `A file already exists at '${targetPath}'. Kirea will not overwrite an installed model; use it or move it out of the models folder first.`
          );
        }
        fs.rmSync(targetPath, { force: true });
      }
      return { requested, file, derivedCategory, fileName, targetPath };
    });

    const tasks: DownloadTask[] = [];
    for (const plan of plans) {
      const taskId = `hf_${crypto
        .createHash("sha1")
        .update(`${details.id}@${details.revision}:${plan.file.path}`)
        .digest("hex")
        .slice(0, 12)}`;
      const sidecarPath = `${plan.targetPath.replace(/\.[^.]+$/, "")}.hf.json`;
      writeSidecar(sidecarPath, {
        source: "huggingface",
        repo_id: details.id,
        revision: details.revision,
        file_path: plan.file.path,
        sha256: plan.file.sha256,
        license: details.license,
        pipeline_tag: details.pipelineTag,
        architecture: details.architecture,
        base_model: details.architectureLabel,
        description: details.description,
        modelUrl: huggingFaceRepoUrl(details.id),
        downloadedAt: new Date().toISOString(),
      });
      try {
        const task = await this.options.downloadManager.startDownload({
          id: taskId,
          kind: "model",
          title: `${details.id} · ${plan.fileName}`,
          url: huggingFaceFileUrl(details.id, details.revision, plan.file.path),
          targetPath: plan.targetPath,
          category: plan.derivedCategory,
          sourceName: "huggingface",
          licenseName: details.license ?? "Unknown",
          expectedSha256: plan.file.sha256,
          expectedBytes: plan.file.sizeBytes > 0 ? plan.file.sizeBytes : undefined,
        });
        tasks.push(task);
      } catch (err) {
        fs.rmSync(sidecarPath, { force: true });
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
          tasks.length > 0
            ? `${message} ${tasks.length} download(s) were already started and will continue.`
            : message
        );
      }
    }

    this.options.logger.info(
      "huggingface",
      `Queued ${tasks.length} Hugging Face download(s) for ${details.id}`
    );
    return tasks;
  }

  private async getSafetensorsProbe(
    details: HuggingFaceRepoDetails,
    filePath: string
  ): Promise<SafetensorsProbe | null> {
    const key = `${details.id}@${details.revision}:${filePath}`;
    const cached = this.probeCache.get(key);
    if (cached && Date.now() - cached.at < 600_000) {
      return cached.probe;
    }
    const probe = await this.options.client.probeSafetensors(
      details.id,
      details.revision,
      filePath
    );
    this.probeCache.set(key, { at: Date.now(), probe });
    return probe;
  }

  private async getRuntimeCapabilities(force: boolean): Promise<RuntimeCapabilities> {
    const state = this.options.getRuntime();
    if (state.status !== "connected" || !state.api) {
      return { connected: false, comfyVersion: state.comfyVersion, nodeClasses: null };
    }
    if (!force && this.nodeCache && Date.now() - this.nodeCache.at < 30_000) {
      return this.nodeCache.capabilities;
    }
    try {
      const objectInfo = await state.api.getAllObjectInfo();
      const capabilities: RuntimeCapabilities = {
        connected: true,
        comfyVersion: state.comfyVersion,
        nodeClasses: new Set(Object.keys(objectInfo)),
      };
      this.nodeCache = { at: Date.now(), capabilities };
      return capabilities;
    } catch (err) {
      this.options.logger.warn(
        "huggingface",
        "Could not read ComfyUI object_info during compatibility check",
        String(err)
      );
      return { connected: true, comfyVersion: state.comfyVersion, nodeClasses: null };
    }
  }

  private resolveDiskFreeBytes(hardware: GpuStats, modelsRoot: string): number | null {
    const driveRoot = (path.parse(path.resolve(modelsRoot)).root || modelsRoot).toUpperCase();
    const freeGB = hardware.diskFreeGB[driveRoot];
    if (typeof freeGB !== "number" || !Number.isFinite(freeGB)) return null;
    return freeGB * 1024 ** 3;
  }

  /** Used by tests and for a conservative pre-download sanity check. */
  describeTargetPath(
    repoId: string,
    revision: string,
    filePath: string,
    architecture: string
  ): string {
    const details = this.repoCache.get(`${repoId}@${revision}`)?.details;
    const file = details?.files.find((candidate) => candidate.path === filePath);
    const category = file
      ? categoryForSelectedFile(file, architecture)
      : architecture === "wan_video"
        ? "diffusion_model"
        : "checkpoint";
    return path.join(
      resolveCivitaiModelsRoot(this.options.getSettings(), this.options.managedModelsDir),
      CATEGORY_FOLDERS[category],
      sanitizeModelFileName(path.basename(filePath), "hf-model.safetensors")
    );
  }
}

function writeSidecar(targetPath: string, payload: Record<string, unknown>): void {
  const tempPath = `${targetPath}.tmp`;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), "utf8");
  fs.rmSync(targetPath, { force: true });
  fs.renameSync(tempPath, targetPath);
}

/**
 * Re-exported so handlers can validate a repository selection against the same
 * conservative architecture rules used by the compatibility report.
 */
export function assessSelectedArchitecture(
  details: HuggingFaceRepoDetails,
  filePath: string
) {
  return assessHuggingFaceArchitecture({
    repoId: details.id,
    pipelineTag: details.pipelineTag,
    tags: details.tags,
    filePath,
    config: details.config,
    modelIndex: details.modelIndex,
  });
}
