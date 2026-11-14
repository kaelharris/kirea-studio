import React, { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, Workflow } from "lucide-react";
import type { SpriteKilnReport } from "../../../shared/pixel-types";
import { Badge, Button, Card, Skeleton } from "../ui/Primitives";

export const SpriteKilnPanel: React.FC = () => {
  const [report, setReport] = useState<SpriteKilnReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setReport(await window.kirea.getSpriteKilnReport());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not inspect SpriteKiln.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Workflow className="w-4 h-4 text-fg-muted" />
            <span className="label-mono text-fg-muted">SpriteKiln adapter</span>
            <Badge tone={report?.available ? "success" : "neutral"}>
              {report?.available ? "Detected" : "Not installed"}
            </Badge>
          </div>
          <p className="mt-1 text-[11px] text-fg-muted leading-relaxed">
            Read-only inspection of SpriteKiln workflow files. Kirea never installs its custom
            nodes into an existing ComfyUI, and never downloads its model tiers automatically.
          </p>
        </div>
        <Button size="sm" variant="utility" loading={loading} onClick={() => void load()}>
          <RefreshCw className="w-3 h-3" /> Refresh
        </Button>
      </div>

      {loading && !report && (
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
      {report && (
        <>
          <p className="text-[11px] text-fg-muted leading-relaxed">{report.message}</p>
          {report.available && (
            <p className="font-mono text-[10px] text-fg-faint break-all">{report.rootPath}</p>
          )}
          {report.workflows.length > 0 && (
            <ul className="space-y-1.5">
              {report.workflows.slice(0, 8).map((workflow) => (
                <li
                  key={workflow.file}
                  className="border border-border rounded-md px-2 py-1.5 space-y-0.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-fg truncate">
                      {workflow.title}
                    </span>
                    <Badge tone={workflow.runnable ? "success" : "warning"}>
                      {workflow.runnable ? (
                        <>
                          <CheckCircle2 className="w-3 h-3" /> Runnable
                        </>
                      ) : (
                        "Needs setup"
                      )}
                    </Badge>
                  </div>
                  <p className="font-mono text-[10px] text-fg-faint">
                    {workflow.nodeCount} nodes · {workflow.modelFiles.length} model files
                  </p>
                  {workflow.customNodeTypes.length > 0 && (
                    <p className="text-[10px] text-fg-faint truncate">
                      Missing: {workflow.customNodeTypes.join(", ")}
                    </p>
                  )}
                  {workflow.reason && (
                    <p className="text-[10px] text-fg-faint">{workflow.reason}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
};
