import { EventEmitter } from "node:events";
import WebSocket from "ws";
import {
  isComfyWsExecuting,
  isComfyWsExecutionError,
  isComfyWsExecutionInterrupted,
  isComfyWsExecutionStart,
  isComfyWsExecutionSuccess,
  isComfyWsProgress,
  isComfyWsStatus,
  type ComfyWsJsonMessage,
} from "./comfy-types";

export interface ComfyWsProgressEvent {
  promptId?: string;
  value: number;
  max: number;
  node?: string;
}

export interface ComfyWsExecutingEvent {
  promptId?: string;
  node: string | null;
}

export interface ComfyWsErrorEvent {
  promptId?: string;
  exceptionMessage: string;
  exceptionType?: string;
  nodeId?: string;
  nodeType?: string;
}

export class ComfyWsClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private wsUrl = "";
  private shouldRun = false;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private connected = false;
  private lastExecutingPromptId: string | undefined;

  isConnected(): boolean {
    return this.connected;
  }

  connect(wsUrl: string): void {
    if (this.wsUrl === wsUrl && this.shouldRun && this.ws) {
      return;
    }
    this.disconnect();
    this.wsUrl = wsUrl;
    this.shouldRun = true;
    this.reconnectAttempts = 0;
    this.openSocket();
  }

  disconnect(): void {
    this.shouldRun = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        // close() can emit an error while still connecting; keep a sink so it is not unhandled.
        this.ws.on("error", () => undefined);
        this.ws.close();
      } catch {
        // ignore close error
      }
      this.ws = null;
    }
    if (this.connected) {
      this.connected = false;
      this.emit("connection", false);
    }
  }

  private openSocket(): void {
    if (!this.shouldRun || !this.wsUrl) return;
    const socket = new WebSocket(this.wsUrl);
    this.ws = socket;

    socket.on("open", () => {
      this.connected = true;
      this.reconnectAttempts = 0;
      this.emit("connection", true);
    });

    socket.on("message", (rawData, isBinary) => {
      if (isBinary) {
        const buf = Buffer.isBuffer(rawData)
          ? rawData
          : Array.isArray(rawData)
            ? Buffer.concat(rawData)
            : Buffer.from(rawData);
        this.handleBinaryFrame(buf);
        return;
      }

      try {
        const parsed = JSON.parse(rawData.toString("utf-8")) as ComfyWsJsonMessage;
        this.handleJsonMessage(parsed);
      } catch {
        // Ignore malformed WS message
      }
    });

    socket.on("close", () => {
      const wasConnected = this.connected;
      this.connected = false;
      this.ws = null;
      if (wasConnected) {
        this.emit("connection", false);
      }
      this.scheduleReconnect();
    });

    socket.on("error", (err) => {
      this.emit("ws_error", err);
    });
  }

  private scheduleReconnect(): void {
    if (!this.shouldRun || this.reconnectTimer) return;
    const delayMs = Math.min(10000, 750 * Math.pow(1.6, this.reconnectAttempts));
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delayMs);
  }

  private handleBinaryFrame(buf: Buffer): void {
    if (buf.length < 8) return;
    const eventType = buf.readUInt32BE(0);
    // ComfyUI protocol: eventType 1 = preview image (4 bytes format + image payload)
    if (eventType === 1) {
      const imageFormat = buf.readUInt32BE(4);
      const mime = imageFormat === 2 ? "image/png" : "image/jpeg";
      const payload = buf.subarray(8);
      if (payload.length > 0) {
        const dataUrl = `data:${mime};base64,${payload.toString("base64")}`;
        this.emit("preview", { promptId: this.lastExecutingPromptId, dataUrl });
      }
      return;
    }
    // eventType 4 = preview with metadata header (4 bytes mimelen or similar)
    if (eventType === 4 && buf.length > 12) {
      const metaLen = buf.readUInt32BE(4);
      const imgStart = 8 + metaLen;
      if (imgStart < buf.length) {
        const payload = buf.subarray(imgStart);
        const isPng =
          payload.length >= 4 &&
          payload[0] === 0x89 &&
          payload[1] === 0x50 &&
          payload[2] === 0x4e &&
          payload[3] === 0x47;
        const mime = isPng ? "image/png" : "image/jpeg";
        const dataUrl = `data:${mime};base64,${payload.toString("base64")}`;
        this.emit("preview", { promptId: this.lastExecutingPromptId, dataUrl });
      }
    }
  }

  private handleJsonMessage(msg: ComfyWsJsonMessage): void {
    const data = msg.data ?? {};
    const promptId = typeof data.prompt_id === "string" ? data.prompt_id : undefined;

    if (isComfyWsStatus(msg)) {
      this.emit("status", data);
      return;
    }
    if (isComfyWsExecutionStart(msg)) {
      if (promptId) this.lastExecutingPromptId = promptId;
      this.emit("execution_start", { promptId });
      return;
    }
    if (isComfyWsExecuting(msg)) {
      const node = typeof data.node === "string" ? data.node : null;
      if (promptId) this.lastExecutingPromptId = promptId;
      this.emit("executing", { promptId, node } satisfies ComfyWsExecutingEvent);
      return;
    }
    if (isComfyWsProgress(msg)) {
      const value = Number(data.value ?? 0);
      const max = Number(data.max ?? 0);
      const node = typeof data.node === "string" ? data.node : undefined;
      this.emit("progress", {
        promptId: promptId ?? this.lastExecutingPromptId,
        value,
        max,
        node,
      } satisfies ComfyWsProgressEvent);
      return;
    }
    if (isComfyWsExecutionSuccess(msg)) {
      this.emit("execution_success", { promptId });
      return;
    }
    if (isComfyWsExecutionInterrupted(msg)) {
      this.emit("execution_interrupted", { promptId });
      return;
    }
    if (isComfyWsExecutionError(msg)) {
      const exceptionMessage =
        typeof data.exception_message === "string"
          ? data.exception_message
          : "ComfyUI node execution failed";
      this.emit("execution_error", {
        promptId,
        exceptionMessage,
        exceptionType:
          typeof data.exception_type === "string" ? data.exception_type : undefined,
        nodeId: typeof data.node_id === "string" ? data.node_id : undefined,
        nodeType: typeof data.node_type === "string" ? data.node_type : undefined,
      } satisfies ComfyWsErrorEvent);
    }
  }
}

