import React, { useEffect, useState } from "react";
import {
  CheckCircle2,
  Cpu,
  Download,
  Eye,
  EyeOff,
  FileText,
  FolderOpen,
  HardDrive,
  Info,
  KeyRound,
  Play,
  Plug,
  Plus,
  RefreshCw,
  ShieldCheck,
  Square,
  Trash2,
} from "lucide-react";
import type { RuntimeReleaseInfo } from "../../shared/api";
import type { CivitaiConnectionTest } from "../../shared/civitai";
import type {
  AppDiagnostics,
  AppSettings,
  DownloadTask,
  GpuStats,
  NavSection,
  OutputFormat,
  PerformanceProfile,
  RuntimeMode,
  RuntimeState,
} from "../../shared/types";
import {
  Badge,
  Button,
  Card,
  Input,
  SectionHeader,
  Select,
} from "../components/ui/Primitives";
import { formatBytes } from "../utils/format";

interface SettingsPageProps {
  settings: AppSettings;
  runtime: RuntimeState;
  hardware: GpuStats | null;
  downloads: DownloadTask[];
  samplersAndSchedulers: { samplers: string[]; schedulers: string[] };
  onUpdateSettings: (partial: Partial<AppSettings>) => Promise<void>;
  onStartRuntime: (mode?: RuntimeMode) => Promise<void>;
  onStopRuntime: () => Promise<void>;
  onTestConnection: () => Promise<void>;
  onToast: (msg: string, tone?: "info" | "error") => void;
}

type SettingsTab = "runtime" | "storage" | "performance" | "civitai" | "diagnostics";

export const SettingsPage: React.FC<SettingsPageProps> = ({
  settings,
  runtime,
  hardware,
  downloads,
  samplersAndSchedulers,
  onUpdateSettings,
  onStartRuntime,
  onStopRuntime,
  onTestConnection,
  onToast,
}) => {
  const [tab, setTab] = useState<SettingsTab>("runtime");
  const [diagnostics, setDiagnostics] = useState<AppDiagnostics | null>(null);
  const [runtimeLogs, setRuntimeLogs] = useState<string[]>([]);
  const [latestRelease, setLatestRelease] = useState<RuntimeReleaseInfo | null>(null);
  const [checkingRelease, setCheckingRelease] = useState(false);
  const [installingManaged, setInstallingManaged] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [savingApiKey, setSavingApiKey] = useState(false);
  const [testingCivitai, setTestingCivitai] = useState(false);
  const [civitaiTest, setCivitaiTest] = useState<CivitaiConnectionTest | null>(null);

  useEffect(() => {
    if (tab === "diagnostics") {
      void window.kirea.getDiagnostics().then(setDiagnostics);
    } else if (tab === "runtime") {
      void window.kirea.getRuntimeLogs().then(setRuntimeLogs);
    }
  }, [tab]);

  const managedDownload = downloads.find((d) => d.kind === "comfy_runtime");
  const managedPct =
    managedDownload && managedDownload.totalBytes > 0
      ? Math.min(
          100,
          Math.round((managedDownload.downloadedBytes / managedDownload.totalBytes) * 100)
        )
      : 0;

  const handleCheckRelease = async (): Promise<void> => {
    setCheckingRelease(true);
    try {
      const info = await window.kirea.checkRuntimeRelease();
      setLatestRelease(info);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setCheckingRelease(false);
    }
  };

  const handleInstallManaged = async (): Promise<void> => {
    setInstallingManaged(true);
    try {
      const res = await window.kirea.installManagedRuntime();
      setLatestRelease(res.release);
      onToast(`Started managed ComfyUI (${res.release.tagName}) download & setup.`);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setInstallingManaged(false);
    }
  };

  const pickAndSaveDir = async (
    title: string,
    field: "externalComfyPath" | "managedComfyPath" | "outputDirectory" | "downloadDirectory"
  ): Promise<void> => {
    const picked = await window.kirea.pickDirectory(title);
    if (picked) {
      await onUpdateSettings({ [field]: picked });
      onToast(`Updated directory to ${picked}`);
    }
  };

  const handleAddExtraModelDir = async (): Promise<void> => {
    const picked = await window.kirea.pickDirectory("Add Extra Models Folder");
    if (picked && !settings.extraModelDirs.includes(picked)) {
      await onUpdateSettings({
        extraModelDirs: [...settings.extraModelDirs, picked],
      });
      onToast(`Added model directory ${picked}`);
    }
  };

  const handleSaveCivitaiKey = async (): Promise<void> => {
    setSavingApiKey(true);
    try {
      const hadKey = apiKeyDraft.trim().length > 0;
      await window.kirea.setCivitaiApiKey(apiKeyDraft);
      await onUpdateSettings({});
      setApiKeyDraft("");
      setCivitaiTest(null);
      onToast(hadKey ? "Civitai API key stored securely." : "Civitai API key cleared.");
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSavingApiKey(false);
    }
  };

  const handleClearCivitaiKey = async (): Promise<void> => {
    setSavingApiKey(true);
    try {
      await window.kirea.setCivitaiApiKey("");
      await onUpdateSettings({});
      setApiKeyDraft("");
      setCivitaiTest(null);
      onToast("Civitai API key cleared.");
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSavingApiKey(false);
    }
  };

  const handleTestCivitai = async (): Promise<void> => {
    setTestingCivitai(true);
    try {
      setCivitaiTest(await window.kirea.testCivitaiConnection());
    } catch (err) {
      setCivitaiTest({
        ok: false,
        authenticated: settings.civitaiApiKeySet,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTestingCivitai(false);
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Settings & Engine Configuration"
        subtitle="Configure ComfyUI runtime modes, isolated storage directories, hardware performance profiles, and diagnostics."
      />

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <nav
          aria-label="Settings sections"
          className="shrink-0 lg:sticky lg:top-0 lg:w-[200px]"
        >
          <div className="flex flex-wrap gap-1 lg:flex-col">
            {(
              [
                ["runtime", "Runtime & ComfyUI"],
                ["storage", "Storage & Paths"],
                ["performance", "Performance & Defaults"],
                ["civitai", "Civitai Hub"],
                ["diagnostics", "Interface & Diagnostics"],
              ] as Array<[SettingsTab, string]>
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-current={tab === id ? "page" : undefined}
                onClick={() => setTab(id)}
                className={`h-8 rounded-lg px-3 text-left text-small transition-colors lg:w-full ${
                  tab === id
                    ? "bg-accent-solid font-semibold text-accent-fg"
                    : "text-fg-muted hover:bg-surface-subtle hover:text-fg"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </nav>

        <div className="w-full min-w-0 max-w-[720px] space-y-4">
          {/* TAB 1: RUNTIME */}
      {tab === "runtime" && (
        <div className="space-y-4">
          {/* Runtime Mode Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card
              className={`p-4 space-y-4 border-2 ${
                settings.runtimeMode === "external"
                  ? "border-accent"
                  : "border-border"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <Badge tone="accent">Option A</Badge>
                  <h3 className="text-base font-semibold text-fg mt-1">
                    Existing ComfyUI Installation
                  </h3>
                </div>
                <Button
                  size="sm"
                  variant={settings.runtimeMode === "external" ? "primary" : "secondary"}
                  className="shrink-0"
                  onClick={() => void onUpdateSettings({ runtimeMode: "external" })}
                >
                  {settings.runtimeMode === "external" ? "Active Mode" : "Select Mode"}
                </Button>
              </div>
              <p className="text-xs text-fg-muted leading-relaxed">
                Connects to or launches an existing ComfyUI installation in read-only mode.
                Outputs, temp files, and databases are routed strictly to Kirea Studio directories
                without altering external installs or models.
              </p>

              <div className="space-y-2">
                <label className="text-xs font-medium text-fg-muted">
                  ComfyUI Installation Path
                </label>
                <div className="flex gap-2">
                  <Input
                    aria-label="ComfyUI Installation Path"
                    value={settings.externalComfyPath}
                    onChange={(e) =>
                      void onUpdateSettings({ externalComfyPath: e.target.value })
                    }
                    placeholder="C:\path\to\ComfyUI"
                    className="text-xs"
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      void pickAndSaveDir("Select Existing ComfyUI Folder", "externalComfyPath")
                    }
                  >
                    Browse
                  </Button>
                </div>

                {runtime.detectedExternalPaths.length > 0 && (
                  <div className="space-y-1 pt-1">
                    <div className="flex items-center justify-between text-[11px] text-fg-subtle">
                      <span>Auto-detected local installations:</span>
                      <button
                        type="button"
                        onClick={() => void window.kirea.discoverRuntime()}
                        className="inline-flex min-h-6 items-center text-accent hover:underline cursor-pointer"
                      >
                        Re-detect
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {runtime.detectedExternalPaths.map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() =>
                            void onUpdateSettings({
                              runtimeMode: "external",
                              externalComfyPath: p,
                            })
                          }
                          className={`px-2.5 py-1 text-[11px] rounded-lg border text-left truncate max-w-full cursor-pointer ${
                            settings.externalComfyPath.toLowerCase() === p.toLowerCase()
                              ? "bg-accent-soft border-accent text-accent-hover"
                              : "bg-bg border-border text-fg-muted hover:text-fg"
                          }`}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </Card>

            <Card
              className={`p-4 space-y-4 border-2 ${
                settings.runtimeMode === "managed"
                  ? "border-accent"
                  : "border-border"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <Badge tone="neutral">Option B</Badge>
                  <h3 className="text-base font-semibold text-fg mt-1">
                    App-Managed ComfyUI Runtime
                  </h3>
                </div>
                <Button
                  size="sm"
                  variant={settings.runtimeMode === "managed" ? "primary" : "secondary"}
                  className="shrink-0"
                  onClick={() => void onUpdateSettings({ runtimeMode: "managed" })}
                >
                  {settings.runtimeMode === "managed" ? "Active Mode" : "Select Mode"}
                </Button>
              </div>
              <p className="text-xs text-fg-muted leading-relaxed">
                Downloads the official Comfy-Org Windows Portable NVIDIA CUDA package into
                Kirea Studio&apos;s isolated runtime directory without touching system Python.
                Future runtime updates never touch your separate models folder.
              </p>

              <div className="p-3 rounded-xl bg-bg border border-border text-xs space-y-1">
                <div className="flex justify-between gap-2">
                  <span className="text-fg-subtle">Managed Location</span>
                  <span className="font-mono text-[11px] text-fg truncate">
                    {settings.managedComfyPath}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-fg-subtle">Install Status</span>
                  {runtime.installedManagedPath ? (
                    <Badge tone="success">Installed</Badge>
                  ) : (
                    <Badge tone="neutral">Not Installed</Badge>
                  )}
                </div>
              </div>

              {latestRelease && (
                <div className="p-3 rounded-xl bg-surface-elevated border border-border text-xs space-y-1">
                  <div className="font-semibold text-fg">
                    Official Release {latestRelease.tagName} ({formatBytes(latestRelease.sizeBytes)})
                  </div>
                  <p className="text-fg-muted">{latestRelease.compatibilityNote}</p>
                </div>
              )}

              {managedDownload && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-fg font-medium capitalize">
                      {managedDownload.status}
                    </span>
                    <span className="tabular-nums text-fg-muted">{managedPct}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-surface-subtle rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent transition-[width] duration-200 ease-out"
                      style={{ width: `${managedPct}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  loading={checkingRelease}
                  onClick={() => void handleCheckRelease()}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Check Official Release
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  loading={installingManaged}
                  onClick={() => void handleInstallManaged()}
                >
                  <Download className="w-3.5 h-3.5" />
                  {runtime.installedManagedPath
                    ? "Reinstall / Update Runtime"
                    : "Download & Install Managed Runtime"}
                </Button>
              </div>
            </Card>
          </div>

          {/* Connection & Engine Controls */}
          <Card className="p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-fg">
                  Loopback API Endpoint &amp; Process Controls
                </h3>
                <p className="text-xs text-fg-muted">
                  Only loopback hosts (127.0.0.1 / localhost) are permitted for local inference security.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => void onTestConnection()}>
                  <Plug className="w-3.5 h-3.5" />
                  Test Connection
                </Button>
                {runtime.status !== "connected" ? (
                  <Button
                    size="sm"
                    variant="primary"
                    loading={runtime.status === "starting"}
                    onClick={() => void onStartRuntime()}
                  >
                    <Play className="w-3.5 h-3.5" />
                    Start Engine
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={!runtime.managedOwned}
                    title={
                      runtime.managedOwned
                        ? "Stop Kirea-owned ComfyUI process"
                        : "Externally launched ComfyUI is never terminated by Kirea Studio"
                    }
                    onClick={() => void onStopRuntime()}
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                    {runtime.managedOwned ? "Stop Owned Engine" : "External Running"}
                  </Button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-fg-muted">Loopback Host</label>
                <Select
                  aria-label="Loopback Host"
                  value={settings.comfyHost}
                  onChange={(e) => void onUpdateSettings({ comfyHost: e.target.value })}
                >
                  <option value="127.0.0.1">127.0.0.1 (Recommended)</option>
                  <option value="localhost">localhost</option>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-fg-muted">Port</label>
                <Input
                  type="number"
                  aria-label="Port"
                  min={1024}
                  max={65535}
                  value={settings.comfyPort}
                  onChange={(e) =>
                    void onUpdateSettings({
                      comfyPort: Number(e.target.value) || 8188,
                    })
                  }
                  className="tabular-nums"
                />
              </div>
              <div className="flex items-end pb-2">
                <label className="inline-flex items-center gap-2 text-xs text-fg cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.autoStartRuntime}
                    onChange={(e) =>
                      void onUpdateSettings({ autoStartRuntime: e.target.checked })
                    }
                    className="accent-accent"
                  />
                  Auto-start ComfyUI when Kirea Studio launches
                </label>
              </div>
            </div>

            {/* Live Runtime Metadata & Logs */}
            <div className="pt-2 border-t border-border space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap gap-2">
                  <Badge tone={runtime.status === "connected" ? "success" : "neutral"}>
                    Status: {runtime.status}
                  </Badge>
                  {runtime.comfyVersion && <Badge>ComfyUI v{runtime.comfyVersion}</Badge>}
                  {runtime.pytorchVersion && <Badge>PyTorch {runtime.pytorchVersion}</Badge>}
                  {runtime.pythonVersion && (
                    <Badge>Python {runtime.pythonVersion.split(" ")[0]}</Badge>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void window.kirea.getRuntimeLogs().then(setRuntimeLogs)}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Refresh Process Logs
                </Button>
              </div>

              {runtimeLogs.length > 0 && (
                <pre className="p-3 rounded-xl bg-bg border border-border text-[11px] font-mono text-fg-muted max-h-44 overflow-y-auto whitespace-pre-wrap">
                  {runtimeLogs.slice(-40).join("\n")}
                </pre>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* TAB 2: STORAGE */}
      {tab === "storage" && (
        <Card className="p-4 space-y-5">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-fg-muted">
              Generated Images Output Directory
            </label>
            <div className="flex gap-2">
              <Input aria-label="Generated Images Output Directory" value={settings.outputDirectory} readOnly className="text-xs" />
              <Button
                variant="secondary"
                onClick={() =>
                  void pickAndSaveDir("Select Output Directory", "outputDirectory")
                }
              >
                Change
              </Button>
              <Button
                variant="ghost"
                onClick={() => void window.kirea.openPath(settings.outputDirectory)}
              >
                <FolderOpen className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-fg-muted">
              Downloads Staging Directory
            </label>
            <div className="flex gap-2">
              <Input aria-label="Downloads Staging Directory" value={settings.downloadDirectory} readOnly className="text-xs" />
              <Button
                variant="secondary"
                onClick={() =>
                  void pickAndSaveDir("Select Downloads Directory", "downloadDirectory")
                }
              >
                Change
              </Button>
              <Button
                variant="ghost"
                onClick={() => void window.kirea.openPath(settings.downloadDirectory)}
              >
                <FolderOpen className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t border-border">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-semibold text-fg-muted">
                  Additional Read-Only Model Directories
                </h3>
                <p className="text-[11px] text-fg-subtle">
                  Points Kirea Studio&apos;s model scanner to extra local directories containing checkpoints, LoRAs, or VAEs.
                </p>
              </div>
              <Button size="sm" variant="secondary" onClick={() => void handleAddExtraModelDir()}>
                <Plus className="w-3.5 h-3.5" />
                Add Folder
              </Button>
            </div>

            {settings.extraModelDirs.length === 0 ? (
              <p className="text-xs text-fg-subtle italic">
                No extra model folders configured beyond your active ComfyUI install and app-managed models directory.
              </p>
            ) : (
              <div className="space-y-1.5">
                {settings.extraModelDirs.map((dir) => (
                  <div
                    key={dir}
                    className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-bg border border-border text-xs"
                  >
                    <span className="truncate font-mono">{dir}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void onUpdateSettings({
                          extraModelDirs: settings.extraModelDirs.filter((d) => d !== dir),
                        })
                      }
                    >
                      <Trash2 className="w-3.5 h-3.5 text-danger" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      )}

      {/* TAB 3: PERFORMANCE */}
      {tab === "performance" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {(
              [
                [
                  "balanced",
                  "Balanced Profile",
                  "Recommended 1024px baseline for SDXL (12–16 GB VRAM) with auto-preview enabled.",
                ],
                [
                  "quality",
                  "Quality Profile",
                  "Higher resolution targets (up to 1152–1472px) and high-VRAM retention flags for >=16 GB GPUs.",
                ],
                [
                  "memory_saver",
                  "Memory Saver Profile",
                  "Passes --lowvram flag to owned ComfyUI processes and caps resolution / batch pressure cleanly.",
                ],
              ] as Array<[PerformanceProfile, string, string]>
            ).map(([id, title, desc]) => (
              <Card
                key={id}
                className={`p-4 flex flex-col justify-between gap-3 border-2 ${
                  settings.performanceProfile === id ? "border-accent" : "border-border"
                }`}
              >
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-fg">{title}</h3>
                  <p className="text-xs text-fg-muted leading-relaxed">{desc}</p>
                </div>
                <Button
                  size="sm"
                  variant={settings.performanceProfile === id ? "primary" : "secondary"}
                  onClick={() => void onUpdateSettings({ performanceProfile: id })}
                >
                  {settings.performanceProfile === id ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5" /> Selected
                    </>
                  ) : (
                    "Apply Profile"
                  )}
                </Button>
              </Card>
            ))}
          </div>

          <Card className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-1">
              <label className="text-xs text-fg-muted">Default Steps</label>
              <Input
                type="number"
                aria-label="Default Steps"
                min={1}
                max={120}
                value={settings.defaultSteps}
                onChange={(e) =>
                  void onUpdateSettings({ defaultSteps: Number(e.target.value) || 24 })
                }
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-fg-muted">Default CFG</label>
              <Input
                type="number"
                aria-label="Default CFG"
                step={0.5}
                min={1}
                max={25}
                value={settings.defaultCfg}
                onChange={(e) =>
                  void onUpdateSettings({ defaultCfg: Number(e.target.value) || 6.5 })
                }
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-fg-muted">Default Sampler</label>
              <Select
                aria-label="Default Sampler"
                value={settings.defaultSampler}
                onChange={(e) =>
                  void onUpdateSettings({ defaultSampler: e.target.value })
                }
              >
                {samplersAndSchedulers.samplers.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-fg-muted">Default Output Format</label>
              <Select
                aria-label="Default Output Format"
                value={settings.defaultOutputFormat}
                onChange={(e) =>
                  void onUpdateSettings({
                    defaultOutputFormat: e.target.value as OutputFormat,
                  })
                }
              >
                <option value="png">PNG (Lossless)</option>
                <option value="jpeg">JPEG</option>
                <option value="webp">WebP</option>
              </Select>
            </div>
          </Card>
        </div>
      )}

      {/* TAB: CIVITAI HUB */}
      {tab === "civitai" && (
        <div className="space-y-4">
          <Card className="p-4 space-y-4">
            <div className="flex items-start gap-2.5">
              <KeyRound className="w-4 h-4 text-accent mt-0.5 shrink-0" />
              <div>
                <h3 className="text-sm font-semibold text-fg">Civitai API Key</h3>
                <p className="text-xs text-fg-muted leading-relaxed mt-1">
                  Optional. Required for gated or early-access models. The key is
                  encrypted with the OS keychain (DPAPI) in a dedicated secrets file,
                  never stored in the settings database, and sent only to civitai.com.
                  Public browsing and downloads work without a key.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={settings.civitaiApiKeySet ? "success" : "neutral"}>
                  {settings.civitaiApiKeySet ? "API key stored" : "Public browsing only"}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-2">
                <div className="relative flex-1 min-w-[260px]">
                  <Input
                    aria-label="Civitai API key"
                    type={showApiKey ? "text" : "password"}
                    value={apiKeyDraft}
                    onChange={(e) => setApiKeyDraft(e.target.value)}
                    placeholder={
                      settings.civitaiApiKeySet
                        ? "Stored key — paste a new one to replace it"
                        : "Paste your Civitai API key"
                    }
                    autoComplete="off"
                    spellCheck={false}
                    className="pr-9 font-mono text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey((v) => !v)}
                    aria-label={showApiKey ? "Hide API key" : "Show API key"}
                    className="absolute right-2 top-2 p-0.5 text-fg-subtle hover:text-fg cursor-pointer"
                  >
                    {showApiKey ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
                <Button
                  variant="primary"
                  loading={savingApiKey}
                  onClick={() => void handleSaveCivitaiKey()}
                >
                  Save Key
                </Button>
                {settings.civitaiApiKeySet && (
                  <Button
                    variant="danger"
                    disabled={savingApiKey}
                    onClick={() => void handleClearCivitaiKey()}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                loading={testingCivitai}
                onClick={() => void handleTestCivitai()}
              >
                <Plug className="w-3.5 h-3.5" />
                Test Connection
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void window.kirea.openExternalUrl("https://civitai.com/user/account")
                }
              >
                Get an API key
              </Button>
              {civitaiTest && (
                <Badge tone={civitaiTest.ok ? "success" : "danger"}>
                  {civitaiTest.message}
                </Badge>
              )}
            </div>
          </Card>

          <Card className="p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-fg">Safe Browsing Filter</h3>
              <p className="text-xs text-fg-muted leading-relaxed mt-1 max-w-xl">
                When enabled, Civitai Hub search requests exclude NSFW models. Model
                downloads always remain explicit user actions.
              </p>
            </div>
            <label className="inline-flex items-center gap-2 text-xs text-fg cursor-pointer">
              <input
                type="checkbox"
                checked={settings.nsfwFilter}
                onChange={(e) =>
                  void onUpdateSettings({ nsfwFilter: e.target.checked })
                }
                className="accent-accent"
              />
              Hide NSFW results
            </label>
          </Card>

          <Card className="p-4 space-y-1.5">
            <h3 className="text-sm font-semibold text-fg">Download Destination</h3>
            <p className="text-xs text-fg-muted leading-relaxed">
              Checkpoints, LoRAs, VAEs, and upscalers stream into the active ComfyUI
              models tree (<span className="font-mono text-fg">checkpoints/</span>,{" "}
              <span className="font-mono text-fg">loras/</span>,{" "}
              <span className="font-mono text-fg">vae/</span>,{" "}
              <span className="font-mono text-fg">upscale_models/</span>). Checkpoints
              and LoRAs are nested by architecture (for example{" "}
              <span className="font-mono text-fg">checkpoints/sdxl</span>). Existing
              model files are never moved or modified.
            </p>
            <p className="text-[11px] font-mono text-fg-muted break-all pt-1">
              {settings.externalComfyPath ||
                settings.managedComfyPath ||
                "App-managed models directory"}
            </p>
          </Card>
        </div>
      )}

      {/* TAB 4: INTERFACE, DIAGNOSTICS & NOTICES */}
      {tab === "diagnostics" && (
        <div className="space-y-4">
          <Card className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-xs text-fg-muted">Color Theme</label>
              <Select
                aria-label="Color Theme"
                value={settings.theme}
                onChange={(e) =>
                  void onUpdateSettings({
                    theme: e.target.value as "dark" | "light" | "system",
                  })
                }
              >
                <option value="dark">Dark · Charcoal</option>
                <option value="light">Light · Ivory</option>
                <option value="system">Match system</option>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-fg-muted">Gallery Density</label>
              <Select
                aria-label="Gallery Density"
                value={settings.galleryLayout}
                onChange={(e) =>
                  void onUpdateSettings({
                    galleryLayout: e.target.value as "comfortable" | "compact",
                  })
                }
              >
                <option value="comfortable">Comfortable Cards</option>
                <option value="compact">Compact Grid</option>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-fg-muted">Startup Workspace</label>
              <Select
                aria-label="Startup Workspace"
                value={settings.startupPage}
                onChange={(e) =>
                  void onUpdateSettings({
                    startupPage: e.target.value as NavSection,
                  })
                }
              >
                <option value="home">Home Overview</option>
                <option value="create">Create Studio</option>
                <option value="library">Image Library</option>
              </Select>
            </div>
          </Card>

          <Card className="p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-accent" />
                <h3 className="text-sm font-semibold text-fg">
                  System Hardware &amp; Storage Diagnostics
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void window.kirea.exportLogs().then((p) => p && onToast(`Exported logs to ${p}`))}
                >
                  <FileText className="w-3.5 h-3.5" />
                  Export Diagnostics Logs
                </Button>
              </div>
            </div>

            {hardware && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs bg-bg border border-border rounded-xl p-3.5">
                <div>
                  <div className="text-fg-subtle">GPU / Driver</div>
                  <div className="font-semibold text-fg">{hardware.name}</div>
                  <div className="text-fg-muted">
                    Driver {hardware.driverVersion} • CUDA {hardware.cudaVersion}
                  </div>
                </div>
                <div>
                  <div className="text-fg-subtle">VRAM &amp; System Memory</div>
                  <div className="font-semibold text-fg tabular-nums">
                    {hardware.vramFreeMB} / {hardware.vramTotalMB} MiB VRAM
                  </div>
                  <div className="text-fg-muted tabular-nums">
                    {hardware.systemRamTotalMB} MB RAM
                  </div>
                </div>
                <div>
                  <div className="text-fg-subtle">Free Disk Space</div>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {Object.entries(hardware.diskFreeGB).map(([drive, gb]) => (
                      <Badge key={drive} tone="neutral" className="tabular-nums">
                        <HardDrive className="w-3 h-3" />
                        {drive} {gb} GB
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {diagnostics && (
              <div className="space-y-2 text-xs">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-fg-muted">
                  <div>
                    <span className="text-fg-subtle">Version:</span> Kirea Studio v
                    {diagnostics.appVersion} (Electron {diagnostics.electronVersion}, Node{" "}
                    {diagnostics.nodeVersion})
                  </div>
                  <div className="truncate" title={diagnostics.dbPath}>
                    <span className="text-fg-subtle">SQLite DB:</span> {diagnostics.dbPath}
                  </div>
                </div>
                <pre className="p-3 rounded-xl bg-bg border border-border text-[11px] font-mono text-fg-muted max-h-40 overflow-y-auto whitespace-pre-wrap">
                  {diagnostics.recentLogs.slice(-25).join("\n")}
                </pre>
              </div>
            )}
          </Card>

          <Card className="p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-fg">
              <ShieldCheck className="w-4 h-4 text-success" />
              Licensing, Attribution &amp; Architecture Boundary
            </div>
            <p className="text-xs text-fg-muted leading-relaxed">
              Kirea Studio is original MIT-licensed desktop software (`better-sqlite3`, `sharp`,
              `ws`, `lucide-react`, `zod`, Electron, React). ComfyUI (GPL-3.0)
              runs strictly as an isolated external local subprocess over localhost HTTP/WebSocket
              APIs; no GPL source code is compiled or bundled into Kirea Studio. Workflow JSON
              adaptation insights were derived from MIT-licensed `Comfy-Org/workflow_templates`
              and UX inspiration from `mcmonkeyprojects/SwarmUI` (MIT). See{" "}
              <span className="font-mono text-fg">THIRD_PARTY_NOTICES.md</span> for full notices.
            </p>
            <div className="flex items-center gap-1.5 text-[11px] text-fg-subtle pt-1">
              <Info className="w-3.5 h-3.5" />
              All prompts, workflows, generated images, and models remain strictly on your machine.
            </div>
          </Card>
        </div>
      )}
        </div>
      </div>
    </div>
  );
};

