import React, { useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  FolderOpen,
  Heart,
  ImagePlus,
  Sparkles,
  Square,
  Users,
  Wand2,
  X,
} from "lucide-react";
import { ASPECT_RATIOS } from "../../shared/aspect-ratios";
import { PROMPT_SNIPPETS, STUDIO_PRESETS } from "../../shared/presets";
import type {
  CharacterProfile,
  GeneratedImageRecord,
  GenerationJob,
  GenerationRequest,
  LoraRecipe,
  RuntimeState,
  ValidationIssue,
} from "../../shared/types";
import { Button } from "../components/ui/Primitives";
import { MediaImage } from "../components/ui/MediaImage";
import { shortModelLabel, toMediaUrl } from "../utils/format";

interface CreateCreativeModeProps {
  draft: GenerationRequest;
  setDraft: React.Dispatch<React.SetStateAction<GenerationRequest>>;
  runtime: RuntimeState;
  images: GeneratedImageRecord[];
  activeJob: GenerationJob | null;
  progressPercent: number;
  submitting: boolean;
  blockingErrors: ValidationIssue[];
  /** Blocking errors worth showing now (hides the untouched empty-prompt case). */
  visibleBlockingErrors: ValidationIssue[];
  /** True while the prompt is empty and the user has not interacted with it yet. */
  promptPending: boolean;
  onRevealPromptErrors: () => void;
  warnings: ValidationIssue[];
  checkpointOptions: { path: string; label: string }[];
  activeCharacter: CharacterProfile | null;
  activeRecipe: LoraRecipe | null;
  onSelectCharacter: (characterId: string | null) => void;
  onOpenCharacters: () => void;
  onSelectRecipe: (recipeId: string | null) => void;
  onCheckpointChange: (relPath: string) => void;
  onAspectChange: (ratioId: string) => void;
  onPickReference: () => void;
  onClearReference: () => void;
  onGenerate: () => void;
  onCancel: () => void;
  onInspectImage: (img: GeneratedImageRecord) => void;
  onToggleFavorite: (id: string) => void;
}

export const CreateCreativeMode: React.FC<CreateCreativeModeProps> = ({
  draft,
  setDraft,
  runtime,
  images,
  activeJob,
  progressPercent,
  submitting,
  blockingErrors,
  visibleBlockingErrors,
  promptPending,
  onRevealPromptErrors,
  warnings,
  checkpointOptions,
  activeCharacter,
  activeRecipe,
  onSelectCharacter,
  onOpenCharacters,
  onSelectRecipe,
  onCheckpointChange,
  onAspectChange,
  onPickReference,
  onClearReference,
  onGenerate,
  onCancel,
  onInspectImage,
  onToggleFavorite,
}) => {
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [showNegative, setShowNegative] = useState(false);
  const threadImages = images.slice(0, 10);
  const characterAvatar = activeCharacter?.references[0]?.filePath;
  const hasReference = draft.mode === "img2img" && Boolean(draft.inputImagePath);
  const engineOnline = runtime.status === "connected";

  const applyStarterBrief = (preset: (typeof STUDIO_PRESETS)[number]): void => {
    onAspectChange(preset.aspectRatio);
    setDraft((prev) => ({
      ...prev,
      prompt: preset.prompt,
      negativePrompt: preset.negativePrompt,
      steps: preset.steps,
      cfg: preset.cfg,
    }));
    promptRef.current?.focus();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-surface">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[980px] px-6 py-6">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-h2 text-fg">Studio thread</h2>
            <span className="font-mono text-tech tabular-nums text-fg-subtle">
              {images.length} render{images.length === 1 ? "" : "s"} ·{" "}
              {shortModelLabel(draft.checkpoint)}
            </span>
          </div>

          {activeJob && (
            <div className="mt-4 rounded-xl border border-border bg-bg/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 text-small font-semibold text-fg">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
                  {activeJob.status === "QUEUED"
                    ? "Queued in ComfyUI"
                    : activeJob.status === "SUBMITTING"
                      ? "Submitting graph"
                      : activeJob.status === "PROCESSING_OUTPUT"
                        ? "Finalizing and embedding metadata"
                        : `Sampling ${activeJob.progressStep} of ${activeJob.progressMax}`}
                </span>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-tech tabular-nums text-accent">
                    {progressPercent}%
                  </span>
                  <Button size="sm" variant="danger" onClick={onCancel}>
                    <Square className="h-3 w-3 fill-current" />
                    Cancel
                  </Button>
                </div>
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-subtle">
                <div
                  className="h-full bg-accent transition-[width] duration-200 ease-out"
                  style={{ width: `${Math.max(3, progressPercent)}%` }}
                />
              </div>
              <div className="mt-3 flex items-center gap-3">
                {activeJob.previewDataUrl ? (
                  <img
                    src={activeJob.previewDataUrl}
                    alt="Live inference preview"
                    className="h-24 w-24 rounded-lg border border-border object-cover"
                  />
                ) : null}
                <p className="min-w-0 flex-1 truncate text-caption font-normal text-fg-subtle">
                  {activeJob.prompt}
                </p>
              </div>
            </div>
          )}

          {threadImages.length === 0 ? (
            <div className="mt-6 rounded-xl border border-dashed border-border px-6 py-8">
              <p className="max-w-[52ch] text-body text-fg">
                Nothing briefed yet. Describe the render in the composer below;
                Kirea keeps the prompt, seed, and model attached to the result.
              </p>
              <div className="mt-5 space-y-2">
                <p className="text-caption text-fg-subtle">Start from a recipe</p>
                <div className="flex flex-wrap gap-2">
                  {STUDIO_PRESETS.slice(0, 3).map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => applyStarterBrief(preset)}
                      className="group inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-small text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
                    >
                      {preset.title}
                      <ArrowRight className="h-3.5 w-3.5 text-fg-subtle transition-colors group-hover:text-accent" />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <ol className="mt-4 divide-y divide-divider">
              {threadImages.map((img) => (
                <li
                  key={img.id}
                  className="grid gap-4 py-5 sm:grid-cols-[176px_minmax(0,1fr)]"
                >
                  <button
                    type="button"
                    onClick={() => onInspectImage(img)}
                    className="group block aspect-square overflow-hidden rounded-lg border border-border bg-bg transition-colors hover:border-accent"
                  >
                    <MediaImage
                      src={toMediaUrl(img.filePath)}
                      alt={img.prompt}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  </button>

                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-tech tabular-nums text-fg-subtle">
                      <span>
                        {new Date(img.createdAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <span>
                        {img.width}×{img.height}
                      </span>
                      <span>seed {img.seed}</span>
                      {img.favorite && (
                        <span className="inline-flex items-center gap-1 text-danger">
                          <Heart className="h-3 w-3 fill-current" />
                          kept
                        </span>
                      )}
                    </div>

                    <p className="mt-1.5 text-body leading-relaxed text-fg line-clamp-3">
                      {img.prompt || "Untitled brief"}
                    </p>

                    <p className="mt-1.5 truncate text-caption font-normal text-fg-subtle">
                      {shortModelLabel(img.checkpoint)} · {img.sampler} ·{" "}
                      {img.steps} steps · cfg {img.cfg}
                    </p>

                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => onInspectImage(img)}
                      >
                        Inspect
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onToggleFavorite(img.id)}
                        aria-label={
                          img.favorite
                            ? "Remove from favorites"
                            : "Add to favorites"
                        }
                      >
                        <Heart
                          className={`h-3.5 w-3.5 ${
                            img.favorite ? "fill-danger text-danger" : ""
                          }`}
                        />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void window.kirea.openPath(img.filePath)}
                        aria-label="Show file on disk"
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-border bg-surface-elevated">
        <div className="mx-auto w-full max-w-[980px] space-y-2.5 px-6 py-4">
          {(activeCharacter || hasReference || activeRecipe) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {activeCharacter && (
                <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-surface pl-1 pr-1.5 text-caption font-semibold text-fg">
                  {characterAvatar ? (
                    <img
                      src={toMediaUrl(characterAvatar)}
                      alt=""
                      className="h-5 w-5 rounded-full object-cover"
                    />
                  ) : (
                    <Users className="ml-1 h-3.5 w-3.5 text-fg-subtle" />
                  )}
                  {activeCharacter.name}
                  <button
                    type="button"
                    onClick={() => onSelectCharacter(null)}
                    aria-label={`Remove ${activeCharacter.name} from this brief`}
                    className="rounded-full p-0.5 text-fg-subtle transition-colors hover:text-fg"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
              {hasReference && draft.inputImagePath && (
                <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-surface pl-1 pr-1.5 text-caption font-semibold text-fg">
                  <img
                    src={toMediaUrl(draft.inputImagePath)}
                    alt=""
                    className="h-5 w-5 rounded-full object-cover"
                  />
                  Reference · denoise {draft.denoise.toFixed(2)}
                  <button
                    type="button"
                    onClick={onClearReference}
                    aria-label="Remove reference image"
                    className="rounded-full p-0.5 text-fg-subtle transition-colors hover:text-fg"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
              {activeRecipe && (
                <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-surface pl-2.5 pr-1.5 text-caption font-semibold text-fg">
                  Recipe · {activeRecipe.name}
                  <button
                    type="button"
                    onClick={() => onSelectRecipe(null)}
                    aria-label={`Detach recipe ${activeRecipe.name}`}
                    className="rounded-full p-0.5 text-fg-subtle transition-colors hover:text-fg"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
            </div>
          )}

          <div className="rounded-xl border border-border bg-surface transition-colors focus-within:border-accent">
            <label htmlFor="creative-brief" className="sr-only">
              Brief for this render
            </label>
            <textarea
              id="creative-brief"
              ref={promptRef}
              rows={3}
              value={draft.prompt}
              onChange={(e) =>
                setDraft((p) => ({ ...p, prompt: e.target.value }))
              }
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  if (blockingErrors.length > 0) onRevealPromptErrors();
                  else if (!submitting) onGenerate();
                }
              }}
              placeholder="Brief the render: subject, light, lens, materials, mood..."
              className="w-full resize-none bg-transparent px-3.5 pt-3 text-body text-fg placeholder:text-fg-subtle"
            />

            <div className="flex flex-wrap items-center gap-2 border-t border-border px-2.5 py-2">
              <label className="sr-only" htmlFor="creative-checkpoint">
                Checkpoint
              </label>
              <select
                id="creative-checkpoint"
                value={draft.checkpoint}
                onChange={(e) => onCheckpointChange(e.target.value)}
                className="h-7 max-w-[200px] rounded-md border border-transparent bg-transparent px-2 font-mono text-tech text-fg-muted transition-colors hover:border-border focus:border-border-strong"
              >
                {checkpointOptions.map((option) => (
                  <option key={option.path} value={option.path}>
                    {option.label}
                  </option>
                ))}
              </select>

              <span aria-hidden="true" className="h-4 w-px bg-border" />

              <label className="sr-only" htmlFor="creative-aspect">
                Aspect ratio
              </label>
              <select
                id="creative-aspect"
                value={draft.aspectRatio}
                onChange={(e) => onAspectChange(e.target.value)}
                className="h-7 rounded-md border border-transparent bg-transparent px-2 font-mono text-tech text-fg-muted transition-colors hover:border-border focus:border-border-strong"
              >
                {ASPECT_RATIOS.map((ratio) => (
                  <option key={ratio.id} value={ratio.id}>
                    {ratio.id} · {ratio.label.split(" ")[1] ?? ""}
                  </option>
                ))}
              </select>

              <span className="font-mono text-tech tabular-nums text-fg-subtle">
                {draft.width}×{draft.height}
              </span>

              <span aria-hidden="true" className="h-4 w-px bg-border" />

              <Button size="sm" variant="ghost" onClick={onOpenCharacters}>
                <Users className="h-3.5 w-3.5" />
                Character
              </Button>
              <Button size="sm" variant="ghost" onClick={onPickReference}>
                <ImagePlus className="h-3.5 w-3.5" />
                Reference
              </Button>

              <div className="ml-auto flex items-center gap-2">
                <label className="sr-only" htmlFor="creative-batch">
                  Images per brief
                </label>
                <select
                  id="creative-batch"
                  value={draft.batchCount}
                  onChange={(e) =>
                    setDraft((p) => ({
                      ...p,
                      batchCount: Number(e.target.value),
                    }))
                  }
                  className="h-7 rounded-md border border-transparent bg-transparent px-2 font-mono text-tech text-fg-muted transition-colors hover:border-border focus:border-border-strong"
                >
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      {n} img
                    </option>
                  ))}
                </select>

                <Button
                  variant="accent"
                  size="md"
                  loading={submitting}
                  disabled={blockingErrors.length > 0}
                  onClick={onGenerate}
                >
                  <Sparkles className="h-4 w-4" />
                  {activeJob ? "Queue another" : "Generate"}
                </Button>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <button
                type="button"
                aria-expanded={showNegative}
                onClick={() => setShowNegative((open) => !open)}
                className="cursor-pointer text-caption font-normal text-fg-subtle transition-colors hover:text-fg-muted"
              >
                Negative prompt
                {draft.negativePrompt.trim() ? " · set" : ""}
              </button>

              <div className="flex flex-wrap items-center gap-1.5">
                {PROMPT_SNIPPETS.slice(0, 3).map((snippet) => (
                  <button
                    key={snippet.label}
                    type="button"
                    onClick={() =>
                      setDraft((p) => ({
                        ...p,
                        prompt: p.prompt.trim()
                          ? `${p.prompt.trim()}, ${snippet.text}`
                          : snippet.text,
                      }))
                    }
                    className="rounded-full border border-border px-2.5 py-1 text-caption font-normal text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
                  >
                    + {snippet.label}
                  </button>
                ))}
              </div>

              <span className="ml-auto inline-flex items-center gap-2 text-caption font-normal text-fg-subtle">
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 rounded-full ${
                    engineOnline ? "bg-success" : "bg-warning"
                  }`}
                />
                {engineOnline ? "Engine online" : "Engine idle"} · Ctrl+Enter to
                generate
              </span>
            </div>

            {showNegative && (
              <textarea
                rows={2}
                aria-label="Negative prompt"
                value={draft.negativePrompt}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, negativePrompt: e.target.value }))
                }
                placeholder="blurry, artifacts, bad anatomy, text..."
                className="w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-small text-fg-muted placeholder:text-fg-subtle focus:border-border-strong"
              />
            )}
          </div>

          {(visibleBlockingErrors.length > 0 ||
            warnings.length > 0 ||
            promptPending) && (
            <div className="space-y-1">
              {visibleBlockingErrors.slice(0, 2).map((issue, index) => (
                <p
                  key={`err-${index}`}
                  role="alert"
                  className="inline-flex items-center gap-1.5 rounded-md bg-danger-soft px-2 py-1 text-caption font-normal text-danger"
                >
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  {issue.message}
                </p>
              ))}
              {visibleBlockingErrors.length === 0 &&
                warnings.slice(0, 1).map((issue, index) => (
                  <p
                    key={`warn-${index}`}
                    className="inline-flex items-center gap-1.5 rounded-md bg-warning-soft px-2 py-1 text-caption font-normal text-warning"
                  >
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    {issue.message}
                  </p>
                ))}
              {visibleBlockingErrors.length === 0 && promptPending && (
                <p className="text-caption font-normal text-fg-subtle">
                  Write a brief to enable Generate.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
