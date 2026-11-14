import React from "react";
import {
  Box,
  Bug,
  Grid3X3,
  Package,
  Sparkles,
  Sword,
  Trees,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import type { PixelKind } from "../../../shared/pixel-types";
import { PIXEL_KIND_LABELS } from "../../../shared/pixel-types";

export const PIXEL_KIND_ICONS: Record<PixelKind, LucideIcon> = {
  character: UserRound,
  creature: Bug,
  weapon: Sword,
  item: Package,
  object: Box,
  tileset: Grid3X3,
  environment: Trees,
  effect: Sparkles,
};

export function checkerStyle(cell = 8): React.CSSProperties {
  return {
    backgroundColor: "var(--surface-subtle)",
    backgroundImage:
      "conic-gradient(rgba(127,127,127,0.22) 25%, transparent 0 50%, rgba(127,127,127,0.22) 0 75%, transparent 0)",
    backgroundSize: `${cell * 2}px ${cell * 2}px`,
  };
}

export const PixelImage: React.FC<{
  src: string | undefined;
  alt: string;
  className?: string;
  checker?: boolean;
  node?: PixelKind;
}> = ({ src, alt, className = "", checker = true, node }) => {
  const Icon = node ? PIXEL_KIND_ICONS[node] : null;
  return (
    <div
      className={`flex items-center justify-center overflow-hidden ${className}`}
      style={checker ? checkerStyle() : undefined}
    >
      {src ? (
        <img
          src={src}
          alt={alt}
          className="w-full h-full object-contain"
          style={{ imageRendering: "pixelated" }}
          draggable={false}
        />
      ) : (
        <div className="flex flex-col items-center gap-1 text-fg-faint">
          {Icon && <Icon className="w-5 h-5" />}
          <span className="font-mono text-[9px] uppercase tracking-[0.08em]">No preview</span>
        </div>
      )}
    </div>
  );
};

export const KindBadgeLabel: React.FC<{ kind: PixelKind }> = ({ kind }) => {
  const Icon = PIXEL_KIND_ICONS[kind];
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-[0.08em] text-fg-muted">
      <Icon className="w-3 h-3" />
      {PIXEL_KIND_LABELS[kind]}
    </span>
  );
};

export const PixelField: React.FC<{
  label: string;
  hint?: string;
  children: React.ReactNode;
}> = ({ label, hint, children }) => (
  <label className="block space-y-1.5">
    <span className="label-mono text-fg-muted">{label}</span>
    {children}
    {hint && <span className="block text-[11px] text-fg-faint leading-relaxed">{hint}</span>}
  </label>
);

export function formatPixelDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function hashPromptToSeed(prompt: string): number {
  let hash = 2166136261;
  for (let i = 0; i < prompt.length; i++) {
    hash ^= prompt.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}
