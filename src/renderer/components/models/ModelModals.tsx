import React from "react";
import {
  CheckCircle2,
  CloudDownload,
  Download,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
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
} from "../../../shared/model-utils";
import type { ModelArchitecture, ModelRecord } from "../../../shared/types";
import { formatBytes } from "../../utils/format";
import { ModelPreview } from "../ModelPreview";
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
                <div className="h-48 rounded-xl overflow-hidden border border-border bg-bg">
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
                      className="h-24 rounded-lg overflow-hidden border border-border bg-bg cursor-pointer hover:border-border-strong transition-colors"
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
  onImportPreview: () => void;
  onSaveMetadata: () => void;
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
}) => (
      <Modal
        open={Boolean(editTarget && editDraft)}
        onClose={onClose}
        title={`Model Metadata — ${editTarget?.name ?? ""}`}
        maxWidthClass="max-w-2xl"
      >
        {editTarget && editDraft && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-4">
              <div className="space-y-2">
                <ModelPreview model={editTarget} className="h-40" />
                <Button
                  size="sm"
                  variant="secondary"
                  className="w-full"
                  loading={importingPreview}
                  onClick={() => onImportPreview()}
                >
                  <Plus className="w-3.5 h-3.5" />
                  Import Preview
                </Button>
                <p className="text-[11px] text-fg-subtle leading-relaxed">
                  Custom images are copied into Kirea Studio's app data. External
                  ComfyUI folders are never modified.
                </p>
              </div>

              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[11px] text-fg-subtle">Display Name</label>
                    <Input
                      value={editDraft.displayName}
                      placeholder={editTarget.name}
                      onChange={(e) =>
                        setEditDraft((p) =>
                          p ? { ...p, displayName: e.target.value } : p
                        )
                      }
                      className="h-8 text-xs"
                    />
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
);
