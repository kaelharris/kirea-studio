import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { StudioRepository } from "../../db/repositories";
import type { StudioPaths } from "../../paths";
import type { PixelboltModule } from "../pixel-engine";
import {
  PIXEL_DIRECTIONS,
  type PixelPackageDirection,
  type PixelPackageFileKind,
  type PixelPackageIssue,
  type PixelPackagePreview,
  type PixelPackageProgress,
  type PixelPackageRequest,
  type PixelPackageSummary,
} from "../../../shared/pixel-package-types";
import type { PixelAssetRecord, PixelCharacter, PixelProject } from "../../../shared/pixel-types";
import { slugify, type PixelRecipe } from "../../../shared/pixel-recipe";
import {
  flattenOnto,
  packSheet,
  parseHexColor,
  scaleNearest,
  type PackCell,
  type PackedSheet,
  type RgbaImage,
} from "./sheet-packer";
import { sha256 } from "./hash";
import {
  godotFiles,
  phaserFiles,
  unityEditorScript,
  unityFiles,
  type PresetAnimation,
  type PresetGroup,
} from "./engine-presets";

export const PACKAGE_SCHEMA = "kirea.pixel-package";
export const PACKAGE_SCHEMA_VERSION = 1;
export const GENERATION_SIDECAR = "generation.json";

export interface PackageBuildContext {
  paths: StudioPaths;
  repo: StudioRepository;
  engine: PixelboltModule;
  appVersion: string;
}

export interface PackageBuildOptions {
  signal?: AbortSignal;
  onProgress?: (stage: PixelPackageProgress["stage"], done: number, total: number, message: string) => void;
}

export interface PackageFileMeta {
  kind: PixelPackageFileKind;
  width?: number;
  height?: number;
  frames?: number;
}

export interface ExpectedPixels {
  /** Whole-image files, keyed by path relative to the package root. */
  images: Map<string, RgbaImage>;
  /** Sheet regions, keyed by `${sheetPath}#${frameKey}`. */
  regions: Map<string, RgbaImage>;
}

export interface BuiltPackage {
  root: string;
  /** Paths are relative to the package root and use forward slashes. */
  files: Map<string, Buffer>;
  meta: Map<string, PackageFileMeta>;
  issues: PixelPackageIssue[];
  summary: PixelPackageSummary;
  preview: PixelPackagePreview | null;
  expected: ExpectedPixels;
  engines: Record<string, Record<string, unknown> | null>;
}

export class PackageCancelledError extends Error {
  constructor() {
    super("The export was cancelled.");
    this.name = "PackageCancelledError";
  }
}

const DIRECTION_CODES: Record<string, PixelPackageDirection> = {
  S: "south",
  SE: "south-east",
  E: "east",
  NE: "north-east",
  N: "north",
  NW: "north-west",
  W: "west",
  SW: "south-west",
};

const VIEW_DIRECTIONS: Record<string, PixelPackageDirection> = {
  front: "south",
  back: "north",
  right: "east",
  left: "west",
};

interface FrameData {
  id: string;
  idSource: "frame-record" | "version-position";
  index: number;
  name: string;
  durationMs: number;
  native: RgbaImage;
  image: RgbaImage;
}

interface ClipData {
  name: string;
  frames: number[];
  loop: boolean;
  missing: string[];
  synthesized: boolean;
}

interface UnitData {
  asset: PixelAssetRecord;
  key: string;
  slot: string;
  version: number;
  isCurrent: boolean;
  width: number;
  height: number;
  palette: string[];
  recipeText: string;
  frames: FrameData[];
  clips: ClipData[];
  direction: PixelPackageDirection | null;
  directionSource: "generation" | "view-name" | null;
  generation: Buffer | null;
  generationSummary: Record<string, unknown> | null;
  pivot: { x: number; y: number };
}

interface GroupData {
  kind: "character" | "asset";
  key: string;
  title: string;
  character: PixelCharacter | null;
  reference: UnitData | null;
  referenceMissing: boolean;
  units: UnitData[];
}

interface AnimationDef {
  key: string;
  clip: string;
  unit: UnitData;
  loop: boolean;
  frames: Array<{ frame: FrameData; sheetKey: string }>;
  missing: string[];
  synthesized: boolean;
}

interface BuildState {
  ctx: PackageBuildContext;
  request: PixelPackageRequest;
  options: PackageBuildOptions;
  issues: PixelPackageIssue[];
  files: Map<string, Buffer>;
  meta: Map<string, PackageFileMeta>;
  expected: ExpectedPixels;
  background: [number, number, number] | null;
}

export { sha256 };

export function resolveVersionFramesDirectory(
  pixelAssetsDir: string,
  assetId: string,
  version: number,
  previewPath: string
): string {
  const preferred = path.dirname(previewPath);
  if (fsSync.existsSync(path.join(preferred, "frame_000.png"))) return preferred;
  for (let candidate = version; candidate >= 1; candidate -= 1) {
    const directory = path.join(pixelAssetsDir, assetId, "versions", String(candidate));
    if (fsSync.existsSync(path.join(directory, "frame_000.png"))) return directory;
  }
  return preferred;
}

export function directionFromGeneration(generation: unknown): PixelPackageDirection | null {
  if (!generation || typeof generation !== "object") return null;
  const settings = (generation as { settings?: unknown }).settings;
  if (!settings || typeof settings !== "object") return null;
  const raw = (settings as { direction?: unknown }).direction;
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  const code = DIRECTION_CODES[value.toUpperCase()];
  if (code) return code;
  const lower = value.toLowerCase();
  return (PIXEL_DIRECTIONS as readonly string[]).includes(lower) ? (lower as PixelPackageDirection) : null;
}

export function directionFromViewName(name: string): PixelPackageDirection | null {
  const match = /(?:^|\s)(front|back|right|left)$/i.exec(name.trim());
  return match ? VIEW_DIRECTIONS[match[1]!.toLowerCase()]! : null;
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new PackageCancelledError();
}

function uniqueName(base: string, taken: Set<string>, suffix: () => string): string {
  if (!taken.has(base.toLowerCase())) {
    taken.add(base.toLowerCase());
    return base;
  }
  let candidate = `${base}-${suffix()}`;
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${base}-${suffix()}-${n}`;
  taken.add(candidate.toLowerCase());
  return candidate;
}

function numbered(base: string, taken: Set<string>): string {
  let candidate = base;
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${base}-${n}`;
  taken.add(candidate.toLowerCase());
  return candidate;
}

function json(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function pad3(value: number): string {
  return String(value).padStart(3, "0");
}

function fps(durations: number[]): number {
  const total = durations.reduce((sum, value) => sum + value, 0);
  return total > 0 ? Math.round(((durations.length * 1000) / total) * 1000) / 1000 : 0;
}

function transparencyOf(images: RgbaImage[]): { mode: "alpha" | "opaque"; partialAlpha: boolean } {
  let transparent = false;
  let partial = false;
  for (const image of images) {
    for (let i = 3; i < image.data.length; i += 4) {
      const alpha = image.data[i]!;
      if (alpha < 255) transparent = true;
      if (alpha > 0 && alpha < 255) partial = true;
    }
  }
  return { mode: transparent ? "alpha" : "opaque", partialAlpha: partial };
}

function pivotFor(preset: PixelPackageRequest["pivot"], width: number, height: number): { x: number; y: number } {
  if (preset === "top-left") return { x: 0, y: 0 };
  if (preset === "bottom-center") return { x: width / 2, y: height };
  return { x: width / 2, y: height / 2 };
}

class UnitLoader {
  constructor(private readonly state: BuildState) {}

  private issue(severity: "error" | "warning", code: string, message: string, extra: Partial<PixelPackageIssue> = {}): void {
    this.state.issues.push({ severity, code, message, ...extra });
  }

  async load(asset: PixelAssetRecord, requestedVersion: number | undefined): Promise<UnitData | null> {
    const { repo, engine, paths } = this.state.ctx;
    const version = requestedVersion ?? asset.version;
    const isCurrent = version === asset.version;
    let recipeText: string;
    let palette = asset.palette;
    let sources: Array<{ id: string; idSource: FrameData["idSource"]; name: string; durationMs: number; filePath: string }>;
    let framesDirectory: string;
    if (isCurrent) {
      recipeText = asset.recipeJson;
      const rows = repo.pixel.getFrames(asset.id);
      sources = rows.map((row) => ({
        id: row.id,
        idSource: "frame-record" as const,
        name: row.name,
        durationMs: row.durationMs,
        filePath: row.filePath,
      }));
      framesDirectory = rows[0] ? path.dirname(rows[0].filePath) : path.dirname(asset.previewPath);
    } else {
      const row = repo.pixel.getVersion(asset.id, version);
      if (!row) {
        this.issue("error", "version-not-found", `${asset.name} has no version ${version}.`, { assetId: asset.id });
        return null;
      }
      recipeText = row.recipeJson;
      if (row.palette.length) palette = row.palette;
      framesDirectory = resolveVersionFramesDirectory(paths.pixelAssetsDir, asset.id, version, row.previewPath);
      let parsed: PixelRecipe;
      try {
        parsed = JSON.parse(recipeText) as PixelRecipe;
      } catch {
        this.issue("error", "recipe-unreadable", `Version ${version} of ${asset.name} has an unreadable recipe.`, {
          assetId: asset.id,
        });
        return null;
      }
      sources = (parsed.frames ?? []).map((frame, index) => ({
        id: `${asset.id}:${version}:${index}`,
        idSource: "version-position" as const,
        name: frame.name,
        durationMs: frame.duration,
        filePath: path.join(framesDirectory, `frame_${pad3(index)}.png`),
      }));
    }
    let recipe: PixelRecipe;
    try {
      recipe = JSON.parse(recipeText) as PixelRecipe;
    } catch {
      this.issue("error", "recipe-unreadable", `${asset.name} has an unreadable recipe.`, { assetId: asset.id });
      return null;
    }
    const width = recipe.width || asset.width;
    const height = recipe.height || asset.height;
    if (!sources.length) {
      this.issue("error", "asset-no-frames", `${asset.name} has no frames.`, { assetId: asset.id });
      return null;
    }
    if (isCurrent && recipe.frames && recipe.frames.length !== sources.length) {
      this.issue(
        "warning",
        "frame-count-mismatch",
        `${asset.name} lists ${recipe.frames.length} frames in its recipe and ${sources.length} saved frames; the saved frames are exported.`,
        { assetId: asset.id }
      );
    }
    const frames: FrameData[] = [];
    let failed = false;
    for (const [index, source] of sources.entries()) {
      throwIfCancelled(this.state.options.signal);
      let bytes: Buffer;
      try {
        bytes = await fs.readFile(source.filePath);
      } catch {
        this.issue("error", "frame-file-missing", `${asset.name} v${version} is missing frame ${index + 1} (${source.name}).`, {
          assetId: asset.id,
        });
        failed = true;
        continue;
      }
      let decoded: RgbaImage;
      try {
        decoded = engine.decodePNG(bytes);
      } catch {
        this.issue("error", "frame-unreadable", `Frame ${index + 1} of ${asset.name} is not a readable PNG.`, {
          assetId: asset.id,
        });
        failed = true;
        continue;
      }
      if (decoded.width !== width || decoded.height !== height) {
        this.issue(
          "error",
          "frame-size-mismatch",
          `Frame ${index + 1} of ${asset.name} is ${decoded.width}×${decoded.height}; the asset is ${width}×${height}.`,
          { assetId: asset.id }
        );
        failed = true;
        continue;
      }
      const native: RgbaImage = { data: new Uint8ClampedArray(decoded.data), width, height };
      let image = scaleNearest(native, this.state.request.scale);
      if (this.state.background) image = flattenOnto(image, this.state.background);
      frames.push({
        id: source.id,
        idSource: source.idSource,
        index,
        name: source.name,
        durationMs: Math.max(1, Math.round(source.durationMs)),
        native,
        image,
      });
    }
    if (failed) return null;

    const byName = new Map<string, number>();
    for (const frame of frames) if (!byName.has(frame.name)) byName.set(frame.name, frame.index);
    const clips: ClipData[] = [];
    for (const [name, animation] of Object.entries(recipe.animations ?? {})) {
      const indices: number[] = [];
      const missing: string[] = [];
      for (const frameName of animation.frames ?? []) {
        const index = byName.get(frameName);
        if (index === undefined) missing.push(frameName);
        else indices.push(index);
      }
      if (!indices.length) {
        this.issue("warning", "animation-empty", `${asset.name}: animation "${name}" has none of its frames, so it is left out.`, {
          assetId: asset.id,
          animation: name,
        });
        continue;
      }
      if (missing.length) {
        this.issue(
          "warning",
          "animation-missing-frames",
          `${asset.name}: animation "${name}" refers to ${missing.length} missing frame${missing.length === 1 ? "" : "s"} (${missing.join(", ")}); the ${indices.length} present frames are exported in order.`,
          { assetId: asset.id, animation: name }
        );
      }
      clips.push({ name, frames: indices, loop: animation.loop !== false, missing, synthesized: false });
    }
    if (!clips.length) {
      clips.push({ name: "idle", frames: frames.map((frame) => frame.index), loop: true, missing: [], synthesized: true });
    }

    const generation = await this.readGeneration(asset.id, version, framesDirectory);
    let generationSummary: Record<string, unknown> | null = null;
    let direction: PixelPackageDirection | null = null;
    let directionSource: UnitData["directionSource"] = null;
    if (generation) {
      try {
        const parsed = JSON.parse(generation.toString("utf8")) as Record<string, unknown>;
        generationSummary = parsed;
        direction = directionFromGeneration(parsed);
        if (direction) directionSource = "generation";
      } catch {
        generationSummary = null;
      }
    }
    if (!direction) {
      direction = directionFromViewName(asset.name);
      if (direction) directionSource = "view-name";
    }
    const scale = this.state.request.scale;
    return {
      asset,
      key: "",
      slot: "",
      version,
      isCurrent,
      width,
      height,
      palette,
      recipeText,
      frames,
      clips,
      direction,
      directionSource,
      generation,
      generationSummary,
      pivot: pivotFor(this.state.request.pivot, width * scale, height * scale),
    };
  }

  private async readGeneration(assetId: string, version: number, framesDirectory: string): Promise<Buffer | null> {
    const assetDirectory = path.join(this.state.ctx.paths.pixelAssetsDir, assetId);
    const candidates = [
      path.join(assetDirectory, "versions", String(version), GENERATION_SIDECAR),
      path.join(framesDirectory, GENERATION_SIDECAR),
      path.join(assetDirectory, GENERATION_SIDECAR),
    ];
    for (const file of candidates) {
      try {
        const bytes = await fs.readFile(file);
        const parsed = JSON.parse(bytes.toString("utf8")) as unknown;
        if (parsed && typeof parsed === "object") return bytes;
      } catch {
        // Try the next location.
      }
    }
    return null;
  }
}

function sortUnits(units: UnitData[]): UnitData[] {
  const rank = (unit: UnitData): number =>
    unit.direction ? PIXEL_DIRECTIONS.indexOf(unit.direction) : PIXEL_DIRECTIONS.length;
  return [...units].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.asset.name.localeCompare(b.asset.name) ||
      a.asset.id.localeCompare(b.asset.id)
  );
}

function assignKeys(group: GroupData, issues: PixelPackageIssue[]): void {
  const keys = new Set<string>();
  const slots = new Set<string>();
  const seenDirections = new Map<string, UnitData>();
  for (const unit of group.units) {
    unit.key = uniqueName(slugify(unit.asset.name), keys, () => unit.asset.id.slice(0, 8));
  }
  for (const unit of group.units) {
    if (unit.direction && !seenDirections.has(unit.direction)) seenDirections.set(unit.direction, unit);
  }
  for (const unit of group.units) {
    const direction = unit.direction;
    if (direction && seenDirections.get(direction) === unit && !slots.has(direction)) {
      unit.slot = direction;
      slots.add(direction);
      continue;
    }
    if (direction) {
      const other = seenDirections.get(direction);
      if (other !== unit) {
        issues.push({
          severity: "warning",
          code: "duplicate-direction",
          message: `${unit.asset.name} and ${other!.asset.name} both face ${direction}; ${unit.asset.name} is exported under its own name.`,
          assetId: unit.asset.id,
        });
      }
    }
    unit.slot = numbered(unit.key, slots);
  }
}

function sheetKeyOf(group: GroupData, unit: UnitData, frame: FrameData): string {
  return group.units.length === 1 ? frame.name : `${unit.slot}/${frame.name}`;
}

function buildAnimations(group: GroupData, issues: PixelPackageIssue[], filter?: string): AnimationDef[] {
  const taken = new Set<string>();
  const defs: AnimationDef[] = [];
  const multi = group.units.length > 1;
  for (const unit of group.units) {
    for (const clip of unit.clips) {
      if (filter !== undefined && clip.name !== filter) continue;
      let key = clip.name;
      if (multi && unit.direction && unit.slot === unit.direction) key = `${clip.name}_${unit.direction}`;
      if (taken.has(key)) {
        const renamed = numbered(`${key}_${unit.key}`, taken);
        issues.push({
          severity: "warning",
          code: "animation-key-renamed",
          message: `Two assets have an animation called "${key}"; the one in ${unit.asset.name} is named "${renamed}".`,
          assetId: unit.asset.id,
          animation: clip.name,
        });
        key = renamed;
      } else {
        taken.add(key);
      }
      defs.push({
        key,
        clip: clip.name,
        unit,
        loop: clip.loop,
        frames: clip.frames.map((index) => {
          const frame = unit.frames[index]!;
          return { frame, sheetKey: sheetKeyOf(group, unit, frame) };
        }),
        missing: clip.missing,
        synthesized: clip.synthesized,
      });
    }
  }
  return defs;
}

interface SheetOutput {
  path: string;
  jsonPath: string;
  kind: "combined" | "animation" | "direction";
  packed: PackedSheet;
  frames: Map<string, { unit: UnitData; frame: FrameData }>;
  animations: AnimationDef[];
}

class GroupBuilder {
  private readonly prefix: string;
  private readonly local = new Map<string, Buffer>();
  readonly sheets: SheetOutput[] = [];
  readonly animations: AnimationDef[];
  readonly animationFiles = new Map<string, string[]>();
  readonly previews = new Map<string, { gif?: string; apng?: string }>();
  readonly stills = new Map<string, string>();
  readonly unframed = new Map<string, string[]>();
  identityPath: string | null = null;

  constructor(
    private readonly state: BuildState,
    readonly group: GroupData,
    readonly folder: string,
    private readonly packageId: string,
    private readonly projectScope: boolean,
    filter?: string
  ) {
    this.prefix = folder ? `${folder}/` : "";
    this.animations = buildAnimations(group, state.issues, filter);
  }

  private add(relative: string, data: Buffer, meta: PackageFileMeta, expected?: RgbaImage): void {
    const full = `${this.prefix}${relative}`;
    if (this.state.files.has(full)) throw new Error(`The package would contain ${full} twice.`);
    this.state.files.set(full, data);
    this.state.meta.set(full, meta);
    this.local.set(relative, data);
    if (expected) this.state.expected.images.set(full, expected);
  }

  private png(image: RgbaImage): Buffer {
    return Buffer.from(this.state.ctx.engine.encodePNG(image.data, image.width, image.height));
  }

  addExtra(relative: string, data: Buffer, kind: PixelPackageFileKind): void {
    this.add(relative, data, { kind });
  }

  private usedUnits(): UnitData[] {
    if (this.state.request.scope !== "animation") return this.group.units;
    const used = new Set(this.animations.map((def) => def.unit));
    return this.group.units.filter((unit) => used.has(unit));
  }

  build(): void {
    const { request } = this.state;
    const outputs = request.outputs;
    const engine = request.preset !== "generic";
    const character = this.group.kind === "character";
    const units = this.usedUnits();
    const clipFolders = new Map<string, string>();
    const clipFolderNames = new Set<string>();
    const folderFor = (clip: string): string => {
      let folder = clipFolders.get(clip);
      if (!folder) {
        folder = numbered(slugify(clip), clipFolderNames);
        clipFolders.set(clip, folder);
      }
      return folder;
    };

    if (this.group.reference && outputs.stills) {
      const reference = this.group.reference;
      const still = stillOf(reference);
      this.identityPath = `identity/${reference.key || slugify(reference.asset.name)}.png`;
      this.add(this.identityPath, this.png(still.image), { kind: "still", width: still.image.width, height: still.image.height }, still.image);
    }

    if (outputs.stills) {
      for (const unit of units) {
        const still = stillOf(unit);
        const relative = unit.direction && unit.slot === unit.direction
          ? `directions/${unit.direction}/${unit.key}.png`
          : `stills/${unit.key}.png`;
        this.add(relative, this.png(still.image), { kind: "still", width: still.image.width, height: still.image.height }, still.image);
        this.stills.set(unit.asset.id, relative);
      }
    }

    if (outputs.frames) {
      const written = new Map<FrameData, string>();
      for (const def of this.animations) {
        const base = character || this.group.units.length > 1
          ? `animations/${folderFor(def.clip)}/${def.unit.slot}`
          : `animations/${folderFor(def.clip)}`;
        const files: string[] = [];
        def.frames.forEach(({ frame }, position) => {
          const existing = written.get(frame);
          if (existing) {
            files.push(existing);
            return;
          }
          const relative = `${base}/${pad3(position)}_${slugify(frame.name)}.png`;
          this.add(relative, this.png(frame.image), { kind: "frame", width: frame.image.width, height: frame.image.height }, frame.image);
          files.push(relative);
          written.set(frame, relative);
        });
        this.animationFiles.set(def.key, files);
      }
      if (request.scope !== "animation") {
        for (const unit of units) {
          const loose = unit.frames.filter((frame) => !written.has(frame));
          if (!loose.length) continue;
          const base = this.group.units.length > 1 ? `frames/${unit.slot}` : "frames";
          const files: string[] = [];
          for (const frame of loose) {
            const relative = `${base}/${pad3(frame.index)}_${slugify(frame.name)}.png`;
            this.add(relative, this.png(frame.image), { kind: "frame", width: frame.image.width, height: frame.image.height }, frame.image);
            files.push(relative);
          }
          this.unframed.set(unit.asset.id, files);
        }
      }
    }

    if (outputs.combinedSheet || engine) {
      this.combinedSheet(units);
    }
    if (outputs.animationSheets) {
      const clips = [...new Set(this.animations.map((def) => def.clip))];
      for (const clip of clips) {
        const defs = this.animations.filter((def) => def.clip === clip);
        const rows = defs.map((def) => dedupeFrames(def.frames).map(({ frame }) => ({ unit: def.unit, frame })));
        this.packInto(`spritesheets/animations/${folderFor(clip)}`, "animation", rows, defs);
      }
    }
    if (outputs.directionSheets) {
      for (const unit of units) {
        if (!unit.direction) continue;
        const defs = this.animations.filter((def) => def.unit === unit);
        const indices = this.state.request.scope === "animation"
          ? [...new Set(defs.flatMap((def) => def.frames.map(({ frame }) => frame.index)))].sort((a, b) => a - b)
          : unit.frames.map((frame) => frame.index);
        const rows = [indices.map((index) => ({ unit, frame: unit.frames[index]! }))];
        this.packInto(`spritesheets/directions/${unit.slot}`, "direction", rows, defs);
      }
    }

    if (outputs.gif || outputs.apng) {
      const previewNames = new Set<string>();
      for (const def of this.animations) {
        const name = numbered(slugify(def.key), previewNames);
        const frames = def.frames.map(({ frame }) => ({ data: frame.image.data, duration: frame.durationMs }));
        const { width, height } = def.frames[0]!.frame.image;
        const entry: { gif?: string; apng?: string } = {};
        if (outputs.gif) {
          try {
            const gif = this.state.ctx.engine.encodeGIF(frames, width, height, { loop: def.loop, scale: 1, background: null });
            const relative = `previews/${name}.gif`;
            this.add(relative, Buffer.from(gif.data), { kind: "gif", width, height, frames: frames.length });
            entry.gif = relative;
            const changed = gif.delays.some((delay, index) => delay !== frames[index]!.duration);
            if (changed) {
              this.state.issues.push({
                severity: "warning",
                code: "gif-timing",
                message: `GIF stores delays in hundredths of a second, so the "${def.key}" preview plays ${gif.delays.join("/")} ms instead of ${frames.map((frame) => frame.duration).join("/")} ms. The sheets and engine files keep the exact times.`,
                assetId: def.unit.asset.id,
                animation: def.clip,
              });
            }
            if (gif.partialAlpha > 0) {
              this.state.issues.push({
                severity: "warning",
                code: "gif-alpha",
                message: `The "${def.key}" GIF preview rounds ${gif.partialAlpha} partly transparent pixels to fully clear or fully opaque; PNG outputs keep them.`,
                assetId: def.unit.asset.id,
                animation: def.clip,
              });
            }
          } catch (error) {
            this.state.issues.push({
              severity: "warning",
              code: "gif-failed",
              message: `No GIF preview for "${def.key}": ${error instanceof Error ? error.message : String(error)}`,
              assetId: def.unit.asset.id,
              animation: def.clip,
            });
          }
        }
        if (outputs.apng) {
          const relative = `previews/${name}.apng`;
          this.add(
            relative,
            Buffer.from(this.state.ctx.engine.encodeAPNG(frames, width, height, def.loop)),
            { kind: "apng", width, height, frames: frames.length }
          );
          entry.apng = relative;
        }
        this.previews.set(def.key, entry);
      }
    }

    if (outputs.frames || outputs.stills || engine || outputs.combinedSheet) {
      for (const unit of units) {
        if (unit.generation) {
          this.add(`metadata/generation/${unit.key}.json`, unit.generation, { kind: "provenance" });
        }
        this.add(`metadata/recipes/${unit.key}.v${unit.version}.json`, Buffer.from(unit.recipeText), { kind: "provenance" });
      }
    }

    if (engine) this.engineFiles();
  }

  private combinedSheet(units: UnitData[]): void {
    const rows = units.map((unit) => {
      if (this.state.request.scope !== "animation") return unit.frames.map((frame) => ({ unit, frame }));
      const indices = [
        ...new Set(
          this.animations.filter((def) => def.unit === unit).flatMap((def) => def.frames.map(({ frame }) => frame.index))
        ),
      ].sort((a, b) => a - b);
      return indices.map((index) => ({ unit, frame: unit.frames[index]! }));
    });
    this.packInto(`spritesheets/${this.group.key}`, "combined", rows, this.animations);
  }

  private packInto(
    base: string,
    kind: SheetOutput["kind"],
    rows: Array<Array<{ unit: UnitData; frame: FrameData }>>,
    animations: AnimationDef[]
  ): void {
    const layout = this.state.request.layout;
    const frames = new Map<string, { unit: UnitData; frame: FrameData }>();
    const cellOf = (entry: { unit: UnitData; frame: FrameData }): PackCell => {
      const key = sheetKeyOf(this.group, entry.unit, entry.frame);
      frames.set(key, entry);
      return { key, image: entry.frame.image };
    };
    const flat = rows.flat().map(cellOf);
    let packed: PackedSheet | null = null;
    const rowLength = Math.max(...rows.map((row) => row.length));
    const autoGrid = layout.columns <= 0 && layout.rows <= 0;
    if (autoGrid && rows.length > 1) {
      const padded: Array<PackCell | null> = [];
      for (const row of rows) {
        const cells = row.map(cellOf);
        padded.push(...cells, ...Array.from({ length: rowLength - cells.length }, () => null));
      }
      try {
        packed = packSheet(padded, { ...layout, columns: rowLength });
      } catch {
        packed = null;
      }
    }
    if (!packed) {
      try {
        packed = packSheet(flat, layout, { rowLength: autoGrid && rows.length === 1 ? undefined : rowLength });
      } catch (error) {
        this.state.issues.push({
          severity: "error",
          code: "sheet-failed",
          message: `${base}.png: ${error instanceof Error ? error.message : String(error)}`,
        });
        return;
      }
    }
    const pngPath = `${base}.png`;
    const jsonPath = `${base}.json`;
    const image: RgbaImage = { data: packed.data, width: packed.width, height: packed.height };
    this.add(pngPath, this.png(image), { kind: "sheet", width: packed.width, height: packed.height, frames: packed.order.length });
    for (const key of packed.order) {
      this.state.expected.regions.set(`${this.prefix}${pngPath}#${key}`, frames.get(key)!.frame.image);
    }
    const sheet: SheetOutput = { path: pngPath, jsonPath, kind, packed, frames, animations };
    this.add(jsonPath, json(this.sheetJson(sheet)), { kind: "atlas", frames: packed.order.length });
    this.sheets.push(sheet);
  }

  pivotOf(key: string, sheet: SheetOutput): { x: number; y: number } {
    const entry = sheet.frames.get(key)!;
    const region = sheet.packed.regions.get(key)!;
    return { x: entry.unit.pivot.x + region.canvasOffset.x, y: entry.unit.pivot.y + region.canvasOffset.y };
  }

  private sheetJson(sheet: SheetOutput): unknown {
    const frames: Record<string, unknown> = {};
    for (const key of sheet.packed.order) {
      const region = sheet.packed.regions.get(key)!;
      const { unit, frame } = sheet.frames.get(key)!;
      const pivot = this.pivotOf(key, sheet);
      frames[key] = {
        frame: region.frame,
        rotated: false,
        trimmed: region.trimmed,
        spriteSourceSize: region.spriteSourceSize,
        sourceSize: region.sourceSize,
        duration: frame.durationMs,
        pivot: { x: round6(pivot.x / region.sourceSize.w), y: round6(pivot.y / region.sourceSize.h) },
        kirea: {
          frameId: frame.id,
          assetId: unit.asset.id,
          version: unit.version,
          index: frame.index,
          name: frame.name,
          slot: unit.slot,
          direction: unit.direction,
          pivotPx: pivot,
        },
      };
    }
    const keys = new Set(sheet.packed.order);
    const animations: Record<string, unknown> = {};
    for (const def of sheet.animations) {
      const inSheet = def.frames.filter(({ sheetKey }) => keys.has(sheetKey));
      if (!inSheet.length) continue;
      animations[def.key] = {
        frames: inSheet.map(({ sheetKey }) => sheetKey),
        durations: inSheet.map(({ frame }) => frame.durationMs),
        loop: def.loop,
        fps: fps(inSheet.map(({ frame }) => frame.durationMs)),
        direction: def.unit.direction,
      };
    }
    return {
      frames,
      animations,
      meta: {
        app: "KIREA Studio",
        version: this.state.ctx.appVersion,
        image: path.posix.basename(sheet.path),
        format: "RGBA8888",
        size: { w: sheet.packed.width, h: sheet.packed.height },
        scale: String(this.state.request.scale),
        layout: {
          columns: sheet.packed.columns,
          rows: sheet.packed.rows,
          cell: sheet.packed.cell,
          padding: this.state.request.layout.padding,
          spacing: this.state.request.layout.spacing,
          extrude: this.state.request.layout.extrude,
          trim: this.state.request.layout.trim,
          uniformFrames: this.state.request.layout.uniformFrames,
        },
      },
    };
  }

  combined(): SheetOutput | null {
    return this.sheets.find((sheet) => sheet.kind === "combined") ?? null;
  }

  private presetGroup(): PresetGroup | null {
    const sheet = this.combined();
    if (!sheet) return null;
    const animations: PresetAnimation[] = this.animations.map((def) => ({
      key: def.key,
      loop: def.loop,
      frames: def.frames.map(({ frame, sheetKey }) => ({ sheetKey, durationMs: frame.durationMs })),
    }));
    const pivots = new Map<string, { x: number; y: number }>();
    for (const key of sheet.packed.order) pivots.set(key, this.pivotOf(key, sheet));
    return {
      key: this.group.key,
      title: this.group.title,
      sheetPath: sheet.path,
      sheet: sheet.packed,
      animations,
      pivots,
      pixelsPerUnit: this.state.request.pixelsPerUnit,
      scale: this.state.request.scale,
      packageId: this.packageId,
      animationPrefix: this.projectScope ? `${this.group.key}_` : "",
    };
  }

  readonly engineInfo: Record<string, unknown> = {};

  private engineFiles(): void {
    const preset = this.presetGroup();
    if (!preset) return;
    const { request, ctx } = this.state;
    const result =
      request.preset === "godot"
        ? godotFiles(ctx.engine, preset)
        : request.preset === "unity"
          ? unityFiles(preset)
          : phaserFiles(preset);
    for (const file of result.files) this.add(file.path, file.data, { kind: file.kind });
    for (const issue of result.issues) this.state.issues.push(issue);
    this.engineInfo[request.preset] = result.info;
  }

  manifest(fileName: string, project: PixelProject | null): Buffer {
    const { request, ctx } = this.state;
    const units = this.usedUnits();
    const images = units.flatMap((unit) => unit.frames.map((frame) => frame.image));
    const sheetEntry = (sheet: SheetOutput) => ({
      path: sheet.path,
      json: sheet.jsonPath,
      kind: sheet.kind,
      width: sheet.packed.width,
      height: sheet.packed.height,
      columns: sheet.packed.columns,
      rows: sheet.packed.rows,
      cell: sheet.packed.cell,
      frames: sheet.packed.order.length,
    });
    const combined = this.combined();
    const files = [...this.local.entries()]
      .filter(([relative]) => relative !== fileName)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([relative, data]) => ({ path: relative, bytes: data.length, sha256: sha256(data) }));
    const character = this.group.character;
    const manifest = {
      schema: PACKAGE_SCHEMA,
      schemaVersion: PACKAGE_SCHEMA_VERSION,
      generator: { app: "KIREA Studio", version: ctx.appVersion, engine: "pixelbolt" },
      scope: request.scope,
      preset: request.preset,
      project: project ? { id: project.id, name: project.name, description: project.description } : null,
      character: character
        ? {
            id: character.id,
            name: character.name,
            description: character.description,
            seed: character.seed,
            paletteId: character.paletteId,
            referenceAssetId: character.referenceAssetId,
            reference: this.group.reference
              ? { assetId: this.group.reference.asset.id, version: this.group.reference.version, file: this.identityPath }
              : null,
            createdAt: character.createdAt,
          }
        : null,
      export: {
        scale: request.scale,
        pivot: request.pivot,
        pixelsPerUnit: request.pixelsPerUnit,
        background: request.preset === "generic" ? request.background : null,
        layout: request.layout,
        filtering: "nearest-neighbour",
        transparency: transparencyOf(images),
        animationFilter: request.scope === "animation" ? request.animation ?? null : null,
      },
      assets: units.map((unit) => ({
        id: unit.asset.id,
        key: unit.key,
        slot: unit.slot,
        name: unit.asset.name,
        kind: unit.asset.kind,
        engine: unit.asset.engine,
        version: unit.version,
        latestVersion: unit.asset.version,
        isLatest: unit.isCurrent,
        parentAssetId: unit.asset.parentAssetId,
        characterId: unit.asset.characterId,
        direction: unit.direction,
        directionSource: unit.directionSource,
        canvas: { w: unit.width, h: unit.height },
        exported: { w: unit.width * request.scale, h: unit.height * request.scale },
        pivot: unit.pivot,
        paletteId: unit.asset.paletteId,
        palette: unit.palette,
        transparency: transparencyOf(unit.frames.map((frame) => frame.native)),
        still: this.stills.get(unit.asset.id) ?? null,
        recipe: this.local.has(`metadata/recipes/${unit.key}.v${unit.version}.json`)
          ? `metadata/recipes/${unit.key}.v${unit.version}.json`
          : null,
        generation: unit.generation ? `metadata/generation/${unit.key}.json` : null,
        provenance: {
          prompt: unit.asset.prompt,
          seed: unit.asset.seed,
          generator: unit.asset.engine,
          backend: stringField(unit.generationSummary, "backend"),
          workflowId: stringField(unit.generationSummary, "workflowId"),
          model: stringField(unit.generationSummary, "model"),
          createdAt: unit.asset.createdAt,
          updatedAt: unit.asset.updatedAt,
        },
        frames: (request.scope === "animation"
          ? unit.frames.filter((frame) =>
              this.animations.some((def) => def.unit === unit && def.frames.some((entry) => entry.frame === frame))
            )
          : unit.frames
        ).map((frame) => ({
          id: frame.id,
          idSource: frame.idSource,
          index: frame.index,
          name: frame.name,
          durationMs: frame.durationMs,
          sheetKey: sheetKeyOf(this.group, unit, frame),
        })),
        looseFrames: this.unframed.get(unit.asset.id) ?? [],
      })),
      animations: this.animations.map((def) => {
        const durations = def.frames.map(({ frame }) => frame.durationMs);
        return {
          key: def.key,
          name: def.clip,
          assetId: def.unit.asset.id,
          slot: def.unit.slot,
          direction: def.unit.direction,
          loop: def.loop,
          fps: fps(durations),
          uniformTiming: durations.every((value) => value === durations[0]),
          frameCount: def.frames.length,
          totalDurationMs: durations.reduce((sum, value) => sum + value, 0),
          frames: def.frames.map(({ frame, sheetKey }) => ({ frameId: frame.id, sheetKey, durationMs: frame.durationMs })),
          files: this.animationFiles.get(def.key) ?? [],
          preview: this.previews.get(def.key) ?? null,
          missingFrames: def.missing,
          synthesized: def.synthesized,
        };
      }),
      directions: PIXEL_DIRECTIONS.filter((direction) => units.some((unit) => unit.slot === direction)).map((direction) => {
        const unit = units.find((candidate) => candidate.slot === direction)!;
        return {
          direction,
          assetId: unit.asset.id,
          still: this.stills.get(unit.asset.id) ?? null,
          animations: this.animations.filter((def) => def.unit === unit).map((def) => def.key),
          sheet: this.sheets.find((sheet) => sheet.kind === "direction" && sheet.path === `spritesheets/directions/${direction}.png`)?.path ?? null,
        };
      }),
      sheets: this.sheets.map(sheetEntry),
      engines: {
        godot: request.preset === "godot" ? this.engineInfo.godot : null,
        unity: request.preset === "unity" ? this.engineInfo.unity : null,
        phaser: request.preset === "phaser" ? this.engineInfo.phaser : null,
        combinedSheet: combined ? combined.path : null,
      },
      issues: this.state.issues
        .filter((issue) => issue.severity === "warning")
        .filter((issue) => !issue.assetId || units.some((unit) => unit.asset.id === issue.assetId))
        .map((issue) => ({ code: issue.code, message: issue.message })),
      files,
    };
    return json(manifest);
  }

  finish(fileName: string, project: PixelProject | null, readme: string): void {
    this.add("README.txt", Buffer.from(readme), { kind: "readme" });
    const manifest = this.manifest(fileName, project);
    this.add(fileName, manifest, { kind: "manifest" });
  }
}

function stillOf(unit: UnitData): FrameData {
  const idle = unit.clips.find((clip) => clip.name.toLowerCase() === "idle");
  return unit.frames[idle?.frames[0] ?? 0] ?? unit.frames[0]!;
}

function dedupeFrames<T extends { sheetKey: string }>(frames: T[]): T[] {
  const seen = new Set<string>();
  return frames.filter((frame) => {
    if (seen.has(frame.sheetKey)) return false;
    seen.add(frame.sheetKey);
    return true;
  });
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function stringField(record: Record<string, unknown> | null, field: string): string | null {
  const value = record?.[field];
  return typeof value === "string" ? value : null;
}

function readmeFor(builder: GroupBuilder, request: PixelPackageRequest, manifestName: string): string {
  const lines = [
    `${builder.group.title} — KIREA Studio pixel package`,
    "",
    `Manifest: ${manifestName} (schema ${PACKAGE_SCHEMA} v${PACKAGE_SCHEMA_VERSION}). It lists every file with its size and SHA-256,`,
    "every frame with its stable id, and every animation with its frame order, durations, FPS and loop flag.",
    "",
    "Folders",
    "  identity/        the character's reference image, when it has one",
    "  directions/      one still per facing direction (south, east, north, west…)",
    "  stills/          stills of assets that have no facing direction",
    "  animations/      every animation frame as its own PNG, numbered in play order",
    "  frames/          frames that no animation uses",
    "  spritesheets/    packed sheets with TexturePacker-style JSON (frame rects, trim, pivot, duration)",
    "  previews/        animated GIF / APNG previews (GIF rounds timing to 10 ms; sheets keep exact times)",
    "  metadata/        the original recipe of each exported version and any generation record, unchanged",
    "",
    `Pixels are exported at ${request.scale}× with nearest-neighbour scaling only. Pivot: ${request.pivot}.`,
    "",
  ];
  const combined = builder.combined();
  if (request.preset === "godot" && combined) {
    lines.push(
      "Godot 4",
      `  ${combined.path.replace(/\.png$/, ".tres")} is a SpriteFrames resource; ${builder.group.key}.tscn holds an AnimatedSprite2D`,
      "  that uses it with nearest filtering and the export pivot as its offset. Copy the whole folder into your",
      "  project. These files were checked structurally by KIREA (regions, timing, paths); they have not been",
      "  opened in the Godot editor by KIREA.",
      ""
    );
  }
  if (request.preset === "unity" && combined) {
    lines.push(
      "Unity",
      "  Copy the whole folder (including Editor/) into Assets/. The .png.meta slices the sheet into named sprites",
      "  with point filtering, no compression and the export pivot. The editor script builds one AnimationClip per",
      `  animation into ${combined.path.replace(/\.png$/, "_clips")}/ from the .unity-animations.json. No Animator Controller is created.`,
      ""
    );
  }
  if (request.preset === "phaser" && combined) {
    const base = combined.path.replace(/\.png$/, "");
    lines.push(
      "Phaser 3",
      `  this.load.atlas("${builder.group.key}", "${base}.png", "${base}.json");`,
      `  this.load.json("${builder.group.key}-anims", "${base}.anims.json");`,
      `  // in create(): this.anims.fromJSON(this.cache.json.get("${builder.group.key}-anims"));`,
      "  Per-frame durations are exact (Phaser 3.60+ uses a frame's duration in place of the frame rate).",
      ""
    );
  }
  return `${lines.join("\n")}\n`;
}

export async function buildPackage(
  ctx: PackageBuildContext,
  request: PixelPackageRequest,
  options: PackageBuildOptions = {}
): Promise<BuiltPackage> {
  const issues: PixelPackageIssue[] = [];
  let background: [number, number, number] | null = null;
  if (request.background) {
    if (request.preset !== "generic") {
      issues.push({
        severity: "warning",
        code: "background-ignored",
        message: `${request.preset} packages keep transparency; the background colour applies to generic exports only.`,
      });
    } else {
      background = parseHexColor(request.background);
      if (request.layout.trim) {
        issues.push({
          severity: "warning",
          code: "background-trim",
          message: "Frames on a solid background have no transparent border, so trimming changes nothing.",
        });
      }
    }
  }
  const state: BuildState = {
    ctx,
    request,
    options,
    issues,
    files: new Map(),
    meta: new Map(),
    expected: { images: new Map(), regions: new Map() },
    background,
  };
  const loader = new UnitLoader(state);
  const report = (stage: PixelPackageProgress["stage"], done: number, total: number, message: string) =>
    options.onProgress?.(stage, done, total, message);
  const { repo } = ctx;

  const groups: GroupData[] = [];
  let project: PixelProject | null = null;
  let rootBase = "package";
  let animationFilter: string | undefined;

  const loadCharacterGroup = async (character: PixelCharacter): Promise<GroupData | null> => {
    const assets = repo.pixel.listAssets({ characterId: character.id });
    if (!assets.length) {
      issues.push({ severity: "error", code: "character-empty", message: `${character.name} has no sprites to export yet.` });
      return null;
    }
    const units: UnitData[] = [];
    for (const [index, asset] of assets.entries()) {
      report("collect", index, assets.length, `Reading ${asset.name}`);
      const unit = await loader.load(asset, undefined);
      if (unit) units.push(unit);
    }
    const group: GroupData = {
      kind: "character",
      key: slugify(character.name),
      title: character.name,
      character,
      reference: null,
      referenceMissing: false,
      units: sortUnits(units),
    };
    assignKeys(group, issues);
    if (character.referenceAssetId) {
      const inGroup = group.units.find((unit) => unit.asset.id === character.referenceAssetId);
      if (inGroup) group.reference = inGroup;
      else {
        const reference = repo.pixel.getAsset(character.referenceAssetId);
        const loaded = reference ? await loader.load(reference, undefined) : null;
        if (loaded) {
          loaded.key = slugify(reference!.name);
          loaded.slot = loaded.key;
          group.reference = loaded;
        } else {
          group.referenceMissing = true;
          issues.push({
            severity: "warning",
            code: "reference-missing",
            message: `${character.name}'s reference image is no longer available; the package has no identity image.`,
          });
        }
      }
    }
    return group;
  };

  const loadAssetGroup = async (asset: PixelAssetRecord, version: number | undefined): Promise<GroupData | null> => {
    report("collect", 0, 1, `Reading ${asset.name}`);
    const unit = await loader.load(asset, version);
    if (!unit) return null;
    const group: GroupData = {
      kind: "asset",
      key: slugify(asset.name),
      title: asset.name,
      character: null,
      reference: null,
      referenceMissing: false,
      units: [unit],
    };
    assignKeys(group, issues);
    return group;
  };

  const assetFor = (id: string | undefined): PixelAssetRecord | null => {
    const asset = id ? repo.pixel.getAsset(id) : null;
    if (!asset) issues.push({ severity: "error", code: "asset-not-found", message: "The selected asset no longer exists." });
    return asset;
  };
  const characterFor = (id: string | undefined): PixelCharacter | null => {
    const character = id ? repo.pixel.getCharacter(id) : null;
    if (!character) issues.push({ severity: "error", code: "character-not-found", message: "The selected character no longer exists." });
    return character;
  };

  switch (request.scope) {
    case "asset": {
      const asset = assetFor(request.assetId);
      if (asset) {
        project = repo.pixel.getProject(asset.projectId);
        const group = await loadAssetGroup(asset, request.version);
        if (group) groups.push(group);
        rootBase = request.version !== undefined && request.version !== asset.version
          ? `${slugify(asset.name)}-v${request.version}`
          : slugify(asset.name);
      }
      break;
    }
    case "animation": {
      animationFilter = request.animation?.trim();
      if (!animationFilter) {
        issues.push({ severity: "error", code: "animation-not-found", message: "Choose an animation to export." });
        break;
      }
      if (request.characterId) {
        const character = characterFor(request.characterId);
        if (character) {
          project = repo.pixel.getProject(character.projectId);
          const group = await loadCharacterGroup(character);
          if (group) groups.push(group);
          rootBase = `${slugify(character.name)}-${slugify(animationFilter)}`;
        }
      } else {
        const asset = assetFor(request.assetId);
        if (asset) {
          project = repo.pixel.getProject(asset.projectId);
          const group = await loadAssetGroup(asset, request.version);
          if (group) groups.push(group);
          rootBase = `${slugify(asset.name)}-${slugify(animationFilter)}`;
        }
      }
      const filter = animationFilter;
      if (groups.length && !groups.some((group) => group.units.some((unit) => unit.clips.some((clip) => clip.name === filter)))) {
        issues.push({ severity: "error", code: "animation-not-found", message: `No exported sprite has an animation called "${filter}".`, animation: filter });
      }
      break;
    }
    case "character": {
      const character = characterFor(request.characterId);
      if (character) {
        project = repo.pixel.getProject(character.projectId);
        const group = await loadCharacterGroup(character);
        if (group) groups.push(group);
        rootBase = slugify(character.name);
      }
      break;
    }
    case "project": {
      project = request.projectId ? repo.pixel.getProject(request.projectId) : null;
      if (!project) {
        issues.push({ severity: "error", code: "project-not-found", message: "The selected project no longer exists." });
        break;
      }
      rootBase = slugify(project.name);
      const characters = repo.pixel.listCharacters(project.id).sort(
        (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
      );
      for (const character of characters) {
        throwIfCancelled(options.signal);
        if (!repo.pixel.listAssets({ characterId: character.id }).length) {
          issues.push({
            severity: "warning",
            code: "character-empty",
            message: `${character.name} has no sprites yet and is left out.`,
          });
          continue;
        }
        const group = await loadCharacterGroup(character);
        if (group) groups.push(group);
      }
      const loose = repo.pixel
        .listAssets({ projectId: project.id })
        .filter((asset) => !asset.characterId)
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      for (const asset of loose) {
        throwIfCancelled(options.signal);
        const group = await loadAssetGroup(asset, undefined);
        if (group) groups.push(group);
      }
      if (!groups.length && !issues.some((issue) => issue.severity === "error")) {
        issues.push({ severity: "error", code: "project-empty", message: `${project.name} has no sprites to export yet.` });
      }
      break;
    }
  }
  throwIfCancelled(options.signal);

  const root = request.preset === "generic" ? rootBase : `${rootBase}-${request.preset}`;
  const blocked = issues.some((issue) => issue.severity === "error");
  const summaryUnits = groups.flatMap((group) =>
    group.units.filter(
      (unit) => !animationFilter || unit.clips.some((clip) => clip.name === animationFilter)
    )
  );
  const summary: PixelPackageSummary = {
    root,
    assets: summaryUnits.length,
    frames: 0,
    animations: 0,
    directions: PIXEL_DIRECTIONS.filter((direction) => summaryUnits.some((unit) => unit.direction === direction)),
    sheets: 0,
    versions: summaryUnits.map((unit) => ({
      assetId: unit.asset.id,
      name: unit.asset.name,
      version: unit.version,
      current: unit.isCurrent,
    })),
  };
  if (blocked) {
    return {
      root,
      files: new Map(),
      meta: new Map(),
      issues,
      summary,
      preview: null,
      expected: state.expected,
      engines: { godot: null, unity: null, phaser: null },
    };
  }

  const packageId = sha256(
    JSON.stringify({
      root,
      scope: request.scope,
      units: groups.flatMap((group) => group.units.map((unit) => `${unit.asset.id}@${unit.version}`)),
    })
  ).slice(0, 12);
  const projectScope = request.scope === "project";
  const builders: GroupBuilder[] = [];
  const folderNames = new Set<string>();
  for (const [index, group] of groups.entries()) {
    throwIfCancelled(options.signal);
    report("pack", index, groups.length, `Packing ${group.title}`);
    let folder = "";
    if (projectScope) {
      const parent = group.kind === "character" ? "characters" : "assets";
      folder = `${parent}/${numbered(group.key, folderNames)}`;
      group.key = folder.split("/")[1]!;
    }
    const builder = new GroupBuilder(state, group, folder, packageId, projectScope, animationFilter);
    builder.build();
    builders.push(builder);
    if (state.issues.some((issue) => issue.severity === "error")) break;
  }
  if (state.issues.some((issue) => issue.severity === "error")) {
    return {
      root,
      files: new Map(),
      meta: new Map(),
      issues,
      summary,
      preview: null,
      expected: state.expected,
      engines: { godot: null, unity: null, phaser: null },
    };
  }
  report("encode", groups.length, groups.length, "Writing the manifest");
  if (request.preset === "unity" && builders.some((builder) => builder.combined())) {
    const script = unityEditorScript(packageId, root);
    if (projectScope) {
      state.files.set(script.path, script.data);
      state.meta.set(script.path, { kind: "unity" });
    } else {
      builders[0]!.addExtra(script.path, script.data, "unity");
    }
  }
  for (const builder of builders) {
    const manifestName = builder.group.kind === "character" ? "character.json" : "asset.json";
    builder.finish(manifestName, project, readmeFor(builder, request, manifestName));
  }
  if (projectScope) {
    const projectFiles = [...state.files.entries()]
      .filter(([file]) => !builders.some((builder) => file.startsWith(`${builder.folder}/`)))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([file, data]) => ({ path: file, bytes: data.length, sha256: sha256(data) }));
    const readme = [
      `${project!.name} — KIREA Studio pixel project package`,
      "",
      "project.json lists every character and asset folder. Each folder has its own manifest",
      "(character.json or asset.json) and README.txt describing its files.",
      "",
    ].join("\n");
    const readmeBytes = Buffer.from(`${readme}\n`);
    state.files.set("README.txt", readmeBytes);
    state.meta.set("README.txt", { kind: "readme" });
    projectFiles.push({ path: "README.txt", bytes: readmeBytes.length, sha256: sha256(readmeBytes) });
    projectFiles.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const manifest = json({
      schema: PACKAGE_SCHEMA,
      schemaVersion: PACKAGE_SCHEMA_VERSION,
      generator: { app: "KIREA Studio", version: ctx.appVersion, engine: "pixelbolt" },
      scope: "project",
      preset: request.preset,
      project: { id: project!.id, name: project!.name, description: project!.description },
      export: { scale: request.scale, pivot: request.pivot, pixelsPerUnit: request.pixelsPerUnit, layout: request.layout },
      groups: builders.map((builder) => {
        const manifestName = builder.group.kind === "character" ? "character.json" : "asset.json";
        const manifestPath = `${builder.folder}/${manifestName}`;
        const bytes = state.files.get(manifestPath)!;
        return {
          kind: builder.group.kind,
          key: builder.group.key,
          name: builder.group.title,
          path: builder.folder,
          manifest: manifestPath,
          manifestSha256: sha256(bytes),
          assets: builder.group.units.map((unit) => unit.asset.id),
          animations: builder.animations.map((def) => def.key),
        };
      }),
      issues: issues.filter((issue) => issue.severity === "warning").map((issue) => ({ code: issue.code, message: issue.message })),
      files: projectFiles,
    });
    state.files.set("project.json", manifest);
    state.meta.set("project.json", { kind: "manifest" });
  }

  const sortedFiles = new Map([...state.files.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  summary.frames = builders.reduce(
    (sum, builder) =>
      sum +
      (request.scope === "animation"
        ? new Set(builder.animations.flatMap((def) => def.frames.map(({ frame }) => frame))).size
        : builder.group.units.reduce((count, unit) => count + unit.frames.length, 0)),
    0
  );
  summary.animations = builders.reduce((sum, builder) => sum + builder.animations.length, 0);
  summary.sheets = builders.reduce((sum, builder) => sum + builder.sheets.length, 0);

  const engineInfo: Record<string, Record<string, unknown> | null> = { godot: null, unity: null, phaser: null };
  for (const builder of builders) {
    for (const [engineKey, info] of Object.entries(builder.engineInfo)) {
      engineInfo[engineKey] = (info as Record<string, unknown> | null) ?? null;
    }
  }
  return {
    root,
    files: sortedFiles,
    meta: state.meta,
    issues,
    summary,
    preview: previewOf(ctx.engine, builders),
    expected: state.expected,
    engines: engineInfo,
  };
}

const PREVIEW_PIXEL_LIMIT = 1_048_576;

function previewOf(engine: PixelboltModule, builders: GroupBuilder[]): PixelPackagePreview | null {
  for (const builder of builders) {
    const sheet = builder.combined() ?? builder.sheets[0];
    if (sheet && sheet.packed.width * sheet.packed.height <= PREVIEW_PIXEL_LIMIT) {
      const png = engine.encodePNG(sheet.packed.data, sheet.packed.width, sheet.packed.height);
      return {
        label: `${builder.group.title} · ${sheet.path}`,
        dataUrl: `data:image/png;base64,${Buffer.from(png).toString("base64")}`,
        width: sheet.packed.width,
        height: sheet.packed.height,
      };
    }
  }
  for (const builder of builders) {
    const unit = builder.group.units[0];
    if (!unit) continue;
    const still = stillOf(unit).image;
    const png = engine.encodePNG(still.data, still.width, still.height);
    return {
      label: `${builder.group.title} · still`,
      dataUrl: `data:image/png;base64,${Buffer.from(png).toString("base64")}`,
      width: still.width,
      height: still.height,
    };
  }
  return null;
}
