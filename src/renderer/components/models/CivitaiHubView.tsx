import React, { useEffect, useRef } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Flame,
  ImageOff,
  Library,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  ThumbsUp,
  TrendingUp,
  Wand2,
} from "lucide-react";
import {
  CIVITAI_BASE_MODELS,
  CIVITAI_MODEL_TYPES,
  CIVITAI_MODEL_TYPE_LABELS,
  CIVITAI_PERIODS,
  CIVITAI_SORTS,
  type CivitaiBaseModel,
  type CivitaiDownloadTask,
  type CivitaiModelSummary,
  type CivitaiModelType,
  type CivitaiPeriod,
  type CivitaiSort,
  type CivitaiVersion,
} from "../../../shared/civitai";
import {
  ARCHITECTURE_LABELS,
  architectureBadgeTone,
} from "../../../shared/model-utils";
import { formatBytes } from "../../utils/format";
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
  downloadPercent,
  formatCount,
  isActiveDownload,
  RemotePreview,
} from "./models-helpers";

export type HubTab =
  | "hot"
  | "trending"
  | "checkpoints"
  | "loras"
  | "recent"
  | "installed";
export type HubProvider = "civitai" | "huggingface" | "seaart" | "local";

const HUB_TABS: { id: HubTab; label: string; icon: React.ReactNode }[] = [
  { id: "hot", label: "Hot Models", icon: <Flame className="w-3.5 h-3.5" /> },
  { id: "trending", label: "Trending", icon: <TrendingUp className="w-3.5 h-3.5" /> },
  { id: "checkpoints", label: "Checkpoints", icon: <Sparkles className="w-3.5 h-3.5" /> },
  { id: "loras", label: "LoRAs", icon: <Wand2 className="w-3.5 h-3.5" /> },
  { id: "recent", label: "Recently Updated", icon: <Clock className="w-3.5 h-3.5" /> },
  { id: "installed", label: "Installed", icon: <Library className="w-3.5 h-3.5" /> },
];

const HUB_PROVIDERS: { id: HubProvider; label: string }[] = [
  { id: "civitai", label: "Civitai" },
  { id: "huggingface", label: "Hugging Face" },
  { id: "seaart", label: "SeaArt" },
  { id: "local", label: "Local" },
];

export type HubCategoryChip =
  | "ALL"
  | "CHARACTER"
  | "STYLE"
  | "CONCEPT"
  | "CLOTHING"
  | "BASE MODEL"
  | "BACKGROUND"
  | "TOOL"
  | "POSES"
  | "ASSETS"
  | "VEHICLE"
  | "BUILDINGS"
  | "OBJECTS"
  | "ACTION"
  | "ANIMAL";

export const CIVITAI_CATEGORY_CHIPS: HubCategoryChip[] = [
  "ALL",
  "CHARACTER",
  "STYLE",
  "CONCEPT",
  "CLOTHING",
  "BASE MODEL",
  "BACKGROUND",
  "TOOL",
  "POSES",
  "ASSETS",
  "VEHICLE",
  "BUILDINGS",
  "OBJECTS",
  "ACTION",
  "ANIMAL",
];

export const CIVITAI_BASE_MODEL_SUB_OPTIONS = [
  "SDXL 1.0",
  "Illustrious",
  "Pony",
  "Flux.1 D",
  "SD 1.5",
  "Wan Video",
];

export const CIVITAI_PERIOD_PILLS: { id: CivitaiPeriod; label: string }[] = [
  { id: "Day", label: "DAY" },
  { id: "Week", label: "WEEK" },
  { id: "Month", label: "MONTH" },
  { id: "Year", label: "YEAR" },
  { id: "AllTime", label: "ALL TIME" },
];

const PERIOD_LABELS: Record<CivitaiPeriod, string> = {
  Day: "Today",
  Week: "This week",
  Month: "This month",
  Year: "This year",
  AllTime: "All time",
};

function civitaiModelUrl(model: CivitaiModelSummary): string {
  return `https://civitai.com/models/${model.id}`;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff) || diff < 0) return "just now";
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

interface CivitaiHubViewProps {
  hubQuery: string;
  setHubQuery: (q: string) => void;
  hubType: "all" | CivitaiModelType;
  setHubType: (t: "all" | CivitaiModelType) => void;
  hubBase: "all" | CivitaiBaseModel;
  setHubBase: (b: "all" | CivitaiBaseModel) => void;
  hubSort: CivitaiSort;
  setHubSort: (s: CivitaiSort) => void;
  hubPeriod: CivitaiPeriod;
  setHubPeriod: (p: CivitaiPeriod) => void;
  hubCategoryChip: HubCategoryChip;
  setHubCategoryChip: (c: HubCategoryChip) => void;
  hubBaseModelSub: string;
  setHubBaseModelSub: (b: string) => void;
  hubTab: HubTab;
  selectHubTab: (tab: HubTab) => void;
  hubProvider: HubProvider;
  selectHubProvider: (provider: HubProvider) => void;
  hubUpdatedAt: string | null;
  matureEnabled: boolean;
  onSetMature: (enabled: boolean) => void;
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
  onUseInCreate: (version: CivitaiVersion) => void;
  onOpenExternal: (url: string) => void;
  onScanLocal: () => void;
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
  hubPeriod,
  setHubPeriod,
  hubCategoryChip,
  setHubCategoryChip,
  hubBaseModelSub,
  setHubBaseModelSub,
  hubTab,
  selectHubTab,
  hubProvider,
  selectHubProvider,
  hubUpdatedAt,
  matureEnabled,
  onSetMature,
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
  onUseInCreate,
  onOpenExternal,
  onScanLocal,
}) => {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const { showContextMenu } = useContextMenu();

  const handleCivitaiContextMenu = (
    e: React.MouseEvent,
    model: CivitaiModelSummary,
    version: CivitaiVersion | null,
    installed: boolean
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const civitaiUrl = `https://civitai.com/models/${model.id}`;
    const activeDl = version
      ? civitaiDownloads.find(
          (t) =>
            t.versionId === version.id &&
            isActiveDownload(t.status)
        )
      : null;

    const items: ContextMenuItem[] = [
      {
        id: "civitai-details",
        label: "View Model Details & Versions",
        icon: <Sparkles className="w-3.5 h-3.5" />,
        onClick: () => onOpenDetails(model),
      },
      {
        id: "civitai-web",
        label: "Open on Civitai.com",
        icon: <ExternalLink className="w-3.5 h-3.5" />,
        onClick: () => onOpenExternal(civitaiUrl),
        separator: true,
      },
    ];

    if (installed && version) {
      items.push({
        id: "civitai-use",
        label: "Use in Creation Studio",
        icon: <Wand2 className="w-3.5 h-3.5" />,
        onClick: () => onUseInCreate(version),
      });
    } else if (version) {
      items.push({
        id: "civitai-dl",
        label: activeDl ? "Downloading..." : "Download Selected Variant",
        icon: <Download className="w-3.5 h-3.5" />,
        disabled: Boolean(activeDl),
        disabledReason: activeDl ? "Download in progress" : undefined,
        onClick: () => onStartDownload(model, version),
      });
    }

    items.push(
      {
        id: "civitai-copy-name",
        label: "Copy Model Name",
        icon: <Copy className="w-3.5 h-3.5" />,
        onClick: () => {
          void navigator.clipboard.writeText(model.name);
        },
      },
      {
        id: "civitai-copy-id",
        label: "Copy Model ID",
        icon: <Copy className="w-3.5 h-3.5" />,
        onClick: () => {
          void navigator.clipboard.writeText(String(model.id));
        },
      },
      {
        id: "civitai-copy-url",
        label: "Copy Civitai URL",
        icon: <Copy className="w-3.5 h-3.5" />,
        onClick: () => {
          void navigator.clipboard.writeText(civitaiUrl);
        },
      }
    );

    showContextMenu({
      x: e.clientX,
      y: e.clientY,
      title: model.name,
      items,
    });
  };

  const handleEmptyCivitaiContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const items: ContextMenuItem[] = [
      {
        id: "civitai-refresh",
        label: "Refresh Civitai Feed",
        icon: <RefreshCw className="w-3.5 h-3.5" />,
        onClick: () => onFetchHub(null, false),
      },
      {
        id: "civitai-downloads",
        label: "View Downloads",
        icon: <Download className="w-3.5 h-3.5" />,
        onClick: onOpenDownloads,
        separator: true,
      },
      {
        id: "civitai-to-hf",
        label: "Browse Hugging Face Hub",
        onClick: () => selectHubProvider("huggingface"),
      },
      {
        id: "civitai-to-vault",
        label: "Switch to Installed Models Vault",
        onClick: () => selectHubProvider("local"),
      },
    ];

    showContextMenu({
      x: e.clientX,
      y: e.clientY,
      title: "Civitai Hub",
      items,
    });
  };

  // Automatic infinite scrolling via IntersectionObserver
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hubCursor || hubLoading || hubLoadingMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onFetchHub(hubCursor, true);
        }
      },
      { rootMargin: "350px" }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hubCursor, hubLoading, hubLoadingMore, onFetchHub]);

  return (
    <div onContextMenu={handleEmptyCivitaiContextMenu} className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div
        role="tablist"
        aria-label="Model discovery tabs"
        className="flex flex-wrap items-center gap-1 p-1 rounded-xl bg-surface border border-border"
      >
        {HUB_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={
              (hubTab === tab.id && hubProvider !== "seaart") ||
              (tab.id === "installed" && hubProvider === "local")
            }
            onClick={() => selectHubTab(tab.id)}
            className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium transition-colors ${
              (hubTab === tab.id && hubProvider !== "seaart") ||
              (tab.id === "installed" && hubProvider === "local")
                ? "bg-accent-solid text-white"
                : "text-fg-muted hover:text-fg hover:bg-surface-subtle"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 p-1 rounded-xl bg-surface border border-border">
          {HUB_PROVIDERS.map((provider) => (
            <button
              key={provider.id}
              type="button"
              onClick={() => selectHubProvider(provider.id)}
              className={`h-7 px-2.5 rounded-lg text-[11px] font-semibold transition-colors ${
                hubProvider === provider.id
                  ? "bg-surface-subtle text-fg shadow-sm"
                  : "text-fg-subtle hover:text-fg"
              }`}
            >
              {provider.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => onSetMature(!matureEnabled)}
          className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border text-[11px] font-semibold transition-colors ${
            matureEnabled
              ? "bg-warning-soft text-warning border-warning/40"
              : "bg-surface text-fg-subtle border-border hover:text-fg"
          }`}
          title={
            matureEnabled
              ? "Mature content is visible. Click to hide it."
              : "Mature content is blurred or hidden. Click to enable 18+ content."
          }
        >
          <ShieldAlert className="w-3.5 h-3.5" />
          18+
        </button>
      </div>
    </div>

    {hubProvider === "seaart" ? (
      <Card className="p-5 space-y-3">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-warning-soft text-warning shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="space-y-1.5">
            <h3 className="text-sm font-semibold text-fg">SeaArt discovery</h3>
            <p className="text-xs text-fg-muted leading-relaxed max-w-2xl">
              SeaArt does not publish an official public model-discovery API, so this
              build does not scrape private endpoints or fabricate trending data. Browse
              the official SeaArt model library in your browser, download files through
              SeaArt's own terms, place them in the active ComfyUI models tree, then
              rescan the vault. Installing through the app remains an explicit action.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            onClick={() => onOpenExternal("https://www.seaart.ai/models")}
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Open SeaArt Model Library
          </Button>
          <Button variant="secondary" size="sm" onClick={onScanLocal}>
            <Library className="w-3.5 h-3.5" />
            Rescan Local Models
          </Button>
        </div>
        <p className="text-[11px] text-fg-subtle">
          Provider attribution: SeaArt content stays on SeaArt. Kirea Studio only reads
          what you download and place locally.
        </p>
      </Card>
    ) : (
      <>
        {/* Horizontal Category Filter Bar */}
        <div className="space-y-2">
          <div
            role="toolbar"
            aria-label="Civitai Categories"
            className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin"
          >
            {CIVITAI_CATEGORY_CHIPS.map((chip) => {
              const isActive = hubCategoryChip === chip;
              return (
                <button
                  key={chip}
                  type="button"
                  onClick={() => setHubCategoryChip(chip)}
                  aria-pressed={isActive}
                  className={`shrink-0 font-mono text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-none select-none cursor-pointer transition-none ${
                    isActive
                      ? "bg-[#1E3BFF] text-[#F2F2EE] border-2 border-[#F2F2EE]"
                      : "bg-[#0B0C10] text-[#F2F2EE] border-2 border-[#F2F2EE]/30 hover:border-[#F2F2EE]"
                  }`}
                >
                  {chip}
                </button>
              );
            })}
          </div>

          {/* Crisp Sub-Selector when BASE MODEL is active */}
          {hubCategoryChip === "BASE MODEL" && (
            <div className="flex items-center gap-1.5 overflow-x-auto p-1.5 bg-[#0B0C10] border-2 border-[#1E3BFF] shadow-[2px_2px_0px_#1E3BFF]">
              <span className="font-mono text-[10px] font-bold text-[#1E3BFF] uppercase tracking-wider px-1 shrink-0">
                BASE_ARCH:
              </span>
              {CIVITAI_BASE_MODEL_SUB_OPTIONS.map((opt) => {
                const isSubActive = hubBaseModelSub === opt;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setHubBaseModelSub(opt)}
                    className={`shrink-0 font-mono text-[11px] font-bold uppercase px-2 py-0.5 rounded-none cursor-pointer transition-none ${
                      isSubActive
                        ? "bg-[#1E3BFF] text-[#F2F2EE] border-2 border-[#F2F2EE]"
                        : "bg-[#0B0C10] text-[#F2F2EE]/80 border-2 border-[#F2F2EE]/30 hover:border-[#F2F2EE]"
                    }`}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="p-3 rounded-none bg-surface border-2 border-border flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-fg-subtle absolute left-3 top-2.5" strokeWidth={2} />
            <Input
              value={hubQuery}
              onChange={(e) => setHubQuery(e.target.value)}
              aria-label="Search Civitai"
              placeholder="Search Civitai models, creators, styles..."
              className="pl-9 rounded-none border-2"
            />
          </div>
          <div className="w-36 shrink-0">
            <Select
              value={hubType}
              onChange={(e) => setHubType(e.target.value as "all" | CivitaiModelType)}
              className="h-9 text-xs rounded-none border-2"
              aria-label="Filter by model type"
            >
              <option value="all">All types</option>
              {CIVITAI_MODEL_TYPES.map((type) => (
                <option key={type} value={type}>
                  {CIVITAI_MODEL_TYPE_LABELS[type] ?? type}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-36 shrink-0">
            <Select
              value={hubBase}
              onChange={(e) => setHubBase(e.target.value as "all" | CivitaiBaseModel)}
              className="h-9 text-xs rounded-none border-2"
              aria-label="Filter by base architecture"
            >
              <option value="all">All architectures</option>
              {CIVITAI_BASE_MODELS.map((base) => (
                <option key={base} value={base}>
                  {base}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-36 shrink-0">
            <Select
              value={hubSort}
              onChange={(e) => setHubSort(e.target.value as CivitaiSort)}
              className="h-9 text-xs rounded-none border-2"
              aria-label="Sort results"
            >
              {CIVITAI_SORTS.map((sort) => (
                <option key={sort} value={sort}>
                  {sort}
                </option>
              ))}
            </Select>
          </div>

          {/* Visible Period Selector Pill Bar */}
          <div
            role="group"
            aria-label="Time period selector"
            className="flex items-center gap-1 bg-[#0B0C10] p-1 border-2 border-border"
          >
            <span className="font-mono text-[10px] font-bold uppercase text-fg-subtle px-1 shrink-0">
              PERIOD:
            </span>
            {CIVITAI_PERIOD_PILLS.map((pill) => {
              const isPeriodActive = hubPeriod === pill.id;
              return (
                <button
                  key={pill.id}
                  type="button"
                  onClick={() => setHubPeriod(pill.id)}
                  aria-pressed={isPeriodActive}
                  className={`font-mono text-[11px] font-bold uppercase px-2 py-0.5 rounded-none cursor-pointer transition-none ${
                    isPeriodActive
                      ? "bg-[#1E3BFF] text-[#F2F2EE] border-2 border-[#F2F2EE]"
                      : "bg-[#0B0C10] text-[#F2F2EE]/70 border-2 border-[#F2F2EE]/30 hover:border-[#F2F2EE] hover:text-[#F2F2EE]"
                  }`}
                >
                  {pill.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <p className="text-[11px] text-fg-subtle inline-flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border border-border bg-surface-subtle text-fg-muted font-semibold">
              <ExternalLink className="w-3 h-3" />
              Source: Civitai
            </span>
            Results are fetched live from Civitai's public models API.
            {hubUpdatedAt ? ` Updated ${relativeTime(hubUpdatedAt)}.` : ""}
          </p>
          {!matureEnabled && (
            <p className="text-[11px] text-fg-subtle inline-flex items-center gap-1">
              <ImageOff className="w-3 h-3" />
              Mature previews are blurred while 18+ is off.
            </p>
          )}
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
            <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(230px,1fr))]">
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
                const previewHidden = model.nsfw && !matureEnabled;

                return (
                  <Card
                    key={model.id}
                    className="flex flex-col overflow-hidden border border-border/80 hover:border-accent/60 transition-colors"
                    onContextMenu={(e) =>
                      handleCivitaiContextMenu(e, model, version, installed)
                    }
                  >
                      <button
                        type="button"
                        onClick={() => onOpenDetails(model)}
                        className="relative flex items-center justify-center w-full aspect-[2/3] bg-well overflow-hidden group cursor-pointer p-0"
                        title="Open model details"
                      >
                        <RemotePreview
                          url={model.primaryPreviewUrl}
                          alt={`${model.name} preview`}
                          className={`w-full h-full transition-transform duration-300 group-hover:scale-[1.03] ${
                            previewHidden ? "blur-xl scale-110 opacity-70" : ""
                          }`}
                        />
                        {previewHidden && (
                          <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-4 text-center bg-black/20">
                            <ImageOff className="w-5 h-5 text-white/90" />
                            <span className="text-[11px] font-semibold text-white/95">
                              Mature preview hidden
                            </span>
                            <span className="text-[10px] text-white/70">
                              Enable 18+ to reveal
                            </span>
                          </span>
                        )}
                        <div className="absolute top-2 left-2 flex flex-wrap gap-1 max-w-[calc(100%-1rem)] pointer-events-none">
                          <Badge tone="accent">{CIVITAI_MODEL_TYPE_LABELS[model.type] ?? model.type}</Badge>
                          {version && version.architecture !== "unknown" && (
                            <Badge tone={architectureBadgeTone(version.architecture)}>
                              {ARCHITECTURE_LABELS[version.architecture]}
                            </Badge>
                          )}
                          {model.nsfw && <Badge tone="danger">18+</Badge>}
                        </div>
                        {installed && (
                          <div className="absolute top-2 right-2 pointer-events-none">
                            <Badge tone="success">
                              <CheckCircle2 className="w-3 h-3" />
                              Installed
                            </Badge>
                          </div>
                        )}
                      </button>

                      <div className="p-3 flex flex-col gap-2 flex-1">
                        <div className="flex items-start justify-between gap-1.5 min-w-0">
                          <div className="min-w-0 flex-1">
                            <h3
                              className="text-sm font-semibold text-fg truncate hover:text-accent cursor-pointer"
                              title={model.name}
                              onClick={() => onOpenDetails(model)}
                            >
                              {model.name}
                            </h3>
                            <p className="text-[11px] text-fg-subtle truncate">
                              {model.creator ? `by ${model.creator}` : "Unknown creator"}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 text-[11px] text-fg-muted tabular-nums shrink-0 pt-0.5" title={`${model.stats.downloads} downloads`}>
                            <Download className="w-3 h-3 text-fg-subtle" />
                            {formatCount(model.stats.downloads)}
                          </div>
                        </div>

                        {model.versions.length > 1 && (
                          <Select
                            value={String(version?.id ?? "")}
                            onChange={(e) =>
                              setVersionSelection((prev) => ({
                                ...prev,
                                [model.id]: Number(e.target.value),
                              }))
                            }
                            className="h-7 text-[11px] py-0"
                            aria-label={`Select version of ${model.name}`}
                          >
                            {model.versions.map((v) => (
                              <option key={v.id} value={v.id}>
                                {v.name} {v.baseModel ? `· ${v.baseModel}` : ""}
                              </option>
                            ))}
                          </Select>
                        )}

                        <div className="flex items-center justify-between gap-2 text-[11px] text-fg-muted mt-auto pt-2 border-t border-border/70">
                          <span className="tabular-nums font-medium text-fg-subtle truncate">
                            {version && version.sizeBytes > 0
                              ? formatBytes(version.sizeBytes)
                              : "Size unknown"}
                            {anyInstalled && !installed && (
                              <span className="text-success"> (other installed)</span>
                            )}
                          </span>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => onOpenDetails(model)}
                            className="h-6 px-2 text-[11px]"
                          >
                            Details
                          </Button>
                        </div>

                        {installed ? (
                          <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                            <Badge tone="success" className="justify-center py-1 text-[11px]">
                              <CheckCircle2 className="w-3 h-3" />
                              Installed
                            </Badge>
                            <Button
                              size="sm"
                              variant="primary"
                              disabled={!version}
                              onClick={() => {
                                if (version) onUseInCreate(version);
                              }}
                              className="h-7 text-xs px-2"
                            >
                              <Wand2 className="w-3 h-3" />
                              Use
                            </Button>
                          </div>
                        ) : activeTask ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={onOpenDownloads}
                            className="h-7 text-xs"
                          >
                            <Loader2 className="w-3 h-3 animate-spin" />
                            {downloadPercent(activeTask)}%
                          </Button>
                        ) : version && !version.downloadable ? (
                          <Badge tone="danger" className="justify-center py-1 text-[11px]">
                            Unavailable
                          </Badge>
                        ) : (
                          <Button
                            size="sm"
                            variant="primary"
                            disabled={!version}
                            onClick={() => {
                              if (version) onStartDownload(model, version);
                            }}
                            className="h-7 text-xs"
                          >
                            <Download className="w-3.5 h-3.5" />
                            Download
                          </Button>
                        )}
                      </div>
                    </Card>
                );
              })}
            </div>

            {/* Infinite scroll sentinel */}
            {hubCursor && (
              <div ref={sentinelRef} className="flex flex-col items-center justify-center py-6 gap-2">
                {hubLoadingMore ? (
                  <div className="flex items-center gap-2 text-xs text-fg-muted">
                    <Loader2 className="w-4 h-4 animate-spin text-accent" />
                    <span>Loading more models...</span>
                  </div>
                ) : (
                  <div className="h-4" />
                )}
                {hubError && (
                  <div className="flex items-center gap-2 text-xs text-danger">
                    <span>{hubError}</span>
                    <Button size="sm" variant="secondary" onClick={() => onFetchHub(hubCursor, true)}>
                      Retry
                    </Button>
                  </div>
                )}
              </div>
            )}

            {!hubCursor && hubItems.length > 0 && !hubLoading && (
              <div className="text-center py-8 text-xs text-fg-subtle">
                All {hubItems.length} models loaded
              </div>
            )}
          </>
        )}
      </>
    )}
  </div>
);
};
