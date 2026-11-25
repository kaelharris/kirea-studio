import type {
  CollectionRecord,
  GeneratedImageRecord,
  GeneratedVideoRecord,
  GenerationJob,
  GenerationMode,
  GenerationRequest,
  ImageOperationRecord,
  JobErrorKind,
  JobLifecycleState,
  LoraSelection,
  OutputFormat,
  PromptRecord,
  VideoContainerFormat,
} from "../../../shared/types";
import crypto from "node:crypto";
import { classifyImageOperation } from "../../../shared/image-labels";
import type { StudioDatabase } from "../database";
import { safeParseJson } from "../repo-mappers";

export class GenerationsRepository {
  constructor(private readonly studioDb: StudioDatabase,
    private readonly onSyncStoryScene: (job: GenerationJob) => void) {}

  upsertJob(job: GenerationJob): void {
    this.studioDb.db
      .prepare(
        `INSERT INTO generation_jobs (
          id, prompt_id, status, error_kind, error_message, prompt, negative_prompt,
          checkpoint, workflow_id, workflow_version, mode, settings_json,
          progress_step, progress_max, current_node, output_paths_json,
          submitted_at, started_at, completed_at, batch_index, batch_total,
          character_id, lora_recipe_id, story_id, story_scene_id, startup_interrupted
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          prompt_id = excluded.prompt_id,
          status = CASE
            WHEN generation_jobs.status = 'COMPLETED' THEN 'COMPLETED'
            ELSE excluded.status
          END,
          error_kind = CASE
            WHEN generation_jobs.status = 'COMPLETED' THEN 'NONE'
            ELSE excluded.error_kind
          END,
          error_message = CASE
            WHEN generation_jobs.status = 'COMPLETED' THEN NULL
            ELSE excluded.error_message
          END,
          progress_step = CASE
            WHEN generation_jobs.status = 'COMPLETED' THEN generation_jobs.progress_step
            ELSE excluded.progress_step
          END,
          progress_max = CASE
            WHEN generation_jobs.status = 'COMPLETED' THEN generation_jobs.progress_max
            ELSE excluded.progress_max
          END,
          current_node = CASE
            WHEN generation_jobs.status = 'COMPLETED' THEN NULL
            ELSE excluded.current_node
          END,
          output_paths_json = CASE
            WHEN generation_jobs.status = 'COMPLETED' AND excluded.output_paths_json = '[]' THEN generation_jobs.output_paths_json
            ELSE excluded.output_paths_json
          END,
          started_at = COALESCE(generation_jobs.started_at, excluded.started_at),
          completed_at = COALESCE(generation_jobs.completed_at, excluded.completed_at),
          character_id = COALESCE(excluded.character_id, generation_jobs.character_id),
          lora_recipe_id = COALESCE(excluded.lora_recipe_id, generation_jobs.lora_recipe_id),
          story_id = COALESCE(excluded.story_id, generation_jobs.story_id),
          story_scene_id = COALESCE(excluded.story_scene_id, generation_jobs.story_scene_id),
          startup_interrupted = MAX(generation_jobs.startup_interrupted, excluded.startup_interrupted)`
      )
      .run(
        job.id,
        job.promptId,
        job.status,
        job.errorKind,
        job.errorMessage,
        job.prompt,
        job.negativePrompt,
        job.checkpoint,
        job.workflowId,
        job.workflowVersion,
        job.mode,
        JSON.stringify(job.settings),
        job.progressStep,
        job.progressMax,
        job.currentNode,
        JSON.stringify(job.outputPaths),
        job.submittedAt,
        job.startedAt,
        job.completedAt,
        job.batchIndex,
        job.batchTotal,
        job.characterId ?? null,
        job.loraRecipeId ?? null,
        job.storyId ?? null,
        job.storySceneId ?? null,
        job.startupInterrupted ? 1 : 0
      );

    this.onSyncStoryScene(job);
  }

  listJobs(limit = 150): GenerationJob[] {
    const rows = this.studioDb.db
      .prepare("SELECT * FROM generation_jobs ORDER BY submitted_at DESC LIMIT ?")
      .all(limit) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: String(r.id),
      promptId: r.prompt_id ? String(r.prompt_id) : null,
      status: r.status as JobLifecycleState,
      errorKind: r.error_kind as JobErrorKind,
      errorMessage: r.error_message ? String(r.error_message) : null,
      prompt: String(r.prompt),
      negativePrompt: String(r.negative_prompt ?? ""),
      checkpoint: String(r.checkpoint),
      workflowId: String(r.workflow_id),
      workflowVersion: String(r.workflow_version),
      mode: r.mode as GenerationMode,
      settings: safeParseJson<GenerationRequest>(String(r.settings_json), {} as GenerationRequest),
      progressStep: Number(r.progress_step ?? 0),
      progressMax: Number(r.progress_max ?? 0),
      currentNode: r.current_node ? String(r.current_node) : null,
      previewDataUrl: null,
      outputPaths: safeParseJson<string[]>(String(r.output_paths_json), []),
      submittedAt: String(r.submitted_at),
      startedAt: r.started_at ? String(r.started_at) : null,
      completedAt: r.completed_at ? String(r.completed_at) : null,
      batchIndex: Number(r.batch_index ?? 1),
      batchTotal: Number(r.batch_total ?? 1),
      characterId: r.character_id ? String(r.character_id) : null,
      loraRecipeId: r.lora_recipe_id ? String(r.lora_recipe_id) : null,
      storyId: r.story_id ? String(r.story_id) : null,
      storySceneId: r.story_scene_id ? String(r.story_scene_id) : null,
      startupInterrupted: Boolean(r.startup_interrupted),
    }));
  }

  getJobById(id: string): GenerationJob | null {
    const row = this.studioDb.db
      .prepare("SELECT * FROM generation_jobs WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      promptId: row.prompt_id ? String(row.prompt_id) : null,
      status: row.status as JobLifecycleState,
      errorKind: row.error_kind as JobErrorKind,
      errorMessage: row.error_message ? String(row.error_message) : null,
      prompt: String(row.prompt),
      negativePrompt: String(row.negative_prompt ?? ""),
      checkpoint: String(row.checkpoint),
      workflowId: String(row.workflow_id),
      workflowVersion: String(row.workflow_version),
      mode: row.mode as GenerationMode,
      settings: safeParseJson<GenerationRequest>(String(row.settings_json), {} as GenerationRequest),
      progressStep: Number(row.progress_step ?? 0),
      progressMax: Number(row.progress_max ?? 0),
      currentNode: row.current_node ? String(row.current_node) : null,
      previewDataUrl: null,
      outputPaths: safeParseJson<string[]>(String(row.output_paths_json), []),
      submittedAt: String(row.submitted_at),
      startedAt: row.started_at ? String(row.started_at) : null,
      completedAt: row.completed_at ? String(row.completed_at) : null,
      batchIndex: Number(row.batch_index ?? 1),
      batchTotal: Number(row.batch_total ?? 1),
      characterId: row.character_id ? String(row.character_id) : null,
      loraRecipeId: row.lora_recipe_id ? String(row.lora_recipe_id) : null,
      storyId: row.story_id ? String(row.story_id) : null,
      storySceneId: row.story_scene_id ? String(row.story_scene_id) : null,
      startupInterrupted: Boolean(row.startup_interrupted),
    };
  }

  hasOutputsForJob(jobId: string): boolean {
    const img = this.studioDb.db
      .prepare("SELECT 1 FROM generated_images WHERE job_id = ? LIMIT 1")
      .get(jobId);
    if (img) return true;
    const vid = this.studioDb.db
      .prepare("SELECT 1 FROM generated_videos WHERE job_id = ? LIMIT 1")
      .get(jobId);
    return Boolean(vid);
  }

  deleteJob(jobId: string): boolean {
    const res = this.studioDb.db
      .prepare("DELETE FROM generation_jobs WHERE id = ?")
      .run(jobId);
    return res.changes > 0;
  }

  deleteJobs(jobIds: string[]): number {
    if (jobIds.length === 0) return 0;
    const stmt = this.studioDb.db.prepare("DELETE FROM generation_jobs WHERE id = ?");
    let count = 0;
    const runTx = this.studioDb.db.transaction(() => {
      for (const id of jobIds) {
        const res = stmt.run(id);
        if (res.changes > 0) count++;
      }
    });
    runTx();
    return count;
  }

  recordCompletedGenerationTx(
    job: GenerationJob,
    images: GeneratedImageRecord[],
    promptRecord: { id: string; title: string; prompt: string; negativePrompt: string } | null
  ): void {
    const insertImg = this.studioDb.db.prepare(
      `INSERT INTO generated_images (
        id, job_id, file_path, file_name, format, width, height, size_bytes,
        prompt, negative_prompt, seed, checkpoint, loras_json, workflow_id,
        sampler, scheduler, steps, cfg, denoise, mode, favorite, tags_json,
        collection_id, created_at, character_id, lora_recipe_id, story_id,
        story_scene_id, parent_image_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const findParent = this.studioDb.db.prepare(
      "SELECT id FROM generated_images WHERE file_path = ? LIMIT 1"
    );
    const parentSequence = this.studioDb.db.prepare(
      "SELECT COALESCE(MAX(sequence), -1) AS sequence FROM image_operations WHERE image_id = ?"
    );
    const insertOperation = this.studioDb.db.prepare(
      `INSERT INTO image_operations (
        id, image_id, sequence, operation, workflow_id, workflow_version,
        checkpoint, prompt, seed, parameters_json, parent_image_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const hasValidPrompt = Boolean(promptRecord && promptRecord.prompt.trim().length > 0);
    const existingPrompt = hasValidPrompt
      ? (this.studioDb.db
          .prepare("SELECT id, usage_count FROM prompts WHERE prompt = ? AND negative_prompt = ? LIMIT 1")
          .get(promptRecord!.prompt, promptRecord!.negativePrompt) as
          | { id: string; usage_count: number }
          | undefined)
      : undefined;

    this.studioDb.transaction(() => {
      const now = new Date().toISOString();
      this.upsertJob(job);
      for (const img of images) {
        const parent = img.sourceImagePath
          ? (findParent.get(img.sourceImagePath) as { id: string } | undefined)
          : undefined;
        const parentImageId = parent?.id ?? null;
        insertImg.run(
          img.id,
          img.jobId,
          img.filePath,
          img.fileName,
          img.format,
          img.width,
          img.height,
          img.sizeBytes,
          img.prompt,
          img.negativePrompt,
          img.seed,
          img.checkpoint,
          JSON.stringify(img.loras),
          img.workflowId,
          img.sampler,
          img.scheduler,
          img.steps,
          img.cfg,
          img.denoise,
          img.mode,
          img.favorite ? 1 : 0,
          JSON.stringify(img.tags),
          img.collectionId,
          img.createdAt,
          img.characterId ?? job.characterId ?? null,
          img.loraRecipeId ?? job.loraRecipeId ?? null,
          img.storyId ?? job.storyId ?? job.settings?.storyId ?? null,
          img.storySceneId ?? job.storySceneId ?? job.settings?.storySceneId ?? null,
          parentImageId
        );

        const parentSeq = parentImageId
          ? Number(
              (
                parentSequence.get(parentImageId) as
                  | { sequence: number }
                  | undefined
              )?.sequence ?? -1
            )
          : -1;
        insertOperation.run(
          `op_${crypto.randomUUID().slice(0, 12)}`,
          img.id,
          parentSeq + 1,
          classifyImageOperation(img.mode, img.workflowId),
          img.workflowId,
          job.workflowVersion ?? null,
          img.checkpoint,
          img.prompt,
          img.seed,
          JSON.stringify(job.settings ?? {}),
          parentImageId,
          img.createdAt
        );
      }

      const sceneId = job.storySceneId ?? job.settings?.storySceneId ?? null;
      const storyId = job.storyId ?? job.settings?.storyId ?? null;
      if (sceneId && images.length > 0) {
        this.studioDb.db
          .prepare(
            `UPDATE story_scenes
             SET selected_image_id = COALESCE(selected_image_id, ?), updated_at = ?
             WHERE id = ?`
          )
          .run(images[0]!.id, now, sceneId);
        if (storyId) {
          this.studioDb.db
            .prepare(
              `UPDATE stories
               SET status = CASE WHEN status = 'draft' THEN 'in_progress' ELSE status END,
                   updated_at = ?
               WHERE id = ?`
            )
            .run(now, storyId);
        }
      }
      if (hasValidPrompt && existingPrompt) {
        this.studioDb.db
          .prepare("UPDATE prompts SET usage_count = ?, last_used_at = ? WHERE id = ?")
          .run(existingPrompt.usage_count + 1, now, existingPrompt.id);
      } else if (hasValidPrompt && promptRecord) {
        this.studioDb.db
          .prepare(
            `INSERT INTO prompts (id, title, prompt, negative_prompt, tags_json, favorite, usage_count, last_used_at, created_at)
             VALUES (?, ?, ?, ?, '[]', 0, 1, ?, ?)`
          )
          .run(
            promptRecord.id,
            promptRecord.title,
            promptRecord.prompt,
            promptRecord.negativePrompt,
            now,
            now
          );
      }
    });
  }

  recordCompletedVideoTx(
    job: GenerationJob,
    videos: GeneratedVideoRecord[],
    promptRecord: { id: string; title: string; prompt: string; negativePrompt: string } | null
  ): void {
    const insertVideo = this.studioDb.db.prepare(
      `INSERT INTO generated_videos (
        id, job_id, file_path, file_name, container, width, height, size_bytes,
        duration_seconds, fps, frame_count, prompt, negative_prompt, seed,
        checkpoint, loras_json, workflow_id, sampler, scheduler, steps, cfg,
        denoise, mode, favorite, tags_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const hasValidPrompt = Boolean(promptRecord && promptRecord.prompt.trim().length > 0);
    const existingPrompt = hasValidPrompt
      ? (this.studioDb.db
          .prepare("SELECT id, usage_count FROM prompts WHERE prompt = ? AND negative_prompt = ? LIMIT 1")
          .get(promptRecord!.prompt, promptRecord!.negativePrompt) as
          | { id: string; usage_count: number }
          | undefined)
      : undefined;

    this.studioDb.transaction(() => {
      const now = new Date().toISOString();
      this.upsertJob(job);
      for (const video of videos) {
        insertVideo.run(
          video.id,
          video.jobId,
          video.filePath,
          video.fileName,
          video.container,
          video.width,
          video.height,
          video.sizeBytes,
          video.durationSeconds,
          video.fps,
          video.frameCount,
          video.prompt,
          video.negativePrompt,
          video.seed,
          video.checkpoint,
          JSON.stringify(video.loras),
          video.workflowId,
          video.sampler,
          video.scheduler,
          video.steps,
          video.cfg,
          video.denoise,
          video.mode,
          video.favorite ? 1 : 0,
          JSON.stringify(video.tags),
          video.createdAt
        );
      }

      if (hasValidPrompt && existingPrompt) {
        this.studioDb.db
          .prepare("UPDATE prompts SET usage_count = ?, last_used_at = ? WHERE id = ?")
          .run(existingPrompt.usage_count + 1, now, existingPrompt.id);
      } else if (hasValidPrompt && promptRecord) {
        this.studioDb.db
          .prepare(
            `INSERT INTO prompts (id, title, prompt, negative_prompt, tags_json, favorite, usage_count, last_used_at, created_at)
             VALUES (?, ?, ?, ?, '[]', 0, 1, ?, ?)`
          )
          .run(promptRecord.id, promptRecord.title, promptRecord.prompt, promptRecord.negativePrompt, now, now);
      }
    });
  }

  listVideos(limit = 100): GeneratedVideoRecord[] {
    const rows = this.studioDb.db
      .prepare("SELECT * FROM generated_videos ORDER BY created_at DESC LIMIT ?")
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapVideoRow(row));
  }

  getVideoById(id: string): GeneratedVideoRecord | null {
    const row = this.studioDb.db
      .prepare("SELECT * FROM generated_videos WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.mapVideoRow(row) : null;
  }

  toggleVideoFavorite(id: string): GeneratedVideoRecord | null {
    const current = this.studioDb.db
      .prepare("SELECT favorite FROM generated_videos WHERE id = ?")
      .get(id) as { favorite: number } | undefined;
    if (!current) return null;
    this.studioDb.db
      .prepare("UPDATE generated_videos SET favorite = ? WHERE id = ?")
      .run(current.favorite ? 0 : 1, id);
    return this.getVideoById(id);
  }

  deleteVideo(id: string): void {
    this.studioDb.db.prepare("DELETE FROM generated_videos WHERE id = ?").run(id);
  }

  private mapVideoRow(row: Record<string, unknown>): GeneratedVideoRecord {
    return {
      id: String(row.id),
      jobId: String(row.job_id),
      filePath: String(row.file_path),
      fileName: String(row.file_name),
      container: row.container as VideoContainerFormat,
      width: Number(row.width),
      height: Number(row.height),
      sizeBytes: Number(row.size_bytes),
      durationSeconds: Number(row.duration_seconds),
      fps: Number(row.fps),
      frameCount: Number(row.frame_count),
      prompt: String(row.prompt),
      negativePrompt: String(row.negative_prompt ?? ""),
      seed: Number(row.seed),
      checkpoint: String(row.checkpoint),
      loras: safeParseJson<LoraSelection[]>(String(row.loras_json), []),
      workflowId: String(row.workflow_id),
      sampler: String(row.sampler),
      scheduler: String(row.scheduler),
      steps: Number(row.steps),
      cfg: Number(row.cfg),
      denoise: Number(row.denoise ?? 1),
      mode: row.mode as GenerationMode,
      favorite: Boolean(row.favorite),
      tags: safeParseJson<string[]>(String(row.tags_json), []),
      createdAt: String(row.created_at),
    };
  }

  private attachOperationLineage(records: GeneratedImageRecord[]): void {
    if (records.length === 0) return;
    const parentRows = this.studioDb.db
      .prepare("SELECT id, parent_image_id FROM generated_images")
      .all() as Array<{ id: string; parent_image_id: string | null }>;
    const parents = new Map(
      parentRows.map((row) => [row.id, row.parent_image_id])
    );

    const operationRows = this.studioDb.db
      .prepare("SELECT * FROM image_operations ORDER BY sequence ASC")
      .all() as Array<Record<string, unknown>>;
    const operations = new Map<string, ImageOperationRecord[]>();
    for (const row of operationRows) {
      const imageId = String(row.image_id);
      const list = operations.get(imageId) ?? [];
      list.push({
        id: String(row.id),
        imageId,
        sequence: Number(row.sequence ?? 0),
        operation: String(row.operation) as ImageOperationRecord["operation"],
        workflowId: String(row.workflow_id),
        workflowVersion: row.workflow_version
          ? String(row.workflow_version)
          : null,
        checkpoint: String(row.checkpoint ?? ""),
        prompt: String(row.prompt ?? ""),
        seed: Number(row.seed ?? 0),
        parameters: safeParseJson<Record<string, unknown>>(
          String(row.parameters_json ?? "{}"),
          {}
        ),
        parentImageId: row.parent_image_id
          ? String(row.parent_image_id)
          : null,
        createdAt: String(row.created_at),
      });
      operations.set(imageId, list);
    }

    for (const record of records) {
      const lineage: ImageOperationRecord[] = [];
      const seen = new Set<string>();
      let cursor: string | null = record.id;
      while (cursor && !seen.has(cursor)) {
        seen.add(cursor);
        lineage.push(...(operations.get(cursor) ?? []));
        cursor = parents.get(cursor) ?? null;
      }
      lineage.sort((a, b) => a.sequence - b.sequence);
      record.parentImageId = parents.get(record.id) ?? null;
      record.operations = lineage;
    }
  }

  listImages(filters?: {    search?: string;
    favoriteOnly?: boolean;
    collectionId?: string | null;
    sortBy?: "newest" | "oldest" | "name";
  }): GeneratedImageRecord[] {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filters?.favoriteOnly) {
      clauses.push("favorite = 1");
    }
    if (filters?.collectionId) {
      clauses.push("collection_id = ?");
      params.push(filters.collectionId);
    }
    if (filters?.search && filters.search.trim().length > 0) {
      const q = `%${filters.search.trim()}%`;
      clauses.push("(prompt LIKE ? OR checkpoint LIKE ? OR tags_json LIKE ? OR file_name LIKE ?)");
      params.push(q, q, q, q);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const order =
      filters?.sortBy === "oldest"
        ? "ORDER BY g.created_at ASC"
        : filters?.sortBy === "name"
          ? "ORDER BY g.file_name COLLATE NOCASE ASC"
          : "ORDER BY g.created_at DESC";

    const rows = this.studioDb.db
      .prepare(`
        SELECT g.*, json_extract(j.settings_json, '$.inputImagePath') AS source_image_path
        FROM generated_images g
        LEFT JOIN generation_jobs j ON g.job_id = j.id
        ${where.replace(/\b(favorite|collection_id|prompt|checkpoint|tags_json|file_name)\b/g, "g.$1")}
        ${order}
        LIMIT 500
      `)
      .all(...params) as Array<Record<string, unknown>>;

    const records = rows.map((r) => ({
      id: String(r.id),
      jobId: String(r.job_id),
      filePath: String(r.file_path),
      fileName: String(r.file_name),
      format: r.format as OutputFormat,
      width: Number(r.width),
      height: Number(r.height),
      sizeBytes: Number(r.size_bytes),
      prompt: String(r.prompt),
      negativePrompt: String(r.negative_prompt ?? ""),
      seed: Number(r.seed),
      checkpoint: String(r.checkpoint),
      loras: safeParseJson<LoraSelection[]>(String(r.loras_json), []),
      workflowId: String(r.workflow_id),
      sampler: String(r.sampler),
      scheduler: String(r.scheduler),
      steps: Number(r.steps),
      cfg: Number(r.cfg),
      denoise: Number(r.denoise ?? 1),
      mode: r.mode as GenerationMode,
      favorite: Boolean(r.favorite),
      tags: safeParseJson<string[]>(String(r.tags_json), []),
      collectionId: r.collection_id ? String(r.collection_id) : null,
      createdAt: String(r.created_at),
      characterId: r.character_id ? String(r.character_id) : null,
      loraRecipeId: r.lora_recipe_id ? String(r.lora_recipe_id) : null,
      storyId: r.story_id ? String(r.story_id) : null,
      storySceneId: r.story_scene_id ? String(r.story_scene_id) : null,
      sourceImagePath: (r.source_image_path ?? r.sourceImagePath) ? String(r.source_image_path ?? r.sourceImagePath) : null,
      parentImageId: r.parent_image_id ? String(r.parent_image_id) : null,
    }));
    this.attachOperationLineage(records);
    return records;
  }

  getImageById(id: string): GeneratedImageRecord | null {
    const row = this.studioDb.db
      .prepare(`
        SELECT g.*, json_extract(j.settings_json, '$.inputImagePath') AS source_image_path
        FROM generated_images g
        LEFT JOIN generation_jobs j ON g.job_id = j.id
        WHERE g.id = ?
      `)
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    const record: GeneratedImageRecord = {
      id: String(row.id),
      jobId: String(row.job_id),
      filePath: String(row.file_path),
      fileName: String(row.file_name),
      format: row.format as OutputFormat,
      width: Number(row.width),
      height: Number(row.height),
      sizeBytes: Number(row.size_bytes),
      prompt: String(row.prompt),
      negativePrompt: String(row.negative_prompt ?? ""),
      seed: Number(row.seed),
      checkpoint: String(row.checkpoint),
      loras: safeParseJson<LoraSelection[]>(String(row.loras_json), []),
      workflowId: String(row.workflow_id),
      sampler: String(row.sampler),
      scheduler: String(row.scheduler),
      steps: Number(row.steps),
      cfg: Number(row.cfg),
      denoise: Number(row.denoise ?? 1),
      mode: row.mode as GenerationMode,
      favorite: Boolean(row.favorite),
      tags: safeParseJson<string[]>(String(row.tags_json), []),
      collectionId: row.collection_id ? String(row.collection_id) : null,
      createdAt: String(row.created_at),
      characterId: row.character_id ? String(row.character_id) : null,
      loraRecipeId: row.lora_recipe_id ? String(row.lora_recipe_id) : null,
      storyId: row.story_id ? String(row.story_id) : null,
      storySceneId: row.story_scene_id ? String(row.story_scene_id) : null,
      sourceImagePath: (row.source_image_path ?? row.sourceImagePath) ? String(row.source_image_path ?? row.sourceImagePath) : null,
      parentImageId: row.parent_image_id ? String(row.parent_image_id) : null,
    };
    this.attachOperationLineage([record]);
    return record;
  }

  toggleImageFavorite(id: string): GeneratedImageRecord | null {
    const current = this.studioDb.db
      .prepare("SELECT favorite FROM generated_images WHERE id = ?")
      .get(id) as { favorite: number } | undefined;
    if (!current) return null;
    const next = current.favorite ? 0 : 1;
    this.studioDb.db
      .prepare("UPDATE generated_images SET favorite = ? WHERE id = ?")
      .run(next, id);
    return this.getImageById(id);
  }

  updateImageMetadata(
    id: string,
    updates: { tags?: string[]; collectionId?: string | null }
  ): void {
    if (updates.tags !== undefined) {
      this.studioDb.db
        .prepare("UPDATE generated_images SET tags_json = ? WHERE id = ?")
        .run(JSON.stringify(updates.tags), id);
    }
    if (updates.collectionId !== undefined) {
      this.studioDb.db
        .prepare("UPDATE generated_images SET collection_id = ? WHERE id = ?")
        .run(updates.collectionId, id);
    }
  }

  deleteImage(id: string): void {
    this.studioDb.db.prepare("DELETE FROM generated_images WHERE id = ?").run(id);
  }

  listCollections(): CollectionRecord[] {
    const rows = this.studioDb.db
      .prepare(
        `SELECT c.*, COUNT(i.id) AS image_count
         FROM collections c
         LEFT JOIN generated_images i ON i.collection_id = c.id
         GROUP BY c.id
         ORDER BY c.created_at DESC`
      )
      .all() as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      description: String(r.description ?? ""),
      createdAt: String(r.created_at),
      imageCount: Number(r.image_count ?? 0),
    }));
  }

  createCollection(id: string, name: string, description = ""): CollectionRecord {
    const now = new Date().toISOString();
    this.studioDb.db
      .prepare("INSERT INTO collections (id, name, description, created_at) VALUES (?, ?, ?, ?)")
      .run(id, name.trim(), description.trim(), now);
    return { id, name: name.trim(), description: description.trim(), createdAt: now, imageCount: 0 };
  }

  deleteCollection(id: string): void {
    this.studioDb.db.prepare("DELETE FROM collections WHERE id = ?").run(id);
  }

  listPrompts(limit = 50): PromptRecord[] {
    const rows = this.studioDb.db
      .prepare("SELECT * FROM prompts ORDER BY COALESCE(last_used_at, created_at) DESC LIMIT ?")
      .all(limit) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: String(r.id),
      title: String(r.title),
      prompt: String(r.prompt),
      negativePrompt: String(r.negative_prompt ?? ""),
      tags: safeParseJson<string[]>(String(r.tags_json), []),
      favorite: Boolean(r.favorite),
      usageCount: Number(r.usage_count ?? 1),
      lastUsedAt: r.last_used_at ? String(r.last_used_at) : null,
      createdAt: String(r.created_at),
    }));
  }

  savePrompt(record: PromptRecord): PromptRecord {
    this.studioDb.db
      .prepare(
        `INSERT INTO prompts (id, title, prompt, negative_prompt, tags_json, favorite, usage_count, last_used_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           prompt = excluded.prompt,
           negative_prompt = excluded.negative_prompt,
           tags_json = excluded.tags_json,
           favorite = excluded.favorite`
      )
      .run(
        record.id,
        record.title,
        record.prompt,
        record.negativePrompt,
        JSON.stringify(record.tags),
        record.favorite ? 1 : 0,
        record.usageCount,
        record.lastUsedAt,
        record.createdAt
      );
    return record;
  }

  deletePrompt(id: string): void {
    this.studioDb.db.prepare("DELETE FROM prompts WHERE id = ?").run(id);
  }

}
