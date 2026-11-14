import { describe, expect, it } from "vitest";
import { StudioDatabase } from "../../src/main/db/database";
import { StudioRepository } from "../../src/main/db/repositories";
import { WORKFLOW_TEMPLATES } from "../../src/main/comfy/workflow-registry";
import type {
  GeneratedImageRecord,
  GenerationJob,
} from "../../src/shared/types";

const NOW = "2026-11-11T10:00:00.000Z";

function makeJob(id: string, overrides: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id,
    promptId: `prompt_${id}`,
    status: "COMPLETED",
    errorKind: "NONE",
    errorMessage: null,
    prompt: "cliff walk",
    negativePrompt: "lowres",
    checkpoint: "SDXL/base.safetensors",
    workflowId: "t2i_sdxl_base",
    workflowVersion: "1.0.0",
    mode: "txt2img",
    settings: {
      workflowId: "t2i_sdxl_base",
      mode: "txt2img",
      prompt: "cliff walk",
      negativePrompt: "lowres",
      checkpoint: "SDXL/base.safetensors",
      vae: null,
      loras: [],
      aspectRatio: "1:1",
      width: 1024,
      height: 1024,
      steps: 24,
      cfg: 6.5,
      sampler: "dpmpp_2m",
      scheduler: "karras",
      seed: 123,
      randomSeed: false,
      batchCount: 1,
      batchSize: 1,
      outputFormat: "png",
      inputImagePath: null,
      denoise: 1,
    },
    progressStep: 24,
    progressMax: 24,
    currentNode: null,
    previewDataUrl: null,
    outputPaths: [],
    submittedAt: NOW,
    startedAt: NOW,
    completedAt: NOW,
    batchIndex: 1,
    batchTotal: 1,
    ...overrides,
  };
}

function makeImage(
  id: string,
  job: GenerationJob,
  overrides: Partial<GeneratedImageRecord> = {}
): GeneratedImageRecord {
  return {
    id,
    jobId: job.id,
    filePath: `C:\\out\\${id}.png`,
    fileName: `${id}.png`,
    format: "png",
    width: 1024,
    height: 1024,
    sizeBytes: 1024,
    prompt: job.prompt,
    negativePrompt: job.negativePrompt,
    seed: 123,
    checkpoint: job.checkpoint,
    loras: [],
    workflowId: job.workflowId,
    sampler: "dpmpp_2m",
    scheduler: "karras",
    steps: 24,
    cfg: 6.5,
    denoise: 1,
    mode: "txt2img",
    favorite: false,
    tags: [],
    collectionId: null,
    createdAt: NOW,
    storyId: job.storyId ?? null,
    storySceneId: job.storySceneId ?? null,
    ...overrides,
  };
}

function makeRepo() {
  const db = new StudioDatabase(":memory:");
  const repo = new StudioRepository(db);
  repo.upsertWorkflowMetadata(WORKFLOW_TEMPLATES);
  return { db, repo };
}

describe("Canvas repository", () => {
  it("creates canvases with defaults and canonical page dimensions", () => {
    const { db, repo } = makeRepo();
    const story = repo.saveStory({ title: "Lantern" });

    const canvas = repo.saveCanvas({ storyId: story.id, name: "Storyboard" });
    expect(canvas.template).toBe("grid_2x3");
    expect(canvas.pageSize).toBe("a4_landscape");
    expect(canvas.pageWidth).toBe(1123);
    expect(canvas.pageHeight).toBe(794);
    expect(canvas.margin).toBe(32);
    expect(canvas.gutter).toBe(16);
    expect(canvas.background).toBe("#0B0B0F");
    expect(canvas.captionMode).toBe("scene_title");
    expect(canvas.items).toEqual([]);

    expect(() =>
      repo.saveCanvas({ storyId: story.id, name: "Storyboard" })
    ).toThrow(/already exists/);

    const custom = repo.saveCanvas({
      storyId: story.id,
      name: "Custom",
      template: "filmstrip",
      pageSize: "custom",
      pageWidth: 900,
      pageHeight: 700,
      margin: 999,
      gutter: -5,
      captionMode: "synopsis",
      settings: { bleed: false },
    });
    expect(custom.pageWidth).toBe(900);
    expect(custom.pageHeight).toBe(700);
    expect(custom.margin).toBe(240);
    expect(custom.gutter).toBe(0);
    expect(custom.captionMode).toBe("synopsis");
    expect(custom.settings).toEqual({ bleed: false });

    const renamed = repo.saveCanvas({
      id: custom.id,
      storyId: story.id,
      name: "Custom board",
      template: custom.template,
    });
    expect(renamed.createdAt).toBe(custom.createdAt);
    expect(renamed.settings).toEqual({ bleed: false });
    expect(repo.listCanvases(story.id)).toHaveLength(2);
    db.close();
  });

  it("persists panels with overlays and clamps normalized geometry", () => {
    const { db, repo } = makeRepo();
    const story = repo.saveStory({ title: "Panels" });
    const withScene = repo.saveStoryScene({
      storyId: story.id,
      title: "Opening",
      prompt: "cliff walk",
    });
    const scene = withScene.scenes[0]!;
    const canvas = repo.saveCanvas({ storyId: story.id, name: "Storyboard" });

    const saved = repo.saveCanvasItem({
      canvasId: canvas.id,
      sceneId: scene.id,
      fit: "contain",
      captionOverride: "Beat one",
      x: 1.4,
      y: -1,
      width: 0.5,
      height: 2,
      overlays: [
        {
          id: "ov_1",
          kind: "speech",
          speaker: "Mira",
          text: "Hold the light.",
          x: 0.25,
          y: 0.75,
        },
      ],
    });

    expect(saved.items).toHaveLength(1);
    const item = saved.items[0]!;
    expect(item.sceneId).toBe(scene.id);
    expect(item.fit).toBe("contain");
    expect(item.captionOverride).toBe("Beat one");
    expect(item.x).toBe(1);
    expect(item.y).toBe(0);
    expect(item.width).toBe(0.5);
    expect(item.height).toBe(1);
    expect(item.overlays).toEqual([
      {
        id: "ov_1",
        kind: "speech",
        speaker: "Mira",
        text: "Hold the light.",
        x: 0.25,
        y: 0.75,
      },
    ]);

    const updated = repo.saveCanvasItem({
      id: item.id,
      canvasId: canvas.id,
      captionOverride: "Beat two",
    });
    expect(updated.items[0]?.captionOverride).toBe("Beat two");
    expect(updated.items[0]?.fit).toBe("contain");
    expect(updated.items[0]?.overlays[0]?.text).toBe("Hold the light.");

    const cleared = repo.saveCanvasItem({
      id: item.id,
      canvasId: canvas.id,
      overlays: [],
    });
    expect(cleared.items[0]?.overlays).toEqual([]);
    db.close();
  });

  it("reorders and deletes panels while reindexing positions", () => {
    const { db, repo } = makeRepo();
    const story = repo.saveStory({ title: "Order" });
    const canvas = repo.saveCanvas({ storyId: story.id, name: "Board" });

    const withA = repo.saveCanvasItem({ canvasId: canvas.id, captionOverride: "A" });
    const withB = repo.saveCanvasItem({ canvasId: canvas.id, captionOverride: "B" });
    const withC = repo.saveCanvasItem({ canvasId: canvas.id, captionOverride: "C" });
    const [a, b, c] = withC.items;
    expect(withA.items).toHaveLength(1);
    expect(withB.items).toHaveLength(2);
    expect(withC.items.map((item) => item.position)).toEqual([0, 1, 2]);

    const reordered = repo.reorderCanvasItems(canvas.id, [c!.id, a!.id, b!.id]);
    expect(reordered?.items.map((item) => item.captionOverride)).toEqual([
      "C",
      "A",
      "B",
    ]);
    expect(reordered?.items.map((item) => item.position)).toEqual([0, 1, 2]);

    const afterDelete = repo.deleteCanvasItem(canvas.id, a!.id);
    expect(afterDelete?.items.map((item) => item.captionOverride)).toEqual([
      "C",
      "B",
    ]);
    expect(afterDelete?.items.map((item) => item.position)).toEqual([0, 1]);
    expect(repo.deleteCanvasItem(canvas.id, "missing")).toBeNull();
    db.close();
  });

  it("syncs scenes while preserving panel styling and dropping orphans", () => {
    const { db, repo } = makeRepo();
    const story = repo.saveStory({ title: "Sync" });
    const withA = repo.saveStoryScene({
      storyId: story.id,
      title: "A",
      synopsis: "First",
    });
    const withB = repo.saveStoryScene({
      storyId: story.id,
      title: "B",
      synopsis: "Second",
    });
    const withC = repo.saveStoryScene({
      storyId: story.id,
      title: "C",
      synopsis: "Third",
    });
    const sceneA = withA.scenes[0]!;
    const sceneB = withB.scenes[1]!;
    const sceneC = withC.scenes[2]!;

    const jobA = makeJob("job_a", { storyId: story.id, storySceneId: sceneA.id });
    repo.recordCompletedGenerationTx(jobA, [makeImage("img_a", jobA)], null);
    const jobB = makeJob("job_b", { storyId: story.id, storySceneId: sceneB.id });
    repo.recordCompletedGenerationTx(jobB, [makeImage("img_b", jobB)], null);

    const canvas = repo.saveCanvas({ storyId: story.id, name: "Sync board" });
    const synced = repo.syncCanvasFromStory(canvas.id);
    expect(synced?.items.map((item) => item.sceneId)).toEqual([
      sceneA.id,
      sceneB.id,
      sceneC.id,
    ]);
    expect(synced?.items.map((item) => item.imageId)).toEqual([
      "img_a",
      "img_b",
      null,
    ]);

    const panelB = synced!.items[1]!;
    repo.saveCanvasItem({
      id: panelB.id,
      canvasId: canvas.id,
      fit: "contain",
      captionOverride: "Custom B",
      overlays: [
        { id: "ov_b", kind: "narration", text: "Rain.", x: 0.5, y: 0.1 },
      ],
    });
    repo.saveCanvasItem({ canvasId: canvas.id, captionOverride: "Loose panel" });

    repo.reorderStoryScenes(story.id, [sceneC.id, sceneA.id, sceneB.id]);
    const afterReorder = repo.syncCanvasFromStory(canvas.id);
    expect(afterReorder?.items.map((item) => item.sceneId)).toEqual([
      sceneC.id,
      sceneA.id,
      sceneB.id,
    ]);
    const preserved = afterReorder!.items[2]!;
    expect(preserved.fit).toBe("contain");
    expect(preserved.captionOverride).toBe("Custom B");
    expect(preserved.overlays[0]?.text).toBe("Rain.");
    expect(
      afterReorder?.items.some((item) => item.captionOverride === "Loose panel")
    ).toBe(false);

    repo.deleteStoryScene(story.id, sceneC.id);
    const afterRemove = repo.syncCanvasFromStory(canvas.id);
    expect(afterRemove?.items.map((item) => item.sceneId)).toEqual([
      sceneA.id,
      sceneB.id,
    ]);
    expect(repo.syncCanvasFromStory("missing")).toBeNull();
    db.close();
  });

  it("records export history and clears story links on cascade delete", () => {
    const { db, repo } = makeRepo();
    const story = repo.saveStory({ title: "Exports" });
    const canvas = repo.saveCanvas({ storyId: story.id, name: "Board" });

    const record = repo.recordStoryExport({
      storyId: story.id,
      canvasId: canvas.id,
      kind: "png",
      filePath: "C:\\Pictures\\Kirea Studio\\Stories\\exports\\board-01.png",
      width: 1123,
      height: 794,
      pageCount: 2,
      sizeBytes: 4096,
      settings: { pageIndex: 0, template: "grid_2x3" },
    });
    expect(record.kind).toBe("png");
    expect(record.pageCount).toBe(2);
    expect(record.settings).toEqual({ pageIndex: 0, template: "grid_2x3" });
    expect(repo.listStoryExports(story.id)).toHaveLength(1);
    expect(repo.listStoryExports()).toHaveLength(1);

    repo.deleteStory(story.id);
    expect(repo.listCanvases(story.id)).toEqual([]);
    const survivors = repo.listStoryExports();
    expect(survivors).toHaveLength(1);
    expect(survivors[0]?.storyId).toBeNull();
    expect(survivors[0]?.canvasId).toBeNull();
    db.close();
  });
});
