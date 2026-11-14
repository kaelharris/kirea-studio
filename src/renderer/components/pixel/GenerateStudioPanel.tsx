import React, { useMemo, useState } from "react";
import { Dice5, RefreshCw, Sparkles, Wand2 } from "lucide-react";
import type {
  PixelAssetDetail,
  PixelCharacter,
  PixelDirection,
  PixelKind,
} from "../../../shared/pixel-types";
import {
  PIXEL_KIND_LABELS,
  PIXEL_PALETTES,
  PIXEL_SIZE_PRESETS,
} from "../../../shared/pixel-types";
import {
  Badge,
  Button,
  Card,
  Input,
  Select,
  Textarea,
} from "../ui/Primitives";
import {
  PixelField,
  PixelImage,
  PIXEL_KIND_ICONS,
  formatPixelDate,
  hashPromptToSeed,
} from "./pixel-ui";

export type GenerateMode = "all" | "environment" | "objects";

interface GenerateStudioProps {
  mode: GenerateMode;
  projectId: string;
  characters: PixelCharacter[];
  onGenerated: (details: PixelAssetDetail[]) => void;
  onInspect: (assetId: string, target: "animation" | "editor") => void;
  onToast: (message: string, tone?: "info" | "error") => void;
}

const MODE_KINDS: Record<GenerateMode, PixelKind[]> = {
  all: [
    "character",
    "creature",
    "weapon",
    "item",
    "object",
    "tileset",
    "environment",
    "effect",
  ],
  environment: ["environment", "tileset"],
  objects: ["object", "weapon", "item", "effect"],
};

const MODE_COPY: Record<
  GenerateMode,
  { title: string; subtitle: string; defaultKind: PixelKind }
> = {
  all: {
    title: "Generate",
    subtitle:
      "Render playable pixel assets locally with Pixelbolt. Every frame is real pixel data, persisted at native resolution.",
    defaultKind: "character",
  },
  environment: {
    title: "Environment Studio",
    subtitle:
      "Build seamless tilesets and vista backgrounds. Sizes snap to a 16 px tile grid; tiles are repeatable at the edges.",
    defaultKind: "tileset",
  },
  objects: {
    title: "Objects & Effects",
    subtitle:
      "Props, weapons, pickups and multi-frame effect bursts, drawn on the shared palette so they sit together in one world.",
    defaultKind: "object",
  },
};

const DEFAULT_SIZE: Partial<Record<PixelKind, { w: number; h: number }>> = {
  tileset: { w: 48, h: 48 },
  environment: { w: 64, h: 48 },
  effect: { w: 32, h: 32 },
};

const DIRECTION_LABELS: Record<PixelDirection, string> = {
  front: "Front",
  back: "Back",
  side: "Side",
};

export const GenerateStudioPanel: React.FC<GenerateStudioProps> = ({
  mode,
  projectId,
  characters,
  onGenerated,
  onInspect,
  onToast,
}) => {
  const copy = MODE_COPY[mode];
  const kinds = MODE_KINDS[mode];
  const [kind, setKind] = useState<PixelKind>(copy.defaultKind);
  const [name, setName] = useState("");
  const [size, setSize] = useState<{ w: number; h: number }>(
    DEFAULT_SIZE[copy.defaultKind] ?? { w: 32, h: 32 }
  );
  const [paletteId, setPaletteId] = useState("kirea");
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 100000));
  const [seedMode, setSeedMode] = useState<"random" | "fixed" | "prompt">("random");
  const [direction, setDirection] = useState<PixelDirection>("front");
  const [variations, setVariations] = useState(1);
  const [prompt, setPrompt] = useState("");
  const [characterId, setCharacterId] = useState("");
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<PixelAssetDetail[]>([]);

  const effectiveName = useMemo(
    () => name.trim() || `${PIXEL_KIND_LABELS[kind]} ${seed}`,
    [name, kind, seed]
  );

  const pickKind = (next: PixelKind): void => {
    setKind(next);
    const preset = DEFAULT_SIZE[next];
    if (preset) setSize(preset);
    if (next !== "character") setDirection("front");
  };

  const randomizeSeed = (): void => {
    const next = Math.floor(Math.random() * 100000);
    setSeed(next);
    setSeedMode("random");
  };

  const resolveSeed = (index: number): number => {
    if (seedMode === "prompt" && prompt.trim()) {
      return hashPromptToSeed(prompt.trim()) + index;
    }
    return seed + index;
  };

  const generate = async (): Promise<void> => {
    if (!projectId || busy) return;
    const count = Math.max(1, Math.min(4, variations));
    setBusy(true);
    try {
      const results: PixelAssetDetail[] = [];
      for (let index = 0; index < count; index++) {
        const detail = await window.kirea.generatePixelAsset({
          projectId,
          characterId: kind === "character" && characterId ? characterId : null,
          kind,
          name: count > 1 ? `${effectiveName} v${index + 1}` : effectiveName,
          width: size.w,
          height: size.h,
          paletteId,
          seed: resolveSeed(index),
          direction: kind === "character" ? direction : undefined,
          prompt: prompt.trim() || undefined,
        });
        results.push(detail);
      }
      setRecent(results);
      onGenerated(results);
      onToast(
        `Rendered ${results.length} ${results.length === 1 ? "asset" : "assets"} with Pixelbolt.`,
        "info"
      );
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Pixel generation failed.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <Card className="p-4 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-h2 text-fg">{copy.title}</h2>
              <p className="mt-1 text-[12px] text-fg-muted leading-relaxed">{copy.subtitle}</p>
            </div>
            <Badge tone="accent">Pixelbolt</Badge>
          </div>

          <PixelField label="Asset kind">
            <div className="grid grid-cols-2 gap-1.5">
              {kinds.map((entry) => {
                const Icon = PIXEL_KIND_ICONS[entry];
                const active = kind === entry;
                return (
                  <button
                    key={entry}
                    type="button"
                    onClick={() => pickKind(entry)}
                    aria-pressed={active}
                    className={`flex items-center gap-2 h-8 px-2 rounded-md border text-[11px] font-medium transition-colors ${
                      active
                        ? "border-accent bg-accent-soft text-fg"
                        : "border-border bg-bg text-fg-muted hover:border-border-strong hover:text-fg"
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {PIXEL_KIND_LABELS[entry]}
                  </button>
                );
              })}
            </div>
          </PixelField>

          <PixelField label="Name">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={effectiveName}
              maxLength={120}
            />
          </PixelField>

          <PixelField label="Canvas size">
            <div className="flex flex-wrap gap-1.5">
              {PIXEL_SIZE_PRESETS.map((preset) => {
                const active = size.w === preset && size.h === preset;
                return (
                  <Button
                    key={preset}
                    variant="utility"
                    size="md"
                    onClick={() => setSize({ w: preset, h: preset })}
                    className={active ? "border-accent text-fg" : ""}
                  >
                    {preset}
                  </Button>
                );
              })}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="flex items-center gap-2">
                <span className="text-[11px] text-fg-muted w-6">W</span>
                <Input
                  type="number"
                  min={8}
                  max={256}
                  value={size.w}
                  onChange={(event) =>
                    setSize((prev) => ({ ...prev, w: Number(event.target.value) || 8 }))
                  }
                />
              </label>
              <label className="flex items-center gap-2">
                <span className="text-[11px] text-fg-muted w-6">H</span>
                <Input
                  type="number"
                  min={8}
                  max={256}
                  value={size.h}
                  onChange={(event) =>
                    setSize((prev) => ({ ...prev, h: Number(event.target.value) || 8 }))
                  }
                />
              </label>
            </div>
          </PixelField>

          <div className="grid grid-cols-2 gap-3">
            <PixelField label="Palette">
              <Select value={paletteId} onChange={(event) => setPaletteId(event.target.value)}>
                {PIXEL_PALETTES.map((palette) => (
                  <option key={palette.id} value={palette.id}>
                    {palette.name}
                  </option>
                ))}
              </Select>
            </PixelField>
            <PixelField label="Seed">
              <div className="flex gap-1.5">
                <Input
                  type="number"
                  min={0}
                  max={4294967295}
                  value={seed}
                  onChange={(event) => {
                    setSeed(Number(event.target.value) || 0);
                    setSeedMode("fixed");
                  }}
                />
                <Button variant="utility" onClick={randomizeSeed} aria-label="Randomize seed">
                  <Dice5 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </PixelField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <PixelField
              label="Seed mode"
              hint={
                seedMode === "prompt"
                  ? "The prompt is hashed into the seed, so wording changes the layout."
                  : undefined
              }
            >
              <Select
                value={seedMode}
                onChange={(event) => setSeedMode(event.target.value as typeof seedMode)}
              >
                <option value="random">Random each run</option>
                <option value="fixed">Fixed seed</option>
                <option value="prompt">Derive from prompt</option>
              </Select>
            </PixelField>
            <PixelField label="Variations" hint="Renders 1–4 assets with sequential seeds.">
              <Select
                value={String(variations)}
                onChange={(event) => setVariations(Number(event.target.value))}
              >
                {[1, 2, 3, 4].map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </Select>
            </PixelField>
          </div>

          {kind === "character" && (
            <div className="grid grid-cols-2 gap-3">
              <PixelField label="Facing">
                <Select
                  value={direction}
                  onChange={(event) => setDirection(event.target.value as PixelDirection)}
                >
                  {(Object.keys(DIRECTION_LABELS) as PixelDirection[]).map((entry) => (
                    <option key={entry} value={entry}>
                      {DIRECTION_LABELS[entry]}
                    </option>
                  ))}
                </Select>
              </PixelField>
              <PixelField label="Character (optional)" hint="Links this sprite to a saved identity.">
                <Select
                  value={characterId}
                  onChange={(event) => setCharacterId(event.target.value)}
                >
                  <option value="">Unlinked</option>
                  {characters.map((character) => (
                    <option key={character.id} value={character.id}>
                      {character.name}
                    </option>
                  ))}
                </Select>
              </PixelField>
            </div>
          )}

          <PixelField
            label="Prompt"
            hint="Stored with the asset and shown in the library. Use “Derive from prompt” to influence seeds; Pixelbolt itself renders from deterministic recipes."
          >
            <Textarea
              rows={3}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="e.g. wanderer in a blue cloak, crescent charm, 4-frame walk cycle"
              maxLength={4000}
            />
          </PixelField>

          <PixelField label="Engine" hint="AI workflows (SpriteKiln / ComfyUI) are listed in Library once their nodes are installed; they are not required for local rendering.">
            <Select value="pixelbolt" disabled>
              <option value="pixelbolt">Pixelbolt 0.17 · local deterministic</option>
            </Select>
          </PixelField>

          <Button
            variant="accent"
            size="lg"
            className="w-full"
            loading={busy}
            disabled={!projectId}
            onClick={() => void generate()}
          >
            {!busy && <Wand2 className="w-4 h-4" />}
            {busy ? "Rendering frames…" : "Generate pixel asset"}
          </Button>
          {kind === "character" && (
            <p className="text-[11px] text-fg-faint leading-relaxed">
              A character asset includes idle, walk and attack frames. Use Character Studio to
              render all four facings as one set.
            </p>
          )}
          {kind === "effect" && (
            <p className="text-[11px] text-fg-faint leading-relaxed">
              Effects render a 6-frame burst animation with per-frame durations.
            </p>
          )}
          {kind === "tileset" && (
            <p className="text-[11px] text-fg-faint leading-relaxed">
              Tilesets snap to 16 px tiles; the sheet is exported for Godot, Unity and Phaser.
            </p>
          )}
        </Card>

        <Card className="p-4 min-h-[320px]">
          <div className="flex items-center justify-between mb-3">
            <div>
              <span className="label-mono text-fg-muted">Latest render</span>
              <p className="text-[11px] text-fg-faint mt-1">
                Preview is the first frame at native pixels; open in Animation or Editor to work
                with every frame.
              </p>
            </div>
            {recent.length > 0 && (
              <Badge tone="success">{recent.length} rendered</Badge>
            )}
          </div>
          {recent.length === 0 ? (
            <div className="h-[260px] flex flex-col items-center justify-center text-center gap-2 border border-dashed border-border rounded-xl">
              <Sparkles className="w-6 h-6 text-fg-subtle" />
              <p className="text-small text-fg-muted max-w-xs">
                Nothing rendered yet in this session. Every asset is written to disk with frame PNGs,
                a sprite sheet and version history.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {recent.map((asset) => (
                <div
                  key={asset.id}
                  className="border border-border rounded-lg overflow-hidden bg-surface-subtle/40"
                >
                  <PixelImage
                    src={asset.frames[0]?.dataUrl || asset.previewDataUrl}
                    alt={asset.name}
                    node={asset.kind}
                    className="aspect-square w-full"
                  />
                  <div className="p-2 space-y-1">
                    <p className="text-[11px] font-semibold text-fg truncate">{asset.name}</p>
                    <p className="font-mono text-[10px] text-fg-faint">
                      {asset.width}×{asset.height} · {asset.frames.length}f · seed {asset.seed}
                    </p>
                    <p className="font-mono text-[10px] text-fg-faint">
                      {formatPixelDate(asset.createdAt)}
                    </p>
                    <div className="flex gap-1 pt-1">
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
          <div className="mt-4 flex items-center gap-2 text-[11px] text-fg-faint">
            <RefreshCw className={`w-3 h-3 ${busy ? "animate-spin" : ""}`} />
            {busy
              ? "Rendering with Pixelbolt, writing frame PNGs and a sheet…"
              : "Renders finish in well under a second at these sizes."}
          </div>
        </Card>
      </div>
    </div>
  );
};
