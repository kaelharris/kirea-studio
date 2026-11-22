import { safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";

interface StoredToken {
  version: 1;
  encrypted: boolean;
  value: string;
}

/**
 * Stores the Hugging Face access token with OS credential encryption. The token
 * is never written to SQLite, settings JSON, logs, or renderer state.
 */
export class HuggingFaceTokenStore {
  private readonly filePath: string;

  constructor(userDataDir: string) {
    this.filePath = path.join(userDataDir, "secrets", "huggingface.json");
  }

  get secretPath(): string {
    return this.filePath;
  }

  hasToken(): boolean {
    return Boolean(this.getToken());
  }

  getToken(): string | null {
    const stored = this.read();
    if (!stored || !stored.value || !stored.encrypted) return null;
    if (!safeStorage.isEncryptionAvailable()) return null;
    try {
      return safeStorage.decryptString(Buffer.from(stored.value, "base64")) || null;
    } catch {
      return null;
    }
  }

  setToken(raw: string): boolean {
    const trimmed = raw.trim();
    if (!trimmed) {
      this.clear();
      return false;
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(
        "OS credential encryption is unavailable; refusing to store the Hugging Face token in plaintext."
      );
    }
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const payload: StoredToken = {
      version: 1,
      encrypted: true,
      value: safeStorage.encryptString(trimmed).toString("base64"),
    };
    fs.writeFileSync(this.filePath, JSON.stringify(payload), {
      encoding: "utf8",
      mode: 0o600,
    });
    return true;
  }

  clear(): void {
    fs.rmSync(this.filePath, { force: true });
  }

  private read(): StoredToken | null {
    try {
      if (!fs.existsSync(this.filePath)) return null;
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as unknown;
      if (!parsed || typeof parsed !== "object") return null;
      const source = parsed as Record<string, unknown>;
      if (typeof source.value !== "string") return null;
      return {
        version: 1,
        encrypted: source.encrypted === true,
        value: source.value,
      };
    } catch {
      return null;
    }
  }
}
