import React from "react";
import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { Button } from "../components/ui/Primitives";
import { CreateCreativeMode } from "./CreateCreativeMode";
import type { CreatePageProps } from "../components/create/create-helpers";
import { CreateCenterStage } from "../components/create/CreateCenterStage";
import { CreateGenerationSidebar } from "../components/create/CreateGenerationSidebar";
import { CreateModals } from "../components/create/CreateModals";
import { CreateRightInspector } from "../components/create/CreateRightInspector";
import { CreateUpscaleSidebar } from "../components/create/CreateUpscaleSidebar";
import { useCreateController } from "../components/create/useCreateController";

export const CreatePage: React.FC<CreatePageProps> = (props) => {
  const ctrl = useCreateController(props);
  const {
    draft,
    setDraft,
    runtime,
    images,
    onSelectCharacter,
    onOpenCharacters,
    onSelectRecipe,
    onInspectImage,
    onToggleFavorite,
    submitting,
    uiMode,
    setUiMode,
    leftPanelOpen,
    setLeftPanelOpen,
    inspectorOpen,
    setInspectorOpen,
    activeRecipe,
    activeJob,
    activeCharacter,
    handleModeSwitch,
    handleCheckpointChange,
    handleAspectChange,
    handlePickReference,
    handleClearReference,
    checkpointOptions,
    handleGenerate,
    blockingErrors,
    visibleBlockingErrors,
    promptPending,
    revealPromptErrors,
    warnings,
    progressPercent,
  } = ctrl;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5">
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-h1 text-fg">Create</h1>
          <p className="mt-0.5 text-small text-fg-muted">
            {uiMode === "creative"
              ? "Brief the render in plain language; every setting stays in sync with Advanced."
              : "Every parameter exposed — checkpoint, prompt, sampler, and output."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {uiMode === "advanced" && (
            <>
              <Button
                size="sm"
                variant={leftPanelOpen ? "secondary" : "ghost"}
                aria-pressed={leftPanelOpen}
                onClick={() => setLeftPanelOpen((open) => !open)}
              >
                {leftPanelOpen ? (
                  <PanelLeftClose className="h-3.5 w-3.5" />
                ) : (
                  <PanelLeftOpen className="h-3.5 w-3.5" />
                )}
                Settings
              </Button>
              <Button
                size="sm"
                variant={inspectorOpen ? "creative" : "secondary"}
                aria-pressed={inspectorOpen}
                aria-expanded={inspectorOpen}
                onClick={() => setInspectorOpen((open) => !open)}
              >
                {inspectorOpen ? (
                  <PanelRightClose className="h-3.5 w-3.5" />
                ) : (
                  <PanelRightOpen className="h-3.5 w-3.5" />
                )}
                Inspector
              </Button>
            </>
          )}

          <div
            role="tablist"
            aria-label="Create workspace mode"
            className="inline-flex rounded-lg border border-border bg-surface p-0.5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={uiMode === "creative"}
              onClick={() => setUiMode("creative")}
              className={`h-7 rounded-md px-3 text-small font-semibold transition-colors ${
                uiMode === "creative"
                  ? "bg-accent-solid text-accent-fg"
                  : "text-fg-muted hover:text-fg"
              }`}
            >
              Creative
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={uiMode === "advanced"}
              onClick={() => setUiMode("advanced")}
              className={`h-7 rounded-md px-3 text-small font-semibold transition-colors ${
                uiMode === "advanced"
                  ? "bg-accent-solid text-accent-fg"
                  : "text-fg-muted hover:text-fg"
              }`}
            >
              Advanced
            </button>
          </div>
        </div>
      </div>

      {uiMode === "creative" ? (
        <CreateCreativeMode
          draft={draft}
          setDraft={setDraft}
          runtime={runtime}
          images={images}
          activeJob={activeJob}
          progressPercent={progressPercent}
          submitting={submitting}
          blockingErrors={blockingErrors}
          visibleBlockingErrors={visibleBlockingErrors}
          promptPending={promptPending}
          onRevealPromptErrors={revealPromptErrors}
          warnings={warnings}
          checkpointOptions={checkpointOptions}
          activeCharacter={activeCharacter}
          activeRecipe={activeRecipe}
          onSelectCharacter={onSelectCharacter}
          onOpenCharacters={onOpenCharacters}
          onSelectRecipe={onSelectRecipe}
          onCheckpointChange={handleCheckpointChange}
          onAspectChange={handleAspectChange}
          onPickReference={() => void handlePickReference()}
          onClearReference={handleClearReference}
          onGenerate={() => void handleGenerate()}
          onCancel={() => {
            if (activeJob) void window.kirea.cancelJob(activeJob.id);
          }}
          onInspectImage={onInspectImage}
          onToggleFavorite={(id) => void onToggleFavorite(id)}
          onDeleteImage={props.onDeleteImage}
          onDeleteJob={props.onDeleteJob}
          jobs={props.jobs}
          onToast={props.onToast}
        />
      ) : (
      <div className="flex min-h-0 flex-1 gap-0">
      {/* LEFT PARAMETER INSPECTOR */}
      <div
        className={`hidden shrink-0 flex-col overflow-hidden border-r bg-bg lg:flex ${
          leftPanelOpen
            ? "w-[300px] min-[2200px]:w-[340px] border-border"
            : "w-0 border-transparent"
        }`}
      >
        <div className="border-b border-border bg-surface-elevated p-2">
          <div className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-bg p-1">
            <button
              type="button"
              onClick={() => handleModeSwitch("txt2img")}
              className={`h-8 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                draft.mode === "txt2img"
                  ? "bg-accent-solid text-accent-fg"
                  : "text-fg-muted hover:text-fg"
              }`}
            >
              Text to Image
            </button>
            <button
              type="button"
              onClick={() => handleModeSwitch("img2img")}
              className={`h-8 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                draft.mode === "img2img"
                  ? "bg-accent-solid text-accent-fg"
                  : "text-fg-muted hover:text-fg"
              }`}
            >
              Image to Image
            </button>
            <button
              type="button"
              onClick={() => handleModeSwitch("upscale")}
              className={`h-8 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                draft.mode === "upscale"
                  ? "bg-accent-solid text-accent-fg"
                  : "text-fg-muted hover:text-fg"
              }`}
            >
              Upscale
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2.5 space-y-3">
          {draft.mode === "upscale" ? (
            <CreateUpscaleSidebar ctrl={ctrl} />
          ) : (
            <CreateGenerationSidebar ctrl={ctrl} />
          )}
        </div>
      </div>

      <CreateCenterStage ctrl={ctrl} />
      <CreateRightInspector ctrl={ctrl} />
      </div>
      )}

      <CreateModals ctrl={ctrl} />
    </div>
  );
};
