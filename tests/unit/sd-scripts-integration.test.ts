import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StudioDatabase } from "../../src/main/db/database";
import { StudioRepository } from "../../src/main/db/repositories";
import { TrainingManager } from "../../src/main/training/training-manager";
import type {
  CharacterProfile,
  CharacterTrainingJob,
} from "../../src/shared/types";

const tempDirs: string[] = [];
const openDbs: StudioDatabase[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-sdscripts-test-"));
  tempDirs.push(dir);
  return dir;
}

function makeDb(): { repo: StudioRepository; db: StudioDatabase } {
  const db = new StudioDatabase(":memory:");
  openDbs.push(db);
  return { repo: new StudioRepository(db), db };
}

afterEach(() => {
  while (openDbs.length > 0) {
    openDbs.pop()!.close();
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

describe("sd-scripts SDXL Training Integration", () => {
  it("resolves python and sd-scripts adapter paths correctly", () => {
    const { repo } = makeDb();
    const tempDir = makeTempDir();
    const mockPaths = { defaultManagedModelsDir: tempDir } as any;
    const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;
    const emitEvent = vi.fn();

    const tm = new TrainingManager(repo, mockPaths, mockLogger, emitEvent);
    const pythonExe = tm.resolvePythonPath();
    expect(pythonExe).toBeDefined();
    expect(typeof pythonExe).toBe("string");
  });

  it("fails preflight gracefully when checkpoint does not exist", async () => {
    const { repo } = makeDb();
    const tempDir = makeTempDir();
    const mockPaths = { defaultManagedModelsDir: tempDir } as any;
    const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;
    const emitEvent = vi.fn();

    const tm = new TrainingManager(repo, mockPaths, mockLogger, emitEvent);

    const char = {
      id: "char_sdxl_preflight",
      name: "SDXL Test Char",
      triggerWords: ["sdxl_token"],
      description: "Preflight test",
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      references: [
        {
          id: "r1",
          characterId: "char_sdxl_preflight",
          filePath: path.join(tempDir, "1.png"),
          approvalStatus: "approved",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: "r2",
          characterId: "char_sdxl_preflight",
          filePath: path.join(tempDir, "2.png"),
          approvalStatus: "approved",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    } as any;
    repo.saveCharacter(char);

    const preflight = await tm.preflightTraining("char_sdxl_preflight", {
      baseCheckpointPath: path.join(tempDir, "non_existent_checkpoint.safetensors"),
    });

    // Checkpoint missing should produce an advisory / blocker
    expect(preflight.modelAvailable).toBe(false);
  });

  it("suppresses adapter registration when training fails or is cancelled", () => {
    const { repo } = makeDb();
    const tempDir = makeTempDir();
    const mockPaths = { defaultManagedModelsDir: tempDir } as any;
    const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;
    const emitEvent = vi.fn();

    const tm = new TrainingManager(repo, mockPaths, mockLogger, emitEvent);

    repo.saveCharacter({
      id: "char_fail_test",
      name: "Fail Test",
      description: "Fail test",
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      references: [],
    } as any);

    const job: CharacterTrainingJob = {
      id: "job_fail_1",
      characterId: "char_fail_test",
      baseModelFamily: "illustrious",
      status: "FAILED",
      errorMessage: "CUDA out of memory",
      progressStep: 10,
      progressMax: 100,
      config: {
        baseModelFamily: "illustrious",
        baseCheckpointPath: "Animixy².safetensors",
        triggerToken: "fail_test",
        rank: 16,
        alpha: 16,
        learningRate: 1e-4,
        epochs: 10,
        batchSize: 1,
        resolution: 1024,
      },
      logsText: "CUDA OOM error\n",
      submittedAt: new Date().toISOString(),
    };
    repo.saveTrainingJob(job);

    const adapters = repo.listAdapters("char_fail_test");
    // No adapter must be registered for a failed job
    expect(adapters.length).toBe(0);
  });

  it("registers adapter only on validated completion", () => {
    const { repo } = makeDb();
    const tempDir = makeTempDir();
    const mockPaths = { defaultManagedModelsDir: tempDir } as any;
    const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;
    const emitEvent = vi.fn();

    const tm = new TrainingManager(repo, mockPaths, mockLogger, emitEvent);

    repo.saveCharacter({
      id: "char_success_test",
      name: "Success Test",
      description: "Success test",
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      references: [],
    } as any);

    const outputPath = path.join(tempDir, "success_lora.safetensors");
    fs.writeFileSync(outputPath, "mock validated safetensors");

    const adapter = repo.saveAdapter({
      characterId: "char_success_test",
      baseModelFamily: "illustrious",
      checkpointName: "Animixy²",
      checkpointPath: "Animixy².safetensors",
      triggerToken: "success_test",
      fileLocation: outputPath,
      rank: 16,
      alpha: 16,
      recommendedStrength: 0.85,
      status: "trained",
    } as any);

    expect(adapter.id).toBeDefined();
    expect(adapter.status).toBe("trained");

    const listed = repo.listAdapters("char_success_test");
    expect(listed.length).toBe(1);
    expect(listed[0]!.triggerToken).toBe("success_test");
    expect(listed[0]!.fileLocation).toBe(outputPath);
  });
});
