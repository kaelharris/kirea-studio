import type { UpdateProgress } from "./update-types";

/** Compares dotted versions; a prerelease sorts below its final release. */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string): { core: number[]; pre: string[] } => {
    const cleaned = value.trim().replace(/^v/i, "").split("+")[0] ?? "";
    const [corePart, prePart] = cleaned.split("-", 2);
    const core = (corePart ?? "")
      .split(".")
      .map((part) => {
        const n = Number.parseInt(part, 10);
        return Number.isFinite(n) ? n : 0;
      });
    const pre = prePart ? prePart.split(".") : [];
    return { core, pre };
  };

  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.core.length, right.core.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (left.core[i] ?? 0) - (right.core[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  if (left.pre.length === 0 && right.pre.length === 0) return 0;
  if (left.pre.length === 0) return 1;
  if (right.pre.length === 0) return -1;
  const preLength = Math.max(left.pre.length, right.pre.length);
  for (let i = 0; i < preLength; i += 1) {
    const l = left.pre[i];
    const r = right.pre[i];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    const ln = Number.parseInt(l, 10);
    const rn = Number.parseInt(r, 10);
    if (Number.isFinite(ln) && Number.isFinite(rn)) {
      if (ln !== rn) return ln > rn ? 1 : -1;
    } else if (l !== r) {
      return l > r ? 1 : -1;
    }
  }
  return 0;
}

export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

/** electron-updater may return a string, an array of notes, or HTML. */
export function normalizeReleaseNotes(raw: unknown, maxLength = 4000): string | null {
  let text = "";
  if (typeof raw === "string") {
    text = raw;
  } else if (Array.isArray(raw)) {
    text = raw
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (entry && typeof entry === "object" && "note" in entry) {
          return String((entry as { note?: unknown }).note ?? "");
        }
        return "";
      })
      .join("\n");
  } else if (raw && typeof raw === "object" && "note" in raw) {
    text = String((raw as { note?: unknown }).note ?? "");
  }

  if (!text.trim()) return null;

  const plain = text
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n• ")
    .replace(/<\s*\/\s*(p|div|h[1-6]|ul|ol)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (match) => ENTITIES[match] ?? match)
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!plain) return null;
  return plain.length > maxLength ? `${plain.slice(0, maxLength).trimEnd()}…` : plain;
}

/** Single-line summary for the compact notification. */
export function summarizeReleaseNotes(notes: string | null, maxLength = 220): string | null {
  if (!notes) return null;
  const flat = notes.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  if (flat.length <= maxLength) return flat;
  const cut = flat.slice(0, maxLength);
  const boundary = cut.lastIndexOf(" ");
  return `${(boundary > maxLength * 0.6 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

export function toUpdateProgress(raw: {
  percent?: unknown;
  transferred?: unknown;
  total?: unknown;
  bytesPerSecond?: unknown;
}): UpdateProgress {
  const num = (value: unknown): number => {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const totalBytes = num(raw.total);
  const transferredBytes = num(raw.transferred);
  const percent =
    raw.percent === undefined
      ? totalBytes > 0
        ? (transferredBytes / totalBytes) * 100
        : 0
      : num(raw.percent);
  return {
    percent: clampPercent(percent),
    transferredBytes,
    totalBytes,
    bytesPerSecond: num(raw.bytesPerSecond),
  };
}
