import { afterEach, describe, expect, it, vi } from "vitest";
import type { StudioLogger } from "../../src/main/logger";
import type {
  UpdatePreferenceStore,
  UpdatePreferences,
} from "../../src/main/updater/update-preference-store";
import {
  UpdateService,
  type CancellationTokenLike,
  type UpdaterAdapter,
  type UpdaterEventName,
  type UpdateServiceOptions,
} from "../../src/main/updater/update-service";

class FakeToken implements CancellationTokenLike {
  cancelled = false;
  onCancel: (() => void) | null = null;
  cancel(): void {
    this.cancelled = true;
    this.onCancel?.();
  }
}

class FakeAdapter implements UpdaterAdapter {
  handlers = new Map<UpdaterEventName, Array<(payload?: unknown) => void>>();
  configureCalls: Array<Record<string, unknown>> = [];
  allowPrerelease = false;
  checkCalls = 0;
  downloadCalls = 0;
  quitCalls: Array<[boolean | undefined, boolean | undefined]> = [];
  lastToken: FakeToken | null = null;
  checkImpl: () => Promise<unknown> = async () => undefined;
  downloadImpl: (token: CancellationTokenLike) => Promise<unknown> = async () => undefined;

  on(event: UpdaterEventName, listener: (payload?: unknown) => void): unknown {
    const list = this.handlers.get(event) ?? [];
    list.push(listener);
    this.handlers.set(event, list);
    return this;
  }

  configure(options: {
    autoDownload: boolean;
    allowDowngrade: boolean;
    autoInstallOnAppQuit: boolean;
    allowPrerelease: boolean;
  }): void {
    this.configureCalls.push({ ...options });
    this.allowPrerelease = options.allowPrerelease;
  }

  checkForUpdates(): Promise<unknown> {
    this.checkCalls += 1;
    return this.checkImpl();
  }

  downloadUpdate(token: CancellationTokenLike): Promise<unknown> {
    this.downloadCalls += 1;
    this.lastToken = token as FakeToken;
    return this.downloadImpl(token);
  }

  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void {
    this.quitCalls.push([isSilent, isForceRunAfter]);
  }

  setAllowPrerelease(value: boolean): void {
    this.allowPrerelease = value;
  }

  emit(event: UpdaterEventName, payload?: unknown): void {
    for (const listener of this.handlers.get(event) ?? []) listener(payload);
  }
}

function memoryStore(initial: Partial<UpdatePreferences> = {}) {
  let prefs: UpdatePreferences = {
    channel: "stable",
    dismissedVersion: null,
    lastCheckedAt: null,
    ...initial,
  };
  const store: UpdatePreferenceStore = {
    read: () => ({ ...prefs }),
    patch: (partial) => {
      prefs = { ...prefs, ...partial };
      return { ...prefs };
    },
  };
  return { store, read: () => ({ ...prefs }) };
}

function makeLogger(): StudioLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as StudioLogger;
}

interface SetupOptions {
  prefs?: Partial<UpdatePreferences>;
  enabled?: boolean;
  automatic?: boolean;
  currentVersion?: string;
  activeJobs?: () => number;
}

function setup(overrides: SetupOptions = {}) {
  const adapter = new FakeAdapter();
  const memory = memoryStore(overrides.prefs);
  const states: string[] = [];
  const options: UpdateServiceOptions = {
    logger: makeLogger(),
    store: memory.store,
    getCurrentVersion: () => overrides.currentVersion ?? "1.0.4",
    isEnabled: () => overrides.enabled ?? true,
    getAutomaticChecksEnabled: () => overrides.automatic ?? true,
    getActiveJobCount: overrides.activeJobs ?? (() => 0),
    beforeInstall: vi.fn(async () => undefined),
    createAdapter: async () => ({
      adapter,
      createCancellationToken: () => new FakeToken(),
    }),
    now: () => new Date("2026-11-17T10:00:00.000Z"),
    startupDelayMs: 1000,
    intervalMs: 60_000,
  };
  const service = new UpdateService(options);
  service.onStateChanged((state) => states.push(state.phase));
  return { service, adapter, memory, options, states };
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

afterEach(() => {
  vi.useRealTimers();
});

describe("UpdateService checks", () => {
  it("is disabled in unpackaged builds and never touches the feed", async () => {
    const { service, adapter } = setup({ enabled: false });
    const state = await service.checkForUpdates(true);
    expect(state.phase).toBe("disabled");
    expect(state.canCheck).toBe(false);
    expect(adapter.checkCalls).toBe(0);
    service.dispose();
  });

  it("reports checking then available with normalized notes", async () => {
    const { service, adapter } = setup();
    adapter.checkImpl = async () => {
      adapter.emit("update-available", {
        version: "1.1.0",
        releaseNotes: "<p>New updater</p>",
        releaseDate: "2026-11-17T00:00:00.000Z",
      });
    };
    const state = await service.checkForUpdates(true);
    expect(state.phase).toBe("available");
    expect(state.availableVersion).toBe("1.1.0");
    expect(state.releaseNotes).toBe("New updater");
    expect(state.dismissed).toBe(false);
    expect(state.lastCheckedAt).toBe("2026-11-17T10:00:00.000Z");
    service.dispose();
  });

  it("never offers a downgrade or the same version", async () => {
    const { service, adapter } = setup({ currentVersion: "1.0.4" });
    adapter.checkImpl = async () => {
      adapter.emit("update-available", { version: "1.0.1" });
    };
    const state = await service.checkForUpdates(true);
    expect(state.phase).toBe("up-to-date");
    expect(state.availableVersion).toBeNull();
    service.dispose();
  });

  it("falls back to up-to-date when the adapter resolves without events", async () => {
    const { service } = setup();
    const state = await service.checkForUpdates(true);
    expect(state.phase).toBe("up-to-date");
    service.dispose();
  });

  it("surfaces check failures without throwing", async () => {
    const { service, adapter } = setup();
    adapter.checkImpl = async () => {
      throw new Error("net::ERR_INTERNET_DISCONNECTED");
    };
    const state = await service.checkForUpdates(true);
    expect(state.phase).toBe("error");
    expect(state.error).toContain("Could not reach the update server");
    service.dispose();
  });

  it("prevents concurrent checks", async () => {
    const { service, adapter } = setup();
    let release!: () => void;
    adapter.checkImpl = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    const first = service.checkForUpdates(true);
    await tick();
    const second = await service.checkForUpdates(true);
    expect(second.phase).toBe("checking");
    expect(adapter.checkCalls).toBe(1);
    release();
    await first;
    expect(service.getState().phase).toBe("up-to-date");
    service.dispose();
  });

  it("skips automatic checks when the user disabled them", async () => {
    const { service, adapter } = setup({ automatic: false });
    const state = await service.checkForUpdates(false);
    expect(state.phase).toBe("idle");
    expect(adapter.checkCalls).toBe(0);
    service.dispose();
  });
});

describe("UpdateService dismissal", () => {
  it("remembers a dismissed version across services", async () => {
    const memory = memoryStore();
    const adapter = new FakeAdapter();
    const options = {
      logger: makeLogger(),
      store: memory.store,
      getCurrentVersion: () => "1.0.4",
      isEnabled: () => true,
      getAutomaticChecksEnabled: () => true,
      getActiveJobCount: () => 0,
      beforeInstall: async () => undefined,
      createAdapter: async () => ({ adapter, createCancellationToken: () => new FakeToken() }),
      now: () => new Date("2026-11-17T10:00:00.000Z"),
    };
    adapter.checkImpl = async () => {
      adapter.emit("update-available", { version: "1.1.0" });
    };
    const first = new UpdateService(options);
    await first.checkForUpdates(true);
    expect(first.dismissUpdate().dismissed).toBe(true);
    expect(memory.read().dismissedVersion).toBe("1.1.0");
    first.dispose();

    const second = new UpdateService(options);
    const state = await second.checkForUpdates(true);
    expect(state.phase).toBe("available");
    expect(state.dismissed).toBe(true);
    second.dispose();
  });
});

describe("UpdateService downloads", () => {
  async function availableService(overrides: SetupOptions = {}) {
    const ctx = setup(overrides);
    ctx.adapter.checkImpl = async () => {
      ctx.adapter.emit("update-available", { version: "1.1.0", releaseNotes: "Notes" });
    };
    await ctx.service.checkForUpdates(true);
    return ctx;
  }

  it("streams real adapter progress and finishes downloaded", async () => {
    const { service, adapter } = await availableService();
    adapter.downloadImpl = async () => {
      adapter.emit("download-progress", {
        percent: 42,
        transferred: 420,
        total: 1000,
        bytesPerSecond: 200,
      });
      adapter.emit("update-downloaded", { version: "1.1.0" });
    };
    const state = await service.downloadUpdate();
    expect(adapter.downloadCalls).toBe(1);
    expect(state.phase).toBe("downloaded");
    expect(state.progress?.percent).toBe(100);
    expect(state.progress?.transferredBytes).toBe(420);
    service.dispose();
  });

  it("returns to available when the user cancels", async () => {
    const { service, adapter } = await availableService();
    let rejectDownload!: (err: Error) => void;
    adapter.downloadImpl = (token) =>
      new Promise((_resolve, reject) => {
        rejectDownload = reject;
        (token as FakeToken).onCancel = () => reject(new Error("Download cancelled"));
      });
    const download = service.downloadUpdate();
    await tick();
    expect(service.getState().phase).toBe("downloading");
    const cancelled = service.cancelDownload();
    expect(cancelled.phase).toBe("available");
    rejectDownload(new Error("Download cancelled"));
    const final = await download;
    expect(final.phase).toBe("available");
    expect(final.error).toBeNull();
    service.dispose();
  });

  it("reports download failures as retryable errors", async () => {
    const { service, adapter } = await availableService();
    adapter.downloadImpl = async () => {
      throw new Error("sha512 checksum mismatch");
    };
    const state = await service.downloadUpdate();
    expect(state.phase).toBe("error");
    expect(state.error).toContain("integrity check");
    service.dispose();
  });
});

describe("UpdateService install", () => {
  async function downloadedService(activeJobs: () => number) {
    const ctx = setup({ activeJobs });
    ctx.adapter.checkImpl = async () => {
      ctx.adapter.emit("update-available", { version: "1.1.0" });
    };
    await ctx.service.checkForUpdates(true);
    ctx.adapter.downloadImpl = async () => {
      ctx.adapter.emit("update-downloaded", { version: "1.1.0" });
    };
    await ctx.service.downloadUpdate();
    return ctx;
  }

  it("blocks installation while generation jobs are running", async () => {
    const { service, adapter, options } = await downloadedService(() => 2);
    const result = await service.installUpdate(false);
    expect(result).toEqual({ started: false, activeJobs: 2, reason: "active-jobs" });
    expect(adapter.quitCalls).toHaveLength(0);
    expect(options.beforeInstall).not.toHaveBeenCalled();
    service.dispose();
  });

  it("installs after explicit confirmation, cleaning up first", async () => {
    const { service, adapter, options } = await downloadedService(() => 2);
    const result = await service.installUpdate(true);
    expect(result.started).toBe(true);
    expect(options.beforeInstall).toHaveBeenCalledTimes(1);
    await tick();
    expect(adapter.quitCalls).toEqual([[false, true]]);
    expect(service.isInstalling()).toBe(true);
    service.dispose();
  });

  it("refuses to install before a download finished", async () => {
    const { service, adapter } = setup();
    const result = await service.installUpdate(true);
    expect(result.reason).toBe("not-ready");
    expect(adapter.quitCalls).toHaveLength(0);
    service.dispose();
  });

  it("does not quit when cleanup fails", async () => {
    const { service, adapter, options } = await downloadedService(() => 0);
    options.beforeInstall = vi.fn(async () => {
      throw new Error("db busy");
    });
    const result = await service.installUpdate(false);
    expect(result.started).toBe(false);
    expect(adapter.quitCalls).toHaveLength(0);
    expect(service.getState().phase).toBe("error");
    service.dispose();
  });
});

describe("UpdateService channel and scheduling", () => {
  it("persists prerelease channel and applies it to the adapter", async () => {
    const { service, adapter, memory } = setup();
    await service.checkForUpdates(true);
    const state = service.setChannel("prerelease");
    await tick();
    expect(state.channel).toBe("prerelease");
    expect(memory.read().channel).toBe("prerelease");
    expect(adapter.allowPrerelease).toBe(true);
    expect(service.getState().phase).toBe("idle");
    service.dispose();
  });

  it("starts with the persisted channel", () => {
    const { service } = setup({ prefs: { channel: "prerelease" } });
    expect(service.getState().channel).toBe("prerelease");
    service.dispose();
  });

  it("schedules a delayed startup check when enabled", async () => {
    vi.useFakeTimers();
    const { service, adapter } = setup();
    service.scheduleAutomaticChecks();
    await vi.advanceTimersByTimeAsync(999);
    expect(adapter.checkCalls).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(adapter.checkCalls).toBe(1);
    service.dispose();
  });

  it("repeats checks on the periodic interval and stops after dispose", async () => {
    vi.useFakeTimers();
    const { service, adapter } = setup();
    service.scheduleAutomaticChecks();
    await vi.advanceTimersByTimeAsync(1000);
    expect(adapter.checkCalls).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(adapter.checkCalls).toBe(2);
    service.dispose();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(adapter.checkCalls).toBe(2);
  });

  it("does not schedule checks when automatic checks are off", async () => {
    vi.useFakeTimers();
    const { service, adapter } = setup({ automatic: false });
    service.scheduleAutomaticChecks();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(adapter.checkCalls).toBe(0);
    service.dispose();
  });
});
