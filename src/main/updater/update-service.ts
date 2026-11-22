import { EventEmitter } from "node:events";
import {
  isNewerVersion,
  normalizeReleaseNotes,
  toUpdateProgress,
} from "../../shared/update-utils";
import type {
  UpdateChannel,
  UpdateInstallResult,
  UpdateState,
} from "../../shared/update-types";
import type { StudioLogger } from "../logger";
import type { UpdatePreferenceStore } from "./update-preference-store";

export type UpdaterEventName =
  | "checking-for-update"
  | "update-available"
  | "update-not-available"
  | "download-progress"
  | "update-downloaded"
  | "error";

export interface CancellationTokenLike {
  cancel(): void;
}

export interface UpdaterAdapter {
  on(event: UpdaterEventName, listener: (payload?: unknown) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(cancellationToken: CancellationTokenLike): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  setAllowPrerelease(value: boolean): void;
  configure(options: {
    autoDownload: boolean;
    allowDowngrade: boolean;
    autoInstallOnAppQuit: boolean;
    allowPrerelease: boolean;
  }): void;
}

export interface UpdaterHandle {
  adapter: UpdaterAdapter;
  createCancellationToken: () => CancellationTokenLike;
}

export interface UpdateServiceOptions {
  logger: StudioLogger;
  store: UpdatePreferenceStore;
  getCurrentVersion: () => string;
  /** Packaged, non-dev builds with a generated update feed. */
  isEnabled: () => boolean;
  getAutomaticChecksEnabled: () => boolean;
  getActiveJobCount: () => number;
  beforeInstall: () => Promise<void>;
  createAdapter: () => Promise<UpdaterHandle>;
  now?: () => Date;
  startupDelayMs?: number;
  intervalMs?: number;
}

const DEFAULT_STARTUP_DELAY_MS = 20_000;
const DEFAULT_INTERVAL_MS = 4 * 60 * 60 * 1000;

function describeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  if (/net::|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|socket hang up|network/i.test(raw)) {
    return "Could not reach the update server. Check your connection and try again.";
  }
  if (/404|cannot find latest|latest\.yml|no published builds/i.test(raw)) {
    return "No update feed is available for this version yet.";
  }
  if (/app-update\.yml|ENOENT/i.test(raw)) {
    return "This build has no update feed configured. Install a newer release from GitHub.";
  }
  if (/sha512|checksum|integrity/i.test(raw)) {
    return "The downloaded update failed its integrity check and was discarded.";
  }
  return raw.trim() || "The update operation failed.";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readVersion(payload: unknown): string | null {
  const version = asRecord(payload).version;
  return typeof version === "string" && version.trim() ? version.trim() : null;
}

function readReleaseDate(payload: unknown): string | null {
  const raw = asRecord(payload).releaseDate;
  if (typeof raw !== "string" || !raw.trim()) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export class UpdateService extends EventEmitter {
  private readonly options: UpdateServiceOptions;
  private readonly prefs: ReturnType<UpdatePreferenceStore["read"]>;
  private dismissedVersion: string | null;
  private state: UpdateState;
  private adapterPromise: Promise<UpdaterHandle | null> | null = null;
  private checkInFlight = false;
  private downloadToken: CancellationTokenLike | null = null;
  private cancelRequested = false;
  private installing = false;
  private stateListeners = new Set<(state: UpdateState) => void>();
  private timers: NodeJS.Timeout[] = [];
  private disposed = false;

  constructor(options: UpdateServiceOptions) {
    super();
    this.options = options;
    this.prefs = options.store.read();
    this.dismissedVersion = this.prefs.dismissedVersion;
    const enabled = options.isEnabled();
    this.state = {
      phase: enabled ? "idle" : "disabled",
      currentVersion: options.getCurrentVersion(),
      availableVersion: null,
      releaseNotes: null,
      releaseDate: null,
      progress: null,
      error: null,
      lastCheckedAt: this.prefs.lastCheckedAt,
      channel: this.prefs.channel,
      canCheck: enabled,
      dismissed: false,
    };
  }

  getState(): UpdateState {
    return {
      ...this.state,
      currentVersion: this.options.getCurrentVersion(),
      progress: this.state.progress ? { ...this.state.progress } : null,
    };
  }

  isInstalling(): boolean {
    return this.installing;
  }

  onStateChanged(listener: (state: UpdateState) => void): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  scheduleAutomaticChecks(): void {
    if (this.disposed || !this.options.isEnabled() || !this.options.getAutomaticChecksEnabled()) {
      return;
    }
    const startup = setTimeout(() => {
      void this.checkForUpdates(false);
    }, this.options.startupDelayMs ?? DEFAULT_STARTUP_DELAY_MS);
    startup.unref();
    const interval = setInterval(
      () => {
        void this.checkForUpdates(false);
      },
      this.options.intervalMs ?? DEFAULT_INTERVAL_MS
    );
    interval.unref();
    this.timers.push(startup, interval);
  }

  dispose(): void {
    this.disposed = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
    this.stateListeners.clear();
  }

  async checkForUpdates(manual = true): Promise<UpdateState> {
    if (!this.options.isEnabled()) return this.getState();
    if (!manual && !this.options.getAutomaticChecksEnabled()) return this.getState();
    if (
      this.checkInFlight ||
      this.state.phase === "downloading" ||
      this.state.phase === "downloaded" ||
      this.state.phase === "installing"
    ) {
      return this.getState();
    }

    const handle = await this.getAdapter();
    if (!handle) return this.getState();

    this.checkInFlight = true;
    this.setState({ phase: "checking", error: null, progress: null });
    try {
      await handle.adapter.checkForUpdates();
    } catch (err) {
      this.options.logger.warn("updater", "Update check failed", err);
      this.setState({
        phase: "error",
        error: describeError(err),
        progress: null,
        lastCheckedAt: this.nowIso(),
      });
    } finally {
      this.checkInFlight = false;
      if (this.state.phase === "checking") {
        this.options.store.patch({ lastCheckedAt: this.nowIso() });
        this.setState({ phase: "up-to-date", lastCheckedAt: this.nowIso() });
      }
    }
    return this.getState();
  }

  async downloadUpdate(): Promise<UpdateState> {
    if (!this.options.isEnabled()) return this.getState();
    if (this.state.phase === "downloading" || this.state.phase === "installing") {
      return this.getState();
    }
    if (!this.state.availableVersion) return this.getState();

    const handle = await this.getAdapter();
    if (!handle) return this.getState();

    this.cancelRequested = false;
    const token = handle.createCancellationToken();
    this.downloadToken = token;
    this.setState({
      phase: "downloading",
      error: null,
      progress: {
        percent: 0,
        transferredBytes: 0,
        totalBytes: 0,
        bytesPerSecond: 0,
      },
    });

    try {
      await handle.adapter.downloadUpdate(token);
      if (this.getState().phase === "downloading") {
        this.setState({
          phase: "downloaded",
          progress: this.state.progress
            ? { ...this.state.progress, percent: 100 }
            : { percent: 100, transferredBytes: 0, totalBytes: 0, bytesPerSecond: 0 },
        });
      }
    } catch (err) {
      if (this.cancelRequested) {
        if (this.state.phase !== "downloaded") {
          this.setState({ phase: "available", progress: null, error: null });
        }
      } else {
        this.options.logger.warn("updater", "Update download failed", err);
        this.setState({ phase: "error", error: describeError(err), progress: null });
      }
    } finally {
      this.downloadToken = null;
      this.cancelRequested = false;
    }
    return this.getState();
  }

  cancelDownload(): UpdateState {
    if (this.state.phase !== "downloading") return this.getState();
    this.cancelRequested = true;
    try {
      this.downloadToken?.cancel();
    } catch {
      // token cancellation is best effort
    }
    this.setState({ phase: "available", progress: null, error: null });
    return this.getState();
  }

  dismissUpdate(): UpdateState {
    if (!this.state.availableVersion) return this.getState();
    this.dismissedVersion = this.state.availableVersion;
    this.options.store.patch({ dismissedVersion: this.dismissedVersion });
    this.setState({ dismissed: true });
    return this.getState();
  }

  setChannel(channel: UpdateChannel): UpdateState {
    if (this.state.channel === channel) return this.getState();
    this.options.store.patch({ channel });
    this.setState({
      channel,
      phase: this.options.isEnabled() ? "idle" : "disabled",
      availableVersion: null,
      releaseNotes: null,
      releaseDate: null,
      progress: null,
      error: null,
      dismissed: false,
    });
    void this.adapterPromise?.then((handle) => {
      handle?.adapter.setAllowPrerelease(channel === "prerelease");
    });
    return this.getState();
  }

  async installUpdate(force = false): Promise<UpdateInstallResult> {
    const activeJobs = this.options.getActiveJobCount();
    if (!this.options.isEnabled()) {
      return { started: false, activeJobs, reason: "disabled" };
    }
    if (this.state.phase !== "downloaded" || this.installing) {
      return { started: false, activeJobs, reason: "not-ready" };
    }
    if (activeJobs > 0 && !force) {
      return { started: false, activeJobs, reason: "active-jobs" };
    }

    const handle = await this.getAdapter();
    if (!handle) {
      return { started: false, activeJobs, reason: "disabled" };
    }

    this.options.logger.info(
      "updater",
      force && activeJobs > 0
        ? `Installing update with ${activeJobs} active job(s); user confirmed restart.`
        : "Installing downloaded update."
    );
    this.setState({ phase: "installing", error: null });

    try {
      await this.options.beforeInstall();
    } catch (err) {
      this.options.logger.error("updater", "Could not prepare the app for update install", err);
      this.setState({
        phase: "error",
        error: "Could not prepare the app for installation. Close Kirea Studio and run the installer manually.",
      });
      return { started: false, activeJobs, reason: "not-ready" };
    }

    this.installing = true;
    setImmediate(() => {
      try {
        handle.adapter.quitAndInstall(false, true);
      } catch (err) {
        this.installing = false;
        this.options.logger.error("updater", "quitAndInstall failed", err);
        this.setState({
          phase: "error",
          error: "The installer could not start. Restart Kirea Studio and try again.",
        });
      }
    });
    return { started: true, activeJobs, reason: null };
  }

  private nowIso(): string {
    return (this.options.now?.() ?? new Date()).toISOString();
  }

  private setState(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch };
    const snapshot = this.getState();
    for (const listener of this.stateListeners) {
      try {
        listener(snapshot);
      } catch {
        // listener errors must never break the updater
      }
    }
    this.emit("stateChanged", snapshot);
  }

  private async getAdapter(): Promise<UpdaterHandle | null> {
    if (!this.options.isEnabled()) return null;
    if (this.adapterPromise) return this.adapterPromise;

    this.adapterPromise = this.options
      .createAdapter()
      .then((handle) => {
        this.wireAdapter(handle.adapter);
        return handle;
      })
      .catch((err) => {
        this.adapterPromise = null;
        this.options.logger.error("updater", "Could not initialize the updater", err);
        this.setState({
          phase: "error",
          error: "The updater could not start in this build.",
        });
        return null;
      });
    return this.adapterPromise;
  }

  private wireAdapter(adapter: UpdaterAdapter): void {
    adapter.configure({
      autoDownload: false,
      allowDowngrade: false,
      autoInstallOnAppQuit: false,
      allowPrerelease: this.state.channel === "prerelease",
    });

    adapter.on("checking-for-update", () => {
      if (this.state.phase !== "downloading" && this.state.phase !== "downloaded") {
        this.setState({ phase: "checking", error: null });
      }
    });

    adapter.on("update-available", (info) => {
      const version = readVersion(info);
      const currentVersion = this.options.getCurrentVersion();
      if (!version || !isNewerVersion(version, currentVersion)) {
        this.setState({
          phase: "up-to-date",
          availableVersion: null,
          releaseNotes: null,
          releaseDate: null,
          progress: null,
          error: null,
          dismissed: false,
          lastCheckedAt: this.nowIso(),
        });
        return;
      }
      const notes = normalizeReleaseNotes(asRecord(info).releaseNotes);
      const dismissed = this.dismissedVersion === version;
      this.options.store.patch({ lastCheckedAt: this.nowIso() });
      this.options.logger.info(
        "updater",
        `Update ${version} available (installed ${currentVersion}).`
      );
      this.setState({
        phase: "available",
        availableVersion: version,
        releaseNotes: notes,
        releaseDate: readReleaseDate(info),
        progress: null,
        error: null,
        dismissed,
        lastCheckedAt: this.nowIso(),
      });
    });

    adapter.on("update-not-available", () => {
      this.options.store.patch({ lastCheckedAt: this.nowIso() });
      this.setState({
        phase: "up-to-date",
        availableVersion: null,
        releaseNotes: null,
        releaseDate: null,
        progress: null,
        error: null,
        dismissed: false,
        lastCheckedAt: this.nowIso(),
      });
    });

    adapter.on("download-progress", (payload) => {
      if (this.state.phase !== "downloading") return;
      this.setState({ progress: toUpdateProgress(asRecord(payload)) });
    });

    adapter.on("update-downloaded", (info) => {
      const version = readVersion(info) ?? this.state.availableVersion;
      this.options.logger.info("updater", `Update ${version ?? ""} downloaded.`.trim());
      this.setState({
        phase: "downloaded",
        availableVersion: version,
        releaseNotes:
          normalizeReleaseNotes(asRecord(info).releaseNotes) ?? this.state.releaseNotes,
        progress: this.state.progress
          ? { ...this.state.progress, percent: 100 }
          : { percent: 100, transferredBytes: 0, totalBytes: 0, bytesPerSecond: 0 },
      });
    });

    adapter.on("error", (err) => {
      if (this.cancelRequested && this.state.phase !== "downloading") return;
      if (
        this.state.phase === "downloading" &&
        /cancel/i.test((err as Error | undefined)?.message ?? "")
      ) {
        this.setState({ phase: "available", progress: null, error: null });
        return;
      }
      const message = describeError(err);
      this.options.logger.warn("updater", "Updater error event", err);
      this.setState({
        phase: "error",
        error: message,
        progress: this.state.phase === "downloading" ? null : this.state.progress,
      });
    });
  }
}
