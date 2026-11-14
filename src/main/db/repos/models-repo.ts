import { randomUUID } from "node:crypto";
import type {
  DownloadStatus,
  DownloadTask,
  GenerationMode,
  LoraRecipe,
  LoraRecipeInput,
  LoraRecipeItem,
  ModelArchitecture,
  ModelCategory,
  ModelDiscovery,
  ModelMetadata,
  ModelMetadataPatch,
  ModelRecord,
} from "../../../shared/types";
import type { StudioDatabase } from "../database";
import {
  mapDiscoveryRow,
  mapMetadataRow,
  parseRecipeSettings,
  safeParseJson,
} from "../repo-mappers";

export class ModelsRepository {
  constructor(private readonly studioDb: StudioDatabase) {}

  replaceScannedModels(models: ModelRecord[]): void {
    const upsertStmt = this.studioDb.db.prepare(
      `INSERT INTO models (
         id, name, relative_path, file_path, category, architecture, size_bytes,
         sha256, source_root, is_duplicate, duplicate_of, is_incomplete,
         compatible_workflows_json, license, description, installed, last_seen_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(file_path) DO UPDATE SET
         id = excluded.id,
         name = excluded.name,
         relative_path = excluded.relative_path,
         category = excluded.category,
         architecture = excluded.architecture,
         size_bytes = excluded.size_bytes,
         sha256 = COALESCE(excluded.sha256, models.sha256),
         source_root = excluded.source_root,
         is_duplicate = excluded.is_duplicate,
         duplicate_of = excluded.duplicate_of,
         is_incomplete = excluded.is_incomplete,
         compatible_workflows_json = excluded.compatible_workflows_json,
         installed = excluded.installed,
         last_seen_at = excluded.last_seen_at`
    );

    const discoveryStmt = this.studioDb.db.prepare(
      `INSERT INTO model_discovery (
         model_id, file_path, description, base_model, preview_path,
         trigger_words_json, discovered_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(model_id) DO UPDATE SET
         file_path = excluded.file_path,
         description = excluded.description,
         base_model = excluded.base_model,
         preview_path = excluded.preview_path,
         trigger_words_json = excluded.trigger_words_json,
         discovered_at = excluded.discovered_at`
    );

    this.studioDb.transaction(() => {
      this.studioDb.db.prepare("DELETE FROM models").run();
      this.studioDb.db.prepare("DELETE FROM model_discovery").run();
      for (const m of models) {
        upsertStmt.run(
          m.id,
          m.name,
          m.relativePath,
          m.filePath,
          m.category,
          m.architecture,
          m.sizeBytes,
          m.sha256,
          m.sourceRoot,
          m.isDuplicate ? 1 : 0,
          m.duplicateOf,
          m.isIncomplete ? 1 : 0,
          JSON.stringify(m.compatibleWorkflows),
          m.license,
          m.description,
          m.installed ? 1 : 0,
          m.lastSeenAt
        );
        if (m.discovery) {
          discoveryStmt.run(
            m.id,
            m.filePath,
            m.discovery.description,
            m.discovery.baseModel,
            m.discovery.previewPath,
            JSON.stringify(m.discovery.triggerWords),
            m.discovery.discoveredAt
          );
        }
      }
    });
  }

  listModels(category?: ModelCategory): ModelRecord[] {
    const rows = (
      category
        ? this.studioDb.db
            .prepare("SELECT * FROM models WHERE category = ? ORDER BY name COLLATE NOCASE ASC")
            .all(category)
        : this.studioDb.db
            .prepare("SELECT * FROM models ORDER BY category ASC, name COLLATE NOCASE ASC")
            .all()
    ) as Array<Record<string, unknown>>;

    const metadataByModel = new Map<string, ModelMetadata>();
    const metadataRows = this.studioDb.db
      .prepare("SELECT * FROM model_metadata")
      .all() as Array<Record<string, unknown>>;
    for (const row of metadataRows) {
      const meta = mapMetadataRow(row);
      metadataByModel.set(meta.modelId, meta);
    }

    const discoveryByModel = new Map<string, ModelDiscovery>();
    const discoveryRows = this.studioDb.db
      .prepare("SELECT * FROM model_discovery")
      .all() as Array<Record<string, unknown>>;
    for (const row of discoveryRows) {
      const discovery = mapDiscoveryRow(row);
      discoveryByModel.set(discovery.modelId, discovery);
    }

    return rows.map((r) => {
      const id = String(r.id);
      return {
        id,
        name: String(r.name),
        relativePath: String(r.relative_path),
        filePath: String(r.file_path),
        category: r.category as ModelCategory,
        architecture: r.architecture as ModelArchitecture,
        sizeBytes: Number(r.size_bytes),
        sha256: r.sha256 ? String(r.sha256) : null,
        sourceRoot: String(r.source_root),
        isDuplicate: Boolean(r.is_duplicate),
        duplicateOf: r.duplicate_of ? String(r.duplicate_of) : null,
        isIncomplete: Boolean(r.is_incomplete),
        compatibleWorkflows: safeParseJson<string[]>(String(r.compatible_workflows_json), []),
        license: r.license ? String(r.license) : null,
        description: r.description ? String(r.description) : null,
        installed: Boolean(r.installed),
        lastSeenAt: String(r.last_seen_at),
        metadata: metadataByModel.get(id) ?? null,
        discovery: discoveryByModel.get(id) ?? null,
      };
    });
  }

  getModelById(modelId: string): ModelRecord | null {
    return this.listModels().find((m) => m.id === modelId) ?? null;
  }

  updateModelMetadata(modelId: string, patch: ModelMetadataPatch): ModelRecord {
    const model = this.getModelById(modelId);
    if (!model) {
      throw new Error(`Unknown model id: ${modelId}`);
    }
    const now = new Date().toISOString();
    const existing = this.studioDb.db
      .prepare("SELECT * FROM model_metadata WHERE model_id = ?")
      .get(modelId) as Record<string, unknown> | undefined;
    const current = existing ? mapMetadataRow(existing) : null;

    const displayName =
      patch.displayName !== undefined ? patch.displayName : current?.displayName ?? null;
    const description =
      patch.description !== undefined ? patch.description : current?.description ?? "";
    const architectureOverride =
      patch.architectureOverride !== undefined
        ? patch.architectureOverride
        : current?.architectureOverride ?? null;
    const baseModel =
      patch.baseModel !== undefined ? patch.baseModel : current?.baseModel ?? null;
    const previewMode =
      patch.previewMode !== undefined ? patch.previewMode : current?.previewMode ?? "auto";
    const previewPath =
      patch.previewPath !== undefined ? patch.previewPath : current?.previewPath ?? null;
    const triggerWords =
      patch.triggerWords !== undefined ? patch.triggerWords : current?.triggerWords ?? [];
    const tags = patch.tags !== undefined ? patch.tags : current?.tags ?? [];
    const notes = patch.notes !== undefined ? patch.notes : current?.notes ?? "";
    const favorite =
      patch.favorite !== undefined ? patch.favorite : current?.favorite ?? false;

    this.studioDb.db
      .prepare(
        `INSERT INTO model_metadata (
           model_id, file_path, display_name, description, architecture_override,
           base_model, preview_mode, preview_path, trigger_words_json, tags_json,
           notes, favorite, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(model_id) DO UPDATE SET
           file_path = excluded.file_path,
           display_name = excluded.display_name,
           description = excluded.description,
           architecture_override = excluded.architecture_override,
           base_model = excluded.base_model,
           preview_mode = excluded.preview_mode,
           preview_path = excluded.preview_path,
           trigger_words_json = excluded.trigger_words_json,
           tags_json = excluded.tags_json,
           notes = excluded.notes,
           favorite = excluded.favorite,
           updated_at = excluded.updated_at`
      )
      .run(
        modelId,
        model.filePath,
        displayName,
        description,
        architectureOverride,
        baseModel,
        previewMode,
        previewPath,
        JSON.stringify(triggerWords),
        JSON.stringify(tags),
        notes,
        favorite ? 1 : 0,
        current?.createdAt ?? now,
        now
      );

    const updated = this.getModelById(modelId);
    if (!updated) {
      throw new Error(`Model disappeared while updating metadata: ${modelId}`);
    }
    return updated;
  }

  deleteModelRecord(filePath: string): void {
    this.studioDb.transaction(() => {
      this.studioDb.db.prepare("DELETE FROM models WHERE file_path = ?").run(filePath);
      this.studioDb.db
        .prepare("DELETE FROM model_metadata WHERE file_path = ?")
        .run(filePath);
      this.studioDb.db
        .prepare("DELETE FROM model_discovery WHERE file_path = ?")
        .run(filePath);
    });
  }

  listLoraRecipes(): LoraRecipe[] {
    const rows = this.studioDb.db
      .prepare("SELECT * FROM lora_recipes ORDER BY updated_at DESC")
      .all() as Array<Record<string, unknown>>;
    if (rows.length === 0) return [];

    const itemRows = this.studioDb.db
      .prepare("SELECT * FROM lora_recipe_items ORDER BY recipe_id, position ASC")
      .all() as Array<Record<string, unknown>>;
    const itemsByRecipe = new Map<string, LoraRecipeItem[]>();
    for (const row of itemRows) {
      const recipeId = String(row.recipe_id);
      const list = itemsByRecipe.get(recipeId) ?? [];
      list.push({
        position: Number(row.position),
        loraPath: String(row.lora_path),
        loraName: String(row.lora_name ?? ""),
        architecture: (row.architecture as ModelArchitecture) ?? "unknown",
        strengthModel: Number(row.strength_model ?? 0.85),
        strengthClip: Number(row.strength_clip ?? 0.85),
        enabled: Boolean(row.enabled),
        triggerWords: safeParseJson<string[]>(String(row.trigger_words_json), []),
      });
      itemsByRecipe.set(recipeId, list);
    }

    return rows.map((r) => {
      const id = String(r.id);
      return {
        id,
        name: String(r.name),
        description: String(r.description ?? ""),
        mode: r.mode as GenerationMode,
        workflowId: r.workflow_id ? String(r.workflow_id) : null,
        architecture: (r.architecture as ModelArchitecture) ?? "unknown",
        checkpointPath: r.checkpoint_path ? String(r.checkpoint_path) : null,
        checkpointName: r.checkpoint_name ? String(r.checkpoint_name) : null,
        basePrompt: String(r.base_prompt ?? ""),
        negativePrompt: String(r.negative_prompt ?? ""),
        settings: parseRecipeSettings(String(r.settings_json)),
        coverImagePath: r.cover_image_path ? String(r.cover_image_path) : null,
        tags: safeParseJson<string[]>(String(r.tags_json), []),
        favorite: Boolean(r.favorite),
        usageCount: Number(r.usage_count ?? 0),
        lastUsedAt: r.last_used_at ? String(r.last_used_at) : null,
        createdAt: String(r.created_at),
        updatedAt: String(r.updated_at),
        items: itemsByRecipe.get(id) ?? [],
      };
    });
  }

  saveLoraRecipe(input: LoraRecipeInput): LoraRecipe {
    const now = new Date().toISOString();
    const id = input.id ?? randomUUID();
    const existing = this.studioDb.db
      .prepare("SELECT created_at, usage_count, last_used_at FROM lora_recipes WHERE id = ?")
      .get(id) as
      | { created_at: string; usage_count: number; last_used_at: string | null }
      | undefined;

    const upsertRecipe = this.studioDb.db.prepare(
      `INSERT INTO lora_recipes (
         id, name, description, mode, workflow_id, architecture, checkpoint_path,
         checkpoint_name, base_prompt, negative_prompt, settings_json,
         cover_image_path, tags_json, favorite, usage_count, last_used_at,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         mode = excluded.mode,
         workflow_id = excluded.workflow_id,
         architecture = excluded.architecture,
         checkpoint_path = excluded.checkpoint_path,
         checkpoint_name = excluded.checkpoint_name,
         base_prompt = excluded.base_prompt,
         negative_prompt = excluded.negative_prompt,
         settings_json = excluded.settings_json,
         cover_image_path = excluded.cover_image_path,
         tags_json = excluded.tags_json,
         favorite = excluded.favorite,
         updated_at = excluded.updated_at`
    );

    const deleteItems = this.studioDb.db.prepare(
      "DELETE FROM lora_recipe_items WHERE recipe_id = ?"
    );
    const insertItem = this.studioDb.db.prepare(
      `INSERT INTO lora_recipe_items (
         recipe_id, position, lora_path, lora_name, architecture,
         strength_model, strength_clip, enabled, trigger_words_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const seenPaths = new Set<string>();

    this.studioDb.transaction(() => {
      upsertRecipe.run(
        id,
        input.name.trim(),
        input.description ?? "",
        input.mode ?? "txt2img",
        input.workflowId ?? null,
        input.architecture ?? "unknown",
        input.checkpointPath ?? null,
        input.checkpointName ?? null,
        input.basePrompt ?? "",
        input.negativePrompt ?? "",
        JSON.stringify(input.settings ?? {}),
        input.coverImagePath ?? null,
        JSON.stringify(input.tags ?? []),
        input.favorite ? 1 : 0,
        existing?.usage_count ?? 0,
        existing?.last_used_at ?? null,
        existing?.created_at ?? now,
        now
      );

      deleteItems.run(id);
      input.items.forEach((item, index) => {
        if (!item.loraPath || seenPaths.has(item.loraPath)) return;
        seenPaths.add(item.loraPath);
        insertItem.run(
          id,
          index,
          item.loraPath,
          item.loraName ?? "",
          item.architecture ?? input.architecture ?? "unknown",
          item.strengthModel ?? 0.85,
          item.strengthClip ?? 0.85,
          item.enabled === false ? 0 : 1,
          JSON.stringify(item.triggerWords ?? [])
        );
      });
    });

    const saved = this.listLoraRecipes().find((r) => r.id === id);
    if (!saved) {
      throw new Error(`Failed to persist LoRA recipe ${id}`);
    }
    return saved;
  }

  deleteLoraRecipe(id: string): void {
    this.studioDb.db.prepare("DELETE FROM lora_recipes WHERE id = ?").run(id);
  }

  markLoraRecipeUsed(id: string): void {
    const now = new Date().toISOString();
    this.studioDb.db
      .prepare(
        "UPDATE lora_recipes SET usage_count = usage_count + 1, last_used_at = ? WHERE id = ?"
      )
      .run(now, id);
  }


  upsertDownload(task: DownloadTask): void {
    this.studioDb.db
      .prepare(
        `INSERT INTO downloads (
          id, kind, title, url, target_path, category, source_name, license_name,
          expected_sha256, actual_sha256, total_bytes, downloaded_bytes, status, error,
          created_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          actual_sha256 = excluded.actual_sha256,
          total_bytes = excluded.total_bytes,
          downloaded_bytes = excluded.downloaded_bytes,
          status = excluded.status,
          error = excluded.error,
          completed_at = excluded.completed_at`
      )
      .run(
        task.id,
        task.kind,
        task.title,
        task.url,
        task.targetPath,
        task.category,
        task.sourceName,
        task.licenseName,
        task.expectedSha256,
        task.actualSha256,
        task.totalBytes,
        task.downloadedBytes,
        task.status,
        task.error,
        task.createdAt,
        task.completedAt
      );
  }

  listDownloads(limit = 50): DownloadTask[] {
    const rows = this.studioDb.db
      .prepare("SELECT * FROM downloads ORDER BY created_at DESC LIMIT ?")
      .all(limit) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: String(r.id),
      kind: r.kind as "comfy_runtime" | "model",
      title: String(r.title),
      url: String(r.url),
      targetPath: String(r.target_path),
      category: r.category as ModelCategory | "runtime",
      sourceName: String(r.source_name),
      licenseName: String(r.license_name),
      expectedSha256: r.expected_sha256 ? String(r.expected_sha256) : null,
      actualSha256: r.actual_sha256 ? String(r.actual_sha256) : null,
      totalBytes: Number(r.total_bytes ?? 0),
      downloadedBytes: Number(r.downloaded_bytes ?? 0),
      speedBytesPerSec: 0,
      etaSeconds: null,
      status: r.status as DownloadStatus,
      error: r.error ? String(r.error) : null,
      createdAt: String(r.created_at),
      completedAt: r.completed_at ? String(r.completed_at) : null,
    }));
  }
}
