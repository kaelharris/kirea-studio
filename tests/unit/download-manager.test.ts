import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StudioDatabase } from "../../src/main/db/database";
import { StudioRepository } from "../../src/main/db/repositories";
import { DownloadManager } from "../../src/main/downloads/download-manager";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()!();
  }
});

function createRangeTestServer(payload: Buffer): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === "/slow-file") {
        const range = req.headers.range;
        let start = 0;
        let end = payload.length - 1;
        if (range) {
          const match = range.match(/bytes=(\d+)-(\d*)/);
          if (match?.[1]) {
            start = Number(match[1]);
            if (match[2]) end = Number(match[2]);
            res.writeHead(206, {
              "Content-Range": `bytes ${start}-${end}/${payload.length}`,
              "Content-Length": String(end - start + 1),
              "Accept-Ranges": "bytes",
            });
          } else {
            res.writeHead(200, { "Content-Length": String(payload.length) });
          }
        } else {
          res.writeHead(200, {
            "Content-Length": String(payload.length),
            "Accept-Ranges": "bytes",
          });
        }

        // Drip chunks slowly enough for pause tests
        let cursor = start;
        const timer = setInterval(() => {
          if (cursor > end) {
            clearInterval(timer);
            res.end();
            return;
          }
          const nextEnd = Math.min(cursor + 32 * 1024, end + 1);
          res.write(payload.subarray(cursor, nextEnd));
          cursor = nextEnd;
        }, 15);
        req.on("close", () => clearInterval(timer));
        return;
      }

      res.writeHead(200, { "Content-Length": String(payload.length) });
      res.end(payload);
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({
        port: addr.port,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

describe("DownloadManager", () => {
  it("supports Range pause/resume, SHA-256 verification, and mismatch rejection", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-dl-"));
    const db = new StudioDatabase(path.join(tempDir, "dl.db"));
    const repo = new StudioRepository(db);

    const payload = crypto.randomBytes(512 * 1024); // 512 KB
    const expectedSha = crypto.createHash("sha256").update(payload).digest("hex");
    const server = await createRangeTestServer(payload);

    cleanups.push(async () => {
      await server.close();
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    const mgr = new DownloadManager(repo, undefined, {
      allowLoopbackHttpForTests: true,
    });

    const target1 = path.join(tempDir, "models", "test-model.safetensors");
    const started = await mgr.startDownload({
      id: "dl_pause_resume",
      kind: "model",
      title: "Test Resumable Model",
      url: `http://127.0.0.1:${server.port}/slow-file`,
      targetPath: target1,
      category: "checkpoint",
      sourceName: "Local Mock",
      licenseName: "MIT",
      expectedSha256: expectedSha,
      expectedBytes: payload.length,
    });

    expect(started.id).toBe("dl_pause_resume");

    // Wait slightly so first chunks stream into .part file, then pause
    await new Promise((r) => setTimeout(r, 90));
    expect(mgr.pauseDownload("dl_pause_resume")).toBe(true);
    const pausedTask = await mgr.waitForTask("dl_pause_resume");
    expect(pausedTask?.status).toBe("paused");
    expect(pausedTask!.downloadedBytes).toBeGreaterThan(0);

    // Resume and wait for SHA-256 verification & rename
    mgr.resumeDownload("dl_pause_resume");
    const completed = await mgr.waitForTask("dl_pause_resume");
    expect(completed?.status).toBe("completed");
    expect(completed?.actualSha256).toBe(expectedSha);
    expect(fs.existsSync(target1)).toBe(true);
    expect(fs.statSync(target1).size).toBe(payload.length);

    // Check bad SHA-256 rejection
    const targetBad = path.join(tempDir, "models", "bad.safetensors");
    await mgr.startDownload({
      id: "dl_bad_sha",
      kind: "model",
      title: "Corrupt Model",
      url: `http://127.0.0.1:${server.port}/fast-file`,
      targetPath: targetBad,
      category: "lora",
      sourceName: "Local Mock",
      licenseName: "MIT",
      expectedSha256: "0".repeat(64),
      expectedBytes: payload.length,
    });
    const failed = await mgr.waitForTask("dl_bad_sha");
    expect(failed?.status).toBe("failed");
    expect(failed?.error).toContain("SHA-256");
    expect(fs.existsSync(targetBad)).toBe(false);
    expect(fs.existsSync(`${targetBad}.part`)).toBe(false);
  });
});

