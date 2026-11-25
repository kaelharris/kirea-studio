import React, { useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  CheckSquare,
  Clock,
  Download,
  Eraser,
  Pause,
  Play,
  RotateCcw,
  Square,
  Square as SquareIcon,
  Trash2,
  X,
} from "lucide-react";
import type {
  DownloadTask,
  GenerationJob,
  JobErrorKind,
  ModelRecord,
  NavSection,
} from "../../shared/types";
import { getModelRefDisplayName } from "../../shared/model-utils";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  SectionHeader,
} from "../components/ui/Primitives";
import { MediaImage } from "../components/ui/MediaImage";
import {
  formatBytes,
  formatDurationSeconds,
  formatRelativeTime,
  toMediaUrl,
} from "../utils/format";

interface QueuePageProps {
  jobs: GenerationJob[];
  models: ModelRecord[];
  downloads: DownloadTask[];
  onNavigate: (page: NavSection) => void;
  onClearDownloads?: () => void;
  onDeleteJob?: (jobId: string) => Promise<void>;
  onDeleteJobs?: (jobIds: string[]) => Promise<void>;
  onToast: (msg: string, tone?: "info" | "error") => void;
}

type JobFilter = "all" | "active" | "failed" | "completed";

function errorAdvice(kind: JobErrorKind): string | null {
  switch (kind) {
    case "CUDA_OOM":
      return "Tip: Switch Performance Profile to 'Memory Saver' or lower image resolution.";
    case "MISSING_MODEL":
      return "Tip: Rescan Models or check that the selected checkpoint/VAE/LoRA is available.";
    case "RUNTIME_CRASH":
      return "Tip: Check Settings -> Runtime Logs and restart the ComfyUI engine.";
    default:
      return null;
  }
}

function isJobActive(status: GenerationJob["status"]): boolean {
  return (
    status === "IDLE" ||
    status === "VALIDATING" ||
    status === "SUBMITTING" ||
    status === "QUEUED" ||
    status === "RUNNING" ||
    status === "PROCESSING_OUTPUT"
  );
}

export const QueuePage: React.FC<QueuePageProps> = ({
  jobs,
  models,
  downloads,
  onNavigate,
  onClearDownloads,
  onDeleteJob,
  onDeleteJobs,
  onToast,
}) => {
  const [filter, setFilter] = useState<JobFilter>("all");
  const [selectedFailedIds, setSelectedFailedIds] = useState<Set<string>>(new Set());
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [bulkDeleteTarget, setBulkDeleteTarget] = useState<{
    ids: string[];
    label: string;
  } | null>(null);

  const activeJobs = useMemo(
    () => jobs.filter((j) => isJobActive(j.status)),
    [jobs]
  );
  const failedJobs = useMemo(
    () => jobs.filter((j) => j.status === "FAILED" || j.status === "CANCELLED"),
    [jobs]
  );
  const completedJobs = useMemo(
    () => jobs.filter((j) => j.status === "COMPLETED"),
    [jobs]
  );

  const filteredJobs = useMemo(() => {
    switch (filter) {
      case "active":
        return activeJobs;
      case "failed":
        return failedJobs;
      case "completed":
        return completedJobs;
      case "all":
      default:
        return jobs;
    }
  }, [filter, jobs, activeJobs, failedJobs, completedJobs]);

  const handleRetry = async (jobId: string): Promise<void> => {
    try {
      await window.kirea.retryJob(jobId);
      onToast("Job re-queued.");
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const handleToggleSelectFailed = (id: string) => {
    setSelectedFailedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectAllFailed = () => {
    if (selectedFailedIds.size === failedJobs.length) {
      setSelectedFailedIds(new Set());
    } else {
      setSelectedFailedIds(new Set(failedJobs.map((j) => j.id)));
    }
  };

  const handleConfirmSingleDelete = async () => {
    if (!deleteTargetId || !onDeleteJob) return;
    try {
      await onDeleteJob(deleteTargetId);
      setSelectedFailedIds((prev) => {
        const next = new Set(prev);
        next.delete(deleteTargetId);
        return next;
      });
      setDeleteTargetId(null);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const handleConfirmBulkDelete = async () => {
    if (!bulkDeleteTarget || !onDeleteJobs) return;
    try {
      await onDeleteJobs(bulkDeleteTarget.ids);
      setSelectedFailedIds((prev) => {
        const next = new Set(prev);
        for (const id of bulkDeleteTarget.ids) {
          next.delete(id);
        }
        return next;
      });
      setBulkDeleteTarget(null);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Queue & Download Monitor"
        subtitle="Monitor active inference jobs, recover interrupted renders, and manage local asset downloads."
        actions={
          <Button variant="primary" onClick={() => onNavigate("create")}>
            New Generation
          </Button>
        }
      />

      {/* Active Downloads Section */}
      {downloads.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="label-mono text-label">
              Download Manager ({downloads.length})
            </h2>
            {downloads.some(
              (dl) =>
                dl.status === "completed" ||
                dl.status === "failed" ||
                dl.status === "cancelled"
            ) && onClearDownloads && (
              <Button
                size="sm"
                variant="secondary"
                onClick={onClearDownloads}
                className="font-mono text-xs uppercase"
                title="Clear finished downloads from list (files on disk are preserved)"
              >
                <Eraser className="w-3.5 h-3.5 mr-1" />
                Clear History
              </Button>
            )}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {downloads.map((dl) => {
              const pct =
                dl.totalBytes > 0
                  ? Math.min(100, Math.round((dl.downloadedBytes / dl.totalBytes) * 100))
                  : 0;
              return (
                <Card key={dl.id} className="p-4 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Download className="w-4 h-4 text-accent shrink-0" />
                        <h3 className="truncate text-h3 text-fg">
                          {dl.title}
                        </h3>
                      </div>
                      <p
                        className="mt-0.5 truncate font-mono text-tech text-fg-subtle"
                        title={dl.targetPath}
                      >
                        {dl.targetPath}
                      </p>
                    </div>
                    <Badge
                      tone={
                        dl.status === "completed"
                          ? "success"
                          : dl.status === "failed"
                            ? "danger"
                            : dl.status === "downloading"
                              ? "accent"
                              : "neutral"
                      }
                    >
                      {dl.status}
                    </Badge>
                  </div>

                  <div className="space-y-1">
                    <div className="w-full h-1.5 bg-surface-subtle rounded-full overflow-hidden">
                      <div
                        className="h-full bg-accent transition-[width] duration-200 ease-out"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-caption tabular-nums text-fg-muted">
                      <span>
                        {formatBytes(dl.downloadedBytes)} / {formatBytes(dl.totalBytes)} ({pct}%)
                      </span>
                      <span>
                        {dl.status === "downloading"
                          ? `${(dl.speedBytesPerSec / (1024 * 1024)).toFixed(2)} MB/s • ETA ${formatDurationSeconds(dl.etaSeconds)}`
                          : dl.actualSha256
                            ? `SHA-256 ${dl.actualSha256.slice(0, 12)}...`
                            : dl.licenseName}
                      </span>
                    </div>
                  </div>

                  {dl.error && (
                    <p className="text-small text-danger">{dl.error}</p>
                  )}

                  <div className="flex justify-end gap-1.5">
                    {dl.status === "downloading" && (
                      <>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void window.kirea.pauseDownload(dl.id)}
                        >
                          <Pause className="w-3.5 h-3.5" />
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
                    {(dl.status === "paused" || dl.status === "failed") && (
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
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Generation Jobs */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="label-mono text-label">
              Generation Job History ({jobs.length})
            </h2>

            {/* Status Filter Chips */}
            <div className="flex items-center gap-1.5 p-1 bg-surface-subtle border border-border">
              {(
                [
                  { id: "all", label: "ALL", count: jobs.length },
                  { id: "active", label: "ACTIVE", count: activeJobs.length },
                  { id: "failed", label: "FAILED", count: failedJobs.length },
                  { id: "completed", label: "COMPLETED", count: completedJobs.length },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilter(tab.id)}
                  className={`px-2.5 py-1 text-xs font-mono font-medium transition-colors ${
                    filter === tab.id
                      ? "bg-[#1E3BFF] text-[#F2F2EE]"
                      : "text-fg-muted hover:text-fg hover:bg-surface"
                  }`}
                >
                  {tab.label} ({tab.count})
                </button>
              ))}
            </div>
          </div>

          {/* Bulk Action Controls */}
          {failedJobs.length > 0 && onDeleteJobs && (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={handleSelectAllFailed}
                className="font-mono text-xs uppercase"
              >
                {selectedFailedIds.size === failedJobs.length && failedJobs.length > 0 ? (
                  <>
                    <CheckSquare className="w-3.5 h-3.5 mr-1 text-[#1E3BFF]" />
                    Deselect All
                  </>
                ) : (
                  <>
                    <SquareIcon className="w-3.5 h-3.5 mr-1" />
                    Select All Failed
                  </>
                )}
              </Button>

              {selectedFailedIds.size > 0 && (
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() =>
                    setBulkDeleteTarget({
                      ids: Array.from(selectedFailedIds),
                      label: `${selectedFailedIds.size} Selected`,
                    })
                  }
                  className="font-mono text-xs uppercase"
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1" />
                  Delete Selected ({selectedFailedIds.size})
                </Button>
              )}

              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  setBulkDeleteTarget({
                    ids: failedJobs.map((j) => j.id),
                    label: "All Failed Jobs",
                  })
                }
                className="font-mono text-xs uppercase"
                title="Permanently remove all failed generation records from history"
              >
                <Eraser className="w-3.5 h-3.5 mr-1" />
                Clear All Failed ({failedJobs.length})
              </Button>
            </div>
          )}
        </div>

        {filteredJobs.length === 0 ? (
          <EmptyState
            icon={<Clock className="w-5 h-5" />}
            title={
              filter === "all"
                ? "No generation jobs yet"
                : `No ${filter} generation jobs`
            }
            description={
              filter === "all"
                ? "Jobs submitted from Create Studio appear here with real-time step progress, deletion, and retry controls."
                : `There are currently no jobs matching the '${filter}' filter.`
            }
          />
        ) : (
          <div className="space-y-2.5">
            {filteredJobs.map((job) => {
              const isActive = isJobActive(job.status);
              const isFailed = job.status === "FAILED" || job.status === "CANCELLED";
              const isSelected = selectedFailedIds.has(job.id);
              const pct =
                job.progressMax > 0
                  ? Math.min(100, Math.round((job.progressStep / job.progressMax) * 100))
                  : 0;
              const advice = errorAdvice(job.errorKind);

              return (
                <Card
                  key={job.id}
                  className={`p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors ${
                    isSelected ? "border-[#1E3BFF] bg-[#1E3BFF]/5" : ""
                  }`}
                >
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    {/* Batch Selection Checkbox for Failed / Cancelled Jobs */}
                    {isFailed && onDeleteJobs && (
                      <button
                        type="button"
                        onClick={() => handleToggleSelectFailed(job.id)}
                        className="mt-1 text-fg-subtle hover:text-fg focus:outline-none shrink-0"
                        title={isSelected ? "Deselect job" : "Select job for bulk deletion"}
                      >
                        {isSelected ? (
                          <CheckSquare className="w-4 h-4 text-[#1E3BFF]" />
                        ) : (
                          <SquareIcon className="w-4 h-4 text-fg-muted" />
                        )}
                      </button>
                    )}

                    {job.outputPaths[0] ? (
                      <MediaImage
                        src={toMediaUrl(job.outputPaths[0])}
                        alt={job.prompt}
                        compact
                        className="w-16 h-16 rounded-lg bg-surface-subtle object-contain border border-border shrink-0"
                      />
                    ) : (
                      <div className="w-16 h-16 rounded-lg bg-surface-subtle border border-border flex items-center justify-center shrink-0">
                        {job.status === "COMPLETED" ? (
                          <CheckCircle2 className="w-5 h-5 text-success" />
                        ) : job.status === "FAILED" ? (
                          <AlertCircle className="w-5 h-5 text-danger" />
                        ) : (
                          <Clock className="w-5 h-5 text-accent" />
                        )}
                      </div>
                    )}

                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          tone={
                            job.status === "COMPLETED"
                              ? "success"
                              : job.status === "FAILED"
                                ? "danger"
                                : job.status === "CANCELLED"
                                  ? "neutral"
                                  : "accent"
                          }
                        >
                          {job.status}
                        </Badge>
                        {job.errorKind !== "NONE" && job.errorKind !== "CANCELLED" && (
                          <Badge tone="warning">{job.errorKind}</Badge>
                        )}
                        <span className="text-small text-fg-muted">
                          {getModelRefDisplayName(models, job.checkpoint)}
                        </span>
                        <span className="font-mono text-tech tabular-nums text-fg-subtle">
                          {formatRelativeTime(job.submittedAt)}
                        </span>
                      </div>

                      <p className="line-clamp-1 text-small text-fg">{job.prompt}</p>

                      {isActive && (
                        <div className="max-w-sm space-y-1 pt-1">
                          <div className="w-full h-1.5 bg-surface-subtle rounded-full overflow-hidden">
                            <div
                              className="h-full bg-accent transition-[width] duration-200 ease-out"
                              style={{ width: `${Math.max(5, pct)}%` }}
                            />
                          </div>
                          <div className="text-caption tabular-nums text-fg-subtle">
                            Step {job.progressStep}/{job.progressMax} ({pct}%)
                          </div>
                        </div>
                      )}

                      {job.errorMessage && (
                        <div className="space-y-0.5 text-small text-danger">
                          <p>{job.errorMessage}</p>
                          {advice && <p className="text-fg-muted">{advice}</p>}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {isActive && (
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => void window.kirea.cancelJob(job.id)}
                      >
                        <Square className="w-3.5 h-3.5 fill-current" />
                        Cancel
                      </Button>
                    )}
                    {isFailed && (
                      <>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void handleRetry(job.id)}
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Retry
                        </Button>
                        {onDeleteJob && (
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => setDeleteTargetId(job.id)}
                            title="Delete failed generation from history"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Delete
                          </Button>
                        )}
                      </>
                    )}
                    {job.status === "COMPLETED" && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onNavigate("library")}
                        >
                          View in Library
                        </Button>
                        {onDeleteJob && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setDeleteTargetId(job.id)}
                            title="Remove job record from queue history (image remains in Library)"
                          >
                            <Trash2 className="w-3.5 h-3.5 text-fg-subtle hover:text-danger" />
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Confirmation Dialog for Single Job Deletion */}
      <ConfirmDialog
        open={Boolean(deleteTargetId)}
        onClose={() => setDeleteTargetId(null)}
        onConfirm={() => void handleConfirmSingleDelete()}
        title="Delete Generation Job Record"
        description="Are you sure you want to remove this generation record from history? Output images already saved to your library will not be affected."
        confirmLabel="Delete"
        danger={true}
        defaultFocusConfirm={true}
      />

      {/* Confirmation Dialog for Bulk Job Deletion */}
      <ConfirmDialog
        open={Boolean(bulkDeleteTarget)}
        onClose={() => setBulkDeleteTarget(null)}
        onConfirm={() => void handleConfirmBulkDelete()}
        title={`Delete ${bulkDeleteTarget?.ids.length ?? 0} Generation Records`}
        description={`Are you sure you want to remove ${
          bulkDeleteTarget?.label ?? "these records"
        } from history? Output images in your Library will remain intact.`}
        confirmLabel="Delete All"
        danger={true}
        defaultFocusConfirm={true}
      />
    </div>
  );
};
