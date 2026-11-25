import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudioDatabase } from "../../src/main/db/database";
import { StudioRepository } from "../../src/main/db/repositories";
import { detectHardwareStats, getDiskFreeGBMap } from "../../src/main/hardware/gpu-detector";
import type { StudioPaths } from "../../src/main/paths";
import {
  reconcileInterruptedTrainingJobs,
  TrainingManager,
} from "../../src/main/training/training-manager";
import type {
  CharacterTrainingConfig,
  CharacterTrainingJob,
} from "../../src/shared/types";

const processMocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: processMocks.spawn,
  execFile: processMocks.execFile,
}));

vi.mock("../../src/main/hardware/gpu-detector", () => ({
  detectHardwareStats: vi.fn(),
  getDiskFreeGBMap: vi.fn(),
}));

class FakeChild extends EventEmitter {
  readonly pid = 4242;
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kill = vi.fn((_signal?: NodeJS.Signals) => true);
}

const GPU_STATS = {
  available: true,
  name: "Fixture GPU",
  driverVersion: "1",
  cudaVersion: "12",
  vramTotalMB: 16384,
  vramFreeMB: 12000,
  vramUsedMB: 4384,
  systemRamTotalMB: 32768,
  systemRamFreeMB: 16384,
  diskFreeGB: { "C:\\": 100 },
  recommendedMaxBatch: 1,
  advisories: [],
};

const nativeExistsSync = fs.existsSync.bind(fs);
const originalPython = process.env.KIREA_TRAINING_PYTHON;
const originalResourcesDescriptor = Object.getOwnPropertyDescriptor(
  process,
  "resourcesPath"
);

function writeSafetensors(filePath: string, tensorName = "lora_unet.test"): void {
  const header = Buffer.from(
    JSON.stringify({
      [tensorName]: { dtype: "F32", shape: [1], data_offsets: [0, 4] },
    })
  );
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(header.length));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.concat([length, header, Buffer.alloc(4)]));
}

describe("TrainingManager integrity", () => {
  let root: string;
  let db: StudioDatabase;
  let repo: StudioRepository;
  let manager: TrainingManager;
  let characterId: string;
  let checkpointPath: string;
  let adapterPath: string;
  let sdScriptsPath: string;
  let pythonPath: string;
  let children: FakeChild[];
  let emitEvent: (channel: string, payload: unknown) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    root = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-training-integrity-"));
    children = [];
    emitEvent = vi.fn();
    db = new StudioDatabase(":memory:");
    repo = new StudioRepository(db);

    const modelsDir = path.join(root, "models");
    const charactersDir = path.join(root, "characters");
    const paths: StudioPaths = {
      userDataDir: root,
      dbPath: path.join(root, "studio.db"),
      logsDir: path.join(root, "logs"),
      cacheDir: path.join(root, "cache"),
      tempDir: path.join(root, "temp"),
      defaultOutputDir: path.join(root, "outputs"),
      defaultDownloadsDir: path.join(root, "downloads"),
      defaultManagedRuntimeDir: path.join(root, "runtime"),
      defaultManagedModelsDir: modelsDir,
      inputUploadCacheDir: path.join(root, "inputs"),
      modelPreviewCacheDir: path.join(root, "previews"),
      charactersDir,
      pixelAssetsDir: path.join(root, "pixel-assets"),
      pixelExportsDir: path.join(root, "pixel-exports"),
      pixelAiTempDir: path.join(root, "pixel-ai-temp"),
    };
    fs.mkdirSync(modelsDir, { recursive: true });
    fs.mkdirSync(charactersDir, { recursive: true });

    adapterPath = path.join(root, "external/training/sd_scripts_adapter.py");
    sdScriptsPath = path.join(root, "external/sd-scripts/sdxl_train_network.py");
    pythonPath = path.join(root, "python.exe");
    checkpointPath = path.join(root, "base.safetensors");
    fs.mkdirSync(path.dirname(adapterPath), { recursive: true });
    fs.mkdirSync(path.dirname(sdScriptsPath), { recursive: true });
    fs.writeFileSync(adapterPath, "# real sd-scripts adapter fixture\n");
    fs.writeFileSync(sdScriptsPath, "# sd-scripts entry point fixture\n");
    fs.writeFileSync(pythonPath, "python fixture");
    writeSafetensors(checkpointPath, "model.diffusion_model.test");

    const character = repo.saveCharacter({
      name: "Aria",
      description: "Training fixture",
      triggerWords: ["kirea_aria"],
      checkpointPath,
    });
    characterId = character.id;
    for (const id of ["approved-1", "approved-2"]) {
      const filePath = path.join(root, `${id}.png`);
      fs.writeFileSync(filePath, "image fixture");
      repo.addCharacterReference({
        characterId,
        filePath,
        approvalStatus: "approved",
        includedInTraining: true,
      });
    }

    vi.spyOn(process, "cwd").mockReturnValue(root);
    vi.spyOn(fs, "existsSync").mockImplementation((candidate) => {
      const resolved = path.resolve(String(candidate));
      return resolved.startsWith(`${root}${path.sep}`)
        ? nativeExistsSync(resolved)
        : false;
    });
    Object.defineProperty(process, "resourcesPath", {
      configurable: true,
      value: path.join(root, "resources"),
    });
    process.env.KIREA_TRAINING_PYTHON = pythonPath;

    vi.mocked(detectHardwareStats).mockResolvedValue(GPU_STATS);
    vi.mocked(getDiskFreeGBMap).mockResolvedValue({ [path.parse(root).root]: 100 });
    processMocks.execFile.mockImplementation(
      (_command: string, _args: string[], _options: unknown, callback: Function) => {
        callback(null, "2.5.1+cu124\n", "");
      }
    );
    processMocks.spawn.mockImplementation(() => {
      const child = new FakeChild();
      children.push(child);
      return child;
    });

    manager = new TrainingManager(
      repo,
      paths,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
      emitEvent
    );
  });

  afterEach(() => {
    (manager as any).dispose?.();
    for (const child of children) {
      child.stdout.destroy();
      child.stderr.destroy();
    }
    vi.restoreAllMocks();
    if (originalResourcesDescriptor) {
      Object.defineProperty(process, "resourcesPath", originalResourcesDescriptor);
    } else {
      delete (process as any).resourcesPath;
    }
    if (originalPython === undefined) {
      delete process.env.KIREA_TRAINING_PYTHON;
    } else {
      process.env.KIREA_TRAINING_PYTHON = originalPython;
    }
    db.close();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  function config(overrides: Partial<CharacterTrainingConfig> = {}): CharacterTrainingConfig {
    return {
      baseModelFamily: "illustrious",
      baseCheckpointPath: checkpointPath,
      triggerToken: "kirea_aria",
      rank: 16,
      alpha: 16,
      learningRate: 0.0001,
      epochs: 2,
      batchSize: 1,
      resolution: 1024,
      gradientAccumulationSteps: 2,
      gradientCheckpointing: true,
      precision: "bf16",
      saveEveryNEpochs: 1,
      ...overrides,
    };
  }

  async function startJob(overrides: Partial<CharacterTrainingConfig> = {}) {
    const job = await manager.startTraining(characterId, config(overrides));
    return { job, child: children[children.length - 1]! };
  }

  async function emitJson(child: FakeChild, payload: Record<string, unknown>) {
    child.stdout.write(`${JSON.stringify(payload)}\n`);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  function persistedJob(
    id: string,
    status: CharacterTrainingJob["status"]
  ): CharacterTrainingJob {
    return {
      id,
      characterId,
      baseModelFamily: "illustrious",
      status,
      progressStep: 0,
      progressMax: 2,
      logsText: "",
      config: config(),
      submittedAt: new Date().toISOString(),
    };
  }

  it("accepts the real adapter and sd-scripts with a bounded torch import check", async () => {
    const result = await manager.preflightTraining(characterId, config());

    expect(result.ready).toBe(true);
    expect(result.backendAvailable).toBe(true);
    expect(result.pythonPath).toBe(pythonPath);
    expect(result.torchVersion).toBe("2.5.1+cu124");
    expect(processMocks.execFile).toHaveBeenCalledWith(
      pythonPath,
      ["-c", expect.stringContaining("import torch")],
      expect.objectContaining({ timeout: expect.any(Number), windowsHide: true }),
      expect.any(Function)
    );
    expect(processMocks.spawn).not.toHaveBeenCalled();
  });

  it("rejects a synthetic trainer when the real adapter is absent", async () => {
    fs.rmSync(adapterPath);
    fs.writeFileSync(
      path.join(path.dirname(adapterPath), "train_lora.py"),
      "# synthetic fallback\n"
    );

    const result = await manager.preflightTraining(characterId, config());

    expect(result.ready).toBe(false);
    expect(result.blockers.join(" ")).toContain("adapter");
    expect(processMocks.spawn).not.toHaveBeenCalled();
  });

  it("requires the sd-scripts SDXL training entry point", async () => {
    fs.rmSync(sdScriptsPath);

    const result = await manager.preflightTraining(characterId, config());

    expect(result.ready).toBe(false);
    expect(result.blockers.join(" ")).toContain("sdxl_train_network.py");
  });

  it("fails preflight when the selected Python cannot import torch", async () => {
    processMocks.execFile.mockImplementation(
      (_command: string, _args: string[], _options: unknown, callback: Function) => {
        callback(new Error("torch import failed"), "", "No module named torch");
      }
    );

    const result = await manager.preflightTraining(characterId, config());

    expect(result.ready).toBe(false);
    expect(result.backendAvailable).toBe(false);
    expect(result.torchVersion).toBeNull();
    expect(result.blockers.join(" ")).toContain("PyTorch");
  });

  it("requires an explicit character or config checkpoint", async () => {
    repo.saveCharacter({
      id: characterId,
      name: "Aria",
      checkpointPath: null,
    });

    const result = await manager.preflightTraining(characterId);

    expect(result.modelAvailable).toBe(false);
    expect(result.modelPath).toBeNull();
    expect(result.blockers.join(" ")).toContain("checkpoint must be configured");
  });

  it("reserves the training slot before the first await", async () => {
    let releasePreflight!: (stats: typeof GPU_STATS) => void;
    const preflightGate = new Promise<typeof GPU_STATS>((resolve) => {
      releasePreflight = resolve;
    });
    vi.mocked(detectHardwareStats).mockReturnValueOnce(preflightGate);

    const first = manager.startTraining(characterId, config());
    const second = manager.startTraining(characterId, config());
    try {
      await expect(second).rejects.toThrow(/already/i);
      expect(processMocks.spawn).not.toHaveBeenCalled();
    } finally {
      releasePreflight(GPU_STATS);
      await first;
      children[children.length - 1]!.emit("close", 1);
    }
    expect(processMocks.spawn).toHaveBeenCalledTimes(1);
  });

  it("keeps a cancelled job reserved until its process closes", async () => {
    const { job, child } = await startJob();

    expect(manager.cancelTraining(job.id)).toBe(true);
    expect(repo.getTrainingJob(job.id)?.status).toBe("CANCELLED");
    await expect(manager.startTraining(characterId, config())).rejects.toThrow(
      /already/i
    );

    child.emit("close", 0);
    const next = await startJob();
    next.child.emit("close", 1);
    expect(processMocks.spawn).toHaveBeenCalledTimes(2);
  });

  it.skipIf(process.platform !== "win32")(
    "terminates the Windows process tree on cancellation",
    async () => {
      const { job, child } = await startJob();

      expect(manager.cancelTraining(job.id)).toBe(true);
      expect(processMocks.execFile).toHaveBeenCalledWith(
        "taskkill",
        ["/PID", String(child.pid), "/T", "/F"],
        expect.objectContaining({ timeout: expect.any(Number), windowsHide: true }),
        expect.any(Function)
      );
      child.emit("close", 0);
    }
  );

  it("releases the reservation after preflight failure", async () => {
    fs.rmSync(adapterPath);
    await expect(manager.startTraining(characterId, config())).rejects.toThrow(
      /adapter/i
    );
    fs.writeFileSync(adapterPath, "# real sd-scripts adapter fixture\n");

    const { child } = await startJob();
    child.emit("close", 1);
    expect(processMocks.spawn).toHaveBeenCalledTimes(1);
  });

  it("releases the reservation after dataset export failure", async () => {
    vi.spyOn(fs.promises, "copyFile").mockRejectedValueOnce(
      new Error("dataset copy failed")
    );
    await expect(manager.startTraining(characterId, config())).rejects.toThrow(
      /dataset copy failed/
    );

    const { child } = await startJob();
    child.emit("close", 1);
    expect(processMocks.spawn).toHaveBeenCalledTimes(1);
  });

  it("persists failure and releases the reservation when spawning throws", async () => {
    processMocks.spawn.mockImplementationOnce(() => {
      throw new Error("spawn failed");
    });

    await expect(manager.startTraining(characterId, config())).rejects.toThrow(
      /spawn failed/
    );
    const failedJob = repo.listTrainingJobs(characterId)[0]!;
    expect(failedJob.status).toBe("FAILED");
    expect(failedJob.errorMessage).toContain("spawn failed");

    const { child } = await startJob();
    child.emit("close", 1);
    expect(processMocks.spawn).toHaveBeenCalledTimes(2);
  });

  it("disposes active training and rejects later starts", async () => {
    const { job, child } = await startJob();

    manager.dispose();

    expect(repo.getTrainingJob(job.id)?.status).toBe("FAILED");
    expect(repo.getTrainingJob(job.id)?.errorMessage).toMatch(/shutdown/i);
    expect(processMocks.execFile).toHaveBeenCalledWith(
      "taskkill",
      ["/PID", String(child.pid), "/T", "/F"],
      expect.any(Object),
      expect.any(Function)
    );
    await expect(manager.startTraining(characterId, config())).rejects.toThrow(
      /disposed|shutdown/i
    );
    child.emit("close", 0);
  });

  it("forwards accumulation, checkpointing, cadence, precision, and safe output settings", async () => {
    const outputDirectory = path.join(root, "models", "custom-loras");
    const { child } = await startJob({
      gradientAccumulationSteps: 4,
      gradientCheckpointing: false,
      saveEveryNEpochs: 3,
      precision: "fp32",
      outputDirectory,
    });
    const args = processMocks.spawn.mock.calls[0]![1] as string[];
    const valueAfter = (flag: string) => args[args.indexOf(flag) + 1];

    expect(valueAfter("--gradient_accumulation_steps")).toBe("4");
    expect(valueAfter("--gradient_checkpointing")).toBe("false");
    expect(valueAfter("--save_every_n_epochs")).toBe("3");
    expect(valueAfter("--precision")).toBe("fp32");
    expect(valueAfter("--output_dir")).toBe(path.resolve(outputDirectory));
    child.emit("close", 1);
  });

  it("sanitizes character-derived output names and directories", async () => {
    repo.saveCharacter({
      id: characterId,
      name: "../../Escape Hero",
      checkpointPath,
    });

    const { job, child } = await startJob();
    const args = processMocks.spawn.mock.calls[0]![1] as string[];

    expect(args[args.indexOf("--output_name") + 1]).toBe(
      "escape_hero_illustrious_lora"
    );
    expect(job.outputAdapterPath).toBe(
      path.join(root, "models", "loras", "characters", "escape_hero", "escape_hero_illustrious_lora.safetensors")
    );
    child.emit("close", 1);
  });

  it("rejects output directories outside managed models and releases the slot", async () => {
    await expect(
      manager.startTraining(
        characterId,
        config({ outputDirectory: path.join(root, "escape") })
      )
    ).rejects.toThrow(/managed models directory/i);

    const { child } = await startJob();
    child.emit("close", 1);
    expect(processMocks.spawn).toHaveBeenCalledTimes(1);
  });

  it("registers an adapter only after a valid contained safetensors completion", async () => {
    const { job, child } = await startJob();
    const outputPath = job.outputAdapterPath!;
    writeSafetensors(outputPath, "lora_unet.test");

    await emitJson(child, { type: "completed", output_path: outputPath });

    expect(repo.getTrainingJob(job.id)?.status).toBe("COMPLETED");
    expect(repo.listAdapters(characterId)).toHaveLength(1);
    expect(repo.listAdapters(characterId)[0]?.fileLocation).toBe(outputPath);
    child.emit("close", 0);
  });

  it("rejects completed output outside the approved directory", async () => {
    const { job, child } = await startJob();
    const outsidePath = path.join(root, "escape.safetensors");
    writeSafetensors(outsidePath);

    await emitJson(child, { type: "completed", output_path: outsidePath });

    expect(repo.getTrainingJob(job.id)?.status).toBe("FAILED");
    expect(repo.getTrainingJob(job.id)?.errorMessage).toMatch(/outside/i);
    expect(repo.listAdapters(characterId)).toHaveLength(0);
    child.emit("close", 0);
    expect(repo.getTrainingJob(job.id)?.status).toBe("FAILED");
  });

  it.each([
    ["empty", (filePath: string) => fs.writeFileSync(filePath, "")],
    ["invalid JSON header", (filePath: string) => fs.writeFileSync(filePath, "not safetensors")],
  ])("rejects %s safetensors output", async (_label, writeInvalid) => {
    const { job, child } = await startJob();
    writeInvalid(job.outputAdapterPath!);

    await emitJson(child, {
      type: "completed",
      output_path: job.outputAdapterPath,
    });

    expect(repo.getTrainingJob(job.id)?.status).toBe("FAILED");
    expect(repo.listAdapters(characterId)).toHaveLength(0);
    child.emit("close", 0);
  });

  it("fails a zero-exit process that never reports validated completion", async () => {
    const { job, child } = await startJob();

    child.emit("close", 0);

    expect(repo.getTrainingJob(job.id)?.status).toBe("FAILED");
    expect(repo.getTrainingJob(job.id)?.errorMessage).toMatch(/validated completion/i);
    expect(repo.listAdapters(characterId)).toHaveLength(0);
  });

  it("ignores late completion messages after cancellation", async () => {
    const { job, child } = await startJob();
    writeSafetensors(job.outputAdapterPath!);
    expect(manager.cancelTraining(job.id)).toBe(true);

    await emitJson(child, {
      type: "completed",
      output_path: job.outputAdapterPath,
    });

    expect(repo.getTrainingJob(job.id)?.status).toBe("CANCELLED");
    expect(repo.listAdapters(characterId)).toHaveLength(0);
    child.emit("close", 0);
  });

  it("reconciles persisted running and queued jobs to failed", () => {
    repo.saveTrainingJob(persistedJob("job-running", "RUNNING"));
    repo.saveTrainingJob(persistedJob("job-queued", "QUEUED"));
    repo.saveTrainingJob(persistedJob("job-completed", "COMPLETED"));
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;

    const reconciled = reconcileInterruptedTrainingJobs(repo, logger);

    expect(reconciled).toBe(2);
    expect(repo.getTrainingJob("job-running")?.status).toBe("FAILED");
    expect(repo.getTrainingJob("job-queued")?.status).toBe("FAILED");
    expect(repo.getTrainingJob("job-running")?.errorMessage).toMatch(/restart/i);
    expect(repo.getTrainingJob("job-completed")?.status).toBe("COMPLETED");
  });
});
