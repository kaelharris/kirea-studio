import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FolderOpen,
  Heart,
  Info,
  Maximize2,
  Minimize2,
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
  OutputFormat,
} from "../../shared/types";
import { CHARACTER_REFERENCE_ROLE_LABELS } from "../../shared/character-utils";
import { formatBytes, shortModelLabel, toMediaUrl } from "../utils/format";
import {
  Badge,
  Button,
  ConfirmDialog,
  Input,
  Select,
} from "./ui/Primitives";
import { MediaImage } from "./ui/MediaImage";
import { ComparisonSlider } from "./ui/ComparisonSlider";

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
  onClose: () => void;
  onReuseSettings: (image: GeneratedImageRecord) => void;
  onUpscaleImage?: (image: GeneratedImageRecord) => void;
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
  onClose,
  onReuseSettings,
  onUpscaleImage,
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

  // Compute navigation indices
  const currentIndex = images.findIndex((img) => img.id === image?.id);
  const hasMultiple = images.length > 1 && currentIndex !== -1;
  const canGoPrev = hasMultiple;
  const canGoNext = hasMultiple;

  const goToPrev = useCallback(() => {
    if (!hasMultiple || !onSelectImage) return;
    const prevIndex = (currentIndex - 1 + images.length) % images.length;
    const target = images[prevIndex];
    if (target) onSelectImage(target);
  }, [hasMultiple, currentIndex, images, onSelectImage]);

  const goToNext = useCallback(() => {
    if (!hasMultiple || !onSelectImage) return;
    const nextIndex = (currentIndex + 1) % images.length;
    const target = images[nextIndex];
    if (target) onSelectImage(target);
  }, [hasMultiple, currentIndex, images, onSelectImage]);

  // Comparison eligibility
  const effectiveSourcePath = image?.sourceImagePath || customCompareSrc;
  const canCompare = Boolean(effectiveSourcePath);

  // Sync state whenever active image changes
  useEffect(() => {
    if (!image) return;
    setTagDraft("");
    setIsPromoting(false);
    setCompareMode(Boolean(image.sourceImagePath));
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
    const handleFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", handleFsChange);
    return () => document.removeEventListener("fullscreenchange", handleFsChange);
  }, []);

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
      // Ignore if user is typing into an input/textarea
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;

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
  }, [image, confirmDeleteOpen, goToPrev, goToNext, onClose, canCompare]);

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
    await navigator.clipboard.writeText(image.prompt);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 1800);
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
        ref={panelRef}
      >
        {/* TOP FLOATING HUD BAR */}
        <header className="absolute top-0 inset-x-0 z-40 flex items-center justify-between p-3.5 bg-gradient-to-b from-black/85 via-black/40 to-transparent pointer-events-auto">
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
            <Badge tone="accent" className="hidden md:inline-flex uppercase text-[10px] tracking-wider">
              {image.mode}
            </Badge>

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

          {/* Right Action Buttons */}
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                onReuseSettings(image);
                onClose();
              }}
              title="Reuse generation prompt and settings in Create"
              className="bg-white/10 hover:bg-white/20 text-white border-white/15"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Reuse Settings</span>
            </Button>

            {onUpscaleImage && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  onUpscaleImage(image);
                  onClose();
                }}
                title="Send to AI Upscaler"
                className="bg-white/10 hover:bg-white/20 text-white border-white/15"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Upscale</span>
              </Button>
            )}

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

        {/* MAIN VISUAL CANVAS: 1ST FULL SCREEN */}
        <main className="relative w-full h-full flex items-center justify-center overflow-hidden p-2 sm:p-4 md:p-6">
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
            <div className="relative w-full h-full flex items-center justify-center">
              <MediaImage
                src={toMediaUrl(image.filePath)}
                alt={image.prompt}
                className="max-w-[100vw] max-h-[100vh] w-auto h-auto object-contain object-center rounded-lg shadow-2xl transition-transform"
              />
            </div>
          )}

          {/* FLOATING PREVIOUS / NEXT NAVIGATION BUTTONS */}
          {hasMultiple && (
            <>
              <button
                type="button"
                onClick={goToPrev}
                disabled={!canGoPrev}
                aria-label="Previous generation"
                title="Previous generation (←)"
                className="absolute left-4 top-1/2 -translate-y-1/2 z-30 p-3 rounded-full bg-black/60 hover:bg-accent text-white backdrop-blur border border-white/15 shadow-2xl transition-all hover:scale-110 active:scale-95 cursor-pointer disabled:opacity-20"
              >
                <ChevronLeft className="w-6 h-6 stroke-[2.5]" />
              </button>

              <button
                type="button"
                onClick={goToNext}
                disabled={!canGoNext}
                aria-label="Next generation"
                title="Next generation (→)"
                className="absolute right-4 top-1/2 -translate-y-1/2 z-30 p-3 rounded-full bg-black/60 hover:bg-accent text-white backdrop-blur border border-white/15 shadow-2xl transition-all hover:scale-110 active:scale-95 cursor-pointer disabled:opacity-20"
              >
                <ChevronRight className="w-6 h-6 stroke-[2.5]" />
              </button>
            </>
          )}

          {/* BOTTOM FLOATING PROMPT SNIPPET */}
          <footer className="absolute bottom-4 inset-x-4 z-30 flex items-center justify-center pointer-events-none">
            <div className="max-w-2xl px-4 py-2 rounded-full bg-black/75 border border-white/10 text-white/90 text-xs truncate backdrop-blur pointer-events-auto text-center shadow-lg">
              {image.prompt || "No prompt recorded"}
            </div>
          </footer>
        </main>

        {/* SLIDE-OUT METADATA & PARAMETERS DRAWER */}
        <aside
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
                <div>
                  <div className="text-fg-subtle text-[11px]">Checkpoint</div>
                  <div className="font-medium text-fg truncate" title={image.checkpoint}>
                    {shortModelLabel(image.checkpoint)}
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
                      {shortModelLabel(l.name)} ({l.strengthModel})
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
        onClose={() => setConfirmDeleteOpen(false)}
        onConfirm={() => {
          void onDelete(image.id).then(onClose);
        }}
        title="Delete Generated Image"
        description={`Remove '${image.fileName}' from disk and from your Kirea Studio library? This cannot be undone.`}
        confirmLabel="Delete Permanently"
        danger
      />
    </>
  );
};
