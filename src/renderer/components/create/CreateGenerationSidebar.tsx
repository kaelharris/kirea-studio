import React, { useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  BookmarkPlus,
  Check,
  ChevronDown,
  ChevronUp,
  Dices,
  Eraser,
  FolderOpen,
  Heart,
  ImagePlus,
  Lock,
  Maximize2,
  Plus,
  RotateCcw,
  Sparkles,
  Square,
  Tags,
  Trash2,
  Unlock,
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
  getModelDisplayName,
  getModelRefDisplayName,
  isGenerationSupportedArchitecture,
  UPSCALE_PRESETS,
  VAE_AUTO,
} from "../../../shared/model-utils";
import { isMossWorkflow, isMossWorkflowReady } from "../../../shared/moss-image";
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
import { toMediaUrl } from "../../utils/format";
import {
  DEFAULT_HIRES_CONFIG,
  describeUpscalerLabel,
  LORA_PREVIEW_SIZES,
} from "./create-helpers";
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
    onUpdateSettings,
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
    activeOutfitId,
    onSelectOutfit,
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
    currentSamplingProfile,
    samplingMode,
    setSamplingMode,
    isSamplingCustomized,
    restoreRecommendedSamplingProfile,
    samplingProfileValidation,
  } = ctrl;
  const [coreExpanded, setCoreExpanded] = useState(true);
  const [paramsExpanded, setParamsExpanded] = useState(true);
  const [advancedExpanded, setAdvancedExpanded] = useState(false);
  const [showAdvancedSampling, setShowAdvancedSampling] = useState(false);

  return (
    <div className="space-y-3.5">
      {/* 1. Core Model & Recipe */}
      <div className="space-y-2.5">
        <button
          type="button"
          onClick={() => setCoreExpanded((p) => !p)}
          className="flex w-full items-center justify-between text-xs font-semibold text-fg hover:text-accent transition-colors cursor-pointer select-none"
        >
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] uppercase tracking-wider text-label">
              1. Core Model & Recipe
            </span>
            {currentArch !== "unknown" && (
              <Badge tone={architectureBadgeTone(currentArch)}>
                {ARCHITECTURE_LABELS[currentArch]}
              </Badge>
            )}
          </div>
          {coreExpanded ? (
            <ChevronUp className="w-3.5 h-3.5 text-fg-subtle" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-fg-subtle" />
          )}
        </button>

        {coreExpanded && (
          <div className="space-y-3 pt-2 border-t border-border/60">
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
              <div className="flex items-center gap-2">
                {currentCheckpointModel && currentCheckpointInfo?.previewPath && (
                  <div className="w-14 shrink-0">
                    <ModelPreview
                      model={currentCheckpointModel}
                      className="h-14 rounded-lg"
                      iconSizeClass="w-4 h-4"
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
                            {getModelDisplayName(m)}
                          </option>
                        ))}
                      </optgroup>
                    ))
                  )}
                </Select>
              </div>
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
              {currentArch === "moss_image" &&
                !isMossWorkflowReady(models, draft.workflowId) && (
                  <div className="p-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-200 text-xs space-y-1">
                    <div className="font-semibold text-amber-300">Missing MOSS Requirements</div>
                    <p className="text-[11px] text-amber-200/90 leading-snug">
                      To generate with MOSS-Image, install the <strong>Qwen3.5-9B text encoder</strong> and <strong>FLUX.2 small VAE</strong> in your Model Vault.
                    </p>
                  </div>
              )}
            </div>

            {isMossWorkflow(draft.workflowId) &&
              draft.workflowId === "t2i_moss_image_layout" && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs font-semibold text-fg-muted">
                      Layout boxes (JSON)
                    </label>
                    <button
                      type="button"
                      className="text-[10px] text-accent hover:underline cursor-pointer"
                      onClick={() =>
                        setDraft((p) => ({
                          ...p,
                          layoutJson: JSON.stringify(
                            [
                              {
                                x: 128,
                                y: 128,
                                width: 768,
                                height: 384,
                                metadata: {
                                  type: "text",
                                  text: "MOSS",
                                  desc: "Large display title across the top of the image",
                                  palette: [],
                                },
                              },
                              {
                                x: 256,
                                y: 512,
                                width: 512,
                                height: 384,
                                metadata: {
                                  type: "obj",
                                  text: "",
                                  desc: "Main subject centered in the lower half",
                                  palette: [],
                                },
                              },
                            ],
                            null,
                            2
                          ),
                        }))
                      }
                    >
                      Insert sample
                    </button>
                  </div>
                  <Textarea
                    value={draft.layoutJson ?? ""}
                    onChange={(e) =>
                      setDraft((p) => ({ ...p, layoutJson: e.target.value }))
                    }
                    placeholder='[{"x":128,"y":128,"width":768,"height":384,"metadata":{"type":"text","text":"MOSS","desc":"Title","palette":[]}}]'
                    rows={7}
                    spellCheck={false}
                    className="font-mono text-[11px]"
                  />
                  <p className="text-[10px] text-fg-subtle leading-snug">
                    Pixel-space boxes on a {draft.width}×{draft.height} canvas.
                    Text boxes render their exact text; object boxes use the
                    description.
                  </p>
                </div>
              )}
          </div>
            {/* Character Identity */}
              <div className="space-y-2 border-t border-divider pt-3">
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
                    className={`space-y-2 border-l-2 pl-2 ${
                      activeCharacterPlan?.active
                        ? "border-accent/40"
                        : "border-border"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={activeCharacterPlan?.active ? "accent" : "neutral"}>
                        {activeCharacterPlan?.active
                          ? "Img2img reference active"
                          : "Identity text only"}
                      </Badge>
                      {activeCharacter.dna?.dnaLocked && (
                        <Badge tone="accent">
                          DNA LOCKED
                        </Badge>
                      )}
                      {activeCharacter.dna?.triggerToken && (
                        <span className="font-mono text-[10px] bg-accent/10 text-accent px-1.5 py-0.5 border border-accent/20">
                          {activeCharacter.dna.triggerToken}
                        </span>
                      )}
                      {activeCharacterPlan?.active && (
                        <span className="text-[11px] text-fg-subtle tabular-nums">
                          denoise {activeCharacterPlan.denoise}
                        </span>
                      )}
                    </div>

                    {/* Outfit Switcher */}
                    {activeCharacter.outfits && activeCharacter.outfits.length > 0 && (
                      <div className="pt-1.5 border-t border-border/50 space-y-1">
                        <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-label">
                          <span>Outfit</span>
                          <span className="text-fg-subtle">{activeCharacter.outfits.length} available</span>
                        </div>
                        <Select
                          value={activeOutfitId ?? ""}
                          onChange={(e) => onSelectOutfit(e.target.value || null)}
                          className="h-7 text-xs w-full"
                        >
                          <option value="">Default appearance</option>
                          {activeCharacter.outfits.map((outfit) => (
                            <option key={outfit.id} value={outfit.id}>
                              {outfit.name} {outfit.isDefault ? "(Default)" : ""}
                            </option>
                          ))}
                        </Select>
                      </div>
                    )}

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
                          {getModelRefDisplayName(
                            models,
                            activeCharacter.checkpointPath
                          ) || activeCharacter.checkpointName}
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
              <div className="space-y-2 border-t border-divider pt-3">
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
            {/* LoRA Stack */}
          <div className="space-y-2 pt-2 border-t border-border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-terracotta">
                  LoRA Adapters ({draft.loras.length}/{activeWorkflow?.maxLoras ?? 4})
                </span>
                {loraWarnings.length > 0 && (
                  <Badge tone="warning">{loraWarnings.length} mismatch</Badge>
                )}
              </div>
              <Button
                size="sm"
                variant="creative"
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
                      <div
                        className="shrink-0"
                        style={{
                          width: LORA_PREVIEW_SIZES.stack,
                          height: LORA_PREVIEW_SIZES.stack,
                        }}
                      >
                        <ModelPreview
                          model={model}
                          className="h-full w-full rounded-lg"
                          iconSizeClass="w-4 h-4"
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
            {/* Img2Img Input Panel */}
          {draft.mode === "img2img" && (
            <div className="space-y-3 border-t border-border pt-3">
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

              {ctrl.workflowMode === "inpaint" && (
                <div className="rounded-lg bg-accent-soft/30 p-2 text-[11px] text-accent border border-accent/20">
                  <span className="font-semibold">Inpaint active:</span> Brush directly on the canvas preview to mark the area to regenerate.
                </div>
              )}
              {ctrl.workflowMode === "outpaint" && (
                <div className="rounded-lg bg-accent-soft/30 p-2 text-[11px] text-accent border border-accent/20">
                  <span className="font-semibold">Outpaint active:</span> Use the directional padding buttons on the canvas to extend borders.
                </div>
              )}
              {ctrl.workflowMode === "variations" && (
                <div className="rounded-lg bg-surface-subtle p-2 text-[11px] text-fg-muted border border-border">
                  <span className="font-semibold">Variations active:</span> Generates diverse interpretations with randomized seed.
                </div>
              )}

              <div className="space-y-1.5">
                <SliderField
                  label="Denoise Strength"
                  value={draft.denoise}
                  min={0.1}
                  max={1.0}
                  step={0.05}
                  onChange={(v) => setDraft((p) => ({ ...p, denoise: v }))}
                />
                <div className="flex items-center gap-1.5 pt-1">
                  <span className="text-[10px] text-fg-subtle">Presets:</span>
                  {[
                    { label: "Subtle (0.35)", val: 0.35 },
                    { label: "Balanced (0.55)", val: 0.55 },
                    { label: "Creative (0.75)", val: 0.75 },
                  ].map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => setDraft((d) => ({ ...d, denoise: p.val }))}
                      className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer border ${
                        Math.abs(draft.denoise - p.val) < 0.03
                          ? "bg-accent text-white border-accent"
                          : "bg-surface text-fg-muted border-border hover:text-fg"
                      }`}
                    >
                      {p.label.split(" ")[0]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          </div>
        )}
      </div>

      {/* 2. Generation Parameters */}
      <div className="space-y-2.5">
        <button
          type="button"
          onClick={() => setParamsExpanded((p) => !p)}
          className="flex w-full items-center justify-between text-xs font-semibold text-fg hover:text-accent transition-colors cursor-pointer select-none"
        >
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] uppercase tracking-wider text-label">
              2. Generation Parameters
            </span>
            <span className="font-mono text-[11px] text-fg-subtle tabular-nums">
              {draft.width}×{draft.height} · {draft.steps} steps
            </span>
          </div>
          {paramsExpanded ? (
            <ChevronUp className="w-3.5 h-3.5 text-fg-subtle" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-fg-subtle" />
          )}
        </button>

        {paramsExpanded && (
          <div className="space-y-3 pt-2 border-t border-border/60">
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
            {/* Smart Sampling Profile Header & Controls */}
            <div className="space-y-2.5 pt-2 border-t border-border">
              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-label">
                    Sampling
                  </span>
                  <Badge
                    tone={
                      isSamplingCustomized
                        ? "warning"
                        : currentSamplingProfile.provenance.confidence === "official"
                          ? "accent"
                          : "neutral"
                    }
                  >
                    {isSamplingCustomized
                      ? "Custom"
                      : `${currentSamplingProfile.provenance.confidence.toUpperCase()}`}
                  </Badge>
                </div>

                <div className="flex items-center gap-1">
                  {isSamplingCustomized && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={restoreRecommendedSamplingProfile}
                      className="h-6 px-1.5 text-[10px] font-mono uppercase text-accent hover:text-accent hover:bg-accent/10"
                      title="Restore the recommended sampling settings for this model"
                    >
                      <RotateCcw className="w-3 h-3 mr-1" />
                      Restore
                    </Button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowAdvancedSampling((p) => !p)}
                    className="flex items-center gap-1 text-[11px] font-mono text-fg-subtle hover:text-fg transition-colors px-1 py-0.5 cursor-pointer"
                    title="Toggle Advanced Sampling Settings (Sampler, Scheduler, CFG)"
                  >
                    <span className="text-[10px] uppercase">{showAdvancedSampling ? "Hide" : "Advanced"}</span>
                    {showAdvancedSampling ? (
                      <ChevronUp className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>

              {/* Model Profile Summary Hint */}
              <div className="text-[11px] font-mono text-fg-muted flex items-center justify-between bg-surface-subtle px-2 py-1 border border-border/60">
                <span className="truncate">
                  {currentSamplingProfile.modelFamily.toUpperCase()}{" "}
                  {currentSamplingProfile.modelVariant && currentSamplingProfile.modelVariant !== "base"
                    ? `[${currentSamplingProfile.modelVariant.toUpperCase()}]`
                    : ""}{" "}
                  · {currentSamplingProfile.sampling.steps} steps ({currentSamplingProfile.sampling.sampler})
                </span>
                <span className="shrink-0 text-fg-subtle text-[10px]">
                  CFG {currentSamplingProfile.sampling.cfg}
                </span>
              </div>

              {/* Sampling Steps Slider */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[11px] text-fg-subtle">Sampling Steps</span>
                  {currentSamplingProfile.lockedParameters?.includes("steps") && (
                    <Badge tone="neutral" className="text-[9px] py-0">LOCKED</Badge>
                  )}
                </div>
                <SliderField
                  label=""
                  value={draft.steps}
                  min={currentSamplingProfile.recommendedRanges?.steps?.min ?? 1}
                  max={Math.max(60, currentSamplingProfile.recommendedRanges?.steps?.max ?? 60)}
                  step={1}
                  disabled={currentSamplingProfile.lockedParameters?.includes("steps")}
                  onChange={(v) => {
                    setDraft((p) => ({ ...p, steps: v }));
                    setSamplingMode("custom");
                  }}
                />
              </div>

              {/* Advanced Sampling Settings Collapsible */}
              {showAdvancedSampling && (
                <div className="space-y-2.5 border-t border-border pt-3 animate-[kirea-panel-in_140ms_ease-out]">
                  {/* Runtime missing samplers warning banner */}
                  {!samplingProfileValidation.supported && (
                    <div className="p-2 border border-warning/40 bg-warning/10 text-warning text-[11px] font-mono space-y-1">
                      {samplingProfileValidation.warnings.map((w, idx) => (
                        <p key={idx}>⚠️ {w}</p>
                      ))}
                    </div>
                  )}

                  {/* CFG Guidance */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[11px] text-fg-subtle">CFG Guidance</span>
                      {currentSamplingProfile.lockedParameters?.includes("cfg") && (
                        <Badge tone="neutral" className="text-[9px] py-0">
                          LOCKED ({currentSamplingProfile.sampling.cfg})
                        </Badge>
                      )}
                    </div>
                    <SliderField
                      label=""
                      value={draft.cfg}
                      min={currentSamplingProfile.lockedParameters?.includes("cfg") ? draft.cfg : 1}
                      max={currentSamplingProfile.lockedParameters?.includes("cfg") ? draft.cfg : 15}
                      step={0.5}
                      disabled={currentSamplingProfile.lockedParameters?.includes("cfg")}
                      onChange={(v) => {
                        setDraft((p) => ({ ...p, cfg: v }));
                        setSamplingMode("custom");
                      }}
                    />
                    {currentSamplingProfile.lockedParameters?.includes("cfg") && (
                      <p className="text-[10px] text-fg-subtle font-mono">
                        CFG is fixed for {currentSamplingProfile.modelFamily} {currentSamplingProfile.modelVariant} architecture.
                      </p>
                    )}
                  </div>

                  {/* Sampler and Scheduler Pickers */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[11px] text-fg-subtle flex items-center justify-between">
                        <span>Sampler</span>
                        {draft.sampler === currentSamplingProfile.sampling.sampler && (
                          <span className="text-[9px] text-accent font-mono font-semibold">REC</span>
                        )}
                      </label>
                      <Select
                        value={draft.sampler}
                        onChange={(e) => {
                          setDraft((p) => ({ ...p, sampler: e.target.value }));
                          setSamplingMode("custom");
                        }}
                        className="h-8 text-xs font-mono"
                      >
                        {samplersAndSchedulers.samplers.map((s) => (
                          <option key={s} value={s}>
                            {s} {s === currentSamplingProfile.sampling.sampler ? "★" : ""}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] text-fg-subtle flex items-center justify-between">
                        <span>Scheduler</span>
                        {draft.scheduler === currentSamplingProfile.sampling.scheduler && (
                          <span className="text-[9px] text-accent font-mono font-semibold">REC</span>
                        )}
                      </label>
                      <Select
                        value={draft.scheduler}
                        onChange={(e) => {
                          setDraft((p) => ({ ...p, scheduler: e.target.value }));
                          setSamplingMode("custom");
                        }}
                        className="h-8 text-xs font-mono"
                      >
                        {samplersAndSchedulers.schedulers.map((s) => (
                          <option key={s} value={s}>
                            {s} {s === currentSamplingProfile.sampling.scheduler ? "★" : ""}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Seed */}
            {/* Seed Control with [LOCK_SEED] / [RANDOMIZE] Toggle */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-label">
                  Seed
                </span>
                <span className="font-mono text-[10px] uppercase tracking-wider text-fg-subtle">
                  {draft.seed === -1 || draft.randomSeed ? "DYNAMIC (RANDOM)" : "LOCKED"}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="relative flex-1">
                  {draft.seed === -1 || draft.randomSeed ? (
                    <div className="flex h-8 items-center px-2.5 rounded-none border-2 border-border bg-well font-mono text-xs font-semibold text-fg-muted tracking-wide select-none">
                      -1 (RANDOM)
                    </div>
                  ) : (
                    <Input
                      type="number"
                      min={0}
                      max={4294967295}
                      value={draft.seed}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setDraft((p) => ({
                          ...p,
                          seed: Math.max(0, Math.min(4294967295, isNaN(val) ? 0 : val)),
                          randomSeed: false,
                        }));
                      }}
                      className="h-8 text-xs font-mono tabular-nums rounded-none border-2"
                    />
                  )}
                </div>
                {draft.seed === -1 || draft.randomSeed ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    title="Lock current generation to a fixed seed"
                    onClick={() => {
                      const nextSeed = Math.floor(Math.random() * 4294967295);
                      setDraft((p) => ({
                        ...p,
                        randomSeed: false,
                        seed: nextSeed,
                      }));
                      onToast(`Locked seed to ${nextSeed}.`);
                    }}
                    className="h-8 px-2.5 rounded-none border-2 border-[#F2F2EE] font-mono text-[11px] font-bold tracking-wider uppercase"
                  >
                    <Lock className="w-3.5 h-3.5 mr-1" strokeWidth={2} />
                    [LOCK_SEED]
                  </Button>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="secondary"
                      title="Roll a new fixed seed"
                      onClick={() => {
                        const nextSeed = Math.floor(Math.random() * 4294967295);
                        setDraft((p) => ({
                          ...p,
                          randomSeed: false,
                          seed: nextSeed,
                        }));
                        onToast(`Rolled seed: ${nextSeed}.`);
                      }}
                      className="h-8 px-2 rounded-none border-2 font-mono text-[11px]"
                    >
                      <Dices className="w-3.5 h-3.5" strokeWidth={2} />
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      title="Switch to random seed for each render"
                      onClick={() => {
                        setDraft((p) => ({
                          ...p,
                          seed: -1,
                          randomSeed: true,
                        }));
                        onToast("Seed unlocked (random on each run).");
                      }}
                      className="h-8 px-2.5 rounded-none border-2 border-[#1E3BFF] text-[#1E3BFF] hover:bg-[#1E3BFF] hover:text-[#F2F2EE] font-mono text-[11px] font-bold tracking-wider uppercase"
                    >
                      <Unlock className="w-3.5 h-3.5 mr-1" strokeWidth={2} />
                      [RANDOMIZE]
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 3. Advanced Conditioning */}
      <div className="space-y-2.5">
        <button
          type="button"
          onClick={() => setAdvancedExpanded((p) => !p)}
          className="flex w-full items-center justify-between text-xs font-semibold text-fg hover:text-accent transition-colors cursor-pointer select-none"
        >
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] uppercase tracking-wider text-label">
              3. Advanced Conditioning
            </span>
            <span className="text-[11px] text-fg-subtle">
              VAE · Hires · Batch
            </span>
          </div>
          {advancedExpanded ? (
            <ChevronUp className="w-3.5 h-3.5 text-fg-subtle" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-fg-subtle" />
          )}
        </button>

        {advancedExpanded && (
          <div className="space-y-3 pt-2 border-t border-border/60">
            <div className="space-y-2">{vaeModels.length > 0 && (
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
                      ? ` — ${getModelRefDisplayName(models, autoVaeName)}`
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
            )}</div>
            {/* High-Res Fix (2-Pass Detail) */}
          <div className="space-y-3 border-t border-border pt-3">
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

            <label className="flex items-center justify-between gap-3 p-2 rounded-lg bg-surface border border-border cursor-pointer">
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-[11px] font-medium text-fg">
                  Mature Content (18+)
                  <span
                    className={`px-1 py-0.5 rounded-sm font-mono text-[9px] font-semibold uppercase tracking-[0.08em] border ${
                      settings.nsfwFilter
                        ? "bg-surface-subtle text-fg-subtle border-border"
                        : "bg-warning-soft text-warning border-warning/30"
                    }`}
                  >
                    {settings.nsfwFilter ? "Off" : "On"}
                  </span>
                </span>
                <span className="block text-[10px] text-fg-subtle leading-snug mt-0.5">
                  Provider safe-browsing plus local blur. Off by default.
                </span>
              </span>
              <input
                type="checkbox"
                checked={!settings.nsfwFilter}
                onChange={(e) =>
                  void onUpdateSettings({ nsfwFilter: !e.target.checked })
                }
                className="accent-accent shrink-0"
                aria-label="Show mature model content"
              />
            </label>
          </div>
        )}
      </div>
    </div>
  );
};
