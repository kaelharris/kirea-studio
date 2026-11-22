import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const safeStorageState = { available: true };

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => safeStorageState.available,
    encryptString: (raw: string) =>
      Buffer.from(`enc:${Buffer.from(raw, "utf8").toString("base64")}`, "utf8"),
    decryptString: (buf: Buffer) => {
      const text = buf.toString("utf8");
      if (!text.startsWith("enc:")) throw new Error("Invalid ciphertext");
      return Buffer.from(text.slice(4), "base64").toString("utf8");
    },
  },
}));

import { HuggingFaceTokenStore } from "../../src/main/huggingface/token-store";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-hf-token-"));
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  safeStorageState.available = true;
});

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("HuggingFaceTokenStore", () => {
  it("encrypts the token at rest and round-trips it cleanly", () => {
    const dir = makeTempDir();
    const store = new HuggingFaceTokenStore(dir);

    expect(store.setToken("  hf_secret_123  ")).toBe(true);
    expect(store.hasToken()).toBe(true);
    expect(store.getToken()).toBe("hf_secret_123");

    const disk = JSON.parse(fs.readFileSync(store.secretPath, "utf8")) as {
      encrypted: boolean;
      value: string;
    };
    expect(disk.encrypted).toBe(true);
    expect(disk.value).not.toContain("hf_secret_123");
  });

  it("refuses plaintext storage when OS encryption is unavailable", () => {
    const dir = makeTempDir();
    const store = new HuggingFaceTokenStore(dir);
    safeStorageState.available = false;

    expect(() => store.setToken("hf_secret_123")).toThrow(/plaintext/i);
    expect(fs.existsSync(store.secretPath)).toBe(false);
  });

  it("clears the token and ignores unencrypted files", () => {
    const dir = makeTempDir();
    const store = new HuggingFaceTokenStore(dir);
    store.setToken("hf_secret_123");
    store.clear();
    expect(store.hasToken()).toBe(false);

    fs.mkdirSync(path.dirname(store.secretPath), { recursive: true });
    fs.writeFileSync(
      store.secretPath,
      JSON.stringify({ version: 1, encrypted: false, value: "plaintext_token" }),
      "utf8"
    );
    expect(store.getToken()).toBeNull();
  });
});
