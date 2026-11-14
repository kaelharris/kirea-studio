import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CloudDownload,
  Download,
  ExternalLink,
  FolderOpen,
  HardDrive,
  ImageOff,
  Layers,
  Loader2,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Star,
  ThumbsUp,
  Trash2,
  X,
} from "lucide-react";
import {
  CIVITAI_BASE_MODELS,
  CIVITAI_MODEL_TYPES,
  CIVITAI_SORTS,
  type CivitaiBaseModel,
  type CivitaiDownloadStatus,
  type CivitaiDownloadTask,
  type CivitaiModelSummary,
  type CivitaiModelType,
  type CivitaiSearchQuery,
  type CivitaiSort,
  type CivitaiVersion,
} from "../../shared/civitai";
import {
  ARCHITECTURE_LABELS,
  architectureBadgeTone,
  getEffectiveModelInfo,
  isGenerationSupportedArchitecture,
} from "../../shared/model-utils";
import type {
  AppSettings,
  CuratedModelCatalogItem,
  DownloadTask,
  GpuStats,
  ModelArchitecture,
  ModelCategory,
  ModelMetadataPatch,
  ModelRecord,
  WorkflowTemplate,
} from "../../shared/types";
import { ModelPreview } from "../components/ModelPreview";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Input,
  Modal,
  SectionHeader,
  Select,
  Textarea,
} from "../components/ui/Primitives";
import { formatBytes, formatDurationSeconds } from "../utils/format";

import {
  ACTIVE_DOWNLOAD_STATUSES,
  HUB_PAGE_SIZE,
  isActiveDownload,
  type MetadataDraft,
  type PageMode,
  splitList,
} from "../components/models/models-helpers";
import { CivitaiHubView } from "../components/models/CivitaiHubView";
import { DownloadsQueueView } from "../components/models/DownloadsQueueView";
import {
  CivitaiDetailsModal,
  ModelEditorModal,
} from "../components/models/ModelModals";
import { ModelVaultView } from "../components/models/ModelVaultView";

interface ModelsPageProps {
  models: ModelRecord[];
  catalog: CuratedModelCatalogItem[];
  downloads: DownloadTask[];
  civitaiDownloads: CivitaiDownloadTask[];
  settings: AppSettings;
  hardware: GpuStats | null;
  workflows: WorkflowTemplate[];
  managedModelsRootHint: string;
  onScanModels: () => Promise<void>;
  onUseModel: (model: ModelRecord) => void;
  onDeleteModel: (filePath: string) => Promise<void>;
  onUpdateModelMetadata: (
    modelId: string,
    patch: ModelMetadataPatch
  ) => Promise<ModelRecord>;
  onImportPreview: (modelId: string) => Promise<ModelRecord | null>;
  onToast: (msg: string, tone?: "info" | "error") => void;
}

export const ModelsPage: React.FC<ModelsPageProps> = ({
  models,
  catalog,
  downloads,
  civitaiDownloads,
  settings,
  hardware,
  workflows,
  managedModelsRootHint,
  onScanModels,
  onUseModel,
  onDeleteModel,
  onUpdateModelMetadata,
  onImportPreview,
  onToast,
}) => {
  const [mode, setMode] = useState<PageMode>("vault");
  const [vaultTab, setVaultTab] = useState<"installed" | "catalog">("installed");
  const [category, setCategory] = useState<"all" | ModelCategory>("all");
  const [architecture, setArchitecture] = useState<"all" | ModelArchitecture>("all");
  const [search, setSearch] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ModelRecord | null>(null);
  const [editTarget, setEditTarget] = useState<ModelRecord | null>(null);
  const [editDraft, setEditDraft] = useState<MetadataDraft | null>(null);
  const [savingMeta, setSavingMeta] = useState(false);
  const [importingPreview, setImportingPreview] = useState(false);

  const [hubQuery, setHubQuery] = useState("");
  const [hubDebounced, setHubDebounced] = useState("");
  const [hubType, setHubType] = useState<"all" | CivitaiModelType>("all");
  const [hubBase, setHubBase] = useState<"all" | CivitaiBaseModel>("all");
  const [hubSort, setHubSort] = useState<CivitaiSort>("Most Downloaded");
  const [hubItems, setHubItems] = useState<CivitaiModelSummary[]>([]);
  const [hubCursor, setHubCursor] = useState<string | null>(null);
  const [hubLoading, setHubLoading] = useState(false);
  const [hubLoadingMore, setHubLoadingMore] = useState(false);
  const [hubLoaded, setHubLoaded] = useState(false);
  const [hubError, setHubError] = useState<string | null>(null);
  const [versionSelection, setVersionSelection] = useState<Record<number, number>>(
    {}
  );
  const [detailsTarget, setDetailsTarget] = useState<CivitaiModelSummary | null>(
    null
  );
  const [detailsData, setDetailsData] = useState<CivitaiModelSummary | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const hubRequestRef = useRef(0);
  const detailsRequestRef = useRef(0);

  const workflowNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const wf of workflows) map.set(wf.id, wf.name);
    return map;
  }, [workflows]);

  const filteredModels = useMemo(() => {
    const q = search.trim().toLowerCase();
    return models.filter((m) => {
      if (category !== "all" && m.category !== category) return false;
      const info = getEffectiveModelInfo(m);
      if (architecture !== "all" && info.architecture !== architecture) return false;
      if (favoritesOnly && !m.metadata?.favorite) return false;
      if (!q) return true;
      const haystack = [
        info.name,
        m.name,
        m.relativePath,
        m.filePath,
        info.architecture,
        info.baseModel ?? "",
        info.description,
        info.triggerWords.join(" "),
        (m.metadata?.tags ?? []).join(" "),
        m.category,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [models, category, architecture, favoritesOnly, search]);

  const installedFileNames = useMemo(() => {
    const names = new Set<string>();
    for (const model of models) {
      if (!model.installed) continue;
      const base = model.filePath.split(/[\\/]/).pop();
      if (base) names.add(base.toLowerCase());
    }
    for (const task of civitaiDownloads) {
      if (task.status === "completed") names.add(task.fileName.toLowerCase());
    }
    return names;
  }, [models, civitaiDownloads]);

  const isVersionInstalled = useCallback(
    (version: CivitaiVersion): boolean =>
      version.installed || installedFileNames.has(version.fileName.toLowerCase()),
    [installedFileNames]
  );

  const selectedVersionFor = useCallback(
    (model: CivitaiModelSummary): CivitaiVersion | null => {
      const selectedId = versionSelection[model.id];
      return (
        model.versions.find((version) => version.id === selectedId) ??
        model.versions[0] ??
        null
      );
    },
    [versionSelection]
  );

  const activeDownloads = useMemo(
    () => civitaiDownloads.filter((task) => isActiveDownload(task.status)),
    [civitaiDownloads]
  );
  const completedDownloads = useMemo(
    () => civitaiDownloads.filter((task) => task.status === "completed"),
    [civitaiDownloads]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setHubDebounced(hubQuery.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [hubQuery]);

  const fetchHub = useCallback(
    async (cursor: string | null, append: boolean): Promise<void> => {
      const requestId = ++hubRequestRef.current;
      if (append) {
        setHubLoadingMore(true);
      } else {
        setHubLoading(true);
      }
      setHubError(null);
      try {
        const query: CivitaiSearchQuery = {
          query: hubDebounced || undefined,
          type: hubType === "all" ? undefined : hubType,
          baseModel: hubBase === "all" ? undefined : hubBase,
          sort: hubSort,
          nsfw: !settings.nsfwFilter,
          limit: HUB_PAGE_SIZE,
          cursor: cursor ?? undefined,
        };
        const result = await window.kirea.searchCivitaiModels(query);
        if (requestId !== hubRequestRef.current) return;
        setHubItems((prev) => (append ? [...prev, ...result.items] : result.items));
        setHubCursor(result.nextCursor);
        setHubLoaded(true);
      } catch (err) {
        if (requestId !== hubRequestRef.current) return;
        setHubError(err instanceof Error ? err.message : String(err));
        if (!append) setHubItems([]);
        setHubLoaded(true);
      } finally {
        if (requestId === hubRequestRef.current) {
          setHubLoading(false);
          setHubLoadingMore(false);
        }
      }
    },
    [hubDebounced, hubType, hubBase, hubSort, settings.nsfwFilter]
  );

  useEffect(() => {
    if (mode !== "hub") return;
    void fetchHub(null, false);
  }, [mode, fetchHub]);

  const handleStartCivitaiDownload = async (
    model: CivitaiModelSummary,
    version: CivitaiVersion
  ): Promise<void> => {
    try {
      await window.kirea.startCivitaiDownload(model.id, version.id);
      onToast(`Downloading ${model.name} — ${version.name}`);
      setMode("downloads");
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const handleCancelCivitaiDownload = async (
    task: CivitaiDownloadTask
  ): Promise<void> => {
    try {
      await window.kirea.cancelCivitaiDownload(task.id);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const handleRetryCivitaiDownload = async (
    task: CivitaiDownloadTask
  ): Promise<void> => {
    try {
      const next = await window.kirea.retryCivitaiDownload(task.id);
      if (!next) onToast("Download task is no longer available.", "error");
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const openDetails = useCallback(
    (model: CivitaiModelSummary): void => {
      const requestId = ++detailsRequestRef.current;
      setDetailsTarget(model);
      setDetailsData(model);
      setDetailsLoading(true);
      window.kirea
        .getCivitaiModelDetails(model.id)
        .then((details) => {
          if (requestId === detailsRequestRef.current) setDetailsData(details);
        })
        .catch((err) => {
          if (requestId === detailsRequestRef.current) {
            onToast(err instanceof Error ? err.message : String(err), "error");
          }
        })
        .finally(() => {
          if (requestId === detailsRequestRef.current) setDetailsLoading(false);
        });
    },
    [onToast]
  );

  const closeDetails = (): void => {
    detailsRequestRef.current += 1;
    setDetailsTarget(null);
    setDetailsData(null);
    setDetailsLoading(false);
  };

  const handleScan = async (): Promise<void> => {
    setScanning(true);
    try {
      await onScanModels();
      onToast("Model catalog scan completed.");
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setScanning(false);
    }
  };

  const handleStartCatalogDownload = async (
    item: CuratedModelCatalogItem
  ): Promise<void> => {
    try {
      await window.kirea.startModelDownload(item.id);
      onToast(`Started downloading ${item.name}`);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const isManagedPath = (filePath: string): boolean => {
    if (!managedModelsRootHint) return false;
    return filePath.toLowerCase().startsWith(managedModelsRootHint.toLowerCase());
  };

  const openEditor = (model: ModelRecord): void => {
    const info = getEffectiveModelInfo(model);
    setEditTarget(model);
    setEditDraft({
      displayName: model.metadata?.displayName ?? "",
      description: model.metadata?.description || info.description,
      architectureOverride: model.metadata?.architectureOverride ?? "auto",
      baseModel: model.metadata?.baseModel || info.baseModel || "",
      previewMode: model.metadata?.previewMode ?? "auto",
      triggerWords: info.triggerWords.join(", "),
      tags: (model.metadata?.tags ?? []).join(", "),
      notes: model.metadata?.notes ?? "",
    });
  };

  const closeEditor = (): void => {
    setEditTarget(null);
    setEditDraft(null);
  };

  const saveMetadata = async (): Promise<void> => {
    if (!editTarget || !editDraft) return;
    setSavingMeta(true);
    try {
      const patch: ModelMetadataPatch = {
        displayName: editDraft.displayName.trim() || null,
        description: editDraft.description.trim(),
        architectureOverride:
          editDraft.architectureOverride === "auto"
            ? null
            : editDraft.architectureOverride,
        baseModel: editDraft.baseModel.trim() || null,
        previewMode: editDraft.previewMode,
        triggerWords: splitList(editDraft.triggerWords),
        tags: splitList(editDraft.tags),
        notes: editDraft.notes.trim(),
      };
      const updated = await onUpdateModelMetadata(editTarget.id, patch);
      setEditTarget(updated);
      onToast("Model metadata saved.");
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSavingMeta(false);
    }
  };

  const importPreview = async (): Promise<void> => {
    if (!editTarget) return;
    setImportingPreview(true);
    try {
      const updated = await onImportPreview(editTarget.id);
      if (updated) {
        setEditTarget(updated);
        setEditDraft((prev) => (prev ? { ...prev, previewMode: "custom" } : prev));
        onToast("Custom preview image imported.");
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setImportingPreview(false);
    }
  };

  const toggleFavorite = async (model: ModelRecord): Promise<void> => {
    try {
      await onUpdateModelMetadata(model.id, {
        favorite: !(model.metadata?.favorite ?? false),
      });
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    }
  };
  const details = detailsData ?? detailsTarget;
  const detailVersions = details?.versions ?? [];
  const sampleImages = Array.from(
    new Set(detailVersions.flatMap((version) => version.sampleImageUrls))
  ).slice(0, 8);

  return (
    <div className="space-y-5">
      <div className="sticky -top-6 z-10 -mx-6 space-y-3 border-b border-border bg-bg px-6 pb-3 pt-6">
        <SectionHeader
          title="Model Vault & Civitai Hub"
          subtitle="Non-destructive discovery across existing ComfyUI folders, Civitai browsing, and verified downloads."
          actions={
            mode === "vault" ? (
              <Button
                variant="secondary"
                loading={scanning}
                onClick={() => void handleScan()}
              >
                <RefreshCw className="w-4 h-4" />
                Rescan Models
              </Button>
            ) : mode === "hub" ? (
              <Button
                variant="secondary"
                loading={hubLoading}
                onClick={() => void fetchHub(null, false)}
              >
                <RefreshCw className="w-4 h-4" />
                Refresh Hub
              </Button>
            ) : undefined
          }
        />

        <div className="inline-flex flex-wrap gap-1 rounded-md border border-border bg-surface p-1">
          {(
            [
              ["vault", "01 // LOCAL VAULT"],
              ["hub", "02 // CIVITAI HUB"],
              ["downloads", "03 // DOWNLOADS"],
            ] as Array<[PageMode, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={mode === id}
              onClick={() => setMode(id)}
              className={`inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-[3px] border px-3 font-mono text-[11px] font-medium uppercase tracking-[0.08em] transition-colors ${
                mode === id
                  ? "border-border-strong bg-surface-subtle text-fg"
                  : "border-transparent text-fg-muted hover:text-fg hover:bg-surface-subtle"
              }`}
            >
              {label}
              {id === "downloads" && activeDownloads.length > 0 && (
                <span
                  className={`inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-[3px] text-[10px] font-bold ${
                    mode === id
                      ? "bg-accent-solid text-white"
                      : "bg-warning-soft text-warning border border-warning/30"
                  }`}
                >
                  {activeDownloads.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {mode === "vault" && (
        <ModelVaultView
          models={models}
          filteredModels={filteredModels}
          catalog={catalog}
          downloads={downloads}
          hardware={hardware}
          workflowNames={workflowNames}
          vaultTab={vaultTab}
          setVaultTab={setVaultTab}
          category={category}
          setCategory={setCategory}
          architecture={architecture}
          setArchitecture={setArchitecture}
          search={search}
          setSearch={setSearch}
          favoritesOnly={favoritesOnly}
          setFavoritesOnly={setFavoritesOnly}
          isManagedPath={isManagedPath}
          onUseModel={onUseModel}
          onToggleFavorite={(model) => void toggleFavorite(model)}
          onOpenEditor={openEditor}
          onRequestDelete={setDeleteTarget}
          onStartCatalogDownload={(item) => void handleStartCatalogDownload(item)}
          onOpenHub={() => setMode("hub")}
          onScan={() => void handleScan()}
          onOpenPath={(p) => void window.kirea.openPath(p)}
        />
      )}

      {mode === "hub" && (
        <CivitaiHubView
          hubQuery={hubQuery}
          setHubQuery={setHubQuery}
          hubType={hubType}
          setHubType={setHubType}
          hubBase={hubBase}
          setHubBase={setHubBase}
          hubSort={hubSort}
          setHubSort={setHubSort}
          hubItems={hubItems}
          hubCursor={hubCursor}
          hubLoading={hubLoading}
          hubLoadingMore={hubLoadingMore}
          hubLoaded={hubLoaded}
          hubError={hubError}
          civitaiDownloads={civitaiDownloads}
          versionSelection={versionSelection}
          setVersionSelection={setVersionSelection}
          selectedVersionFor={selectedVersionFor}
          isVersionInstalled={isVersionInstalled}
          onFetchHub={(cursor, append) => void fetchHub(cursor, append)}
          onOpenDetails={(m) => void openDetails(m)}
          onStartDownload={(m, v) => void handleStartCivitaiDownload(m, v)}
          onCancelDownload={(t) => void handleCancelCivitaiDownload(t)}
          onOpenDownloads={() => setMode("downloads")}
        />
      )}

      {mode === "downloads" && (
        <DownloadsQueueView
          civitaiDownloads={civitaiDownloads}
          activeDownloads={activeDownloads}
          completedDownloads={completedDownloads}
          onSwitchToHub={() => setMode("hub")}
          onSwitchToVault={() => setMode("vault")}
          onCancelDownload={(t) => void handleCancelCivitaiDownload(t)}
          onRetryDownload={(t) => void handleRetryCivitaiDownload(t)}
          onOpenPath={(p) => void window.kirea.openPath(p)}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) {
            void onDeleteModel(deleteTarget.filePath);
          }
        }}
        title="Delete App-Managed Model"
        description={`Remove '${deleteTarget?.name ?? ""}' (${formatBytes(deleteTarget?.sizeBytes ?? 0)}) from Kirea Studio's managed models directory?`}
        confirmLabel="Delete File"
        danger
      />

      <CivitaiDetailsModal
        details={details}
        detailVersions={detailVersions}
        sampleImages={sampleImages}
        detailsLoading={detailsLoading}
        civitaiDownloads={civitaiDownloads}
        selectedVersionFor={selectedVersionFor}
        setVersionSelection={setVersionSelection}
        isVersionInstalled={isVersionInstalled}
        onClose={closeDetails}
        onStartDownload={(m, v) => void handleStartCivitaiDownload(m, v)}
        onCancelDownload={(t) => void handleCancelCivitaiDownload(t)}
        onOpenDownloads={() => setMode("downloads")}
        onOpenExternal={(u) => void window.kirea.openExternalUrl(u)}
      />

      <ModelEditorModal
        editTarget={editTarget}
        editDraft={editDraft}
        setEditDraft={setEditDraft}
        savingMeta={savingMeta}
        importingPreview={importingPreview}
        onClose={closeEditor}
        onToggleFavorite={(model) => void toggleFavorite(model)}
        onImportPreview={() => void importPreview()}
        onSaveMetadata={() => void saveMetadata()}
      />
    </div>
  );
};
