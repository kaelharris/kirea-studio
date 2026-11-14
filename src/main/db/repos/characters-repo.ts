import { randomUUID } from "node:crypto";
import type {
  CharacterProfile,
  CharacterProfileInput,
  CharacterReference,
  CharacterReferenceRole,
} from "../../../shared/types";
import type { StudioDatabase } from "../database";
import { mapCharacterReferenceRow, mapCharacterRow } from "../repo-mappers";

export class CharactersRepository {
  constructor(private readonly studioDb: StudioDatabase) {}

  listCharacters(): CharacterProfile[] {
    const rows = this.studioDb.db
      .prepare("SELECT * FROM characters ORDER BY favorite DESC, updated_at DESC")
      .all() as Array<Record<string, unknown>>;
    if (rows.length === 0) return [];

    const refRows = this.studioDb.db
      .prepare("SELECT * FROM character_references ORDER BY character_id, position ASC")
      .all() as Array<Record<string, unknown>>;
    const refsByCharacter = new Map<string, CharacterReference[]>();
    for (const row of refRows) {
      const ref = mapCharacterReferenceRow(row);
      const list = refsByCharacter.get(ref.characterId) ?? [];
      list.push(ref);
      refsByCharacter.set(ref.characterId, list);
    }

    return rows.map((r) => {
      const id = String(r.id);
      return mapCharacterRow(r, refsByCharacter.get(id) ?? []);
    });
  }

  getCharacterById(id: string): CharacterProfile | null {
    return this.listCharacters().find((c) => c.id === id) ?? null;
  }

  saveCharacter(input: CharacterProfileInput): CharacterProfile {
    const now = new Date().toISOString();
    const id = input.id ?? randomUUID();
    const existing = this.studioDb.db
      .prepare("SELECT created_at, usage_count, last_used_at FROM characters WHERE id = ?")
      .get(id) as
      | { created_at: string; usage_count: number; last_used_at: string | null }
      | undefined;

    const upsert = this.studioDb.db.prepare(
      `INSERT INTO characters (
         id, name, description, appearance, clothing, prompt_prefix, negative_prompt,
         trigger_words_json, architecture, checkpoint_path, checkpoint_name,
         lora_recipe_id, reference_mode, reference_weight, reference_start,
         reference_end, tags_json, favorite, usage_count, last_used_at,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         appearance = excluded.appearance,
         clothing = excluded.clothing,
         prompt_prefix = excluded.prompt_prefix,
         negative_prompt = excluded.negative_prompt,
         trigger_words_json = excluded.trigger_words_json,
         architecture = excluded.architecture,
         checkpoint_path = excluded.checkpoint_path,
         checkpoint_name = excluded.checkpoint_name,
         lora_recipe_id = excluded.lora_recipe_id,
         reference_mode = excluded.reference_mode,
         reference_weight = excluded.reference_weight,
         reference_start = excluded.reference_start,
         reference_end = excluded.reference_end,
         tags_json = excluded.tags_json,
         favorite = excluded.favorite,
         updated_at = excluded.updated_at`
    );

    const demotePrimary = this.studioDb.db.prepare(
      "UPDATE character_references SET role = 'secondary' WHERE character_id = ? AND role = 'primary'"
    );
    const updateRef = this.studioDb.db.prepare(
      "UPDATE character_references SET role = ?, caption = ?, weight = ? WHERE id = ? AND character_id = ?"
    );

    this.studioDb.transaction(() => {
      upsert.run(
        id,
        input.name.trim(),
        input.description ?? "",
        input.appearance ?? "",
        input.clothing ?? "",
        input.promptPrefix ?? "",
        input.negativePrompt ?? "",
        JSON.stringify(input.triggerWords ?? []),
        input.architecture ?? "unknown",
        input.checkpointPath ?? null,
        input.checkpointName ?? null,
        input.loraRecipeId ?? null,
        input.referenceMode ?? "none",
        input.referenceWeight ?? 0.75,
        input.referenceStart ?? 0,
        input.referenceEnd ?? 1,
        JSON.stringify(input.tags ?? []),
        input.favorite ? 1 : 0,
        existing?.usage_count ?? 0,
        existing?.last_used_at ?? null,
        existing?.created_at ?? now,
        now
      );

      if (input.references && input.references.length > 0) {
        const desiredPrimary = input.references.find((r) => r.role === "primary");
        if (desiredPrimary) demotePrimary.run(id);
        let primaryAssigned = false;
        for (const ref of input.references) {
          const role: CharacterReferenceRole =
            ref.role === "primary" && !primaryAssigned ? "primary" : ref.role === "primary" ? "secondary" : ref.role;
          if (role === "primary") primaryAssigned = true;
          updateRef.run(
            role,
            ref.caption ?? "",
            ref.weight ?? 1,
            ref.id,
            id
          );
        }
      }
    });

    const saved = this.getCharacterById(id);
    if (!saved) {
      throw new Error(`Failed to persist character ${id}`);
    }
    return saved;
  }

  deleteCharacter(id: string): boolean {
    const result = this.studioDb.db
      .prepare("DELETE FROM characters WHERE id = ?")
      .run(id);
    return result.changes > 0;
  }

  addCharacterReference(input: {
    characterId: string;
    filePath: string;
    sourcePath?: string | null;
    role?: CharacterReferenceRole;
    caption?: string;
    weight?: number;
  }): CharacterReference {
    if (!this.getCharacterById(input.characterId)) {
      throw new Error(`Unknown character id: ${input.characterId}`);
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    const role = input.role ?? "secondary";

    const nextPosition = this.studioDb.db
      .prepare(
        "SELECT COALESCE(MAX(position), -1) + 1 AS next FROM character_references WHERE character_id = ?"
      )
      .get(input.characterId) as { next: number };

    this.studioDb.transaction(() => {
      if (role === "primary") {
        this.studioDb.db
          .prepare(
            "UPDATE character_references SET role = 'secondary' WHERE character_id = ? AND role = 'primary'"
          )
          .run(input.characterId);
      }
      this.studioDb.db
        .prepare(
          `INSERT INTO character_references (
             id, character_id, role, file_path, source_path, caption, weight, position, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          input.characterId,
          role,
          input.filePath,
          input.sourcePath ?? null,
          input.caption ?? "",
          input.weight ?? 1,
          nextPosition.next,
          now
        );
      this.studioDb.db
        .prepare("UPDATE characters SET updated_at = ? WHERE id = ?")
        .run(now, input.characterId);
    });

    const row = this.studioDb.db
      .prepare("SELECT * FROM character_references WHERE id = ?")
      .get(id) as Record<string, unknown>;
    return mapCharacterReferenceRow(row);
  }

  updateCharacterReference(
    characterId: string,
    refId: string,
    patch: { role?: CharacterReferenceRole; caption?: string; weight?: number }
  ): CharacterReference | null {
    const current = this.studioDb.db
      .prepare("SELECT * FROM character_references WHERE id = ? AND character_id = ?")
      .get(refId, characterId) as Record<string, unknown> | undefined;
    if (!current) return null;
    const existing = mapCharacterReferenceRow(current);
    const now = new Date().toISOString();

    this.studioDb.transaction(() => {
      if (patch.role === "primary") {
        this.studioDb.db
          .prepare(
            "UPDATE character_references SET role = 'secondary' WHERE character_id = ? AND role = 'primary' AND id != ?"
          )
          .run(characterId, refId);
      }
      this.studioDb.db
        .prepare(
          "UPDATE character_references SET role = ?, caption = ?, weight = ? WHERE id = ? AND character_id = ?"
        )
        .run(
          patch.role ?? existing.role,
          patch.caption ?? existing.caption,
          patch.weight ?? existing.weight,
          refId,
          characterId
        );
      this.studioDb.db
        .prepare("UPDATE characters SET updated_at = ? WHERE id = ?")
        .run(now, characterId);
    });

    const row = this.studioDb.db
      .prepare("SELECT * FROM character_references WHERE id = ?")
      .get(refId) as Record<string, unknown>;
    return mapCharacterReferenceRow(row);
  }

  removeCharacterReference(characterId: string, refId: string): CharacterReference | null {
    const row = this.studioDb.db
      .prepare("SELECT * FROM character_references WHERE id = ? AND character_id = ?")
      .get(refId, characterId) as Record<string, unknown> | undefined;
    if (!row) return null;
    const now = new Date().toISOString();
    this.studioDb.transaction(() => {
      this.studioDb.db
        .prepare("DELETE FROM character_references WHERE id = ? AND character_id = ?")
        .run(refId, characterId);
      this.studioDb.db
        .prepare("UPDATE characters SET updated_at = ? WHERE id = ?")
        .run(now, characterId);
    });
    return mapCharacterReferenceRow(row);
  }

  markCharacterUsed(id: string): void {
    const now = new Date().toISOString();
    this.studioDb.db
      .prepare(
        "UPDATE characters SET usage_count = usage_count + 1, last_used_at = ? WHERE id = ?"
      )
      .run(now, id);
  }

}
