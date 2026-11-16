import React, { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import type { CivitaiDownloadStatus, CivitaiDownloadTask } from "../../../shared/civitai";
import type { ModelArchitecture, ModelCategory } from "../../../shared/types";

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger";
export type PageMode = "vault" | "hub" | "downloads";

export const HUB_PAGE_SIZE = 24;
export const ACTIVE_DOWNLOAD_STATUSES: CivitaiDownloadStatus[] = [
  "queued",
  "downloading",
  "verifying",
  "finalizing",
];
export const DOWNLOAD_STATUS_LABELS: Record<CivitaiDownloadStatus, string> = {
  queued: "Queued",
  downloading: "Downloading",
  verifying: "Verifying SHA-256",
  finalizing: "Finalizing",
  completed: "Installed",
  failed: "Failed",
  cancelled: "Cancelled",
};
export const DOWNLOAD_STATUS_TONES: Record<CivitaiDownloadStatus, Tone> = {
  queued: "neutral",
  downloading: "accent",
  verifying: "warning",
  finalizing: "warning",
  completed: "success",
  failed: "danger",
  cancelled: "neutral",
};

export function isActiveDownload(status: CivitaiDownloadStatus): boolean {
  return ACTIVE_DOWNLOAD_STATUSES.includes(status);
}

export function formatSpeed(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return "0 MB/s";
  return `${(bytesPerSec / (1024 * 1024)).toFixed(2)} MB/s`;
}

export function formatCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function splitList(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)
    )
  );
}

export function categoryLabel(category: ModelCategory): string {
  return category.replace(/_/g, " ");
}

export function downloadPercent(task: CivitaiDownloadTask): number {
  if (task.status === "completed") return 100;
  if (task.totalBytes <= 0) return 0;
  return Math.min(
    100,
    Math.max(0, Math.round((task.downloadedBytes / task.totalBytes) * 100))
  );
}

export function folderOf(filePath: string): string {
  return filePath.replace(/[\\/][^\\/]+$/, "");
}

export const RemotePreview: React.FC<{
  url: string | null;
  alt: string;
  className?: string;
  iconClass?: string;
}> = ({ url, alt, className = "", iconClass = "w-5 h-5" }) => {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [url]);

  if (!url || failed) {
    return (
      <div className={`flex items-center justify-center bg-well ${className}`}>
        <div className="flex flex-col items-center gap-1 text-fg-subtle">
          <ImageOff className={iconClass} />
          <span className="text-[11px] uppercase tracking-wider">No preview</span>
        </div>
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      draggable={false}
      onError={() => setFailed(true)}
      className={`w-full h-full object-contain object-center ${className}`}
    />
  );
};


export interface MetadataDraft {
  displayName: string;
  description: string;
  architectureOverride: "auto" | ModelArchitecture;
  baseModel: string;
  previewMode: "auto" | "custom" | "none";
  triggerWords: string;
  tags: string;
  notes: string;
}

export const CATEGORY_LABELS: Array<{ id: "all" | ModelCategory; label: string }> = [
  { id: "all", label: "All" },
  { id: "checkpoint", label: "Checkpoints" },
  { id: "lora", label: "LoRAs" },
  { id: "vae", label: "VAEs" },
  { id: "diffusion_model", label: "Diffusion / UNET" },
  { id: "text_encoder", label: "Text Encoders" },
  { id: "upscale", label: "Upscalers" },
  { id: "controlnet", label: "ControlNet" },
  { id: "embedding", label: "Embeddings" },
];

export const ARCHITECTURE_FILTERS: ModelArchitecture[] = [
  "sd15",
  "sdxl",
  "illustrious",
  "pony",
  "flux",
  "z_image",
  "anima",
  "ltx_video",
  "unknown",
];

