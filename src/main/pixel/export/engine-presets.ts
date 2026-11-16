import path from "node:path";
import type { PixelPackageFileKind, PixelPackageIssue } from "../../../shared/pixel-package-types";
import type { PixelboltModule } from "../pixel-engine";
import type { PackedSheet } from "./sheet-packer";
import { sha256 } from "./package-builder";

export interface PresetAnimation {
  key: string;
  loop: boolean;
  frames: Array<{ sheetKey: string; durationMs: number }>;
}

export interface PresetGroup {
  key: string;
  title: string;
  sheetPath: string;
  sheet: PackedSheet;
  animations: PresetAnimation[];
  /** Pivot of every frame, in exported canvas pixels measured from the frame's top-left. */
  pivots: Map<string, { x: number; y: number }>;
  pixelsPerUnit: number;
  scale: number;
  packageId: string;
  animationPrefix: string;
}

export interface PresetFile {
  path: string;
  data: Buffer;
  kind: PixelPackageFileKind;
}

export interface PresetResult {
  files: PresetFile[];
  issues: PixelPackageIssue[];
  info: Record<string, unknown>;
}

function baseName(sheetPath: string): string {
  return path.posix.basename(sheetPath, ".png");
}

function dirName(sheetPath: string): string {
  return path.posix.dirname(sheetPath);
}

function join(dir: string, file: string): string {
  return dir === "." ? file : `${dir}/${file}`;
}

// ---------------------------------------------------------------- Godot

export function godotFiles(engine: PixelboltModule, group: PresetGroup): PresetResult {
  const issues: PixelPackageIssue[] = [];
  const frames: Record<
    string,
    {
      frame: { x: number; y: number; w: number; h: number };
      spriteSourceSize: { x: number; y: number; w: number; h: number };
      sourceSize: { w: number; h: number };
      duration: number;
    }
  > = {};
  for (const key of group.sheet.order) {
    const region = group.sheet.regions.get(key)!;
    const animation = group.animations.find((entry) => entry.frames.some((frame) => frame.sheetKey === key));
    const duration = animation?.frames.find((frame) => frame.sheetKey === key)?.durationMs ?? 100;
    frames[key] = {
      frame: region.frame,
      spriteSourceSize: region.spriteSourceSize,
      sourceSize: region.sourceSize,
      duration,
    };
  }
  const animations: Record<string, { frames: string[]; loop: boolean }> = {};
  for (const animation of group.animations) {
    const keys = [...new Set(animation.frames.map((frame) => frame.sheetKey))];
    animations[`${group.animationPrefix}${animation.key}`] = { frames: keys, loop: animation.loop };
  }
  if (!Object.keys(animations).length) {
    issues.push({
      severity: "warning",
      code: "godot-no-animations",
      message: "The Godot scene has no animations to play because the package has no animation clips.",
    });
  }
  const resource = engine.spriteFrames(
    { frames, animations, meta: { image: path.posix.basename(group.sheetPath) } },
    { image: path.posix.basename(group.sheetPath) }
  );
  for (const key of resource.approximate) {
    issues.push({
      severity: "warning",
      code: "godot-timing",
      message: `Godot stores one speed per animation, so "${key}" plays at a fractional frame length that is a rounded 32-bit float. The sheet JSON keeps the exact millisecond durations.`,
    });
  }
  const folder = dirName(group.sheetPath);
  const base = baseName(group.sheetPath);
  const resourcePath = join(folder, `${base}.tres`);
  const scenePath = `${group.key}.tscn`;
  const first = Object.keys(animations)[0];
  const pivot = group.pivots.get(group.sheet.order[0]!) ?? { x: 0, y: 0 };
  const nodeName = godotNodeName(group.title);
  const scene = [
    "[gd_scene format=3]",
    "",
    `[ext_resource type="SpriteFrames" path=${quote(resourcePath)} id="1_frames"]`,
    "",
    `[node name=${quote(nodeName)} type="AnimatedSprite2D"]`,
    "texture_filter = 1",
    'sprite_frames = ExtResource("1_frames")',
    ...(first ? [`animation = &${quote(first)}`] : []),
    "centered = false",
    `offset = Vector2(${number(-pivot.x)}, ${number(-pivot.y)})`,
    "",
  ].join("\n");
  return {
    files: [
      { path: resourcePath, data: Buffer.from(resource.text), kind: "godot" },
      { path: scenePath, data: Buffer.from(scene), kind: "godot" },
    ],
    issues,
    info: {
      validated: "structure-only",
      resource: resourcePath,
      scene: scenePath,
      animations: Object.keys(animations),
      approximateTiming: resource.approximate,
      note: "KIREA checked the SpriteFrames regions, timing and paths; this package has not been opened in the Godot editor.",
    },
  };
}

function godotNodeName(title: string): string {
  const cleaned = title.replace(/[.:@%"/\\]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || "Sprite";
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function number(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
}

// ---------------------------------------------------------------- Unity

const UNITY_SPRITE_GROUP = 213;

interface UnitySprite {
  name: string;
  sheetKey: string;
  rect: { x: number; y: number; w: number; h: number };
  pivot: { x: number; y: number };
  spriteId: string;
  internalId: string;
}

function unityName(value: string, taken: Set<string>): string {
  const base = value.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "sprite";
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  for (let n = 2; ; n++) {
    const candidate = `${base}_${n}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}

function unitySprites(group: PresetGroup): UnitySprite[] {
  const taken = new Set<string>();
  const height = group.sheet.height;
  return group.sheet.order.map((sheetKey, index) => {
    const region = group.sheet.regions.get(sheetKey)!;
    const pivot = group.pivots.get(sheetKey) ?? { x: 0, y: 0 };
    const frame = region.frame;
    const name = unityName(sheetKey, taken);
    const pivotX = frame.w > 0 ? (pivot.x - region.spriteSourceSize.x) / frame.w : 0.5;
    const pivotY = frame.h > 0 ? 1 - (pivot.y - region.spriteSourceSize.y) / frame.h : 0.5;
    return {
      name,
      sheetKey,
      rect: { x: frame.x, y: height - (frame.y + frame.h), w: frame.w, h: frame.h },
      pivot: { x: round4(pivotX), y: round4(pivotY) },
      spriteId: sha256(`${group.packageId}:${sheetKey}`).slice(0, 32),
      internalId: String(BigInt(UNITY_SPRITE_GROUP) * 100000n + BigInt(index) * 2n),
    };
  });
}

function round4(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

function unityMaxTextureSize(width: number, height: number): number {
  let size = 32;
  while (size < Math.max(width, height) && size < 16384) size *= 2;
  return size;
}

function unityMeta(group: PresetGroup, sprites: UnitySprite[]): Buffer {
  const maxSize = unityMaxTextureSize(group.sheet.width, group.sheet.height);
  const lines: string[] = [
    "fileFormatVersion: 2",
    `guid: ${sha256(`${group.packageId}:${group.sheetPath}`).slice(0, 32)}`,
    "TextureImporter:",
    "  internalIDToNameTable:",
  ];
  for (const sprite of sprites) {
    lines.push("  - first:", `      ${UNITY_SPRITE_GROUP}: ${sprite.internalId}`, `    second: ${unityScalar(sprite.name)}`);
  }
  lines.push(
    "  externalObjects: {}",
    "  serializedVersion: 12",
    "  mipmaps:",
    "    mipMapMode: 0",
    "    enableMipMap: 0",
    "    sRGBTexture: 1",
    "    linearTexture: 0",
    "    fadeOut: 0",
    "    borderMipMap: 0",
    "    mipMapsPreserveCoverage: 0",
    "    alphaTestReferenceValue: 0.5",
    "    mipMapFadeDistanceStart: 1",
    "    mipMapFadeDistanceEnd: 3",
    "  bumpmap:",
    "    convertToNormalMap: 0",
    "    externalNormalMap: 0",
    "    heightScale: 0.25",
    "    normalMapFilter: 0",
    "    flipGreenChannel: 0",
    "  isReadable: 0",
    "  streamingMipmaps: 0",
    "  streamingMipmapsPriority: 0",
    "  vTOnly: 0",
    "  ignoreMipmapLimit: 0",
    "  grayScaleToAlpha: 0",
    "  generateCubemap: 6",
    "  cubemapConvolution: 0",
    "  seamlessCubemap: 0",
    "  textureFormat: 1",
    `  maxTextureSize: ${maxSize}`,
    "  textureSettings:",
    "    serializedVersion: 2",
    "    filterMode: 0",
    "    aniso: 1",
    "    mipBias: 0",
    "    wrapU: 1",
    "    wrapV: 1",
    "    wrapW: 1",
    "  nPOTScale: 0",
    "  lightmap: 0",
    "  compressionQuality: 50",
    "  spriteMode: 2",
    "  spriteExtrude: 1",
    "  spriteMeshType: 0",
    "  alignment: 9",
    "  spritePivot: {x: 0.5, y: 0.5}",
    `  spritePixelsToUnits: ${round4(group.pixelsPerUnit * group.scale)}`,
    "  spriteBorder: {x: 0, y: 0, z: 0, w: 0}",
    "  spriteGenerateFallbackPhysicsShape: 0",
    "  alphaUsage: 1",
    "  alphaIsTransparency: 1",
    "  spriteTessellationDetail: -1",
    "  textureType: 8",
    "  textureShape: 1",
    "  singleChannelComponent: 0",
    "  flipbookRows: 1",
    "  flipbookColumns: 1",
    "  maxTextureSizeSet: 0",
    "  compressionQualitySet: 0",
    "  textureFormatSet: 0",
    "  ignorePngGamma: 0",
    "  applyGammaDecoding: 0",
    "  swizzle: 50462976",
    "  cookieLightType: 0",
    "  platformSettings:",
    "  - serializedVersion: 3",
    "    buildTarget: DefaultTexturePlatform",
    `    maxTextureSize: ${maxSize}`,
    "    resizeAlgorithm: 0",
    "    textureFormat: -1",
    "    textureCompression: 0",
    "    compressionQuality: 50",
    "    crunchedCompression: 0",
    "    allowsAlphaSplitting: 0",
    "    overridden: 0",
    "    ignorePlatformSupport: 0",
    "    androidETC2FallbackOverride: 0",
    "    forceMaximumCompressionQuality_BC6H_BC7: 0",
    "  spriteSheet:",
    "    serializedVersion: 2",
    "    sprites:"
  );
  for (const sprite of sprites) {
    lines.push(
      "    - serializedVersion: 2",
      `      name: ${unityScalar(sprite.name)}`,
      "      rect:",
      "        serializedVersion: 2",
      `        x: ${sprite.rect.x}`,
      `        y: ${sprite.rect.y}`,
      `        width: ${sprite.rect.w}`,
      `        height: ${sprite.rect.h}`,
      "      alignment: 9",
      `      pivot: {x: ${sprite.pivot.x}, y: ${sprite.pivot.y}}`,
      "      border: {x: 0, y: 0, z: 0, w: 0}",
      "      outline: []",
      "      physicsShape: []",
      "      tessellationDetail: 0",
      "      bones: []",
      `      spriteID: ${sprite.spriteId}`,
      `      internalID: ${sprite.internalId}`,
      "      vertices: []",
      "      indices: ",
      "      edges: []",
      "      weights: []",
      "      secondaryTextures: []"
    );
  }
  lines.push(
    "    outline: []",
    "    physicsShape: []",
    "    bones: []",
    `    spriteID: ${sha256(`${group.packageId}:${group.sheetPath}:sheet`).slice(0, 32)}`,
    "    internalID: 0",
    "    vertices: []",
    "    indices: ",
    "    edges: []",
    "    weights: []",
    "    secondaryTextures: []",
    "    nameFileIdTable:"
  );
  for (const sprite of [...sprites].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    lines.push(`      ${unityScalar(sprite.name)}: ${sprite.internalId}`);
  }
  lines.push(
    "  mipmapLimitGroupName: ",
    "  pSDRemoveMatte: 0",
    "  userData: ",
    "  assetBundleName: ",
    "  assetBundleVariant: ",
    ""
  );
  return Buffer.from(`${lines.join("\n")}\n`);
}

function unityScalar(value: string): string {
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : JSON.stringify(value);
}

export function unityFiles(group: PresetGroup): PresetResult {
  const issues: PixelPackageIssue[] = [];
  const sprites = unitySprites(group);
  const byKey = new Map(sprites.map((sprite) => [sprite.sheetKey, sprite]));
  const folder = dirName(group.sheetPath);
  const base = baseName(group.sheetPath);
  const clipNames = new Set<string>();
  const animations = group.animations.map((animation) => {
    const name = unityName(`${group.animationPrefix}${animation.key}`, clipNames);
    const durations = animation.frames.map((frame) => frame.durationMs);
    const total = durations.reduce((sum, value) => sum + value, 0);
    return {
      name,
      source: animation.key,
      loop: animation.loop,
      frameRate: rounded(total > 0 ? (durations.length * 1000) / total : 12),
      frames: animation.frames.map((frame) => ({
        sprite: byKey.get(frame.sheetKey)!.name,
        durationMs: frame.durationMs,
      })),
    };
  });
  const data = {
    schema: "kirea.unity-animations",
    schemaVersion: 1,
    packageId: group.packageId,
    texture: path.posix.basename(group.sheetPath),
    pixelsPerUnit: round4(group.pixelsPerUnit * group.scale),
    clipsFolder: `${base}_clips`,
    animations,
  };
  const maxSize = unityMaxTextureSize(group.sheet.width, group.sheet.height);
  if (Math.max(group.sheet.width, group.sheet.height) > maxSize) {
    issues.push({
      severity: "warning",
      code: "unity-sheet-size",
      message: `Unity's texture importer tops out at 16384 px, but ${group.sheetPath} is ${group.sheet.width}×${group.sheet.height}. Lower the scale or split the sheet.`,
    });
  }
  return {
    files: [
      { path: `${group.sheetPath}.meta`, data: unityMeta(group, sprites), kind: "unity" },
      { path: join(folder, `${base}.unity-animations.json`), data: Buffer.from(`${JSON.stringify(data, null, 2)}\n`), kind: "unity" },
    ],
    issues,
    info: {
      validated: "structure-only",
      spriteMeta: `${group.sheetPath}.meta`,
      animations: join(folder, `${base}.unity-animations.json`),
      clipsFolder: join(folder, data.clipsFolder),
      sprites: sprites.map((sprite) => sprite.name),
      clips: animations.map((animation) => animation.name),
      pixelsPerUnit: data.pixelsPerUnit,
      note: "KIREA checked the TextureImporter meta, sprite rects, pivots and clip frames structurally; the package has not been imported by Unity at export time.",
    },
  };
}

export function unityEditorScript(packageId: string, root: string): PresetFile {
  const className = "KireaPixelImport";
  const menuRoot = root.replace(/[^A-Za-z0-9 _-]+/g, " ").trim() || "Package";
  const source = `// Generated by KIREA Studio for the "${packageId}" pixel package.
// Turns every kirea.unity-animations.json of this package into one AnimationClip per animation,
// with each frame held for its own duration. It never creates an Animator Controller.
using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace Kirea.PixelImport
{
    public class ${className} : AssetPostprocessor
    {
        const string TargetPackage = "${packageId}";

        [Serializable]
        class FrameEntry
        {
            public string sprite;
            public float durationMs;
        }

        [Serializable]
        class ClipEntry
        {
            public string name;
            public bool loop;
            public float frameRate;
            public FrameEntry[] frames;
        }

        [Serializable]
        class AnimationData
        {
            public string schema;
            public int schemaVersion;
            public string packageId;
            public string texture;
            public float pixelsPerUnit;
            public string clipsFolder;
            public ClipEntry[] animations;
        }

        static void OnPostprocessAllAssets(string[] imported, string[] deleted, string[] moved, string[] movedFrom)
        {
            foreach (var assetPath in imported)
            {
                if (assetPath.EndsWith(".unity-animations.json")) Build(assetPath);
            }
        }

        [MenuItem("Tools/KIREA/${menuRoot}/Build Pixel Animations")]
        public static void BuildAll()
        {
            var root = Path.Combine(Application.dataPath);
            foreach (var file in Directory.GetFiles(root, "*.unity-animations.json", SearchOption.AllDirectories))
            {
                var assetPath = "Assets" + file.Substring(root.Length).Replace('\\\\', '/');
                Build(assetPath);
            }
        }

        static void Build(string jsonPath)
        {
            var absolute = Path.GetFullPath(jsonPath);
            if (!File.Exists(absolute)) return;
            AnimationData data;
            try { data = JsonUtility.FromJson<AnimationData>(File.ReadAllText(absolute)); }
            catch (Exception error) { Debug.LogError("KIREA: cannot read " + jsonPath + ": " + error.Message); return; }
            if (data == null || data.packageId != TargetPackage || data.animations == null) return;

            var folder = Path.GetDirectoryName(jsonPath).Replace('\\\\', '/');
            var texturePath = folder + "/" + data.texture;
            var sprites = new Dictionary<string, Sprite>();
            foreach (var asset in AssetDatabase.LoadAllAssetsAtPath(texturePath))
            {
                var sprite = asset as Sprite;
                if (sprite != null) sprites[sprite.name] = sprite;
            }
            var expected = 0;
            foreach (var clip in data.animations) expected += clip.frames.Length;
            if (sprites.Count < expected)
            {
                Debug.LogWarning("KIREA: " + texturePath + " exposes " + sprites.Count + " sprites, fewer than the " + expected + " the animations need. Reimport the texture, then run Tools/KIREA/${menuRoot}/Build Pixel Animations.");
                return;
            }

            var clipsDir = folder + "/" + data.clipsFolder;
            if (!AssetDatabase.IsValidFolder(clipsDir)) AssetDatabase.CreateFolder(folder, data.clipsFolder);

            foreach (var entry in data.animations)
            {
                var keys = new List<ObjectReferenceKeyframe>();
                float time = 0f;
                foreach (var frame in entry.frames)
                {
                    Sprite sprite;
                    if (!sprites.TryGetValue(frame.sprite, out sprite))
                    {
                        Debug.LogError("KIREA: animation \\"" + entry.name + "\\" needs sprite \\"" + frame.sprite + "\\", which is not in " + texturePath + ".");
                        break;
                    }
                    keys.Add(new ObjectReferenceKeyframe { time = time, value = sprite });
                    time += Mathf.Max(0.001f, frame.durationMs) / 1000f;
                }
                if (keys.Count != entry.frames.Length) continue;
                keys.Add(new ObjectReferenceKeyframe { time = time, value = keys[keys.Count - 1].value });

                var clipPath = clipsDir + "/" + entry.name + ".anim";
                var clip = new AnimationClip { name = entry.name, frameRate = Mathf.Max(1f, entry.frameRate) };
                var settings = AnimationUtility.GetAnimationClipSettings(clip);
                settings.loopTime = entry.loop;
                AnimationUtility.SetAnimationClipSettings(clip, settings);
                var binding = EditorCurveBinding.PPtrCurve("", typeof(SpriteRenderer), "m_Sprite");
                AnimationUtility.SetObjectReferenceCurve(clip, binding, keys.ToArray());

                var existing = AssetDatabase.LoadAssetAtPath<AnimationClip>(clipPath);
                if (existing == null)
                {
                    AssetDatabase.CreateAsset(clip, clipPath);
                }
                else
                {
                    EditorUtility.CopySerialized(clip, existing);
                    existing.frameRate = clip.frameRate;
                    UnityEngine.Object.DestroyImmediate(clip);
                    EditorUtility.SetDirty(existing);
                }
                Debug.Log("KIREA: wrote " + clipPath + " (" + entry.frames.Length + " frames, " + (entry.loop ? "looping" : "one shot") + ").");
            }
            AssetDatabase.SaveAssets();
        }
    }
}
`;
  return { path: `Editor/${className}_${packageId}.cs`, data: Buffer.from(source), kind: "unity" };
}

function rounded(value: number): number {
  return Math.round(value * 1000) / 1000;
}

// ---------------------------------------------------------------- Phaser

export function phaserFiles(group: PresetGroup): PresetResult {
  const issues: PixelPackageIssue[] = [];
  const folder = dirName(group.sheetPath);
  const base = baseName(group.sheetPath);
  const textureKey = group.key;
  const animations = group.animations.map((animation) => {
    const frames = animation.frames.map((frame) => ({
      key: textureKey,
      frame: frame.sheetKey,
      duration: frame.durationMs,
    }));
    const total = frames.reduce((sum, frame) => sum + frame.duration, 0);
    return {
      key: `${group.animationPrefix}${animation.key}`,
      type: "frame",
      frames,
      frameRate: rounded(total > 0 ? (frames.length * 1000) / total : 12),
      repeat: animation.loop ? -1 : 0,
      yoyo: false,
    };
  });
  const data = {
    schema: "kirea.phaser-animations",
    schemaVersion: 1,
    packageId: group.packageId,
    atlas: `${base}.json`,
    texture: `${base}.png`,
    scale: group.scale,
    anims: animations,
  };
  return {
    files: [
      {
        path: join(folder, `${base}.anims.json`),
        data: Buffer.from(`${JSON.stringify(data, null, 2)}\n`),
        kind: "phaser",
      },
    ],
    issues,
    info: {
      validated: "structure-only",
      atlas: join(folder, `${base}.json`),
      animations: join(folder, `${base}.anims.json`),
      textureKey,
      animationKeys: animations.map((animation) => animation.key),
      note: "KIREA checked the atlas frame keys and the animation JSON structurally; the package has not been loaded by Phaser at export time.",
    },
  };
}
