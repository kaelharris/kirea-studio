import type {
  GenerationMode,
  VideoWorkflowSpec,
  WorkflowTemplate,
} from "./types";

export const VIDEO_MODES: GenerationMode[] = ["t2v", "i2v"];

export function isVideoMode(mode: GenerationMode | string): boolean {
  return mode === "t2v" || mode === "i2v";
}

export function isVideoWorkflow(
  workflow: Pick<WorkflowTemplate, "video"> | null | undefined
): boolean {
  return Boolean(workflow?.video);
}

export function videoModeLabel(mode: GenerationMode): string {
  if (mode === "t2v") return "Text to Video";
  if (mode === "i2v") return "Image to Video";
  return mode;
}

export interface ResolvedFrameCount {
  frameCount: number;
  durationSeconds: number;
  snapped: boolean;
  clamped: boolean;
}

/**
 * Converts a requested duration into a frame count the workflow can execute.
 * Video VAEs require lengths on a fixed stride, so the result is snapped and
 * the actual duration is derived from the snapped frame count.
 */
export function resolveVideoFrameCount(
  durationSeconds: number,
  spec: VideoWorkflowSpec
): ResolvedFrameCount {
  const fps = spec.fps > 0 ? spec.fps : 16;
  const min = Math.min(spec.minFrames, spec.maxFrames);
  const max = Math.max(spec.minFrames, spec.maxFrames);
  const step = Math.max(1, Math.round(spec.frameStep));
  const targetFrames = Math.max(
    1,
    Math.round((Number.isFinite(durationSeconds) ? durationSeconds : 0) * fps)
  );
  const clampedTarget = Math.min(max, Math.max(min, targetFrames));
  const snapped = min + Math.round((clampedTarget - min) / step) * step;
  const frameCount = Math.min(max, Math.max(min, snapped));
  return {
    frameCount,
    durationSeconds: frameCount / fps,
    snapped: frameCount !== targetFrames,
    clamped: clampedTarget !== targetFrames,
  };
}

export function formatDurationSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0.0s";
  return `${seconds.toFixed(1)}s`;
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}

export function videoDurationOptions(spec: VideoWorkflowSpec): number[] {
  const durations: number[] = [];
  const maxSeconds = spec.maxFrames / spec.fps;
  for (
    let frames = spec.minFrames;
    frames <= spec.maxFrames;
    frames += Math.max(1, spec.frameStep)
  ) {
    durations.push(Number((frames / spec.fps).toFixed(2)));
    if (durations.length > 24) break;
  }
  if (durations.length === 0 || durations[durations.length - 1]! < maxSeconds - 0.01) {
    durations.push(Number(maxSeconds.toFixed(2)));
  }
  return durations;
}
