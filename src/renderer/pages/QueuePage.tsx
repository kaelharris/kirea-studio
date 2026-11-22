import React from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Download,
  Pause,
  Play,
  RotateCcw,
  Square,
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
  onToast: (msg: string, tone?: "info" | "error") => void;
}

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

export const QueuePage: React.FC<QueuePageProps> = ({
  jobs,
  models,
  downloads,
  onNavigate,
  onToast,
}) => {
  const handleRetry = async (jobId: string): Promise<void> => {
    try {
      await window.kirea.retryJob(jobId);
      onToast("Job re-queued.");
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
          <h2 className="label-mono text-label">
            Download Manager ({downloads.length})
          </h2>
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
      <div className="space-y-3">
        <h2 className="label-mono text-label">
          Generation Job History ({jobs.length})
        </h2>

        {jobs.length === 0 ? (
          <EmptyState
            icon={<Clock className="w-5 h-5" />}
            title="No generation jobs yet"
            description="Jobs submitted from Create Studio appear here with real-time step progress and retry controls."
          />
        ) : (
          <div className="space-y-2.5">
            {jobs.map((job) => {
              const isActive =
                job.status === "IDLE" ||
                job.status === "VALIDATING" ||
                job.status === "SUBMITTING" ||
                job.status === "QUEUED" ||
                job.status === "RUNNING" ||
                job.status === "PROCESSING_OUTPUT";
              const pct =
                job.progressMax > 0
                  ? Math.min(100, Math.round((job.progressStep / job.progressMax) * 100))
                  : 0;
              const advice = errorAdvice(job.errorKind);

              return (
                <Card key={job.id} className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
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
                    {(job.status === "FAILED" || job.status === "CANCELLED") && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void handleRetry(job.id)}
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Retry
                      </Button>
                    )}
                    {job.status === "COMPLETED" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onNavigate("library")}
                      >
                        View in Library
                      </Button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

