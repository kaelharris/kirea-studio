import type Database from "better-sqlite3";

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
];

