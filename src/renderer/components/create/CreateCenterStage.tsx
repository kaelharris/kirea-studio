import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  BookmarkPlus,
  Brush,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  Dices,
  Eraser,
  Expand,
  FolderOpen,
  Heart,
  History,
  Image as ImageIcon,
  ImagePlus,
  Layers,
  LayoutGrid,
  Lightbulb,
  List,
  Lock,
  Maximize2,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Square,
  Tags,
  Trash2,
  Unlock,
  Upload,
  Users,
  Wand2,
} from "lucide-react";
import { CopyPromptButton } from "../CopyPromptButton";
import { ReticleCornerBrackets } from "../BrandIcons";
import {
  ASPECT_RATIOS,
  IMAGE_UPSCALER_LANCZOS,
  LATENT_UPSCALER_BICUBIC,
  LATENT_UPSCALER_BISLERP,
} from "../../../shared/aspect-ratios";
import { PROMPT_SNIPPETS, STUDIO_PRESETS } from "../../../shared/presets";
import { imageWorkflowLabel } from "../../../shared/image-labels";
import type {
  GeneratedImageRecord,
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
  ConfirmDialog,
  Input,
  Modal,
  Select,
  SliderField,
  Textarea,
  useContextMenu,
  type ContextMenuItem,
} from "../ui/Primitives";
import { MediaImage } from "../ui/MediaImage";
import { ComparisonSlider } from "../ui/ComparisonSlider";
import { toMediaUrl } from "../../utils/format";
import { describeUpscalerLabel } from "./create-helpers";
import { CompactPromptComposer } from "./CompactPromptComposer";
import { WorkflowSelector } from "./WorkflowSelector";
import { EditingCanvas } from "./EditingCanvas";
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
    jobs,
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
    onDeleteImage,
    onDeleteJob,
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
    workflowMode,
    setWorkflowMode,
    handleSelectWorkflowMode,
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

  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [showCanvasComparison, setShowCanvasComparison] = useState(false);
  const [resultsView, setResultsView] = useState<"canvas" | "history" | "inspiration">(
    "canvas"
  );
  const [resultSearch, setResultSearch] = useState("");
  const [resultFilter, setResultFilter] = useState<"all" | "kept" | "upscaled">("all");
  const [resultLayout, setResultLayout] = useState<"grid" | "list">("grid");
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<{
    type: "job" | "image";
    id: string;
    label: string;
  } | null>(null);

  const failedJob = useMemo(() => {
    if (!jobs || jobs.length === 0) return null;
    const latestImageTime = images[0] ? new Date(images[0].createdAt).getTime() : 0;
    return (
      jobs.find((j) => {
        if (j.status !== "FAILED") return false;
        if (j.startupInterrupted) return false;
        if (j.errorMessage?.includes("Interrupted when application previously")) return false;
        if (latestImageTime && new Date(j.submittedAt).getTime() <= latestImageTime) {
          return false;
        }
        return true;
      }) ?? null
    );
  }, [jobs, images]);

  // When latestImage updates (new generation arrives) or activeJob starts, ALWAYS reset comparison mode
  useEffect(() => {
    setSelectedImageId(null);
    setShowCanvasComparison(false);
  }, [latestImage?.id]);

  useEffect(() => {
    if (activeJob) {
      setShowCanvasComparison(false);
    }
  }, [activeJob?.id]);

  // Reset comparison mode when switching workflow or draft mode
  useEffect(() => {
    setShowCanvasComparison(false);
  }, [workflowMode, draft.mode]);

  const displayedImage =
    (selectedImageId ? images.find((img) => img.id === selectedImageId) : null) ??
    latestImage;

  const displayedIndex = displayedImage
    ? images.findIndex((img) => img.id === displayedImage.id)
    : -1;
  const hasMultipleImages = images.length > 1 && displayedIndex !== -1;

  const goToPrevImage = useCallback(() => {
    if (!hasMultipleImages) return;
    const prevIndex = (displayedIndex - 1 + images.length) % images.length;
    const target = images[prevIndex];
    if (target) {
      setSelectedImageId(target.id);
      setShowCanvasComparison(false);
    }
  }, [hasMultipleImages, displayedIndex, images]);

  const goToNextImage = useCallback(() => {
    if (!hasMultipleImages) return;
    const nextIndex = (displayedIndex + 1) % images.length;
    const target = images[nextIndex];
    if (target) {
      setSelectedImageId(target.id);
      setShowCanvasComparison(false);
    }
  }, [hasMultipleImages, displayedIndex, images]);

  // Keyboard navigation & deletion when user is not focused on an input/textarea
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goToPrevImage();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goToNextImage();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (deleteConfirmTarget) return;
        if (failedJob && !activeJob) {
          e.preventDefault();
          setDeleteConfirmTarget({
            type: "job",
            id: failedJob.id,
            label: failedJob.prompt
              ? `Failed Generation: "${failedJob.prompt.slice(0, 36)}..."`
              : `Failed Generation #${failedJob.id.slice(0, 8)}`,
          });
        } else if (displayedImage) {
          e.preventDefault();
          setDeleteConfirmTarget({
            type: "image",
            id: displayedImage.id,
            label: `Generation (${displayedImage.width}×${displayedImage.height}, Seed ${displayedImage.seed})`,
          });
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goToPrevImage, goToNextImage, deleteConfirmTarget, failedJob, activeJob, displayedImage]);

  // Determine if comparison is possible for the currently displayed image
  const canvasSourcePath =
    displayedImage?.sourceImagePath ||
    (draft.mode === "upscale" && displayedImage?.mode === "upscale" && draft.inputImagePath
      ? draft.inputImagePath
      : null);
  const canCompare = Boolean(canvasSourcePath && displayedImage);

  const { showContextMenu } = useContextMenu();

  const handleImageContextMenu = useCallback(
    (e: React.MouseEvent, img: GeneratedImageRecord) => {
      e.preventDefault();
      e.stopPropagation();

      const items: ContextMenuItem[] = [
        {
          id: "preview-open",
          label: "Open Fullscreen Lightbox",
          icon: <Maximize2 className="w-3.5 h-3.5" />,
          onClick: () => onInspectImage(img, images),
          separator: true,
        },
        {
          id: "send-edit",
          label: "Send to Edit / Img2Img",
          icon: <Wand2 className="w-3.5 h-3.5" />,
          onClick: () => handleSelectWorkflowMode("edit", img),
        },
        {
          id: "send-inpaint",
          label: "Send to Inpaint (Brush Mask)",
          icon: <Brush className="w-3.5 h-3.5" />,
          onClick: () => handleSelectWorkflowMode("inpaint", img),
        },
        {
          id: "send-outpaint",
          label: "Send to Outpaint (Expand Canvas)",
          icon: <Expand className="w-3.5 h-3.5" />,
          onClick: () => handleSelectWorkflowMode("outpaint", img),
        },
        {
          id: "send-variations",
          label: "Generate Variations",
          icon: <Layers className="w-3.5 h-3.5" />,
          onClick: () => handleSelectWorkflowMode("variations", img),
        },
        {
          id: "send-upscale",
          label: "Send to AI Upscale (4×)",
          icon: <Maximize2 className="w-3.5 h-3.5" />,
          onClick: () => handleSelectWorkflowMode("upscale", img),
          separator: true,
        },
        {
          id: "lock-seed",
          label: `Lock Seed (${img.seed})`,
          icon: <Lock className="w-3.5 h-3.5" />,
          onClick: () => {
            setDraft((p) => ({ ...p, randomSeed: false, seed: img.seed }));
            onToast?.(`Seed ${img.seed} locked.`);
          },
        },
        {
          id: "toggle-fav",
          label: img.favorite ? "Remove from Favorites" : "Add to Favorites",
          icon: <Heart className="w-3.5 h-3.5" />,
          onClick: () => void onToggleFavorite(img.id),
        },
        {
          id: "copy-path",
          label: "Copy Image Path",
          icon: <Copy className="w-3.5 h-3.5" />,
          onClick: () => {
            void navigator.clipboard.writeText(img.filePath);
            onToast?.("Image path copied to clipboard.");
          },
        },
        {
          id: "copy-prompt",
          label: "Copy Prompt",
          icon: <Copy className="w-3.5 h-3.5" />,
          onClick: () => {
            void navigator.clipboard.writeText(img.prompt);
            onToast?.("Prompt copied to clipboard.");
          },
        },
        {
          id: "reveal-folder",
          label: "Reveal in File Explorer",
          icon: <FolderOpen className="w-3.5 h-3.5" />,
          onClick: () => void window.kirea.openPath(img.filePath),
        },
        {
          id: "delete-generation",
          label: "Delete Generation",
          icon: <Trash2 className="w-3.5 h-3.5 text-danger" />,
          destructive: true,
          separator: true,
          onClick: () => {
            setDeleteConfirmTarget({
              type: "image",
              id: img.id,
              label: `Generation (${img.width}×${img.height}, Seed ${img.seed})`,
            });
          },
        },
      ];

      showContextMenu({
        x: e.clientX,
        y: e.clientY,
        title: "Generated Image",
        items,
      });
    },
    [images, onInspectImage, handleSelectWorkflowMode, setDraft, onToggleFavorite, onToast, showContextMenu]
  );

  const handleEmptyCanvasContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const items: ContextMenuItem[] = [
        {
          id: "empty-load-image",
          label: "Import / Pick Source Image...",
          icon: <Upload className="w-3.5 h-3.5" />,
          onClick: () => {
            void window.kirea.pickImage().then((res) => {
              if (res) {
                setDraft((p) => ({ ...p, inputImagePath: res }));
                onToast?.("Source image loaded.");
              }
            });
          },
        },
      ];

      if (images.length > 0) {
        const latest = images[0];
        if (latest) {
          items.push({
            id: "empty-restore-recent",
            label: "Load Most Recent Generation",
            icon: <Sparkles className="w-3.5 h-3.5" />,
            onClick: () => {
              setDraft((p) => ({ ...p, inputImagePath: latest.filePath }));
              onToast?.("Loaded latest generation.");
            },
          });
        }
      }

      if (images.length > 0) {
        items.push({
          id: "empty-browse-library",
          label: "Browse Recent Generation Lightbox",
          icon: <ImageIcon className="w-3.5 h-3.5" />,
          onClick: () => {
            const first = images[0];
            if (first) onInspectImage(first, images);
          },
        });
      }

      showContextMenu({
        x: e.clientX,
        y: e.clientY,
        title: "Creation Canvas",
        items,
      });
    },
    [images, setDraft, onToast, onInspectImage, showContextMenu]
  );

  const filteredHistory = (() => {
    const query = resultSearch.trim().toLowerCase();
    return images.filter((img) => {
      if (resultFilter === "kept" && !img.favorite) return false;
      if (
        resultFilter === "upscaled" &&
        imageWorkflowLabel(img).label !== "Upscaled"
      ) {
        return false;
      }
      if (!query) return true;
      return [
        img.prompt,
        img.fileName,
        img.checkpoint,
        img.workflowId,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  })();

  return (
    <>
      {/* CENTER CANVAS + PROMPT DOCK */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        {draft.mode === "upscale" ? (
          <div className="shrink-0 space-y-3 border-b border-border bg-bg px-2.5 py-2.5">
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
          <CompactPromptComposer
            prompt={draft.prompt}
            negativePrompt={draft.negativePrompt}
            onPromptChange={(newPrompt) =>
              setDraft((p) => ({ ...p, prompt: newPrompt }))
            }
            onNegativePromptChange={(newNegative) =>
              setDraft((p) => ({ ...p, negativePrompt: newNegative }))
            }
            onGenerate={() => void handleGenerate()}
            onCancel={
              activeJob
                ? () => void window.kirea.cancelJob(activeJob.id)
                : undefined
            }
            submitting={submitting}
            blockingErrors={blockingErrors}
            warnings={warnings}
            architecture={currentArch}
            onSavePrompt={() => {
              const title =
                draft.prompt.trim().slice(0, 40) || "Studio Prompt";
              void onSavePrompt({
                title,
                prompt: draft.prompt,
                negativePrompt: draft.negativePrompt,
              }).then(() => onToast("Saved prompt to library."));
            }}
            onToast={onToast}
            isEngineOnline={runtime.status === "connected"}
            activeJob={Boolean(activeJob)}
          />
        )}

        {/* Results Workspace Toolbar */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-surface px-2.5 py-2">
          <WorkflowSelector
            currentMode={workflowMode}
            onSelectMode={(mode) => handleSelectWorkflowMode(mode, displayedImage)}
            hasSourceImage={Boolean(draft.inputImagePath || displayedImage)}
            modelArch={currentArch}
          />

          <div
            role="tablist"
            aria-label="Results workspace view"
            className="inline-flex rounded-lg border border-border bg-bg p-0.5 ml-auto"
          >
            {(
              [
                { id: "canvas", label: "Canvas", icon: <Sparkles className="w-3.5 h-3.5" /> },
                { id: "history", label: "History", icon: <History className="w-3.5 h-3.5" /> },
                { id: "inspiration", label: "Inspiration", icon: <Lightbulb className="w-3.5 h-3.5" /> },
              ] as const
            ).map((view) => (
              <button
                key={view.id}
                type="button"
                role="tab"
                aria-selected={resultsView === view.id}
                onClick={() => setResultsView(view.id)}
                className={`inline-flex items-center gap-1.5 h-7 rounded-md px-2.5 text-[11px] font-semibold transition-colors cursor-pointer ${
                  resultsView === view.id
                    ? "bg-accent-solid text-accent-fg"
                    : "text-fg-muted hover:text-fg"
                }`}
              >
                {view.icon}
                {view.label}
              </button>
            ))}
          </div>

          {resultsView === "history" && (
            <div className="flex shrink-0 flex-nowrap items-center gap-1.5">
              <div className="relative w-52">
                <Search className="w-3.5 h-3.5 text-fg-subtle absolute left-2.5 top-2" />
                <Input
                  value={resultSearch}
                  onChange={(e) => setResultSearch(e.target.value)}
                  placeholder="Search history..."
                  aria-label="Search generation history"
                  className="h-8 pl-8 text-xs"
                />
              </div>
              <div className="w-32 shrink-0">
                <Select
                  value={resultFilter}
                  onChange={(e) =>
                    setResultFilter(e.target.value as "all" | "kept" | "upscaled")
                  }
                  aria-label="Filter history"
                  className="h-8 w-full text-xs"
                >
                  <option value="all">All renders</option>
                  <option value="kept">Kept</option>
                  <option value="upscaled">Upscaled</option>
                </Select>
              </div>
              <div className="inline-flex rounded-md border border-border bg-bg p-0.5">
                <button
                  type="button"
                  aria-label="Grid layout"
                  aria-pressed={resultLayout === "grid"}
                  onClick={() => setResultLayout("grid")}
                  className={`p-1 rounded ${resultLayout === "grid" ? "bg-surface-subtle text-fg" : "text-fg-subtle hover:text-fg"}`}
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="List layout"
                  aria-pressed={resultLayout === "list"}
                  onClick={() => setResultLayout("list")}
                  className={`p-1 rounded ${resultLayout === "list" ? "bg-surface-subtle text-fg" : "text-fg-subtle hover:text-fg"}`}
                >
                  <List className="w-3.5 h-3.5" />
                </button>
              </div>
              <span className="text-[11px] text-fg-subtle tabular-nums">
                {filteredHistory.length} of {images.length}
              </span>
            </div>
          )}
        </div>

        {/* Live Canvas / Result Stage */}
        <div className="order-1 flex min-h-0 flex-1 flex-col overflow-hidden bg-bg">
          {resultsView === "history" ? (
            <div className="flex-1 min-h-0 overflow-y-auto p-3">
              {filteredHistory.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center gap-2 p-8 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-surface-subtle text-fg-muted">
                    <History className="w-5 h-5" />
                  </div>
                  <h3 className="text-sm font-semibold text-fg">
                    {images.length === 0 ? "No renders yet" : "No renders matched"}
                  </h3>
                  <p className="text-xs text-fg-muted max-w-sm">
                    {images.length === 0
                      ? "Generated images appear here with their persisted operation and settings."
                      : "Adjust the search or filter to see more of your history."}
                  </p>
                </div>
              ) : (
                <div
                  className={
                    resultLayout === "grid"
                      ? "grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(170px,1fr))]"
                      : "flex flex-col gap-2"
                  }
                >
                  {filteredHistory.map((img) => {
                    const label = imageWorkflowLabel(img);
                    if (resultLayout === "list") {
                      return (
                        <button
                          key={img.id}
                          type="button"
                          onClick={() => {
                            setSelectedImageId(img.id);
                            setResultsView("canvas");
                          }}
                          onDoubleClick={() => onInspectImage(img, filteredHistory)}
                          className="flex items-center gap-3 rounded-lg border border-border bg-bg p-2 text-left hover:border-accent transition-colors cursor-pointer"
                        >
                          <span className="w-14 h-16 shrink-0 rounded-md bg-well p-0.5 flex items-center justify-center overflow-hidden">
                            <MediaImage
                              src={toMediaUrl(img.filePath)}
                              alt={img.fileName}
                              compact
                              className="w-full h-full bg-surface-subtle object-contain"
                            />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                              <Badge tone={label.tone}>{label.label}</Badge>
                              <span className="font-mono text-[10px] text-fg-subtle tabular-nums">
                                {img.width}×{img.height}
                              </span>
                            </span>
                            <span className="mt-1 block text-xs text-fg line-clamp-1">
                              {img.prompt || "Untitled render"}
                            </span>
                            <span className="mt-0.5 block text-[10px] text-fg-subtle tabular-nums">
                              {new Date(img.createdAt).toLocaleString()} · seed {img.seed}
                            </span>
                          </span>
                        </button>
                      );
                    }
                    return (
                      <button
                        key={img.id}
                        type="button"
                        onClick={() => {
                          setSelectedImageId(img.id);
                          setResultsView("canvas");
                        }}
                        onDoubleClick={() => onInspectImage(img, filteredHistory)}
                        className="group flex flex-col self-start overflow-hidden rounded-lg border border-border bg-bg text-left hover:border-accent transition-colors cursor-pointer"
                      >
                        <span className="relative flex aspect-[2/3] w-full items-center justify-center bg-well p-1.5 overflow-hidden">
                          <MediaImage
                            src={toMediaUrl(img.filePath)}
                            alt={img.fileName}
                            loading="lazy"
                            compact
                            className="w-full h-full bg-surface-subtle object-contain"
                          />
                          <span className="absolute top-1.5 left-1.5 flex flex-wrap gap-1">
                            <Badge tone={label.tone}>{label.label}</Badge>
                          </span>
                          {img.favorite && (
                            <span className="absolute top-1.5 right-1.5 p-1 rounded-full bg-black/50">
                              <Heart className="w-3 h-3 fill-danger text-danger" />
                            </span>
                          )}
                        </span>
                        <span className="p-2">
                          <span className="block text-[11px] text-fg line-clamp-2 leading-snug">
                            {img.prompt || "Untitled render"}
                          </span>
                          <span className="mt-1 block font-mono text-[10px] text-fg-subtle tabular-nums">
                            {img.width}×{img.height} · seed {img.seed}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : resultsView === "inspiration" ? (
            <div className="flex-1 min-h-0 overflow-y-auto p-3">
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
                {STUDIO_PRESETS.map((preset) => (
                  <div
                    key={preset.id}
                    className="flex flex-col gap-2 rounded-lg border border-border bg-bg p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-xs font-semibold text-fg truncate">
                        {preset.title}
                      </h3>
                      <Badge tone="neutral">{preset.aspectRatio}</Badge>
                    </div>
                    <p className="text-[11px] text-fg-muted line-clamp-4 leading-relaxed">
                      {preset.prompt}
                    </p>
                    <div className="mt-auto flex items-center justify-between pt-1">
                      <span className="font-mono text-[10px] text-fg-subtle">
                        {preset.steps} steps · cfg {preset.cfg}
                      </span>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          handleAspectChange(preset.aspectRatio);
                          setDraft((prev) => ({
                            ...prev,
                            prompt: preset.prompt,
                            negativePrompt: preset.negativePrompt,
                            steps: preset.steps,
                            cfg: preset.cfg,
                          }));
                          setResultsView("canvas");
                          onToast("Inspiration brief applied.");
                        }}
                      >
                        <Wand2 className="w-3.5 h-3.5" />
                        Use brief
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
          <>
          {failedJob && !activeJob && (
            <div className="mx-3 mt-3 px-3 py-2 bg-danger/10 border-2 border-danger/40 rounded-lg flex items-center justify-between gap-3 text-xs shrink-0 shadow-[2px_2px_0px_#0B0C10]">
              <div className="flex items-center gap-2 min-w-0">
                <AlertTriangle className="w-4 h-4 text-danger shrink-0" />
                <span className="font-semibold text-danger truncate font-mono">
                  Generation failed: {failedJob.errorMessage || "ComfyUI execution error"}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void window.kirea.retryJob(failedJob.id)}
                  className="font-mono text-xs uppercase"
                >
                  <RotateCcw className="w-3.5 h-3.5 mr-1" />
                  Retry
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    setDeleteConfirmTarget({
                      type: "job",
                      id: failedJob.id,
                      label: failedJob.prompt
                        ? `Failed Generation: "${failedJob.prompt.slice(0, 36)}..."`
                        : `Failed Generation #${failedJob.id.slice(0, 8)}`,
                    });
                  }}
                  className="font-mono text-xs uppercase"
                  title="Delete failed generation (Delete key)"
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1" />
                  Delete
                </Button>
              </div>
            </div>
          )}
          {activeJob ? (
            <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-6 gap-4 bg-bg/60">
              {activeJob.previewDataUrl ? (
                <img
                  src={activeJob.previewDataUrl}
                  alt="Live inference preview"
                  className="max-h-[min(68vh,720px)] w-auto max-w-full rounded-xl border border-border-strong object-contain shadow-[var(--shadow-float)]"
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
                    {getModelRefDisplayName(models, activeJob.checkpoint)}
                  </p>
                )}
              </div>
            </div>
          ) : displayedImage ? (
            <div className="flex-1 min-h-0 flex flex-col">
              <div
                className="flex-1 min-h-0 bg-well flex items-center justify-center p-1 sm:p-2 overflow-hidden relative group"
                onContextMenu={(e) => {
                  if (workflowMode !== "inpaint" && workflowMode !== "outpaint") {
                    handleImageContextMenu(e, displayedImage);
                  }
                }}
              >
                <ReticleCornerBrackets />
                {workflowMode === "inpaint" || workflowMode === "outpaint" ? (
                  <EditingCanvas
                    imageSrc={draft.inputImagePath || displayedImage.filePath}
                    sourceImagePath={displayedImage.filePath}
                    mode={workflowMode}
                    width={displayedImage.width}
                    height={displayedImage.height}
                    onMaskChange={ctrl.handleMaskChange}
                    onOutpaintParamsChange={ctrl.handleOutpaintParamsChange}
                    onFullscreen={() => onInspectImage(displayedImage, images)}
                    canCompare={canCompare}
                  />
                ) : showCanvasComparison && canCompare && canvasSourcePath ? (
                  <div className="w-full h-full flex items-center justify-center">
                    <ComparisonSlider
                      beforeSrc={toMediaUrl(canvasSourcePath)}
                      afterSrc={toMediaUrl(displayedImage.filePath)}
                      beforeLabel={displayedImage.mode === "upscale" ? "Input / Original" : "Original"}
                      afterLabel={displayedImage.mode === "upscale" ? "AI Upscaled (4×)" : "Output"}
                      className="w-full h-full max-h-full"
                    />
                  </div>
                ) : (
                  <MediaImage
                    src={toMediaUrl(displayedImage.filePath)}
                    alt={displayedImage.prompt}
                    onClick={() => onInspectImage(displayedImage, images)}
                    className="max-h-full max-w-full cursor-zoom-in rounded-lg object-contain shadow-[var(--shadow-float)] transition-transform duration-200"
                  />
                )}

                {/* Floating Navigation Controls on Canvas */}
                {hasMultipleImages && (
                  <>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        goToPrevImage();
                      }}
                      className="absolute left-3 top-1/2 -translate-y-1/2 p-2.5 rounded-full bg-black/60 hover:bg-black/85 text-white/90 hover:text-white border border-white/20 backdrop-blur-md opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all cursor-pointer shadow-lg z-10"
                      title="Previous Generation (ArrowLeft ←)"
                      aria-label="Previous generation"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        goToNextImage();
                      }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-2.5 rounded-full bg-black/60 hover:bg-black/85 text-white/90 hover:text-white border border-white/20 backdrop-blur-md opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all cursor-pointer shadow-lg z-10"
                      title="Next Generation (ArrowRight →)"
                      aria-label="Next generation"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </>
                )}

                {/* Top Overlays on Canvas: Index badge + Quick actions */}
                <div className="absolute top-3 left-3 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
                  {hasMultipleImages && (
                    <span className="font-mono text-xs font-semibold px-2.5 py-1 rounded-full bg-black/60 text-white/90 backdrop-blur-md border border-white/15 tabular-nums">
                      {displayedIndex + 1} / {images.length}
                    </span>
                  )}
                </div>

              </div>

              {/* Bottom Stage Action Row */}
              <div className="px-4 py-2 border-t border-border bg-surface-elevated flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-3 min-w-0">
                  <Badge
                    tone={imageWorkflowLabel(displayedImage).tone}
                    className="shrink-0"
                  >
                    {imageWorkflowLabel(displayedImage).label}
                  </Badge>
                  <Badge tone="neutral" className="tabular-nums">
                    {displayedImage.width}×{displayedImage.height}
                  </Badge>
                  <span className="text-fg-muted tabular-nums">
                    Seed {displayedImage.seed}
                  </span>
                  <CopyPromptButton
                    prompt={displayedImage.prompt}
                    negativePrompt={displayedImage.negativePrompt}
                    seed={displayedImage.seed}
                    steps={displayedImage.steps}
                    cfg={displayedImage.cfg}
                    sampler={displayedImage.sampler}
                    checkpoint={displayedImage.checkpoint}
                    loras={displayedImage.loras}
                    width={displayedImage.width}
                    height={displayedImage.height}
                    onToast={onToast}
                  />
                  <span className="text-fg-subtle truncate max-w-md">
                    {getModelRefDisplayName(models, displayedImage.checkpoint)} • {displayedImage.sampler}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  {canCompare && (
                    <Button
                      size="sm"
                      variant={showCanvasComparison ? "accent" : "ghost"}
                      onClick={() => setShowCanvasComparison((p) => !p)}
                      title="Toggle Before / After Comparison Slider"
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">
                        {showCanvasComparison ? "Exit Compare" : "Compare"}
                      </span>
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant={workflowMode === "inpaint" ? "accent" : "ghost"}
                    onClick={() => handleSelectWorkflowMode("inpaint", displayedImage)}
                    title="Inpaint / Regenerate brushed area"
                  >
                    <Brush className="w-3.5 h-3.5" />
                    <span className="hidden xl:inline">Inpaint</span>
                  </Button>
                  <Button
                    size="sm"
                    variant={workflowMode === "outpaint" ? "accent" : "ghost"}
                    onClick={() => handleSelectWorkflowMode("outpaint", displayedImage)}
                    title="Outpaint / Extend canvas boundaries"
                  >
                    <Expand className="w-3.5 h-3.5" />
                    <span className="hidden xl:inline">Outpaint</span>
                  </Button>
                  <Button
                    size="sm"
                    variant={workflowMode === "variations" ? "accent" : "ghost"}
                    onClick={() => handleSelectWorkflowMode("variations", displayedImage)}
                    title="Generate aesthetic variations with randomized seed"
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span className="hidden xl:inline">Variations</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleSelectWorkflowMode("upscale", displayedImage)}
                    title="Send this image to 4× AI Upscale"
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Upscale</span>
                  </Button>
                  <Button
                    size="sm"
                    variant={!draft.randomSeed && draft.seed === displayedImage.seed ? "accent" : "ghost"}
                    onClick={() => {
                      if (!draft.randomSeed && draft.seed === displayedImage.seed) {
                        setDraft((p) => ({ ...p, randomSeed: true, seed: -1 }));
                        onToast("Seed unlocked (random on next render).");
                      } else {
                        setDraft((p) => ({
                          ...p,
                          randomSeed: false,
                          seed: displayedImage.seed,
                        }));
                        onToast(`Seed locked to ${displayedImage.seed}.`);
                      }
                    }}
                    title={
                      !draft.randomSeed && draft.seed === displayedImage.seed
                        ? "Seed is locked to this image. Click to randomize."
                        : "Lock draft to reuse this exact seed"
                    }
                  >
                    {!draft.randomSeed && draft.seed === displayedImage.seed ? (
                      <>
                        <Lock className="w-3.5 h-3.5 mr-1" strokeWidth={2} />
                        [SEED LOCKED]
                      </>
                    ) : (
                      <>
                        <Unlock className="w-3.5 h-3.5 mr-1" strokeWidth={2} />
                        Lock Seed
                      </>
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void onToggleFavorite(displayedImage.id)}
                  >
                    <Heart
                      className={`w-3.5 h-3.5 ${
                        displayedImage.favorite ? "fill-danger text-danger" : ""
                      }`}
                    />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void window.kirea.openPath(displayedImage.filePath)}
                    title="Reveal in file explorer"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-danger hover:bg-danger/10 hover:text-danger"
                    onClick={() => {
                      setDeleteConfirmTarget({
                        type: "image",
                        id: displayedImage.id,
                        label: `Generation (${displayedImage.width}×${displayedImage.height}, Seed ${displayedImage.seed})`,
                      });
                    }}
                    title="Delete generation (Delete key)"
                    aria-label="Delete generation"
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1" />
                    <span className="hidden xl:inline">Delete</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => onInspectImage(displayedImage, images)}
                  >
                    Fullscreen
                  </Button>
                </div>
              </div>
            </div>
          ) : workflowMode !== "generate" ? (
            <div
              onContextMenu={handleEmptyCanvasContextMenu}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
              }}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files[0];
                if (file) {
                  const filePath = (file as any).path || (window.URL && URL.createObjectURL(file));
                  if (filePath) {
                    setDraft((p) => ({ ...p, inputImagePath: filePath }));
                  }
                }
              }}
              className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-bg/40 m-4 rounded-2xl border-2 border-dashed border-border hover:border-accent/60 transition-colors"
            >
              <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-surface-subtle shadow-sm">
                {workflowMode === "inpaint" ? (
                  <Brush className="w-8 h-8 text-creative" />
                ) : workflowMode === "outpaint" ? (
                  <Expand className="w-8 h-8 text-creative" />
                ) : workflowMode === "variations" ? (
                  <Layers className="w-8 h-8 text-accent" />
                ) : workflowMode === "upscale" ? (
                  <Maximize2 className="w-8 h-8 text-accent" />
                ) : (
                  <Pencil className="w-8 h-8 text-accent" />
                )}
              </div>
              <h3 className="text-base font-semibold text-fg">
                Drop or browse a source image to begin{" "}
                {workflowMode === "inpaint"
                  ? "Inpainting"
                  : workflowMode === "outpaint"
                    ? "Outpainting"
                    : workflowMode === "variations"
                      ? "Variations"
                      : workflowMode === "upscale"
                        ? "Upscaling"
                        : "Edit"}
              </h3>
              <p className="mt-1 text-xs text-fg-muted max-w-md leading-relaxed">
                {workflowMode === "inpaint"
                  ? "Draw a mask over the canvas to replace objects, repair hands, or edit clothing."
                  : workflowMode === "outpaint"
                    ? "Expand canvas boundaries outward to reveal wider backgrounds and cinematic scenery."
                    : workflowMode === "variations"
                      ? "Generate stylized variations of an existing image with randomized seeds."
                      : workflowMode === "upscale"
                        ? "Enlarge images up to 4× with neural super-resolution and Alchemy Refiner."
                        : "Guide generation using an initial image and denoise strength."}
              </p>
              <div className="mt-4 flex items-center gap-2">
                <Button
                  variant="primary"
                  size="md"
                  onClick={() => void handlePickInputImage()}
                >
                  <ImagePlus className="w-4 h-4" />
                  Browse Image File
                </Button>
              </div>

              {images.length > 0 && (
                <div className="mt-6 pt-5 border-t border-border/60 w-full max-w-lg space-y-2.5">
                  <p className="text-[11px] font-semibold text-fg-subtle uppercase tracking-wider">
                    Or select from recent generations
                  </p>
                  <div className="flex items-center justify-center gap-2 overflow-x-auto p-1">
                    {images.slice(0, 5).map((img) => (
                      <button
                        key={img.id}
                        type="button"
                        onClick={() => {
                          setDraft((p) => ({ ...p, inputImagePath: img.filePath }));
                          setSelectedImageId(img.id);
                        }}
                        title={`Use ${img.width}×${img.height} as source`}
                        className="w-14 h-14 rounded-lg overflow-hidden border border-border hover:border-accent hover:ring-2 hover:ring-accent/40 bg-surface-subtle transition-all cursor-pointer p-0.5 shrink-0"
                      >
                        <MediaImage
                          src={toMediaUrl(img.filePath)}
                          alt={img.fileName}
                          compact
                          className="w-full h-full object-cover rounded-md"
                        />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : failedJob ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-bg/40">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-danger/40 bg-danger/10 text-danger shadow-[4px_4px_0px_#0B0C10]">
                <AlertTriangle className="w-8 h-8" />
              </div>
              <h3 className="text-base font-bold text-fg uppercase tracking-wide">
                Generation Failed
              </h3>
              <p className="mt-1 text-xs text-danger max-w-md font-mono line-clamp-3">
                {failedJob.errorMessage || "ComfyUI execution error occurred during rendering."}
              </p>
              {failedJob.prompt && (
                <p className="mt-2 text-[11px] text-fg-subtle max-w-md truncate font-mono">
                  Brief: {failedJob.prompt}
                </p>
              )}
              <div className="mt-5 flex items-center gap-3">
                <Button
                  size="md"
                  variant="secondary"
                  onClick={() => void window.kirea.retryJob(failedJob.id)}
                  className="font-mono text-xs uppercase"
                >
                  <RotateCcw className="w-3.5 h-3.5 mr-1" />
                  Retry Generation
                </Button>
                <Button
                  size="md"
                  variant="danger"
                  onClick={() => {
                    setDeleteConfirmTarget({
                      type: "job",
                      id: failedJob.id,
                      label: failedJob.prompt
                        ? `Failed Generation: "${failedJob.prompt.slice(0, 36)}..."`
                        : `Failed Generation #${failedJob.id.slice(0, 8)}`,
                    });
                  }}
                  className="font-mono text-xs uppercase"
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1" />
                  Delete Failed Generation
                </Button>
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
                Pick a checkpoint on the left, write the brief in the prompt composer
                below, and click <span className="text-fg font-medium">Generate Image</span>{" "}
                to render locally through ComfyUI.
              </p>
            </div>
          )}

          {/* Bottom Recent Strip */}
          {images.length > 0 && (
            <div className="p-2 border-t border-border bg-surface-elevated flex items-center gap-2 overflow-x-auto">
              <span className="text-[11px] font-semibold text-fg-subtle px-1 shrink-0">
                Recent
              </span>
              {images.slice(0, 16).map((img) => {
                const isSelected = img.id === displayedImage?.id;
                return (
                  <div key={img.id} className="relative shrink-0 group/thumb">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedImageId(img.id);
                        setShowCanvasComparison(false);
                      }}
                      onDoubleClick={() => onInspectImage(img, images.slice(0, 16))}
                      onContextMenu={(e) => handleImageContextMenu(e, img)}
                      title={`View ${img.width}×${img.height} (Double-click to expand)`}
                      className={`w-12 h-12 rounded-none overflow-hidden border-2 shrink-0 cursor-pointer transition-all flex items-center justify-center bg-surface-subtle p-0.5 ${
                        isSelected
                          ? "border-[#1E3BFF] ring-2 ring-[#1E3BFF]/50 shadow-sm"
                          : "border-border hover:border-[#F2F2EE]"
                      }`}
                    >
                      <MediaImage
                        src={toMediaUrl(img.filePath)}
                        alt={img.fileName}
                        compact
                        className="w-full h-full bg-surface-subtle object-contain"
                      />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteConfirmTarget({
                          type: "image",
                          id: img.id,
                          label: `Generation (${img.width}×${img.height}, Seed ${img.seed})`,
                        });
                      }}
                      className="absolute top-0.5 left-0.5 p-0.5 bg-[#0B0C10]/80 text-[#F2F2EE]/70 hover:text-danger border border-[#F2F2EE]/20 opacity-0 group-hover/thumb:opacity-100 transition-opacity z-10 cursor-pointer"
                      title="Delete this generation"
                      aria-label="Delete generation"
                    >
                      <Trash2 className="w-2.5 h-2.5" />
                    </button>
                    <div className="opacity-0 group-hover/thumb:opacity-100 focus-within:opacity-100 transition-opacity">
                      <CopyPromptButton
                        variant="filmstrip"
                        prompt={img.prompt}
                        negativePrompt={img.negativePrompt}
                        seed={img.seed}
                        steps={img.steps}
                        cfg={img.cfg}
                        sampler={img.sampler}
                        checkpoint={img.checkpoint}
                        loras={img.loras}
                        width={img.width}
                        height={img.height}
                        onToast={onToast}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(deleteConfirmTarget)}
        onClose={() => setDeleteConfirmTarget(null)}
        onConfirm={() => {
          if (!deleteConfirmTarget) return;
          if (deleteConfirmTarget.type === "job") {
            if (onDeleteJob) {
              void onDeleteJob(deleteConfirmTarget.id);
            } else {
              void window.kirea.deleteJob(deleteConfirmTarget.id);
            }
            onToast?.("Failed generation deleted.");
          } else {
            if (onDeleteImage) {
              void onDeleteImage(deleteConfirmTarget.id);
            } else {
              void window.kirea.deleteImage(deleteConfirmTarget.id);
            }
            onToast?.("Generation deleted.");
          }
          setDeleteConfirmTarget(null);
        }}
        title="Delete Generation?"
        description={`Are you sure you want to delete ${deleteConfirmTarget?.label ?? "this generation"}? This action cannot be undone.`}
        confirmLabel="Yes, Delete"
        danger
        defaultFocusConfirm
      />
    </>
  );
};
