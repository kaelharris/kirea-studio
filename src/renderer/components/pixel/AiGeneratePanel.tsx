import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Dice5,
  ImagePlus,
  Link2,
  RefreshCw,
  ServerCog,
  Sparkles,
  SquareDashed,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import type {
  PixelAiBackendStatus,
  PixelAiCapabilityId,
  PixelAiGenerateInput,
  PixelAiImageInput,
  PixelAiJob,
  PixelAiMode,
} from "../../../shared/pixel-ai-types";
import { SPRITEKILN_STYLES } from "../../../shared/pixel-ai-types";
import type {
  PixelAssetDetail,
  PixelAssetRecord,
  PixelCharacter,
  PixelKind,
} from "../../../shared/pixel-types";
import { PIXEL_KIND_LABELS, PIXEL_PALETTES, PIXEL_SIZE_PRESETS } from "../../../shared/pixel-types";
import {
  Badge,
  Button,
  Card,
  Input,
  ProgressBar,
  Select,
  SliderField,
  Textarea,
} from "../ui/Primitives";
import { PixelField, PixelImage, PIXEL_KIND_ICONS, formatPixelDate } from "./pixel-ui";

interface AiGeneratePanelProps {
  projectId: string;
  characters: PixelCharacter[];
  assets: PixelAssetRecord[];
  onGenerated: (details: PixelAssetDetail[]) => void;
  onInspect: (assetId: string, target: "animation" | "editor") => void;
  onToast: (message: string, tone?: "info" | "error") => void;
}

const MODE_COPY: Record<PixelAiMode, { label: string; hint: string }> = {
  text: {
    label: "Text → pixel art",
    hint: "Describe a subject; SpriteKiln renders it, then quantises to the selected palette.",
  },
  image: {
    label: "Image → pixel art",
    hint: "Convert an existing image. Direct quantises the source; AI redraw re-renders it.",
  },
  reference: {
    label: "Reference-guided",
    hint: "A subject reference locks the silhouette and colours while the prompt restyles it.",
  },
  inpaint: {
    label: "Localized edit",
    hint: "Repaint one rectangular region of an existing sprite; the rest is preserved.",
  },
  directions: {
    label: "Directional set",
    hint: "Runs from Character Studio: rotate one front-facing sprite into 4 or 8 facings.",
  },
};

const HARD_BLOCKED_STATES = new Set(["setup_required", "workflows_missing", "unreachable"]);

const CAPABILITY_LABELS: Record<PixelAiCapabilityId, string> = {
  text_to_pixel: "Text to pixel art",
  image_to_pixel_direct: "Image pixel conversion",
  image_to_pixel_ai: "Image AI redraw",
  reference_to_pixel: "Reference-guided pixel art",
  inpaint_pixel: "Localized pixel edit",
  directional_set: "Directional sprite set",
};

function statusTone(state: PixelAiBackendStatus["state"] | undefined) {
  if (state === "ready") return "success" as const;
  if (state === "unverified") return "warning" as const;
  if (state === "setup_required" || state === "workflows_missing") return "warning" as const;
  return "danger" as const;
}

function statusLabel(state: PixelAiBackendStatus["state"] | undefined): string {
  switch (state) {
    case "ready":
      return "Ready";
    case "unverified":
      return "Unverified";
    case "setup_required":
      return "Setup required";
    case "workflows_missing":
      return "Workflows missing";
    default:
      return "Unreachable";
  }
}

export const AiGeneratePanel: React.FC<AiGeneratePanelProps> = ({
  projectId,
  characters,
  assets,
  onGenerated,
  onInspect,
  onToast,
}) => {
  const [status, setStatus] = useState<PixelAiBackendStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [backend, setBackend] = useState({ host: "", port: 8189, root: "" });
  const [backendSaving, setBackendSaving] = useState(false);

  const [mode, setMode] = useState<PixelAiMode>("text");
  const [kind, setKind] = useState<PixelKind>("character");
  const [characterId, setCharacterId] = useState("");
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [width, setWidth] = useState(32);
  const [height, setHeight] = useState(32);
  const [paletteId, setPaletteId] = useState("kirea");
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1_000_000));
  const [style, setStyle] = useState("game asset");
  const [transparent, setTransparent] = useState(true);
  const [steps, setSteps] = useState(8);
  const [longSide, setLongSide] = useState(1024);
  const [conversion, setConversion] = useState<"direct" | "ai">("direct");
  const [strength, setStrength] = useState(0.7);
  const [image, setImage] = useState<PixelAiImageInput | null>(null);
  const [subject, setSubject] = useState<PixelAiImageInput | null>(null);
  const [styleReference, setStyleReference] = useState<PixelAiImageInput | null>(null);
  const [inpaintBase, setInpaintBase] = useState<PixelAiImageInput | null>(null);
  const [region, setRegion] = useState({ x: 0, y: 0, width: 16, height: 16, grow: 1 });

  const [job, setJob] = useState<PixelAiJob | null>(null);
  const [jobAsset, setJobAsset] = useState<PixelAssetDetail | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const handledJobRef = useRef<string | null>(null);

  const effectiveName = useMemo(
    () => name.trim() || `AI ${PIXEL_KIND_LABELS[kind]} ${seed}`,
    [name, kind, seed]
  );

  const activeJob = job && (job.status === "queued" || job.status === "running") ? job : null;
  const backendBlocked = status ? HARD_BLOCKED_STATES.has(status.state) : false;

  const loadStatus = useCallback(async (): Promise<void> => {
    setStatusLoading(true);
    setStatusError(null);
    try {
      setStatus(await window.kirea.getPixelAiStatus());
    } catch (loadError) {
      setStatusError(
        loadError instanceof Error ? loadError.message : "Could not inspect the pixel backend."
      );
    } finally {
      setStatusLoading(false);
    }
  }, []);

  const applyJob = useCallback(
    (next: PixelAiJob): void => {
      setJob(next);
      if (next.status === "completed" && next.assetId && handledJobRef.current !== next.id) {
        handledJobRef.current = next.id;
        void window.kirea
          .getPixelAsset(next.assetId)
          .then((detail) => {
            setJobAsset(detail);
            onGenerated([detail]);
          })
          .catch(() => undefined);
      }
    },
    [onGenerated]
  );
  const applyJobRef = useRef(applyJob);
  applyJobRef.current = applyJob;

  useEffect(() => {
    void loadStatus();
    void window.kirea
      .getSettings()
      .then((settings) =>
        setBackend({
          host: settings.pixelBackendHost,
          port: settings.pixelBackendPort,
          root: settings.pixelBackendWorkflowRoot,
        })
      )
      .catch(() => undefined);
    void window.kirea
      .listPixelAiJobs()
      .then((jobs) => {
        const active = jobs.find((entry) => entry.status === "queued" || entry.status === "running");
        const latest = active ?? jobs[0];
        if (latest) applyJobRef.current(latest);
      })
      .catch(() => undefined);
  }, [loadStatus]);

  useEffect(() => {
    return window.kirea.onPixelAiJobUpdated((updated) => {
      applyJobRef.current(updated);
    });
  }, []);

  const saveBackend = async (): Promise<void> => {
    setBackendSaving(true);
    try {
      await window.kirea.updateSettings({
        pixelBackendHost: backend.host.trim() || "127.0.0.1",
        pixelBackendPort: Math.max(1024, Math.min(65535, Math.round(backend.port) || 8189)),
        pixelBackendWorkflowRoot: backend.root.trim(),
      });
      setTestMessage(null);
      await loadStatus();
      onToast("Pixel backend settings saved. The main Kirea ComfyUI is unchanged.", "info");
    } catch (saveError) {
      onToast(
        saveError instanceof Error ? saveError.message : "Could not save backend settings.",
        "error"
      );
    } finally {
      setBackendSaving(false);
    }
  };

  const testConnection = async (): Promise<void> => {
    try {
      const result = await window.kirea.testPixelAiConnection();
      setTestMessage(result.message);
      onToast(result.message, result.ok ? "info" : "error");
    } catch (testError) {
      const message =
        testError instanceof Error ? testError.message : "Could not test the pixel backend.";
      setTestMessage(message);
      onToast(message, "error");
    }
  };

  const readImageFile = (file: File): Promise<PixelAiImageInput> =>
    new Promise((resolve, reject) => {
      if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
        reject(new Error("Use a PNG, JPEG or WebP image."));
        return;
      }
      if (file.size > 20 * 1024 * 1024) {
        reject(new Error("Images must be 20 MB or smaller."));
        return;
      }
      const reader = new FileReader();
      reader.onload = () =>
        resolve({
          kind: "dataUrl",
          dataUrl: String(reader.result),
          fileName: file.name,
        });
      reader.onerror = () => reject(new Error("Could not read that image."));
      reader.readAsDataURL(file);
    });

  const handleDropImage = async (
    file: File | undefined,
    setter: (value: PixelAiImageInput | null) => void
  ): Promise<void> => {
    if (!file) return;
    try {
      setter(await readImageFile(file));
    } catch (readError) {
      onToast(readError instanceof Error ? readError.message : "Could not read that image.", "error");
    }
  };

  const buildInput = (): PixelAiGenerateInput => {
    const input: PixelAiGenerateInput = {
      projectId,
      characterId: kind === "character" && characterId ? characterId : null,
      kind,
      name: effectiveName.slice(0, 120),
      mode,
      prompt: prompt.trim(),
      negativePrompt: negativePrompt.trim() || undefined,
      width,
      height,
      paletteId,
      seed,
      transparent,
    };
    if (mode === "text" || mode === "reference") {
      input.style = style;
      input.longSide = longSide;
    }
    if (mode === "text" || (mode === "image" && conversion === "ai")) {
      input.steps = steps;
    }
    if (mode === "image") {
      input.conversion = conversion;
      input.image = image ?? undefined;
      if (conversion === "ai") input.strength = strength;
    }
    if (mode === "reference") {
      input.reference = {
        subject: subject ?? undefined!,
        style: styleReference ?? undefined,
      };
      input.strength = strength;
    }
    if (mode === "inpaint") {
      input.longSide = longSide;
      input.inpaint = { base: inpaintBase ?? undefined!, region };
    }
    return input;
  };

  const generate = async (): Promise<void> => {
    if (!projectId || submitting || activeJob) return;
    if (mode !== "image" && !prompt.trim()) {
      onToast("Describe what you want the AI to generate.", "error");
      return;
    }
    if (mode === "image" && !image) {
      onToast("Choose the image to convert.", "error");
      return;
    }
    if (mode === "reference" && !subject) {
      onToast("Choose a subject reference image.", "error");
      return;
    }
    if (mode === "inpaint" && !inpaintBase) {
      onToast("Choose the sprite to edit.", "error");
      return;
    }
    if (mode === "inpaint" && (!(region.width > 0) || !(region.height > 0))) {
      onToast("The edit region must be larger than zero.", "error");
      return;
    }
    setSubmitting(true);
    try {
      const started = await window.kirea.generatePixelAi(buildInput());
      handledJobRef.current = null;
      setJobAsset(null);
      applyJob(started);
    } catch (startError) {
      onToast(
        startError instanceof Error ? startError.message : "Could not start AI generation.",
        "error"
      );
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async (): Promise<void> => {
    if (!activeJob) return;
    try {
      await window.kirea.cancelPixelAiJob(activeJob.id);
    } catch (cancelError) {
      onToast(
        cancelError instanceof Error ? cancelError.message : "Could not cancel the job.",
        "error"
      );
    }
  };

  const randomizeSeed = (): void => {
    setSeed(Math.floor(Math.random() * 4_294_967_295));
  };

  const progressPercent =
    activeJob && activeJob.progress !== null && activeJob.progressMax
      ? Math.min(100, (activeJob.progress / activeJob.progressMax) * 100)
      : null;

  const requiresCapability: PixelAiCapabilityId =
    mode === "text"
      ? "text_to_pixel"
      : mode === "reference"
        ? "reference_to_pixel"
        : mode === "inpaint"
          ? "inpaint_pixel"
          : conversion === "direct"
            ? "image_to_pixel_direct"
            : "image_to_pixel_ai";
  const capability = status?.capabilities.find((entry) => entry.id === requiresCapability) ?? null;
  const capabilityBlocked = backendBlocked
    ? true
    : capability
      ? !capability.ready && !capability.unverified
      : false;

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,440px)_minmax(0,1fr)]">
        <Card className="p-4 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-h2 text-fg">AI pixel generation</h2>
              <p className="mt-1 text-[12px] text-fg-muted leading-relaxed">
                Real semantic generation through a dedicated SpriteKiln backend. Kirea never
                installs nodes or models into your existing ComfyUI.
              </p>
            </div>
            <Badge tone="creative">
              <Sparkles className="w-3 h-3" /> SpriteKiln
            </Badge>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            {(Object.keys(MODE_COPY) as PixelAiMode[])
              .filter((entry) => entry !== "directions")
              .map((entry) => {
              const active = mode === entry;
              return (
                <button
                  key={entry}
                  type="button"
                  onClick={() => setMode(entry)}
                  aria-pressed={active}
                  className={`h-8 px-2 rounded-md border text-[11px] font-medium transition-colors ${
                    active
                      ? "border-accent bg-accent-soft text-fg"
                      : "border-border bg-bg text-fg-muted hover:border-border-strong hover:text-fg"
                  }`}
                >
                  {MODE_COPY[entry].label}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-fg-faint leading-relaxed">{MODE_COPY[mode].hint}</p>

          <PixelField label="Asset kind">
            <div className="grid grid-cols-2 gap-1.5">
              {(Object.keys(PIXEL_KIND_LABELS) as PixelKind[]).map((entry) => {
                const Icon = PIXEL_KIND_ICONS[entry];
                const active = kind === entry;
                return (
                  <button
                    key={entry}
                    type="button"
                    onClick={() => setKind(entry)}
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

          {kind === "character" && characters.length > 0 && (
            <PixelField label="Character (optional)" hint="Links the generated sprite to a saved identity.">
              <Select value={characterId} onChange={(event) => setCharacterId(event.target.value)}>
                <option value="">Unlinked</option>
                {characters.map((character) => (
                  <option key={character.id} value={character.id}>
                    {character.name}
                  </option>
                ))}
              </Select>
            </PixelField>
          )}

          <PixelField label="Name">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={effectiveName}
              maxLength={120}
            />
          </PixelField>

          {mode === "image" && (
            <>
              <ImageSourceField
                label="Source image"
                hint="PNG, JPEG or WebP up to 20 MB. The source is uploaded to the dedicated backend only."
                value={image}
                onChange={setImage}
                assets={assets}
                onFile={(file) => void handleDropImage(file, setImage)}
              />
              <div className="grid grid-cols-2 gap-3">
                <PixelField label="Conversion">
                  <Select
                    value={conversion}
                    onChange={(event) => setConversion(event.target.value as "direct" | "ai")}
                  >
                    <option value="direct">Direct quantise</option>
                    <option value="ai">AI redraw</option>
                  </Select>
                </PixelField>
                {conversion === "ai" && (
                  <PixelField label="Redraw strength" hint="Higher follows the prompt more; lower stays closer to the source.">
                    <SliderField
                      label="Strength"
                      value={strength}
                      min={0.05}
                      max={1}
                      step={0.05}
                      onChange={setStrength}
                    />
                  </PixelField>
                )}
              </div>
            </>
          )}

          {mode === "reference" && (
            <>
              <ImageSourceField
                label="Subject reference"
                hint="Locks the silhouette and identity. The generation never overwrites this reference."
                value={subject}
                onChange={setSubject}
                assets={assets}
                onFile={(file) => void handleDropImage(file, setSubject)}
              />
              <ImageSourceField
                label="Style reference (optional)"
                hint="Without one, the subject reference is reused as the style reference."
                value={styleReference}
                onChange={setStyleReference}
                assets={assets}
                onFile={(file) => void handleDropImage(file, setStyleReference)}
              />
            </>
          )}

          {mode === "inpaint" && (
            <>
              <ImageSourceField
                label="Sprite to edit"
                hint="The base frame. Pixels outside the region are copied from this image."
                value={inpaintBase}
                onChange={setInpaintBase}
                assets={assets}
                onFile={(file) => void handleDropImage(file, setInpaintBase)}
              />
              <div className="space-y-2 border border-border rounded-lg p-2.5">
                <span className="label-mono text-fg-muted flex items-center gap-1.5">
                  <SquareDashed className="w-3 h-3" /> Edit region (pixels)
                </span>
                <div className="grid grid-cols-4 gap-2">
                  {(["x", "y", "width", "height"] as const).map((key) => (
                    <label key={key} className="space-y-1">
                      <span className="text-[10px] font-mono uppercase text-fg-faint">{key}</span>
                      <Input
                        type="number"
                        min={key === "width" || key === "height" ? 1 : 0}
                        max={256}
                        value={region[key]}
                        onChange={(event) =>
                          setRegion((prev) => ({
                            ...prev,
                            [key]: Math.max(0, Math.min(256, Number(event.target.value) || 0)),
                          }))
                        }
                      />
                    </label>
                  ))}
                </div>
                <SliderField
                  label="Grow"
                  value={region.grow}
                  min={0}
                  max={8}
                  step={1}
                  suffix=" px"
                  onChange={(value) => setRegion((prev) => ({ ...prev, grow: value }))}
                />
              </div>
            </>
          )}

          <PixelField
            label={mode === "text" || mode === "reference" ? "Prompt" : "Prompt (optional / edit instruction)"}
            hint={
              mode === "image" && conversion === "direct"
                ? "Direct conversion does not use the prompt."
                : "Sent to the backend as the semantic prompt and stored with the asset."
            }
          >
            <Textarea
              rows={3}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="e.g. a weathered knight holding a lantern, three-quarter view"
              maxLength={10000}
            />
          </PixelField>

          <PixelField
            label="Negative prompt"
            hint="Stored with the asset. Upstream distilled workflows run at cfg 1.0, so negatives are not applied."
          >
            <Input
              value={negativePrompt}
              onChange={(event) => setNegativePrompt(event.target.value)}
              placeholder="e.g. blurry, photorealism, extra limbs"
              maxLength={10000}
            />
          </PixelField>

          <PixelField label="Output size">
            <div className="flex flex-wrap gap-1.5">
              {PIXEL_SIZE_PRESETS.map((preset) => {
                const active = width === preset && height === preset;
                return (
                  <Button
                    key={preset}
                    variant="utility"
                    size="md"
                    onClick={() => {
                      setWidth(preset);
                      setHeight(preset);
                    }}
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
                  value={width}
                  onChange={(event) =>
                    setWidth(Math.max(8, Math.min(256, Number(event.target.value) || 8)))
                  }
                />
              </label>
              <label className="flex items-center gap-2">
                <span className="text-[11px] text-fg-muted w-6">H</span>
                <Input
                  type="number"
                  min={8}
                  max={256}
                  value={height}
                  onChange={(event) =>
                    setHeight(Math.max(8, Math.min(256, Number(event.target.value) || 8)))
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
                  onChange={(event) =>
                    setSeed(Math.max(0, Math.min(4294967295, Number(event.target.value) || 0)))
                  }
                />
                <Button variant="utility" onClick={randomizeSeed} aria-label="Randomize seed">
                  <Dice5 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </PixelField>
          </div>

          {(mode === "text" || mode === "reference") && (
            <PixelField label="Style preset">
              <Select value={style} onChange={(event) => setStyle(event.target.value)}>
                {SPRITEKILN_STYLES.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </Select>
            </PixelField>
          )}

          {mode === "reference" && (
            <SliderField
              label="Reference strength"
              value={strength}
              min={0}
              max={2}
              step={0.05}
              onChange={setStrength}
            />
          )}

          {mode !== "image" && (
            <SliderField
              label="Generation long side"
              value={longSide}
              min={512}
              max={2048}
              step={64}
              suffix=" px"
              onChange={setLongSide}
            />
          )}

          {(mode === "text" || (mode === "image" && conversion === "ai")) && (
            <SliderField
              label="Steps"
              value={steps}
              min={1}
              max={mode === "text" ? 40 : 30}
              step={1}
              onChange={setSteps}
            />
          )}

          <label className="flex items-start gap-2 text-[11px] text-fg-muted">
            <input
              type="checkbox"
              checked={transparent}
              onChange={(event) => setTransparent(event.target.checked)}
              className="mt-0.5"
            />
            <span>
              Request a transparent-friendly background
              <span className="block text-[10px] text-fg-faint">
                Applied by text and reference workflows. Image redraw does not remove backgrounds.
              </span>
            </span>
          </label>

          {capability && !capability.ready && (
            <p className="text-[11px] text-warning leading-relaxed">
              {CAPABILITY_LABELS[requiresCapability]} is not ready:{" "}
              {capability.unverified
                ? "one or more requirements could not be verified."
                : "required nodes, models or workflow files are missing."}
            </p>
          )}

          <div className="flex gap-2">
            <Button
              variant="accent"
              size="lg"
              className="flex-1"
              loading={submitting}
              disabled={!projectId || Boolean(activeJob) || capabilityBlocked}
              onClick={() => void generate()}
            >
              {!submitting && <Wand2 className="w-4 h-4" />}
              {activeJob ? "Generation running…" : "Generate with AI"}
            </Button>
            {activeJob && (
              <Button variant="secondary" size="lg" onClick={() => void cancel()}>
                <X className="w-4 h-4" /> Cancel
              </Button>
            )}
          </div>
          <p className="text-[10px] text-fg-faint leading-relaxed">
            Generated PNGs import as normal Pixel Studio assets with a new version, frame IDs and
            generation metadata. Pixelbolt local rendering stays available in the other tabs.
          </p>
        </Card>

        <div className="space-y-5">
          <Card className="p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <ServerCog className="w-4 h-4 text-fg-muted" />
                <span className="label-mono text-fg-muted">Backend readiness</span>
                {status && <Badge tone={statusTone(status.state)}>{statusLabel(status.state)}</Badge>}
              </div>
              <div className="flex gap-1.5">
                <Button size="sm" variant="utility" loading={statusLoading} onClick={() => void loadStatus()}>
                  <RefreshCw className="w-3 h-3" /> Check
                </Button>
                <Button size="sm" variant="utility" onClick={() => void testConnection()}>
                  <Link2 className="w-3 h-3" /> Test
                </Button>
              </div>
            </div>

            {statusError && (
              <p className="text-[11px] text-danger flex items-center gap-1.5">
                <AlertTriangle className="w-3 h-3" /> {statusError}
              </p>
            )}
            {testMessage && <p className="text-[11px] text-fg-muted">{testMessage}</p>}

            {!status && statusLoading && (
              <p className="text-[11px] text-fg-faint">Inspecting the dedicated backend…</p>
            )}

            {status && (
              <>
                <p className="text-[11px] text-fg-muted leading-relaxed">{status.message}</p>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 font-mono text-[10px] text-fg-faint">
                  <span>API</span>
                  <span className="text-fg-muted break-all">{status.apiUrl}</span>
                  <span>ComfyUI</span>
                  <span className="text-fg-muted">{status.comfyVersion ?? "unknown"}</span>
                  <span>Python</span>
                  <span className="text-fg-muted">{status.pythonVersion ?? "unknown"}</span>
                  <span>PyTorch</span>
                  <span className="text-fg-muted">{status.pytorchVersion ?? "unknown"}</span>
                  <span>Workflows</span>
                  <span className="text-fg-muted break-all">
                    {status.workflowRoot || "not found"} ({status.workflowRootSource})
                  </span>
                </div>

                <div className="space-y-1.5">
                  {status.capabilities.map((entry) => (
                    <details
                      key={entry.id}
                      className="border border-border rounded-md px-2 py-1.5"
                    >
                      <summary className="flex items-center justify-between gap-2 cursor-pointer list-none">
                        <span className="text-[11px] font-medium text-fg">
                          {CAPABILITY_LABELS[entry.id]}
                        </span>
                        <Badge
                          tone={entry.ready ? "success" : entry.unverified ? "warning" : "danger"}
                        >
                          {entry.ready ? "Ready" : entry.unverified ? "Unverified" : "Needs setup"}
                        </Badge>
                      </summary>
                      <ul className="mt-1.5 space-y-1">
                        {entry.requirements.map((requirement) => (
                          <li
                            key={`${entry.id}:${requirement.kind}:${requirement.name}`}
                            className="flex items-start gap-1.5 text-[10px] text-fg-faint"
                          >
                            {requirement.state === "available" ? (
                              <CheckCircle2 className="w-3 h-3 text-success shrink-0" />
                            ) : (
                              <AlertTriangle
                                className={`w-3 h-3 shrink-0 ${
                                  requirement.state === "missing" ? "text-danger" : "text-warning"
                                }`}
                              />
                            )}
                            <span>
                              <span className="font-mono uppercase">{requirement.kind}</span>{" "}
                              {requirement.name}
                              {requirement.detail ? ` — ${requirement.detail}` : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                      {entry.notes.length > 0 && (
                        <ul className="mt-1.5 space-y-0.5">
                          {entry.notes.map((note) => (
                            <li key={note} className="text-[10px] text-fg-faint">
                              {note}
                            </li>
                          ))}
                        </ul>
                      )}
                    </details>
                  ))}
                </div>

                {status.hardware && status.hardware.devices.length > 0 && (
                  <div className="space-y-1">
                    <span className="label-mono text-fg-muted flex items-center gap-1.5">
                      <Cpu className="w-3 h-3" /> Hardware
                    </span>
                    {status.hardware.devices.map((device) => (
                      <p key={device.name} className="font-mono text-[10px] text-fg-faint">
                        {device.name} · {Math.round(device.vramTotalBytes / 1024 ** 3)} GB VRAM ·{" "}
                        {Math.round(device.vramFreeBytes / 1024 ** 3)} GB free
                      </p>
                    ))}
                    {status.hardware.ramTotalBytes !== null && (
                      <p className="font-mono text-[10px] text-fg-faint">
                        RAM {Math.round(status.hardware.ramTotalBytes / 1024 ** 3)} GB
                      </p>
                    )}
                  </div>
                )}

                {(status.warnings.length > 0 || (status.hardware?.warnings.length ?? 0) > 0) && (
                  <ul className="space-y-1">
                    {[...status.warnings, ...(status.hardware?.warnings ?? [])].map((warning) => (
                      <li key={warning} className="text-[10px] text-warning flex gap-1.5">
                        <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" /> {warning}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}

            <details className="border-t border-border pt-2">
              <summary className="cursor-pointer text-[11px] text-fg-muted">
                Dedicated backend connection
              </summary>
              <div className="mt-2 space-y-2">
                <p className="text-[10px] text-fg-faint leading-relaxed">
                  Runs a separate ComfyUI with SpriteKiln installed. The main Kirea ComfyUI host,
                  models, workflows and Python environment are never modified. Loopback only.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <PixelField label="Host">
                    <Input
                      value={backend.host}
                      onChange={(event) =>
                        setBackend((prev) => ({ ...prev, host: event.target.value }))
                      }
                      placeholder="127.0.0.1"
                    />
                  </PixelField>
                  <PixelField label="Port">
                    <Input
                      type="number"
                      min={1024}
                      max={65535}
                      value={backend.port}
                      onChange={(event) =>
                        setBackend((prev) => ({
                          ...prev,
                          port: Number(event.target.value) || 8189,
                        }))
                      }
                    />
                  </PixelField>
                </div>
                <PixelField
                  label="SpriteKiln checkout (workflows/api)"
                  hint="Leave empty to auto-detect a bundled or sibling SpriteKiln checkout."
                >
                  <Input
                    value={backend.root}
                    onChange={(event) =>
                      setBackend((prev) => ({ ...prev, root: event.target.value }))
                    }
                    placeholder="C:\\path\\to\\spritekiln"
                  />
                </PixelField>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={backendSaving}
                  onClick={() => void saveBackend()}
                >
                  Save & recheck
                </Button>
              </div>
            </details>
          </Card>

          <Card className="p-4 space-y-3">
            <span className="label-mono text-fg-muted">Generation</span>

            {!job && (
              <div className="h-[220px] flex flex-col items-center justify-center text-center gap-2 border border-dashed border-border rounded-xl">
                <Sparkles className="w-6 h-6 text-fg-subtle" />
                <p className="text-small text-fg-muted max-w-sm">
                  No AI generation in this session. The first prompt creates a real asset in this
                  project.
                </p>
              </div>
            )}

            {job && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-fg truncate">{job.name}</span>
                  <Badge
                    tone={
                      job.status === "completed"
                        ? "success"
                        : job.status === "failed"
                          ? "danger"
                          : job.status === "cancelled"
                            ? "neutral"
                            : "info"
                    }
                  >
                    {job.status}
                  </Badge>
                </div>
                <p className="font-mono text-[10px] text-fg-faint">
                  {MODE_COPY[job.mode].label} · {job.stage}
                  {job.promptId ? ` · ${job.promptId.slice(0, 8)}` : ""}
                </p>
                {(job.status === "queued" || job.status === "running") && (
                  <>
                    <ProgressBar
                      value={progressPercent ?? 0}
                      label="AI generation progress"
                    />
                    <p className="text-[10px] text-fg-faint">
                      {progressPercent !== null
                        ? `${Math.round(progressPercent)}%`
                        : "Waiting for backend progress…"}
                    </p>
                  </>
                )}
                {job.error && (
                  <p className="text-[11px] text-danger leading-relaxed">{job.error}</p>
                )}
                {job.warnings.length > 0 && (
                  <ul className="space-y-0.5">
                    {job.warnings.map((warning) => (
                      <li key={warning} className="text-[10px] text-warning">
                        {warning}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {jobAsset && (
              <div className="border border-border rounded-lg overflow-hidden bg-surface-subtle/40">
                <PixelImage
                  src={jobAsset.frames[0]?.dataUrl || jobAsset.previewDataUrl}
                  alt={jobAsset.name}
                  node={jobAsset.kind}
                  className="aspect-square w-full max-h-[260px]"
                />
                <div className="p-2 space-y-1">
                  <p className="text-[11px] font-semibold text-fg truncate">{jobAsset.name}</p>
                  <p className="font-mono text-[10px] text-fg-faint">
                    {jobAsset.width}×{jobAsset.height} · {jobAsset.frames.length}f · seed{" "}
                    {jobAsset.seed ?? "—"} · v{jobAsset.version}
                  </p>
                  <p className="font-mono text-[10px] text-fg-faint">
                    {formatPixelDate(jobAsset.createdAt)}
                  </p>
                  {jobAsset.generation && (
                    <p className="text-[10px] text-fg-faint leading-relaxed">
                      {jobAsset.generation.workflowFile} · {jobAsset.generation.model}
                      {jobAsset.generation.notes.length > 0
                        ? ` · ${jobAsset.generation.notes[0]}`
                        : ""}
                    </p>
                  )}
                  <div className="flex gap-1 pt-1">
                    <Button
                      size="sm"
                      variant="utility"
                      onClick={() => onInspect(jobAsset.id, "animation")}
                    >
                      Animate
                    </Button>
                    <Button
                      size="sm"
                      variant="utility"
                      onClick={() => onInspect(jobAsset.id, "editor")}
                    >
                      Edit
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 text-[11px] text-fg-faint">
              <ImagePlus className={`w-3 h-3 ${activeJob ? "animate-pulse" : ""}`} />
              {activeJob
                ? "Rendering on the dedicated backend, then importing PNG frames…"
                : "Finished generations become versioned Pixel Studio assets."}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

const ImageSourceField: React.FC<{
  label: string;
  hint: string;
  value: PixelAiImageInput | null;
  onChange: (value: PixelAiImageInput | null) => void;
  assets: PixelAssetRecord[];
  onFile: (file: File | undefined) => void;
}> = ({ label, hint, value, onChange, assets, onFile }) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const assetRecord =
    value?.kind === "asset" ? assets.find((asset) => asset.id === value.assetId) : undefined;
  const previewSrc =
    value?.kind === "dataUrl" ? value.dataUrl : assetRecord?.previewDataUrl ?? undefined;
  const selectValue =
    value?.kind === "asset" ? `asset:${value.assetId}` : value?.kind === "dataUrl" ? "upload" : "";

  return (
    <div className="space-y-1.5">
      <span className="label-mono text-fg-muted">{label}</span>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          onFile(event.dataTransfer.files[0]);
        }}
        className={`flex items-center gap-2 rounded-lg border p-2 transition-colors ${
          dragging ? "border-accent bg-accent-soft/40" : "border-border bg-bg"
        }`}
      >
        <PixelImage
          src={previewSrc}
          alt={label}
          className="w-14 h-14 shrink-0 rounded-md border border-border"
        />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex gap-1.5">
            <Button size="sm" variant="utility" onClick={() => inputRef.current?.click()}>
              <Upload className="w-3 h-3" /> Upload
            </Button>
            {value && (
              <Button
                size="sm"
                variant="utility"
                aria-label={`Clear ${label}`}
                onClick={() => onChange(null)}
              >
                <X className="w-3 h-3" />
              </Button>
            )}
          </div>
          <Select
            className="w-full"
            value={selectValue}
            onChange={(event) => {
              const next = event.target.value;
              if (!next) onChange(null);
              else if (next.startsWith("asset:")) {
                onChange({ kind: "asset", assetId: next.slice("asset:".length) });
              }
            }}
          >
            <option value="">Choose a project asset…</option>
            {value?.kind === "dataUrl" && (
              <option value="upload">{value.fileName ?? "Uploaded image"}</option>
            )}
            {assets.map((asset) => (
              <option key={asset.id} value={`asset:${asset.id}`}>
                {asset.name} ({asset.width}×{asset.height})
              </option>
            ))}
          </Select>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(event) => {
            onFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>
      <p className="text-[10px] text-fg-faint leading-relaxed">{hint}</p>
    </div>
  );
};
