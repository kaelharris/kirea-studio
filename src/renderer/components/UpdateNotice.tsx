import React, { useEffect, useState } from "react";
import { Download, Loader2, RotateCcw, X } from "lucide-react";
import { summarizeReleaseNotes } from "../../shared/update-utils";
import type { UpdateInstallResult, UpdateState } from "../../shared/update-types";
import { formatBytes, formatDurationSeconds } from "../utils/format";
import { Badge, Button } from "./ui/Primitives";
import { BrandMark } from "./BrandMark";

interface UpdateNoticeProps {
  state: UpdateState;
  onDownload: () => void;
  onCancel: () => void;
  onLater: () => void;
  onInstall: (force?: boolean) => Promise<UpdateInstallResult>;
}

const UPDATE_READY_PHASES = new Set(["downloading", "downloaded", "installing"]);

export const UpdateNotice: React.FC<UpdateNoticeProps> = ({
  state,
  onDownload,
  onCancel,
  onLater,
  onInstall,
}) => {
  const [downloadAttempted, setDownloadAttempted] = useState(false);
  const [blockedJobs, setBlockedJobs] = useState<number | null>(null);
  const [installing, setInstalling] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (state.phase === "downloading" || state.phase === "downloaded") {
      setDownloadAttempted(true);
    }
    if (state.phase === "available") {
      setDownloadAttempted(false);
      setBlockedJobs(null);
      if (!state.dismissed) setHidden(false);
    }
    if (state.phase === "downloading") setHidden(false);
    if (state.phase !== "downloaded") setInstalling(false);
  }, [state.phase, state.dismissed]);

  const visible =
    !hidden &&
    ((state.phase === "available" && !state.dismissed) ||
      UPDATE_READY_PHASES.has(state.phase) ||
      (state.phase === "error" && downloadAttempted && Boolean(state.availableVersion)));

  if (!visible) return null;

  const handleLater = (): void => {
    setHidden(true);
    onLater();
  };

  const notes = summarizeReleaseNotes(state.releaseNotes);
  const progress = state.progress;

  const handleDownload = (): void => {
    setDownloadAttempted(true);
    setBlockedJobs(null);
    onDownload();
  };

  const handleInstall = async (force = false): Promise<void> => {
    setInstalling(true);
    const result = await onInstall(force);
    if (!result.started) {
      setInstalling(false);
      if (result.reason === "active-jobs") {
        setBlockedJobs(result.activeJobs);
      }
    }
  };

  const speedLabel =
    progress && progress.bytesPerSecond > 0
      ? `${formatBytes(progress.bytesPerSecond)}/s`
      : null;
  const remaining =
    progress && progress.bytesPerSecond > 0 && progress.totalBytes > progress.transferredBytes
      ? formatDurationSeconds(
          (progress.totalBytes - progress.transferredBytes) / progress.bytesPerSecond
        )
      : null;

  return (
    <aside
      role="status"
      aria-live="polite"
      aria-label="Kirea Studio update"
      className="fixed bottom-20 right-4 z-40 w-[380px] max-w-[calc(100vw-2rem)] rounded-xl border border-border-strong bg-surface-elevated p-4 shadow-[var(--shadow-float)] animate-[kirea-panel-in_180ms_ease-out]"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-well">
          <BrandMark size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-small font-semibold text-fg">Kirea Studio update</span>
            {state.availableVersion && (
              <Badge tone="accent">v{state.availableVersion}</Badge>
            )}
          </div>
          {state.phase === "available" && (
            <p className="mt-1 text-xs text-fg-muted">
              A newer version is available. You are on v{state.currentVersion}.
            </p>
          )}
          {state.phase === "downloading" && (
            <p className="mt-1 text-xs text-fg-muted">
              Downloading v{state.availableVersion ?? ""} — you can keep working.
            </p>
          )}
          {state.phase === "downloaded" && (
            <p className="mt-1 text-xs text-fg-muted">
              Update ready to install. Your images, models, and settings are kept.
            </p>
          )}
          {state.phase === "installing" && (
            <p className="mt-1 text-xs text-fg-muted">Restarting to install the update…</p>
          )}
          {state.phase === "error" && (
            <p className="mt-1 text-xs text-danger">{state.error}</p>
          )}
        </div>
        <button
          type="button"
          aria-label="Remind me later"
          onClick={handleLater}
          className="-mr-1 -mt-1 shrink-0 rounded-md p-1 text-fg-subtle transition-colors hover:bg-surface-subtle hover:text-fg"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {notes && state.phase === "available" && (
        <p className="mt-3 line-clamp-3 text-[11px] leading-relaxed text-fg-subtle">
          {notes}
        </p>
      )}

      {state.phase === "downloading" && (
        <div className="mt-3 space-y-1.5">
          <div className="flex items-baseline justify-between text-[11px]">
            <span className="font-mono tabular-nums text-fg">
              {progress ? `${Math.round(progress.percent)}%` : "Starting…"}
            </span>
            <span className="font-mono tabular-nums text-fg-subtle">
              {progress && progress.totalBytes > 0
                ? `${formatBytes(progress.transferredBytes)} / ${formatBytes(progress.totalBytes)}`
                : ""}
            </span>
          </div>
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-surface-subtle"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress?.percent ?? 0)}
          >
            <div
              className="h-full bg-accent-solid transition-[width] duration-200 ease-out"
              style={{ width: `${progress?.percent ?? 0}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-fg-subtle">
            <span>{speedLabel ?? "Connecting…"}</span>
            <span>{remaining ? `${remaining} left` : ""}</span>
          </div>
        </div>
      )}

      {blockedJobs !== null && (
        <div className="mt-3 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-[11px] leading-relaxed text-warning">
          {blockedJobs} generation {blockedJobs === 1 ? "job is" : "jobs are"} still running.
          Restarting now will stop {blockedJobs === 1 ? "it" : "them"}.
        </div>
      )}

      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {state.phase === "available" && (
          <>
            <Button size="sm" variant="ghost" onClick={handleLater}>
              Later
            </Button>
            <Button size="sm" variant="primary" onClick={handleDownload}>
              <Download className="h-3.5 w-3.5" />
              Download Update
            </Button>
          </>
        )}
        {state.phase === "downloading" && (
          <Button size="sm" variant="secondary" onClick={onCancel}>
            Cancel Download
          </Button>
        )}
        {state.phase === "downloaded" && blockedJobs === null && (
          <>
            <Button size="sm" variant="ghost" onClick={handleLater}>
              Later
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={installing}
              onClick={() => void handleInstall(false)}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Restart &amp; Update
            </Button>
          </>
        )}
        {state.phase === "downloaded" && blockedJobs !== null && (
          <>
            <Button size="sm" variant="ghost" onClick={() => setBlockedJobs(null)}>
              Keep working
            </Button>
            <Button
              size="sm"
              variant="danger"
              loading={installing}
              onClick={() => void handleInstall(true)}
            >
              Restart anyway
            </Button>
          </>
        )}
        {state.phase === "error" && downloadAttempted && (
          <>
            <Button size="sm" variant="ghost" onClick={handleLater}>
              Later
            </Button>
            <Button size="sm" variant="primary" onClick={handleDownload}>
              <Download className="h-3.5 w-3.5" />
              Retry Download
            </Button>
          </>
        )}
        {state.phase === "installing" && (
          <span className="inline-flex items-center gap-2 text-[11px] text-fg-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Closing Kirea Studio…
          </span>
        )}
      </div>
    </aside>
  );
};
