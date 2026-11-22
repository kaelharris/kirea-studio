import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { StudioDatabase } from "../../src/main/db/database";
import { MIGRATIONS } from "../../src/main/db/migrations";
import { StudioRepository } from "../../src/main/db/repositories";
import { imageWorkflowLabels } from "../../src/shared/image-labels";
import type { GeneratedImageRecord, GenerationJob } from "../../src/shared/types";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-provenance-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

function makeJob(
  id: string,
  mode: GenerationJob["mode"],
  workflowId: string,
  inputImagePath: string | null
): GenerationJob {
  return {
    id,
    promptId: `prompt_${id}`,
    status: "COMPLETED",
    errorKind: "NONE",
    errorMessage: null,
    prompt: `${workflowId} prompt`,
    negativePrompt: "",
    checkpoint: "model.safetensors",
    workflowId,
    workflowVersion: "1.0.0",
    mode,
    settings: {
      workflowId,
      mode,
      prompt: `${workflowId} prompt`,
      negativePrompt: "",
      checkpoint: "model.safetensors",
      vae: null,
      loras: [],
      aspectRatio: "1:1",
      width: 1024,
      height: 1024,
      steps: 20,
      cfg: 4,
      sampler: "euler",
      scheduler: "simple",
      seed: 42,
      randomSeed: false,
      batchCount: 1,
      batchSize: 1,
      outputFormat: "png",
      inputImagePath,
      denoise: 1,
    },
    progressStep: 20,
    progressMax: 20,
    currentNode: null,
    previewDataUrl: null,
    outputPaths: [],
    submittedAt: "2026-11-17T10:00:00.000Z",
    startedAt: "2026-11-17T10:00:01.000Z",
    completedAt: "2026-11-17T10:00:05.000Z",
    batchIndex: 1,
    batchTotal: 1,
  };
}

function makeImage(
  id: string,
  job: GenerationJob,
  sourceImagePath: string | null
): GeneratedImageRecord {
  return {
    id,
    jobId: job.id,
    filePath: `C:\\cache\\${id}.png`,
    fileName: `${id}.png`,
    format: "png",
    width: 1024,
    height: 1024,
    sizeBytes: 1,
    prompt: job.prompt,
    negativePrompt: "",
    seed: job.settings.seed,
    checkpoint: job.checkpoint,
    loras: [],
    workflowId: job.workflowId,
    sampler: job.settings.sampler,
    scheduler: job.settings.scheduler,
    steps: job.settings.steps,
    cfg: job.settings.cfg,
    denoise: job.settings.denoise,
    mode: job.mode,
    favorite: false,
    tags: [],
    collectionId: null,
    createdAt: job.completedAt ?? job.submittedAt,
    sourceImagePath,
  };
}

describe("image operation lineage", () => {
  it("keeps Txt2Img, Upscaled and Image Edited labels across restart", () => {
    const dir = makeTempDir();
    const dbPath = path.join(dir, "studio.db");
    let db = new StudioDatabase(dbPath);
    let repo = new StudioRepository(db);

    const rootJob = makeJob("job_root", "txt2img", "t2i_moss_image", null);
    const root = makeImage("img_root", rootJob, null);
    repo.recordCompletedGenerationTx(rootJob, [root], null);

    const upscaleJob = makeJob(
      "job_upscale",
      "upscale",
      "upscale_model_v1",
      root.filePath
    );
    const upscaled = makeImage("img_upscaled", upscaleJob, root.filePath);
    repo.recordCompletedGenerationTx(upscaleJob, [upscaled], null);

    const editJob = makeJob(
      "job_edit",
      "img2img",
      "i2i_moss_image_edit",
      upscaled.filePath
    );
    const edited = makeImage("img_edited", editJob, upscaled.filePath);
    repo.recordCompletedGenerationTx(editJob, [edited], null);

    const editedRecord = repo.getImageById("img_edited");
    expect(editedRecord?.parentImageId).toBe("img_upscaled");
    expect(editedRecord?.operations?.map((operation) => operation.operation)).toEqual([
      "moss_image",
      "upscale",
      "image_edit",
    ]);
    expect(editedRecord?.operations?.map((operation) => operation.sequence)).toEqual([
      0, 1, 2,
    ]);
    expect(
      imageWorkflowLabels(editedRecord!).map((label) => label.label)
    ).toEqual(["MOSS-Image", "Upscaled", "Image Edited"]);

    const rootRecord = repo.getImageById("img_root");
    expect(rootRecord?.workflowId).toBe("t2i_moss_image");
    expect(rootRecord?.mode).toBe("txt2img");
    expect(rootRecord?.parentImageId).toBeNull();

    db.close();
    db = new StudioDatabase(dbPath);
    repo = new StudioRepository(db);
    const restored = repo.getImageById("img_edited");
    expect(
      imageWorkflowLabels(restored!).map((label) => label.label)
    ).toEqual(["MOSS-Image", "Upscaled", "Image Edited"]);
    expect(restored?.operations?.[2]?.parameters).toMatchObject({
      workflowId: "i2i_moss_image_edit",
      inputImagePath: upscaled.filePath,
    });
    db.close();
  });

  it("backfills lineage for images created before schema v11", () => {
    const dir = makeTempDir();
    const dbPath = path.join(dir, "studio.db");
    const rootPath = "C:\\cache\\legacy_root.png";
    const childPath = "C:\\cache\\legacy_upscaled.png";
    const now = "2026-11-16T10:00:00.000Z";

    const raw = new Database(dbPath);
    raw.pragma("foreign_keys = OFF");
    raw.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
    for (const migration of MIGRATIONS.filter((entry) => entry.version <= 10)) {
      migration.up(raw);
      raw
        .prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)")
        .run(migration.version, migration.name, now);
    }

    const insertJob = raw.prepare(
      `INSERT INTO generation_jobs (
        id, prompt_id, status, prompt, negative_prompt, checkpoint, workflow_id,
        workflow_version, mode, settings_json, submitted_at
      ) VALUES (?, ?, 'COMPLETED', ?, '', ?, ?, '1.0.0', ?, ?, ?)`
    );
    insertJob.run(
      "job_legacy_root",
      "prompt_legacy_root",
      "legacy prompt",
      "moss.safetensors",
      "t2i_moss_image",
      "txt2img",
      JSON.stringify({ workflowId: "t2i_moss_image", inputImagePath: null }),
      now
    );
    insertJob.run(
      "job_legacy_upscale",
      "prompt_legacy_upscale",
      "legacy prompt",
      "moss.safetensors",
      "upscale_model_v1",
      "upscale",
      JSON.stringify({ workflowId: "upscale_model_v1", inputImagePath: rootPath }),
      now
    );

    const insertImage = raw.prepare(
      `INSERT INTO generated_images (
        id, job_id, file_path, file_name, format, width, height, size_bytes,
        prompt, seed, checkpoint, workflow_id, sampler, scheduler, steps, cfg,
        mode, created_at
      ) VALUES (?, ?, ?, ?, 'png', 1024, 1024, 1, 'legacy prompt', 7,
        'moss.safetensors', ?, 'euler', 'simple', 20, 4, ?, ?)`
    );
    insertImage.run(
      "img_legacy_root",
      "job_legacy_root",
      rootPath,
      "legacy_root.png",
      "t2i_moss_image",
      "txt2img",
      now
    );
    insertImage.run(
      "img_legacy_upscaled",
      "job_legacy_upscale",
      childPath,
      "legacy_upscaled.png",
      "upscale_model_v1",
      "upscale",
      now
    );
    raw.close();

    const db = new StudioDatabase(dbPath);
    const repo = new StudioRepository(db);
    const restored = repo.getImageById("img_legacy_upscaled");
    expect(restored?.parentImageId).toBe("img_legacy_root");
    expect(restored?.operations?.map((operation) => operation.operation)).toEqual([
      "moss_image",
      "upscale",
    ]);
    expect(
      imageWorkflowLabels(restored!).map((label) => label.label)
    ).toEqual(["MOSS-Image", "Upscaled"]);
    db.close();
  });
});
