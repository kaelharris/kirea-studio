import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  isPixelAssetId,
  resolvePixelExportDirectory,
} from "../../src/main/pixel/pixel-export-path";

const EXPORT_ROOT = path.resolve("C:\\Users\\Test\\Pictures\\Kirea\\PixelExports");
const VALID_ID = "5f0c2f6e-7a68-4f0b-9d5e-7b3c1a2d4e5f";

describe("pixel export folder resolution", () => {
  it("resolves a valid asset id inside the export root", () => {
    expect(isPixelAssetId(VALID_ID)).toBe(true);
    expect(resolvePixelExportDirectory(EXPORT_ROOT, VALID_ID)).toBe(
      path.join(EXPORT_ROOT, VALID_ID)
    );
  });

  it("accepts uppercase UUIDs", () => {
    const upper = VALID_ID.toUpperCase();
    expect(resolvePixelExportDirectory(EXPORT_ROOT, upper)).toBe(
      path.join(EXPORT_ROOT, upper)
    );
  });

  it.each([
    ["empty", ""],
    ["spaces", "   "],
    ["plain name", "my-asset"],
    ["truncated", "5f0c2f6e-7a68-4f0b-9d5e"],
    ["extra suffix", `${VALID_ID}-extra`],
    ["non-hex characters", "zzzzzzzz-zzzz-4zzz-9zzz-zzzzzzzzzzzz"],
    ["parent traversal", ".."],
    ["dot", "."],
    ["parent with valid prefix", `../${VALID_ID}`],
    ["nested traversal", `..\\${VALID_ID}`],
    ["forward separator", `sub/${VALID_ID}`],
    ["back separator", `sub\\${VALID_ID}`],
    ["absolute windows path", "C:\\Windows\\System32"],
    ["absolute posix path", "/etc/passwd"],
    ["UNC path", "\\\\server\\share"],
    ["query suffix", `${VALID_ID}?x=1`],
    ["null byte", `${VALID_ID}\u0000`],
  ])("rejects %s", (_label, candidate) => {
    expect(() => resolvePixelExportDirectory(EXPORT_ROOT, candidate)).toThrow(
      "Invalid export folder."
    );
  });

  it("rejects non-string values", () => {
    for (const candidate of [undefined, null, 42, true, {}, []]) {
      expect(() => resolvePixelExportDirectory(EXPORT_ROOT, candidate)).toThrow(
        "Invalid export folder."
      );
    }
  });

  it("keeps the resolved folder inside a relative export root", () => {
    const relativeRoot = path.join("pixel-exports");
    const resolved = resolvePixelExportDirectory(relativeRoot, VALID_ID);
    expect(path.relative(path.resolve(relativeRoot), resolved)).toBe(VALID_ID);
    expect(resolved.startsWith(path.resolve(relativeRoot))).toBe(true);
  });
});
