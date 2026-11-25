import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..");
const ELECTRON = path.join(ROOT, "node_modules", "electron", "dist", "electron.exe");
const PORT = 9465;
const PROFILE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-site-profile-"));
const ISOLATED_HOME = path.join(PROFILE_DIR, "home");
const DB_PATH = path.join(PROFILE_DIR, "kirea-studio.db");
const SHOTS_DIR = path.join(ROOT, "site", "assets", "shots");
const MANIFEST_PATH = path.join(SHOTS_DIR, "manifest.json");
const VIBE_DIR = path.join(ROOT, "vibe_images");
const VIEWPORT = { width: 1600, height: 940, deviceScaleFactor: 1 };
const SHOT_NAMES = Object.freeze([
  "home-dark",
  "create-dark",
  "models-dark",
  "workflows-dark",
  "explore-dark",
  "create-light",
  "home-light",
]);
const FIXTURE_SET = "curated-non-nsfw-v1";
const FIXTURE_BASE_TIME = Date.parse("2026-11-23T12:00:00.000Z");

// Public, tracked artwork only. No APPDATA database, model previews, or user output paths.
const FIXTURES = Object.freeze([
  {
    id: "img_featured_moss",
    jobId: "job_featured_moss",
    sourceFile: "kirea-v2-hero-living-world_1795024761463_bd01b793.png",
    fileName: "kirea-moss-hero-living-world.png",
    width: 2560,
    height: 1080,
    prompt:
      "masterpiece, best quality, 1girl, silver hair flowing, glowing amber eyes, intricate silk kimono, floating luminescent lanterns, ethereal night festival, highly detailed digital painting",
    negativePrompt: "blurry, lowres, watermark, artifacts, distorted anatomy",
    seed: 8492019,
    checkpoint: "Realism By Stable Yogi Moss V2.0 INT8-ConvRot C92.safetensors",
    loras: [{ name: "anime_outline_v1", strength: 0.75 }],
    workflowId: "t2i_moss_image",
    sampler: "euler",
    scheduler: "simple",
    steps: 28,
    cfg: 4.0,
    denoise: 1.0,
    mode: "txt2img",
    tags: ["moss-image", "featured", "anime"],
    offsetMinutes: 0,
    parentId: null,
  },
  {
    id: "img_featured_illustrious",
    jobId: "job_featured_illustrious",
    sourceFile: "kirea-v2-character-cast-armored_1795025403458_a1053ec0.png",
    fileName: "kirea-character-cast-armored.png",
    width: 1536,
    height: 1024,
    prompt:
      "masterpiece, ultra-detailed, cinematic lighting, 1girl, mechanical cyber armor, braided silver hair, glowing katana, neon city reflections, sharp focus",
    negativePrompt: "blurry, bad hands, low quality",
    seed: 4182903,
    checkpoint: "Animixy²",
    loras: [
      { name: "cyber_detail_v2", strength: 0.8 },
      { name: "mecha_accents", strength: 0.65 },
    ],
    workflowId: "t2i_illustrious_base",
    sampler: "dpmpp_2m",
    scheduler: "karras",
    steps: 26,
    cfg: 6.0,
    denoise: 1.0,
    mode: "txt2img",
    tags: ["illustrious", "cyberpunk", "featured"],
    offsetMinutes: 2,
    parentId: null,
  },
  {
    id: "img_featured_canvas",
    jobId: "job_featured_canvas",
    sourceFile: "kirea-v2-image-studio_1795024651902_d12e9f26.png",
    fileName: "kirea-image-studio-palette.png",
    width: 1024,
    height: 1280,
    prompt:
      "masterpiece, 1girl, studio artist with paint palette, glowing iridescent pigments, gentle sunlight, atelier workshop",
    negativePrompt: "low quality, distorted",
    seed: 7391024,
    checkpoint: "Animixy²",
    loras: [],
    workflowId: "i2i_sdxl_base",
    sampler: "euler_ancestral",
    scheduler: "karras",
    steps: 24,
    cfg: 5.5,
    denoise: 0.6,
    mode: "img2img",
    tags: ["inpaint", "atelier"],
    offsetMinutes: 4,
    parentId: "img_featured_illustrious",
  },
  {
    id: "img_featured_video",
    jobId: "job_featured_video",
    sourceFile: "kirea-v2-video-courier-clean_1795024966811_aecf664b.png",
    fileName: "kirea-video-courier-clean.png",
    width: 1536,
    height: 1024,
    prompt:
      "cinematic anime, aerial courier flying through cloud canyons, sunset rim light, wind streaks, 60fps",
    negativePrompt: "low framerate, jerky",
    seed: 5291840,
    checkpoint: "Animixy²",
    loras: [],
    workflowId: "t2v_wan21_1_3b",
    sampler: "euler",
    scheduler: "normal",
    steps: 30,
    cfg: 6.0,
    denoise: 1.0,
    mode: "t2v",
    tags: ["video", "wan2.1"],
    offsetMinutes: 6,
    parentId: null,
  },
  {
    id: "img_featured_pixel",
    jobId: "job_featured_pixel",
    sourceFile: "kirea-pixel-studio_1794920113787_30a0d825.png",
    fileName: "kirea-pixel-studio-greenhouse.png",
    width: 1024,
    height: 1024,
    prompt:
      "pixel art, 32-bit, retro rpg greenhouse rooftop, lush herbs, morning sun, terracotta tiles",
    negativePrompt: "blurry, smooth",
    seed: 3918274,
    checkpoint: "Animixy²",
    loras: [],
    workflowId: "t2i_illustrious_base",
    sampler: "euler",
    scheduler: "simple",
    steps: 20,
    cfg: 7.0,
    denoise: 1.0,
    mode: "txt2img",
    tags: ["pixel", "rpg"],
    offsetMinutes: 8,
    parentId: null,
  },
]);

let activeLaunch = null;

function assertFile(file, label) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new Error(`${label} is missing: ${file}`);
  }
}

function fixturePath(fixture) {
  return path.join(VIBE_DIR, fixture.sourceFile);
}

function fixtureTimestamp(fixture) {
  return new Date(FIXTURE_BASE_TIME - fixture.offsetMinutes * 60_000).toISOString();
}

async function validateFixtures() {
  const vibeRoot = fs.realpathSync(VIBE_DIR);
  for (const fixture of FIXTURES) {
    const file = fixturePath(fixture);
    assertFile(file, `Curated screenshot fixture ${fixture.fileName}`);
    const realFile = fs.realpathSync(file);
    const relative = path.relative(vibeRoot, realFile);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Curated screenshot fixture escapes vibe_images: ${fixture.sourceFile}`);
    }
    const metadata = await sharp(realFile).metadata();
    if (metadata.width !== fixture.width || metadata.height !== fixture.height) {
      throw new Error(
        `${fixture.sourceFile}: expected ${fixture.width}x${fixture.height}, got ${metadata.width}x${metadata.height}`
      );
    }
  }
}

function getProvenance() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const gitSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  const trackedChanges = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  return { appVersion: pkg.version, gitSha, workingTreeDirty: trackedChanges.length > 0 };
}

function buildIsolatedEnv() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VITE_DEV_SERVER_URL;
  const appData = path.join(PROFILE_DIR, "appdata");
  const temp = path.join(PROFILE_DIR, "temp");
  const shellFolders = ["Pictures", "Desktop", "Documents", "Downloads"].map((name) =>
    path.join(ISOLATED_HOME, name)
  );
  for (const dir of [ISOLATED_HOME, appData, temp, ...shellFolders]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  env.APPDATA = appData;
  env.LOCALAPPDATA = appData;
  env.USERPROFILE = ISOLATED_HOME;
  env.HOME = ISOLATED_HOME;
  env.TEMP = temp;
  env.TMP = temp;
  env.KIREA_DISABLE_UPDATES = "1";
  return env;
}

function launchApp(env) {
  const child = spawn(
    ELECTRON,
    [".", `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE_DIR}`],
    { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"], detached: false, windowsHide: true }
  );
  const launch = { child, error: null, output: "" };
  const capture = (chunk) => {
    launch.output = `${launch.output}${chunk.toString()}`.slice(-12000);
  };
  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);
  child.once("error", (error) => {
    launch.error = error;
  });
  activeLaunch = launch;
  return launch;
}

function waitForExit(child, timeoutMs = 10_000) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      child.off("exit", onExit);
      child.off("error", onError);
    };
    const onExit = () => {
      cleanup();
      resolve();
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for Electron to exit."));
    }, timeoutMs);
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

async function stopLaunch(launch) {
  if (!launch) return;
  if (launch.child.exitCode === null && launch.child.signalCode === null) {
    try {
      launch.child.kill();
    } catch {
      // Best-effort cleanup; the profile is temporary and isolated.
    }
  }
  try {
    await waitForExit(launch.child, 5_000);
  } catch {
    // Do not mask the original capture error with a cleanup timeout.
  }
  if (activeLaunch === launch) activeLaunch = null;
}

function cleanupProfile() {
  if (activeLaunch && activeLaunch.child.exitCode === null && activeLaunch.child.signalCode === null) {
    try {
      activeLaunch.child.kill();
    } catch {
      // Best-effort synchronous cleanup during process exit.
    }
  }
  try {
    fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
  } catch {
    // Windows may still be releasing a child-process handle during process exit.
  }
}
process.once("exit", cleanupProfile);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollTarget(launch, timeoutMs = 60_000) {
  const expectedUrl = pathToFileURL(path.join(ROOT, "dist", "index.html")).href;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (launch.error) throw launch.error;
    if (launch.child.exitCode !== null || launch.child.signalCode !== null) {
      throw new Error(`Electron exited before the renderer target appeared (code ${launch.child.exitCode}).${launch.output ? `\n${launch.output}` : ""}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`, {
        signal: AbortSignal.timeout(1_000),
      });
      const targets = await response.json();
      const target = targets.find(
        (item) => item.type === "page" && String(item.url).startsWith(expectedUrl)
      );
      if (target?.webSocketDebuggerUrl) return target;
    } catch {
      // The debugging endpoint may not be ready yet.
    }
    await sleep(250);
  }
  throw new Error("Timed out waiting for the built app renderer CDP target.");
}

function connectCdp(socket, getOutput = () => "") {
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
  socket.addEventListener("close", () => {
    for (const entry of pending.values()) {
      entry.reject(new Error(`CDP connection closed before a response arrived (${entry.method}).${getOutput() ? `\n${getOutput()}` : ""}`));
    }
    pending.clear();
  });
  return {
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, method });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    async evaluate(expression) {
      const result = await this.send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
        userGesture: true,
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
  };
}

async function openRenderer(env) {
  const launch = launchApp(env);
  let socket;
  try {
    const target = await pollTarget(launch);
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    const cdp = connectCdp(socket, () => launch.output);
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    return { launch, socket, cdp };
  } catch (error) {
    try {
      socket?.close();
    } catch {
      // Ignore cleanup errors.
    }
    await stopLaunch(launch);
    throw error;
  }
}

async function waitForSelector(cdp, selector, description, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cdp.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) return;
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${description} (${selector}).`);
}

async function assertSelectorCount(cdp, selector, expected, description) {
  const count = await cdp.evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
  if (count !== expected) {
    throw new Error(`${description}: expected ${expected} match(es) for ${selector}, found ${count}.`);
  }
}

async function assertImageLoaded(cdp, alt, description, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let result = { count: 0, loaded: 0 };
  while (Date.now() < deadline) {
    result = await cdp.evaluate(`(() => {
      const matches = Array.from(document.images).filter((img) => img.alt === ${JSON.stringify(alt)});
      if (matches.length === 1) matches[0].scrollIntoView({ block: "center", inline: "nearest" });
      return {
        count: matches.length,
        loaded: matches.filter((img) => img.complete && img.naturalWidth > 0).length,
      };
    })()`);
    if (result.count >= 1 && result.loaded >= 1) return;
    await sleep(200);
  }
  throw new Error(`${description}: expected a loaded image with alt ${JSON.stringify(alt)}, found ${result.count} match(es), ${result.loaded} loaded.`);
}

async function assertHeading(cdp, text) {
  const found = await cdp.evaluate(`Array.from(document.querySelectorAll("h1, h2"))
    .some((el) => (el.textContent || "").trim() === ${JSON.stringify(text)})`);
  if (!found) throw new Error(`Expected heading ${JSON.stringify(text)} was not rendered.`);
}

async function assertTextIncludes(cdp, text) {
  const found = await cdp.evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`);
  if (!found) throw new Error(`Expected visible text ${JSON.stringify(text)} was not rendered.`);
}

async function assertTabSelected(cdp, tablistLabel, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let selected;
  while (Date.now() < deadline) {
    selected = await cdp.evaluate(`(() => {
      const selector = '[role="tablist"][aria-label="' + ${JSON.stringify(tablistLabel)} + '"]';
      const tablist = document.querySelector(selector);
      return tablist?.querySelector('[role="tab"][aria-selected="true"]')?.textContent.trim() ?? null;
    })()`);
    if (selected === label) return;
    await sleep(200);
  }
  throw new Error(`Expected selected tab ${JSON.stringify(label)} in ${JSON.stringify(tablistLabel)}, found ${JSON.stringify(selected)}.`);
}

async function clickSelector(cdp, selector, description) {
  await assertSelectorCount(cdp, selector, 1, description);
  await cdp.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
}

async function clickByExactText(cdp, selector, text, description) {
  const result = await cdp.evaluate(`(() => {
    const matches = Array.from(document.querySelectorAll(${JSON.stringify(selector)}))
      .filter((el) => (el.textContent || "").trim() === ${JSON.stringify(text)});
    if (matches.length !== 1) return { ok: false, count: matches.length };
    matches[0].click();
    return { ok: true, count: 1 };
  })()`);
  if (!result.ok) {
    throw new Error(`${description}: expected one exact text match for ${JSON.stringify(text)}, found ${result.count}.`);
  }
}

async function clickByTextPrefix(cdp, selector, text, description) {
  const result = await cdp.evaluate(`(() => {
    const matches = Array.from(document.querySelectorAll(${JSON.stringify(selector)}))
      .filter((el) => (el.textContent || "").trim().startsWith(${JSON.stringify(text)}));
    if (matches.length !== 1) return { ok: false, count: matches.length };
    matches[0].click();
    return { ok: true, count: 1 };
  })()`);
  if (!result.ok) {
    throw new Error(`${description}: expected one text prefix match for ${JSON.stringify(text)}, found ${result.count}.`);
  }
}

async function clickFixtureHistoryCard(cdp, fixture) {
  await assertImageLoaded(cdp, fixture.fileName, "Curated history fixture");
  const result = await cdp.evaluate(`(() => {
    const image = Array.from(document.images).find((img) => img.alt === ${JSON.stringify(fixture.fileName)});
    const card = image?.closest("button");
    if (!card) return { ok: false, count: 0 };
    card.click();
    return { ok: true, count: 1 };
  })()`);
  if (!result.ok) throw new Error(`Curated history fixture ${fixture.fileName} is not inside a button.`);
  await waitForSelector(
    cdp,
    '[role="tablist"][aria-label="Results workspace view"] [role="tab"][aria-selected="true"]',
    "Canvas tab selection"
  );
  const selected = await cdp.evaluate(
    `document.querySelector('[role="tablist"][aria-label="Results workspace view"] [role="tab"][aria-selected="true"]')?.textContent.trim()`
  );
  if (selected !== "Canvas") throw new Error(`Expected Canvas tab after fixture selection, found ${JSON.stringify(selected)}.`);
  await assertImageLoaded(cdp, fixture.prompt, "Curated dominant canvas fixture");
}

async function navTo(cdp, label, heading) {
  await clickByExactText(
    cdp,
    'aside nav[aria-label="Primary workspace"] button',
    label,
    `Navigate to ${label}`
  );
  await waitForSelector(
    cdp,
    `aside nav[aria-label="Primary workspace"] button[aria-current="page"][aria-label="${label}"]`,
    `${label} navigation state`
  );
  await assertHeading(cdp, heading);
}

async function setTheme(cdp, theme) {
  const current = await cdp.evaluate(`document.documentElement.getAttribute("data-theme")`);
  if (current === theme) return;
  if (current !== "dark" && current !== "light") {
    throw new Error(`Unexpected current theme ${JSON.stringify(current)}.`);
  }
  await clickSelector(
    cdp,
    `aside button[aria-label^="Theme: ${current}."]`,
    `Switch from ${current} to ${theme} theme`
  );
  await waitForSelector(cdp, `html[data-theme="${theme}"]`, `${theme} theme`);
}

async function initializeSchemaThroughApp(env) {
  const { launch, socket, cdp } = await openRenderer(env);
  try {
    await waitForSelector(
      cdp,
      'aside nav[aria-label="Primary workspace"] button[aria-current="page"]',
      "app shell during schema initialization"
    );
    try {
      await cdp.send("Browser.close");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("CDP connection closed")) throw error;
    }
    await waitForExit(launch.child);
  } finally {
    try {
      socket.close();
    } catch {
      // Ignore cleanup errors.
    }
    await stopLaunch(launch);
  }
  assertFile(DB_PATH, "App-initialized temporary database");
}

function assertSchema(db) {
  const requiredTables = new Set(["schema_migrations", "settings", "generation_jobs", "generated_images"]);
  const tables = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name)
  );
  for (const table of requiredTables) {
    if (!tables.has(table)) throw new Error(`App lifecycle did not initialize required table ${table}.`);
  }
  const requiredImageColumns = [
    "id", "job_id", "file_path", "file_name", "format", "width", "height", "size_bytes",
    "prompt", "negative_prompt", "seed", "checkpoint", "loras_json", "workflow_id",
    "sampler", "scheduler", "steps", "cfg", "denoise", "mode", "favorite", "tags_json",
    "collection_id", "created_at", "character_id", "lora_recipe_id", "story_id",
    "story_scene_id", "parent_image_id",
  ];
  const imageColumns = new Set(db.prepare("PRAGMA table_info(generated_images)").all().map((row) => row.name));
  for (const column of requiredImageColumns) {
    if (!imageColumns.has(column)) throw new Error(`App-initialized generated_images schema is missing ${column}.`);
  }
  const migrations = db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get().count;
  if (migrations === 0) throw new Error("App lifecycle did not record any schema migrations.");
}

function seedCuratedFixtures() {
  const db = new Database(DB_PATH);
  try {
    assertSchema(db);
    db.pragma("foreign_keys = OFF");
    const preservedTables = new Set(["schema_migrations", "settings", "workflows"]);
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    ).all();
    const clear = db.transaction(() => {
      for (const { name } of tables) {
        if (preservedTables.has(name)) continue;
        db.exec(`DELETE FROM "${name.replace(/"/g, '""')}"`);
      }
    });
    clear();

    const settings = {
      theme: "dark",
      startupPage: "home",
      runtimeMode: "external",
      externalComfyPath: path.join(PROFILE_DIR, "empty-comfy"),
      managedComfyPath: path.join(PROFILE_DIR, "empty-managed-comfy"),
      outputDirectory: VIBE_DIR,
      downloadDirectory: path.join(PROFILE_DIR, "downloads"),
      cacheDirectory: path.join(PROFILE_DIR, "cache"),
      tempDirectory: path.join(PROFILE_DIR, "temp"),
      extraModelDirs: [],
      autoStartRuntime: false,
      checkUpdatesAutomatically: false,
      nsfwFilter: true,
    };
    const now = fixtureTimestamp(FIXTURES[0]);
    db.prepare(
      `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
    ).run("app_settings", JSON.stringify(settings), now);

    const insertJob = db.prepare(
      `INSERT INTO generation_jobs (
        id, prompt_id, status, error_kind, error_message, prompt, negative_prompt,
        checkpoint, workflow_id, workflow_version, mode, settings_json,
        progress_step, progress_max, current_node, output_paths_json,
        submitted_at, started_at, completed_at, batch_index, batch_total,
        character_id, lora_recipe_id, story_id, story_scene_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertImage = db.prepare(
      `INSERT INTO generated_images (
        id, job_id, file_path, file_name, format, width, height, size_bytes,
        prompt, negative_prompt, seed, checkpoint, loras_json, workflow_id,
        sampler, scheduler, steps, cfg, denoise, mode, favorite, tags_json,
        collection_id, created_at, character_id, lora_recipe_id, story_id,
        story_scene_id, parent_image_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const seed = db.transaction(() => {
      for (const fixture of FIXTURES) {
        const filePath = fixturePath(fixture);
        const timestamp = fixtureTimestamp(fixture);
        const parent = fixture.parentId
          ? FIXTURES.find((item) => item.id === fixture.parentId)
          : null;
        if (fixture.parentId && !parent) throw new Error(`Unknown fixture parent ${fixture.parentId}.`);
        const settingsJson = {
          prompt: fixture.prompt,
          negativePrompt: fixture.negativePrompt,
          checkpoint: fixture.checkpoint,
          workflowId: fixture.workflowId,
          mode: fixture.mode,
          width: fixture.width,
          height: fixture.height,
          seed: fixture.seed,
          steps: fixture.steps,
          cfg: fixture.cfg,
          denoise: fixture.denoise,
          sampler: fixture.sampler,
          scheduler: fixture.scheduler,
          loras: fixture.loras,
          batchSize: 1,
          outputFormat: "png",
          inputImagePath: parent ? fixturePath(parent) : null,
        };
        insertJob.run(
          fixture.jobId, null, "COMPLETED", "NONE", null, fixture.prompt,
          fixture.negativePrompt, fixture.checkpoint, fixture.workflowId, "1.0.0",
          fixture.mode, JSON.stringify(settingsJson), fixture.steps, fixture.steps, null,
          JSON.stringify([filePath]), timestamp, timestamp, timestamp, 1, 1,
          null, null, null, null
        );
        insertImage.run(
          fixture.id, fixture.jobId, filePath, fixture.fileName, "png", fixture.width,
          fixture.height, fs.statSync(filePath).size, fixture.prompt, fixture.negativePrompt,
          fixture.seed, fixture.checkpoint, JSON.stringify(fixture.loras), fixture.workflowId,
          fixture.sampler, fixture.scheduler, fixture.steps, fixture.cfg, fixture.denoise,
          fixture.mode, 1, JSON.stringify(fixture.tags), null, timestamp, null, null, null,
          null, fixture.parentId
        );
      }
    });
    seed();

    const imageCount = db.prepare("SELECT COUNT(*) AS count FROM generated_images").get().count;
    const jobCount = db.prepare("SELECT COUNT(*) AS count FROM generation_jobs").get().count;
    const modelCount = db.prepare("SELECT COUNT(*) AS count FROM models").get().count;
    if (imageCount !== FIXTURES.length || jobCount !== FIXTURES.length || modelCount !== 0) {
      throw new Error(`Unexpected seeded profile contents: ${imageCount} images, ${jobCount} jobs, ${modelCount} models.`);
    }
    db.pragma("wal_checkpoint(TRUNCATE)");
  } finally {
    db.close();
  }
  console.log(`[shots] Seeded ${FIXTURES.length} curated non-NSFW fixtures in the temporary profile.`);
}

async function saveShot(cdp, name, provenance) {
  if (!SHOT_NAMES.includes(name)) throw new Error(`Unexpected screenshot target ${name}.`);
  const shot = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
    clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height, scale: 1 },
  });
  const raw = Buffer.from(shot.data, "base64");
  const rawMetadata = await sharp(raw).metadata();
  if (rawMetadata.width !== VIEWPORT.width || rawMetadata.height !== VIEWPORT.height) {
    throw new Error(`${name}: captured ${rawMetadata.width}x${rawMetadata.height}, expected ${VIEWPORT.width}x${VIEWPORT.height}.`);
  }
  const outPath = path.join(SHOTS_DIR, `${name}.webp`);
  await sharp(raw)
    .resize(VIEWPORT.width, VIEWPORT.height, { fit: "fill" })
    .webp({ quality: 90, effort: 6 })
    .toFile(outPath);
  const outputMetadata = await sharp(outPath).metadata();
  if (outputMetadata.width !== VIEWPORT.width || outputMetadata.height !== VIEWPORT.height) {
    throw new Error(`${name}: output dimensions are not ${VIEWPORT.width}x${VIEWPORT.height}.`);
  }
  console.log(`[shots] Saved ${name}.webp from app v${provenance.appVersion} (${VIEWPORT.width}x${VIEWPORT.height}).`);
}

async function captureShots(env, provenance) {
  const { launch, socket, cdp } = await openRenderer(env);
  try {
    await cdp.send("Emulation.setDeviceMetricsOverride", { ...VIEWPORT, mobile: false });
    await waitForSelector(
      cdp,
      'aside nav[aria-label="Primary workspace"] button[aria-current="page"]',
      "seeded app shell"
    );
    await waitForSelector(cdp, 'html[data-theme="dark"]', "deterministic dark theme");

    await navTo(cdp, "Home", "Create something worth keeping.");
    await assertImageLoaded(cdp, FIXTURES[0].prompt, "Home recent creations");
    await saveShot(cdp, "home-dark", provenance);

    await navTo(cdp, "Create", "Create");
    await clickByExactText(
      cdp,
      '[role="tablist"][aria-label="Create workspace mode"] [role="tab"]',
      "Advanced",
      "Create Advanced mode"
    );
    await assertTabSelected(cdp, "Create workspace mode", "Advanced");
    const promptSelector = 'textarea[placeholder^="Describe your scene, characters, lighting, framing"]';
    await assertSelectorCount(cdp, promptSelector, 1, "Create prompt composer");
    await cdp.evaluate(`(() => {
      const textarea = document.querySelector(${JSON.stringify(promptSelector)});
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      setter.call(textarea, ${JSON.stringify(FIXTURES[0].prompt)});
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await clickByExactText(
      cdp,
      '[role="tablist"][aria-label="Results workspace view"] [role="tab"]',
      "History",
      "Create history"
    );
    await clickFixtureHistoryCard(cdp, FIXTURES[0]);
    await saveShot(cdp, "create-dark", provenance);

    await navTo(cdp, "Models", "Model Vault & Civitai Hub");
    await clickByTextPrefix(cdp, "button", "Curated Download Catalog (", "Curated model catalog");
    await assertTextIncludes(cdp, "MOSS-Image");
    await saveShot(cdp, "models-dark", provenance);

    await navTo(cdp, "Workflows", "Workflows");
    await assertTextIncludes(cdp, "MOSS-Image (Qwen3.5-9B + FLUX.2 VAE)");
    await assertTextIncludes(cdp, "Illustrious Text-to-Image");
    await saveShot(cdp, "workflows-dark", provenance);

    await navTo(cdp, "Explore", "Starter Presets & Prompt Library");
    await saveShot(cdp, "explore-dark", provenance);

    await setTheme(cdp, "light");
    await navTo(cdp, "Create", "Create");
    await clickByExactText(
      cdp,
      '[role="tablist"][aria-label="Create workspace mode"] [role="tab"]',
      "Advanced",
      "Light Create Advanced mode"
    );
    await assertTabSelected(cdp, "Create workspace mode", "Advanced");
    await clickByExactText(
      cdp,
      '[role="tablist"][aria-label="Results workspace view"] [role="tab"]',
      "History",
      "Light Create history"
    );
    await clickFixtureHistoryCard(cdp, FIXTURES[0]);
    await assertImageLoaded(cdp, FIXTURES[0].prompt, "Light Create canvas");
    await saveShot(cdp, "create-light", provenance);

    await navTo(cdp, "Home", "Create something worth keeping.");
    await assertImageLoaded(cdp, FIXTURES[0].prompt, "Light Home recent creations");
    await saveShot(cdp, "home-light", provenance);

    await setTheme(cdp, "dark");
  } finally {
    try {
      socket.close();
    } catch {
      // Ignore cleanup errors.
    }
    await stopLaunch(launch);
  }

  for (const name of SHOT_NAMES) assertFile(path.join(SHOTS_DIR, `${name}.webp`), `Screenshot ${name}`);
  const manifest = {
    schemaVersion: 1,
    appVersion: provenance.appVersion,
    gitSha: provenance.gitSha,
    workingTreeDirty: provenance.workingTreeDirty,
    fixtureSet: FIXTURE_SET,
    profile: "ephemeral-user-data",
    viewport: VIEWPORT,
    screenshots: SHOT_NAMES.map((name) => ({ file: `${name}.webp`, width: VIEWPORT.width, height: VIEWPORT.height })),
  };
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`[shots] Wrote ${path.relative(ROOT, MANIFEST_PATH)} for v${provenance.appVersion} at ${provenance.gitSha}.`);
}

async function main() {
  try {
    assertFile(ELECTRON, "Electron executable");
    assertFile(path.join(ROOT, "dist", "index.html"), "Built renderer");
    assertFile(path.join(ROOT, "dist-electron", "main", "index.js"), "Built main process");
    const provenance = getProvenance();
    await validateFixtures();
    fs.mkdirSync(SHOTS_DIR, { recursive: true });
    const env = buildIsolatedEnv();

    console.log("[shots] Initializing a fresh temporary profile through the app lifecycle...");
    await initializeSchemaThroughApp(env);
    seedCuratedFixtures();
    await captureShots(env, provenance);
    console.log("[shots] Successfully captured all seven deterministic app screenshots.");
  } finally {
    cleanupProfile();
  }
}

main().catch((error) => {
  console.error("[shots] Error:", error);
  process.exitCode = 1;
});
