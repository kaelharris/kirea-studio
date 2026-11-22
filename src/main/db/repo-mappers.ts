import type {
  CharacterProfile,
  CharacterReference,
  CharacterReferenceMode,
  CharacterReferenceRole,
  LoraRecipeItem,
  LoraRecipeSettings,
  ModelArchitecture,
  ModelDiscovery,
  ModelMetadata,
  ModelSource,
  Story,
  StoryCanvas,
  StoryCanvasItem,
  StoryCastMember,
  StoryCastRole,
  StoryExportKind,
  StoryExportRecord,
  StoryScene,
  StorySceneCastMember,
  StorySceneStatus,
} from "../../shared/types";
import { normalizeCanvasOverlays } from "../../shared/canvas-layout";

export function safeParseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function mapMetadataRow(r: Record<string, unknown>): ModelMetadata {
  return {
    modelId: String(r.model_id),
    filePath: String(r.file_path),
    displayName: r.display_name ? String(r.display_name) : null,
    description: String(r.description ?? ""),
    architectureOverride: r.architecture_override
      ? (String(r.architecture_override) as ModelArchitecture)
      : null,
    baseModel: r.base_model ? String(r.base_model) : null,
    previewMode: (r.preview_mode as ModelMetadata["previewMode"]) ?? "auto",
    previewPath: r.preview_path ? String(r.preview_path) : null,
    triggerWords: safeParseJson<string[]>(String(r.trigger_words_json), []),
    tags: safeParseJson<string[]>(String(r.tags_json), []),
    notes: String(r.notes ?? ""),
    favorite: Boolean(r.favorite),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export function mapDiscoveryRow(r: Record<string, unknown>): ModelDiscovery {
  return {
    modelId: String(r.model_id),
    filePath: String(r.file_path),
    description: r.description ? String(r.description) : null,
    baseModel: r.base_model ? String(r.base_model) : null,
    previewPath: r.preview_path ? String(r.preview_path) : null,
    triggerWords: safeParseJson<string[]>(String(r.trigger_words_json), []),
    source: safeParseJson<ModelSource | null>(
      r.source_json ? String(r.source_json) : null,
      null
    ),
    embeddedTitle: r.embedded_title ? String(r.embedded_title) : null,
    discoveredAt: String(r.discovered_at),
  };
}

export function parseRecipeSettings(raw: string | null | undefined): LoraRecipeSettings {
  return safeParseJson<LoraRecipeSettings>(raw, {});
}

export function mapCharacterReferenceRow(r: Record<string, unknown>): CharacterReference {
  return {
    id: String(r.id),
    characterId: String(r.character_id),
    role: (r.role as CharacterReferenceRole) ?? "secondary",
    filePath: String(r.file_path),
    sourcePath: r.source_path ? String(r.source_path) : null,
    caption: String(r.caption ?? ""),
    weight: Number(r.weight ?? 1),
    position: Number(r.position ?? 0),
    createdAt: String(r.created_at),
  };
}

export function mapCharacterRow(
  r: Record<string, unknown>,
  references: CharacterReference[]
): CharacterProfile {
  return {
    id: String(r.id),
    name: String(r.name),
    description: String(r.description ?? ""),
    appearance: String(r.appearance ?? ""),
    clothing: String(r.clothing ?? ""),
    promptPrefix: String(r.prompt_prefix ?? ""),
    negativePrompt: String(r.negative_prompt ?? ""),
    triggerWords: safeParseJson<string[]>(String(r.trigger_words_json), []),
    architecture: (r.architecture as ModelArchitecture) ?? "unknown",
    checkpointPath: r.checkpoint_path ? String(r.checkpoint_path) : null,
    checkpointName: r.checkpoint_name ? String(r.checkpoint_name) : null,
    loraRecipeId: r.lora_recipe_id ? String(r.lora_recipe_id) : null,
    referenceMode: (r.reference_mode as CharacterReferenceMode) ?? "none",
    referenceWeight: Number(r.reference_weight ?? 0.75),
    referenceStart: Number(r.reference_start ?? 0),
    referenceEnd: Number(r.reference_end ?? 1),
    tags: safeParseJson<string[]>(String(r.tags_json), []),
    favorite: Boolean(r.favorite),
    usageCount: Number(r.usage_count ?? 0),
    lastUsedAt: r.last_used_at ? String(r.last_used_at) : null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    references,
  };
}

export function numberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

export function stringOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

export function mapStoryCastRow(r: Record<string, unknown>): StoryCastMember {
  return {
    characterId: String(r.character_id),
    position: Number(r.position ?? 0),
    storyRole: (r.story_role as StoryCastRole) ?? "supporting",
  };
}

export function mapStorySceneCastRow(r: Record<string, unknown>): StorySceneCastMember {
  return {
    characterId: String(r.character_id),
    position: Number(r.position ?? 0),
    roleHint: String(r.role_hint ?? ""),
  };
}

export function mapStorySceneRow(
  r: Record<string, unknown>,
  cast: StorySceneCastMember[]
): StoryScene {
  return {
    id: String(r.id),
    storyId: String(r.story_id),
    position: Number(r.position ?? 0),
    title: String(r.title ?? ""),
    synopsis: String(r.synopsis ?? ""),
    prompt: String(r.prompt ?? ""),
    negativePrompt: String(r.negative_prompt ?? ""),
    checkpointPath: stringOrNull(r.checkpoint_path),
    loraRecipeId: stringOrNull(r.lora_recipe_id),
    aspectRatio: stringOrNull(r.aspect_ratio),
    width: numberOrNull(r.width),
    height: numberOrNull(r.height),
    steps: numberOrNull(r.steps),
    cfg: numberOrNull(r.cfg),
    sampler: stringOrNull(r.sampler),
    scheduler: stringOrNull(r.scheduler),
    seed: Number(r.seed ?? -1),
    denoise: numberOrNull(r.denoise),
    referenceModeOverride: (r.reference_mode_override as StoryScene["referenceModeOverride"]) ?? null,
    batchCount: Number(r.batch_count ?? 1),
    status: (r.status as StorySceneStatus) ?? "draft",
    lastJobId: stringOrNull(r.last_job_id),
    selectedImageId: stringOrNull(r.selected_image_id),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    cast,
  };
}

export function mapStoryRow(
  r: Record<string, unknown>,
  cast: StoryCastMember[],
  scenes: StoryScene[]
): Story {
  return {
    id: String(r.id),
    title: String(r.title),
    logline: String(r.logline ?? ""),
    stylePrompt: String(r.style_prompt ?? ""),
    negativePrompt: String(r.negative_prompt ?? ""),
    defaultCharacterId: stringOrNull(r.default_character_id),
    defaultCheckpointPath: stringOrNull(r.default_checkpoint_path),
    defaultLoraRecipeId: stringOrNull(r.default_lora_recipe_id),
    coverSceneId: stringOrNull(r.cover_scene_id),
    status: (r.status as Story["status"]) ?? "draft",
    tags: safeParseJson<string[]>(String(r.tags_json), []),
    favorite: Boolean(r.favorite),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    cast,
    scenes,
  };
}

export function mapCanvasItemRow(r: Record<string, unknown>): StoryCanvasItem {
  return {
    id: String(r.id),
    canvasId: String(r.canvas_id),
    sceneId: stringOrNull(r.scene_id),
    imageId: stringOrNull(r.image_id),
    position: Number(r.position ?? 0),
    x: numberOrNull(r.x),
    y: numberOrNull(r.y),
    width: numberOrNull(r.width),
    height: numberOrNull(r.height),
    fit: r.fit === "contain" ? "contain" : "cover",
    captionOverride: String(r.caption_override ?? ""),
    overlays: normalizeCanvasOverlays(
      safeParseJson<unknown>(String(r.overlays_json ?? "[]"), [])
    ),
  };
}

export function mapCanvasRow(
  r: Record<string, unknown>,
  items: StoryCanvasItem[]
): StoryCanvas {
  return {
    id: String(r.id),
    storyId: String(r.story_id),
    name: String(r.name),
    template: r.template as StoryCanvas["template"],
    pageSize: r.page_size as StoryCanvas["pageSize"],
    pageWidth: Number(r.page_width),
    pageHeight: Number(r.page_height),
    margin: Number(r.margin ?? 32),
    gutter: Number(r.gutter ?? 16),
    background: String(r.background ?? "#0B0B0F"),
    captionMode: r.caption_mode as StoryCanvas["captionMode"],
    settings: safeParseJson<Record<string, unknown>>(
      String(r.settings_json ?? "{}"),
      {}
    ),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    items,
  };
}

export function mapStoryExportRow(r: Record<string, unknown>): StoryExportRecord {
  return {
    id: String(r.id),
    storyId: stringOrNull(r.story_id),
    canvasId: stringOrNull(r.canvas_id),
    kind: r.kind as StoryExportKind,
    filePath: String(r.file_path),
    width: Number(r.width ?? 0),
    height: Number(r.height ?? 0),
    pageCount: Number(r.page_count ?? 1),
    sizeBytes: Number(r.size_bytes ?? 0),
    settings: safeParseJson<Record<string, unknown>>(
      String(r.settings_json ?? "{}"),
      {}
    ),
    createdAt: String(r.created_at),
  };
}

