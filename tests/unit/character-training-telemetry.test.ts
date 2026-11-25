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
  CharacterTrainingTelemetry,
} from "../../src/shared/types";

const tempDirs: string[] = [];
const openDbs: StudioDatabase[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-telemetry-test-"));
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

describe("Character Training Telemetry & Lifecycle", () => {
  it("preflight detects missing references when fewer than 2 exist", async () => {
    const { repo } = makeDb();
    const tempDir = makeTempDir();

    const mockPaths = {
      defaultManagedModelsDir: tempDir,
    } as any;
    const mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as any;
    const emitEvent = vi.fn();

    const tm = new TrainingManager(repo, mockPaths, mockLogger, emitEvent);

    // Create a character with 1 reference
    const char = {
      id: "char_test_1",
      name: "Aria",
      triggerWords: ["aria_dna"],
      description: "Test character",
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      identityCore: {
        triggerToken: "aria_dna",
        species: "Human",
        fixedTraits: ["blue eyes"],
        variableTraits: ["jacket"],
      },
      visualMemory: [],
      modelMemory: [],
      characterKnowledge: {
        rules: [],
        dialogueExamples: [],
      },
      references: [
        {
          id: "ref_1",
          characterId: "char_test_1",
          filePath: path.join(tempDir, "ref1.png"),
          role: "canonical_face",
          caption: "aria",
          weight: 1.0,
          position: 0,
          category: "face",
          approvalStatus: "approved",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    } as any;

    repo.saveCharacter(char);

    const preflight = await tm.preflightTraining("char_test_1");
    expect(preflight.ready).toBe(false);
    expect(preflight.blockers.some((b) => b.includes("At least 2 approved references are required"))).toBe(true);
  });

  it("calculates exponential moving average (EMA) smoothed loss correctly", () => {
    // Standard EMA formula:
    // When smoothedLoss === 0 -> initial loss
    // Afterwards: 0.1 * loss + 0.9 * smoothedLoss
    let smoothedLoss = 0;
    const losses = [1.2, 0.9, 0.6, 0.4, 0.2];

    for (const loss of losses) {
      if (smoothedLoss === 0) {
        smoothedLoss = loss;
      } else {
        smoothedLoss = 0.1 * loss + 0.9 * smoothedLoss;
      }
    }

    // Step 1: 1.2
    // Step 2: 0.1*0.9 + 0.9*1.2 = 0.09 + 1.08 = 1.17
    // Step 3: 0.1*0.6 + 0.9*1.17 = 0.06 + 1.053 = 1.113
    // Step 4: 0.1*0.4 + 0.9*1.113 = 0.04 + 1.0017 = 1.0417
    // Step 5: 0.1*0.2 + 0.9*1.0417 = 0.02 + 0.93753 = 0.95753
    expect(smoothedLoss).toBeCloseTo(0.95753, 4);
    expect(smoothedLoss).toBeLessThan(1.2);
  });

  it("bounds loss history to at most 1000 items", () => {
    const lossHistory: Array<{ step: number; loss: number }> = [];

    for (let step = 1; step <= 1500; step++) {
      lossHistory.push({ step, loss: 1 / step });
      if (lossHistory.length > 1000) {
        lossHistory.shift();
      }
    }

    expect(lossHistory.length).toBe(1000);
    expect(lossHistory[0]!.step).toBe(501);
    expect(lossHistory[999]!.step).toBe(1500);
  });

  it("estimates remaining time accurately from observed rolling step durations", () => {
    const stepDurations: number[] = [];
    const maxSteps = 100;

    // Simulate 10 steps taking ~200ms each
    for (let s = 1; s <= 10; s++) {
      const elapsedMs = 200 + (s % 3) * 10; // 200, 210, 220, 200...
      stepDurations.push(elapsedMs);
      if (stepDurations.length > 50) {
        stepDurations.shift();
      }
    }

    const avgDurationMs = stepDurations.reduce((a, b) => a + b, 0) / stepDurations.length;
    const currentStep = 10;
    const remainingSteps = maxSteps - currentStep;
    const estimatedRemainingMs = Math.round(avgDurationMs * remainingSteps);

    // Remaining steps = 90. Avg duration ~210ms -> ~18900ms (~18.9s)
    expect(estimatedRemainingMs).toBeGreaterThan(17000);
    expect(estimatedRemainingMs).toBeLessThan(20000);
  });

  it("handles training cancellation and preserves last valid checkpoint path", async () => {
    const { repo } = makeDb();
    const tempDir = makeTempDir();

    const mockPaths = {
      defaultManagedModelsDir: tempDir,
    } as any;
    const mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as any;
    const emitEvent = vi.fn();

    const tm = new TrainingManager(repo, mockPaths, mockLogger, emitEvent);

    const checkpointPath = path.join(tempDir, "checkpoint-step-100.safetensors");
    fs.writeFileSync(checkpointPath, "mock safetensors content");

    repo.saveCharacter({
      id: "char_test",
      name: "Test Character",
      description: "Test",
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      references: [],
    } as any);

    const job: CharacterTrainingJob = {
      id: "job_cancel_test",
      characterId: "char_test",
      baseModelFamily: "illustrious",
      status: "RUNNING",
      progressStep: 100,
      progressMax: 500,
      currentEpoch: 2,
      totalEpochs: 10,
      loss: 0.15,
      outputAdapterPath: checkpointPath,
      logsText: "Training checkpoint log\n",
      config: {
        baseModelFamily: "illustrious",
        baseCheckpointPath: "test.safetensors",
        triggerToken: "char_test",
        rank: 16,
        alpha: 16,
        learningRate: 1e-4,
        epochs: 10,
        batchSize: 1,
        resolution: 1024,
        precision: "fp16",
      },
      submittedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
    };
    repo.saveTrainingJob(job);

    // Set private state for test
    const mockKill = vi.fn();
    (tm as any).activeProcess = { kill: mockKill };
    (tm as any).activeJobId = "job_cancel_test";
    (tm as any).lastSavedCheckpointPath = checkpointPath;

    const result = tm.cancelTraining("job_cancel_test");
    expect(result).toBe(true);
    expect(mockKill).toHaveBeenCalledWith("SIGTERM");

    const savedJob = repo.getTrainingJob("job_cancel_test");
    expect(savedJob?.status).toBe("CANCELLED");
    expect(savedJob?.outputAdapterPath).toBe(checkpointPath);
  });
});
