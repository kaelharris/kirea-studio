import fs from "node:fs";
import path from "node:path";
import type { UpdateChannel } from "../../shared/update-types";

export interface UpdatePreferences {
  channel: UpdateChannel;
  dismissedVersion: string | null;
  lastCheckedAt: string | null;
}

export interface UpdatePreferenceStore {
  read(): UpdatePreferences;
  patch(partial: Partial<UpdatePreferences>): UpdatePreferences;
}

const DEFAULTS: UpdatePreferences = {
  channel: "stable",
  dismissedVersion: null,
  lastCheckedAt: null,
};

function sanitize(raw: unknown): UpdatePreferences {
  if (!raw || typeof raw !== "object") return { ...DEFAULTS };
  const value = raw as Record<string, unknown>;
  return {
    channel: value.channel === "prerelease" ? "prerelease" : "stable",
    dismissedVersion:
      typeof value.dismissedVersion === "string" ? value.dismissedVersion : null,
    lastCheckedAt:
      typeof value.lastCheckedAt === "string" ? value.lastCheckedAt : null,
  };
}

/** Small dedicated file so dismissal and channel survive restarts. */
export function createFileUpdatePreferenceStore(userDataDir: string): UpdatePreferenceStore {
  const filePath = path.join(userDataDir, "update-preferences.json");
  let cached: UpdatePreferences | null = null;

  const read = (): UpdatePreferences => {
    if (cached) return cached;
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
      cached = sanitize(parsed);
    } catch {
      cached = { ...DEFAULTS };
    }
    return cached;
  };

  const persist = (prefs: UpdatePreferences): void => {
    const tmp = `${filePath}.tmp`;
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(prefs, null, 2), "utf-8");
      fs.renameSync(tmp, filePath);
    } catch {
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        // best effort
      }
    }
  };

  return {
    read,
    patch(partial) {
      const next = sanitize({ ...read(), ...partial });
      cached = next;
      persist(next);
      return next;
    },
  };
}
