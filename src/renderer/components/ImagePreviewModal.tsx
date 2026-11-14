import React, { useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  Download,
  FolderOpen,
  Heart,
  Maximize2,
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
  useDialogFocus,
} from "./ui/Primitives";
import { MediaImage } from "./ui/MediaImage";

const PROMOTE_ROLES: CharacterReferenceRole[] = [
  "primary",
  "secondary",
  "expression",
  "outfit",
  "pose",
];

interface ImagePreviewModalProps {
  image: GeneratedImageRecord | null;
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
  const [promoteRole, setPromoteRole] =
    useState<CharacterReferenceRole>("secondary");
  const [isPromoting, setIsPromoting] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useDialogFocus(
    Boolean(image),
    () => {
      if (!confirmDeleteOpen) onClose();
    },
    panelRef
  );

  useEffect(() => {
    if (!image) return;
    setTagDraft("");
    setIsPromoting(false);
    const defaultCharacter =
      characters.find((c) => c.id === image.characterId) ?? characters[0] ?? null;
    setPromoteCharacterId(defaultCharacter?.id ?? "");
    const hasPrimary =
      defaultCharacter?.references.some((ref) => ref.role === "primary") ?? false;
    setPromoteRole(hasPrimary ? "secondary" : "primary");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image]);

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
        className="fixed inset-0 z-40 flex items-center justify-center bg-[var(--scrim)] p-4 animate-[kirea-overlay-in_140ms_ease-out] lg:p-8"
        role="dialog"
        aria-modal="true"
        aria-label={`Inspect ${image.fileName}`}
        onClick={onClose}
      >
        <div
          ref={panelRef}
          tabIndex={-1}
          className="grid h-[88vh] w-full max-w-6xl grid-cols-1 overflow-hidden rounded-2xl border border-border-strong bg-surface shadow-[var(--shadow-float)] animate-[kirea-panel-in_180ms_ease-out] focus-visible:outline-none lg:grid-cols-[1fr_380px]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Left Stage */}
          <div className="relative bg-well flex items-center justify-center p-4 overflow-hidden">
            <MediaImage
              src={toMediaUrl(image.filePath)}
              alt={image.prompt}
              className="max-w-full max-h-full object-contain rounded-lg shadow-lg"
            />
            <button
              type="button"
              onClick={onClose}
              aria-label="Close inspector"
              className="lg:hidden absolute top-3 right-3 p-2 rounded-lg bg-black/60 text-white hover:bg-black"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Right Metadata Inspector */}
          <div className="flex flex-col h-full border-l border-border bg-surface overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface-elevated">
              <div className="min-w-0">
                <p className="truncate text-small font-semibold text-fg">
                  {image.fileName}
                </p>
                <p className="font-mono text-tech tabular-nums text-fg-subtle">
                  {image.width}×{image.height} • {image.format.toUpperCase()} •{" "}
                  {formatBytes(image.sizeBytes)}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void onToggleFavorite(image.id)}
                  aria-label="Toggle favorite"
                >
                  <Heart
                    className={`w-4 h-4 ${
                      image.favorite ? "fill-danger text-danger" : ""
                    }`}
                  />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onClose}
                  aria-label="Close panel"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-5">
              {/* Primary Actions */}
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
                  Reuse in Create
                </Button>
                {onUpscaleImage && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      onUpscaleImage(image);
                      onClose();
                    }}
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                    Upscale Image
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  className={onUpscaleImage ? "col-span-2" : ""}
                  onClick={() => void window.kirea.openPath(image.filePath)}
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  Open Folder
                </Button>
              </div>

              {/* Promote to Character */}
              {characters.length > 0 && (
                <div className="space-y-2 p-3 rounded-xl bg-bg border border-border">
                  <span className="label-mono text-fg-subtle">
                    Add to Character
                  </span>
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
                  <p className="text-caption font-normal leading-relaxed text-fg-subtle">
                    Copies this image into the character's app-managed reference
                    folder. Your original stays in the library.
                  </p>
                </div>
              )}

              {/* Prompt Block */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="label-mono text-fg-subtle">
                    Prompt
                  </span>
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
                <p className="whitespace-pre-wrap rounded-md border border-border bg-bg p-2.5 text-small leading-relaxed text-fg">
                  {image.prompt || "—"}
                </p>
              </div>

              {image.negativePrompt && (
                <div className="space-y-1.5">
                  <span className="label-mono text-fg-subtle">
                    Negative Prompt
                  </span>
                  <p className="whitespace-pre-wrap rounded-md border border-border bg-bg p-2.5 text-small leading-relaxed text-fg-muted">
                    {image.negativePrompt}
                  </p>
                </div>
              )}

              {/* Parameters */}
              <div className="space-y-2">
                <span className="label-mono text-fg-subtle">
                  Parameters
                </span>
                <div className="grid grid-cols-2 gap-2 text-xs bg-bg border border-border rounded-xl p-3">
                  <div>
                    <div className="text-fg-subtle">Checkpoint</div>
                    <div className="font-medium text-fg truncate" title={image.checkpoint}>
                      {shortModelLabel(image.checkpoint)}
                    </div>
                  </div>
                  <div>
                    <div className="text-fg-subtle">Seed</div>
                    <div className="font-medium text-fg tabular-nums">
                      {image.seed}
                    </div>
                  </div>
                  <div>
                    <div className="text-fg-subtle">Sampler / Scheduler</div>
                    <div className="font-medium text-fg">
                      {image.sampler} / {image.scheduler}
                    </div>
                  </div>
                  <div>
                    <div className="text-fg-subtle">Steps / CFG</div>
                    <div className="font-medium text-fg tabular-nums">
                      {image.steps} steps • CFG {image.cfg}
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

              {/* Collection */}
              <div className="space-y-1.5">
                <span className="label-mono text-fg-subtle">
                  Collection
                </span>
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
                <span className="label-mono text-fg-subtle">
                  Tags
                </span>
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
                <span className="label-mono text-fg-subtle">
                  Export Copy
                </span>
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
                  Strip prompt &amp; generation metadata from exported file
                </label>
              </div>
            </div>

            <div className="p-3 border-t border-border bg-surface-elevated flex justify-between items-center">
              <Button
                size="sm"
                variant="danger"
                onClick={() => setConfirmDeleteOpen(true)}
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete Image
              </Button>
              <Button size="sm" variant="ghost" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        </div>
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

