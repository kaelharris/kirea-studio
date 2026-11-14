import type { AppSettings } from "../../shared/types";

export type ThemePreference = AppSettings["theme"];
export type ResolvedTheme = "dark" | "light";

/**
 * Mirror of the persisted preference, read synchronously by `public/theme-boot.js`
 * before first paint so a light-theme user never sees a dark flash while the
 * SQLite-backed settings load over IPC. The settings row stays the source of truth.
 */
export const THEME_STORAGE_KEY = "kirea.theme";

/**
 * Set by theme-boot.js when no mirror exists yet (first launch after an update).
 * The app stays hidden until the persisted theme is known, so a light-theme user
 * never sees one dark frame. theme-boot.js clears it on its own after 2.5 s.
 */
export const THEME_PENDING_ATTR = "data-theme-pending";

/** Applies the persisted preference and reveals the app if it was held back. */
export const commitPersistedTheme = (preference: ThemePreference): ResolvedTheme => {
  document.documentElement.removeAttribute(THEME_PENDING_ATTR);
  return applyTheme(preference);
};

const DARK_QUERY = "(prefers-color-scheme: dark)";

const isPreference = (value: unknown): value is ThemePreference =>
  value === "dark" || value === "light" || value === "system";

export const systemPrefersDark = (): boolean =>
  typeof window === "undefined" || typeof window.matchMedia !== "function"
    ? true
    : window.matchMedia(DARK_QUERY).matches;

export const resolveTheme = (preference: ThemePreference): ResolvedTheme =>
  preference === "system" ? (systemPrefersDark() ? "dark" : "light") : preference;

export const readStoredThemePreference = (): ThemePreference | null => {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isPreference(stored) ? stored : null;
  } catch {
    return null;
  }
};

export const applyTheme = (preference: ThemePreference): ResolvedTheme => {
  const resolved = resolveTheme(preference);
  const root = document.documentElement;
  root.setAttribute("data-theme", resolved);
  root.setAttribute("data-theme-preference", preference);
  // While the first-run theme is still pending, the in-memory default is a guess;
  // only the persisted settings may write the mirror.
  if (root.hasAttribute(THEME_PENDING_ATTR)) return resolved;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage unavailable: the attribute is still applied for this session.
  }
  return resolved;
};

/** Calls `onChange` whenever the OS colour scheme flips. Returns an unsubscribe. */
export const watchSystemTheme = (onChange: () => void): (() => void) => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => undefined;
  }
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};
