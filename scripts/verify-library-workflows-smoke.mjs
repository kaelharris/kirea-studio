import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import zlib from "node:zlib";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, "..");
const ELECTRON = path.join(ROOT, "node_modules", "electron", "dist", "electron.exe");
const RENDERER_PORT = 9455;
const MAIN_PORT = 9341;
const LOG_PATH = path.join(ROOT, "app-library-workflows-smoke.log");
const SHOT_DIR = path.join(os.tmpdir(), "kirea-library-workflows-smoke");
const PROFILE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-library-profile-"));
const RUNTIME_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-library-runtime-"));
const WORKFLOWS_DIR = path.join(
  PROFILE_DIR,
  "cache",
  "comfy-user",
  "default",
  "workflows"
);
const LEDGER_PATH = path.join(PROFILE_DIR, "cache", "workflow-import-ledger.json");
const PREVIEW_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const errors = [];
const notes = [];

fs.mkdirSync(SHOT_DIR, { recursive: true });

let child = null;
let renderer = null;
let mainCdp = null;

function log(line) {
  const text = `[${new Date().toISOString()}] ${line}`;
  console.log(text);
  fs.appendFileSync(LOG_PATH, `${text}\n`);
}

function isMissingLocalMedia(url) {
  if (!url || !String(url).startsWith("kirea-media://")) return false;
  try {
    const filePath = new URL(String(url)).searchParams.get("p");
    return Boolean(filePath) && !fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

/* ------------------------------------------------------------------ */
/* Fixtures and seeding                                                */
/* ------------------------------------------------------------------ */

function crc32(data) {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc ^= data[i];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, "utf8");
    const compressed = zlib.deflateRawSync(data);
    const checksum = crc32(data);
    const name = Buffer.from(entry.path, "utf8");
    const flags = 0x0800;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);

    localParts.push(local, name, compressed);
    centralParts.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

function uiWorkflow(nodes) {
  return JSON.stringify({ nodes, links: [], version: 0.4 }, null, 2);
}

const FLUX_V2_JSON = uiWorkflow([
  { id: 1, type: "CheckpointLoaderSimple", widgets_values: ["flux-dev.safetensors"] },
  { id: 2, type: "CLIPTextEncode", widgets_values: ["inpaint the mask, keep the face"] },
  { id: 3, type: "KSampler", widgets_values: [42, "euler"] },
  { id: 4, type: "SaveImage", widgets_values: ["flux-inpaint"] },
]);
const FLUX_V1_JSON = uiWorkflow([
  { id: 1, type: "CheckpointLoaderSimple", widgets_values: ["flux-schnell.safetensors"] },
  { id: 2, type: "KSampler", widgets_values: [7, "euler"] },
]);
const AURORA_JSON = uiWorkflow([
  { id: 1, type: "UpscaleModelLoader", widgets_values: ["4x-ultra.pth"] },
  { id: 2, type: "ImageUpscaleWithModel", widgets_values: [] },
]);
const WAN_JSON = uiWorkflow([
  { id: 1, type: "WanVideoSampler", widgets_values: ["wan2.1-t2v.safetensors"] },
  { id: 2, type: "SaveVideo", widgets_values: ["wan-motion"] },
]);
const PACK_JSON = uiWorkflow([
  { id: 1, type: "CheckpointLoaderSimple", widgets_values: ["inpaint-flux.safetensors"] },
  { id: 2, type: "InpaintModelConditioning", widgets_values: [] },
]);

const WAN_ZIP = buildZip([
  { path: "wan-motion.json", data: WAN_JSON },
  { path: "preview.png", data: Buffer.from(PREVIEW_PNG, "base64") },
]);
const LOCAL_ZIP_PATH = path.join(PROFILE_DIR, "kirea-test-pack.zip");
fs.writeFileSync(
  LOCAL_ZIP_PATH,
  buildZip([
    { path: "flows/flux-inpaint.json", data: PACK_JSON },
    { path: "preview.png", data: Buffer.from(PREVIEW_PNG, "base64") },
    { path: "scripts/setup.py", data: "print('never executed')\n" },
    { path: "README.txt", data: "Kirea smoke fixture archive.\n" },
  ])
);

function seedProfile() {
  const { StudioDatabase } = require(path.join(ROOT, "dist-electron/main/db/database.js"));
  const { StudioRepository } = require(
    path.join(ROOT, "dist-electron/main/db/repositories.js")
  );
  const dbPath = path.join(PROFILE_DIR, "kirea-studio.db");
  const db = new StudioDatabase(dbPath);
  try {
    const repo = new StudioRepository(db);
    repo.createCollection("col-fav", "Favorites");

    const png = Buffer.from(PREVIEW_PNG, "base64");
    const fixtureDir = path.join(PROFILE_DIR, "cache", "smoke-media");
    fs.mkdirSync(fixtureDir, { recursive: true });
    const imageOnePath = path.join(fixtureDir, "aria.png");
    const videoPath = path.join(fixtureDir, "aria-walk.webm");
    const previewPath = path.join(fixtureDir, "pixie-preview.png");
    const ariaRefPath = path.join(fixtureDir, "aria-ref.png");
    const missingImagePath = path.join(fixtureDir, "missing.png");
    const missingPreviewPath = path.join(fixtureDir, "missing-preview.png");
    const missingRefPath = path.join(fixtureDir, "ghost-ref.png");
    for (const file of [imageOnePath, previewPath, ariaRefPath]) {
      fs.writeFileSync(file, png);
    }

    const videoBuild = spawnSync(
      "ffmpeg",
      [
        "-y",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=64x64:r=24:d=1",
        "-c:v",
        "libvpx-vp9",
        "-b:v",
        "0",
        "-crf",
        "40",
        videoPath,
      ],
      { stdio: "inherit" }
    );
    if (videoBuild.status !== 0 || !fs.existsSync(videoPath)) {
      fail("Could not generate the video fixture with ffmpeg.");
    }

    const makeJob = (overrides = {}) => ({
      id: "job-1",
      promptId: null,
      status: "COMPLETED",
      errorKind: "NONE",
      errorMessage: null,
      prompt: "prompt",
      negativePrompt: "",
      checkpoint: "model.safetensors",
      workflowId: "t2i_sdxl_base",
      workflowVersion: "1",
      mode: "txt2img",
      settings: {},
      progressStep: 20,
      progressMax: 20,
      currentNode: null,
      previewDataUrl: null,
      outputPaths: [],
      submittedAt: "2026-11-10T10:00:00.000Z",
      startedAt: "2026-11-10T10:00:00.000Z",
      completedAt: "2026-11-10T10:01:00.000Z",
      batchIndex: 1,
      batchTotal: 1,
      ...overrides,
    });

    const imageOne = {
      id: "img-1",
      jobId: "job-img-1",
      filePath: imageOnePath,
      fileName: "aria.png",
      format: "png",
      width: 1024,
      height: 1024,
      sizeBytes: fs.statSync(imageOnePath).size,
      prompt: "Aria portrait with silver hair",
      negativePrompt: "blurry",
      seed: 1,
      checkpoint: "novaXL",
      loras: [],
      workflowId: "t2i_sdxl_base",
      sampler: "euler",
      scheduler: "normal",
      steps: 28,
      cfg: 6,
      denoise: 1,
      mode: "txt2img",
      favorite: true,
      tags: ["anime"],
      collectionId: "col-fav",
      createdAt: "2026-11-10T10:00:00.000Z",
    };
    const imageTwo = {
      ...imageOne,
      id: "img-2",
      jobId: "job-img-2",
      filePath: missingImagePath,
      fileName: "landscape.png",
      prompt: "landscape study",
      checkpoint: "flux-dev",
      favorite: false,
      tags: [],
      collectionId: null,
      createdAt: "2026-11-12T10:00:00.000Z",
    };
    const video = {
      id: "vid-1",
      jobId: "job-vid-1",
      filePath: videoPath,
      fileName: "aria-walk.webm",
      container: "webm",
      width: 64,
      height: 64,
      sizeBytes: fs.statSync(videoPath).size,
      durationSeconds: 4.5,
      fps: 24,
      frameCount: 108,
      prompt: "Aria walk cycle",
      negativePrompt: "",
      seed: 7,
      checkpoint: "wan-video",
      loras: [],
      workflowId: "t2v_wan_base",
      sampler: "euler",
      scheduler: "normal",
      steps: 20,
      cfg: 5,
      denoise: 1,
      mode: "t2v",
      favorite: true,
      tags: ["animation"],
      createdAt: "2026-11-13T10:00:00.000Z",
    };

    repo.recordCompletedGenerationTx(makeJob({ id: "job-img-1" }), [imageOne], null);
    repo.recordCompletedGenerationTx(
      makeJob({ id: "job-img-2", submittedAt: "2026-11-12T10:00:00.000Z" }),
      [imageTwo],
      null
    );
    repo.recordCompletedVideoTx(
      makeJob({ id: "job-vid-1", mode: "t2v" }),
      [video],
      null
    );

    const recipe = {
      version: 1,
      name: "pixie-idle",
      width: 32,
      height: 32,
      palette: { k: "#111111", b: "#4f7bfc" },
      frames: [
        { name: "idle_1", duration: 100 },
        { name: "idle_2", duration: 150 },
        { name: "walk_1", duration: 200 },
      ],
      animations: {
        idle: { frames: ["idle_1", "idle_2"] },
        walk: { frames: ["walk_1"], loop: false },
        empty: { frames: [] },
      },
    };
    const project = repo.pixel.saveProject({ id: "pixel-project", name: "Pixel Demo" });
    const pixelCharacter = repo.pixel.saveCharacter({
      id: "pixel-char-1",
      projectId: project.id,
      name: "Pixie",
    });
    repo.pixel.insertAsset(
      {
        id: "asset-1",
        projectId: project.id,
        characterId: pixelCharacter.id,
        name: "Pixie idle",
        kind: "character",
        engine: "pixelbolt",
        width: 32,
        height: 32,
        prompt: "tiny knight",
        seed: 3,
        paletteId: "kirea",
        palette: ["#111111", "#4f7bfc"],
        recipeJson: JSON.stringify(recipe),
        previewPath,
        sheetPath: null,
        parentAssetId: null,
      },
      []
    );
    repo.pixel.insertAsset(
      {
        id: "asset-2",
        projectId: project.id,
        characterId: null,
        name: "Orphan item",
        kind: "item",
        engine: "imported",
        width: 16,
        height: 16,
        prompt: "missing preview",
        seed: null,
        paletteId: "kirea",
        palette: [],
        recipeJson: "",
        previewPath: missingPreviewPath,
        sheetPath: null,
        parentAssetId: null,
      },
      []
    );

    const characterInput = (overrides = {}) => ({
      name: "Aria",
      description: "Protagonist of the demo",
      appearance: "silver hair",
      clothing: "black coat",
      promptPrefix: "kirea_aria",
      negativePrompt: "",
      triggerWords: [],
      architecture: "sdxl",
      referenceMode: "none",
      referenceWeight: 0.5,
      tags: ["hero"],
      favorite: true,
      ...overrides,
    });
    const aria = repo.saveCharacter(characterInput());
    repo.addCharacterReference({
      characterId: aria.id,
      filePath: ariaRefPath,
      role: "primary",
    });
    const ghost = repo.saveCharacter(
      characterInput({ name: "Ghost", description: "", tags: [], favorite: false })
    );
    repo.addCharacterReference({
      characterId: ghost.id,
      filePath: missingRefPath,
      role: "secondary",
    });
  } finally {
    db.close();
  }
}

/* ------------------------------------------------------------------ */
/* CDP plumbing                                                       */
/* ------------------------------------------------------------------ */

function connectCdp(socket) {
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result);
  });
  return {
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    async evaluate(expression) {
      const result = await this.send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails) {
        throw new Error(
          result.exceptionDetails.exception?.description ??
            result.exceptionDetails.text ??
            "Evaluation failed"
        );
      }
      return result.result?.value;
    },
    close() {
      try {
        socket.close();
      } catch {
        // already closed
      }
    },
  };
}

async function openWebSocket(wsUrl) {
  const socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  return socket;
}

async function listTargets() {
  try {
    const response = await fetch(`http://127.0.0.1:${RENDERER_PORT}/json/list`);
    if (!response.ok) return [];
    return await response.json();
  } catch {
    return [];
  }
}

async function waitForRendererTarget(timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const targets = await listTargets();
    const splash = targets.find((target) => String(target.url).includes("splash.html"));
    const main = targets.find(
      (target) =>
        target.type === "page" &&
        String(target.url).startsWith("file:") &&
        String(target.url).includes("index.html")
    );
    if (main && !splash) return main;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  fail("Timed out waiting for the main renderer target after the splash handoff.");
}

async function pollMainTarget(timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${MAIN_PORT}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const target = targets.find((entry) => entry.webSocketDebuggerUrl);
        if (target) return target;
      }
    } catch {
      // booting
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  fail("Timed out waiting for the Electron main-process inspector.");
}

async function evaluate(expression) {
  return renderer.evaluate(expression);
}

async function waitFor(fn, label, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  fail(`Timed out waiting for ${label}`);
}

const bodyIncludes = (text) =>
  evaluate(
    `document.body.innerText.toLowerCase().includes(${JSON.stringify(
      text.toLowerCase()
    )})`
  );

async function clickIfPresent(text) {
  return evaluate(`(() => {
    const needle = ${JSON.stringify(text)};
    const nodes = Array.from(document.querySelectorAll('button, [role="tab"], a'));
    const target = nodes.find((node) => (node.textContent || "").trim().includes(needle) && !node.disabled);
    if (!target) return false;
    target.click();
    return true;
  })()`);
}

async function click(text) {
  const clicked = await clickIfPresent(text);
  if (!clicked) fail(`No clickable element matched "${text}"`);
  log(`clicked: ${text}`);
}

async function clickFilter(label) {
  const clicked = await evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('button[aria-pressed]')).find((node) => {
      const text = (node.textContent || "").replace(/\\s+/g, " ").trim();
      return text.startsWith(${JSON.stringify(label)}) && /\\d+$/.test(text);
    });
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) fail(`No media filter matched "${label}"`);
  log(`clicked filter: ${label}`);
}

async function dialogText() {
  return evaluate(
    `document.querySelector('[role="dialog"]') ? document.querySelector('[role="dialog"]').innerText : ""`
  );
}

async function openNavPage(label, marker) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    await clickIfPresent(label);
    await new Promise((resolve) => setTimeout(resolve, 700));
    if (await bodyIncludes(marker)) {
      log(`opened: ${label}`);
      return;
    }
  }
  fail(`Timed out opening the "${label}" page.`);
}

async function screenshot(name) {
  await new Promise((resolve) => setTimeout(resolve, 400));
  const shot = await renderer.send("Page.captureScreenshot", { format: "png" });
  const file = path.join(SHOT_DIR, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
  log(`screenshot: ${file}`);
  return file;
}

async function setInput(ariaLabel, value) {
  const changed = await evaluate(`(() => {
    const input = document.querySelector('input[aria-label=${JSON.stringify(ariaLabel)}]');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  if (!changed) fail(`Could not set the "${ariaLabel}" input.`);
}

async function setSelect(ariaLabel, value) {
  const changed = await evaluate(`(() => {
    const select = document.querySelector('select[aria-label=${JSON.stringify(ariaLabel)}]');
    if (!select) return false;
    select.value = ${JSON.stringify(value)};
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!changed) fail(`Could not set the "${ariaLabel}" select.`);
}

async function clickAria(label) {
  const clicked = await evaluate(`(() => {
    const button = document.querySelector('[aria-label=${JSON.stringify(label)}]');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) fail(`No element with aria-label "${label}".`);
  log(`clicked aria: ${label}`);
}

async function closeModal() {
  const closed = await evaluate(`(() => {
    const button = document.querySelector('[aria-label="Close dialog"]');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!closed) fail("No open dialog to close.");
}

async function cardHeadingNames() {
  return evaluate(
    `Array.from(document.querySelectorAll('h3')).map((node) => (node.textContent || '').trim())`
  );
}

async function clickCardButton(name, label) {
  const clicked = await evaluate(`(() => {
    const heading = Array.from(document.querySelectorAll('h3')).find(
      (node) => (node.textContent || "").trim() === ${JSON.stringify(name)}
    );
    if (!heading) return false;
    let node = heading;
    while (node && !node.querySelector('button')) node = node.parentElement;
    if (!node) return false;
    const button = Array.from(node.querySelectorAll('button')).find(
      (candidate) =>
        (candidate.textContent || "").trim().includes(${JSON.stringify(label)}) &&
        !candidate.disabled
    );
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) fail(`No "${label}" button found in the "${name}" card.`);
  log(`clicked: ${label} (${name})`);
}

async function openWorkflowCard(name) {
  const clicked = await evaluate(`(() => {
    const heading = Array.from(document.querySelectorAll('h3')).find(
      (node) => (node.textContent || "").trim() === ${JSON.stringify(name)}
    );
    if (!heading) return false;
    const button = heading.closest('button');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) fail(`Could not open the "${name}" workflow card.`);
  log(`opened workflow: ${name}`);
}

async function libraryCount(label) {
  return evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('button[aria-pressed]')).find((node) => {
      const text = (node.textContent || "").replace(/\\s+/g, " ").trim();
      return text.startsWith(${JSON.stringify(label)}) && /\\d+$/.test(text);
    });
    if (!button) return null;
    const match = (button.textContent || "").match(/(\\d+)\\s*$/);
    return match ? Number(match[1]) : null;
  })()`);
}

async function inspectLabels() {
  return evaluate(
    `Array.from(document.querySelectorAll('[aria-label^="Inspect "]')).map((node) => node.getAttribute('aria-label'))`
  );
}

async function installedCardCount() {
  return evaluate(`(() => {
    return Array.from(document.querySelectorAll('button')).filter(
      (button) => (button.textContent || "").trim() === "Remove"
    ).length;
  })()`);
}

async function fileExists(filePath) {
  try {
    fs.accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}

async function waitForFile(filePath, label, timeoutMs = 20000) {
  await waitFor(() => fileExists(filePath), label, timeoutMs);
}

/* ------------------------------------------------------------------ */
/* Main-process mock for Civitai and workflow downloads               */
/* ------------------------------------------------------------------ */

const RAW_WORKFLOWS = [
  {
    id: 7001,
    name: "Flux Inpaint Detailer",
    type: "Workflows",
    nsfw: false,
    description: "<p>A <b>Flux</b> inpaint workflow</p><script>alert(1)</script>",
    tags: ["flux", "inpaint"],
    creator: { username: "flowmaster" },
    baseModels: ["Flux.1 D"],
    stats: { downloadCount: 9100, thumbsUpCount: 420, rating: 4.7 },
    modelVersions: [
      {
        id: 7102,
        name: "v2",
        baseModel: "Flux.1 D",
        publishedAt: "2026-10-02T00:00:00.000Z",
        description: "Release notes for v2.",
        stats: { downloadCount: 5100, thumbsUpCount: 320, thumbsDownCount: 8 },
        images: [{ url: "https://image.civitai.com/kirea/flux-inpaint.png" }],
        files: [
          {
            id: 1,
            name: "flow.json",
            type: "Config",
            sizeKB: 2,
            hashes: { SHA256: "ABC123" },
            downloadUrl: "https://workflows.example.com/flux-inpaint-v2.json",
          },
        ],
      },
      {
        id: 7101,
        name: "v1",
        baseModel: "Flux.1 D",
        publishedAt: "2026-08-14T00:00:00.000Z",
        stats: { downloadCount: 4000, thumbsUpCount: 100, thumbsDownCount: 3 },
        files: [
          {
            id: 2,
            name: "flux-inpaint-v1.json",
            type: "Config",
            sizeKB: 1,
            downloadUrl: "https://workflows.example.com/flux-inpaint-v1.json",
          },
        ],
      },
    ],
  },
  {
    id: 7002,
    name: "Wan Video Motion",
    type: "Workflows",
    nsfw: false,
    description: "Text-to-video motion pass for native Wan nodes.",
    tags: ["animation", "video"],
    creator: { username: "motionlab" },
    baseModels: ["Wan 2.1"],
    stats: { downloadCount: 2200, thumbsUpCount: 90, rating: 4.2 },
    modelVersions: [
      {
        id: 7201,
        name: "v1",
        baseModel: "Wan 2.1",
        stats: { downloadCount: 2200, thumbsUpCount: 90, thumbsDownCount: 1 },
        files: [
          {
            id: 3,
            name: "wan-motion.zip",
            type: "Archive",
            sizeKB: 6,
            downloadUrl: "https://workflows.example.com/wan-motion.zip",
          },
        ],
      },
    ],
  },
  {
    id: 7003,
    name: "Sdxl Upscale Studio",
    type: "Workflows",
    nsfw: false,
    description: "Compare two SDXL upscale passes.",
    tags: ["upscale"],
    creator: { username: "sharpener" },
    baseModels: ["SDXL 1.0"],
    stats: { downloadCount: 6600, thumbsUpCount: 210, rating: 4.5 },
    modelVersions: [
      {
        id: 7301,
        name: "v3",
        baseModel: "SDXL 1.0",
        stats: { downloadCount: 6600, thumbsUpCount: 210, thumbsDownCount: 2 },
        files: [
          {
            id: 4,
            name: "sdxl-upscale.json",
            type: "Config",
            downloadUrl: "https://workflows.example.com/sdxl-upscale.json",
          },
        ],
      },
    ],
  },
];

const MOCK_CONFIG = {
  page1: [RAW_WORKFLOWS[0], RAW_WORKFLOWS[1]],
  page2: [RAW_WORKFLOWS[0], RAW_WORKFLOWS[2]],
  models: RAW_WORKFLOWS,
  files: {
    "https://workflows.example.com/flux-inpaint-v2.json": {
      kind: "json",
      body: FLUX_V2_JSON,
    },
    "https://workflows.example.com/flux-inpaint-v1.json": {
      kind: "json",
      body: FLUX_V1_JSON,
    },
    "https://workflows.example.com/aurora-upscale.json": {
      kind: "json",
      body: AURORA_JSON,
    },
    "https://workflows.example.com/sdxl-upscale.json": {
      kind: "json",
      body: AURORA_JSON,
    },
    "https://workflows.example.com/wan-motion.zip": {
      kind: "zip",
      body: WAN_ZIP.toString("base64"),
    },
  },
};

function buildMockExpression() {
  return `(async () => {
    const config = ${JSON.stringify(MOCK_CONFIG)};
    if (globalThis.__kireaWorkflowSmokeInstalled) return "already installed";
    globalThis.__kireaSmokeRequests = [];
    const originalFetch = globalThis.fetch.bind(globalThis);
    const json = (value, status) =>
      new Response(JSON.stringify(value), {
        status: status || 200,
        headers: { "content-type": "application/json" },
      });

    globalThis.fetch = async function kireaWorkflowMockFetch(input, init) {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      globalThis.__kireaSmokeRequests.push(url);

      if (url.indexOf("https://civitai.com/api/v1/models?") === 0) {
        const cursor = new URL(url).searchParams.get("cursor");
        if (cursor === "page-2") {
          return json({ items: config.page2, metadata: { nextCursor: null } });
        }
        return json({ items: config.page1, metadata: { nextCursor: "page-2" } });
      }

      const detail = /^https:\\/\\/civitai\\.com\\/api\\/v1\\/models\\/(\\d+)/.exec(url);
      if (detail) {
        const found = config.models.find((model) => String(model.id) === detail[1]);
        return found ? json(found) : json({ error: "not found" }, 404);
      }

      if (config.files[url]) {
        const entry = config.files[url];
        if (entry.kind === "zip") {
          return new Response(Uint8Array.from(Buffer.from(entry.body, "base64")), {
            status: 200,
            headers: { "content-type": "application/zip" },
          });
        }
        return new Response(entry.body, {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      return originalFetch(input, init);
    };

    const electron = process.mainModule.require("electron");
    globalThis.__kireaDialogPath = ${JSON.stringify(LOCAL_ZIP_PATH)};
    if (!globalThis.__kireaDialogPatched) {
      const originalDialog = electron.dialog.showOpenDialog.bind(electron.dialog);
      electron.dialog.showOpenDialog = async (...args) => {
        if (globalThis.__kireaDialogPath) {
          return { canceled: false, filePaths: [globalThis.__kireaDialogPath] };
        }
        return originalDialog(...args);
      };
      globalThis.__kireaDialogPatched = true;
    }

    globalThis.__kireaWorkflowSmokeInstalled = true;
    return "installed";
  })()`;
}

async function requestLog() {
  return mainCdp.evaluate("JSON.stringify(globalThis.__kireaSmokeRequests || [])");
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                          */
/* ------------------------------------------------------------------ */

async function shutdown() {
  renderer?.close();
  mainCdp?.close();
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);
  if (child.exitCode === null) {
    try {
      child.kill("SIGKILL");
    } catch {
      // already gone
    }
  }
}

async function removeTempDir(dir) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 2, retryDelay: 200 });
      return;
    } catch (err) {
      if (attempt === 5) {
        log(`cleanup warning: could not remove ${dir}: ${err.message}`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
}

function listWorkflowFiles() {
  try {
    return fs
      .readdirSync(WORKFLOWS_DIR)
      .filter((name) => !name.startsWith("."))
      .sort();
  } catch {
    return [];
  }
}

function findForbiddenWeights() {
  const hits = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\\.(safetensors|ckpt|pt|pth|bin)$/i.test(entry.name)) hits.push(full);
    }
  };
  walk(PROFILE_DIR);
  return hits;
}

/* ------------------------------------------------------------------ */
/* Verification                                                       */
/* ------------------------------------------------------------------ */

async function verifyLibrary() {
  await openNavPage("Library", "Media Library");
  await waitFor(async () => (await libraryCount("All")) === 7, "library aggregation counts");

  assert((await libraryCount("Images")) === 2, "Library Images count should be 2.");
  assert((await libraryCount("Videos")) === 1, "Library Videos count should be 1.");
  assert((await libraryCount("Pixel Art")) === 2, "Library Pixel Art count should be 2.");
  assert((await libraryCount("Characters")) === 2, "Library Characters count should be 2.");
  assert((await libraryCount("Animations")) === 2, "Library Animations count should be 2.");
  await waitFor(
    () => bodyIncludes("3 media files can't be found on disk"),
    "the missing-media banner"
  );
  assert(
    (await bodyIncludes("The files were moved or deleted outside Kirea.")) === true,
    "The missing-media banner should explain the records are preserved."
  );
  notes.push("Library aggregated 7 items across 5 media types and surfaced 3 missing files");
  await screenshot("01-library-all");

  await clickFilter("Images");
  await waitFor(
    async () =>
      (await bodyIncludes("Aria portrait with silver hair")) &&
      (await bodyIncludes("landscape study")) &&
      (await bodyIncludes("1 media file can't be found on disk")),
    "Images filter"
  );
  let labels = await inspectLabels();
  assert(
    labels.length === 1 && labels[0] === "Inspect Aria portrait with silver hair",
    "Only the available image should offer inspection."
  );
  await setSelect("Sort media", "name");
  await waitFor(async () => {
    const order = await evaluate(`(() => {
      const text = document.body.innerText;
      return text.indexOf("Aria portrait with silver hair") < text.indexOf("landscape study");
    })()`);
    return order === true;
  }, "image title sort");
  notes.push("Images filter and title sorting matched the underlying image records");

  await clickFilter("All");
  await setSelect("Sort media", "newest");
  await setInput("Search media library", "aria");
  await waitFor(async () => (await libraryCount("All")) === 3, "search across media types");
  assert((await libraryCount("Pixel Art")) === 0, "Search 'aria' should not match pixel art.");
  await setInput("Search media library", "");
  await waitFor(async () => (await libraryCount("All")) === 7, "cleared search");

  await click("Favorites");
  await waitFor(async () => (await libraryCount("All")) === 3, "favorites filter");
  const favoritePressed = await evaluate(
    `document.querySelector('button[aria-pressed="true"]') !== null`
  );
  assert(favoritePressed, "The Favorites filter should report its pressed state.");
  await click("Favorites");
  await waitFor(async () => (await libraryCount("All")) === 7, "favorites cleared");

  await setSelect("Filter by image collection", "col-fav");
  await waitFor(async () => (await libraryCount("All")) === 1, "collection filter");
  labels = await inspectLabels();
  assert(
    labels[0] === "Inspect Aria portrait with silver hair",
    "The seeded collection should only contain the Aria image."
  );
  await setSelect("Filter by image collection", "all");
  await waitFor(async () => (await libraryCount("All")) === 7, "collection filter cleared");
  notes.push("Search matched prompts/models/characters; favorites and image collections filtered correctly");

  await clickFilter("Videos");
  await waitFor(async () => (await libraryCount("Videos")) === 1, "video filter");
  await waitFor(() => bodyIncludes("24 FPS"), "video card frame rate");
  assert((await bodyIncludes("5s")) === true, "Video card should show the recorded duration.");
  assert((await bodyIncludes("wan-video")) === true, "Video card should show the recorded model.");
  await clickAria("Inspect Aria walk cycle");
  await waitFor(() => bodyIncludes("Frame rate"), "video inspector metadata");
  assert((await bodyIncludes("108")) === true, "Video inspector should show the recorded frame count.");
  assert(
    (await bodyIncludes("t2v_wan_base")) === true,
    "Video inspector should show the recorded workflow."
  );
  const videoState = await evaluate(`(() => {
    const video = document.querySelector('video');
    if (!video) return null;
    return { readyState: video.readyState, width: video.videoWidth, height: video.videoHeight };
  })()`);
  assert(videoState && videoState.readyState >= 2, "The video element should decode the recorded file.");
  assert(videoState.width === 64, "The decoded video width should match the fixture.");
  notes.push(
    `Video inspector decoded the real file (readyState ${videoState.readyState}, ${videoState.width}x${videoState.height})`
  );
  await screenshot("02-library-video-inspector");
  await click("Open in Video Studio");
  await waitFor(() => bodyIncludes("Aria walk cycle"), "Video Studio focus from the library", 30000);
  await waitFor(() => bodyIncludes("Video Studio"), "Video Studio page");
  log("video cross-navigation reached Video Studio");
  notes.push("Video cross-navigation opened Video Studio with the same video history record");

  await openNavPage("Library", "Media Library");
  await clickFilter("Pixel Art");
  await waitFor(async () => (await libraryCount("Pixel Art")) === 2, "pixel filter");
  await clickAria("Inspect Pixie idle");
  await waitFor(() => bodyIncludes("Animation clips"), "pixel inspector metadata");
  assert((await bodyIncludes("idle, walk")) === true, "Pixel inspector should list animation clips.");
  assert((await bodyIncludes("Pixie")) === true, "Pixel inspector should show the character.");
  await screenshot("03-library-pixel-inspector");
  await click("Open in Pixel Studio");
  await waitFor(() => bodyIncludes("Pixie idle"), "Pixel Studio focus from the library", 30000);
  await waitFor(() => bodyIncludes("Pixel Studio"), "Pixel Studio page");
  log("pixel cross-navigation reached Pixel Studio");
  notes.push("Pixel cross-navigation opened Pixel Studio on the same asset");

  await openNavPage("Library", "Media Library");
  await clickFilter("Animations");
  await waitFor(async () => (await libraryCount("Animations")) === 2, "animation filter");
  assert((await bodyIncludes("Loop")) === true, "Animated clips should show their loop flag.");
  assert((await bodyIncludes("One-shot")) === true, "Non-looping clips should show One-shot.");
  assert((await bodyIncludes("2 frames")) === true, "Animation cards should show frame counts.");
  notes.push("Derived animations rendered with clip names, durations, and loop flags");

  await clickFilter("Characters");
  await waitFor(async () => (await libraryCount("Characters")) === 2, "character filter");
  await clickAria("Inspect Aria");
  await waitFor(() => bodyIncludes("Protagonist of the demo"), "character inspector description");
  assert((await bodyIncludes("References")) === true, "Character inspector should show references.");
  assert((await bodyIncludes("sdxl")) === true, "Character inspector should show the architecture.");
  await screenshot("04-library-character-inspector");
  await click("Open in Character Studio");
  await waitFor(() => bodyIncludes("Character Hub"), "Character Hub from the library", 30000);
  await waitFor(() => bodyIncludes("Aria"), "focused character");
  log("character cross-navigation reached Character Hub");
  notes.push("Character cross-navigation opened the Character Hub profile");

  await openNavPage("Library", "Media Library");
  await clickAria("List view");
  await waitFor(() => bodyIncludes("Open in Video Studio"), "list view rows");
  assert((await bodyIncludes("landscape study")) === true, "List view should include missing rows too.");
  await screenshot("05-library-list-view");
  await clickAria("Grid view");
  await waitFor(() => bodyIncludes("Media Library"), "grid view restore");
  notes.push("Grid and list presentations both render the same records");
}

async function verifyWorkflowBrowser() {
  await openNavPage("Workflows", "Civitai workflow discovery");
  await click("Browse Civitai");
  await waitFor(() => bodyIncludes("Flux Inpaint Detailer"), "mocked Civitai workflow results");
  assert(
    (await bodyIncludes("Wan Video Motion")) === true,
    "The second mocked workflow should render."
  );
  await screenshot("06-workflows-browse");

  const civitaiRequests = JSON.parse(await requestLog()).filter((url) =>
    url.startsWith("https://civitai.com/api/v1/models")
  );
  assert(civitaiRequests.length > 0, "The workflow browser should call Civitai.");
  for (const url of civitaiRequests) {
    assert(
      new URL(url).searchParams.get("types") === "Workflows",
      `Civitai search must use the workflow type filter: ${url}`
    );
  }
  notes.push(
    `Civitai search used types=Workflows on all ${civitaiRequests.length} request(s)`
  );

  await click("Load more");
  await waitFor(() => bodyIncludes("Sdxl Upscale Studio"), "second workflow page");
  const namesAfterLoadMore = await cardHeadingNames();
  assert(
    namesAfterLoadMore.filter((name) => name === "Flux Inpaint Detailer").length === 1,
    "Loading another page must not duplicate workflow cards."
  );
  notes.push("Pagination appended page 2 without duplicating the repeated model");

  await click("Inpainting");
  await waitFor(
    () => bodyIncludes("Category filtering scans multiple Civitai pages"),
    "category scan notice"
  );
  await waitFor(() => bodyIncludes("Flux Inpaint Detailer"), "category results");
  const inpa = await cardHeadingNames();
  assert(
    !inpa.includes("Wan Video Motion"),
    "The Inpainting category must exclude the video workflow."
  );
  notes.push("The Inpainting category filtered workflows using Civitai metadata");
  await click("All");

  await openWorkflowCard("Flux Inpaint Detailer");
  await waitFor(() => bodyIncludes("A Flux inpaint workflow"), "workflow details modal");
  assert((await bodyIncludes("flowmaster")) === true, "Details should show the creator.");
  assert((await bodyIncludes("flow.json")) === true, "Details should list the workflow file.");
  const versionOptions = await evaluate(
    `Array.from(document.querySelector('select[aria-label="Workflow version"]').options).map((option) => option.textContent)`
  );
  assert(versionOptions.length === 2, "The version selector should list both versions.");
  await setSelect("Workflow version", "7101");
  await waitFor(() => bodyIncludes("flux-inpaint-v1.json"), "v1 file list");
  await setSelect("Workflow version", "7102");
  await waitFor(() => bodyIncludes("flow.json"), "v2 file list");
  await screenshot("07-workflow-details");

  await click("Prepare import");
  await waitFor(() => bodyIncludes("Workflow analyzed"), "workflow analysis preview");
  assert((await bodyIncludes("Installable")) === true, "A UI workflow should be installable.");
  await screenshot("08-workflow-prepared");

  await click("Install into ComfyUI");
  const installedFlux = path.join(WORKFLOWS_DIR, "Flux Inpaint Detailer - v2.json");
  await waitForFile(installedFlux, "Civitai workflow installation");
  await waitFor(() => bodyIncludes("installed as Flux Inpaint Detailer - v2.json"), "installed badge in the modal");
  await screenshot("09-workflow-installed");
  await closeModal();
  await waitFor(async () => {
    const names = await cardHeadingNames();
    return names.includes("Flux Inpaint Detailer");
  }, "workflow grid after closing the modal");
  const fluxCard = await evaluate(`(() => {
    const heading = Array.from(document.querySelectorAll('h3')).find(
      (node) => (node.textContent || '').trim() === 'Flux Inpaint Detailer'
    );
    let node = heading;
    while (node && !node.querySelector('button')) node = node.parentElement;
    return node ? node.innerText : '';
  })()`);
  assert(
    fluxCard.toLowerCase().includes("installed"),
    "The workflow card should show an Installed badge."
  );
  notes.push("Civitai UI workflow downloaded, analyzed, installed, and marked installed");

  await openWorkflowCard("Wan Video Motion");
  await waitFor(
    () => evaluate(`Boolean(document.querySelector('select[aria-label="Workflow version"]'))`),
    "Wan workflow modal"
  );
  await click("Prepare import");
  await waitFor(
    () => bodyIncludes("Archive with 1 workflow candidate(s)"),
    "Wan archive candidate preview"
  );
  const wanDialog = (await dialogText()).toLowerCase();
  assert(
    wanDialog.includes("wan-motion.json"),
    "The archive candidate should be listed."
  );
  assert(
    wanDialog.includes("installable"),
    "The archive's UI workflow should be reported installable."
  );
  assert(
    wanDialog.includes("video"),
    "The video workflow badge should be shown."
  );
  await screenshot("10-workflow-archive-preview");
  await closeModal();
  assert(
    !fs.existsSync(path.join(WORKFLOWS_DIR, "Wan Video Motion - v1.json")),
    "Preparing a ZIP must not install anything."
  );
  notes.push("A Civitai ZIP was inspected in memory and previewed without installing");
}

async function verifyLocalImportAndManagement() {
  const installedFlux = path.join(WORKFLOWS_DIR, "Flux Inpaint Detailer - v2.json");
  await openNavPage("Workflows", "Civitai workflow discovery");
  await click("Import Workflow");
  await waitFor(() => bodyIncludes("Analyze a workflow"), "import tab");

  await setInput("Workflow URL", "https://workflows.example.com/aurora-upscale.json");
  await click("Analyze URL");
  await waitFor(
    () => bodyIncludes("ComfyUI Node Compatibility"),
    "URL workflow analysis"
  );
  assert((await bodyIncludes("UI workflow")) === true, "The URL workflow should be detected as UI format.");
  await click("Install into ComfyUI");
  const aurora = path.join(WORKFLOWS_DIR, "aurora-upscale.json");
  await waitForFile(aurora, "direct URL workflow install");
  await waitFor(async () => (await bodyIncludes("Installed in ComfyUI")) === true, "installed side card");
  notes.push("Direct HTTPS workflow JSON analyzed and installed");

  await click("Analyze URL");
  await waitFor(
    () => bodyIncludes("ComfyUI Node Compatibility"),
    "re-analysis of the direct URL"
  );
  await click("Install into ComfyUI");
  const auroraCopy = path.join(WORKFLOWS_DIR, "aurora-upscale-1.json");
  await waitForFile(auroraCopy, "collision-safe workflow install");
  assert(fs.existsSync(aurora), "A second install must not overwrite the first file.");
  notes.push("Reinstalling the same workflow created -1 instead of overwriting");

  await click("Choose ZIP archive");
  await waitFor(() => bodyIncludes("kirea-test-pack.zip"), "local ZIP inspection", 30000);
  assert((await bodyIncludes("flows/flux-inpaint.json")) === true, "ZIP candidate entry should render.");
  assert(
    (await bodyIncludes("images, scripts, nested archives and custom nodes are never")) === true,
    "The archive protection copy should be visible."
  );
  await screenshot("11-workflows-zip-preview");
  await click("Install into ComfyUI");
  const packFile = path.join(WORKFLOWS_DIR, "kirea-test-pack - flux-inpaint.json");
  await waitForFile(packFile, "ZIP workflow installation");
  assert(
    !fs.existsSync(path.join(WORKFLOWS_DIR, "preview.png")),
    "ZIP preview images must not be extracted during install."
  );
  assert(
    !fs.existsSync(path.join(WORKFLOWS_DIR, "setup.py")),
    "ZIP scripts must not be extracted during install."
  );
  notes.push("ZIP import installed only the selected workflow; preview and script entries stayed packed");

  await click("Installed (");
  await waitFor(
    () =>
      evaluate(
        `Boolean(document.querySelector('input[aria-label="Search installed workflows"]'))`
      ),
    "installed tab"
  );
  await waitFor(async () => (await installedCardCount()) === 4, "four installed workflow cards");
  assert((await bodyIncludes("ComfyUI workflows folder:")) === true, "The workflows folder should be shown.");
  await screenshot("12-workflows-installed");

  await setInput("Search installed workflows", "aurora");
  await waitFor(async () => (await installedCardCount()) === 2, "installed workflow search");
  await setInput("Search installed workflows", "");
  await waitFor(async () => (await installedCardCount()) === 4, "cleared installed search");
  await setSelect("Filter installed workflows", "unknown");
  await waitFor(async () => (await installedCardCount()) === 4, "unverified filter");
  await setSelect("Filter installed workflows", "all");
  notes.push("Installed workflow search and compatibility filters worked");

  await clickCardButton("Flux Inpaint Detailer - v2", "Details");
  await waitFor(() => bodyIncludes("Source URL:"), "installed workflow details");
  assert(
    (await bodyIncludes("Civitai model 7001, version 7102")) === true,
    "Details should preserve the Civitai model/version identity."
  );
  await screenshot("13-workflow-import-details");
  await closeModal();

  await clickCardButton("Flux Inpaint Detailer - v2", "Revalidate");
  await waitFor(() => bodyIncludes("Revalidated 'Flux Inpaint Detailer - v2.json'"), "revalidation toast", 30000);
  assert(fs.existsSync(installedFlux), "Revalidation must not modify the installed file.");
  notes.push("Revalidate re-analyzed the installed workflow and reported its dependencies");

  await clickCardButton("Flux Inpaint Detailer - v2", "Reimport");
  await waitFor(() => bodyIncludes("Reimport preview"), "reimport preview modal", 30000);
  assert(
    (await bodyIncludes("never")) === true,
    "Reimport should explain that installing creates a new file."
  );
  await screenshot("14-workflow-reimport");
  await closeModal();
  await waitFor(async () => !(await bodyIncludes("Reimport preview")), "reimport modal closed");

  await clickCardButton("kirea-test-pack - flux-inpaint", "Remove");
  await waitFor(() => bodyIncludes("Remove installed workflow?"), "remove confirmation");
  await click("Cancel");
  await waitFor(async () => !(await bodyIncludes("Remove installed workflow?")), "cancelled removal");
  assert(fs.existsSync(packFile), "Cancelling removal must keep the workflow file.");
  await clickCardButton("kirea-test-pack - flux-inpaint", "Remove");
  await waitFor(() => bodyIncludes("Remove installed workflow?"), "remove confirmation again");
  await click("Remove workflow");
  await waitFor(async () => !(await fileExists(packFile)), "workflow removal");
  await waitFor(async () => (await installedCardCount()) === 3, "installed list after removal");
  assert(fs.existsSync(installedFlux), "Removing one workflow must not delete the others.");
  assert(fs.existsSync(aurora) && fs.existsSync(auroraCopy), "Other installed workflows must remain.");
  notes.push("Removal required confirmation and deleted only the selected workflow");
}

async function verifyFilesystem() {
  await waitFor(
    () => listWorkflowFiles().length === 3,
    "the expected installed workflow file set"
  );
  const files = listWorkflowFiles();
  assert(
    JSON.stringify(files) ===
      JSON.stringify([
        "Flux Inpaint Detailer - v2.json",
        "aurora-upscale-1.json",
        "aurora-upscale.json",
      ]),
    `Unexpected workflow folder contents: ${JSON.stringify(files)}`
  );
  assert(
    !files.some((name) => /\.(png|py|sh|zip|part)$/i.test(name)),
    "The workflows folder must only contain installed workflow JSON files."
  );

  const ledger = JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8"));
  assert(Array.isArray(ledger), "The workflow ledger should contain records.");
  assert(ledger.length === 3, "The workflow ledger should track the three remaining installs.");
  const civitaiRecord = ledger.find(
    (record) => record.civitaiModelId === 7001 && record.civitaiVersionId === 7102
  );
  assert(civitaiRecord, "The ledger should preserve Civitai model/version identity.");
  assert(
    civitaiRecord.originalFileName === "flow.json",
    "The ledger should preserve the original Civitai filename."
  );

  const weights = findForbiddenWeights();
  assert(
    weights.length === 0,
    `Model weight files were downloaded unexpectedly: ${weights.join(", ")}`
  );
  const requests = JSON.parse(await requestLog());
  assert(
    !requests.some((url) => /\/api\/download\/models\//.test(url)),
    "Workflow browsing must never call Civitai's model download endpoint."
  );
  assert(
    !requests.some((url) => /\.(safetensors|ckpt|pt|pth)(\?|$)/i.test(url)),
    "Workflow browsing must never request model weights."
  );
  notes.push("No model weights were downloaded and the workflows folder only holds workflow JSON");
}

async function main() {
  fs.writeFileSync(LOG_PATH, "");
  seedProfile();
  log(`seeded isolated profile: ${PROFILE_DIR}`);

  child = spawn(
    ELECTRON,
    [
      `--inspect=${MAIN_PORT}`,
      `--remote-debugging-port=${RENDERER_PORT}`,
      `--user-data-dir=${PROFILE_DIR}`,
      ".",
    ],
    { cwd: ROOT, stdio: "ignore", detached: false }
  );
  process.on("exit", () => {
    try {
      child?.kill();
    } catch {
      // already exited
    }
  });

  const rendererTarget = await waitForRendererTarget();
  log(`renderer target: ${rendererTarget.url}`);
  const rendererSocket = await openWebSocket(rendererTarget.webSocketDebuggerUrl);
  renderer = connectCdp(rendererSocket);

  const previewBody = Buffer.from(PREVIEW_PNG, "base64").toString("base64");
  rendererSocket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id) return;
    if (message.method === "Runtime.exceptionThrown") {
      const detail = message.params.exceptionDetails;
      errors.push(
        `pageerror: ${detail.exception?.description ?? detail.text ?? "unknown"}`
      );
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      errors.push(
        `console.error: ${message.params.args
          .map((arg) => arg.value ?? arg.description ?? "")
          .join(" ")}`
      );
    }
    if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
      const entry = message.params.entry;
      if (isMissingLocalMedia(entry.url)) {
        notes.push("A seeded missing media file logged a resource error as expected");
        return;
      }
      errors.push(`log: ${entry.text}${entry.url ? ` <${entry.url}>` : ""}`);
    }
    if (message.method === "Fetch.requestPaused") {
      const { requestId, request } = message.params;
      const isPreview = String(request.url).startsWith("https://image.civitai.com/");
      const reply = isPreview
        ? {
            requestId,
            responseCode: 200,
            responseHeaders: [{ name: "Content-Type", value: "image/png" }],
            body: previewBody,
          }
        : { requestId };
      const method = isPreview ? "Fetch.fulfillRequest" : "Fetch.continueRequest";
      renderer.send(method, reply).catch(() => undefined);
    }
  });

  await renderer.send("Runtime.enable");
  await renderer.send("Log.enable");
  await renderer.send("Page.enable");
  await renderer.send("Fetch.enable", {
    patterns: [{ urlPattern: "https://image.civitai.com/*", requestStage: "Request" }],
  });

  mainCdp = connectCdp(await openWebSocket((await pollMainTarget()).webSocketDebuggerUrl));
  await mainCdp.send("Runtime.enable");
  const mockStatus = await mainCdp.evaluate(buildMockExpression());
  log(`main workflow/Civitai mock: ${mockStatus}`);

  await waitFor(() => evaluate("Boolean(window.kirea)"), "the preload bridge");
  const settings = await evaluate(
    `window.kirea.updateSettings(${JSON.stringify({
      runtimeMode: "managed",
      managedComfyPath: RUNTIME_DIR,
    })})`
  );
  assert(
    settings?.runtimeMode === "managed",
    "Could not point the app at the isolated managed ComfyUI runtime."
  );
  log(`installed workflows folder: ${WORKFLOWS_DIR}`);

  await waitFor(() => bodyIncludes("Kirea"), "initial UI");
  await waitFor(() => bodyIncludes("Library"), "sidebar navigation");

  await verifyLibrary();
  await verifyWorkflowBrowser();
  await verifyLocalImportAndManagement();
  await verifyFilesystem();

  log(`notes: ${notes.join(" | ")}`);
  if (errors.length > 0) {
    for (const error of errors) log(`ERROR ${error}`);
    fail(`${errors.length} console/page error(s) detected`);
  }
  log(
    "PASS: unified Library and Civitai workflow browser/import verified in the Electron app with no console errors"
  );
}

main()
  .then(async () => {
    await shutdown();
    await removeTempDir(PROFILE_DIR);
    await removeTempDir(RUNTIME_DIR);
    process.exit(0);
  })
  .catch(async (error) => {
    log(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
    await shutdown();
    await removeTempDir(PROFILE_DIR);
    await removeTempDir(RUNTIME_DIR);
    process.exit(1);
  });
