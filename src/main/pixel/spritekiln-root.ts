import fsSync from "node:fs";
import path from "node:path";

export interface SpriteKilnRoot {
  rootPath: string;
  source: "configured" | "bundled";
}

export function resolveSpriteKilnRoot(configuredRoot?: string): SpriteKilnRoot | null {
  const candidates: Array<{ rootPath: string; source: SpriteKilnRoot["source"] }> = [];
  if (configuredRoot && configuredRoot.trim()) {
    candidates.push({ rootPath: path.resolve(configuredRoot.trim()), source: "configured" });
  }
  try {
    const electron = require("electron") as {
      app?: { isPackaged?: boolean; getAppPath?: () => string };
    };
    const app = electron.app;
    if (app && typeof app.getAppPath === "function") {
      candidates.push({
        rootPath: app.isPackaged
          ? path.join(process.resourcesPath, "pixel-engines", "spritekiln")
          : path.join(app.getAppPath(), "external", "pixel-engines", "spritekiln"),
        source: "bundled",
      });
    }
  } catch {
    // Running outside Electron (tests).
  }
  candidates.push({
    rootPath: path.join(process.cwd(), "external", "pixel-engines", "spritekiln"),
    source: "bundled",
  });
  for (const candidate of candidates) {
    try {
      if (fsSync.existsSync(candidate.rootPath)) return candidate;
    } catch {
      // Keep looking.
    }
  }
  return null;
}
