import fs from "node:fs";
import path from "node:path";
import type {
  ComfyHistoryEntry,
  ComfyHistoryResponse,
  ComfyPromptGraph,
  ComfyPromptSubmitResponse,
  ComfyQueueResponse,
  ComfySystemStatsResponse,
} from "./comfy-types";

export class ComfyApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly bodyText?: string
  ) {
    super(message);
    this.name = "ComfyApiError";
  }
}

export class ComfyApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  setBaseUrl(baseUrl: string): void {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  getWsUrl(clientId: string): string {
    const wsBase = this.baseUrl.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:");
    return `${wsBase}/ws?clientId=${encodeURIComponent(clientId)}`;
  }

  private async requestJson<T>(
    endpoint: string,
    init?: RequestInit & { timeoutMs?: number }
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), init?.timeoutMs ?? 8000);
    try {
      const res = await fetch(`${this.baseUrl}${endpoint}`, {
        ...init,
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new ComfyApiError(
          `ComfyUI ${init?.method ?? "GET"} ${endpoint} failed (${res.status})`,
          res.status,
          text
        );
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  async getSystemStats(): Promise<ComfySystemStatsResponse> {
    return this.requestJson<ComfySystemStatsResponse>("/system_stats", { timeoutMs: 4000 });
  }

  async getObjectInfoNode(nodeClass: string): Promise<Record<string, unknown>> {
    return this.requestJson<Record<string, unknown>>(
      `/object_info/${encodeURIComponent(nodeClass)}`,
      { timeoutMs: 5000 }
    );
  }

  /**
   * Feature-detects whether a ComfyUI node class is registered on the connected server.
   */
  async hasNode(nodeClass: string): Promise<boolean> {
    try {
      const info = await this.getObjectInfoNode(nodeClass);
      return Boolean(info && typeof info === "object" && nodeClass in info);
    } catch {
      return false;
    }
  }

  async getAllObjectInfo(): Promise<Record<string, unknown>> {
    return this.requestJson<Record<string, unknown>>("/object_info", { timeoutMs: 12000 });
  }

  async getSamplersAndSchedulers(): Promise<{ samplers: string[]; schedulers: string[] }> {
    try {
      const info = await this.getObjectInfoNode("KSampler");
      const kSampler = info.KSampler as
        | { input?: { required?: Record<string, unknown[]> } }
        | undefined;
      const req = kSampler?.input?.required;
      const samplers = Array.isArray(req?.sampler_name?.[0])
        ? (req.sampler_name[0] as string[])
        : [];
      const schedulers = Array.isArray(req?.scheduler?.[0])
        ? (req.scheduler[0] as string[])
        : [];
      return { samplers, schedulers };
    } catch {
      return { samplers: [], schedulers: [] };
    }
  }

  async listModels(folder: string): Promise<string[]> {
    try {
      return await this.requestJson<string[]>(`/models/${encodeURIComponent(folder)}`, {
        timeoutMs: 5000,
      });
    } catch {
      return [];
    }
  }

  async submitPrompt(
    prompt: ComfyPromptGraph,
    clientId: string
  ): Promise<ComfyPromptSubmitResponse> {
    return this.requestJson<ComfyPromptSubmitResponse>("/prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, client_id: clientId }),
      timeoutMs: 15000,
    });
  }

  async getQueue(): Promise<ComfyQueueResponse> {
    return this.requestJson<ComfyQueueResponse>("/queue", { timeoutMs: 4000 });
  }

  async getHistory(promptId: string): Promise<ComfyHistoryEntry | null> {
    const res = await this.requestJson<ComfyHistoryResponse>(
      `/history/${encodeURIComponent(promptId)}`,
      { timeoutMs: 5000 }
    );
    return res[promptId] ?? null;
  }

  async interrupt(promptId?: string): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(`${this.baseUrl}/interrupt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(promptId ? { prompt_id: promptId } : {}),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new ComfyApiError(`ComfyUI /interrupt failed (${res.status})`, res.status, text);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  async deleteQueueItems(promptIds: string[]): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(`${this.baseUrl}/queue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delete: promptIds }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new ComfyApiError(`ComfyUI /queue delete failed (${res.status})`, res.status);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  async uploadImage(
    localFilePath: string,
    overwrite = true
  ): Promise<{ name: string; subfolder: string; type: string }> {
    const buffer = await fs.promises.readFile(localFilePath);
    const fileName = path.basename(localFilePath);
    const ext = path.extname(fileName).toLowerCase();
    const mime =
      ext === ".jpg" || ext === ".jpeg"
        ? "image/jpeg"
        : ext === ".webp"
          ? "image/webp"
          : "image/png";

    const form = new FormData();
    form.append("image", new Blob([buffer], { type: mime }), fileName);
    form.append("type", "input");
    form.append("overwrite", overwrite ? "true" : "false");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(`${this.baseUrl}/upload/image`, {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new ComfyApiError(`Upload image failed (${res.status})`, res.status, text);
      }
      return (await res.json()) as { name: string; subfolder: string; type: string };
    } finally {
      clearTimeout(timeout);
    }
  }

  async fetchOutputBuffer(
    filename: string,
    subfolder = "",
    type: "output" | "temp" | "input" = "output"
  ): Promise<Buffer> {
    const params = new URLSearchParams({ filename, subfolder, type });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch(`${this.baseUrl}/view?${params.toString()}`, {
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new ComfyApiError(
          `Failed to retrieve output ${filename} (${res.status})`,
          res.status
        );
      }
      const arr = await res.arrayBuffer();
      return Buffer.from(arr);
    } finally {
      clearTimeout(timeout);
    }
  }
}

