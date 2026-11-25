import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  FolderOpen,
  Heart,
  ImagePlus,
  RotateCcw,
  Sparkles,
  Square,
  Trash2,
  Users,
  Wand2,
  X,
  Eraser,
  Copy,
  Maximize2,
  BookmarkPlus,
  FolderOpen as FolderIcon,
} from "lucide-react";
import {
  ASPECT_RATIOS,
  CUSTOM_ASPECT_ID,
  formatAspectRatio,
  inferModelArchitecture,
} from "../../shared/aspect-ratios";
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
import {
  Badge,
  Button,
  ConfirmDialog,
  isInteractiveKeyboardTarget,
  useContextMenu,
  type ContextMenuItem,
} from "../components/ui/Primitives";
import { imageWorkflowLabel } from "../../shared/image-labels";
import { MediaImage } from "../components/ui/MediaImage";
import { MagicPromptModal } from "../components/create/MagicPromptModal";
import { shortModelLabel, toMediaUrl } from "../utils/format";

export function shouldHandleGenerationDeleteKey(
  event: Pick<
    KeyboardEvent,
    "key" | "ctrlKey" | "altKey" | "metaKey" | "repeat" | "defaultPrevented"
  >,
  target: unknown,
  confirmationOpen: boolean
): boolean {
  return (
    !confirmationOpen &&
    !event.defaultPrevented &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    !event.repeat &&
    (event.key === "Delete" || event.key === "Backspace") &&
    !isInteractiveKeyboardTarget(target)
  );
}

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
  jobs?: GenerationJob[];
  onDeleteImage?: (id: string) => Promise<void> | void;
  onDeleteJob?: (jobId: string) => Promise<void> | void;
  onToast?: (msg: string, tone?: "info" | "error") => void;
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
  jobs,
  onDeleteImage,
  onDeleteJob,
  onToast,
}) => {
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [showNegative, setShowNegative] = useState(false);
  const [magicModalOpen, setMagicModalOpen] = useState(false);
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<{
    type: "job" | "image";
    id: string;
    label: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);

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
  const { showContextMenu } = useContextMenu();

  const handlePromptContextMenu = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const textarea = promptRef.current;
    const selectedText = textarea
      ? textarea.value.substring(textarea.selectionStart, textarea.selectionEnd)
      : "";
    const hasSelection = selectedText.length > 0;

    const items: ContextMenuItem[] = [
      {
        id: "prompt-undo",
        label: "Undo",
        shortcut: "Ctrl+Z",
        onClick: () => {
          document.execCommand("undo");
        },
      },
      {
        id: "prompt-redo",
        label: "Redo",
        shortcut: "Ctrl+Y",
        onClick: () => {
          document.execCommand("redo");
        },
        separator: true,
      },
      {
        id: "prompt-cut",
        label: "Cut",
        shortcut: "Ctrl+X",
        disabled: !hasSelection,
        disabledReason: "No text selected",
        onClick: () => {
          if (!textarea) return;
          const start = textarea.selectionStart;
          const end = textarea.selectionEnd;
          void navigator.clipboard.writeText(selectedText).catch(() => {});
          const nextVal = textarea.value.substring(0, start) + textarea.value.substring(end);
          setDraft((p) => ({ ...p, prompt: nextVal }));
        },
      },
      {
        id: "prompt-copy",
        label: hasSelection ? "Copy Selection" : "Copy Entire Prompt",
        shortcut: "Ctrl+C",
        disabled: !draft.prompt,
        disabledReason: "Prompt is empty",
        onClick: () => {
          const textToCopy = hasSelection ? selectedText : draft.prompt;
          void navigator.clipboard.writeText(textToCopy).catch(() => {});
        },
      },
      {
        id: "prompt-paste",
        label: "Paste",
        shortcut: "Ctrl+V",
        onClick: () => {
          void navigator.clipboard
            .readText()
            .then((clipText) => {
              if (!clipText || !textarea) return;
              const start = textarea.selectionStart;
              const end = textarea.selectionEnd;
              const nextVal = textarea.value.substring(0, start) + clipText + textarea.value.substring(end);
              setDraft((p) => ({ ...p, prompt: nextVal }));
            })
            .catch(() => {});
        },
      },
      {
        id: "prompt-select-all",
        label: "Select All",
        shortcut: "Ctrl+A",
        onClick: () => {
          textarea?.select();
        },
        separator: true,
      },
      {
        id: "prompt-magic",
        label: "Magic Prompt Enhancement...",
        icon: <Wand2 className="w-3.5 h-3.5 text-accent" />,
        onClick: () => setMagicModalOpen(true),
      },
      {
        id: "prompt-snippets",
        label: "Append Snippet",
        icon: <Sparkles className="w-3.5 h-3.5 text-creative" />,
        children: PROMPT_SNIPPETS.map((snip, idx) => ({
          id: `snippet-${idx}`,
          label: snip.label,
          onClick: () => {
            setDraft((p) => ({
              ...p,
              prompt: p.prompt.trim() ? `${p.prompt.trim()}, ${snip.text}` : snip.text,
            }));
          },
        })),
        separator: true,
      },
      {
        id: "prompt-clear",
        label: "Clear Prompt",
        icon: <Eraser className="w-3.5 h-3.5" />,
        disabled: !draft.prompt,
        disabledReason: "Prompt is empty",
        destructive: true,
        onClick: () => setDraft((p) => ({ ...p, prompt: "" })),
      },
    ];

    showContextMenu({
      x: e.clientX,
      y: e.clientY,
      title: "Prompt Composer",
      items,
    });
  };

  const handleNegativePromptContextMenu = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const target = e.currentTarget;
    const selectedText = target.value.substring(target.selectionStart, target.selectionEnd);
    const hasSelection = selectedText.length > 0;

    const items: ContextMenuItem[] = [
      {
        id: "neg-undo",
        label: "Undo",
        shortcut: "Ctrl+Z",
        onClick: () => {
          document.execCommand("undo");
        },
      },
      {
        id: "neg-redo",
        label: "Redo",
        shortcut: "Ctrl+Y",
        onClick: () => {
          document.execCommand("redo");
        },
        separator: true,
      },
      {
        id: "neg-cut",
        label: "Cut",
        shortcut: "Ctrl+X",
        disabled: !hasSelection,
        disabledReason: "No text selected",
        onClick: () => {
          const start = target.selectionStart;
          const end = target.selectionEnd;
          void navigator.clipboard.writeText(selectedText).catch(() => {});
          const nextVal = target.value.substring(0, start) + target.value.substring(end);
          setDraft((p) => ({ ...p, negativePrompt: nextVal }));
        },
      },
      {
        id: "neg-copy",
        label: hasSelection ? "Copy Selection" : "Copy Entire Negative Prompt",
        shortcut: "Ctrl+C",
        disabled: !draft.negativePrompt,
        disabledReason: "Negative prompt is empty",
        onClick: () => {
          const textToCopy = hasSelection ? selectedText : draft.negativePrompt;
          void navigator.clipboard.writeText(textToCopy).catch(() => {});
        },
      },
      {
        id: "neg-paste",
        label: "Paste",
        shortcut: "Ctrl+V",
        onClick: () => {
          void navigator.clipboard
            .readText()
            .then((clipText) => {
              if (!clipText) return;
              const start = target.selectionStart;
              const end = target.selectionEnd;
              const nextVal = target.value.substring(0, start) + clipText + target.value.substring(end);
              setDraft((p) => ({ ...p, negativePrompt: nextVal }));
            })
            .catch(() => {});
        },
      },
      {
        id: "neg-select-all",
        label: "Select All",
        shortcut: "Ctrl+A",
        onClick: () => target.select(),
        separator: true,
      },
      {
        id: "neg-clear",
        label: "Clear Negative Prompt",
        icon: <Eraser className="w-3.5 h-3.5" />,
        disabled: !draft.negativePrompt,
        disabledReason: "Negative prompt is empty",
        destructive: true,
        onClick: () => setDraft((p) => ({ ...p, negativePrompt: "" })),
      },
    ];

    showContextMenu({
      x: e.clientX,
      y: e.clientY,
      title: "Negative Prompt",
      items,
    });
  };

  const handleImageContextMenu = (e: React.MouseEvent, img: GeneratedImageRecord) => {
    e.preventDefault();
    e.stopPropagation();

    const items: ContextMenuItem[] = [
      {
        id: "img-inspect",
        label: "Open in Preview",
        icon: <Maximize2 className="w-3.5 h-3.5" />,
        onClick: () => onInspectImage(img),
        shortcut: "Space",
      },
      {
        id: "img-fav",
        label: img.favorite ? "Remove from Favorites" : "Add to Favorites",
        icon: <Heart className={`w-3.5 h-3.5 ${img.favorite ? "text-accent fill-accent" : ""}`} />,
        onClick: () => onToggleFavorite(img.id),
        shortcut: "F",
        separator: true,
      },
      {
        id: "img-copy-path",
        label: "Copy File Path",
        icon: <Copy className="w-3.5 h-3.5" />,
        onClick: () => void navigator.clipboard.writeText(img.filePath),
      },
      {
        id: "img-copy-prompt",
        label: "Copy Prompt",
        icon: <Copy className="w-3.5 h-3.5" />,
        onClick: () => void navigator.clipboard.writeText(img.prompt),
      },
      {
        id: "img-reveal",
        label: "Reveal in File Explorer",
        icon: <FolderIcon className="w-3.5 h-3.5" />,
        onClick: () => void window.kirea.openPath(img.filePath),
      },
      {
        id: "img-delete",
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
      title: "Artwork Actions",
      items,
    });
  };

  // Content-aware auto-resize for prompt textarea
  useEffect(() => {
    const el = promptRef.current;
    if (!el) return;
    el.style.height = "auto";
    const nextHeight = Math.min(220, Math.max(52, el.scrollHeight));
    el.style.height = `${nextHeight}px`;
  }, [draft.prompt]);

  const threadImages = images.slice(0, 10);

  // Keyboard deletion shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!shouldHandleGenerationDeleteKey(e, e.target, Boolean(deleteConfirmTarget))) return;

      if (failedJob && !activeJob) {
        e.preventDefault();
        setDeleteConfirmTarget({
          type: "job",
          id: failedJob.id,
          label: failedJob.prompt
            ? `Failed Generation: "${failedJob.prompt.slice(0, 36)}..."`
            : `Failed Generation #${failedJob.id.slice(0, 8)}`,
        });
      } else if (threadImages[0]) {
        e.preventDefault();
        setDeleteConfirmTarget({
          type: "image",
          id: threadImages[0].id,
          label: `Generation (${threadImages[0].width}×${threadImages[0].height}, Seed ${threadImages[0].seed})`,
        });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deleteConfirmTarget, failedJob, activeJob, threadImages]);
  const characterAvatar = activeCharacter?.references[0]?.filePath;
  const hasReference = draft.mode === "img2img" && Boolean(draft.inputImagePath);
  const engineOnline = runtime.status === "connected";
  const checkpointLabel = (ref: string): string =>
    checkpointOptions.find((option) => option.path === ref)?.label ??
    shortModelLabel(ref);

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

  const handleConfirmDelete = async (): Promise<void> => {
    if (!deleteConfirmTarget || deleting) return;
    setDeleting(true);
    try {
      if (deleteConfirmTarget.type === "job") {
        if (onDeleteJob) {
          await onDeleteJob(deleteConfirmTarget.id);
        } else {
          const removed = await window.kirea.deleteJob(deleteConfirmTarget.id);
          if (!removed) throw new Error("Failed generation could not be deleted.");
          onToast?.("Failed generation deleted.");
        }
      } else if (onDeleteImage) {
        await onDeleteImage(deleteConfirmTarget.id);
      } else {
        await window.kirea.deleteImage(deleteConfirmTarget.id);
        onToast?.("Generation deleted.");
      }
      setDeleteConfirmTarget(null);
    } catch (err) {
      onToast?.(
        err instanceof Error ? err.message : "Generation could not be deleted.",
        "error"
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-bg">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1240px] px-4 sm:px-5 py-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-h2 text-fg">Studio thread</h2>
            <span className="font-mono text-tech tabular-nums text-fg-subtle">
              {images.length} render{images.length === 1 ? "" : "s"} ·{" "}
              {checkpointLabel(draft.checkpoint)}
            </span>
          </div>

          {failedJob && !activeJob && (
            <div className="mt-4 rounded-xl border-2 border-danger/40 bg-danger/10 p-4 shadow-[2px_2px_0px_#0B0C10]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <AlertTriangle className="h-4 w-4 text-danger shrink-0" />
                  <span className="text-small font-semibold text-danger truncate font-mono">
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
                    <RotateCcw className="h-3 w-3 mr-1" />
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
                    <Trash2 className="h-3 w-3 mr-1" />
                    Delete
                  </Button>
                </div>
              </div>
              {failedJob.prompt && (
                <p className="mt-2 text-caption text-fg-subtle truncate font-mono">
                  Brief: {failedJob.prompt}
                </p>
              )}
            </div>
          )}

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
                    className="h-28 w-20 aspect-[2/3] rounded-lg border border-border bg-surface-subtle object-contain p-0.5"
                  />
                ) : null}
                <p className="min-w-0 flex-1 truncate text-caption font-normal text-fg-subtle">
                  {activeJob.prompt}
                </p>
              </div>
            </div>
          )}

          {threadImages.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-border px-4 py-6">
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
            <ol className="mt-3 divide-y divide-divider">
              {threadImages.map((img) => (
                <li
                  key={img.id}
                  className="grid gap-3 py-3 sm:grid-cols-[112px_minmax(0,1fr)] md:grid-cols-[128px_minmax(0,1fr)] xl:grid-cols-[144px_minmax(0,1fr)] items-start"
                >
                  <button
                    type="button"
                    onClick={() => onInspectImage(img)}
                    onContextMenu={(e) => handleImageContextMenu(e, img)}
                    className="group relative flex aspect-[2/3] w-full items-center justify-center overflow-hidden rounded-xl border border-border bg-well transition-all hover:border-accent p-1"
                  >
                    <MediaImage
                      src={toMediaUrl(img.filePath)}
                      alt={img.prompt}
                      loading="lazy"
                      className="h-full w-full object-contain object-center transition-transform duration-200 group-hover:scale-[1.02]"
                    />
                  </button>

                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-tech tabular-nums text-fg-subtle">
                      <Badge tone={imageWorkflowLabel(img).tone}>
                        {imageWorkflowLabel(img).label}
                      </Badge>
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
                      {checkpointLabel(img.checkpoint)} · {img.sampler} ·{" "}
                      {img.steps} steps · cfg {img.cfg}
                    </p>

                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
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
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-danger hover:bg-danger/10 hover:text-danger"
                        onClick={() => {
                          setDeleteConfirmTarget({
                            type: "image",
                            id: img.id,
                            label: `Generation (${img.width}×${img.height}, Seed ${img.seed})`,
                          });
                        }}
                        aria-label="Delete generation"
                        title="Delete generation (Delete key)"
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1" />
                        <span className="hidden sm:inline">Delete</span>
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
        <div className="mx-auto w-full max-w-[1240px] space-y-2 px-4 sm:px-5 py-3">
          {(activeCharacter || hasReference || activeRecipe) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {activeCharacter && (
                <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-surface pl-1 pr-1.5 text-caption font-semibold text-fg">
                  {characterAvatar ? (
                    <img
                      src={toMediaUrl(characterAvatar)}
                      alt=""
                      className="h-5 w-5 rounded-full object-contain object-center bg-surface-subtle"
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
                    className="h-5 w-5 rounded-full object-contain object-center bg-surface-subtle"
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
              onContextMenu={handlePromptContextMenu}
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
                {draft.aspectRatio === CUSTOM_ASPECT_ID && (
                  <option value={CUSTOM_ASPECT_ID}>Custom</option>
                )}
              </select>

              <span className="font-mono text-tech tabular-nums text-fg-subtle">
                {formatAspectRatio(draft.width, draft.height)} ·{" "}
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
                <button
                  type="button"
                  onClick={() => setMagicModalOpen(true)}
                  className="inline-flex items-center gap-1 rounded-full border border-terracotta/40 bg-terracotta-soft/40 px-2.5 py-1 text-caption font-medium text-terracotta hover:border-terracotta hover:bg-terracotta-soft transition-colors cursor-pointer"
                  title="Enhance brief into model-aware Danbooru tags"
                >
                  <Sparkles className="h-3 w-3 animate-pulse" />
                  Magic Danbooru
                </button>

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
                onContextMenu={handleNegativePromptContextMenu}
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

      <MagicPromptModal
        open={magicModalOpen}
        onClose={() => setMagicModalOpen(false)}
        currentPrompt={draft.prompt}
        architecture={inferModelArchitecture(draft.checkpoint)}
        onApply={(newPrompt) => {
          setDraft((p) => ({ ...p, prompt: newPrompt }));
          setMagicModalOpen(false);
        }}
        onAppend={(appendedPrompt) => {
          setDraft((p) => ({ ...p, prompt: appendedPrompt }));
          setMagicModalOpen(false);
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteConfirmTarget)}
        onClose={() => setDeleteConfirmTarget(null)}
        onConfirm={handleConfirmDelete}
        title="Delete Generation?"
        description={`Are you sure you want to delete ${deleteConfirmTarget?.label ?? "this generation"}? This action cannot be undone.`}
        confirmLabel="Yes, Delete"
        danger
        defaultFocusConfirm
      />
    </div>
  );
};
