import type Database from "better-sqlite3";
import { classifyImageOperation } from "../../shared/image-labels";
import type { GenerationMode } from "../../shared/types";

export interface Migration {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial_schema",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS collections (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          description TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS generation_jobs (
          id TEXT PRIMARY KEY,
          prompt_id TEXT,
          status TEXT NOT NULL,
          error_kind TEXT NOT NULL DEFAULT 'NONE',
          error_message TEXT,
          prompt TEXT NOT NULL,
          negative_prompt TEXT NOT NULL DEFAULT '',
          checkpoint TEXT NOT NULL,
          workflow_id TEXT NOT NULL,
          workflow_version TEXT NOT NULL,
          mode TEXT NOT NULL,
          settings_json TEXT NOT NULL,
          progress_step INTEGER NOT NULL DEFAULT 0,
          progress_max INTEGER NOT NULL DEFAULT 0,
          current_node TEXT,
          output_paths_json TEXT NOT NULL DEFAULT '[]',
          submitted_at TEXT NOT NULL,
          started_at TEXT,
          completed_at TEXT,
          batch_index INTEGER NOT NULL DEFAULT 1,
          batch_total INTEGER NOT NULL DEFAULT 1
        );

        CREATE INDEX IF NOT EXISTS idx_jobs_status_submitted
          ON generation_jobs(status, submitted_at DESC);

        CREATE TABLE IF NOT EXISTS generated_images (
          id TEXT PRIMARY KEY,
          job_id TEXT NOT NULL,
          file_path TEXT NOT NULL UNIQUE,
          file_name TEXT NOT NULL,
          format TEXT NOT NULL,
          width INTEGER NOT NULL,
          height INTEGER NOT NULL,
          size_bytes INTEGER NOT NULL,
          prompt TEXT NOT NULL,
          negative_prompt TEXT NOT NULL DEFAULT '',
          seed INTEGER NOT NULL,
          checkpoint TEXT NOT NULL,
          loras_json TEXT NOT NULL DEFAULT '[]',
          workflow_id TEXT NOT NULL,
          sampler TEXT NOT NULL,
          scheduler TEXT NOT NULL,
          steps INTEGER NOT NULL,
          cfg REAL NOT NULL,
          denoise REAL NOT NULL DEFAULT 1.0,
          mode TEXT NOT NULL,
          favorite INTEGER NOT NULL DEFAULT 0,
          tags_json TEXT NOT NULL DEFAULT '[]',
          collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_images_created
          ON generated_images(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_images_favorite
          ON generated_images(favorite, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_images_collection
          ON generated_images(collection_id);

        CREATE TABLE IF NOT EXISTS prompts (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          prompt TEXT NOT NULL,
          negative_prompt TEXT NOT NULL DEFAULT '',
          tags_json TEXT NOT NULL DEFAULT '[]',
          favorite INTEGER NOT NULL DEFAULT 0,
          usage_count INTEGER NOT NULL DEFAULT 1,
          last_used_at TEXT,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS models (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          relative_path TEXT NOT NULL,
          file_path TEXT NOT NULL UNIQUE,
          category TEXT NOT NULL,
          architecture TEXT NOT NULL,
          size_bytes INTEGER NOT NULL,
          sha256 TEXT,
          source_root TEXT NOT NULL,
          is_duplicate INTEGER NOT NULL DEFAULT 0,
          duplicate_of TEXT,
          is_incomplete INTEGER NOT NULL DEFAULT 0,
          compatible_workflows_json TEXT NOT NULL DEFAULT '[]',
          license TEXT,
          description TEXT,
          installed INTEGER NOT NULL DEFAULT 1,
          last_seen_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_models_category
          ON models(category, name);

        CREATE TABLE IF NOT EXISTS workflows (
          id TEXT PRIMARY KEY,
          version TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT NOT NULL,
          mode TEXT NOT NULL,
          metadata_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS downloads (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          title TEXT NOT NULL,
          url TEXT NOT NULL,
          target_path TEXT NOT NULL,
          category TEXT NOT NULL,
          source_name TEXT NOT NULL,
          license_name TEXT NOT NULL,
          expected_sha256 TEXT,
          actual_sha256 TEXT,
          total_bytes INTEGER NOT NULL DEFAULT 0,
          downloaded_bytes INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL,
          error TEXT,
          created_at TEXT NOT NULL,
          completed_at TEXT
        );
      `);
    },
  },
  {
    version: 2,
    name: "model_metadata_and_lora_recipes",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS model_metadata (
          model_id TEXT PRIMARY KEY,
          file_path TEXT NOT NULL UNIQUE,
          display_name TEXT,
          description TEXT NOT NULL DEFAULT '',
          architecture_override TEXT,
          base_model TEXT,
          preview_mode TEXT NOT NULL DEFAULT 'auto'
            CHECK (preview_mode IN ('auto', 'custom', 'none')),
          preview_path TEXT,
          trigger_words_json TEXT NOT NULL DEFAULT '[]',
          tags_json TEXT NOT NULL DEFAULT '[]',
          notes TEXT NOT NULL DEFAULT '',
          favorite INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_model_metadata_favorite
          ON model_metadata(favorite, updated_at DESC);

        CREATE TABLE IF NOT EXISTS model_discovery (
          model_id TEXT PRIMARY KEY,
          file_path TEXT NOT NULL,
          description TEXT,
          base_model TEXT,
          preview_path TEXT,
          trigger_words_json TEXT NOT NULL DEFAULT '[]',
          discovered_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_model_discovery_path
          ON model_discovery(file_path);

        CREATE TABLE IF NOT EXISTS lora_recipes (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          mode TEXT NOT NULL DEFAULT 'txt2img',
          workflow_id TEXT,
          architecture TEXT NOT NULL DEFAULT 'unknown',
          checkpoint_path TEXT,
          checkpoint_name TEXT,
          base_prompt TEXT NOT NULL DEFAULT '',
          negative_prompt TEXT NOT NULL DEFAULT '',
          settings_json TEXT NOT NULL DEFAULT '{}',
          cover_image_path TEXT,
          tags_json TEXT NOT NULL DEFAULT '[]',
          favorite INTEGER NOT NULL DEFAULT 0,
          usage_count INTEGER NOT NULL DEFAULT 0,
          last_used_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_lora_recipes_updated
          ON lora_recipes(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_lora_recipes_architecture
          ON lora_recipes(architecture);
        CREATE INDEX IF NOT EXISTS idx_lora_recipes_checkpoint
          ON lora_recipes(checkpoint_path);

        CREATE TABLE IF NOT EXISTS lora_recipe_items (
          recipe_id TEXT NOT NULL REFERENCES lora_recipes(id) ON DELETE CASCADE,
          position INTEGER NOT NULL,
          lora_path TEXT NOT NULL,
          lora_name TEXT NOT NULL DEFAULT '',
          architecture TEXT NOT NULL DEFAULT 'unknown',
          strength_model REAL NOT NULL DEFAULT 0.85,
          strength_clip REAL NOT NULL DEFAULT 0.85,
          enabled INTEGER NOT NULL DEFAULT 1,
          trigger_words_json TEXT NOT NULL DEFAULT '[]',
          PRIMARY KEY (recipe_id, position)
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_lora_recipe_items_unique
          ON lora_recipe_items(recipe_id, lora_path);
        CREATE INDEX IF NOT EXISTS idx_lora_recipe_items_path
          ON lora_recipe_items(lora_path);
      `);
    },
  },
  {
    version: 3,
    name: "character_profiles",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS characters (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          appearance TEXT NOT NULL DEFAULT '',
          clothing TEXT NOT NULL DEFAULT '',
          prompt_prefix TEXT NOT NULL DEFAULT '',
          negative_prompt TEXT NOT NULL DEFAULT '',
          trigger_words_json TEXT NOT NULL DEFAULT '[]',
          architecture TEXT NOT NULL DEFAULT 'unknown',
          checkpoint_path TEXT,
          checkpoint_name TEXT,
          lora_recipe_id TEXT REFERENCES lora_recipes(id) ON DELETE SET NULL,
          reference_mode TEXT NOT NULL DEFAULT 'none'
            CHECK (reference_mode IN ('none', 'img2img', 'ipadapter', 'controlnet')),
          reference_weight REAL NOT NULL DEFAULT 0.75,
          reference_start REAL NOT NULL DEFAULT 0.0,
          reference_end REAL NOT NULL DEFAULT 1.0,
          tags_json TEXT NOT NULL DEFAULT '[]',
          favorite INTEGER NOT NULL DEFAULT 0,
          usage_count INTEGER NOT NULL DEFAULT 0,
          last_used_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_characters_name
          ON characters(name COLLATE NOCASE);
        CREATE INDEX IF NOT EXISTS idx_characters_updated
          ON characters(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_characters_recipe
          ON characters(lora_recipe_id);

        CREATE TABLE IF NOT EXISTS character_references (
          id TEXT PRIMARY KEY,
          character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
          role TEXT NOT NULL DEFAULT 'secondary'
            CHECK (role IN ('primary', 'secondary', 'expression', 'outfit', 'pose')),
          file_path TEXT NOT NULL,
          source_path TEXT,
          caption TEXT NOT NULL DEFAULT '',
          weight REAL NOT NULL DEFAULT 1.0,
          position INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_character_refs_character
          ON character_references(character_id, position);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_character_refs_one_primary
          ON character_references(character_id) WHERE role = 'primary';

        ALTER TABLE generation_jobs
          ADD COLUMN character_id TEXT REFERENCES characters(id) ON DELETE SET NULL;
        ALTER TABLE generation_jobs
          ADD COLUMN lora_recipe_id TEXT REFERENCES lora_recipes(id) ON DELETE SET NULL;
        ALTER TABLE generated_images
          ADD COLUMN character_id TEXT REFERENCES characters(id) ON DELETE SET NULL;
        ALTER TABLE generated_images
          ADD COLUMN lora_recipe_id TEXT REFERENCES lora_recipes(id) ON DELETE SET NULL;

        CREATE INDEX IF NOT EXISTS idx_jobs_character
          ON generation_jobs(character_id, submitted_at DESC);
        CREATE INDEX IF NOT EXISTS idx_images_character
          ON generated_images(character_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_images_recipe
          ON generated_images(lora_recipe_id);
      `);
    },
  },
  {
    version: 4,
    name: "story_studio_and_canvas",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS stories (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          logline TEXT NOT NULL DEFAULT '',
          style_prompt TEXT NOT NULL DEFAULT '',
          negative_prompt TEXT NOT NULL DEFAULT '',
          default_character_id TEXT REFERENCES characters(id) ON DELETE SET NULL,
          default_checkpoint_path TEXT,
          default_lora_recipe_id TEXT REFERENCES lora_recipes(id) ON DELETE SET NULL,
          cover_scene_id TEXT,
          status TEXT NOT NULL DEFAULT 'draft'
            CHECK (status IN ('draft', 'in_progress', 'complete')),
          tags_json TEXT NOT NULL DEFAULT '[]',
          favorite INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_stories_updated
          ON stories(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_stories_favorite
          ON stories(favorite, updated_at DESC);

        CREATE TABLE IF NOT EXISTS story_characters (
          story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
          character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
          position INTEGER NOT NULL,
          story_role TEXT NOT NULL DEFAULT 'supporting'
            CHECK (story_role IN ('lead', 'supporting', 'cameo')),
          PRIMARY KEY (story_id, character_id)
        );

        CREATE INDEX IF NOT EXISTS idx_story_characters_character
          ON story_characters(character_id);

        CREATE TABLE IF NOT EXISTS story_scenes (
          id TEXT PRIMARY KEY,
          story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
          position INTEGER NOT NULL,
          title TEXT NOT NULL DEFAULT '',
          synopsis TEXT NOT NULL DEFAULT '',
          prompt TEXT NOT NULL DEFAULT '',
          negative_prompt TEXT NOT NULL DEFAULT '',
          checkpoint_path TEXT,
          lora_recipe_id TEXT REFERENCES lora_recipes(id) ON DELETE SET NULL,
          aspect_ratio TEXT,
          width INTEGER,
          height INTEGER,
          steps INTEGER,
          cfg REAL,
          sampler TEXT,
          scheduler TEXT,
          seed INTEGER NOT NULL DEFAULT -1,
          denoise REAL,
          reference_mode_override TEXT
            CHECK (reference_mode_override IN ('none', 'img2img', 'ipadapter', 'controlnet')),
          batch_count INTEGER NOT NULL DEFAULT 1,
          status TEXT NOT NULL DEFAULT 'draft'
            CHECK (status IN ('draft', 'queued', 'generating', 'completed', 'failed')),
          last_job_id TEXT REFERENCES generation_jobs(id) ON DELETE SET NULL,
          selected_image_id TEXT REFERENCES generated_images(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (story_id, position)
        );

        CREATE INDEX IF NOT EXISTS idx_story_scenes_story
          ON story_scenes(story_id, position);
        CREATE INDEX IF NOT EXISTS idx_story_scenes_recipe
          ON story_scenes(lora_recipe_id);

        CREATE TABLE IF NOT EXISTS story_scene_characters (
          scene_id TEXT NOT NULL REFERENCES story_scenes(id) ON DELETE CASCADE,
          character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
          position INTEGER NOT NULL,
          role_hint TEXT NOT NULL DEFAULT '',
          PRIMARY KEY (scene_id, character_id)
        );

        CREATE INDEX IF NOT EXISTS idx_story_scene_characters_character
          ON story_scene_characters(character_id);

        ALTER TABLE generation_jobs
          ADD COLUMN story_id TEXT REFERENCES stories(id) ON DELETE SET NULL;
        ALTER TABLE generation_jobs
          ADD COLUMN story_scene_id TEXT REFERENCES story_scenes(id) ON DELETE SET NULL;
        ALTER TABLE generated_images
          ADD COLUMN story_id TEXT REFERENCES stories(id) ON DELETE SET NULL;
        ALTER TABLE generated_images
          ADD COLUMN story_scene_id TEXT REFERENCES story_scenes(id) ON DELETE SET NULL;

        CREATE INDEX IF NOT EXISTS idx_jobs_story
          ON generation_jobs(story_id, submitted_at DESC);
        CREATE INDEX IF NOT EXISTS idx_jobs_story_scene
          ON generation_jobs(story_scene_id, submitted_at DESC);
        CREATE INDEX IF NOT EXISTS idx_images_story
          ON generated_images(story_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_images_story_scene
          ON generated_images(story_scene_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS story_canvases (
          id TEXT PRIMARY KEY,
          story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
          name TEXT NOT NULL DEFAULT 'Storyboard',
          template TEXT NOT NULL DEFAULT 'grid_2x3'
            CHECK (template IN ('grid_2x3', 'grid_3x3', 'filmstrip', 'freeform')),
          page_size TEXT NOT NULL DEFAULT 'a4_landscape'
            CHECK (page_size IN ('a4_portrait', 'a4_landscape', 'letter', 'square', 'custom')),
          page_width INTEGER NOT NULL DEFAULT 1123,
          page_height INTEGER NOT NULL DEFAULT 794,
          margin INTEGER NOT NULL DEFAULT 32,
          gutter INTEGER NOT NULL DEFAULT 16,
          background TEXT NOT NULL DEFAULT '#0B0B0F',
          caption_mode TEXT NOT NULL DEFAULT 'scene_title'
            CHECK (caption_mode IN ('none', 'scene_title', 'synopsis', 'prompt')),
          settings_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (story_id, name)
        );

        CREATE INDEX IF NOT EXISTS idx_story_canvases_story
          ON story_canvases(story_id, updated_at DESC);

        CREATE TABLE IF NOT EXISTS story_canvas_items (
          id TEXT PRIMARY KEY,
          canvas_id TEXT NOT NULL REFERENCES story_canvases(id) ON DELETE CASCADE,
          scene_id TEXT REFERENCES story_scenes(id) ON DELETE SET NULL,
          image_id TEXT REFERENCES generated_images(id) ON DELETE SET NULL,
          position INTEGER NOT NULL,
          x REAL,
          y REAL,
          width REAL,
          height REAL,
          fit TEXT NOT NULL DEFAULT 'cover' CHECK (fit IN ('cover', 'contain')),
          caption_override TEXT NOT NULL DEFAULT '',
          UNIQUE (canvas_id, position)
        );

        CREATE INDEX IF NOT EXISTS idx_story_canvas_items_canvas
          ON story_canvas_items(canvas_id, position);

        CREATE TABLE IF NOT EXISTS story_exports (
          id TEXT PRIMARY KEY,
          story_id TEXT REFERENCES stories(id) ON DELETE SET NULL,
          canvas_id TEXT REFERENCES story_canvases(id) ON DELETE SET NULL,
          kind TEXT NOT NULL CHECK (kind IN ('png', 'pdf')),
          file_path TEXT NOT NULL,
          width INTEGER NOT NULL,
          height INTEGER NOT NULL,
          page_count INTEGER NOT NULL DEFAULT 1,
          size_bytes INTEGER NOT NULL DEFAULT 0,
          settings_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_story_exports_story
          ON story_exports(story_id, created_at DESC);
      `);
    },
  },
  {
    version: 5,
    name: "canvas_overlays",
    up: (db) => {
      const columns = db
        .prepare("PRAGMA table_info(story_canvas_items)")
        .all() as Array<{ name: string }>;
      if (!columns.some((column) => column.name === "overlays_json")) {
        db.exec(
          "ALTER TABLE story_canvas_items ADD COLUMN overlays_json TEXT NOT NULL DEFAULT '[]'"
        );
      }
    },
  },
  {
    version: 6,
    name: "pixel_studio",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS pixel_projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          width INTEGER NOT NULL DEFAULT 32,
          height INTEGER NOT NULL DEFAULT 32,
          palette_json TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS pixel_characters (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES pixel_projects(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          seed INTEGER NOT NULL DEFAULT 0,
          palette_id TEXT NOT NULL DEFAULT 'kirea',
          reference_asset_id TEXT REFERENCES pixel_assets(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_pixel_characters_project
          ON pixel_characters(project_id, updated_at DESC);

        CREATE TABLE IF NOT EXISTS pixel_assets (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES pixel_projects(id) ON DELETE CASCADE,
          character_id TEXT REFERENCES pixel_characters(id) ON DELETE SET NULL,
          name TEXT NOT NULL,
          kind TEXT NOT NULL,
          engine TEXT NOT NULL DEFAULT 'pixelbolt',
          width INTEGER NOT NULL,
          height INTEGER NOT NULL,
          frame_count INTEGER NOT NULL DEFAULT 1,
          prompt TEXT NOT NULL DEFAULT '',
          seed INTEGER,
          palette_id TEXT NOT NULL DEFAULT 'kirea',
          palette_json TEXT NOT NULL DEFAULT '[]',
          recipe_json TEXT NOT NULL DEFAULT '{}',
          preview_path TEXT NOT NULL,
          sheet_path TEXT,
          parent_asset_id TEXT REFERENCES pixel_assets(id) ON DELETE SET NULL,
          version INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_pixel_assets_project
          ON pixel_assets(project_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_pixel_assets_character
          ON pixel_assets(character_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_pixel_assets_kind
          ON pixel_assets(kind, updated_at DESC);

        CREATE TABLE IF NOT EXISTS pixel_asset_versions (
          id TEXT PRIMARY KEY,
          asset_id TEXT NOT NULL REFERENCES pixel_assets(id) ON DELETE CASCADE,
          version INTEGER NOT NULL,
          recipe_json TEXT NOT NULL DEFAULT '{}',
          preview_path TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE (asset_id, version)
        );

        CREATE TABLE IF NOT EXISTS pixel_frames (
          asset_id TEXT NOT NULL REFERENCES pixel_assets(id) ON DELETE CASCADE,
          frame_index INTEGER NOT NULL,
          name TEXT NOT NULL,
          duration_ms INTEGER NOT NULL DEFAULT 100,
          file_path TEXT NOT NULL,
          PRIMARY KEY (asset_id, frame_index)
        );

        CREATE TABLE IF NOT EXISTS pixel_exports (
          id TEXT PRIMARY KEY,
          asset_id TEXT NOT NULL REFERENCES pixel_assets(id) ON DELETE CASCADE,
          format TEXT NOT NULL,
          file_path TEXT NOT NULL,
          width INTEGER NOT NULL,
          height INTEGER NOT NULL,
          frame_count INTEGER NOT NULL DEFAULT 1,
          settings_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_pixel_exports_asset
          ON pixel_exports(asset_id, created_at DESC);
      `);
    },
  },
  {
    version: 7,
    name: "pixel_frame_ids",
    up: (db) => {
      db.exec(`
        ALTER TABLE pixel_frames ADD COLUMN frame_id TEXT;
        UPDATE pixel_frames SET frame_id =
          lower(hex(randomblob(4))) || '-' ||
          lower(hex(randomblob(2))) || '-' ||
          '4' || substr(lower(hex(randomblob(2))), 2) || '-' ||
          substr('89ab', 1 + (abs(random()) % 4), 1) ||
          substr(lower(hex(randomblob(2))), 2) || '-' ||
          lower(hex(randomblob(6)))
          WHERE frame_id IS NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_pixel_frames_asset_frame_id
          ON pixel_frames(asset_id, frame_id);
      `);
    },
  },
  {
    version: 8,
    name: "pixel_palette_library",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS pixel_palettes (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          colors_json TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_pixel_palettes_name
          ON pixel_palettes(name COLLATE NOCASE);
      `);
    },
  },
  {
    version: 9,
    name: "pixel_version_palette",
    up: (db) => {
      db.exec(`
        ALTER TABLE pixel_asset_versions
          ADD COLUMN palette_json TEXT NOT NULL DEFAULT '[]';
      `);
    },
  },
  {
    version: 10,
    name: "generated_videos",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS generated_videos (
          id TEXT PRIMARY KEY,
          job_id TEXT NOT NULL,
          file_path TEXT NOT NULL UNIQUE,
          file_name TEXT NOT NULL,
          container TEXT NOT NULL,
          width INTEGER NOT NULL,
          height INTEGER NOT NULL,
          size_bytes INTEGER NOT NULL,
          duration_seconds REAL NOT NULL,
          fps REAL NOT NULL,
          frame_count INTEGER NOT NULL,
          prompt TEXT NOT NULL,
          negative_prompt TEXT NOT NULL DEFAULT '',
          seed INTEGER NOT NULL,
          checkpoint TEXT NOT NULL,
          loras_json TEXT NOT NULL DEFAULT '[]',
          workflow_id TEXT NOT NULL,
          sampler TEXT NOT NULL,
          scheduler TEXT NOT NULL,
          steps INTEGER NOT NULL,
          cfg REAL NOT NULL,
          denoise REAL NOT NULL DEFAULT 1.0,
          mode TEXT NOT NULL,
          favorite INTEGER NOT NULL DEFAULT 0,
          tags_json TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_videos_created
          ON generated_videos(created_at DESC);
      `);
    },
  },
  {
    version: 11,
    name: "image_operation_lineage",
    up: (db) => {
      db.exec(`
        ALTER TABLE generated_images
          ADD COLUMN parent_image_id TEXT REFERENCES generated_images(id) ON DELETE SET NULL;

        CREATE TABLE IF NOT EXISTS image_operations (
          id TEXT PRIMARY KEY,
          image_id TEXT NOT NULL REFERENCES generated_images(id) ON DELETE CASCADE,
          sequence INTEGER NOT NULL,
          operation TEXT NOT NULL,
          workflow_id TEXT NOT NULL,
          workflow_version TEXT,
          checkpoint TEXT NOT NULL,
          prompt TEXT NOT NULL,
          seed INTEGER NOT NULL,
          parameters_json TEXT NOT NULL DEFAULT '{}',
          parent_image_id TEXT REFERENCES generated_images(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_image_operations_image
          ON image_operations(image_id);
        CREATE INDEX IF NOT EXISTS idx_image_operations_parent
          ON image_operations(parent_image_id);

        UPDATE generated_images AS child
        SET parent_image_id = (
          SELECT parent.id
          FROM generated_images parent
          JOIN generation_jobs job ON job.id = child.job_id
          WHERE parent.file_path = json_extract(job.settings_json, '$.inputImagePath')
          LIMIT 1
        )
        WHERE parent_image_id IS NULL;
      `);

      const rows = db
        .prepare(
          `SELECT g.id, g.mode, g.workflow_id, g.checkpoint, g.prompt, g.seed,
                  g.created_at, g.parent_image_id, j.workflow_version, j.settings_json
           FROM generated_images g
           LEFT JOIN generation_jobs j ON j.id = g.job_id`
        )
        .all() as Array<{
        id: string;
        mode: string;
        workflow_id: string;
        checkpoint: string;
        prompt: string;
        seed: number;
        created_at: string;
        parent_image_id: string | null;
        workflow_version: string | null;
        settings_json: string | null;
      }>;

      const byId = new Map(rows.map((row) => [row.id, row]));
      const sequenceCache = new Map<string, number>();
      const sequenceFor = (id: string, depth = 0): number => {
        const cached = sequenceCache.get(id);
        if (cached !== undefined) return cached;
        const row = byId.get(id);
        if (!row || depth > 32) return 0;
        const parent = row.parent_image_id ? byId.get(row.parent_image_id) : null;
        const value = parent ? sequenceFor(parent.id, depth + 1) + 1 : 0;
        sequenceCache.set(id, value);
        return value;
      };

      const insert = db.prepare(
        `INSERT OR IGNORE INTO image_operations (
          id, image_id, sequence, operation, workflow_id, workflow_version,
          checkpoint, prompt, seed, parameters_json, parent_image_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const row of rows) {
        let parameters: Record<string, unknown> = {};
        if (row.settings_json) {
          try {
            parameters = JSON.parse(row.settings_json) as Record<string, unknown>;
          } catch {
            parameters = {};
          }
        }
        insert.run(
          `${row.id}:op`,
          row.id,
          sequenceFor(row.id),
          classifyImageOperation(row.mode as GenerationMode, row.workflow_id),
          row.workflow_id,
          row.workflow_version,
          row.checkpoint,
          row.prompt,
          row.seed,
          JSON.stringify(parameters),
          row.parent_image_id,
          row.created_at
        );
      }
    },
  },
  {
    version: 12,
    name: "model_discovery_source_metadata",
    up: (db) => {
      db.exec(`
        ALTER TABLE model_discovery ADD COLUMN source_json TEXT;
        ALTER TABLE model_discovery ADD COLUMN embedded_title TEXT;
      `);
    },
  },
  {
    version: 13,
    name: "character_dna_system",
    up: (db) => {
      db.exec(`
        -- 1. Character DNA Core & Knowledge columns
        ALTER TABLE characters ADD COLUMN trigger_token TEXT;
        ALTER TABLE characters ADD COLUMN age_category TEXT;
        ALTER TABLE characters ADD COLUMN species TEXT;
        ALTER TABLE characters ADD COLUMN hair_color TEXT;
        ALTER TABLE characters ADD COLUMN hair_style TEXT;
        ALTER TABLE characters ADD COLUMN eye_color TEXT;
        ALTER TABLE characters ADD COLUMN skin_tone TEXT;
        ALTER TABLE characters ADD COLUMN facial_characteristics TEXT;
        ALTER TABLE characters ADD COLUMN distinctive_features_json TEXT DEFAULT '[]';
        ALTER TABLE characters ADD COLUMN body_characteristics TEXT;
        ALTER TABLE characters ADD COLUMN signature_accessories_json TEXT DEFAULT '[]';
        ALTER TABLE characters ADD COLUMN canonical_description TEXT;
        ALTER TABLE characters ADD COLUMN fixed_traits_json TEXT DEFAULT '[]';
        ALTER TABLE characters ADD COLUMN variable_traits_json TEXT DEFAULT '[]';
        ALTER TABLE characters ADD COLUMN preferred_style TEXT;
        ALTER TABLE characters ADD COLUMN negative_constraints TEXT;
        ALTER TABLE characters ADD COLUMN personality TEXT;
        ALTER TABLE characters ADD COLUMN speech_style TEXT;
        ALTER TABLE characters ADD COLUMN background TEXT;
        ALTER TABLE characters ADD COLUMN history TEXT;
        ALTER TABLE characters ADD COLUMN relationships_json TEXT DEFAULT '[]';
        ALTER TABLE characters ADD COLUMN motivations TEXT;
        ALTER TABLE characters ADD COLUMN likes_json TEXT DEFAULT '[]';
        ALTER TABLE characters ADD COLUMN dislikes_json TEXT DEFAULT '[]';
        ALTER TABLE characters ADD COLUMN rules_json TEXT DEFAULT '[]';
        ALTER TABLE characters ADD COLUMN worldbuilding TEXT;
        ALTER TABLE characters ADD COLUMN dialogue_examples_json TEXT DEFAULT '[]';
        ALTER TABLE characters ADD COLUMN dna_locked INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE characters ADD COLUMN active_adapter_id TEXT;
        ALTER TABLE characters ADD COLUMN active_outfit_id TEXT;

        -- 2. Extended Character Reference metadata
        ALTER TABLE character_references ADD COLUMN category TEXT NOT NULL DEFAULT 'other';
        ALTER TABLE character_references ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'pending';
        ALTER TABLE character_references ADD COLUMN associated_outfit_id TEXT;
        ALTER TABLE character_references ADD COLUMN included_in_training INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE character_references ADD COLUMN width INTEGER;
        ALTER TABLE character_references ADD COLUMN height INTEGER;
        ALTER TABLE character_references ADD COLUMN aspect_ratio TEXT;

        -- 3. Character Outfits table
        CREATE TABLE IF NOT EXISTS character_outfits (
          id TEXT PRIMARY KEY,
          character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          prompt_tokens_json TEXT NOT NULL DEFAULT '[]',
          is_default INTEGER NOT NULL DEFAULT 0,
          preview_image_path TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_character_outfits_char
          ON character_outfits(character_id);

        -- 4. Character Adapters table (Model Memory)
        CREATE TABLE IF NOT EXISTS character_adapters (
          id TEXT PRIMARY KEY,
          character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
          base_model_family TEXT NOT NULL,
          checkpoint_path TEXT,
          checkpoint_name TEXT,
          trigger_token TEXT NOT NULL,
          file_location TEXT NOT NULL,
          training_config_json TEXT,
          dataset_version TEXT,
          rank INTEGER NOT NULL DEFAULT 16,
          alpha INTEGER NOT NULL DEFAULT 16,
          recommended_strength REAL NOT NULL DEFAULT 0.85,
          status TEXT NOT NULL DEFAULT 'trained',
          validation_images_json TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_character_adapters_char
          ON character_adapters(character_id, base_model_family);

        -- 5. Character Datasets table
        CREATE TABLE IF NOT EXISTS character_datasets (
          id TEXT PRIMARY KEY,
          character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
          version TEXT NOT NULL,
          name TEXT NOT NULL,
          item_count INTEGER NOT NULL DEFAULT 0,
          manifest_json TEXT NOT NULL DEFAULT '[]',
          export_path TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_character_datasets_char
          ON character_datasets(character_id);

        -- 6. Character Training Jobs table
        CREATE TABLE IF NOT EXISTS character_training_jobs (
          id TEXT PRIMARY KEY,
          character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
          adapter_id TEXT REFERENCES character_adapters(id) ON DELETE SET NULL,
          base_model_family TEXT NOT NULL,
          status TEXT NOT NULL,
          progress_step INTEGER NOT NULL DEFAULT 0,
          progress_max INTEGER NOT NULL DEFAULT 0,
          current_epoch INTEGER DEFAULT 0,
          total_epochs INTEGER DEFAULT 0,
          loss REAL,
          config_json TEXT NOT NULL,
          error_message TEXT,
          logs_text TEXT NOT NULL DEFAULT '',
          output_adapter_path TEXT,
          submitted_at TEXT NOT NULL,
          started_at TEXT,
          completed_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_character_training_char
          ON character_training_jobs(character_id, status);
      `);
    },
  },
  {
    version: 14,
    name: "character_archetype",
    up: (db) => {
      db.exec(`
        ALTER TABLE characters ADD COLUMN archetype TEXT;
      `);
    },
  },
  {
    version: 15,
    name: "character_gender",
    up: (db) => {
      db.exec(`
        ALTER TABLE characters ADD COLUMN gender TEXT;
      `);
    },
  },
  {
    version: 16,
    name: "character_reference_vision_tags",
    up: (db) => {
      db.exec(`
        ALTER TABLE character_references ADD COLUMN suggested_tags_json TEXT DEFAULT '[]';
        ALTER TABLE character_references ADD COLUMN image_hash TEXT;
        CREATE TABLE IF NOT EXISTS visual_tag_cache (
          image_hash TEXT PRIMARY KEY,
          tags_json TEXT NOT NULL,
          tagger_version TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 17,
    name: "generation_job_startup_interrupted",
    up: (db) => {
      db.exec(`
        ALTER TABLE generation_jobs
          ADD COLUMN startup_interrupted INTEGER NOT NULL DEFAULT 0
          CHECK (startup_interrupted IN (0, 1));
      `);
    },
  },
];

