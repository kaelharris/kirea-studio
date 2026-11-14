import React from "react";
import { CheckCircle2, Layers, Sparkles, Workflow } from "lucide-react";
import type { ModelRecord, RuntimeState, WorkflowTemplate } from "../../shared/types";
import { Badge, Button, Card, SectionHeader } from "../components/ui/Primitives";

interface WorkflowsPageProps {
  workflows: WorkflowTemplate[];
  models: ModelRecord[];
  runtime: RuntimeState;
  onUseWorkflow: (workflow: WorkflowTemplate) => void;
}

export const WorkflowsPage: React.FC<WorkflowsPageProps> = ({
  workflows,
  models,
  runtime,
  onUseWorkflow,
}) => {
  return (
    <div className="space-y-6">
      <SectionHeader
        sticky
        title="Versioned Workflow Templates"
        subtitle="Validated ComfyUI API node pipelines managed cleanly by Kirea Studio with explicit input checks."
        actions={
          <Badge tone={runtime.status === "connected" ? "success" : "neutral"}>
            <CheckCircle2 className="w-3.5 h-3.5" />
            {runtime.status === "connected"
              ? `${runtime.nodeTypesCount} ComfyUI node types available`
              : "Connect ComfyUI to verify node schemas"}
          </Badge>
        }
      />

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

                <p className="text-small text-fg-muted">
                  {wf.description}
                </p>

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
                    <div className="font-medium text-fg tabular-nums">
                      Up to {wf.maxLoras}
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="label-mono text-label">
                    Required ComfyUI Nodes
                  </div>
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
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => onUseWorkflow(wf)}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Load in Create
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

