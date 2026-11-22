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
  PanelRightClose,
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
  getModelRefDisplayName,
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

export const CreateRightInspector: React.FC<{ ctrl: CreateController }> = ({ ctrl }) => {
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
    inspectorOpen,
    setInspectorOpen,
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
      <aside
        aria-label="Inspector"
        className={`hidden shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-surface min-[1600px]:flex ${
          inspectorOpen ? "w-[264px] min-[2200px]:w-[320px]" : "w-0 border-transparent"
        }`}
      >
        <div className="flex items-center justify-between gap-1 border-b border-border bg-surface-elevated px-2 py-1.5">
          <div
            role="tablist"
            aria-label="Inspector panel"
            className="inline-flex rounded-md border border-border bg-bg p-0.5"
          >
            {(["result", "history"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={inspectorTab === tab}
                onClick={() => setInspectorTab(tab)}
                className={`h-6 rounded px-2 text-caption font-semibold capitalize transition-colors ${
                  inspectorTab === tab
                    ? "bg-surface text-fg"
                    : "text-fg-subtle hover:text-fg"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setInspectorOpen(false)}
            aria-label="Collapse inspector"
            className="rounded p-1 text-fg-subtle transition-colors hover:text-fg"
          >
            <PanelRightClose className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {inspectorTab === "result" ? (
            <div className="space-y-5">
              <section className="space-y-2">
                <h2 className="label-mono text-label">Current output</h2>
                {activeJob ? (
                  <div className="rounded-lg border border-border bg-bg/60 p-2.5">
                    <p className="text-small font-semibold text-fg">
                      {activeJob.status === "RUNNING"
                        ? `Sampling ${activeJob.progressStep} / ${activeJob.progressMax}`
                        : activeJob.status === "PROCESSING_OUTPUT"
                          ? "Finalizing output"
                          : activeJob.status === "QUEUED"
                            ? "Queued"
                            : "Submitting"}
                    </p>
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-subtle">
                      <div
                        className="h-full bg-accent transition-[width] duration-200 ease-out"
                        style={{ width: `${Math.max(3, progressPercent)}%` }}
                      />
                    </div>
                    <p className="mt-2 line-clamp-3 text-caption font-normal text-fg-subtle">
                      {activeJob.prompt}
                    </p>
                  </div>
                ) : latestImage ? (
                  <>
                    <button
                      type="button"
                      onClick={() => onInspectImage(latestImage)}
                      className="block w-full overflow-hidden rounded-lg border border-border transition-colors hover:border-accent"
                    >
                      <MediaImage
                        src={toMediaUrl(latestImage.filePath)}
                        alt={latestImage.prompt}
                        className="w-full object-contain"
                      />
                    </button>
                    <p className="line-clamp-3 text-small text-fg">
                      {latestImage.prompt}
                    </p>
                    <dl className="space-y-1">
                      {[
                        {
                          k: "Dimensions",
                          v: `${latestImage.width}×${latestImage.height}`,
                        },
                        { k: "Seed", v: String(latestImage.seed) },
                        {
                          k: "Checkpoint",
                          v: getModelRefDisplayName(models, latestImage.checkpoint),
                        },
                        { k: "Sampler", v: latestImage.sampler },
                        { k: "Steps", v: String(latestImage.steps) },
                        { k: "CFG", v: String(latestImage.cfg) },
                      ].map((row) => (
                        <div
                          key={row.k}
                          className="flex items-baseline justify-between gap-2"
                        >
                          <dt className="text-caption font-normal text-fg-subtle">
                            {row.k}
                          </dt>
                          <dd className="truncate text-right font-mono text-tech text-fg-muted">
                            {row.v}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </>
                ) : (
                  <p className="text-small text-fg-subtle">
                    Nothing rendered yet. Your latest result appears here.
                  </p>
                )}
              </section>

              <section className="space-y-1.5">
                <h2 className="label-mono text-label">Pre-flight</h2>
                {blockingErrors.length === 0 && warnings.length === 0 ? (
                  <p className="font-mono text-tech tabular-nums text-fg-muted">
                    Ready · {draft.width}×{draft.height} ·{" "}
                    {draft.steps} steps · seed{" "}
                    {draft.randomSeed ? "random" : draft.seed}
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {promptPending && (
                      <li className="text-caption font-normal text-fg-subtle">
                        Waiting for a prompt.
                      </li>
                    )}
                    {visibleBlockingErrors.map((issue, index) => (
                      <li
                        key={`err-${index}`}
                        className="flex items-start gap-1.5 text-caption font-normal text-danger"
                      >
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        {issue.message}
                      </li>
                    ))}
                    {warnings.map((issue, index) => (
                      <li
                        key={`warn-${index}`}
                        className="flex items-start gap-1.5 text-caption font-normal text-warning"
                      >
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        {issue.message}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {draft.mode !== "upscale" && (
                <section className="space-y-2 border-t border-divider pt-4">
                  <h2 className="label-mono text-label">Next render</h2>
                  <dl className="space-y-1">
                    {[
                      { k: "Workflow", v: activeWorkflow?.name ?? "—" },
                      {
                        k: "Checkpoint",
                        v: draft.checkpoint
                          ? getModelRefDisplayName(models, draft.checkpoint)
                          : "None",
                      },
                      {
                        k: "VAE",
                        v:
                          !draft.vae || draft.vae === VAE_AUTO
                            ? `Auto${
                                autoVaeName
                                  ? ` · ${getModelRefDisplayName(models, autoVaeName)}`
                                  : ""
                              }`
                            : draft.vae === "embedded"
                              ? "Embedded"
                              : getModelRefDisplayName(models, draft.vae),
                      },
                      { k: "Sampler", v: `${draft.sampler} · ${draft.scheduler}` },
                      { k: "Steps / CFG", v: `${draft.steps} · ${draft.cfg}` },
                      { k: "Size", v: `${draft.width}×${draft.height}` },
                      ...(draft.mode === "img2img"
                        ? [{ k: "Denoise", v: draft.denoise.toFixed(2) }]
                        : []),
                      { k: "Batch", v: `${draft.batchCount}×` },
                      {
                        k: "High-res fix",
                        v: hiresConfig.enabled
                          ? `${hiresConfig.scale}× · ${hiresConfig.steps} steps`
                          : "Off",
                      },
                    ].map((row) => (
                      <div
                        key={row.k}
                        className="flex items-baseline justify-between gap-2"
                      >
                        <dt className="shrink-0 text-caption font-normal text-fg-subtle">
                          {row.k}
                        </dt>
                        <dd
                          title={row.v}
                          className="truncate text-right font-mono text-tech text-fg-muted"
                        >
                          {row.v}
                        </dd>
                      </div>
                    ))}
                  </dl>

                  <div className="space-y-1 pt-1">
                    <p className="text-caption font-normal text-fg-subtle">
                      LoRA stack ({draft.loras.length})
                    </p>
                    {draft.loras.length === 0 ? (
                      <p className="text-caption font-normal text-fg-subtle">
                        No adapters. Add LoRAs from the settings panel.
                      </p>
                    ) : (
                      <ul className="space-y-1">
                        {draft.loras.map((lora) => (
                          <li
                            key={lora.name}
                            className="flex items-baseline justify-between gap-2 rounded-md border border-border bg-bg/60 px-2 py-1"
                          >
                            <span
                              title={lora.name}
                              className="truncate text-caption font-normal text-fg"
                            >
                              {getModelRefDisplayName(models, lora.name)}
                            </span>
                            <span className="shrink-0 font-mono text-tech tabular-nums text-fg-muted">
                              {lora.strengthModel.toFixed(2)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </section>
              )}
            </div>
          ) : (
            <section className="space-y-2">
              <h2 className="label-mono text-label">Library</h2>
              {images.length === 0 ? (
                <p className="text-small text-fg-subtle">
                  Finished renders collect here.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-1.5">
                  {images.slice(0, 18).map((img) => (
                    <button
                      key={img.id}
                      type="button"
                      onClick={() => onInspectImage(img)}
                      className="aspect-square overflow-hidden rounded-md border border-border transition-colors hover:border-accent flex items-center justify-center bg-surface-subtle p-0.5"
                    >
                      <MediaImage
                        src={toMediaUrl(img.filePath)}
                        alt={img.prompt}
                        loading="lazy"
                        compact
                        className="h-full w-full bg-surface-subtle object-contain"
                      />
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </aside>
    </>
  );
};
