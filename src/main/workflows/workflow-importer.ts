import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ComfyApiClient } from "../comfy/comfy-adapter";
import { resolveComfyInstallLayout } from "../comfy/runtime-manager";
import type { AppSettings, ModelCategory, ModelRecord } from "../../shared/types";
import type {
  InstalledWorkflowFile,
  WorkflowArchiveCandidate,
  WorkflowArchivePreview,
  WorkflowCompatibilityStatus,
  WorkflowImportRecord,
  WorkflowImportReport,
  WorkflowInstallResult,
  WorkflowJsonFormat,
  WorkflowModelReference,
  WorkflowNodeClassReport,
  WorkflowRevalidationResult,
  WorkflowSourceKind,
} from "../../shared/workflow-import";
import type { WorkflowImportLedger } from "./workflow-ledger";
import {
  inspectWorkflowArchive,
  readWorkflowArchiveJson,
} from "./workflow-archive";

const CIVITAI_API_BASE = "https://civitai.com/api/v1";
const CIVITAI_DOWNLOAD_BASE = "https://civitai.com/api/download/models";
const USER_AGENT = "KireaStudio/1.0.1 (Windows Desktop)";
const MAX_WORKFLOW_BYTES = 5 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;
const MAX_ARCHIVE_WORKFLOWS = 20;
const PREVIEW_TTL_MS = 30 * 60 * 1000;
const MAX_PREVIEWS = 20;

const MODEL_EXTENSION = /\.(safetensors|ckpt|pt|pth|bin|gguf)$/i;

// Frontend-only nodes that never appear in ComfyUI's /object_info registry.
const FRONTEND_NODE_TYPES = new Set([
  "Note",
  "MarkdownNote",
  "Reroute",
  "PrimitiveNode",
  "Comment",
  "Frame",
]);

const VIDEO_NODE_TYPES = new Set([
  "CreateVideo",
  "SaveVideo",
  "SaveWEBM",
  "SaveAnimatedWEBP",
  "EmptyHunyuanLatentVideo",
  "EmptyLTXVLatentVideo",
  "LTXVImgToVideo",
  "LTXVImgToVideoInplace",
  "LTXVConditioning",
  "WanImageToVideo",
]);

const MODEL_INPUTS: Record<string, { inputName: string; category: ModelCategory }> = {
  CheckpointLoaderSimple: { inputName: "ckpt_name", category: "checkpoint" },
  CheckpointLoader: { inputName: "ckpt_name", category: "checkpoint" },
  unCLIPCheckpointLoader: { inputName: "ckpt_name", category: "checkpoint" },
  ImageOnlyCheckpointLoader: { inputName: "ckpt_name", category: "checkpoint" },
  UNETLoader: { inputName: "unet_name", category: "diffusion_model" },
  CLIPLoader: { inputName: "clip_name", category: "text_encoder" },
  DualCLIPLoader: { inputName: "clip_name1", category: "text_encoder" },
  TripleCLIPLoader: { inputName: "clip_name1", category: "text_encoder" },
  VAELoader: { inputName: "vae_name", category: "vae" },
  LoraLoader: { inputName: "lora_name", category: "lora" },
  LoraLoaderModelOnly: { inputName: "lora_name", category: "lora" },
  UpscaleModelLoader: { inputName: "model_name", category: "upscale" },
  ControlNetLoader: { inputName: "control_net_name", category: "controlnet" },
};

const CATEGORY_FOLDERS: Record<ModelCategory, string> = {
  checkpoint: "checkpoints",
  lora: "loras",
  vae: "vae",
  embedding: "embeddings",
  controlnet: "controlnet",
  upscale: "upscale_models",
  diffusion_model: "diffusion_models",
  text_encoder: "text_encoders",
};

interface ParsedWorkflowNode {
  id: string;
  classType: string;
  inputs: Record<string, unknown>;
  widgetValues: unknown[] | null;
}

export interface ParsedWorkflow {
  format: WorkflowJsonFormat;
  nodes: ParsedWorkflowNode[];
  subgraphCount: number;
}

export interface WorkflowAnalysisOptions {
  name: string;
  sourceKind: WorkflowSourceKind;
  sourceLabel: string;
  models: ModelRecord[];
  availableNodeClasses?: Set<string> | null;
  runtimeChecked?: boolean;
  civitaiModelId?: number | null;
  civitaiVersionId?: number | null;
  originalFileName?: string | null;
  sourceUrl?: string | null;
  archiveEntry?: string | null;
}

export interface WorkflowImportMeta {
  name?: string | null;
  civitaiModelId?: number | null;
  civitaiVersionId?: number | null;
  originalFileName?: string | null;
  sourceUrl?: string | null;
  archiveEntry?: string | null;
}

export interface WorkflowArchiveImportMeta {
  archiveName?: string;
  namePrefix?: string;
  sourceLabel?: string;
  civitaiModelId?: number | null;
  civitaiVersionId?: number | null;
  sourceUrl?: string | null;
}

export interface WorkflowImporterDeps {
  getSettings: () => AppSettings;
  getModels: () => ModelRecord[];
  getConnectedApi: () => ComfyApiClient | null;
  getCivitaiApiKey: () => string | null;
  cacheDir: string;
  ledger?: WorkflowImportLedger;
}

interface StoredPreview {
  text: string;
  report: WorkflowImportReport;
  createdAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isApiPrompt(root: unknown): root is Record<string, Record<string, unknown>> {
  if (!isRecord(root)) return false;
  const entries = Object.values(root);
  return (
    entries.length > 0 &&
    entries.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.class_type === "string" &&
        isRecord(entry.inputs)
    )
  );
}

/**
 * Parses both ComfyUI formats: the editor's UI workflow document and the
 * API prompt object accepted by /prompt.
 */
export function parseWorkflowJson(text: string): ParsedWorkflow {
  let root: unknown;
  try {
    root = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("The downloaded file is not valid JSON.");
  }

  if (isRecord(root) && Array.isArray(root.nodes)) {
    const nodes: ParsedWorkflowNode[] = [];
    for (const raw of root.nodes) {
      if (!isRecord(raw) || typeof raw.type !== "string") continue;
      const widgets = Array.isArray(raw.widgets_values)
        ? raw.widgets_values
        : isRecord(raw.widgets_values)
          ? Object.values(raw.widgets_values)
          : null;
      nodes.push({
        id: String(raw.id ?? "?"),
        classType: raw.type,
        inputs: {},
        widgetValues: widgets,
      });
    }
    if (nodes.length === 0) {
      throw new Error("This UI workflow does not contain any nodes.");
    }
    return {
      format: "ui",
      nodes,
      subgraphCount:
        isRecord(root.definitions) && Array.isArray(root.definitions.subgraphs)
          ? root.definitions.subgraphs.length
          : 0,
    };
  }

  if (isApiPrompt(root)) {
    const nodes: ParsedWorkflowNode[] = Object.entries(root).map(([id, node]) => ({
      id,
      classType: String(node.class_type),
      inputs: isRecord(node.inputs) ? node.inputs : {},
      widgetValues: null,
    }));
    return { format: "api", nodes, subgraphCount: 0 };
  }

  throw new Error(
    "This file is not a ComfyUI workflow. Expected a UI workflow (nodes/links) or an API prompt (class_type/inputs)."
  );
}

function classifyModel(
  classType: string,
  inputName: string,
  filename: string
): ModelCategory | "unknown" {
  const mapped = MODEL_INPUTS[classType];
  if (mapped && mapped.inputName === inputName) return mapped.category;
  if (classType.includes("Lora")) return "lora";
  if (classType.includes("VAE")) return "vae";
  if (classType.includes("Upscale")) return "upscale";
  if (classType.includes("ControlNet")) return "controlnet";
  if (classType.includes("CLIP")) return "text_encoder";
  if (classType.includes("Checkpoint")) return "checkpoint";
  if (classType.includes("UNET")) return "diffusion_model";

  const lower = filename.toLowerCase();
  if (lower.includes("control")) return "controlnet";
  if (lower.includes("lora")) return "lora";
  if (lower.includes("vae")) return "vae";
  if (/\.(pt|pth)$/i.test(lower)) return "upscale";
  if (/(umt5|t5xxl|t5|clip|qwen)/.test(lower)) return "text_encoder";
  if (/(wan|ltx|unet|diffusion)/.test(lower)) return "diffusion_model";
  if (/(xl|sd15|illustrious|pony)/.test(lower)) return "checkpoint";
  return "unknown";
}

function expectedFolder(category: ModelCategory | "unknown"): string {
  return category === "unknown" ? "models" : CATEGORY_FOLDERS[category];
}

function collectModelReferences(
  parsed: ParsedWorkflow,
  models: ModelRecord[]
): { references: WorkflowModelReference[]; warnings: string[] } {
  const byBasename = new Map<string, ModelRecord[]>();
  for (const model of models) {
    if (!model.installed) continue;
    const basename = path.basename(model.filePath || model.relativePath).toLowerCase();
    const bucket = byBasename.get(basename) ?? [];
    bucket.push(model);
    byBasename.set(basename, bucket);
  }

  const references: WorkflowModelReference[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  const addReference = (
    node: ParsedWorkflowNode,
    inputName: string,
    filenameRaw: string
  ): void => {
    const filename = filenameRaw.trim();
    if (!filename || !MODEL_EXTENSION.test(filename)) return;
    const category = classifyModel(node.classType, inputName, filename);
    const key = `${node.id}:${category}:${filename.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);

    const candidates = byBasename.get(path.basename(filename).toLowerCase()) ?? [];
    let match = candidates.find((model) => category === "unknown" || model.category === category);
    if (!match && category !== "unknown") {
      match = candidates[0];
      if (match) {
        warnings.push(
          `'${filename}' is installed as a ${match.category}, but ${node.classType} expects it in ${expectedFolder(category)}.`
        );
      }
    }
    if (category === "unknown" && candidates.length > 0) {
      warnings.push(
        `Could not classify '${filename}' from ${node.classType}; verify it sits in the correct ComfyUI model folder.`
      );
    }

    references.push({
      nodeId: node.id,
      nodeClass: node.classType,
      inputName,
      filename,
      category,
      expectedFolder: expectedFolder(category),
      installed: Boolean(match),
    });
  };

  for (const node of parsed.nodes) {
    if (node.classType in MODEL_INPUTS) {
      const expectedInput = MODEL_INPUTS[node.classType]!.inputName;
      const fromInput = node.inputs[expectedInput];
      if (typeof fromInput === "string") {
        addReference(node, expectedInput, fromInput);
      } else if (node.widgetValues) {
        const widget = node.widgetValues.find(
          (value) => typeof value === "string" && MODEL_EXTENSION.test(value)
        );
        if (typeof widget === "string") addReference(node, expectedInput, widget);
      }
    }

    for (const [inputName, value] of Object.entries(node.inputs)) {
      if (typeof value === "string") addReference(node, inputName, value);
    }

    if (node.widgetValues) {
      for (const [index, value] of node.widgetValues.entries()) {
        if (typeof value !== "string" || !MODEL_EXTENSION.test(value)) continue;
        const inputName =
          node.classType in MODEL_INPUTS && index === 0
            ? MODEL_INPUTS[node.classType]!.inputName
            : "widget";
        addReference(node, inputName, value);
      }
    }
  }

  return { references, warnings };
}

export function analyzeWorkflowText(
  text: string,
  options: WorkflowAnalysisOptions
): Omit<WorkflowImportReport, "previewId"> {
  const parsed = parseWorkflowJson(text);
  const warnings: string[] = [];
  const notes: string[] = [];

  const backendClasses = new Map<string, number>();
  for (const node of parsed.nodes) {
    if (FRONTEND_NODE_TYPES.has(node.classType)) continue;
    if (node.classType.includes(">")) continue; // subgraph instance placeholder
    backendClasses.set(node.classType, (backendClasses.get(node.classType) ?? 0) + 1);
  }

  const availability = options.availableNodeClasses ?? null;
  const nodeClasses: WorkflowNodeClassReport[] = Array.from(backendClasses.entries())
    .map(([classType, count]) => ({
      classType,
      count,
      available: availability ? availability.has(classType) : null,
    }))
    .sort((a, b) => a.classType.localeCompare(b.classType));

  const missingNodeClasses = availability
    ? nodeClasses.filter((node) => !node.available).map((node) => node.classType)
    : [];

  const { references, warnings: modelWarnings } = collectModelReferences(
    parsed,
    options.models
  );
  warnings.push(...modelWarnings);
  const missingModels = references.filter((reference) => !reference.installed);
  if (missingModels.length > 0) {
    warnings.push(
      `${missingModels.length} referenced model file(s) were not found in Kirea's scanned model folders.`
    );
  }
  if (references.length === 0) {
    notes.push("No model file references were detected; verify the workflow's loader nodes.");
  }
  if (parsed.subgraphCount > 0) {
    warnings.push(
      `This workflow defines ${parsed.subgraphCount} subgraph(s); confirm they open in your ComfyUI version.`
    );
  }

  const video =
    parsed.nodes.some((node) => VIDEO_NODE_TYPES.has(node.classType)) ||
    parsed.nodes.some((node) => /video/i.test(node.classType));

  if (parsed.format === "ui") {
    notes.push(
      "UI-format workflow: it can be installed into ComfyUI's workflow browser."
    );
  } else {
    notes.push(
      "API prompt format: this is a /prompt graph, not a ComfyUI editor workflow, so it can be validated but not installed into the workflow browser."
    );
  }
  if (!options.runtimeChecked) {
    notes.push("ComfyUI node availability was not verified.");
  }
  if (video) {
    notes.push("Video workflow: ComfyUI 0.3.30+ is required for the native video nodes.");
  }

  return {
    name: options.name,
    format: parsed.format,
    sourceKind: options.sourceKind,
    sourceLabel: options.sourceLabel,
    sizeBytes: Buffer.byteLength(text, "utf8"),
    nodeCount: parsed.nodes.length,
    video,
    runtimeChecked: Boolean(options.runtimeChecked),
    installable: parsed.format === "ui",
    nodeClasses,
    missingNodeClasses,
    modelReferences: references,
    warnings,
    notes,
    civitaiModelId: options.civitaiModelId ?? null,
    civitaiVersionId: options.civitaiVersionId ?? null,
    originalFileName: options.originalFileName ?? null,
    sourceUrl: options.sourceUrl ?? null,
    archiveEntry: options.archiveEntry ?? null,
  };
}

export function resolveWorkflowsDir(
  settings: AppSettings,
  cacheDir: string
): string | null {
  if (settings.runtimeMode === "managed") {
    return path.join(cacheDir, "comfy-user", "default", "workflows");
  }
  const layout = resolveComfyInstallLayout(settings.externalComfyPath);
  if (!layout) return null;
  return path.join(layout.comfyDir, "user", "default", "workflows");
}

export function sanitizeWorkflowFileBase(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "");
  return (cleaned || "imported-workflow").slice(0, 120);
}

export function isPathInsideWorkflowsDir(
  filePath: string,
  workflowsDir: string
): boolean {
  const relative = path.relative(path.resolve(workflowsDir), path.resolve(filePath));
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isForbiddenHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".local")) return true;
  if (host.includes(":")) {
    if (host === "::1" || host.startsWith("fe80") || host.startsWith("fc") || host.startsWith("fd")) {
      return true;
    }
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a = -1, b = -1] = host.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  return false;
}

export function assertSafeWorkflowUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("Enter a valid workflow URL.");
  }
  if (url.protocol !== "https:") {
    throw new Error("Workflow downloads require an HTTPS URL.");
  }
  if (url.username || url.password) {
    throw new Error("Workflow URLs must not contain embedded credentials.");
  }
  if (isForbiddenHostname(url.hostname)) {
    throw new Error("Local and private network URLs are not allowed for workflow downloads.");
  }
  return url;
}

interface CivitaiWorkflowTarget {
  modelName: string;
  versionName: string;
  downloadUrl: string;
}

function civitaiModelId(url: URL): number | null {
  const match = url.pathname.match(/\/models\/(\d+)/);
  if (!match) return null;
  return Number(match[1]);
}

async function fetchCivitaiWorkflowTarget(
  url: URL,
  modelId: number,
  apiKey: string | null
): Promise<CivitaiWorkflowTarget> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": USER_AGENT,
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let response: Response;
  try {
    response = await fetch(`${CIVITAI_API_BASE}/models/${modelId}`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new Error(
      `Unable to reach Civitai. ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error(
      apiKey
        ? "Civitai rejected the stored API key. Update it in Settings → Civitai Hub."
        : "Civitai requires an API key for this workflow. Add one in Settings → Civitai Hub."
    );
  }
  if (!response.ok) {
    throw new Error(`Civitai metadata request failed (HTTP ${response.status}).`);
  }
  let payload: {
    name?: string;
    modelVersions?: Array<{
      id?: number;
      name?: string;
      files?: Array<{ name?: string; downloadUrl?: string }>;
    }>;
  };
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    throw new Error("Civitai returned an unreadable metadata response.");
  }

  const versions = Array.isArray(payload.modelVersions) ? payload.modelVersions : [];
  const requestedVersionId = Number(url.searchParams.get("modelVersionId") ?? "");
  let version =
    Number.isFinite(requestedVersionId) && requestedVersionId > 0
      ? versions.find((entry) => entry.id === requestedVersionId)
      : undefined;
  if (!version) {
    const withJson = versions.filter((entry) =>
      (entry.files ?? []).some((file) => /\.json$/i.test(file.name ?? ""))
    );
    if (withJson.length === 1) {
      version = withJson[0];
    } else if (withJson.length === 0) {
      throw new Error("This Civitai model has no JSON workflow file.");
    } else {
      throw new Error(
        "This Civitai model has multiple workflow versions. Open the version you want and paste its modelVersionId URL."
      );
    }
  }
  if (!version || typeof version.id !== "number") {
    throw new Error("Could not resolve a Civitai workflow version.");
  }

  const file = (version.files ?? []).find((entry) => /\.json$/i.test(entry.name ?? ""));
  const downloadUrl =
    (file?.downloadUrl ?? "").trim() || `${CIVITAI_DOWNLOAD_BASE}/${version.id}`;
  return {
    modelName: (payload.name ?? "").trim() || `Civitai model ${modelId}`,
    versionName: (version.name ?? "").trim() || `Version ${version.id}`,
    downloadUrl,
  };
}

async function fetchWorkflowBuffer(
  url: string,
  apiKey: string | null,
  maxBytes: number,
  accept: string
): Promise<Buffer> {
  const parsed = assertSafeWorkflowUrl(url);
  const headers: Record<string, string> = {
    Accept: accept,
    "User-Agent": USER_AGENT,
  };
  if (apiKey && parsed.hostname.endsWith("civitai.com")) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  let response: Response;
  try {
    response = await fetch(parsed.toString(), {
      headers,
      redirect: "follow",
      signal: controller.signal,
    });
  } catch (error) {
    throw new Error(
      `Unable to download the workflow. ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error(
      apiKey
        ? "Civitai rejected the request. Check the stored API key in Settings → Civitai Hub."
        : "This workflow is gated. Add a Civitai API key in Settings → Civitai Hub, then retry."
    );
  }
  if (response.status === 404) {
    throw new Error("Civitai could not find that workflow file (HTTP 404).");
  }
  if (response.status === 429) {
    throw new Error("Civitai rate limit reached. Wait a moment before downloading again.");
  }
  if (!response.ok) {
    throw new Error(`Workflow download failed (HTTP ${response.status}).`);
  }
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > maxBytes) {
    throw new Error(`The workflow file exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB limit.`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > maxBytes) {
    throw new Error(`The workflow file exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB limit.`);
  }
  const head = buffer.subarray(0, 64).toString("utf8").trimStart().toLowerCase();
  if (head.startsWith("<!doctype html") || head.startsWith("<html")) {
    throw new Error(
      "That URL returned a web page, not a workflow file. Use a direct download link."
    );
  }
  return buffer;
}

async function fetchWorkflowText(
  url: string,
  apiKey: string | null
): Promise<string> {
  const buffer = await fetchWorkflowBuffer(
    url,
    apiKey,
    MAX_WORKFLOW_BYTES,
    "application/json, text/plain;q=0.9, */*;q=0.5"
  );
  return buffer.toString("utf8");
}

export class WorkflowImporter {
  private readonly previews = new Map<string, StoredPreview>();
  private availabilityCache: {
    at: number;
    classes: Set<string> | null;
    runtimeChecked: boolean;
  } | null = null;

  constructor(private readonly deps: WorkflowImporterDeps) {}

  private prunePreviews(): void {
    const cutoff = Date.now() - PREVIEW_TTL_MS;
    for (const [id, preview] of this.previews) {
      if (preview.createdAt < cutoff) this.previews.delete(id);
    }
    while (this.previews.size >= MAX_PREVIEWS) {
      const oldest = this.previews.keys().next().value;
      if (!oldest) break;
      this.previews.delete(oldest);
    }
  }

  private async analyzeText(
    text: string,
    name: string,
    sourceKind: WorkflowSourceKind,
    sourceLabel: string,
    meta: WorkflowImportMeta = {}
  ): Promise<WorkflowImportReport> {
    let availableNodeClasses: Set<string> | null = null;
    let runtimeChecked = false;
    const api = this.deps.getConnectedApi();
    if (api) {
      const cached = this.availabilityCache;
      if (cached && Date.now() - cached.at < 15_000) {
        availableNodeClasses = cached.classes;
        runtimeChecked = cached.runtimeChecked;
      } else {
        try {
          const info = await api.getAllObjectInfo();
          availableNodeClasses = new Set(Object.keys(info));
          runtimeChecked = true;
        } catch {
          availableNodeClasses = null;
        }
        this.availabilityCache = {
          at: Date.now(),
          classes: availableNodeClasses,
          runtimeChecked,
        };
      }
    }

    const analysis = analyzeWorkflowText(text, {
      name,
      sourceKind,
      sourceLabel,
      models: this.deps.getModels(),
      availableNodeClasses,
      runtimeChecked,
      civitaiModelId: meta.civitaiModelId ?? null,
      civitaiVersionId: meta.civitaiVersionId ?? null,
      originalFileName: meta.originalFileName ?? null,
      sourceUrl: meta.sourceUrl ?? null,
      archiveEntry: meta.archiveEntry ?? null,
    });

    this.prunePreviews();
    const previewId = crypto.randomUUID();
    const report: WorkflowImportReport = { ...analysis, previewId };
    this.previews.set(previewId, { text, report, createdAt: Date.now() });
    return report;
  }

  async analyzeUrl(
    rawUrl: string,
    meta: WorkflowImportMeta = {}
  ): Promise<WorkflowImportReport> {
    const url = assertSafeWorkflowUrl(rawUrl);
    const apiKey = this.deps.getCivitaiApiKey();
    let downloadUrl = url.toString();
    let name = path.basename(url.pathname).replace(/\.json$/i, "") || url.hostname;

    const modelId = civitaiModelId(url);
    if (modelId) {
      const target = await fetchCivitaiWorkflowTarget(url, modelId, apiKey);
      downloadUrl = target.downloadUrl;
      name = `${target.modelName} - ${target.versionName}`;
    }

    const text = await fetchWorkflowText(downloadUrl, apiKey);
    return this.analyzeText(
      text,
      meta.name ?? name,
      meta.civitaiModelId ? "civitai" : "url",
      url.toString(),
      {
        ...meta,
        sourceUrl: meta.sourceUrl ?? url.toString(),
      }
    );
  }

  async analyzeFile(
    filePath: string,
    meta: WorkflowImportMeta = {}
  ): Promise<WorkflowImportReport> {
    if (!/\.json$/i.test(filePath)) {
      throw new Error("Choose a ComfyUI workflow .json file.");
    }
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      throw new Error("The selected workflow path is not a file.");
    }
    if (stat.size > MAX_WORKFLOW_BYTES) {
      throw new Error("Workflow JSON is larger than the 5 MB import limit.");
    }
    const text = fs.readFileSync(filePath, "utf8");
    return this.analyzeText(
      text,
      meta.name ?? path.basename(filePath).replace(/\.json$/i, ""),
      "file",
      filePath,
      { ...meta, originalFileName: meta.originalFileName ?? path.basename(filePath) }
    );
  }

  async analyzeWorkflowArchiveUrl(
    rawUrl: string,
    meta: WorkflowArchiveImportMeta = {}
  ): Promise<WorkflowArchivePreview> {
    const url = assertSafeWorkflowUrl(rawUrl);
    const buffer = await fetchWorkflowBuffer(
      url.toString(),
      this.deps.getCivitaiApiKey(),
      MAX_ARCHIVE_BYTES,
      "application/zip, application/octet-stream;q=0.9, */*;q=0.5"
    );
    const archiveName =
      meta.archiveName ?? (path.basename(url.pathname) || "civitai-workflow.zip");
    return this.analyzeArchiveBuffer(buffer, {
      ...meta,
      archiveName,
      sourceLabel: meta.sourceLabel ?? url.toString(),
      sourceUrl: meta.sourceUrl ?? url.toString(),
    });
  }

  async analyzeWorkflowArchiveFile(filePath: string): Promise<WorkflowArchivePreview> {
    if (!/\.zip$/i.test(filePath)) {
      throw new Error("Choose a workflow ZIP archive.");
    }
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      throw new Error("The selected archive path is not a file.");
    }
    if (stat.size > MAX_ARCHIVE_BYTES) {
      throw new Error(
        `The archive is larger than the ${Math.round(MAX_ARCHIVE_BYTES / (1024 * 1024))} MB import limit.`
      );
    }
    const buffer = fs.readFileSync(filePath);
    return this.analyzeArchiveBuffer(buffer, {
      archiveName: path.basename(filePath),
      sourceLabel: filePath,
      sourceUrl: null,
    });
  }

  private async analyzeArchiveBuffer(
    buffer: Buffer,
    meta: WorkflowArchiveImportMeta
  ): Promise<WorkflowArchivePreview> {
    const inspection = inspectWorkflowArchive(buffer);
    const warnings = [...inspection.warnings];
    const archiveName = meta.archiveName ?? "workflow-archive.zip";
    const prefix = meta.namePrefix ?? archiveName.replace(/\.zip$/i, "");
    const sourceLabel = meta.sourceLabel ?? archiveName;
    const entries = inspection.jsonEntries.slice(0, MAX_ARCHIVE_WORKFLOWS);
    if (inspection.jsonEntries.length > MAX_ARCHIVE_WORKFLOWS) {
      warnings.push(
        `The archive contains ${inspection.jsonEntries.length} JSON files; only the first ${MAX_ARCHIVE_WORKFLOWS} were analyzed.`
      );
    }
    if (inspection.jsonEntries.length === 0) {
      throw new Error("The archive does not contain a JSON workflow file.");
    }

    const baseCounts = new Map<string, number>();
    for (const entry of inspection.jsonEntries) {
      const base = entry.fileName.replace(/\.json$/i, "").toLowerCase();
      baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1);
    }

    const candidates: WorkflowArchiveCandidate[] = [];
    for (const entry of entries) {
      let text: string;
      try {
        text = readWorkflowArchiveJson(buffer, entry);
      } catch (error) {
        warnings.push(
          `Skipped '${entry.path}': ${error instanceof Error ? error.message : String(error)}`
        );
        continue;
      }
      if (Buffer.byteLength(text, "utf8") > MAX_WORKFLOW_BYTES) {
        warnings.push(`Skipped '${entry.path}': workflow JSON is larger than the 5 MB limit.`);
        continue;
      }
      const base = entry.fileName.replace(/\.json$/i, "");
      const name =
        (baseCounts.get(base.toLowerCase()) ?? 0) > 1
          ? `${prefix} - ${entry.path.replace(/\.json$/i, "")}`
          : `${prefix} - ${base}`;
      try {
        const report = await this.analyzeText(text, name, "archive", sourceLabel, {
          civitaiModelId: meta.civitaiModelId ?? null,
          civitaiVersionId: meta.civitaiVersionId ?? null,
          originalFileName: entry.path,
          sourceUrl: meta.sourceUrl ?? null,
          archiveEntry: entry.path,
        });
        candidates.push({
          entryPath: entry.path,
          fileName: entry.fileName,
          sizeBytes: entry.uncompressedSize,
          report,
        });
      } catch (error) {
        warnings.push(
          `Skipped '${entry.path}': ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (candidates.length === 0) {
      throw new Error(
        "No valid ComfyUI workflow JSON was found in the archive. Nothing was installed."
      );
    }
    candidates.sort(
      (a, b) =>
        Number(b.report.installable) - Number(a.report.installable) ||
        a.entryPath.localeCompare(b.entryPath)
    );
    return {
      archiveName,
      sourceLabel,
      candidates,
      warnings,
    };
  }

  install(previewId: string): WorkflowInstallResult {
    const preview = this.previews.get(previewId);
    if (!preview) {
      throw new Error("This workflow analysis expired. Analyze the workflow again.");
    }
    if (!preview.report.installable) {
      throw new Error(
        "API prompt graphs cannot be installed into ComfyUI's workflow browser. Use a UI-format workflow."
      );
    }
    const workflowsDir = resolveWorkflowsDir(this.deps.getSettings(), this.deps.cacheDir);
    if (!workflowsDir) {
      throw new Error(
        "Kirea could not locate the ComfyUI installation. Set the ComfyUI path in Settings → Runtime, then retry."
      );
    }

    fs.mkdirSync(workflowsDir, { recursive: true });
    const base = sanitizeWorkflowFileBase(preview.report.name);
    let fileName = `${base}.json`;
    let counter = 1;
    while (fs.existsSync(path.join(workflowsDir, fileName))) {
      fileName = `${base}-${counter}.json`;
      counter += 1;
    }
    const filePath = path.join(workflowsDir, fileName);
    fs.writeFileSync(filePath, preview.text, "utf8");
    this.recordInstallation(preview.report, fileName, filePath, workflowsDir);
    this.previews.delete(previewId);
    return { fileName, filePath, folder: workflowsDir };
  }

  private recordInstallation(
    report: WorkflowImportReport,
    fileName: string,
    filePath: string,
    folder: string
  ): void {
    if (!this.deps.ledger) return;
    const missingModelCount = report.modelReferences.filter(
      (reference) => !reference.installed
    ).length;
    const compatibility: WorkflowCompatibilityStatus = report.runtimeChecked
      ? report.missingNodeClasses.length === 0 && missingModelCount === 0
        ? "compatible"
        : "incompatible"
      : "unknown";
    const record: WorkflowImportRecord = {
      id: crypto.randomUUID(),
      workflowName: report.name,
      sourceKind: report.sourceKind,
      sourceLabel: report.sourceLabel,
      sourceUrl: report.sourceUrl,
      civitaiModelId: report.civitaiModelId,
      civitaiVersionId: report.civitaiVersionId,
      originalFileName: report.originalFileName,
      fileName,
      filePath,
      folder,
      importedAt: new Date().toISOString(),
      format: report.format,
      compatibility,
      missingNodeCount: report.missingNodeClasses.length,
      missingModelCount,
      archiveEntry: report.archiveEntry,
    };
    this.deps.ledger.upsert(record);
  }

  listInstalled(): InstalledWorkflowFile[] {
    const workflowsDir = resolveWorkflowsDir(this.deps.getSettings(), this.deps.cacheDir);
    if (!workflowsDir || !fs.existsSync(workflowsDir)) return [];
    return fs
      .readdirSync(workflowsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.json$/i.test(entry.name))
      .map((entry) => {
        const filePath = path.join(workflowsDir, entry.name);
        const stat = fs.statSync(filePath);
        return {
          fileName: entry.name,
          filePath,
          sizeBytes: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          importRecord: this.deps.ledger?.getByFilePath(filePath) ?? null,
        };
      })
      .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
      .slice(0, 200);
  }

  removeInstalled(filePath: string): boolean {
    const workflowsDir = resolveWorkflowsDir(this.deps.getSettings(), this.deps.cacheDir);
    if (!workflowsDir || !isPathInsideWorkflowsDir(filePath, workflowsDir)) {
      throw new Error("Blocked attempt to remove a file outside ComfyUI's workflow folder.");
    }
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      throw new Error("That workflow file no longer exists on disk.");
    }
    if (!fs.statSync(resolved).isFile()) {
      throw new Error("That workflow path is not a file.");
    }
    fs.unlinkSync(resolved);
    this.deps.ledger?.removeByFilePath(resolved);
    return true;
  }

  async revalidateInstalled(filePath: string): Promise<WorkflowRevalidationResult> {
    const workflowsDir = resolveWorkflowsDir(this.deps.getSettings(), this.deps.cacheDir);
    if (!workflowsDir || !isPathInsideWorkflowsDir(filePath, workflowsDir)) {
      throw new Error("Blocked attempt to validate a file outside ComfyUI's workflow folder.");
    }
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      throw new Error("That workflow file no longer exists on disk.");
    }
    const record = this.deps.ledger?.getByFilePath(resolved) ?? null;
    const report = await this.analyzeFile(resolved, {
      civitaiModelId: record?.civitaiModelId ?? null,
      civitaiVersionId: record?.civitaiVersionId ?? null,
      originalFileName: record?.originalFileName ?? path.basename(resolved),
      sourceUrl: record?.sourceUrl ?? null,
    });
    if (!record) return { report, record: null };
    const missingModelCount = report.modelReferences.filter(
      (reference) => !reference.installed
    ).length;
    const compatibility: WorkflowCompatibilityStatus = report.runtimeChecked
      ? report.missingNodeClasses.length === 0 && missingModelCount === 0
        ? "compatible"
        : "incompatible"
      : "unknown";
    const updated: WorkflowImportRecord = {
      ...record,
      compatibility,
      missingNodeCount: report.missingNodeClasses.length,
      missingModelCount,
    };
    this.deps.ledger?.upsert(updated);
    return { report, record: updated };
  }

  async reimportInstalled(filePath: string): Promise<WorkflowImportReport> {
    const workflowsDir = resolveWorkflowsDir(this.deps.getSettings(), this.deps.cacheDir);
    if (!workflowsDir || !isPathInsideWorkflowsDir(filePath, workflowsDir)) {
      throw new Error("Blocked attempt to reimport a file outside ComfyUI's workflow folder.");
    }
    const resolved = path.resolve(filePath);
    const record = this.deps.ledger?.getByFilePath(resolved) ?? null;
    if (record?.sourceUrl) {
      return this.analyzeUrl(record.sourceUrl, {
        civitaiModelId: record.civitaiModelId,
        civitaiVersionId: record.civitaiVersionId,
        originalFileName: record.originalFileName,
        sourceUrl: record.sourceUrl,
      });
    }
    if (!fs.existsSync(resolved)) {
      throw new Error("That workflow file no longer exists on disk.");
    }
    return this.analyzeFile(resolved, {
      civitaiModelId: record?.civitaiModelId ?? null,
      civitaiVersionId: record?.civitaiVersionId ?? null,
      originalFileName: record?.originalFileName ?? path.basename(resolved),
      sourceUrl: record?.sourceUrl ?? null,
    });
  }

  workflowsDir(): string | null {
    return resolveWorkflowsDir(this.deps.getSettings(), this.deps.cacheDir);
  }
}
