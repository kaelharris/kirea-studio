import fs from "node:fs";
import path from "node:path";
import type {
  GenerationRequest,
  VideoContainerFormat,
} from "../../shared/types";
import { getCollisionFreeFilePath } from "../images/image-exporter";

export interface KireaVideoMetadataPayload {
  app: "Kirea Studio";
  version: string;
  jobId: string;
  workflowId: string;
  workflowVersion: string;
  mode: string;
  prompt: string;
  negativePrompt: string;
  checkpoint: string;
  loras: GenerationRequest["loras"];
  seed: number;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  denoise: number;
  durationSeconds: number;
  fps: number;
  frameCount: number;
  createdAt: string;
}

export interface SavedVideoResult {
  filePath: string;
  fileName: string;
  container: VideoContainerFormat;
  width: number;
  height: number;
  sizeBytes: number;
  durationSeconds: number;
  fps: number;
  frameCount: number;
}

export function detectVideoContainer(filename: string): VideoContainerFormat | null {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".mp4" || ext === ".m4v") return "mp4";
  if (ext === ".webm") return "webm";
  return null;
}

export async function saveGeneratedVideo(
  rawBuffer: Buffer,
  sourceFilename: string,
  outputRootDir: string,
  meta: KireaVideoMetadataPayload,
  videoIndex: number
): Promise<SavedVideoResult> {
  if (rawBuffer.length === 0) {
    throw new Error("ComfyUI returned an empty video file.");
  }
  const container = detectVideoContainer(sourceFilename);
  if (!container) {
    throw new Error(
      `ComfyUI returned '${path.basename(sourceFilename)}', which is not an MP4 or WebM video.`
    );
  }

  const dateFolder = meta.createdAt.slice(0, 10) || new Date().toISOString().slice(0, 10);
  const targetDir = path.join(outputRootDir, dateFolder);
  await fs.promises.mkdir(targetDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const baseName = `kirea_${stamp}_s${meta.seed}_v${videoIndex + 1}.${container}`;
  const targetPath = getCollisionFreeFilePath(path.join(targetDir, baseName));
  await fs.promises.writeFile(targetPath, rawBuffer);
  await fs.promises.writeFile(`${targetPath}.json`, JSON.stringify(meta, null, 2), "utf8");

  return {
    filePath: targetPath,
    fileName: path.basename(targetPath),
    container,
    width: meta.width,
    height: meta.height,
    sizeBytes: rawBuffer.length,
    durationSeconds: meta.durationSeconds,
    fps: meta.fps,
    frameCount: meta.frameCount,
  };
}

export async function exportVideoToDestination(
  sourceFilePath: string,
  destinationPath: string
): Promise<string> {
  const ext = path.extname(sourceFilePath);
  const requested = path.resolve(destinationPath);
  const withExt = path.extname(requested) ? requested : `${requested}${ext}`;
  const safeDest = getCollisionFreeFilePath(withExt);
  await fs.promises.mkdir(path.dirname(safeDest), { recursive: true });
  await fs.promises.copyFile(sourceFilePath, safeDest);
  return safeDest;
}
