import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Expand,
  FolderOpen,
  FolderPlus,
  Heart,
  Info,
  Maximize2,
  Minimize2,
  Paintbrush,
  SlidersHorizontal,
  Sparkles,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import type {
  CharacterProfile,
  CharacterReferenceRole,
  CollectionRecord,
  GeneratedImageRecord,
  ModelRecord,
  OutputFormat,
} from "../../shared/types";
import { CHARACTER_REFERENCE_ROLE_LABELS } from "../../shared/character-utils";
import { imageWorkflowLabels } from "../../shared/image-labels";
import { getModelRefDisplayName } from "../../shared/model-utils";
import { formatBytes, toMediaUrl } from "../utils/format";
import {
  Badge,
  Button,
  ConfirmDialog,
  Input,
  Select,
  isInteractiveKeyboardTarget,
  useDialogFocus,
} from "./ui/Primitives";
import { ComparisonSlider } from "./ui/ComparisonSlider";
import { ZoomableImage } from "./ui/ZoomableImage";

const PROMOTE_ROLES: CharacterReferenceRole[] = [
  "primary",
  "secondary",
  "expression",
  "outfit",
  "pose",
];

interface ImagePreviewModalProps {
  image: GeneratedImageRecord | null;
  images?: GeneratedImageRecord[];
  onSelectImage?: (image: GeneratedImageRecord) => void;
  collections: CollectionRecord[];
  characters: CharacterProfile[];
  models?: ModelRecord[];
  onClose: () => void;
  onReuseSettings: (image: GeneratedImageRecord) => void;
  onUpscaleImage?: (image: GeneratedImageRecord) => void;
  onSendToWorkflow?: (
    image: GeneratedImageRecord,
    targetWorkflow: "edit" | "inpaint" | "outpaint" | "variations" | "upscale"
  ) => void;
  onToggleFavorite: (id: string) => Promise<void>;
  onUpdateMeta: (
    id: string,
    updates: { tags?: string[]; collectionId?: string | null }
  ) => Promise<void>;
  onAddToCharacter: (
    image: GeneratedImageRecord,
    characterId: string,
    role: CharacterReferenceRole
  ) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onToast: (message: string, tone?: "info" | "error") => void;
}

export const ImagePreviewModal: React.FC<ImagePreviewModalProps> = ({
  image,
  images = [],
  onSelectImage,
  collections,
  characters,
  models = [],
  onClose,
  onReuseSettings,
  onUpscaleImage,
  onSendToWorkflow,
  onToggleFavorite,
  onUpdateMeta,
  onAddToCharacter,
  onDelete,
  onToast,
}) => {
  const [tagDraft, setTagDraft] = useState("");
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [exportFormat, setExportFormat] = useState<OutputFormat>("png");
  const [stripMeta, setStripMeta] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [promoteCharacterId, setPromoteCharacterId] = useState("");
  const [promoteRole, setPromoteRole] = useState<CharacterReferenceRole>("secondary");
  const [isPromoting, setIsPromoting] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [customCompareSrc, setCustomCompareSrc] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const copiedPromptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useDialogFocus(Boolean(image) && !confirmDeleteOpen, onClose, panelRef);

  // 3-second auto-hiding inactivity timer for immersive fullscreen viewing
  const [controlsVisible, setControlsVisible] = useState(true);
  const inactivityTimerRef = useRef<NodeJS.Timeout | null>(null);

  const resetInactivityTimer = useCallback(() => {
    setControlsVisible(true);
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
    }
    inactivityTimerRef.current = setTimeout(() => {
      setControlsVisible(false);
    }, 3000);
  }, []);

  // When active image changes or modal mounts, reset timer and keep controls visible
  useEffect(() => {
    if (!image) return;
    resetInactivityTimer();
    return () => {
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
      }
      if (copiedPromptTimerRef.current) {
        clearTimeout(copiedPromptTimerRef.current);
      }
    };
  }, [image, resetInactivityTimer]);

  // Activity listeners to reset countdown on mouse move, touch, or key interaction
  useEffect(() => {
    if (!image) return;
    const handleActivity = () => {
      resetInactivityTimer();
    };

    window.addEventListener("mousemove", handleActivity, { passive: true });
    window.addEventListener("pointermove", handleActivity, { passive: true });
    window.addEventListener("touchstart", handleActivity, { passive: true });

    return () => {
      window.removeEventListener("mousemove", handleActivity);
      window.removeEventListener("pointermove", handleActivity);
      window.removeEventListener("touchstart", handleActivity);
    };
  }, [image, resetInactivityTimer]);

  const areControlsVisible = controlsVisible || showDetails || confirmDeleteOpen;

  useEffect(() => {
    if (!image || areControlsVisible) return;
    if (panelRef.current?.contains(document.activeElement)) {
      panelRef.current.focus();
    }
  }, [image, areControlsVisible]);

  // Compute navigation indices
  const currentIndex = images.findIndex((img) => img.id === image?.id);
  const hasMultiple = images.length > 1 && currentIndex !== -1;
  const canGoPrev = hasMultiple;
  const canGoNext = hasMultiple;

  const goToPrev = useCallback(() => {
    resetInactivityTimer();
    if (!hasMultiple || !onSelectImage) return;
    const prevIndex = (currentIndex - 1 + images.length) % images.length;
    const target = images[prevIndex];
    if (target) onSelectImage(target);
  }, [hasMultiple, currentIndex, images, onSelectImage, resetInactivityTimer]);

  const goToNext = useCallback(() => {
    resetInactivityTimer();
    if (!hasMultiple || !onSelectImage) return;
    const nextIndex = (currentIndex + 1) % images.length;
    const target = images[nextIndex];
    if (target) onSelectImage(target);
  }, [hasMultiple, currentIndex, images, onSelectImage, resetInactivityTimer]);

  // Comparison eligibility
  const effectiveSourcePath = image?.sourceImagePath || customCompareSrc;
  const canCompare = Boolean(effectiveSourcePath);

  // Sync state whenever active image changes
  useEffect(() => {
    if (!image) return;
    setTagDraft("");
    setIsPromoting(false);
    setCompareMode(false);
    setCustomCompareSrc(null);
    const defaultCharacter =
      characters.find((c) => c.id === image.characterId) ?? characters[0] ?? null;
    setPromoteCharacterId(defaultCharacter?.id ?? "");
    const hasPrimary =
      defaultCharacter?.references.some((ref) => ref.role === "primary") ?? false;
    setPromoteRole(hasPrimary ? "secondary" : "primary");
  }, [image, characters]);

  // Fullscreen event listener
  useEffect(() => {
    if (!image) return;
    const handleFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", handleFsChange);
    return () => document.removeEventListener("fullscreenchange", handleFsChange);
  }, [image]);

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // Ignored if browser blocks fullscreen request
    }
  };

  // Keyboard navigation listener
  useEffect(() => {
    if (!image || confirmDeleteOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isInteractiveKeyboardTarget(e.target)) return;
      resetInactivityTimer();

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goToPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goToNext();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "i" || e.key === "I") {
        e.preventDefault();
        setShowDetails((p) => !p);
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        void toggleFullscreen();
      } else if ((e.key === "c" || e.key === "C") && canCompare) {
        e.preventDefault();
        setCompareMode((p) => !p);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [image, confirmDeleteOpen, goToPrev, goToNext, onClose, canCompare, resetInactivityTimer]);

  if (!image) return null;

  const handlePromoteCharacterChange = (characterId: string): void => {
    setPromoteCharacterId(characterId);
    const target = characters.find((c) => c.id === characterId);
    const hasPrimary =
      target?.references.some((ref) => ref.role === "primary") ?? false;
    setPromoteRole(hasPrimary ? "secondary" : "primary");
  };

  const handlePromote = async (): Promise<void> => {
    if (!promoteCharacterId) return;
    setIsPromoting(true);
    try {
      await onAddToCharacter(image, promoteCharacterId, promoteRole);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setIsPromoting(false);
    }
  };

  const handleCopyPrompt = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(image.prompt);
      setCopiedPrompt(true);
      if (copiedPromptTimerRef.current) clearTimeout(copiedPromptTimerRef.current);
      copiedPromptTimerRef.current = setTimeout(() => setCopiedPrompt(false), 1800);
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Prompt could not be copied.", "error");
    }
  };

  const handleAddTag = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const cleaned = tagDraft.trim();
    if (!cleaned || image.tags.includes(cleaned)) {
      setTagDraft("");
      return;
    }
    await onUpdateMeta(image.id, { tags: [...image.tags, cleaned] });
    setTagDraft("");
  };

  const handleRemoveTag = async (tag: string): Promise<void> => {
    await onUpdateMeta(image.id, {
      tags: image.tags.filter((t) => t !== tag),
    });
  };

  const handleDownloadOriginal = async (): Promise<void> => {
    setIsExporting(true);
    try {
      const savedPath = await window.kirea.exportImage(
        image.id,
        image.format,
        false
      );
      if (savedPath) {
        onToast(`Original saved to ${savedPath}`);
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setIsExporting(false);
    }
  };

  const handleExport = async (): Promise<void> => {
    setIsExporting(true);
    try {
      const savedPath = await window.kirea.exportImage(
        image.id,
        exportFormat,
        stripMeta
      );
      if (savedPath) {
        onToast(`Exported to ${savedPath}`);
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-md animate-[kirea-overlay-in_140ms_ease-out] select-none"
        role="dialog"
        aria-modal="true"
        aria-label={`Inspect ${image.fileName}`}
        aria-hidden={confirmDeleteOpen}
        inert={confirmDeleteOpen}
        ref={panelRef}
      >
        {/* TOP FLOATING HUD BAR */}
        <header
          aria-hidden={!areControlsVisible}
          inert={!areControlsVisible}
          className={`absolute top-0 inset-x-0 z-40 flex items-center justify-between p-3.5 bg-gradient-to-b from-[#0B0C10]/95 via-[#0B0C10]/60 to-transparent transition-opacity duration-300 ease-out motion-reduce:transition-none ${
            areControlsVisible
              ? "opacity-100 pointer-events-auto"
              : "opacity-0 pointer-events-none"
          }`}
        >
          {/* Left Metadata / Index Badges */}
          <div className="flex items-center gap-2.5 min-w-0">
            {hasMultiple && (
              <span className="font-mono text-xs font-semibold px-2.5 py-1 rounded-full bg-white/15 text-white backdrop-blur shadow-sm tabular-nums">
                {currentIndex + 1} / {images.length}
              </span>
            )}
            <Badge tone="neutral" className="tabular-nums font-mono text-xs text-white/90 bg-white/10 border-white/15">
              {image.width} × {image.height}
            </Badge>
            <span className="hidden sm:inline-block font-mono text-xs text-white/70 uppercase tracking-wider">
              {image.format} · {formatBytes(image.sizeBytes)}
            </span>
            {imageWorkflowLabels(image).map((label, index) => (
              <Badge
                key={`${label.label}-${index}`}
                tone={label.tone}
                className="hidden md:inline-flex uppercase text-[10px] tracking-wider bg-white/10 border-white/15 text-white"
              >
                {label.label}
              </Badge>
            ))}

            {/* Comparison Slider Toggle */}
            {canCompare && (
              <button
                type="button"
                onClick={() => setCompareMode((p) => !p)}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                  compareMode
                    ? "bg-accent text-white shadow-[0_0_12px_rgba(var(--accent-rgb),0.5)] border border-accent-hover"
                    : "bg-white/15 text-white/90 hover:bg-white/25 border border-white/15"
                }`}
                title="Toggle Before / After Comparison Slider (C)"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>{compareMode ? "Comparing Before / After" : "Compare Before / After"}</span>
              </button>
            )}
          </div>

          {/* Right Header Navigation & Modals */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setShowDetails((p) => !p)}
              aria-label="Toggle details drawer"
              className={`p-2 rounded-lg border transition-colors cursor-pointer ${
                showDetails
                  ? "bg-accent border-accent text-white"
                  : "bg-white/10 hover:bg-white/20 text-white border-white/15"
              }`}
              title="Toggle Details & Parameters (I)"
            >
              <Info className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => void toggleFullscreen()}
              aria-label="Toggle fullscreen"
              className="hidden md:inline-flex p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white border border-white/15 transition-colors cursor-pointer"
              title="Toggle Fullscreen (F)"
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close fullscreen view"
              className="p-2 rounded-lg bg-white/10 hover:bg-danger text-white border border-white/15 transition-colors cursor-pointer"
              title="Close (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* MAIN VISUAL CANVAS: IMMERSIVE FULL SCREEN */}
        <main className="relative w-full h-full flex items-center justify-center overflow-hidden p-0 m-0">
          {compareMode && effectiveSourcePath ? (
            <div className="w-full h-full max-w-full max-h-full flex items-center justify-center">
              <ComparisonSlider
                beforeSrc={toMediaUrl(effectiveSourcePath)}
                afterSrc={toMediaUrl(image.filePath)}
                beforeLabel="Original Before"
                afterLabel="Upscaled After"
              />
            </div>
          ) : (
            <ZoomableImage
              src={toMediaUrl(image.filePath)}
              alt={image.prompt}
              naturalWidth={image.width}
              naturalHeight={image.height}
            />
          )}

          {/* FLOATING PREVIOUS / NEXT NAVIGATION BUTTONS */}
          {hasMultiple && areControlsVisible && (
            <>
              <button
                type="button"
                onClick={goToPrev}
                disabled={!canGoPrev}
                aria-label="Previous artwork (Arrow Left)"
                title="Previous artwork (←)"
                className={`absolute left-4 top-1/2 -translate-y-1/2 z-30 p-3 rounded-full bg-[#0B0C10]/80 hover:bg-[#1E3BFF] text-white border border-white/20 shadow-2xl transition-all hover:scale-110 active:scale-95 cursor-pointer disabled:opacity-20 motion-reduce:transition-none ${
                  areControlsVisible
                    ? "opacity-100 pointer-events-auto"
                    : "opacity-0 pointer-events-none"
                }`}
              >
                <ChevronLeft className="w-6 h-6 stroke-[2.5]" />
              </button>

              <button
                type="button"
                onClick={goToNext}
                disabled={!canGoNext}
                aria-label="Next artwork (Arrow Right)"
                title="Next artwork (→)"
                className={`absolute right-4 top-1/2 -translate-y-1/2 z-30 p-3 rounded-full bg-[#0B0C10]/80 hover:bg-[#1E3BFF] text-white border border-white/20 shadow-2xl transition-all hover:scale-110 active:scale-95 cursor-pointer disabled:opacity-20 motion-reduce:transition-none ${
                  areControlsVisible
                    ? "opacity-100 pointer-events-auto"
                    : "opacity-0 pointer-events-none"
                }`}
              >
                <ChevronRight className="w-6 h-6 stroke-[2.5]" />
              </button>
            </>
          )}
        </main>

        {/* CONTEXTUAL ACTION DOCK (7 REQUIRED ACTIONS) */}
        <div
          aria-hidden={!areControlsVisible}
          inert={!areControlsVisible}
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1.5 p-2 rounded-xl bg-[#0B0C10]/90 border border-white/20 shadow-2xl backdrop-blur-md transition-opacity duration-300 ease-out motion-reduce:transition-none ${
            areControlsVisible
              ? "opacity-100 pointer-events-auto"
              : "opacity-0 pointer-events-none"
          }`}
        >
          {/* 1. Upscale */}
          {onUpscaleImage && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                onUpscaleImage(image);
                onClose();
              }}
              title="Send artwork to AI Upscaler"
              className="bg-white/10 hover:bg-white/20 text-white border-white/15 text-xs font-mono uppercase"
            >
              <Maximize2 className="w-3.5 h-3.5 mr-1 text-[#1E3BFF]" />
              Upscale
            </Button>
          )}

          {/* 2. Reuse Settings */}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              onReuseSettings(image);
              onClose();
            }}
            title="Restore prompt, model, seed and parameters in Create Studio"
            className="bg-white/10 hover:bg-white/20 text-white border-white/15 text-xs font-mono uppercase"
          >
            <Sparkles className="w-3.5 h-3.5 mr-1 text-[#1E3BFF]" />
            Reuse Settings
          </Button>

          {/* 3. Copy Prompt */}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void handleCopyPrompt()}
            title="Copy positive prompt to clipboard"
            className={`text-xs font-mono uppercase transition-colors ${
              copiedPrompt
                ? "bg-[#1E3BFF]/20 text-[#1E3BFF] border-[#1E3BFF]"
                : "bg-white/10 hover:bg-white/20 text-white border-white/15"
            }`}
          >
            {copiedPrompt ? (
              <>
                <Check className="w-3.5 h-3.5 mr-1 text-[#1E3BFF]" />
                [COPIED ✓]
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 mr-1" />
                Copy Prompt
              </>
            )}
          </Button>

          {/* 4. Inpaint */}
          {onSendToWorkflow && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                onSendToWorkflow(image, "inpaint");
                onClose();
              }}
              title="Send image to Inpainting workflow"
              className="bg-white/10 hover:bg-white/20 text-white border-white/15 text-xs font-mono uppercase"
            >
              <Paintbrush className="w-3.5 h-3.5 mr-1 text-[#1E3BFF]" />
              Inpaint
            </Button>
          )}

          {/* 5. Outpaint */}
          {onSendToWorkflow && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                onSendToWorkflow(image, "outpaint");
                onClose();
              }}
              title="Send image to Outpainting canvas"
              className="bg-white/10 hover:bg-white/20 text-white border-white/15 text-xs font-mono uppercase"
            >
              <Expand className="w-3.5 h-3.5 mr-1 text-[#1E3BFF]" />
              Outpaint
            </Button>
          )}

          {/* 6. Save to Collection */}
          <div className="relative flex items-center">
            <select
              value={image.collectionId ?? ""}
              onChange={(e) => {
                const colId = e.target.value ? e.target.value : null;
                void onUpdateMeta(image.id, { collectionId: colId });
                onToast(colId ? "Added to collection." : "Removed from collection.");
              }}
              className="h-8 px-2 text-xs font-mono bg-white/10 hover:bg-white/20 text-white border border-white/15 rounded-md cursor-pointer focus:outline-none"
              title="Assign or remove from collection"
            >
              <option value="" className="bg-[#0B0C10] text-[#F2F2EE]">
                📁 No Collection
              </option>
              {collections.map((col) => (
                <option key={col.id} value={col.id} className="bg-[#0B0C10] text-[#F2F2EE]">
                  📁 {col.name}
                </option>
              ))}
            </select>
          </div>

          <div className="h-4 w-px bg-white/20 mx-0.5" />

          {/* Favorite */}
          <button
            type="button"
            onClick={() => void onToggleFavorite(image.id)}
            aria-label={image.favorite ? "Remove favorite" : "Favorite"}
            className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white border border-white/15 transition-colors cursor-pointer"
            title="Favorite (Heart)"
          >
            <Heart
              className={`w-4 h-4 ${
                image.favorite ? "fill-danger text-danger" : "text-white/80"
              }`}
            />
          </button>

          {/* Download Original */}
          <button
            type="button"
            onClick={() => void handleDownloadOriginal()}
            disabled={isExporting}
            aria-label="Download original image"
            className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white border border-white/15 transition-colors cursor-pointer disabled:opacity-50"
            title="Download original file"
          >
            <Download className="w-4 h-4" />
          </button>

          {/* 7. Delete */}
          <Button
            size="sm"
            variant="danger"
            onClick={() => setConfirmDeleteOpen(true)}
            className="text-xs font-mono uppercase"
            title="Delete this artwork (requires confirmation)"
          >
            <Trash2 className="w-3.5 h-3.5 mr-1" />
            Delete
          </Button>
        </div>

        {/* SLIDE-OUT METADATA & PARAMETERS DRAWER */}
        <aside
          aria-hidden={!showDetails}
          inert={!showDetails}
          className={`fixed top-0 right-0 bottom-0 z-50 w-full max-w-sm sm:max-w-md bg-surface/95 backdrop-blur-xl border-l border-border shadow-2xl flex flex-col transition-transform duration-250 ease-out ${
            showDetails ? "translate-x-0" : "translate-x-full"
          }`}
        >
          {/* Drawer Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-surface-elevated">
            <div>
              <h2 className="text-sm font-semibold text-fg">Generation Details</h2>
              <p className="text-[11px] text-fg-subtle truncate max-w-[240px] font-mono">
                {image.fileName}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowDetails(false)}
              className="p-1.5 rounded-lg text-fg-muted hover:text-fg hover:bg-surface-subtle transition-colors cursor-pointer"
              aria-label="Close details drawer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Drawer Body */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {/* Action Bar */}
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  onReuseSettings(image);
                  onClose();
                }}
              >
                <Sparkles className="w-3.5 h-3.5" />
                Reuse Settings
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void window.kirea.openPath(image.filePath)}
              >
                <FolderOpen className="w-3.5 h-3.5" />
                Open File
              </Button>
            </div>

            {/* Prompt */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="label-mono text-fg-subtle">Prompt</span>
                <button
                  type="button"
                  onClick={() => void handleCopyPrompt()}
                  className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline cursor-pointer"
                >
                  {copiedPrompt ? (
                    <>
                      <Check className="w-3 h-3" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" /> Copy
                    </>
                  )}
                </button>
              </div>
              <p className="whitespace-pre-wrap rounded-lg border border-border bg-bg p-3 text-xs leading-relaxed text-fg select-text">
                {image.prompt || "—"}
              </p>
            </div>

            {/* Negative Prompt */}
            {image.negativePrompt && (
              <div className="space-y-1.5">
                <span className="label-mono text-fg-subtle">Negative Prompt</span>
                <p className="whitespace-pre-wrap rounded-lg border border-border bg-bg p-3 text-xs leading-relaxed text-fg-muted select-text">
                  {image.negativePrompt}
                </p>
              </div>
            )}

            {/* Generation Parameters Grid */}
            <div className="space-y-2">
              <span className="label-mono text-fg-subtle">Parameters</span>
              <div className="grid grid-cols-2 gap-2 text-xs bg-bg border border-border rounded-xl p-3">
                <div className="col-span-2">
                  <div className="text-fg-subtle text-[11px]">Provenance</div>
                  <div className="mt-1 space-y-1">
                    {imageWorkflowLabels(image).map((label, index) => (
                      <div
                        key={`${label.label}-${index}`}
                        className="flex items-center gap-2"
                      >
                        <Badge tone={label.tone}>{label.label}</Badge>
                        <span className="text-[10px] text-fg-subtle">
                          {index === 0 ? "Original generation" : `Stage ${index + 1}`}
                        </span>
                        <span
                          className="font-mono text-[10px] text-fg-subtle truncate max-w-[190px]"
                          title={label.workflowId ?? undefined}
                        >
                          {label.workflowId ?? "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-fg-subtle text-[11px]">Checkpoint</div>
                  <div className="font-medium text-fg truncate" title={image.checkpoint}>
                    {getModelRefDisplayName(models, image.checkpoint)}
                  </div>
                </div>
                <div>
                  <div className="text-fg-subtle text-[11px]">Seed</div>
                  <div className="font-medium text-fg tabular-nums">{image.seed}</div>
                </div>
                <div>
                  <div className="text-fg-subtle text-[11px]">Sampler / Scheduler</div>
                  <div className="font-medium text-fg truncate">
                    {image.sampler} / {image.scheduler}
                  </div>
                </div>
                <div>
                  <div className="text-fg-subtle text-[11px]">Steps / CFG</div>
                  <div className="font-medium text-fg tabular-nums">
                    {image.steps} steps · CFG {image.cfg}
                  </div>
                </div>
              </div>

              {image.loras.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {image.loras.map((l) => (
                    <Badge key={l.name} tone="accent">
                      {getModelRefDisplayName(models, l.name)} ({l.strengthModel})
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* Add to Character */}
            {characters.length > 0 && (
              <div className="space-y-2 p-3.5 rounded-xl bg-bg border border-border">
                <span className="label-mono text-fg-subtle">Add to Character</span>
                <Select
                  value={promoteCharacterId}
                  onChange={(e) => handlePromoteCharacterChange(e.target.value)}
                  className="h-8 text-xs"
                >
                  {characters.map((character) => (
                    <option key={character.id} value={character.id}>
                      {character.favorite ? "★ " : ""}
                      {character.name}
                    </option>
                  ))}
                </Select>
                <div className="flex items-center gap-2">
                  <Select
                    value={promoteRole}
                    onChange={(e) =>
                      setPromoteRole(e.target.value as CharacterReferenceRole)
                    }
                    className="h-8 text-xs max-w-[150px]"
                  >
                    {PROMOTE_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {CHARACTER_REFERENCE_ROLE_LABELS[role]}
                      </option>
                    ))}
                  </Select>
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={isPromoting}
                    disabled={!promoteCharacterId}
                    onClick={() => void handlePromote()}
                  >
                    Add Reference
                  </Button>
                </div>
              </div>
            )}

            {/* Collection */}
            <div className="space-y-1.5">
              <span className="label-mono text-fg-subtle">Collection</span>
              <Select
                value={image.collectionId ?? ""}
                onChange={(e) =>
                  void onUpdateMeta(image.id, {
                    collectionId: e.target.value || null,
                  })
                }
              >
                <option value="">Uncollected</option>
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>

            {/* Tags */}
            <div className="space-y-2">
              <span className="label-mono text-fg-subtle">Tags</span>
              <div className="flex flex-wrap gap-1.5">
                {image.tags.map((t) => (
                  <Badge key={t} tone="neutral">
                    <Tag className="w-3 h-3" />
                    {t}
                    <button
                      type="button"
                      onClick={() => void handleRemoveTag(t)}
                      aria-label={`Remove tag ${t}`}
                      className="ml-0.5 hover:text-danger cursor-pointer"
                    >
                      ×
                    </button>
                  </Badge>
                ))}
              </div>
              <form onSubmit={(e) => void handleAddTag(e)} className="flex gap-2">
                <Input
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  placeholder="Add tag..."
                  className="h-8 text-xs"
                />
                <Button type="submit" size="sm">
                  Add
                </Button>
              </form>
            </div>

            {/* Export Section */}
            <div className="space-y-2 pt-3 border-t border-border">
              <span className="label-mono text-fg-subtle">Export Copy</span>
              <div className="flex items-center gap-2">
                <Select
                  value={exportFormat}
                  onChange={(e) =>
                    setExportFormat(e.target.value as OutputFormat)
                  }
                  className="h-8 text-xs"
                >
                  <option value="png">PNG (Lossless)</option>
                  <option value="jpeg">JPEG (94% Quality)</option>
                  <option value="webp">WebP (92% Quality)</option>
                </Select>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={isExporting}
                  onClick={() => void handleExport()}
                >
                  <Download className="w-3.5 h-3.5" />
                  Export
                </Button>
              </div>
              <label className="flex items-center gap-2 text-xs text-fg-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={stripMeta}
                  onChange={(e) => setStripMeta(e.target.checked)}
                  className="rounded border-border accent-accent"
                />
                Strip metadata from exported file
              </label>
            </div>
          </div>

          {/* Drawer Footer */}
          <div className="p-4 border-t border-border bg-surface-elevated flex items-center justify-between">
            <Button
              size="sm"
              variant="danger"
              onClick={() => setConfirmDeleteOpen(true)}
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowDetails(false)}>
              Hide Details
            </Button>
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmDeleteOpen}
        zIndexClass="z-[60]"
        onClose={() => setConfirmDeleteOpen(false)}
        onConfirm={() => {
          void onDelete(image.id).then(onClose);
        }}
        title="Delete Generated Image"
        description={`Permanently remove '${image.fileName}' (${image.width}×${image.height} · ${getModelRefDisplayName(models, image.checkpoint)}) from your disk and library? This action cannot be undone.`}
        confirmLabel="Delete Permanently"
        defaultFocusConfirm
        danger
      />
    </>
  );
};
