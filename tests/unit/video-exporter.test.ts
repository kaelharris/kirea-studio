import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  detectVideoContainer,
  exportVideoToDestination,
  saveGeneratedVideo,
  type KireaVideoMetadataPayload,
} from "../../src/main/videos/video-exporter";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true, maxRetries: 6, retryDelay: 50 });
  }
});

function meta(): KireaVideoMetadataPayload {
  return {
    app: "Kirea Studio",
    version: "1.0.0",
    jobId: "job_video",
    workflowId: "t2v_wan21_1_3b",
    workflowVersion: "1.0.0",
    mode: "t2v",
    prompt: "rain-soaked alley, slow dolly",
    negativePrompt: "blur",
    checkpoint: "wan2.1_t2v_1.3B_fp16.safetensors",
    loras: [],
    seed: 42,
    width: 832,
    height: 480,
    steps: 30,
    cfg: 6,
    sampler: "uni_pc",
    scheduler: "simple",
    denoise: 1,
    durationSeconds: 2.0625,
    fps: 16,
    frameCount: 33,
    createdAt: "2026-11-15T10:00:00.000Z",
  };
}

describe("Video exporter", () => {
  it("detects supported containers and rejects others", () => {
    expect(detectVideoContainer("Kirea_00001_.mp4")).toBe("mp4");
    expect(detectVideoContainer("clip.WEBM")).toBe("webm");
    expect(detectVideoContainer("clip.mkv")).toBeNull();
    expect(detectVideoContainer("clip.png")).toBeNull();
  });

  it("saves collision-free video files with JSON sidecars", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-video-"));
    tempDirs.push(dir);
    const buffer = Buffer.from("fake-mp4-payload");

    const first = await saveGeneratedVideo(buffer, "ComfyUI_00001_.mp4", dir, meta(), 0);
    expect(first.container).toBe("mp4");
    expect(first.fileName.endsWith(".mp4")).toBe(true);
    expect(first.durationSeconds).toBeCloseTo(2.0625);
    expect(fs.existsSync(first.filePath)).toBe(true);

    const sidecar = JSON.parse(fs.readFileSync(`${first.filePath}.json`, "utf8"));
    expect(sidecar.prompt).toBe("rain-soaked alley, slow dolly");
    expect(sidecar.frameCount).toBe(33);

    const second = await saveGeneratedVideo(buffer, "ComfyUI_00002_.mp4", dir, meta(), 0);
    expect(second.filePath).not.toBe(first.filePath);
    expect(path.basename(second.filePath)).toMatch(/-1\.mp4$/);

    await expect(
      saveGeneratedVideo(buffer, "ComfyUI_00003_.mkv", dir, meta(), 0)
    ).rejects.toThrow(/not an MP4 or WebM/);
  });

  it("copies exports to the destination and keeps the source container", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-video-export-"));
    tempDirs.push(dir);
    const saved = await saveGeneratedVideo(
      Buffer.from("video-bytes"),
      "ComfyUI_00001_.webm",
      dir,
      meta(),
      0
    );

    const exported = await exportVideoToDestination(
      saved.filePath,
      path.join(dir, "exports", "final-cut")
    );
    expect(exported.endsWith(".webm")).toBe(true);
    expect(fs.readFileSync(exported).toString()).toBe("video-bytes");
  });
});
