import type {
  GenerationMode,
  ImageOperationKind,
  ImageOperationRecord,
  JobLifecycleState,
} from "./types";

export type ImageLabelTone =
  | "neutral"
  | "accent"
  | "success"
  | "warning"
  | "danger"
  | "info";

export interface ImageWorkflowLabel {
  label: string;
  tone: ImageLabelTone;
  /** Persisted workflow identifier, shown as provenance when available. */
  workflowId: string | null;
}

interface WorkflowProvenance {
  mode: GenerationMode;
  workflowId?: string | null;
  workflowName?: string | null;
  operations?: ImageOperationRecord[];
}

export function classifyImageOperation(
  mode: GenerationMode,
  workflowId?: string | null
): ImageOperationKind {
  const haystack = (workflowId ?? "").toLowerCase();
  if (mode === "t2v" || mode === "i2v") return "other";
  if (haystack.includes("moss")) {
    return haystack.includes("edit") ? "image_edit" : "moss_image";
  }
  if (haystack.includes("outpaint") || haystack.includes("inpaint")) {
    return "inpaint";
  }
  if (haystack.includes("face") || haystack.includes("gfpgan") || haystack.includes("codeformer")) {
    return "face_restore";
  }
  if (
    haystack.includes("background") ||
    haystack.includes("rembg") ||
    haystack.includes("rmbg") ||
    haystack.includes("birefnet")
  ) {
    return "background_remove";
  }
  if (haystack.includes("edit") || haystack.includes("kontext") || haystack.includes("instruct")) {
    return "image_edit";
  }
  if (mode === "upscale" || haystack.includes("upscale")) return "upscale";
  if (mode === "img2img") return "img2img";
  return "txt2img";
}

const OPERATION_LABELS: Record<
  ImageOperationKind,
  { label: string; tone: ImageLabelTone }
> = {
  txt2img: { label: "Txt2Img", tone: "neutral" },
  img2img: { label: "Img2Img", tone: "neutral" },
  inpaint: { label: "Inpaint", tone: "accent" },
  upscale: { label: "Upscaled", tone: "success" },
  face_restore: { label: "Face Restored", tone: "success" },
  background_remove: { label: "Background Removed", tone: "success" },
  image_edit: { label: "Image Edited", tone: "info" },
  moss_image: { label: "MOSS-Image", tone: "accent" },
  other: { label: "Operation", tone: "neutral" },
};

export function imageOperationLabel(
  operation: ImageOperationKind,
  workflowId?: string | null
): ImageWorkflowLabel {
  const base = OPERATION_LABELS[operation];
  const haystack = (workflowId ?? "").toLowerCase();
  if (operation === "inpaint" && haystack.includes("outpaint")) {
    return { label: "Outpaint", tone: "accent", workflowId: workflowId ?? null };
  }
  if (
    operation === "img2img" &&
    (haystack.includes("controlnet") || haystack.includes("layout"))
  ) {
    return { label: "ControlNet", tone: "accent", workflowId: workflowId ?? null };
  }
  if (operation === "other" && haystack.includes("video")) {
    return { label: "Video", tone: "info", workflowId: workflowId ?? null };
  }
  return { label: base.label, tone: base.tone, workflowId: workflowId ?? null };
}

/**
 * Returns every applicable operation label, oldest first. The first label is
 * the original generation; later labels are completed post-processing stages.
 */
export function imageWorkflowLabels(provenance: WorkflowProvenance): ImageWorkflowLabel[] {
  if (provenance.mode === "t2v" || provenance.mode === "i2v") {
    return [
      {
        label: "Video",
        tone: "info",
        workflowId: provenance.workflowId ?? null,
      },
    ];
  }
  if (provenance.operations && provenance.operations.length > 0) {
    const seen = new Set<string>();
    const labels: ImageWorkflowLabel[] = [];
    for (const operation of provenance.operations) {
      const label = imageOperationLabel(operation.operation, operation.workflowId);
      const key = label.label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      labels.push(label);
    }
    if (labels.length > 0) return labels;
  }
  const operation = classifyImageOperation(provenance.mode, provenance.workflowId);
  return [imageOperationLabel(operation, provenance.workflowId)];
}

/**
 * Primary label for compact cards: the most recent operation, or the original
 * operation for assets with no lineage.
 */
export function imageWorkflowLabel(provenance: WorkflowProvenance): ImageWorkflowLabel {
  const labels = imageWorkflowLabels(provenance);
  return labels[labels.length - 1] ?? {
    label: "Txt2Img",
    tone: "neutral",
    workflowId: provenance.workflowId ?? null,
  };
}

export function jobStateLabel(
  status: JobLifecycleState
): { label: string; tone: ImageLabelTone } | null {
  switch (status) {
    case "IDLE":
      return null;
    case "VALIDATING":
      return { label: "Validating", tone: "info" };
    case "SUBMITTING":
      return { label: "Submitting", tone: "info" };
    case "QUEUED":
      return { label: "Queued", tone: "info" };
    case "RUNNING":
      return { label: "Generating", tone: "accent" };
    case "PROCESSING_OUTPUT":
      return { label: "Finalizing", tone: "accent" };
    case "COMPLETED":
      return { label: "Completed", tone: "success" };
    case "FAILED":
      return { label: "Failed", tone: "danger" };
    case "CANCELLED":
      return { label: "Cancelled", tone: "warning" };
    default:
      return null;
  }
}
