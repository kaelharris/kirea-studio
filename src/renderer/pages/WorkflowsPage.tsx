import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Download,
  Eye,
  FileJson,
  FolderOpen,
  Globe,
  History,
  Layers,
  Link2,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Workflow,
  XCircle,
} from "lucide-react";
import type {
  InstalledWorkflowFile,
  WorkflowArchivePreview,
  WorkflowCompatibilityStatus,
  WorkflowImportReport,
} from "../../shared/workflow-import";
import {
  CIVITAI_WORKFLOW_CATEGORIES,
  CIVITAI_WORKFLOW_SORTS,
  type CivitaiWorkflowCategory,
  type CivitaiWorkflowImportPreview,
  type CivitaiWorkflowSort,
  type CivitaiWorkflowSummary,
} from "../../shared/civitai-workflows";
import type { ModelRecord, RuntimeState, WorkflowTemplate } from "../../shared/types";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Input,
  Modal,
  SectionHeader,
  Select,
} from "../components/ui/Primitives";

interface WorkflowsPageProps {
  workflows: WorkflowTemplate[];
  models: ModelRecord[];
  runtime: RuntimeState;
  onUseWorkflow: (workflow: WorkflowTemplate) => void;
  onToast: (message: string, tone?: "info" | "error") => void;
}

type WorkflowTab = "templates" | "browse" | "import" | "installed";
type InstalledFilter = "all" | WorkflowCompatibilityStatus;

const INPUT_CLASS =
  "w-full h-8 rounded-md border border-border bg-surface px-3 font-mono text-small text-fg placeholder:text-fg-subtle focus:border-border-strong focus:outline-none";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(
    value
  );
}

function compatibilityTone(
  status: WorkflowCompatibilityStatus
): "success" | "danger" | "warning" {
  if (status === "compatible") return "success";
  if (status === "incompatible") return "danger";
  return "warning";
}

function compatibilityLabel(status: WorkflowCompatibilityStatus): string {
  if (status === "compatible") return "Compatible";
  if (status === "incompatible") return "Missing dependencies";
  return "Unverified";
}

const TemplatesGrid: React.FC<{
  workflows: WorkflowTemplate[];
  models: ModelRecord[];
  onUseWorkflow: (workflow: WorkflowTemplate) => void;
}> = ({ workflows, models, onUseWorkflow }) => (
  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
    {workflows.map((wf) => {
      const matchingModels = models.filter(
        (m) => m.installed && m.compatibleWorkflows.includes(wf.id)
      );

      return (
        <Card key={wf.id} className="p-4 flex flex-col justify-between gap-4">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <Workflow className="w-4 h-4 shrink-0 text-accent" aria-hidden="true" />
                <div>
                  <h3 className="text-h3 text-fg">{wf.name}</h3>
                  <p className="font-mono text-tech text-fg-subtle">
                    {wf.id} • v{wf.version}
                  </p>
                </div>
              </div>
              <Badge tone="accent">{wf.mode}</Badge>
            </div>

            <p className="text-small text-fg-muted">{wf.description}</p>

            <div className="grid grid-cols-3 gap-2 rounded-xl border border-border bg-bg p-3 text-small">
              <div>
                <div className="text-fg-subtle">Dimensions</div>
                <div className="font-medium text-fg tabular-nums">
                  {wf.minDim}–{wf.maxDim}px (÷{wf.dimStep})
                </div>
              </div>
              <div>
                <div className="text-fg-subtle">Default Run</div>
                <div className="font-medium text-fg tabular-nums">
                  {wf.defaults.steps} steps • CFG {wf.defaults.cfg}
                </div>
              </div>
              <div>
                <div className="text-fg-subtle">LoRA Slots</div>
                <div className="font-medium text-fg tabular-nums">Up to {wf.maxLoras}</div>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="label-mono text-label">Required ComfyUI Nodes</div>
              <div className="flex flex-wrap gap-1.5">
                {wf.requiredNodes.map((n) => (
                  <Badge key={n} tone="neutral" className="font-mono text-[11px]">
                    {n}
                  </Badge>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
            <span className="inline-flex items-center gap-1.5 text-small text-fg-muted">
              <Layers className="w-3.5 h-3.5 text-fg-subtle" />
              {matchingModels.length} compatible local model(s)
            </span>
            <Button size="sm" variant="primary" onClick={() => onUseWorkflow(wf)}>
              <Sparkles className="w-3.5 h-3.5" />
              Load in Create
            </Button>
          </div>
        </Card>
      );
    })}
  </div>
);

const ImportReportView: React.FC<{
  report: WorkflowImportReport;
  installing: boolean;
  onInstall: () => void;
}> = ({ report, installing, onInstall }) => {
  const missingNodes = report.nodeClasses.filter((node) => node.available === false);
  const missingModels = report.modelReferences.filter((reference) => !reference.installed);

  return (
    <Card className="p-5 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FileJson className="w-4 h-4 text-accent shrink-0" />
            <h3 className="text-h3 text-fg truncate">{report.name}</h3>
          </div>
          <p className="mt-1 font-mono text-tech text-fg-subtle break-all">
            {report.sourceLabel}
          </p>
          {report.archiveEntry && (
            <p className="mt-1 text-[11px] text-fg-subtle break-all">
              Archive entry: {report.archiveEntry}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={report.format === "ui" ? "success" : "warning"}>
            {report.format === "ui" ? "UI workflow" : "API prompt"}
          </Badge>
          {report.sourceKind === "civitai" && <Badge tone="accent">Civitai</Badge>}
          {report.sourceKind === "archive" && <Badge tone="info">ZIP</Badge>}
          {report.video && <Badge tone="info">video</Badge>}
          <Badge tone="neutral">{formatBytes(report.sizeBytes)}</Badge>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 rounded-xl border border-border bg-bg p-3 text-small">
        <div>
          <div className="text-fg-subtle">Nodes</div>
          <div className="font-medium text-fg tabular-nums">{report.nodeCount}</div>
        </div>
        <div>
          <div className="text-fg-subtle">Missing nodes</div>
          <div className="font-medium text-fg tabular-nums">
            {report.runtimeChecked ? report.missingNodeClasses.length : "—"}
          </div>
        </div>
        <div>
          <div className="text-fg-subtle">Missing models</div>
          <div className="font-medium text-fg tabular-nums">{missingModels.length}</div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="label-mono text-label">ComfyUI Node Compatibility</div>
        {!report.runtimeChecked && (
          <p className="text-small text-fg-muted">
            Connect ComfyUI to verify that every node class in this workflow is installed.
          </p>
        )}
        {report.runtimeChecked && missingNodes.length === 0 && (
          <p className="inline-flex items-center gap-1.5 text-small text-success">
            <CheckCircle2 className="w-4 h-4" />
            All {report.nodeClasses.length} backend node classes are available.
          </p>
        )}
        {missingNodes.length > 0 && (
          <div className="rounded-lg border border-danger/30 bg-danger-soft p-3 space-y-1.5">
            <p className="inline-flex items-center gap-1.5 text-small font-medium text-danger">
              <XCircle className="w-4 h-4" />
              {missingNodes.length} node class(es) are not installed
            </p>
            <div className="flex flex-wrap gap-1.5">
              {missingNodes.map((node) => (
                <Badge key={node.classType} tone="danger" className="font-mono">
                  {node.classType}
                </Badge>
              ))}
            </div>
            <p className="text-small text-fg-muted">
              Install the matching custom nodes in ComfyUI before running this workflow. Kirea
              never installs nodes automatically.
            </p>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="label-mono text-label">Model References</div>
        {report.modelReferences.length === 0 ? (
          <p className="text-small text-fg-muted">No model file references detected.</p>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border">
            {report.modelReferences.map((reference) => (
              <div
                key={`${reference.nodeId}:${reference.inputName}:${reference.filename}`}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="font-mono text-small text-fg break-all">{reference.filename}</p>
                  <p className="text-[11px] text-fg-subtle">
                    {reference.nodeClass} → ComfyUI/{reference.expectedFolder}
                  </p>
                </div>
                <Badge tone={reference.installed ? "success" : "danger"}>
                  {reference.installed ? "Installed" : "Missing"}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </div>

      {report.warnings.length > 0 && (
        <div className="space-y-1.5 rounded-lg border border-warning/30 bg-warning-soft p-3">
          <p className="inline-flex items-center gap-1.5 text-small font-medium text-warning">
            <AlertTriangle className="w-4 h-4" />
            Compatibility warnings
          </p>
          {report.warnings.map((warning) => (
            <p key={warning} className="text-small text-fg-muted">
              {warning}
            </p>
          ))}
        </div>
      )}

      {report.notes.length > 0 && (
        <ul className="space-y-1 text-small text-fg-muted">
          {report.notes.map((note) => (
            <li key={note}>• {note}</li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <p className="max-w-[52ch] text-[11px] text-fg-subtle">
          Installation writes one new JSON file into ComfyUI's user/default/workflows folder.
          Existing files are never overwritten and no models are downloaded.
        </p>
        <Button
          variant="accent"
          onClick={onInstall}
          loading={installing}
          disabled={!report.installable}
        >
          <Upload className="w-3.5 h-3.5" />
          Install into ComfyUI
        </Button>
      </div>
    </Card>
  );
};

const WorkflowBrowserCard: React.FC<{
  item: CivitaiWorkflowSummary;
  onOpen: () => void;
}> = ({ item, onOpen }) => (
  <button
    type="button"
    onClick={onOpen}
    className="text-left bg-surface border border-border rounded-xl overflow-hidden hover:border-border-strong transition-colors flex flex-col"
  >
    <div className="aspect-video bg-bg border-b border-border overflow-hidden">
      {item.primaryPreviewUrl ? (
        <img
          src={item.primaryPreviewUrl}
          alt=""
          loading="lazy"
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <Workflow className="w-8 h-8 text-fg-faint" />
        </div>
      )}
    </div>
    <div className="p-3 space-y-2 flex-1 flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-small font-semibold text-fg line-clamp-2">{item.name}</h3>
        {item.installed && (
          <Badge tone="success" className="shrink-0">
            Installed
          </Badge>
        )}
      </div>
      <p className="text-[11px] text-fg-subtle">
        {item.creator ? `by ${item.creator}` : "Unknown creator"}
      </p>
      {item.categories.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {item.categories.slice(0, 3).map((category) => (
            <Badge key={category} tone="neutral">
              {CIVITAI_WORKFLOW_CATEGORIES.find((entry) => entry.id === category)?.label ??
                category}
            </Badge>
          ))}
        </div>
      )}
      <div className="mt-auto flex items-center justify-between gap-2 pt-2 border-t border-border">
        <span className="inline-flex items-center gap-1 text-[11px] text-fg-subtle">
          <Download className="w-3 h-3" />
          {formatCount(item.stats.downloads)}
        </span>
        <span className="text-[11px] text-fg-subtle">
          {item.versions.length} version{item.versions.length === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  </button>
);

export const WorkflowsPage: React.FC<WorkflowsPageProps> = ({
  workflows,
  models,
  runtime,
  onUseWorkflow,
  onToast,
}) => {
  const [tab, setTab] = useState<WorkflowTab>("templates");
  const [url, setUrl] = useState("");
  const [report, setReport] = useState<WorkflowImportReport | null>(null);
  const [archivePreview, setArchivePreview] = useState<WorkflowArchivePreview | null>(null);
  const [archiveCandidateId, setArchiveCandidateId] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installed, setInstalled] = useState<InstalledWorkflowFile[]>([]);
  const [installedFolder, setInstalledFolder] = useState<string | null>(null);
  const [installedQuery, setInstalledQuery] = useState("");
  const [installedFilter, setInstalledFilter] = useState<InstalledFilter>("all");
  const [removeTarget, setRemoveTarget] = useState<InstalledWorkflowFile | null>(null);
  const [detailsFile, setDetailsFile] = useState<InstalledWorkflowFile | null>(null);
  const [revalidatingPath, setRevalidatingPath] = useState<string | null>(null);
  const [reimportingPath, setReimportingPath] = useState<string | null>(null);
  const [reimportReport, setReimportReport] = useState<WorkflowImportReport | null>(null);

  const [wfQuery, setWfQuery] = useState("");
  const [wfSubmitted, setWfSubmitted] = useState("");
  const [wfCategory, setWfCategory] = useState<CivitaiWorkflowCategory | null>(null);
  const [wfSort, setWfSort] = useState<CivitaiWorkflowSort>("Most Downloaded");
  const [wfResults, setWfResults] = useState<CivitaiWorkflowSummary[]>([]);
  const [wfCursor, setWfCursor] = useState<string | null>(null);
  const [wfCategoryFiltered, setWfCategoryFiltered] = useState(false);
  const [wfLoading, setWfLoading] = useState(false);
  const [wfLoadingMore, setWfLoadingMore] = useState(false);
  const [wfError, setWfError] = useState<string | null>(null);
  const [selectedWorkflow, setSelectedWorkflow] = useState<CivitaiWorkflowSummary | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);
  const [browserBusy, setBrowserBusy] = useState(false);
  const [browserPreview, setBrowserPreview] = useState<CivitaiWorkflowImportPreview | null>(null);
  const [browserCandidateId, setBrowserCandidateId] = useState<string | null>(null);

  const refreshInstalled = useCallback(async () => {
    try {
      const files = await window.kirea.listInstalledWorkflows();
      setInstalled(files);
      const folder = files[0]?.importRecord?.folder ?? null;
      if (folder) setInstalledFolder(folder);
    } catch (error) {
      onToast(
        error instanceof Error ? error.message : "Could not list installed workflows.",
        "error"
      );
    }
  }, [onToast]);

  useEffect(() => {
    if (tab === "import" || tab === "installed") void refreshInstalled();
  }, [tab, refreshInstalled]);

  useEffect(() => {
    if (tab !== "browse") return;
    let cancelled = false;
    setWfLoading(true);
    setWfError(null);
    window.kirea
      .searchCivitaiWorkflows({
        query: wfSubmitted || undefined,
        category: wfCategory,
        sort: wfSort,
        limit: 24,
      })
      .then((result) => {
        if (cancelled) return;
        setWfResults(result.items);
        setWfCursor(result.nextCursor);
        setWfCategoryFiltered(result.categoryFiltered);
      })
      .catch((error) => {
        if (!cancelled) {
          setWfError(error instanceof Error ? error.message : "Civitai workflow search failed.");
        }
      })
      .finally(() => {
        if (!cancelled) setWfLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, wfSubmitted, wfCategory, wfSort]);

  const analyzeUrl = async (): Promise<void> => {
    if (!url.trim()) {
      onToast("Paste a workflow URL first.", "error");
      return;
    }
    setAnalyzing(true);
    try {
      const result = await window.kirea.analyzeWorkflowUrl(url.trim());
      setReport(result);
      setArchivePreview(null);
      setArchiveCandidateId(null);
      onToast("Workflow analyzed.");
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setAnalyzing(false);
    }
  };

  const analyzeFile = async (): Promise<void> => {
    setAnalyzing(true);
    try {
      const result = await window.kirea.analyzeWorkflowFile();
      if (!result) return;
      if (result.kind === "archive") {
        setArchivePreview(result.preview);
        setArchiveCandidateId(result.preview.candidates[0]?.report.previewId ?? null);
        setReport(null);
        onToast(
          `Archive inspected: ${result.preview.candidates.length} workflow candidate(s). Nothing was installed.`
        );
      } else {
        setReport(result.report);
        setArchivePreview(null);
        setArchiveCandidateId(null);
        onToast("Workflow analyzed.");
      }
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setAnalyzing(false);
    }
  };

  const analyzeArchive = async (): Promise<void> => {
    setAnalyzing(true);
    try {
      const preview = await window.kirea.analyzeWorkflowArchiveFile();
      if (!preview) return;
      setArchivePreview(preview);
      setArchiveCandidateId(preview.candidates[0]?.report.previewId ?? null);
      setReport(null);
      onToast(
        `Archive inspected: ${preview.candidates.length} workflow candidate(s). Nothing was installed.`
      );
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setAnalyzing(false);
    }
  };

  const installReport = async (target: WorkflowImportReport): Promise<void> => {
    setInstalling(true);
    try {
      const result = await window.kirea.installWorkflowImport(target.previewId);
      onToast(`Installed '${result.fileName}' into ComfyUI.`);
      setInstalledFolder(result.folder);
      setReport((current) => (current?.previewId === target.previewId ? null : current));
      setArchivePreview((current) =>
        current
          ? {
              ...current,
              candidates: current.candidates.filter(
                (candidate) => candidate.report.previewId !== target.previewId
              ),
            }
          : current
      );
      setArchiveCandidateId((current) => (current === target.previewId ? null : current));
      setReimportReport((current) =>
        current?.previewId === target.previewId ? null : current
      );
      setBrowserPreview((current) => {
        if (!current) return current;
        if (current.report?.previewId === target.previewId) {
          return { ...current, report: null };
        }
        return {
          ...current,
          candidates: current.candidates.filter(
            (candidate) => candidate.report.previewId !== target.previewId
          ),
        };
      });
      setBrowserCandidateId((current) => (current === target.previewId ? null : current));
      await refreshInstalled();
      if (selectedWorkflow) {
        const fresh = await window.kirea.getCivitaiWorkflowDetails(selectedWorkflow.id);
        setSelectedWorkflow(fresh);
        setWfResults((current) =>
          current.map((item) => (item.id === fresh.id ? fresh : item))
        );
      }
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setInstalling(false);
    }
  };

  const reveal = async (filePath: string): Promise<void> => {
    try {
      await window.kirea.revealInstalledWorkflow(filePath);
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), "error");
    }
  };

  const removeInstalled = async (file: InstalledWorkflowFile): Promise<void> => {
    try {
      await window.kirea.removeInstalledWorkflow(file.filePath);
      onToast(`Removed '${file.fileName}' from ComfyUI's workflows folder.`);
      await refreshInstalled();
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), "error");
    }
  };

  const revalidate = async (file: InstalledWorkflowFile): Promise<void> => {
    setRevalidatingPath(file.filePath);
    try {
      const result = await window.kirea.revalidateInstalledWorkflow(file.filePath);
      const status = result.record?.compatibility ?? "unknown";
      onToast(
        `Revalidated '${file.fileName}': ${compatibilityLabel(
          status
        )}, ${result.report.missingNodeClasses.length} missing node class(es), ${result.report.modelReferences.filter((reference) => !reference.installed).length} missing model(s).`
      );
      await refreshInstalled();
      setDetailsFile((current) =>
        current && current.filePath === file.filePath
          ? installed.find((entry) => entry.filePath === file.filePath) ?? current
          : current
      );
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setRevalidatingPath(null);
    }
  };

  const reimport = async (file: InstalledWorkflowFile): Promise<void> => {
    setReimportingPath(file.filePath);
    try {
      const result = await window.kirea.reimportInstalledWorkflow(file.filePath);
      setReimportReport(result);
      onToast("Workflow re-analyzed. Review the report before installing.");
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setReimportingPath(null);
    }
  };

  const openWorkflow = async (modelId: number): Promise<void> => {
    const summary = wfResults.find((item) => item.id === modelId) ?? null;
    if (!summary) return;
    setSelectedWorkflow(summary);
    setSelectedVersionId(summary.versions[0]?.id ?? null);
    setBrowserPreview(null);
    setBrowserCandidateId(null);
    setBrowserBusy(true);
    try {
      const fresh = await window.kirea.getCivitaiWorkflowDetails(modelId);
      setSelectedWorkflow(fresh);
      setSelectedVersionId(fresh.versions[0]?.id ?? null);
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBrowserBusy(false);
    }
  };

  const prepareBrowserImport = async (): Promise<void> => {
    if (!selectedWorkflow || selectedVersionId === null) return;
    setBrowserBusy(true);
    setBrowserPreview(null);
    setBrowserCandidateId(null);
    try {
      const preview = await window.kirea.prepareCivitaiWorkflowImport({
        modelId: selectedWorkflow.id,
        versionId: selectedVersionId,
      });
      setBrowserPreview(preview);
      if (preview.report) setBrowserCandidateId(preview.report.previewId);
      else if (preview.candidates.length === 1) {
        setBrowserCandidateId(preview.candidates[0]!.report.previewId);
      }
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBrowserBusy(false);
    }
  };

  const loadMore = async (): Promise<void> => {
    if (!wfCursor || wfLoadingMore) return;
    setWfLoadingMore(true);
    try {
      const result = await window.kirea.searchCivitaiWorkflows({
        query: wfSubmitted || undefined,
        category: wfCategory,
        sort: wfSort,
        cursor: wfCursor,
        limit: 24,
      });
      setWfResults((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...result.items.filter((item) => !seen.has(item.id))];
      });
      setWfCursor(result.nextCursor);
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setWfLoadingMore(false);
    }
  };

  const submitBrowserSearch = (): void => {
    setWfSubmitted(wfQuery.trim());
  };

  const archiveSelectedReport = useMemo(
    () =>
      archivePreview?.candidates.find(
        (candidate) => candidate.report.previewId === archiveCandidateId
      )?.report ?? null,
    [archivePreview, archiveCandidateId]
  );

  const browserSelectedReport = useMemo(() => {
    if (!browserPreview) return null;
    if (browserPreview.report) return browserPreview.report;
    return (
      browserPreview.candidates.find(
        (candidate) => candidate.report.previewId === browserCandidateId
      )?.report ?? null
    );
  }, [browserPreview, browserCandidateId]);

  const selectedVersion = useMemo(
    () =>
      selectedWorkflow?.versions.find((version) => version.id === selectedVersionId) ??
      selectedWorkflow?.versions[0] ??
      null,
    [selectedWorkflow, selectedVersionId]
  );

  const visibleInstalled = useMemo(() => {
    const query = installedQuery.trim().toLowerCase();
    return installed.filter((file) => {
      const record = file.importRecord ?? null;
      const status = record?.compatibility ?? "unknown";
      if (installedFilter !== "all" && status !== installedFilter) return false;
      if (!query) return true;
      return [
        file.fileName,
        record?.workflowName ?? "",
        record?.sourceLabel ?? "",
        record?.originalFileName ?? "",
        record?.archiveEntry ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [installed, installedQuery, installedFilter]);

  const installedCounts = useMemo(() => {
    const counts = { compatible: 0, incompatible: 0, unknown: 0 };
    for (const file of installed) {
      counts[(file.importRecord?.compatibility ?? "unknown") as keyof typeof counts] += 1;
    }
    return counts;
  }, [installed]);

  return (
    <div className="space-y-6">
      <SectionHeader
        sticky
        title="Workflows"
        subtitle="Kirea's validated templates, Civitai workflow discovery, and a checked importer for workflow JSON and ZIP archives. Model weights are never downloaded from workflow listings."
        actions={
          <Badge tone={runtime.status === "connected" ? "success" : "neutral"}>
            <CheckCircle2 className="w-3.5 h-3.5" />
            {runtime.status === "connected"
              ? `${runtime.nodeTypesCount} ComfyUI node types available`
              : "Connect ComfyUI to verify node schemas"}
          </Badge>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={tab === "templates" ? "primary" : "ghost"}
          onClick={() => setTab("templates")}
        >
          <Workflow className="w-3.5 h-3.5" />
          Templates ({workflows.length})
        </Button>
        <Button
          size="sm"
          variant={tab === "browse" ? "primary" : "ghost"}
          onClick={() => setTab("browse")}
        >
          <Globe className="w-3.5 h-3.5" />
          Browse Civitai
        </Button>
        <Button
          size="sm"
          variant={tab === "import" ? "primary" : "ghost"}
          onClick={() => setTab("import")}
        >
          <FileJson className="w-3.5 h-3.5" />
          Import Workflow
        </Button>
        <Button
          size="sm"
          variant={tab === "installed" ? "primary" : "ghost"}
          onClick={() => setTab("installed")}
        >
          <Archive className="w-3.5 h-3.5" />
          Installed ({installed.length})
        </Button>
      </div>

      {tab === "templates" && (
        <TemplatesGrid
          workflows={workflows}
          models={models}
          onUseWorkflow={onUseWorkflow}
        />
      )}

      {tab === "browse" && (
        <div className="space-y-4">
          <Card className="p-4 space-y-3">
            <div className="flex flex-col xl:flex-row gap-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
                <input
                  className={`${INPUT_CLASS} pl-8`}
                  placeholder="Search Civitai workflows"
                  value={wfQuery}
                  onChange={(event) => setWfQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") submitBrowserSearch();
                  }}
                  aria-label="Search Civitai workflows"
                />
              </div>
              <div className="w-full xl:w-48">
                <Select
                  value={wfSort}
                  onChange={(event) => setWfSort(event.target.value as CivitaiWorkflowSort)}
                  aria-label="Sort workflows"
                >
                  {CIVITAI_WORKFLOW_SORTS.map((sort) => (
                    <option key={sort} value={sort}>
                      {sort}
                    </option>
                  ))}
                </Select>
              </div>
              <Button variant="accent" onClick={submitBrowserSearch} loading={wfLoading}>
                <Search className="w-3.5 h-3.5" />
                Search
              </Button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              <Button
                size="sm"
                variant={wfCategory === null ? "secondary" : "ghost"}
                onClick={() => setWfCategory(null)}
              >
                All
              </Button>
              {CIVITAI_WORKFLOW_CATEGORIES.map((category) => (
                <Button
                  key={category.id}
                  size="sm"
                  variant={wfCategory === category.id ? "secondary" : "ghost"}
                  onClick={() => setWfCategory(category.id)}
                >
                  {category.label}
                </Button>
              ))}
            </div>

            <p className="text-[11px] text-fg-subtle">
              Browsing uses Civitai's workflow type filter. Categories are inferred from
              Civitai's own tags, names and base models; a workflow without category metadata
              appears under Other.
              {wfCategoryFiltered
                ? " Category filtering scans multiple Civitai pages, so some matching workflows may be omitted."
                : ""}
            </p>
          </Card>

          {wfError && (
            <div className="rounded-lg border border-danger/30 bg-danger-soft p-3 text-small text-danger">
              {wfError}
            </div>
          )}

          {wfLoading ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4">
              {Array.from({ length: 6 }).map((_, index) => (
                <div
                  key={index}
                  className="h-64 rounded-xl border border-border bg-surface-subtle animate-pulse"
                />
              ))}
            </div>
          ) : wfResults.length === 0 ? (
            <Card className="p-6 text-center">
              <p className="text-small text-fg-muted">
                No Civitai workflows matched this search. Try a different query or category.
              </p>
            </Card>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4">
              {wfResults.map((item) => (
                <WorkflowBrowserCard
                  key={item.id}
                  item={item}
                  onOpen={() => void openWorkflow(item.id)}
                />
              ))}
            </div>
          )}

          {wfCursor && !wfLoading && (
            <div className="flex justify-center">
              <Button variant="secondary" onClick={() => void loadMore()} loading={wfLoadingMore}>
                Load more
              </Button>
            </div>
          )}
        </div>
      )}

      {tab === "import" && (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-4 items-start">
          <div className="space-y-4">
            <Card className="p-5 space-y-4">
              <div>
                <h3 className="text-h3 text-fg">Analyze a workflow</h3>
                <p className="mt-1 text-small text-fg-muted">
                  Paste a direct HTTPS .json link or a Civitai workflow model page, or choose a
                  local workflow JSON or ZIP archive. Kirea detects UI vs API format, inspects
                  archives without extracting them, and checks nodes and models locally.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Link2 className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
                  <input
                    className={`${INPUT_CLASS} pl-8`}
                    placeholder="https://civitai.com/models/… or https://…/workflow.json"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void analyzeUrl();
                    }}
                    aria-label="Workflow URL"
                  />
                </div>
                <Button variant="accent" onClick={() => void analyzeUrl()} loading={analyzing}>
                  <Globe className="w-3.5 h-3.5" />
                  Analyze URL
                </Button>
              </div>

              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="label-mono text-label">or</span>
                <div className="h-px flex-1 bg-border" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Button
                  variant="secondary"
                  onClick={() => void analyzeFile()}
                  loading={analyzing}
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  Choose JSON or ZIP
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => void analyzeArchive()}
                  loading={analyzing}
                >
                  <Archive className="w-3.5 h-3.5" />
                  Choose ZIP archive
                </Button>
              </div>
            </Card>

            {report && (
              <ImportReportView
                report={report}
                installing={installing}
                onInstall={() => void installReport(report)}
              />
            )}

            {archivePreview && (
              <Card className="p-5 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Archive className="w-4 h-4 text-accent" />
                      <h3 className="text-h3 text-fg truncate">{archivePreview.archiveName}</h3>
                    </div>
                    <p className="mt-1 font-mono text-[11px] text-fg-subtle break-all">
                      {archivePreview.sourceLabel}
                    </p>
                  </div>
                  <Badge tone="info">
                    {archivePreview.candidates.length} candidate
                    {archivePreview.candidates.length === 1 ? "" : "s"}
                  </Badge>
                </div>

                <p className="text-small text-fg-muted">
                  Kirea inspected this archive in memory. Only the workflow entry you install is
                  written to ComfyUI; images, scripts, nested archives and custom nodes are never
                  extracted or executed.
                </p>

                <div className="divide-y divide-border rounded-lg border border-border">
                  {archivePreview.candidates.map((candidate) => (
                    <div
                      key={candidate.report.previewId}
                      className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="font-mono text-small text-fg break-all">
                          {candidate.entryPath}
                        </p>
                        <p className="text-[11px] text-fg-subtle tabular-nums">
                          {formatBytes(candidate.sizeBytes)} • {candidate.report.format === "ui"
                            ? "UI workflow"
                            : "API prompt"}
                          {" • "}
                          {candidate.report.missingNodeClasses.length} missing node(s)
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant={
                          candidate.report.previewId === archiveCandidateId
                            ? "primary"
                            : "utility"
                        }
                        onClick={() =>
                          setArchiveCandidateId(candidate.report.previewId)
                        }
                      >
                        {candidate.report.previewId === archiveCandidateId ? "Selected" : "Review"}
                      </Button>
                    </div>
                  ))}
                </div>

                {archivePreview.warnings.length > 0 && (
                  <div className="space-y-1 rounded-lg border border-warning/30 bg-warning-soft p-3">
                    <p className="inline-flex items-center gap-1.5 text-small font-medium text-warning">
                      <AlertTriangle className="w-4 h-4" />
                      Archive warnings
                    </p>
                    {archivePreview.warnings.map((warning) => (
                      <p key={warning} className="text-small text-fg-muted">
                        {warning}
                      </p>
                    ))}
                  </div>
                )}
              </Card>
            )}

            {archiveSelectedReport && (
              <ImportReportView
                report={archiveSelectedReport}
                installing={installing}
                onInstall={() => void installReport(archiveSelectedReport)}
              />
            )}
          </div>

          <Card className="p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Archive className="w-4 h-4 text-accent" />
                <h3 className="text-h3 text-fg">Installed in ComfyUI</h3>
              </div>
              <Button size="sm" variant="ghost" onClick={() => void refreshInstalled()}>
                <RefreshCw className="w-3.5 h-3.5" />
                Refresh
              </Button>
            </div>

            {installedFolder && (
              <p className="font-mono text-[11px] text-fg-subtle break-all">{installedFolder}</p>
            )}

            {installed.length === 0 ? (
              <p className="text-small text-fg-muted">
                No workflows imported by Kirea yet. Installed files appear here and in ComfyUI's
                workflow browser.
              </p>
            ) : (
              <div className="divide-y divide-border rounded-lg border border-border">
                {installed.slice(0, 6).map((file) => (
                  <div
                    key={file.filePath}
                    className="flex items-center justify-between gap-3 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="font-mono text-small text-fg truncate">{file.fileName}</p>
                      <p className="text-[11px] text-fg-subtle tabular-nums">
                        {formatBytes(file.sizeBytes)} •{" "}
                        {new Date(file.modifiedAt).toLocaleString()}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="utility"
                      onClick={() => void reveal(file.filePath)}
                      title="Reveal in Explorer"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      Reveal
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <Button variant="ghost" size="sm" onClick={() => setTab("installed")}>
              Manage installed workflows
            </Button>

            <p className="text-[11px] text-fg-subtle">
              Missing custom nodes and models are never fetched automatically. Resolve them in
              ComfyUI or the model vault first.
            </p>
          </Card>
        </div>
      )}

      {tab === "installed" && (
        <div className="space-y-4">
          <Card className="p-4 space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
                <input
                  className={`${INPUT_CLASS} pl-8`}
                  placeholder="Search installed workflows"
                  value={installedQuery}
                  onChange={(event) => setInstalledQuery(event.target.value)}
                  aria-label="Search installed workflows"
                />
              </div>
              <div className="w-full sm:w-56">
                <Select
                  value={installedFilter}
                  onChange={(event) =>
                    setInstalledFilter(event.target.value as InstalledFilter)
                  }
                  aria-label="Filter installed workflows"
                >
                  <option value="all">All ({installed.length})</option>
                  <option value="compatible">Compatible ({installedCounts.compatible})</option>
                  <option value="incompatible">
                    Missing dependencies ({installedCounts.incompatible})
                  </option>
                  <option value="unknown">Unverified ({installedCounts.unknown})</option>
                </Select>
              </div>
              <Button variant="secondary" onClick={() => void refreshInstalled()}>
                <RefreshCw className="w-3.5 h-3.5" />
                Refresh
              </Button>
            </div>
            {installedFolder && (
              <p className="font-mono text-[11px] text-fg-subtle break-all">
                ComfyUI workflows folder: {installedFolder}
              </p>
            )}
          </Card>

          {visibleInstalled.length === 0 ? (
            <Card className="p-6 text-center">
              <p className="text-small text-fg-muted">
                {installed.length === 0
                  ? "No workflows imported by Kirea yet."
                  : "No installed workflows match this search or filter."}
              </p>
            </Card>
          ) : (
            <div className="space-y-3">
              {visibleInstalled.map((file) => {
                const record = file.importRecord ?? null;
                const status = record?.compatibility ?? "unknown";
                return (
                  <Card key={file.filePath} className="p-4 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-small font-semibold text-fg truncate">
                            {record?.workflowName ?? file.fileName}
                          </h3>
                          <Badge tone={compatibilityTone(status)}>
                            {compatibilityLabel(status)}
                          </Badge>
                          {record && (
                            <Badge tone="neutral">
                              {record.format === "ui" ? "UI workflow" : "API prompt"}
                            </Badge>
                          )}
                          {record?.sourceKind === "civitai" && (
                            <Badge tone="accent">Civitai</Badge>
                          )}
                          {record?.sourceKind === "archive" && (
                            <Badge tone="info">ZIP</Badge>
                          )}
                        </div>
                        <p className="font-mono text-[11px] text-fg-subtle break-all">
                          {file.fileName} • {formatBytes(file.sizeBytes)} •{" "}
                          {new Date(file.modifiedAt).toLocaleString()}
                        </p>
                        {record && (
                          <p className="text-[11px] text-fg-muted break-all">
                            Source: {record.sourceKind}
                            {record.sourceLabel ? ` • ${record.sourceLabel}` : ""}
                            {record.civitaiModelId !== null
                              ? ` • Civitai model ${record.civitaiModelId}`
                              : ""}
                            {record.civitaiVersionId !== null
                              ? ` / version ${record.civitaiVersionId}`
                              : ""}
                          </p>
                        )}
                        {record?.originalFileName && (
                          <p className="text-[11px] text-fg-subtle break-all">
                            Original: {record.originalFileName}
                            {record.archiveEntry ? ` (${record.archiveEntry})` : ""}
                          </p>
                        )}
                        {record && (
                          <p className="text-[11px] text-fg-subtle tabular-nums">
                            Imported {new Date(record.importedAt).toLocaleString()} •{" "}
                            {record.missingNodeCount} missing node class(es) •{" "}
                            {record.missingModelCount} missing model(s)
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                      <Button
                        size="sm"
                        variant="utility"
                        onClick={() => setDetailsFile(file)}
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Details
                      </Button>
                      <Button
                        size="sm"
                        variant="utility"
                        onClick={() => void reveal(file.filePath)}
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
                        Reveal
                      </Button>
                      <Button
                        size="sm"
                        variant="utility"
                        loading={revalidatingPath === file.filePath}
                        onClick={() => void revalidate(file)}
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        Revalidate
                      </Button>
                      <Button
                        size="sm"
                        variant="utility"
                        loading={reimportingPath === file.filePath}
                        onClick={() => void reimport(file)}
                      >
                        <History className="w-3.5 h-3.5" />
                        Reimport
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => setRemoveTarget(file)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Remove
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      <Modal
        open={selectedWorkflow !== null}
        onClose={() => {
          setSelectedWorkflow(null);
          setBrowserPreview(null);
          setBrowserCandidateId(null);
        }}
        title={selectedWorkflow?.name ?? "Civitai workflow"}
        maxWidthClass="max-w-3xl"
      >
        {selectedWorkflow && (
          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            {selectedWorkflow.primaryPreviewUrl && (
              <div className="aspect-video bg-bg border border-border rounded-lg overflow-hidden">
                <img
                  src={selectedWorkflow.primaryPreviewUrl}
                  alt=""
                  className="w-full h-full object-contain"
                />
              </div>
            )}

            <div className="flex flex-wrap items-center gap-1.5">
              {selectedWorkflow.installed && <Badge tone="success">Installed</Badge>}
              {selectedWorkflow.categories.map((category) => (
                <Badge key={category} tone="neutral">
                  {CIVITAI_WORKFLOW_CATEGORIES.find((entry) => entry.id === category)?.label ??
                    category}
                </Badge>
              ))}
              {selectedWorkflow.baseModels.map((baseModel) => (
                <Badge key={baseModel} tone="info">
                  {baseModel}
                </Badge>
              ))}
            </div>

            <p className="text-small text-fg-muted whitespace-pre-line">
              {selectedWorkflow.description?.trim() || "No description was provided on Civitai."}
            </p>

            <div className="grid grid-cols-3 gap-2 rounded-xl border border-border bg-bg p-3 text-small">
              <div>
                <div className="text-fg-subtle">Creator</div>
                <div className="font-medium text-fg truncate">
                  {selectedWorkflow.creator ?? "Unknown"}
                </div>
              </div>
              <div>
                <div className="text-fg-subtle">Downloads</div>
                <div className="font-medium text-fg tabular-nums">
                  {formatCount(selectedWorkflow.stats.downloads)}
                </div>
              </div>
              <div>
                <div className="text-fg-subtle">Rating</div>
                <div className="font-medium text-fg tabular-nums">
                  {selectedWorkflow.stats.rating > 0
                    ? `${selectedWorkflow.stats.rating.toFixed(1)} / 5`
                    : "—"}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="label-mono text-label">Version</div>
              <Select
                value={selectedVersionId ?? ""}
                onChange={(event) => {
                  setSelectedVersionId(Number(event.target.value));
                  setBrowserPreview(null);
                  setBrowserCandidateId(null);
                }}
                aria-label="Workflow version"
              >
                {selectedWorkflow.versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {version.name}
                    {version.installed ? " — installed" : ""}
                  </option>
                ))}
              </Select>
              {selectedVersion && (
                <p className="text-[11px] text-fg-subtle">
                  Published{" "}
                  {selectedVersion.publishedAt
                    ? new Date(selectedVersion.publishedAt).toLocaleDateString()
                    : "date unavailable"}{" "}
                  • {selectedVersion.stats.downloads} downloads
                  {selectedVersion.installedFileName
                    ? ` • installed as ${selectedVersion.installedFileName}`
                    : ""}
                </p>
              )}
            </div>

            {selectedVersion && (
              <div className="space-y-2">
                <div className="label-mono text-label">Workflow files</div>
                {selectedVersion.files.length === 0 ? (
                  <p className="text-small text-fg-muted">
                    Civitai did not list a file for this version.
                  </p>
                ) : (
                  <div className="divide-y divide-border rounded-lg border border-border">
                    {selectedVersion.files.map((file) => (
                      <div
                        key={`${file.id ?? file.fileName}`}
                        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="font-mono text-small text-fg break-all">
                            {file.fileName}
                          </p>
                          <p className="text-[11px] text-fg-subtle">
                            {file.fileType ?? "unknown type"} • {formatBytes(file.sizeBytes)}
                            {file.primary ? " • primary" : ""}
                          </p>
                        </div>
                        <Badge
                          tone={
                            file.kind === "unsupported"
                              ? "danger"
                              : file.kind === "zip"
                                ? "info"
                                : "success"
                          }
                        >
                          {file.kind === "unsupported" ? "unsupported" : file.kind}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {selectedVersion?.description && (
              <p className="text-small text-fg-muted whitespace-pre-line">
                {selectedVersion.description}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
              <p className="max-w-[52ch] text-[11px] text-fg-subtle">
                Kirea downloads only the listed workflow file and inspects it before
                installation. Model weights are never downloaded automatically.
              </p>
              <Button
                variant="accent"
                loading={browserBusy}
                onClick={() => void prepareBrowserImport()}
                disabled={!selectedVersion || selectedVersion.primaryFile === null}
              >
                <Download className="w-3.5 h-3.5" />
                Prepare import
              </Button>
            </div>

            {browserPreview && (
              <div className="space-y-3 rounded-xl border border-border bg-bg p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-small font-medium text-fg">
                      {browserPreview.fileKind === "zip"
                        ? `Archive with ${browserPreview.candidates.length} workflow candidate(s)`
                        : "Workflow analyzed"}
                    </p>
                    <p className="text-[11px] text-fg-subtle break-all">
                      {browserPreview.originalFileName}
                    </p>
                  </div>
                  <Badge tone="neutral">{browserPreview.fileKind.toUpperCase()}</Badge>
                </div>

                {browserPreview.notes.map((note) => (
                  <p key={note} className="text-small text-fg-muted">
                    • {note}
                  </p>
                ))}

                {browserPreview.candidates.length > 0 && (
                  <div className="divide-y divide-border rounded-lg border border-border">
                    {browserPreview.candidates.map((candidate) => (
                      <div
                        key={candidate.report.previewId}
                        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="font-mono text-small text-fg break-all">
                            {candidate.entryPath}
                          </p>
                          <p className="text-[11px] text-fg-subtle">
                            {candidate.report.format === "ui" ? "UI workflow" : "API prompt"} •{" "}
                            {candidate.report.missingNodeClasses.length} missing node class(es) •{" "}
                            {
                              candidate.report.modelReferences.filter(
                                (reference) => !reference.installed
                              ).length
                            }{" "}
                            missing model(s)
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant={
                            browserCandidateId === candidate.report.previewId
                              ? "primary"
                              : "utility"
                          }
                          onClick={() => setBrowserCandidateId(candidate.report.previewId)}
                        >
                          {browserCandidateId === candidate.report.previewId
                            ? "Selected"
                            : "Review"}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                {browserSelectedReport && (
                  <div className="rounded-lg border border-border bg-surface p-3 space-y-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge
                        tone={browserSelectedReport.installable ? "success" : "warning"}
                      >
                        {browserSelectedReport.installable ? "Installable" : "Analyze only"}
                      </Badge>
                      {browserSelectedReport.video && <Badge tone="info">video</Badge>}
                      <Badge tone="neutral">
                        {browserSelectedReport.missingNodeClasses.length} missing node(s)
                      </Badge>
                      <Badge tone="neutral">
                        {
                          browserSelectedReport.modelReferences.filter(
                            (reference) => !reference.installed
                          ).length
                        }{" "}
                        missing model(s)
                      </Badge>
                    </div>
                    <p className="text-small text-fg-muted">
                      {browserSelectedReport.installable
                        ? "UI workflow analyzed. Review the dependencies in the import tab before installing."
                        : "This is an API prompt graph, which can be validated but not installed into ComfyUI's workflow browser."}
                    </p>
                    <Button
                      variant="accent"
                      loading={installing}
                      disabled={!browserSelectedReport.installable}
                      onClick={() => void installReport(browserSelectedReport)}
                    >
                      <Upload className="w-3.5 h-3.5" />
                      Install into ComfyUI
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={detailsFile !== null}
        onClose={() => setDetailsFile(null)}
        title={detailsFile?.importRecord?.workflowName ?? detailsFile?.fileName ?? "Workflow"}
        maxWidthClass="max-w-2xl"
      >
        {detailsFile && (
          <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
            <p className="font-mono text-[11px] text-fg-subtle break-all">
              {detailsFile.filePath}
            </p>
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-bg p-3 text-small">
              <div>
                <div className="text-fg-subtle">Size</div>
                <div className="font-medium text-fg tabular-nums">
                  {formatBytes(detailsFile.sizeBytes)}
                </div>
              </div>
              <div>
                <div className="text-fg-subtle">Modified</div>
                <div className="font-medium text-fg tabular-nums">
                  {new Date(detailsFile.modifiedAt).toLocaleString()}
                </div>
              </div>
              {detailsFile.importRecord && (
                <>
                  <div>
                    <div className="text-fg-subtle">Source</div>
                    <div className="font-medium text-fg break-all">
                      {detailsFile.importRecord.sourceKind}
                    </div>
                  </div>
                  <div>
                    <div className="text-fg-subtle">Imported</div>
                    <div className="font-medium text-fg tabular-nums">
                      {new Date(detailsFile.importRecord.importedAt).toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="text-fg-subtle">Compatibility</div>
                    <div className="font-medium text-fg">
                      {compatibilityLabel(detailsFile.importRecord.compatibility)}
                    </div>
                  </div>
                  <div>
                    <div className="text-fg-subtle">Missing dependencies</div>
                    <div className="font-medium text-fg tabular-nums">
                      {detailsFile.importRecord.missingNodeCount} node class(es),{" "}
                      {detailsFile.importRecord.missingModelCount} model(s)
                    </div>
                  </div>
                </>
              )}
            </div>
            {detailsFile.importRecord?.sourceUrl && (
              <p className="text-small text-fg-muted break-all">
                <span className="text-fg-subtle">Source URL: </span>
                {detailsFile.importRecord.sourceUrl}
              </p>
            )}
            {detailsFile.importRecord?.originalFileName && (
              <p className="text-small text-fg-muted break-all">
                <span className="text-fg-subtle">Original file: </span>
                {detailsFile.importRecord.originalFileName}
                {detailsFile.importRecord.archiveEntry
                  ? ` (archive entry ${detailsFile.importRecord.archiveEntry})`
                  : ""}
              </p>
            )}
            {detailsFile.importRecord && (
              <p className="text-small text-fg-muted">
                Civitai model {detailsFile.importRecord.civitaiModelId ?? "—"}, version{" "}
                {detailsFile.importRecord.civitaiVersionId ?? "—"}
              </p>
            )}
            <div className="flex flex-wrap gap-2 border-t border-border pt-3">
              <Button
                size="sm"
                variant="utility"
                onClick={() => void reveal(detailsFile.filePath)}
              >
                <FolderOpen className="w-3.5 h-3.5" />
                Reveal
              </Button>
              <Button
                size="sm"
                variant="utility"
                loading={revalidatingPath === detailsFile.filePath}
                onClick={() => void revalidate(detailsFile)}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                Revalidate
              </Button>
              <Button
                size="sm"
                variant="utility"
                loading={reimportingPath === detailsFile.filePath}
                onClick={() => void reimport(detailsFile)}
              >
                <History className="w-3.5 h-3.5" />
                Reimport
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={reimportReport !== null}
        onClose={() => setReimportReport(null)}
        title="Reimport preview"
        maxWidthClass="max-w-2xl"
      >
        {reimportReport && (
          <div className="max-h-[70vh] overflow-y-auto pr-1">
            <p className="mb-3 text-small text-fg-muted">
              Reimport analyzed the original source again. Installing creates a new file and never
              overwrites the existing workflow.
            </p>
            <ImportReportView
              report={reimportReport}
              installing={installing}
              onInstall={() => void installReport(reimportReport)}
            />
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        onConfirm={() => {
          if (removeTarget) void removeInstalled(removeTarget);
        }}
        title="Remove installed workflow?"
        description={
          removeTarget
            ? `This deletes '${removeTarget.fileName}' from ComfyUI's workflows folder and removes its import record. Models are not affected.`
            : ""
        }
        confirmLabel="Remove workflow"
      />
    </div>
  );
};
