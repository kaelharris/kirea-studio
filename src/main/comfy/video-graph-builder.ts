import type {
  ModelRecord,
  VideoContainerFormat,
  VideoGenerationSettings,
  VideoModelRequirement,
  VideoWorkflowSpec,
  WorkflowTemplate,
} from "../../shared/types";
import { resolveVideoFrameCount } from "../../shared/video-utils";
import type { ComfyPromptGraph } from "./comfy-types";

export interface ResolvedVideoCompanion {
  requirement: VideoModelRequirement;
  resolvedName: string;
  installed: boolean;
}

export interface ResolvedVideoModels {
  textEncoder: string | null;
  vae: string | null;
  companions: ResolvedVideoCompanion[];
  missing: VideoModelRequirement[];
}

export function resolveVideoModels(
  template: WorkflowTemplate,
  availableModels: ModelRecord[]
): ResolvedVideoModels {
  const requirements = template.video?.companionModels ?? [];
  const companions: ResolvedVideoCompanion[] = requirements.map((requirement) => {
    const wanted = requirement.fileName.toLowerCase();
    const match = availableModels.find(
      (model) =>
        model.category === requirement.category &&
        (model.relativePath.toLowerCase() === wanted || model.name.toLowerCase() === wanted)
    );
    return {
      requirement,
      resolvedName: match?.relativePath ?? requirement.fileName,
      installed: Boolean(match),
    };
  });

  return {
    textEncoder:
      companions.find((c) => c.requirement.category === "text_encoder")?.resolvedName ?? null,
    vae: companions.find((c) => c.requirement.category === "vae")?.resolvedName ?? null,
    companions,
    missing: companions.filter((c) => !c.installed).map((c) => c.requirement),
  };
}

export function resolveVideoFormat(
  spec: VideoWorkflowSpec,
  requested: VideoContainerFormat | undefined
): VideoContainerFormat {
  if (requested && spec.formats.includes(requested)) return requested;
  return spec.formats[0] ?? "mp4";
}

export function resolveVideoFrames(
  request: { video?: { durationSeconds: number } },
  spec: VideoWorkflowSpec
): ReturnType<typeof resolveVideoFrameCount> {
  const requestedDuration =
    request.video && Number.isFinite(request.video.durationSeconds)
      ? request.video.durationSeconds
      : spec.defaultFrameCount / spec.fps;
  return resolveVideoFrameCount(requestedDuration, spec);
}

export interface VideoGraphParams {
  template: WorkflowTemplate;
  request: {
    checkpoint: string;
    prompt: string;
    negativePrompt: string;
    steps: number;
    cfg: number;
    sampler: string;
    scheduler: string;
    width: number;
    height: number;
    batchSize: number;
    video?: VideoGenerationSettings;
  };
  uploadedInputFilename?: string;
  availableModels: ModelRecord[];
  filenamePrefix: string;
  resolvedSeed: number;
  width: number;
  height: number;
}

function saveVideoNode(
  graph: ComfyPromptGraph,
  id: string,
  videoRef: [string, number],
  filenamePrefix: string,
  format: VideoContainerFormat
): void {
  graph[id] = {
    class_type: "SaveVideo",
    inputs: {
      video: videoRef,
      filename_prefix: filenamePrefix,
      format,
      codec: "auto",
    },
    _meta: { title: "Save Video" },
  };
}

export function buildVideoPromptGraph(params: VideoGraphParams): ComfyPromptGraph {
  const {
    template,
    request,
    uploadedInputFilename,
    availableModels,
    filenamePrefix,
    resolvedSeed,
    width,
    height,
  } = params;
  const spec = template.video;
  if (!spec) {
    throw new Error(`Workflow '${template.id}' is not a video workflow.`);
  }

  const models = resolveVideoModels(template, availableModels);
  if (!models.textEncoder) {
    throw new Error(`Workflow '${template.name}' requires a text encoder model.`);
  }
  const frames = resolveVideoFrames(request, spec);
  const format = resolveVideoFormat(spec, request.video?.format);
  const batchSize = Math.max(1, Math.floor(request.batchSize || 1));

  if (spec.family === "wan21_t2v") {
    if (!models.vae) {
      throw new Error(`Workflow '${template.name}' requires a Wan VAE model.`);
    }
    const graph: ComfyPromptGraph = {
      "1": {
        class_type: "UNETLoader",
        inputs: { unet_name: request.checkpoint, weight_dtype: "default" },
        _meta: { title: "Load Wan Diffusion Model" },
      },
      "2": {
        class_type: "CLIPLoader",
        inputs: { clip_name: models.textEncoder, type: "wan", device: "default" },
        _meta: { title: "Load UMT5-XXL Text Encoder" },
      },
      "3": {
        class_type: "VAELoader",
        inputs: { vae_name: models.vae },
        _meta: { title: "Load Wan VAE" },
      },
      "4": {
        class_type: "ModelSamplingSD3",
        inputs: { shift: 8.0, model: ["1", 0] },
        _meta: { title: "Wan Sampling Shift" },
      },
      "5": {
        class_type: "CLIPTextEncode",
        inputs: { text: request.prompt, clip: ["2", 0] },
        _meta: { title: "Positive Prompt" },
      },
      "6": {
        class_type: "CLIPTextEncode",
        inputs: { text: request.negativePrompt || "", clip: ["2", 0] },
        _meta: { title: "Negative Prompt" },
      },
      "7": {
        class_type: "EmptyHunyuanLatentVideo",
        inputs: {
          width,
          height,
          length: frames.frameCount,
          batch_size: batchSize,
        },
        _meta: { title: "Empty Video Latent" },
      },
      "8": {
        class_type: "KSampler",
        inputs: {
          seed: resolvedSeed,
          steps: request.steps,
          cfg: request.cfg,
          sampler_name: request.sampler,
          scheduler: request.scheduler,
          denoise: 1.0,
          model: ["4", 0],
          positive: ["5", 0],
          negative: ["6", 0],
          latent_image: ["7", 0],
        },
        _meta: { title: "Video KSampler" },
      },
      "9": {
        class_type: "VAEDecode",
        inputs: { samples: ["8", 0], vae: ["3", 0] },
        _meta: { title: "Decode Video Frames" },
      },
      "10": {
        class_type: "CreateVideo",
        inputs: { images: ["9", 0], fps: spec.fps },
        _meta: { title: "Assemble Video" },
      },
    };
    saveVideoNode(graph, "11", ["10", 0], filenamePrefix, format);
    return graph;
  }

  // LTX-Video: one checkpoint supplies UNET + VAE; T5-XXL is loaded separately.
  const graph: ComfyPromptGraph = {
    "1": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: request.checkpoint },
      _meta: { title: "Load LTX-Video Checkpoint" },
    },
    "2": {
      class_type: "CLIPLoader",
      inputs: { clip_name: models.textEncoder, type: "ltxv", device: "default" },
      _meta: { title: "Load T5-XXL Text Encoder" },
    },
    "3": {
      class_type: "CLIPTextEncode",
      inputs: { text: request.prompt, clip: ["2", 0] },
      _meta: { title: "Positive Prompt" },
    },
    "4": {
      class_type: "CLIPTextEncode",
      inputs: { text: request.negativePrompt || "", clip: ["2", 0] },
      _meta: { title: "Negative Prompt" },
    },
  };

  let positiveRef: [string, number] = ["3", 0];
  let negativeRef: [string, number] = ["4", 0];
  let latentRef: [string, number];

  if (template.mode === "i2v") {
    if (!uploadedInputFilename) {
      throw new Error("Input image must be uploaded to ComfyUI before building image-to-video graph.");
    }
    graph["5"] = {
      class_type: "LoadImage",
      inputs: { image: uploadedInputFilename },
      _meta: { title: "Load Input Image" },
    };
    graph["6"] = {
      class_type: "ImageScale",
      inputs: {
        image: ["5", 0],
        upscale_method: "lanczos",
        width,
        height,
        crop: "center",
      },
      _meta: { title: "Resize Input Image" },
    };
    graph["7"] = {
      class_type: "LTXVImgToVideo",
      inputs: {
        positive: positiveRef,
        negative: negativeRef,
        vae: ["1", 2],
        image: ["6", 0],
        width,
        height,
        length: frames.frameCount,
        batch_size: batchSize,
        strength: 1.0,
      },
      _meta: { title: "LTXV Image Conditioning" },
    };
    positiveRef = ["7", 0];
    negativeRef = ["7", 1];
    latentRef = ["7", 2];
    graph["8"] = {
      class_type: "KSampler",
      inputs: {
        seed: resolvedSeed,
        steps: request.steps,
        cfg: request.cfg,
        sampler_name: request.sampler,
        scheduler: request.scheduler,
        denoise: 1.0,
        model: ["1", 0],
        positive: positiveRef,
        negative: negativeRef,
        latent_image: latentRef,
      },
      _meta: { title: "Video KSampler" },
    };
    graph["9"] = {
      class_type: "VAEDecode",
      inputs: { samples: ["8", 0], vae: ["1", 2] },
      _meta: { title: "Decode Video Frames" },
    };
    graph["10"] = {
      class_type: "CreateVideo",
      inputs: { images: ["9", 0], fps: spec.fps },
      _meta: { title: "Assemble Video" },
    };
    saveVideoNode(graph, "11", ["10", 0], filenamePrefix, format);
    return graph;
  }

  graph["5"] = {
    class_type: "EmptyLTXVLatentVideo",
    inputs: {
      width,
      height,
      length: frames.frameCount,
      batch_size: batchSize,
    },
    _meta: { title: "Empty Video Latent" },
  };
  graph["6"] = {
    class_type: "LTXVConditioning",
    inputs: {
      positive: positiveRef,
      negative: negativeRef,
      frame_rate: spec.fps,
    },
    _meta: { title: "LTXV Frame Rate Conditioning" },
  };
  graph["7"] = {
    class_type: "KSampler",
    inputs: {
      seed: resolvedSeed,
      steps: request.steps,
      cfg: request.cfg,
      sampler_name: request.sampler,
      scheduler: request.scheduler,
      denoise: 1.0,
      model: ["1", 0],
      positive: ["6", 0],
      negative: ["6", 1],
      latent_image: ["5", 0],
    },
    _meta: { title: "Video KSampler" },
  };
  graph["8"] = {
    class_type: "VAEDecode",
    inputs: { samples: ["7", 0], vae: ["1", 2] },
    _meta: { title: "Decode Video Frames" },
  };
  graph["9"] = {
    class_type: "CreateVideo",
    inputs: { images: ["8", 0], fps: spec.fps },
    _meta: { title: "Assemble Video" },
  };
  saveVideoNode(graph, "10", ["9", 0], filenamePrefix, format);
  return graph;
}
