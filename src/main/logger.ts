import fs from "node:fs";
import path from "node:path";

export type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

const SENSITIVE_PATTERNS = [
  /(Bearer\s+)[A-Za-z0-9._-]+/gi,
  /(hf_[A-Za-z0-9]{10,})/g,
  /(api[_-]?key["':=\s]+)[A-Za-z0-9._-]{6,}/gi,
  /(token["':=\s]+)[A-Za-z0-9._-]{6,}/gi,
];

export function redactSensitiveText(input: string): string {
  let out = input;
  for (const pattern of SENSITIVE_PATTERNS) {
    out = out.replace(pattern, (_match, prefix) =>
      prefix && !prefix.startsWith("hf_") ? `${prefix}[REDACTED]` : "[REDACTED]"
    );
  }
  return out;
}

export class StudioLogger {
  private readonly logFilePath: string;
  private readonly ringBuffer: string[] = [];
  private readonly maxRingEntries = 500;

  constructor(logsDir: string, fileName = "kirea-studio.log") {
    fs.mkdirSync(logsDir, { recursive: true });
    this.logFilePath = path.join(logsDir, fileName);
  }

  getFilePath(): string {
    return this.logFilePath;
  }

  getRecent(limit = 200): string[] {
    return this.ringBuffer.slice(-limit);
  }

  log(level: LogLevel, scope: string, message: string, detail?: unknown): void {
    const ts = new Date().toISOString();
    let suffix = "";
    if (detail !== undefined) {
      if (detail instanceof Error) {
        suffix = ` | ${detail.message}`;
      } else if (typeof detail === "string") {
        suffix = ` | ${detail}`;
      } else {
        try {
          suffix = ` | ${JSON.stringify(detail)}`;
        } catch {
          suffix = " | [unserializable]";
        }
      }
    }
    const line = redactSensitiveText(`[${ts}] [${level}] [${scope}] ${message}${suffix}`);
    this.ringBuffer.push(line);
    if (this.ringBuffer.length > this.maxRingEntries) {
      this.ringBuffer.shift();
    }
    try {
      fs.appendFileSync(this.logFilePath, line + "\n", "utf-8");
    } catch {
      // Never crash app if log file write fails temporarily
    }
  }

  info(scope: string, message: string, detail?: unknown): void {
    this.log("INFO", scope, message, detail);
  }

  warn(scope: string, message: string, detail?: unknown): void {
    this.log("WARN", scope, message, detail);
  }

  error(scope: string, message: string, detail?: unknown): void {
    this.log("ERROR", scope, message, detail);
  }

  debug(scope: string, message: string, detail?: unknown): void {
    this.log("DEBUG", scope, message, detail);
  }
}

