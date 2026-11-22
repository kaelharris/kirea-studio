import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import {
  CivitaiClient,
} from "../dist-electron/main/civitai/civitai-client.js";
import {
  CivitaiDownloadManager,
  resolveCivitaiModelsRoot,
  resolveCivitaiTargetPath,
} from "../dist-electron/main/civitai/download-manager.js";
import { ModelScanner } from "../dist-electron/main/models/model-scanner.js";

const USER_AGENT = "KireaStudio/1.0.1 verification";
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-civitai-verify-"));
const REAL_COMFY = path.join(ROOT, "real-comfy");
const REAL_MODELS = path.join(REAL_COMFY, "ComfyUI", "models");
const REAL_MANAGED = path.join(ROOT, "real-managed-models");
const LOCAL_COMFY = path.join(ROOT, "local-comfy");
const LOCAL_MODELS = path.join(LOCAL_COMFY, "ComfyUI", "models");
const LOCAL_MANAGED = path.join(ROOT, "local-managed-models");
const PREVIEWS = path.join(ROOT, "previews");
const APPDATA = path.join(ROOT, "appdata");

for (const dir of [REAL_MODELS, REAL_MANAGED, LOCAL_MODELS, LOCAL_MANAGED, PREVIEWS, APPDATA]) {
  fs.mkdirSync(dir, { recursive: true });
}
for (const folder of ["checkpoints", "loras", "vae", "upscale_models"]) {
  fs.mkdirSync(path.join(REAL_MODELS, folder), { recursive: true });
  fs.mkdirSync(path.join(LOCAL_MODELS, folder), { recursive: true });
}
process.env.APPDATA = APPDATA;

const checks = [];
const failures = [];
const notes = [];
const downloads = [];

function check(name, condition, detail = "") {
  const ok = Boolean(condition);
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push({ name, detail });
  return ok;
}

function note(message) {
  notes.push(message);
  console.log(`NOTE  ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function makeSettings(comfyRoot) {
  return {
    runtimeMode: "external",
    externalComfyPath: comfyRoot,
    comfyHost: "127.0.0.1",
    comfyPort: 8188,
    pixelBackendHost: "127.0.0.1",
    pixelBackendPort: 8189,
    pixelBackendWorkflowRoot: "",
    managedComfyPath: "",
    autoStartRuntime: false,
    outputDirectory: path.join(ROOT, "outputs"),
    extraModelDirs: [],
    downloadDirectory: path.join(ROOT, "downloads"),
    cacheDirectory: path.join(ROOT, "cache"),
    tempDirectory: path.join(ROOT, "tmp"),
    performanceProfile: "balanced",
    maxActiveJobs: 1,
    defaultBatchSize: 1,
    enableMemoryWarnings: false,
    theme: "dark",
    galleryLayout: "comfortable",
    startupPage: "home",
    defaultSampler: "euler",
    defaultScheduler: "normal",
    defaultSteps: 20,
    defaultCfg: 7,
    defaultOutputFormat: "png",
    checkUpdatesAutomatically: false,
    nsfwFilter: true,
    civitaiApiKeySet: false,
  };
}

const realSettings = makeSettings(REAL_COMFY);
const localSettings = makeSettings(LOCAL_COMFY);

function makeVersion({
  id,
  fileName,
  downloadUrl,
  sizeBytes,
  sha256 = null,
  architecture = "sd15",
  baseModel = "SD 1.5",
  type = "LORA",
}) {
  return {
    id,
    name: `ver-${id}`,
    baseModel,
    architecture,
    availability: "Public",
    fileName,
    downloadUrl,
    downloadable: true,
    sizeBytes,
    sha256,
    trainedWords: [],
    releaseNotes: null,
    primaryPreviewUrl: null,
    sampleImageUrls: [],
    publishedAt: null,
    installed: false,
    type,
  };
}

function makeModel({ id, name, type, version }) {
  return {
    id,
    name,
    creator: "local-verifier",
    type,
    nsfw: false,
    description: null,
    tags: [],
    stats: { downloads: 0, thumbsUp: 0, rating: 0 },
    versions: [version],
    primaryPreviewUrl: null,
    installed: false,
  };
}

function createPayloadServer(payload, options = {}) {
  const { redirectTo = null, requireBearer = null, chunkSize = 16 * 1024, delayMs = 12 } = options;
  const requests = [];
  const server = http.createServer((req, res) => {
    void (async () => {
      requests.push({
        path: req.url,
        authorization: req.headers.authorization ?? null,
        range: req.headers.range ?? null,
      });

      if (requireBearer && req.headers.authorization !== `Bearer ${requireBearer}`) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "local verifier requires the bearer token" }));
        return;
      }
      if (req.url === "/403") {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "local gated file" }));
        return;
      }
      if (req.url === "/404") {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "local missing file" }));
        return;
      }
      if (req.url === "/429") {
        res.writeHead(429, { "Content-Type": "text/plain" });
        res.end("slow down");
        return;
      }
      if (req.url === "/401") {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "local unauthorized file" }));
        return;
      }
      if (req.url === "/redirect" && redirectTo) {
        res.writeHead(302, { Location: redirectTo });
        res.end();
        return;
      }

      const total = payload.length;
      let start = 0;
      let end = total - 1;
      let partial = false;
      const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
      if (match) {
        start = Number(match[1]);
        end = match[2] ? Math.min(Number(match[2]), total - 1) : total - 1;
        partial = true;
      }
      if (start >= total) {
        res.writeHead(416, { "Content-Range": `bytes */${total}` });
        res.end();
        return;
      }

      res.writeHead(partial ? 206 : 200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(end - start + 1),
        ...(partial ? { "Content-Range": `bytes ${start}-${end}/${total}` } : {}),
      });

      for (let offset = start; offset <= end; offset += chunkSize) {
        if (res.destroyed || res.writableEnded) return;
        try {
          res.write(payload.subarray(offset, Math.min(offset + chunkSize, end + 1)));
        } catch {
          return;
        }
        if (delayMs > 0) await sleep(delayMs);
      }
      res.end();
    })().catch((err) => {
      try {
        res.destroy(err);
      } catch {
        // already gone
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      server.unref();
      const { port } = server.address();
      resolve({
        base: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

function trackTask(manager, taskId) {
  const events = [];
  const listener = (task) => {
    if (task.id === taskId) events.push({ ...task });
  };
  manager.on("progress", listener);
  return {
    events,
    stop: () => manager.off("progress", listener),
  };
}

async function waitFor(predicate, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function settle(manager, task) {
  if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") {
    return task;
  }
  return (await manager.waitForTask(task.id)) ?? manager.getTask(task.id);
}

function sidecarPathFor(targetPath) {
  return `${targetPath.replace(/\.[^.]+$/, "")}.civitai.info`;
}

function previewFilesFor(targetPath) {
  const base = targetPath.replace(/\.[^.]+$/, "");
  return [".preview.png", ".preview.jpg", ".preview.jpeg", ".preview.webp"]
    .map((ext) => `${base}${ext}`)
    .filter((candidate) => fs.existsSync(candidate));
}

function expectedTarget(modelsRoot, type, architecture, fileName) {
  return resolveCivitaiTargetPath(modelsRoot, type, architecture, fileName);
}

function pickSmallestModelFile(rawVersion) {
  const files = (rawVersion.files ?? []).filter(
    (file) =>
      /\.(safetensors|ckpt|pt|pth|bin|gguf)$/i.test(file.name ?? "") &&
      !/vae|clip|config|text.?encoder|training/i.test(file.name ?? "")
  );
  return (
    files.find((file) => file.primary === true) ??
    files.find((file) => (file.type ?? "").toLowerCase() !== "vae") ??
    files[0] ??
    null
  );
}

const REAL_TARGETS = [
  {
    category: "LORA",
    scannerCategory: "lora",
    type: "LORA",
    query: "Clothing Adjuster",
    file: "ClothingAdjuster3.safetensors",
    fallbackModelId: 88132,
    fallbackVersionId: 117151,
  },
  {
    category: "Checkpoint",
    scannerCategory: "checkpoint",
    type: "Checkpoint",
    query: "FilmGirl",
    file: "FilmProvia2.safetensors",
    fallbackModelId: 33208,
    fallbackVersionId: 75069,
  },
  {
    category: "VAE",
    scannerCategory: "vae",
    type: "VAE",
    query: "customVAE",
    file: "Q6.safetensors",
    fallbackModelId: 79699,
    fallbackVersionId: 104041,
  },
  {
    category: "Upscaler",
    scannerCategory: "upscale",
    type: "Upscaler",
    query: "RealESRGAN x4plus anime",
    file: "RealESRGAN_x4plus_anime_6B.safetensors",
    fallbackModelId: 2341949,
    fallbackVersionId: 2634279,
  },
];

async function main() {
  console.log(`Civitai verification workspace: ${ROOT}`);
  console.log(`Real models root: ${REAL_MODELS}`);
  console.log(`Local models root: ${LOCAL_MODELS}`);

  const client = new CivitaiClient({ getApiKey: () => null });
  const scanner = new ModelScanner();

  const connection = await client.testConnection();
  check(
    "anonymous Civitai connectivity",
    connection.ok && connection.authenticated === false,
    connection.message
  );

  const pageOne = await client.searchModels({ type: "LORA", limit: 2, sort: "Most Downloaded" });
  check(
    "search returns Civitai LORA results",
    pageOne.items.length > 0 && pageOne.items.every((item) => item.type === "LORA"),
    `${pageOne.items.length} items, cursor=${pageOne.nextCursor ? "present" : "missing"}`
  );
  if (pageOne.nextCursor) {
    const pageTwo = await client.searchModels({
      type: "LORA",
      limit: 2,
      sort: "Most Downloaded",
      cursor: pageOne.nextCursor,
    });
    const idsOne = new Set(pageOne.items.map((item) => item.id));
    check(
      "cursor pagination returns a non-overlapping next page",
      pageTwo.items.length > 0 && pageTwo.items.every((item) => !idsOne.has(item.id)),
      `${pageTwo.items.length} items on page 2`
    );
  } else {
    check("cursor pagination returns a next cursor", false, "Civitai returned no nextCursor");
  }

  const vaeDetails = await client.getModelDetails(79699);
  const selectedVae = vaeDetails.versions.find((version) => version.id === 104041);
  check(
    "model details expose the selected version among many versions",
    Boolean(selectedVae) &&
      selectedVae.fileName === "Q6.safetensors" &&
      selectedVae.architecture === "sd15" &&
      selectedVae.downloadable,
    selectedVae
      ? `${selectedVae.name} / ${selectedVae.fileName} / ${selectedVae.architecture}`
      : "version 698548 not returned"
  );

  const rawPonyResponse = await fetch("https://civitai.com/api/v1/models/257749", {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
  });
  if (rawPonyResponse.ok) {
    const rawPony = await rawPonyResponse.json();
    const rawVersion = (rawPony.modelVersions ?? []).find((version) =>
      (version.files ?? []).some((file) => (file.type ?? "").toLowerCase() === "vae")
    );
    if (rawVersion) {
      const ponyDetails = await client.getModelDetails(257749);
      const mappedVersion = ponyDetails.versions.find((version) => version.id === rawVersion.id);
      const expectedFile = pickSmallestModelFile(rawVersion);
      check(
        "primary model file is selected over bundled VAE/config files",
        Boolean(mappedVersion && expectedFile) &&
          mappedVersion.fileName === expectedFile.name &&
          !/vae/i.test(mappedVersion.fileName),
        mappedVersion && expectedFile
          ? `chose ${mappedVersion.fileName} from ${(rawVersion.files ?? []).length} files`
          : "no multi-file version found"
      );
      check(
        "download URL follows the selected file",
        Boolean(mappedVersion && expectedFile) &&
          (expectedFile.downloadUrl
            ? mappedVersion.downloadUrl === expectedFile.downloadUrl
            : mappedVersion.downloadUrl.includes(`/models/${mappedVersion.id}`)),
        mappedVersion?.downloadUrl ?? "missing"
      );
    } else {
      note("Pony model 290640 no longer exposes a bundled VAE file; multi-file live check skipped");
    }
  } else {
    note(`Could not load Pony multi-file metadata (HTTP ${rawPonyResponse.status})`);
  }

  const fetchLog = [];
  const trackingFetch = async (input, init = {}) => {
    const headers = init.headers ?? {};
    fetchLog.push({
      url: String(input),
      authorization:
        typeof headers === "object" && !Array.isArray(headers)
          ? Boolean(headers.Authorization)
          : false,
      range:
        typeof headers === "object" && !Array.isArray(headers)
          ? headers.Range ?? null
          : null,
    });
    return fetch(input, init);
  };

  const realManager = new CivitaiDownloadManager({
    previewCacheDir: PREVIEWS,
    fetcher: trackingFetch,
  });

  const resolved = [];
  for (const target of REAL_TARGETS) {
    let candidate = null;
    let via = "search";
    try {
      const search = await client.searchModels({
        query: target.query,
        type: target.type,
        limit: 20,
        sort: "Most Downloaded",
      });
      for (const model of search.items) {
        const version = model.versions.find(
          (entry) =>
            entry.fileName.toLowerCase() === target.file.toLowerCase() && entry.downloadable
        );
        if (version) {
          candidate = { model, version };
          break;
        }
      }
    } catch (err) {
      note(`${target.category} search failed: ${err.message}`);
    }
    if (!candidate) {
      via = "details";
      try {
        const details = await client.getModelDetails(target.fallbackModelId);
        const version =
          details.versions.find((entry) => entry.id === target.fallbackVersionId) ??
          details.versions.find(
            (entry) => entry.fileName.toLowerCase() === target.file.toLowerCase()
          );
        if (version) candidate = { model: details, version };
      } catch (err) {
        note(`${target.category} details fallback failed: ${err.message}`);
      }
    }
    if (!candidate) {
      check(`${target.category} test candidate resolves from Civitai`, false, target.file);
      continue;
    }
    check(
      `${target.category} test candidate resolves from Civitai`,
      candidate.version.downloadable && /^https:\/\//.test(candidate.version.downloadUrl),
      `${candidate.model.name} / ${candidate.version.name} / ${candidate.version.fileName} (${via})`
    );
    resolved.push({ target, ...candidate });
  }

  for (const { target, model, version } of resolved) {
    const expected = expectedTarget(
      REAL_MODELS,
      target.type,
      version.architecture,
      version.fileName
    );
    console.log(
      `\nDownloading ${target.category}: ${model.name} / ${version.name} (${version.fileName}, ${(
        version.sizeBytes / (1024 * 1024)
      ).toFixed(1)} MB)`
    );
    const eventsBefore = fetchLog.length;
    const tracker = trackTask(realManager, `civitai_${version.id}`);
    const startedAt = Date.now();
    let task;
    try {
      task = realManager.start({
        model,
        version,
        apiKey: null,
        settings: realSettings,
        managedModelsDir: REAL_MANAGED,
      });
      task = await settle(realManager, task);
    } catch (err) {
      tracker.stop();
      check(`${target.category} download completes`, false, err.message);
      continue;
    }
    tracker.stop();
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

    if (task.status !== "completed") {
      check(`${target.category} download completes`, false, task.error ?? task.status);
      continue;
    }
    check(`${target.category} download completes`, true, `${elapsed}s`);
    check(
      `${target.category} installs into the expected category directory`,
      path.resolve(task.targetPath) === path.resolve(expected),
      task.targetPath
    );
    check(
      `${target.category} final file exists without a .part leftover`,
      fs.existsSync(task.targetPath) && !fs.existsSync(`${task.targetPath}.part`)
    );
    const size = fs.statSync(task.targetPath).size;
    check(
      `${target.category} final size matches the server-resolved size`,
      size === task.downloadedBytes && size === task.totalBytes && size > 0,
      `${size} bytes`
    );
    check(
      `${target.category} reported size is close to Civitai metadata`,
      version.sizeBytes === 0 || Math.abs(size - version.sizeBytes) <= 4096,
      `file=${size}, metadata=${version.sizeBytes}`
    );
    const actualSha = await sha256File(task.targetPath);
    check(
      `${target.category} SHA-256 matches Civitai metadata`,
      Boolean(version.sha256) && actualSha === version.sha256.toLowerCase(),
      version.sha256 ? actualSha.slice(0, 16) + "…" : "Civitai did not provide a SHA-256"
    );

    const sidecarPath = sidecarPathFor(task.targetPath);
    let sidecar = null;
    try {
      sidecar = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));
    } catch {
      sidecar = null;
    }
    check(
      `${target.category} writes a Civitai sidecar`,
      Boolean(sidecar) &&
        sidecar.source === "civitai" &&
        sidecar.modelId === model.id &&
        sidecar.modelVersionId === version.id &&
        sidecar.modelName === model.name,
      sidecarPath
    );
    check(
      `${target.category} sidecar records the verified SHA-256`,
      Boolean(sidecar && version.sha256 && sidecar.sha256?.toLowerCase() === version.sha256.toLowerCase())
    );

    const previewFiles = previewFilesFor(task.targetPath);
    if (previewFiles.length > 0) {
      check(
        `${target.category} caches a preview next to the model`,
        previewFiles.every((file) => fs.statSync(file).size > 0),
        previewFiles.map((file) => path.basename(file)).join(", ")
      );
    } else if (version.primaryPreviewUrl) {
      note(`${target.category} preview was not downloadable anonymously (model file is unaffected)`);
    }

    const statuses = new Set(tracker.events.map((event) => event.status));
    const progressPoints = new Set(tracker.events.map((event) => event.downloadedBytes)).size;
    check(
      `${target.category} progress events report real byte movement`,
      statuses.has("downloading") && statuses.has("completed") && progressPoints >= 2,
      `${tracker.events.length} events, ${progressPoints} byte positions`
    );

    const logForTask = fetchLog.slice(eventsBefore);
    const downloadHops = logForTask.filter((entry) => entry.url.includes("/api/download/models/"));
    check(
      `${target.category} download URL handling used HTTPS with no stored key`,
      downloadHops.length > 0 &&
        downloadHops.every((entry) => entry.url.startsWith("https://") && !entry.authorization),
      downloadHops.map((entry) => new URL(entry.url).host).join(" -> ")
    );

    downloads.push({ target, model, version, task, sidecar, actualSha, expected, previewFiles });
    await sleep(250);
  }

  const scannerRecords = await scanner.scanAll(realSettings, REAL_MANAGED);
  for (const entry of downloads) {
    const record = scannerRecords.find(
      (candidate) => path.resolve(candidate.filePath) === path.resolve(entry.task.targetPath)
    );
    check(
      `${entry.target.category} scanner recognizes the downloaded model`,
      Boolean(record) && record.category === entry.target.scannerCategory &&
        record.installed && !record.isIncomplete,
      record
        ? `${record.category} / ${record.architecture} / ${record.sizeBytes} bytes`
        : "not found"
    );
    if (record) {
      check(
        `${entry.target.category} scanner reads sidecar metadata`,
        Boolean(record.discovery?.baseModel) && record.description !== null,
        `${record.discovery?.baseModel ?? "no base model"} / ${record.discovery?.previewPath ?? "no preview"}`
      );
      if (entry.previewFiles.length > 0) {
        check(
          `${entry.target.category} scanner links the adjacent preview`,
          Boolean(record.discovery?.previewPath) &&
            fs.existsSync(record.discovery.previewPath),
          record.discovery?.previewPath ?? "no preview"
        );
      }
      check(
        `${entry.target.category} scanner reports real bytes`,
        record.sizeBytes === entry.task.downloadedBytes,
        `${record.sizeBytes}`
      );
    }
  }

  if (downloads.length > 0) {
    const source = downloads[0];
    const duplicatePath = path.join(
      path.dirname(source.task.targetPath),
      "dup-check",
      path.basename(source.task.targetPath)
    );
    fs.mkdirSync(path.dirname(duplicatePath), { recursive: true });
    fs.copyFileSync(source.task.targetPath, duplicatePath);
    const duplicateRecords = await scanner.scanAll(realSettings, REAL_MANAGED);
    const duplicateGroup = duplicateRecords.filter(
      (record) =>
        record.category === source.target.scannerCategory &&
        path.basename(record.filePath).toLowerCase() ===
          path.basename(source.task.targetPath).toLowerCase() &&
        record.sizeBytes === source.task.downloadedBytes
    );
    check(
      "scanner detects duplicate model files by category, basename, and size",
      duplicateGroup.length === 2 && duplicateGroup.some((record) => record.isDuplicate),
      duplicateGroup.map((record) => `${path.basename(path.dirname(record.filePath))}:${record.isDuplicate}`).join(", ")
    );
    fs.rmSync(path.dirname(duplicatePath), { recursive: true, force: true });
  }

  const detailsAfter = await client.getModelDetails(79699, scannerRecords);
  const installedVae = detailsAfter.versions.find((version) => version.id === 104041);
  check(
    "Civitai Hub marks a downloaded version as Installed using scanned models",
    Boolean(installedVae?.installed),
    installedVae?.fileName ?? "version missing"
  );

  const localManager = new CivitaiDownloadManager({
    allowLoopbackHttpForTests: true,
    fetcher: trackingFetch,
  });
  const payload = Buffer.alloc(1024 * 1024);
  for (let index = 0; index < payload.length; index += 1) {
    payload[index] = (index * 31 + 7) & 0xff;
  }
  const payloadSha = sha256Buffer(payload);
  const localTarget = (type, architecture, fileName) =>
    resolveCivitaiTargetPath(LOCAL_MODELS, type, architecture, fileName);

  const payloadServer = await createPayloadServer(payload);
  const redirectServer = await createPayloadServer(payload);
  let sourceServer = null;

  try {
    const progressServer = await createPayloadServer(payload, {
      chunkSize: 8 * 1024,
      delayMs: 40,
    });
    const progressVersion = makeVersion({
      id: 900001,
      fileName: "progress-test.safetensors",
      downloadUrl: `${progressServer.base}/file`,
      sizeBytes: payload.length,
      sha256: payloadSha,
    });
    const progressTask = localManager.start({
      model: makeModel({ id: 900000, name: "Progress Test", type: "LORA", version: progressVersion }),
      version: progressVersion,
      apiKey: null,
      settings: localSettings,
      managedModelsDir: LOCAL_MANAGED,
    });
    const progressTracker = trackTask(localManager, progressTask.id);
    await waitFor(
      () => (localManager.getTask(progressTask.id)?.downloadedBytes ?? 0) >= 512 * 1024,
      12000,
      "local progress"
    );
    const progressBytes = progressTracker.events
      .map((event) => event.downloadedBytes)
      .filter((bytes) => bytes > 0);
    check(
      "progress reporting advances during a slow transfer",
      new Set(progressBytes).size >= 2,
      `${new Set(progressBytes).size} byte positions`
    );
    localManager.cancelDownload(progressTask.id);
    const cancelled = await settle(localManager, localManager.getTask(progressTask.id));
    progressTracker.stop();
    check("cancellation settles the task", cancelled?.status === "cancelled", cancelled?.status);
    check(
      "cancellation removes the partial file",
      !fs.existsSync(progressTask.targetPath) && !fs.existsSync(`${progressTask.targetPath}.part`)
    );
    await progressServer.close();

    const resumeVersion = makeVersion({
      id: 900002,
      fileName: "resume-test.safetensors",
      downloadUrl: `${payloadServer.base}/file`,
      sizeBytes: payload.length,
      sha256: payloadSha,
    });
    const resumeTarget = localTarget("LORA", "sd15", resumeVersion.fileName);
    fs.mkdirSync(path.dirname(resumeTarget), { recursive: true });
    const resumeOffset = 256 * 1024;
    fs.writeFileSync(`${resumeTarget}.part`, payload.subarray(0, resumeOffset));
    const requestsBeforeResume = payloadServer.requests.length;
    const resumeTask = localManager.start({
      model: makeModel({ id: 900000, name: "Resume Test", type: "LORA", version: resumeVersion }),
      version: resumeVersion,
      apiKey: null,
      settings: localSettings,
      managedModelsDir: LOCAL_MANAGED,
    });
    const resumed = await settle(localManager, resumeTask);
    const resumeRequests = payloadServer.requests.slice(requestsBeforeResume);
    check("retry/resume completes an interrupted transfer", resumed?.status === "completed", resumed?.error ?? resumed?.status);
    check(
      "resume sends a Range request and appends to the .part file",
      resumeRequests.some((request) => request.range === `bytes=${resumeOffset}-`) &&
        fs.existsSync(resumeTarget) &&
        (await sha256File(resumeTarget)) === payloadSha
    );

    const integrityVersion = makeVersion({
      id: 900003,
      fileName: "integrity-test.safetensors",
      downloadUrl: `${payloadServer.base}/file`,
      sizeBytes: payload.length,
      sha256: "0".repeat(64),
    });
    const integrityTask = localManager.start({
      model: makeModel({ id: 900000, name: "Integrity Test", type: "LORA", version: integrityVersion }),
      version: integrityVersion,
      apiKey: null,
      settings: localSettings,
      managedModelsDir: LOCAL_MANAGED,
    });
    const integrity = await settle(localManager, integrityTask);
    check(
      "SHA-256 mismatch fails the download and removes the partial file",
      integrity?.status === "failed" &&
        /SHA-256 verification failed/i.test(integrity.error ?? "") &&
        !fs.existsSync(integrityTask.targetPath) &&
        !fs.existsSync(`${integrityTask.targetPath}.part`),
      integrity?.error ?? integrity?.status
    );

    const duplicateVersion = makeVersion({
      id: 900004,
      fileName: "duplicate-test.safetensors",
      downloadUrl: `${payloadServer.base}/file`,
      sizeBytes: payload.length,
      sha256: payloadSha,
    });
    const duplicateTarget = localTarget("LORA", "sd15", duplicateVersion.fileName);
    fs.mkdirSync(path.dirname(duplicateTarget), { recursive: true });
    fs.writeFileSync(duplicateTarget, payload);
    const requestsBeforeDuplicate = payloadServer.requests.length;
    const duplicateTask = localManager.start({
      model: makeModel({ id: 900000, name: "Duplicate Test", type: "LORA", version: duplicateVersion }),
      version: duplicateVersion,
      apiKey: null,
      settings: localSettings,
      managedModelsDir: LOCAL_MANAGED,
    });
    check(
      "an already-installed file is recognized without another transfer",
      duplicateTask.status === "completed" &&
        payloadServer.requests.length === requestsBeforeDuplicate &&
        fs.statSync(duplicateTarget).size === payload.length
    );

    const conflictVersion = makeVersion({
      id: 900005,
      fileName: "conflict-test.safetensors",
      downloadUrl: `${payloadServer.base}/file`,
      sizeBytes: payload.length,
      sha256: payloadSha,
    });
    const conflictTarget = localTarget("LORA", "sd15", conflictVersion.fileName);
    fs.mkdirSync(path.dirname(conflictTarget), { recursive: true });
    fs.writeFileSync(conflictTarget, Buffer.concat([payload, Buffer.alloc(8192)]));
    let conflictError = null;
    try {
      localManager.start({
        model: makeModel({ id: 900000, name: "Conflict Test", type: "LORA", version: conflictVersion }),
        version: conflictVersion,
        apiKey: null,
        settings: localSettings,
        managedModelsDir: LOCAL_MANAGED,
      });
    } catch (err) {
      conflictError = err;
    }
    check(
      "a mismatched existing file is refused instead of overwritten",
      Boolean(conflictError) &&
        /different file already exists/i.test(conflictError.message) &&
        fs.statSync(conflictTarget).size === payload.length + 8192,
      conflictError?.message ?? "no error"
    );

    const authVersion = makeVersion({
      id: 900006,
      fileName: "auth-redirect.safetensors",
      downloadUrl: `${payloadServer.base}/redirect`,
      sizeBytes: payload.length,
      sha256: payloadSha,
    });
    const authManager = new CivitaiDownloadManager({
      allowLoopbackHttpForTests: true,
      fetcher: trackingFetch,
    });
    sourceServer = await createPayloadServer(payload, {
      requireBearer: "test-key",
      redirectTo: `${redirectServer.base}/file`,
    });
    const authTask = authManager.start({
      model: makeModel({ id: 900000, name: "Auth Redirect Test", type: "LORA", version: { ...authVersion, downloadUrl: `${sourceServer.base}/redirect` } }),
      version: { ...authVersion, downloadUrl: `${sourceServer.base}/redirect` },
      apiKey: "test-key",
      settings: localSettings,
      managedModelsDir: LOCAL_MANAGED,
    });
    const authResult = await settle(authManager, authTask);
    check("API-key authorization is sent to the download origin", authResult?.status === "completed", authResult?.error ?? authResult?.status);
    check(
      "Authorization is stripped on a cross-origin redirect",
      sourceServer.requests.some((request) => request.authorization === "Bearer test-key") &&
        redirectServer.requests.some(
          (request) => request.path === "/file" && request.authorization === null
        )
    );
    const errorCases = [
      { id: 900007, name: "401", route: "/401", pattern: /requires authentication.*local unauthorized/i },
      { id: 900008, name: "403", route: "/403", pattern: /refused this download.*local gated/i },
      { id: 900009, name: "404", route: "/404", pattern: /unavailable.*local missing/i },
      { id: 900010, name: "429", route: "/429", pattern: /rate limit/i },
    ];
    for (const errorCase of errorCases) {
      const version = makeVersion({
        id: errorCase.id,
        fileName: `error-${errorCase.name}.safetensors`,
        downloadUrl: `${payloadServer.base}${errorCase.route}`,
        sizeBytes: payload.length,
        sha256: payloadSha,
      });
      const task = localManager.start({
        model: makeModel({ id: 900000, name: `Error ${errorCase.name}`, type: "LORA", version }),
        version,
        apiKey: null,
        settings: localSettings,
        managedModelsDir: LOCAL_MANAGED,
      });
      const result = await settle(localManager, task);
      check(
        `HTTP ${errorCase.name} produces a clear download error`,
        result?.status === "failed" && errorCase.pattern.test(result.error ?? "") &&
          !fs.existsSync(task.targetPath),
        result?.error ?? result?.status
      );
    }
  } finally {
    if (sourceServer) await sourceServer.close();
    await payloadServer.close();
    await redirectServer.close();
  }

  const liveUnauthorizedVersion = makeVersion({
    id: 910001,
    fileName: "live-401-gated.pt",
    downloadUrl: "https://civitai.com/api/download/models/165249?fileId=2037763",
    sizeBytes: 1000,
    sha256: null,
    architecture: "unknown",
    baseModel: "Upscaler",
  });
  const liveUnauthorized = realManager.start({
    model: makeModel({
      id: 910000,
      name: "Live 401 Gated File",
      type: "Upscaler",
      version: liveUnauthorizedVersion,
    }),
    version: liveUnauthorizedVersion,
    apiKey: null,
    settings: realSettings,
    managedModelsDir: REAL_MANAGED,
  });
  const liveUnauthorizedResult = await settle(realManager, liveUnauthorized);
  check(
    "live gated download reports the server's authentication message",
    liveUnauthorizedResult?.status === "failed" &&
      /requires authentication/i.test(liveUnauthorizedResult.error ?? "") &&
      /disabled downloads/i.test(liveUnauthorizedResult.error ?? ""),
    liveUnauthorizedResult?.error ?? liveUnauthorizedResult?.status
  );
  check(
    "live gated download leaves no model file",
    !fs.existsSync(liveUnauthorized.targetPath)
  );

  let gatedStatus = null;
  try {
    const ponySearch = await client.searchModels({
      query: "Pony Diffusion V6 XL",
      type: "Checkpoint",
      limit: 10,
      sort: "Most Downloaded",
    });
    const ponyModel =
      ponySearch.items.find((item) => /pony diffusion v6 xl/i.test(item.name)) ??
      ponySearch.items[0];
    const ponyVersion = ponyModel?.versions.find(
      (version) => version.downloadable && !/vae/i.test(version.fileName)
    );
    if (ponyModel && ponyVersion) {
      const preflight = await fetch(ponyVersion.downloadUrl, {
        headers: { Range: "bytes=0-0", "User-Agent": USER_AGENT },
        redirect: "follow",
      });
      gatedStatus = preflight.status;
      await preflight.body?.cancel().catch(() => undefined);
      if (preflight.status === 401 || preflight.status === 403) {
        const task = realManager.start({
          model: ponyModel,
          version: ponyVersion,
          apiKey: null,
          settings: realSettings,
          managedModelsDir: REAL_MANAGED,
        });
        const result = await settle(realManager, task);
        check(
          `live restricted download (HTTP ${preflight.status}) is reported clearly`,
          result?.status === "failed" &&
            (preflight.status === 401
              ? /requires authentication/i.test(result.error ?? "")
              : /refused this download/i.test(result.error ?? "")),
          result?.error ?? result?.status
        );
        check(
          "live restricted download leaves no model file",
          !fs.existsSync(task.targetPath)
        );
      } else {
        note(
          `Pony Diffusion preflight returned HTTP ${preflight.status}; skipped the attempt to avoid a 2 GB download`
        );
      }
    } else {
      note("Pony Diffusion V6 XL was not available in live search; restricted-live check skipped");
    }
  } catch (err) {
    note(`Live restricted check could not run: ${err.message}`);
  }

  const categorySummary = {};
  for (const target of REAL_TARGETS) {
    const entry = downloads.find((item) => item.target.category === target.category);
    categorySummary[target.category] = entry
      ? {
          status: "working",
          model: `${entry.model.name} / ${entry.version.name}`,
          file: entry.task.fileName,
          bytes: entry.task.downloadedBytes,
          target: entry.task.targetPath,
          sha256Verified: entry.version.sha256
            ? entry.actualSha === entry.version.sha256.toLowerCase()
            : null,
        }
      : { status: "not verified" };
  }

  const summary = {
    workspace: ROOT,
    categories: categorySummary,
    anonymousApi: connection.ok,
    liveRestrictedStatus: gatedStatus,
    checks: checks.length,
    failures: failures.length,
    notes,
  };
  console.log("\n=== VERIFICATION SUMMARY ===");
  console.log(JSON.stringify(summary, null, 2));
  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const failure of failures) console.log(`- ${failure.name}: ${failure.detail}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("VERIFICATION CRASHED", err);
  process.exitCode = 1;
});
