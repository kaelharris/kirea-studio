import { randomUUID } from "node:crypto";
import type {
  PixelAssetFilters,
  PixelAssetRecord,
  PixelCharacter,
  PixelCharacterInput,
  PixelExportFormat,
  PixelExportResult,
  PixelProject,
  PixelProjectInput,
  PixelSavedPalette,
  PixelSavedPaletteInput,
} from "../../../shared/pixel-types";
import type { StudioDatabase } from "../database";

export interface PixelAssetInsert {
  id: string;
  projectId: string;
  characterId: string | null;
  name: string;
  kind: PixelAssetRecord["kind"];
  engine: PixelAssetRecord["engine"];
  width: number;
  height: number;
  prompt: string;
  seed: number | null;
  paletteId: string;
  palette: string[];
  recipeJson: string;
  previewPath: string;
  sheetPath: string | null;
  parentAssetId: string | null;
}

export interface PixelFrameInsert {
  id: string;
  index: number;
  name: string;
  durationMs: number;
  filePath: string;
}

export interface PixelFrameRow {
  id: string;
  index: number;
  name: string;
  durationMs: number;
  filePath: string;
}

export class PixelRepository {
  constructor(private readonly studioDb: StudioDatabase) {}

  listProjects(): PixelProject[] {
    const rows = this.studioDb.db
      .prepare("SELECT * FROM pixel_projects ORDER BY updated_at DESC")
      .all() as Array<Record<string, unknown>>;
    return rows.map(mapProjectRow);
  }

  getProject(id: string): PixelProject | null {
    const row = this.studioDb.db
      .prepare("SELECT * FROM pixel_projects WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? mapProjectRow(row) : null;
  }

  saveProject(input: PixelProjectInput): PixelProject {
    const now = new Date().toISOString();
    const id = input.id ?? randomUUID();
    const existing = this.getProject(id);
    this.studioDb.db
      .prepare(
        `INSERT INTO pixel_projects (id, name, description, width, height, palette_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           description = excluded.description,
           width = excluded.width,
           height = excluded.height,
           updated_at = excluded.updated_at`
      )
      .run(
        id,
        input.name.trim() || "Untitled project",
        input.description ?? "",
        input.width ?? existing?.width ?? 32,
        input.height ?? existing?.height ?? 32,
        existing?.paletteJson ?? "[]",
        existing?.createdAt ?? now,
        now
      );
    return this.getProject(id)!;
  }

  deleteProject(id: string): boolean {
    return this.studioDb.db.prepare("DELETE FROM pixel_projects WHERE id = ?").run(id).changes > 0;
  }

  listCharacters(projectId?: string): PixelCharacter[] {
    const rows = (
      projectId
        ? this.studioDb.db
            .prepare("SELECT * FROM pixel_characters WHERE project_id = ? ORDER BY updated_at DESC")
            .all(projectId)
        : this.studioDb.db
            .prepare("SELECT * FROM pixel_characters ORDER BY updated_at DESC")
            .all()
    ) as Array<Record<string, unknown>>;
    return rows.map(mapCharacterRow);
  }

  getCharacter(id: string): PixelCharacter | null {
    const row = this.studioDb.db
      .prepare("SELECT * FROM pixel_characters WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? mapCharacterRow(row) : null;
  }

  saveCharacter(input: PixelCharacterInput): PixelCharacter {
    const now = new Date().toISOString();
    const id = input.id ?? randomUUID();
    const existing = this.getCharacter(id);
    this.studioDb.db
      .prepare(
        `INSERT INTO pixel_characters (
           id, project_id, name, description, seed, palette_id, reference_asset_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           description = excluded.description,
           seed = excluded.seed,
           palette_id = excluded.palette_id,
           reference_asset_id = excluded.reference_asset_id,
           updated_at = excluded.updated_at`
      )
      .run(
        id,
        input.projectId,
        input.name.trim() || "Unnamed character",
        input.description ?? existing?.description ?? "",
        input.seed ?? existing?.seed ?? 1,
        input.paletteId ?? existing?.paletteId ?? "kirea",
        input.referenceAssetId ?? existing?.referenceAssetId ?? null,
        existing?.createdAt ?? now,
        now
      );
    return this.getCharacter(id)!;
  }

  deleteCharacter(id: string): boolean {
    return (
      this.studioDb.db.prepare("DELETE FROM pixel_characters WHERE id = ?").run(id).changes > 0
    );
  }

  insertAsset(asset: PixelAssetInsert, frames: PixelFrameInsert[]): void {
    const now = new Date().toISOString();
    const tx = this.studioDb.db.transaction(() => {
      this.studioDb.db
        .prepare(
          `INSERT INTO pixel_assets (
             id, project_id, character_id, name, kind, engine, width, height, frame_count,
             prompt, seed, palette_id, palette_json, recipe_json, preview_path, sheet_path,
             parent_asset_id, version, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
        )
        .run(
          asset.id,
          asset.projectId,
          asset.characterId,
          asset.name,
          asset.kind,
          asset.engine,
          asset.width,
          asset.height,
          frames.length,
          asset.prompt,
          asset.seed,
          asset.paletteId,
          JSON.stringify(asset.palette),
          asset.recipeJson,
          asset.previewPath,
          asset.sheetPath,
          asset.parentAssetId,
          now,
          now
        );
      this.insertFrames(asset.id, frames);
      this.recordVersion(asset.id, 1, asset.recipeJson, asset.previewPath, asset.palette);
    });
    tx();
  }

  listAssets(filters: PixelAssetFilters = {}): PixelAssetRecord[] {
    const clauses: string[] = [];
    const params: Array<string> = [];
    if (filters.projectId) {
      clauses.push("project_id = ?");
      params.push(filters.projectId);
    }
    if (filters.characterId) {
      clauses.push("character_id = ?");
      params.push(filters.characterId);
    }
    if (filters.kind) {
      clauses.push("kind = ?");
      params.push(filters.kind);
    }
    if (filters.search) {
      clauses.push("name LIKE ?");
      params.push(`%${filters.search}%`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.studioDb.db
      .prepare(`SELECT * FROM pixel_assets ${where} ORDER BY updated_at DESC`)
      .all(...params) as Array<Record<string, unknown>>;
    return rows.map(mapAssetRow);
  }

  getAsset(id: string): PixelAssetRecord | null {
    const row = this.studioDb.db
      .prepare("SELECT * FROM pixel_assets WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? mapAssetRow(row) : null;
  }

  getFrames(assetId: string): PixelFrameRow[] {
    const rows = this.studioDb.db
      .prepare("SELECT * FROM pixel_frames WHERE asset_id = ? ORDER BY frame_index ASC")
      .all(assetId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.frame_id ?? ""),
      index: Number(row.frame_index),
      name: String(row.name),
      durationMs: Number(row.duration_ms),
      filePath: String(row.file_path),
    }));
  }

  replaceFrames(
    assetId: string,
    frames: PixelFrameInsert[],
    patch: {
      recipeJson: string;
      previewPath: string;
      sheetPath: string | null;
      frameCount: number;
      version: number;
      width: number;
      height: number;
      palette: string[];
    }
  ): void {
    const now = new Date().toISOString();
    const tx = this.studioDb.db.transaction(() => {
      this.studioDb.db.prepare("DELETE FROM pixel_frames WHERE asset_id = ?").run(assetId);
      this.insertFrames(assetId, frames);
      this.studioDb.db
        .prepare(
          `UPDATE pixel_assets SET
             frame_count = ?, recipe_json = ?, preview_path = ?, sheet_path = ?,
             version = ?, width = ?, height = ?, palette_json = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          patch.frameCount,
          patch.recipeJson,
          patch.previewPath,
          patch.sheetPath,
          patch.version,
          patch.width,
          patch.height,
          JSON.stringify(patch.palette),
          now,
          assetId
        );
      this.recordVersion(assetId, patch.version, patch.recipeJson, patch.previewPath, patch.palette);
    });
    tx();
  }

  updatePalette(assetId: string, palette: string[], version: number): void {
    const asset = this.getAsset(assetId);
    if (!asset) throw new Error("Pixel asset not found.");
    const now = new Date().toISOString();
    const tx = this.studioDb.db.transaction(() => {
      this.studioDb.db
        .prepare(
          `UPDATE pixel_assets SET palette_json = ?, version = ?, updated_at = ? WHERE id = ?`
        )
        .run(JSON.stringify(palette), version, now, assetId);
      this.recordVersion(assetId, version, asset.recipeJson, asset.previewPath, palette);
    });
    tx();
  }

  updateRecipe(assetId: string, recipeJson: string, version: number): void {
    const asset = this.getAsset(assetId);
    if (!asset) throw new Error("Pixel asset not found.");
    const now = new Date().toISOString();
    const tx = this.studioDb.db.transaction(() => {
      this.studioDb.db
        .prepare(
          `UPDATE pixel_assets SET recipe_json = ?, version = ?, updated_at = ? WHERE id = ?`
        )
        .run(recipeJson, version, now, assetId);
      this.recordVersion(assetId, version, recipeJson, asset.previewPath, asset.palette);
    });
    tx();
  }

  listVersions(assetId: string): Array<{
    id: string;
    assetId: string;
    version: number;
    previewPath: string;
    createdAt: string;
  }> {
    const rows = this.studioDb.db
      .prepare(
        "SELECT id, asset_id, version, preview_path, created_at FROM pixel_asset_versions WHERE asset_id = ? ORDER BY version DESC"
      )
      .all(assetId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      assetId: String(row.asset_id),
      version: Number(row.version),
      previewPath: String(row.preview_path ?? ""),
      createdAt: String(row.created_at),
    }));
  }

  hasVersion(assetId: string, version: number): boolean {
    return Boolean(
      this.studioDb.db
        .prepare("SELECT 1 FROM pixel_asset_versions WHERE asset_id = ? AND version = ?")
        .get(assetId, version)
    );
  }

  getVersion(
    assetId: string,
    version: number
  ): {
    version: number;
    recipeJson: string;
    previewPath: string;
    palette: string[];
    createdAt: string;
  } | null {
    const row = this.studioDb.db
      .prepare(
        "SELECT version, recipe_json, preview_path, palette_json, created_at FROM pixel_asset_versions WHERE asset_id = ? AND version = ?"
      )
      .get(assetId, version) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      version: Number(row.version),
      recipeJson: String(row.recipe_json ?? "{}"),
      previewPath: String(row.preview_path ?? ""),
      palette: parsePalette(row.palette_json),
      createdAt: String(row.created_at),
    };
  }

  listPalettes(): PixelSavedPalette[] {
    const rows = this.studioDb.db
      .prepare("SELECT * FROM pixel_palettes ORDER BY updated_at DESC")
      .all() as Array<Record<string, unknown>>;
    return rows.map(mapPaletteRow);
  }

  savePalette(input: PixelSavedPaletteInput & { colors: string[] }): PixelSavedPalette {
    const now = new Date().toISOString();
    const id = input.id ?? randomUUID();
    const existing = this.getPalette(id);
    this.studioDb.db
      .prepare(
        `INSERT INTO pixel_palettes (id, name, colors_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           colors_json = excluded.colors_json,
           updated_at = excluded.updated_at`
      )
      .run(
        id,
        input.name.trim(),
        JSON.stringify(input.colors),
        existing?.createdAt ?? now,
        now
      );
    return this.getPalette(id)!;
  }

  getPalette(id: string): PixelSavedPalette | null {
    const row = this.studioDb.db
      .prepare("SELECT * FROM pixel_palettes WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? mapPaletteRow(row) : null;
  }

  deletePalette(id: string): boolean {
    return this.studioDb.db.prepare("DELETE FROM pixel_palettes WHERE id = ?").run(id).changes > 0;
  }

  renameAsset(id: string, name: string): boolean {
    return (
      this.studioDb.db
        .prepare("UPDATE pixel_assets SET name = ?, updated_at = ? WHERE id = ?")
        .run(name.trim() || "Untitled asset", new Date().toISOString(), id).changes > 0
    );
  }

  deleteAsset(id: string): boolean {
    return this.studioDb.db.prepare("DELETE FROM pixel_assets WHERE id = ?").run(id).changes > 0;
  }

  recordExport(
    assetId: string,
    format: PixelExportFormat,
    result: Omit<PixelExportResult, "format">,
    settings: Record<string, unknown>
  ): void {
    this.studioDb.db
      .prepare(
        `INSERT INTO pixel_exports (id, asset_id, format, file_path, width, height, frame_count, settings_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        assetId,
        format,
        result.filePath,
        result.width,
        result.height,
        result.frameCount,
        JSON.stringify(settings),
        new Date().toISOString()
      );
  }

  private insertFrames(assetId: string, frames: PixelFrameInsert[]): void {
    const stmt = this.studioDb.db.prepare(
      "INSERT INTO pixel_frames (asset_id, frame_id, frame_index, name, duration_ms, file_path) VALUES (?, ?, ?, ?, ?, ?)"
    );
    for (const frame of frames) {
      stmt.run(assetId, frame.id, frame.index, frame.name, frame.durationMs, frame.filePath);
    }
  }

  private recordVersion(
    assetId: string,
    version: number,
    recipeJson: string,
    previewPath: string,
    palette: string[]
  ): void {
    this.studioDb.db
      .prepare(
        `INSERT OR IGNORE INTO pixel_asset_versions (id, asset_id, version, recipe_json, preview_path, palette_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        assetId,
        version,
        recipeJson,
        previewPath,
        JSON.stringify(palette),
        new Date().toISOString()
      );
  }
}

function parsePalette(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]")) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((entry): entry is string => typeof entry === "string");
    }
  } catch {
    // Fall through to an empty palette.
  }
  return [];
}

function mapProjectRow(row: Record<string, unknown>): PixelProject {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description ?? ""),
    width: Number(row.width ?? 32),
    height: Number(row.height ?? 32),
    paletteJson: String(row.palette_json ?? "[]"),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapCharacterRow(row: Record<string, unknown>): PixelCharacter {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    name: String(row.name),
    description: String(row.description ?? ""),
    seed: Number(row.seed ?? 1),
    paletteId: String(row.palette_id ?? "kirea"),
    referenceAssetId: row.reference_asset_id ? String(row.reference_asset_id) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapPaletteRow(row: Record<string, unknown>): PixelSavedPalette {
  let colors: string[] = [];
  try {
    const parsed = JSON.parse(String(row.colors_json ?? "[]")) as unknown;
    if (Array.isArray(parsed)) {
      colors = parsed.filter((entry): entry is string => typeof entry === "string");
    }
  } catch {
    colors = [];
  }
  return {
    id: String(row.id),
    name: String(row.name),
    colors,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapAssetRow(row: Record<string, unknown>): PixelAssetRecord {
  let palette: string[] = [];
  try {
    const parsed = JSON.parse(String(row.palette_json ?? "[]")) as unknown;
    if (Array.isArray(parsed)) palette = parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    palette = [];
  }
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    characterId: row.character_id ? String(row.character_id) : null,
    name: String(row.name),
    kind: String(row.kind) as PixelAssetRecord["kind"],
    engine: String(row.engine) as PixelAssetRecord["engine"],
    width: Number(row.width),
    height: Number(row.height),
    frameCount: Number(row.frame_count ?? 1),
    prompt: String(row.prompt ?? ""),
    seed: row.seed === null || row.seed === undefined ? null : Number(row.seed),
    paletteId: String(row.palette_id ?? "kirea"),
    palette,
    previewDataUrl: "",
    previewPath: String(row.preview_path ?? ""),
    sheetPath: row.sheet_path ? String(row.sheet_path) : null,
    recipeJson: String(row.recipe_json ?? "{}"),
    parentAssetId: row.parent_asset_id ? String(row.parent_asset_id) : null,
    version: Number(row.version ?? 1),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
