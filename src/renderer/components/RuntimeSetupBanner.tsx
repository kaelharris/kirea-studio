import React, { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, Play, Plug, Settings2, X } from "lucide-react";
import type { NavSection, RuntimeState } from "../../shared/types";
import { Button } from "./ui/Primitives";

interface RuntimeSetupBannerProps {
  runtime: RuntimeState;
  starting: boolean;
  onStartRuntime: () => void;
  onTestConnection: () => void;
  onNavigate: (page: NavSection) => void;
}

export const RuntimeSetupBanner: React.FC<RuntimeSetupBannerProps> = ({
  runtime,
  starting,
  onStartRuntime,
  onTestConnection,
  onNavigate,
}) => {
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  if (runtime.status === "connected") return null;

  const hasValidInstall = runtime.isConfiguredPathValid || runtime.detectedExternalPaths.length > 0;
  const isError = runtime.status === "error";

  if (dismissed && !isError) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-warning/30 bg-surface/80 px-3 py-1 text-xs text-fg-muted">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-warning animate-pulse" />
          <span>ComfyUI Offline</span>
        </div>
        <div className="flex items-center gap-2">
          {hasValidInstall && (
            <Button
              size="sm"
              variant="primary"
              className="h-6 px-2 text-[11px]"
              loading={starting || runtime.status === "starting"}
              onClick={onStartRuntime}
            >
              <Play className="w-3 h-3" />
              Start
            </Button>
          )}
          <button
            type="button"
            onClick={() => setDismissed(false)}
            className="text-[11px] text-fg-subtle hover:text-fg underline ml-1"
          >
            Show banner
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-warning/35 bg-surface text-xs shadow-sm transition-all">
      <div className="flex items-center justify-between gap-3 px-3 py-1.5 min-h-[36px]">
        <div className="flex min-w-0 items-center gap-2.5">
          <AlertTriangle
            aria-hidden="true"
            className={`h-4 w-4 shrink-0 ${isError ? "text-danger" : "text-warning"}`}
          />
          <span className="font-semibold text-fg shrink-0">
            {runtime.status === "starting"
              ? "Starting ComfyUI Engine…"
              : runtime.status === "installing"
                ? "Installing Runtime…"
                : isError
                  ? "ComfyUI Error"
                  : "ComfyUI Offline"}
          </span>
          <span className="hidden sm:inline text-fg-muted truncate">
            {hasValidInstall
              ? `Local install ready on ${runtime.apiUrl}.`
              : "Configure an existing ComfyUI folder or install the runtime."}
          </span>
          {runtime.lastError && (
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-fg-subtle hover:text-fg ml-1"
            >
              <span>Details</span>
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {hasValidInstall && runtime.status !== "installing" && (
            <>
              <Button
                size="sm"
                variant="secondary"
                onClick={onTestConnection}
                disabled={starting}
                className="h-7 px-2.5 text-xs"
              >
                <Plug className="w-3 h-3" />
                <span className="hidden md:inline">Test API</span>
              </Button>
              <Button
                size="sm"
                variant="primary"
                loading={starting || runtime.status === "starting"}
                onClick={onStartRuntime}
                className="h-7 px-2.5 text-xs"
              >
                <Play className="w-3 h-3" />
                <span>Start Engine</span>
              </Button>
            </>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onNavigate("settings")}
            className="h-7 px-2 text-xs"
          >
            <Settings2 className="w-3 h-3" />
            <span className="hidden md:inline">Setup</span>
          </Button>
          {!isError && (
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="p-1 rounded-md text-fg-subtle hover:text-fg hover:bg-surface-subtle transition-colors"
              title="Dismiss warning for this session"
              aria-label="Dismiss banner"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {expanded && runtime.lastError && (
        <div className="border-t border-border px-3 py-2 bg-surface-subtle rounded-b-lg">
          <p className="break-words font-mono text-[11px] text-fg-muted">
            {runtime.lastError}
          </p>
        </div>
      )}
    </div>
  );
};
