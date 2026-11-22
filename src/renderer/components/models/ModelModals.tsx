import React, { useMemo, useState } from "react";
import {
  Check,
  CheckCircle2,
  CloudDownload,
  Download,
  ExternalLink,
  FolderOpen,
  History,
  Images,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  ThumbsUp,
  X,
} from "lucide-react";
import type {
  CivitaiDownloadTask,
  CivitaiModelSummary,
  CivitaiVersion,
} from "../../../shared/civitai";
import {
  ARCHITECTURE_LABELS,
  architectureBadgeTone,
  getEffectiveModelInfo,
} from "../../../shared/model-utils";
import type {
  GeneratedImageRecord,
  ModelArchitecture,
  ModelRecord,
} from "../../../shared/types";
import {
  formatBytes,
  formatRelativeTime,
  toMediaUrl,
} from "../../utils/format";
import { ModelPreview } from "../ModelPreview";
import { MediaImage } from "../ui/MediaImage";
import {
  Badge,
  Button,
  Input,
  Modal,
  Select,
  Textarea,
} from "../ui/Primitives";
import {
  ARCHITECTURE_FILTERS,
  DOWNLOAD_STATUS_LABELS,
  downloadPercent,
  formatCount,
  isActiveDownload,
  type MetadataDraft,
  RemotePreview,
} from "./models-helpers";

interface CivitaiDetailsModalProps {
  details: CivitaiModelSummary | null;
  detailVersions: CivitaiVersion[];
  sampleImages: string[];
  detailsLoading: boolean;
  civitaiDownloads: CivitaiDownloadTask[];
  selectedVersionFor: (model: CivitaiModelSummary) => CivitaiVersion | null;
  setVersionSelection: React.Dispatch<React.SetStateAction<Record<number, number>>>;
  isVersionInstalled: (version: CivitaiVersion) => boolean;
  onClose: () => void;
  onStartDownload: (model: CivitaiModelSummary, version: CivitaiVersion) => void;
  onCancelDownload: (task: CivitaiDownloadTask) => void;
  onOpenDownloads: () => void;
  onOpenExternal: (url: string) => void;
}

export const CivitaiDetailsModal: React.FC<CivitaiDetailsModalProps> = ({
  details,
  detailVersions,
  sampleImages,
  detailsLoading,
  civitaiDownloads,
  selectedVersionFor,
  setVersionSelection,
  isVersionInstalled,
  onClose,
  onStartDownload,
  onCancelDownload,
  onOpenDownloads,
  onOpenExternal,
}) => (
      <Modal
        open={Boolean(details)}
        onClose={onClose}
        title={details ? `${details.name} — Civitai Details` : "Civitai Details"}
        maxWidthClass="max-w-3xl"
      >
        {details && (
          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-4">
              <div className="space-y-2">
                <div className="aspect-[2/3] rounded-xl overflow-hidden border border-border bg-well flex items-center justify-center p-1.5">
                  <RemotePreview
                    url={details.primaryPreviewUrl}
                    alt={`${details.name} preview`}
                    className="w-full h-full"
                    iconClass="w-6 h-6"
                  />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone="accent">{details.type}</Badge>
                  {details.nsfw && <Badge tone="danger">NSFW</Badge>}
                  {details.creator && <Badge tone="neutral">{details.creator}</Badge>}
                  {detailsLoading && (
                    <Badge tone="warning">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Loading details
                    </Badge>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 text-[11px] text-fg-muted tabular-nums">
                  <span className="inline-flex items-center gap-1">
                    <Download className="w-3 h-3" />
                    {formatCount(details.stats.downloads)} downloads
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <ThumbsUp className="w-3 h-3" />
                    {formatCount(details.stats.thumbsUp)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Star className="w-3 h-3" />
                    {details.stats.rating.toFixed(1)}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  className="w-full"
                  onClick={() =>
                    void window.kirea.openExternalUrl(
                      `https://civitai.com/models/${details.id}`
                    )
                  }
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open on Civitai
                </Button>
              </div>

              <div className="space-y-3">
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-fg">
                    About & Sample Prompts
                  </h3>
                  <p className="text-xs text-fg-muted leading-relaxed whitespace-pre-line max-h-44 overflow-y-auto">
                    {details.description ||
                      "No description was published for this model."}
                  </p>
                </div>

                {details.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {details.tags.slice(0, 12).map((tag) => (
                      <span
                        key={tag}
                        className="px-1.5 py-0.5 rounded bg-surface-subtle border border-border text-[11px] text-fg-muted"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-3 pt-3 border-t border-border">
              <h3 className="text-sm font-semibold text-fg">
                Versions ({detailVersions.length})
              </h3>
              {detailVersions.map((version) => {
                const installed = isVersionInstalled(version);
                const activeTask = civitaiDownloads.find(
                  (task) =>
                    task.versionId === version.id && isActiveDownload(task.status)
                );
                return (
                  <div
                    key={version.id}
                    className="p-3 rounded-xl bg-bg border border-border space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-semibold text-fg">
                          {version.name}
                        </span>
                        <Badge tone={architectureBadgeTone(version.architecture)}>
                          {ARCHITECTURE_LABELS[version.architecture]}
                        </Badge>
                        {version.baseModel && (
                          <Badge tone="neutral">{version.baseModel}</Badge>
                        )}
                        {version.availability && version.availability !== "Public" && (
                          <Badge tone="warning">
                            {version.availability === "EarlyAccess"
                              ? "Early access"
                              : version.availability}
                          </Badge>
                        )}
                        {installed && (
                          <Badge tone="success">
                            <CheckCircle2 className="w-3 h-3" />
                            Installed
                          </Badge>
                        )}
                      </div>
                      <span className="text-[11px] text-fg-muted tabular-nums">
                        {formatBytes(version.sizeBytes)}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-2 text-[11px] text-fg-subtle font-mono">
                      <span className="truncate">{version.fileName}</span>
                      {version.sha256 && (
                        <span className="truncate" title={version.sha256}>
                          SHA-256 {version.sha256.slice(0, 12)}…
                        </span>
                      )}
                      {version.publishedAt && (
                        <span>
                          Published {new Date(version.publishedAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>

                    {version.trainedWords.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        <span className="text-[11px] text-fg-subtle mr-1">
                          Trigger words:
                        </span>
                        {version.trainedWords.map((word) => (
                          <span
                            key={word}
                            className="px-1.5 py-0.5 rounded bg-surface-subtle border border-border text-[11px] text-fg-muted"
                          >
                            {word}
                          </span>
                        ))}
                      </div>
                    )}

                    {version.releaseNotes && (
                      <p className="text-[11px] text-fg-muted leading-relaxed whitespace-pre-line line-clamp-4">
                        {version.releaseNotes}
                      </p>
                    )}

                    <div className="flex justify-end">
                      {installed ? (
                        <Badge tone="success">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          In Vault
                        </Badge>
                      ) : activeTask ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            onClose();
                            onOpenDownloads();
                          }}
                        >
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Downloading {downloadPercent(activeTask)}%
                        </Button>
                      ) : !version.downloadable ? (
                        <Badge tone="danger">No downloadable file</Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => onStartDownload(details, version)}
                        >
                          <Download className="w-3.5 h-3.5" />
                          Download to Vault
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {sampleImages.length > 0 && (
              <div className="space-y-2 pt-3 border-t border-border">
                <h3 className="text-sm font-semibold text-fg">Sample Images</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {sampleImages.map((url) => (
                    <button
                      key={url}
                      type="button"
                      onClick={() => void window.kirea.openExternalUrl(url)}
                      className="aspect-[2/3] rounded-lg overflow-hidden border border-border bg-well flex items-center justify-center cursor-pointer hover:border-border-strong transition-colors p-1"
                      title="Open sample image on Civitai"
                    >
                      <RemotePreview
                        url={url}
                        alt="Civitai sample"
                        className="w-full h-full"
                        iconClass="w-4 h-4"
                      />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
);

interface ModelEditorModalProps {
  editTarget: ModelRecord | null;
  editDraft: MetadataDraft | null;
  setEditDraft: React.Dispatch<React.SetStateAction<MetadataDraft | null>>;
  savingMeta: boolean;
  importingPreview: boolean;
  onClose: () => void;
  onToggleFavorite: (model: ModelRecord) => void;
  onImportPreview: (sourceFilePath?: string) => void;
  onSaveMetadata: () => void;
  images?: GeneratedImageRecord[];
}

export const ModelEditorModal: React.FC<ModelEditorModalProps> = ({
  editTarget,
  editDraft,
  setEditDraft,
  savingMeta,
  importingPreview,
  onClose,
  onToggleFavorite,
  onImportPreview,
  onSaveMetadata,
  images,
}) => {
  const [recentPickerOpen, setRecentPickerOpen] = useState(false);
  const [recentSearch, setRecentSearch] = useState("");
  const [filterMatchedModel, setFilterMatchedModel] = useState(false);

  const latestImage = images && images.length > 0 ? images[0] : null;
  const recentImages = useMemo(() => (images ? images.slice(0, 48) : []), [images]);

  const isModelMatch = React.useCallback(
    (img: GeneratedImageRecord) => {
      if (!editTarget) return false;
      const targetName = editTarget.name.toLowerCase();
      const targetBase = editTarget.relativePath
        ? editTarget.relativePath.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? targetName
        : targetName;
      if (
        img.checkpoint &&
        (img.checkpoint.toLowerCase().includes(targetName) ||
          targetName.includes(img.checkpoint.toLowerCase()) ||
          img.checkpoint.toLowerCase().includes(targetBase))
      ) {
        return true;
      }
      if (
        img.loras &&
        img.loras.some(
          (l) =>
            l.name.toLowerCase().includes(targetName) ||
            targetName.includes(l.name.toLowerCase()) ||
            l.name.toLowerCase().includes(targetBase)
        )
      ) {
        return true;
      }
      return false;
    },
    [editTarget]
  );

  const matchedCount = useMemo(
    () => recentImages.filter(isModelMatch).length,
    [recentImages, isModelMatch]
  );

  const filteredRecent = useMemo(() => {
    return recentImages.filter((img) => {
      if (filterMatchedModel && !isModelMatch(img)) return false;
      if (!recentSearch.trim()) return true;
      const q = recentSearch.toLowerCase();
      return (
        img.prompt?.toLowerCase().includes(q) ||
        img.fileName?.toLowerCase().includes(q) ||
        img.checkpoint?.toLowerCase().includes(q) ||
        img.loras?.some((l) => l.name.toLowerCase().includes(q))
      );
    });
  }, [recentImages, filterMatchedModel, isModelMatch, recentSearch]);

  return (
    <>
      <Modal
        open={Boolean(editTarget && editDraft)}
        onClose={onClose}
        title={`Model Metadata — ${
          editTarget ? getEffectiveModelInfo(editTarget).name : ""
        }`}
        maxWidthClass="max-w-2xl"
      >
        {editTarget && editDraft && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-4">
              <div className="space-y-2.5">
                <ModelPreview model={editTarget} className="h-40" />

                <div className="space-y-1.5">
                  {/* Action 1: Use Latest Generated Work (1-click quick assign) */}
                  {latestImage ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="w-full justify-center text-xs font-semibold border border-accent/40 bg-accent/10 text-accent hover:bg-accent/20 hover:border-accent transition-all flex items-center gap-1.5 shadow-xs"
                      loading={importingPreview}
                      onClick={() => onImportPreview(latestImage.filePath)}
                      title={`Assign latest generation: ${latestImage.fileName} (${latestImage.width}×${latestImage.height})`}
                    >
                      <Sparkles className="w-3.5 h-3.5 text-accent shrink-0" />
                      <span className="truncate">Use Latest Generated Work</span>
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled
                      className="w-full justify-center text-xs text-fg-subtle/50 border border-border/40 bg-surface-subtle/40 flex items-center gap-1.5 opacity-60 cursor-not-allowed"
                      title="No generated images available in library yet"
                    >
                      <Sparkles className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">Use Latest Generated Work</span>
                    </Button>
                  )}

                  {/* Action 2: Choose from Recent Creations Picker */}
                  {recentImages.length > 0 && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="w-full justify-center text-xs text-fg hover:text-fg hover:bg-surface-subtle border-border flex items-center gap-1.5"
                      onClick={() => setRecentPickerOpen(true)}
                      title="Browse all recent creations to assign as model preview"
                    >
                      <Images className="w-3.5 h-3.5 text-fg-subtle shrink-0" />
                      <span className="truncate">Select from Recent Works ({recentImages.length})…</span>
                    </Button>
                  )}

                  {/* Action 3: Import from file */}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="w-full justify-center text-xs text-fg-subtle hover:text-fg hover:bg-surface-subtle flex items-center gap-1.5"
                    loading={importingPreview}
                    onClick={() => onImportPreview()}
                  >
                    <FolderOpen className="w-3.5 h-3.5 shrink-0" />
                    <span>Import from File…</span>
                  </Button>
                </div>

                {/* Quick mini-strip for top 3 recent creations */}
                {recentImages.length > 0 && (
                  <div className="space-y-1 pt-1.5 border-t border-border/70">
                    <div className="flex items-center justify-between text-[10px] text-fg-subtle font-medium">
                      <span>Recent Works</span>
                      <button
                        type="button"
                        className="text-accent hover:underline cursor-pointer text-[10px]"
                        onClick={() => setRecentPickerOpen(true)}
                      >
                        Browse all
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {recentImages.slice(0, 3).map((img, idx) => (
                        <button
                          key={img.id}
                          type="button"
                          onClick={() => onImportPreview(img.filePath)}
                          title={idx === 0 ? `Latest: ${img.prompt.slice(0, 80)}…` : img.prompt.slice(0, 80)}
                          className="group relative aspect-square rounded-lg overflow-hidden border border-border bg-well hover:border-accent hover:ring-1 hover:ring-accent transition-all cursor-pointer"
                        >
                          <MediaImage
                            src={toMediaUrl(img.filePath)}
                            alt={img.prompt}
                            className="w-full h-full object-cover"
                          />
                          {idx === 0 && (
                            <span className="absolute top-1 left-1 px-1 py-0.2 rounded text-[8px] font-bold bg-accent-solid text-white leading-tight shadow-xs">
                              Latest
                            </span>
                          )}
                          {isModelMatch(img) && idx !== 0 && (
                            <span className="absolute top-1 left-1 px-1 py-0.2 rounded text-[8px] font-bold bg-emerald-600 text-white leading-tight shadow-xs">
                              Model
                            </span>
                          )}
                          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-0.5 text-white">
                            <Check className="w-3.5 h-3.5" />
                            <span className="text-[8px] font-bold uppercase tracking-wider">Use</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <p className="text-[10px] text-fg-subtle leading-relaxed pt-0.5">
                  Custom images are copied into Kirea Studio's app data. External ComfyUI folders are never modified.
                </p>
              </div>

              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[11px] text-fg-subtle">Display Name</label>
                    <Input
                      value={editDraft.displayName}
                      placeholder={getEffectiveModelInfo(editTarget).name}
                      onChange={(e) =>
                        setEditDraft((p) =>
                          p ? { ...p, displayName: e.target.value } : p
                        )
                      }
                      className="h-8 text-xs"
                    />
                    {editTarget.discovery?.source && (
                      <p className="text-[10px] text-fg-subtle truncate">
                        {[
                          editTarget.discovery.source.provider,
                          editTarget.discovery.source.modelId
                            ? `model #${editTarget.discovery.source.modelId}`
                            : null,
                          editTarget.discovery.source.versionId
                            ? `version #${editTarget.discovery.source.versionId}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] text-fg-subtle">Base Model</label>
                    <Input
                      value={editDraft.baseModel}
                      placeholder="e.g. SDXL 1.0"
                      onChange={(e) =>
                        setEditDraft((p) =>
                          p ? { ...p, baseModel: e.target.value } : p
                        )
                      }
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] text-fg-subtle">
                      Architecture Override
                    </label>
                    <Select
                      value={editDraft.architectureOverride}
                      onChange={(e) =>
                        setEditDraft((p) =>
                          p
                            ? {
                                ...p,
                                architectureOverride: e.target
                                  .value as MetadataDraft["architectureOverride"],
                              }
                            : p
                        )
                      }
                      className="h-8 text-xs"
                    >
                      <option value="auto">
                        Auto detected ({ARCHITECTURE_LABELS[editTarget.architecture]})
                      </option>
                      {ARCHITECTURE_FILTERS.map((arch) => (
                        <option key={arch} value={arch}>
                          {ARCHITECTURE_LABELS[arch]}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] text-fg-subtle">Preview Mode</label>
                    <Select
                      value={editDraft.previewMode}
                      onChange={(e) =>
                        setEditDraft((p) =>
                          p
                            ? {
                                ...p,
                                previewMode: e.target
                                  .value as MetadataDraft["previewMode"],
                              }
                            : p
                        )
                      }
                      className="h-8 text-xs"
                    >
                      <option value="auto">Auto (sidecar / adjacent image)</option>
                      <option value="custom">Custom imported image</option>
                      <option value="none">None (hide preview)</option>
                    </Select>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] text-fg-subtle">Description</label>
                  <Textarea
                    rows={2}
                    value={editDraft.description}
                    onChange={(e) =>
                      setEditDraft((p) =>
                        p ? { ...p, description: e.target.value } : p
                      )
                    }
                    className="text-xs"
                    placeholder="What this model is best at..."
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[11px] text-fg-subtle">
                      Trigger Words (comma separated)
                    </label>
                    <Input
                      value={editDraft.triggerWords}
                      onChange={(e) =>
                        setEditDraft((p) =>
                          p ? { ...p, triggerWords: e.target.value } : p
                        )
                      }
                      className="h-8 text-xs"
                      placeholder="mychar, silver hair"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] text-fg-subtle">
                      Tags (comma separated)
                    </label>
                    <Input
                      value={editDraft.tags}
                      onChange={(e) =>
                        setEditDraft((p) => (p ? { ...p, tags: e.target.value } : p))
                      }
                      className="h-8 text-xs"
                      placeholder="anime, portrait"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] text-fg-subtle">Notes</label>
                  <Textarea
                    rows={2}
                    value={editDraft.notes}
                    onChange={(e) =>
                      setEditDraft((p) => (p ? { ...p, notes: e.target.value } : p))
                    }
                    className="text-xs"
                    placeholder="Private usage notes..."
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 pt-3 border-t border-border">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onToggleFavorite(editTarget)}
              >
                <Star
                  className={`w-3.5 h-3.5 ${
                    editTarget.metadata?.favorite ? "fill-warning text-warning" : ""
                  }`}
                />
                {editTarget.metadata?.favorite ? "Unfavorite" : "Favorite"}
              </Button>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  loading={savingMeta}
                  onClick={() => onSaveMetadata()}
                >
                  Save Metadata
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Recent Generations Selection Dialog */}
      <Modal
        open={recentPickerOpen}
        onClose={() => setRecentPickerOpen(false)}
        title={
          <div className="flex items-center gap-2">
            <Images className="w-4 h-4 text-accent" />
            <span className="font-semibold text-sm">Select Preview from Recent Works</span>
          </div>
        }
        maxWidthClass="max-w-3xl"
        zIndexClass="z-50"
      >
        <div className="space-y-3.5 p-1">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
            <div className="flex items-center gap-2 flex-1 min-w-[220px]">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
                <Input
                  value={recentSearch}
                  onChange={(e) => setRecentSearch(e.target.value)}
                  placeholder="Search recent creations by prompt, model or tag…"
                  className="h-8 pl-8 text-xs"
                />
              </div>
            </div>
            {matchedCount > 0 && (
              <Button
                size="sm"
                variant={filterMatchedModel ? "primary" : "secondary"}
                onClick={() => setFilterMatchedModel((p) => !p)}
                className="text-xs h-8"
              >
                <Sparkles className="w-3.5 h-3.5 mr-1" />
                Used with this model ({matchedCount})
              </Button>
            )}
          </div>

          <div className="max-h-[55vh] overflow-y-auto pr-1 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
            {filteredRecent.length === 0 ? (
              <div className="col-span-full py-12 text-center text-fg-subtle text-xs space-y-1">
                <p>No recent generations matched your filter.</p>
                {filterMatchedModel && (
                  <button
                    type="button"
                    className="text-accent underline text-xs cursor-pointer"
                    onClick={() => setFilterMatchedModel(false)}
                  >
                    View all recent works
                  </button>
                )}
              </div>
            ) : (
              filteredRecent.map((img, idx) => {
                const isMatched = isModelMatch(img);
                return (
                  <button
                    key={img.id}
                    type="button"
                    onClick={() => {
                      onImportPreview(img.filePath);
                      setRecentPickerOpen(false);
                    }}
                    className="group relative flex flex-col rounded-xl border border-border bg-surface overflow-hidden hover:border-accent hover:ring-2 hover:ring-accent/40 transition-all text-left cursor-pointer shadow-xs"
                  >
                    <div className="relative aspect-square w-full bg-well overflow-hidden">
                      <MediaImage
                        src={toMediaUrl(img.filePath)}
                        alt={img.prompt}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                      />
                      {idx === 0 && (
                        <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-accent-solid text-white shadow-xs">
                          Latest Work
                        </span>
                      )}
                      {isMatched && (
                        <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-600 text-white shadow-xs">
                          Model match
                        </span>
                      )}
                      <div className="absolute inset-0 bg-black/55 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1 text-white">
                        <Check className="w-4 h-4 text-accent" />
                        <span className="px-2 py-0.5 rounded-md bg-accent-solid text-white text-[11px] font-semibold shadow-sm">
                          Assign as Preview
                        </span>
                      </div>
                    </div>
                    <div className="p-2 space-y-1">
                      <p className="text-[11px] text-fg line-clamp-2 leading-snug">
                        {img.prompt || "No prompt recorded"}
                      </p>
                      <div className="flex items-center justify-between text-[10px] text-fg-subtle pt-0.5 border-t border-border/40">
                        <span>{img.width}×{img.height}</span>
                        <span>{formatRelativeTime(img.createdAt)}</span>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-border text-xs">
            <span className="text-fg-subtle">
              Showing {filteredRecent.length} of {recentImages.length} recent creations
            </span>
            <Button size="sm" variant="secondary" onClick={() => setRecentPickerOpen(false)}>
              Close
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};
