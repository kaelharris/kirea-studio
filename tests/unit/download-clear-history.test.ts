import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CivitaiDownloadManager } from "../../src/main/civitai/download-manager";
import { DownloadManager } from "../../src/main/downloads/download-manager";
import type { CivitaiDownloadTask } from "../../src/shared/civitai";
import type { DownloadTask } from "../../src/shared/types";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-dl-clear-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("CivitaiDownloadManager.clearCompleted", () => {
  it("clears completed, failed, and cancelled downloads from memory and persistence without touching files", () => {
    const dir = makeTempDir();
    const persistPath = path.join(dir, "civitai-downloads.json");

    // Create a mock model file on disk to verify it is NOT deleted
    const modelFilePath = path.join(dir, "model.safetensors");
    fs.writeFileSync(modelFilePath, "mock weights content");

    const manager = new CivitaiDownloadManager({
      persistPath,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
    });

    const completedTask: CivitaiDownloadTask = {
      id: "civitai_101",
      modelId: 1,
      versionId: 101,
      modelName: "Anime Checkpoint",
      versionName: "v1.0",
      architecture: "sdxl",
      fileName: "model.safetensors",
      targetPath: modelFilePath,
      status: "completed",
      totalBytes: 1000,
      downloadedBytes: 1000,
      speedBytesPerSec: 0,
      etaSeconds: null,
      error: null,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };

    const failedTask: CivitaiDownloadTask = {
      ...completedTask,
      id: "civitai_102",
      versionId: 102,
      status: "failed",
      error: "Network timeout",
    };

    const activeTask: CivitaiDownloadTask = {
      ...completedTask,
      id: "civitai_103",
      versionId: 103,
      status: "downloading",
      downloadedBytes: 500,
    };

    // Inject entries
    (manager as any).entries.set(completedTask.id, {
      task: completedTask,
      request: {} as any,
      controller: null,
      promise: null,
      cancelRequested: false,
    });
    (manager as any).entries.set(failedTask.id, {
      task: failedTask,
      request: {} as any,
      controller: null,
      promise: null,
      cancelRequested: false,
    });
    (manager as any).entries.set(activeTask.id, {
      task: activeTask,
      request: {} as any,
      controller: null,
      promise: null,
      cancelRequested: false,
    });

    expect(manager.listDownloads().length).toBe(3);

    const cleared = manager.clearCompleted();
    expect(cleared).toBe(2);

    // Active task must still be present
    const remaining = manager.listDownloads();
    expect(remaining.length).toBe(1);
    expect(remaining[0]?.id).toBe("civitai_103");

    // The physical file on disk must NOT have been deleted
    expect(fs.existsSync(modelFilePath)).toBe(true);
    expect(fs.readFileSync(modelFilePath, "utf8")).toBe("mock weights content");

    // Check that persistence file was updated
    expect(fs.existsSync(persistPath)).toBe(true);
    const persisted = JSON.parse(fs.readFileSync(persistPath, "utf8"));
    expect(persisted.length).toBe(1);
    expect(persisted[0]?.task?.id).toBe("civitai_103");
  });
});

describe("DownloadManager.clearCompleted", () => {
  it("clears completed, failed, and cancelled generic downloads while keeping active downloads", () => {
    const dir = makeTempDir();
    const mockFilePath = path.join(dir, "generic-model.safetensors");
    fs.writeFileSync(mockFilePath, "generic model data");

    const deletedIds: string[] = [];
    const mockRepo = {
      listDownloads: () => [],
      upsertDownload: vi.fn(),
      deleteDownload: (id: string) => {
        deletedIds.push(id);
      },
      clearCompletedDownloads: vi.fn(() => 2),
    } as any;

    const manager = new DownloadManager(mockRepo);

    const completedTask: DownloadTask = {
      id: "hf_dl_1",
      kind: "model",
      title: "Hugging Face Model",
      url: "https://huggingface.co/model.safetensors",
      targetPath: mockFilePath,
      category: "checkpoint",
      sourceName: "huggingface",
      licenseName: "apache-2.0",
      expectedSha256: null,
      actualSha256: null,
      totalBytes: 5000,
      downloadedBytes: 5000,
      speedBytesPerSec: 0,
      etaSeconds: null,
      status: "completed",
      error: null,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };

    const cancelledTask: DownloadTask = {
      ...completedTask,
      id: "hf_dl_2",
      status: "cancelled",
    };

    const activeTask: DownloadTask = {
      ...completedTask,
      id: "hf_dl_3",
      status: "downloading",
    };

    (manager as any).tasks.set(completedTask.id, completedTask);
    (manager as any).tasks.set(cancelledTask.id, cancelledTask);
    (manager as any).tasks.set(activeTask.id, activeTask);

    expect(manager.listDownloads().length).toBe(3);

    const cleared = manager.clearCompleted();
    expect(cleared).toBe(2);

    const remaining = manager.listDownloads();
    expect(remaining.length).toBe(1);
    expect(remaining[0]?.id).toBe("hf_dl_3");

    // The physical file on disk must NOT have been deleted
    expect(fs.existsSync(mockFilePath)).toBe(true);
    expect(fs.readFileSync(mockFilePath, "utf8")).toBe("generic model data");

    // Verified calls to repository
    expect(mockRepo.clearCompletedDownloads).toHaveBeenCalled();
    expect(deletedIds).toContain("hf_dl_1");
    expect(deletedIds).toContain("hf_dl_2");
  });
});
