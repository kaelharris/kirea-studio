import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type {
  CivitaiDownloadTask,
  CivitaiModelSummary,
  CivitaiModelType,
  CivitaiVersion,
} from "../../shared/civitai";
import type { AppSettings, ModelArchitecture } from "../../shared/types";
import type { StudioLogger } from "../logger";
import { assertSafeExternalUrl } from "../security";

const USER_AGENT = "KireaStudio/1.0.1 (Windows Desktop)";

export const CIVITAI_TYPE_FOLDERS: Record<CivitaiModelType, string> = {
  Checkpoint: "checkpoints",
  LORA: "loras",
  TextualInversion: "embeddings",
  VAE: "vae",
  Controlnet: "controlnet",
  Upscaler: "upscale_models",
  MotionModel: "diffusion_models",
  Other: "checkpoints",
};

const MODEL_EXTENSIONS = new Set([
  ".safetensors",
  ".ckpt",
  ".pt",
  ".pth",
  ".bin",
  ".gguf",
]);

export interface CivitaiDownloadManagerOptions {
  logger?: StudioLogger;
  previewCacheDir?: string;
  allowLoopbackHttpForTests?: boolean;
  fetcher?: typeof fetch;
  persistPath?: string;
}

export interface CivitaiStartDownloadInput {
  model: CivitaiModelSummary;
  version: CivitaiVersion;
  apiKey: string | null;
  settings: AppSettings;
  managedModelsDir: string;
}

interface ManagedEntry {
  task: CivitaiDownloadTask;
  request: CivitaiStartDownloadInput;
  controller: AbortController | null;
  promise: Promise<CivitaiDownloadTask> | null;
  cancelRequested: boolean;
}

export function sanitizeModelFileName(raw: string, fallback: string): string {
  const base = path.basename((raw || "").replace(/\\/g, "/"));
  const cleaned = base
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "");
  const safe = cleaned || `${fallback.replace(/\.[^.]+$/, "")}.safetensors`;
  return MODEL_EXTENSIONS.has(path.extname(safe).toLowerCase())
    ? safe
    : `${safe}.safetensors`;
}

export function resolveCivitaiModelsRoot(
  settings: AppSettings,
  managedModelsDir: string
): string {
  const comfyRoot =
    settings.runtimeMode === "managed"
      ? settings.managedComfyPath
      : settings.externalComfyPath;
  if (comfyRoot && fs.existsSync(comfyRoot)) {
    const portableModels = path.join(comfyRoot, "ComfyUI", "models");
    if (fs.existsSync(portableModels)) return portableModels;
    return path.join(comfyRoot, "models");
  }
  return managedModelsDir;
}

export function resolveCivitaiTargetPath(
  modelsRoot: string,
  type: CivitaiModelType,
  architecture: ModelArchitecture,
  fileName: string
): string {
  let folder = CIVITAI_TYPE_FOLDERS[type] ?? "checkpoints";
  if (
    type === "Checkpoint" &&
    (architecture === "moss_image" || architecture === "anima" || architecture === "z_image")
  ) {
    folder = "diffusion_models";
  }
  const useArchitectureFolder =
    (type === "Checkpoint" || type === "LORA" || type === "TextualInversion") && architecture !== "unknown";
  return path.join(
    modelsRoot,
    folder,
    ...(useArchitectureFolder ? [architecture] : []),
    fileName
  );
}

export interface CivitaiSidecarInput {
  modelId: number;
  versionId: number;
  modelName: string;
  versionName: string;
  baseModel: string;
  trainedWords: string[];
  description: string | null;
  sha256: string | null;
}

export function buildCivitaiSidecar(
  input: CivitaiSidecarInput,
  downloadedAt = new Date().toISOString()
): Record<string, unknown> {
  return {
    source: "civitai",
    modelId: input.modelId,
    modelVersionId: input.versionId,
    modelName: input.modelName,
    name: input.versionName,
    baseModel: input.baseModel,
    trainedWords: input.trainedWords,
    description: input.description ?? "",
    sha256: input.sha256,
    modelUrl: `https://civitai.com/models/${input.modelId}?modelVersionId=${input.versionId}`,
    downloadedAt,
  };
}

const MAX_REDIRECTS = 6;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function validateDownloadUrl(rawUrl: string, allowLoopbackHttp?: boolean): URL {
  const parsed = new URL(rawUrl);
  if (
    allowLoopbackHttp &&
    parsed.protocol === "http:" &&
    (parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "localhost" ||
      parsed.hostname === "::1")
  ) {
    return parsed;
  }
  return assertSafeExternalUrl(rawUrl);
}

/**
 * Follows HTTP redirects manually so every redirect target is validated and any
 * Authorization bearer token is stripped before leaving the initial origin.
 */
async function fetchWithSafeRedirects(
  fetcher: typeof fetch,
  rawUrl: string,
  options: {
    headers: Record<string, string>;
    apiKey?: string | null;
    signal?: AbortSignal;
    allowLoopbackHttp?: boolean;
  }
): Promise<Response> {
  const initialUrl = validateDownloadUrl(rawUrl, options.allowLoopbackHttp);
  let currentUrl = initialUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const hopHeaders = { ...options.headers };
    if (options.apiKey && currentUrl.origin === initialUrl.origin) {
      hopHeaders.Authorization = `Bearer ${options.apiKey}`;
    } else {
      delete hopHeaders.Authorization;
    }

    const response = await fetcher(currentUrl.toString(), {
      headers: hopHeaders,
      redirect: "manual",
      signal: options.signal,
    });

    if (!REDIRECT_STATUSES.has(response.status)) {
      return response;
    }

    const location = response.headers.get("location");
    if (!location) {
      return response;
    }

    await response.body?.cancel().catch(() => undefined);
    if (hop === MAX_REDIRECTS) {
      throw new Error("Too many redirects while fetching Civitai resource.");
    }

    const resolvedLocation = new URL(location, currentUrl).toString();
    currentUrl = validateDownloadUrl(resolvedLocation, options.allowLoopbackHttp);
  }

  throw new Error("Too many redirects while fetching Civitai resource.");
}

async function computeFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex").toLowerCase()));
  });
}

function previewExtension(contentType: string | null): string {
  const value = (contentType ?? "").toLowerCase();
  if (value.includes("webp")) return ".webp";
  if (value.includes("jpeg") || value.includes("jpg")) return ".jpg";
  return ".png";
}

function writeFileAtomic(targetPath: string, contents: string): void {
  const tempPath = `${targetPath}.tmp`;
  fs.writeFileSync(tempPath, contents, "utf8");
  fs.rmSync(targetPath, { force: true });
  fs.renameSync(tempPath, targetPath);
}

async function readResponseErrorDetail(response: Response): Promise<string | null> {
  try {
    const text = (await response.text()).trim();
    if (!text) return null;
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const message = parsed.message ?? parsed.error ?? parsed.details;
      if (typeof message === "string" && message.trim()) {
        return message.trim().replace(/\s+/g, " ").slice(0, 300);
      }
    } catch {
      // Fall through to the raw body.
    }
    return text.replace(/\s+/g, " ").slice(0, 300);
  } catch {
    return null;
  }
}

export class CivitaiDownloadManager extends EventEmitter {
  private readonly entries = new Map<string, ManagedEntry>();

  constructor(private readonly options: CivitaiDownloadManagerOptions = {}) {
    super();
    this.loadPersisted();
  }

  private savePersisted(): void {
    if (!this.options.persistPath) return;
    try {
      const data = Array.from(this.entries.values()).map((entry) => ({
        task: entry.task,
        request: entry.request,
      }));
      const dir = path.dirname(this.options.persistPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      writeFileAtomic(this.options.persistPath, JSON.stringify(data, null, 2));
    } catch (err) {
      this.options.logger?.warn("civitai", "Failed to save persisted downloads", String(err));
    }
  }

  private loadPersisted(): void {
    if (!this.options.persistPath || !fs.existsSync(this.options.persistPath)) return;
    try {
      const raw = fs.readFileSync(this.options.persistPath, "utf8");
      const data = JSON.parse(raw) as Array<{ task: CivitaiDownloadTask; request: CivitaiStartDownloadInput }>;
      if (!Array.isArray(data)) return;
      for (const item of data) {
        if (!item?.task?.id || !item?.request) continue;
        const task = { ...item.task };
        const partPath = `${task.targetPath}.part`;
        const partBytes = fs.existsSync(partPath) ? fs.statSync(partPath).size : 0;
        const targetBytes = fs.existsSync(task.targetPath) ? fs.statSync(task.targetPath).size : 0;

        if (targetBytes > 0 && (task.totalBytes <= 0 || targetBytes >= task.totalBytes - 4096)) {
          task.status = "completed";
          task.downloadedBytes = targetBytes;
          task.totalBytes = targetBytes;
          task.speedBytesPerSec = 0;
          task.etaSeconds = null;
        } else if (
          task.status === "queued" ||
          task.status === "downloading" ||
          task.status === "verifying" ||
          task.status === "finalizing"
        ) {
          task.downloadedBytes = partBytes;
          task.speedBytesPerSec = 0;
          task.etaSeconds = null;
          task.status = partBytes > 0 ? "paused" : "failed";
          task.error =
            partBytes > 0
              ? "Interrupted by application exit — ready to resume."
              : "Interrupted before data was saved.";
        }
        this.entries.set(task.id, {
          task,
          request: item.request,
          controller: null,
          promise: null,
          cancelRequested: false,
        });
      }
    } catch (err) {
      this.options.logger?.warn("civitai", "Failed to load persisted downloads", String(err));
    }
  }

  prepareShutdown(): void {
    for (const entry of this.entries.values()) {
      if (
        entry.task.status === "queued" ||
        entry.task.status === "downloading" ||
        entry.task.status === "verifying" ||
        entry.task.status === "finalizing"
      ) {
        entry.controller?.abort();
        const partPath = `${entry.task.targetPath}.part`;
        const partBytes = fs.existsSync(partPath) ? fs.statSync(partPath).size : 0;
        entry.task = {
          ...entry.task,
          status: partBytes > 0 ? "paused" : "failed",
          downloadedBytes: partBytes,
          speedBytesPerSec: 0,
          etaSeconds: null,
          error:
            partBytes > 0
              ? "Interrupted by application exit — ready to resume."
              : "Interrupted before data was saved.",
        };
      }
    }
    this.savePersisted();
  }

  private get fetcher(): typeof fetch {
    return this.options.fetcher ?? fetch;
  }

  listDownloads(): CivitaiDownloadTask[] {
    return Array.from(this.entries.values())
      .map((entry) => ({ ...entry.task }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  clearCompleted(): number {
    let cleared = 0;
    const toRemove: string[] = [];
    for (const [id, entry] of this.entries.entries()) {
      const s = entry.task.status;
      if (s === "completed" || s === "failed" || s === "cancelled") {
        toRemove.push(id);
      }
    }
    for (const id of toRemove) {
      this.entries.delete(id);
      cleared++;
    }
    if (cleared > 0) {
      this.savePersisted();
      this.emit("historyCleared", cleared);
    }
    return cleared;
  }

  getTask(id: string): CivitaiDownloadTask | undefined {
    const entry = this.entries.get(id);
    return entry ? { ...entry.task } : undefined;
  }

  async waitForTask(id: string): Promise<CivitaiDownloadTask | undefined> {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    if (entry.promise) return await entry.promise;
    return { ...entry.task };
  }

  start(input: CivitaiStartDownloadInput): CivitaiDownloadTask {
    validateDownloadUrl(input.version.downloadUrl, this.options.allowLoopbackHttpForTests);

    const id = `civitai_${input.version.id}`;
    const existing = this.entries.get(id);
    if (
      existing &&
      (existing.task.status === "queued" ||
        existing.task.status === "downloading" ||
        existing.task.status === "verifying" ||
        existing.task.status === "finalizing")
    ) {
      return { ...existing.task };
    }

    const modelsRoot = resolveCivitaiModelsRoot(input.settings, input.managedModelsDir);
    const fileName = sanitizeModelFileName(
      input.version.fileName,
      `${input.model.name}-v${input.version.id}`
    );
    const targetPath = resolveCivitaiTargetPath(
      modelsRoot,
      input.model.type,
      input.version.architecture,
      fileName
    );

    if (fs.existsSync(targetPath)) {
      const existingBytes = fs.statSync(targetPath).size;
      if (existingBytes === 0) {
        fs.rmSync(targetPath, { force: true });
      } else if (
        input.version.sizeBytes === 0 ||
        Math.abs(existingBytes - input.version.sizeBytes) <= 4096
      ) {
        const completedAt = new Date().toISOString();
        const alreadyInstalled: CivitaiDownloadTask = {
          id,
          modelId: input.model.id,
          versionId: input.version.id,
          modelName: input.model.name,
          versionName: input.version.name,
          architecture: input.version.architecture,
          fileName,
          targetPath,
          totalBytes: existingBytes,
          downloadedBytes: existingBytes,
          speedBytesPerSec: 0,
          etaSeconds: null,
          status: "completed",
          error: null,
          createdAt: existing?.task.createdAt ?? completedAt,
          completedAt,
        };
        const entry: ManagedEntry = {
          task: alreadyInstalled,
          request: input,
          controller: null,
          promise: null,
          cancelRequested: false,
        };
        this.entries.set(id, entry);
        this.emitTask(alreadyInstalled);
        return { ...alreadyInstalled };
      } else {
        throw new Error(
          `A different file already exists at '${targetPath}'. Remove or rename it before downloading this version.`
        );
      }
    }

    const task: CivitaiDownloadTask = {
      id,
      modelId: input.model.id,
      versionId: input.version.id,
      modelName: input.model.name,
      versionName: input.version.name,
      architecture: input.version.architecture,
      fileName,
      targetPath,
      totalBytes: input.version.sizeBytes,
      downloadedBytes: 0,
      speedBytesPerSec: 0,
      etaSeconds: null,
      status: "queued",
      error: null,
      createdAt: existing?.task.createdAt ?? new Date().toISOString(),
      completedAt: null,
    };

    const entry: ManagedEntry = {
      task,
      request: input,
      controller: null,
      promise: null,
      cancelRequested: false,
    };
    this.entries.set(id, entry);
    this.emitTask(task);
    this.savePersisted();
    this.launch(entry);
    return { ...task };
  }

  pauseDownload(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    if (entry.task.status !== "queued" && entry.task.status !== "downloading") {
      return false;
    }
    const partPath = `${entry.task.targetPath}.part`;
    const partBytes = fs.existsSync(partPath) ? fs.statSync(partPath).size : 0;
    entry.controller?.abort();
    this.updateTask(entry, {
      status: "paused",
      downloadedBytes: partBytes,
      speedBytesPerSec: 0,
      etaSeconds: null,
      error: "Paused by user.",
    });
    this.savePersisted();
    return true;
  }

  resumeDownload(id: string): CivitaiDownloadTask | null {
    return this.retryDownload(id);
  }

  cancelDownload(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    if (
      entry.task.status !== "queued" &&
      entry.task.status !== "downloading" &&
      entry.task.status !== "verifying" &&
      entry.task.status !== "finalizing"
    ) {
      return false;
    }
    entry.cancelRequested = true;
    entry.controller?.abort();
    // If the transfer has not reached its first await yet, settle it immediately.
    if (!entry.promise) {
      this.finalizeCancelled(entry);
    }
    this.savePersisted();
    return true;
  }

  retryDownload(id: string): CivitaiDownloadTask | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    if (
      entry.task.status === "queued" ||
      entry.task.status === "downloading" ||
      entry.task.status === "verifying" ||
      entry.task.status === "finalizing"
    ) {
      return { ...entry.task };
    }

    const partPath = `${entry.task.targetPath}.part`;
    const partBytes = fs.existsSync(partPath) ? fs.statSync(partPath).size : 0;
    entry.cancelRequested = false;
    entry.task = {
      ...entry.task,
      status: "queued",
      downloadedBytes: partBytes,
      speedBytesPerSec: 0,
      etaSeconds: null,
      error: null,
      completedAt: null,
    };
    this.emitTask(entry.task);
    this.savePersisted();
    this.launch(entry);
    return { ...entry.task };
  }

  private launch(entry: ManagedEntry): void {
    entry.promise = this.transfer(entry).finally(() => {
      entry.controller = null;
      entry.promise = null;
      this.savePersisted();
    });
  }

  private updateTask(entry: ManagedEntry, patch: Partial<CivitaiDownloadTask>): void {
    entry.task = { ...entry.task, ...patch };
    this.emitTask(entry.task);
    if (patch.status && patch.status !== "downloading") {
      this.savePersisted();
    }
  }

  private emitTask(task: CivitaiDownloadTask): void {
    this.emit("progress", { ...task });
  }

  private finalizeCancelled(entry: ManagedEntry): void {
    const partPath = `${entry.task.targetPath}.part`;
    fs.rmSync(partPath, { force: true });
    this.updateTask(entry, {
      status: "cancelled",
      downloadedBytes: 0,
      speedBytesPerSec: 0,
      etaSeconds: null,
      error: "Cancelled by user.",
    });
    this.savePersisted();
  }

  private async transfer(entry: ManagedEntry): Promise<CivitaiDownloadTask> {
    const { request } = entry;
    const { version } = request;
    const partPath = `${entry.task.targetPath}.part`;

    if (entry.cancelRequested) {
      this.finalizeCancelled(entry);
      return { ...entry.task };
    }

    await fs.promises.mkdir(path.dirname(entry.task.targetPath), { recursive: true });

    const controller = new AbortController();
    entry.controller = controller;

    if (entry.cancelRequested) {
      this.finalizeCancelled(entry);
      return { ...entry.task };
    }

    let existingBytes = fs.existsSync(partPath) ? fs.statSync(partPath).size : 0;
    this.updateTask(entry, {
      status: "downloading",
      downloadedBytes: existingBytes,
      speedBytesPerSec: 0,
      etaSeconds: null,
      error: null,
    });

    let writeStream: fs.WriteStream | null = null;
    try {
      const headers: Record<string, string> = {
        "User-Agent": USER_AGENT,
        Accept: "application/octet-stream",
      };
      if (existingBytes > 0) headers.Range = `bytes=${existingBytes}-`;

      const response = await fetchWithSafeRedirects(this.fetcher, version.downloadUrl, {
        headers,
        apiKey: request.apiKey,
        signal: controller.signal,
        allowLoopbackHttp: this.options.allowLoopbackHttpForTests,
      });

      if (response.status === 401) {
        const detail = await readResponseErrorDetail(response);
        throw new Error(
          `Civitai requires authentication for this download (HTTP 401)${detail ? `: ${detail}` : "."} Add or update the API key in Settings → Civitai Hub.`
        );
      }
      if (response.status === 403) {
        const detail = await readResponseErrorDetail(response);
        throw new Error(
          `Civitai refused this download (HTTP 403)${detail ? `: ${detail}` : "."} The model may be gated, in early access, or restricted; accept its terms on Civitai and verify your API key has access.`
        );
      }
      if (response.status === 404 || response.status === 410 || response.status === 451) {
        const detail = await readResponseErrorDetail(response);
        throw new Error(
          `Civitai reports this file as unavailable (HTTP ${response.status})${detail ? `: ${detail}` : "."}`
        );
      }
      if (response.status === 429) {
        throw new Error(
          "Civitai rate limit reached while downloading. Wait a moment and retry."
        );
      }

      const alreadyComplete =
        response.status === 416 &&
        entry.task.totalBytes > 0 &&
        existingBytes >= entry.task.totalBytes;

      if (!alreadyComplete) {
        if (!response.ok && response.status !== 206) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }

        const isPartial = response.status === 206;
        if (!isPartial && existingBytes > 0) {
          await fs.promises.rm(partPath, { force: true });
          existingBytes = 0;
        }

        const contentLength = Number(response.headers.get("content-length") ?? "0");
        const contentRange = response.headers.get("content-range");
        let resolvedTotal = entry.task.totalBytes;
        if (contentRange) {
          const match = contentRange.match(/\/(\d+)\s*$/);
          if (match) resolvedTotal = Number(match[1]);
        } else if (contentLength > 0) {
          resolvedTotal = isPartial ? existingBytes + contentLength : contentLength;
        }
        this.updateTask(entry, { totalBytes: resolvedTotal });

        if (!response.body) {
          throw new Error("Civitai returned an empty response body.");
        }

        writeStream = fs.createWriteStream(partPath, {
          flags: isPartial && existingBytes > 0 ? "a" : "w",
        });

        let downloaded = existingBytes;
        let windowBytes = 0;
        let windowStart = Date.now();
        let lastEmitAt = Date.now();
        let smoothedSpeed = 0;

        const nodeStream = Readable.fromWeb(
          response.body as unknown as import("node:stream/web").ReadableStream
        );

        await new Promise<void>((resolve, reject) => {
          const onAbort = (): void => {
            nodeStream.destroy();
            reject(new Error("ABORTED"));
          };
          controller.signal.addEventListener("abort", onAbort, { once: true });

          nodeStream.on("data", (chunk: Buffer) => {
            const canContinue = writeStream!.write(chunk);
            if (!canContinue) {
              nodeStream.pause();
              writeStream!.once("drain", () => {
                if (!controller.signal.aborted) nodeStream.resume();
              });
            }

            downloaded += chunk.length;
            windowBytes += chunk.length;

            const now = Date.now();
            if (now - lastEmitAt >= 250 || downloaded === chunk.length) {
              const elapsedMs = now - windowStart;
              if (elapsedMs >= 200) {
                const instantRate = (windowBytes * 1000) / elapsedMs;
                smoothedSpeed =
                  smoothedSpeed > 0
                    ? smoothedSpeed * 0.65 + instantRate * 0.35
                    : instantRate;
                windowBytes = 0;
                windowStart = now;
              }
              const remaining =
                entry.task.totalBytes > downloaded
                  ? entry.task.totalBytes - downloaded
                  : 0;
              this.updateTask(entry, {
                downloadedBytes: downloaded,
                speedBytesPerSec: Math.round(smoothedSpeed),
                etaSeconds:
                  smoothedSpeed > 1024 && remaining > 0
                    ? Math.ceil(remaining / smoothedSpeed)
                    : null,
              });
              lastEmitAt = now;
            }
          });

          nodeStream.on("error", (err) => {
            controller.signal.removeEventListener("abort", onAbort);
            reject(err);
          });

          nodeStream.on("end", () => {
            controller.signal.removeEventListener("abort", onAbort);
            writeStream!.end(() => resolve());
          });
        });
      }

      if (writeStream && !writeStream.closed) {
        await new Promise<void>((resolve) => writeStream!.close(() => resolve()));
      }

      const finalPartSize = fs.existsSync(partPath) ? fs.statSync(partPath).size : 0;
      if (entry.task.totalBytes > 0 && finalPartSize !== entry.task.totalBytes) {
        // Server-reported lengths are authoritative; tolerate Civitai's rounded sizeKB
        // only when the response did not provide a Content-Length/Content-Range.
        if (Math.abs(entry.task.totalBytes - finalPartSize) > 4096) {
          await fs.promises.rm(partPath, { force: true });
          throw new Error(
            `Incomplete download: received ${finalPartSize} of ${entry.task.totalBytes} bytes.`
          );
        }
      }

      this.updateTask(entry, {
        status: "verifying",
        downloadedBytes: finalPartSize,
        speedBytesPerSec: 0,
        etaSeconds: null,
      });

      if (version.sha256) {
        const actual = await computeFileSha256(partPath);
        if (actual !== version.sha256.toLowerCase()) {
          await fs.promises.rm(partPath, { force: true });
          throw new Error(
            `SHA-256 verification failed. Expected ${version.sha256.slice(0, 12)}…, got ${actual.slice(0, 12)}….`
          );
        }
      }

      this.updateTask(entry, { status: "finalizing" });

      const sidecarPath = `${entry.task.targetPath.replace(/\.[^.]+$/, "")}.civitai.info`;
      writeFileAtomic(
        sidecarPath,
        JSON.stringify(
          buildCivitaiSidecar({
            modelId: request.model.id,
            versionId: version.id,
            modelName: request.model.name,
            versionName: version.name,
            baseModel: version.baseModel,
            trainedWords: version.trainedWords,
            description: request.model.description,
            sha256: version.sha256,
          }),
          null,
          2
        )
      );

      await this.cachePreview(version, entry.task.targetPath);

      await fs.promises.rm(entry.task.targetPath, { force: true });
      await fs.promises.rename(partPath, entry.task.targetPath);

      const completedAt = new Date().toISOString();
      this.updateTask(entry, {
        status: "completed",
        downloadedBytes: finalPartSize,
        totalBytes: finalPartSize,
        speedBytesPerSec: 0,
        etaSeconds: null,
        completedAt,
      });
      this.options.logger?.info(
        "civitai",
        `Installed ${request.model.name} (${version.name}) -> ${entry.task.targetPath}`
      );
      this.emit("completed", { ...entry.task });
      return { ...entry.task };
    } catch (err) {
      if (writeStream && !writeStream.closed) {
        await new Promise<void>((resolve) => writeStream!.close(() => resolve()));
      }

      if (entry.task.status === "paused") {
        const partBytes = fs.existsSync(partPath)
          ? fs.statSync(partPath).size
          : entry.task.downloadedBytes;
        this.updateTask(entry, {
          status: "paused",
          downloadedBytes: partBytes,
          speedBytesPerSec: 0,
          etaSeconds: null,
          error: "Paused by user.",
        });
        return { ...entry.task };
      }

      if (entry.cancelRequested || controller.signal.aborted) {
        this.finalizeCancelled(entry);
        return { ...entry.task };
      }

      const message = err instanceof Error ? err.message : String(err);
      this.options.logger?.error(
        "civitai",
        `Download failed for ${request.model.name}`,
        message
      );
      const partBytes = fs.existsSync(partPath) ? fs.statSync(partPath).size : 0;
      this.updateTask(entry, {
        status: "failed",
        downloadedBytes: partBytes,
        speedBytesPerSec: 0,
        etaSeconds: null,
        error: message,
      });
      return { ...entry.task };
    }
  }

  private async cachePreview(version: CivitaiVersion, targetPath: string): Promise<void> {
    const previewUrl = version.primaryPreviewUrl;
    if (!previewUrl) return;
    try {
      const response = await fetchWithSafeRedirects(this.fetcher, previewUrl, {
        headers: { "User-Agent": USER_AGENT },
        allowLoopbackHttp: this.options.allowLoopbackHttpForTests,
      });
      if (!response.ok) return;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length === 0) return;
      const ext = previewExtension(response.headers.get("content-type"));
      const localPreview = `${targetPath.replace(/\.[^.]+$/, "")}.preview${ext}`;
      await fs.promises.writeFile(localPreview, bytes);

      if (this.options.previewCacheDir) {
        await fs.promises.mkdir(this.options.previewCacheDir, { recursive: true });
        await fs.promises.writeFile(
          path.join(this.options.previewCacheDir, `civitai-${version.id}${ext}`),
          bytes
        );
      }
    } catch (err) {
      this.options.logger?.warn(
        "civitai",
        `Preview download failed for version ${version.id}`,
        String(err)
      );
    }
  }
}
