import React, { useEffect, useMemo, useRef, useState } from "react";
import { Boxes, CheckCircle2, Compass, Dice5, Plus, Sparkles, Trash2, UserRound, Wand2 } from "lucide-react";
import type {
  PixelAssetDetail,
  PixelAssetRecord,
  PixelCharacter,
} from "../../../shared/pixel-types";
import { PIXEL_PALETTES } from "../../../shared/pixel-types";
import type {
  PixelAiBackendStatus,
  PixelAiGenerateInput,
  PixelAiJob,
} from "../../../shared/pixel-ai-types";
import { SPRITEKILN_STYLES } from "../../../shared/pixel-ai-types";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Input,
  ProgressBar,
  Select,
  SliderField,
  Textarea,
} from "../ui/Primitives";
import { PixelField, PixelImage, formatPixelDate } from "./pixel-ui";
import { PackageExportDialog, type PackageExportTarget } from "./PackageExportDialog";

interface CharacterStudioProps {
  projectId: string;
  characters: PixelCharacter[];
  assets: PixelAssetRecord[];
  focusCharacterId?: string;
  onCharactersChanged: () => Promise<void> | void;
  onGenerated: (details: PixelAssetDetail[]) => void;
  onInspect: (assetId: string, target: "animation" | "editor") => void;
  onToast: (message: string, tone?: "info" | "error") => void;
}

const EMPTY_FORM = {
  id: "",
  name: "",
  description: "",
  paletteId: "kirea",
  seed: 0,
  referenceAssetId: "",
};

const AI_BLOCKED_STATES = new Set(["setup_required", "workflows_missing", "unreachable"]);

export const CharacterStudioPanel: React.FC<CharacterStudioProps> = ({
  projectId,
  characters,
  assets,
  focusCharacterId,
  onCharactersChanged,
  onGenerated,
  onInspect,
  onToast,
}) => {
  const [selectedId, setSelectedId] = useState<string>("");
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [busy, setBusy] = useState(false);
  const [viewSize, setViewSize] = useState(32);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [packageTarget, setPackageTarget] = useState<PackageExportTarget | null>(null);

  const [aiPrompt, setAiPrompt] = useState("");
  const [variation, setVariation] = useState("");
  const [aiStyle, setAiStyle] = useState("character (front, RPG)");
  const [aiStrength, setAiStrength] = useState(0.7);
  const [aiStatus, setAiStatus] = useState<PixelAiBackendStatus | null>(null);
  const [aiStatusError, setAiStatusError] = useState<string | null>(null);
  const [aiJob, setAiJob] = useState<PixelAiJob | null>(null);
  const [aiSubmitting, setAiSubmitting] = useState(false);
  const aiJobIdRef = useRef<string | null>(null);
  const handledAiJobRef = useRef<string | null>(null);
  const autoReferenceRef = useRef<PixelCharacter | null>(null);

  const [directionCount, setDirectionCount] = useState<4 | 8>(4);
  const [directionJob, setDirectionJob] = useState<PixelAiJob | null>(null);
  const [directionAssets, setDirectionAssets] = useState<PixelAssetDetail[]>([]);
  const [directionSubmitting, setDirectionSubmitting] = useState(false);
  const directionJobIdRef = useRef<string | null>(null);
  const handledDirectionJobRef = useRef<string | null>(null);

  const selected = useMemo(
    () => characters.find((character) => character.id === selectedId) ?? null,
    [characters, selectedId]
  );

  useEffect(() => {
    if (!selectedId && characters[0]) {
      setSelectedId(characters[0].id);
    }
  }, [characters, selectedId]);

  useEffect(() => {
    if (focusCharacterId && characters.some((character) => character.id === focusCharacterId)) {
      setSelectedId(focusCharacterId);
    }
  }, [characters, focusCharacterId]);

  useEffect(() => {
    if (!selected) {
      setForm({ ...EMPTY_FORM, seed: Math.floor(Math.random() * 100000) });
      return;
    }
    setForm({
      id: selected.id,
      name: selected.name,
      description: selected.description,
      paletteId: selected.paletteId,
      seed: selected.seed,
      referenceAssetId: selected.referenceAssetId ?? "",
    });
  }, [selected?.id]);

  useEffect(() => {
    setAiPrompt(selected?.description ?? "");
    setVariation("");
  }, [selected?.id]);

  useEffect(() => {
    void window.kirea
      .getPixelAiStatus()
      .then(setAiStatus)
      .catch((error: unknown) => {
        setAiStatusError(
          error instanceof Error ? error.message : "Could not inspect the pixel backend."
        );
      });
  }, []);

  useEffect(() => {
    return window.kirea.onPixelAiJobUpdated((updated) => {
      if (directionJobIdRef.current === updated.id) {
        setDirectionJob(updated);
        if (updated.status !== "completed") return;
        if (handledDirectionJobRef.current === updated.id) return;
        handledDirectionJobRef.current = updated.id;
        directionJobIdRef.current = null;
        const ids = updated.assetIds.length
          ? updated.assetIds
          : updated.assetId
            ? [updated.assetId]
            : [];
        void Promise.all(ids.map((id) => window.kirea.getPixelAsset(id)))
          .then((details) => {
            setDirectionAssets(details);
            onGenerated(details);
            onToast(`Generated ${details.length} directional sprites.`, "info");
          })
          .catch((error: unknown) => {
            onToast(
              error instanceof Error ? error.message : "Could not open the directional sprites.",
              "error"
            );
          });
        return;
      }
      if (aiJobIdRef.current !== updated.id) return;
      setAiJob(updated);
      if (updated.status !== "completed" || !updated.assetId) return;
      if (handledAiJobRef.current === updated.id) return;
      handledAiJobRef.current = updated.id;
      aiJobIdRef.current = null;
      const autoCharacter = autoReferenceRef.current;
      autoReferenceRef.current = null;
      void window.kirea
        .getPixelAsset(updated.assetId)
        .then(async (detail) => {
          if (autoCharacter) {
            try {
              await window.kirea.savePixelCharacter({
                id: autoCharacter.id,
                projectId: autoCharacter.projectId,
                name: autoCharacter.name,
                description: autoCharacter.description,
                seed: autoCharacter.seed,
                paletteId: autoCharacter.paletteId,
                referenceAssetId: detail.id,
              });
              await onCharactersChanged();
              setForm((prev) => ({ ...prev, referenceAssetId: detail.id }));
              onToast(
                `${autoCharacter.name} now uses ${detail.name} as its identity reference.`,
                "info"
              );
            } catch (error) {
              onToast(
                error instanceof Error
                  ? error.message
                  : "The identity was generated but could not be stored as the reference.",
                "error"
              );
            }
          }
          onGenerated([detail]);
        })
        .catch((error: unknown) => {
          onToast(
            error instanceof Error ? error.message : "Could not open the generated asset.",
            "error"
          );
        });
    });
  }, [onCharactersChanged, onGenerated, onToast]);

  const characterAssets = useMemo(
    () => assets.filter((asset) => asset.characterId === selectedId),
    [assets, selectedId]
  );

  const characterPreview = (characterId: string): string | undefined =>
    assets.find((asset) => asset.characterId === characterId)?.previewDataUrl;

  const startNew = (): void => {
    setSelectedId("");
    setForm({ ...EMPTY_FORM, seed: Math.floor(Math.random() * 100000) });
  };

  const save = async (silent = false): Promise<PixelCharacter | null> => {
    if (!projectId) return null;
    if (!form.name.trim()) {
      onToast("Give the character a name before saving.", "error");
      return null;
    }
    setBusy(true);
    try {
      const saved = await window.kirea.savePixelCharacter({
        id: form.id || undefined,
        projectId,
        name: form.name.trim(),
        description: form.description.trim(),
        paletteId: form.paletteId,
        seed: Math.max(0, Math.round(form.seed)),
        referenceAssetId: form.referenceAssetId || null,
      });
      await onCharactersChanged();
      setSelectedId(saved.id);
      if (!silent) onToast(form.id ? "Character updated." : "Character created.", "info");
      return saved;
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Could not save the character.", "error");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const startAi = async (variant: "identity" | "variation"): Promise<void> => {
    if (!projectId) return;
    if (variant === "variation" && !form.referenceAssetId) {
      onToast("Set an identity reference before generating variations.", "error");
      return;
    }
    if (variant === "variation" && !variation.trim()) {
      onToast("Describe the clothing, equipment or pose change.", "error");
      return;
    }
    const character = await save(true);
    if (!character) return;
    const base = (aiPrompt.trim() || character.description.trim() || character.name).trim();
    const referenceId = character.referenceAssetId;
    const change = variation.trim();
    const input: PixelAiGenerateInput = {
      projectId,
      characterId: character.id,
      parentAssetId: referenceId,
      kind: "character",
      name: `${character.name} · ${variant === "variation" ? change.slice(0, 60) : "identity"}`.slice(
        0,
        120
      ),
      mode: referenceId ? "reference" : "text",
      prompt: variant === "variation" ? `${base}. ${change}` : base,
      width: viewSize,
      height: viewSize,
      paletteId: character.paletteId,
      seed: character.seed,
      style: aiStyle,
      transparent: true,
      longSide: 1024,
    };
    if (referenceId) {
      input.reference = { subject: { kind: "asset", assetId: referenceId } };
      input.strength = aiStrength;
    }
    setAiSubmitting(true);
    try {
      const started = await window.kirea.generatePixelAi(input);
      handledAiJobRef.current = null;
      autoReferenceRef.current = !referenceId && variant === "identity" ? character : null;
      aiJobIdRef.current = started.id;
      setAiJob(started);
    } catch (error) {
      onToast(
        error instanceof Error ? error.message : "Could not start AI generation.",
        "error"
      );
    } finally {
      setAiSubmitting(false);
    }
  };

  const startDirections = async (): Promise<void> => {
    if (!projectId) return;
    if (!form.referenceAssetId) {
      onToast("Set an identity reference before generating directions.", "error");
      return;
    }
    const character = await save(true);
    if (!character || !character.referenceAssetId) return;
    const referenceId = character.referenceAssetId;
    const base = (aiPrompt.trim() || character.description.trim() || character.name).trim();
    const input: PixelAiGenerateInput = {
      projectId,
      characterId: character.id,
      parentAssetId: referenceId,
      kind: "character",
      name: `${character.name} · ${directionCount} directions`.slice(0, 120),
      mode: "directions",
      prompt: base,
      width: viewSize,
      height: viewSize,
      paletteId: character.paletteId,
      seed: character.seed,
      style: aiStyle,
      transparent: true,
      longSide: 1024,
      directionCount,
      reference: { subject: { kind: "asset", assetId: referenceId } },
    };
    setDirectionSubmitting(true);
    try {
      const started = await window.kirea.generatePixelAi(input);
      handledDirectionJobRef.current = null;
      directionJobIdRef.current = started.id;
      setDirectionJob(started);
      setDirectionAssets([]);
    } catch (error) {
      onToast(
        error instanceof Error ? error.message : "Could not start direction generation.",
        "error"
      );
    } finally {
      setDirectionSubmitting(false);
    }
  };

  const useAsReference = async (assetId: string): Promise<void> => {
    if (!selected) return;
    setForm((prev) => ({ ...prev, referenceAssetId: assetId }));
    try {
      await window.kirea.savePixelCharacter({
        id: selected.id,
        projectId: selected.projectId,
        name: form.name.trim() || selected.name,
        description: form.description.trim(),
        seed: Math.max(0, Math.round(form.seed)),
        paletteId: form.paletteId,
        referenceAssetId: assetId,
      });
      await onCharactersChanged();
      onToast("Identity reference updated.", "info");
    } catch (error) {
      onToast(
        error instanceof Error ? error.message : "Could not update the identity reference.",
        "error"
      );
    }
  };

  const generateViews = async (): Promise<void> => {
    const character = selected ?? (await save());
    if (!character) return;
    setBusy(true);
    try {
      const details = await window.kirea.generatePixelCharacterViews(
        character.id,
        Math.max(0, Math.round(form.seed)),
        viewSize,
        viewSize
      );
      onGenerated(details);
      onToast(`Rendered ${details.length} facings for ${character.name}.`, "info");
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Could not render facings.", "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (!selected) return;
    try {
      await window.kirea.deletePixelCharacter(selected.id);
      await onCharactersChanged();
      setSelectedId("");
      onToast("Character deleted. Its rendered assets stay in the library.", "info");
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Could not delete the character.", "error");
    }
  };

  const referenceAsset = assets.find((asset) => asset.id === form.referenceAssetId) ?? null;
  const aiCapabilityId = form.referenceAssetId ? "reference_to_pixel" : "text_to_pixel";
  const aiCapability =
    aiStatus?.capabilities.find((entry) => entry.id === aiCapabilityId) ?? null;
  const aiBackendBlocked = aiStatus ? AI_BLOCKED_STATES.has(aiStatus.state) : false;
  const aiBlocked =
    aiBackendBlocked ||
    (aiCapability ? !aiCapability.ready && !aiCapability.unverified : false);
  const aiActive = aiJob?.status === "queued" || aiJob?.status === "running";
  const aiProgress =
    aiActive && aiJob?.progress !== null && aiJob?.progressMax
      ? Math.min(100, (aiJob.progress / aiJob.progressMax) * 100)
      : null;
  const directionCapability =
    aiStatus?.capabilities.find((entry) => entry.id === "directional_set") ?? null;
  const directionBlocked =
    aiBackendBlocked ||
    (directionCapability ? !directionCapability.ready && !directionCapability.unverified : false);
  const directionActive =
    directionJob?.status === "queued" || directionJob?.status === "running";
  const directionProgress =
    directionActive && directionJob?.progress !== null && directionJob?.progressMax
      ? Math.min(100, (directionJob.progress / directionJob.progressMax) * 100)
      : null;

  return (
    <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
      <Card className="p-3 space-y-2 self-start">
        <div className="flex items-center justify-between px-1 pb-1">
          <span className="label-mono text-fg-muted">Characters</span>
          <Button size="sm" variant="utility" onClick={startNew}>
            <Plus className="w-3.5 h-3.5" /> New
          </Button>
        </div>
        {characters.length === 0 && (
          <p className="px-1 py-6 text-[11px] text-fg-faint text-center leading-relaxed">
            No characters yet. Create one, then render all four facings from a single identity.
          </p>
        )}
        <div className="space-y-1">
          {characters.map((character) => {
            const active = character.id === selectedId;
            return (
              <button
                key={character.id}
                type="button"
                onClick={() => setSelectedId(character.id)}
                className={`w-full flex items-center gap-2.5 p-1.5 rounded-lg border text-left transition-colors ${
                  active
                    ? "border-accent bg-accent-soft"
                    : "border-transparent hover:border-border hover:bg-surface-subtle"
                }`}
              >
                <PixelImage
                  src={characterPreview(character.id)}
                  alt={character.name}
                  className="w-10 h-10 rounded-md border border-border shrink-0"
                />
                <span className="min-w-0">
                  <span className="block text-[12px] font-semibold text-fg truncate">
                    {character.name}
                  </span>
                  <span className="block font-mono text-[10px] text-fg-faint">
                    seed {character.seed} · {character.paletteId}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      <div className="space-y-5 min-w-0">
        <Card className="p-4 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-h2 text-fg">
                {selected ? selected.name : "New character identity"}
              </h2>
              <p className="mt-1 text-[12px] text-fg-muted leading-relaxed">
                An identity stores the palette, seed and reference used for every facing, variation
                and animation of this character.
              </p>
            </div>
            {selected && (
              <Badge tone="sand">
                {selected.updatedAt !== selected.createdAt ? "Updated" : "Saved"}
              </Badge>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <PixelField label="Name">
              <Input
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="e.g. Sela, courier of the low quarter"
                maxLength={120}
              />
            </PixelField>
            <PixelField label="Palette">
              <Select
                value={form.paletteId}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, paletteId: event.target.value }))
                }
              >
                {PIXEL_PALETTES.map((palette) => (
                  <option key={palette.id} value={palette.id}>
                    {palette.name}
                  </option>
                ))}
              </Select>
            </PixelField>
            <PixelField label="Seed" hint="Same palette, seed and size reproduce the same set.">
              <Input
                type="number"
                min={0}
                max={4294967295}
                value={form.seed}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, seed: Number(event.target.value) || 0 }))
                }
              />
            </PixelField>
            <PixelField label="Reference asset" hint="An existing asset in this project that fixes the look.">
              <Select
                value={form.referenceAssetId}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, referenceAssetId: event.target.value }))
                }
              >
                <option value="">None</option>
                {assets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.name}
                  </option>
                ))}
              </Select>
            </PixelField>
          </div>

          <PixelField label="Description">
            <Textarea
              rows={3}
              value={form.description}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, description: event.target.value }))
              }
              placeholder="Identity notes: silhouette, garment, colours, accessories."
              maxLength={2000}
            />
          </PixelField>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="accent" loading={busy} onClick={() => void save()}>
              <UserRound className="w-3.5 h-3.5" />
              {form.id ? "Save changes" : "Create character"}
            </Button>
            <Select
              className="w-28"
              value={String(viewSize)}
              onChange={(event) => setViewSize(Number(event.target.value))}
            >
              {[32, 48, 64].map((size) => (
                <option key={size} value={size}>
                  {size} px views
                </option>
              ))}
            </Select>
            <Button variant="secondary" loading={busy} onClick={() => void generateViews()}>
              <Wand2 className="w-3.5 h-3.5" />
              Render 4 facings
            </Button>
            {selected && (
              <Button
                variant="secondary"
                onClick={() =>
                  setPackageTarget({
                    scope: "character",
                    projectId: selected.projectId,
                    characterId: selected.id,
                    label: selected.name,
                  })
                }
              >
                <Boxes className="w-3.5 h-3.5" /> Export package
              </Button>
            )}
            {selected && (
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </Button>
            )}
          </div>
        </Card>

        <Card className="p-4 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-h2 text-fg flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-accent" /> SpriteKiln identity
              </h2>
              <p className="mt-1 text-[12px] text-fg-muted leading-relaxed">
                Generate the identity itself, then variations that keep the saved reference. Every
                output is a normal versioned asset linked to this character.
              </p>
            </div>
            {aiStatus && (
              <Badge
                tone={
                  aiStatus.state === "ready"
                    ? "success"
                    : aiStatus.state === "unverified"
                      ? "warning"
                      : "danger"
                }
              >
                {aiStatus.state === "ready"
                  ? "Ready"
                  : aiStatus.state === "unverified"
                    ? "Unverified"
                    : "Needs setup"}
              </Badge>
            )}
          </div>

          {!aiStatus && !aiStatusError && (
            <p className="text-[11px] text-fg-faint">Checking the isolated pixel backend…</p>
          )}
          {aiStatusError && <p className="text-[11px] text-danger">{aiStatusError}</p>}
          {aiStatus && aiBackendBlocked && (
            <p className="text-[11px] text-warning leading-relaxed">{aiStatus.message}</p>
          )}
          {aiCapability && !aiCapability.ready && (
            <p className="text-[11px] text-warning leading-relaxed">
              {aiCapability.label} is{" "}
              {aiCapability.unverified ? "unverified" : "missing required nodes, models or files"}{" "}
              on the dedicated backend.
            </p>
          )}

          <PixelField
            label="Identity prompt"
            hint="Stored with the character and reused for every variation."
          >
            <Textarea
              rows={2}
              value={aiPrompt}
              onChange={(event) => setAiPrompt(event.target.value)}
              placeholder="e.g. a courier in a patched blue coat, short dark hair, scar over the left brow"
              maxLength={10000}
            />
          </PixelField>

          <PixelField
            label="Variation"
            hint="Clothing, equipment or pose change, applied on top of the identity prompt. Colours are quantised to the identity palette."
          >
            <Input
              value={variation}
              onChange={(event) => setVariation(event.target.value)}
              placeholder="e.g. wearing a steel cuirass and carrying a lantern"
              maxLength={500}
            />
          </PixelField>

          <div className="grid grid-cols-2 gap-3">
            <PixelField label="Style preset">
              <Select value={aiStyle} onChange={(event) => setAiStyle(event.target.value)}>
                {SPRITEKILN_STYLES.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </Select>
            </PixelField>
            <PixelField label="Seed" hint="Saved with the identity.">
              <div className="flex gap-1.5">
                <Input
                  type="number"
                  min={0}
                  max={4294967295}
                  value={form.seed}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, seed: Number(event.target.value) || 0 }))
                  }
                />
                <Button
                  variant="utility"
                  aria-label="Randomize identity seed"
                  onClick={() =>
                    setForm((prev) => ({
                      ...prev,
                      seed: Math.floor(Math.random() * 4_294_967_295),
                    }))
                  }
                >
                  <Dice5 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </PixelField>
          </div>

          {form.referenceAssetId && (
            <>
              <SliderField
                label="Reference strength"
                value={aiStrength}
                min={0}
                max={2}
                step={0.05}
                onChange={setAiStrength}
              />
              <p className="text-[10px] text-fg-faint leading-relaxed">
                Higher values hold the identity silhouette and colours; lower values let the
                variation prompt change them more.
              </p>
              {referenceAsset && (
                <div className="flex items-center gap-2 border border-border rounded-lg p-2">
                  <PixelImage
                    src={referenceAsset.previewDataUrl}
                    alt={referenceAsset.name}
                    className="w-10 h-10 rounded-md border border-border shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-fg truncate">
                      {referenceAsset.name}
                    </p>
                    <p className="font-mono text-[10px] text-fg-faint">
                      identity reference · {referenceAsset.width}×{referenceAsset.height}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="utility"
                    className="ml-auto"
                    onClick={() => setForm((prev) => ({ ...prev, referenceAssetId: "" }))}
                  >
                    Clear
                  </Button>
                </div>
              )}
            </>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              variant="accent"
              loading={aiSubmitting}
              disabled={aiActive || aiBlocked || !aiStatus}
              onClick={() => void startAi("identity")}
            >
              <Sparkles className="w-3.5 h-3.5" />
              {aiJob ? "Generate again" : "Generate identity"}
            </Button>
            <Button
              variant="secondary"
              loading={aiSubmitting}
              disabled={aiActive || aiBlocked || !aiStatus || !form.referenceAssetId}
              onClick={() => void startAi("variation")}
            >
              <Wand2 className="w-3.5 h-3.5" />
              Generate variation
            </Button>
          </div>

          {aiJob && (
            <div className="border border-border rounded-lg p-2.5 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-fg truncate">{aiJob.name}</span>
                <Badge
                  tone={
                    aiJob.status === "completed"
                      ? "success"
                      : aiJob.status === "failed"
                        ? "danger"
                        : aiJob.status === "cancelled"
                          ? "neutral"
                          : "info"
                  }
                >
                  {aiJob.status}
                </Badge>
              </div>
              <p className="font-mono text-[10px] text-fg-faint">
                {aiJob.stage}
                {aiJob.promptId ? ` · ${aiJob.promptId.slice(0, 8)}` : ""} ·{" "}
                {formatPixelDate(aiJob.updatedAt)}
              </p>
              {aiActive && (
                <ProgressBar value={aiProgress ?? 0} label="Identity generation progress" />
              )}
              {aiJob.error && <p className="text-[11px] text-danger leading-relaxed">{aiJob.error}</p>}
            </div>
          )}

          <p className="text-[10px] text-fg-faint leading-relaxed">
            Reference-guided generation runs on the isolated SpriteKiln backend. The reference is
            never overwritten; new outputs stay linked to the character and their parent asset.
          </p>
        </Card>

        <Card className="p-4 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-h2 text-fg flex items-center gap-2">
                <Compass className="w-4 h-4 text-accent" /> Directional set
              </h2>
              <p className="mt-1 text-[12px] text-fg-muted leading-relaxed">
                Rotates the identity reference into a directional sprite set. Every facing is
                imported as its own asset linked to this character and to the reference it came from.
              </p>
            </div>
            {directionCapability && (
              <Badge
                tone={
                  directionCapability.ready
                    ? "success"
                    : directionCapability.unverified
                      ? "warning"
                      : "danger"
                }
              >
                {directionCapability.ready
                  ? "Ready"
                  : directionCapability.unverified
                    ? "Unverified"
                    : "Needs setup"}
              </Badge>
            )}
          </div>

          {directionBlocked && (
            <p className="text-[11px] text-warning leading-relaxed">
              {directionCapability && !directionCapability.ready
                ? `${directionCapability.label} is ${
                    directionCapability.unverified
                      ? "unverified"
                      : "missing required nodes, models or files"
                  } on the dedicated backend.`
                : aiStatus?.message}
            </p>
          )}
          {!form.referenceAssetId && (
            <p className="text-[11px] text-fg-faint leading-relaxed">
              Set an identity reference first. The workflow needs one front-facing sprite.
            </p>
          )}

          <div className="flex flex-wrap items-end gap-3">
            <PixelField label="Directions">
              <Select
                value={String(directionCount)}
                onChange={(event) => setDirectionCount(Number(event.target.value) === 8 ? 8 : 4)}
              >
                <option value="4">4 · front, right, back, left</option>
                <option value="8">8 · clockwise from front</option>
              </Select>
            </PixelField>
            <Button
              variant="accent"
              loading={directionSubmitting}
              disabled={
                directionActive || directionBlocked || !aiStatus || !form.referenceAssetId
              }
              onClick={() => void startDirections()}
            >
              <Compass className="w-3.5 h-3.5" />
              Generate {directionCount} directions
            </Button>
          </div>

          {directionJob && (
            <div className="border border-border rounded-lg p-2.5 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-fg truncate">
                  {directionJob.name}
                </span>
                <Badge
                  tone={
                    directionJob.status === "completed"
                      ? "success"
                      : directionJob.status === "failed"
                        ? "danger"
                        : directionJob.status === "cancelled"
                          ? "neutral"
                          : "info"
                  }
                >
                  {directionJob.status}
                </Badge>
              </div>
              <p className="font-mono text-[10px] text-fg-faint">
                {directionJob.stage}
                {directionJob.promptId ? ` · ${directionJob.promptId.slice(0, 8)}` : ""}
              </p>
              {directionActive && (
                <ProgressBar
                  value={directionProgress ?? 0}
                  label="Direction generation progress"
                />
              )}
              {directionJob.error && (
                <p className="text-[11px] text-danger leading-relaxed">{directionJob.error}</p>
              )}
            </div>
          )}

          {directionAssets.length > 0 && (
            <div>
              <p className="label-mono text-fg-muted mb-2">Last generated set</p>
              <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
                {directionAssets.map((asset) => {
                  const label = asset.name.split(" · ").pop() ?? asset.name;
                  return (
                    <div
                      key={asset.id}
                      className="border border-border rounded-lg overflow-hidden bg-surface-subtle/30 text-center"
                    >
                      <PixelImage
                        src={asset.previewDataUrl}
                        alt={`${asset.name} ${label}`}
                        className="aspect-square w-full"
                      />
                      <p className="font-mono text-[10px] text-fg-muted py-1">{label}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <p className="text-[10px] text-fg-faint leading-relaxed">
            Eight directions run five generation passes (front, the three-quarter and side views,
            and back); the west-facing sprites are mirrored from the east renders. The source must
            face the viewer.
          </p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <span className="label-mono text-fg-muted">Rendered views & variations</span>
              <p className="text-[11px] text-fg-faint mt-1">
                Front, back, right and mirrored left facings share one seed and palette set.
              </p>
            </div>
            <Badge tone="neutral">{characterAssets.length} assets</Badge>
          </div>
          {characterAssets.length === 0 ? (
            <EmptyState
              icon={<UserRound />}
              title="No views rendered"
              description="Save the identity, then render the four facings. Each facing is a full animation set with idle, walk and attack frames."
            />
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {characterAssets.slice(0, 12).map((asset) => (
                <div
                  key={asset.id}
                  className="border border-border rounded-lg overflow-hidden bg-surface-subtle/30"
                >
                  <PixelImage
                    src={asset.previewDataUrl}
                    alt={asset.name}
                    className="aspect-square w-full"
                  />
                  <div className="p-2">
                    <p className="text-[11px] font-semibold text-fg truncate">{asset.name}</p>
                    <p className="font-mono text-[10px] text-fg-faint">
                      v{asset.version} · {asset.frameCount}f
                      {asset.id === form.referenceAssetId ? " · reference" : ""}
                    </p>
                    <div className="flex flex-wrap gap-1 pt-1.5">
                      <Button size="sm" variant="utility" onClick={() => onInspect(asset.id, "animation")}>
                        Animate
                      </Button>
                      <Button size="sm" variant="utility" onClick={() => onInspect(asset.id, "editor")}>
                        Edit
                      </Button>
                      {asset.id !== form.referenceAssetId && (
                        <Button size="sm" variant="utility" onClick={() => void useAsReference(asset.id)}>
                          Use as reference
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void remove()}
        title="Delete character"
        description="The identity is removed. Assets already rendered stay in the library and can be reused."
        confirmLabel="Delete character"
      />

      <PackageExportDialog
        open={!!packageTarget}
        onClose={() => setPackageTarget(null)}
        target={packageTarget}
        onToast={onToast}
      />
    </div>
  );
};
