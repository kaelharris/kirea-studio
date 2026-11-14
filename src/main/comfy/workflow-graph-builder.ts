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
import { findPresetUpscaler } from "../../shared/model-utils";
import type { ComfyPromptGraph } from "./comfy-types";
import {
  ANIMA_DEFAULT_NEGATIVE,
  getWorkflowById,
  isAnimaWorkflow,
} from "./workflow-templates";
import {
  clampRefinerCreativity,
  resolveArchitectureFor,
  resolveRefinerCheckpoint,
  resolveRequestedVae,
} from "./workflow-validation";

export interface BuildWorkflowParams {
  request: GenerationRequest;
  uploadedInputFilename?: string;
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
      availableModels.find((m) => m.category === "vae" && m.name.toLowerCase().includes("ae."))
        ?.relativePath ?? "ae.safetensors";

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
  const graph: ComfyPromptGraph = {
    "4": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: request.checkpoint },
      _meta: { title: "Load Checkpoint" },
    },
  };

  let modelRef: [string, number] = ["4", 0];
  let clipRef: [string, number] = ["4", 1];
  let vaeRef: [string, number] = ["4", 2];

  const standardVaeName = resolveRequestedVae(
    request,
    resolveArchitectureFor(request.checkpoint, availableModels),
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

  request.loras.slice(0, template.maxLoras).forEach((lora, idx) => {
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

  if (template.mode === "img2img") {
    if (!uploadedInputFilename) {
      throw new Error("Input image must be uploaded to ComfyUI before building img2img graph.");
    }
    graph["11"] = {
      class_type: "LoadImage",
      inputs: { image: uploadedInputFilename },
      _meta: { title: "Load Input Image" },
    };
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
    vaeRef,
    supportsUpscaleModel,
  });

  return { template, resolvedSeed, graph };
}

