import React, { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, Workflow } from "lucide-react";
import type { PixelAiBackendStatus } from "../../../shared/pixel-ai-types";
import { Badge, Button, Card, Skeleton } from "../ui/Primitives";

export const SpriteKilnPanel: React.FC = () => {
  const [status, setStatus] = useState<PixelAiBackendStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await window.kirea.getPixelAiStatus());
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Could not inspect the pixel backend."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const tone =
    status?.state === "ready"
      ? "success"
      : status?.state === "unverified" ||
          status?.state === "setup_required" ||
          status?.state === "workflows_missing"
        ? "warning"
        : "danger";

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Workflow className="w-4 h-4 text-fg-muted" />
            <span className="label-mono text-fg-muted">SpriteKiln backend</span>
            <Badge tone={tone}>
              {status
                ? status.state === "ready"
                  ? "Ready"
                  : status.state === "unverified"
                    ? "Unverified"
                    : status.state === "setup_required"
                      ? "Setup required"
                      : status.state === "workflows_missing"
                        ? "Workflows missing"
                        : "Unreachable"
                : "Unknown"}
            </Badge>
          </div>
          <p className="mt-1 text-[11px] text-fg-muted leading-relaxed">
            Readiness is checked against a dedicated ComfyUI instance. Kirea never installs
            SpriteKiln nodes or models and never modifies your existing ComfyUI environment.
          </p>
        </div>
        <Button size="sm" variant="utility" loading={loading} onClick={() => void load()}>
          <RefreshCw className="w-3 h-3" /> Refresh
        </Button>
      </div>

      {loading && !status && (
        <div className="space-y-2">
          <Skeleton height={14} />
          <Skeleton height={14} className="w-2/3" />
        </div>
      )}
      {error && (
        <p className="text-[11px] text-danger flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3" /> {error}
        </p>
      )}
      {status && (
        <>
          <p className="text-[11px] text-fg-muted leading-relaxed">{status.message}</p>
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[10px] text-fg-faint">
            <span>API</span>
            <span className="text-fg-muted break-all">{status.apiUrl}</span>
            <span>ComfyUI</span>
            <span className="text-fg-muted">{status.comfyVersion ?? "unknown"}</span>
            <span>Workflows</span>
            <span className="text-fg-muted break-all">
              {status.workflowRoot || "not found"} ({status.workflowRootSource})
            </span>
          </div>
          <ul className="space-y-1">
            {status.capabilities.map((capability) => (
              <li
                key={capability.id}
                className="flex items-center justify-between gap-2 border border-border rounded-md px-2 py-1.5"
              >
                <span className="text-[11px] text-fg truncate">{capability.label}</span>
                <Badge tone={capability.ready ? "success" : capability.unverified ? "warning" : "danger"}>
                  {capability.ready ? (
                    <>
                      <CheckCircle2 className="w-3 h-3" /> Ready
                    </>
                  ) : capability.unverified ? (
                    "Unverified"
                  ) : (
                    "Needs setup"
                  )}
                </Badge>
              </li>
            ))}
          </ul>
          {(status.warnings.length > 0 || (status.hardware?.warnings.length ?? 0) > 0) && (
            <ul className="space-y-1">
              {[...status.warnings, ...(status.hardware?.warnings ?? [])].map((warning) => (
                <li key={warning} className="text-[10px] text-warning flex gap-1.5">
                  <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" /> {warning}
                </li>
              ))}
            </ul>
          )}
          <p className="text-[10px] text-fg-faint leading-relaxed">
            Connect the dedicated backend and generate from the AI Generate tab. Setup and model
            downloads remain explicit actions you perform outside Kirea.
          </p>
        </>
      )}
    </Card>
  );
};
