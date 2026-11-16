import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

export interface RenderedFrame {
  name: string;
  duration: number;
  data: Uint8ClampedArray;
}

export interface RenderedProject {
  width: number;
  height: number;
  frames: RenderedFrame[];
  animations: Record<string, { frames: number[]; loop: boolean; duration: number }>;
  warnings: string[];
  sheet: { columns: number; padding: number; scale: number };
}

export interface PixelAtlas {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  metadata: {
    frames: Record<
      string,
      {
        frame: { x: number; y: number; w: number; h: number };
        spriteSourceSize: { x: number; y: number; w: number; h: number };
        sourceSize: { w: number; h: number };
        duration: number;
      }
    >;
    animations: Record<string, { frames: string[]; loop: boolean; duration: number }>;
    meta: { image: string; size: { w: number; h: number }; scale: string; frameTags: unknown[] };
  };
}

export interface SpriteFramesAtlas {
  frames: Record<
    string,
    {
      frame: { x: number; y: number; w: number; h: number };
      spriteSourceSize: { x: number; y: number; w: number; h: number };
      sourceSize: { w: number; h: number };
      duration: number;
    }
  >;
  animations: Record<string, { frames: string[]; loop: boolean }>;
  meta: { image: string };
}

export interface PixelboltModule {
  renderProject(spec: unknown): RenderedProject;
  buildAtlas(project: RenderedProject): PixelAtlas;
  encodePNG(data: Uint8ClampedArray, width: number, height: number): Buffer;
  encodeGIF(
    frames: Array<{ data: Uint8ClampedArray; duration: number }>,
    width: number,
    height: number,
    options?: { loop?: boolean; scale?: number; background?: [number, number, number] | null }
  ): {
    data: Uint8Array;
    width: number;
    height: number;
    colors: number;
    transparent: boolean;
    delays: number[];
    partialAlpha: number;
  };
  encodeAPNG(
    frames: Array<{ data: Uint8ClampedArray; duration: number }>,
    width: number,
    height: number,
    loop?: boolean
  ): Buffer;
  animationGIF(
    project: RenderedProject,
    animation: string,
    options?: { scale?: number; background?: string }
  ): {
    data: Buffer;
    animation: string;
    width: number;
    height: number;
    frames: number;
    duration: number;
    loop: boolean;
    notes: string[];
  };
  createZip(files: Map<string, Uint8Array>): Buffer;
  godotTiming(durations: number[]): { speed: number; durations: number[]; exact: boolean };
  spriteFrames(atlas: SpriteFramesAtlas, options?: { image?: string }): {
    text: string;
    approximate: string[];
  };
  decodePNG(bytes: Buffer): { data: Uint8ClampedArray; width: number; height: number };
  scalePixels(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    scale: number
  ): Uint8ClampedArray;
}

// TypeScript emits CommonJS for the Electron main process, so a literal import() would be
// rewritten to require(), which cannot load Pixelbolt's ESM entry. Keep the call native.
const nativeImport = new Function("specifier", "return import(specifier)") as (
  specifier: string
) => Promise<PixelboltModule>;

let cached: Promise<PixelboltModule> | null = null;
const requireFromCwd = createRequire(path.join(process.cwd(), "package.json"));

function resolveEngineEntry(): string {
  const candidates: string[] = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require("electron") as {
      app?: { isPackaged?: boolean; getAppPath?: () => string };
    };
    const app = electron.app;
    if (app && typeof app.getAppPath === "function") {
      candidates.push(
        app.isPackaged
          ? path.join(process.resourcesPath, "pixel-engines", "pixelbolt", "src", "index.js")
          : path.join(app.getAppPath(), "external", "pixel-engines", "pixelbolt", "src", "index.js")
      );
    }
  } catch {
    // Running outside Electron (unit tests): fall through to the repository copy.
  }
  candidates.push(
    path.join(process.cwd(), "external", "pixel-engines", "pixelbolt", "src", "index.js")
  );
  for (const candidate of candidates) {
    try {
      if (candidate && require("node:fs").existsSync(candidate)) return candidate;
    } catch {
      // Keep looking.
    }
  }
  return candidates[candidates.length - 1]!;
}

export function loadPixelEngine(): Promise<PixelboltModule> {
  if (!cached) {
    const entry = resolveEngineEntry();
    // Electron 45 ships Node 24, where require() can load ESM. Fall back to a native
    // dynamic import for runtimes that still need it.
    cached = Promise.resolve()
      .then(() => requireFromCwd(entry) as PixelboltModule)
      .catch(() => nativeImport(pathToFileURL(entry).href))
      .catch((error: unknown) => {
        cached = null;
        throw new Error(
          `Pixelbolt engine could not be loaded from ${entry}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      });
  }
  return cached;
}

export async function renderRecipe(recipe: unknown): Promise<RenderedProject> {
  const engine = await loadPixelEngine();
  return engine.renderProject(recipe);
}

export async function writeRenderFiles(
  engine: PixelboltModule,
  render: RenderedProject,
  directory: string,
  slug: string
): Promise<{ framePaths: string[]; previewPath: string; sheetPath: string }> {
  await fs.mkdir(directory, { recursive: true });
  const framePaths: string[] = [];
  for (const [index, frame] of render.frames.entries()) {
    const filePath = path.join(directory, `frame_${String(index).padStart(3, "0")}.png`);
    await writePngDurable(engine, filePath, frame.data, render.width, render.height);
    framePaths.push(filePath);
  }
  const previewPath = path.join(directory, "preview.png");
  await writePngDurable(
    engine,
    previewPath,
    render.frames[0]!.data,
    render.width,
    render.height
  );
  const sheetPath = path.join(directory, `${slug}-sheet.png`);
  const atlas = engine.buildAtlas(render);
  await writePngDurable(engine, sheetPath, atlas.data, atlas.width, atlas.height);
  return { framePaths, previewPath, sheetPath };
}

async function writePngDurable(
  engine: PixelboltModule,
  filePath: string,
  data: Uint8ClampedArray,
  width: number,
  height: number
): Promise<void> {
  await fs.writeFile(filePath, engine.encodePNG(data, width, height), { flush: true });
  const decoded = engine.decodePNG(await fs.readFile(filePath));
  if (decoded.width !== width || decoded.height !== height) {
    throw new Error(
      `Wrote ${decoded.width}×${decoded.height} to ${path.basename(filePath)}; expected ${width}×${height}.`
    );
  }
}

export async function writePreviewFile(
  engine: PixelboltModule,
  render: RenderedProject,
  directory: string
): Promise<{ previewPath: string; sheetPath: string }> {
  await fs.mkdir(directory, { recursive: true });
  const previewPath = path.join(directory, "preview.png");
  await fs.writeFile(
    previewPath,
    engine.encodePNG(render.frames[0]!.data, render.width, render.height)
  );
  const atlas = engine.buildAtlas(render);
  const sheetPath = path.join(directory, "sheet.png");
  await fs.writeFile(sheetPath, engine.encodePNG(atlas.data, atlas.width, atlas.height));
  return { previewPath, sheetPath };
}

export async function dataUrlToPng(dataUrl: string): Promise<Buffer> {
  const match = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error("Frame data must be a base64 PNG data URL.");
  return Buffer.from(match[1]!, "base64");
}

export function pngToDataUrl(buffer: Buffer): string {
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

export async function readFileDataUrl(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  return pngToDataUrl(buffer);
}

export function buildPixelsFromImage(
  engine: PixelboltModule,
  buffer: Buffer,
  expectedWidth: number,
  expectedHeight: number
): Array<{ x: number; y: number; color: string }> {
  const decoded = engine.decodePNG(buffer);
  if (decoded.width !== expectedWidth || decoded.height !== expectedHeight) {
    throw new Error(
      `Frame is ${decoded.width}×${decoded.height}; expected ${expectedWidth}×${expectedHeight}.`
    );
  }
  const pixels: Array<{ x: number; y: number; color: string }> = [];
  for (let y = 0; y < decoded.height; y++) {
    for (let x = 0; x < decoded.width; x++) {
      const offset = (y * decoded.width + x) * 4;
      const alpha = decoded.data[offset + 3]!;
      if (alpha === 0) continue;
      const hex = `#${[0, 1, 2]
        .map((channel) => decoded.data[offset + channel]!.toString(16).padStart(2, "0"))
        .join("")}${alpha.toString(16).padStart(2, "0")}`;
      pixels.push({ x, y, color: hex });
    }
  }
  return pixels;
}
