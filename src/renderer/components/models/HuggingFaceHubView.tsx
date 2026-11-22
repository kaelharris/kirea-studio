import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Cpu,
  Download,
  ExternalLink,
  FileText,
  HardDrive,
  HelpCircle,
  Layers,
  Loader2,
  Lock,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  XCircle,
} from "lucide-react";
import type { DownloadTask, ModelCategory } from "../../../shared/types";
import type {
  HuggingFaceCheck,
  HuggingFaceCompatibilityReport,
  HuggingFaceFile,
  HuggingFaceRepoDetails,
  HuggingFaceRepoSummary,
} from "../../../shared/huggingface";
import {
  HF_COMPATIBILITY_LABELS,
  normalizeHuggingFaceRepoId,
} from "../../../shared/huggingface";
import { formatBytes } from "../../utils/format";
import { Badge, Button, Card, EmptyState, Input, Modal, Select, useContextMenu, type ContextMenuItem } from "../ui/Primitives";
import { formatCount } from "./models-helpers";
import type { HubProvider } from "./CivitaiHubView";

interface HuggingFaceHubViewProps {
  tokenSet: boolean;
  hfDownloads: DownloadTask[];
  onSelectProvider: (provider: HubProvider) => void;
  onOpenDownloads: () => void;
  onOpenSettings: () => void;
  onToast: (msg: string, tone?: "info" | "error") => void;
}

type TaskFilter = "all" | "text-to-video" | "image-to-video";
type ArchitectureFilter = "all" | "wan_video" | "ltx_video" | "other";
type SortFilter = "downloads" | "likes" | "lastModified";

const STATUS_TONE: Record<
  HuggingFaceCompatibilityReport["status"],
  "success" | "warning" | "danger" | "neutral"
> = {
  COMPATIBLE: "success",
  CONDITIONAL: "warning",
  INCOMPATIBLE: "danger",
  UNKNOWN: "neutral",
};

const CHECK_TONE: Record<HuggingFaceCheck["status"], "success" | "warning" | "danger" | "neutral"> = {
  pass: "success",
  warn: "warning",
  fail: "danger",
  unknown: "neutral",
};

const CATEGORY_LABELS: Record<string, string> = {
  architecture: "Architecture",
  loader: "Loader & nodes",
  dependencies: "Dependencies",
  hardware: "Hardware",
  disk: "Disk",
  duplicate: "Duplicate",
  auth: "Authentication",
  metadata: "Metadata",
};

function CheckIcon({ status }: { status: HuggingFaceCheck["status"] }): React.ReactElement {
  if (status === "pass") return <CheckCircle2 className="w-4 h-4 text-success shrink-0" />;
  if (status === "warn") return <AlertTriangle className="w-4 h-4 text-warning shrink-0" />;
  if (status === "fail") return <XCircle className="w-4 h-4 text-danger shrink-0" />;
  return <HelpCircle className="w-4 h-4 text-fg-subtle shrink-0" />;
}

function fileCategoryFor(file: HuggingFaceFile, architecture: string): ModelCategory {
  if (file.kind === "vae") return "vae";
  if (file.kind === "text_encoder") return "text_encoder";
  if (file.kind === "lora") return "lora";
  if (file.kind === "diffusion_model") return "diffusion_model";
  if (file.kind === "checkpoint") {
    return architecture === "wan_video" ? "diffusion_model" : "checkpoint";
  }
  return "checkpoint";
}

function providerBar(
  onSelectProvider: (provider: HubProvider) => void,
  onOpenDownloads: () => void,
  active: HubProvider
): React.ReactElement {
  const providers: Array<{ id: HubProvider; label: string }> = [
    { id: "civitai", label: "Civitai" },
    { id: "huggingface", label: "Hugging Face" },
    { id: "seaart", label: "SeaArt" },
    { id: "local", label: "Local" },
  ];
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-1 p-1 rounded-xl bg-surface border border-border">
        {providers.map((provider) => (
          <button
            key={provider.id}
            type="button"
            onClick={() => onSelectProvider(provider.id)}
            className={`h-7 px-2.5 rounded-lg text-[11px] font-semibold transition-colors ${
              active === provider.id
                ? "bg-surface-subtle text-fg shadow-sm"
                : "text-fg-subtle hover:text-fg"
            }`}
          >
            {provider.label}
          </button>
        ))}
      </div>
      <Button variant="secondary" size="sm" onClick={onOpenDownloads}>
        <Download className="w-3.5 h-3.5" />
        Downloads
      </Button>
    </div>
  );
}

export const HuggingFaceHubView: React.FC<HuggingFaceHubViewProps> = ({
  tokenSet,
  hfDownloads,
  onSelectProvider,
  onOpenDownloads,
  onOpenSettings,
  onToast,
}) => {
  const [query, setQuery] = useState("");
  const [taskFilter, setTaskFilter] = useState<TaskFilter>("text-to-video");
  const [architecture, setArchitecture] = useState<ArchitectureFilter>("all");
  const [sort, setSort] = useState<SortFilter>("downloads");
  const [items, setItems] = useState<HuggingFaceRepoSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const [repoOpen, setRepoOpen] = useState(false);
  const [details, setDetails] = useState<HuggingFaceRepoDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [report, setReport] = useState<HuggingFaceCompatibilityReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [override, setOverride] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [started, setStarted] = useState(false);
  const checkRef = useRef(0);

  const fetchResults = useCallback(
    async (nextCursor: string | null, append: boolean): Promise<void> => {
      const requestId = ++requestRef.current;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const result = await window.kirea.searchHuggingFaceModels({
          query: query.trim() || undefined,
          task: taskFilter,
          architecture,
          sort,
          limit: 24,
          cursor: nextCursor,
        });
        if (requestId !== requestRef.current) return;
        setItems((prev) => (append ? [...prev, ...result.items] : result.items));
        setCursor(result.nextCursor);
        setLoaded(true);
      } catch (err) {
        if (requestId !== requestRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
        if (!append) setItems([]);
        setLoaded(true);
      } finally {
        if (requestId === requestRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [query, taskFilter, architecture, sort]
  );

  useEffect(() => {
    void fetchResults(null, false);
    // Initial browse; manual search reuses the current filters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskFilter, architecture, sort]);

  const runCheck = useCallback(
    async (target: HuggingFaceRepoDetails, paths: string[]): Promise<void> => {
      if (paths.length === 0) {
        setReport(null);
        return;
      }
      const requestId = ++checkRef.current;
      setChecking(true);
      try {
        const next = await window.kirea.checkHuggingFaceCompatibility({
          repoId: target.id,
          revision: target.revision,
          selectedPaths: paths,
        });
        if (requestId === checkRef.current) {
          setReport(next);
          setAcknowledged(false);
          setOverride(false);
        }
      } catch (err) {
        if (requestId === checkRef.current) {
          setReport(null);
          onToast(err instanceof Error ? err.message : String(err), "error");
        }
      } finally {
        if (requestId === checkRef.current) setChecking(false);
      }
    },
    [onToast]
  );

  const openRepo = useCallback(
    async (raw: string): Promise<void> => {
      setRepoOpen(true);
      setDetails(null);
      setDetailsError(null);
      setDetailsLoading(true);
      setSelectedPaths(new Set());
      setReport(null);
      setStarted(false);
      try {
        const next = await window.kirea.getHuggingFaceRepo(raw);
        setDetails(next);
        const defaults = next.files
          .filter((file) => file.primary && file.selectable)
          .map((file) => file.path);
        const fallback = next.files.filter((file) => file.selectable).slice(0, 1).map((file) => file.path);
        const initial = defaults.length > 0 ? defaults : fallback;
        setSelectedPaths(new Set(initial));
        if (initial.length > 0) void runCheck(next, initial);
      } catch (err) {
        setDetailsError(err instanceof Error ? err.message : String(err));
      } finally {
        setDetailsLoading(false);
      }
    },
    [runCheck]
  );

  const handleSubmit = (): void => {
    const normalized = normalizeHuggingFaceRepoId(query);
    if (normalized) {
      void openRepo(normalized);
      return;
    }
    void fetchResults(null, false);
  };

  const toggleFile = (filePath: string): void => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  };

  useEffect(() => {
    if (!details || selectedPaths.size === 0) {
      setReport(null);
      return;
    }
    const timer = window.setTimeout(() => {
      void runCheck(details, [...selectedPaths]);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [details, selectedPaths, runCheck]);

  const selectedFiles = useMemo(
    () => (details ? details.files.filter((file) => selectedPaths.has(file.path)) : []),
    [details, selectedPaths]
  );

  const selectCompanions = (): void => {
    if (!details) return;
    const available = details.files.filter(
      (file) =>
        file.selectable &&
        details.requiredComponents.some(
          (component) =>
            component.availableInRepo &&
            component.fileName.toLowerCase() ===
              (file.path.split("/").pop() ?? "").toLowerCase()
        )
    );
    if (available.length === 0) {
      onToast("This repository does not contain the exact companion filenames Kirea expects.");
      return;
    }
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      for (const file of available) next.add(file.path);
      return next;
    });
  };

  const startDownload = async (): Promise<void> => {
    if (!details || !report) return;
    setDownloading(true);
    try {
      if (details.gated && !tokenSet) {
        throw new Error(
          "This repository is gated. Add a Hugging Face token in Settings before downloading."
        );
      }
      const tasks = await window.kirea.startHuggingFaceDownloads({
        repoId: details.id,
        revision: details.revision,
        files: selectedFiles.map((file) => ({
          path: file.path,
          category: fileCategoryFor(file, details.architecture),
        })),
        acknowledgeConditional: acknowledged,
        override,
      });
      setStarted(true);
      onToast(
        `Queued ${tasks.length} Hugging Face download${tasks.length === 1 ? "" : "s"}. Progress is in Downloads.`
      );
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setDownloading(false);
    }
  };

  const needsConditionalAck = report?.status === "CONDITIONAL";
  const needsOverride = report?.status === "UNKNOWN" || Boolean(report?.duplicateOf);
  const hasSelectableMain = Boolean(
    details?.files.some(
      (file) =>
        file.selectable && (file.kind === "checkpoint" || file.kind === "diffusion_model")
    )
  );
  const downloadAllowed =
    Boolean(report) &&
    report?.status !== "INCOMPATIBLE" &&
    selectedFiles.length > 0 &&
    (!needsConditionalAck || acknowledged) &&
    (!needsOverride || override);

  const activeHfDownloads = hfDownloads.filter((task) =>
    ["pending", "downloading", "verifying"].includes(task.status)
  );
  const { showContextMenu } = useContextMenu();

  const handleHuggingFaceContextMenu = (e: React.MouseEvent, repo: HuggingFaceRepoSummary) => {
    e.preventDefault();
    e.stopPropagation();

    const hfUrl = `https://huggingface.co/${repo.id}`;

    const items: ContextMenuItem[] = [
      {
        id: "hf-inspect",
        label: "Inspect Repository & Files",
        icon: <Sparkles className="w-3.5 h-3.5" />,
        onClick: () => void openRepo(repo.id),
      },
      {
        id: "hf-web",
        label: "Open on Hugging Face Web",
        icon: <ExternalLink className="w-3.5 h-3.5" />,
        onClick: () => void window.kirea.openExternalUrl(hfUrl),
        separator: true,
      },
      {
        id: "hf-copy-id",
        label: "Copy Repository ID",
        icon: <Copy className="w-3.5 h-3.5" />,
        onClick: () => {
          void navigator.clipboard.writeText(repo.id);
          onToast("Copied repository ID to clipboard.");
        },
      },
      {
        id: "hf-copy-url",
        label: "Copy Hugging Face URL",
        icon: <Copy className="w-3.5 h-3.5" />,
        onClick: () => {
          void navigator.clipboard.writeText(hfUrl);
          onToast("Copied repository URL to clipboard.");
        },
      },
    ];

    showContextMenu({
      x: e.clientX,
      y: e.clientY,
      title: repo.id,
      items,
    });
  };

  const handleEmptyHubContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const items: ContextMenuItem[] = [
      {
        id: "hf-refresh",
        label: "Refresh Repositories",
        icon: <RefreshCw className="w-3.5 h-3.5" />,
        onClick: () => void fetchResults(null, false),
      },
      {
        id: "hf-downloads",
        label: "View Downloads",
        icon: <Download className="w-3.5 h-3.5" />,
        onClick: onOpenDownloads,
        separator: true,
      },
      {
        id: "hf-to-civitai",
        label: "Switch to Civitai Hub",
        onClick: () => onSelectProvider("civitai"),
      },
      {
        id: "hf-to-vault",
        label: "Switch to Installed Models Vault",
        onClick: () => onSelectProvider("local"),
      },
    ];

    showContextMenu({
      x: e.clientX,
      y: e.clientY,
      title: "Hugging Face Hub",
      items,
    });
  };

  return (
    <div onContextMenu={handleEmptyHubContextMenu} className="space-y-4">
      {providerBar(onSelectProvider, onOpenDownloads, "huggingface")}

      <Card className="p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[260px]">
            <Search className="w-4 h-4 text-fg-subtle absolute left-3 top-2.5" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") handleSubmit();
              }}
              aria-label="Search Hugging Face"
              placeholder="Search video models or paste a repository URL / owner/repo"
              className="pl-9"
            />
          </div>
          <div className="w-40">
            <Select
              value={taskFilter}
              onChange={(event) => setTaskFilter(event.target.value as TaskFilter)}
              aria-label="Filter by task"
              className="h-9 text-xs"
            >
              <option value="all">Any video task</option>
              <option value="text-to-video">Text-to-video</option>
              <option value="image-to-video">Image-to-video</option>
            </Select>
          </div>
          <div className="w-40">
            <Select
              value={architecture}
              onChange={(event) => setArchitecture(event.target.value as ArchitectureFilter)}
              aria-label="Filter by architecture"
              className="h-9 text-xs"
            >
              <option value="all">All architectures</option>
              <option value="wan_video">Wan</option>
              <option value="ltx_video">LTX-Video</option>
              <option value="other">Other / unsupported</option>
            </Select>
          </div>
          <div className="w-36">
            <Select
              value={sort}
              onChange={(event) => setSort(event.target.value as SortFilter)}
              aria-label="Sort results"
              className="h-9 text-xs"
            >
              <option value="downloads">Most downloaded</option>
              <option value="likes">Most liked</option>
              <option value="lastModified">Recently updated</option>
            </Select>
          </div>
          <Button variant="primary" size="md" loading={loading} onClick={handleSubmit}>
            <Search className="w-4 h-4" />
            Search
          </Button>
          <Button
            variant="secondary"
            size="md"
            onClick={() => void fetchResults(null, false)}
            disabled={loading}
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
        <p className="text-[11px] text-fg-subtle leading-relaxed">
          First-release compatibility is deliberately limited to architectures Kirea actually
          executes: Wan 2.1 1.3B text-to-video and LTX-Video 2B. Other architectures stay visible
          with an explicit reason. Weights are never inspected by downloading them.
        </p>
      </Card>

      {!tokenSet && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2">
          <span className="text-xs text-fg-muted flex items-center gap-2">
            <Lock className="w-3.5 h-3.5 text-fg-subtle" />
            Anonymous browsing is active. A token is required for gated repositories.
          </span>
          <Button variant="secondary" size="sm" onClick={onOpenSettings}>
            Add token in Settings
          </Button>
        </div>
      )}

      {activeHfDownloads.length > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-accent/25 bg-accent-soft px-3 py-2">
          <span className="text-xs text-accent-hover">
            {activeHfDownloads.length} Hugging Face download
            {activeHfDownloads.length === 1 ? "" : "s"} in progress
          </span>
          <Button variant="utility" size="sm" onClick={onOpenDownloads}>
            View downloads
          </Button>
        </div>
      )}

      {error && (
        <Card className="p-4 border-danger/30">
          <p className="text-xs text-danger flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            {error}
          </p>
        </Card>
      )}

      {loading && items.length === 0 ? (
        <Card className="p-10 flex items-center justify-center gap-2 text-sm text-fg-muted">
          <Loader2 className="w-4 h-4 animate-spin" />
          Querying the Hugging Face Hub…
        </Card>
      ) : loaded && items.length === 0 && !error ? (
        <EmptyState
          icon={<Search className="w-5 h-5" />}
          title="No repositories matched"
          description="Try a different query, switch the task filter, or paste a full repository URL."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((repo) => (
            <Card
              key={repo.id}
              className="p-4 flex flex-col gap-3 cursor-pointer hover:border-accent/60 transition-colors"
              onContextMenu={(e) => handleHuggingFaceContextMenu(e, repo)}
            >
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-lg bg-surface-subtle border border-border flex items-center justify-center shrink-0 overflow-hidden">
                  {repo.thumbnailUrl ? (
                    <img
                      src={repo.thumbnailUrl}
                      alt=""
                      loading="lazy"
                      className="w-full h-full object-cover"
                      onError={(event) => {
                        (event.currentTarget as HTMLImageElement).style.display = "none";
                      }}
                    />
                  ) : (
                    <Layers className="w-5 h-5 text-fg-subtle" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-fg truncate" title={repo.id}>
                    {repo.id}
                  </h3>
                  <p className="text-[11px] text-fg-subtle truncate">
                    {repo.author ?? "Unknown author"} ·{" "}
                    {repo.pipelineTag ?? "pipeline unknown"}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone={repo.runnable ? "success" : "warning"}>
                  {repo.runnable ? "Runnable workflow" : "Unsupported"}
                </Badge>
                {repo.gated && <Badge tone="warning"><Lock className="w-3 h-3" />Gated</Badge>}
                {repo.license && <Badge tone="neutral">{repo.license}</Badge>}
                <Badge tone="neutral">{repo.architectureLabel}</Badge>
              </div>

              <p className="text-[11px] text-fg-muted leading-relaxed line-clamp-2">
                {repo.supportReason}
              </p>

              <div className="mt-auto flex items-center justify-between gap-2 pt-2 border-t border-border/70">
                <span className="text-[11px] text-fg-subtle font-mono">
                  {formatCount(repo.downloads)} downloads · {formatCount(repo.likes)} likes
                </span>
                <Button variant="secondary" size="sm" onClick={() => void openRepo(repo.id)}>
                  Inspect
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {cursor && (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            loading={loadingMore}
            onClick={() => void fetchResults(cursor, true)}
          >
            Load more
          </Button>
        </div>
      )}

      <Modal
        open={repoOpen}
        onClose={() => setRepoOpen(false)}
        title={details?.id ?? "Hugging Face repository"}
        maxWidthClass="max-w-5xl"
      >
        {detailsLoading ? (
          <div className="py-16 flex items-center justify-center gap-2 text-sm text-fg-muted">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading repository metadata…
          </div>
        ) : detailsError ? (
          <div className="space-y-4">
            <p className="text-xs text-danger flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              {detailsError}
            </p>
            <Button variant="secondary" onClick={() => setRepoOpen(false)}>
              Close
            </Button>
          </div>
        ) : details ? (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-4 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={details.runnable ? "success" : "warning"}>
                  {details.runnable ? details.architectureLabel : "Not loadable"}
                </Badge>
                {details.gated && <Badge tone="warning"><Lock className="w-3 h-3" />Gated</Badge>}
                {details.license && <Badge tone="neutral">{details.license}</Badge>}
                {details.pipelineTag && <Badge tone="neutral">{details.pipelineTag}</Badge>}
              </div>
              <p className="text-xs text-fg-muted leading-relaxed">
                {details.supportReason}
              </p>
              {details.description && (
                <div className="rounded-lg border border-border bg-bg p-3 max-h-36 overflow-auto">
                  <p className="text-[11px] text-fg-muted leading-relaxed whitespace-pre-wrap">
                    {details.description}
                  </p>
                </div>
              )}

              {details.requiredComponents.length > 0 && (
                <div className="rounded-lg border border-border p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-xs font-semibold text-fg">Required components</h4>
                    {details.requiredComponents.some(
                      (component) => !component.installed && component.availableInRepo
                    ) && (
                      <Button variant="utility" size="sm" onClick={selectCompanions}>
                        Select available
                      </Button>
                    )}
                  </div>
                  {details.requiredComponents.map((component) => (
                    <div
                      key={`${component.category}:${component.fileName}`}
                      className="flex items-center justify-between gap-2 text-[11px]"
                    >
                      <span className="text-fg-muted truncate" title={component.fileName}>
                        {component.label}
                        <span className="font-mono text-fg-subtle"> · {component.fileName}</span>
                      </span>
                      <Badge tone={component.installed ? "success" : component.availableInRepo ? "warning" : "danger"}>
                        {component.installed ? "Installed" : component.availableInRepo ? "In repo" : "Missing"}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-fg">
                    Files <span className="text-fg-subtle font-normal">({details.files.length})</span>
                  </h4>
                  <span className="text-[10px] font-mono text-fg-subtle">
                    SHA-256 from LFS metadata when available
                  </span>
                </div>
                <div className="max-h-[300px] overflow-auto rounded-lg border border-border divide-y divide-border/70">
                  {details.files.map((file) => (
                    <label
                      key={file.path}
                      className={`flex items-start gap-3 p-2.5 ${
                        file.selectable ? "cursor-pointer hover:bg-surface-subtle/60" : "opacity-70"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        disabled={!file.selectable}
                        checked={selectedPaths.has(file.path)}
                        onChange={() => toggleFile(file.path)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[11px] text-fg font-mono truncate" title={file.path}>
                            {file.path}
                          </span>
                          {file.primary && <Badge tone="accent">Primary</Badge>}
                          {file.quantization && <Badge tone="neutral">{file.quantization}</Badge>}
                          {!file.selectable && <Badge tone="neutral">

                            Metadata
                          </Badge>}
                        </div>
                        <p className="text-[10px] text-fg-subtle mt-0.5">
                          {file.sizeBytes > 0 ? formatBytes(file.sizeBytes) : "size unknown"}
                          {file.sha256 ? ` · SHA ${file.sha256.slice(0, 12)}…` : ""}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-3 min-w-0">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-fg">Compatibility monitor</h4>
                {checking && <Loader2 className="w-3.5 h-3.5 animate-spin text-fg-subtle" />}
              </div>

              {!report && !checking ? (
                details && !hasSelectableMain ? (
                  <Card className="p-4 border-danger/30">
                    <p className="text-xs text-danger font-medium flex items-center gap-1.5">
                      <XCircle className="w-4 h-4" />
                      No loadable single-file weight
                    </p>
                    <p className="text-[10px] text-fg-muted leading-relaxed mt-1">
                      {details.supportReason ||
                        "This repository does not expose a ComfyUI-loadable checkpoint or diffusion model."}
                    </p>
                  </Card>
                ) : (
                  <Card className="p-4 text-xs text-fg-muted">
                    Select at least one weight file to run the preflight check.
                  </Card>
                )
              ) : report ? (
                <>
                  <div className="rounded-xl border border-border p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <Badge tone={STATUS_TONE[report.status]}>
                        {HF_COMPATIBILITY_LABELS[report.status]}
                      </Badge>
                      <span className="text-[10px] font-mono text-fg-subtle">
                        {report.workflowName ?? "No workflow"}
                      </span>
                    </div>
                    <p className="text-[11px] text-fg-muted leading-relaxed">{report.summary}</p>
                  </div>

                  <div className="rounded-lg border border-border divide-y divide-border/70 max-h-[190px] overflow-auto">
                    {report.checks.map((check) => (
                      <div key={check.id} className="p-2.5 flex items-start gap-2">
                        <CheckIcon status={check.status} />
                        <div className="min-w-0">
                          <p className="text-[11px] text-fg font-medium">
                            <span className="text-fg-subtle font-mono uppercase text-[9px] mr-1.5">
                              {CATEGORY_LABELS[check.category] ?? check.category}
                            </span>
                            {check.title}
                          </p>
                          <p className="text-[10px] text-fg-muted leading-relaxed mt-0.5">
                            {check.detail}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                    <div className="rounded-md border border-border p-2">
                      <span className="text-fg-subtle block">GPU</span>
                      <span className="text-fg">{report.detected.gpuName}</span>
                    </div>
                    <div className="rounded-md border border-border p-2">
                      <span className="text-fg-subtle block">VRAM</span>
                      <span className="text-fg">
                        {Math.round(report.detected.vramTotalMB / 1024)} GB total ·{" "}
                        {(report.detected.vramFreeMB / 1024).toFixed(1)} GB free
                      </span>
                    </div>
                    <div className="rounded-md border border-border p-2">
                      <span className="text-fg-subtle block">RAM</span>
                      <span className="text-fg">
                        {(report.detected.systemRamTotalMB / 1024).toFixed(0)} GB ·{" "}
                        {(report.detected.systemRamFreeMB / 1024).toFixed(1)} GB free
                      </span>
                    </div>
                    <div className="rounded-md border border-border p-2">
                      <span className="text-fg-subtle block">Disk free</span>
                      <span className="text-fg">
                        {report.detected.diskFreeGB === null ? "unknown" : `${report.detected.diskFreeGB} GB`}
                      </span>
                    </div>
                    <div className="rounded-md border border-border p-2">
                      <span className="text-fg-subtle block">Workflow need</span>
                      <span className="text-fg">
                        min {Math.round(report.requirements.minVramMB / 1024)} GB · rec{" "}
                        {Math.round(report.requirements.recommendedVramMB / 1024)} GB
                      </span>
                    </div>
                    <div className="rounded-md border border-border p-2">
                      <span className="text-fg-subtle block">Download</span>
                      <span className="text-fg">{formatBytes(report.requirements.downloadBytes)}</span>
                    </div>
                  </div>

                  {report.missingNodes.length > 0 && (
                    <div className="rounded-lg border border-danger/30 bg-danger-soft p-2.5">
                      <p className="text-[10px] text-danger leading-relaxed">
                        Missing nodes: <span className="font-mono">{report.missingNodes.join(", ")}</span>.
                        Kirea does not install custom nodes automatically.
                      </p>
                    </div>
                  )}

                  {report.missingComponents.length > 0 && (
                    <div className="rounded-lg border border-warning/30 bg-warning-soft p-2.5">
                      <p className="text-[10px] text-warning leading-relaxed">
                        Missing components:{" "}
                        <span className="font-mono">
                          {report.missingComponents.map((component) => component.fileName).join(", ")}
                        </span>
                      </p>
                    </div>
                  )}

                  {report.recommendations.length > 0 && (
                    <ul className="space-y-1 text-[10px] text-fg-muted leading-relaxed">
                      {report.recommendations.map((recommendation) => (
                        <li key={recommendation} className="flex gap-1.5">
                          <span className="text-fg-subtle">→</span>
                          {recommendation}
                        </li>
                      ))}
                    </ul>
                  )}

                  {report.duplicateOf && (
                    <div className="rounded-lg border border-warning/30 bg-warning-soft p-2.5">
                      <p className="text-[10px] text-warning leading-relaxed">
                        Already installed as <strong>{report.duplicateOf}</strong>. Normal download is
                        blocked.
                      </p>
                    </div>
                  )}

                  {details.gated && !tokenSet && (
                    <div className="rounded-lg border border-warning/30 bg-warning-soft p-2.5">
                      <p className="text-[10px] text-warning leading-relaxed">
                        This repository is gated. Add a Hugging Face token in Settings before downloading.
                      </p>
                    </div>
                  )}

                  {needsConditionalAck && (
                    <label className="flex items-start gap-2 text-[10px] text-fg-muted leading-relaxed">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={acknowledged}
                        onChange={(event) => setAcknowledged(event.target.checked)}
                      />
                      I understand the compatibility limitations above and want to download anyway.
                    </label>
                  )}
                  {needsOverride && (
                    <label className="flex items-start gap-2 text-[10px] text-fg-muted leading-relaxed">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={override}
                        onChange={(event) => setOverride(event.target.checked)}
                      />
                      I understand compatibility is unverified or the model is already installed, and
                      I explicitly override the protection.
                    </label>
                  )}
                </>
              ) : null}

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button
                  variant="primary"
                  loading={downloading}
                  disabled={!downloadAllowed || started}
                  onClick={() => void startDownload()}
                >
                  <Download className="w-4 h-4" />
                  {report?.status === "INCOMPATIBLE"
                    ? "Download blocked"
                    : !hasSelectableMain
                      ? "No loadable weight"
                      : `Download ${selectedFiles.length || ""} file${selectedFiles.length === 1 ? "" : "s"}`}
                </Button>
                {started && (
                  <Button variant="secondary" onClick={onOpenDownloads}>
                    View downloads
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => window.kirea.openExternalUrl(`https://huggingface.co/${details.id}`)}
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Repository
                </Button>
              </div>
              {report?.status === "INCOMPATIBLE" && (
                <p className="text-[10px] text-danger leading-relaxed">
                  {report.blockingReasons.join(" ") || report.summary}
                </p>
              )}
              <p className="text-[10px] text-fg-subtle leading-relaxed">
                Compatibility is re-checked against live hardware, ComfyUI nodes and free disk
                immediately before any download starts.
              </p>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
};
