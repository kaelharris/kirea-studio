import React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CloudDownload,
  Download,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Star,
  ThumbsUp,
  X,
} from "lucide-react";
import {
  CIVITAI_BASE_MODELS,
  CIVITAI_MODEL_TYPES,
  CIVITAI_SORTS,
  type CivitaiBaseModel,
  type CivitaiDownloadTask,
  type CivitaiModelSummary,
  type CivitaiModelType,
  type CivitaiSort,
  type CivitaiVersion,
} from "../../../shared/civitai";
import {
  ARCHITECTURE_LABELS,
  architectureBadgeTone,
} from "../../../shared/model-utils";
import { formatBytes } from "../../utils/format";
import { Badge, Button, Card, EmptyState, Input, Select } from "../ui/Primitives";
import {
  DOWNLOAD_STATUS_LABELS,
  downloadPercent,
  formatCount,
  isActiveDownload,
  RemotePreview,
} from "./models-helpers";

interface CivitaiHubViewProps {
  hubQuery: string;
  setHubQuery: (q: string) => void;
  hubType: "all" | CivitaiModelType;
  setHubType: (t: "all" | CivitaiModelType) => void;
  hubBase: "all" | CivitaiBaseModel;
  setHubBase: (b: "all" | CivitaiBaseModel) => void;
  hubSort: CivitaiSort;
  setHubSort: (s: CivitaiSort) => void;
  hubItems: CivitaiModelSummary[];
  hubCursor: string | null;
  hubLoading: boolean;
  hubLoadingMore: boolean;
  hubLoaded: boolean;
  hubError: string | null;
  civitaiDownloads: CivitaiDownloadTask[];
  versionSelection: Record<number, number>;
  setVersionSelection: React.Dispatch<React.SetStateAction<Record<number, number>>>;
  selectedVersionFor: (model: CivitaiModelSummary) => CivitaiVersion | null;
  isVersionInstalled: (version: CivitaiVersion) => boolean;
  onFetchHub: (cursor: string | null, append: boolean) => void;
  onOpenDetails: (model: CivitaiModelSummary) => void;
  onStartDownload: (model: CivitaiModelSummary, version: CivitaiVersion) => void;
  onCancelDownload: (task: CivitaiDownloadTask) => void;
  onOpenDownloads: () => void;
}

export const CivitaiHubView: React.FC<CivitaiHubViewProps> = ({
  hubQuery,
  setHubQuery,
  hubType,
  setHubType,
  hubBase,
  setHubBase,
  hubSort,
  setHubSort,
  hubItems,
  hubCursor,
  hubLoading,
  hubLoadingMore,
  hubLoaded,
  hubError,
  civitaiDownloads,
  setVersionSelection,
  selectedVersionFor,
  isVersionInstalled,
  onFetchHub,
  onOpenDetails,
  onStartDownload,
  onCancelDownload,
  onOpenDownloads,
}) => (
    <>
      <div className="p-3 rounded-xl bg-surface border border-border flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-fg-subtle absolute left-3 top-2.5" />
          <Input
            value={hubQuery}
            onChange={(e) => setHubQuery(e.target.value)}
            aria-label="Search Civitai"
          placeholder="Search Civitai models, creators, styles..."
            className="pl-9"
          />
        </div>
        <Select
          value={hubType}
          onChange={(e) => setHubType(e.target.value as "all" | CivitaiModelType)}
          className="h-9 w-36 text-xs"
          aria-label="Filter by model type"
        >
          <option value="all">All types</option>
          {CIVITAI_MODEL_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </Select>
        <Select
          value={hubBase}
          onChange={(e) => setHubBase(e.target.value as "all" | CivitaiBaseModel)}
          className="h-9 w-40 text-xs"
          aria-label="Filter by base architecture"
        >
          <option value="all">All architectures</option>
          {CIVITAI_BASE_MODELS.map((base) => (
            <option key={base} value={base}>
              {base}
            </option>
          ))}
        </Select>
        <Select
          value={hubSort}
          onChange={(e) => setHubSort(e.target.value as CivitaiSort)}
          className="h-9 w-40 text-xs"
          aria-label="Sort results"
        >
          {CIVITAI_SORTS.map((sort) => (
            <option key={sort} value={sort}>
              {sort}
            </option>
          ))}
        </Select>
        <Button
          variant="secondary"
          size="md"
          loading={hubLoading}
          onClick={() => onFetchHub(null, false)}
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </Button>
      </div>

      {hubError && (
        <div className="p-3 rounded-xl bg-danger-soft border border-danger/30 text-xs text-danger flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p>{hubError}</p>
            <p className="text-danger/80">
              Browsing works without a key. Gated or early-access models require an
              API key in Settings → Civitai Hub.
            </p>
          </div>
        </div>
      )}

      {hubLoading && hubItems.length === 0 ? (
        <div className="py-16 flex flex-col items-center gap-2 text-fg-muted">
          <Loader2 className="w-6 h-6 animate-spin text-accent" />
          <p className="text-xs">Querying Civitai...</p>
        </div>
      ) : hubLoaded && hubItems.length === 0 ? (
        <EmptyState
          icon={<Search className="w-5 h-5" />}
          title="No Civitai models matched"
          description="Try removing a filter or broadening your search terms."
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setHubQuery("");
                setHubType("all");
                setHubBase("all");
              }}
            >
              Reset filters
            </Button>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
            {hubItems.map((model) => {
              const version = selectedVersionFor(model);
              const installed = version ? isVersionInstalled(version) : model.installed;
              const activeTask = version
                ? civitaiDownloads.find(
                    (task) =>
                      task.versionId === version.id && isActiveDownload(task.status)
                  )
                : undefined;
              const anyInstalled = model.versions.some(isVersionInstalled);

              return (
                <Card key={model.id} className="flex flex-col overflow-hidden">
                  <button
                    type="button"
                    onClick={() => onOpenDetails(model)}
                    className="relative block w-full h-44 bg-bg overflow-hidden group cursor-pointer"
                    title="Open model details"
                  >
                    <RemotePreview
                      url={model.primaryPreviewUrl}
                      alt={`${model.name} preview`}
                      className="w-full h-full transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                    <div className="absolute top-2 left-2 flex flex-wrap gap-1 max-w-[calc(100%-1rem)]">
                      <Badge tone="accent">{model.type}</Badge>
                      {version && version.architecture !== "unknown" && (
                        <Badge tone={architectureBadgeTone(version.architecture)}>
                          {ARCHITECTURE_LABELS[version.architecture]}
                        </Badge>
                      )}
                      {version?.availability && version.availability !== "Public" && (
                        <Badge tone="warning">
                          {version.availability === "EarlyAccess"
                            ? "Early access"
                            : version.availability}
                        </Badge>
                      )}
                      {model.nsfw && <Badge tone="danger">NSFW</Badge>}
                    </div>
                    {installed && (
                      <div className="absolute top-2 right-2">
                        <Badge tone="success">
                          <CheckCircle2 className="w-3 h-3" />
                          Installed
                        </Badge>
                      </div>
                    )}
                  </button>

                  <div className="p-3.5 flex flex-col gap-2.5 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3
                          className="text-sm font-semibold text-fg truncate"
                          title={model.name}
                        >
                          {model.name}
                        </h3>
                        <p className="text-[11px] text-fg-subtle truncate">
                          {model.creator ? `by ${model.creator}` : "Unknown creator"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-fg-muted tabular-nums shrink-0">
                        <span className="inline-flex items-center gap-1">
                          <Download className="w-3 h-3" />
                          {formatCount(model.stats.downloads)}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <ThumbsUp className="w-3 h-3" />
                          {formatCount(model.stats.thumbsUp)}
                        </span>
                      </div>
                    </div>

                    {model.description && (
                      <p className="text-xs text-fg-muted line-clamp-2">
                        {model.description}
                      </p>
                    )}

                    {version && version.trainedWords.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {version.trainedWords.slice(0, 3).map((word) => (
                          <span
                            key={word}
                            className="px-1.5 py-0.5 rounded bg-surface-subtle border border-border text-[11px] text-fg-muted"
                          >
                            {word}
                          </span>
                        ))}
                        {version.trainedWords.length > 3 && (
                          <span className="text-[11px] text-fg-subtle">
                            +{version.trainedWords.length - 3} more
                          </span>
                        )}
                      </div>
                    )}

                    {model.versions.length > 0 && (
                      <Select
                        value={String(version?.id ?? "")}
                        onChange={(e) =>
                          setVersionSelection((prev) => ({
                            ...prev,
                            [model.id]: Number(e.target.value),
                          }))
                        }
                        className="h-8 text-xs"
                        aria-label={`Select version of ${model.name}`}
                      >
                        {model.versions.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                            {v.baseModel ? ` · ${v.baseModel}` : ""}
                          </option>
                        ))}
                      </Select>
                    )}

                    <div className="flex items-center justify-between gap-2 text-[11px] text-fg-muted mt-auto pt-2 border-t border-border/70">
                      <span className="tabular-nums">
                        {version && version.sizeBytes > 0
                          ? formatBytes(version.sizeBytes)
                          : "Size unknown"}
                        {anyInstalled && !installed && (
                          <span className="text-success">
                            {" "}
                            · another version installed
                          </span>
                        )}
                      </span>
                      <Button size="sm" variant="ghost" onClick={() => onOpenDetails(model)}>
                        Details
                      </Button>
                    </div>

                    {installed ? (
                      <Badge tone="success" className="justify-center py-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Installed in Vault
                      </Badge>
                    ) : activeTask ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={onOpenDownloads}
                      >
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Downloading {downloadPercent(activeTask)}% — View Queue
                      </Button>
                    ) : version && !version.downloadable ? (
                      <Badge tone="danger" className="justify-center py-1.5">
                        No downloadable file
                      </Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={!version}
                        onClick={() => {
                          if (version) onStartDownload(model, version);
                        }}
                      >
                        <Download className="w-3.5 h-3.5" />
                        Download to Vault
                      </Button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>

          {hubCursor && (
            <div className="flex justify-center pt-1">
              <Button
                variant="secondary"
                size="md"
                loading={hubLoadingMore}
                onClick={() => onFetchHub(hubCursor, true)}
              >
                <Plus className="w-4 h-4" />
                Load more models
              </Button>
            </div>
          )}
        </>
      )}
    </>
);
