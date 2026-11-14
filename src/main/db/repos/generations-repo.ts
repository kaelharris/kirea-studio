import type {
  CollectionRecord,
  GeneratedImageRecord,
  GenerationJob,
  GenerationMode,
  GenerationRequest,
  JobErrorKind,
  JobLifecycleState,
  LoraSelection,
  OutputFormat,
  PromptRecord,
} from "../../../shared/types";
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
          character_id, lora_recipe_id, story_id, story_scene_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          prompt_id = excluded.prompt_id,
          status = excluded.status,
          error_kind = excluded.error_kind,
          error_message = excluded.error_message,
          progress_step = excluded.progress_step,
          progress_max = excluded.progress_max,
          current_node = excluded.current_node,
          output_paths_json = excluded.output_paths_json,
          started_at = excluded.started_at,
          completed_at = excluded.completed_at,
          character_id = excluded.character_id,
          lora_recipe_id = excluded.lora_recipe_id,
          story_id = excluded.story_id,
          story_scene_id = excluded.story_scene_id`
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
        job.storySceneId ?? null
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
    };
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
        collection_id, created_at, character_id, lora_recipe_id, story_id, story_scene_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
          img.storySceneId ?? job.storySceneId ?? job.settings?.storySceneId ?? null
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

  listImages(filters?: {
    search?: string;
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
        ? "ORDER BY created_at ASC"
        : filters?.sortBy === "name"
          ? "ORDER BY file_name COLLATE NOCASE ASC"
          : "ORDER BY created_at DESC";

    const rows = this.studioDb.db
      .prepare(`SELECT * FROM generated_images ${where} ${order} LIMIT 500`)
      .all(...params) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
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
    }));
  }

  getImageById(id: string): GeneratedImageRecord | null {
    const row = this.studioDb.db
      .prepare("SELECT * FROM generated_images WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
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
    };
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
