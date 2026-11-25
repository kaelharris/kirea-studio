import { randomUUID } from "node:crypto";
import type {
  CharacterAdapter,
  CharacterDataset,
  CharacterIdentityCore,
  CharacterKnowledge,
  CharacterOutfit,
  CharacterProfile,
  CharacterProfileInput,
  CharacterReference,
  CharacterReferenceApproval,
  CharacterReferenceCategory,
  CharacterReferenceRole,
  CharacterTrainingJob,
  VisualTag,
} from "../../../shared/types";
import type { StudioDatabase } from "../database";
import {
  mapCharacterAdapterRow,
  mapCharacterDatasetRow,
  mapCharacterOutfitRow,
  mapCharacterReferenceRow,
  mapCharacterRow,
  mapCharacterTrainingJobRow,
} from "../repo-mappers";

function mapCharacterProfileRow(
  row: Record<string, unknown>,
  references: CharacterReference[] = [],
  outfits: CharacterOutfit[] = [],
  adapters: CharacterAdapter[] = []
): CharacterProfile {
  const profile = mapCharacterRow(row, references, outfits, adapters);
  const storedString = (value: unknown): string | null =>
    value === null || value === undefined ? null : String(value);
  const storedDnaString = (value: unknown, fallback: string): string =>
    value === null || value === undefined ? fallback : String(value);

  return {
    ...profile,
    checkpointPath: storedString(row.checkpoint_path),
    checkpointName: storedString(row.checkpoint_name),
    loraRecipeId: storedString(row.lora_recipe_id),
    activeAdapterId: storedString(row.active_adapter_id),
    activeOutfitId: storedString(row.active_outfit_id),
    dna: profile.dna
      ? {
          ...profile.dna,
          triggerToken: storedDnaString(row.trigger_token, profile.dna.triggerToken),
          gender: storedString(row.gender) ?? undefined,
          archetype: storedString(row.archetype) ?? undefined,
          canonicalDescription: storedDnaString(
            row.canonical_description,
            profile.dna.canonicalDescription
          ),
          negativeConstraints: storedDnaString(
            row.negative_constraints,
            profile.dna.negativeConstraints
          ),
        }
      : profile.dna,
  };
}

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

    let outfitRows: Array<Record<string, unknown>> = [];
    try {
      outfitRows = this.studioDb.db
        .prepare("SELECT * FROM character_outfits ORDER BY character_id, is_default DESC, created_at ASC")
        .all() as Array<Record<string, unknown>>;
    } catch {
      // Table may not exist yet in test harness before migration
    }
    const outfitsByCharacter = new Map<string, CharacterOutfit[]>();
    for (const row of outfitRows) {
      const outfit = mapCharacterOutfitRow(row);
      const list = outfitsByCharacter.get(outfit.characterId) ?? [];
      list.push(outfit);
      outfitsByCharacter.set(outfit.characterId, list);
    }

    let adapterRows: Array<Record<string, unknown>> = [];
    try {
      adapterRows = this.studioDb.db
        .prepare("SELECT * FROM character_adapters ORDER BY character_id, created_at DESC")
        .all() as Array<Record<string, unknown>>;
    } catch {
      // Table may not exist yet in test harness before migration
    }
    const adaptersByCharacter = new Map<string, CharacterAdapter[]>();
    for (const row of adapterRows) {
      const adapter = mapCharacterAdapterRow(row);
      const list = adaptersByCharacter.get(adapter.characterId) ?? [];
      list.push(adapter);
      adaptersByCharacter.set(adapter.characterId, list);
    }

    return rows.map((r) => {
      const id = String(r.id);
      return mapCharacterProfileRow(
        r,
        refsByCharacter.get(id) ?? [],
        outfitsByCharacter.get(id) ?? [],
        adaptersByCharacter.get(id) ?? []
      );
    });
  }

  getCharacterById(id: string): CharacterProfile | null {
    return this.listCharacters().find((c) => c.id === id) ?? null;
  }

  saveCharacter(input: Partial<CharacterProfileInput>): CharacterProfile {
    const now = new Date().toISOString();
    const id = input.id ?? randomUUID();
    const existing = this.studioDb.db
      .prepare("SELECT * FROM characters WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    const current = existing ? mapCharacterProfileRow(existing) : null;
    const name = input.name ?? current?.name;
    if (!name?.trim()) {
      throw new Error("Character name is required.");
    }
    const supplied = Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== undefined)
    ) as Partial<CharacterProfileInput>;
    const suppliedDna = Object.fromEntries(
      Object.entries(input.dna ?? {}).filter(([, value]) => value !== undefined)
    ) as Partial<CharacterIdentityCore>;
    const suppliedKnowledge = Object.fromEntries(
      Object.entries(input.knowledge ?? {}).filter(([, value]) => value !== undefined)
    ) as Partial<CharacterKnowledge>;
    const merged = { ...current, ...supplied, name };
    const dna = (input.dna === undefined
      ? current?.dna
      : { ...current?.dna, ...suppliedDna }) as Partial<CharacterIdentityCore> | undefined;
    const knowledge = (input.knowledge === undefined
      ? current?.knowledge
      : { ...current?.knowledge, ...suppliedKnowledge }) as Partial<CharacterKnowledge> | undefined;

    const upsert = this.studioDb.db.prepare(
      `INSERT INTO characters (
         id, name, description, appearance, clothing, prompt_prefix, negative_prompt,
         trigger_words_json, architecture, checkpoint_path, checkpoint_name,
         lora_recipe_id, reference_mode, reference_weight, reference_start,
         reference_end, tags_json, favorite, usage_count, last_used_at,
         created_at, updated_at,
         trigger_token, gender, age_category, species, archetype, hair_color, hair_style,
         eye_color, skin_tone, facial_characteristics, distinctive_features_json,
         body_characteristics, signature_accessories_json, canonical_description,
         fixed_traits_json, variable_traits_json, preferred_style, negative_constraints,
         personality, speech_style, background, history, relationships_json,
         motivations, likes_json, dislikes_json, rules_json, worldbuilding,
         dialogue_examples_json, dna_locked, active_adapter_id, active_outfit_id
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       )
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
         updated_at = excluded.updated_at,
         trigger_token = excluded.trigger_token,
         gender = excluded.gender,
         age_category = excluded.age_category,
         species = excluded.species,
         archetype = excluded.archetype,
         hair_color = excluded.hair_color,
         hair_style = excluded.hair_style,
         eye_color = excluded.eye_color,
         skin_tone = excluded.skin_tone,
         facial_characteristics = excluded.facial_characteristics,
         distinctive_features_json = excluded.distinctive_features_json,
         body_characteristics = excluded.body_characteristics,
         signature_accessories_json = excluded.signature_accessories_json,
         canonical_description = excluded.canonical_description,
         fixed_traits_json = excluded.fixed_traits_json,
         variable_traits_json = excluded.variable_traits_json,
         preferred_style = excluded.preferred_style,
         negative_constraints = excluded.negative_constraints,
         personality = excluded.personality,
         speech_style = excluded.speech_style,
         background = excluded.background,
         history = excluded.history,
         relationships_json = excluded.relationships_json,
         motivations = excluded.motivations,
         likes_json = excluded.likes_json,
         dislikes_json = excluded.dislikes_json,
         rules_json = excluded.rules_json,
         worldbuilding = excluded.worldbuilding,
         dialogue_examples_json = excluded.dialogue_examples_json,
         dna_locked = excluded.dna_locked,
         active_adapter_id = excluded.active_adapter_id,
         active_outfit_id = excluded.active_outfit_id`
    );

    const demotePrimary = this.studioDb.db.prepare(
      "UPDATE character_references SET role = 'secondary' WHERE character_id = ? AND role = 'primary'"
    );
    const updateRef = this.studioDb.db.prepare(
      `UPDATE character_references SET
         role = ?,
         caption = ?,
         weight = ?,
         category = COALESCE(?, category),
         approval_status = COALESCE(?, approval_status),
         associated_outfit_id = ?,
         included_in_training = COALESCE(?, included_in_training)
       WHERE id = ? AND character_id = ?`
    );

    this.studioDb.transaction(() => {
      upsert.run(
        id,
        name.trim(),
        merged.description ?? "",
        merged.appearance ?? "",
        merged.clothing ?? "",
        merged.promptPrefix ?? "",
        merged.negativePrompt ?? "",
        JSON.stringify(merged.triggerWords ?? []),
        merged.architecture ?? "unknown",
        merged.checkpointPath ?? null,
        merged.checkpointName ?? null,
        merged.loraRecipeId ?? null,
        merged.referenceMode ?? "none",
        merged.referenceWeight ?? 0.75,
        merged.referenceStart ?? 0,
        merged.referenceEnd ?? 1,
        JSON.stringify(merged.tags ?? []),
        merged.favorite ? 1 : 0,
        existing?.usage_count ?? 0,
        existing?.last_used_at ?? null,
        existing?.created_at ?? now,
        now,
        // DNA fields
        dna?.triggerToken ?? (merged.triggerWords?.[0] || `kirea_${merged.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`),
        dna?.gender ?? null,
        dna?.ageCategory ?? "young_adult",
        dna?.species ?? "human",
        dna?.archetype ?? null,
        dna?.hairColor ?? "",
        dna?.hairStyle ?? "",
        dna?.eyeColor ?? "",
        dna?.skinTone ?? "",
        dna?.facialCharacteristics ?? "",
        JSON.stringify(dna?.distinctiveFeatures ?? []),
        dna?.bodyCharacteristics ?? "",
        JSON.stringify(dna?.signatureAccessories ?? []),
        dna?.canonicalDescription ?? merged.appearance ?? "",
        JSON.stringify(dna?.fixedTraits ?? []),
        JSON.stringify(dna?.variableTraits ?? []),
        dna?.preferredStyle ?? "anime aesthetic",
        dna?.negativeConstraints ?? merged.negativePrompt ?? "",
        // Knowledge fields
        knowledge?.personality ?? "",
        knowledge?.speechStyle ?? "",
        knowledge?.background ?? "",
        knowledge?.history ?? "",
        JSON.stringify(knowledge?.relationships ?? []),
        knowledge?.motivations ?? "",
        JSON.stringify(knowledge?.likes ?? []),
        JSON.stringify(knowledge?.dislikes ?? []),
        JSON.stringify(knowledge?.rules ?? []),
        knowledge?.worldbuilding ?? "",
        JSON.stringify(knowledge?.dialogueExamples ?? []),
        dna?.dnaLocked ? 1 : 0,
        merged.activeAdapterId ?? null,
        merged.activeOutfitId ?? null
      );

      if (input.references && input.references.length > 0) {
        const desiredPrimary = input.references.find((r) => r.role === "primary");
        if (desiredPrimary) demotePrimary.run(id);
        let primaryAssigned = false;
        for (const ref of input.references) {
          const role: CharacterReferenceRole =
            ref.role === "primary" && !primaryAssigned
              ? "primary"
              : ref.role === "primary"
                ? "secondary"
                : ref.role ?? "secondary";
          if (role === "primary") primaryAssigned = true;
          updateRef.run(
            role,
            ref.caption ?? "",
            ref.weight ?? 1,
            ref.category ?? null,
            ref.approvalStatus ?? null,
            ref.associatedOutfitId ?? null,
            ref.includedInTraining !== undefined ? (ref.includedInTraining ? 1 : 0) : null,
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

  // --- Visual Memory Reference Management ---

  addCharacterReference(input: {
    characterId: string;
    filePath: string;
    sourcePath?: string | null;
    role?: CharacterReferenceRole;
    caption?: string;
    weight?: number;
    category?: CharacterReferenceCategory;
    approvalStatus?: CharacterReferenceApproval;
    associatedOutfitId?: string | null;
    includedInTraining?: boolean;
    width?: number | null;
    height?: number | null;
    aspectRatio?: string | null;
    suggestedTags?: VisualTag[];
    imageHash?: string | null;
  }): CharacterReference {
    if (!this.getCharacterById(input.characterId)) {
      throw new Error(`Unknown character id: ${input.characterId}`);
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    const role = input.role ?? "secondary";
    const category = input.category ?? (role === "primary" ? "canonical_face" : "other");
    const approvalStatus = input.approvalStatus ?? (role === "primary" ? "approved" : "pending");

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
             id, character_id, role, file_path, source_path, caption, weight, position, created_at,
             category, approval_status, associated_outfit_id, included_in_training,
             width, height, aspect_ratio, suggested_tags_json, image_hash
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
          now,
          category,
          approvalStatus,
          input.associatedOutfitId ?? null,
          input.includedInTraining !== false ? 1 : 0,
          input.width ?? null,
          input.height ?? null,
          input.aspectRatio ?? null,
          JSON.stringify(input.suggestedTags ?? []),
          input.imageHash ?? null
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
    patch: {
      role?: CharacterReferenceRole;
      caption?: string;
      weight?: number;
      category?: CharacterReferenceCategory;
      approvalStatus?: CharacterReferenceApproval;
      associatedOutfitId?: string | null;
      includedInTraining?: boolean;
      suggestedTags?: VisualTag[];
      imageHash?: string | null;
    }
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
          `UPDATE character_references SET
             role = ?,
             caption = ?,
             weight = ?,
             category = ?,
             approval_status = ?,
             associated_outfit_id = ?,
             included_in_training = ?,
             suggested_tags_json = ?,
             image_hash = ?
           WHERE id = ? AND character_id = ?`
        )
        .run(
          patch.role ?? existing.role,
          patch.caption ?? existing.caption,
          patch.weight ?? existing.weight,
          patch.category ?? existing.category ?? "other",
          patch.approvalStatus ?? existing.approvalStatus ?? "pending",
          patch.associatedOutfitId !== undefined ? patch.associatedOutfitId : existing.associatedOutfitId ?? null,
          patch.includedInTraining !== undefined ? (patch.includedInTraining ? 1 : 0) : existing.includedInTraining ? 1 : 0,
          patch.suggestedTags !== undefined ? JSON.stringify(patch.suggestedTags) : JSON.stringify(existing.suggestedTags ?? []),
          patch.imageHash !== undefined ? patch.imageHash : existing.imageHash ?? null,
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

  // --- Outfits (Appearance Layer) ---

  listOutfits(characterId: string): CharacterOutfit[] {
    const rows = this.studioDb.db
      .prepare("SELECT * FROM character_outfits WHERE character_id = ? ORDER BY is_default DESC, created_at ASC")
      .all(characterId) as Array<Record<string, unknown>>;
    return rows.map(mapCharacterOutfitRow);
  }

  saveOutfit(outfit: {
    id?: string;
    characterId: string;
    name: string;
    description?: string;
    promptTokens: string[];
    isDefault?: boolean;
    previewImagePath?: string | null;
  }): CharacterOutfit {
    const id = outfit.id ?? randomUUID();
    const now = new Date().toISOString();

    this.studioDb.transaction(() => {
      const owner = this.studioDb.db
        .prepare("SELECT character_id FROM character_outfits WHERE id = ?")
        .get(id) as { character_id: string } | undefined;
      if (owner && owner.character_id !== outfit.characterId) {
        throw new Error(`Outfit ${id} belongs to another character`);
      }
      if (outfit.isDefault) {
        this.studioDb.db
          .prepare("UPDATE character_outfits SET is_default = 0 WHERE character_id = ?")
          .run(outfit.characterId);
      }
      this.studioDb.db
        .prepare(
          `INSERT INTO character_outfits (
             id, character_id, name, description, prompt_tokens_json, is_default,
             preview_image_path, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             description = excluded.description,
             prompt_tokens_json = excluded.prompt_tokens_json,
             is_default = excluded.is_default,
             preview_image_path = excluded.preview_image_path,
             updated_at = excluded.updated_at
           WHERE character_outfits.character_id = excluded.character_id`
        )
        .run(
          id,
          outfit.characterId,
          outfit.name.trim(),
          outfit.description ?? "",
          JSON.stringify(outfit.promptTokens ?? []),
          outfit.isDefault ? 1 : 0,
          outfit.previewImagePath ?? null,
          now,
          now
        );
    });

    const row = this.studioDb.db
      .prepare("SELECT * FROM character_outfits WHERE id = ? AND character_id = ?")
      .get(id, outfit.characterId) as Record<string, unknown>;
    return mapCharacterOutfitRow(row);
  }

  deleteOutfit(outfitId: string, characterId?: string): boolean {
    const owner = this.studioDb.db
      .prepare("SELECT character_id FROM character_outfits WHERE id = ?")
      .get(outfitId) as { character_id: string } | undefined;
    if (!owner) return false;
    const res = this.studioDb.db
      .prepare("DELETE FROM character_outfits WHERE id = ? AND character_id = ?")
      .run(outfitId, characterId ?? owner.character_id);
    return res.changes > 0;
  }

  // --- Model Memory Adapters ---

  listAdapters(characterId: string): CharacterAdapter[] {
    const rows = this.studioDb.db
      .prepare("SELECT * FROM character_adapters WHERE character_id = ? ORDER BY created_at DESC")
      .all(characterId) as Array<Record<string, unknown>>;
    return rows.map(mapCharacterAdapterRow);
  }

  saveAdapter(adapter: {
    id?: string;
    characterId: string;
    baseModelFamily: string;
    checkpointPath?: string | null;
    checkpointName?: string | null;
    triggerToken: string;
    fileLocation: string;
    trainingConfig?: unknown;
    datasetVersion?: string | null;
    rank?: number;
    alpha?: number;
    recommendedStrength?: number;
    status?: CharacterAdapter["status"];
    validationImages?: string[];
  }): CharacterAdapter {
    const id = adapter.id ?? randomUUID();
    const now = new Date().toISOString();

    this.studioDb.transaction(() => {
      const owner = this.studioDb.db
        .prepare("SELECT character_id FROM character_adapters WHERE id = ?")
        .get(id) as { character_id: string } | undefined;
      if (owner && owner.character_id !== adapter.characterId) {
        throw new Error(`Adapter ${id} belongs to another character`);
      }
      this.studioDb.db
        .prepare(
          `INSERT INTO character_adapters (
             id, character_id, base_model_family, checkpoint_path, checkpoint_name,
             trigger_token, file_location, training_config_json, dataset_version,
             rank, alpha, recommended_strength, status, validation_images_json,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             base_model_family = excluded.base_model_family,
             checkpoint_path = excluded.checkpoint_path,
             checkpoint_name = excluded.checkpoint_name,
             trigger_token = excluded.trigger_token,
             file_location = excluded.file_location,
             training_config_json = excluded.training_config_json,
             dataset_version = excluded.dataset_version,
             rank = excluded.rank,
             alpha = excluded.alpha,
             recommended_strength = excluded.recommended_strength,
             status = excluded.status,
             validation_images_json = excluded.validation_images_json,
             updated_at = excluded.updated_at
           WHERE character_adapters.character_id = excluded.character_id`
        )
        .run(
          id,
          adapter.characterId,
          adapter.baseModelFamily,
          adapter.checkpointPath ?? null,
          adapter.checkpointName ?? null,
          adapter.triggerToken,
          adapter.fileLocation,
          adapter.trainingConfig ? JSON.stringify(adapter.trainingConfig) : null,
          adapter.datasetVersion ?? null,
          adapter.rank ?? 16,
          adapter.alpha ?? 16,
          adapter.recommendedStrength ?? 0.85,
          adapter.status ?? "trained",
          JSON.stringify(adapter.validationImages ?? []),
          now,
          now
        );
    });

    const row = this.studioDb.db
      .prepare("SELECT * FROM character_adapters WHERE id = ? AND character_id = ?")
      .get(id, adapter.characterId) as Record<string, unknown>;
    return mapCharacterAdapterRow(row);
  }

  deleteAdapter(adapterId: string, characterId?: string): boolean {
    const owner = this.studioDb.db
      .prepare("SELECT character_id FROM character_adapters WHERE id = ?")
      .get(adapterId) as { character_id: string } | undefined;
    if (!owner) return false;
    const res = this.studioDb.db
      .prepare("DELETE FROM character_adapters WHERE id = ? AND character_id = ?")
      .run(adapterId, characterId ?? owner.character_id);
    return res.changes > 0;
  }

  // --- Datasets & Versions ---

  listDatasets(characterId: string): CharacterDataset[] {
    const rows = this.studioDb.db
      .prepare("SELECT * FROM character_datasets WHERE character_id = ? ORDER BY created_at DESC")
      .all(characterId) as Array<Record<string, unknown>>;
    return rows.map(mapCharacterDatasetRow);
  }

  getDataset(datasetId: string): CharacterDataset | null {
    const row = this.studioDb.db
      .prepare("SELECT * FROM character_datasets WHERE id = ?")
      .get(datasetId) as Record<string, unknown> | undefined;
    return row ? mapCharacterDatasetRow(row) : null;
  }

  saveDataset(dataset: {
    id?: string;
    characterId: string;
    version: string;
    name: string;
    itemCount: number;
    items: unknown[];
    exportPath?: string | null;
  }): CharacterDataset {
    const id = dataset.id ?? randomUUID();
    const now = new Date().toISOString();

    this.studioDb.db
      .prepare(
        `INSERT INTO character_datasets (
           id, character_id, version, name, item_count, manifest_json, export_path, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           item_count = excluded.item_count,
           manifest_json = excluded.manifest_json,
           export_path = excluded.export_path`
      )
      .run(
        id,
        dataset.characterId,
        dataset.version,
        dataset.name,
        dataset.itemCount,
        JSON.stringify(dataset.items ?? []),
        dataset.exportPath ?? null,
        now
      );

    const row = this.studioDb.db
      .prepare("SELECT * FROM character_datasets WHERE id = ?")
      .get(id) as Record<string, unknown>;
    return mapCharacterDatasetRow(row);
  }

  // --- Training Jobs ---

  listTrainingJobs(characterId?: string): CharacterTrainingJob[] {
    const stmt = characterId
      ? this.studioDb.db.prepare(
          "SELECT * FROM character_training_jobs WHERE character_id = ? ORDER BY submitted_at DESC"
        )
      : this.studioDb.db.prepare(
          "SELECT * FROM character_training_jobs ORDER BY submitted_at DESC"
        );
    const rows = (characterId ? stmt.all(characterId) : stmt.all()) as Array<Record<string, unknown>>;
    return rows.map(mapCharacterTrainingJobRow);
  }

  getTrainingJob(id: string): CharacterTrainingJob | null {
    const row = this.studioDb.db
      .prepare("SELECT * FROM character_training_jobs WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? mapCharacterTrainingJobRow(row) : null;
  }

  saveTrainingJob(job: CharacterTrainingJob): CharacterTrainingJob {
    this.studioDb.db
      .prepare(
        `INSERT INTO character_training_jobs (
           id, character_id, adapter_id, base_model_family, status,
           progress_step, progress_max, current_epoch, total_epochs, loss,
           config_json, error_message, logs_text, output_adapter_path,
           submitted_at, started_at, completed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           adapter_id = excluded.adapter_id,
           status = excluded.status,
           progress_step = excluded.progress_step,
           progress_max = excluded.progress_max,
           current_epoch = excluded.current_epoch,
           total_epochs = excluded.total_epochs,
           loss = excluded.loss,
           config_json = excluded.config_json,
           error_message = excluded.error_message,
           logs_text = excluded.logs_text,
           output_adapter_path = excluded.output_adapter_path,
           started_at = excluded.started_at,
           completed_at = excluded.completed_at`
      )
      .run(
        job.id,
        job.characterId,
        job.adapterId ?? null,
        job.baseModelFamily ?? "illustrious",
        job.status,
        job.progressStep,
        job.progressMax,
        job.currentEpoch ?? 0,
        job.totalEpochs ?? 0,
        job.loss ?? null,
        JSON.stringify(job.config ?? {}),
        job.errorMessage ?? null,
        job.logsText ?? "",
        job.outputAdapterPath ?? null,
        job.submittedAt,
        job.startedAt ?? null,
        job.completedAt ?? null
      );

    return this.getTrainingJob(job.id)!;
  }

  getVisualTagCache(imageHash: string): { tags: VisualTag[]; taggerVersion: string } | null {
    try {
      const row = this.studioDb.db
        .prepare("SELECT tags_json, tagger_version FROM visual_tag_cache WHERE image_hash = ?")
        .get(imageHash) as { tags_json: string; tagger_version: string } | undefined;
      if (!row) return null;
      return {
        tags: JSON.parse(row.tags_json) as VisualTag[],
        taggerVersion: row.tagger_version,
      };
    } catch {
      return null;
    }
  }

  setVisualTagCache(imageHash: string, tags: VisualTag[], taggerVersion: string): void {
    try {
      const now = new Date().toISOString();
      this.studioDb.db
        .prepare(
          `INSERT INTO visual_tag_cache (image_hash, tags_json, tagger_version, created_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(image_hash) DO UPDATE SET
             tags_json = excluded.tags_json,
             tagger_version = excluded.tagger_version,
             created_at = excluded.created_at`
        )
        .run(imageHash, JSON.stringify(tags), taggerVersion, now);
    } catch {
      // Ignore cache persistence error
    }
  }
}
