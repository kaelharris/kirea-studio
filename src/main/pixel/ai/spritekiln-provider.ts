import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type {
  PixelAiBackendStatus,
  PixelAiCapabilityId,
  PixelAiCapabilityStatus,
  PixelAiGenerateInput,
  PixelAiGenerationMetadata,
  PixelAiImageInput,
  PixelAiRequirement,
  PixelAiReferenceMetadata,
} from "../../../shared/pixel-ai-types";
import { SPRITEKILN_STYLES } from "../../../shared/pixel-ai-types";
import { getPalettePreset, paletteColors } from "../../../shared/pixel-recipe";
import type { AppSettings } from "../../../shared/types";
import {
  ComfyApiClient,
  ComfyApiError,
} from "../../comfy/comfy-adapter";
import type { ComfyHistoryEntry, ComfyHistoryOutputFile, ComfyPromptGraph } from "../../comfy/comfy-types";
import { ComfyWsClient } from "../../comfy/comfy-ws";
import type { StudioRepository } from "../../db/repositories";
import type { StudioLogger } from "../../logger";
import type { StudioPaths } from "../../paths";
import { isAllowedLoopbackHost } from "../../security";
import { loadPixelEngine } from "../pixel-engine";
import { resolveSpriteKilnRoot } from "../spritekiln-root";

interface GraphNode {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta?: { title?: string };
}

type PromptGraph = Record<string, GraphNode>;

interface CapabilityDescriptor {
  id: PixelAiCapabilityId;
  label: string;
  mode: PixelAiGenerateInput["mode"];
  workflowFile: string;
  saveNode: string;
  notes: string[];
}

const CAPABILITIES: CapabilityDescriptor[] = [
  {
    id: "text_to_pixel",
    label: "Text to pixel art",
    mode: "text",
    workflowFile: "01_text_to_pixel_art.api.json",
    saveNode: "20",
    notes: ["Negative prompts are stored but not applied: the upstream distilled workflow runs at cfg 1.0."],
  },
  {
    id: "image_to_pixel_direct",
    label: "Image pixel conversion",
    mode: "image",
    workflowFile: "02_image_to_pixel_art.api.json",
    saveNode: "8",
    notes: ["Deterministic palette/quantise path. It does not load a generative model."],
  },
  {
    id: "image_to_pixel_ai",
    label: "Image AI redraw",
    mode: "image",
    workflowFile: "02_image_to_pixel_art.api.json",
    saveNode: "23",
    notes: ["Upstream redraw workflow does not include background removal; transparency is not applied."],
  },
  {
    id: "reference_to_pixel",
    label: "Reference-guided pixel art",
    mode: "reference",
    workflowFile: "03_reference_to_pixel_art.api.json",
    saveNode: "33",
    notes: ["Requires a subject reference. A style reference is optional; without it the subject image is reused."],
  },
  {
    id: "inpaint_pixel",
    label: "Localized pixel edit",
    mode: "inpaint",
    workflowFile: "05_inpaint_pixel_art.api.json",
    saveNode: "27",
    notes: ["Uses a rectangular region mask. The rest of the source sprite is preserved by SK_MaskedMerge."],
  },
  {
    id: "directional_set",
    label: "Directional sprite set",
    mode: "directions",
    workflowFile: "06_rotate_8_directions.api.json",
    saveNode: "26",
    notes: [
      "Turns a front-facing sprite into a 4 or 8 direction set while keeping design, outfit and palette.",
      "West-facing directions are mirrored from the east renders; five generation passes produce eight directions.",
    ],
  },
];

interface ModelInput {
  field: string;
  folder: string;
}

const MODEL_INPUTS: Record<string, ModelInput> = {
  UNETLoader: { field: "unet_name", folder: "diffusion_models" },
  LoraLoaderModelOnly: { field: "lora_name", folder: "loras" },
  CLIPLoader: { field: "clip_name", folder: "text_encoders" },
  VAELoader: { field: "vae_name", folder: "vae" },
  LoadBackgroundRemovalModel: { field: "bg_removal_name", folder: "background_removal" },
  CheckpointLoaderSimple: { field: "ckpt_name", folder: "checkpoints" },
};

const IMAGE_DATA_URL = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=\s]+)$/;

export class PixelAiCancelledError extends Error {
  constructor() {
    super("Pixel generation cancelled.");
    this.name = "PixelAiCancelledError";
  }
}

export interface PixelAiProgress {
  stage?: string;
  value?: number;
  max?: number;
  promptId?: string;
}

export interface PixelAiGenerationResult {
  png: Buffer;
  width: number;
  height: number;
  promptId: string;
  metadata: PixelAiGenerationMetadata;
}

export interface PixelAiDirectionImage {
  label: string;
  png: Buffer;
  width: number;
  height: number;
}

export interface PixelAiDirectionResult {
  images: PixelAiDirectionImage[];
  promptId: string;
  metadata: PixelAiGenerationMetadata;
}

const DIRECTION_LABELS: Record<4 | 8, string[]> = {
  4: ["S", "E", "N", "W"],
  8: ["S", "SE", "E", "NE", "N", "NW", "W", "SW"],
};

export interface SpriteKilnProviderOptions {
  timeoutMs?: number;
  pollMs?: number;
  createApiClient?: (apiUrl: string) => ComfyApiClient;
  createWsClient?: () => ComfyWsClient;
}

interface ProviderConfig {
  apiUrl: string;
  host: string;
  port: number;
}

export class SpriteKilnProvider {
  private readonly timeoutMs: number;
  private readonly pollMs: number;
  private readonly createApiClient: (apiUrl: string) => ComfyApiClient;
  private readonly createWsClient: () => ComfyWsClient;
  private readonly activePrompts = new Map<string, string>();

  constructor(
    private readonly paths: StudioPaths,
    private readonly repo: StudioRepository,
    private readonly getSettings: () => AppSettings,
    private readonly logger: StudioLogger,
    options: SpriteKilnProviderOptions = {}
  ) {
    this.timeoutMs = options.timeoutMs ?? 15 * 60_000;
    this.pollMs = options.pollMs ?? 800;
    this.createApiClient = options.createApiClient ?? ((apiUrl) => new ComfyApiClient(apiUrl));
    this.createWsClient = options.createWsClient ?? (() => new ComfyWsClient());
  }

  getConfig(): ProviderConfig {
    const settings = this.getSettings();
    if (!isAllowedLoopbackHost(settings.pixelBackendHost)) {
      throw new Error("Pixel backend host must be a loopback address (127.0.0.1, localhost or ::1).");
    }
    const port = settings.pixelBackendPort;
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new Error("Pixel backend port must be between 1024 and 65535.");
    }
    return {
      host: settings.pixelBackendHost.trim(),
      port,
      apiUrl: `http://${settings.pixelBackendHost.trim()}:${port}`,
    };
  }

  async testConnection(): Promise<{ ok: boolean; apiUrl: string; comfyVersion: string | null; message: string }> {
    const config = this.getConfig();
    try {
      const stats = await this.createApiClient(config.apiUrl).getSystemStats();
      return {
        ok: true,
        apiUrl: config.apiUrl,
        comfyVersion: stats.system?.comfyui_version ?? null,
        message: `Connected to the dedicated pixel backend at ${config.apiUrl}.`,
      };
    } catch (error) {
      return {
        ok: false,
        apiUrl: config.apiUrl,
        comfyVersion: null,
        message: `Could not reach the dedicated pixel backend at ${config.apiUrl}: ${errorMessage(error)}`,
      };
    }
  }

  async getStatus(): Promise<PixelAiBackendStatus> {
    const checkedAt = new Date().toISOString();
    const settings = this.getSettings();
    let config: ProviderConfig;
    try {
      config = this.getConfig();
    } catch (error) {
      return {
        state: "setup_required",
        message: errorMessage(error),
        configured: false,
        reachable: false,
        apiUrl: "",
        comfyVersion: null,
        pythonVersion: null,
        pytorchVersion: null,
        workflowRoot: "",
        workflowRootSource: "missing",
        capabilities: [],
        hardware: null,
        warnings: [],
        checkedAt,
      };
    }

    const resolvedRoot = resolveSpriteKilnRoot(settings.pixelBackendWorkflowRoot);
    if (!resolvedRoot) {
      return {
        state: "workflows_missing",
        message:
          "SpriteKiln workflow files were not found. Point Pixel Studio at an installed SpriteKiln checkout; Kirea does not install or copy it.",
        configured: true,
        reachable: false,
        apiUrl: config.apiUrl,
        comfyVersion: null,
        pythonVersion: null,
        pytorchVersion: null,
        workflowRoot: "",
        workflowRootSource: "missing",
        capabilities: CAPABILITIES.map((capability) => capabilityPlaceholder(capability, "Workflow files were not found.")),
        hardware: null,
        warnings: [],
        checkedAt,
      };
    }

    const api = this.createApiClient(config.apiUrl);
    let stats: Awaited<ReturnType<ComfyApiClient["getSystemStats"]>> | null = null;
    let objectInfo: Record<string, unknown> | null = null;
    let connectionError: string | null = null;
    try {
      stats = await api.getSystemStats();
    } catch (error) {
      connectionError = errorMessage(error);
    }
    if (stats) {
      objectInfo = await api.getAllObjectInfo().catch(() => null);
    }

    const warnings: string[] = [];
    const hardware = stats ? buildHardware(stats) : null;
    if (hardware) warnings.push(...hardware.warnings);
    const version = stats?.system?.comfyui_version ?? null;
    const versionState = checkComfyVersion(version);
    const versionOkay = versionState === "ok";
    if (stats) {
      if (versionState !== "ok") {
        warnings.push(
          versionState === "unknown"
            ? "ComfyUI version is unknown. SpriteKiln documents ComfyUI 0.41+; readiness cannot be confirmed."
            : `ComfyUI ${version} is older than the documented SpriteKiln baseline (0.41+).`
        );
      }
    }

    const capabilities: PixelAiCapabilityStatus[] = [];
    for (const capability of CAPABILITIES) {
      capabilities.push(
        await this.inspectCapability(
          capability,
          resolvedRoot.rootPath,
          objectInfo,
          connectionError,
          version
        )
      );
    }

    const anyMissing = capabilities.some((capability) =>
      capability.requirements.some((requirement) => requirement.state === "missing")
    );
    const missingModels = uniqueNames(
      capabilities.flatMap((capability) =>
        capability.requirements
          .filter((requirement) => requirement.kind === "model" && requirement.state === "missing")
          .map((requirement) => requirement.name)
      )
    );
    const missingNodes = uniqueNames(
      capabilities.flatMap((capability) =>
        capability.requirements
          .filter((requirement) => requirement.kind === "node" && requirement.state === "missing")
          .map((requirement) => requirement.name)
      )
    );
    const anyUnverified = capabilities.some((capability) => capability.unverified);
    const allFilesMissing = capabilities.every((capability) =>
      capability.requirements.some(
        (requirement) => requirement.kind === "workflow" && requirement.state === "missing"
      )
    );

    let state: PixelAiBackendStatus["state"];
    let message: string;
    if (!stats) {
      state = "unreachable";
      message = `The dedicated pixel backend at ${config.apiUrl} is not reachable. Start a separate ComfyUI instance with SpriteKiln installed. ${connectionError ?? ""}`.trim();
    } else if (allFilesMissing) {
      state = "workflows_missing";
      message = `No supported SpriteKiln API workflows were found in ${resolvedRoot.rootPath}.`;
    } else if (anyMissing) {
      const parts: string[] = [];
      if (missingModels.length > 0) {
        parts.push(`missing model${missingModels.length === 1 ? "" : "s"} ${summarizeNames(missingModels)}`);
      }
      if (missingNodes.length > 0) {
        parts.push(`missing node classes ${summarizeNames(missingNodes)}`);
      }
      state = "setup_required";
      message = `The dedicated pixel backend is reachable, but it has ${parts.join(" and ")}. Install them in that ComfyUI instance and restart it.`;
    } else if (anyUnverified || !versionOkay) {
      state = "unverified";
      message = "ComfyUI and SpriteKiln files were found, but at least one requirement could not be verified.";
    } else {
      state = "ready";
      message = "The dedicated pixel backend is connected and every inspected requirement is available.";
    }

    return {
      state,
      message,
      configured: true,
      reachable: Boolean(stats),
      apiUrl: config.apiUrl,
      comfyVersion: version,
      pythonVersion: stats?.system?.python_version ?? null,
      pytorchVersion: stats?.system?.pytorch_version ?? null,
      workflowRoot: resolvedRoot.rootPath,
      workflowRootSource: resolvedRoot.source,
      capabilities,
      hardware,
      warnings,
      checkedAt,
    };
  }

  async generate(
    jobId: string,
    input: PixelAiGenerateInput,
    onProgress: (progress: PixelAiProgress) => void,
    signal: AbortSignal
  ): Promise<PixelAiGenerationResult> {
    const config = this.getConfig();
    const root = resolveSpriteKilnRoot(this.getSettings().pixelBackendWorkflowRoot);
    if (!root) throw new Error("SpriteKiln workflow files were not found.");
    const capability = resolveCapability(input);
    const workflowPath = path.join(root.rootPath, "workflows", "api", capability.workflowFile);
    const graph = await readWorkflow(workflowPath);
    const palette = paletteColors(getPalettePreset(input.paletteId));
    const seed = input.seed ?? Math.floor(Math.random() * 4294967296);
    const api = this.createApiClient(config.apiUrl);
    const ws = this.createWsClient();
    const clientId = randomUUID();
    const tempFiles: string[] = [];
    let promptId: string | null = null;
    let wsExecutionError: string | null = null;
    let executionSucceeded = false;

    try {
      throwIfAborted(signal);
      const uploaded = await this.prepareInputs(jobId, input, api, tempFiles, signal);
      const reference = describeReference(input);
      const applied = applyOverrides(graph, capability, input, {
        seed,
        palette,
        uploaded,
      });
      ws.on("progress", (event: { promptId?: string; value: number; max: number; node?: string }) => {
        if (promptId && event.promptId && event.promptId !== promptId) return;
        onProgress({
          promptId: promptId ?? event.promptId,
          value: event.value,
          max: event.max,
          stage: event.node ? `Sampling ${event.node}` : "Sampling",
        });
      });
      ws.on("executing", (event: { node: string | null }) => {
        if (!event.node) return;
        const node = graph[event.node];
        onProgress({ stage: node ? `Running ${node._meta?.title ?? node.class_type}` : "Running" });
      });
      ws.on("execution_success", () => {
        executionSucceeded = true;
      });
      ws.on("execution_error", (event: { promptId?: string; exceptionMessage: string }) => {
        if (promptId && event.promptId && event.promptId !== promptId) return;
        wsExecutionError = event.exceptionMessage;
      });
      throwIfAborted(signal);
      ws.connect(api.getWsUrl(clientId));

      onProgress({ stage: "Submitting workflow" });
      let submitted: Awaited<ReturnType<ComfyApiClient["submitPrompt"]>>;
      try {
        submitted = await api.submitPrompt(graph as ComfyPromptGraph, clientId);
      } catch (error) {
        if (error instanceof ComfyApiError && error.statusCode === 400) {
          const detail = describeHttpRejection(error.bodyText);
          if (detail) {
            throw new Error(
              `ComfyUI rejected the workflow: ${detail}. Check that every required model and node is installed in the dedicated ComfyUI.`
            );
          }
        }
        throw error;
      }
      if (submitted.node_errors && Object.keys(submitted.node_errors).length > 0) {
        throw new Error(
          `ComfyUI rejected the workflow: ${describeSubmissionErrors(submitted.node_errors)}. Check that every required model and node is installed in the dedicated ComfyUI.`
        );
      }
      if (!submitted.prompt_id) {
        throw new Error(submitted.error?.message ?? "ComfyUI did not return a prompt id.");
      }
      promptId = submitted.prompt_id;
      this.activePrompts.set(promptId, jobId);
      onProgress({ promptId, stage: "Queued" });

      const output = await this.waitForOutput(api, promptId, capability.saveNode, {
        signal,
        onProgress,
        executionSucceeded: () => executionSucceeded,
        executionError: () => wsExecutionError,
      });
      const downloaded = await api.fetchOutputBuffer(
        output.filename,
        output.subfolder,
        output.type
      );
      const normalized = await this.normalizeOutput(downloaded, input.width, input.height);
      const metadata: PixelAiGenerationMetadata = {
        backend: "spritekiln",
        backendVersion: null,
        workflowId: capability.id,
        workflowFile: capability.workflowFile,
        model: applied.model,
        prompt: input.prompt.trim(),
        negativePrompt: input.negativePrompt?.trim() ?? "",
        seed,
        width: input.width,
        height: input.height,
        paletteId: input.paletteId,
        palette,
        style: input.style ?? null,
        timestamp: new Date().toISOString(),
        promptId,
        reference,
        settings: applied.settings,
        notes: [...capability.notes, ...applied.notes],
      };
      const stats = await api.getSystemStats().catch(() => null);
      metadata.backendVersion = stats?.system?.comfyui_version ?? null;
      this.logger.log(
        "INFO",
        "pixel",
        `SpriteKiln generated ${capability.id} for job ${jobId} (prompt ${promptId}).`
      );
      return {
        png: normalized.buffer,
        width: normalized.width,
        height: normalized.height,
        promptId,
        metadata,
      };
    } catch (error) {
      if (promptId) {
        await this.cancelPrompt(promptId).catch(() => undefined);
      }
      throw error;
    } finally {
      ws.disconnect();
      if (promptId) this.activePrompts.delete(promptId);
      await Promise.all(
        tempFiles.map((file) => fs.rm(file, { force: true }).catch(() => undefined))
      );
    }
  }

  async generateDirections(
    jobId: string,
    input: PixelAiGenerateInput,
    onProgress: (progress: PixelAiProgress) => void,
    signal: AbortSignal
  ): Promise<PixelAiDirectionResult> {
    const config = this.getConfig();
    const root = resolveSpriteKilnRoot(this.getSettings().pixelBackendWorkflowRoot);
    if (!root) throw new Error("SpriteKiln workflow files were not found.");
    const capability = CAPABILITIES[5]!;
    const workflowPath = path.join(root.rootPath, "workflows", "api", capability.workflowFile);
    const graph = await readWorkflow(workflowPath);
    const palette = paletteColors(getPalettePreset(input.paletteId));
    const seed = input.seed ?? Math.floor(Math.random() * 4294967296);
    const count: 4 | 8 = input.directionCount === 4 ? 4 : 8;
    const api = this.createApiClient(config.apiUrl);
    const ws = this.createWsClient();
    const clientId = randomUUID();
    const tempFiles: string[] = [];
    let promptId: string | null = null;
    let wsExecutionError: string | null = null;
    let executionSucceeded = false;

    try {
      throwIfAborted(signal);
      const uploaded = await this.prepareInputs(jobId, input, api, tempFiles, signal);
      const reference = describeReference(input);
      const applied = applyOverrides(graph, capability, input, { seed, palette, uploaded });
      ws.on("progress", (event: { promptId?: string; value: number; max: number; node?: string }) => {
        if (promptId && event.promptId && event.promptId !== promptId) return;
        onProgress({
          promptId: promptId ?? event.promptId,
          value: event.value,
          max: event.max,
          stage: event.node ? `Sampling ${event.node}` : "Sampling",
        });
      });
      ws.on("executing", (event: { node: string | null }) => {
        if (!event.node) return;
        const node = graph[event.node];
        onProgress({ stage: node ? `Running ${node._meta?.title ?? node.class_type}` : "Running" });
      });
      ws.on("execution_success", () => {
        executionSucceeded = true;
      });
      ws.on("execution_error", (event: { promptId?: string; exceptionMessage: string }) => {
        if (promptId && event.promptId && event.promptId !== promptId) return;
        wsExecutionError = event.exceptionMessage;
      });
      throwIfAborted(signal);
      ws.connect(api.getWsUrl(clientId));

      onProgress({ stage: "Submitting direction workflow" });
      let submitted: Awaited<ReturnType<ComfyApiClient["submitPrompt"]>>;
      try {
        submitted = await api.submitPrompt(graph as ComfyPromptGraph, clientId);
      } catch (error) {
        if (error instanceof ComfyApiError && error.statusCode === 400) {
          const detail = describeHttpRejection(error.bodyText);
          if (detail) {
            throw new Error(
              `ComfyUI rejected the workflow: ${detail}. Check that every required model and node is installed in the dedicated ComfyUI.`
            );
          }
        }
        throw error;
      }
      if (submitted.node_errors && Object.keys(submitted.node_errors).length > 0) {
        throw new Error(
          `ComfyUI rejected the workflow: ${describeSubmissionErrors(submitted.node_errors)}. Check that every required model and node is installed in the dedicated ComfyUI.`
        );
      }
      if (!submitted.prompt_id) {
        throw new Error(submitted.error?.message ?? "ComfyUI did not return a prompt id.");
      }
      promptId = submitted.prompt_id;
      this.activePrompts.set(promptId, jobId);
      onProgress({ promptId, stage: "Queued" });

      const entry = await this.waitForHistory(api, promptId, capability.saveNode, {
        signal,
        onProgress,
        executionSucceeded: () => executionSucceeded,
        executionError: () => wsExecutionError,
      });
      const files = pickOutputs(entry, capability.saveNode);
      const labels = DIRECTION_LABELS[count];
      if (files.length !== labels.length) {
        throw new Error(
          `SpriteKiln returned ${files.length} direction images; expected ${labels.length}. Check the direction workflow outputs.`
        );
      }
      const images: PixelAiDirectionImage[] = [];
      for (const [index, file] of files.entries()) {
        onProgress({ stage: `Importing direction ${labels[index]}` });
        const downloaded = await api.fetchOutputBuffer(file.filename, file.subfolder, file.type);
        const normalized = await this.normalizeOutput(downloaded, input.width, input.height);
        images.push({
          label: labels[index]!,
          png: normalized.buffer,
          width: normalized.width,
          height: normalized.height,
        });
      }
      const metadata: PixelAiGenerationMetadata = {
        backend: "spritekiln",
        backendVersion: null,
        workflowId: capability.id,
        workflowFile: capability.workflowFile,
        model: applied.model,
        prompt: input.prompt.trim(),
        negativePrompt: input.negativePrompt?.trim() ?? "",
        seed,
        width: input.width,
        height: input.height,
        paletteId: input.paletteId,
        palette,
        style: input.style ?? null,
        timestamp: new Date().toISOString(),
        promptId,
        reference,
        settings: applied.settings,
        notes: [...capability.notes, ...applied.notes],
      };
      const stats = await api.getSystemStats().catch(() => null);
      metadata.backendVersion = stats?.system?.comfyui_version ?? null;
      this.logger.log(
        "INFO",
        "pixel",
        `SpriteKiln generated ${images.length} directions for job ${jobId} (prompt ${promptId}).`
      );
      return { images, promptId, metadata };
    } catch (error) {
      if (promptId) {
        await this.cancelPrompt(promptId).catch(() => undefined);
      }
      throw error;
    } finally {
      ws.disconnect();
      if (promptId) this.activePrompts.delete(promptId);
      await Promise.all(
        tempFiles.map((file) => fs.rm(file, { force: true }).catch(() => undefined))
      );
    }
  }

  async cancelPrompt(promptId: string): Promise<void> {
    const config = this.getConfig();
    const api = this.createApiClient(config.apiUrl);
    await api.deleteQueueItems([promptId]).catch(() => undefined);
    await api.interrupt(promptId).catch(() => undefined);
  }

  private async inspectCapability(
    capability: CapabilityDescriptor,
    rootPath: string,
    objectInfo: Record<string, unknown> | null,
    connectionError: string | null,
    version: string | null
  ): Promise<PixelAiCapabilityStatus> {
    const workflowPath = path.join(rootPath, "workflows", "api", capability.workflowFile);
    const requirements: PixelAiRequirement[] = [];
    const notes = [...capability.notes];
    let graph: PromptGraph;
    try {
      graph = await readWorkflow(workflowPath);
      requirements.push({
        kind: "workflow",
        name: capability.workflowFile,
        state: "available",
        detail: workflowPath,
      });
    } catch (error) {
      requirements.push({
        kind: "workflow",
        name: capability.workflowFile,
        state: "missing",
        detail: errorMessage(error),
      });
      return {
        id: capability.id,
        label: capability.label,
        mode: capability.mode,
        workflowFile: capability.workflowFile,
        ready: false,
        unverified: false,
        requirements,
        notes,
      };
    }

    const nodes = collectAncestors(graph, capability.saveNode);
    if (!nodes.size) {
      requirements.push({
        kind: "workflow",
        name: capability.workflowFile,
        state: "unverified",
        detail: `Save node ${capability.saveNode} was not found in the API workflow.`,
      });
    }

    if (!objectInfo) {
      for (const nodeId of nodes) {
        const node = graph[nodeId]!;
        requirements.push({
          kind: "node",
          name: node.class_type,
          state: "unverified",
          detail: connectionError ?? "ComfyUI /object_info was unavailable.",
        });
      }
      notes.push("Node and model availability could not be verified against ComfyUI.");
      return {
        id: capability.id,
        label: capability.label,
        mode: capability.mode,
        workflowFile: capability.workflowFile,
        ready: false,
        unverified: true,
        requirements: dedupeRequirements(requirements),
        notes,
      };
    }

    for (const nodeId of nodes) {
      const node = graph[nodeId]!;
      const nodeInfo = objectInfo[node.class_type];
      requirements.push({
        kind: "node",
        name: node.class_type,
        state: nodeInfo ? "available" : "missing",
        detail: nodeInfo
          ? null
          : `Node class ${node.class_type} is not installed in the dedicated ComfyUI. Install the SpriteKiln node pack, then restart ComfyUI.`,
      });
      const modelSpec = MODEL_INPUTS[node.class_type];
      if (!modelSpec) continue;
      const modelValue = node.inputs[modelSpec.field];
      if (typeof modelValue !== "string" || !modelValue.trim()) continue;
      if (!nodeInfo) {
        requirements.push({
          kind: "model",
          name: modelValue,
          state: "missing",
          detail: `The ${node.class_type} loader is not installed in the dedicated ComfyUI.`,
        });
        continue;
      }
      const options = modelOptions(objectInfo, node.class_type, modelSpec.field);
      if (!options) {
        requirements.push({
          kind: "model",
          name: modelValue,
          state: "unverified",
          detail: `ComfyUI did not expose an enumerable model list for ${node.class_type}.${modelSpec.field}.`,
        });
        continue;
      }
      const present = options.includes(modelValue);
      requirements.push({
        kind: "model",
        name: modelValue,
        state: present ? "available" : "missing",
        detail: present
          ? null
          : `Missing ${modelValue}. Place it in models/${modelSpec.folder}/ of the dedicated ComfyUI, then restart ComfyUI.`,
      });
    }

    if (version === null) {
      notes.push("ComfyUI version is unknown; the documented 0.41+ baseline cannot be confirmed.");
    } else if (checkComfyVersion(version) !== "ok") {
      notes.push(`ComfyUI ${version} is below the documented 0.41+ baseline.`);
    }

    const unique = dedupeRequirements(requirements);
    const versionOkay = version !== null && checkComfyVersion(version) === "ok";
    return {
      id: capability.id,
      label: capability.label,
      mode: capability.mode,
      workflowFile: capability.workflowFile,
      ready:
        unique.length > 0 &&
        unique.every((requirement) => requirement.state === "available") &&
        versionOkay,
      unverified: !versionOkay || unique.some((requirement) => requirement.state === "unverified"),
      requirements: unique,
      notes,
    };
  }

  private async prepareInputs(
    jobId: string,
    input: PixelAiGenerateInput,
    api: ComfyApiClient,
    tempFiles: string[],
    signal: AbortSignal
  ): Promise<Partial<Record<"image" | "subject" | "style" | "inpaint", string>>> {
    const uploaded: Partial<Record<"image" | "subject" | "style" | "inpaint", string>> = {};
    const roles: Array<["image" | "subject" | "style" | "inpaint", PixelAiImageInput | undefined]> =
      input.mode === "image"
        ? [["image", input.image]]
        : input.mode === "reference"
          ? [
              ["subject", input.reference?.subject],
              ["style", input.reference?.style ?? input.reference?.subject],
            ]
          : input.mode === "directions"
            ? [["subject", input.reference?.subject]]
            : input.mode === "inpaint"
            ? [["inpaint", input.inpaint?.base]]
            : [];
    for (const [role, source] of roles) {
      if (!source) throw new Error(`A ${role} image is required for ${input.mode} generation.`);
      throwIfAborted(signal);
      const buffer = await this.readImageInput(source);
      const normalized = await sharp(buffer)
        .rotate()
        .png()
        .toBuffer();
      const metadata = await sharp(normalized).metadata();
      if (!metadata.width || !metadata.height) throw new Error("The supplied image could not be decoded.");
      if (metadata.width > 4096 || metadata.height > 4096) {
        throw new Error("Reference images must be 4096 px or smaller per side.");
      }
      const fileName = `${jobId}-${role}.png`;
      const filePath = path.join(this.paths.pixelAiTempDir, fileName);
      await fs.mkdir(this.paths.pixelAiTempDir, { recursive: true });
      await fs.writeFile(filePath, normalized, { flush: true });
      tempFiles.push(filePath);
      const result = await api.uploadImage(filePath, false);
      uploaded[role] = result.name;
    }
    return uploaded;
  }

  private async readImageInput(source: PixelAiImageInput): Promise<Buffer> {
    if (source.kind === "asset") {
      const asset = this.repo.pixel.getAsset(source.assetId);
      if (!asset) throw new Error("The selected reference asset was not found.");
      if (source.frameIndex !== undefined) {
        const frame = this.repo.pixel
          .getFrames(asset.id)
          .find((entry) => entry.index === source.frameIndex);
        if (!frame) throw new Error("The selected reference frame was not found.");
        return fs.readFile(frame.filePath);
      }
      return fs.readFile(asset.previewPath);
    }
    const match = IMAGE_DATA_URL.exec(source.dataUrl.trim());
    if (!match) throw new Error("Reference images must be PNG, JPEG or WebP data URLs.");
    const buffer = Buffer.from(match[1]!, "base64");
    if (buffer.length > 20 * 1024 * 1024) throw new Error("Reference images must be 20 MB or smaller.");
    return buffer;
  }

  private async normalizeOutput(
    buffer: Buffer,
    width: number,
    height: number
  ): Promise<{ buffer: Buffer; width: number; height: number }> {
    const metadata = await sharp(buffer).metadata();
    if (!metadata.width || !metadata.height) throw new Error("SpriteKiln returned an undecodable image.");
    let output = buffer;
    if (metadata.width !== width || metadata.height !== height) {
      output = await sharp(buffer)
        .resize(width, height, { kernel: "nearest", fit: "fill" })
        .png()
        .toBuffer();
    }
    const engine = await loadPixelEngine();
    const decoded = engine.decodePNG(output);
    if (decoded.width !== width || decoded.height !== height) {
      throw new Error(
        `SpriteKiln returned ${decoded.width}×${decoded.height}; expected ${width}×${height}.`
      );
    }
    return { buffer: output, width: decoded.width, height: decoded.height };
  }

  private async waitForOutput(
    api: ComfyApiClient,
    promptId: string,
    saveNode: string,
    options: {
      signal: AbortSignal;
      onProgress: (progress: PixelAiProgress) => void;
      executionSucceeded: () => boolean;
      executionError: () => string | null;
    }
  ): Promise<ComfyHistoryOutputFile> {
    const entry = await this.waitForHistory(api, promptId, saveNode, options);
    const file = pickOutput(entry, saveNode);
    if (!file) {
      throw new Error("ComfyUI completed the workflow but returned no saved PNG for the selected output node.");
    }
    return file;
  }

  private async waitForHistory(
    api: ComfyApiClient,
    promptId: string,
    saveNode: string,
    options: {
      signal: AbortSignal;
      onProgress: (progress: PixelAiProgress) => void;
      executionSucceeded: () => boolean;
      executionError: () => string | null;
    }
  ): Promise<ComfyHistoryEntry> {
    const startedAt = Date.now();
    const deadline = startedAt + this.timeoutMs;
    let missingSince: number | null = null;
    let consecutiveFailures = 0;
    while (Date.now() < deadline) {
      throwIfAborted(options.signal);
      const wsError = options.executionError();
      if (wsError) throw new Error(`ComfyUI execution failed: ${wsError}`);
      const entry = await api.getHistory(promptId).catch((error: unknown) => {
        consecutiveFailures += 1;
        if (consecutiveFailures >= 5) throw new Error(`Lost connection to ComfyUI: ${errorMessage(error)}`);
        return null;
      });
      if (entry) {
        consecutiveFailures = 0;
        const failure = historyFailure(entry);
        if (failure) throw new Error(failure);
        if (pickOutput(entry, saveNode)) return entry;
        if (entry.status?.completed || options.executionSucceeded()) {
          throw new Error("ComfyUI completed the workflow but returned no saved PNG for the selected output node.");
        }
      }
      const queue = await api.getQueue().catch(() => null);
      if (queue) consecutiveFailures = 0;
      const inQueue = queue
        ? [...queue.queue_running, ...queue.queue_pending].some((item) => item[1] === promptId)
        : null;
      if (inQueue) {
        missingSince = null;
        options.onProgress({
          promptId,
          stage: queue?.queue_running.some((item) => item[1] === promptId) ? "Running" : "Queued",
        });
      } else if (inQueue === false) {
        missingSince ??= Date.now();
        const grace = options.executionSucceeded() ? 10_000 : 30_000;
        if (Date.now() - missingSince > grace) {
          throw new Error(
            options.executionSucceeded()
              ? "ComfyUI executed the workflow but no history or output appeared."
              : "ComfyUI no longer lists this prompt in its queue or history. It may have been interrupted or the backend restarted."
          );
        }
      }
      await delay(this.pollMs, options.signal);
    }
    throw new Error(
      `Pixel generation timed out after ${Math.round(this.timeoutMs / 1000)} seconds. Cancel the job or check the dedicated ComfyUI instance.`
    );
  }
}

function resolveCapability(input: PixelAiGenerateInput): CapabilityDescriptor {
  if (input.mode === "text") return CAPABILITIES[0]!;
  if (input.mode === "image") {
    return input.conversion === "direct" ? CAPABILITIES[1]! : CAPABILITIES[2]!;
  }
  if (input.mode === "reference") return CAPABILITIES[3]!;
  if (input.mode === "directions") return CAPABILITIES[5]!;
  return CAPABILITIES[4]!;
}

function applyOverrides(
  graph: PromptGraph,
  capability: CapabilityDescriptor,
  input: PixelAiGenerateInput,
  context: { seed: number; palette: string[]; uploaded: Partial<Record<"image" | "subject" | "style" | "inpaint", string>> }
): { model: string; settings: Record<string, string | number | boolean>; notes: string[] } {
  const set = (nodeId: string, key: string, value: unknown): void => {
    const node = graph[nodeId];
    if (!node) throw new Error(`SpriteKiln workflow is missing node ${nodeId}.`);
    node.inputs[key] = value;
  };
  const paletteHex = context.palette.join(" ");
  const paletteCount = Math.max(2, Math.min(256, context.palette.length));
  const saveNode = capability.saveNode;
  set(saveNode, "upscale", 1);
  set(saveNode, "filename_prefix", `spritekiln/kirea_${randomUUID()}`);
  set(saveNode, "as_animation", false);

  const style = input.style && SPRITEKILN_STYLES.includes(input.style as (typeof SPRITEKILN_STYLES)[number])
    ? input.style
    : capability.mode === "text"
      ? "game asset"
      : "default";
  const longSide = clamp(input.longSide ?? 1024, 512, 2048);
  const transparent = input.transparent !== false;
  const settings: Record<string, string | number | boolean> = {
    style,
    transparent,
    longSide,
  };
  const notes: string[] = [];

  switch (capability.id) {
    case "text_to_pixel": {
      set("2", "subject", input.prompt.trim());
      set("2", "style", style);
      set("2", "model", "z_image (pixel LoRA)");
      set("2", "art_width", input.width);
      set("2", "art_height", input.height);
      set("2", "colors", paletteCount);
      set("2", "background", transparent ? "white" : "scene");
      set("2", "long_side", longSide);
      set("11", "seed", context.seed);
      if (input.steps !== undefined) set("11", "steps", clamp(input.steps, 1, 40));
      set("18", "source", "hex");
      set("18", "hex_palette", paletteHex);
      set("18", "colors", paletteCount);
      set("18", "dither", "none");
      settings.steps = input.steps ?? 8;
      break;
    }
    case "image_to_pixel_direct":
    case "image_to_pixel_ai": {
      const image = context.uploaded.image;
      if (!image) throw new Error("An input image is required.");
      set("2", "image", image);
      set("3", "value", input.width);
      set("4", "value", input.height);
      set("5", "value", paletteCount);
      if (capability.id === "image_to_pixel_ai") {
        set("16", "text", input.prompt.trim() || "Pixel art. crisp pixels, limited palette, retro game graphics");
        set("18", "seed", context.seed);
        if (input.steps !== undefined) set("18", "steps", clamp(input.steps, 1, 30));
        set("18", "denoise", clamp(input.strength ?? 0.6, 0.05, 1));
        set("22", "source", "hex");
        set("22", "hex_palette", paletteHex);
        set("22", "colors", paletteCount);
        set("22", "dither", "none");
        settings.strength = clamp(input.strength ?? 0.6, 0.05, 1);
        settings.steps = input.steps ?? 8;
        notes.push("Transparency is not applied by the upstream image redraw workflow.");
      } else {
        set("7", "source", "hex");
        set("7", "hex_palette", paletteHex);
        set("7", "colors", paletteCount);
        set("7", "dither", "none");
        notes.push("Direct conversion preserves the source alpha channel; it does not remove a background.");
      }
      break;
    }
    case "reference_to_pixel": {
      const subject = context.uploaded.subject;
      const styleImage = context.uploaded.style;
      if (!subject || !styleImage) throw new Error("Subject and style references are required.");
      set("7", "image", subject);
      set("8", "image", styleImage);
      set("2", "subject", input.prompt.trim());
      set("2", "style", style);
      set("2", "model", "flux2 klein (pixel LoRA)");
      set("2", "art_width", input.width);
      set("2", "art_height", input.height);
      set("2", "colors", paletteCount);
      set("2", "background", transparent ? "white" : "scene");
      set("2", "long_side", longSide);
      set("4", "strength_model", clamp(input.strength ?? 0.7, 0, 2));
      set("19", "noise_seed", context.seed);
      set("31", "source", "hex");
      set("31", "hex_palette", paletteHex);
      set("31", "colors", paletteCount);
      set("31", "dither", "none");
      settings.referenceStrength = clamp(input.strength ?? 0.7, 0, 2);
      if (!input.reference?.style) notes.push("No style reference was supplied; the subject reference was reused.");
      break;
    }
    case "inpaint_pixel": {
      const image = context.uploaded.inpaint;
      const region = input.inpaint?.region;
      if (!image || !region) throw new Error("A source image and edit region are required.");
      const x = clamp(Math.round(region.x), 0, input.width - 1);
      const y = clamp(Math.round(region.y), 0, input.height - 1);
      const width = clamp(Math.round(region.width), 1, input.width - x);
      const height = clamp(Math.round(region.height), 1, input.height - y);
      set("2", "image", image);
      set("4", "x", x);
      set("4", "y", y);
      set("4", "width", width);
      set("4", "height", height);
      set("4", "grow", clamp(Math.round(region.grow ?? 1), 0, 8));
      set("5", "long_side", longSide);
      set("12", "text", input.prompt.trim());
      set("16", "noise_seed", context.seed);
      set("23", "width", input.width);
      set("23", "height", input.height);
      set("25", "source", "hex");
      set("25", "hex_palette", paletteHex);
      set("25", "colors", paletteCount);
      set("25", "dither", "none");
      settings.region = `${x},${y},${width},${height}`;
      notes.push("The edit region is rectangular; pixels outside it are copied from the source by the upstream merge node.");
      break;
    }
    case "directional_set": {
      const source = context.uploaded.subject;
      if (!source) throw new Error("A front-facing source sprite is required.");
      const count = input.directionCount === 4 ? 4 : 8;
      set("2", "image", source);
      set("4", "long_side", longSide);
      set("4", "background", "gray");
      set("5", "directions", String(count));
      set("5", "mirror_west", true);
      set("5", "background", "gray");
      set("15", "noise_seed", context.seed);
      set("22", "width", input.width);
      set("22", "height", input.height);
      set("22", "colors", paletteCount);
      set("24", "source", "hex");
      set("24", "hex_palette", paletteHex);
      set("24", "colors", paletteCount);
      set("24", "dither", "none");
      set("24", "shared_palette", true);
      settings.directionCount = count;
      settings.mirrorWest = true;
      settings.longSide = longSide;
      notes.push(
        "The source sprite must face the viewer (front). West-facing results are mirrored from east renders."
      );
      break;
    }
  }

  const nodes = collectAncestors(graph, saveNode);
  const models = [...nodes]
    .map((nodeId) => graph[nodeId]!)
    .filter((node) => MODEL_INPUTS[node.class_type])
    .map((node) => String(node.inputs[MODEL_INPUTS[node.class_type]!.field] ?? ""))
    .filter(Boolean);
  return {
    model: models.length ? [...new Set(models)].join(" + ") : "none",
    settings,
    notes,
  };
}

function describeReference(input: PixelAiGenerateInput): PixelAiReferenceMetadata | null {
  if (input.mode !== "reference" && input.mode !== "directions") return null;
  const label = (source: PixelAiImageInput | undefined): { source: "asset" | "upload"; label: string } | null => {
    if (!source) return null;
    return source.kind === "asset"
      ? { source: "asset", label: source.assetId }
      : { source: "upload", label: source.fileName ?? "uploaded image" };
  };
  const subject = label(input.reference?.subject);
  if (!subject) return null;
  return { subject, style: label(input.reference?.style) };
}

async function readWorkflow(filePath: string): Promise<PromptGraph> {
  let text: string;
  try {
    text = await fs.readFile(filePath, "utf8");
  } catch {
    throw new Error(`SpriteKiln workflow file was not found: ${filePath}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`SpriteKiln workflow is not valid JSON: ${path.basename(filePath)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`SpriteKiln workflow is not an API-format graph: ${path.basename(filePath)}`);
  }
  const graph = parsed as Record<string, unknown>;
  for (const value of Object.values(graph)) {
    if (!value || typeof value !== "object") continue;
    const node = value as { class_type?: unknown; inputs?: unknown };
    if (typeof node.class_type !== "string" || !node.inputs || typeof node.inputs !== "object") {
      throw new Error(`SpriteKiln workflow contains an invalid node: ${path.basename(filePath)}`);
    }
  }
  return graph as PromptGraph;
}

function collectAncestors(graph: PromptGraph, saveNode: string): Set<string> {
  const seen = new Set<string>();
  const stack = [saveNode];
  while (stack.length) {
    const nodeId = stack.pop()!;
    if (seen.has(nodeId) || !graph[nodeId]) continue;
    seen.add(nodeId);
    for (const value of Object.values(graph[nodeId]!.inputs)) {
      if (!Array.isArray(value) || value.length === 0) continue;
      const linked = value[0];
      if (typeof linked === "string" && graph[linked]) stack.push(linked);
    }
  }
  return seen;
}

function modelOptions(
  objectInfo: Record<string, unknown>,
  classType: string,
  inputName: string
): string[] | null {
  const info = objectInfo[classType] as
    | { input?: { required?: Record<string, unknown>; optional?: Record<string, unknown> } }
    | undefined;
  const spec =
    info?.input?.required?.[inputName] ?? info?.input?.optional?.[inputName];
  if (!Array.isArray(spec)) return null;
  if (Array.isArray(spec[0])) {
    return spec[0].filter((entry): entry is string => typeof entry === "string");
  }
  if (spec[0] === "COMBO") {
    const options = (spec[1] as { options?: unknown } | undefined)?.options;
    if (Array.isArray(options)) {
      return options.filter((entry): entry is string => typeof entry === "string");
    }
  }
  return null;
}

function historyFailure(entry: ComfyHistoryEntry): string | null {
  if (entry.status?.status_str !== "error") return null;
  const failure = entry.status.messages?.find((message) => message[0] === "execution_error");
  const data = failure?.[1] as { exception_message?: unknown; exception_type?: unknown } | undefined;
  if (typeof data?.exception_message === "string" && data.exception_message.trim()) {
    return `ComfyUI execution failed: ${data.exception_message}`;
  }
  return "ComfyUI execution failed without an exception message.";
}

function pickOutput(entry: ComfyHistoryEntry, saveNode: string): ComfyHistoryOutputFile | null {
  const images = entry.outputs?.[saveNode]?.images;
  if (!Array.isArray(images) || images.length === 0) return null;
  const native = images.find(
    (image) => image.type === "output" && /\.png$/i.test(image.filename) && !/_x\d+\.png$/i.test(image.filename)
  );
  return native ?? images.find((image) => image.type === "output") ?? images[0] ?? null;
}

function pickOutputs(entry: ComfyHistoryEntry, saveNode: string): ComfyHistoryOutputFile[] {
  const images = entry.outputs?.[saveNode]?.images;
  if (!Array.isArray(images)) return [];
  const natives = images.filter(
    (image) => image.type === "output" && /\.png$/i.test(image.filename) && !/_x\d+\.png$/i.test(image.filename)
  );
  return natives.sort((a, b) => a.filename.localeCompare(b.filename, undefined, { numeric: true }));
}

function buildHardware(stats: {
  system?: { ram_total?: number; ram_free?: number };
  devices?: Array<{ name: string; type: string; vram_total: number; vram_free: number }>;
}) {
  const devices = (stats.devices ?? []).map((device) => ({
    name: device.name,
    type: device.type,
    vramTotalBytes: device.vram_total,
    vramFreeBytes: device.vram_free,
  }));
  const warnings: string[] = [];
  if (devices.length === 0 || devices.every((device) => device.type === "cpu")) {
    warnings.push("ComfyUI reports CPU-only execution. SpriteKiln workflows are designed for GPU execution.");
  }
  for (const device of devices) {
    if (device.vramTotalBytes > 0 && device.vramTotalBytes < 8 * 1024 ** 3) {
      warnings.push(`${device.name} has less than 8 GB VRAM; SpriteKiln workflows may run out of memory.`);
    } else if (device.vramFreeBytes > 0 && device.vramFreeBytes < 4 * 1024 ** 3) {
      warnings.push(`${device.name} has less than 4 GB VRAM free. Close other GPU workloads before generating.`);
    }
  }
  return {
    devices,
    ramTotalBytes: stats.system?.ram_total ?? null,
    ramFreeBytes: stats.system?.ram_free ?? null,
    warnings,
  };
}

function checkComfyVersion(version: string | null): "ok" | "old" | "unknown" {
  if (!version) return "unknown";
  const match = /(\d+)\.(\d+)/.exec(version);
  if (!match) return "unknown";
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 0 || minor >= 41 ? "ok" : "old";
}

function capabilityPlaceholder(
  capability: CapabilityDescriptor,
  detail: string
): PixelAiCapabilityStatus {
  return {
    id: capability.id,
    label: capability.label,
    mode: capability.mode,
    workflowFile: capability.workflowFile,
    ready: false,
    unverified: false,
    requirements: [
      { kind: "workflow", name: capability.workflowFile, state: "missing", detail },
    ],
    notes: capability.notes,
  };
}

function dedupeRequirements(requirements: PixelAiRequirement[]): PixelAiRequirement[] {
  const seen = new Set<string>();
  const result: PixelAiRequirement[] = [];
  for (const requirement of requirements) {
    const key = `${requirement.kind}:${requirement.name}:${requirement.state}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(requirement);
  }
  return result;
}

function uniqueNames(names: string[]): string[] {
  return [...new Set(names)];
}

function summarizeNames(names: string[], limit = 6): string {
  if (names.length <= limit) return names.join(", ");
  return `${names.slice(0, limit).join(", ")} (+${names.length - limit} more)`;
}

function describeHttpRejection(bodyText: string | undefined): string | null {
  if (!bodyText || !bodyText.trim()) return null;
  try {
    const parsed = JSON.parse(bodyText) as {
      node_errors?: Record<string, unknown>;
      error?: { message?: unknown; details?: unknown };
    };
    if (parsed.node_errors && Object.keys(parsed.node_errors).length > 0) {
      return describeSubmissionErrors(parsed.node_errors);
    }
    const details = typeof parsed.error?.details === "string" ? parsed.error.details.trim() : "";
    const message = typeof parsed.error?.message === "string" ? parsed.error.message.trim() : "";
    return details || message || null;
  } catch {
    return bodyText.trim().slice(0, 300);
  }
}

function describeSubmissionErrors(errors: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [nodeId, raw] of Object.entries(errors)) {
    const entry = raw as { class_type?: unknown; errors?: unknown };
    const classType = typeof entry?.class_type === "string" ? entry.class_type : `node ${nodeId}`;
    const list = Array.isArray(entry?.errors) ? entry.errors : [];
    for (const item of list) {
      const error = item as { message?: unknown; details?: unknown };
      if (typeof error?.details === "string" && error.details.trim()) {
        parts.push(`${classType}: ${error.details.trim()}`);
      } else if (typeof error?.message === "string" && error.message.trim()) {
        parts.push(`${classType}: ${error.message.trim()}`);
      }
    }
  }
  return parts.length > 0 ? parts.slice(0, 4).join("; ") : JSON.stringify(errors);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new PixelAiCancelledError());
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new PixelAiCancelledError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new PixelAiCancelledError();
}

function errorMessage(error: unknown): string {
  if (error instanceof ComfyApiError) {
    return error.bodyText ? `${error.message}: ${error.bodyText.slice(0, 300)}` : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}
