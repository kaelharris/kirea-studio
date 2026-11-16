import React from "react";
import {
  AlertCircle,
  AlertTriangle,
  BookmarkPlus,
  Check,
  Dices,
  Eraser,
  FolderOpen,
  Heart,
  ImagePlus,
  Lock,
  Maximize2,
  Plus,
  Sparkles,
  Square,
  Tags,
  Trash2,
  Users,
  Wand2,
} from "lucide-react";
import {
  ASPECT_RATIOS,
  CUSTOM_ASPECT_ID,
  formatAspectRatio,
  IMAGE_UPSCALER_LANCZOS,
  LATENT_UPSCALER_BICUBIC,
  LATENT_UPSCALER_BISLERP,
} from "../../../shared/aspect-ratios";
import { PROMPT_SNIPPETS } from "../../../shared/presets";
import type {
  OutputFormat,
  PerformanceProfile,
} from "../../../shared/types";
import {
  ARCHITECTURE_HINTS,
  ARCHITECTURE_LABELS,
  architectureBadgeTone,
  evaluateLoraCompatibility,
  getEffectiveArchitecture,
  getEffectiveModelInfo,
  isGenerationSupportedArchitecture,
  UPSCALE_PRESETS,
  VAE_AUTO,
} from "../../../shared/model-utils";
import { ModelPreview } from "../ModelPreview";
import {
  Badge,
  Button,
  Input,
  Modal,
  Select,
  SliderField,
  Textarea,
} from "../ui/Primitives";
import { MediaImage } from "../ui/MediaImage";
import { shortModelLabel, toMediaUrl } from "../../utils/format";
import { DEFAULT_HIRES_CONFIG, describeUpscalerLabel } from "./create-helpers";
import type { CreateController } from "./useCreateController";

export const CreateGenerationSidebar: React.FC<{ ctrl: CreateController }> = ({ ctrl }) => {
  const {
    draft,
    setDraft,
    settings,
    runtime,
    models,
    workflows,
    samplersAndSchedulers,
    images,
    recipes,
    characters,
    activeCharacterId,
    onSelectCharacter,
    onOpenCharacters,
    activeRecipeId,
    onSelectRecipe,
    onSavePrompt,
    onInspectImage,
    onToggleFavorite,
    onToast,
    validationIssues,
    submitting,
    sourceImageDims,
    loraPickerOpen,
    setLoraPickerOpen,
    loraSearch,
    setLoraSearch,
    showIncompatibleLoras,
    setShowIncompatibleLoras,
    recipeModalOpen,
    setRecipeModalOpen,
    recipeName,
    setRecipeName,
    recipeDescription,
    setRecipeDescription,
    savingRecipe,
    inspectorTab,
    setInspectorTab,
    primaryModels,
    currentCheckpointModel,
    currentArch,
    checkpointGroups,
    loraModels,
    filteredLoraModels,
    activeRecipe,
    vaeModels,
    autoVaeName,
    upscaleModels,
    hiresConfig,
    upscaleConfig,
    compatibleWorkflows,
    activeWorkflow,
    dimensionInfo,
    activeJob,
    latestImage,
    currentCheckpointInfo,
    loraWarnings,
    activeCharacter,
    activeCharacterPlan,
    appendToPrompt,
    handleWorkflowChange,
    handleCheckpointChange,
    handleAspectChange,
    handleDimensionChange,
    handleProfileChange,
    handleAddLora,
    updateLora,
    handleOpenSaveRecipe,
    handleSaveRecipe,
    handleApplyRecipe,
    handlePickInputImage,
    handlePickReference,
    handleClearReference,
    checkpointOptions,
    hiresDims,
    upscaleSourceWidth,
    upscaleSourceHeight,
    upscaleTargetWidth,
    upscaleTargetHeight,
    isRefinerPipeline,
    refinerCheckpointModels,
    refinerArch,
    refinerCompatibleLoras,
    setUpscalePipeline,
    applyUpscalePreset,
    setHiresPipeline,
    handleGenerate,
    blockingErrors,
    warnings,
    progressPercent,
  } = ctrl;

  return (
    <>
            <>
              {/* Character Identity */}
              <div className="p-2.5 rounded-xl bg-bg border border-border space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-label">
                    Character Identity
                  </span>
                  <Button size="sm" variant="ghost" onClick={onOpenCharacters}>
                    <Users className="w-3.5 h-3.5" />
                    Manage
                  </Button>
                </div>
                <Select
                  value={activeCharacterId ?? ""}
                  onChange={(e) => onSelectCharacter(e.target.value || null)}
                  className="h-8 text-xs"
                >
                  <option value="">No character — free-form prompt</option>
                  {characters.map((character) => (
                    <option key={character.id} value={character.id}>
                      {character.favorite ? "★ " : ""}
                      {character.name} ({ARCHITECTURE_LABELS[character.architecture]})
                    </option>
                  ))}
                </Select>

                {activeCharacter && (
                  <div
                    className={`p-2 rounded-lg border space-y-1.5 ${
                      activeCharacterPlan?.active
                        ? "border-accent/40 bg-accent-soft/40"
                        : "border-border"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={activeCharacterPlan?.active ? "accent" : "neutral"}>
                        {activeCharacterPlan?.active
                          ? "Img2img reference active"
                          : "Identity text only"}
                      </Badge>
                      {activeCharacterPlan?.active && (
                        <span className="text-[11px] text-fg-subtle tabular-nums">
                          denoise {activeCharacterPlan.denoise}
                        </span>
                      )}
                    </div>

                    {activeCharacterPlan?.reason === "missing_primary" && (
                      <p className="text-[11px] text-warning leading-relaxed">
                        No primary reference saved. Add one in Character Hub to
                        enable img2img conditioning.
                      </p>
                    )}
                    {activeCharacterPlan?.reason === "unsupported_architecture" && (
                      <p className="text-[11px] text-warning leading-relaxed">
                        Stock img2img cannot drive{" "}
                        {ARCHITECTURE_LABELS[currentArch]}; using prompt-only
                        identity.
                      </p>
                    )}
                    {activeCharacter.checkpointPath &&
                      !primaryModels.some(
                        (m) => m.relativePath === activeCharacter.checkpointPath
                      ) && (
                        <p className="text-[11px] text-warning leading-relaxed">
                          Checkpoint '
                          {activeCharacter.checkpointName ??
                            shortModelLabel(activeCharacter.checkpointPath)}
                          ' is not installed; kept the current checkpoint.
                        </p>
                      )}

                    <p className="text-[11px] text-fg-subtle truncate">
                      {activeCharacterPlan?.active
                        ? "Reference image and denoise are applied from the character profile."
                        : "Prompt tokens, checkpoint, and LoRA recipe are injected from the character profile."}
                    </p>
                  </div>
                )}
              </div>

              {/* LoRA Recipe Bar */}
              <div className="p-2.5 rounded-xl bg-bg border border-border space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-label">
                    LoRA Recipe
                  </span>
                  <div className="flex items-center gap-1">
                    {activeRecipe && (
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Detach recipe (keep current settings)"
                        onClick={() => onSelectRecipe(null)}
                      >
                        Detach
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleOpenSaveRecipe}
                    >
                      <BookmarkPlus className="w-3.5 h-3.5" />
                      {activeRecipe ? "Update" : "Save as Recipe"}
                    </Button>
                  </div>
                </div>
                <Select
                  value={activeRecipeId ?? ""}
                  onChange={(e) => handleApplyRecipe(e.target.value)}
                  className="h-8 text-xs"
                >
                  <option value="">No recipe — manual LoRA stack</option>
                  {recipes.map((recipe) => (
                    <option key={recipe.id} value={recipe.id}>
                      {recipe.favorite ? "★ " : ""}
                      {recipe.name} ({recipe.items.length} LoRA
                      {recipe.items.length === 1 ? "" : "s"})
                    </option>
                  ))}
                </Select>
                {activeRecipe && (
                  <p className="text-[11px] text-fg-subtle leading-relaxed">
                    {activeRecipe.description ||
                      `${activeRecipe.items.length} adapters • ${
                        ARCHITECTURE_LABELS[activeRecipe.architecture]
                      }${activeRecipe.checkpointName ? ` • ${activeRecipe.checkpointName}` : ""}`}
                  </p>
                )}
              </div>

              {/* Model & Workflow */}
          <div className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-fg-muted">
                  Checkpoint / Base Model
                </label>
                {currentArch !== "unknown" && (
                  <Badge tone={architectureBadgeTone(currentArch)}>
                    {ARCHITECTURE_LABELS[currentArch]}
                  </Badge>
                )}
              </div>
              <div className="flex items-start gap-2">
                {currentCheckpointModel && currentCheckpointInfo?.previewPath && (
                  <div className="w-11 shrink-0">
                    <ModelPreview
                      model={currentCheckpointModel}
                      className="h-11 rounded-lg"
                      iconSizeClass="w-3.5 h-3.5"
                    />
                  </div>
                )}
                <Select
                  value={draft.checkpoint}
                  onChange={(e) => handleCheckpointChange(e.target.value)}
                >
                  {primaryModels.length === 0 ? (
                    <option value="">No checkpoints scanned yet</option>
                  ) : (
                    checkpointGroups.map(([label, group]) => (
                      <optgroup key={label} label={label}>
                        {group.map((m) => (
                          <option key={m.id} value={m.relativePath}>
                            {getEffectiveModelInfo(m).name}
                          </option>
                        ))}
                      </optgroup>
                    ))
                  )}
                </Select>
              </div>
              {currentCheckpointInfo?.description && (
                <p className="text-[11px] text-fg-subtle leading-relaxed">
                  {currentCheckpointInfo.description}
                </p>
              )}
              {currentArch !== "unknown" && (
                <p className="text-[11px] text-fg-subtle leading-relaxed">
                  {ARCHITECTURE_HINTS[currentArch]}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-fg-muted">
                Workflow Pipeline
              </label>
              <Select
                value={draft.workflowId}
                onChange={(e) => handleWorkflowChange(e.target.value)}
              >
                {compatibleWorkflows.map((wf) => (
                  <option key={wf.id} value={wf.id}>
                    {wf.name} (v{wf.version})
                  </option>
                ))}
              </Select>
            </div>

            {vaeModels.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-fg-muted">
                  VAE
                </label>
                <Select
                  value={draft.vae ?? VAE_AUTO}
                  onChange={(e) =>
                    setDraft((p) => ({ ...p, vae: e.target.value }))
                  }
                >
                  <option value={VAE_AUTO}>
                    Auto (Recommended)
                    {autoVaeName
                      ? ` — ${shortModelLabel(autoVaeName)}`
                      : " — checkpoint default"}
                  </option>
                  <option value="">Checkpoint Built-in VAE</option>
                  {vaeModels.map((v) => (
                    <option key={v.id} value={v.relativePath}>
                      [{ARCHITECTURE_LABELS[getEffectiveArchitecture(v)]}]{" "}
                      {getEffectiveModelInfo(v).name}
                    </option>
                  ))}
                </Select>
                <p className="text-[11px] text-fg-subtle leading-relaxed">
                  Auto resolves the correct decoder per architecture (SDXL → sdxl_vae_fp16fix,
                  SD 1.5 → vae-ft-mse, Anima → qwen_image_vae).
                </p>
              </div>
            )}
          </div>

          {/* Img2Img Input Panel */}
          {draft.mode === "img2img" && (
            <div className="p-3 rounded-xl bg-bg border border-border space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-fg">
                  Reference Image
                </span>
                <Button size="sm" variant="secondary" onClick={() => void handlePickInputImage()}>
                  <ImagePlus className="w-3.5 h-3.5" />
                  Choose Image
                </Button>
              </div>
              {draft.inputImagePath ? (
                <div className="relative rounded-lg overflow-hidden border border-border bg-well h-32 flex items-center justify-center">
                  <MediaImage
                    src={toMediaUrl(draft.inputImagePath)}
                    alt="Img2Img reference"
                    className="max-h-full max-w-full object-contain"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((p) => ({ ...p, inputImagePath: null }))
                    }
                    aria-label="Clear reference image"
                    className="absolute top-1.5 right-1.5 p-1 rounded-md bg-black/70 text-white hover:bg-danger cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="text-xs text-fg-subtle py-4 text-center border border-dashed border-border rounded-lg">
                  Select a PNG, JPEG, or WebP input image.
                </div>
              )}

              <SliderField
                label="Denoise Strength"
                value={draft.denoise}
                min={0.1}
                max={1.0}
                step={0.05}
                onChange={(v) => setDraft((p) => ({ ...p, denoise: v }))}
              />
            </div>
          )}

          {/* LoRA Stack */}
          <div className="space-y-2 pt-2 border-t border-border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-fg-muted">
                  LoRA Adapters ({draft.loras.length}/{activeWorkflow?.maxLoras ?? 4})
                </span>
                {loraWarnings.length > 0 && (
                  <Badge tone="warning">{loraWarnings.length} mismatch</Badge>
                )}
              </div>
              <Button
                size="sm"
                variant="ghost"
                disabled={
                  loraModels.length === 0 ||
                  draft.loras.length >= (activeWorkflow?.maxLoras ?? 4)
                }
                onClick={() => setLoraPickerOpen(true)}
              >
                <Plus className="w-3.5 h-3.5" />
                Add LoRA
              </Button>
            </div>

            {draft.loras.length === 0 && (
              <p className="text-[11px] text-fg-subtle leading-relaxed">
                No adapters selected. Add LoRAs to stack styles, or load a saved
                LoRA Recipe above.
              </p>
            )}

            {draft.loras.map((sel, index) => {
              const model =
                loraModels.find((m) => m.relativePath === sel.name) ?? null;
              const info = model ? getEffectiveModelInfo(model) : null;
              const compatibility = info
                ? evaluateLoraCompatibility(info.architecture, currentArch)
                : null;
              const mismatched =
                compatibility != null && !compatibility.compatible;
              const triggerWords = info?.triggerWords ?? [];

              return (
                <div
                  key={`${sel.name}-${index}`}
                  className={`p-2.5 rounded-xl bg-bg border space-y-2 ${
                    mismatched ? "border-warning/60" : "border-border"
                  }`}
                >
                  <div className="flex items-start gap-1.5">
                    {model && info?.previewPath && (
                      <div className="w-9 shrink-0">
                        <ModelPreview
                          model={model}
                          className="h-9 rounded-lg"
                          iconSizeClass="w-3 h-3"
                        />
                      </div>
                    )}
                    <div className="flex-1 min-w-0 space-y-1">
                      <Select
                        value={sel.name}
                        onChange={(e) => updateLora(index, { name: e.target.value })}
                        className="h-8 text-xs"
                      >
                        {loraModels
                          .filter(
                            (l) =>
                              filteredLoraModels.includes(l) ||
                              l.relativePath === sel.name
                          )
                          .map((l) => {
                          const lInfo = getEffectiveModelInfo(l);
                          return (
                            <option key={l.id} value={l.relativePath}>
                              [{ARCHITECTURE_LABELS[lInfo.architecture]}] {lInfo.name}
                            </option>
                          );
                        })}
                      </Select>
                      {info && (
                        <div className="flex items-center gap-1.5 text-[11px] text-fg-subtle">
                          <Badge tone={architectureBadgeTone(info.architecture)}>
                            {ARCHITECTURE_LABELS[info.architecture]}
                          </Badge>
                          {mismatched && (
                            <span className="inline-flex items-center gap-1 text-warning">
                              <AlertTriangle className="w-3 h-3" />
                              Incompatible with {ARCHITECTURE_LABELS[currentArch]}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setDraft((p) => ({
                          ...p,
                          loras: p.loras.filter((_, i) => i !== index),
                        }))
                      }
                      aria-label="Remove LoRA"
                      className="p-1.5 rounded-lg text-fg-muted hover:text-danger hover:bg-danger-soft cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {triggerWords.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1">
                      <Tags className="w-3 h-3 text-fg-subtle shrink-0" />
                      {triggerWords.slice(0, 6).map((word) => {
                        const alreadyInPrompt = draft.prompt
                          .toLowerCase()
                          .includes(word.toLowerCase());
                        return (
                          <button
                            key={word}
                            type="button"
                            disabled={alreadyInPrompt}
                            onClick={() => appendToPrompt(word)}
                            className={`px-1.5 py-0.5 rounded-md border text-[11px] transition-colors ${
                              alreadyInPrompt
                                ? "border-border text-fg-subtle cursor-default"
                                : "border-border text-fg-muted hover:text-fg hover:border-accent cursor-pointer"
                            }`}
                            title={
                              alreadyInPrompt
                                ? "Already in prompt"
                                : `Append '${word}' to prompt`
                            }
                          >
                            + {word}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <SliderField
                      label="Model Weight"
                      value={sel.strengthModel}
                      min={-1.5}
                      max={1.5}
                      step={0.05}
                      onChange={(v) => updateLora(index, { strengthModel: v })}
                    />
                    <SliderField
                      label="CLIP Weight"
                      value={sel.strengthClip}
                      min={-1.5}
                      max={1.5}
                      step={0.05}
                      onChange={(v) => updateLora(index, { strengthClip: v })}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Aspect Ratio & Dimensions */}
          <div className="space-y-2.5 pt-2 border-t border-border">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-fg-muted">
                Aspect Ratio
              </span>
              <span className="font-mono text-[11px] text-fg-subtle tabular-nums">
                {formatAspectRatio(draft.width, draft.height)} · {draft.width} ×{" "}
                {draft.height}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {ASPECT_RATIOS.map((ar) => (
                <button
                  key={ar.id}
                  type="button"
                  onClick={() => handleAspectChange(ar.id)}
                  className={`h-8 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                    draft.aspectRatio === ar.id
                      ? "bg-accent-soft border-accent text-accent-hover"
                      : "bg-bg border-border text-fg-muted hover:text-fg"
                  }`}
                >
                  {ar.id}
                </button>
              ))}
              <button
                type="button"
                onClick={() => handleAspectChange(CUSTOM_ASPECT_ID)}
                className={`h-8 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                  draft.aspectRatio === CUSTOM_ASPECT_ID
                    ? "bg-accent-soft border-accent text-accent-hover"
                    : "bg-bg border-border text-fg-muted hover:text-fg"
                }`}
              >
                Custom
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] text-fg-subtle">Width</label>
                <Input
                  type="number"
                  step={activeWorkflow?.dimStep ?? 8}
                  min={activeWorkflow?.minDim ?? 256}
                  max={activeWorkflow?.maxDim ?? 1536}
                  value={draft.width}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    if (!Number.isFinite(next) || next <= 0) return;
                    handleDimensionChange("width", next);
                  }}
                  className="h-8 text-xs tabular-nums"
                />
              </div>
              <div>
                <label className="text-[11px] text-fg-subtle">Height</label>
                <Input
                  type="number"
                  step={activeWorkflow?.dimStep ?? 8}
                  min={activeWorkflow?.minDim ?? 256}
                  max={activeWorkflow?.maxDim ?? 1536}
                  value={draft.height}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    if (!Number.isFinite(next) || next <= 0) return;
                    handleDimensionChange("height", next);
                  }}
                  className="h-8 text-xs tabular-nums"
                />
              </div>
            </div>
            <p className="text-[11px] text-fg-subtle">
              {activeWorkflow
                ? `${activeWorkflow.name} accepts ${activeWorkflow.minDim}–${activeWorkflow.maxDim}px in ${activeWorkflow.dimStep}px steps.`
                : "This workflow does not publish dimension limits."}
            </p>
            {dimensionInfo.notes.length > 0 && (
              <div className="space-y-1 rounded-lg border border-warning/30 bg-warning-soft px-2 py-1.5">
                {dimensionInfo.notes.map((note) => (
                  <p
                    key={note}
                    className="flex items-start gap-1.5 text-[11px] leading-snug text-warning"
                  >
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>{note}</span>
                  </p>
                ))}
              </div>
            )}
          </div>

          {/* High-Res Fix (2-Pass Detail) */}
          <div className="p-3 rounded-xl bg-bg border border-border space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs font-semibold text-fg">
                  High-Res Fix
                </span>
                {hiresConfig.enabled && (
                  <Badge tone="accent">
                    {hiresDims.width}×{hiresDims.height}
                  </Badge>
                )}
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={hiresConfig.enabled}
                onClick={() =>
                  setDraft((p) => ({
                    ...p,
                    hiresFix: {
                      ...(p.hiresFix ?? DEFAULT_HIRES_CONFIG),
                      enabled: !(p.hiresFix?.enabled ?? false),
                    },
                  }))
                }
                className={`px-2.5 h-6 rounded-full text-[11px] font-semibold transition-colors cursor-pointer ${
                  hiresConfig.enabled
                    ? "bg-accent-solid text-accent-fg"
                    : "bg-surface-elevated border border-border text-fg-muted hover:text-fg"
                }`}
              >
                {hiresConfig.enabled ? "Enabled" : "Off"}
              </button>
            </div>

            {hiresConfig.enabled ? (
              <div className="space-y-3 pt-1">
                <div className="space-y-1">
                  <label className="text-[11px] text-fg-subtle">
                    Hires Pipeline
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setHiresPipeline("latent")}
                      className={`h-7 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                        (hiresConfig.pipeline ?? "latent") === "latent"
                          ? "bg-accent-soft border-accent text-accent-hover"
                          : "bg-surface border-border text-fg-muted hover:text-fg"
                      }`}
                    >
                      Latent
                    </button>
                    <button
                      type="button"
                      onClick={() => setHiresPipeline("refiner")}
                      className={`h-7 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                        hiresConfig.pipeline === "refiner"
                          ? "bg-accent-soft border-accent text-accent-hover"
                          : "bg-surface border-border text-fg-muted hover:text-fg"
                      }`}
                    >
                      Refiner
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] text-fg-subtle">
                    Hires Upscaler
                  </label>
                  <Select
                    value={hiresConfig.upscaler}
                    onChange={(e) =>
                      setDraft((p) => ({
                        ...p,
                        hiresFix: {
                          ...(p.hiresFix ?? DEFAULT_HIRES_CONFIG),
                          enabled: true,
                          upscaler: e.target.value,
                        },
                      }))
                    }
                    className="h-8 text-xs"
                  >
                    <option value={LATENT_UPSCALER_BISLERP}>
                      Latent (Bislerp — Fast)
                    </option>
                    <option value={LATENT_UPSCALER_BICUBIC}>
                      Latent (Bicubic)
                    </option>
                    {upscaleModels.map((m) => (
                      <option key={m.id} value={m.relativePath}>
                        {describeUpscalerLabel(m.name)}
                      </option>
                    ))}
                  </Select>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-fg-subtle">Upscale Factor</span>
                    <span className="text-accent font-medium tabular-nums">
                      {draft.width}×{draft.height} → {hiresDims.width}×{hiresDims.height}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[1.25, 1.5, 2.0].map((factor) => (
                      <button
                        key={factor}
                        type="button"
                        onClick={() =>
                          setDraft((p) => ({
                            ...p,
                            hiresFix: {
                              ...(p.hiresFix ?? DEFAULT_HIRES_CONFIG),
                              enabled: true,
                              scale: factor,
                            },
                          }))
                        }
                        className={`h-7 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                          Math.abs(hiresConfig.scale - factor) < 0.02
                            ? "bg-accent-soft border-accent text-accent-hover"
                            : "bg-surface border-border text-fg-muted hover:text-fg"
                        }`}
                      >
                        {factor}×
                      </button>
                    ))}
                  </div>
                </div>

                <SliderField
                  label="Hires Pass Steps"
                  value={hiresConfig.steps}
                  min={6}
                  max={30}
                  step={1}
                  onChange={(v) =>
                    setDraft((p) => ({
                      ...p,
                      hiresFix: {
                        ...(p.hiresFix ?? DEFAULT_HIRES_CONFIG),
                        enabled: true,
                        steps: v,
                      },
                    }))
                  }
                />

                {hiresConfig.pipeline === "refiner" ? (
                  <SliderField
                    label="Refiner Creativity"
                    value={hiresConfig.creativity ?? 0.35}
                    min={0.2}
                    max={0.5}
                    step={0.01}
                    onChange={(v) =>
                      setDraft((p) => ({
                        ...p,
                        hiresFix: {
                          ...(p.hiresFix ?? DEFAULT_HIRES_CONFIG),
                          enabled: true,
                          creativity: v,
                        },
                      }))
                    }
                  />
                ) : (
                  <SliderField
                    label="Hires Denoise"
                    value={hiresConfig.denoise}
                    min={0.2}
                    max={0.7}
                    step={0.05}
                    onChange={(v) =>
                      setDraft((p) => ({
                        ...p,
                        hiresFix: {
                          ...(p.hiresFix ?? DEFAULT_HIRES_CONFIG),
                          enabled: true,
                          denoise: v,
                        },
                      }))
                    }
                  />
                )}
              </div>
            ) : (
              <p className="text-[11px] text-fg-subtle">
                Optional 2nd sampling pass to boost crisp texture & anatomy detail above base resolution.
              </p>
            )}
          </div>

          {/* Sampling Controls */}
          <div className="space-y-3 pt-2 border-t border-border">
            <SliderField
              label="Sampling Steps"
              value={draft.steps}
              min={1}
              max={60}
              step={1}
              onChange={(v) => setDraft((p) => ({ ...p, steps: v }))}
            />
            <SliderField
              label="CFG Guidance"
              value={draft.cfg}
              min={1}
              max={15}
              step={0.5}
              onChange={(v) => setDraft((p) => ({ ...p, cfg: v }))}
            />

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[11px] text-fg-subtle">Sampler</label>
                <Select
                  value={draft.sampler}
                  onChange={(e) =>
                    setDraft((p) => ({ ...p, sampler: e.target.value }))
                  }
                  className="h-8 text-xs"
                >
                  {samplersAndSchedulers.samplers.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-fg-subtle">Scheduler</label>
                <Select
                  value={draft.scheduler}
                  onChange={(e) =>
                    setDraft((p) => ({ ...p, scheduler: e.target.value }))
                  }
                  className="h-8 text-xs"
                >
                  {samplersAndSchedulers.schedulers.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            {/* Seed */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-fg-muted font-medium">Seed</span>
                <label className="inline-flex items-center gap-1.5 text-[11px] text-fg-muted cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.randomSeed}
                    onChange={(e) =>
                      setDraft((p) => ({ ...p, randomSeed: e.target.checked }))
                    }
                    className="accent-accent"
                  />
                  Randomize each run
                </label>
              </div>
              <div className="flex gap-1.5">
                <Input
                  type="number"
                  min={0}
                  max={2147483647}
                  value={draft.seed}
                  disabled={draft.randomSeed}
                  onChange={(e) =>
                    setDraft((p) => ({
                      ...p,
                      seed: Math.max(0, Number(e.target.value) || 0),
                    }))
                  }
                  className="h-8 text-xs tabular-nums"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  title="Generate new fixed seed"
                  onClick={() =>
                    setDraft((p) => ({
                      ...p,
                      randomSeed: false,
                      seed: Math.floor(Math.random() * 2_147_483_647),
                    }))
                  }
                >
                  <Dices className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>

            {/* Batch, Output Format, Performance Profile */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[11px] text-fg-subtle">Batch Count</label>
                <Select
                  value={draft.batchCount}
                  onChange={(e) =>
                    setDraft((p) => ({
                      ...p,
                      batchCount: Number(e.target.value),
                    }))
                  }
                  className="h-8 text-xs"
                >
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      {n} {n === 1 ? "Image" : "Images"}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-fg-subtle">Save Format</label>
                <Select
                  value={draft.outputFormat}
                  onChange={(e) =>
                    setDraft((p) => ({
                      ...p,
                      outputFormat: e.target.value as OutputFormat,
                    }))
                  }
                  className="h-8 text-xs"
                >
                  <option value="png">PNG (Lossless)</option>
                  <option value="jpeg">JPEG (Compact)</option>
                  <option value="webp">WebP</option>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] text-fg-subtle">Performance Profile</label>
              <Select
                value={settings.performanceProfile}
                onChange={(e) =>
                  void handleProfileChange(e.target.value as PerformanceProfile)
                }
                className="h-8 text-xs"
              >
                <option value="balanced">Balanced (Recommended)</option>
                <option value="quality">High Quality (Higher Res)</option>
                <option value="memory_saver">Memory Saver (Low VRAM)</option>
              </Select>
            </div>
          </div>
            </>
    </>
  );
};
