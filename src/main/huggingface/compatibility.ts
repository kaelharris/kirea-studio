import { ARCHITECTURE_LABELS } from "../../shared/model-utils";
import type {
  HuggingFaceCheck,
  HuggingFaceCompatibilityReport,
  HuggingFaceCompatibilityStatus,
  HuggingFaceFile,
  HuggingFaceRepoDetails,
} from "../../shared/huggingface";
import {
  assessHuggingFaceArchitecture,
  isDiffusersWeightPath,
  isUnsupportedHuggingFaceQuantization,
  workflowLabelForId,
} from "../../shared/huggingface";
import type { GpuStats, ModelRecord } from "../../shared/types";
import { getWorkflowById } from "../comfy/workflow-templates";
import type { SafetensorsProbe } from "./hf-client";

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

export interface RuntimeCapabilities {
  connected: boolean;
  comfyVersion: string | null;
  nodeClasses: Set<string> | null;
}

export interface CompatibilityInput {
  details: HuggingFaceRepoDetails;
  selectedPaths: string[];
  hardware: GpuStats;
  runtime: RuntimeCapabilities;
  installedModels: ModelRecord[];
  diskFreeBytes: number | null;
  probe: SafetensorsProbe | null;
}

function baseName(filePath: string): string {
  return filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;
}

function normalizeName(value: string): string {
  return value.replace(/\\/g, "/").replace(/^.*\//, "").toLowerCase();
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function enrichHuggingFaceRepo(
  details: HuggingFaceRepoDetails,
  installedModels: ModelRecord[]
): HuggingFaceRepoDetails {
  const template = details.workflowId ? getWorkflowById(details.workflowId) : undefined;
  const requirements = template?.video?.companionModels ?? [];
  const repoNames = new Set(details.files.map((file) => normalizeName(file.path)));
  return {
    ...details,
    requiredComponents: requirements.map((requirement) => ({
      category: requirement.category,
      fileName: requirement.fileName,
      label: requirement.label,
      approxSizeGB: requirement.approxSizeGB,
      installed: installedModels.some(
        (model) =>
          model.category === requirement.category &&
          normalizeName(model.relativePath) === normalizeName(requirement.fileName)
      ),
      availableInRepo: repoNames.has(normalizeName(requirement.fileName)),
    })),
  };
}

function fileCategoryFor(
  file: HuggingFaceFile,
  architecture: string
): "checkpoint" | "diffusion_model" | "vae" | "text_encoder" | "lora" | null {
  if (file.kind === "vae") return "vae";
  if (file.kind === "text_encoder") return "text_encoder";
  if (file.kind === "lora") return "lora";
  if (file.kind === "diffusion_model") return "diffusion_model";
  if (file.kind === "checkpoint") {
    return architecture === "wan_video" ? "diffusion_model" : "checkpoint";
  }
  return null;
}

function isMainModelFile(file: HuggingFaceFile): boolean {
  return file.kind === "checkpoint" || file.kind === "diffusion_model";
}

function resolveQuantization(file: HuggingFaceFile, probe: SafetensorsProbe | null): string | null {
  if (file.quantization) return file.quantization;
  if (!probe?.ok) return null;
  const dtypes = probe.dtypes;
  if ((dtypes.F8_E4M3 ?? 0) > 0 || (dtypes.F8_E5M2 ?? 0) > 0) return "FP8";
  if ((dtypes.BF16 ?? 0) > 0) return "BF16";
  if ((dtypes.F16 ?? 0) > 0) return "FP16";
  if ((dtypes.F32 ?? 0) > 0) return "FP32";
  return null;
}

function isUnsupportedQuantization(quantization: string | null): boolean {
  return isUnsupportedHuggingFaceQuantization(quantization);
}

function duplicateOfPrimary(
  primary: HuggingFaceFile,
  installedModels: ModelRecord[]
): string | null {
  const primaryName = normalizeName(primary.path);
  for (const model of installedModels) {
    if (!model.installed) continue;
    if (primary.sha256 && model.sha256 && model.sha256.toLowerCase() === primary.sha256) {
      return model.name;
    }
    if (
      normalizeName(model.relativePath) === primaryName &&
      (primary.sizeBytes === 0 || Math.abs(model.sizeBytes - primary.sizeBytes) <= 4096)
    ) {
      return model.name;
    }
  }
  return null;
}

function statusFromChecks(checks: HuggingFaceCheck[]): HuggingFaceCompatibilityStatus {
  if (checks.some((check) => check.status === "fail")) return "INCOMPATIBLE";
  if (checks.some((check) => check.status === "unknown")) return "UNKNOWN";
  const relevantWarnings = checks.some(
    (check) =>
      check.status === "warn" &&
      check.category !== "duplicate" &&
      check.category !== "auth"
  );
  return relevantWarnings ? "CONDITIONAL" : "COMPATIBLE";
}

function summaryFor(status: HuggingFaceCompatibilityStatus, checks: HuggingFaceCheck[]): string {
  if (status === "INCOMPATIBLE") {
    return unique(
      checks.filter((check) => check.status === "fail").map((check) => check.title)
    ).join(" · ");
  }
  if (status === "CONDITIONAL") {
    return unique(
      checks
        .filter((check) => check.status === "warn")
        .map((check) => check.title)
    ).join(" · ");
  }
  if (status === "UNKNOWN") {
    return unique(
      checks.filter((check) => check.status === "unknown").map((check) => check.title)
    ).join(" · ");
  }
  return "Architecture, ComfyUI nodes, model components, hardware and disk all passed.";
}

export function evaluateHuggingFaceCompatibility(
  input: CompatibilityInput
): HuggingFaceCompatibilityReport {
  const { details, hardware, runtime, installedModels, diskFreeBytes, probe } = input;
  const checks: HuggingFaceCheck[] = [];
  const recommendations: string[] = [];
  const blockingReasons: string[] = [];

  const selectedFiles = details.files.filter((file) =>
    input.selectedPaths.includes(file.path)
  );
  const selectedWeights = selectedFiles.filter(
    (file) =>
      file.selectable ||
      file.kind === "diffusion_model" ||
      file.kind === "checkpoint" ||
      file.kind === "vae" ||
      file.kind === "text_encoder" ||
      file.kind === "lora"
  );
  const selectedMainWeights = selectedWeights.filter(isMainModelFile);
  const primary =
    selectedMainWeights.find((file) => file.primary) ??
    selectedMainWeights[0] ??
    null;

  const assessment = primary
    ? assessHuggingFaceArchitecture({
        repoId: details.id,
        pipelineTag: details.pipelineTag,
        tags: details.tags,
        filePath: primary.path,
        config: details.config,
        modelIndex: details.modelIndex,
      })
    : assessHuggingFaceArchitecture({
        repoId: details.id,
        pipelineTag: details.pipelineTag,
        tags: details.tags,
        filePath: null,
        config: details.config,
        modelIndex: details.modelIndex,
      });

  const template = assessment.workflowId ? getWorkflowById(assessment.workflowId) : undefined;
  const videoSpec = template?.video ?? null;

  // --- Architecture / workflow support -------------------------------------
  if (!primary) {
    const onlyCompanions = selectedWeights.length > 0;
    checks.push({
      id: "weights",
      category: "metadata",
      status: "fail",
      title: onlyCompanions ? "No main model file selected" : "No loadable model weight selected",
      detail: onlyCompanions
        ? "Select the main checkpoint or diffusion-model file, not only a VAE, text encoder, or LoRA."
        : "This repository has no selectable single-file checkpoint or diffusion model. Select a file or use a ComfyUI repackaged repository.",
    });
    blockingReasons.push(
      onlyCompanions
        ? "No main model weight file was selected."
        : "No loadable model weight file was selected."
    );
  } else if (!assessment.runnable || !template || !videoSpec) {
    checks.push({
      id: "architecture",
      category: "architecture",
      status: "fail",
      title: "No shipped Kirea workflow",
      detail: assessment.reason,
    });
    blockingReasons.push(assessment.reason);
  } else if (selectedMainWeights.length > 1) {
    checks.push({
      id: "architecture",
      category: "architecture",
      status: "fail",
      title: "Multiple main model files selected",
      detail:
        "Select exactly one checkpoint or diffusion-model file. Companion VAE/text-encoder files can be added alongside it, but Kirea cannot run two main weights in one download set.",
    });
    blockingReasons.push("More than one main model weight was selected.");
  } else {
    checks.push({
      id: "architecture",
      category: "architecture",
      status: "pass",
      title: `Maps to ${template.name}`,
      detail: assessment.reason,
    });
  }

  // --- Weight format / loader compatibility --------------------------------
  if (primary) {
    const diffusersPath = isDiffusersWeightPath(primary.path);
    const probeFormat = probe?.ok ? probe.nativeFormat : null;
    if (diffusersPath || probeFormat === "diffusers") {
      checks.push({
        id: "format",
        category: "loader",
        status: "fail",
        title: "Diffusers-format weights cannot be loaded",
        detail:
          "This file is a Diffusers transformer or sharded pipeline. Kirea's UNETLoader and CheckpointLoaderSimple expect one ComfyUI-format checkpoint with native keys; they cannot assemble Diffusers components. Choose a ComfyUI repackaged single-file model.",
      });
      blockingReasons.push(
        "Kirea cannot load Diffusers-format weights with its shipped ComfyUI loaders."
      );
    } else if (probe?.ok && probeFormat === "unknown" && primary.format === "safetensors") {
      checks.push({
        id: "format",
        category: "loader",
        status: "warn",
        title: "Weight key format was not recognized",
        detail:
          "The safetensors header does not match Kirea's known ComfyUI key layouts. It may still load, but loader compatibility cannot be confirmed from the header.",
      });
    }
  }

  // --- Quantization / loader support ---------------------------------------
  const unsupportedCompanion = selectedWeights.find(
    (file) =>
      file !== primary &&
      isUnsupportedQuantization(
        file.quantization ?? (file.format === "gguf" ? "GGUF" : null)
      )
  );
  if (unsupportedCompanion) {
    checks.push({
      id: "quantization_companion",
      category: "loader",
      status: "fail",
      title: "Unsupported companion quantization",
      detail: `${unsupportedCompanion.path} is ${unsupportedCompanion.quantization ?? "GGUF"}; the shipped VAE/text-encoder loaders expect safetensors.`,
    });
    blockingReasons.push("A selected companion file uses a loader Kirea does not ship.");
  }

  const quantization = primary ? resolveQuantization(primary, probe) : null;
  if (primary) {
    if (isUnsupportedQuantization(quantization)) {
      checks.push({
        id: "quantization",
        category: "loader",
        status: "fail",
        title: `Unsupported quantization: ${quantization}`,
        detail:
          "Kirea's shipped loaders do not use GGUF/INT quantized loader nodes for this architecture. Install a safetensors FP16/BF16/FP8 variant instead.",
      });
      blockingReasons.push(`${quantization} weights require a loader Kirea does not ship.`);
    } else if (!quantization) {
      checks.push({
        id: "quantization",
        category: "loader",
        status: "warn",
        title: "Quantization could not be verified",
        detail:
          "The filename and safetensors header did not identify a quantization. The model may still load, but memory estimates are less certain.",
      });
    } else if (quantization === "FP32") {
      checks.push({
        id: "quantization",
        category: "loader",
        status: "warn",
        title: "FP32 weights",
        detail: "FP32 weights load, but need substantially more VRAM and RAM than FP16.",
      });
    } else {
      checks.push({
        id: "quantization",
        category: "loader",
        status: "pass",
        title: `${quantization} weights`,
        detail: "The shipped safetensors loaders support this weight format.",
      });
    }
  }

  // --- ComfyUI loader nodes ------------------------------------------------
  const missingNodes: string[] = [];
  if (template) {
    if (!runtime.connected || !runtime.nodeClasses) {
      checks.push({
        id: "nodes",
        category: "loader",
        status: "unknown",
        title: "ComfyUI is not connected",
        detail:
          "Kirea could not inspect the live ComfyUI node registry. Connect the runtime to verify loader and video nodes before running.",
      });
    } else {
      for (const nodeClass of template.requiredNodes) {
        if (!runtime.nodeClasses.has(nodeClass)) missingNodes.push(nodeClass);
      }
      if (missingNodes.length > 0) {
        checks.push({
          id: "nodes",
          category: "loader",
          status: "fail",
          title: `Missing ComfyUI nodes: ${missingNodes.join(", ")}`,
          detail:
            "These nodes must be provided by the installed ComfyUI version. Kirea never installs custom nodes automatically.",
        });
        blockingReasons.push(`ComfyUI is missing required nodes: ${missingNodes.join(", ")}.`);
      } else {
        checks.push({
          id: "nodes",
          category: "loader",
          status: "pass",
          title: "All required ComfyUI nodes are present",
          detail: `Verified ${template.requiredNodes.length} node classes on ComfyUI ${
            runtime.comfyVersion ?? "(version unknown)"
          }.`,
        });
      }
    }
  }

  // --- Companion components ------------------------------------------------
  const missingComponents: Array<{
    category: ModelRecord["category"];
    fileName: string;
    label: string;
    approxSizeGB: number;
  }> = [];
  if (videoSpec) {
    const selectedNames = new Set(selectedFiles.map((file) => normalizeName(file.path)));
    for (const requirement of videoSpec.companionModels) {
      const installed = installedModels.some(
        (model) =>
          model.category === requirement.category &&
          normalizeName(model.relativePath) === normalizeName(requirement.fileName)
      );
      const selected = selectedNames.has(normalizeName(requirement.fileName));
      if (!installed && !selected) {
        missingComponents.push({
          category: requirement.category,
          fileName: requirement.fileName,
          label: requirement.label,
          approxSizeGB: requirement.approxSizeGB,
        });
      }
    }
    if (missingComponents.length > 0) {
      checks.push({
        id: "components",
        category: "dependencies",
        status: "warn",
        title: `${missingComponents.length} required component${
          missingComponents.length === 1 ? "" : "s"
        } missing`,
        detail: missingComponents
          .map((component) => `${component.label} (${component.fileName})`)
          .join(" · "),
      });
      recommendations.push(
        `Install the required companion files before generating: ${missingComponents
          .map((component) => component.fileName)
          .join(", ")}.`
      );
    } else {
      checks.push({
        id: "components",
        category: "dependencies",
        status: "pass",
        title: "All required model components are available",
        detail: `${videoSpec.companionModels.length} companion component${
          videoSpec.companionModels.length === 1 ? "" : "s"
        } installed or selected.`,
      });
    }
  }

  // --- Hardware ------------------------------------------------------------
  const vramTotalMB = Math.max(0, hardware.vramTotalMB);
  const vramFreeMB = Math.max(0, hardware.vramFreeMB);
  const ramTotalMB = Math.max(0, hardware.systemRamTotalMB);
  const ramFreeMB = Math.max(0, hardware.systemRamFreeMB);

  if (!hardware.available || vramTotalMB <= 0) {
    checks.push({
      id: "gpu",
      category: "hardware",
      status: "fail",
      title: "No compatible GPU detected",
      detail:
        "Kirea could not detect an NVIDIA GPU with VRAM. Video workflows are not viable on CPU-only execution.",
    });
    blockingReasons.push("No NVIDIA GPU was detected.");
  } else if (videoSpec) {
    if (vramTotalMB < videoSpec.minVramMB) {
      checks.push({
        id: "vram",
        category: "hardware",
        status: "fail",
        title: `VRAM below workflow minimum (${Math.round(vramTotalMB / 1024)} GB < ${Math.round(
          videoSpec.minVramMB / 1024
        )} GB)`,
        detail: `Kirea's ${template?.name ?? "video"} graph does not expose CPU offloading controls, so this workflow cannot be claimed as viable on this GPU.`,
      });
      blockingReasons.push("Total VRAM is below the workflow minimum.");
    } else if (vramTotalMB < videoSpec.recommendedVramMB) {
      checks.push({
        id: "vram",
        category: "hardware",
        status: "warn",
        title: "VRAM is at the workflow minimum",
        detail: `Detected ${Math.round(vramTotalMB / 1024)} GB; recommended is ${Math.round(
          videoSpec.recommendedVramMB / 1024
        )} GB. Use the lightest preset and one active job.`,
      });
      recommendations.push("Use the lightest validated resolution and frame count for this workflow.");
    } else {
      checks.push({
        id: "vram",
        category: "hardware",
        status: "pass",
        title: "VRAM meets the recommended target",
        detail: `Detected ${Math.round(vramTotalMB / 1024)} GB; recommended ${Math.round(
          videoSpec.recommendedVramMB / 1024
        )} GB.`,
      });
    }
    if (vramFreeMB > 0 && vramFreeMB < videoSpec.minVramMB) {
      checks.push({
        id: "vram_free",
        category: "hardware",
        status: "warn",
        title: "Free VRAM is currently low",
        detail: `Only ${(vramFreeMB / 1024).toFixed(1)} GB is free right now. Close other GPU applications before generating.`,
      });
    }
  }

  if (videoSpec && ramTotalMB > 0) {
    const weightGB = (primary?.sizeBytes ?? 0) / GIB;
    const companionGB = Math.max(
      0,
      ...(videoSpec.companionModels.map((component) => component.approxSizeGB) ?? [0])
    );
    const estimatedRamGB = Math.round((weightGB + companionGB + 6) * 10) / 10;
    if (ramTotalMB / 1024 < estimatedRamGB) {
      checks.push({
        id: "ram",
        category: "hardware",
        status: "warn",
        title: "System RAM may be tight",
        detail: `Estimated need is about ${estimatedRamGB} GB (rough estimate); detected ${(
          ramTotalMB / 1024
        ).toFixed(1)} GB total, ${(ramFreeMB / 1024).toFixed(1)} GB free. ComfyUI may use memory mapping and swap.`,
      });
    } else {
      checks.push({
        id: "ram",
        category: "hardware",
        status: "pass",
        title: "System RAM is sufficient",
        detail: `Estimated need about ${estimatedRamGB} GB (rough estimate); detected ${(
          ramTotalMB / 1024
        ).toFixed(1)} GB.`,
      });
    }
  }

  // --- Disk ---------------------------------------------------------------
  const downloadBytes = selectedFiles.reduce((total, file) => total + file.sizeBytes, 0);
  const requiredFreeBytes = Math.ceil(downloadBytes * 1.05);
  if (diskFreeBytes === null) {
    checks.push({
      id: "disk",
      category: "disk",
      status: "unknown",
      title: "Disk space could not be verified",
      detail: "Kirea could not read free space for the active ComfyUI models drive.",
    });
  } else if (diskFreeBytes < requiredFreeBytes) {
    checks.push({
      id: "disk",
      category: "disk",
      status: "fail",
      title: "Insufficient free disk space",
      detail: `Needs about ${(requiredFreeBytes / GIB).toFixed(2)} GB with temporary headroom; ${(
        diskFreeBytes / GIB
      ).toFixed(2)} GB free.`,
    });
    blockingReasons.push("Not enough free disk space for the selected files.");
  } else {
    const headroom = diskFreeBytes - requiredFreeBytes;
    checks.push({
      id: "disk",
      category: "disk",
      status: headroom < 2 * GIB ? "warn" : "pass",
      title: headroom < 2 * GIB ? "Disk headroom is tight" : "Disk space is sufficient",
      detail: `Download needs about ${(requiredFreeBytes / GIB).toFixed(2)} GB; ${(
        diskFreeBytes / GIB
      ).toFixed(2)} GB free.`,
    });
  }

  // --- Duplicate ----------------------------------------------------------
  const duplicate = primary ? duplicateOfPrimary(primary, installedModels) : null;
  if (duplicate) {
    checks.push({
      id: "duplicate",
      category: "duplicate",
      status: "warn",
      title: `Already installed as ${duplicate}`,
      detail:
        "A matching file or SHA-256 is already in the Kirea model library. Normal download is blocked; use an explicit override to re-download.",
    });
    recommendations.push("Use the installed copy, or explicitly override to re-download.");
  } else {
    checks.push({
      id: "duplicate",
      category: "duplicate",
      status: "pass",
      title: "No duplicate detected",
      detail: "No installed model matched the selected file by SHA-256 or filename and size.",
    });
  }

  // --- Metadata / gated access -------------------------------------------
  if (!details.config && !details.modelIndex && !probe?.ok) {
    checks.push({
      id: "metadata",
      category: "metadata",
      status: "warn",
      title: "Repository metadata is limited",
      detail:
        "No config, model_index, or safetensors header was available. Classification is based on repository tags and filenames.",
    });
  } else {
    checks.push({
      id: "metadata",
      category: "metadata",
      status: "pass",
      title: "Repository metadata inspected",
      detail: probe?.ok
        ? `Safetensors header read without downloading weights (${probe.tensorCount} tensors).`
        : "Configuration files were inspected.",
    });
  }

  if (details.gated) {
    checks.push({
      id: "auth",
      category: "auth",
      status: "warn",
      title: "Gated repository",
      detail:
        "This repository requires a Hugging Face token with access granted on the repository page. Kirea stores the token with OS encryption and never logs it.",
    });
  }

  const status = statusFromChecks(checks);
  const specPreset = videoSpec?.presets[0] ?? null;
  const estimatedPeakVramMB =
    primary && videoSpec
      ? Math.round(
          ((primary.sizeBytes / GIB +
            Math.max(...videoSpec.companionModels.map((component) => component.approxSizeGB), 0)) *
            1024 *
            0.7 +
            1536)
        )
      : 0;

  return {
    status,
    summary: summaryFor(status, checks),
    checks,
    architecture: assessment.architecture,
    workflowId: assessment.workflowId,
    workflowName: template?.name ?? workflowLabelForId(assessment.workflowId),
    detected: {
      gpuName: hardware.name,
      vramTotalMB,
      vramFreeMB,
      systemRamTotalMB: ramTotalMB,
      systemRamFreeMB: ramFreeMB,
      diskFreeGB: diskFreeBytes === null ? null : Math.round((diskFreeBytes / GIB) * 100) / 100,
      comfyVersion: runtime.comfyVersion,
      runtimeConnected: runtime.connected,
    },
    requirements: {
      workflowId: assessment.workflowId,
      workflowName: template?.name ?? null,
      minVramMB: videoSpec?.minVramMB ?? 0,
      recommendedVramMB: videoSpec?.recommendedVramMB ?? 0,
      estimatedPeakVramMB,
      estimatedRamGB:
        primary && videoSpec
          ? Math.round(
              (primary.sizeBytes / GIB +
                Math.max(...videoSpec.companionModels.map((component) => component.approxSizeGB), 0) +
                6) *
                10
            ) / 10
          : 0,
      downloadBytes,
      requiredFreeBytes,
      suggestedPreset:
        videoSpec && specPreset
          ? {
              width: specPreset.width,
              height: specPreset.height,
              frameCount: videoSpec.defaultFrameCount,
            }
          : null,
    },
    selectedFiles,
    missingComponents,
    missingNodes,
    recommendations: unique(recommendations),
    blockingReasons: unique(blockingReasons),
    duplicateOf: duplicate,
    evaluatedAt: new Date().toISOString(),
  };
}

export function categoryForSelectedFile(
  file: HuggingFaceFile,
  architecture: string
): "checkpoint" | "diffusion_model" | "vae" | "text_encoder" | "lora" {
  return fileCategoryFor(file, architecture) ?? "checkpoint";
}

export function displayArchitecture(architecture: string): string {
  return ARCHITECTURE_LABELS[architecture as keyof typeof ARCHITECTURE_LABELS] ?? architecture;
}
