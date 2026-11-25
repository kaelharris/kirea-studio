import { describe, expect, it, vi } from "vitest";
import { JobOrchestrator } from "../../src/main/jobs/job-orchestrator";
import type { GenerationJob, GenerationRequest } from "../../src/shared/types";

function createTestOrchestrator(overrides: { deleteJob?: any; deleteJobs?: any } = {}) {
  const mockRepo = {
    listJobs: () => [],
    upsertJob: vi.fn(),
    hasOutputsForJob: vi.fn(() => false),
    deleteJob: overrides.deleteJob ?? vi.fn((id: string) => id !== "non-existent"),
    deleteJobs: overrides.deleteJobs ?? vi.fn((ids: string[]) => ids.length),
  } as any;
  const mockWs = { on: vi.fn() };
  const mockApi = {
    interrupt: vi.fn().mockResolvedValue({}),
    deleteQueueItems: vi.fn().mockResolvedValue({}),
  };
  const mockRuntime = {
    getState: () => ({ status: "connected" }),
    getApiClient: () => mockApi,
    getWsClient: () => mockWs,
  } as any;
  const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;

  const orchestrator = new JobOrchestrator(
    mockRepo,
    mockRuntime,
    () => ({} as any),
    () => [],
    () => 16384,
    mockLogger
  );

  return { orchestrator, mockRepo, mockApi };
}

function makeJob(partial: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id: partial.id ?? "job-test",
    promptId: partial.promptId ?? null,
    status: partial.status ?? "RUNNING",
    errorKind: partial.errorKind ?? "NONE",
    errorMessage: partial.errorMessage ?? null,
    prompt: partial.prompt ?? "Test generation",
    negativePrompt: partial.negativePrompt ?? "",
    checkpoint: partial.checkpoint ?? "illustrious.safetensors",
    workflowId: partial.workflowId ?? "t2i_illustrious_base",
    workflowVersion: partial.workflowVersion ?? "1.0",
    mode: partial.mode ?? "txt2img",
    settings: partial.settings ?? ({} as GenerationRequest),
    progressStep: partial.progressStep ?? 0,
    progressMax: partial.progressMax ?? 20,
    currentNode: partial.currentNode ?? null,
    previewDataUrl: partial.previewDataUrl ?? null,
    outputPaths: partial.outputPaths ?? [],
    submittedAt: partial.submittedAt ?? new Date().toISOString(),
    startedAt: partial.startedAt ?? null,
    completedAt: partial.completedAt ?? null,
    batchIndex: partial.batchIndex ?? 1,
    batchTotal: partial.batchTotal ?? 1,
  };
}

describe("JobOrchestrator.deleteJob", () => {
  it("returns false for non-existent job id", () => {
    const { orchestrator } = createTestOrchestrator();
    expect(orchestrator.deleteJob("non-existent")).toBe(false);
  });

  it("deletes a failed or completed job cleanly and emits jobDeleted, calling SQLite repo", () => {
    const { orchestrator, mockRepo } = createTestOrchestrator();

    const testJob: GenerationJob = {
      id: "job-fail-123",
      promptId: "prompt-1",
      status: "FAILED",
      errorKind: "SUBMISSION_FAILED",
      errorMessage: "ComfyUI POST /prompt failed (400)",
      prompt: "A neon cyborg warrior",
      negativePrompt: "blurry",
      checkpoint: "illustrious.safetensors",
      workflowId: "txt2img",
      workflowVersion: "1.0",
      mode: "txt2img",
      settings: {} as GenerationRequest,
      progressStep: 0,
      progressMax: 20,
      currentNode: null,
      previewDataUrl: null,
      outputPaths: [],
      submittedAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      batchIndex: 0,
      batchTotal: 1,
    };

    // Inject job into internal map
    (orchestrator as any).jobs.set(testJob.id, testJob);
    expect(orchestrator.listJobs().length).toBe(1);

    const deleteSpy = vi.fn();
    orchestrator.on("jobDeleted", deleteSpy);

    const deleted = orchestrator.deleteJob(testJob.id);
    expect(deleted).toBe(true);
    expect(deleteSpy).toHaveBeenCalledWith("job-fail-123");
    expect(mockRepo.deleteJob).toHaveBeenCalledWith("job-fail-123");
    expect(orchestrator.listJobs().length).toBe(0);
    expect((orchestrator as any).jobs.has(testJob.id)).toBe(false);
  });

  it("removes queued pending job from pendingIds on delete", () => {
    const { orchestrator } = createTestOrchestrator();

    const testJob: GenerationJob = {
      id: "job-pending-456",
      promptId: null,
      status: "QUEUED",
      errorKind: "NONE",
      errorMessage: null,
      prompt: "Pending generation",
      negativePrompt: "",
      checkpoint: "flux.safetensors",
      workflowId: "txt2img",
      workflowVersion: "1.0",
      mode: "txt2img",
      settings: {} as GenerationRequest,
      progressStep: 0,
      progressMax: 20,
      currentNode: null,
      previewDataUrl: null,
      outputPaths: [],
      submittedAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      batchIndex: 0,
      batchTotal: 1,
    };

    (orchestrator as any).jobs.set(testJob.id, testJob);
    (orchestrator as any).pendingIds.push(testJob.id);

    expect((orchestrator as any).pendingIds.includes(testJob.id)).toBe(true);

    const deleted = orchestrator.deleteJob(testJob.id);
    expect(deleted).toBe(true);
    expect((orchestrator as any).pendingIds.includes(testJob.id)).toBe(false);
    expect(orchestrator.listJobs().length).toBe(0);
  });

  it("supports batch delete of multiple jobs via deleteJobs and calls repo.deleteJobs", () => {
    const { orchestrator, mockRepo } = createTestOrchestrator();

    const job1: GenerationJob = {
      id: "job-batch-1",
      promptId: "prompt-1",
      status: "FAILED",
      errorKind: "UNKNOWN",
      errorMessage: "Timed out",
      prompt: "Prompt 1",
      negativePrompt: "",
      checkpoint: "sdxl.safetensors",
      workflowId: "txt2img",
      workflowVersion: "1.0",
      mode: "txt2img",
      settings: {} as GenerationRequest,
      progressStep: 0,
      progressMax: 20,
      currentNode: null,
      previewDataUrl: null,
      outputPaths: [],
      submittedAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      batchIndex: 0,
      batchTotal: 1,
    };

    const job2: GenerationJob = {
      ...job1,
      id: "job-batch-2",
      prompt: "Prompt 2",
    };

    (orchestrator as any).jobs.set(job1.id, job1);
    (orchestrator as any).jobs.set(job2.id, job2);
    expect(orchestrator.listJobs().length).toBe(2);

    const deletedCount = orchestrator.deleteJobs([job1.id, job2.id]);
    expect(deletedCount).toBe(2);
    expect(mockRepo.deleteJobs).toHaveBeenCalledWith([job1.id, job2.id]);
    expect(orchestrator.listJobs().length).toBe(0);
  });

  it("cancels an active job before deleting it and blocks the asynchronous cancellation write", async () => {
    const { orchestrator, mockRepo, mockApi } = createTestOrchestrator();
    const job = makeJob({ id: "job-active-delete", promptId: "prompt-active-delete" });
    const order: string[] = [];
    const cancelled = makeJob({
      ...job,
      status: "CANCELLED",
      errorKind: "CANCELLED",
      errorMessage: "Cancelled by user.",
    });

    (orchestrator as any).jobs.set(job.id, job);
    (orchestrator as any).activeJobId = job.id;
    (orchestrator as any).activePromptId = job.promptId;
    const rejectWaiter = vi.fn(() => {
      (orchestrator as any).activeWaiter = null;
      (orchestrator as any).commitJob(cancelled);
    });
    (orchestrator as any).activeWaiter = {
      resolve: vi.fn(),
      reject: rejectWaiter,
    };
    mockApi.interrupt.mockImplementation(async () => {
      order.push("cancel");
      return {};
    });
    mockRepo.deleteJob.mockImplementation(() => {
      order.push("delete");
      return true;
    });
    orchestrator.on("jobDeleted", () => order.push("deleted-event"));

    expect(orchestrator.deleteJob(job.id)).toBe(true);
    expect(order[0]).toBe("cancel");
    await vi.waitFor(() => expect(rejectWaiter).toHaveBeenCalled());

    expect(mockRepo.upsertJob).not.toHaveBeenCalledWith(cancelled);
    expect(orchestrator.listJobs()).toEqual([]);
    expect(order).toEqual(["cancel", "delete", "deleted-event"]);
  });

  it("does not let late completion or failure commits recreate a deleted job", () => {
    const { orchestrator, mockRepo } = createTestOrchestrator();
    const job = makeJob({ id: "job-late-completion" });
    (orchestrator as any).jobs.set(job.id, job);

    expect(orchestrator.deleteJob(job.id)).toBe(true);
    const writesAfterDelete = mockRepo.upsertJob.mock.calls.length;

    (orchestrator as any).commitJob({
      ...job,
      status: "COMPLETED",
      outputPaths: ["C:/art/late.png"],
      completedAt: new Date().toISOString(),
    });
    (orchestrator as any).commitJob({
      ...job,
      status: "FAILED",
      errorKind: "RUNTIME_CRASH",
      errorMessage: "Late failure",
    });

    expect(orchestrator.listJobs()).toEqual([]);
    expect(mockRepo.upsertJob).toHaveBeenCalledTimes(writesAfterDelete);
  });

  it("returns and emits only actual bulk removals for partial and duplicate requests", () => {
    const { orchestrator, mockRepo } = createTestOrchestrator({
      deleteJobs: vi.fn(() => 1),
    });
    const job = makeJob({ id: "job-bulk-existing", status: "FAILED" });
    (orchestrator as any).jobs.set(job.id, job);
    const deleted = vi.fn();
    orchestrator.on("jobDeleted", deleted);

    expect(orchestrator.deleteJobs([job.id, "job-bulk-missing", job.id])).toBe(1);
    expect(deleted).toHaveBeenCalledTimes(1);
    expect(deleted).toHaveBeenCalledWith(job.id);
    expect(orchestrator.listJobs()).toEqual([]);
  });
});
