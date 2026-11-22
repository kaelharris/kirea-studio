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
import { toMediaUrl } from "../../utils/format";
import { describeUpscalerLabel } from "./create-helpers";
import type { CreateController } from "./useCreateController";

export const CreateUpscaleSidebar: React.FC<{ ctrl: CreateController }> = ({ ctrl }) => {
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
    onSavePrompt,
    onInspectImage,
    onToggleFavorite,
    onToast,
    validationIssues,
    submitting,
    sourceImageDims,
    setSourceImageDims,
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
              {/* Standalone Upscale Input Image */}
              <div className="p-3 rounded-xl bg-bg border border-border space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-fg">Source Image</span>
                  <div className="flex items-center gap-1.5">
                    {latestImage && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setDraft((p) => ({
                            ...p,
                            inputImagePath: latestImage.filePath,
                            width: Math.min(4096, Math.max(64, latestImage.width)),
                            height: Math.min(4096, Math.max(64, latestImage.height)),
                          }))
                        }
                      >
                        Use Latest
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void handlePickInputImage()}
                    >
                      <ImagePlus className="w-3.5 h-3.5" />
                      Choose Image
                    </Button>
                  </div>
                </div>

                {draft.inputImagePath ? (
                  <div className="relative rounded-lg overflow-hidden border border-border bg-well h-40 flex items-center justify-center">
                    <MediaImage
                      src={toMediaUrl(draft.inputImagePath)}
                      alt="Upscale source"
                      onLoad={(e) => {
                        const w = e.currentTarget.naturalWidth;
                        const h = e.currentTarget.naturalHeight;
                        if (w > 0 && h > 0) {
                          setSourceImageDims({ width: w, height: h });
                          const clampedW = Math.min(4096, Math.max(64, w));
                          const clampedH = Math.min(4096, Math.max(64, h));
                          setDraft((p) =>
                            p.mode === "upscale" &&
                            (p.width !== clampedW || p.height !== clampedH)
                              ? { ...p, width: clampedW, height: clampedH }
                              : p
                          );
                        }
                      }}
                      className="max-h-full max-w-full object-contain"
                    />
                    <span className="absolute bottom-1.5 left-1.5 px-2 py-0.5 rounded-md bg-black/75 text-[11px] font-medium text-white tabular-nums">
                      Original: {upscaleSourceWidth} × {upscaleSourceHeight}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setDraft((p) => ({ ...p, inputImagePath: null }))
                      }
                      aria-label="Clear source image"
                      className="absolute top-1.5 right-1.5 p-1 rounded-md bg-black/70 text-white hover:bg-danger cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="text-xs text-fg-subtle py-6 text-center border border-dashed border-border rounded-lg">
                    Select any PNG, JPEG, or WebP file—or send a creation directly from your Library.
                  </div>
                )}
              </div>

              {/* Pipeline, Presets & Upscaler Model */}
              <div className="space-y-3 pt-2 border-t border-border">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-fg-muted">
                    Upscale Pipeline
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setUpscalePipeline("crisp")}
                      className={`h-9 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                        !isRefinerPipeline
                          ? "bg-accent-soft border-accent text-accent-hover"
                          : "bg-bg border-border text-fg-muted hover:text-fg"
                      }`}
                    >
                      Crisp 4×
                    </button>
                    <button
                      type="button"
                      onClick={() => setUpscalePipeline("refiner")}
                      className={`h-9 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                        isRefinerPipeline
                          ? "bg-accent-soft border-accent text-accent-hover"
                          : "bg-bg border-border text-fg-muted hover:text-fg"
                      }`}
                    >
                      Alchemy Refiner
                    </button>
                  </div>
                </div>

                {isRefinerPipeline && (
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-fg-muted">
                      Alchemy Preset
                    </label>
                    <div className="grid gap-1.5">
                      {UPSCALE_PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => applyUpscalePreset(preset.id)}
                          className={`p-2 rounded-xl border text-left transition-colors cursor-pointer ${
                            upscaleConfig.preset === preset.id
                              ? "bg-accent-soft border-accent"
                              : "bg-bg border-border hover:border-accent/60"
                          }`}
                        >
                          <span className="flex items-center gap-1.5 text-xs font-semibold text-fg">
                            <Sparkles className="w-3.5 h-3.5 text-accent" />
                            {preset.label}
                          </span>
                          <span className="block mt-0.5 text-[11px] text-fg-subtle leading-relaxed">
                            {preset.description}
                          </span>
                        </button>
                      ))}
                    </div>
                    <SliderField
                      label="Refiner Creativity"
                      value={upscaleConfig.creativity ?? 0.35}
                      min={0.2}
                      max={0.5}
                      step={0.01}
                      onChange={(v) =>
                        setDraft((p) => ({
                          ...p,
                          upscale: {
                            ...p.upscale,
                            upscaler: p.upscale?.upscaler ?? "",
                            scale: p.upscale?.scale ?? 4,
                            pipeline: "refiner",
                            creativity: v,
                          },
                        }))
                      }
                    />
                    <p className="text-[11px] text-fg-subtle leading-relaxed">
                      0.20 subtly sharpens detail; 0.50 re-renders creatively.
                      The refiner re-paints the upscaled image at low denoise.
                    </p>
                  </div>
                )}

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-fg-muted">
                      AI Upscale Model
                    </label>
                    <Badge tone="accent">{upscaleModels.length} Installed</Badge>
                  </div>
                  <Select
                    value={upscaleConfig.upscaler || IMAGE_UPSCALER_LANCZOS}
                    onChange={(e) =>
                      setDraft((p) => ({
                        ...p,
                        upscale: {
                          ...p.upscale,
                          upscaler: e.target.value,
                          scale: p.upscale?.scale ?? 4,
                        },
                      }))
                    }
                  >
                    {upscaleModels.map((m) => (
                      <option key={m.id} value={m.relativePath}>
                        {describeUpscalerLabel(m.name)}
                      </option>
                    ))}
                    <option value={IMAGE_UPSCALER_LANCZOS}>
                      Built-in Lanczos (Fast Non-AI Fallback)
                    </option>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-fg-muted">
                      Scale Multiplier
                    </span>
                    <span className="text-[11px] text-accent font-medium tabular-nums">
                      {upscaleTargetWidth} × {upscaleTargetHeight} px
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[2, 3, 4].map((factor) => (
                      <button
                        key={factor}
                        type="button"
                        onClick={() =>
                          setDraft((p) => ({
                            ...p,
                            upscale: {
                              ...p.upscale,
                              upscaler:
                                p.upscale?.upscaler ||
                                upscaleModels[0]?.relativePath ||
                                IMAGE_UPSCALER_LANCZOS,
                              scale: factor,
                            },
                          }))
                        }
                        className={`h-9 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                          upscaleConfig.scale === factor
                            ? "bg-accent-soft border-accent text-accent-hover"
                            : "bg-bg border-border text-fg-muted hover:text-fg"
                        }`}
                      >
                        {factor}× {factor === 4 ? "(Native)" : ""}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-fg-subtle leading-relaxed">
                    {isRefinerPipeline
                      ? "The AI upscaler enlarges first; the refiner then re-renders detail at the target 2K/4K resolution."
                      : "Runs your local 4× neural upscaler on GPU; scales down smoothly via Lanczos when 2× or 3× is selected."}
                  </p>
                </div>
              </div>

              {isRefinerPipeline && (
                <div className="space-y-3 pt-2 border-t border-border">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-fg-muted">
                      Refiner Checkpoint
                    </label>
                    <Select
                      value={upscaleConfig.checkpoint ?? ""}
                      onChange={(e) =>
                        setDraft((p) => ({
                          ...p,
                          upscale: {
                            ...p.upscale,
                            upscaler: p.upscale?.upscaler ?? "",
                            scale: p.upscale?.scale ?? 4,
                            pipeline: "refiner",
                            checkpoint: e.target.value || null,
                          },
                        }))
                      }
                    >
                      <option value="">Use current generation checkpoint</option>
                      {refinerCheckpointModels.map((m) => (
                        <option key={m.id} value={m.relativePath}>
                          [
                          {ARCHITECTURE_LABELS[getEffectiveArchitecture(m)]}
                          ] {getEffectiveModelInfo(m).name}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-fg-muted">
                      Refiner Prompt
                    </label>
                    <Textarea
                      value={draft.prompt}
                      onChange={(e) =>
                        setDraft((p) => ({ ...p, prompt: e.target.value }))
                      }
                      rows={2}
                      placeholder="Describe the detail you want the refiner to add..."
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-fg-muted">
                      Refiner Negative
                    </label>
                    <Textarea
                      value={draft.negativePrompt}
                      onChange={(e) =>
                        setDraft((p) => ({ ...p, negativePrompt: e.target.value }))
                      }
                      rows={2}
                      placeholder="blurry, artifacts, low quality..."
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-fg-muted">
                        Refiner LoRAs ({Math.min(draft.loras.length, 2)}/2)
                      </label>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={
                          draft.loras.length >= 2 ||
                          refinerCompatibleLoras.length === 0
                        }
                        onClick={() =>
                          handleAddLora(refinerCompatibleLoras[0]?.relativePath)
                        }
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Add
                      </Button>
                    </div>
                    {draft.loras.slice(0, 2).map((sel, index) => (
                      <div key={`${sel.name}-${index}`} className="flex gap-1.5">
                        <Select
                          value={sel.name}
                          onChange={(e) =>
                            updateLora(index, { name: e.target.value })
                          }
                          className="h-8 flex-1 text-xs"
                        >
                          {refinerCompatibleLoras
                            .filter(
                              (l) =>
                                l.relativePath === sel.name ||
                                !draft.loras.some(
                                  (other) => other.name === l.relativePath
                                )
                            )
                            .map((l) => (
                              <option key={l.id} value={l.relativePath}>
                                [{ARCHITECTURE_LABELS[getEffectiveArchitecture(l)]}]
                                {" "}
                                {getEffectiveModelInfo(l).name}
                              </option>
                            ))}
                        </Select>
                        <button
                          type="button"
                          aria-label="Remove refiner LoRA"
                          onClick={() =>
                            setDraft((p) => ({
                              ...p,
                              loras: p.loras.filter((_, i) => i !== index),
                            }))
                          }
                          className="p-1.5 rounded-lg text-fg-muted hover:text-danger hover:bg-danger-soft cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    {draft.loras.length === 0 && (
                      <p className="text-[11px] text-fg-subtle">
                        Optional. Refiner LoRAs must match{" "}
                        {ARCHITECTURE_LABELS[refinerArch]}.
                      </p>
                    )}
                    {draft.loras.length > 2 && (
                      <p className="text-[11px] text-warning">
                        Only the first 2 adapters are applied in the refiner
                        pass.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Save Format */}
              <div className="space-y-1.5 pt-2 border-t border-border">
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
            </>
    </>
  );
};
