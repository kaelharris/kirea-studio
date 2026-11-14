import React from "react";
import { AlertTriangle, Play, Plug, Settings2 } from "lucide-react";
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
  if (runtime.status === "connected") return null;

  const hasValidInstall = runtime.isConfiguredPathValid || runtime.detectedExternalPaths.length > 0;

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-warning/35 bg-surface px-4 py-3">
      <div className="flex min-w-0 items-start gap-3">
        <AlertTriangle
          aria-hidden="true"
          className="mt-0.5 h-4 w-4 shrink-0 text-warning"
        />
        <div className="min-w-0">
          <p className="text-h3 text-fg">
            {runtime.status === "starting"
              ? "Starting local ComfyUI engine…"
              : runtime.status === "installing"
                ? "Installing managed ComfyUI runtime…"
                : "Local ComfyUI engine not connected"}
          </p>
          <p className="mt-0.5 text-small text-fg-muted">
            {hasValidInstall
              ? `Detected local ComfyUI install. Start or connect on ${runtime.apiUrl} (your existing files remain completely untouched).`
              : "Configure an existing ComfyUI folder (Option A) or install the managed Windows ComfyUI runtime (Option B)."}
          </p>
          {runtime.lastError && (
            <details className="group mt-1">
              <summary className="cursor-pointer select-none text-meta font-mono uppercase tracking-[0.08em] text-fg-subtle hover:text-fg-muted">
                Technical details
              </summary>
              <p className="mt-1 break-words font-mono text-tech text-fg-muted">
                {runtime.lastError}
              </p>
            </details>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {hasValidInstall && runtime.status !== "installing" && (
          <>
            <Button
              size="sm"
              variant="secondary"
              onClick={onTestConnection}
              disabled={starting}
            >
              <Plug className="w-3.5 h-3.5" />
              Test API
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={starting || runtime.status === "starting"}
              onClick={onStartRuntime}
            >
              <Play className="w-3.5 h-3.5" />
              Start Engine
            </Button>
          </>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onNavigate("settings")}
        >
          <Settings2 className="w-3.5 h-3.5" />
          Runtime Setup
        </Button>
      </div>
    </div>
  );
};

