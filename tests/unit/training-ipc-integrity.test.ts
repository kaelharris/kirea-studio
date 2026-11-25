import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudioDatabase } from "../../src/main/db/database";
import { StudioRepository } from "../../src/main/db/repositories";
import type { StudioPaths } from "../../src/main/paths";
import { IPC_CHANNELS } from "../../src/shared/ipc-channels";

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => os.tmpdir()) },
  dialog: {},
  shell: {},
  BrowserWindow: class BrowserWindow {},
}));

import {
  registerStoriesHandlers,
  shutdownTraining,
} from "../../src/main/ipc/handlers/stories-handlers";
import type { HandlerContext } from "../../src/main/ipc/schemas";

type Handler = (event: unknown, ...args: any[]) => any;

describe("training IPC path containment and lifecycle", () => {
  let root: string;
  let paths: StudioPaths;
  let db: StudioDatabase;
  let repo: StudioRepository;
  let characterId: string;
  let handlers: Map<string, Handler>;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-training-ipc-"));
    paths = {
      userDataDir: root,
      dbPath: path.join(root, "studio.db"),
      logsDir: path.join(root, "logs"),
      cacheDir: path.join(root, "cache"),
      tempDir: path.join(root, "temp"),
      defaultOutputDir: path.join(root, "outputs"),
      defaultDownloadsDir: path.join(root, "downloads"),
      defaultManagedRuntimeDir: path.join(root, "runtime"),
      defaultManagedModelsDir: path.join(root, "models"),
      inputUploadCacheDir: path.join(root, "inputs"),
      modelPreviewCacheDir: path.join(root, "previews"),
      charactersDir: path.join(root, "characters"),
      pixelAssetsDir: path.join(root, "pixel-assets"),
      pixelExportsDir: path.join(root, "pixel-exports"),
      pixelAiTempDir: path.join(root, "pixel-ai-temp"),
    };
    fs.mkdirSync(paths.charactersDir, { recursive: true });
    fs.mkdirSync(paths.defaultOutputDir, { recursive: true });
    db = new StudioDatabase(":memory:");
    repo = new StudioRepository(db);
    const character = repo.saveCharacter({ name: "Aria" });
    characterId = character.id;

    for (const [id, approvalStatus] of [
      ["approved", "approved"],
      ["pending", "pending"],
    ] as const) {
      const filePath = path.join(root, `${id}.png`);
      fs.writeFileSync(filePath, "image fixture");
      repo.addCharacterReference({
        characterId,
        filePath,
        approvalStatus,
        includedInTraining: true,
      });
    }

    handlers = new Map();
    const context = {
      paths,
      repo,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      getSettings: () => ({ outputDirectory: paths.defaultOutputDir }),
      getMainWindow: () => null,
    } as unknown as HandlerContext;
    registerStoriesHandlers(context, (channel, fn) => {
      handlers.set(channel, fn as Handler);
    });
  });

  afterEach(() => {
    shutdownTraining();
    db.close();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it.each([
    ["an unrelated absolute directory", () => path.join(root, "escape")],
    ["a traversal out of the character root", () => path.join(paths.charactersDir, "..", "escape")],
  ])("rejects dataset export to %s", async (_label, destination) => {
    const exportDataset = handlers.get(IPC_CHANNELS.CHARACTERS_EXPORT_DATASET)!;
    const target = destination();

    await expect(exportDataset({}, characterId, target)).rejects.toThrow(
      /outside|authorized/i
    );
    expect(fs.existsSync(target)).toBe(false);
  });

  it("exports only approved references into an authorized directory", async () => {
    const exportDataset = handlers.get(IPC_CHANNELS.CHARACTERS_EXPORT_DATASET)!;
    const destination = path.join(paths.charactersDir, characterId, "dataset_export");

    const result = await exportDataset({}, characterId, destination);

    expect(result).toEqual({
      success: true,
      exportPath: path.resolve(destination),
      count: 1,
    });
    const dataset = repo.listDatasets(characterId)[0]!;
    expect(dataset.items.map((item) => item.referenceId)).toHaveLength(1);
    expect(dataset.items[0]?.selected).toBe(true);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(destination, "dataset_manifest.json"), "utf8")
    );
    expect(manifest).toHaveLength(1);
  });

  it("disposes the registered training manager on shutdown", async () => {
    shutdownTraining();
    const startTraining = handlers.get(IPC_CHANNELS.CHARACTERS_START_TRAINING)!;

    await expect(
      startTraining({}, characterId, {
        baseModelFamily: "illustrious",
        baseCheckpointPath: path.join(root, "base.safetensors"),
        triggerToken: "kirea_aria",
        rank: 16,
        alpha: 16,
        learningRate: 0.0001,
        epochs: 2,
        batchSize: 1,
        resolution: 1024,
      })
    ).rejects.toThrow(/disposed|shutdown/i);
  });

  it("wires startup reconciliation and shutdown disposal in the main process", () => {
    const source = fs.readFileSync(path.resolve("src/main/index.ts"), "utf8");

    expect(source).toContain("reconcileInterruptedTrainingJobs(repo, logger)");
    expect(source).toContain("shutdownTraining()");
  });
});
