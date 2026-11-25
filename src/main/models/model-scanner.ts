import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  AppSettings,
  ModelArchitecture,
  ModelCategory,
  ModelDiscovery,
  ModelRecord,
  ModelSource,
} from "../../shared/types";
import { inferModelArchitecture } from "../../shared/aspect-ratios";
import { normalizeModelTitle } from "../../shared/model-utils";
import { WORKFLOW_TEMPLATES } from "../comfy/workflow-registry";
import type { ComfyApiClient } from "../comfy/comfy-adapter";
import type { StudioLogger } from "../logger";

const ACCEPTED_MODEL_EXTS = new Set([
  ".safetensors",
  ".ckpt",
  ".pt",
  ".pth",
  ".bin",
  ".gguf",
]);

const INCOMPLETE_EXTS = new Set([".part", ".tmp", ".crdownload"]);

const PREVIEW_EXTS = [".png", ".jpg", ".jpeg", ".webp"];
const SIDECAR_SUFFIXES = [".hf.json", ".json", ".civitai.info"];

export interface DiscoveredModelMetadata {
  description: string | null;
  baseModel: string | null;
  triggerWords: string[];
  previewPath: string | null;
  source: ModelSource | null;
  embeddedTitle: string | null;
}

const CATEGORY_TO_FOLDERS: Record<ModelCategory, string[]> = {
  checkpoint: ["checkpoints"],
  lora: ["loras"],
  vae: ["vae"],
  embedding: ["embeddings"],
  controlnet: ["controlnet"],
  upscale: ["upscale_models"],
  diffusion_model: ["diffusion_models", "unet"],
  text_encoder: ["text_encoders", "clip"],
};

const FOLDER_TO_CATEGORY: Record<string, ModelCategory> = {
  checkpoints: "checkpoint",
  loras: "lora",
  vae: "vae",
  embeddings: "embedding",
  controlnet: "controlnet",
  upscale_models: "upscale",
  diffusion_models: "diffusion_model",
  unet: "diffusion_model",
  text_encoders: "text_encoder",
  clip: "text_encoder",
};

const COMFY_LIVE_MODEL_FOLDERS: Array<{ category: ModelCategory; folder: string }> = [
  { category: "checkpoint", folder: "checkpoints" },
  { category: "lora", folder: "loras" },
  { category: "vae", folder: "vae" },
  { category: "embedding", folder: "embeddings" },
  { category: "controlnet", folder: "controlnet" },
  { category: "upscale", folder: "upscale_models" },
  { category: "diffusion_model", folder: "diffusion_models" },
  { category: "text_encoder", folder: "text_encoders" },
];

export interface ParsedExtraModelPaths {
  byCategory: Record<ModelCategory, string[]>;
}

/**
 * Lightweight, read-only YAML subset parser for ComfyUI `extra_model_paths.yaml`
 * and Comfy Desktop `shared_model_paths.yaml`. Handles `base_path`, single-line
 * values, and multiline `|` path blocks without mutating external files.
 */
export function parseComfyExtraModelPathsYaml(
  yamlContent: string,
  yamlFileDir: string
): ParsedExtraModelPaths {
  const byCategory: Record<ModelCategory, string[]> = {
    checkpoint: [],
    lora: [],
    vae: [],
    embedding: [],
    controlnet: [],
    upscale: [],
    diffusion_model: [],
    text_encoder: [],
  };

  let currentSection = "";
  let basePath = yamlFileDir;
  let activeKey: string | null = null;
  let activeBlockIndent = -1;

  const lines = yamlContent.split(/\r?\n/);

  const pushPath = (folderKey: string, rawVal: string): void => {
    const cleaned = rawVal.trim().replace(/^["']|["']$/g, "");
    if (!cleaned || cleaned === "|") return;
    const category = FOLDER_TO_CATEGORY[folderKey];
    if (!category) return;
    const resolved = path.isAbsolute(cleaned) ? path.normalize(cleaned) : path.resolve(basePath, cleaned);
    if (!byCategory[category].includes(resolved)) {
      byCategory[category].push(resolved);
    }
  };

  for (const rawLine of lines) {
    const withoutComment = rawLine.replace(/(^|\s)#.*$/, "");
    if (!withoutComment.trim()) continue;

    const indentMatch = withoutComment.match(/^(\s*)/);
    const indent = indentMatch?.[1] ? indentMatch[1].length : 0;
    const trimmed = withoutComment.trim();

    if (activeKey && activeBlockIndent >= 0 && indent > activeBlockIndent) {
      pushPath(activeKey, trimmed.replace(/^-\s*/, ""));
      continue;
    }
    activeKey = null;
    activeBlockIndent = -1;

    if (indent === 0 && trimmed.endsWith(":") && !trimmed.includes(" ")) {
      currentSection = trimmed.slice(0, -1).trim();
      basePath = yamlFileDir;
      continue;
    }

    if (!currentSection) {
      // Allow top-level key mappings too
    }

    const kvMatch = trimmed.match(/^([A-Za-z0-9_]+)\s*:\s*(.*)$/);
    if (!kvMatch || !kvMatch[1]) continue;
    const key = kvMatch[1].toLowerCase();
    const val = (kvMatch[2] ?? "").trim();

    if (key === "base_path") {
      const cleanedBase = val.replace(/^["']|["']$/g, "");
      if (cleanedBase) {
        basePath = path.isAbsolute(cleanedBase)
          ? path.normalize(cleanedBase)
          : path.resolve(yamlFileDir, cleanedBase);
      }
      continue;
    }

    if (key in FOLDER_TO_CATEGORY) {
      if (val === "|" || val === "|-" || val === ">") {
        activeKey = key;
        activeBlockIndent = indent;
      } else if (val) {
        pushPath(key, val);
      }
    }
  }

  return { byCategory };
}

function getCompatibleWorkflowIds(category: ModelCategory, arch: ModelArchitecture): string[] {
  if (arch === "ltx_video") {
    return category === "checkpoint" ? ["t2v_ltx_2b", "i2v_ltx_2b"] : [];
  }
  if (arch === "wan_video") {
    return category === "diffusion_model" || category === "checkpoint"
      ? ["t2v_wan21_1_3b", "t2v_wan21_14b"]
      : [];
  }

  if (category === "checkpoint") {
    if (arch === "anima") {
      return ["t2i_anima_base", "i2i_anima_base"];
    }
    if (arch === "krea2") {
      return ["t2i_krea2_base", "i2i_krea2_base"];
    }
    return WORKFLOW_TEMPLATES.filter(
      (wf) =>
        wf.mode !== "upscale" &&
        !wf.video &&
        wf.id !== "t2i_z_image_turbo" &&
        wf.id !== "t2i_anima_base" &&
        wf.id !== "i2i_anima_base" &&
        wf.id !== "t2i_krea2_base" &&
        wf.id !== "i2i_krea2_base" &&
        (arch === "unknown"
          ? wf.supportedArchitectures.includes("unknown")
          : wf.supportedArchitectures.includes(arch))
    ).map((wf) => wf.id);
  }

  if (category === "diffusion_model") {
    if (arch === "z_image") {
      return ["t2i_z_image_turbo"];
    }
    if (arch === "anima") {
      return ["t2i_anima_base", "i2i_anima_base"];
    }
    if (arch === "krea2") {
      return ["t2i_krea2_base", "i2i_krea2_base"];
    }
    if (arch === "moss_image") {
      return WORKFLOW_TEMPLATES.filter((wf) =>
        wf.supportedArchitectures.includes("moss_image")
      ).map((wf) => wf.id);
    }
    return [];
  }

  if (category === "upscale") {
    return ["upscale_model_v1", "upscale_refiner_v1"];
  }

  if (category === "lora" || category === "vae") {
    return WORKFLOW_TEMPLATES.filter(
      (wf) =>
        wf.mode !== "upscale" &&
        !wf.video &&
        (category === "vae" || wf.supportsLora) &&
        (arch === "unknown" ? true : wf.supportedArchitectures.includes(arch))
    ).map((wf) => wf.id);
  }

  return [];
}

/**
 * Reads only the safetensors header JSON and classifies the architecture from
 * tensor key signatures. This catches models whose filenames hide the family
 * (e.g. atomico/dinamus Anima merges) without loading any tensor data.
 */
export function sniffSafetensorsArchitecture(filePath: string): ModelArchitecture | null {
  if (path.extname(filePath).toLowerCase() !== ".safetensors") return null;

  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, "r");
    const lengthBuffer = Buffer.alloc(8);
    fs.readSync(fd, lengthBuffer, 0, 8, 0);
    const headerLength = Number(lengthBuffer.readBigUInt64LE(0));
    if (!Number.isFinite(headerLength) || headerLength <= 1 || headerLength > 64 * 1024 * 1024) {
      return null;
    }
    const readLength = Math.min(headerLength, 8 * 1024 * 1024);
    const headerBuffer = Buffer.alloc(readLength);
    fs.readSync(fd, headerBuffer, 0, readLength, 8);
    return classifySafetensorsHeader(headerBuffer.toString("utf8").toLowerCase());
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore
      }
    }
  }
}

function classifySafetensorsHeader(header: string): ModelArchitecture | null {
  if (
    header.includes('modelspec.architecture":"moss_image') ||
    header.includes('modelspec.architecture":"moss') ||
    header.includes('"image_model": "moss_image"') ||
    header.includes('"image_model":"moss_image"') ||
    (header.includes("shared_block_modulation") &&
      (header.includes("layers.0.proj.ffn_up_gate") ||
        header.includes("layers.0.proj.q") ||
        header.includes("final_linear_video"))) ||
    (header.includes("video_embedder") &&
      (header.includes("layers.0.proj.q.lora_") || header.includes("layers.0.proj.ffn_up_gate.lora_"))) ||
    header.includes("layers.0.proj.q.lora_") ||
    header.includes("layers.0.proj.ffn_up_gate.lora_") ||
    header.includes(".layers.0.proj.q.")
  ) {
    return "moss_image";
  }

  if (
    header.includes('modelspec.architecture":"anima') ||
    header.includes("networks.lora_anima")
  ) {
    return "anima";
  }

  if (
    header.includes("final_linear_video") ||
    header.includes("final_norm_video") ||
    header.includes("wan2.1") ||
    header.includes("wan_video")
  ) {
    return "wan_video";
  }

  const hasAnimaAdapter =
    header.includes("adaln_modulation_cross_attn") ||
    header.includes("llm_adapter.blocks") ||
    header.includes("lora_unet_blocks_0_adaln_modulation") ||
    /lora_unet_blocks_\d+_adaln_modulation/.test(header);
  if (hasAnimaAdapter) return "anima";

  const hasKrea2Signature =
    (header.includes("attn.gate") || header.includes("attn_gate")) &&
    header.includes("blocks");
  if (hasKrea2Signature) return "krea2";

  // Anima DiT LoRAs use flat `lora_unet_blocks_N_cross_attn_*` keys, and
  // Anima text-encoder LoRAs target the LLM adapter's `_layers_N_mlp_*_proj`.
  if (
    /lora_unet_blocks_\d+_cross_attn_/.test(header) ||
    /lora_te\d?_layers_\d+_(?:mlp_(?:down|gate|up)_proj|self_attn_o_proj)/.test(header)
  ) {
    return "anima";
  }

  const hasZImageSignature =
    /lora_unet_layers_\d+_adaln_modulation/.test(header) ||
    header.includes(".layers.0.adaln_modulation") ||
    header.includes(".layers.1.adaln_modulation") ||
    (header.includes("context_refiner") && header.includes("cap_embedder")) ||
    (header.includes("noise_refiner") && header.includes("x_embedder"));
  if (hasZImageSignature) return "z_image";

  if (
    header.includes("double_blocks.0") ||
    header.includes("single_blocks.0") ||
    header.includes("lora_unet_double_blocks")
  ) {
    return "flux";
  }

  // Diffusers-style LoRAs hide the family in `down_blocks` keys; the
  // cross-attention input size separates SDXL (2048) from SD1.5 (768).
  const crossAttnInput = header.match(
    /attn2_to_k\.lora_down\.weight":\{[^}]*?"shape":\[\d+,(\d+)\]/
  );
  if (crossAttnInput) {
    const dim = Number(crossAttnInput[1]);
    if (Number.isFinite(dim) && dim > 0) {
      return dim >= 1024 ? "sdxl" : "sd15";
    }
  }

  if (
    header.includes("conditioner.embedders.1") ||
    header.includes("lora_te2_") ||
    (header.includes("lora_te1_") && header.includes("lora_unet_input_blocks"))
  ) {
    return "sdxl";
  }

  if (
    header.includes("conditioner.embedders.0") ||
    (header.includes("lora_te_") && header.includes("lora_unet_input_blocks"))
  ) {
    return "sd15";
  }

  return null;
}

function inferArchitectureFromCategoryName(
  fileName: string,
  category: ModelCategory
): ModelArchitecture | null {
  const lower = fileName.toLowerCase();
  if (lower.includes("moss")) {
    return "moss_image";
  }
  if (category === "text_encoder") {
    if (
      lower.includes("qwen3.5-9b") ||
      lower.includes("qwen3_5_9b") ||
      lower.includes("qwen35_9b")
    ) {
      return "moss_image";
    }
    if (lower.includes("qwen_3_06b") || lower.includes("qwen3_06b")) return "anima";
    if (lower.includes("qwen_3_4b") || lower.includes("qwen3_4b")) return "z_image";
    if (lower.includes("qwen3vl") || lower.includes("qwen3_vl")) return "krea2";
    if (lower.includes("t5xxl")) return "flux";
    return null;
  }
  if (category === "vae") {
    if (
      lower.includes("flux2-vae_small") ||
      lower.includes("flux2_vae_small") ||
      lower.includes("flux2-vae-small")
    ) {
      return "moss_image";
    }
    if (lower.includes("qwen_image_vae")) return "anima";
    if (lower === "ae" || lower.startsWith("ae.")) return "flux";
    if (lower.includes("sdxl_vae") || lower.includes("sdxl-vae")) return "sdxl";
    if (
      lower.includes("vae-ft-mse") ||
      lower.includes("kl-f8") ||
      lower.includes("blessed2")
    ) {
      return "sd15";
    }
    return null;
  }
  return null;
}

function refineSdxlFamily(
  architecture: ModelArchitecture,
  combined: string
): ModelArchitecture {
  if (architecture !== "sdxl") return architecture;
  return inferModelArchitecture(combined);
}

function inferCategoryContextArchitecture(
  fileName: string,
  relativePath: string,
  category: ModelCategory,
  filePath?: string
): ModelArchitecture {
  const combined = `${relativePath} ${fileName}`;
  const nameHint =
    inferArchitectureFromCategoryName(fileName, category) ??
    inferModelArchitecture(combined);

  if (nameHint !== "unknown") {
    // Filenames distinguish Illustrious/Pony inside the SDXL family.
    return refineSdxlFamily(nameHint, combined);
  }

  if (filePath) {
    const sniffed = sniffSafetensorsArchitecture(filePath);
    if (sniffed) {
      return refineSdxlFamily(sniffed, combined);
    }
  }

  if (
    category === "diffusion_model" &&
    /(?:^|[^a-z])z[-_ ]?(?:image|turbo)|zturbo|zimage|(?:^|[_-])izt(?:[_-]|$)/i.test(combined)
  ) {
    return "z_image";
  }
  return "unknown";
}

function stableModelId(filePath: string): string {
  return crypto.createHash("sha1").update(filePath.toLowerCase()).digest("hex").slice(0, 16);
}

function firstString(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function firstStringArray(source: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const value = source[key];
    if (Array.isArray(value)) {
      const cleaned = value
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.trim())
        .filter(Boolean);
      if (cleaned.length > 0) return Array.from(new Set(cleaned));
    }
    if (typeof value === "string" && value.trim()) {
      const split = value
        .split(/[,\n]/)
        .map((v) => v.trim())
        .filter(Boolean);
      if (split.length > 0) return Array.from(new Set(split));
    }
  }
  return [];
}

function firstNumber(source: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function parseModelSource(source: Record<string, unknown>): ModelSource | null {
  const provider = firstString(source, ["source", "provider"]);
  const modelName = firstString(source, [
    "modelName",
    "model_name",
    "repo_id",
    "repoId",
    "huggingface_repo",
  ]);
  const versionName = firstString(source, ["name", "versionName", "version_name", "revision"]);
  const modelId = firstNumber(source, ["modelId", "model_id"]);
  const versionId = firstNumber(source, [
    "modelVersionId",
    "model_version_id",
    "versionId",
    "version_id",
  ]);
  if (!modelName && modelId === null) return null;

  const normalizedProvider = provider?.trim().toLowerCase() ?? "";
  const isCivitai = normalizedProvider === "civitai";
  const isHuggingFace =
    normalizedProvider === "huggingface" || (!isCivitai && modelName?.includes("/") === true);
  const url =
    firstString(source, ["modelUrl", "model_url"]) ??
    (isCivitai && modelId !== null
      ? `https://civitai.com/models/${modelId}${
          versionId !== null ? `?modelVersionId=${versionId}` : ""
        }`
      : isHuggingFace && modelName
        ? `https://huggingface.co/${modelName}`
        : null);

  return {
    provider:
      provider?.trim() || (isCivitai ? "civitai" : isHuggingFace ? "huggingface" : "local"),
    modelId,
    versionId,
    modelName,
    versionName,
    url,
  };
}

/**
 * Reads the safetensors `__metadata__` block (bounded to the first 8 MiB) for a
 * human title. Many Civitai uploads use `modelspec.title` or `ss_output_name`.
 */
export function readSafetensorsEmbeddedTitle(filePath: string): string | null {
  if (path.extname(filePath).toLowerCase() !== ".safetensors") return null;

  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, "r");
    const lengthBuffer = Buffer.alloc(8);
    fs.readSync(fd, lengthBuffer, 0, 8, 0);
    const headerLength = Number(lengthBuffer.readBigUInt64LE(0));
    if (!Number.isFinite(headerLength) || headerLength <= 1 || headerLength > 64 * 1024 * 1024) {
      return null;
    }
    const readLength = Math.min(headerLength, 8 * 1024 * 1024);
    const headerBuffer = Buffer.alloc(readLength);
    fs.readSync(fd, headerBuffer, 0, readLength, 8);
    const parsed = JSON.parse(headerBuffer.toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const metadata = (parsed as Record<string, unknown>).__metadata__;
    if (!metadata || typeof metadata !== "object") return null;
    const record = metadata as Record<string, unknown>;
    return (
      normalizeModelTitle(firstString(record, ["modelspec.title", "ss_output_name"])) ??
      null
    );
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore
      }
    }
  }
}

function stripHtml(input: string): string {
  return input
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function resolvePreviewCandidate(raw: string | null, baseDir: string): string | null {
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return null;
  const resolved = path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(baseDir, raw);
  if (!PREVIEW_EXTS.includes(path.extname(resolved).toLowerCase())) return null;
  if (!fs.existsSync(resolved)) return null;
  try {
    if (!fs.statSync(resolved).isFile()) return null;
  } catch {
    return null;
  }
  return resolved;
}

function findAdjacentPreview(modelFilePath: string): string | null {
  const dir = path.dirname(modelFilePath);
  const withoutExt = path.join(dir, path.basename(modelFilePath, path.extname(modelFilePath)));
  const suffixes = [".preview", ".thumb", ".thumbnail", ".civitai", ".poster", ""];
  for (const suffix of suffixes) {
    for (const ext of PREVIEW_EXTS) {
      const candidate = `${withoutExt}${suffix}${ext}`;
      if (fs.existsSync(candidate)) {
        try {
          if (fs.statSync(candidate).isFile()) return candidate;
        } catch {
          // ignore unreadable candidate
        }
      }
    }
  }
  return null;
}

/**
 * Read-only discovery of metadata and cover art shipped next to model files.
 * Never writes into the model's (possibly external) ComfyUI directory.
 */
export function discoverModelMetadata(modelFilePath: string): DiscoveredModelMetadata | null {
  if (modelFilePath.startsWith("comfy-api://")) return null;

  const dir = path.dirname(modelFilePath);
  const withoutExt = path.join(dir, path.basename(modelFilePath, path.extname(modelFilePath)));

  let description: string | null = null;
  let baseModel: string | null = null;
  let triggerWords: string[] = [];
  let previewPath: string | null = null;
  let source: ModelSource | null = null;

  for (const suffix of SIDECAR_SUFFIXES) {
    const sidecarPath = `${withoutExt}${suffix}`;
    if (!fs.existsSync(sidecarPath)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(sidecarPath, "utf8")) as unknown;
      if (!raw || typeof raw !== "object") continue;
      const sidecar = raw as Record<string, unknown>;

      const rawDescription = firstString(sidecar, [
        "description",
        "modelDescription",
        "about",
        "notes",
      ]);
      if (rawDescription && !description) {
        const stripped = stripHtml(rawDescription);
        description = stripped.length > 0 ? stripped : null;
      }

      if (!baseModel) {
        baseModel = firstString(sidecar, ["baseModel", "base_model", "base", "modelType"]);
      }

      if (triggerWords.length === 0) {
        triggerWords = firstStringArray(sidecar, [
          "triggerWords",
          "trigger_words",
          "trainedWords",
          "trained_words",
          "activationWords",
        ]);
      }

      if (!source) {
        source = parseModelSource(sidecar);
      }

      if (!previewPath) {
        previewPath = resolvePreviewCandidate(
          firstString(sidecar, [
            "previewPath",
            "preview_path",
            "preview",
            "thumbnail",
            "image",
            "cover",
          ]),
          path.dirname(sidecarPath)
        );
      }
    } catch {
      // Malformed sidecar files are ignored; they stay user-owned on disk.
    }
  }

  if (!previewPath) {
    previewPath = findAdjacentPreview(modelFilePath);
  }

  const embeddedTitle = source?.modelName
    ? null
    : readSafetensorsEmbeddedTitle(modelFilePath);

  if (
    !description &&
    !baseModel &&
    triggerWords.length === 0 &&
    !previewPath &&
    !source &&
    !embeddedTitle
  ) {
    return null;
  }

  return { description, baseModel, triggerWords, previewPath, source, embeddedTitle };
}

function addCategoryDir(
  map: Map<ModelCategory, Set<string>>,
  category: ModelCategory,
  dirPath: string
): void {
  const normalized = path.normalize(dirPath);
  if (!fs.existsSync(normalized)) return;
  try {
    if (!fs.statSync(normalized).isDirectory()) return;
  } catch {
    return;
  }
  let set = map.get(category);
  if (!set) {
    set = new Set<string>();
    map.set(category, set);
  }
  set.add(normalized);
}

export class ModelScanner {
  constructor(private readonly logger?: StudioLogger) {}

  resolveScanRoots(
    settings: AppSettings,
    managedModelsDir: string
  ): Map<ModelCategory, string[]> {
    const dirMap = new Map<ModelCategory, Set<string>>();

    const addModelsBaseRoot = (modelsRoot: string): void => {
      if (!modelsRoot || !fs.existsSync(modelsRoot)) return;
      for (const [category, folders] of Object.entries(CATEGORY_TO_FOLDERS) as Array<
        [ModelCategory, string[]]
      >) {
        for (const folder of folders) {
          addCategoryDir(dirMap, category, path.join(modelsRoot, folder));
        }
      }
    };

    const readYamlConfigIfPresent = (yamlPath: string): void => {
      if (!fs.existsSync(yamlPath)) return;
      try {
        const content = fs.readFileSync(yamlPath, "utf8");
        const parsed = parseComfyExtraModelPathsYaml(content, path.dirname(yamlPath));
        for (const [category, dirs] of Object.entries(parsed.byCategory) as Array<
          [ModelCategory, string[]]
        >) {
          for (const d of dirs) {
            addCategoryDir(dirMap, category, d);
          }
        }
      } catch (err) {
        this.logger?.warn("model-scanner", `Failed to parse YAML ${yamlPath}`, String(err));
      }
    };

    // 1. App-managed models root (always scanned)
    addModelsBaseRoot(managedModelsDir);

    // 2. Configured ComfyUI root (`models/` + `extra_model_paths.yaml`)
    const comfyRoot =
      settings.runtimeMode === "managed" ? settings.managedComfyPath : settings.externalComfyPath;
    if (comfyRoot && fs.existsSync(comfyRoot)) {
      addModelsBaseRoot(path.join(comfyRoot, "models"));
      readYamlConfigIfPresent(path.join(comfyRoot, "extra_model_paths.yaml"));
      readYamlConfigIfPresent(path.join(comfyRoot, "extra_models_config.yaml"));
      // Portable ComfyUI layout: <root>/ComfyUI/models
      addModelsBaseRoot(path.join(comfyRoot, "ComfyUI", "models"));
      readYamlConfigIfPresent(path.join(comfyRoot, "ComfyUI", "extra_model_paths.yaml"));
    }

    // 3. Windows AppData ComfyUI / Comfy Desktop shared configs (strictly read-only)
    const appData = process.env.APPDATA;
    if (appData) {
      readYamlConfigIfPresent(path.join(appData, "ComfyUI", "extra_models_config.yaml"));
      readYamlConfigIfPresent(path.join(appData, "Comfy Desktop", "shared_model_paths.yaml"));
    }

    // 4. User-configured extraModelDirs in Settings
    for (const extraDir of settings.extraModelDirs) {
      if (!extraDir || !fs.existsSync(extraDir)) continue;
      // Support pointing at either a Comfy root, a `models/` directory, or a folder containing category subdirs
      addModelsBaseRoot(extraDir);
      addModelsBaseRoot(path.join(extraDir, "models"));
    }

    const result = new Map<ModelCategory, string[]>();
    for (const [category, set] of dirMap.entries()) {
      result.set(category, Array.from(set.values()));
    }
    return result;
  }

  async scanAll(
    settings: AppSettings,
    managedModelsDir: string,
    liveClient?: ComfyApiClient | null
  ): Promise<ModelRecord[]> {
    const rootsByCategory = this.resolveScanRoots(settings, managedModelsDir);
    const records: ModelRecord[] = [];
    const seenFilePaths = new Set<string>();
    const nowIso = new Date().toISOString();

    for (const [category, dirs] of rootsByCategory.entries()) {
      for (const rootDir of dirs) {
        await this.walkCategoryDir(rootDir, rootDir, category, nowIso, seenFilePaths, records);
      }
    }

    // Also inspect live ComfyUI `/models/{folder}` if connected to catch any custom-configured paths
    if (liveClient) {
      await this.mergeLiveComfyModels(liveClient, records, nowIso);
    }

    // Detect duplicates across scanned roots (same normalized filename + non-zero sizeBytes)
    const bySignature = new Map<string, ModelRecord[]>();
    for (const rec of records) {
      if (rec.isIncomplete || rec.sizeBytes <= 0) continue;
      const key = `${rec.category}|${path.basename(rec.filePath).toLowerCase()}|${rec.sizeBytes}`;
      const list = bySignature.get(key) ?? [];
      list.push(rec);
      bySignature.set(key, list);
    }

    for (const group of bySignature.values()) {
      const canonical = group[0];
      if (!canonical || group.length <= 1) continue;
      for (let i = 1; i < group.length; i++) {
        const dup = group[i];
        if (!dup) continue;
        dup.isDuplicate = true;
        dup.duplicateOf = canonical.filePath;
      }
    }

    return records;
  }

  private async walkCategoryDir(
    baseCategoryDir: string,
    currentDir: string,
    category: ModelCategory,
    nowIso: string,
    seenFilePaths: Set<string>,
    outRecords: ModelRecord[]
  ): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".")) continue;
        await this.walkCategoryDir(baseCategoryDir, fullPath, category, nowIso, seenFilePaths, outRecords);
        continue;
      }
      if (!entry.isFile()) continue;

      const lowerName = entry.name.toLowerCase();
      if (lowerName.startsWith("put_") && lowerName.includes("_here")) {
        continue;
      }

      const ext = path.extname(lowerName);
      const isIncomplete = INCOMPLETE_EXTS.has(ext);
      const isAcceptedModel = ACCEPTED_MODEL_EXTS.has(ext);

      if (!isIncomplete && !isAcceptedModel) {
        continue;
      }

      const canonicalKey = fullPath.toLowerCase();
      if (seenFilePaths.has(canonicalKey)) continue;
      seenFilePaths.add(canonicalKey);

      let stat: fs.Stats;
      try {
        stat = await fs.promises.stat(fullPath);
      } catch {
        continue;
      }

      if (!isIncomplete && stat.size === 0) {
        continue;
      }

      const relativePath = path.relative(baseCategoryDir, fullPath);
      const cleanName = path.basename(entry.name, ext);
      const discoveryInfo = isIncomplete ? null : discoverModelMetadata(fullPath);
      const architecture = inferCategoryContextArchitecture(
        `${entry.name} ${discoveryInfo?.baseModel ?? ""}`,
        relativePath,
        category,
        fullPath
      );
      const compatibleWorkflows = isIncomplete
        ? []
        : getCompatibleWorkflowIds(category, architecture);
      const id = stableModelId(fullPath);

      const discovery: ModelDiscovery | null =
        discoveryInfo && !isIncomplete
          ? {
              modelId: id,
              filePath: fullPath,
              description: discoveryInfo.description,
              baseModel: discoveryInfo.baseModel,
              previewPath: discoveryInfo.previewPath,
              triggerWords: discoveryInfo.triggerWords,
              source: discoveryInfo.source,
              embeddedTitle: discoveryInfo.embeddedTitle,
              discoveredAt: nowIso,
            }
          : null;

      outRecords.push({
        id,
        name: cleanName,
        relativePath,
        filePath: fullPath,
        category,
        architecture,
        sizeBytes: stat.size,
        sha256: null,
        sourceRoot: baseCategoryDir,
        isDuplicate: false,
        duplicateOf: null,
        isIncomplete,
        compatibleWorkflows,
        license: null,
        description: discoveryInfo?.description ?? null,
        installed: !isIncomplete,
        lastSeenAt: nowIso,
        discovery,
      });
    }
  }

  private async mergeLiveComfyModels(
    liveClient: ComfyApiClient,
    records: ModelRecord[],
    nowIso: string
  ): Promise<void> {
    const existingSet = new Set(
      records.map((r) => `${r.category}|${r.relativePath.replace(/\//g, "\\").toLowerCase()}`)
    );

    for (const { category, folder } of COMFY_LIVE_MODEL_FOLDERS) {
      let names: string[];
      try {
        names = await liveClient.listModels(folder);
      } catch {
        continue;
      }

      for (const relName of names) {
        const normalizedRel = relName.replace(/\//g, "\\").toLowerCase();
        if (existingSet.has(`${category}|${normalizedRel}`)) continue;

        const base = path.basename(relName);
        const ext = path.extname(base);
        const architecture = inferCategoryContextArchitecture(base, relName, category);
        const syntheticPath = `comfy-api://${folder}/${relName}`;

        records.push({
          id: stableModelId(syntheticPath),
          name: path.basename(base, ext),
          relativePath: relName,
          filePath: syntheticPath,
          category,
          architecture,
          sizeBytes: 0,
          sha256: null,
          sourceRoot: "ComfyUI Live API",
          isDuplicate: false,
          duplicateOf: null,
          isIncomplete: false,
          compatibleWorkflows: getCompatibleWorkflowIds(category, architecture),
          license: null,
          description: "Discovered via connected ComfyUI API",
          installed: true,
          lastSeenAt: nowIso,
        });
      }
    }
  }
}
