import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { GpuStats } from "../../shared/types";

const execFileAsync = promisify(execFile);

export async function getDiskFreeGBMap(targetPaths: string[]): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  const seenRoots = new Set<string>();

  for (const p of targetPaths) {
    if (!p) continue;
    const resolved = path.resolve(p);
    const root = path.parse(resolved).root || resolved;
    const key = root.toUpperCase();
    if (seenRoots.has(key)) continue;
    seenRoots.add(key);

    try {
      const checkDir = fs.existsSync(resolved) ? resolved : root;
      const stats = await fs.promises.statfs(checkDir);
      const freeBytes = Number(stats.bavail) * Number(stats.bsize);
      result[key] = Math.round((freeBytes / (1024 ** 3)) * 100) / 100;
    } catch {
      // Ignore drives that cannot be stat'd
    }
  }
  return result;
}

export async function detectHardwareStats(pathsToCheck: string[] = []): Promise<GpuStats> {
  const systemRamTotalMB = Math.round(os.totalmem() / (1024 * 1024));
  const systemRamFreeMB = Math.round(os.freemem() / (1024 * 1024));
  const diskFreeGB = await getDiskFreeGBMap([
    process.cwd(),
    os.homedir(),
    ...pathsToCheck,
  ]);

  let available = false;
  let name = "No NVIDIA GPU detected";
  let driverVersion = "N/A";
  let cudaVersion = "N/A";
  let vramTotalMB = 0;
  let vramFreeMB = 0;
  let vramUsedMB = 0;

  try {
    const { stdout } = await execFileAsync(
      "nvidia-smi",
      [
        "--query-gpu=name,driver_version,memory.total,memory.free,memory.used",
        "--format=csv,noheader,nounits",
      ],
      { timeout: 4000, windowsHide: true }
    );

    const firstLine = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean);

    if (firstLine) {
      const parts = firstLine.split(",").map((s) => s.trim());
      if (parts.length >= 5) {
        available = true;
        name = parts[0] || "NVIDIA GPU";
        driverVersion = parts[1] || "Unknown";
        vramTotalMB = Number.parseInt(parts[2] || "0", 10) || 0;
        vramFreeMB = Number.parseInt(parts[3] || "0", 10) || 0;
        vramUsedMB = Number.parseInt(parts[4] || "0", 10) || 0;
      }
    }

    // Read CUDA version header cleanly when available
    try {
      const smiFull = await execFileAsync("nvidia-smi", [], {
        timeout: 4000,
        windowsHide: true,
      });
      const cudaMatch = smiFull.stdout.match(/CUDA Version:\s*([0-9.]+)/i);
      if (cudaMatch?.[1]) {
        cudaVersion = cudaMatch[1];
      }
    } catch {
      // Optional
    }
  } catch {
    available = false;
  }

  const advisories: string[] = [];
  if (!available) {
    advisories.push("nvidia-smi unavailable. GPU acceleration cannot be verified locally.");
  } else {
    if (vramTotalMB >= 15500) {
      advisories.push(
        `${name} (${Math.round(vramTotalMB / 1024)} GB VRAM): Optimal for SDXL 1024px and SD 1.5; keep concurrent active jobs at 1.`
      );
    } else if (vramTotalMB >= 8000) {
      advisories.push(
        `${name} (${Math.round(vramTotalMB / 1024)} GB VRAM): Use Balanced or Memory Saver profile for SDXL.`
      );
    } else {
      advisories.push(
        `Low VRAM (${vramTotalMB} MB): Prefer Memory Saver profile and 512–768px dimensions.`
      );
    }
    if (vramFreeMB > 0 && vramFreeMB < 6000) {
      advisories.push(
        `Only ${(vramFreeMB / 1024).toFixed(1)} GB VRAM is currently free; close GPU-heavy desktop windows if OOM occurs.`
      );
    }
  }

  if (systemRamFreeMB < 8000) {
    advisories.push(
      `System RAM free is ${(systemRamFreeMB / 1024).toFixed(1)} GB of ${(systemRamTotalMB / 1024).toFixed(0)} GB; large text encoders (e.g. T5-XXL) may swap to disk.`
    );
  }

  const recommendedMaxBatch = vramTotalMB >= 15500 ? 4 : vramTotalMB >= 10000 ? 2 : 1;

  return {
    available,
    name,
    driverVersion,
    cudaVersion,
    vramTotalMB,
    vramFreeMB,
    vramUsedMB,
    systemRamTotalMB,
    systemRamFreeMB,
    diskFreeGB,
    recommendedMaxBatch,
    advisories,
  };
}

