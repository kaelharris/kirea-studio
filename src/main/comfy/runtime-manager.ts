import { spawn, execFile, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  AppSettings,
  ComfyDeviceInfo,
  PerformanceProfile,
  RuntimeMode,
  RuntimeState,
} from "../../shared/types";
import type { DownloadManager } from "../downloads/download-manager";
import type { StudioLogger } from "../logger";
import type { StudioPaths } from "../paths";
import { isAllowedLoopbackHost } from "../security";
import { ComfyApiClient } from "./comfy-adapter";
import { ComfyWsClient } from "./comfy-ws";

const execFileAsync = promisify(execFile);

export interface ResolvedComfyLayout {
  rootPath: string;
  comfyDir: string;
  mainPyPath: string;
  pythonExePath: string;
  kind: "portable" | "venv" | "system_python";
}

export interface OfficialComfyReleaseInfo {
  tagName: string;
  assetName: string;
  downloadUrl: string;
  sizeBytes: number;
  sha256: string | null;
  releaseUrl: string;
  publishedAt: string;
  compatibilityNote: string;
}

const MAX_RUNTIME_LOG_LINES = 500;

export function resolveComfyInstallLayout(candidateRoot: string): ResolvedComfyLayout | null {
  if (!candidateRoot) return null;
  const resolved = path.resolve(candidateRoot);
  if (!fs.existsSync(resolved)) return null;

  // Check 1: Portable distribution (<root>/ComfyUI/main.py + <root>/python_embeded/python.exe)
  const portableComfyDir = path.join(resolved, "ComfyUI");
  const portableMain = path.join(portableComfyDir, "main.py");
  const portablePython = path.join(resolved, "python_embeded", "python.exe");
  if (fs.existsSync(portableMain) && fs.existsSync(portablePython)) {
    return {
      rootPath: resolved,
      comfyDir: portableComfyDir,
      mainPyPath: portableMain,
      pythonExePath: portablePython,
      kind: "portable",
    };
  }

  // Also check if user selected <root>/ComfyUI directly inside a portable folder
  const directMain = path.join(resolved, "main.py");
  const parentPortablePython = path.join(path.dirname(resolved), "python_embeded", "python.exe");
  if (fs.existsSync(directMain) && fs.existsSync(parentPortablePython)) {
    return {
      rootPath: path.dirname(resolved),
      comfyDir: resolved,
      mainPyPath: directMain,
      pythonExePath: parentPortablePython,
      kind: "portable",
    };
  }

  // Check 2: Extracted portable inside a container directory (<root>/ComfyUI_windows_portable/...)
  const nestedPortable = path.join(resolved, "ComfyUI_windows_portable");
  if (fs.existsSync(nestedPortable)) {
    const nestedResolved = resolveComfyInstallLayout(nestedPortable);
    if (nestedResolved) return nestedResolved;
  }

  // Check 3: Source/Git install with local venv (<comfyDir>/main.py + venv candidates)
  const comfyDirsToTry = [resolved, portableComfyDir].filter((dir) =>
    fs.existsSync(path.join(dir, "main.py"))
  );

  for (const comfyDir of comfyDirsToTry) {
    const mainPy = path.join(comfyDir, "main.py");
    const venvCandidates = [
      path.join(comfyDir, ".venv", "Scripts", "python.exe"),
      path.join(comfyDir, "venv", "Scripts", "python.exe"),
      path.join(path.dirname(comfyDir), ".venv", "Scripts", "python.exe"),
      path.join(path.dirname(comfyDir), "venv", "Scripts", "python.exe"),
    ];
    for (const py of venvCandidates) {
      if (fs.existsSync(py)) {
        return {
          rootPath: comfyDir,
          comfyDir,
          mainPyPath: mainPy,
          pythonExePath: py,
          kind: "venv",
        };
      }
    }
    return {
      rootPath: comfyDir,
      comfyDir,
      mainPyPath: mainPy,
      pythonExePath: "python",
      kind: "system_python",
    };
  }

  return null;
}

function countShallowModelFiles(comfyDir: string): number {
  const subdirs = ["checkpoints", "diffusion_models", "unet", "loras"];
  const exts = new Set([".safetensors", ".ckpt", ".pt", ".pth", ".gguf", ".bin"]);
  let count = 0;
  for (const sub of subdirs) {
    const dir = path.join(comfyDir, "models", sub);
    if (!fs.existsSync(dir)) continue;
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        if (entry.name.startsWith("put_")) continue;
        if (exts.has(path.extname(entry.name).toLowerCase())) {
          count += 1;
          if (count >= 25) return count;
        }
      }
    } catch {
      // Ignore unreadable directories during read-only discovery
    }
  }
  return count;
}

export function discoverExistingComfyPaths(): string[] {
  const candidatesByKey = new Map<string, { comfyDir: string; score: number; order: number }>();
  let orderCounter = 0;
  const addIfValid = (candidate: string | undefined | null): void => {
    if (!candidate) return;
    const layout = resolveComfyInstallLayout(candidate);
    if (!layout) return;
    const key = process.platform === "win32" ? layout.comfyDir.toLowerCase() : layout.comfyDir;
    if (candidatesByKey.has(key)) return;
    const pythonScore = layout.kind === "portable" || layout.kind === "venv" ? 100 : 0;
    const modelScore = countShallowModelFiles(layout.comfyDir) * 2;
    candidatesByKey.set(key, {
      comfyDir: layout.comfyDir,
      score: pythonScore + modelScore,
      order: orderCounter++,
    });
  };

  // Inspect ComfyUI Desktop & ComfyUI AppData pointers (strictly read-only)
  const appData = process.env.APPDATA;
  if (appData) {
    const configJsonPath = path.join(appData, "ComfyUI", "config.json");
    if (fs.existsSync(configJsonPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(configJsonPath, "utf8")) as Record<string, unknown>;
        if (typeof parsed.basePath === "string") addIfValid(parsed.basePath);
      } catch {
        // Ignore malformed external config
      }
    }

    const desktopInstallsPath = path.join(appData, "Comfy Desktop", "installations.json");
    if (fs.existsSync(desktopInstallsPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(desktopInstallsPath, "utf8")) as
          | Array<Record<string, unknown>>
          | Record<string, unknown>;
        const list = Array.isArray(raw) ? raw : Object.values(raw);
        for (const item of list) {
          if (item && typeof item === "object") {
            const rec = item as Record<string, unknown>;
            if (typeof rec.basePath === "string") addIfValid(rec.basePath);
            if (typeof rec.path === "string") addIfValid(rec.path);
          }
        }
      } catch {
        // Ignore malformed external JSON
      }
    }
  }

  // Inspect standard Windows user install locations (shallow, no deep disk crawl)
  const docs = path.join(os.homedir(), "Documents");
  const directCandidates = [
    path.join(docs, "ComfyUI"),
    path.join(docs, "ComfyUI_windows_portable"),
    path.join(docs, "comfy", "ComfyUI"),
    path.join(os.homedir(), "ComfyUI"),
    path.join(os.homedir(), "ComfyUI_windows_portable"),
    "C:\\ComfyUI",
    "C:\\ComfyUI_windows_portable",
  ];

  // Check one extra directory depth inside Documents\ComfyUI\* (e.g., TES\ComfyUI)
  const comfyDocsDir = path.join(docs, "ComfyUI");
  if (fs.existsSync(comfyDocsDir)) {
    try {
      for (const entry of fs.readdirSync(comfyDocsDir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          directCandidates.push(path.join(comfyDocsDir, entry.name));
          directCandidates.push(path.join(comfyDocsDir, entry.name, "ComfyUI"));
        }
      }
    } catch {
      // Ignore permission issues
    }
  }

  for (const cand of directCandidates) {
    addIfValid(cand);
  }

  return Array.from(candidatesByKey.values())
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.order - b.order))
    .map((entry) => entry.comfyDir);
}

function detectCliFlagSupport(comfyDir: string): {
  supportsDatabaseUrl: boolean;
  supportsUserDirectory: boolean;
  supportsDisableAutoLaunch: boolean;
  supportsHighVram: boolean;
} {
  const cliArgsPath = path.join(comfyDir, "comfy", "cli_args.py");
  if (!fs.existsSync(cliArgsPath)) {
    return {
      supportsDatabaseUrl: false,
      supportsUserDirectory: false,
      supportsDisableAutoLaunch: true,
      supportsHighVram: true,
    };
  }
  try {
    const content = fs.readFileSync(cliArgsPath, "utf8");
    return {
      supportsDatabaseUrl: content.includes("--database-url"),
      supportsUserDirectory: content.includes("--user-directory"),
      supportsDisableAutoLaunch: content.includes("--disable-auto-launch"),
      supportsHighVram: content.includes("--highvram"),
    };
  } catch {
    return {
      supportsDatabaseUrl: false,
      supportsUserDirectory: false,
      supportsDisableAutoLaunch: true,
      supportsHighVram: true,
    };
  }
}

export class ComfyRuntimeManager extends EventEmitter {
  private readonly apiClient: ComfyApiClient;
  private readonly wsClient: ComfyWsClient;
  private readonly runtimeLogs: string[] = [];
  private childProcess: ChildProcess | null = null;
  private state: RuntimeState;
  private readonly clientId = `kirea-${process.pid}-${Date.now().toString(36)}`;

  constructor(
    private readonly paths: StudioPaths,
    private settings: AppSettings,
    private readonly logger: StudioLogger
  ) {
    super();
    const apiUrl = this.buildApiUrl(settings);
    this.apiClient = new ComfyApiClient(apiUrl);
    this.wsClient = new ComfyWsClient();

    this.wsClient.on("connection", (connected: boolean) => {
      this.updateState({ wsConnected: connected });
    });

    const detected = discoverExistingComfyPaths();
    const managedLayout = resolveComfyInstallLayout(settings.managedComfyPath);
    const configuredLayout = this.getActiveLayout(settings);

    this.state = {
      status: "disconnected",
      mode: settings.runtimeMode,
      apiUrl,
      comfyVersion: null,
      pythonVersion: null,
      pytorchVersion: null,
      managedPid: null,
      managedOwned: false,
      detectedExternalPaths: detected,
      installedManagedPath: managedLayout?.rootPath ?? null,
      isConfiguredPathValid: Boolean(configuredLayout),
      lastError: null,
      devices: [],
      nodeTypesCount: 0,
      warnings: [],
      wsConnected: false,
    };
  }

  private buildApiUrl(s: AppSettings): string {
    const host = isAllowedLoopbackHost(s.comfyHost) ? s.comfyHost : "127.0.0.1";
    const port = Number.isInteger(s.comfyPort) && s.comfyPort >= 1024 && s.comfyPort <= 65535
      ? s.comfyPort
      : 8188;
    const formattedHost = host.includes(":") ? `[${host}]` : host;
    return `http://${formattedHost}:${port}`;
  }

  private getActiveLayout(s: AppSettings): ResolvedComfyLayout | null {
    const targetPath = s.runtimeMode === "managed" ? s.managedComfyPath : s.externalComfyPath;
    return resolveComfyInstallLayout(targetPath);
  }

  private appendLog(line: string): void {
    const stamped = `[${new Date().toISOString()}] ${line}`;
    this.runtimeLogs.push(stamped);
    if (this.runtimeLogs.length > MAX_RUNTIME_LOG_LINES) {
      this.runtimeLogs.splice(0, this.runtimeLogs.length - MAX_RUNTIME_LOG_LINES);
    }
  }

  private updateState(partial: Partial<RuntimeState>): void {
    this.state = { ...this.state, ...partial };
    this.emit("stateChanged", this.getState());
  }

  getApiClient(): ComfyApiClient {
    return this.apiClient;
  }

  getWsClient(): ComfyWsClient {
    return this.wsClient;
  }

  getClientId(): string {
    return this.clientId;
  }

  getState(): RuntimeState {
    return {
      ...this.state,
      detectedExternalPaths: [...this.state.detectedExternalPaths],
      devices: [...this.state.devices],
      warnings: [...this.state.warnings],
    };
  }

  getLogs(): string[] {
    return [...this.runtimeLogs];
  }

  applySettings(nextSettings: AppSettings): void {
    const prevUrl = this.buildApiUrl(this.settings);
    this.settings = nextSettings;
    const nextUrl = this.buildApiUrl(nextSettings);
    this.apiClient.setBaseUrl(nextUrl);

    const managedLayout = resolveComfyInstallLayout(nextSettings.managedComfyPath);
    const activeLayout = this.getActiveLayout(nextSettings);
    this.updateState({
      mode: nextSettings.runtimeMode,
      apiUrl: nextUrl,
      installedManagedPath: managedLayout?.rootPath ?? null,
      isConfiguredPathValid: Boolean(activeLayout),
    });

    if (prevUrl !== nextUrl && this.wsClient.isConnected()) {
      this.wsClient.disconnect();
      this.updateState({ status: "disconnected", wsConnected: false });
    }
  }

  refreshDiscovery(): RuntimeState {
    const detected = discoverExistingComfyPaths();
    const managedLayout = resolveComfyInstallLayout(this.settings.managedComfyPath);
    const activeLayout = this.getActiveLayout(this.settings);
    this.updateState({
      detectedExternalPaths: detected,
      installedManagedPath: managedLayout?.rootPath ?? null,
      isConfiguredPathValid: Boolean(activeLayout),
    });
    return this.getState();
  }

  async testConnection(): Promise<RuntimeState> {
    try {
      const stats = await this.apiClient.getSystemStats();
      let nodeTypesCount = this.state.nodeTypesCount;
      try {
        const objInfo = await this.apiClient.getAllObjectInfo();
        nodeTypesCount = Object.keys(objInfo).length;
      } catch {
        // Non-fatal if node count fetch fails briefly
      }

      const devices: ComfyDeviceInfo[] = (stats.devices ?? []).map((d) => ({
        name: d.name,
        type: d.type,
        index: d.index,
        vramTotal: d.vram_total,
        vramFree: d.vram_free,
      }));

      const warnings: string[] = [];
      if (devices.length === 0 || devices.every((d) => d.type === "cpu")) {
        warnings.push("Connected ComfyUI reported CPU-only execution; NVIDIA CUDA was not listed.");
      }

      this.wsClient.connect(this.apiClient.getWsUrl(this.clientId));

      this.updateState({
        status: "connected",
        comfyVersion: stats.system?.comfyui_version ?? null,
        pythonVersion: stats.system?.python_version ?? null,
        pytorchVersion: stats.system?.pytorch_version ?? null,
        devices,
        nodeTypesCount,
        warnings,
        lastError: null,
        wsConnected: this.wsClient.isConnected(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.updateState({
        status: this.childProcess ? this.state.status : "disconnected",
        wsConnected: false,
        lastError: message,
      });
    }
    return this.getState();
  }

  async startRuntime(overrideMode?: RuntimeMode, profile?: PerformanceProfile): Promise<RuntimeState> {
    if (overrideMode && overrideMode !== this.settings.runtimeMode) {
      this.updateState({ mode: overrideMode });
    }

    // Check if an instance is already reachable at the configured loopback API address
    try {
      await this.apiClient.getSystemStats();
      this.appendLog(`Attached to already-running ComfyUI instance at ${this.apiClient.getBaseUrl()}`);
      this.logger.info("runtime", "Attached to existing running ComfyUI instance");
      return await this.testConnection();
    } catch {
      // Not reachable yet — proceed to spawn
    }

    if (this.childProcess && !this.childProcess.killed) {
      this.appendLog("ComfyUI process is already starting...");
      return this.getState();
    }

    const mode = overrideMode ?? this.settings.runtimeMode;
    const targetRoot =
      mode === "managed" ? this.settings.managedComfyPath : this.settings.externalComfyPath;
    const layout = resolveComfyInstallLayout(targetRoot);

    if (!layout) {
      const msg =
        mode === "managed"
          ? "Managed ComfyUI runtime is not installed yet. Install it first in Settings -> Runtime."
          : `Valid ComfyUI installation was not found at '${targetRoot || "(not set)"}'.`;
      this.updateState({ status: "error", lastError: msg, isConfiguredPathValid: false });
      throw new Error(msg);
    }

    const perf = profile ?? this.settings.performanceProfile;
    const cliSupport = detectCliFlagSupport(layout.comfyDir);

    const host = isAllowedLoopbackHost(this.settings.comfyHost)
      ? this.settings.comfyHost
      : "127.0.0.1";
    const port = String(this.settings.comfyPort || 8188);

    const comfyOutDir = path.join(this.paths.tempDir, "comfy-out");
    const comfyTempDir = path.join(this.paths.tempDir, "comfy-tmp");
    const comfyUserDir = path.join(this.paths.cacheDir, "comfy-user");
    const comfyDbPath = path.join(this.paths.cacheDir, "comfy-transient.sqlite");
    fs.mkdirSync(comfyOutDir, { recursive: true });
    fs.mkdirSync(comfyTempDir, { recursive: true });
    fs.mkdirSync(comfyUserDir, { recursive: true });

    const args: string[] = [
      "-u",
      layout.mainPyPath,
      "--listen",
      host,
      "--port",
      port,
      "--output-directory",
      comfyOutDir,
      "--temp-directory",
      comfyTempDir,
      "--input-directory",
      this.paths.inputUploadCacheDir,
      "--preview-method",
      "auto",
    ];

    if (cliSupport.supportsDisableAutoLaunch) {
      args.push("--disable-auto-launch");
    }
    if (cliSupport.supportsUserDirectory) {
      args.push("--user-directory", comfyUserDir);
    }
    if (cliSupport.supportsDatabaseUrl) {
      args.push("--database-url", `sqlite:///${comfyDbPath}`);
    }

    if (perf === "memory_saver") {
      args.push("--lowvram");
    } else if (perf === "quality" && cliSupport.supportsHighVram) {
      args.push("--highvram");
    }

    // For managed installs, pass isolated extra_model_paths.yaml if present
    if (mode === "managed") {
      const managedYaml = path.join(layout.comfyDir, "extra_model_paths.yaml");
      if (fs.existsSync(managedYaml)) {
        args.push("--extra-model-paths-config", managedYaml);
      }
    }

    this.updateState({
      status: "starting",
      mode,
      lastError: null,
      isConfiguredPathValid: true,
    });

    this.appendLog(
      `Launching ${mode} ComfyUI (${layout.kind}) via ${layout.pythonExePath} on ${host}:${port}`
    );
    this.logger.info("runtime", `Launching ${mode} ComfyUI`, {
      comfyDir: layout.comfyDir,
      port,
      profile: perf,
    });

    let childExitedEarly = false;
    let earlyExitDetail = "";

    const child = spawn(layout.pythonExePath, args, {
      cwd: layout.comfyDir,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
      },
    });

    this.childProcess = child;
    this.updateState({
      managedPid: child.pid ?? null,
      managedOwned: true,
    });

    const handleStream = (chunk: Buffer, streamLabel: string): void => {
      const lines = chunk.toString("utf8").split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        this.appendLog(`[${streamLabel}] ${trimmed}`);
      }
    };

    child.stdout?.on("data", (d: Buffer) => handleStream(d, "out"));
    child.stderr?.on("data", (d: Buffer) => handleStream(d, "err"));

    child.on("exit", (code, signal) => {
      childExitedEarly = true;
      earlyExitDetail = `ComfyUI exited with code=${code ?? "null"} signal=${signal ?? "null"}`;
      this.appendLog(earlyExitDetail);
      this.logger.warn("runtime", earlyExitDetail);
      this.wsClient.disconnect();
      if (this.childProcess === child) {
        this.childProcess = null;
      }
      this.updateState({
        status: this.state.status === "starting" ? "error" : "disconnected",
        managedPid: null,
        managedOwned: false,
        wsConnected: false,
        lastError: this.state.status === "starting" ? earlyExitDetail : this.state.lastError,
      });
    });

    // Wait up to 90 seconds for ComfyUI HTTP endpoint to come online
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      if (childExitedEarly) {
        const tail = this.runtimeLogs.slice(-6).join("\n");
        throw new Error(`${earlyExitDetail}\n${tail}`.trim());
      }
      try {
        await this.apiClient.getSystemStats();
        return await this.testConnection();
      } catch {
        await new Promise((r) => setTimeout(r, 750));
      }
    }

    const timeoutMsg = "ComfyUI did not respond on loopback API within 90 seconds.";
    this.updateState({ status: "error", lastError: timeoutMsg });
    throw new Error(timeoutMsg);
  }

  async stopRuntime(): Promise<RuntimeState> {
    this.wsClient.disconnect();

    if (!this.state.managedOwned || !this.childProcess) {
      // Never kill an externally started ComfyUI that we do not own
      this.updateState({
        status: "disconnected",
        wsConnected: false,
      });
      return this.getState();
    }

    const child = this.childProcess;
    const pid = child.pid;
    this.childProcess = null;

    this.appendLog(`Stopping owned ComfyUI process (PID ${pid ?? "unknown"})...`);
    this.logger.info("runtime", `Stopping owned ComfyUI PID ${pid ?? "unknown"}`);

    if (pid) {
      try {
        if (process.platform === "win32") {
          await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"], {
            windowsHide: true,
            timeout: 8000,
          });
        } else {
          child.kill("SIGTERM");
        }
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
          // Process already exited
        }
      }
    }

    this.updateState({
      status: "disconnected",
      managedPid: null,
      managedOwned: false,
      wsConnected: false,
    });
    return this.getState();
  }

  async checkLatestOfficialRelease(): Promise<OfficialComfyReleaseInfo> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch(
        "https://api.github.com/repos/Comfy-Org/ComfyUI/releases/latest",
        {
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "KireaStudio/1.0.1",
          },
          signal: controller.signal,
        }
      );
      if (!res.ok) {
        throw new Error(`GitHub Releases check failed (${res.status})`);
      }
      const data = (await res.json()) as {
        tag_name: string;
        html_url: string;
        published_at: string;
        assets: Array<{
          name: string;
          size: number;
          browser_download_url: string;
          digest?: string;
        }>;
      };

      const portableAsset =
        data.assets.find((a) => /ComfyUI_windows_portable_nvidia.*\.7z$/i.test(a.name)) ??
        data.assets.find((a) => /windows.*nvidia.*\.7z$/i.test(a.name));

      if (!portableAsset) {
        throw new Error(
          `Release ${data.tag_name} did not include ComfyUI_windows_portable_nvidia.7z asset.`
        );
      }

      const shaMatch = portableAsset.digest?.match(/^sha256:([a-fA-F0-9]{64})$/);

      return {
        tagName: data.tag_name,
        assetName: portableAsset.name,
        downloadUrl: portableAsset.browser_download_url,
        sizeBytes: portableAsset.size,
        sha256: shaMatch?.[1] ? shaMatch[1].toLowerCase() : null,
        releaseUrl: data.html_url,
        publishedAt: data.published_at,
        compatibilityNote:
          "Official Comfy-Org Windows 10/11 64-bit Portable NVIDIA CUDA build with embedded isolated Python runtime.",
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async installManagedRuntime(downloadManager: DownloadManager): Promise<{
    downloadTaskId: string;
    release: OfficialComfyReleaseInfo;
  }> {
    this.updateState({ status: "installing", lastError: null });
    try {
      const release = await this.checkLatestOfficialRelease();
      const archivePath = path.join(
        this.paths.defaultDownloadsDir,
        `ComfyUI_windows_portable_nvidia_${release.tagName}.7z`
      );
      const extractDir = this.settings.managedComfyPath || this.paths.defaultManagedRuntimeDir;

      const task = await downloadManager.startDownload({
        id: `comfy_runtime_${release.tagName}`,
        kind: "comfy_runtime",
        title: `ComfyUI Windows Portable NVIDIA (${release.tagName})`,
        url: release.downloadUrl,
        targetPath: archivePath,
        category: "runtime",
        sourceName: "GitHub Official Releases (Comfy-Org/ComfyUI)",
        licenseName: "GPL-3.0 (External Managed Subprocess)",
        expectedSha256: release.sha256,
        expectedBytes: release.sizeBytes,
        extractToDir: extractDir,
      });

      // Monitor completion asynchronously to configure isolated YAML inside managed runtime dir
      void downloadManager.waitForTask(task.id).then((done) => {
        if (!done) return;
        if (done.status === "completed") {
          this.finalizeManagedRuntimeSetup(extractDir, release);
        } else if (done.status === "failed" || done.status === "cancelled") {
          this.updateState({
            status: "disconnected",
            lastError: done.error ?? "Managed runtime installation stopped.",
          });
        }
      });

      return { downloadTaskId: task.id, release };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.updateState({ status: "error", lastError: msg });
      throw err;
    }
  }

  private finalizeManagedRuntimeSetup(
    extractDir: string,
    release: OfficialComfyReleaseInfo
  ): void {
    const layout = resolveComfyInstallLayout(extractDir);
    if (!layout) {
      this.updateState({
        status: "error",
        lastError: "Extracted ComfyUI archive did not contain ComfyUI/main.py.",
      });
      return;
    }

    // Write isolated extra_model_paths.yaml INSIDE our managed ComfyUI folder only
    const managedModels = this.paths.defaultManagedModelsDir;
    const yamlContent = [
      "kirea_managed_models:",
      `    base_path: ${managedModels}`,
      "    checkpoints: checkpoints",
      "    loras: loras",
      "    vae: vae",
      "    upscale_models: upscale_models",
      "    controlnet: controlnet",
      "    embeddings: embeddings",
      "    diffusion_models: diffusion_models",
      "    text_encoders: text_encoders",
      "",
    ].join("\n");

    try {
      fs.writeFileSync(path.join(layout.comfyDir, "extra_model_paths.yaml"), yamlContent, "utf8");
      fs.writeFileSync(
        path.join(extractDir, "runtime-manifest.json"),
        JSON.stringify(
          {
            version: release.tagName,
            installedAt: new Date().toISOString(),
            sourceUrl: release.releaseUrl,
            assetName: release.assetName,
            sha256: release.sha256,
            comfyDir: layout.comfyDir,
            pythonExe: layout.pythonExePath,
          },
          null,
          2
        ),
        "utf8"
      );
    } catch (err) {
      this.logger.warn("runtime", "Could not write managed runtime manifest", String(err));
    }

    this.updateState({
      status: "disconnected",
      installedManagedPath: layout.rootPath,
      isConfiguredPathValid: true,
      lastError: null,
    });
    this.appendLog(`Installed managed ComfyUI ${release.tagName} at ${layout.rootPath}`);
  }
}
