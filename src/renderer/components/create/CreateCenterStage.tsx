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
import { shortModelLabel, toMediaUrl } from "../../utils/format";
import { describeUpscalerLabel } from "./create-helpers";
import type { CreateController } from "./useCreateController";

export const CreateCenterStage: React.FC<{ ctrl: CreateController }> = ({ ctrl }) => {
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
    visibleBlockingErrors,
    promptPending,
    warnings,
    progressPercent,
  } = ctrl;

  return (
    <>
      {/* CENTER CANVAS + PROMPT DOCK */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        {draft.mode === "upscale" ? (
          <div className="shrink-0 space-y-3 rounded-xl border border-border bg-surface p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-label">
                  {isRefinerPipeline
                    ? "Alchemy Refiner Upscale"
                    : "4× AI Super-Resolution"}
                </span>
                <Badge tone="accent">
                  {upscaleConfig.scale}× •{" "}
                  {isRefinerPipeline
                    ? UPSCALE_PRESETS.find(
                        (preset) => preset.id === upscaleConfig.preset
                      )?.label ?? "Custom Refiner"
                    : upscaleConfig.upscaler
                      ? describeUpscalerLabel(upscaleConfig.upscaler)
                      : "Lanczos"}
                </Badge>
              </div>
              <span className="text-xs text-fg-subtle tabular-nums">
                {upscaleSourceWidth}×{upscaleSourceHeight} → {upscaleTargetWidth}×
                {upscaleTargetHeight} px
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                {blockingErrors.map((err, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1.5 text-xs text-danger bg-danger-soft px-2.5 py-1 rounded-lg border border-danger/25"
                  >
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    {err.message}
                  </span>
                ))}
                {blockingErrors.length === 0 &&
                  warnings.map((w, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1.5 text-xs text-warning bg-warning-soft px-2.5 py-1 rounded-lg border border-warning/25"
                    >
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      {w.message}
                    </span>
                  ))}
                {blockingErrors.length === 0 && warnings.length === 0 && (
                  <span className="text-xs text-fg-subtle tabular-nums">
                    Ready to upscale • Output saved lossless to Library •{" "}
                    {runtime.status === "connected" ? "Engine online" : "Engine idle"}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {activeJob && (
                  <Button
                    variant="danger"
                    size="lg"
                    onClick={() => void window.kirea.cancelJob(activeJob.id)}
                  >
                    <Square className="w-4 h-4 fill-current" />
                    Cancel
                  </Button>
                )}
                <Button
                  variant="accent"
                  size="lg"
                  loading={submitting}
                  disabled={blockingErrors.length > 0}
                  onClick={() => void handleGenerate()}
                >
                  <Maximize2 className="w-4 h-4" />
                  {activeJob ? "Queue Upscale" : "Upscale Image"}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          /* Prompt Dock */
          <div className="shrink-0 space-y-3 rounded-xl border border-border bg-surface p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-label mr-1">
                Prompt
              </span>
              {PROMPT_SNIPPETS.slice(0, 3).map((snip) => (
                <button
                  key={snip.label}
                  type="button"
                  onClick={() =>
                    setDraft((p) => ({
                      ...p,
                      prompt: p.prompt.trim()
                        ? `${p.prompt.trim()}, ${snip.text}`
                        : snip.text,
                    }))
                  }
                  className="px-2 py-0.5 text-[11px] rounded-md bg-surface-subtle hover:bg-surface-elevated border border-border text-fg-muted hover:text-fg transition-colors cursor-pointer"
                >
                  + {snip.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="ghost"
                disabled={!draft.prompt.trim()}
                onClick={() => {
                  const title =
                    draft.prompt.trim().slice(0, 40) || "Studio Prompt";
                  void onSavePrompt({
                    title,
                    prompt: draft.prompt,
                    negativePrompt: draft.negativePrompt,
                  }).then(() => onToast("Saved prompt to library."));
                }}
              >
                <BookmarkPlus className="w-3.5 h-3.5" />
                Save Prompt
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setDraft((p) => ({ ...p, prompt: "", negativePrompt: "" }))
                }
              >
                <Eraser className="w-3.5 h-3.5" />
                Clear
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-3">
            <Textarea
              rows={3}
              value={draft.prompt}
              onChange={(e) =>
                setDraft((p) => ({ ...p, prompt: e.target.value }))
              }
              placeholder="Describe your scene, lighting, framing, materials, and aesthetic mood..."
            />
            <Textarea
              rows={3}
              value={draft.negativePrompt}
              onChange={(e) =>
                setDraft((p) => ({ ...p, negativePrompt: e.target.value }))
              }
              placeholder="Negative prompt: blurry, artifacts, bad anatomy, text..."
              className="text-fg-muted"
            />
          </div>

          {/* Pre-flight Validation + Generate Action Row */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              {visibleBlockingErrors.map((err, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1.5 text-xs text-danger bg-danger-soft px-2.5 py-1 rounded-lg border border-danger/25"
                >
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {err.message}
                </span>
              ))}
              {visibleBlockingErrors.length === 0 &&
                warnings.map((w, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1.5 text-xs text-warning bg-warning-soft px-2.5 py-1 rounded-lg border border-warning/25"
                  >
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    {w.message}
                  </span>
                ))}
              {visibleBlockingErrors.length === 0 &&
                warnings.length === 0 &&
                promptPending && (
                  <span className="text-xs text-fg-subtle">
                    Describe the scene to enable Generate.
                  </span>
                )}
              {blockingErrors.length === 0 && warnings.length === 0 && (
                <span className="text-xs text-fg-subtle tabular-nums">
                  Ready • {draft.width}×{draft.height}
                  {hiresConfig.enabled
                    ? ` → ${hiresDims.width}×${hiresDims.height} (Hires ${hiresConfig.scale}×)`
                    : ""}{" "}
                  • {draft.steps} steps •{" "}
                  {runtime.status === "connected" ? "Engine online" : "Engine idle"}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {activeJob && (
                <Button
                  variant="danger"
                  size="lg"
                  onClick={() => void window.kirea.cancelJob(activeJob.id)}
                >
                  <Square className="w-4 h-4 fill-current" />
                  Cancel
                </Button>
              )}
              <Button
                variant="accent"
                size="lg"
                loading={submitting}
                disabled={blockingErrors.length > 0}
                onClick={() => void handleGenerate()}
              >
                <Sparkles className="w-4 h-4" />
                {activeJob ? "Queue Another" : "Generate Image"}
              </Button>
            </div>
          </div>
          </div>
        )}

        {/* Live Canvas / Result Stage */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-surface">
          {activeJob ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 gap-4 bg-bg/60">
              {activeJob.previewDataUrl ? (
                <img
                  src={activeJob.previewDataUrl}
                  alt="Live inference preview"
                  className="max-h-[340px] rounded-xl border border-border-strong object-contain shadow-[var(--shadow-float)]"
                />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-xl border border-accent/30 bg-accent-soft text-accent-hover">
                  <Wand2 className="w-9 h-9 animate-pulse" />
                </div>
              )}

              <div className="w-full max-w-md space-y-2 text-center">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-fg">
                    {activeJob.status === "PROCESSING_OUTPUT"
                      ? "Finalizing & Embedding Metadata..."
                      : activeJob.status === "QUEUED"
                        ? "Queued in ComfyUI..."
                        : activeJob.status === "SUBMITTING"
                          ? "Submitting Graph..."
                          : `Sampling Step ${activeJob.progressStep} / ${activeJob.progressMax}`}
                  </span>
                  <span className="tabular-nums font-semibold text-accent">
                    {progressPercent}%
                  </span>
                </div>
                <div className="w-full h-2 bg-surface-subtle rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent transition-[width] duration-200 ease-out"
                    style={{ width: `${Math.max(4, progressPercent)}%` }}
                  />
                </div>
                {activeJob.currentNode && (
                  <p className="text-[11px] text-fg-subtle">
                    Active Node #{activeJob.currentNode} • Checkpoint{" "}
                    {shortModelLabel(activeJob.checkpoint)}
                  </p>
                )}
              </div>
            </div>
          ) : latestImage ? (
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="flex-1 min-h-0 bg-well flex items-center justify-center p-4 overflow-hidden">
                <MediaImage
                  src={toMediaUrl(latestImage.filePath)}
                  alt={latestImage.prompt}
                  onClick={() => onInspectImage(latestImage)}
                  className="max-h-full max-w-full cursor-zoom-in rounded-lg object-contain shadow-[var(--shadow-float)]"
                />
              </div>
              <div className="px-4 py-2.5 border-t border-border bg-surface-elevated flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-3 min-w-0">
                  <Badge tone="neutral" className="tabular-nums">
                    {latestImage.width}×{latestImage.height}
                  </Badge>
                  <span className="text-fg-muted tabular-nums">
                    Seed {latestImage.seed}
                  </span>
                  <span className="text-fg-subtle truncate max-w-md">
                    {shortModelLabel(latestImage.checkpoint)} • {latestImage.sampler}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setDraft((p) => ({
                        ...p,
                        mode: "upscale",
                        workflowId: "upscale_model_v1",
                        inputImagePath: latestImage.filePath,
                        width: Math.min(4096, Math.max(64, latestImage.width)),
                        height: Math.min(4096, Math.max(64, latestImage.height)),
                        upscale: {
                          upscaler:
                            p.upscale?.upscaler ||
                            upscaleModels[0]?.relativePath ||
                            IMAGE_UPSCALER_LANCZOS,
                          scale: p.upscale?.scale ?? 4,
                        },
                      }))
                    }
                    title="Send this image to 4× AI Upscale"
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                    Upscale
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setDraft((p) => ({
                        ...p,
                        randomSeed: false,
                        seed: latestImage.seed,
                      }))
                    }
                    title="Lock this seed"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    Lock Seed
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void onToggleFavorite(latestImage.id)}
                  >
                    <Heart
                      className={`w-3.5 h-3.5 ${
                        latestImage.favorite ? "fill-danger text-danger" : ""
                      }`}
                    />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void window.kirea.openPath(latestImage.filePath)}
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => onInspectImage(latestImage)}
                  >
                    Inspect
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
              <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-xl border border-border bg-surface-subtle text-fg-muted">
                <Sparkles className="w-6 h-6 text-accent" />
              </div>
              <h3 className="text-base font-semibold text-fg">
                Studio Canvas Ready
              </h3>
              <p className="mt-1 text-sm text-fg-muted max-w-md">
                Pick a checkpoint on the left, refine your prompt above, and click{" "}
                <span className="text-fg font-medium">Generate Image</span> to render
                locally through ComfyUI.
              </p>
            </div>
          )}

          {/* Bottom Recent Strip */}
          {images.length > 0 && (
            <div className="p-2.5 border-t border-border bg-surface-elevated flex items-center gap-2 overflow-x-auto">
              <span className="text-[11px] font-semibold text-fg-subtle px-1 shrink-0">
                Recent
              </span>
              {images.slice(0, 12).map((img) => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => onInspectImage(img)}
                  className="w-12 h-12 rounded-lg overflow-hidden border border-border hover:border-accent shrink-0 cursor-pointer transition-colors"
                >
                  <MediaImage
                    src={toMediaUrl(img.filePath)}
                    alt={img.fileName}
                    compact
                    className="w-full h-full bg-surface-subtle object-contain"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
};
