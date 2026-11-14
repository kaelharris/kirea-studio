import { safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";

interface StoredSecret {
  version: 1;
  encrypted: boolean;
  value: string;
}

/**
 * Persists the Civitai API key outside the settings row, encrypted at rest with
 * the OS keychain (DPAPI on Windows) whenever Electron exposes safeStorage.
 */
export class CivitaiKeyStore {
  private readonly filePath: string;

  constructor(userDataDir: string) {
    this.filePath = path.join(userDataDir, "secrets", "civitai.json");
  }

  get secretPath(): string {
    return this.filePath;
  }

  hasKey(): boolean {
    return Boolean(this.getKey());
  }

  getKey(): string | null {
    const stored = this.read();
    if (!stored || !stored.value || !stored.encrypted) return null;
    if (!safeStorage.isEncryptionAvailable()) return null;
    try {
      return safeStorage.decryptString(Buffer.from(stored.value, "base64")) || null;
    } catch {
      return null;
    }
  }

  setKey(raw: string): boolean {
    const trimmed = raw.trim();
    if (!trimmed) {
      this.clear();
      return false;
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(
        "OS credential encryption (DPAPI/keychain) is unavailable; refusing to store Civitai API key in plaintext."
      );
    }
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const payload: StoredSecret = {
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

  private read(): StoredSecret | null {
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
