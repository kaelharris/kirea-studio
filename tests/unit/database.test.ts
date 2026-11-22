import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { StudioDatabase } from "../../src/main/db/database";
import { StudioRepository } from "../../src/main/db/repositories";
import { MIGRATIONS } from "../../src/main/db/migrations";
import { WORKFLOW_TEMPLATES } from "../../src/main/comfy/workflow-registry";
import type {
  AppSettings,
  GenerationJob,
  ModelRecord,
} from "../../src/shared/types";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-db-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

const TEST_DEFAULT_SETTINGS: AppSettings = {
  runtimeMode: "external",
  externalComfyPath: "",
  comfyHost: "127.0.0.1",
  comfyPort: 8188,
  pixelBackendHost: "127.0.0.1",
  pixelBackendPort: 8189,
  pixelBackendWorkflowRoot: "",
  managedComfyPath: "",
  autoStartRuntime: false,
  outputDirectory: "C:\\temp\\out",
  extraModelDirs: [],
  downloadDirectory: "C:\\temp\\dl",
  cacheDirectory: "C:\\temp\\cache",
  tempDirectory: "C:\\temp\\tmp",
  performanceProfile: "balanced",
  maxActiveJobs: 1,
  defaultBatchSize: 1,
  enableMemoryWarnings: true,
  theme: "dark",
  galleryLayout: "comfortable",
  startupPage: "home",
  defaultSampler: "dpmpp_2m",
  defaultScheduler: "karras",
  defaultSteps: 24,
  defaultCfg: 6.5,
  defaultOutputFormat: "png",
  checkUpdatesAutomatically: true,
  nsfwFilter: true,
  civitaiApiKeySet: false,
};

function makeModelRecord(overrides: Partial<ModelRecord> = {}): ModelRecord {
  return {
    id: "model_nova",
    name: "novaAnimeXL_v1",
    relativePath: "SDXL/novaAnimeXL_v1.safetensors",
    filePath: "C:\\Comfy\\models\\checkpoints\\SDXL\\novaAnimeXL_v1.safetensors",
    category: "checkpoint",
    architecture: "sdxl",
    sizeBytes: 1024,
    sha256: null,
    sourceRoot: "C:\\Comfy\\models\\checkpoints",
    isDuplicate: false,
    duplicateOf: null,
    isIncomplete: false,
    compatibleWorkflows: ["t2i_sdxl_base"],
    license: null,
    description: null,
    installed: true,
    lastSeenAt: "2026-11-11T10:00:00.000Z",
    ...overrides,
  };
}

describe("StudioDatabase & StudioRepository", () => {
  it("initializes schema v7 and persists settings, images, collections, and prompts across restarts", () => {
    const dir = makeTempDir();
    const dbPath = path.join(dir, "studio.db");

    const db1 = new StudioDatabase(dbPath);
    expect(db1.recoveredFromCorruption).toBe(false);
    expect(db1.getSchemaVersion()).toBe(12);

    const repo1 = new StudioRepository(db1);
    repo1.upsertWorkflowMetadata(WORKFLOW_TEMPLATES);
    repo1.saveSettings({ theme: "light", defaultSteps: 30 }, TEST_DEFAULT_SETTINGS);

    const col = repo1.createCollection("col_1", "Portraits", "Studio portrait renders");
    const job: GenerationJob = {
      id: "job_test_1",
      promptId: "prompt_1",
      status: "COMPLETED",
      errorKind: "NONE",
      errorMessage: null,
      prompt: "editorial studio portrait",
      negativePrompt: "blurry",
      checkpoint: "sdxl.safetensors",
      workflowId: "t2i_sdxl_base",
      workflowVersion: "1.0.0",
      mode: "txt2img",
      settings: {
        workflowId: "t2i_sdxl_base",
        mode: "txt2img",
        prompt: "editorial studio portrait",
        negativePrompt: "blurry",
        checkpoint: "sdxl.safetensors",
        vae: null,
        loras: [],
        aspectRatio: "1:1",
        width: 1024,
        height: 1024,
        steps: 24,
        cfg: 6.5,
        sampler: "dpmpp_2m",
        scheduler: "karras",
        seed: 12345,
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
      outputPaths: ["C:\\temp\\out\\img1.png"],
      submittedAt: "2026-11-11T10:00:00.000Z",
      startedAt: "2026-11-11T10:00:01.000Z",
      completedAt: "2026-11-11T10:00:10.000Z",
      batchIndex: 1,
      batchTotal: 1,
    };

    repo1.recordCompletedGenerationTx(
      job,
      [
        {
          id: "img_1",
          jobId: job.id,
          filePath: "C:\\temp\\out\\img1.png",
          fileName: "img1.png",
          format: "png",
          width: 1024,
          height: 1024,
          sizeBytes: 512000,
          prompt: job.prompt,
          negativePrompt: job.negativePrompt,
          seed: 12345,
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
          tags: ["studio"],
          collectionId: col.id,
          createdAt: "2026-11-11T10:00:10.000Z",
        },
      ],
      {
        id: "pr_1",
        title: "Editorial",
        prompt: job.prompt,
        negativePrompt: job.negativePrompt,
      }
    );
    db1.close();

    // Reopen fresh instance simulating app restart
    const db2 = new StudioDatabase(dbPath);
    const repo2 = new StudioRepository(db2);
    const reloadedSettings = repo2.getSettings(TEST_DEFAULT_SETTINGS);
    expect(reloadedSettings.theme).toBe("light");
    expect(reloadedSettings.defaultSteps).toBe(30);

    const imgs = repo2.listImages();
    expect(imgs).toHaveLength(1);
    expect(imgs[0]?.tags).toEqual(["studio"]);
    expect(imgs[0]?.collectionId).toBe("col_1");

    const toggled = repo2.toggleImageFavorite("img_1");
    expect(toggled?.favorite).toBe(true);

    const prompts = repo2.listPrompts();
    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.usageCount).toBe(1);
    db2.close();
  });

  it("persists generated videos and supports favorite toggling and deletion", () => {
    const dir = makeTempDir();
    const db = new StudioDatabase(path.join(dir, "studio.db"));
    const repo = new StudioRepository(db);

    const job: GenerationJob = {
      id: "job_video_1",
      promptId: "prompt_video_1",
      status: "COMPLETED",
      errorKind: "NONE",
      errorMessage: null,
      prompt: "slow dolly through a greenhouse",
      negativePrompt: "flicker",
      checkpoint: "wan2.1_t2v_1.3B_fp16.safetensors",
      workflowId: "t2v_wan21_1_3b",
      workflowVersion: "1.0.0",
      mode: "t2v",
      settings: {
        workflowId: "t2v_wan21_1_3b",
        mode: "t2v",
        prompt: "slow dolly through a greenhouse",
        negativePrompt: "flicker",
        checkpoint: "wan2.1_t2v_1.3B_fp16.safetensors",
        vae: null,
        loras: [],
        aspectRatio: "16:9",
        width: 832,
        height: 480,
        steps: 30,
        cfg: 6,
        sampler: "uni_pc",
        scheduler: "simple",
        seed: 4242,
        randomSeed: false,
        batchCount: 1,
        batchSize: 1,
        outputFormat: "png",
        inputImagePath: null,
        denoise: 1,
        video: { fps: 16, frameCount: 33, durationSeconds: 2.06, format: "mp4" },
      },
      progressStep: 30,
      progressMax: 30,
      currentNode: null,
      previewDataUrl: null,
      outputPaths: ["C:\\temp\\out\\video1.mp4"],
      submittedAt: "2026-11-11T10:00:00.000Z",
      startedAt: "2026-11-11T10:00:01.000Z",
      completedAt: "2026-11-11T10:05:00.000Z",
      batchIndex: 1,
      batchTotal: 1,
    };

    repo.recordCompletedVideoTx(
      job,
      [
        {
          id: "vid_1",
          jobId: job.id,
          filePath: "C:\\temp\\out\\video1.mp4",
          fileName: "video1.mp4",
          container: "mp4",
          width: 832,
          height: 480,
          sizeBytes: 2048000,
          durationSeconds: 2.06,
          fps: 16,
          frameCount: 33,
          prompt: job.prompt,
          negativePrompt: job.negativePrompt,
          seed: 4242,
          checkpoint: job.checkpoint,
          loras: [],
          workflowId: job.workflowId,
          sampler: "uni_pc",
          scheduler: "simple",
          steps: 30,
          cfg: 6,
          denoise: 1,
          mode: "t2v",
          favorite: false,
          tags: ["video"],
          createdAt: "2026-11-11T10:05:00.000Z",
        },
      ],
      { id: "pr_video_1", title: "Greenhouse", prompt: job.prompt, negativePrompt: job.negativePrompt }
    );

    const [video] = repo.listVideos();
    expect(video?.frameCount).toBe(33);
    expect(video?.fps).toBe(16);
    expect(video?.container).toBe("mp4");
    expect(repo.toggleVideoFavorite("vid_1")?.favorite).toBe(true);
    repo.deleteVideo("vid_1");
    expect(repo.listVideos()).toHaveLength(0);
    db.close();
  });

  it("recovers gracefully when the SQLite file on disk is corrupted", () => {
    const dir = makeTempDir();
    const dbPath = path.join(dir, "studio.db");
    fs.writeFileSync(dbPath, Buffer.from("NOT A VALID SQLITE DATABASE HEADER!!!"));

    const db = new StudioDatabase(dbPath);
    expect(db.recoveredFromCorruption).toBe(true);
    expect(db.getSchemaVersion()).toBe(12);
    db.close();

    const files = fs.readdirSync(dir);
    expect(files.some((f) => f.includes(".corrupt."))).toBe(true);
  });

  it("upgrades an existing v1 database to v10 without losing v1 data", () => {
    const dir = makeTempDir();
    const dbPath = path.join(dir, "studio.db");

    const raw = new Database(dbPath);
    raw.pragma("foreign_keys = ON");
    raw.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
    const v1 = MIGRATIONS.find((m) => m.version === 1)!;
    v1.up(raw);
    raw
      .prepare(
        "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)"
      )
      .run(1, v1.name, new Date().toISOString());
    raw
      .prepare(
        "INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)"
      )
      .run("theme", JSON.stringify("light"), new Date().toISOString());
    raw.close();

    const db = new StudioDatabase(dbPath);
    expect(db.getSchemaVersion()).toBe(12);

    const tableNames = (
      db.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Array<{ name: string }>
    ).map((r) => r.name);
    for (const table of [
      "model_metadata",
      "model_discovery",
      "lora_recipes",
      "lora_recipe_items",
      "characters",
      "character_references",
      "stories",
      "story_characters",
      "story_scenes",
      "story_scene_characters",
      "story_canvases",
      "story_canvas_items",
      "story_exports",
      "pixel_palettes",
    ]) {
      expect(tableNames).toContain(table);
    }

    const jobColumns = (
      db.db.prepare("PRAGMA table_info(generation_jobs)").all() as Array<{
        name: string;
      }>
    ).map((c) => c.name);
    expect(jobColumns).toContain("character_id");
    expect(jobColumns).toContain("lora_recipe_id");
    expect(jobColumns).toContain("story_id");
    expect(jobColumns).toContain("story_scene_id");

    const canvasItemColumns = (
      db.db.prepare("PRAGMA table_info(story_canvas_items)").all() as Array<{
        name: string;
      }>
    ).map((c) => c.name);
    expect(canvasItemColumns).toContain("overlays_json");

    const imageColumns = (
      db.db.prepare("PRAGMA table_info(generated_images)").all() as Array<{
        name: string;
      }>
    ).map((c) => c.name);
    expect(imageColumns).toContain("character_id");
    expect(imageColumns).toContain("lora_recipe_id");
    expect(imageColumns).toContain("story_id");
    expect(imageColumns).toContain("story_scene_id");

    const theme = db.db
      .prepare("SELECT value_json FROM settings WHERE key = 'theme'")
      .get() as { value_json: string };
    expect(JSON.parse(theme.value_json)).toBe("light");
    db.close();
  });

  it("upgrades a v6 pixel database with stable frame ids without touching frame data", () => {
    const dir = makeTempDir();
    const dbPath = path.join(dir, "studio.db");
    const assetId = "11111111-1111-4111-8111-111111111111";

    const raw = new Database(dbPath);
    raw.pragma("foreign_keys = OFF");
    raw.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
    const now = new Date().toISOString();
    for (const migration of MIGRATIONS.filter((entry) => entry.version <= 6)) {
      migration.up(raw);
      raw
        .prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)")
        .run(migration.version, migration.name, now);
    }
    raw
      .prepare(
        "INSERT INTO pixel_projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)"
      )
      .run("project-legacy", "Legacy", now, now);
    raw
      .prepare(
        `INSERT INTO pixel_assets
          (id, project_id, name, kind, width, height, preview_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(assetId, "project-legacy", "Legacy Hero", "character", 32, 32, "legacy/preview.png", now, now);
    const insertFrame = raw.prepare(
      `INSERT INTO pixel_frames (asset_id, frame_index, name, duration_ms, file_path)
       VALUES (?, ?, ?, ?, ?)`
    );
    insertFrame.run(assetId, 0, "idle", 120, "legacy/frame_000.png");
    insertFrame.run(assetId, 1, "walk", 90, "legacy/frame_001.png");
    raw.close();

    const db = new StudioDatabase(dbPath);
    expect(db.getSchemaVersion()).toBe(12);
    const rows = db.db
      .prepare(
        "SELECT frame_index, name, duration_ms, frame_id FROM pixel_frames WHERE asset_id = ? ORDER BY frame_index"
      )
      .all(assetId) as Array<{
      frame_index: number;
      name: string;
      duration_ms: number;
      frame_id: string;
    }>;
    expect(rows.map((row) => [row.frame_index, row.name, row.duration_ms])).toEqual([
      [0, "idle", 120],
      [1, "walk", 90],
    ]);
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    for (const row of rows) expect(row.frame_id).toMatch(uuidPattern);
    expect(new Set(rows.map((row) => row.frame_id)).size).toBe(rows.length);

    const indexes = db.db.prepare("PRAGMA index_list(pixel_frames)").all() as Array<{
      name: string;
      unique: number;
    }>;
    expect(indexes).toContainEqual(
      expect.objectContaining({ name: "idx_pixel_frames_asset_frame_id", unique: 1 })
    );
    expect(() =>
      db.db
        .prepare(
          `INSERT INTO pixel_frames (asset_id, frame_id, frame_index, name, duration_ms, file_path)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(assetId, rows[0]!.frame_id, 2, "duplicate", 100, "legacy/frame_002.png")
    ).toThrow();
    db.close();
  });

  it("preserves user metadata and recipes across destructive model rescans", () => {
    const db = new StudioDatabase(":memory:");
    const repo = new StudioRepository(db);
    const model = makeModelRecord();

    repo.replaceScannedModels([model]);

    const updated = repo.updateModelMetadata(model.id, {
      displayName: "Nova Anime XL",
      description: "Preferred anime checkpoint",
      architectureOverride: "illustrious",
      baseModel: "SDXL 1.0",
      previewMode: "custom",
      previewPath: "C:\\images\\latest_generated_work.png",
      triggerWords: ["nova_style"],
      tags: ["anime", "portrait"],
      notes: "keep me",
      favorite: true,
    });
    expect(updated.metadata?.displayName).toBe("Nova Anime XL");
    expect(updated.metadata?.previewMode).toBe("custom");
    expect(updated.metadata?.previewPath).toBe("C:\\images\\latest_generated_work.png");
    expect(updated.metadata?.favorite).toBe(true);
    expect(updated.metadata?.triggerWords).toEqual(["nova_style"]);

    const recipe = repo.saveLoraRecipe({
      name: "Nova Line Stack",
      description: "Two adapters",
      architecture: "sdxl",
      checkpointPath: model.relativePath,
      checkpointName: "Nova Anime XL",
      basePrompt: "portrait, rim light",
      items: [
        { loraPath: "C:\\models\\loras\\line.safetensors", strengthModel: 0.9 },
        { loraPath: "C:\\models\\loras\\shade.safetensors", strengthClip: 0.6 },
        { loraPath: "C:\\models\\loras\\line.safetensors" },
      ],
    });
    expect(recipe.items).toHaveLength(2);
    expect(recipe.items[0]?.strengthModel).toBe(0.9);

    // Rescan wipes `models`/`model_discovery` only; user edits must survive.
    repo.replaceScannedModels([makeModelRecord()]);

    const afterRescan = repo.getModelById(model.id);
    expect(afterRescan).not.toBeNull();
    expect(afterRescan?.metadata?.displayName).toBe("Nova Anime XL");
    expect(afterRescan?.metadata?.notes).toBe("keep me");
    expect(repo.listLoraRecipes()).toHaveLength(1);
    expect(repo.listLoraRecipes()[0]?.items).toHaveLength(2);

    // Re-saving replaces the item set instead of appending duplicates.
    const revised = repo.saveLoraRecipe({
      id: recipe.id,
      name: "Nova Line Stack",
      checkpointPath: model.relativePath,
      items: [{ loraPath: "C:\\models\\loras\\line.safetensors" }],
    });
    expect(revised.id).toBe(recipe.id);
    expect(revised.items).toHaveLength(1);

    repo.deleteModelRecord(model.filePath);
    expect(repo.getModelById(model.id)).toBeNull();
    expect(repo.listLoraRecipes()).toHaveLength(1);

    repo.deleteLoraRecipe(recipe.id);
    expect(repo.listLoraRecipes()).toHaveLength(0);
    const orphanItems = db.db
      .prepare("SELECT COUNT(*) AS n FROM lora_recipe_items")
      .get() as { n: number };
    expect(orphanItems.n).toBe(0);
    db.close();
  });
});
