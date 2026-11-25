import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const childProcessMocks = vi.hoisted(() => ({ spawn: vi.fn() }));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: childProcessMocks.spawn };
});

import { ComfyApiClient } from "../../src/main/comfy/comfy-adapter";
import { ComfyWsClient } from "../../src/main/comfy/comfy-ws";
import { ComfyRuntimeManager } from "../../src/main/comfy/runtime-manager";
import type { PerformanceProfile } from "../../src/shared/types";

const tempDirs: string[] = [];
const optionalFlags = [
  "--disable-auto-launch",
  "--user-directory",
  "--database-url",
  "--disable-smart-memory",
  "--reserve-vram",
  "--fast",
  "--lowvram",
  "--highvram",
  "--extra-model-paths-config",
];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-runtime-cli-test-"));
  tempDirs.push(dir);
  return dir;
}

function makeFakeChild(): EventEmitter & {
  pid: number;
  killed: boolean;
  kill: ReturnType<typeof vi.fn>;
  stdout: EventEmitter;
  stderr: EventEmitter;
} {
  const child = new EventEmitter() as ReturnType<typeof makeFakeChild>;
  child.pid = 4242;
  child.killed = false;
  child.kill = vi.fn();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

async function launchWithCliArgs(
  cliArgsSource: string | null,
  profile: PerformanceProfile = "quality",
  unreadable = false
): Promise<string[]> {
  const root = makeTempDir();
  const comfyDir = path.join(root, "ComfyUI");
  fs.mkdirSync(path.join(comfyDir, "comfy"), { recursive: true });
  fs.mkdirSync(path.join(root, "python_embeded"), { recursive: true });
  fs.writeFileSync(path.join(comfyDir, "main.py"), "# test fixture");
  fs.writeFileSync(path.join(root, "python_embeded", "python.exe"), "test fixture");

  if (cliArgsSource !== null) {
    const cliArgsPath = path.join(comfyDir, "comfy", "cli_args.py");
    if (unreadable) {
      fs.mkdirSync(cliArgsPath);
    } else {
      fs.writeFileSync(cliArgsPath, cliArgsSource);
    }
  }

  const stats = {
    system: { comfyui_version: "test", python_version: "test", pytorch_version: "test" },
    devices: [],
  };
  vi.spyOn(ComfyApiClient.prototype, "getSystemStats")
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(stats as any);
  vi.spyOn(ComfyApiClient.prototype, "getAllObjectInfo").mockResolvedValue({});
  vi.spyOn(ComfyWsClient.prototype, "connect").mockImplementation(() => undefined);

  childProcessMocks.spawn.mockReturnValue(makeFakeChild());
  const manager = new ComfyRuntimeManager(
    {
      tempDir: path.join(root, "temp"),
      cacheDir: path.join(root, "cache"),
      inputUploadCacheDir: path.join(root, "input"),
    } as any,
    {
      runtimeMode: "managed",
      managedComfyPath: root,
      externalComfyPath: "",
      comfyHost: "127.0.0.1",
      comfyPort: 8188,
      performanceProfile: profile,
    } as any,
    { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any
  );

  await manager.startRuntime();
  expect(childProcessMocks.spawn).toHaveBeenCalledTimes(1);
  return childProcessMocks.spawn.mock.calls[0]![1] as string[];
}

afterEach(() => {
  vi.restoreAllMocks();
  childProcessMocks.spawn.mockReset();
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

describe("ComfyRuntimeManager CLI compatibility", () => {
  it("does not pass optional flags when cli_args.py is missing", async () => {
    const args = await launchWithCliArgs(null);

    for (const flag of optionalFlags) {
      expect(args).not.toContain(flag);
    }
  });

  it("defaults every optional flag to unsupported when cli_args.py cannot be read", async () => {
    const args = await launchWithCliArgs("", "memory_saver", true);

    for (const flag of optionalFlags) {
      expect(args).not.toContain(flag);
    }
  });

  it("passes declared reserve-vram and fast flags without enabling undeclared flags", async () => {
    const args = await launchWithCliArgs(
      [
        'parser.add_argument("--reserve-vram", type=float)',
        'parser.add_argument("--fast", action="store_true")',
      ].join("\n")
    );

    expect(args).toContain("--reserve-vram");
    expect(args).toContain("4.0");
    expect(args).toContain("--fast");
    expect(args).not.toContain("--disable-auto-launch");
    expect(args).not.toContain("--user-directory");
    expect(args).not.toContain("--database-url");
    expect(args).not.toContain("--disable-smart-memory");
    expect(args).not.toContain("--lowvram");
  });

  it("passes optional performance and isolation flags only when declared", async () => {
    const declaredFlags = [
      "--disable-auto-launch",
      "--user-directory",
      "--database-url",
      "--disable-smart-memory",
      "--reserve-vram",
      "--fast",
      "--lowvram",
    ];
    const args = await launchWithCliArgs(
      declaredFlags.map((flag) => `parser.add_argument("${flag}")`).join("\n"),
      "memory_saver"
    );

    for (const flag of declaredFlags) {
      expect(args).toContain(flag);
    }
    expect(args).not.toContain("--highvram");
    expect(args).not.toContain("--extra-model-paths-config");
  });
});
