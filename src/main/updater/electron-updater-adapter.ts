import { app } from "electron";
import path from "node:path";
import type { NsisUpdater } from "electron-updater";
import type { StudioLogger } from "../logger";
import type { UpdaterAdapter, UpdaterHandle } from "./update-service";

/**
 * electron-updater is imported lazily so the service can be unit tested with a
 * fake adapter and so dev builds never construct the native update feed.
 */
export async function createElectronUpdaterHandle(
  logger: StudioLogger
): Promise<UpdaterHandle> {
  const { autoUpdater, CancellationToken } = await import("electron-updater");

  // Install updates into the folder the app actually runs from, even when the
  // user picked a custom directory during setup.
  (autoUpdater as NsisUpdater).installDirectory = path.dirname(app.getPath("exe"));

  autoUpdater.logger = {
    info: (message?: unknown) => logger.info("updater", String(message ?? "")),
    warn: (message?: unknown) => logger.warn("updater", String(message ?? "")),
    error: (message?: unknown) => logger.error("updater", String(message ?? "")),
    debug: (message?: unknown) => logger.debug("updater", String(message ?? "")),
  };

  const adapter: UpdaterAdapter = {
    on(event, listener) {
      autoUpdater.on(event as never, listener as never);
      return autoUpdater;
    },
    checkForUpdates: () => autoUpdater.checkForUpdates(),
    downloadUpdate: (cancellationToken) =>
      autoUpdater.downloadUpdate(
        cancellationToken as unknown as Parameters<typeof autoUpdater.downloadUpdate>[0]
      ),
    quitAndInstall: (isSilent = false, isForceRunAfter = true) =>
      autoUpdater.quitAndInstall(isSilent, isForceRunAfter),
    setAllowPrerelease: (value) => {
      autoUpdater.allowPrerelease = value;
    },
    configure: ({ autoDownload, allowDowngrade, autoInstallOnAppQuit, allowPrerelease }) => {
      autoUpdater.autoDownload = autoDownload;
      autoUpdater.allowDowngrade = allowDowngrade;
      autoUpdater.autoInstallOnAppQuit = autoInstallOnAppQuit;
      autoUpdater.allowPrerelease = allowPrerelease;
      autoUpdater.disableWebInstaller = true;
    },
  };

  return {
    adapter,
    createCancellationToken: () => new CancellationToken(),
  };
}
