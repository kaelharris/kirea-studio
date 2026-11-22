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

export const CreateModals: React.FC<{ ctrl: CreateController }> = ({ ctrl }) => {
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
    warnings,
    progressPercent,
  } = ctrl;

  return (
    <>
      <Modal
        open={loraPickerOpen}
        onClose={() => setLoraPickerOpen(false)}
        title="Add LoRA Adapter"
        maxWidthClass="max-w-xl"
      >
        <div className="space-y-3">
          <Input
            value={loraSearch}
            onChange={(e) => setLoraSearch(e.target.value)}
            aria-label="Search LoRAs"
            placeholder="Search LoRAs by name, trigger word, or architecture..."
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-fg-subtle">
              Current base: {ARCHITECTURE_LABELS[currentArch]}. Only compatible
              adapters are listed.
            </p>
            <label className="flex items-center gap-1.5 text-[11px] text-fg-muted cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={showIncompatibleLoras}
                onChange={(e) => setShowIncompatibleLoras(e.target.checked)}
                className="accent-accent"
              />
              Show incompatible
            </label>
          </div>

          <div className="max-h-[52vh] overflow-y-auto space-y-1.5 pr-1">
            {filteredLoraModels.length === 0 ? (
              <div className="py-8 text-center text-xs text-fg-subtle border border-dashed border-border rounded-xl">
                No compatible LoRA files discovered. Enable "Show incompatible"
                to browse every installed adapter.
              </div>
            ) : (
              filteredLoraModels.map((lora) => {
                const info = getEffectiveModelInfo(lora);
                const alreadyAdded = draft.loras.some(
                  (sel) => sel.name === lora.relativePath
                );
                const compatibility = evaluateLoraCompatibility(
                  info.architecture,
                  currentArch
                );
                const mismatched = !compatibility.compatible;
                const atCapacity =
                  draft.loras.length >= (activeWorkflow?.maxLoras ?? 4);

                return (
                  <div
                    key={lora.id}
                    className="flex items-center gap-2.5 p-2 rounded-xl bg-bg border border-border"
                  >
                    {info.previewPath && (
                      <div className="w-10 shrink-0">
                        <ModelPreview
                          model={lora}
                          className="h-10 rounded-lg"
                          iconSizeClass="w-3 h-3"
                        />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-semibold text-fg truncate">
                          {info.name}
                        </span>
                        <Badge tone={architectureBadgeTone(info.architecture)}>
                          {ARCHITECTURE_LABELS[info.architecture]}
                        </Badge>
                        {mismatched && <Badge tone="warning">Incompatible</Badge>}
                      </div>
                      {info.triggerWords.length > 0 && (
                        <p className="text-[11px] text-fg-subtle truncate mt-0.5">
                          Triggers: {info.triggerWords.slice(0, 4).join(", ")}
                        </p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant={alreadyAdded ? "ghost" : "secondary"}
                      disabled={alreadyAdded || atCapacity}
                      onClick={() => handleAddLora(lora.relativePath)}
                    >
                      {alreadyAdded ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          Added
                        </>
                      ) : (
                        <>
                          <Plus className="w-3.5 h-3.5" />
                          Add
                        </>
                      )}
                    </Button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </Modal>

      {/* SAVE / UPDATE RECIPE */}
      <Modal
        open={recipeModalOpen}
        onClose={() => {
          if (!savingRecipe) setRecipeModalOpen(false);
        }}
        title={activeRecipe ? "Update LoRA Recipe" : "Save LoRA Recipe"}
        maxWidthClass="max-w-md"
      >
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-[11px] text-fg-subtle">Recipe Name</label>
            <Input
              value={recipeName}
              onChange={(e) => setRecipeName(e.target.value)}
              placeholder="e.g. Neon Noir Portrait"
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] text-fg-subtle">
              Description (optional)
            </label>
            <Textarea
              rows={2}
              value={recipeDescription}
              onChange={(e) => setRecipeDescription(e.target.value)}
              placeholder="What does this stack achieve?"
            />
          </div>

          <div className="p-3 rounded-xl bg-bg border border-border space-y-1 text-[11px] text-fg-muted">
            <div className="flex items-center justify-between gap-2">
              <span className="text-fg-subtle">Checkpoint</span>
              <span className="text-fg truncate">
                {currentCheckpointInfo?.name ??
                  getModelRefDisplayName(models, draft.checkpoint)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-fg-subtle">Architecture</span>
              <span className="text-fg">{ARCHITECTURE_LABELS[currentArch]}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-fg-subtle">LoRA Stack</span>
              <span className="text-fg">
                {draft.loras.length} adapter
                {draft.loras.length === 1 ? "" : "s"}
              </span>
            </div>
          </div>

          {loraWarnings.length > 0 && (
            <p className="text-[11px] text-warning flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              {loraWarnings.length} adapter
              {loraWarnings.length === 1 ? " is" : "s are"} incompatible with{" "}
              {ARCHITECTURE_LABELS[currentArch]}. Generation will be blocked
              until they are removed.
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              variant="secondary"
              onClick={() => setRecipeModalOpen(false)}
              disabled={savingRecipe}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={savingRecipe}
              disabled={!recipeName.trim()}
              onClick={() => void handleSaveRecipe()}
            >
              <BookmarkPlus className="w-3.5 h-3.5" />
              {activeRecipe ? "Update Recipe" : "Save Recipe"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};
