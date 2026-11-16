import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ImagePlus,
  Pencil,
  Plus,
  Sparkles,
  Star,
  Trash2,
  UserRound,
  Users,
  Wand2,
} from "lucide-react";
import {
  ARCHITECTURE_LABELS,
  evaluateLoraCompatibility,
  getEffectiveArchitecture,
  getEffectiveModelInfo,
  isGenerationSupportedArchitecture,
} from "../../shared/model-utils";
import {
  CHARACTER_REFERENCE_MODE_LABELS,
  CHARACTER_REFERENCE_ROLE_LABELS,
  characterReferenceDenoise,
  getCharacterCoverReference,
  getCharacterIdentityTokens,
} from "../../shared/character-utils";
import type {
  CharacterProfile,
  CharacterProfileInput,
  CharacterReferenceMode,
  CharacterReferenceRole,
  LoraRecipe,
  ModelArchitecture,
  ModelRecord,
} from "../../shared/types";
import { toMediaUrl } from "../utils/format";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Input,
  Modal,
  SectionHeader,
  Select,
  SliderField,
  Textarea,
} from "../components/ui/Primitives";

interface CharactersPageProps {
  characters: CharacterProfile[];
  models: ModelRecord[];
  recipes: LoraRecipe[];
  onSaveCharacter: (input: CharacterProfileInput) => Promise<CharacterProfile>;
  onDeleteCharacter: (id: string) => Promise<boolean>;
  onPickReference: (
    characterId: string,
    role: CharacterReferenceRole
  ) => Promise<CharacterProfile | null>;
  onUpdateReference: (
    characterId: string,
    referenceId: string,
    patch: { role?: CharacterReferenceRole; caption?: string }
  ) => Promise<CharacterProfile | null>;
  onRemoveReference: (
    characterId: string,
    referenceId: string
  ) => Promise<CharacterProfile | null>;
  onUseCharacter: (character: CharacterProfile) => void;
  onToast: (message: string, tone?: "info" | "error") => void;
  initialCharacterId?: string;
  onFocusApplied?: () => void;
}

const REFERENCE_ROLES: CharacterReferenceRole[] = [
  "primary",
  "secondary",
  "expression",
  "outfit",
  "pose",
];

const ARCHITECTURE_OPTIONS = Object.keys(
  ARCHITECTURE_LABELS
) as ModelArchitecture[];

function splitTokens(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function referenceModeBadgeTone(
  mode: CharacterReferenceMode
): "neutral" | "accent" | "warning" {
  if (mode === "img2img") return "accent";
  if (mode === "ipadapter" || mode === "controlnet") return "warning";
  return "neutral";
}

const CharacterCover: React.FC<{
  character: CharacterProfile;
  className?: string;
}> = ({ character, className = "" }) => {
  const cover = getCharacterCoverReference(character);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setPreview(null);
    if (!cover) return;
    void window.kirea
      .getCharacterPreview(character.id)
      .then((dataUrl) => {
        if (active) setPreview(dataUrl);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [character.id, character.updatedAt, cover?.filePath]);

  if (!cover) {
    return (
      <div
        className={`flex items-center justify-center bg-surface-subtle text-fg-subtle ${className}`}
      >
        <UserRound className="w-7 h-7" />
      </div>
    );
  }

  if (!preview) {
    return (
      <div
        className={`flex items-center justify-center bg-surface-subtle text-fg-subtle ${className}`}
      >
        <UserRound className="w-7 h-7 animate-pulse" />
      </div>
    );
  }

  return (
    <img
      src={preview}
      alt={`${character.name} reference`}
      className={`object-cover bg-surface-subtle ${className}`}
    />
  );
};

const ReferenceThumb: React.FC<{ reference: { filePath: string; caption: string } }> = ({
  reference,
}) => (
  <img
    src={toMediaUrl(reference.filePath)}
    alt={reference.caption || "Character reference"}
    className="w-14 h-14 rounded-lg object-cover border border-border bg-surface-subtle"
  />
);

interface EditorFormState {
  name: string;
  description: string;
  appearance: string;
  clothing: string;
  promptPrefix: string;
  negativePrompt: string;
  triggerWordsText: string;
  tagsText: string;
  architecture: ModelArchitecture;
  checkpointPath: string;
  loraRecipeId: string;
  referenceMode: CharacterReferenceMode;
  referenceWeight: number;
  favorite: boolean;
}

function toFormState(character: CharacterProfile | null): EditorFormState {
  return {
    name: character?.name ?? "",
    description: character?.description ?? "",
    appearance: character?.appearance ?? "",
    clothing: character?.clothing ?? "",
    promptPrefix: character?.promptPrefix ?? "",
    negativePrompt: character?.negativePrompt ?? "",
    triggerWordsText: (character?.triggerWords ?? []).join(", "),
    tagsText: (character?.tags ?? []).join(", "),
    architecture: character?.architecture ?? "sdxl",
    checkpointPath: character?.checkpointPath ?? "",
    loraRecipeId: character?.loraRecipeId ?? "",
    referenceMode: character?.referenceMode ?? "none",
    referenceWeight: character?.referenceWeight ?? 0.75,
    favorite: character?.favorite ?? false,
  };
}

export const CharactersPage: React.FC<CharactersPageProps> = ({
  characters,
  models,
  recipes,
  onSaveCharacter,
  onDeleteCharacter,
  onPickReference,
  onUpdateReference,
  onRemoveReference,
  onUseCharacter,
  onToast,
  initialCharacterId,
  onFocusApplied,
}) => {
  const [search, setSearch] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<CharacterProfile | null>(null);
  const [form, setForm] = useState<EditorFormState>(() => toFormState(null));
  const [saving, setSaving] = useState(false);
  const [addingReference, setAddingReference] = useState(false);
  const [referenceRole, setReferenceRole] =
    useState<CharacterReferenceRole>("secondary");
  const [deleteTarget, setDeleteTarget] = useState<CharacterProfile | null>(null);

  const checkpointModels = useMemo(
    () =>
      models
        .filter(
          (m) =>
            m.installed &&
            (m.category === "checkpoint" ||
              (m.category === "diffusion_model" &&
                ["z_image", "anima"].includes(getEffectiveArchitecture(m)))) &&
            isGenerationSupportedArchitecture(getEffectiveArchitecture(m))
        )
        .sort((a, b) =>
          getEffectiveModelInfo(a).name.localeCompare(getEffectiveModelInfo(b).name)
        ),
    [models]
  );

  const compatibleRecipes = useMemo(
    () =>
      recipes.filter(
        (recipe) =>
          recipe.id === form.loraRecipeId ||
          recipe.items
            .filter((item) => item.enabled)
            .every(
              (item) =>
                evaluateLoraCompatibility(item.architecture, form.architecture)
                  .compatible
            )
      ),
    [recipes, form.architecture, form.loraRecipeId]
  );

  const visibleCharacters = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return characters;
    return characters.filter((c) =>
      [c.name, c.description, c.appearance, c.tags.join(" ")]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [characters, search]);

  const openNew = (): void => {
    setEditing(null);
    setForm(toFormState(null));
    setReferenceRole("primary");
    setEditorOpen(true);
  };

  const openEdit = (character: CharacterProfile): void => {
    setEditing(character);
    setForm(toFormState(character));
    setReferenceRole("secondary");
    setEditorOpen(true);
  };

  const appliedFocusRef = useRef<string | null>(null);
  useEffect(() => {
    if (!initialCharacterId) {
      appliedFocusRef.current = null;
      return;
    }
    if (appliedFocusRef.current === initialCharacterId) return;
    const target = characters.find((c) => c.id === initialCharacterId);
    if (!target) return;
    appliedFocusRef.current = initialCharacterId;
    openEdit(target);
    onFocusApplied?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCharacterId, characters, onFocusApplied]);

  const updateForm = <K extends keyof EditorFormState>(
    key: K,
    value: EditorFormState[K]
  ): void => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleCheckpointChange = (relativePath: string): void => {
    const model = checkpointModels.find((m) => m.relativePath === relativePath);
    setForm((prev) => ({
      ...prev,
      checkpointPath: relativePath,
      architecture: model ? getEffectiveArchitecture(model) : prev.architecture,
    }));
  };

  const handleSave = async (): Promise<void> => {
    if (!form.name.trim()) {
      onToast("Character needs a name.", "error");
      return;
    }
    setSaving(true);
    try {
      const checkpoint = checkpointModels.find(
        (m) => m.relativePath === form.checkpointPath
      );
      const saved = await onSaveCharacter({
        id: editing?.id,
        name: form.name.trim(),
        description: form.description.trim(),
        appearance: form.appearance.trim(),
        clothing: form.clothing.trim(),
        promptPrefix: form.promptPrefix.trim(),
        negativePrompt: form.negativePrompt.trim(),
        triggerWords: splitTokens(form.triggerWordsText),
        tags: splitTokens(form.tagsText),
        architecture: form.architecture,
        checkpointPath: form.checkpointPath || null,
        checkpointName: checkpoint ? getEffectiveModelInfo(checkpoint).name : null,
        loraRecipeId: form.loraRecipeId || null,
        referenceMode: form.referenceMode,
        referenceWeight: form.referenceWeight,
        favorite: form.favorite,
      });
      setEditing(saved);
      onToast(`Saved character '${saved.name}'.`);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSaving(false);
    }
  };

  const refreshEditing = (updated: CharacterProfile | null): void => {
    if (!updated) return;
    setEditing(updated);
  };

  const handleAddReference = async (): Promise<void> => {
    if (!editing) return;
    setAddingReference(true);
    try {
      const updated = await onPickReference(editing.id, referenceRole);
      if (updated) {
        refreshEditing(updated);
        onToast("Imported character reference.");
        if (referenceRole === "primary") setReferenceRole("secondary");
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setAddingReference(false);
    }
  };

  const handleUpdateReference = async (
    referenceId: string,
    patch: { role?: CharacterReferenceRole; caption?: string }
  ): Promise<void> => {
    if (!editing) return;
    try {
      refreshEditing(await onUpdateReference(editing.id, referenceId, patch));
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const handleRemoveReference = async (referenceId: string): Promise<void> => {
    if (!editing) return;
    try {
      refreshEditing(await onRemoveReference(editing.id, referenceId));
      onToast("Removed character reference.");
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const handleDelete = async (character: CharacterProfile): Promise<void> => {
    try {
      const deleted = await onDeleteCharacter(character.id);
      if (deleted) {
        setEditorOpen(false);
        setEditing(null);
        onToast(`Deleted character '${character.name}'.`);
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const identityTokens = getCharacterIdentityTokens({
    promptPrefix: form.promptPrefix,
    appearance: form.appearance,
    clothing: form.clothing,
    triggerWords: splitTokens(form.triggerWordsText),
  });

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Character Hub"
        subtitle="Reusable identity profiles that inject prompt tokens, checkpoints, LoRA recipes, and stock img2img references into Create Studio."
        actions={
          <Button variant="primary" onClick={openNew}>
            <Plus className="w-4 h-4" />
            New Character
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search characters by name, description, or tags…"
          className="max-w-sm"
          aria-label="Search characters"
        />
        <span className="text-small text-fg-subtle tabular-nums">
          {visibleCharacters.length} of {characters.length} characters
        </span>
      </div>

      {characters.length === 0 ? (
        <EmptyState
          icon={<Users className="w-6 h-6" />}
          title="No characters yet"
          description="Create your first identity profile to keep a consistent face, outfit, checkpoint, and LoRA recipe across generations."
          action={
            <Button variant="primary" onClick={openNew}>
              <Plus className="w-4 h-4" />
              Create Character
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {visibleCharacters.map((character) => {
            const cover = getCharacterCoverReference(character);
            const recipe = character.loraRecipeId
              ? recipes.find((r) => r.id === character.loraRecipeId)
              : null;
            return (
              <Card key={character.id} className="overflow-hidden flex flex-col">
                <div className="relative aspect-[4/3] bg-surface-subtle">
                  <CharacterCover character={character} className="w-full h-full" />
                  <div className="absolute top-2 left-2 flex gap-1.5">
                    <Badge tone={referenceModeBadgeTone(character.referenceMode)}>
                      {CHARACTER_REFERENCE_MODE_LABELS[character.referenceMode]}
                    </Badge>
                    {character.favorite && (
                      <Badge tone="warning">
                        <Star className="w-3 h-3 fill-current" />
                        Favorite
                      </Badge>
                    )}
                  </div>
                  <div className="absolute top-2 right-2">
                    <Badge tone="neutral">
                      {ARCHITECTURE_LABELS[character.architecture]}
                    </Badge>
                  </div>
                </div>

                <div className="p-4 flex-1 flex flex-col gap-3">
                  <div>
                    <h3 className="truncate text-h3 text-fg">
                      {character.name}
                    </h3>
                    <p className="mt-0.5 text-small text-fg-muted line-clamp-2 min-h-[2rem]">
                      {character.description ||
                        character.appearance ||
                        "No description yet."}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-1.5 text-caption text-fg-subtle">
                    <span>{character.references.length} references</span>
                    <span aria-hidden="true">·</span>
                    <span>{recipe ? recipe.name : "No LoRA recipe"}</span>
                    <span aria-hidden="true">·</span>
                    <span>{character.usageCount} uses</span>
                  </div>

                  <div className="mt-auto flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => onUseCharacter(character)}
                      disabled={!cover && character.referenceMode === "img2img"}
                    >
                      <Wand2 className="w-3.5 h-3.5" />
                      Use
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => openEdit(character)}>
                      <Pencil className="w-3.5 h-3.5" />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto"
                      onClick={() => setDeleteTarget(character)}
                      aria-label={`Delete ${character.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editing ? `Edit Character · ${editing.name}` : "New Character"}
        maxWidthClass="max-w-5xl"
      >
        <div className="max-h-[75vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-small text-fg-muted">Name</label>
                <Input
                  value={form.name}
                  onChange={(e) => updateForm("name", e.target.value)}
                  placeholder="e.g. Aria"
                />
              </div>

              <div className="space-y-1">
                <label className="text-small text-fg-muted">Description</label>
                <Textarea
                  rows={2}
                  value={form.description}
                  onChange={(e) => updateForm("description", e.target.value)}
                  placeholder="Who is this character?"
                />
              </div>

              <div className="space-y-1">
                <label className="text-small text-fg-muted">Appearance</label>
                <Textarea
                  rows={2}
                  value={form.appearance}
                  onChange={(e) => updateForm("appearance", e.target.value)}
                  placeholder="silver hair, amber eyes, freckles"
                />
              </div>

              <div className="space-y-1">
                <label className="text-small text-fg-muted">Clothing</label>
                <Textarea
                  rows={2}
                  value={form.clothing}
                  onChange={(e) => updateForm("clothing", e.target.value)}
                  placeholder="black tailored coat, crimson scarf"
                />
              </div>

              <div className="space-y-1">
                <label className="text-small text-fg-muted">
                  Prompt prefix (identity tokens)
                </label>
                <Textarea
                  rows={2}
                  value={form.promptPrefix}
                  onChange={(e) => updateForm("promptPrefix", e.target.value)}
                  placeholder="kirea_aria, masterpiece portrait"
                />
              </div>

              <div className="space-y-1">
                <label className="text-small text-fg-muted">Trigger words</label>
                <Input
                  value={form.triggerWordsText}
                  onChange={(e) => updateForm("triggerWordsText", e.target.value)}
                  placeholder="aria_character, silver_hair"
                />
              </div>

              <div className="space-y-1">
                <label className="text-small text-fg-muted">Negative prompt</label>
                <Textarea
                  rows={2}
                  value={form.negativePrompt}
                  onChange={(e) => updateForm("negativePrompt", e.target.value)}
                  placeholder="extra characters, duplicate face"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3 text-small text-fg-muted">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.favorite}
                    onChange={(e) => updateForm("favorite", e.target.checked)}
                    className="accent-accent"
                  />
                  Favorite character
                </label>
                <span className="inline-flex items-center gap-1 text-fg-subtle">
                  <Sparkles className="w-3.5 h-3.5" />
                  {identityTokens.length} identity tokens
                </span>
              </div>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-small text-fg-muted">Architecture</label>
                  <Select
                    value={form.architecture}
                    onChange={(e) =>
                      updateForm("architecture", e.target.value as ModelArchitecture)
                    }
                  >
                    {ARCHITECTURE_OPTIONS.map((arch) => (
                      <option key={arch} value={arch}>
                        {ARCHITECTURE_LABELS[arch]}
                      </option>
                    ))}
                  </Select>
                </div>

                <div className="space-y-1">
                  <label className="text-small text-fg-muted">Checkpoint</label>
                  <Select
                    value={form.checkpointPath}
                    onChange={(e) => handleCheckpointChange(e.target.value)}
                  >
                    <option value="">Use current checkpoint</option>
                    {form.checkpointPath &&
                      !checkpointModels.some(
                        (m) => m.relativePath === form.checkpointPath
                      ) && (
                        <option value={form.checkpointPath}>
                          {editing?.checkpointName ?? form.checkpointPath} (missing)
                        </option>
                      )}
                    {checkpointModels.map((model) => {
                      const info = getEffectiveModelInfo(model);
                      return (
                        <option key={model.id} value={model.relativePath}>
                          [{ARCHITECTURE_LABELS[info.architecture]}] {info.name}
                        </option>
                      );
                    })}
                  </Select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-small text-fg-muted">Linked LoRA recipe</label>
                <Select
                  value={form.loraRecipeId}
                  onChange={(e) => updateForm("loraRecipeId", e.target.value)}
                >
                  <option value="">No recipe</option>
                  {compatibleRecipes.map((recipe) => (
                    <option key={recipe.id} value={recipe.id}>
                      {recipe.name} ({recipe.items.length} LoRAs)
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-1">
                <label className="text-small text-fg-muted">Reference mode</label>
                <Select
                  value={form.referenceMode}
                  onChange={(e) =>
                    updateForm(
                      "referenceMode",
                      e.target.value as CharacterReferenceMode
                    )
                  }
                >
                  <option value="none">
                    {CHARACTER_REFERENCE_MODE_LABELS.none}
                  </option>
                  <option value="img2img">
                    {CHARACTER_REFERENCE_MODE_LABELS.img2img}
                  </option>
                  <option value="ipadapter" disabled>
                    {CHARACTER_REFERENCE_MODE_LABELS.ipadapter}
                  </option>
                  <option value="controlnet" disabled>
                    {CHARACTER_REFERENCE_MODE_LABELS.controlnet}
                  </option>
                </Select>
                <p className="text-caption text-fg-subtle leading-relaxed">
                  {form.referenceMode === "img2img"
                    ? `Uses stock img2img with the primary reference. Identity strength maps to denoise ${characterReferenceDenoise(
                        form.referenceWeight
                      )} (clamped 0.35–0.75).`
                    : "Prompt-only identity conditioning. Selecting a character injects its tokens, checkpoint, and LoRA recipe."}
                </p>
              </div>

              <SliderField
                label="Identity strength"
                value={form.referenceWeight}
                min={0}
                max={1}
                step={0.05}
                onChange={(v) => updateForm("referenceWeight", v)}
              />

              <div className="space-y-1">
                <label className="text-small text-fg-muted">Tags</label>
                <Input
                  value={form.tagsText}
                  onChange={(e) => updateForm("tagsText", e.target.value)}
                  placeholder="anime, cyberpunk, protagonist"
                />
              </div>

              <div className="pt-2 border-t border-border space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-small font-semibold text-fg">References</h4>
                  <Badge tone="neutral">
                    {editing ? editing.references.length : 0} attached
                  </Badge>
                </div>

                {!editing ? (
                  <p className="text-caption text-fg-subtle">
                    Save the character first, then attach reference images.
                  </p>
                ) : (
                  <>
                    {editing.references.length === 0 && (
                      <p className="text-caption text-fg-subtle">
                        No references yet. A primary reference is required for
                        img2img identity conditioning.
                      </p>
                    )}
                    <div className="space-y-2">
                      {editing.references.map((ref) => (
                        <div
                          key={ref.id}
                          className="flex items-start gap-2 p-2 rounded-lg border border-border bg-bg"
                        >
                          <ReferenceThumb reference={ref} />
                          <div className="flex-1 min-w-0 space-y-1.5">
                            <div className="flex items-center gap-2">
                              <Select
                                className="h-7 text-small max-w-[140px]"
                                value={ref.role}
                                onChange={(e) =>
                                  void handleUpdateReference(ref.id, {
                                    role: e.target.value as CharacterReferenceRole,
                                  })
                                }
                              >
                                {REFERENCE_ROLES.map((role) => (
                                  <option key={role} value={role}>
                                    {CHARACTER_REFERENCE_ROLE_LABELS[role]}
                                  </option>
                                ))}
                              </Select>
                              {ref.role === "primary" && (
                                <Badge tone="accent">Primary</Badge>
                              )}
                            </div>
                            <Input
                              className="h-7 text-small"
                              defaultValue={ref.caption}
                              placeholder="Caption (optional)"
                              onBlur={(e) =>
                                void handleUpdateReference(ref.id, {
                                  caption: e.target.value,
                                })
                              }
                            />
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void handleRemoveReference(ref.id)}
                            aria-label="Remove reference"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center gap-2">
                      <Select
                        className="max-w-[160px]"
                        value={referenceRole}
                        onChange={(e) =>
                          setReferenceRole(e.target.value as CharacterReferenceRole)
                        }
                      >
                        {REFERENCE_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {CHARACTER_REFERENCE_ROLE_LABELS[role]}
                          </option>
                        ))}
                      </Select>
                      <Button
                        variant="secondary"
                        loading={addingReference}
                        onClick={() => void handleAddReference()}
                      >
                        <ImagePlus className="w-4 h-4" />
                        Add Reference…
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-border flex flex-wrap items-center justify-between gap-2">
            <div>
              {editing && (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => setDeleteTarget(editing)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete Character
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => setEditorOpen(false)}>
                Close
              </Button>
              <Button variant="primary" loading={saving} onClick={() => void handleSave()}>
                {editing ? "Save Changes" : "Create Character"}
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) void handleDelete(deleteTarget);
        }}
        title="Delete character?"
        description={
          deleteTarget
            ? `This permanently removes '${deleteTarget.name}' and all of its saved reference images from the Kirea Studio app data folder. Generated images stay in your library.`
            : ""
        }
        confirmLabel="Delete Character"
      />
    </div>
  );
};
