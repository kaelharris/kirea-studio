import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterAll, describe, expect, it } from "vitest";
import type { ComfyRuntimeManager } from "../../src/main/comfy/runtime-manager";
import { StudioDatabase } from "../../src/main/db/database";
import { StudioRepository } from "../../src/main/db/repositories";
import { StudioLogger } from "../../src/main/logger";
import type { StudioPaths } from "../../src/main/paths";
import { verifyPackage } from "../../src/main/pixel/export/package-verify";
import { readPackage } from "../../src/main/pixel/export/package-writer";
import { loadPixelEngine } from "../../src/main/pixel/pixel-engine";
import { PixelService } from "../../src/main/pixel/pixel-service";
import type { PixelPackageRequest, PixelPackageResult } from "../../src/shared/pixel-package-types";
import { DEFAULT_PACKAGE_OUTPUTS, DEFAULT_SHEET_LAYOUT } from "../../src/shared/pixel-package-types";

// These tests open a real Unity editor and a real Phaser build, so they stay out of `npm test`:
//   KIREA_ENGINE_TESTS=1 npx vitest run tests/integration/package-engines.test.ts
const enabled = process.env.KIREA_ENGINE_TESTS === "1";
const require = createRequire(import.meta.url);

const UNITY_CANDIDATES = [
  process.env.KIREA_UNITY_PATH,
  "C:/Program Files/Unity/Hub/Editor/6000.6.6f1/Editor/Unity.exe",
  "C:/Program Files/Unity/Hub/Editor/6000.3.19f1/Editor/Unity.exe",
  "C:/Program Files/Unity/Hub/Editor/2022.3.62f3/Editor/Unity.exe",
  "/Applications/Unity/Hub/Editor/6000.6.6f1/Unity.app/Contents/MacOS/Unity",
];
const PHASER_CANDIDATES = [
  process.env.KIREA_PHASER_PATH,
  path.join(os.tmpdir(), "kirea-phaser", "package", "dist", "phaser.js"),
];

function firstExisting(candidates: Array<string | undefined>): string | null {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function electronBinary(): string | null {
  try {
    const resolved = require("electron") as unknown;
    return typeof resolved === "string" && fs.existsSync(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

const unity = firstExisting(UNITY_CANDIDATES);
const phaser = firstExisting(PHASER_CANDIDATES);
const electron = electronBinary();

const tempDirs: string[] = [];
const databases: StudioDatabase[] = [];

function makeHarness(): { paths: StudioPaths; service: PixelService } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-engines-"));
  tempDirs.push(root);
  const paths: StudioPaths = {
    userDataDir: root,
    dbPath: path.join(root, "studio.db"),
    logsDir: path.join(root, "logs"),
    cacheDir: path.join(root, "cache"),
    tempDir: path.join(root, "temp"),
    defaultOutputDir: path.join(root, "outputs"),
    defaultDownloadsDir: path.join(root, "downloads"),
    defaultManagedRuntimeDir: path.join(root, "runtime"),
    defaultManagedModelsDir: path.join(root, "models"),
    inputUploadCacheDir: path.join(root, "inputs"),
    modelPreviewCacheDir: path.join(root, "previews"),
    charactersDir: path.join(root, "characters"),
    pixelAssetsDir: path.join(root, "pixel-assets"),
    pixelExportsDir: path.join(root, "pixel-exports"),
    pixelAiTempDir: path.join(root, "pixel-ai-temp"),
  };
  for (const dir of Object.values(paths)) {
    if (typeof dir === "string" && path.extname(dir) === "") fs.mkdirSync(dir, { recursive: true });
  }
  const db = new StudioDatabase(paths.dbPath);
  databases.push(db);
  const repo = new StudioRepository(db);
  const logger = new StudioLogger(paths.logsDir);
  const runtime = {
    getApiClient: () => ({
      getAllObjectInfo: async () => {
        throw new Error("runtime offline");
      },
    }),
  } as unknown as ComfyRuntimeManager;
  return { paths, service: new PixelService(paths, repo, runtime, logger) };
}

function request(
  overrides: Partial<PixelPackageRequest> & Pick<PixelPackageRequest, "scope">
): PixelPackageRequest {
  return {
    preset: "generic",
    container: "folder",
    scale: 1,
    layout: { ...DEFAULT_SHEET_LAYOUT },
    outputs: { ...DEFAULT_PACKAGE_OUTPUTS },
    background: null,
    pivot: "bottom-center",
    pixelsPerUnit: 100,
    destination: null,
    ...overrides,
  };
}

interface Manifest {
  animations: Array<{ key: string; name: string; frames: unknown[] }>;
  sheets: Array<{ path: string; frames: number }>;
  engines: {
    unity: { sprites: string[]; clips: string[]; spriteMeta: string; animations: string } | null;
    phaser: { textureKey: string; animationKeys: string[]; atlas: string; animations: string } | null;
  };
}

async function exportPackage(
  service: PixelService,
  preset: "unity" | "phaser",
  prefix: string
): Promise<{ result: PixelPackageResult; folder: string; manifest: Manifest }> {
  const project = service.listProjects()[0]!;
  const detail = await service.generateAsset({
    projectId: project.id,
    kind: "character",
    name: "Engine Hero",
    width: 32,
    height: 32,
    paletteId: "kirea",
    seed: 41,
    direction: "front",
  });
  const destination = path.join(os.tmpdir(), `${prefix}-${Date.now()}`);
  const result = await service.exportPackage(
    request({
      scope: "asset",
      assetId: detail.id,
      preset,
      destination,
      pixelsPerUnit: 32,
      scale: preset === "unity" ? 2 : 1,
    })
  );
  const entries = await readPackage(result.filePath, "folder", result.plan.summary.root);
  const verify = verifyPackage(entries, {
    engine: await loadPixelEngine(),
    root: result.plan.summary.root,
  });
  expect(verify.ok, verify.problems.join(" | ")).toBe(true);
  const manifest = JSON.parse(entries.get("asset.json")!.toString("utf8")) as Manifest;
  return { result, folder: result.filePath, manifest };
}

afterAll(() => {
  for (const db of databases.splice(0)) db.close();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const UNITY_VERIFIER = `using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEngine;
using Kirea.PixelImport;

public static class KireaVerify
{
    [Serializable] class Frame { public string sprite; public float durationMs; }
    [Serializable] class Clip { public string name; public bool loop; public float frameRate; public Frame[] frames; }
    [Serializable] class Data { public string texture; public string clipsFolder; public Clip[] animations; }
    [Serializable] class Report
    {
        public bool ok;
        public List<string> problems = new List<string>();
        public int sprites;
        public int spritesExpected;
        public int clips;
        public string[] clipNames;
        public string[] clipPaths;
        public string texture;
        public int spritesToUnits;
    }

    public static void Run()
    {
        var report = new Report();
        var dataRoot = Application.dataPath.Replace('\\\\', '/');
        try
        {
            var jsonFiles = Directory.GetFiles(dataRoot, "*.unity-animations.json", SearchOption.AllDirectories);
            if (jsonFiles.Length != 1) report.problems.Add("expected one .unity-animations.json, found " + jsonFiles.Length);
            if (jsonFiles.Length > 0)
            {
                var jsonPath = jsonFiles[0].Replace('\\\\', '/');
                var data = JsonUtility.FromJson<Data>(File.ReadAllText(jsonPath));
                var folder = Path.GetDirectoryName(jsonPath).Replace('\\\\', '/');
                var assetFolder = "Assets" + folder.Substring(dataRoot.Length);
                var textureAsset = assetFolder + "/" + data.texture;
                report.texture = textureAsset;
                var texture = AssetDatabase.LoadAssetAtPath<Texture2D>(textureAsset);
                var importer = AssetImporter.GetAtPath(textureAsset) as TextureImporter;
                if (texture == null) report.problems.Add("no Texture2D at " + textureAsset);
                if (importer == null) report.problems.Add("no TextureImporter at " + textureAsset);
                else
                {
                    if (importer.textureType != TextureImporterType.Sprite) report.problems.Add("textureType " + importer.textureType);
                    if (importer.spriteImportMode != SpriteImportMode.Multiple) report.problems.Add("spriteImportMode " + importer.spriteImportMode);
                    if (importer.filterMode != FilterMode.Point) report.problems.Add("filterMode " + importer.filterMode);
                    if (importer.textureCompression != TextureImporterCompression.Uncompressed) report.problems.Add("compression " + importer.textureCompression);
                    report.spritesToUnits = Mathf.RoundToInt(importer.spritePixelsPerUnit);
                }
                var sprites = AssetDatabase.LoadAllAssetsAtPath(textureAsset).OfType<Sprite>().ToArray();
                report.sprites = sprites.Length;
                var needed = new HashSet<string>(data.animations.SelectMany(c => c.frames.Select(f => f.sprite)));
                report.spritesExpected = needed.Count;
                var byName = new Dictionary<string, Sprite>();
                foreach (var sprite in sprites)
                {
                    if (byName.ContainsKey(sprite.name)) report.problems.Add("duplicate sprite " + sprite.name);
                    byName[sprite.name] = sprite;
                    if (texture != null && (sprite.rect.x < 0 || sprite.rect.y < 0 || sprite.rect.xMax > texture.width || sprite.rect.yMax > texture.height))
                        report.problems.Add("sprite outside texture: " + sprite.name);
                    var pivotX = sprite.rect.width > 0 ? sprite.pivot.x / sprite.rect.width : 0;
                    var pivotY = sprite.rect.height > 0 ? sprite.pivot.y / sprite.rect.height : 0;
                    if (Mathf.Abs(pivotX - 0.5f) > 0.001f || Mathf.Abs(pivotY) > 0.001f)
                        report.problems.Add("pivot " + pivotX + "," + pivotY + " is not bottom-center for " + sprite.name);
                }
                foreach (var clip in data.animations)
                {
                    foreach (var frame in clip.frames)
                        if (!byName.ContainsKey(frame.sprite)) report.problems.Add("missing sprite " + frame.sprite);
                }
                KireaPixelImport.BuildAll();
                report.clips = data.animations.Length;
                report.clipNames = data.animations.Select(c => c.name).ToArray();
                var clipPaths = new List<string>();
                foreach (var clip in data.animations)
                {
                    var clipAsset = "Assets" + (folder + "/" + data.clipsFolder + "/" + clip.name + ".anim").Substring(dataRoot.Length);
                    clipPaths.Add(clipAsset);
                    var asset = AssetDatabase.LoadAssetAtPath<AnimationClip>(clipAsset);
                    if (asset == null) { report.problems.Add("missing clip " + clipAsset); continue; }
                    var settings = AnimationUtility.GetAnimationClipSettings(asset);
                    if (settings.loopTime != clip.loop) report.problems.Add(clip.name + " loopTime " + settings.loopTime);
                    if (Mathf.Abs(asset.frameRate - clip.frameRate) > 0.01f) report.problems.Add(clip.name + " frameRate " + asset.frameRate);
                    var bindings = AnimationUtility.GetObjectReferenceCurveBindings(asset);
                    if (bindings.Length != 1) { report.problems.Add(clip.name + " bindings " + bindings.Length); continue; }
                    var keys = AnimationUtility.GetObjectReferenceCurve(asset, bindings[0]);
                    if (keys == null || keys.Length != clip.frames.Length + 1)
                        report.problems.Add(clip.name + " keys " + (keys == null ? 0 : keys.Length) + " for " + clip.frames.Length + " frames");
                }
                report.clipPaths = clipPaths.ToArray();
            }
        }
        catch (Exception error)
        {
            report.problems.Add("exception: " + error);
        }
        report.ok = report.problems.Count == 0;
        File.WriteAllText(Path.Combine(Directory.GetParent(dataRoot).FullName, "KireaVerify.json"), JsonUtility.ToJson(report, true));
    }
}
`;

function runUnity(args: string[], timeout: number): { status: number | null; log: string } {
  const logFile = path.join(os.tmpdir(), `kirea-unity-${Date.now()}.log`);
  const result = spawnSync(unity!, [...args, "-logFile", logFile], {
    timeout,
    encoding: "utf8",
    windowsHide: true,
  });
  const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  return { status: result.status, log };
}

describe.skipIf(!enabled)("real engine imports", () => {
  it(
    "workflow E: Unity imports the package and builds every clip",
    async () => {
      expect(unity, "Unity was not found; set KIREA_UNITY_PATH").toBeTruthy();
      const { service } = makeHarness();
      const pkg = await exportPackage(service, "unity", "kirea-unity-package");
      expect(pkg.manifest.engines.unity).not.toBeNull();

      const project = path.join(os.tmpdir(), `kirea-unity-project-${Date.now()}`);
      tempDirs.push(project);
      const created = runUnity(
        ["-batchmode", "-nographics", "-quit", "-createProject", project],
        600_000
      );
      expect(created.status, created.log.slice(-4000)).toBe(0);
      const assets = path.join(project, "Assets");
      fs.mkdirSync(path.join(assets, "Editor"), { recursive: true });
      fs.cpSync(pkg.folder, path.join(assets, pkg.result.plan.summary.root), { recursive: true });
      fs.writeFileSync(path.join(assets, "Editor", "KireaVerify.cs"), UNITY_VERIFIER);

      const imported = runUnity(
        [
          "-batchmode",
          "-nographics",
          "-quit",
          "-projectPath",
          project,
          "-executeMethod",
          "KireaVerify.Run",
        ],
        900_000
      );
      const reportFile = path.join(project, "KireaVerify.json");
      const report = fs.existsSync(reportFile)
        ? (JSON.parse(fs.readFileSync(reportFile, "utf8")) as {
            ok: boolean;
            problems: string[];
            sprites: number;
            spritesExpected: number;
            clips: number;
            clipNames: string[];
            clipPaths: string[];
            spritesToUnits: number;
          })
        : null;
      expect(report, `Unity exited ${imported.status}: ${imported.log.slice(-6000)}`).toBeTruthy();
      expect(report!.problems.join(" | ")).toBe("");
      expect(report!.ok).toBe(true);
      expect(report!.spritesToUnits).toBe(64);
      expect(report!.sprites).toBe(report!.spritesExpected);
      expect(report!.sprites).toBe(pkg.manifest.sheets[0]!.frames);
      expect(report!.clips).toBe(pkg.manifest.animations.length);
      expect([...report!.clipNames].sort()).toEqual([...pkg.manifest.engines.unity!.clips].sort());
      for (const clipPath of report!.clipPaths) {
        expect(fs.existsSync(path.join(project, ...clipPath.split("/"))), clipPath).toBe(true);
      }
      for (const clip of pkg.manifest.engines.unity!.sprites) expect(clip.length).toBeGreaterThan(0);
    },
    1_200_000
  );

  it(
    "workflow F: Phaser 3.90 loads the atlas and plays every animation",
    async () => {
      expect(phaser, "Phaser was not found; set KIREA_PHASER_PATH").toBeTruthy();
      expect(electron, "Electron was not found").toBeTruthy();
      const { service } = makeHarness();
      const pkg = await exportPackage(service, "phaser", "kirea-phaser-package");
      const phaserInfo = pkg.manifest.engines.phaser!;
      expect(phaserInfo).not.toBeNull();
      const sheetBase = path.posix.basename(phaserInfo.atlas, ".json");
      const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-phaser-run-"));
      tempDirs.push(runDir);
      fs.copyFileSync(phaser!, path.join(runDir, "phaser.js"));
      const atlas = JSON.parse(
        fs.readFileSync(path.join(pkg.folder, "spritesheets", `${sheetBase}.json`), "utf8")
      ) as { frames: Record<string, { frame: { w: number; h: number }; pivot: { x: number; y: number } }> };
      const page = `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="game"></div>
<script src="./phaser.js"></script>
<script>
const fs = require("fs");
const path = require("path");
const PKG = ${JSON.stringify(pkg.folder)};
const TEXTURE = ${JSON.stringify(phaserInfo.textureKey)};
const sheet = ${JSON.stringify(path.join(pkg.folder, "spritesheets", sheetBase))};
const atlas = JSON.parse(fs.readFileSync(sheet + ".json", "utf8"));
const anims = JSON.parse(fs.readFileSync(sheet + ".anims.json", "utf8"));
const png = fs.readFileSync(sheet + ".png").toString("base64");
const problems = [];
window.__kireaResult = null;
window.addEventListener("error", function (event) {
  problems.push("page error: " + event.message);
  window.__kireaResult = { ok: false, problems: problems };
});
class VerifyScene extends Phaser.Scene {
  constructor() { super("verify"); }
  preload() { this.load.image("sheet", "data:image/png;base64," + png); }
  create() {
    const texture = this.textures.addAtlas(TEXTURE, this.textures.get("sheet").getSourceImage(), atlas);
    this.anims.fromJSON(anims);
    if (!texture) problems.push("addAtlas returned nothing");
    if (!this.textures.exists(TEXTURE)) problems.push("texture " + TEXTURE + " is missing");
    const keys = Object.keys(atlas.frames);
    for (const key of keys) if (!texture.has(key)) problems.push("frame " + key + " is missing");
    for (const key of keys.slice(0, 6)) {
      const frame = texture.get(key);
      const source = atlas.frames[key];
      if (frame.width !== source.frame.w || frame.height !== source.frame.h) problems.push(key + " rect mismatch");
      if (!!frame.trimmed !== !!source.trimmed) problems.push(key + " trim mismatch");
    }
    const loaded = [];
    for (const def of anims.anims) {
      const anim = this.anims.get(def.key);
      if (!anim) { problems.push("animation " + def.key + " is missing"); continue; }
      loaded.push(def.key);
      if (anim.frames.length !== def.frames.length) problems.push(def.key + " frame count " + anim.frames.length);
      if (anim.repeat !== def.repeat) problems.push(def.key + " repeat " + anim.repeat);
      for (let index = 0; index < def.frames.length; index++) {
        const frame = anim.frames[index];
        if (!frame) { problems.push(def.key + " frame " + index + " is missing"); continue; }
        if (frame.duration !== def.frames[index].duration) problems.push(def.key + " frame " + index + " duration " + frame.duration);
        if (!texture.has(frame.textureFrame)) problems.push(def.key + " frame " + index + " points at " + frame.textureFrame);
      }
    }
    window.__kireaResult = {
      ok: problems.length === 0,
      problems: problems,
      textureKey: TEXTURE,
      frameCount: keys.length,
      animationKeys: loaded,
      version: Phaser.VERSION
    };
  }
}
new Phaser.Game({ type: Phaser.HEADLESS, width: 64, height: 64, parent: "game", banner: false, audio: { noAudio: true }, scene: VerifyScene });
</script></body></html>`;
      fs.writeFileSync(path.join(runDir, "index.html"), page);
      fs.writeFileSync(
        path.join(runDir, "main.js"),
        `const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");
const dir = __dirname;
const resultFile = path.join(dir, "result.json");
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } });
  win.webContents.on("console-message", (_event, level, message) => { if (level >= 2) console.error("PHASER:", message); });
  await win.loadFile(path.join(dir, "index.html"));
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const result = await win.webContents.executeJavaScript("window.__kireaResult || null");
    if (result) { fs.writeFileSync(resultFile, JSON.stringify(result, null, 2)); app.quit(); return; }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  fs.writeFileSync(resultFile, JSON.stringify({ ok: false, problems: ["Phaser did not report a result"] }));
  app.quit();
}).catch((error) => {
  fs.writeFileSync(resultFile, JSON.stringify({ ok: false, problems: [String(error)] }));
  app.quit();
});
`
      );
      const run = spawnSync(electron!, [path.join(runDir, "main.js")], {
        timeout: 120_000,
        encoding: "utf8",
        windowsHide: true,
      });
      const resultFile = path.join(runDir, "result.json");
      const report = fs.existsSync(resultFile)
        ? (JSON.parse(fs.readFileSync(resultFile, "utf8")) as {
            ok: boolean;
            problems: string[];
            textureKey: string;
            frameCount: number;
            animationKeys: string[];
            version: string;
          })
        : null;
      expect(report, `Electron exited ${run.status}: ${run.stderr ?? ""}${run.stdout ?? ""}`).toBeTruthy();
      expect(report!.problems.join(" | ")).toBe("");
      expect(report!.ok).toBe(true);
      expect(report!.version.startsWith("3.90")).toBe(true);
      expect(report!.textureKey).toBe(phaserInfo.textureKey);
      expect(report!.frameCount).toBe(Object.keys(atlas.frames).length);
      expect([...report!.animationKeys].sort()).toEqual([...phaserInfo.animationKeys].sort());
      for (const frame of Object.values(atlas.frames)) {
        expect(frame.pivot.y).toBe(1);
      }
    },
    300_000
  );
});
