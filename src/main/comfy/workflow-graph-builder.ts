import path from "node:path";
import type {
  GenerationRequest,
  ModelRecord,
  WorkflowTemplate,
} from "../../shared/types";
import {
  calculateHiresDimensions,
  IMAGE_UPSCALER_LANCZOS,
  isLatentUpscaler,
  LATENT_UPSCALER_BICUBIC,
  snapDimension,
} from "../../shared/aspect-ratios";
import {
  findPresetUpscaler,
  resolveAutoVaeName,
} from "../../shared/model-utils";
import type { ComfyPromptGraph } from "./comfy-types";
import {
  classifyMossLora,
  validateMossLayoutJson,
} from "../../shared/moss-image";
import {
  ANIMA_DEFAULT_NEGATIVE,
  getWorkflowById,
  isAnimaWorkflow,
  isKrea2Workflow,
} from "./workflow-templates";
import {
  clampRefinerCreativity,
  resolveArchitectureFor,
  resolveRefinerCheckpoint,
  resolveRequestedVae,
} from "./workflow-validation";
import { buildVideoPromptGraph } from "./video-graph-builder";

/** Negative prompt shipped with ComfyUI's official MOSS-Image templates. */
const MOSS_DEFAULT_NEGATIVE_PROMPT =
  "nsfw, worst quality, bad anatomy, watermark, jpeg artifact";

export function resolveModelRelativePath(
  requestedPath: string,
  models: ModelRecord[]
): string {
  if (!requestedPath) return requestedPath;
  const norm = requestedPath.replace(/[\\/]/g, "/").toLowerCase();
  const matched = models.find(
    (m) =>
      m.relativePath.replace(/[\\/]/g, "/").toLowerCase() === norm ||
      m.relativePath.toLowerCase() === requestedPath.toLowerCase() ||
      m.name.toLowerCase() === norm
  );
  return matched ? matched.relativePath : requestedPath;
}

export interface BuildWorkflowParams {
  request: GenerationRequest;
  uploadedInputFilename?: string;
  uploadedMaskFilename?: string;
  availableModels: ModelRecord[];
  filenamePrefix?: string;
  supportsUpscaleModel?: boolean;
}

interface AttachHiresFixParams {
  graph: ComfyPromptGraph;
  template: WorkflowTemplate;
  request: GenerationRequest;
  resolvedSeed: number;
  baseWidth: number;
  baseHeight: number;
  modelRef: [string, number];
  positiveRef: [string, number];
  negativeRef: [string, number];
  vaeRef: [string, number];
  supportsUpscaleModel: boolean;
}

/**
 * Wires an optional Pass 2 High-Res Fix stage (latent or AI-upscaler guided)
 * onto an existing Pass 1 KSampler ("3") and re-points final VAEDecode ("8").
 */
function attachHiresFixPass(params: AttachHiresFixParams): void {
  const {
    graph,
    template,
    request,
    resolvedSeed,
    baseWidth,
    baseHeight,
    modelRef,
    positiveRef,
    negativeRef,
    vaeRef,
    supportsUpscaleModel,
  } = params;

  const hires = request.hiresFix;
  if (!hires?.enabled) return;

  const hiresDims = calculateHiresDimensions(
    baseWidth,
    baseHeight,
    hires.scale,
    template.dimStep,
    template.minDim,
    4096
  );
  const refinerPipeline =
    hires.pipeline === "refiner" &&
    !isLatentUpscaler(hires.upscaler) &&
    supportsUpscaleModel;
  const hiresDenoise = refinerPipeline
    ? clampRefinerCreativity(hires.creativity)
    : Math.min(0.95, Math.max(0.05, hires.denoise));
  const hiresSteps = Math.max(1, Math.round(hires.steps));

  let upscaledLatentRef: [string, number];

  if (isLatentUpscaler(hires.upscaler) || !supportsUpscaleModel) {
    const method = hires.upscaler === LATENT_UPSCALER_BICUBIC ? "bicubic" : "bislerp";
    graph["90"] = {
      class_type: "LatentUpscale",
      inputs: {
        samples: ["3", 0],
        upscale_method: method,
        width: hiresDims.width,
        height: hiresDims.height,
        crop: "disabled",
      },
      _meta: { title: "Hires Latent Upscale" },
    };
    upscaledLatentRef = ["90", 0];
  } else {
    graph["91"] = {
      class_type: "VAEDecode",
      inputs: { samples: ["3", 0], vae: vaeRef },
      _meta: { title: "Hires Intermediate Decode" },
    };
    graph["92"] = {
      class_type: "UpscaleModelLoader",
      inputs: { model_name: hires.upscaler },
      _meta: { title: "Hires Load Upscale Model" },
    };
    graph["93"] = {
      class_type: "ImageUpscaleWithModel",
      inputs: { upscale_model: ["92", 0], image: ["91", 0] },
      _meta: { title: "Hires AI Upscale" },
    };
    graph["94"] = {
      class_type: "ImageScale",
      inputs: {
        image: ["93", 0],
        upscale_method: "lanczos",
        width: hiresDims.width,
        height: hiresDims.height,
        crop: "disabled",
      },
      _meta: { title: "Hires Target Resize" },
    };
    graph["95"] = {
      class_type: "VAEEncode",
      inputs: { pixels: ["94", 0], vae: vaeRef },
      _meta: { title: "Hires VAE Encode" },
    };
    upscaledLatentRef = ["95", 0];
  }

  graph["96"] = {
    class_type: "KSampler",
    inputs: {
      seed: resolvedSeed,
      steps: hiresSteps,
      cfg: request.cfg,
      sampler_name: refinerPipeline ? "dpmpp_2m_sde" : request.sampler,
      scheduler: refinerPipeline ? "karras" : request.scheduler,
      denoise: hiresDenoise,
      model: modelRef,
      positive: positiveRef,
      negative: negativeRef,
      latent_image: upscaledLatentRef,
    },
    _meta: { title: "Hires Pass 2 KSampler" },
  };

  if (graph["8"]) {
    graph["8"].inputs.samples = ["96", 0];
  }
}

export function buildComfyPromptGraph(params: BuildWorkflowParams): {
  template: WorkflowTemplate;
  resolvedSeed: number;
  graph: ComfyPromptGraph;
} {
  const {
    request,
    uploadedInputFilename,
    uploadedMaskFilename,
    availableModels,
    filenamePrefix = "KireaStudio",
    supportsUpscaleModel = true,
  } = params;
  const template = getWorkflowById(request.workflowId);
  if (!template) {
    throw new Error(`Unknown workflow template: ${request.workflowId}`);
  }

  const width = snapDimension(request.width, template.dimStep, template.minDim, template.maxDim);
  const height = snapDimension(request.height, template.dimStep, template.minDim, template.maxDim);
  const resolvedSeed = request.randomSeed
    ? Math.floor(Math.random() * 2_147_483_647)
    : Math.max(0, Math.floor(request.seed));

  if (template.video) {
    const graph = buildVideoPromptGraph({
      template,
      request,
      uploadedInputFilename,
      availableModels,
      filenamePrefix,
      resolvedSeed,
      width,
      height,
    });
    return { template, resolvedSeed, graph };
  }

  if (template.mode === "upscale") {
    if (!uploadedInputFilename) {
      throw new Error("Input image must be uploaded to ComfyUI before building upscale graph.");
    }
    const upscaleModels = availableModels.filter((m) => m.category === "upscale");
    const presetUpscaler = findPresetUpscaler(request.upscale?.preset, upscaleModels);
    const targetScale = Math.min(4, Math.max(1.25, request.upscale?.scale ?? 4));
    const upscalerName =
      presetUpscaler ??
      (request.upscale?.upscaler?.trim() || IMAGE_UPSCALER_LANCZOS);
    const useModelUpscaler = supportsUpscaleModel && upscalerName !== IMAGE_UPSCALER_LANCZOS;

    if (template.id === "upscale_refiner_v1" || request.upscale?.pipeline === "refiner") {
      const refinerCheckpoint = resolveRefinerCheckpoint(request);
      if (!refinerCheckpoint) {
        throw new Error(
          "Alchemy Refiner requires a checkpoint for the refining pass."
        );
      }
      const refinerArch = resolveArchitectureFor(refinerCheckpoint, availableModels);
      const refinerVaeName = resolveRequestedVae(request, refinerArch, availableModels);
      const targetWidth = Math.min(
        4096,
        Math.max(64, Math.round((width * targetScale) / 8) * 8)
      );
      const targetHeight = Math.min(
        4096,
        Math.max(64, Math.round((height * targetScale) / 8) * 8)
      );

      const graph: ComfyPromptGraph = {
        "11": {
          class_type: "LoadImage",
          inputs: { image: uploadedInputFilename },
          _meta: { title: "Load Input Image" },
        },
      };

      let upscaledRef: [string, number] = ["11", 0];
      if (useModelUpscaler) {
        graph["14"] = {
          class_type: "UpscaleModelLoader",
          inputs: { model_name: upscalerName },
          _meta: { title: "Load Upscale Model" },
        };
        graph["15"] = {
          class_type: "ImageUpscaleWithModel",
          inputs: { upscale_model: ["14", 0], image: ["11", 0] },
          _meta: { title: "AI Model Upscale" },
        };
        upscaledRef = ["15", 0];
      }

      graph["16"] = {
        class_type: "ImageScale",
        inputs: {
          image: upscaledRef,
          upscale_method: "lanczos",
          width: targetWidth,
          height: targetHeight,
          crop: "disabled",
        },
        _meta: { title: "Scale to Refiner Resolution" },
      };

      graph["4"] = {
        class_type: "CheckpointLoaderSimple",
        inputs: { ckpt_name: refinerCheckpoint },
        _meta: { title: "Load Refiner Checkpoint" },
      };

      let modelRef: [string, number] = ["4", 0];
      let clipRef: [string, number] = ["4", 1];
      let vaeRef: [string, number] = ["4", 2];

      if (refinerVaeName) {
        graph["10"] = {
          class_type: "VAELoader",
          inputs: { vae_name: refinerVaeName },
          _meta: { title: "Load Refiner VAE" },
        };
        vaeRef = ["10", 0];
      }

      request.loras.slice(0, 2).forEach((lora, idx) => {
        const nodeId = `2${idx}`;
        graph[nodeId] = {
          class_type: "LoraLoader",
          inputs: {
            lora_name: lora.name,
            strength_model: lora.strengthModel,
            strength_clip: lora.strengthClip,
            model: modelRef,
            clip: clipRef,
          },
          _meta: { title: `Refiner LoRA ${idx + 1}` },
        };
        modelRef = [nodeId, 0];
        clipRef = [nodeId, 1];
      });

      graph["6"] = {
        class_type: "CLIPTextEncode",
        inputs: { text: request.prompt, clip: clipRef },
        _meta: { title: "Refiner Positive Prompt" },
      };
      graph["7"] = {
        class_type: "CLIPTextEncode",
        inputs: { text: request.negativePrompt || "", clip: clipRef },
        _meta: { title: "Refiner Negative Prompt" },
      };
      graph["17"] = {
        class_type: "VAEEncode",
        inputs: { pixels: ["16", 0], vae: vaeRef },
        _meta: { title: "Refiner VAE Encode" },
      };
      graph["18"] = {
        class_type: "KSampler",
        inputs: {
          seed: resolvedSeed,
          steps: Math.min(60, Math.max(4, Math.round(request.upscale?.steps ?? 20))),
          cfg: request.cfg,
          sampler_name: "dpmpp_2m_sde",
          scheduler: "karras",
          denoise: clampRefinerCreativity(request.upscale?.creativity),
          model: modelRef,
          positive: ["6", 0],
          negative: ["7", 0],
          latent_image: ["17", 0],
        },
        _meta: { title: "Refiner KSampler" },
      };
      graph["8"] = {
        class_type: "VAEDecode",
        inputs: { samples: ["18", 0], vae: vaeRef },
        _meta: { title: "Refiner VAE Decode" },
      };
      graph["9"] = {
        class_type: "SaveImage",
        inputs: { filename_prefix: filenamePrefix, images: ["8", 0] },
        _meta: { title: "Save Image" },
      };

      return { template, resolvedSeed, graph };
    }

    const graph: ComfyPromptGraph = {
      "11": {
        class_type: "LoadImage",
        inputs: { image: uploadedInputFilename },
        _meta: { title: "Load Input Image" },
      },
    };

    let finalImageRef: [string, number] = ["11", 0];
    if (useModelUpscaler) {
      graph["14"] = {
        class_type: "UpscaleModelLoader",
        inputs: { model_name: upscalerName },
        _meta: { title: "Load Upscale Model" },
      };
      graph["15"] = {
        class_type: "ImageUpscaleWithModel",
        inputs: { upscale_model: ["14", 0], image: ["11", 0] },
        _meta: { title: "AI Model Upscale" },
      };
      finalImageRef = ["15", 0];

      const nativeFactor = /^2x/i.test(path.basename(upscalerName)) ? 2 : 4;
      const relativeScale = Number((targetScale / nativeFactor).toFixed(4));
      if (Math.abs(relativeScale - 1) > 0.001) {
        graph["16"] = {
          class_type: "ImageScaleBy",
          inputs: {
            image: finalImageRef,
            upscale_method: "lanczos",
            scale_by: relativeScale,
          },
          _meta: { title: "Scale to Target Multiplier" },
        };
        finalImageRef = ["16", 0];
      }
    } else {
      graph["16"] = {
        class_type: "ImageScaleBy",
        inputs: {
          image: ["11", 0],
          upscale_method: "lanczos",
          scale_by: Number(targetScale.toFixed(4)),
        },
        _meta: { title: "Lanczos Scale Upscale" },
      };
      finalImageRef = ["16", 0];
    }

    graph["9"] = {
      class_type: "SaveImage",
      inputs: { filename_prefix: filenamePrefix, images: finalImageRef },
      _meta: { title: "Save Image" },
    };

    return { template, resolvedSeed, graph };
  }

  if (template.id === "t2i_z_image_turbo") {
    const qwenClip =
      availableModels.find(
        (m) => m.category === "text_encoder" && m.name.toLowerCase().includes("qwen_3_4b")
      )?.relativePath ?? "qwen_3_4b.safetensors";
    const aeVae =
      resolveRequestedVae(request, "z_image", availableModels) ??
      resolveAutoVaeName(
        "z_image",
        availableModels.filter((m) => m.category === "vae")
      ) ??
      "ae.safetensors";

    const graph: ComfyPromptGraph = {
      "28": {
        class_type: "UNETLoader",
        inputs: { unet_name: request.checkpoint, weight_dtype: "default" },
        _meta: { title: "Load Diffusion Model" },
      },
      "30": {
        class_type: "CLIPLoader",
        inputs: { clip_name: qwenClip, type: "lumina2", device: "default" },
        _meta: { title: "Load Qwen3 Text Encoder" },
      },
      "29": {
        class_type: "VAELoader",
        inputs: { vae_name: aeVae },
        _meta: { title: "Load AE VAE" },
      },
      "11": {
        class_type: "ModelSamplingAuraFlow",
        inputs: { shift: 3, model: ["28", 0] },
        _meta: { title: "AuraFlow Sampling Shift" },
      },
      "27": {
        class_type: "CLIPTextEncode",
        inputs: { text: request.prompt, clip: ["30", 0] },
        _meta: { title: "Positive Prompt" },
      },
      "33": {
        class_type: "ConditioningZeroOut",
        inputs: { conditioning: ["27", 0] },
        _meta: { title: "Zero Out Negative Conditioning" },
      },
      "13": {
        class_type: "EmptySD3LatentImage",
        inputs: { width, height, batch_size: Math.max(1, request.batchSize) },
        _meta: { title: "Empty Latent Image" },
      },
      "3": {
        class_type: "KSampler",
        inputs: {
          seed: resolvedSeed,
          steps: request.steps,
          cfg: request.cfg,
          sampler_name: request.sampler,
          scheduler: request.scheduler,
          denoise: 1.0,
          model: ["11", 0],
          positive: ["27", 0],
          negative: ["33", 0],
          latent_image: ["13", 0],
        },
        _meta: { title: "KSampler" },
      },
      "8": {
        class_type: "VAEDecode",
        inputs: { samples: ["3", 0], vae: ["29", 0] },
        _meta: { title: "VAE Decode" },
      },
      "9": {
        class_type: "SaveImage",
        inputs: { filename_prefix: filenamePrefix, images: ["8", 0] },
        _meta: { title: "Save Image" },
      },
    };

    // Optional LoRA chain on top of AuraFlow model + CLIP
    let modelOut: [string, number] = ["11", 0];
    let clipOut: [string, number] = ["30", 0];
    request.loras.slice(0, template.maxLoras).forEach((lora, idx) => {
      const nodeId = `5${idx}`;
      graph[nodeId] = {
        class_type: "LoraLoader",
        inputs: {
          lora_name: lora.name,
          strength_model: lora.strengthModel,
          strength_clip: lora.strengthClip,
          model: modelOut,
          clip: clipOut,
        },
        _meta: { title: `LoRA ${idx + 1}` },
      };
      modelOut = [nodeId, 0];
      clipOut = [nodeId, 1];
    });
    graph["27"]!.inputs.clip = clipOut;
    graph["3"]!.inputs.model = modelOut;

    attachHiresFixPass({
      graph,
      template,
      request,
      resolvedSeed,
      baseWidth: width,
      baseHeight: height,
      modelRef: modelOut,
      positiveRef: ["27", 0],
      negativeRef: ["33", 0],
      vaeRef: ["29", 0],
      supportsUpscaleModel,
    });

    return { template, resolvedSeed, graph };
  }

  if (
    template.id === "t2i_moss_image" ||
    template.id === "t2i_moss_image_turbo" ||
    template.id === "t2i_moss_image_base" ||
    template.id === "t2i_moss_image_layout"
  ) {
    const qwenClip =
      availableModels.find(
        (m) =>
          m.category === "text_encoder" &&
          /qwen3\.5[-_]9b|qwen3_5_9b|qwen35_9b/i.test(m.name)
      )?.relativePath ?? "qwen3.5_9b_w4a8_gptq.safetensors";
    const flux2Vae =
      resolveRequestedVae(request, "moss_image", availableModels) ??
      resolveAutoVaeName(
        "moss_image",
        availableModels.filter((m) => m.category === "vae")
      ) ??
      "flux2-vae_small.safetensors";

    const resolvedUnetName = resolveModelRelativePath(request.checkpoint, availableModels);
    const graph: ComfyPromptGraph = {
      "28": {
        class_type: "UNETLoader",
        inputs: { unet_name: resolvedUnetName, weight_dtype: "default" },
        _meta: { title: "Load MOSS-Image Diffusion Model" },
      },
      "30": {
        class_type: "CLIPLoader",
        inputs: { clip_name: qwenClip, type: "moss_image", device: "default" },
        _meta: { title: "Load Qwen3.5-9B Text Encoder" },
      },
      "29": {
        class_type: "VAELoader",
        inputs: { vae_name: flux2Vae },
        _meta: { title: "Load FLUX.2 Small VAE" },
      },
    };

    let modelRef: [string, number] = ["28", 0];
    let clipRef: [string, number] = ["30", 0];
    request.loras.slice(0, template.maxLoras).forEach((lora, idx) => {
      const nodeId = `4${idx}`;
      const loraRecord = availableModels.find(
        (m) =>
          m.category === "lora" &&
          (m.relativePath === lora.name || m.name === lora.name)
      );
      const loraClassification = classifyMossLora(
        loraRecord ?? { name: lora.name, relativePath: lora.name, architecture: "moss_image" }
      );

      const resolvedLoraName = resolveModelRelativePath(lora.name, availableModels);

      if (loraClassification.loaderType === "LoraLoader") {
        graph[nodeId] = {
          class_type: "LoraLoader",
          inputs: {
            lora_name: resolvedLoraName,
            strength_model: lora.strengthModel,
            strength_clip: lora.strengthClip ?? 1.0,
            model: modelRef,
            clip: clipRef,
          },
          _meta: { title: `LoRA ${idx + 1} (Model+CLIP)` },
        };
        modelRef = [nodeId, 0];
        clipRef = [nodeId, 1];
      } else {
        graph[nodeId] = {
          class_type: "LoraLoaderModelOnly",
          inputs: {
            lora_name: resolvedLoraName,
            strength_model: lora.strengthModel,
            model: modelRef,
          },
          _meta: { title: `LoRA ${idx + 1}` },
        };
        modelRef = [nodeId, 0];
      }
    });

    if (template.id === "t2i_moss_image_turbo") {
      const hasTurboLora = request.loras.some((l) =>
        /4_?steps?|turbo/i.test(l.name)
      );
      if (!hasTurboLora) {
        const turboLoraRecord = availableModels.find(
          (m) =>
            m.category === "lora" &&
            /moss.*4_?steps.*lora|4step.*lora/i.test(m.name)
        );
        const turboLoraName =
          turboLoraRecord?.relativePath ??
          "moss_image_sft_4_steps_lora_v2_600_avg_rank_72_bf16.safetensors";
        graph["4_turbo"] = {
          class_type: "LoraLoaderModelOnly",
          inputs: {
            lora_name: turboLoraName,
            strength_model: 1.0,
            model: modelRef,
          },
          _meta: { title: "MOSS 4-Step Turbo LoRA" },
        };
        modelRef = ["4_turbo", 0];
      }
    }

    // Matches ComfyUI's official MOSS-Image t2i template: only single layer 22
    // is skipped, and only through the first half of sampling.
    graph["31"] = {
      class_type: "SkipLayerGuidanceDiTSimple",
      inputs: {
        model: modelRef,
        double_layers: "",
        single_layers: "22",
        start_percent: 0,
        end_percent: 0.5,
      },
      _meta: { title: "MOSS Skip-Layer Guidance" },
    };

    let positiveText = request.prompt;
    if (template.id === "t2i_moss_image_layout") {
      const layoutValidation = validateMossLayoutJson(request.layoutJson?.trim() || "[]");
      if (layoutValidation.format === "full_layout") {
        // User supplied the full MOSS layout JSON: pass it directly to text encode
        positiveText = request.layoutJson!.trim();
      } else {
        // ComfyUI's prompt validator treats any non-[node, slot] list as a link,
        // so pass the boxes through the string-capable `bboxes` input instead of
        // the `editor_state` widget.
        graph["50"] = {
          class_type: "CreateBoundingBoxes",
          inputs: {
            width,
            height,
            editor_state: {},
            bboxes: request.layoutJson?.trim() || "[]",
          },
          _meta: { title: "MOSS Layout Bounding Boxes" },
        };
        graph["51"] = {
          class_type: "MOSSImageLayoutPrompt",
          inputs: {
            prompt: request.prompt,
            element: ["50", 2],
            width,
            height,
            character_boxes: "",
          },
          _meta: { title: "MOSS Layout Prompt" },
        };
        positiveText = "";
      }
    }

    graph["27"] = {
      class_type: "CLIPTextEncode",
      inputs: {
        text: positiveText,
        clip: clipRef,
      },
      _meta: { title: "Positive Prompt" },
    };
    if (template.id === "t2i_moss_image_layout" && graph["51"]) {
      graph["52"] = {
        class_type: "CLIPTextEncode",
        inputs: { text: ["51", 0], clip: clipRef },
        _meta: { title: "Layout Prompt Encode" },
      };
    }
    graph["33"] = {
      class_type: "CLIPTextEncode",
      inputs: {
        text: request.negativePrompt?.trim() || MOSS_DEFAULT_NEGATIVE_PROMPT,
        clip: clipRef,
      },
      _meta: { title: "Negative Prompt" },
    };
    graph["13"] = {
      class_type: "EmptyFlux2LatentImage",
      inputs: { width, height, batch_size: Math.max(1, request.batchSize) },
      _meta: { title: "Empty Flux 2 Latent" },
    };
    graph["3"] = {
      class_type: "KSampler",
      inputs: {
        seed: resolvedSeed,
        steps: request.steps,
        cfg: request.cfg,
        sampler_name: request.sampler,
        scheduler: request.scheduler,
        denoise: 1.0,
        model: ["31", 0],
        positive: [template.id === "t2i_moss_image_layout" && graph["52"] ? "52" : "27", 0],
        negative: ["33", 0],
        latent_image: ["13", 0],
      },
      _meta: { title: "KSampler" },
    };
    graph["8"] = {
      class_type: "VAEDecode",
      inputs: { samples: ["3", 0], vae: ["29", 0] },
      _meta: { title: "VAE Decode" },
    };
    graph["9"] = {
      class_type: "SaveImage",
      inputs: { filename_prefix: filenamePrefix, images: ["8", 0] },
      _meta: { title: "Save Image" },
    };

    attachHiresFixPass({
      graph,
      template,
      request,
      resolvedSeed,
      baseWidth: width,
      baseHeight: height,
      modelRef: ["31", 0],
      positiveRef: [template.id === "t2i_moss_image_layout" && graph["52"] ? "52" : "27", 0],
      negativeRef: ["33", 0],
      vaeRef: ["29", 0],
      supportsUpscaleModel,
    });

    return { template, resolvedSeed, graph };
  }

  if (
    template.id === "i2i_moss_image_edit" ||
    template.id === "i2i_moss_image_color_control" ||
    template.id === "i2i_moss_image_depth_control"
  ) {
    if (!uploadedInputFilename) {
      throw new Error("MOSS-Image edit/control workflows require an input image.");
    }
    const qwenClip =
      availableModels.find(
        (m) =>
          m.category === "text_encoder" &&
          /qwen3\.5[-_]9b|qwen3_5_9b|qwen35_9b/i.test(m.name)
      )?.relativePath ?? "qwen3.5_9b_w4a8_gptq.safetensors";
    const flux2Vae =
      resolveRequestedVae(request, "moss_image", availableModels) ??
      resolveAutoVaeName(
        "moss_image",
        availableModels.filter((m) => m.category === "vae")
      ) ??
      "flux2-vae_small.safetensors";
    const isEdit = template.id === "i2i_moss_image_edit";

    const resolvedUnetName = resolveModelRelativePath(request.checkpoint, availableModels);
    const graph: ComfyPromptGraph = {
      "28": {
        class_type: "UNETLoader",
        inputs: { unet_name: resolvedUnetName, weight_dtype: "default" },
        _meta: { title: "Load MOSS-Image Diffusion Model" },
      },
      "30": {
        class_type: "CLIPLoader",
        inputs: { clip_name: qwenClip, type: "moss_image", device: "default" },
        _meta: { title: "Load Qwen3.5-9B Text Encoder" },
      },
      "29": {
        class_type: "VAELoader",
        inputs: { vae_name: flux2Vae },
        _meta: { title: "Load FLUX.2 Small VAE" },
      },
      "10": {
        class_type: "LoadImage",
        inputs: { image: uploadedInputFilename },
        _meta: { title: isEdit ? "Reference Image" : "Control Map" },
      },
      "11": {
        class_type: "ImageScale",
        inputs: {
          image: ["10", 0],
          upscale_method: "lanczos",
          width,
          height,
          crop: "disabled",
        },
        _meta: { title: "Resize Input" },
      },
    };

    let modelRef: [string, number] = ["28", 0];
    const clipRef: [string, number] = ["30", 0];
    request.loras.slice(0, template.maxLoras).forEach((lora, idx) => {
      const nodeId = `4${idx}`;
      graph[nodeId] = {
        class_type: "LoraLoaderModelOnly",
        inputs: {
          lora_name: lora.name,
          strength_model: lora.strengthModel,
          model: modelRef,
        },
        _meta: { title: `LoRA ${idx + 1}` },
      };
      modelRef = [nodeId, 0];
    });

    const adapterLora = isEdit
      ? availableModels.find(
          (m) =>
            m.category === "lora" &&
            /moss_image_edit_lora/i.test(m.name)
        )?.relativePath
      : availableModels.find(
          (m) =>
            m.category === "lora" &&
            /moss_image_color_depth_control/i.test(m.name)
        )?.relativePath;
    graph["45"] = {
      class_type: "LoraLoaderModelOnly",
      inputs: {
        lora_name:
          adapterLora ??
          (isEdit
            ? "moss_image_edit_lora_rank_64_bf16.safetensors"
            : "moss_image_color_depth_control.safetensors"),
        strength_model: 1,
        model: modelRef,
      },
      _meta: { title: isEdit ? "MOSS Edit LoRA" : "MOSS Color/Depth LoRA" },
    };
    modelRef = ["45", 0];

    if (isEdit) {
      graph["31"] = {
        class_type: "SkipLayerGuidanceDiTSimple",
        inputs: {
          model: modelRef,
          double_layers: "",
          single_layers: "22",
          start_percent: 0,
          end_percent: 1,
        },
        _meta: { title: "MOSS Skip-Layer Guidance" },
      };
      graph["27"] = {
        class_type: "TextEncodeMOSSImageEdit",
        inputs: {
          clip: clipRef,
          prompt: request.prompt,
          edit_format: "Moss-Image-Edit",
          "images.image_0": ["11", 0],
          image_strength: 1,
          vae: ["29", 0],
        },
        _meta: { title: "Edit Instruction" },
      };
      graph["33"] = {
        class_type: "TextEncodeMOSSImageEdit",
        inputs: {
          clip: clipRef,
          prompt:
            request.negativePrompt?.trim() || MOSS_DEFAULT_NEGATIVE_PROMPT,
          edit_format: "Moss-Image-Edit",
          "images.image_0": ["11", 0],
          image_strength: 1,
          vae: ["29", 0],
        },
        _meta: { title: "Negative Edit Instruction" },
      };
      graph["13"] = {
        class_type: "EmptyFlux2LatentImage",
        inputs: { width, height, batch_size: Math.max(1, request.batchSize) },
        _meta: { title: "Empty Flux 2 Latent" },
      };
      graph["3"] = {
        class_type: "KSampler",
        inputs: {
          seed: resolvedSeed,
          steps: request.steps,
          cfg: request.cfg,
          sampler_name: request.sampler,
          scheduler: request.scheduler,
          denoise: 1.0,
          model: ["31", 0],
          positive: ["27", 0],
          negative: ["33", 0],
          latent_image: ["13", 0],
        },
        _meta: { title: "KSampler" },
      };
    } else {
      const isDepth = template.id === "i2i_moss_image_depth_control";
      graph["46"] = {
        class_type: "TemporalScoreRescaling",
        inputs: { model: modelRef, tsr_k: 0.95, tsr_sigma: 1 },
        _meta: { title: "Temporal Score Rescaling" },
      };
      graph["47"] = {
        class_type: "ModelSamplingAuraFlow",
        inputs: { model: ["46", 0], shift: 5, sampling: "flow" },
        _meta: { title: "AuraFlow Sampling Shift" },
      };
      graph["31"] = {
        class_type: "SkipLayerGuidanceDiTSimple",
        inputs: {
          model: ["47", 0],
          double_layers: "",
          single_layers: "24",
          start_percent: 0,
          end_percent: 1,
        },
        _meta: { title: "MOSS Skip-Layer Guidance" },
      };
      graph["27"] = {
        class_type: "CLIPTextEncode",
        inputs: { text: request.prompt, clip: clipRef },
        _meta: { title: "Positive Prompt" },
      };
      graph["33"] = {
        class_type: "CLIPTextEncode",
        inputs: {
          text: request.negativePrompt?.trim() || MOSS_DEFAULT_NEGATIVE_PROMPT,
          clip: clipRef,
        },
        _meta: { title: "Negative Prompt" },
      };
      graph["48"] = {
        class_type: "MOSSImageControl",
        inputs: {
          positive: ["27", 0],
          negative: ["33", 0],
          vae: ["29", 0],
          strength: 1,
          start_percent: 0,
          end_percent: 0.6,
          [isDepth ? "depth_map" : "color_map"]: ["11", 0],
        },
        _meta: { title: isDepth ? "Depth Control" : "Color Region Control" },
      };
      graph["49"] = {
        class_type: "EmptyLatentImage",
        inputs: { width, height, batch_size: Math.max(1, request.batchSize) },
        _meta: { title: "Empty Latent Image" },
      };
      graph["50"] = {
        class_type: "BasicScheduler",
        inputs: {
          model: ["31", 0],
          scheduler: request.scheduler,
          steps: request.steps,
          denoise: 1,
        },
        _meta: { title: "Basic Scheduler" },
      };
      graph["51"] = {
        class_type: "SamplerER_SDE",
        inputs: {
          solver_type: "ER-SDE",
          max_stage: 3,
          eta: 1,
          s_noise: 1.05,
        },
        _meta: { title: "ER-SDE Sampler" },
      };
      graph["52"] = {
        class_type: "SamplerCustom",
        inputs: {
          model: ["31", 0],
          add_noise: true,
          noise_seed: resolvedSeed,
          cfg: request.cfg,
          positive: ["48", 0],
          negative: ["48", 1],
          sampler: ["51", 0],
          sigmas: ["50", 0],
          latent_image: ["49", 0],
        },
        _meta: { title: "Sampler Custom" },
      };
      graph["3"] = {
        class_type: "VAEDecode",
        inputs: { samples: ["52", 0], vae: ["29", 0] },
        _meta: { title: "VAE Decode" },
      };
    }

    if (isEdit) {
      graph["8"] = {
        class_type: "VAEDecode",
        inputs: { samples: ["3", 0], vae: ["29", 0] },
        _meta: { title: "VAE Decode" },
      };
    }
    graph["9"] = {
      class_type: "SaveImage",
      inputs: {
        filename_prefix: filenamePrefix,
        images: [isEdit ? "8" : "3", 0],
      },
      _meta: { title: "Save Image" },
    };

    return { template, resolvedSeed, graph };
  }

  if (isAnimaWorkflow(template.id)) {
    const qwenClip =
      availableModels.find(
        (m) =>
          m.category === "text_encoder" &&
          m.name.toLowerCase().includes("qwen_3_06b")
      )?.relativePath ?? "qwen_3_06b_base.safetensors";
    const animaVae =
      resolveRequestedVae(request, "anima", availableModels) ??
      availableModels.find(
        (m) =>
          m.category === "vae" &&
          m.name.toLowerCase().includes("qwen_image_vae")
      )?.relativePath ??
      "qwen_image_vae.safetensors";

    const graph: ComfyPromptGraph = {
      "28": {
        class_type: "UNETLoader",
        inputs: { unet_name: request.checkpoint, weight_dtype: "default" },
        _meta: { title: "Load Anima Diffusion Model" },
      },
      "30": {
        class_type: "CLIPLoader",
        inputs: { clip_name: qwenClip, type: "stable_diffusion", device: "default" },
        _meta: { title: "Load Qwen3-0.6B Text Encoder" },
      },
      "29": {
        class_type: "VAELoader",
        inputs: { vae_name: animaVae },
        _meta: { title: "Load Qwen Image VAE" },
      },
    };

    let modelRef: [string, number] = ["28", 0];
    request.loras.slice(0, template.maxLoras).forEach((lora, idx) => {
      const nodeId = `4${idx}`;
      graph[nodeId] = {
        class_type: "LoraLoaderModelOnly",
        inputs: {
          lora_name: lora.name,
          strength_model: lora.strengthModel,
          model: modelRef,
        },
        _meta: { title: `Anima LoRA ${idx + 1}` },
      };
      modelRef = [nodeId, 0];
    });

    graph["6"] = {
      class_type: "CLIPTextEncode",
      inputs: { text: request.prompt, clip: ["30", 0] },
      _meta: { title: "Positive Prompt" },
    };
    graph["7"] = {
      class_type: "CLIPTextEncode",
      inputs: {
        text: request.negativePrompt.trim() || ANIMA_DEFAULT_NEGATIVE,
        clip: ["30", 0],
      },
      _meta: { title: "Negative Prompt" },
    };

    let latentRef: [string, number];
    let animaDenoise = 1.0;
    let animaCompositeRef: [string, number] | null = null;

    const hasOutpaintPadding = Boolean(
      request.outpaintPadding &&
        ((request.outpaintPadding.top ?? 0) > 0 ||
          (request.outpaintPadding.bottom ?? 0) > 0 ||
          (request.outpaintPadding.left ?? 0) > 0 ||
          (request.outpaintPadding.right ?? 0) > 0)
    );

    if (template.mode === "img2img") {
      if (!uploadedInputFilename) {
        throw new Error(
          "Input image must be uploaded to ComfyUI before building img2img graph."
        );
      }
      graph["11"] = {
        class_type: "LoadImage",
        inputs: { image: uploadedInputFilename },
        _meta: { title: "Load Input Image" },
      };

      if (uploadedMaskFilename) {
        // --- NATIVE INPAINTING ---
        graph["12"] = {
          class_type: "ImageScale",
          inputs: {
            image: ["11", 0],
            upscale_method: "lanczos",
            width,
            height,
            crop: "center",
          },
          _meta: { title: "Resize Input Image" },
        };
        graph["13"] = {
          class_type: "LoadImage",
          inputs: { image: uploadedMaskFilename },
          _meta: { title: "Load Inpaint Mask Image" },
        };
        graph["14"] = {
          class_type: "ImageScale",
          inputs: {
            image: ["13", 0],
            upscale_method: "nearest-exact",
            width,
            height,
            crop: "center",
          },
          _meta: { title: "Resize Mask to Match Canvas" },
        };
        graph["15"] = {
          class_type: "ImageToMask",
          inputs: {
            image: ["14", 0],
            channel: "red",
          },
          _meta: { title: "Extract Inpaint Mask Channel" },
        };
        graph["5"] = {
          class_type: "VAEEncodeForInpaint",
          inputs: {
            pixels: ["12", 0],
            vae: ["29", 0],
            mask: ["15", 0],
            grow_mask_by: request.maskGrowBy ?? 6,
          },
          _meta: { title: "VAE Encode For Inpainting" },
        };
        latentRef = ["5", 0];
        animaDenoise = Math.min(1, Math.max(0.05, request.denoise));
        animaCompositeRef = ["15", 0];
      } else if (hasOutpaintPadding) {
        // --- NATIVE OUTPAINTING ---
        const padLeft = snapDimension(request.outpaintPadding?.left ?? 0, 8, 0, 4096);
        const padRight = snapDimension(request.outpaintPadding?.right ?? 0, 8, 0, 4096);
        const padTop = snapDimension(request.outpaintPadding?.top ?? 0, 8, 0, 4096);
        const padBottom = snapDimension(request.outpaintPadding?.bottom ?? 0, 8, 0, 4096);

        graph["12"] = {
          class_type: "ImagePadForOutpaint",
          inputs: {
            image: ["11", 0],
            left: padLeft,
            top: padTop,
            right: padRight,
            bottom: padBottom,
            feathering: 40,
          },
          _meta: { title: "Pad Image for Outpainting" },
        };
        graph["5"] = {
          class_type: "VAEEncodeForInpaint",
          inputs: {
            pixels: ["12", 0],
            vae: ["29", 0],
            mask: ["12", 1],
            grow_mask_by: 6,
          },
          _meta: { title: "VAE Encode For Outpainting" },
        };
        latentRef = ["5", 0];
        animaDenoise = Math.min(1, Math.max(0.05, request.denoise));
        animaCompositeRef = ["12", 1];
      } else {
        graph["12"] = {
          class_type: "ImageScale",
          inputs: {
            image: ["11", 0],
            upscale_method: "lanczos",
            width,
            height,
            crop: "center",
          },
          _meta: { title: "Resize Input Image" },
        };
        graph["5"] = {
          class_type: "VAEEncode",
          inputs: { pixels: ["12", 0], vae: ["29", 0] },
          _meta: { title: "VAE Encode" },
        };
        latentRef = ["5", 0];
        animaDenoise = Math.min(1, Math.max(0.05, request.denoise));
      }
    } else {
      graph["5"] = {
        class_type: "EmptyLatentImage",
        inputs: { width, height, batch_size: Math.max(1, request.batchSize) },
        _meta: { title: "Empty Latent Image" },
      };
      latentRef = ["5", 0];
    }

    graph["3"] = {
      class_type: "KSampler",
      inputs: {
        seed: resolvedSeed,
        steps: request.steps,
        cfg: request.cfg,
        sampler_name: request.sampler,
        scheduler: request.scheduler,
        denoise: animaDenoise,
        model: modelRef,
        positive: ["6", 0],
        negative: ["7", 0],
        latent_image: latentRef,
      },
      _meta: { title: "KSampler" },
    };

    graph["8"] = {
      class_type: "VAEDecode",
      inputs: { samples: ["3", 0], vae: ["29", 0] },
      _meta: { title: "VAE Decode" },
    };

    let animaOutputImageRef: [string, number] = ["8", 0];
    if (animaCompositeRef) {
      graph["16"] = {
        class_type: "ImageCompositeMasked",
        inputs: {
          destination: ["12", 0],
          source: ["8", 0],
          x: 0,
          y: 0,
          resize_source: false,
          mask: animaCompositeRef,
        },
        _meta: { title: "Composite Generated Subject Over Source" },
      };
      animaOutputImageRef = ["16", 0];
    }

    graph["9"] = {
      class_type: "SaveImage",
      inputs: { filename_prefix: filenamePrefix, images: animaOutputImageRef },
      _meta: { title: "Save Image" },
    };

    attachHiresFixPass({
      graph,
      template,
      request,
      resolvedSeed,
      baseWidth: width,
      baseHeight: height,
      modelRef,
      positiveRef: ["6", 0],
      negativeRef: ["7", 0],
      vaeRef: ["29", 0],
      supportsUpscaleModel,
    });

    return { template, resolvedSeed, graph };
  }

  if (template.id === "t2i_krea2_base" || template.id === "i2i_krea2_base") {
    const isImg2Img = template.id === "i2i_krea2_base";
    const qwenClip =
      availableModels.find(
        (m) =>
          m.category === "text_encoder" &&
          /qwen3vl[-_]4b/i.test(m.name)
      )?.relativePath ?? "qwen3vl_4b_fp8_scaled.safetensors";

    const aeVae =
      resolveRequestedVae(request, "krea2", availableModels) ??
      availableModels.find(
        (m) =>
          m.category === "vae" &&
          m.name.toLowerCase().includes("ae")
      )?.relativePath ??
      "ae.safetensors";

    const modelRecord = availableModels.find(
      (m) => m.relativePath === request.checkpoint || m.name === request.checkpoint
    );
    const isDiffusionModel = modelRecord?.category === "diffusion_model";
    const resolvedModelName = resolveModelRelativePath(request.checkpoint, availableModels);

    const graph: ComfyPromptGraph = {};

    if (isDiffusionModel) {
      graph["28"] = {
        class_type: "UNETLoader",
        inputs: { unet_name: resolvedModelName, weight_dtype: "default" },
        _meta: { title: "Load Krea 2 Diffusion Model" },
      };
    } else {
      graph["28"] = {
        class_type: "CheckpointLoaderSimple",
        inputs: { ckpt_name: resolvedModelName },
        _meta: { title: "Load Krea 2 Checkpoint" },
      };
    }

    graph["30"] = {
      class_type: "CLIPLoader",
      inputs: { clip_name: qwenClip, type: "krea2", device: "default" },
      _meta: { title: "Load Qwen3-VL-4B Text Encoder" },
    };

    graph["29"] = {
      class_type: "VAELoader",
      inputs: { vae_name: aeVae },
      _meta: { title: "Load AE VAE" },
    };

    let modelRef: [string, number] = ["28", 0];
    let clipRef: [string, number] = ["30", 0];

    request.loras.slice(0, template.maxLoras).forEach((lora, idx) => {
      const nodeId = `4${idx}`;
      const resolvedLoraName = resolveModelRelativePath(lora.name, availableModels);
      graph[nodeId] = {
        class_type: "LoraLoader",
        inputs: {
          lora_name: resolvedLoraName,
          strength_model: lora.strengthModel,
          strength_clip: lora.strengthClip,
          model: modelRef,
          clip: clipRef,
        },
        _meta: { title: `Krea 2 LoRA ${idx + 1}` },
      };
      modelRef = [nodeId, 0];
      clipRef = [nodeId, 1];
    });

    graph["6"] = {
      class_type: "CLIPTextEncode",
      inputs: { text: request.prompt, clip: clipRef },
      _meta: { title: "Positive Prompt" },
    };

    graph["7"] = {
      class_type: "CLIPTextEncode",
      inputs: {
        text: request.negativePrompt.trim() || "worst quality, low quality, blurry",
        clip: clipRef,
      },
      _meta: { title: "Negative Prompt" },
    };

    let latentRef: [string, number];
    let kreaDenoise = 1.0;

    if (isImg2Img) {
      if (!uploadedInputFilename) {
        throw new Error("Krea 2 image-to-image workflow requires an input image.");
      }
      graph["10"] = {
        class_type: "LoadImage",
        inputs: { image: uploadedInputFilename },
        _meta: { title: "Input Image" },
      };
      graph["11"] = {
        class_type: "ImageScale",
        inputs: {
          image: ["10", 0],
          upscale_method: "lanczos",
          width,
          height,
          crop: "center",
        },
        _meta: { title: "Resize Input Image" },
      };
      graph["12"] = {
        class_type: "VAEEncode",
        inputs: { pixels: ["11", 0], vae: ["29", 0] },
        _meta: { title: "VAE Encode Latent" },
      };
      latentRef = ["12", 0];
      kreaDenoise = Math.min(1, Math.max(0.05, request.denoise));
    } else {
      graph["5"] = {
        class_type: "EmptySD3LatentImage",
        inputs: { width, height, batch_size: 1 },
        _meta: { title: "Empty 16-Channel Latent" },
      };
      latentRef = ["5", 0];
    }

    graph["3"] = {
      class_type: "KSampler",
      inputs: {
        seed: resolvedSeed,
        steps: request.steps,
        cfg: request.cfg,
        sampler_name: request.sampler,
        scheduler: request.scheduler,
        denoise: kreaDenoise,
        model: modelRef,
        positive: ["6", 0],
        negative: ["7", 0],
        latent_image: latentRef,
      },
      _meta: { title: "KSampler" },
    };

    graph["8"] = {
      class_type: "VAEDecode",
      inputs: { samples: ["3", 0], vae: ["29", 0] },
      _meta: { title: "VAE Decode" },
    };

    graph["9"] = {
      class_type: "SaveImage",
      inputs: { filename_prefix: filenamePrefix, images: ["8", 0] },
      _meta: { title: "Save Image" },
    };

    attachHiresFixPass({
      graph,
      template,
      request,
      resolvedSeed,
      baseWidth: width,
      baseHeight: height,
      modelRef,
      positiveRef: ["6", 0],
      negativeRef: ["7", 0],
      vaeRef: ["29", 0],
      supportsUpscaleModel,
    });

    return { template, resolvedSeed, graph };
  }

  // Standard CheckpointLoaderSimple pipelines (SDXL / Illustrious / SD 1.5, txt2img & img2img)
  const resolvedCkptName = resolveModelRelativePath(request.checkpoint, availableModels);
  const graph: ComfyPromptGraph = {
    "4": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: resolvedCkptName },
      _meta: { title: "Load Checkpoint" },
    },
  };

  let modelRef: [string, number] = ["4", 0];
  let clipRef: [string, number] = ["4", 1];
  let vaeRef: [string, number] = ["4", 2];

  const baseArch = resolveArchitectureFor(request.checkpoint, availableModels);
  const standardVaeName = resolveRequestedVae(
    request,
    baseArch,
    availableModels
  );

  if (standardVaeName) {
    graph["10"] = {
      class_type: "VAELoader",
      inputs: { vae_name: standardVaeName },
      _meta: { title: "Load VAE" },
    };
    vaeRef = ["10", 0];
  }

  const effectiveMaxLoras =
    template.id === "t2i_illustrious_base" ||
    template.id === "i2i_illustrious_base" ||
    (baseArch === "illustrious" &&
      (template.id === "t2i_sdxl_base" || template.id === "i2i_sdxl_base"))
      ? 10
      : template.maxLoras;

  request.loras.slice(0, effectiveMaxLoras).forEach((lora, idx) => {
    const nodeId = `2${idx}`;
    graph[nodeId] = {
      class_type: "LoraLoader",
      inputs: {
        lora_name: lora.name,
        strength_model: lora.strengthModel,
        strength_clip: lora.strengthClip,
        model: modelRef,
        clip: clipRef,
      },
      _meta: { title: `LoRA ${idx + 1}` },
    };
    modelRef = [nodeId, 0];
    clipRef = [nodeId, 1];
  });

  graph["6"] = {
    class_type: "CLIPTextEncode",
    inputs: { text: request.prompt, clip: clipRef },
    _meta: { title: "Positive Prompt" },
  };
  graph["7"] = {
    class_type: "CLIPTextEncode",
    inputs: { text: request.negativePrompt || "", clip: clipRef },
    _meta: { title: "Negative Prompt" },
  };

  let latentRef: [string, number];
  let denoise = 1.0;
  let compositeMaskRef: [string, number] | null = null;

  const hasOutpaintPadding = Boolean(
    request.outpaintPadding &&
      ((request.outpaintPadding.top ?? 0) > 0 ||
        (request.outpaintPadding.bottom ?? 0) > 0 ||
        (request.outpaintPadding.left ?? 0) > 0 ||
        (request.outpaintPadding.right ?? 0) > 0)
  );

  if (template.mode === "img2img") {
    if (!uploadedInputFilename) {
      throw new Error("Input image must be uploaded to ComfyUI before building img2img graph.");
    }
    graph["11"] = {
      class_type: "LoadImage",
      inputs: { image: uploadedInputFilename },
      _meta: { title: "Load Input Image" },
    };

    if (uploadedMaskFilename) {
      // --- NATIVE INPAINTING ---
      graph["12"] = {
        class_type: "ImageScale",
        inputs: {
          image: ["11", 0],
          upscale_method: "lanczos",
          width,
          height,
          crop: "center",
        },
        _meta: { title: "Resize Input Image" },
      };
      graph["13"] = {
        class_type: "LoadImage",
        inputs: { image: uploadedMaskFilename },
        _meta: { title: "Load Inpaint Mask Image" },
      };
      graph["14"] = {
        class_type: "ImageScale",
        inputs: {
          image: ["13", 0],
          upscale_method: "nearest-exact",
          width,
          height,
          crop: "center",
        },
        _meta: { title: "Resize Mask to Match Canvas" },
      };
      graph["15"] = {
        class_type: "ImageToMask",
        inputs: {
          image: ["14", 0],
          channel: "red",
        },
        _meta: { title: "Extract Inpaint Mask Channel" },
      };
      graph["5"] = {
        class_type: "VAEEncodeForInpaint",
        inputs: {
          pixels: ["12", 0],
          vae: vaeRef,
          mask: ["15", 0],
          grow_mask_by: request.maskGrowBy ?? 6,
        },
        _meta: { title: "VAE Encode For Inpainting" },
      };
      latentRef = ["5", 0];
      denoise = Math.min(1, Math.max(0.05, request.denoise));
      compositeMaskRef = ["15", 0];
    } else if (hasOutpaintPadding) {
      // --- NATIVE OUTPAINTING ---
      const padLeft = snapDimension(request.outpaintPadding?.left ?? 0, 8, 0, 4096);
      const padRight = snapDimension(request.outpaintPadding?.right ?? 0, 8, 0, 4096);
      const padTop = snapDimension(request.outpaintPadding?.top ?? 0, 8, 0, 4096);
      const padBottom = snapDimension(request.outpaintPadding?.bottom ?? 0, 8, 0, 4096);

      graph["12"] = {
        class_type: "ImagePadForOutpaint",
        inputs: {
          image: ["11", 0],
          left: padLeft,
          top: padTop,
          right: padRight,
          bottom: padBottom,
          feathering: 40,
        },
        _meta: { title: "Pad Image for Outpainting" },
      };
      graph["5"] = {
        class_type: "VAEEncodeForInpaint",
        inputs: {
          pixels: ["12", 0],
          vae: vaeRef,
          mask: ["12", 1],
          grow_mask_by: 6,
        },
        _meta: { title: "VAE Encode For Outpainting" },
      };
      latentRef = ["5", 0];
      denoise = Math.min(1, Math.max(0.05, request.denoise));
      compositeMaskRef = ["12", 1];
    } else {
      graph["12"] = {
        class_type: "ImageScale",
        inputs: {
          image: ["11", 0],
          upscale_method: "lanczos",
          width,
          height,
          crop: "center",
        },
        _meta: { title: "Resize Input Image" },
      };
      graph["5"] = {
        class_type: "VAEEncode",
        inputs: { pixels: ["12", 0], vae: vaeRef },
        _meta: { title: "VAE Encode" },
      };
      latentRef = ["5", 0];
      denoise = Math.min(1, Math.max(0.05, request.denoise));
    }
  } else {
    graph["5"] = {
      class_type: "EmptyLatentImage",
      inputs: { width, height, batch_size: Math.max(1, request.batchSize) },
      _meta: { title: "Empty Latent Image" },
    };
    latentRef = ["5", 0];
  }

  graph["3"] = {
    class_type: "KSampler",
    inputs: {
      seed: resolvedSeed,
      steps: request.steps,
      cfg: request.cfg,
      sampler_name: request.sampler,
      scheduler: request.scheduler,
      denoise,
      model: modelRef,
      positive: ["6", 0],
      negative: ["7", 0],
      latent_image: latentRef,
    },
    _meta: { title: "KSampler" },
  };

  graph["8"] = {
    class_type: "VAEDecode",
    inputs: { samples: ["3", 0], vae: vaeRef },
    _meta: { title: "VAE Decode" },
  };

  let outputImageRef: [string, number] = ["8", 0];
  if (compositeMaskRef) {
    graph["16"] = {
      class_type: "ImageCompositeMasked",
      inputs: {
        destination: ["12", 0],
        source: ["8", 0],
        x: 0,
        y: 0,
        resize_source: false,
        mask: compositeMaskRef,
      },
      _meta: { title: "Composite Generated Subject Over Source" },
    };
    outputImageRef = ["16", 0];
  }

  graph["9"] = {
    class_type: "SaveImage",
    inputs: { filename_prefix: filenamePrefix, images: outputImageRef },
    _meta: { title: "Save Image" },
  };

  attachHiresFixPass({
    graph,
    template,
    request,
    resolvedSeed,
    baseWidth: width,
    baseHeight: height,
    modelRef,
    positiveRef: ["6", 0],
    negativeRef: ["7", 0],
    vaeRef,
    supportsUpscaleModel,
  });

  return { template, resolvedSeed, graph };
}

