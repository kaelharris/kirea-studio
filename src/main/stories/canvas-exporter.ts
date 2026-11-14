import { BrowserWindow } from "electron";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildCanvasPages,
  type CanvasLayoutPanel,
} from "../../shared/canvas-layout";
import {
  buildStoryboardHtml,
  storySlug,
  type StoryboardHtmlPage,
  type StoryboardHtmlPanel,
} from "../../shared/canvas-html";
import type {
  GeneratedImageRecord,
  StoryCanvas,
  StoryScene,
} from "../../shared/types";
import { isPathInsideAnyRoot } from "../security";

export interface CanvasExportInput {
  canvas: StoryCanvas;
  storyTitle: string;
  scenes: StoryScene[];
  images: GeneratedImageRecord[];
  allowedRoots: string[];
}

export interface CanvasExportFile {
  filePath: string;
  pageIndex: number;
}

export interface CanvasExportOutput {
  files: CanvasExportFile[];
  pageCount: number;
  width: number;
  height: number;
}

export function resolveStoryExportDir(
  picturesDir: string,
  storyTitle: string
): string {
  return path.join(picturesDir, "Kirea Studio", "Stories", storySlug(storyTitle));
}

export function mediaSrcForImage(
  filePath: string | null,
  allowedRoots: string[]
): string | null {
  if (!filePath) return null;
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) return null;
  if (!isPathInsideAnyRoot(resolved, allowedRoots)) return null;
  return `kirea-media://image/?p=${encodeURIComponent(resolved)}`;
}

export function buildStoryboardPages(
  input: CanvasExportInput
): StoryboardHtmlPage[] {
  const sceneById = new Map(input.scenes.map((scene) => [scene.id, scene]));
  const imageById = new Map(input.images.map((image) => [image.id, image]));
  const layoutPages = buildCanvasPages(
    input.canvas,
    input.canvas.items,
    input.scenes
  );

  return layoutPages.map((page) => ({
    width: page.width,
    height: page.height,
    panels: page.panels.map((panel: CanvasLayoutPanel): StoryboardHtmlPanel => {
      const image = panel.item.imageId
        ? imageById.get(panel.item.imageId) ?? null
        : null;
      const scene = panel.item.sceneId
        ? sceneById.get(panel.item.sceneId) ?? null
        : null;
      return {
        slot: panel.slot,
        imageSrc: mediaSrcForImage(image?.filePath ?? null, input.allowedRoots),
        fit: panel.item.fit,
        caption: panel.caption,
        overlays: panel.item.overlays,
        alt: scene?.title || `Story panel ${panel.pagePosition + 1}`,
      };
    }),
  }));
}

async function withRenderWindow<T>(
  width: number,
  height: number,
  fn: (win: BrowserWindow) => Promise<T>
): Promise<T> {
  const win = new BrowserWindow({
    show: false,
    width,
    height,
    useContentSize: true,
    frame: false,
    backgroundColor: "#00000000",
    paintWhenInitiallyHidden: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  win.setContentSize(width, height);
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());

  try {
    return await fn(win);
  } finally {
    if (!win.isDestroyed()) {
      win.destroy();
    }
  }
}

async function waitForPagePaint(win: BrowserWindow): Promise<void> {
  await win.webContents.executeJavaScript(
    `(async () => {
      try { await document.fonts.ready; } catch {}
      await Promise.all(Array.from(document.images).map((img) => {
        if (img.complete) return true;
        return new Promise((resolve) => {
          img.addEventListener("load", resolve, { once: true });
          img.addEventListener("error", resolve, { once: true });
        });
      }));
      return true;
    })()`
  );
  await new Promise((resolve) => setTimeout(resolve, 60));
}

async function capturePaintedPage(
  win: BrowserWindow,
  rect: { x: number; y: number; width: number; height: number }
): Promise<Electron.NativeImage> {
  // The first capture after a hidden window loads can race the compositor and
  // fail with UnknownVizError; retry until a frame is available.
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const image = await win.webContents.capturePage(rect);
      if (!image.isEmpty()) return image;
      lastError = new Error("Canvas page rendered empty.");
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw lastError ?? new Error("Canvas page capture failed.");
}

async function renderHtmlFile(
  win: BrowserWindow,
  html: string,
  tempDir: string,
  name: string
): Promise<string> {
  const filePath = path.join(tempDir, name);
  await fs.promises.writeFile(filePath, html, "utf8");
  await win.loadFile(filePath);
  await waitForPagePaint(win);
  return filePath;
}

async function ensureExportDir(dir: string): Promise<void> {
  await fs.promises.mkdir(dir, { recursive: true });
}

export async function exportCanvasPng(
  input: CanvasExportInput,
  outputDir: string
): Promise<CanvasExportOutput> {
  const pages = buildStoryboardPages(input);
  if (pages.length === 0) {
    throw new Error("This canvas has no panels to export.");
  }

  const width = pages[0]!.width;
  const height = pages[0]!.height;
  const stem = storySlug(input.storyTitle);
  const tempDir = path.join(os.tmpdir(), `kirea-canvas-${randomUUID()}`);
  await fs.promises.mkdir(tempDir, { recursive: true });
  await ensureExportDir(outputDir);

  const files: CanvasExportFile[] = [];
  try {
    await withRenderWindow(width, height, async (win) => {
      for (let index = 0; index < pages.length; index += 1) {
        const page = pages[index]!;
        const html = buildStoryboardHtml({
          canvas: input.canvas,
          pages: [page],
          title: `${input.storyTitle} — page ${index + 1}`,
        });
        await renderHtmlFile(win, html, tempDir, `page-${index + 1}.html`);
        const image = await capturePaintedPage(win, {
          x: 0,
          y: 0,
          width: page.width,
          height: page.height,
        });
        const fileName =
          pages.length === 1
            ? `${stem}.png`
            : `${stem}-${String(index + 1).padStart(2, "0")}.png`;
        const filePath = path.join(outputDir, fileName);
        await fs.promises.writeFile(filePath, image.toPNG());
        files.push({ filePath, pageIndex: index });
      }
    });
  } finally {
    await fs.promises
      .rm(tempDir, { recursive: true, force: true })
      .catch(() => undefined);
  }

  return { files, pageCount: pages.length, width, height };
}

export async function exportCanvasPdf(
  input: CanvasExportInput,
  destinationPath: string
): Promise<CanvasExportOutput> {
  const pages = buildStoryboardPages(input);
  if (pages.length === 0) {
    throw new Error("This canvas has no panels to export.");
  }

  const width = pages[0]!.width;
  const height = pages[0]!.height;
  const tempDir = path.join(os.tmpdir(), `kirea-canvas-${randomUUID()}`);
  await fs.promises.mkdir(tempDir, { recursive: true });
  await ensureExportDir(path.dirname(destinationPath));

  try {
    const html = buildStoryboardHtml({
      canvas: input.canvas,
      pages,
      title: input.storyTitle,
    });
    await withRenderWindow(width, height, async (win) => {
      await renderHtmlFile(win, html, tempDir, "storyboard.html");
      const pdf = await win.webContents.printToPDF({
        printBackground: true,
        preferCSSPageSize: true,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        pageSize: {
          width: Math.round(width * 264.5833),
          height: Math.round(height * 264.5833),
        },
      });
      await fs.promises.writeFile(destinationPath, pdf);
    });
  } finally {
    await fs.promises
      .rm(tempDir, { recursive: true, force: true })
      .catch(() => undefined);
  }

  return {
    files: [{ filePath: destinationPath, pageIndex: 0 }],
    pageCount: pages.length,
    width,
    height,
  };
}
