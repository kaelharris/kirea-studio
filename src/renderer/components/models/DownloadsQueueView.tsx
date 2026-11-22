import React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CloudDownload,
  FolderOpen,
  HardDrive,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import type { CivitaiDownloadTask } from "../../../shared/civitai";
import type { DownloadStatus, DownloadTask } from "../../../shared/types";
import { ARCHITECTURE_LABELS } from "../../../shared/model-utils";
import { formatBytes, formatDurationSeconds } from "../../utils/format";
import { Badge, Button, Card, EmptyState } from "../ui/Primitives";

const GENERIC_STATUS_LABELS: Record<DownloadStatus, string> = {
  pending: "Queued",
  downloading: "Downloading",
  paused: "Paused",
  verifying: "Verifying SHA-256",
  extracting: "Extracting",
  completed: "Installed",
  failed: "Failed",
  cancelled: "Cancelled",
};

const GENERIC_STATUS_TONES: Record<
  DownloadStatus,
  "neutral" | "accent" | "success" | "warning" | "danger"
> = {
  pending: "neutral",
  downloading: "accent",
  paused: "warning",
  verifying: "warning",
  extracting: "warning",
  completed: "success",
  failed: "danger",
  cancelled: "neutral",
};
import {
  categoryLabel,
  DOWNLOAD_STATUS_LABELS,
  DOWNLOAD_STATUS_TONES,
  downloadPercent,
  folderOf,
  formatSpeed,
  isActiveDownload,
} from "./models-helpers";

interface DownloadsQueueViewProps {
  civitaiDownloads: CivitaiDownloadTask[];
  activeDownloads: CivitaiDownloadTask[];
  completedDownloads: CivitaiDownloadTask[];
  hfDownloads: DownloadTask[];
  onSwitchToHub: () => void;
  onSwitchToVault: () => void;
  onPauseDownload?: (task: CivitaiDownloadTask) => void;
  onCancelDownload: (task: CivitaiDownloadTask) => void;
  onRetryDownload: (task: CivitaiDownloadTask) => void;
  onPauseHfDownload: (task: DownloadTask) => void;
  onResumeHfDownload: (task: DownloadTask) => void;
  onCancelHfDownload: (task: DownloadTask) => void;
  onOpenPath: (targetPath: string) => void;
}

export const DownloadsQueueView: React.FC<DownloadsQueueViewProps> = ({
  civitaiDownloads,
  activeDownloads,
  completedDownloads,
  hfDownloads,
  onSwitchToHub,
  onSwitchToVault,
  onPauseDownload,
  onCancelDownload,
  onRetryDownload,
  onPauseHfDownload,
  onResumeHfDownload,
  onCancelHfDownload,
  onOpenPath,
}) => {
    if (civitaiDownloads.length === 0 && hfDownloads.length === 0) {
      return (
        <EmptyState
          icon={<HardDrive className="w-5 h-5" />}
          title="No model downloads yet"
          description="Search Civitai or Hugging Face and send a model to your vault. Progress, speed, pause/resume, and verification status appear here."
          action={
            <Button variant="primary" onClick={() => onSwitchToHub()}>
              <CloudDownload className="w-4 h-4" />
              Open Model Hub
            </Button>
          }
        />
      );
    }

    return (
      <div className="space-y-4">
        {hfDownloads.length > 0 && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
              <Badge tone="accent">Hugging Face</Badge>
              <span className="text-fg-subtle">
                Persisted downloads with provider authentication, resume, SHA-256 verification, and model-library registration.
              </span>
            </div>
            {hfDownloads.map((task) => {
              const pct =
                task.status === "completed"
                  ? 100
                  : task.totalBytes > 0
                    ? Math.min(100, Math.round((task.downloadedBytes / task.totalBytes) * 100))
                    : 0;
              const active =
                task.status === "pending" ||
                task.status === "downloading" ||
                task.status === "verifying" ||
                task.status === "extracting";
              const pausable = task.status === "pending" || task.status === "downloading";
              const resumable = task.status === "paused" || task.status === "failed";
              return (
                <Card key={task.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-fg truncate">{task.title}</h3>
                      <p className="text-[11px] text-fg-subtle truncate">
                        {task.category} · {task.licenseName}
                      </p>
                    </div>
                    <Badge tone={GENERIC_STATUS_TONES[task.status]}>
                      {active && task.status === "downloading" && (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      )}
                      {GENERIC_STATUS_LABELS[task.status]}
                    </Badge>
                  </div>

                  <p className="text-[11px] font-mono text-fg-subtle truncate" title={task.targetPath}>
                    {task.targetPath}
                  </p>

                  <div className="space-y-1.5">
                    <div className="w-full h-1.5 bg-bg rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-[width] duration-200 ease-out ${
                          task.status === "failed" || task.status === "cancelled"
                            ? "bg-danger"
                            : task.status === "paused"
                              ? "bg-warning"
                              : "bg-accent-solid"
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="flex flex-wrap justify-between gap-2 text-[11px] text-fg-subtle tabular-nums">
                      <span>
                        {formatBytes(task.downloadedBytes)} /{" "}
                        {task.totalBytes > 0 ? formatBytes(task.totalBytes) : "unknown"} · {pct}%
                      </span>
                      <span>
                        {task.status === "downloading" ? (
                          <>
                            {formatSpeed(task.speedBytesPerSec)}
                            {task.etaSeconds !== null && (
                              <> · ETA {formatDurationSeconds(task.etaSeconds)}</>
                            )}
                          </>
                        ) : task.status === "verifying" ? (
                          "Verifying file integrity..."
                        ) : (
                          formatBytes(task.downloadedBytes)
                        )}
                      </span>
                    </div>
                  </div>

                  {task.error && task.status !== "cancelled" && (
                    <p className="text-xs text-danger flex items-start gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      {task.error}
                    </p>
                  )}

                  <div className="flex flex-wrap items-center justify-end gap-1.5 pt-2 border-t border-border/70">
                    {pausable && (
                      <Button size="sm" variant="secondary" onClick={() => onPauseHfDownload(task)}>
                        <Pause className="w-3.5 h-3.5" />
                        Pause
                      </Button>
                    )}
                    {resumable && (
                      <Button size="sm" variant="primary" onClick={() => onResumeHfDownload(task)}>
                        <Play className="w-3.5 h-3.5" />
                        Resume
                      </Button>
                    )}
                    {active && (
                      <Button size="sm" variant="danger" onClick={() => onCancelHfDownload(task)}>
                        <X className="w-3.5 h-3.5" />
                        Cancel
                      </Button>
                    )}
                    {task.status === "completed" && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => onOpenPath(folderOf(task.targetPath))}
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
                        Open Folder
                      </Button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {civitaiDownloads.length > 0 && (
          <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
          <Badge tone="accent">{activeDownloads.length} active</Badge>
          <Badge tone="success">{completedDownloads.length} installed</Badge>
          <Badge tone="neutral">
            {civitaiDownloads.length - activeDownloads.length - completedDownloads.length}{" "}
            inactive
          </Badge>
          <span className="text-fg-subtle">
            Downloads stream into the active ComfyUI models folder with SHA-256
            verification and sidecar metadata.
          </span>
        </div>

        {civitaiDownloads.map((task) => {
          const pct = downloadPercent(task);
          const active = isActiveDownload(task.status);
          return (
            <Card key={task.id} className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-fg truncate">
                    {task.modelName}
                  </h3>
                  <p className="text-[11px] text-fg-subtle truncate">
                    {task.versionName} · {ARCHITECTURE_LABELS[task.architecture]}
                  </p>
                </div>
                <Badge tone={DOWNLOAD_STATUS_TONES[task.status]}>
                  {active && task.status === "downloading" && (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  )}
                  {DOWNLOAD_STATUS_LABELS[task.status]}
                </Badge>
              </div>

              <p
                className="text-[11px] font-mono text-fg-subtle truncate"
                title={task.targetPath}
              >
                {task.targetPath}
              </p>

              {(active || task.status === "paused" || task.status === "failed" || task.status === "cancelled") && (
                <div className="space-y-1.5">
                  <div className="w-full h-1.5 bg-bg rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-[width] duration-200 ease-out ${
                        task.status === "failed" || task.status === "cancelled"
                          ? "bg-danger"
                          : task.status === "paused"
                          ? "bg-warning"
                          : "bg-accent-solid"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="flex flex-wrap justify-between gap-2 text-[11px] text-fg-subtle tabular-nums">
                    <span>
                      {formatBytes(task.downloadedBytes)} /{" "}
                      {task.totalBytes > 0 ? formatBytes(task.totalBytes) : "unknown"}
                      {` • ${pct}%`}
                    </span>
                    <span>
                      {task.status === "downloading" ? (
                        <>
                          {formatSpeed(task.speedBytesPerSec)}
                          {task.etaSeconds !== null && (
                            <> · ETA {formatDurationSeconds(task.etaSeconds)}</>
                          )}
                        </>
                      ) : task.status === "verifying" ? (
                        "Verifying file integrity..."
                      ) : task.status === "finalizing" ? (
                        "Writing sidecar metadata and preview..."
                      ) : task.status === "paused" ? (
                        "Paused (ready to resume)"
                      ) : (
                        formatBytes(task.downloadedBytes)
                      )}
                    </span>
                  </div>
                </div>
              )}

              {task.error && task.status !== "cancelled" && (
                <p className="text-xs text-danger flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  {task.error}
                </p>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border/70">
                <span className="text-[11px] text-fg-subtle tabular-nums">
                  {task.fileName}
                </span>
                <div className="flex items-center gap-1.5">
                  {(task.status === "queued" || task.status === "downloading") && onPauseDownload && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => onPauseDownload(task)}
                    >
                      <Pause className="w-3.5 h-3.5" />
                      Pause
                    </Button>
                  )}
                  {(task.status === "paused" || (task.status === "failed" && task.downloadedBytes > 0)) && (
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => onRetryDownload(task)}
                    >
                      <Play className="w-3.5 h-3.5" />
                      Resume
                    </Button>
                  )}
                  {((task.status === "failed" && task.downloadedBytes === 0) || task.status === "cancelled") && (
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => onRetryDownload(task)}
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Retry
                    </Button>
                  )}
                  {(active || task.status === "paused") && (
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => onCancelDownload(task)}
                    >
                      <X className="w-3.5 h-3.5" />
                      Cancel
                    </Button>
                  )}
                  {task.status === "completed" && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        onOpenPath(folderOf(task.targetPath))
                      }
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      Open Folder
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
          </div>
        )}
      </div>
    );
};
