import { describe, expect, it } from "vitest";
import {
  clampPercent,
  compareVersions,
  isNewerVersion,
  normalizeReleaseNotes,
  summarizeReleaseNotes,
  toUpdateProgress,
} from "../../src/shared/update-utils";

describe("update version comparison", () => {
  it("orders dotted versions numerically", () => {
    expect(compareVersions("1.0.10", "1.0.9")).toBe(1);
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("v2.0.0", "1.99.99")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.1")).toBe(-1);
  });

  it("treats prereleases as older than the final release", () => {
    expect(compareVersions("1.0.0-beta.1", "1.0.0")).toBe(-1);
    expect(compareVersions("1.0.0", "1.0.0-beta.9")).toBe(1);
    expect(compareVersions("1.0.0-beta.2", "1.0.0-beta.10")).toBe(-1);
  });

  it("only offers genuinely newer versions", () => {
    expect(isNewerVersion("1.1.0", "1.0.4")).toBe(true);
    expect(isNewerVersion("1.0.4", "1.0.4")).toBe(false);
    expect(isNewerVersion("1.0.3", "1.0.4")).toBe(false);
  });
});

describe("release notes normalization", () => {
  it("flattens HTML from update manifests into readable text", () => {
    const notes = normalizeReleaseNotes(
      "<h2>Changes</h2><ul><li>Faster</li><li>Safer &amp; quieter</li></ul>"
    );
    expect(notes).toContain("Changes");
    expect(notes).toContain("• Faster");
    expect(notes).toContain("Safer & quieter");
    expect(notes).not.toContain("<li>");
  });

  it("joins electron-updater note arrays", () => {
    expect(
      normalizeReleaseNotes([
        { version: "1.1.0", note: "New updater" },
        { version: "1.0.9", note: "Fix" },
      ])
    ).toBe("New updater\nFix");
  });

  it("returns null for empty notes and caps long bodies", () => {
    expect(normalizeReleaseNotes("   ")).toBeNull();
    expect(normalizeReleaseNotes(null)).toBeNull();
    const long = normalizeReleaseNotes("x".repeat(600), 100);
    expect(long).toHaveLength(101);
    expect(long?.endsWith("…")).toBe(true);
  });

  it("summarizes notes to one short line", () => {
    const summary = summarizeReleaseNotes("Line one\n\nLine two with details", 25);
    expect(summary?.length).toBeLessThanOrEqual(26);
    expect(summarizeReleaseNotes(null)).toBeNull();
  });
});

describe("update progress", () => {
  it("clamps percentages and derives them from byte counts", () => {
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(120)).toBe(100);
    expect(clampPercent(Number.NaN)).toBe(0);
    expect(
      toUpdateProgress({ transferred: 50, total: 200, bytesPerSecond: 10 }).percent
    ).toBe(25);
  });

  it("ignores non-numeric progress payloads", () => {
    expect(
      toUpdateProgress({ percent: "abc", transferred: undefined, total: null })
    ).toEqual({ percent: 0, transferredBytes: 0, totalBytes: 0, bytesPerSecond: 0 });
  });
});
