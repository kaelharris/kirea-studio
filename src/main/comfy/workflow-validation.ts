import type {
  GenerationRequest,
  ModelArchitecture,
  ModelRecord,
  PerformanceProfile,
  ValidationIssue,
  WorkflowTemplate,
} from "../../shared/types";
import {
  calculateHiresDimensions,
  IMAGE_UPSCALER_LANCZOS,
  inferModelArchitecture,
  isLatentUpscaler,
} from "../../shared/aspect-ratios";
import {
  ARCHITECTURE_LABELS,
  evaluateLoraCompatibility,
  findPresetUpscaler,
  isVaeCompatibleWithArchitecture,
  resolveAutoVaeName,
  VAE_AUTO,
  VAE_EMBEDDED,
} from "../../shared/model-utils";
import {
  getWorkflowById,
  isAnimaWorkflow,
  usesDiffusionModelLoader,
} from "./workflow-templates";
import {
  classifyMossModel,
  isMossWorkflow,
  missingMossRequirements,
  mossDependencyStatus,
  mossRequirementsFor,
  validateMossLayoutJson,
} from "../../shared/moss-image";
import { resolveVideoFrames, resolveVideoModels } from "./video-graph-builder";
import { isVideoMode } from "../../shared/video-utils";

const REFINER_CREATIVITY_MIN = 0.2;
const REFINER_CREATIVITY_MAX = 0.5;

export function clampRefinerCreativity(value: number | undefined): number {
  const raw = typeof value === "number" && Number.isFinite(value) ? value : 0.35;
  return Math.min(REFINER_CREATIVITY_MAX, Math.max(REFINER_CREATIVITY_MIN, raw));
}

export function isRefinerUpscaleRequest(request: GenerationRequest): boolean {
  return (
    request.workflowId === "upscale_refiner_v1" ||
    request.upscale?.pipeline === "refiner"
  );
}

export function resolveRefinerCheckpoint(request: GenerationRequest): string {
  return (request.upscale?.checkpoint ?? "").trim() || request.checkpoint.trim();
}

export function resolveRequestedVae(
  request: GenerationRequest,
  architecture: ModelArchitecture,
  availableModels: ModelRecord[]
): string | null {
  const setting = request.vae;
  if (!setting || setting === VAE_EMBEDDED) return null;
  if (setting !== VAE_AUTO) return setting;
  return resolveAutoVaeName(
    architecture,
    availableModels.filter((m) => m.category === "vae")
  );
}

export function resolveArchitectureFor(
  reference: string,
  availableModels: ModelRecord[]
): ModelArchitecture {
  return (
    availableModels.find((m) => m.relativePath === reference || m.name === reference)
      ?.architecture ?? inferModelArchitecture(reference)
  );
}

function collectLoraIssues(
  req: GenerationRequest,
  baseArch: ModelArchitecture,
  installedModels: ModelRecord[],
  wf: WorkflowTemplate
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const effectiveMaxLoras =
    baseArch === "illustrious" && (wf.id === "t2i_sdxl_base" || wf.id === "i2i_sdxl_base")
      ? 10
      : wf.maxLoras;

  if (req.loras.length > effectiveMaxLoras) {
    issues.push({
      field: "loras",
      severity: "error",
      message: `Workflow '${wf.name}' supports at most ${effectiveMaxLoras} LoRAs.`,
    });
  }

  for (const lora of req.loras) {
    const loraRec = installedModels.find(
      (m) =>
        m.category === "lora" &&
        (m.relativePath === lora.name || m.name === lora.name)
    );
    if (installedModels.length > 0 && !loraRec) {
      issues.push({
        field: "loras",
        severity: "error",
        message: `LoRA '${lora.name}' was not found in scanned model directories.`,
      });
      continue;
    }
    if (!loraRec) continue;

    const compatibility = evaluateLoraCompatibility(loraRec.architecture, baseArch);
    if (!compatibility.compatible) {
      issues.push({
        field: "loras",
        severity: "error",
        message: `LoRA '${lora.name}' (${ARCHITECTURE_LABELS[loraRec.architecture]}) is incompatible with ${ARCHITECTURE_LABELS[baseArch]} models. Remove it or switch checkpoints.`,
      });
    } else if (compatibility.level === "cross-paired") {
      issues.push({
        field: "loras",
        severity: "warning",
        message: `LoRA '${lora.name}' is SDXL-family cross-paired with ${ARCHITECTURE_LABELS[baseArch]}; verify the output.`,
      });
    }
  }

  return issues;
}

function validateVideoRequest(
  req: GenerationRequest,
  wf: WorkflowTemplate,
  installedModels: ModelRecord[],
  vramTotalMB: number
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const spec = wf.video;
  if (!spec) {
    issues.push({
      field: "workflowId",
      severity: "error",
      message: `Workflow '${wf.name}' is not a video workflow.`,
    });
    return issues;
  }

  if (!req.prompt || req.prompt.trim().length === 0) {
    issues.push({ field: "prompt", severity: "error", message: "Prompt cannot be empty." });
  }

  if (!req.checkpoint || req.checkpoint.trim().length === 0) {
    issues.push({
      field: "checkpoint",
      severity: "error",
      message: `Select a ${wf.supportedArchitectures.map((a) => ARCHITECTURE_LABELS[a]).join(" or ")} model before generating video.`,
    });
  } else {
    const record = installedModels.find(
      (m) => m.relativePath === req.checkpoint || m.name === req.checkpoint
    );
    const arch = record?.architecture ?? inferModelArchitecture(req.checkpoint);
    if (arch !== "unknown" && !wf.supportedArchitectures.includes(arch)) {
      issues.push({
        field: "checkpoint",
        severity: "error",
        message: `'${req.checkpoint}' (${ARCHITECTURE_LABELS[arch]}) cannot run '${wf.name}'.`,
      });
    }
    if (record && spec.family === "wan21_t2v" && record.category !== "diffusion_model") {
      issues.push({
        field: "checkpoint",
        severity: "error",
        message: `Wan workflows load the video model with UNETLoader; '${req.checkpoint}' is registered as a ${record.category}.`,
      });
    }
    if (record && spec.family === "ltx_video" && record.category !== "checkpoint") {
      issues.push({
        field: "checkpoint",
        severity: "error",
        message: `LTX-Video workflows load an all-in-one checkpoint; '${req.checkpoint}' is registered as a ${record.category}.`,
      });
    }
  }

  if (installedModels.length > 0) {
    const resolved = resolveVideoModels(wf, installedModels);
    for (const missing of resolved.missing) {
      const folder = missing.category === "text_encoder" ? "text_encoders" : missing.category;
      issues.push({
        field: "checkpoint",
        severity: "error",
        message: `Video workflow requires '${missing.fileName}' (${missing.label}, ~${missing.approxSizeGB} GB) in ComfyUI's ${folder} folder.`,
      });
    }
  }

  if (req.mode === "i2v" && (!req.inputImagePath || req.inputImagePath.trim().length === 0)) {
    issues.push({
      field: "inputImagePath",
      severity: "error",
      message: "Image-to-Video mode requires an uploaded or selected input image.",
    });
  }

  if (
    req.width < wf.minDim ||
    req.width > wf.maxDim ||
    req.height < wf.minDim ||
    req.height > wf.maxDim
  ) {
    issues.push({
      field: "dimensions",
      severity: "error",
      message: `Video dimensions must be between ${wf.minDim}px and ${wf.maxDim}px for this workflow.`,
    });
  }
  if (req.width % wf.dimStep !== 0 || req.height % wf.dimStep !== 0) {
    issues.push({
      field: "dimensions",
      severity: "warning",
      message: `Video dimensions snap to ${wf.dimStep}px multiples for this workflow.`,
    });
  }

  if (req.video) {
    if (req.video.fps !== spec.fps) {
      issues.push({
        field: "video",
        severity: "warning",
        message: `This workflow runs at ${spec.fps} fps; the requested ${req.video.fps} fps is ignored.`,
      });
    }
    if (!spec.formats.includes(req.video.format)) {
      issues.push({
        field: "video",
        severity: "error",
        message: `This workflow can only write ${spec.formats.join(" or ")} files.`,
      });
    }
  }

  const frames = resolveVideoFrames(req, spec);
  const minDuration = spec.minFrames / spec.fps;
  const maxDuration = spec.maxFrames / spec.fps;
  if (frames.clamped) {
    issues.push({
      field: "video",
      severity: "warning",
      message: `Requested duration is outside this model's ${minDuration.toFixed(1)}–${maxDuration.toFixed(1)}s range; using ${frames.durationSeconds.toFixed(1)}s.`,
    });
  } else if (frames.snapped) {
    issues.push({
      field: "video",
      severity: "warning",
      message: `Duration snaps to the ${spec.frameStep}-frame grid; using ${frames.frameCount} frames (${frames.durationSeconds.toFixed(1)}s at ${spec.fps} fps).`,
    });
  }

  if (vramTotalMB > 0) {
    if (vramTotalMB < spec.minVramMB) {
      issues.push({
        field: "video",
        severity: "error",
        message: `This workflow needs at least ${(spec.minVramMB / 1024).toFixed(0)} GB VRAM; the detected GPU has ${(vramTotalMB / 1024).toFixed(1)} GB.`,
      });
    } else if (vramTotalMB < spec.recommendedVramMB) {
      issues.push({
        field: "video",
        severity: "warning",
        message: `This workflow recommends ${(spec.recommendedVramMB / 1024).toFixed(0)} GB VRAM; ${(vramTotalMB / 1024).toFixed(1)} GB may need ComfyUI model offloading and slower generation.`,
      });
    }
  }

  return issues;
}

export function validateGenerationRequest(
  req: GenerationRequest,
  installedModels: ModelRecord[],
  profile: PerformanceProfile,
  vramTotalMB: number
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const wf = getWorkflowById(req.workflowId);

  if (!wf) {
    issues.push({
      field: "workflowId",
      severity: "error",
      message: `Unknown workflow template '${req.workflowId}'.`,
    });
    return issues;
  }

  if (wf.mode !== req.mode) {
    issues.push({
      field: "mode",
      severity: "error",
      message: `Workflow '${wf.name}' only supports ${wf.mode}, not ${req.mode}.`,
    });
  }

  if (wf.video) {
    return validateVideoRequest(req, wf, installedModels, vramTotalMB);
  }
  if (isVideoMode(req.mode)) {
    issues.push({
      field: "mode",
      severity: "error",
      message: `${req.mode} requires a video workflow template.`,
    });
    return issues;
  }

  if (req.mode === "upscale") {
    if (!req.inputImagePath || req.inputImagePath.trim().length === 0) {
      issues.push({
        field: "inputImagePath",
        severity: "error",
        message: "Upscale mode requires a selected or uploaded input image.",
      });
    }

    const upscaleModels = installedModels.filter((m) => m.category === "upscale");
    const presetUpscaler = findPresetUpscaler(req.upscale?.preset, upscaleModels);
    const upscalerName = presetUpscaler ?? req.upscale?.upscaler?.trim() ?? "";
    if (!upscalerName) {
      issues.push({
        field: "upscale",
        severity: "error",
        message: "Please select an upscaler model or Alchemy preset before upscaling.",
      });
    } else if (
      upscalerName !== IMAGE_UPSCALER_LANCZOS &&
      installedModels.length > 0 &&
      !upscaleModels.some(
        (m) => m.relativePath === upscalerName || m.name === upscalerName
      )
    ) {
      issues.push({
        field: "upscale",
        severity: "error",
        message: `Upscaler model '${upscalerName}' was not found in scanned upscale_models directories.`,
      });
    }

    if (isRefinerUpscaleRequest(req)) {
      const checkpointName = resolveRefinerCheckpoint(req);
      if (!checkpointName) {
        issues.push({
          field: "checkpoint",
          severity: "error",
          message:
            "Alchemy Refiner requires a checkpoint for the refining pass. Select one in the refiner panel.",
        });
      } else {
        const record = installedModels.find(
          (m) => m.relativePath === checkpointName || m.name === checkpointName
        );
        const arch = record?.architecture ?? inferModelArchitecture(checkpointName);
        if (
          arch === "ltx_video" ||
          arch === "anima" ||
          arch === "z_image" ||
          arch === "flux" ||
          arch === "krea2"
        ) {
          issues.push({
            field: "checkpoint",
            severity: "error",
            message: `'${checkpointName}' cannot drive the refiner pass. Choose an SDXL, Illustrious, Pony, or SD 1.5 checkpoint.`,
          });
        }
        issues.push(...collectLoraIssues(req, arch, installedModels, wf));
      }

      const creativity = req.upscale?.creativity;
      if (
        typeof creativity === "number" &&
        (creativity < REFINER_CREATIVITY_MIN || creativity > REFINER_CREATIVITY_MAX)
      ) {
        issues.push({
          field: "upscale",
          severity: "warning",
          message: `Refiner Creativity must stay between ${REFINER_CREATIVITY_MIN.toFixed(2)} and ${REFINER_CREATIVITY_MAX.toFixed(2)}; it will be clamped.`,
        });
      }
      const refinerSteps = req.upscale?.steps;
      if (typeof refinerSteps === "number" && (refinerSteps < 4 || refinerSteps > 60)) {
        issues.push({
          field: "upscale",
          severity: "warning",
          message: "Refiner steps will be clamped to the 4–60 range.",
        });
      }
    }

    const scale = req.upscale?.scale ?? 4;
    const outPixels = Math.round(req.width * scale) * Math.round(req.height * scale);
    if (outPixels > 4096 * 4096) {
      issues.push({
        field: "upscale",
        severity: "warning",
        message: "Target upscaled resolution exceeds 4096×4096px; heavy memory pressure may occur.",
      });
    }

    return issues;
  }

  if (!req.prompt || req.prompt.trim().length === 0) {
    issues.push({
      field: "prompt",
      severity: "error",
      message: "Prompt cannot be empty.",
    });
  }

  let baseArch: ModelArchitecture = "unknown";

  if (!req.checkpoint || req.checkpoint.trim().length === 0) {
    issues.push({
      field: "checkpoint",
      severity: "error",
      message: "Please select a model before generating.",
    });
  } else {
    const modelRecord = installedModels.find(
      (m) => m.relativePath === req.checkpoint || m.name === req.checkpoint
    );
    const arch = modelRecord?.architecture ?? inferModelArchitecture(req.checkpoint);
    baseArch = arch;

    if (arch === "ltx_video") {
      issues.push({
        field: "checkpoint",
        severity: "error",
        message: `'${req.checkpoint}' is a video model (LTX-Video) and cannot be used with image workflows.`,
      });
    } else if (
      arch !== "unknown" &&
      !wf.supportedArchitectures.includes(arch)
    ) {
      issues.push({
        field: "checkpoint",
        severity: "error",
        message: `Model architecture '${arch}' is incompatible with workflow '${wf.name}'.`,
      });
    }

    if (isAnimaWorkflow(req.workflowId)) {
      if (modelRecord && modelRecord.category !== "diffusion_model") {
        issues.push({
          field: "checkpoint",
          severity: "error",
          message: `Anima workflows load split diffusion models via UNETLoader; '${req.checkpoint}' is registered as a ${modelRecord.category}.`,
        });
      }
      const hasClip = installedModels.some(
        (m) => m.category === "text_encoder" && m.name.toLowerCase().includes("qwen_3_06b")
      );
      const hasVae = installedModels.some(
        (m) => m.category === "vae" && m.name.toLowerCase().includes("qwen_image_vae")
      );
      if (!hasClip || !hasVae) {
        issues.push({
          field: "checkpoint",
          severity: "error",
          message:
            "Anima requires text encoder 'qwen_3_06b_base.safetensors' and VAE 'qwen_image_vae.safetensors' in the vault.",
        });
      }
    } else if (req.workflowId === "t2i_z_image_turbo") {
      const hasClip = installedModels.some(
        (m) => m.category === "text_encoder" && m.name.toLowerCase().includes("qwen_3_4b")
      );
      const hasAe =
        resolveAutoVaeName(
          "z_image",
          installedModels.filter((m) => m.category === "vae")
        ) !== null;
      if (!hasClip || !hasAe) {
        issues.push({
          field: "checkpoint",
          severity: "error",
          message:
            "Z-Image Turbo requires text encoder 'qwen_3_4b.safetensors' and VAE 'ae.safetensors'.",
        });
      }
    } else if (isMossWorkflow(req.workflowId)) {
      if (
        modelRecord &&
        modelRecord.category !== "diffusion_model" &&
        modelRecord.category !== "checkpoint"
      ) {
        issues.push({
          field: "checkpoint",
          severity: "error",
          message: `MOSS-Image loads a split diffusion model via UNETLoader; '${req.checkpoint}' is registered as a ${modelRecord.category}.`,
        });
      }
      const modelClassification = classifyMossModel(
        modelRecord ?? { name: req.checkpoint, relativePath: req.checkpoint, architecture: arch }
      );
      if (!modelClassification.compatible) {
        issues.push({
          field: "checkpoint",
          severity: "error",
          message:
            modelClassification.reason ??
            `Checkpoint '${req.checkpoint}' is incompatible with MOSS-Image.`,
        });
      }
      const wantsBase = req.workflowId === "t2i_moss_image_base";
      if (wantsBase && modelClassification.kind === "moss_sft") {
        issues.push({
          field: "checkpoint",
          severity: "error",
          message:
            "The MOSS-Image Base workflow requires a moss_image_base or custom fine-tune checkpoint without CFG distillation.",
        });
      }
      const missing = missingMossRequirements(installedModels, req.workflowId);
      if (missing.length > 0) {
        const requiredIds = new Set(mossRequirementsFor(req.workflowId));
        const detail = mossDependencyStatus(installedModels, req.workflowId)
          .filter(
            (status) =>
              requiredIds.has(status.dependency.id) && !status.installed
          )
          .map(
            (status) =>
              `${status.dependency.label} (${status.dependency.targetSubdir}/)`
          )
          .join(", ");
        issues.push({
          field: "checkpoint",
          severity: "error",
          message: `MOSS-Image workflow is not ready: missing ${detail}. Install components from the Model Vault catalog and rescan.`,
        });
      }
      if (req.workflowId === "t2i_moss_image_layout") {
        const layoutValidation = validateMossLayoutJson(req.layoutJson?.trim() || "[]");
        if (!layoutValidation.valid || layoutValidation.itemCount === 0) {
          issues.push({
            field: "prompt",
            severity: "error",
            message:
              layoutValidation.error ||
              "MOSS-Image Layout requires bounding-box JSON with at least one box.",
          });
        }
      }
      if (req.width % 16 !== 0 || req.height % 16 !== 0) {
        issues.push({
          field: "dimensions",
          severity: "error",
          message: "MOSS-Image requires width and height to be positive multiples of 16.",
        });
      }
    } else if (!usesDiffusionModelLoader(req.workflowId) && modelRecord?.category === "diffusion_model") {
      issues.push({
        field: "checkpoint",
        severity: "error",
        message: `'${req.checkpoint}' is a standalone diffusion model; switch to an Anima or Z-Image workflow that loads it with UNETLoader.`,
      });
    }

    issues.push(...collectLoraIssues(req, arch, installedModels, wf));
  }

  if (req.vae && req.vae !== VAE_AUTO && req.vae !== VAE_EMBEDDED) {
    const vaeRec = installedModels.find(
      (m) =>
        m.category === "vae" &&
        (m.relativePath === req.vae || m.name === req.vae)
    );
    if (installedModels.length > 0 && !vaeRec) {
      issues.push({
        field: "vae",
        severity: "error",
        message: `VAE '${req.vae}' was not found in scanned vae directories.`,
      });
    } else if (
      vaeRec &&
      !isVaeCompatibleWithArchitecture(vaeRec.architecture, baseArch)
    ) {
      issues.push({
        field: "vae",
        severity: "warning",
        message: `VAE '${req.vae}' (${ARCHITECTURE_LABELS[vaeRec.architecture]}) may not decode ${ARCHITECTURE_LABELS[baseArch]} latents correctly.`,
      });
    }
  }

  if (req.mode === "img2img" && (!req.inputImagePath || req.inputImagePath.trim().length === 0)) {
    issues.push({
      field: "inputImagePath",
      severity: "error",
      message: "Image-to-Image mode requires an uploaded or selected input image.",
    });
  }

  if (req.width < wf.minDim || req.width > wf.maxDim || req.height < wf.minDim || req.height > wf.maxDim) {
    issues.push({
      field: "dimensions",
      severity: "error",
      message: `Dimensions must be between ${wf.minDim}px and ${wf.maxDim}px for this workflow.`,
    });
  }

  if (req.width % wf.dimStep !== 0 || req.height % wf.dimStep !== 0) {
    issues.push({
      field: "dimensions",
      severity: "warning",
      message: `Dimensions will be snapped to a multiple of ${wf.dimStep}.`,
    });
  }

  const totalPixels = req.width * req.height * Math.max(1, req.batchSize);
  if (totalPixels > 1280 * 1280 * 2 && (vramTotalMB <= 16500 || profile === "memory_saver")) {
    issues.push({
      field: "batchSize",
      severity: "warning",
      message:
        "High pixel load (resolution × batch size) may exceed 16 GB VRAM headroom; consider batch size 1.",
    });
  }

  if (req.hiresFix?.enabled) {
    const hiresUpscaler = req.hiresFix.upscaler.trim();
    if (!hiresUpscaler) {
      issues.push({
        field: "hiresFix",
        severity: "error",
        message: "Select an upscaler (Latent Bislerp or an installed .pth model) for High-Res Fix.",
      });
    } else if (
      !isLatentUpscaler(hiresUpscaler) &&
      installedModels.length > 0 &&
      !installedModels.some(
        (m) => m.category === "upscale" && (m.relativePath === hiresUpscaler || m.name === hiresUpscaler)
      )
    ) {
      issues.push({
        field: "hiresFix",
        severity: "error",
        message: `High-Res Fix upscaler '${hiresUpscaler}' was not found in scanned upscale_models directories.`,
      });
    }

    if (req.hiresFix.pipeline === "refiner") {
      if (isLatentUpscaler(hiresUpscaler)) {
        issues.push({
          field: "hiresFix",
          severity: "error",
          message:
            "Refiner High-Res Fix needs an installed AI upscaler (.pth); latent methods cannot feed a refinement pass.",
        });
      }
      const creativity = req.hiresFix.creativity;
      if (
        typeof creativity === "number" &&
        (creativity < REFINER_CREATIVITY_MIN || creativity > REFINER_CREATIVITY_MAX)
      ) {
        issues.push({
          field: "hiresFix",
          severity: "warning",
          message: `Refiner Creativity must stay between ${REFINER_CREATIVITY_MIN.toFixed(2)} and ${REFINER_CREATIVITY_MAX.toFixed(2)}; it will be clamped.`,
        });
      }
    }

    const hiresDims = calculateHiresDimensions(
      req.width,
      req.height,
      req.hiresFix.scale,
      wf.dimStep,
      wf.minDim,
      4096
    );
    const hiresTotalPixels = hiresDims.width * hiresDims.height * Math.max(1, req.batchSize);
    if (hiresTotalPixels > 2048 * 2048 && (vramTotalMB <= 16500 || profile === "memory_saver")) {
      issues.push({
        field: "hiresFix",
        severity: "warning",
        message: `High-Res Fix output (${hiresDims.width}×${hiresDims.height} × batch ${req.batchSize}) may strain 16 GB VRAM; consider Scale ≤ 1.5× or Batch Size 1.`,
      });
    }
  }

  return issues;
}
