import path from "node:path";
import type { PixelPackageVerification } from "../../../shared/pixel-package-types";
import type { PixelboltModule } from "../pixel-engine";
import { samePixels, unpackRegion, type RgbaImage, type SheetRegion } from "./sheet-packer";
import { sha256 } from "./hash";
import type { ExpectedPixels } from "./package-builder";

export interface VerifyOptions {
  engine: PixelboltModule;
  expected?: ExpectedPixels;
  root?: string;
}

interface FrameRecord {
  id: string;
  name: string;
  sheetKey: string;
}

interface SheetRecord {
  path: string;
  json: string;
  width: number;
  height: number;
}

interface SheetJson {
  frames: Record<string, { frame: { x: number; y: number; w: number; h: number }; spriteSourceSize?: SheetRegion["spriteSourceSize"]; sourceSize?: { w: number; h: number }; trimmed?: boolean }>;
}

function parseJson<T>(buffer: Buffer): T | null {
  try {
    return JSON.parse(buffer.toString("utf8")) as T;
  } catch {
    return null;
  }
}

function pngSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  if (bytes.readUInt32BE(0) !== 0x89504e47 || bytes.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  if (bytes.toString("latin1", 12, 16) !== "IHDR") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function apngInfo(bytes: Buffer): { width: number; height: number; frames: number } | null {
  const size = pngSize(bytes);
  if (!size) return null;
  let offset = 8;
  let frames = 0;
  let first = true;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    const body = offset + 8;
    if (type === "acTL") frames = bytes.readUInt32BE(body);
    if (first && type !== "IHDR") return null;
    first = false;
    offset = body + length + 4;
  }
  return frames > 0 ? { width: size.width, height: size.height, frames } : null;
}

function gifInfo(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 13) return null;
  const header = bytes.toString("latin1", 0, 6);
  if (header !== "GIF89a" && header !== "GIF87a") return null;
  return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
}

export function verifyPackage(entries: Map<string, Buffer>, options: VerifyOptions): PixelPackageVerification {
  const problems: string[] = [];
  let checkedFiles = 0;
  let checkedImages = 0;
  let checkedRegions = 0;
  let checkedPixels = 0;
  const report = (message: string): void => {
    problems.push(message);
  };

  const manifests: Array<{ folder: string; name: string; data: Record<string, unknown> }> = [];
  const projectJson = entries.has("project.json") ? parseJson<Record<string, unknown>>(entries.get("project.json")!) : null;
  if (entries.has("project.json") && !projectJson) report("project.json is not valid JSON.");
  if (projectJson) {
    const groups = Array.isArray(projectJson.groups) ? (projectJson.groups as Array<Record<string, unknown>>) : [];
    for (const group of groups) {
      const file = typeof group.manifest === "string" ? group.manifest : null;
      if (!file) {
        report("project.json lists a group without a manifest path.");
        continue;
      }
      const bytes = entries.get(file);
      if (!bytes) {
        report(`project.json points to ${file}, which is not in the package.`);
        continue;
      }
      const parsed = parseJson<Record<string, unknown>>(bytes);
      if (!parsed) report(`${file} is not valid JSON.`);
      else manifests.push({ folder: path.posix.dirname(file) === "." ? "" : path.posix.dirname(file), name: file, data: parsed });
    }
  } else {
    for (const name of ["character.json", "asset.json"]) {
      const bytes = entries.get(name);
      if (!bytes) continue;
      const parsed = parseJson<Record<string, unknown>>(bytes);
      if (!parsed) report(`${name} is not valid JSON.`);
      else manifests.push({ folder: "", name, data: parsed });
    }
  }
  if (!manifests.length && !problems.length) report("The package has no manifest (character.json, asset.json or project.json).");
  for (const manifest of manifests) {
    if (manifest.data.schema !== "kirea.pixel-package") report(`${manifest.name} is not a KIREA pixel package manifest.`);
    if (manifest.data.schemaVersion !== 1) report(`${manifest.name} has an unsupported schema version.`);
  }

  const allowed = new Set<string>(["project.json"]);
  const list = (manifest: { folder: string; name: string; data: Record<string, unknown> }): Array<{ path: string; bytes: number; sha256: string }> => {
    const prefix = manifest.folder ? `${manifest.folder}/` : "";
    const files = Array.isArray(manifest.data.files) ? (manifest.data.files as Array<Record<string, unknown>>) : [];
    const result: Array<{ path: string; bytes: number; sha256: string }> = [];
    for (const file of files) {
      const relative = String(file.path ?? "");
      if (!relative) {
        report(`${manifest.name} lists a file without a path.`);
        continue;
      }
      const full = `${prefix}${relative}`;
      result.push({ path: full, bytes: Number(file.bytes ?? -1), sha256: String(file.sha256 ?? "") });
      allowed.add(full);
    }
    allowed.add(manifest.name);
    return result;
  };

  const checked = new Set<string>();
  for (const manifest of manifests) {
    for (const file of list(manifest)) {
      if (checked.has(file.path)) {
        report(`${file.path} is listed twice.`);
        continue;
      }
      checked.add(file.path);
      const bytes = entries.get(file.path);
      if (!bytes) {
        report(`${manifest.name} lists ${file.path}, which is not in the package.`);
        continue;
      }
      checkedFiles += 1;
      if (bytes.length !== file.bytes) report(`${file.path} is ${bytes.length} bytes; its manifest says ${file.bytes}.`);
      if (sha256(bytes) !== file.sha256) report(`${file.path} does not match the manifest's SHA-256.`);
    }
  }
  if (projectJson) {
    const files = Array.isArray(projectJson.files) ? (projectJson.files as Array<Record<string, unknown>>) : [];
    for (const file of files) {
      const relative = String(file.path ?? "");
      const bytes = entries.get(relative);
      if (!bytes) {
        report(`project.json lists ${relative}, which is not in the package.`);
        continue;
      }
      if (checked.has(relative)) {
        allowed.add(relative);
        continue;
      }
      checked.add(relative);
      checkedFiles += 1;
      if (bytes.length !== Number(file.bytes ?? -1)) report(`${relative} is ${bytes.length} bytes; project.json says ${file.bytes}.`);
      if (sha256(bytes) !== String(file.sha256 ?? "")) report(`${relative} does not match project.json's SHA-256.`);
      allowed.add(relative);
    }
  }
  for (const key of entries.keys()) {
    if (!allowed.has(key) && key !== "project.json" && !manifests.some((manifest) => manifest.name === key)) {
      report(`${key} is in the package but not listed in any manifest.`);
    }
  }

  const { engine } = options;
  const sheetsByPath = new Map<string, SheetRecord>();
  const sheetJson = new Map<string, SheetJson>();
  const animationFrameIds = new Set<string>();
  const animationSheetKeys = new Set<string>();
  const frameIds = new Set<string>();

  for (const manifest of manifests) {
    const prefix = manifest.folder ? `${manifest.folder}/` : "";
    const assets = Array.isArray(manifest.data.assets) ? (manifest.data.assets as Array<Record<string, unknown>>) : [];
    for (const asset of assets) {
      const name = String(asset.name ?? asset.id ?? "asset");
      const exported = asset.exported as { w?: number; h?: number } | undefined;
      for (const field of ["still", "recipe", "generation"]) {
        const file = asset[field];
        if (typeof file === "string" && file && !entries.has(`${prefix}${file}`)) {
          report(`${name}: the manifest's ${field} file ${file} is missing.`);
        }
      }
      const transparency = asset.transparency as { mode?: string } | undefined;
      if (!transparency?.mode) report(`${name}: the manifest has no transparency record.`);
      const frames = Array.isArray(asset.frames) ? (asset.frames as Array<Record<string, unknown>>) : [];
      if (!frames.length) report(`${name}: the manifest lists no frames.`);
      for (const frame of frames) {
        const id = String(frame.id ?? "");
        if (!id) report(`${name}: a frame has no id.`);
        if (frameIds.has(id)) report(`${name}: frame id ${id} appears twice.`);
        frameIds.add(id);
        const sheetKey = String(frame.sheetKey ?? "");
        if (sheetKey) animationSheetKeys.add(sheetKey);
      }
      for (const file of Array.isArray(asset.looseFrames) ? (asset.looseFrames as string[]) : []) {
        const full = `${prefix}${file}`;
        const bytes = entries.get(full);
        if (!bytes) {
          report(`${name}: loose frame ${file} is missing.`);
          continue;
        }
        const size = pngSize(bytes);
        if (!size) report(`${name}: ${file} is not a PNG.`);
        else {
          checkedImages += 1;
          if (exported && (size.width !== exported.w || size.height !== exported.h)) {
            report(`${name}: ${file} is ${size.width}×${size.height}; the manifest says ${exported.w}×${exported.h}.`);
          }
        }
      }
    }

    const sheets = Array.isArray(manifest.data.sheets) ? (manifest.data.sheets as Array<Record<string, unknown>>) : [];
    for (const sheet of sheets) {
      const relative = String(sheet.path ?? "");
      const full = `${prefix}${relative}`;
      const bytes = entries.get(full);
      if (!bytes) {
        report(`${manifest.name}: sheet ${relative} is missing.`);
        continue;
      }
      const size = pngSize(bytes);
      if (!size) {
        report(`${manifest.name}: ${relative} is not a PNG.`);
        continue;
      }
      checkedImages += 1;
      if (size.width !== Number(sheet.width) || size.height !== Number(sheet.height)) {
        report(`${manifest.name}: ${relative} is ${size.width}×${size.height}; the manifest says ${sheet.width}×${sheet.height}.`);
      }
      const jsonFile = `${prefix}${String(sheet.json ?? "")}`;
      const jsonBytes = entries.get(jsonFile);
      const parsed = jsonBytes ? parseJson<SheetJson>(jsonBytes) : null;
      if (!parsed) {
        report(`${manifest.name}: ${relative} has no readable JSON atlas.`);
        continue;
      }
      sheetsByPath.set(full, { path: full, json: jsonFile, width: size.width, height: size.height });
      sheetJson.set(full, parsed);
      let decoded: RgbaImage | null = null;
      const getDecoded = (): RgbaImage | null => {
        if (decoded) return decoded;
        try {
          decoded = engine.decodePNG(bytes);
        } catch {
          report(`${manifest.name}: ${relative} does not decode as a PNG.`);
        }
        return decoded;
      };
      for (const [key, entry] of Object.entries(parsed.frames)) {
        const rect = entry.frame;
        if (!rect || ![rect.x, rect.y, rect.w, rect.h].every((value) => Number.isFinite(value))) {
          report(`${manifest.name}: ${relative} has a malformed frame "${key}".`);
          continue;
        }
        if (rect.w <= 0 || rect.h <= 0 || rect.x < 0 || rect.y < 0 || rect.x + rect.w > size.width || rect.y + rect.h > size.height) {
          report(`${manifest.name}: frame "${key}" lies outside ${relative}.`);
          continue;
        }
        checkedRegions += 1;
        const expected = options.expected?.regions.get(`${full}#${key}`);
        if (!expected) continue;
        const image = getDecoded();
        if (!image) continue;
        const region: SheetRegion = {
          frame: rect,
          trimmed: Boolean(entry.trimmed),
          spriteSourceSize: entry.spriteSourceSize ?? { x: 0, y: 0, w: rect.w, h: rect.h },
          sourceSize: entry.sourceSize ?? { w: rect.w, h: rect.h },
          canvasOffset: { x: 0, y: 0 },
          cell: { column: 0, row: 0 },
        };
        const restored = unpackRegion(image, region);
        checkedPixels += restored.width * restored.height;
        if (!samePixels(restored, expected)) report(`${manifest.name}: ${relative} frame "${key}" does not match its source pixels.`);
      }
    }

    const animations = Array.isArray(manifest.data.animations) ? (manifest.data.animations as Array<Record<string, unknown>>) : [];
    for (const animation of animations) {
      const key = String(animation.key ?? "");
      const frames = Array.isArray(animation.frames) ? (animation.frames as Array<Record<string, unknown>>) : [];
      if (!frames.length) report(`${manifest.name}: animation "${key}" has no frames.`);
      for (const frame of frames) {
        const id = String(frame.frameId ?? "");
        if (id && !frameIds.has(id)) report(`${manifest.name}: animation "${key}" refers to unknown frame ${id}.`);
        const sheetKey = String(frame.sheetKey ?? "");
        const found = [...sheetJson.entries()].some(([, json]) => Boolean(json.frames[sheetKey]));
        if (!found && sheetJson.size) report(`${manifest.name}: animation "${key}" uses "${sheetKey}", which no sheet contains.`);
      }
      for (const file of Array.isArray(animation.files) ? (animation.files as string[]) : []) {
        if (!entries.has(`${prefix}${file}`)) report(`${manifest.name}: animation "${key}" frame file ${file} is missing.`);
      }
      const preview = animation.preview as { gif?: string; apng?: string } | null | undefined;
      if (preview) {
        for (const kind of ["gif", "apng"] as const) {
          const file = preview[kind];
          if (!file) continue;
          const bytes = entries.get(`${prefix}${file}`);
          if (!bytes) {
            report(`${manifest.name}: animation "${key}" ${kind} preview ${file} is missing.`);
            continue;
          }
          if (kind === "gif") {
            if (!gifInfo(bytes)) report(`${manifest.name}: ${file} is not a readable GIF.`);
          } else {
            const info = apngInfo(bytes);
            if (!info) report(`${manifest.name}: ${file} is not a readable APNG.`);
            else if (Number(animation.frameCount) > 0 && info.frames !== Number(animation.frameCount)) {
              report(`${manifest.name}: ${file} holds ${info.frames} APNG frames; the manifest says ${animation.frameCount}.`);
            }
          }
        }
      }
    }

    const directions = Array.isArray(manifest.data.directions) ? (manifest.data.directions as Array<Record<string, unknown>>) : [];
    for (const direction of directions) {
      const still = direction.still;
      if (typeof still === "string" && still && !entries.has(`${prefix}${still}`)) {
        report(`${manifest.name}: the ${String(direction.direction)} still ${still} is missing.`);
      }
    }

    const engines = manifest.data.engines as Record<string, unknown> | undefined;
    verifyEngines(engines, prefix, entries, sheetsByPath, sheetJson, report, (count) => {
      checkedFiles += count;
    });
  }

  const expectedImages = options.expected?.images ?? new Map<string, RgbaImage>();
  for (const [file, expected] of expectedImages) {
    const bytes = entries.get(file);
    if (!bytes) continue;
    let decoded: RgbaImage;
    try {
      decoded = engine.decodePNG(bytes);
    } catch {
      continue;
    }
    checkedImages += 1;
    checkedPixels += expected.width * expected.height;
    if (!samePixels(decoded, expected)) report(`${file} does not match its source pixels.`);
  }

  return {
    ok: problems.length === 0,
    checkedFiles,
    checkedImages,
    checkedRegions,
    checkedPixels,
    problems,
  };
}

function verifyEngines(
  engines: Record<string, unknown> | undefined,
  prefix: string,
  entries: Map<string, Buffer>,
  sheets: Map<string, SheetRecord>,
  sheetJson: Map<string, SheetJson>,
  report: (message: string) => void,
  addChecked: (count: number) => void
): void {
  if (!engines) return;
  const need = (file: unknown, label: string): Buffer | null => {
    if (typeof file !== "string" || !file) return null;
    const bytes = entries.get(`${prefix}${file}`);
    if (!bytes) {
      report(`${label} ${file} is missing.`);
      return null;
    }
    addChecked(1);
    return bytes;
  };
  const godot = engines.godot as { resource?: string; scene?: string } | null;
  if (godot) {
    const resource = need(godot.resource, "The Godot SpriteFrames resource");
    if (resource) {
      const text = resource.toString("utf8");
      if (!text.startsWith('[gd_resource type="SpriteFrames"')) report(`${godot.resource} is not a SpriteFrames resource.`);
      const image = /\[ext_resource type="Texture2D" path="((?:[^"\\]|\\.)*)"/.exec(text)?.[1];
      if (!image) report(`${godot.resource} has no texture reference.`);
      else {
        const imagePath = path.posix.normalize(path.posix.join(path.posix.dirname(`${prefix}${godot.resource!}`), image.replace(/\\"/g, '"')));
        if (!entries.has(imagePath)) report(`${godot.resource} points at ${image}, which is not in the package.`);
      }
      const regions = [...text.matchAll(/region = Rect2\(([^)]+)\)/g)].map((match) => match[1]!.split(",").map(Number));
      if (!regions.length) report(`${godot.resource} defines no AtlasTexture regions.`);
      for (const region of regions) {
        const [x, y, w, h] = region;
        const inside = [...sheets.entries()].some(
          ([, sheet]) => x! >= 0 && y! >= 0 && x! + w! <= sheet.width && y! + h! <= sheet.height
        );
        if (!inside) report(`${godot.resource} has a region outside the sheet: ${region.join(", ")}.`);
      }
      if (!/^animations = \[/m.test(text)) report(`${godot.resource} defines no animations.`);
      if (!/\[resource\]/.test(text)) report(`${godot.resource} has no resource block.`);
    }
    const scene = need(godot.scene, "The Godot scene");
    if (scene) {
      const text = scene.toString("utf8");
      if (!text.startsWith("[gd_scene")) report(`${godot.scene} is not a Godot scene.`);
      const reference = /\[ext_resource type="SpriteFrames" path="((?:[^"\\]|\\.)*)"/.exec(text)?.[1];
      if (!reference) report(`${godot.scene} has no SpriteFrames reference.`);
      else if (!entries.has(path.posix.normalize(path.posix.join(prefix, reference)))) {
        report(`${godot.scene} points at ${reference}, which is not in the package.`);
      }
      if (!/type="AnimatedSprite2D"/.test(text)) report(`${godot.scene} has no AnimatedSprite2D node.`);
    }
  }

  const unity = engines.unity as
    | { spriteMeta?: string; animations?: string; clipsFolder?: string; sprites?: string[]; clips?: string[] }
    | null;
  if (unity) {
    const meta = need(unity.spriteMeta, "The Unity sprite meta");
    const animations = need(unity.animations, "The Unity animation list");
    const metaNames = new Set<string>();
    if (meta) {
      const text = meta.toString("utf8");
      if (!text.startsWith("fileFormatVersion: 2")) report(`${unity.spriteMeta} is not a Unity meta file.`);
      const guid = /^guid: ([0-9a-f]{32})$/m.exec(text)?.[1];
      if (!guid) report(`${unity.spriteMeta} has no valid GUID.`);
      if (!/^  textureType: 8$/m.test(text)) report(`${unity.spriteMeta} is not set up as a sprite.`);
      if (!/^  spriteMode: 2$/m.test(text)) report(`${unity.spriteMeta} does not use sprite mode 2.`);
      if (!/^    filterMode: 0$/m.test(text)) report(`${unity.spriteMeta} does not use point filtering.`);
      if (!/^    textureCompression: 0$/m.test(text)) report(`${unity.spriteMeta} does not keep the texture uncompressed.`);
      const spriteIds = new Set<string>();
      const spriteBlocks = text.split(/^    - serializedVersion: 2$/m).slice(1);
      const image = sheets.get(`${prefix}${metaPathToPng(unity.spriteMeta!)}`);
      for (const block of spriteBlocks) {
        const rawName = /^      name: (.+)$/m.exec(block)?.[1]?.trim();
        if (!rawName) continue;
        const name = rawName.startsWith('"') ? (JSON.parse(rawName) as string) : rawName;
        if (metaNames.has(name)) report(`${unity.spriteMeta} names the sprite "${name}" twice.`);
        metaNames.add(name);
        const spriteId = /^      spriteID: ([0-9a-f]{32})$/m.exec(block)?.[1];
        if (spriteId) {
          if (spriteIds.has(spriteId)) report(`${unity.spriteMeta} repeats spriteID ${spriteId}.`);
          spriteIds.add(spriteId);
        }
        const rect = readUnityRect(block);
        if (!rect) {
          report(`${unity.spriteMeta}: sprite "${name}" has no readable rect.`);
        } else if (image && (rect.x < 0 || rect.y < 0 || rect.x + rect.w > image.width || rect.y + rect.h > image.height)) {
          report(`${unity.spriteMeta}: sprite "${name}" lies outside its texture.`);
        }
        const pivot = /^      pivot: \{x: ([-\d.]+), y: ([-\d.]+)\}$/m.exec(block);
        if (!pivot) report(`${unity.spriteMeta}: sprite "${name}" has no pivot.`);
        else if (Number(pivot[1]) < 0 || Number(pivot[1]) > 1 || Number(pivot[2]) < 0 || Number(pivot[2]) > 1) {
          report(`${unity.spriteMeta}: sprite "${name}" has a pivot outside its rect.`);
        }
      }
      if (!spriteIds.size) report(`${unity.spriteMeta} defines no sprites.`);
      if (unity.sprites) {
        for (const sprite of unity.sprites) if (!metaNames.has(sprite)) report(`${unity.spriteMeta} has no sprite "${sprite}".`);
      }
    }
    if (animations) {
      const parsed = parseJson<{
        schema?: string;
        packageId?: string;
        texture?: string;
        animations?: Array<{ name: string; frames: Array<{ sprite: string; durationMs: number }> }>;
      }>(animations);
      if (!parsed) report(`${unity.animations} is not valid JSON.`);
      else {
        if (parsed.schema !== "kirea.unity-animations") report(`${unity.animations} has the wrong schema.`);
        if (!parsed.animations?.length) report(`${unity.animations} defines no animations.`);
        const texture = `${prefix}${path.posix.normalize(path.posix.join(path.posix.dirname(unity.animations!), parsed.texture ?? ""))}`;
        if (!parsed.texture || !entries.has(texture)) report(`${unity.animations} points at a texture that is not in the package.`);
        for (const animation of parsed.animations ?? []) {
          if (!animation.frames.length) report(`${unity.animations}: clip "${animation.name}" has no frames.`);
          for (const frame of animation.frames) {
            if (!metaNames.has(frame.sprite)) report(`${unity.animations}: clip "${animation.name}" needs missing sprite "${frame.sprite}".`);
            if (!(frame.durationMs > 0)) report(`${unity.animations}: clip "${animation.name}" has a frame with no duration.`);
          }
        }
      }
    }
  }

  const phaser = engines.phaser as { atlas?: string; animations?: string; textureKey?: string } | null;
  if (phaser) {
    const atlasBytes = need(phaser.atlas, "The Phaser atlas");
    const animsBytes = need(phaser.animations, "The Phaser animation list");
    const atlas = atlasBytes ? parseJson<{ frames?: Record<string, unknown>; meta?: { image?: string } }>(atlasBytes) : null;
    if (atlasBytes && !atlas) report(`${phaser.atlas} is not valid JSON.`);
    if (atlas?.meta?.image) {
      const image = path.posix.normalize(path.posix.join(path.posix.dirname(`${prefix}${phaser.atlas!}`), atlas.meta.image));
      if (!entries.has(image)) report(`${phaser.atlas} points at ${atlas.meta.image}, which is not in the package.`);
    }
    const anims = animsBytes
      ? parseJson<{ anims?: Array<{ key: string; frames: Array<{ key: string; frame: string }> }> }>(animsBytes)
      : null;
    if (animsBytes && !anims) report(`${phaser.animations} is not valid JSON.`);
    for (const animation of anims?.anims ?? []) {
      if (!animation.frames.length) report(`${phaser.animations}: animation "${animation.key}" has no frames.`);
      for (const frame of animation.frames) {
        if (frame.key !== phaser.textureKey) report(`${phaser.animations}: animation "${animation.key}" uses texture "${frame.key}", not "${phaser.textureKey}".`);
        if (atlas?.frames && !atlas.frames[frame.frame]) report(`${phaser.animations}: animation "${animation.key}" uses missing frame "${frame.frame}".`);
      }
    }
    for (const [, json] of sheetJson) {
      if (!Object.keys(json.frames).length) report(`${phaser.atlas} has an empty frame list.`);
    }
  }
}

function metaPathToPng(metaPath: string): string {
  return metaPath.endsWith(".meta") ? metaPath.slice(0, -".meta".length) : metaPath;
}

function readUnityRect(block: string): { x: number; y: number; w: number; h: number } | null {
  const x = /^        x: (-?\d+)$/m.exec(block)?.[1];
  const y = /^        y: (-?\d+)$/m.exec(block)?.[1];
  const w = /^        width: (\d+)$/m.exec(block)?.[1];
  const h = /^        height: (\d+)$/m.exec(block)?.[1];
  if (x === undefined || y === undefined || w === undefined || h === undefined) return null;
  return { x: Number(x), y: Number(y), w: Number(w), h: Number(h) };
}
