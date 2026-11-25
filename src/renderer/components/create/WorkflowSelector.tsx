import React from "react";
import {
  Brush,
  Expand,
  Image as ImageIcon,
  Layers,
  Maximize2,
  Sparkles,
  Wand2,
} from "lucide-react";

export type StudioWorkflowMode =
  | "generate"
  | "edit"
  | "inpaint"
  | "outpaint"
  | "variations"
  | "upscale";

export interface WorkflowModeOption {
  id: StudioWorkflowMode;
  label: string;
  icon: React.ReactNode;
  description: string;
  requiresSourceImage: boolean;
  supported: boolean;
  unsupportedReason?: string;
}

interface WorkflowSelectorProps {
  currentMode: StudioWorkflowMode;
  onSelectMode: (mode: StudioWorkflowMode) => void;
  hasSourceImage: boolean;
  modelArch?: string;
}

export const WORKFLOW_MODES: WorkflowModeOption[] = [
  {
    id: "generate",
    label: "Generate",
    icon: <Sparkles className="h-3.5 w-3.5" />,
    description: "Text-to-image generation from prompt brief",
    requiresSourceImage: false,
    supported: true,
  },
  {
    id: "edit",
    label: "Edit / Img2Img",
    icon: <ImageIcon className="h-3.5 w-3.5" />,
    description: "Transform appearance or style of an existing image with controlled denoise",
    requiresSourceImage: true,
    supported: true,
  },
  {
    id: "inpaint",
    label: "Inpaint",
    icon: <Brush className="h-3.5 w-3.5" />,
    description: "Regenerate specific brushed regions while keeping the rest untouched",
    requiresSourceImage: true,
    supported: true,
  },
  {
    id: "outpaint",
    label: "Outpaint",
    icon: <Expand className="h-3.5 w-3.5" />,
    description: "Extend canvas borders in any direction to expand the scene",
    requiresSourceImage: true,
    supported: true,
  },
  {
    id: "variations",
    label: "Variations",
    icon: <Layers className="h-3.5 w-3.5" />,
    description: "Create alternative aesthetic interpretations of the active image",
    requiresSourceImage: true,
    supported: true,
  },
  {
    id: "upscale",
    label: "Upscale",
    icon: <Maximize2 className="h-3.5 w-3.5" />,
    description: "4× AI Super-Resolution and Alchemy Refiner",
    requiresSourceImage: true,
    supported: true,
  },
];

export const WorkflowSelector: React.FC<WorkflowSelectorProps> = ({
  currentMode,
  onSelectMode,
  hasSourceImage,
  modelArch,
}) => {
  return (
    <div
      role="tablist"
      aria-label="Creation workflows"
      className="flex flex-wrap items-center gap-1"
    >
      {WORKFLOW_MODES.map((mode) => {
        const isSelected = currentMode === mode.id;

        return (
          <button
            key={mode.id}
            type="button"
            role="tab"
            aria-selected={isSelected}
            onClick={() => onSelectMode(mode.id)}
            title={mode.description}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer ${
              isSelected
                ? "bg-accent text-white shadow-sm"
                : "text-fg-muted hover:bg-surface-subtle hover:text-fg"
            }`}
          >
            {mode.icon}
            <span>{mode.label}</span>
          </button>
        );
      })}
    </div>
  );
};
