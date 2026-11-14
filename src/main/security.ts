import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import path from "node:path";
import url from "node:url";

export function isTrustedIpcSender(
  event: IpcMainInvokeEvent,
  mainWindow: BrowserWindow | null,
  expectedHtmlPath: string,
  devServerOrigin: string | null
): boolean {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (event.sender !== mainWindow.webContents) return false;
  const senderUrl = event.senderFrame?.url || event.sender.getURL();
  if (!senderUrl) return false;

  if (devServerOrigin && senderUrl.startsWith(devServerOrigin)) {
    return true;
  }

  try {
    const resolved = path.resolve(url.fileURLToPath(senderUrl));
    return resolved.toLowerCase() === path.resolve(expectedHtmlPath).toLowerCase();
  } catch {
    return false;
  }
}

export function isAllowedLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "localhost" ||
    normalized === "::1"
  );
}

export function isPathInsideAnyRoot(targetPath: string, allowedRoots: string[]): boolean {
  const resolvedTarget = path.resolve(targetPath).toLowerCase();
  return allowedRoots.some((root) => {
    if (!root) return false;
    const resolvedRoot = path.resolve(root).toLowerCase();
    return (
      resolvedTarget === resolvedRoot ||
      resolvedTarget.startsWith(resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep)
    );
  });
}

export function assertSafeExternalUrl(rawUrl: string): URL {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`Unsupported URL protocol: ${parsed.protocol}`);
  }
  return parsed;
}

