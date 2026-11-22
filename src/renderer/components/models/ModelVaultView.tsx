import React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CloudDownload,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  HardDrive,
  Layers,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  Trash2,
  X,
} from "lucide-react";
import {
  ARCHITECTURE_LABELS,
  architectureBadgeTone,
  getEffectiveModelInfo,
  isGenerationSupportedArchitecture,
} from "../../../shared/model-utils";
import type {
  CuratedModelCatalogItem,
  DownloadTask,
  GpuStats,
  ModelArchitecture,
  ModelCategory,
  ModelRecord,
} from "../../../shared/types";
import { formatBytes, formatDurationSeconds } from "../../utils/format";
import { ModelPreview } from "../ModelPreview";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Select,
  useContextMenu,
  type ContextMenuItem,
} from "../ui/Primitives";
import {
  ARCHITECTURE_FILTERS,
  CATEGORY_LABELS,
  categoryLabel,
  formatSpeed,
} from "./models-helpers";

interface ModelVaultViewProps {
  models: ModelRecord[];
  filteredModels: ModelRecord[];
  catalog: CuratedModelCatalogItem[];
  downloads: DownloadTask[];
  hardware: GpuStats | null;
  workflowNames: Map<string, string>;
  vaultTab: "installed" | "catalog";
  setVaultTab: (tab: "installed" | "catalog") => void;
  category: "all" | ModelCategory;
  setCategory: (category: "all" | ModelCategory) => void;
  architecture: "all" | ModelArchitecture;
  setArchitecture: (arch: "all" | ModelArchitecture) => void;
  search: string;
  setSearch: (value: string) => void;
  favoritesOnly: boolean;
  setFavoritesOnly: React.Dispatch<React.SetStateAction<boolean>>;
  isManagedPath: (filePath: string) => boolean;
  onUseModel: (model: ModelRecord) => void;
  onToggleFavorite: (model: ModelRecord) => void;
  onOpenEditor: (model: ModelRecord) => void;
  onRequestDelete: (model: ModelRecord) => void;
  onStartCatalogDownload: (item: CuratedModelCatalogItem) => void;
  onOpenHub: () => void;
  onSwitchToQueue?: () => void;
  onScan: () => void;
  onOpenPath: (targetPath: string) => void;
}

export const ModelVaultView: React.FC<ModelVaultViewProps> = ({
  models,
  filteredModels,
  catalog,
  downloads,
  hardware,
  workflowNames,
  vaultTab,
  setVaultTab,
  category,
  setCategory,
  architecture,
  setArchitecture,
  search,
  setSearch,
  favoritesOnly,
  setFavoritesOnly,
  isManagedPath,
  onUseModel,
  onToggleFavorite,
  onOpenEditor,
  onRequestDelete,
  onStartCatalogDownload,
  onOpenHub,
  onSwitchToQueue,
  onScan,
  onOpenPath,
}) => {
  const { showContextMenu } = useContextMenu();

  const handleModelContextMenu = (e: React.MouseEvent, m: ModelRecord) => {
    e.preventDefault();
    e.stopPropagation();

    const info = getEffectiveModelInfo(m);
    const supported = isGenerationSupportedArchitecture(info.architecture);
    const canUse =
      m.installed &&
      supported &&
      (m.category === "checkpoint" ||
        m.category === "upscale" ||
        m.architecture === "z_image");
    const canAddLora = m.installed && supported && m.category === "lora";
    const canDelete = isManagedPath(m.filePath) || m.isIncomplete;

    const items: ContextMenuItem[] = [
      {
        id: "model-editor",
        label: "View / Edit Model Details",
        icon: <Pencil className="w-3.5 h-3.5" />,
        onClick: () => onOpenEditor(m),
      },
    ];

    if (canUse || canAddLora) {
      items.push({
        id: "model-use",
        label: canAddLora ? "Add LoRA to Creation" : "Use in Creation Studio",
        icon: <Play className="w-3.5 h-3.5" />,
        onClick: () => onUseModel(m),
        separator: true,
      });
    }

    items.push({
      id: "model-favorite",
      label: m.metadata?.favorite ? "Remove from Favorites" : "Mark as Favorite",
      icon: <Star className="w-3.5 h-3.5" />,
      onClick: () => onToggleFavorite(m),
    });

    items.push(
      {
        id: "copy-model-name",
        label: "Copy Model Name",
        icon: <Copy className="w-3.5 h-3.5" />,
        onClick: () => {
          void navigator.clipboard.writeText(info.name);
        },
      },
      {
        id: "copy-model-path",
        label: "Copy Model File Path",
        icon: <Copy className="w-3.5 h-3.5" />,
        onClick: () => {
          void navigator.clipboard.writeText(m.filePath);
        },
      }
    );

    if (m.installed && !m.filePath.startsWith("comfy-api://")) {
      items.push({
        id: "reveal-model",
        label: "Reveal in File Explorer",
        icon: <FolderOpen className="w-3.5 h-3.5" />,
        onClick: () => onOpenPath(m.sourceRoot),
        separator: canDelete,
      });
    }

    if (canDelete) {
      items.push({
        id: "delete-model",
        label: "Delete Model...",
        icon: <Trash2 className="w-3.5 h-3.5" />,
        destructive: true,
        onClick: () => onRequestDelete(m),
      });
    }

    showContextMenu({
      x: e.clientX,
      y: e.clientY,
      title: info.name,
      items,
    });
  };

  const handleEmptyVaultContextMenu = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(".rounded-xl, .border, button, input")) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();

    showContextMenu({
      x: e.clientX,
      y: e.clientY,
      title: "Model Vault",
      items: [
        {
          id: "vault-scan",
          label: "Scan Local Models",
          icon: <RefreshCw className="w-3.5 h-3.5" />,
          onClick: onScan,
        },
        {
          id: "vault-hub",
          label: "Browse Online Hub",
          icon: <Download className="w-3.5 h-3.5" />,
          onClick: onOpenHub,
        },
      ],
    });
  };

  return (
    <div onContextMenu={handleEmptyVaultContextMenu} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex p-1 rounded-xl bg-surface border border-border">
          <button
            type="button"
            onClick={() => setVaultTab("installed")}
            className={`px-4 h-8 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
              vaultTab === "installed"
                ? "bg-accent-solid text-accent-fg"
                : "text-fg-muted hover:text-fg"
            }`}
          >
            Installed Local Models ({models.filter((m) => m.installed).length})
          </button>
          <button
            type="button"
            onClick={() => setVaultTab("catalog")}
            className={`px-4 h-8 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
              vaultTab === "catalog"
                ? "bg-accent-solid text-accent-fg"
                : "text-fg-muted hover:text-fg"
            }`}
          >
            Curated Download Catalog ({catalog.length})
          </button>
        </div>

        {vaultTab === "installed" && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-64">
              <Search className="w-4 h-4 text-fg-subtle absolute left-3 top-2.5" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search installed models"
                placeholder="Search name, path, trigger words..."
                className="pl-9"
              />
            </div>
            <div className="w-44 shrink-0">
              <Select
                value={architecture}
                onChange={(e) =>
                  setArchitecture(e.target.value as "all" | ModelArchitecture)
                }
                className="h-9 text-xs"
                aria-label="Filter by architecture"
              >
                <option value="all">All architectures</option>
                {ARCHITECTURE_FILTERS.map((arch) => (
                  <option key={arch} value={arch}>
                    {ARCHITECTURE_LABELS[arch]}
                  </option>
                ))}
              </Select>
            </div>
            <Button
              size="sm"
              variant={favoritesOnly ? "primary" : "secondary"}
              onClick={() => setFavoritesOnly((v) => !v)}
              title="Show favorite models only"
            >
              <Star className={`w-3.5 h-3.5 ${favoritesOnly ? "fill-current" : ""}`} />
              Favorites
            </Button>
          </div>
        )}
      </div>

      {vaultTab === "installed" ? (
        <>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORY_LABELS.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setCategory(cat.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                  category === cat.id
                    ? "bg-accent-soft border-accent text-accent-hover"
                    : "bg-surface border-border text-fg-muted hover:text-fg"
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {filteredModels.length === 0 ? (
            <EmptyState
              icon={<Layers className="w-5 h-5" />}
              title="No matching models found"
              description="Configure your existing ComfyUI folder or extra model folders in Settings, or fetch models from the Civitai Hub."
              action={
                <Button variant="primary" onClick={() => onOpenHub()}>
                  <CloudDownload className="w-4 h-4" />
                  Browse Civitai Hub
                </Button>
              }
            />
          ) : (
            <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(230px,1fr))]">
              {filteredModels.map((m) => {
                const info = getEffectiveModelInfo(m);
                const supported = isGenerationSupportedArchitecture(info.architecture);
                const canUse =
                  m.installed &&
                  supported &&
                  (m.category === "checkpoint" ||
                    m.category === "upscale" ||
                    m.architecture === "z_image");
                const canAddLora = m.installed && supported && m.category === "lora";
                const canDelete = isManagedPath(m.filePath) || m.isIncomplete;
                const compatNames = m.compatibleWorkflows
                  .map((id) => workflowNames.get(id) ?? id)
                  .slice(0, 3);

                return (
                  <Card
                    key={m.id}
                    className="p-3.5 flex flex-col gap-3"
                    onContextMenu={(e) => handleModelContextMenu(e, m)}
                  >
                    <ModelPreview model={m} className="aspect-[2/3]" />

                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone="accent" className="capitalize">
                          {categoryLabel(m.category)}
                        </Badge>
                        <Badge tone={architectureBadgeTone(info.architecture)}>
                          {ARCHITECTURE_LABELS[info.architecture]}
                        </Badge>
                        {m.metadata?.favorite && (
                          <Badge tone="warning">
                            <Star className="w-3 h-3 fill-current" />
                            Favorite
                          </Badge>
                        )}
                        {m.isDuplicate && <Badge tone="warning">Duplicate</Badge>}
                        {m.isIncomplete && <Badge tone="danger">Incomplete</Badge>}
                        {!supported && (
                          <Badge tone="warning">
                            <AlertTriangle className="w-3 h-3" />
                            Label only
                          </Badge>
                        )}
                      </div>

                      <div>
                        <h3 className="text-sm font-semibold text-fg break-all">
                          {info.name}
                        </h3>
                        <p
                          className="text-[11px] text-fg-subtle truncate mt-0.5"
                          title={m.filePath}
                        >
                          {m.filePath}
                        </p>
                      </div>

                      {info.description && (
                        <p className="text-xs text-fg-muted line-clamp-2">
                          {info.description}
                        </p>
                      )}

                      {info.triggerWords.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {info.triggerWords.slice(0, 4).map((word) => (
                            <span
                              key={word}
                              className="px-1.5 py-0.5 rounded bg-surface-subtle border border-border text-[11px] text-fg-muted"
                            >
                              {word}
                            </span>
                          ))}
                          {info.triggerWords.length > 4 && (
                            <span className="text-[11px] text-fg-subtle">
                              +{info.triggerWords.length - 4} more
                            </span>
                          )}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-fg-muted tabular-nums">
                        <span>
                          {m.sizeBytes > 0 ? formatBytes(m.sizeBytes) : "External API"}
                        </span>
                        {info.baseModel && (
                          <span className="truncate">Base: {info.baseModel}</span>
                        )}
                      </div>

                      {compatNames.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {compatNames.map((name) => (
                            <Badge key={name} tone="success">
                              <CheckCircle2 className="w-3 h-3" />
                              {name}
                            </Badge>
                          ))}
                          {m.compatibleWorkflows.length > compatNames.length && (
                            <Badge tone="neutral">
                              +{m.compatibleWorkflows.length - compatNames.length}
                            </Badge>
                          )}
                        </div>
                      ) : (
                        m.installed &&
                        (m.category === "checkpoint" ||
                          m.category === "diffusion_model") && (
                          <Badge tone="warning">
                            <AlertTriangle className="w-3 h-3" />
                            No shipped workflow yet
                          </Badge>
                        )
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-2 mt-auto pt-2 border-t border-border/70">
                      <div className="flex items-center gap-1">
                        {!m.filePath.startsWith("comfy-api://") && (
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Open containing folder"
                            onClick={() => onOpenPath(m.sourceRoot)}
                          >
                            <FolderOpen className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Edit metadata, preview & trigger words"
                          onClick={() => onOpenEditor(m)}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title={
                            m.metadata?.favorite
                              ? "Remove from favorites"
                              : "Add to favorites"
                          }
                          onClick={() => onToggleFavorite(m)}
                        >
                          <Star
                            className={`w-3.5 h-3.5 ${
                              m.metadata?.favorite ? "fill-warning text-warning" : ""
                            }`}
                          />
                        </Button>
                        {canDelete && (
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Delete app-managed model"
                            onClick={() => onRequestDelete(m)}
                          >
                            <Trash2 className="w-3.5 h-3.5 text-fg-muted hover:text-danger" />
                          </Button>
                        )}
                      </div>

                      {m.isIncomplete ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => onSwitchToQueue?.()}
                          title="View and resume this download in the Downloads Queue"
                        >
                          <CloudDownload className="w-3.5 h-3.5 text-accent-hover" />
                          Resume in Queue
                        </Button>
                      ) : canAddLora ? (
                        <Button size="sm" variant="primary" onClick={() => onUseModel(m)}>
                          <Plus className="w-3.5 h-3.5" />
                          Add to Create
                        </Button>
                      ) : canUse ? (
                        <Button size="sm" variant="primary" onClick={() => onUseModel(m)}>
                          <Sparkles className="w-3.5 h-3.5" />
                          Use Model
                        </Button>
                      ) : null}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <div className="space-y-4">
          {hardware && Object.keys(hardware.diskFreeGB).length > 0 && (
            <div className="p-3 rounded-xl bg-surface border border-border flex flex-wrap items-center gap-3 text-xs text-fg-muted">
              <HardDrive className="w-4 h-4 text-accent shrink-0" />
              <span>Available disk space before downloading:</span>
              {Object.entries(hardware.diskFreeGB).map(([drive, gb]) => (
                <Badge key={drive} tone="neutral" className="tabular-nums">
                  {drive} {gb.toFixed(1)} GB free
                </Badge>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {catalog.map((item) => {
              const dl = downloads.find((d) => d.id === `model_${item.id}`);
              const alreadyInstalled = models.some(
                (m) =>
                  m.installed &&
                  (m.filePath.toLowerCase().endsWith(item.fileName.toLowerCase()) ||
                    m.name.toLowerCase() ===
                      item.fileName.replace(/\.[^.]+$/, "").toLowerCase())
              );

              const pct =
                dl && dl.totalBytes > 0
                  ? Math.min(100, Math.round((dl.downloadedBytes / dl.totalBytes) * 100))
                  : 0;

              return (
                <Card key={item.id} className="p-4 flex flex-col justify-between gap-4">
                  <div className="space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <Badge tone="accent" className="capitalize">
                          {categoryLabel(item.category)}
                        </Badge>
                        {item.architecture !== "unknown" && (
                          <Badge tone={architectureBadgeTone(item.architecture)}>
                            {ARCHITECTURE_LABELS[item.architecture]}
                          </Badge>
                        )}
                      </div>
                      <span className="text-xs font-semibold text-fg tabular-nums">
                        {formatBytes(item.sizeBytes)}
                      </span>
                    </div>

                    <div>
                      <h3 className="text-base font-semibold text-fg">{item.name}</h3>
                      <p className="text-xs text-fg-muted mt-1">{item.description}</p>
                    </div>

                    <div className="p-3 rounded-xl bg-bg border border-border space-y-1 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-fg-subtle">Source</span>
                        <button
                          type="button"
                          onClick={() => void window.kirea.openExternalUrl(item.sourceUrl)}
                          className="inline-flex items-center gap-1 text-accent hover:underline cursor-pointer"
                        >
                          {item.sourceName}
                          <ExternalLink className="w-3 h-3" />
                        </button>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-fg-subtle">License</span>
                        <button
                          type="button"
                          onClick={() => void window.kirea.openExternalUrl(item.licenseUrl)}
                          className="inline-flex items-center gap-1 text-fg hover:underline cursor-pointer"
                        >
                          {item.licenseName}
                          <ExternalLink className="w-3 h-3" />
                        </button>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-fg-subtle">Target Folder</span>
                        <span className="text-fg font-mono text-[11px]">
                          models/{item.targetSubdir}/{item.fileName}
                        </span>
                      </div>
                    </div>

                    {dl && (
                      <div className="p-3 rounded-xl bg-surface-elevated border border-border space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-fg capitalize">
                            {dl.status === "verifying"
                              ? "Verifying SHA-256 checksum..."
                              : dl.status}
                          </span>
                          <span className="tabular-nums text-fg-muted">
                            {pct}% • {formatBytes(dl.downloadedBytes)} /{" "}
                            {formatBytes(dl.totalBytes)}
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-bg rounded-full overflow-hidden">
                          <div
                            className="h-full bg-accent transition-[width] duration-200 ease-out"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        {dl.status === "downloading" && (
                          <div className="flex justify-between text-[11px] text-fg-subtle tabular-nums">
                            <span>{formatSpeed(dl.speedBytesPerSec)}</span>
                            <span>ETA {formatDurationSeconds(dl.etaSeconds)}</span>
                          </div>
                        )}
                        {dl.error && (
                          <p className="text-xs text-danger flex items-center gap-1.5">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            {dl.error}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
                    {alreadyInstalled ? (
                      <Badge tone="success">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Installed Locally
                      </Badge>
                    ) : (
                      <span className="text-[11px] text-fg-subtle">
                        Explicit user download confirmation
                      </span>
                    )}

                    <div className="flex items-center gap-1.5">
                      {dl && dl.status === "downloading" && (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => void window.kirea.pauseDownload(dl.id)}
                          >
                            <Play className="w-3.5 h-3.5" />
                            Pause
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => void window.kirea.cancelDownload(dl.id)}
                          >
                            <X className="w-3.5 h-3.5" />
                          </Button>
                        </>
                      )}
                      {dl && (dl.status === "paused" || dl.status === "failed") && (
                        <>
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() => void window.kirea.resumeDownload(dl.id)}
                          >
                            <Play className="w-3.5 h-3.5" />
                            Resume
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void window.kirea.cancelDownload(dl.id)}
                          >
                            <X className="w-3.5 h-3.5" />
                          </Button>
                        </>
                      )}
                      {(!dl ||
                        dl.status === "cancelled" ||
                        (dl.status === "completed" && !alreadyInstalled)) && (
                        <Button
                          size="sm"
                          variant={alreadyInstalled ? "secondary" : "primary"}
                          onClick={() => onStartCatalogDownload(item)}
                        >
                          <Download className="w-3.5 h-3.5" />
                          {alreadyInstalled ? "Re-download" : "Download Model"}
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
