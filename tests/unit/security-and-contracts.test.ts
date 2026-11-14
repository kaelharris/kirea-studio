import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { IPC_CHANNELS } from "../../src/shared/ipc-channels";
import {
  assertSafeExternalUrl,
  isAllowedLoopbackHost,
  isPathInsideAnyRoot,
} from "../../src/main/security";

describe("Security utilities & sandbox preload contract", () => {
  it("enforces strict loopback-only host policy", () => {
    expect(isAllowedLoopbackHost("127.0.0.1")).toBe(true);
    expect(isAllowedLoopbackHost("localhost")).toBe(true);
    expect(isAllowedLoopbackHost("::1")).toBe(true);

    expect(isAllowedLoopbackHost("0.0.0.0")).toBe(false);
    expect(isAllowedLoopbackHost("192.168.1.50")).toBe(false);
    expect(isAllowedLoopbackHost("example.com")).toBe(false);
  });

  it("blocks path traversal attempts outside allowed directories", () => {
    const allowed = ["C:\\Users\\Demo\\Pictures\\Kirea Studio"];
    expect(
      isPathInsideAnyRoot("C:\\Users\\Demo\\Pictures\\Kirea Studio\\2026\\img.png", allowed)
    ).toBe(true);
    expect(
      isPathInsideAnyRoot("C:\\Users\\Demo\\Pictures\\Kirea Studio\\..\\..\\secret.txt", allowed)
    ).toBe(false);
    expect(() => assertSafeExternalUrl("file:///C:/Windows/System32")).toThrow();
  });

  it("keeps preload.ts sandbox-compatible (zero local relative require calls) and synchronized with IPC_CHANNELS", () => {
    const preloadPath = path.resolve(process.cwd(), "src/main/preload.ts");
    const preloadSource = fs.readFileSync(preloadPath, "utf8");

    // Must not runtime-import non-electron modules (Electron sandbox: true rule)
    const runtimeImports = preloadSource
      .split(/\r?\n/)
      .filter(
        (line) =>
          /^\s*import\s+/.test(line) &&
          !/^\s*import\s+type\s+/.test(line) &&
          !line.includes('from "electron"') &&
          !line.includes("from 'electron'")
      );
    expect(runtimeImports).toEqual([]);

    // Verify every invoke/on channel in IPC_CHANNELS appears in preload.ts
    for (const channel of Object.values(IPC_CHANNELS)) {
      expect(preloadSource).toContain(`"${channel}"`);
    }
  });
});

