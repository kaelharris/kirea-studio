import type { CuratedModelCatalogItem, StudioPreset } from "./types";

export const STUDIO_PRESETS: StudioPreset[] = [
  {
    id: "preset-cinematic-editorial",
    title: "Cinematic Editorial Portrait",
    category: "Photography",
    description: "Balanced studio portrait with sculpted rim light and filmic depth.",
    mode: "txt2img",
    recommendedArch: ["sdxl", "illustrious", "sd15"],
    aspectRatio: "3:4",
    prompt:
      "editorial studio portrait, sculpted softbox key light, subtle cyan rim light, natural skin texture, shallow depth of field, 85mm lens, crisp focus, high dynamic range",
    negativePrompt:
      "blurry, oversaturated, plastic skin, distorted anatomy, watermark, text, lowres, artifacts",
    steps: 26,
    cfg: 6.5,
    sampler: "dpmpp_2m",
    scheduler: "karras",
  },
  {
    id: "preset-anime-keyvisual",
    title: "Anime Key Visual",
    category: "Illustration",
    description: "Crisp cel-shaded illustration tuned for Illustrious & Anime SDXL checkpoints.",
    mode: "txt2img",
    recommendedArch: ["illustrious", "sdxl"],
    aspectRatio: "2:3",
    prompt:
      "masterpiece anime key visual, dynamic composition, twilight city skyline, expressive lighting, clean linework, rich atmospheric perspective, painterly sky",
    negativePrompt:
      "lowres, bad anatomy, extra digits, blurry, monochrome, flat lighting, watermark, signature",
    steps: 24,
    cfg: 6.0,
    sampler: "euler_ancestral",
    scheduler: "normal",
  },
  {
    id: "preset-product-glass",
    title: "Industrial Product Studio",
    category: "Design",
    description: "Clean minimalist tabletop lighting for industrial design concepts.",
    mode: "txt2img",
    recommendedArch: ["sdxl", "sd15", "z_image"],
    aspectRatio: "1:1",
    prompt:
      "minimalist industrial design prototype made of brushed anodized aluminum and smoked borosilicate glass on dark slate plinth, soft studio reflections, commercial photography",
    negativePrompt:
      "cluttered background, harsh noise, distorted geometry, text, logo, low quality",
    steps: 22,
    cfg: 6.5,
    sampler: "euler",
    scheduler: "normal",
  },
  {
    id: "preset-landscape-matte",
    title: "Architectural Matte Concept",
    category: "Environment",
    description: "Wide 16:9 environmental concept with crisp scale and atmosphere.",
    mode: "txt2img",
    recommendedArch: ["sdxl", "illustrious", "z_image"],
    aspectRatio: "16:9",
    prompt:
      "wide angle architectural concept art of a cliffside brutalist observatory overlooking misty alpine fjords at blue hour, warm interior windows, cinematic scale",
    negativePrompt:
      "blurry, oversaturated, distorted horizon, jpeg artifacts, watermark, cropped",
    steps: 28,
    cfg: 7.0,
    sampler: "dpmpp_2m",
    scheduler: "karras",
  },
  {
    id: "preset-img2img-relight",
    title: "Studio Relight & Polish",
    category: "Image-to-Image",
    description: "Refine composition and lighting of an existing input image while preserving layout.",
    mode: "img2img",
    recommendedArch: ["sdxl", "illustrious", "sd15"],
    aspectRatio: "1:1",
    prompt:
      "enhanced lighting, crisp micro-detail, balanced filmic contrast, coherent materials, clean rendering",
    negativePrompt:
      "blurry, muddy colors, artifacts, distorted shapes, watermark",
    steps: 22,
    cfg: 6.0,
    sampler: "dpmpp_2m",
    scheduler: "karras",
    denoise: 0.48,
  },
];

export const PROMPT_SNIPPETS: Array<{ label: string; category: string; text: string }> = [
  {
    label: "Filmic Key Light",
    category: "Lighting",
    text: "soft directional key light, subtle rim illumination, rich tonal contrast",
  },
  {
    label: "85mm Studio Lens",
    category: "Camera",
    text: "85mm f/1.8 lens, natural bokeh, crisp focal plane, zero chromatic aberration",
  },
  {
    label: "Clean Anime Lineart",
    category: "Illustration",
    text: "clean crisp linework, vibrant cel shading, expressive atmospheric lighting",
  },
  {
    label: "Negative Quality Guard",
    category: "Negative",
    text: "lowres, blurry, deformed anatomy, watermark, signature, jpeg artifacts, extra limbs",
  },
];

// Official, verified HuggingFace repositories (user explicitly confirms size & license before downloading)
export const CURATED_MODEL_CATALOG: CuratedModelCatalogItem[] = [
  {
    id: "sd-1-5-pruned-emaonly",
    name: "Stable Diffusion 1.5 (FP16 Pruned EMA)",
    fileName: "v1-5-pruned-emaonly-fp16.safetensors",
    category: "checkpoint",
    architecture: "sd15",
    sizeBytes: 2132625894,
    sha256: "b6af0efeb1756f54a3ab67a7e07e5b739c3c4f69a2c4a6b0d5b9a3d0f9f50c2b",
    sourceName: "Hugging Face (Comfy-Org / RunwayML)",
    sourceUrl: "https://huggingface.co/Comfy-Org/stable-diffusion-v1-5-archive",
    downloadUrl:
      "https://huggingface.co/Comfy-Org/stable-diffusion-v1-5-archive/resolve/main/v1-5-pruned-emaonly-fp16.safetensors",
    licenseName: "CreativeML Open RAIL-M",
    licenseUrl: "https://huggingface.co/spaces/CompVis/stable-diffusion-license",
    description: "Fast, lightweight 512px baseline checkpoint ideal for quick iteration.",
    targetSubdir: "checkpoints",
  },
  {
    id: "sdxl-vae-fp16-fix",
    name: "SDXL VAE FP16 Fix",
    fileName: "sdxl_vae_fp16fix.safetensors",
    category: "vae",
    architecture: "sdxl",
    sizeBytes: 334641162,
    sha256: "",
    sourceName: "Hugging Face (madebyollin/sdxl-vae-fp16-fix)",
    sourceUrl: "https://huggingface.co/madebyollin/sdxl-vae-fp16-fix",
    downloadUrl:
      "https://huggingface.co/madebyollin/sdxl-vae-fp16-fix/resolve/main/sdxl.vae.safetensors",
    licenseName: "MIT",
    licenseUrl: "https://huggingface.co/madebyollin/sdxl-vae-fp16-fix",
    description: "Numerical stability VAE for SDXL in FP16 without NaN artifacts.",
    targetSubdir: "vae",
  },
  {
    id: "realesrgan-x4plus",
    name: "RealESRGAN x4plus Upscaler",
    fileName: "RealESRGAN_x4plus.pth",
    category: "upscale",
    architecture: "unknown",
    sizeBytes: 67040989,
    sha256: "",
    sourceName: "GitHub Releases (xinntao/Real-ESRGAN)",
    sourceUrl: "https://github.com/xinntao/Real-ESRGAN",
    downloadUrl:
      "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth",
    licenseName: "BSD-3-Clause",
    licenseUrl: "https://github.com/xinntao/Real-ESRGAN/blob/master/LICENSE",
    description: "General photographic 4x upscaler model.",
    targetSubdir: "upscale_models",
  },
];

