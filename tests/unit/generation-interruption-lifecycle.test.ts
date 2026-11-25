import { describe, expect, it, vi } from "vitest";
import { JobOrchestrator } from "../../src/main/jobs/job-orchestrator";
import { StudioDatabase } from "../../src/main/db/database";
import { StudioRepository } from "../../src/main/db/repositories";
import type { GenerationJob, GenerationRequest, ModelRecord } from "../../src/shared/types";

const mockModels: ModelRecord[] = [
  {
    id: "illustrious-xl",
    name: "illustrious-xl",
    relativePath: "illustrious-xl.safetensors",
    filePath: "C:/models/checkpoints/illustrious-xl.safetensors",
    sha256: "abc123hash",
    architecture: "illustrious",
    category: "checkpoint",
    sizeBytes: 1024 * 1024 * 1024,
    sourceRoot: "C:/models/checkpoints",
    isDuplicate: false,
    duplicateOf: null,
    isIncomplete: false,
    compatibleWorkflows: [],
    license: null,
    description: null,
    installed: true,
    lastSeenAt: new Date().toISOString(),
  },
];

function createHarness(options: {
  hasOutputs?: boolean;
  initialJobs?: GenerationJob[];
} = {}) {
  const { hasOutputs = false, initialJobs = [] } = options;

  let persistedJobs: GenerationJob[] = [...initialJobs];
  const upsertJobMock = vi.fn((job: GenerationJob) => {
    const existingIndex = persistedJobs.findIndex((j) => j.id === job.id);
    if (existingIndex >= 0) {
      // Invariant: completed status cannot be downgraded
      if (persistedJobs[existingIndex]!.status === "COMPLETED" && job.status !== "COMPLETED") {
        return;
      }
      persistedJobs[existingIndex] = { ...job };
    } else {
      persistedJobs.push({ ...job });
    }
  });

  const mockRepo = {
    listJobs: vi.fn(() => [...persistedJobs]),
    upsertJob: upsertJobMock,
    hasOutputsForJob: vi.fn((_jobId: string) => hasOutputs),
    deleteJob: vi.fn((jobId: string) => {
      persistedJobs = persistedJobs.filter((j) => j.id !== jobId);
      return jobId !== "non-existent";
    }),
    deleteJobs: vi.fn((jobIds: string[]) => {
      const initialLen = persistedJobs.length;
      persistedJobs = persistedJobs.filter((j) => !jobIds.includes(j.id));
      return initialLen - persistedJobs.length;
    }),
  } as any;

  let wsListeners: Record<string, ((...args: any[]) => void)[]> = {};
  const mockWs = {
    on: vi.fn((event: string, cb: (...args: any[]) => void) => {
      if (!wsListeners[event]) wsListeners[event] = [];
      wsListeners[event]!.push(cb);
    }),
  };

  const mockApiClient = {
    interrupt: vi.fn().mockResolvedValue({}),
    deleteQueueItems: vi.fn().mockResolvedValue({}),
    submitPrompt: vi.fn().mockResolvedValue({ prompt_id: "comfy-p-100", number: 1 }),
  };

  const mockRuntime = {
    getState: vi.fn(() => ({ status: "connected" })),
    getApiClient: vi.fn(() => mockApiClient),
    getWsClient: vi.fn(() => mockWs),
  } as any;

  const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;

  const orchestrator = new JobOrchestrator(
    mockRepo,
    mockRuntime,
    () => ({ performanceProfile: "balanced" } as any),
    () => mockModels,
    () => 16384,
    mockLogger
  );

  const getJob = (id: string): GenerationJob | undefined => {
    return orchestrator.listJobs().find((j) => j.id === id);
  };

  return {
    orchestrator,
    mockRepo,
    mockWs,
    mockApiClient,
    wsListeners,
    getJob,
    getPersistedJobs: () => persistedJobs,
  };
}

function makeJob(partial: Partial<GenerationJob> = {}): GenerationJob {
  const workflowId = partial.workflowId || "t2i_illustrious_base";
  const checkpoint = partial.checkpoint || "illustrious-xl.safetensors";
  const prompt = partial.prompt || "A cinematic anime masterpiece";
  const negativePrompt = partial.negativePrompt || "";

  return {
    id: partial.id || `job-${Math.random().toString(36).slice(2, 8)}`,
    promptId: partial.promptId ?? null,
    status: partial.status || "IDLE",
    errorKind: partial.errorKind || "NONE",
    errorMessage: partial.errorMessage ?? null,
    prompt,
    negativePrompt,
    checkpoint,
    workflowId,
    workflowVersion: partial.workflowVersion || "1.0",
    mode: partial.mode || "txt2img",
    settings: {
      workflowId,
      checkpoint,
      prompt,
      negativePrompt,
      width: 1024,
      height: 1024,
      steps: 28,
      cfg: 7,
      seed: -1,
      batchCount: 1,
      mode: "txt2img",
      loras: [],
      ...(partial.settings || {}),
    } as GenerationRequest,
    progressStep: partial.progressStep ?? 0,
    progressMax: partial.progressMax ?? 20,
    currentNode: partial.currentNode ?? null,
    previewDataUrl: partial.previewDataUrl ?? null,
    outputPaths: partial.outputPaths || [],
    submittedAt: partial.submittedAt || new Date().toISOString(),
    startedAt: partial.startedAt ?? null,
    completedAt: partial.completedAt ?? null,
    batchIndex: partial.batchIndex ?? 0,
    batchTotal: partial.batchTotal ?? 1,
    startupInterrupted: partial.startupInterrupted,
  };
}

describe("Generation Interruption & Recovery Lifecycle", () => {
  it("persists startupInterrupted through a real repository round trip", () => {
    const db = new StudioDatabase(":memory:");
    try {
      const repo = new StudioRepository(db);
      const interrupted = makeJob({
        id: "job-persisted-interruption",
        status: "FAILED",
        errorKind: "CANCELLED",
        errorMessage: "Interrupted when application previously closed.",
        startupInterrupted: true,
      });

      repo.upsertJob(interrupted);

      expect(repo.getJobById(interrupted.id)?.startupInterrupted).toBe(true);
      expect(repo.listJobs().find((job) => job.id === interrupted.id)?.startupInterrupted).toBe(true);
    } finally {
      db.close();
    }
  });

  it.each(["FAILED", "CANCELLED"] as const)(
    "does not reconcile a terminal %s job to COMPLETED merely because outputs exist",
    (status) => {
      const terminal = makeJob({
        id: `job-terminal-${status.toLowerCase()}`,
        status,
        errorKind: "CANCELLED",
        errorMessage: "Interrupted when application previously closed.",
        startupInterrupted: true,
      });
      const { getJob, mockRepo } = createHarness({
        hasOutputs: true,
        initialJobs: [terminal],
      });

      expect(getJob(terminal.id)?.status).toBe(status);
      expect(getJob(terminal.id)?.startupInterrupted).toBe(true);
      expect(mockRepo.upsertJob).not.toHaveBeenCalled();
    }
  );

  // Scenario 1: Generation completes successfully and the app remains open
  it("Scenario 1: Generation completes successfully and remains COMPLETED", () => {
    const { orchestrator, getJob } = createHarness();
    const job = makeJob({ id: "job-scen-1", status: "PROCESSING_OUTPUT" });
    (orchestrator as any).jobs.set(job.id, job);

    (orchestrator as any).commitJob({
      ...job,
      status: "COMPLETED",
      outputPaths: ["C:/art/test.png"],
      completedAt: new Date().toISOString(),
    });

    const stored = getJob(job.id);
    expect(stored?.status).toBe("COMPLETED");
    expect(stored?.outputPaths).toEqual(["C:/art/test.png"]);
    expect(stored?.errorKind).toBe("NONE");
    expect(stored?.errorMessage).toBeNull();
  });

  // Scenario 2: Generation completes successfully immediately before application shutdown
  it("Scenario 2: Successful job status is protected during prepareShutdown", () => {
    const { orchestrator, getJob } = createHarness();
    const job = makeJob({
      id: "job-scen-2",
      status: "COMPLETED",
      outputPaths: ["C:/art/hero.png"],
      completedAt: new Date().toISOString(),
    });
    (orchestrator as any).jobs.set(job.id, job);

    // Call prepareShutdown before close
    orchestrator.prepareShutdown();

    // Verify it was NOT altered to CANCELLED or FAILED
    const stored = getJob(job.id);
    expect(stored?.status).toBe("COMPLETED");
    expect(stored?.errorMessage).toBeNull();
  });

  // Scenario 3: ComfyUI finishes generation but late progress/executing events arrive
  it("Scenario 3: Late progress and executing events cannot overwrite COMPLETED or PROCESSING_OUTPUT jobs", () => {
    const { orchestrator, wsListeners, getJob } = createHarness();
    const job = makeJob({
      id: "job-scen-3",
      promptId: "prompt-late-3",
      status: "COMPLETED",
      outputPaths: ["C:/art/completed.png"],
    });
    (orchestrator as any).jobs.set(job.id, job);
    (orchestrator as any).activePromptId = null;

    // Simulate late ComfyUI WebSocket progress event arriving after completion
    const progressHandlers = wsListeners["progress"] || [];
    for (const handler of progressHandlers) {
      handler({
        prompt_id: "prompt-late-3",
        node: "3",
        value: 15,
        max: 20,
      });
    }

    // Verify job status was not downgraded to RUNNING
    const stored = getJob(job.id);
    expect(stored?.status).toBe("COMPLETED");
    expect(stored?.errorKind).toBe("NONE");
  });

  // Scenario 4: Application exits while generation is genuinely running (no auto-resubmit)
  it("Scenario 4: Genuinely running job on exit is marked interrupted with startupInterrupted=true and NOT auto-resubmitted", () => {
    const runningJob = makeJob({
      id: "job-scen-4",
      status: "RUNNING",
      promptId: "prompt-interrupted-4",
    });

    const { orchestrator, mockApiClient, getJob } = createHarness({
      hasOutputs: false,
      initialJobs: [runningJob],
    });

    // Run startup reconciliation
    (orchestrator as any).reconcileInterruptedJobsOnStartup();

    const stored = getJob(runningJob.id);
    expect(stored?.status).toBe("FAILED");
    expect(stored?.errorKind).toBe("CANCELLED");
    expect(stored?.startupInterrupted).toBe(true);
    expect(stored?.errorMessage).toContain("Interrupted when application previously closed");

    // CRITICAL: Ensure NO automatic resubmission / queueing happened
    expect(mockApiClient.submitPrompt).not.toHaveBeenCalled();
    expect((orchestrator as any).pendingIds.length).toBe(0);
  });

  // Scenario 5: Application starts with an old interrupted job
  it("Scenario 5: Old interrupted job preserves status in history and has startupInterrupted flag set", () => {
    const staleJob = makeJob({
      id: "job-scen-5",
      status: "SUBMITTING",
    });

    const { orchestrator, getJob } = createHarness({
      hasOutputs: false,
      initialJobs: [staleJob],
    });

    (orchestrator as any).reconcileInterruptedJobsOnStartup();

    const stored = getJob(staleJob.id);
    expect(stored?.status).toBe("FAILED");
    expect(stored?.startupInterrupted).toBe(true);
  });

  // Scenario 6: Application starts with a previously completed job
  it("Scenario 6: Previously completed job remains COMPLETED during startup reconciliation", () => {
    const completedJob = makeJob({
      id: "job-scen-6",
      status: "COMPLETED",
      outputPaths: ["C:/art/photo.png"],
    });

    const { orchestrator, getJob } = createHarness({
      hasOutputs: true,
      initialJobs: [completedJob],
    });

    (orchestrator as any).reconcileInterruptedJobsOnStartup();

    const stored = getJob(completedJob.id);
    expect(stored?.status).toBe("COMPLETED");
    expect(stored?.errorKind).toBe("NONE");
    expect(stored?.errorMessage).toBeNull();
  });

  // Scenario 7: Successful generation with outputs in DB followed by stale recovery logic
  it("Scenario 7: Job with outputs registered in DB is reconciled as COMPLETED even if status in job table was RUNNING", () => {
    const jobWithOutputs = makeJob({
      id: "job-scen-7",
      status: "RUNNING", // e.g. crash happened right after image write before job status commit
      prompt: "Epic fantasy castle",
    });

    const { orchestrator, getJob } = createHarness({
      hasOutputs: true, // Repo has records in generated_images
      initialJobs: [jobWithOutputs],
    });

    (orchestrator as any).reconcileInterruptedJobsOnStartup();

    const stored = getJob(jobWithOutputs.id);
    expect(stored?.status).toBe("COMPLETED");
    expect(stored?.errorKind).toBe("NONE");
    expect(stored?.errorMessage).toBeNull();
  });

  // Scenario 8: Explicit manual retry of a genuinely failed job
  it("Scenario 8: User can explicitly retry a failed job, re-queueing it", async () => {
    const failedJob = makeJob({
      id: "job-scen-8",
      status: "FAILED",
      errorKind: "CANCELLED",
      errorMessage: "Interrupted when application previously closed.",
      startupInterrupted: true,
    });

    const { orchestrator, getJob } = createHarness({
      hasOutputs: false,
      initialJobs: [failedJob],
    });

    (orchestrator as any).jobs.set(failedJob.id, failedJob);

    const reQueuedJobs = await orchestrator.retryJob(failedJob.id);
    expect(reQueuedJobs.length).toBeGreaterThan(0);
    const reQueued = reQueuedJobs[0]!;
    expect(["IDLE", "QUEUED"]).toContain(reQueued.status);
    expect(reQueued.errorKind).toBe("NONE");
    expect(reQueued.errorMessage).toBeNull();
    expect(reQueued.startupInterrupted).toBeUndefined();
    expect((orchestrator as any).jobs.has(reQueued.id)).toBe(true);
  });

  // Scenario 9: Individual and bulk deletion permanently removes records from SQLite without touching library images
  it("Scenario 9: Single and bulk job deletions remove records from SQLite permanently", () => {
    const jobA = makeJob({ id: "job-del-A", status: "FAILED" });
    const jobB = makeJob({ id: "job-del-B", status: "FAILED" });
    const jobC = makeJob({ id: "job-del-C", status: "COMPLETED", outputPaths: ["C:/art/c.png"] });

    const { orchestrator, mockRepo, getJob } = createHarness({
      initialJobs: [jobA, jobB, jobC],
    });

    (orchestrator as any).jobs.set(jobA.id, jobA);
    (orchestrator as any).jobs.set(jobB.id, jobB);
    (orchestrator as any).jobs.set(jobC.id, jobC);

    // Single delete of jobA
    const deletedA = orchestrator.deleteJob(jobA.id);
    expect(deletedA).toBe(true);
    expect(mockRepo.deleteJob).toHaveBeenCalledWith("job-del-A");
    expect(getJob(jobA.id)).toBeUndefined();

    // Bulk delete of jobB and jobC
    const deletedCount = orchestrator.deleteJobs([jobB.id, jobC.id]);
    expect(deletedCount).toBe(2);
    expect(mockRepo.deleteJobs).toHaveBeenCalledWith(["job-del-B", "job-del-C"]);
    expect(getJob(jobB.id)).toBeUndefined();
    expect(getJob(jobC.id)).toBeUndefined();
  });

  // Critical Acceptance Test
  it("Critical Acceptance Test: Successful generation followed by application restart never shows false interruption notification", () => {
    const successfulJob = makeJob({
      id: "job-crit-accept-1",
      status: "COMPLETED",
      prompt: "Masterpiece portrait with golden illumination",
      outputPaths: ["C:/Users/Harris/Pictures/Kirea/masterpiece.png"],
    });

    const { orchestrator, getJob } = createHarness({
      hasOutputs: true,
      initialJobs: [successfulJob],
    });

    // Simulate reboot: startup reconciliation runs
    (orchestrator as any).reconcileInterruptedJobsOnStartup();

    const jobAfterRestart = getJob(successfulJob.id);
    expect(jobAfterRestart?.status).toBe("COMPLETED");
    expect(jobAfterRestart?.errorMessage).toBeNull();
    expect(jobAfterRestart?.startupInterrupted).toBeFalsy();
    expect(jobAfterRestart?.errorKind).toBe("NONE");
  });
});
