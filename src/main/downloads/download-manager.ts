import { execFile } from "node:child_process";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import sevenBin from "7zip-bin";
import type { DownloadTask, ModelCategory } from "../../shared/types";
import type { StudioRepository } from "../db/repositories";
import { getDiskFreeGBMap } from "../hardware/gpu-detector";
import type { StudioLogger } from "../logger";
import { assertSafeExternalUrl } from "../security";

const execFileAsync = promisify(execFile);

export interface StartDownloadInput {
  id?: string;
  kind: "comfy_runtime" | "model";
  title: string;
  url: string;
  targetPath: string;
  category: ModelCategory | "runtime";
  sourceName: string;
  licenseName: string;
  expectedSha256?: string | null;
  expectedBytes?: number;
  extractToDir?: string;
}

export interface DownloadManagerOptions {
  allowLoopbackHttpForTests?: boolean;
  sevenZipPath?: string;
  /**
   * Resolves non-persisted request headers (for example a provider token) each
   * time a transfer starts or resumes. Header values are never stored in the DB.
   */
  headerProvider?: (task: DownloadTask) => Record<string, string> | null;
}

function resolve7zaPath(customPath?: string): string {
  if (customPath) return customPath;
  const binPath = sevenBin.path7za;
  if (binPath.includes("app.asar") && !binPath.includes("app.asar.unpacked")) {
    const unpacked = binPath.replace("app.asar", "app.asar.unpacked");
    if (fs.existsSync(unpacked)) {
      return unpacked;
    }
  }
  return binPath;
}

function validateDownloadUrl(rawUrl: string, allowLoopbackHttp?: boolean): URL {
  const parsed = new URL(rawUrl);
  if (
    allowLoopbackHttp &&
    parsed.protocol === "http:" &&
    (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "::1")
  ) {
    return parsed;
  }
  return assertSafeExternalUrl(rawUrl);
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

export class DownloadManager extends EventEmitter {
  private readonly tasks = new Map<string, DownloadTask>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly userAction = new Map<string, "pause" | "cancel">();
  private readonly extractTargets = new Map<string, string>();
  private readonly activePromises = new Map<string, Promise<DownloadTask>>();

  constructor(
    private readonly repo: StudioRepository,
    private readonly logger?: StudioLogger,
    private readonly options: DownloadManagerOptions = {}
  ) {
    super();
    this.loadPersistedDownloads();
  }

  private loadPersistedDownloads(): void {
    const stored = this.repo.listDownloads(100);
    for (const task of stored) {
      // Recover tasks that were interrupted mid-flight when app last closed
      if (
        task.status === "downloading" ||
        task.status === "pending" ||
        task.status === "verifying" ||
        task.status === "extracting"
      ) {
        const partPath = `${task.targetPath}.part`;
        const partBytes = fs.existsSync(partPath) ? fs.statSync(partPath).size : 0;
        const paused: DownloadTask = {
          ...task,
          downloadedBytes: partBytes,
          speedBytesPerSec: 0,
          etaSeconds: null,
          status: partBytes > 0 ? "paused" : "failed",
          error:
            partBytes > 0
              ? "Interrupted by application exit — ready to resume."
              : "Interrupted before data was saved.",
        };
        this.repo.upsertDownload(paused);
        this.tasks.set(paused.id, paused);
      } else {
        this.tasks.set(task.id, task);
      }
    }
  }

  listDownloads(): DownloadTask[] {
    return Array.from(this.tasks.values()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
  }

  getTask(id: string): DownloadTask | undefined {
    return this.tasks.get(id);
  }

  async waitForTask(id: string): Promise<DownloadTask | undefined> {
    const pending = this.activePromises.get(id);
    if (pending) {
      return await pending;
    }
    return this.tasks.get(id);
  }

  async startDownload(input: StartDownloadInput): Promise<DownloadTask> {
    validateDownloadUrl(input.url, this.options.allowLoopbackHttpForTests);

    const targetDir = path.dirname(path.resolve(input.targetPath));
    await fs.promises.mkdir(targetDir, { recursive: true });

    // Pre-flight disk space verification for large files / runtime archives
    const requiredBytes =
      (input.expectedBytes ?? 0) * (input.extractToDir ? 2.6 : 1.05);
    if (requiredBytes > 0) {
      const diskMap = await getDiskFreeGBMap([targetDir]);
      const driveRoot = (path.parse(targetDir).root || targetDir).toUpperCase();
      const freeGB = diskMap[driveRoot];
      if (typeof freeGB === "number") {
        const freeBytes = freeGB * 1024 ** 3;
        if (freeBytes < requiredBytes) {
          const neededGB = (requiredBytes / 1024 ** 3).toFixed(2);
          throw new Error(
            `Insufficient free disk space on ${driveRoot} (${freeGB.toFixed(2)} GB free, need ~${neededGB} GB).`
          );
        }
      }
    }

    const id = input.id ?? `dl_${crypto.randomUUID().slice(0, 12)}`;
    const existing = this.tasks.get(id);
    if (existing && (existing.status === "downloading" || existing.status === "verifying" || existing.status === "extracting")) {
      return existing;
    }

    const partPath = `${path.resolve(input.targetPath)}.part`;
    const partSize = fs.existsSync(partPath) ? fs.statSync(partPath).size : 0;

    const task: DownloadTask = {
      id,
      kind: input.kind,
      title: input.title,
      url: input.url,
      targetPath: path.resolve(input.targetPath),
      category: input.category,
      sourceName: input.sourceName,
      licenseName: input.licenseName,
      expectedSha256: input.expectedSha256?.trim().toLowerCase() || null,
      actualSha256: null,
      totalBytes: input.expectedBytes ?? 0,
      downloadedBytes: partSize,
      speedBytesPerSec: 0,
      etaSeconds: null,
      status: "pending",
      error: null,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      completedAt: null,
    };

    if (input.extractToDir) {
      this.extractTargets.set(id, path.resolve(input.extractToDir));
    }

    this.commitTask(task);
    this.launchTransfer(task);
    return { ...task };
  }

  pauseDownload(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;
    if (task.status !== "downloading" && task.status !== "pending") return false;

    this.userAction.set(id, "pause");
    const ctrl = this.controllers.get(id);
    ctrl?.abort();
    return true;
  }

  resumeDownload(id: string): DownloadTask | null {
    const task = this.tasks.get(id);
    if (!task) return null;
    if (task.status !== "paused" && task.status !== "failed") {
      return task;
    }

    this.userAction.delete(id);
    const partPath = `${task.targetPath}.part`;
    const partSize = fs.existsSync(partPath) ? fs.statSync(partPath).size : 0;

    const resumed: DownloadTask = {
      ...task,
      status: "pending",
      error: null,
      downloadedBytes: partSize,
      speedBytesPerSec: 0,
      etaSeconds: null,
    };
    this.commitTask(resumed);
    this.launchTransfer(resumed);
    return { ...resumed };
  }

  cancelDownload(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;

    if (task.status === "downloading" || task.status === "pending") {
      this.userAction.set(id, "cancel");
      this.controllers.get(id)?.abort();
      return true;
    }

    const partPath = `${task.targetPath}.part`;
    if (fs.existsSync(partPath)) {
      fs.rmSync(partPath, { force: true });
    }
    this.commitTask({
      ...task,
      status: "cancelled",
      speedBytesPerSec: 0,
      etaSeconds: null,
      error: "Cancelled by user.",
    });
    return true;
  }

  private commitTask(task: DownloadTask): void {
    const copy = { ...task };
    this.tasks.set(copy.id, copy);
    this.repo.upsertDownload(copy);
    this.emit("updated", copy);
  }

  private launchTransfer(task: DownloadTask): void {
    const promise = this.executeTransfer(task.id).finally(() => {
      this.controllers.delete(task.id);
      this.activePromises.delete(task.id);
    });
    this.activePromises.set(task.id, promise);
  }

  private async executeTransfer(taskId: string): Promise<DownloadTask> {
    const initial = this.tasks.get(taskId);
    if (!initial) {
      throw new Error(`Missing download task ${taskId}`);
    }

    const controller = new AbortController();
    this.controllers.set(taskId, controller);
    this.userAction.delete(taskId);

    const partPath = `${initial.targetPath}.part`;
    let existingBytes = fs.existsSync(partPath) ? fs.statSync(partPath).size : 0;

    const current: DownloadTask = {
      ...initial,
      status: "downloading",
      downloadedBytes: existingBytes,
      error: null,
    };
    this.commitTask(current);

    let writeStream: fs.WriteStream | null = null;
    try {
      const headers: Record<string, string> = {
        "User-Agent": "KireaStudio/1.0.1 (Windows Desktop)",
        ...(this.options.headerProvider?.(current) ?? {}),
      };
      if (existingBytes > 0) {
        headers.Range = `bytes=${existingBytes}-`;
      }

      const response = await fetch(current.url, {
        headers,
        redirect: "follow",
        signal: controller.signal,
      });

      if (response.status === 416 && current.totalBytes > 0 && existingBytes >= current.totalBytes) {
        // Already downloaded completely in .part file
      } else {
        if (!response.ok && response.status !== 206) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }

        const isPartial = response.status === 206;
        if (!isPartial && existingBytes > 0) {
          // Server ignored Range header and sent the full stream; restart cleanly
          await fs.promises.rm(partPath, { force: true });
          existingBytes = 0;
        }

        const contentLength = Number(response.headers.get("content-length") ?? "0");
        const contentRange = response.headers.get("content-range");
        const declaredTotal = current.totalBytes;
        let resolvedTotal = declaredTotal;

        if (contentRange) {
          const match = contentRange.match(/\/(\d+)\s*$/);
          if (match) {
            resolvedTotal = Number(match[1]);
          }
        } else if (contentLength > 0) {
          resolvedTotal = isPartial ? existingBytes + contentLength : contentLength;
        }

        if (
          declaredTotal > 0 &&
          resolvedTotal > 0 &&
          resolvedTotal !== declaredTotal
        ) {
          throw new Error(
            `File-size verification failed. Expected ${declaredTotal} bytes, source reports ${resolvedTotal}.`
          );
        }

        current.totalBytes = resolvedTotal;
        current.downloadedBytes = existingBytes;
        this.commitTask(current);

        if (!response.body) {
          throw new Error("Response returned an empty stream body.");
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
                if (!controller.signal.aborted) {
                  nodeStream.resume();
                }
              });
            }

            downloaded += chunk.length;
            windowBytes += chunk.length;

            const now = Date.now();
            const elapsedMs = now - windowStart;
            if (now - lastEmitAt >= 250) {
              if (elapsedMs >= 200) {
                const instantRate = (windowBytes * 1000) / elapsedMs;
                smoothedSpeed =
                  smoothedSpeed > 0 ? smoothedSpeed * 0.65 + instantRate * 0.35 : instantRate;
                windowBytes = 0;
                windowStart = now;
              }
              const remaining =
                current.totalBytes > downloaded ? current.totalBytes - downloaded : 0;
              const eta =
                smoothedSpeed > 1024 && remaining > 0
                  ? Math.ceil(remaining / smoothedSpeed)
                  : null;

              current.downloadedBytes = downloaded;
              current.speedBytesPerSec = Math.round(smoothedSpeed);
              current.etaSeconds = eta;
              this.commitTask(current);
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

      // Close stream before verification/rename
      if (writeStream && !writeStream.closed) {
        await new Promise<void>((resolve) => writeStream!.close(() => resolve()));
      }

      const finalPartSize = fs.existsSync(partPath) ? fs.statSync(partPath).size : 0;
      current.downloadedBytes = finalPartSize;
      if (current.totalBytes === 0) {
        current.totalBytes = finalPartSize;
      }
      if (finalPartSize !== current.totalBytes) {
        await fs.promises.rm(partPath, { force: true });
        throw new Error(
          `File-size verification failed. Expected ${current.totalBytes} bytes, got ${finalPartSize}.`
        );
      }

      // Integrity verification phase
      current.status = "verifying";
      current.speedBytesPerSec = 0;
      current.etaSeconds = null;
      this.commitTask(current);

      const actualSha256 = await computeFileSha256(partPath);
      current.actualSha256 = actualSha256;

      if (current.expectedSha256 && actualSha256 !== current.expectedSha256) {
        await fs.promises.rm(partPath, { force: true });
        throw new Error(
          `SHA-256 verification failed. Expected ${current.expectedSha256.slice(0, 12)}..., got ${actualSha256.slice(0, 12)}...`
        );
      }

      if (fs.existsSync(current.targetPath)) {
        await fs.promises.rm(current.targetPath, { force: true });
      }
      await fs.promises.rename(partPath, current.targetPath);

      // Optional runtime archive extraction via bundled 7za binary (no shell)
      const extractDir = this.extractTargets.get(taskId);
      if (extractDir) {
        current.status = "extracting";
        this.commitTask(current);
        await fs.promises.mkdir(extractDir, { recursive: true });
        const bin7za = resolve7zaPath(this.options.sevenZipPath);
        this.logger?.info("downloads", `Extracting ${current.targetPath} into ${extractDir}`);
        await execFileAsync(bin7za, ["x", "-y", `-o${extractDir}`, current.targetPath], {
          windowsHide: true,
          timeout: 15 * 60 * 1000,
        });
      }

      current.status = "completed";
      current.completedAt = new Date().toISOString();
      this.commitTask(current);
      this.logger?.info("downloads", `Completed ${current.title} -> ${current.targetPath}`);
      return { ...current };
    } catch (err) {
      if (writeStream && !writeStream.closed) {
        await new Promise<void>((resolve) => writeStream!.close(() => resolve()));
      }

      const action = this.userAction.get(taskId);
      this.userAction.delete(taskId);
      const partBytes = fs.existsSync(partPath) ? fs.statSync(partPath).size : 0;

      if (action === "cancel") {
        await fs.promises.rm(partPath, { force: true }).catch(() => undefined);
        const cancelled: DownloadTask = {
          ...current,
          status: "cancelled",
          downloadedBytes: 0,
          speedBytesPerSec: 0,
          etaSeconds: null,
          error: "Cancelled by user.",
        };
        this.commitTask(cancelled);
        return cancelled;
      }

      if (action === "pause" || controller.signal.aborted) {
        const paused: DownloadTask = {
          ...current,
          status: "paused",
          downloadedBytes: partBytes,
          speedBytesPerSec: 0,
          etaSeconds: null,
          error: null,
        };
        this.commitTask(paused);
        return paused;
      }

      const message = err instanceof Error ? err.message : String(err);
      this.logger?.error("downloads", `Download failed for ${current.title}`, message);
      const failed: DownloadTask = {
        ...current,
        status: "failed",
        downloadedBytes: partBytes,
        speedBytesPerSec: 0,
        etaSeconds: null,
        error: message,
      };
      this.commitTask(failed);
      return failed;
    }
  }
}

