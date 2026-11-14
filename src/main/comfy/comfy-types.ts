import { z } from "zod";

export const ComfyNodeSchema = z.object({
  inputs: z.record(z.string(), z.unknown()),
  class_type: z.string(),
  _meta: z
    .object({
      title: z.string().optional(),
    })
    .optional(),
});

export type ComfyNode = z.infer<typeof ComfyNodeSchema>;
export type ComfyPromptGraph = Record<string, ComfyNode>;

export interface ComfySystemStatsResponse {
  system: {
    os: string;
    ram_total: number;
    ram_free: number;
    comfyui_version?: string;
    python_version?: string;
    pytorch_version?: string;
  };
  devices: Array<{
    name: string;
    type: string;
    index: number;
    vram_total: number;
    vram_free: number;
  }>;
}

export interface ComfyPromptSubmitResponse {
  prompt_id: string;
  number: number;
  node_errors?: Record<string, unknown>;
  error?: {
    type?: string;
    message?: string;
    details?: string;
  };
}

export interface ComfyQueueResponse {
  queue_running: Array<[number, string, ...unknown[]]>;
  queue_pending: Array<[number, string, ...unknown[]]>;
}

export interface ComfyHistoryOutputFile {
  filename: string;
  subfolder: string;
  type: "output" | "temp" | "input";
}

export interface ComfyHistoryEntry {
  prompt?: unknown[];
  outputs?: Record<
    string,
    {
      images?: ComfyHistoryOutputFile[];
      [key: string]: unknown;
    }
  >;
  status?: {
    status_str?: "success" | "error";
    completed?: boolean;
    messages?: Array<[string, Record<string, unknown>]>;
  };
}

export type ComfyHistoryResponse = Record<string, ComfyHistoryEntry>;

export interface ComfyWsJsonMessage {
  type: string;
  data: Record<string, unknown>;
}

export function isComfyWsStatus(msg: ComfyWsJsonMessage): boolean {
  return msg.type === "status";
}

export function isComfyWsProgress(msg: ComfyWsJsonMessage): boolean {
  return msg.type === "progress";
}

export function isComfyWsExecuting(msg: ComfyWsJsonMessage): boolean {
  return msg.type === "executing";
}

export function isComfyWsExecutionStart(msg: ComfyWsJsonMessage): boolean {
  return msg.type === "execution_start";
}

export function isComfyWsExecutionSuccess(msg: ComfyWsJsonMessage): boolean {
  return msg.type === "execution_success";
}

export function isComfyWsExecutionInterrupted(msg: ComfyWsJsonMessage): boolean {
  return msg.type === "execution_interrupted";
}

export function isComfyWsExecutionError(msg: ComfyWsJsonMessage): boolean {
  return msg.type === "execution_error";
}

