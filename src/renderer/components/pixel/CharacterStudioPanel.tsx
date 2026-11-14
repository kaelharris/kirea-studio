import React, { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, UserRound, Wand2 } from "lucide-react";
import type {
  PixelAssetDetail,
  PixelAssetRecord,
  PixelCharacter,
} from "../../../shared/pixel-types";
import { PIXEL_PALETTES } from "../../../shared/pixel-types";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Input,
  Select,
  Textarea,
} from "../ui/Primitives";
import { PixelField, PixelImage, formatPixelDate } from "./pixel-ui";

interface CharacterStudioProps {
  projectId: string;
  characters: PixelCharacter[];
  assets: PixelAssetRecord[];
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

export const CharacterStudioPanel: React.FC<CharacterStudioProps> = ({
  projectId,
  characters,
  assets,
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

  const save = async (): Promise<PixelCharacter | null> => {
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
      onToast(form.id ? "Character updated." : "Character created.", "info");
      return saved;
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Could not save the character.", "error");
      return null;
    } finally {
      setBusy(false);
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
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </Button>
            )}
          </div>
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
                    </p>
                    <div className="flex gap-1 pt-1.5">
                      <Button size="sm" variant="utility" onClick={() => onInspect(asset.id, "animation")}>
                        Animate
                      </Button>
                      <Button size="sm" variant="utility" onClick={() => onInspect(asset.id, "editor")}>
                        Edit
                      </Button>
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
    </div>
  );
};
