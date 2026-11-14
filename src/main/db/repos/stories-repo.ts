import { randomUUID } from "node:crypto";
import {
  buildCanvasSyncPanels,
  normalizeCanvasOverlays,
  resolveCanvasPageDimensions,
} from "../../../shared/canvas-layout";
import type {
  GenerationJob,
  Story,
  StoryCanvas,
  StoryCanvasInput,
  StoryCanvasItem,
  StoryCanvasItemInput,
  StoryExportKind,
  StoryExportRecord,
  StoryCastMember,
  StoryInput,
  StoryScene,
  StorySceneCastInput,
  StorySceneCastMember,
  StorySceneInput,
  StorySceneStatus,
} from "../../../shared/types";
import type { StudioDatabase } from "../database";
import {
  mapCanvasItemRow,
  mapCanvasRow,
  mapStoryCastRow,
  mapStoryExportRow,
  mapStoryRow,
  mapStorySceneCastRow,
  mapStorySceneRow,
  numberOrNull,
  safeParseJson,
  stringOrNull,
} from "../repo-mappers";
import type { GenerationsRepository } from "./generations-repo";

export class StoriesRepository {
  constructor(
    private readonly studioDb: StudioDatabase,
    private readonly generations: GenerationsRepository
  ) {}

  listStories(): Story[] {
    const rows = this.studioDb.db
      .prepare("SELECT * FROM stories ORDER BY favorite DESC, updated_at DESC")
      .all() as Array<Record<string, unknown>>;
    if (rows.length === 0) return [];

    const castRows = this.studioDb.db
      .prepare("SELECT * FROM story_characters ORDER BY story_id, position ASC")
      .all() as Array<Record<string, unknown>>;
    const castByStory = new Map<string, StoryCastMember[]>();
    for (const row of castRows) {
      const member = mapStoryCastRow(row);
      const list = castByStory.get(String(row.story_id)) ?? [];
      list.push(member);
      castByStory.set(String(row.story_id), list);
    }

    const sceneCastRows = this.studioDb.db
      .prepare("SELECT * FROM story_scene_characters ORDER BY scene_id, position ASC")
      .all() as Array<Record<string, unknown>>;
    const castByScene = new Map<string, StorySceneCastMember[]>();
    for (const row of sceneCastRows) {
      const member = mapStorySceneCastRow(row);
      const list = castByScene.get(String(row.scene_id)) ?? [];
      list.push(member);
      castByScene.set(String(row.scene_id), list);
    }

    const sceneRows = this.studioDb.db
      .prepare("SELECT * FROM story_scenes ORDER BY story_id, position ASC")
      .all() as Array<Record<string, unknown>>;
    const scenesByStory = new Map<string, StoryScene[]>();
    for (const row of sceneRows) {
      const storyId = String(row.story_id);
      const scene = mapStorySceneRow(
        row,
        castByScene.get(String(row.id)) ?? []
      );
      const list = scenesByStory.get(storyId) ?? [];
      list.push(scene);
      scenesByStory.set(storyId, list);
    }

    return rows.map((row) => {
      const id = String(row.id);
      return mapStoryRow(row, castByStory.get(id) ?? [], scenesByStory.get(id) ?? []);
    });
  }

  getStoryById(id: string): Story | null {
    return this.listStories().find((story) => story.id === id) ?? null;
  }

  saveStory(input: StoryInput): Story {
    const now = new Date().toISOString();
    const id = input.id ?? randomUUID();
    const existing = this.studioDb.db
      .prepare(
        `SELECT created_at, logline, style_prompt, negative_prompt,
                default_character_id, default_checkpoint_path,
                default_lora_recipe_id, cover_scene_id, status, tags_json, favorite
         FROM stories WHERE id = ?`
      )
      .get(id) as
      | {
          created_at: string;
          logline: string;
          style_prompt: string;
          negative_prompt: string;
          default_character_id: string | null;
          default_checkpoint_path: string | null;
          default_lora_recipe_id: string | null;
          cover_scene_id: string | null;
          status: string;
          tags_json: string;
          favorite: number;
        }
      | undefined;

    if (input.coverSceneId) {
      const ownScene = this.studioDb.db
        .prepare("SELECT 1 FROM story_scenes WHERE id = ? AND story_id = ?")
        .get(input.coverSceneId, id);
      if (!ownScene) {
        throw new Error("Cover scene must belong to this story.");
      }
    }

    const upsert = this.studioDb.db.prepare(
      `INSERT INTO stories (
         id, title, logline, style_prompt, negative_prompt, default_character_id,
         default_checkpoint_path, default_lora_recipe_id, cover_scene_id, status,
         tags_json, favorite, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         logline = excluded.logline,
         style_prompt = excluded.style_prompt,
         negative_prompt = excluded.negative_prompt,
         default_character_id = excluded.default_character_id,
         default_checkpoint_path = excluded.default_checkpoint_path,
         default_lora_recipe_id = excluded.default_lora_recipe_id,
         cover_scene_id = excluded.cover_scene_id,
         status = excluded.status,
         tags_json = excluded.tags_json,
         favorite = excluded.favorite,
         updated_at = excluded.updated_at`
    );

    const deleteCast = this.studioDb.db.prepare(
      "DELETE FROM story_characters WHERE story_id = ?"
    );
    const insertCast = this.studioDb.db.prepare(
      `INSERT INTO story_characters (story_id, character_id, position, story_role)
       VALUES (?, ?, ?, ?)`
    );

    this.studioDb.transaction(() => {
      upsert.run(
        id,
        input.title.trim(),
        input.logline ?? existing?.logline ?? "",
        input.stylePrompt ?? existing?.style_prompt ?? "",
        input.negativePrompt ?? existing?.negative_prompt ?? "",
        input.defaultCharacterId !== undefined
          ? input.defaultCharacterId
          : existing?.default_character_id ?? null,
        input.defaultCheckpointPath !== undefined
          ? input.defaultCheckpointPath
          : existing?.default_checkpoint_path ?? null,
        input.defaultLoraRecipeId !== undefined
          ? input.defaultLoraRecipeId
          : existing?.default_lora_recipe_id ?? null,
        input.coverSceneId !== undefined
          ? input.coverSceneId
          : existing?.cover_scene_id ?? null,
        input.status ?? existing?.status ?? "draft",
        JSON.stringify(
          input.tags !== undefined
            ? input.tags
            : (safeParseJson(existing?.tags_json ?? "[]", []) as string[])
        ),
        input.favorite !== undefined
          ? input.favorite
            ? 1
            : 0
          : existing?.favorite ?? 0,
        existing?.created_at ?? now,
        now
      );

      if (input.cast !== undefined) {
        deleteCast.run(id);
        const seen = new Set<string>();
        let position = 0;
        for (const member of input.cast) {
          if (seen.has(member.characterId)) continue;
          seen.add(member.characterId);
          insertCast.run(
            id,
            member.characterId,
            position++,
            member.storyRole ?? "supporting"
          );
        }
      }
    });

    const saved = this.getStoryById(id);
    if (!saved) {
      throw new Error(`Failed to persist story ${id}`);
    }
    return saved;
  }

  deleteStory(id: string): boolean {
    const result = this.studioDb.db.prepare("DELETE FROM stories WHERE id = ?").run(id);
    return result.changes > 0;
  }

  saveStoryScene(input: StorySceneInput): Story {
    const story = this.getStoryById(input.storyId);
    if (!story) {
      throw new Error(`Unknown story id: ${input.storyId}`);
    }

    if (input.id) {
      const owner = this.studioDb.db
        .prepare("SELECT story_id FROM story_scenes WHERE id = ?")
        .get(input.id) as { story_id: string } | undefined;
      if (owner && owner.story_id !== input.storyId) {
        throw new Error("Scene does not belong to this story.");
      }
    }

    const id = input.id ?? randomUUID();
    const now = new Date().toISOString();
    const existing = this.studioDb.db
      .prepare(
        "SELECT position, created_at FROM story_scenes WHERE id = ? AND story_id = ?"
      )
      .get(id, input.storyId) as
      | { position: number; created_at: string }
      | undefined;
    const nextPosition = this.studioDb.db
      .prepare(
        "SELECT COALESCE(MAX(position), -1) + 1 AS next FROM story_scenes WHERE story_id = ?"
      )
      .get(input.storyId) as { next: number };
    const position = existing?.position ?? nextPosition.next;

    this.studioDb.db
      .prepare(
        `INSERT INTO story_scenes (
           id, story_id, position, title, synopsis, prompt, negative_prompt,
           checkpoint_path, lora_recipe_id, aspect_ratio, width, height, steps,
           cfg, sampler, scheduler, seed, denoise, reference_mode_override,
           batch_count, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           synopsis = excluded.synopsis,
           prompt = excluded.prompt,
           negative_prompt = excluded.negative_prompt,
           checkpoint_path = excluded.checkpoint_path,
           lora_recipe_id = excluded.lora_recipe_id,
           aspect_ratio = excluded.aspect_ratio,
           width = excluded.width,
           height = excluded.height,
           steps = excluded.steps,
           cfg = excluded.cfg,
           sampler = excluded.sampler,
           scheduler = excluded.scheduler,
           seed = excluded.seed,
           denoise = excluded.denoise,
           reference_mode_override = excluded.reference_mode_override,
           batch_count = excluded.batch_count,
           updated_at = excluded.updated_at`
      )
      .run(
        id,
        input.storyId,
        position,
        input.title ?? "",
        input.synopsis ?? "",
        input.prompt ?? "",
        input.negativePrompt ?? "",
        input.checkpointPath ?? null,
        input.loraRecipeId ?? null,
        input.aspectRatio ?? null,
        input.width ?? null,
        input.height ?? null,
        input.steps ?? null,
        input.cfg ?? null,
        input.sampler ?? null,
        input.scheduler ?? null,
        input.seed ?? -1,
        input.denoise ?? null,
        input.referenceModeOverride ?? null,
        input.batchCount ?? 1,
        existing?.created_at ?? now,
        now
      );

    if (input.cast !== undefined) {
      this.studioDb.transaction(() => {
        this.replaceSceneCast(id, input.cast ?? []);
        this.studioDb.db
          .prepare("UPDATE stories SET updated_at = ? WHERE id = ?")
          .run(now, input.storyId);
      });
    } else {
      this.studioDb.db
        .prepare("UPDATE stories SET updated_at = ? WHERE id = ?")
        .run(now, input.storyId);
    }

    const saved = this.getStoryById(input.storyId);
    if (!saved) {
      throw new Error(`Failed to reload story ${input.storyId}`);
    }
    return saved;
  }

  deleteStoryScene(storyId: string, sceneId: string): Story | null {
    const scene = this.studioDb.db
      .prepare("SELECT id FROM story_scenes WHERE id = ? AND story_id = ?")
      .get(sceneId, storyId);
    if (!scene) return null;

    const now = new Date().toISOString();
    this.studioDb.transaction(() => {
      this.studioDb.db
        .prepare("DELETE FROM story_scenes WHERE id = ? AND story_id = ?")
        .run(sceneId, storyId);
      this.studioDb.db
        .prepare("UPDATE story_scenes SET position = position + 10000 WHERE story_id = ?")
        .run(storyId);
      const remaining = this.studioDb.db
        .prepare("SELECT id FROM story_scenes WHERE story_id = ? ORDER BY position ASC")
        .all(storyId) as Array<{ id: string }>;
      const setPosition = this.studioDb.db.prepare(
        "UPDATE story_scenes SET position = ? WHERE id = ?"
      );
      remaining.forEach((row, index) => setPosition.run(index, row.id));
      this.studioDb.db
        .prepare("UPDATE stories SET cover_scene_id = NULL WHERE id = ? AND cover_scene_id = ?")
        .run(storyId, sceneId);
      this.studioDb.db
        .prepare("UPDATE stories SET updated_at = ? WHERE id = ?")
        .run(now, storyId);
    });

    return this.getStoryById(storyId);
  }

  reorderStoryScenes(storyId: string, sceneIds: string[]): Story | null {
    if (!this.getStoryById(storyId)) return null;
    const existing = this.studioDb.db
      .prepare("SELECT id FROM story_scenes WHERE story_id = ? ORDER BY position ASC")
      .all(storyId) as Array<{ id: string }>;
    const existingIds = existing.map((row) => row.id);
    const known = new Set(existingIds);
    const ordered = sceneIds.filter((id) => known.has(id));
    for (const id of existingIds) {
      if (!ordered.includes(id)) ordered.push(id);
    }

    const now = new Date().toISOString();
    this.studioDb.transaction(() => {
      this.studioDb.db
        .prepare("UPDATE story_scenes SET position = position + 10000 WHERE story_id = ?")
        .run(storyId);
      const setPosition = this.studioDb.db.prepare(
        "UPDATE story_scenes SET position = ? WHERE id = ? AND story_id = ?"
      );
      ordered.forEach((id, index) => setPosition.run(index, id, storyId));
      this.studioDb.db
        .prepare("UPDATE stories SET updated_at = ? WHERE id = ?")
        .run(now, storyId);
    });

    return this.getStoryById(storyId);
  }

  setStorySceneCast(
    storyId: string,
    sceneId: string,
    cast: StorySceneCastInput[]
  ): Story | null {
    const scene = this.studioDb.db
      .prepare("SELECT id FROM story_scenes WHERE id = ? AND story_id = ?")
      .get(sceneId, storyId);
    if (!scene) return null;
    const now = new Date().toISOString();
    this.studioDb.transaction(() => {
      this.replaceSceneCast(sceneId, cast);
      this.studioDb.db
        .prepare("UPDATE story_scenes SET updated_at = ? WHERE id = ?")
        .run(now, sceneId);
      this.studioDb.db
        .prepare("UPDATE stories SET updated_at = ? WHERE id = ?")
        .run(now, storyId);
    });
    return this.getStoryById(storyId);
  }

  selectStorySceneImage(
    storyId: string,
    sceneId: string,
    imageId: string | null
  ): Story | null {
    const scene = this.studioDb.db
      .prepare("SELECT id FROM story_scenes WHERE id = ? AND story_id = ?")
      .get(sceneId, storyId);
    if (!scene) return null;
    if (imageId && !this.generations.getImageById(imageId)) {
      throw new Error(`Unknown image id: ${imageId}`);
    }
    const now = new Date().toISOString();
    this.studioDb.transaction(() => {
      this.studioDb.db
        .prepare(
          `UPDATE story_scenes
           SET selected_image_id = ?, status = ?, updated_at = ?
           WHERE id = ? AND story_id = ?`
        )
        .run(imageId, imageId ? "completed" : "draft", now, sceneId, storyId);
      this.studioDb.db
        .prepare("UPDATE stories SET updated_at = ? WHERE id = ?")
        .run(now, storyId);
    });
    return this.getStoryById(storyId);
  }

  markStoryInProgress(storyId: string): void {
    const now = new Date().toISOString();
    this.studioDb.db
      .prepare(
        `UPDATE stories
         SET status = CASE WHEN status = 'draft' THEN 'in_progress' ELSE status END,
             updated_at = ?
         WHERE id = ?`
      )
      .run(now, storyId);
  }

  listCanvases(storyId?: string): StoryCanvas[] {
    const rows = (storyId
      ? this.studioDb.db
          .prepare(
            "SELECT * FROM story_canvases WHERE story_id = ? ORDER BY updated_at DESC"
          )
          .all(storyId)
      : this.studioDb.db
          .prepare("SELECT * FROM story_canvases ORDER BY updated_at DESC")
          .all()) as Array<Record<string, unknown>>;
    if (rows.length === 0) return [];

    const itemRows = this.studioDb.db
      .prepare("SELECT * FROM story_canvas_items ORDER BY canvas_id, position ASC")
      .all() as Array<Record<string, unknown>>;
    const itemsByCanvas = new Map<string, StoryCanvasItem[]>();
    for (const row of itemRows) {
      const canvasId = String(row.canvas_id);
      const list = itemsByCanvas.get(canvasId) ?? [];
      list.push(mapCanvasItemRow(row));
      itemsByCanvas.set(canvasId, list);
    }

    return rows.map((row) => {
      const id = String(row.id);
      return mapCanvasRow(row, itemsByCanvas.get(id) ?? []);
    });
  }

  getCanvasById(id: string): StoryCanvas | null {
    const row = this.studioDb.db
      .prepare("SELECT * FROM story_canvases WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    const itemRows = this.studioDb.db
      .prepare("SELECT * FROM story_canvas_items WHERE canvas_id = ? ORDER BY position ASC")
      .all(id) as Array<Record<string, unknown>>;
    return mapCanvasRow(row, itemRows.map(mapCanvasItemRow));
  }

  saveCanvas(input: StoryCanvasInput): StoryCanvas {
    const story = this.studioDb.db
      .prepare("SELECT id FROM stories WHERE id = ?")
      .get(input.storyId);
    if (!story) {
      throw new Error(`Unknown story id: ${input.storyId}`);
    }

    const id = input.id ?? randomUUID();
    const existing = this.studioDb.db
      .prepare("SELECT * FROM story_canvases WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    if (existing && String(existing.story_id) !== input.storyId) {
      throw new Error("Canvas does not belong to this story.");
    }

    const name = input.name.trim();
    if (!name) {
      throw new Error("Canvas name is required.");
    }
    const duplicate = this.studioDb.db
      .prepare(
        "SELECT id FROM story_canvases WHERE story_id = ? AND name = ? AND id <> ?"
      )
      .get(input.storyId, name, id) as { id: string } | undefined;
    if (duplicate) {
      throw new Error("A canvas with that name already exists for this story.");
    }

    const template =
      input.template ?? (existing?.template as StoryCanvas["template"]) ?? "grid_2x3";
    const pageSize =
      input.pageSize ??
      (existing?.page_size as StoryCanvas["pageSize"]) ??
      "a4_landscape";
    const dimensions = resolveCanvasPageDimensions(
      pageSize,
      input.pageWidth ?? (existing?.page_width as number | undefined),
      input.pageHeight ?? (existing?.page_height as number | undefined)
    );
    const margin = Math.max(
      0,
      Math.min(
        240,
        Math.round(
          input.margin ?? (existing?.margin as number | undefined) ?? 32
        )
      )
    );
    const gutter = Math.max(
      0,
      Math.min(
        120,
        Math.round(
          input.gutter ?? (existing?.gutter as number | undefined) ?? 16
        )
      )
    );
    const background =
      input.background ??
      (existing?.background as string | undefined) ??
      "#0B0B0F";
    const captionMode =
      input.captionMode ??
      (existing?.caption_mode as StoryCanvas["captionMode"]) ??
      "scene_title";
    const settings = JSON.stringify(
      input.settings !== undefined
        ? input.settings
        : safeParseJson<Record<string, unknown>>(
            String(existing?.settings_json ?? "{}"),
            {}
          )
    );
    const now = new Date().toISOString();

    this.studioDb.db
      .prepare(
        `INSERT INTO story_canvases (
           id, story_id, name, template, page_size, page_width, page_height,
           margin, gutter, background, caption_mode, settings_json,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           template = excluded.template,
           page_size = excluded.page_size,
           page_width = excluded.page_width,
           page_height = excluded.page_height,
           margin = excluded.margin,
           gutter = excluded.gutter,
           background = excluded.background,
           caption_mode = excluded.caption_mode,
           settings_json = excluded.settings_json,
           updated_at = excluded.updated_at`
      )
      .run(
        id,
        input.storyId,
        name,
        template,
        pageSize,
        dimensions.width,
        dimensions.height,
        margin,
        gutter,
        background,
        captionMode,
        settings,
        existing ? String(existing.created_at) : now,
        now
      );

    const saved = this.getCanvasById(id);
    if (!saved) throw new Error(`Failed to persist canvas ${id}`);
    return saved;
  }

  deleteCanvas(id: string): boolean {
    const result = this.studioDb.db
      .prepare("DELETE FROM story_canvases WHERE id = ?")
      .run(id);
    return result.changes > 0;
  }

  saveCanvasItem(input: StoryCanvasItemInput): StoryCanvas {
    const canvas = this.getCanvasById(input.canvasId);
    if (!canvas) {
      throw new Error(`Unknown canvas id: ${input.canvasId}`);
    }

    const existing = input.id
      ? (this.studioDb.db
          .prepare(
            "SELECT * FROM story_canvas_items WHERE id = ? AND canvas_id = ?"
          )
          .get(input.id, input.canvasId) as Record<string, unknown> | undefined)
      : undefined;
    if (input.id && !existing) {
      throw new Error("Canvas panel not found.");
    }

    const sceneId =
      input.sceneId !== undefined
        ? input.sceneId
        : (stringOrNull(existing?.scene_id) as string | null);
    if (sceneId) {
      const ownScene = this.studioDb.db
        .prepare("SELECT 1 FROM story_scenes WHERE id = ? AND story_id = ?")
        .get(sceneId, canvas.storyId);
      if (!ownScene) {
        throw new Error("Panel scene must belong to this story.");
      }
    }

    const imageId =
      input.imageId !== undefined
        ? input.imageId
        : (stringOrNull(existing?.image_id) as string | null);
    if (imageId && !this.generations.getImageById(imageId)) {
      throw new Error(`Unknown image id: ${imageId}`);
    }

    const id = input.id ?? randomUUID();
    const nextPosition = this.studioDb.db
      .prepare(
        "SELECT COALESCE(MAX(position), -1) + 1 AS next FROM story_canvas_items WHERE canvas_id = ?"
      )
      .get(input.canvasId) as { next: number };
    const position = existing ? Number(existing.position) : nextPosition.next;

    const normalizeNormalized = (
      value: number | null | undefined,
      fallback: number | null,
      min: number
    ): number | null => {
      if (value === undefined) return fallback;
      if (value === null) return null;
      if (!Number.isFinite(value)) return fallback;
      return Math.min(1, Math.max(min, value));
    };

    const x = normalizeNormalized(
      input.x,
      numberOrNull(existing?.x),
      0
    );
    const y = normalizeNormalized(
      input.y,
      numberOrNull(existing?.y),
      0
    );
    const width = normalizeNormalized(
      input.width,
      numberOrNull(existing?.width),
      0.02
    );
    const height = normalizeNormalized(
      input.height,
      numberOrNull(existing?.height),
      0.02
    );

    const overlays =
      input.overlays !== undefined
        ? normalizeCanvasOverlays(input.overlays)
        : normalizeCanvasOverlays(
            safeParseJson<unknown>(String(existing?.overlays_json ?? "[]"), [])
          );

    const now = new Date().toISOString();
    this.studioDb.transaction(() => {
      this.studioDb.db
        .prepare(
          `INSERT INTO story_canvas_items (
             id, canvas_id, scene_id, image_id, position, x, y, width, height,
             fit, caption_override, overlays_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             scene_id = excluded.scene_id,
             image_id = excluded.image_id,
             x = excluded.x,
             y = excluded.y,
             width = excluded.width,
             height = excluded.height,
             fit = excluded.fit,
             caption_override = excluded.caption_override,
             overlays_json = excluded.overlays_json`
        )
        .run(
          id,
          input.canvasId,
          sceneId,
          imageId,
          position,
          x,
          y,
          width,
          height,
          input.fit ?? (existing?.fit as StoryCanvas["items"][number]["fit"]) ?? "cover",
          input.captionOverride ??
            (existing?.caption_override as string | undefined) ??
            "",
          JSON.stringify(overlays)
        );
      this.studioDb.db
        .prepare("UPDATE story_canvases SET updated_at = ? WHERE id = ?")
        .run(now, input.canvasId);
    });

    const saved = this.getCanvasById(input.canvasId);
    if (!saved) throw new Error(`Failed to reload canvas ${input.canvasId}`);
    return saved;
  }

  deleteCanvasItem(canvasId: string, itemId: string): StoryCanvas | null {
    const existing = this.studioDb.db
      .prepare(
        "SELECT id FROM story_canvas_items WHERE id = ? AND canvas_id = ?"
      )
      .get(itemId, canvasId);
    if (!existing) return null;

    const now = new Date().toISOString();
    this.studioDb.transaction(() => {
      this.studioDb.db
        .prepare("DELETE FROM story_canvas_items WHERE id = ? AND canvas_id = ?")
        .run(itemId, canvasId);
      this.studioDb.db
        .prepare(
          "UPDATE story_canvas_items SET position = position + 10000 WHERE canvas_id = ?"
        )
        .run(canvasId);
      const remaining = this.studioDb.db
        .prepare(
          "SELECT id FROM story_canvas_items WHERE canvas_id = ? ORDER BY position ASC"
        )
        .all(canvasId) as Array<{ id: string }>;
      const setPosition = this.studioDb.db.prepare(
        "UPDATE story_canvas_items SET position = ? WHERE id = ?"
      );
      remaining.forEach((row, index) => setPosition.run(index, row.id));
      this.studioDb.db
        .prepare("UPDATE story_canvases SET updated_at = ? WHERE id = ?")
        .run(now, canvasId);
    });
    return this.getCanvasById(canvasId);
  }

  reorderCanvasItems(canvasId: string, itemIds: string[]): StoryCanvas | null {
    if (!this.getCanvasById(canvasId)) return null;
    const existing = this.studioDb.db
      .prepare(
        "SELECT id FROM story_canvas_items WHERE canvas_id = ? ORDER BY position ASC"
      )
      .all(canvasId) as Array<{ id: string }>;
    const existingIds = existing.map((row) => row.id);
    const known = new Set(existingIds);
    const ordered = itemIds.filter((id) => known.has(id));
    for (const id of existingIds) {
      if (!ordered.includes(id)) ordered.push(id);
    }

    const now = new Date().toISOString();
    this.studioDb.transaction(() => {
      this.studioDb.db
        .prepare(
          "UPDATE story_canvas_items SET position = position + 10000 WHERE canvas_id = ?"
        )
        .run(canvasId);
      const setPosition = this.studioDb.db.prepare(
        "UPDATE story_canvas_items SET position = ? WHERE id = ? AND canvas_id = ?"
      );
      ordered.forEach((id, index) => setPosition.run(index, id, canvasId));
      this.studioDb.db
        .prepare("UPDATE story_canvases SET updated_at = ? WHERE id = ?")
        .run(now, canvasId);
    });
    return this.getCanvasById(canvasId);
  }

  syncCanvasFromStory(canvasId: string): StoryCanvas | null {
    const canvas = this.getCanvasById(canvasId);
    if (!canvas) return null;
    const story = this.getStoryById(canvas.storyId);
    if (!story) return null;

    const plan = buildCanvasSyncPanels(story, this.generations.listImages());
    const existingRows = this.studioDb.db
      .prepare(
        "SELECT * FROM story_canvas_items WHERE canvas_id = ? ORDER BY position ASC"
      )
      .all(canvasId) as Array<Record<string, unknown>>;
    const existingByScene = new Map<string, Record<string, unknown>>();
    for (const row of existingRows) {
      if (row.scene_id && !existingByScene.has(String(row.scene_id))) {
        existingByScene.set(String(row.scene_id), row);
      }
    }

    const plannedSceneIds = new Set(plan.map((panel) => panel.sceneId));
    const now = new Date().toISOString();

    this.studioDb.transaction(() => {
      this.studioDb.db
        .prepare(
          "UPDATE story_canvas_items SET position = position + 10000 WHERE canvas_id = ?"
        )
        .run(canvasId);
      const updateExisting = this.studioDb.db.prepare(
        `UPDATE story_canvas_items
         SET position = ?, image_id = ?
         WHERE id = ? AND canvas_id = ?`
      );
      const insert = this.studioDb.db.prepare(
        `INSERT INTO story_canvas_items (
           id, canvas_id, scene_id, image_id, position, fit, caption_override,
           overlays_json
         ) VALUES (?, ?, ?, ?, ?, 'cover', '', '[]')`
      );

      plan.forEach((panel, index) => {
        const existing = existingByScene.get(panel.sceneId);
        if (existing) {
          updateExisting.run(index, panel.imageId, String(existing.id), canvasId);
        } else {
          insert.run(
            randomUUID(),
            canvasId,
            panel.sceneId,
            panel.imageId,
            index
          );
        }
      });

      for (const row of existingRows) {
        const sceneId = stringOrNull(row.scene_id);
        if (!sceneId || !plannedSceneIds.has(sceneId)) {
          this.studioDb.db
            .prepare("DELETE FROM story_canvas_items WHERE id = ?")
            .run(String(row.id));
        }
      }

      this.studioDb.db
        .prepare("UPDATE story_canvases SET updated_at = ? WHERE id = ?")
        .run(now, canvasId);
    });

    return this.getCanvasById(canvasId);
  }

  recordStoryExport(input: {
    storyId: string | null;
    canvasId: string | null;
    kind: StoryExportKind;
    filePath: string;
    width: number;
    height: number;
    pageCount: number;
    sizeBytes: number;
    settings?: Record<string, unknown>;
  }): StoryExportRecord {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.studioDb.db
      .prepare(
        `INSERT INTO story_exports (
           id, story_id, canvas_id, kind, file_path, width, height,
           page_count, size_bytes, settings_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.storyId,
        input.canvasId,
        input.kind,
        input.filePath,
        input.width,
        input.height,
        input.pageCount,
        input.sizeBytes,
        JSON.stringify(input.settings ?? {}),
        now
      );
    const row = this.studioDb.db
      .prepare("SELECT * FROM story_exports WHERE id = ?")
      .get(id) as Record<string, unknown>;
    return mapStoryExportRow(row);
  }

  listStoryExports(storyId?: string, limit = 100): StoryExportRecord[] {
    const rows = (storyId
      ? this.studioDb.db
          .prepare(
            "SELECT * FROM story_exports WHERE story_id = ? ORDER BY created_at DESC LIMIT ?"
          )
          .all(storyId, limit)
      : this.studioDb.db
          .prepare("SELECT * FROM story_exports ORDER BY created_at DESC LIMIT ?")
          .all(limit)) as Array<Record<string, unknown>>;
    return rows.map(mapStoryExportRow);
  }

  private replaceSceneCast(sceneId: string, cast: StorySceneCastInput[]): void {
    this.studioDb.db
      .prepare("DELETE FROM story_scene_characters WHERE scene_id = ?")
      .run(sceneId);
    const insert = this.studioDb.db.prepare(
      `INSERT INTO story_scene_characters (scene_id, character_id, position, role_hint)
       VALUES (?, ?, ?, ?)`
    );
    const seen = new Set<string>();
    let position = 0;
    for (const member of cast) {
      if (seen.has(member.characterId)) continue;
      seen.add(member.characterId);
      insert.run(sceneId, member.characterId, position++, member.roleHint ?? "");
    }
  }

  syncStorySceneFromJob(job: GenerationJob): void {
    const sceneId = job.storySceneId ?? job.settings?.storySceneId ?? null;
    if (!sceneId) return;
    const storyId = job.storyId ?? job.settings?.storyId ?? null;
    const statusMap: Partial<Record<GenerationJob["status"], StorySceneStatus>> = {
      IDLE: "queued",
      VALIDATING: "queued",
      SUBMITTING: "queued",
      QUEUED: "queued",
      RUNNING: "generating",
      PROCESSING_OUTPUT: "generating",
      COMPLETED: "completed",
      FAILED: "failed",
      CANCELLED: "failed",
    };
    const status = statusMap[job.status];
    if (!status) return;
    const now = new Date().toISOString();
    this.studioDb.db
      .prepare(
        `UPDATE story_scenes
         SET status = ?, last_job_id = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(status, job.id, now, sceneId);
    if (status === "completed" && storyId) {
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

}
