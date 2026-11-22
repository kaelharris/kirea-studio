import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const ELECTRON = path.join(ROOT, "node_modules", "electron", "dist", "electron.exe");
const RENDERER_PORT = 9444;
const MAIN_PORT = 9339;
const LOG_PATH = path.join(ROOT, "app-civitai-smoke.log");
const SHOT_DIR = path.join(os.tmpdir(), "kirea-civitai-smoke");
const PROFILE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-civitai-profile-"));
const VAULT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-civitai-vault-"));
const MODELS_ROOT = path.join(VAULT_DIR, "models");
const PREVIEW_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const errors = [];
const notes = [];

fs.mkdirSync(SHOT_DIR, { recursive: true });
fs.mkdirSync(MODELS_ROOT, { recursive: true });

let child = null;
let renderer = null;
let mainCdp = null;

function log(line) {
  const text = `[${new Date().toISOString()}] ${line}`;
  console.log(text);
  fs.appendFileSync(LOG_PATH, `${text}\n`);
}

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

async function pollTargets(port, pickTarget, label, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const target = targets.find(pickTarget);
        if (target?.webSocketDebuggerUrl) return target;
      }
    } catch {
      // still booting
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function evaluate(expression) {
  return renderer.evaluate(expression);
}

async function waitFor(fn, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

const bodyIncludes = (text) =>
  evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`);

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
  if (!clicked) throw new Error(`No clickable element matched "${text}"`);
  log(`clicked: ${text}`);
}

// Startup settings loading can reset the initial route just after the first click.
async function openNavPage(label, marker) {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    await clickIfPresent(label);
    await new Promise((resolve) => setTimeout(resolve, 600));
    if (await bodyIncludes(marker)) {
      log(`opened: ${label}`);
      return;
    }
  }
  throw new Error(`Timed out opening the "${label}" page.`);
}

const cardText = (name) =>
  evaluate(`(() => {
    const heading = Array.from(document.querySelectorAll('h3')).find(
      (node) => (node.textContent || "").trim() === ${JSON.stringify(name)}
    );
    if (!heading) return null;
    let node = heading;
    while (node && !node.querySelector('button')) node = node.parentElement;
    return node ? node.innerText : null;
  })()`);

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
        (candidate.textContent || "").includes(${JSON.stringify(label)}) &&
        !candidate.disabled
    );
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`No "${label}" button found in the "${name}" card.`);
  log(`clicked: ${label} (${name})`);
}

async function screenshot(name) {
  const shot = await renderer.send("Page.captureScreenshot", { format: "png" });
  const file = path.join(SHOT_DIR, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
  log(`screenshot: ${file}`);
  return file;
}

const MOCK_MODELS = [
  {
    id: 9001,
    name: "Pony Dusk LoRA",
    type: "LORA",
    nsfw: false,
    description: "Warm dusk lighting and cinematic rim light for Pony checkpoints.",
    tags: ["lighting", "cinematic", "pony"],
    creator: { username: "kirea-labs" },
    stats: { downloadCount: 154321, thumbsUpCount: 8765, rating: 4.8 },
    modelVersions: [
      {
        id: 5001,
        name: "v2.0 Dusk",
        baseModel: "Pony Diffusion V6 XL",
        publishedAt: "2026-09-14T10:00:00.000Z",
        trainedWords: ["pony dusk", "warm rim light"],
        description:
          "<p>Recommended sample prompt:</p><p>pony dusk, warm rim light, cinematic portrait</p>",
        files: [
          {
            id: 1,
            name: "PonyDusk_v2.safetensors",
            downloadUrl: "https://civitai.com/api/download/models/5001",
            sizeKB: 1280,
            hashes: {},
          },
        ],
        images: [
          { url: "https://image.civitai.com/kirea/pony-dusk-1.png" },
          { url: "https://image.civitai.com/kirea/pony-dusk-2.png" },
        ],
      },
      {
        id: 5003,
        name: "v1.5 Dusk",
        baseModel: "Pony Diffusion V6 XL",
        trainedWords: ["pony dusk"],
        files: [
          {
            id: 2,
            name: "PonyDusk_v1.5.safetensors",
            downloadUrl: "https://civitai.com/api/download/models/5003",
            sizeKB: 900,
            hashes: {},
          },
        ],
        images: [{ url: "https://image.civitai.com/kirea/pony-dusk-15.png" }],
      },
    ],
  },
  {
    id: 9002,
    name: "Pony Line Art LoRA",
    type: "LORA",
    nsfw: false,
    description: "Crisp monochrome line-art stylisation with clean contours.",
    tags: ["line art", "monochrome"],
    creator: { username: "kirea-labs" },
    stats: { downloadCount: 42100, thumbsUpCount: 1930, rating: 4.5 },
    modelVersions: [
      {
        id: 5002,
        name: "v1.0 Line Art",
        baseModel: "Pony Diffusion V6 XL",
        trainedWords: ["line art", "ink sketch"],
        description: "<p>Sample prompt: line art, ink sketch, clean contours</p>",
        files: [
          {
            id: 3,
            name: "PonyLineArt_v1.safetensors",
            downloadUrl: "https://civitai.com/api/download/models/5002",
            sizeKB: 2560,
            hashes: {},
          },
        ],
        images: [{ url: "https://image.civitai.com/kirea/pony-line-1.png" }],
      },
    ],
  },
];

const MOCK_CONFIG = {
  models: MOCK_MODELS,
  totals: { "5001": 1280 * 1024, "5002": 2560 * 1024 },
  downloadPlans: {
    "5001": { first: { chunks: 24, delayMs: 80 } },
    "5002": {
      first: { chunks: 300, delayMs: 60 },
      retry: { chunks: 20, delayMs: 50 },
    },
  },
};

function buildMockExpression() {
  return `(async () => {
    const config = ${JSON.stringify(MOCK_CONFIG)};
    if (globalThis.__kireaCivitaiMockInstalled) return "already installed";
    const originalFetch = globalThis.fetch.bind(globalThis);
    const attempts = Object.create(null);
    const png = Uint8Array.from(Buffer.from(${JSON.stringify(PREVIEW_PNG)}, "base64"));
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const json = (value, status) =>
      new Response(JSON.stringify(value), {
        status: status || 200,
        headers: { "content-type": "application/json" },
      });
    const makeStream = (total, plan, signal) =>
      new ReadableStream({
        async start(controller) {
          let sent = 0;
          const per = Math.ceil(total / plan.chunks);
          try {
            for (let i = 0; i < plan.chunks; i += 1) {
              if (signal && signal.aborted) {
                try { controller.error(new Error("ABORTED")); } catch (err) {}
                return;
              }
              const size = Math.min(per, total - sent);
              if (size <= 0) break;
              controller.enqueue(new Uint8Array(size));
              sent += size;
              await sleep(plan.delayMs);
            }
            controller.close();
          } catch (err) {
            try { controller.error(err); } catch (ignored) {}
          }
        },
      });
    globalThis.fetch = async function kireaMockFetch(input, init) {
      const options = init || {};
      let url = "";
      if (typeof input === "string") url = input;
      else if (input instanceof URL) url = input.href;
      else url = input.url;

      if (url.indexOf("https://civitai.com/api/v1/models?") === 0) {
        return json({ items: config.models, metadata: { nextCursor: null } });
      }

      const detail = /^https:\\/\\/civitai\\.com\\/api\\/v1\\/models\\/(\\d+)/.exec(url);
      if (detail) {
        const found = config.models.find(
          (model) => String(model.id) === detail[1]
        );
        return found ? json(found) : json({ error: "not found" }, 404);
      }

      const download = /^https:\\/\\/civitai\\.com\\/api\\/download\\/models\\/(\\d+)/.exec(url);
      if (download) {
        const versionId = download[1];
        attempts[versionId] = (attempts[versionId] || 0) + 1;
        const planSet = config.downloadPlans[versionId] || {
          first: { chunks: 16, delayMs: 40 },
        };
        const plan =
          attempts[versionId] === 1 ? planSet.first : planSet.retry || planSet.first;
        const total = config.totals[versionId] || 1048576;
        return new Response(makeStream(total, plan, options.signal), {
          status: 200,
          headers: {
            "content-length": String(total),
            "content-type": "application/octet-stream",
          },
        });
      }

      if (url.indexOf("https://image.civitai.com/") === 0) {
        return new Response(png, {
          status: 200,
          headers: { "content-type": "image/png" },
        });
      }

      return originalFetch(input, init);
    };
    globalThis.__kireaCivitaiMockInstalled = true;
    return "mock installed for " + config.models.length + " models";
  })()`;
}

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

async function main() {
  fs.writeFileSync(LOG_PATH, "");
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

  const rendererTarget = await pollTargets(
    RENDERER_PORT,
    (target) => target.type === "page" && String(target.url).startsWith("file:"),
    "the Electron renderer target"
  );
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
      errors.push(`log: ${message.params.entry.text}`);
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
    patterns: [
      { urlPattern: "https://image.civitai.com/*", requestStage: "Request" },
    ],
  });

  const mainTarget = await pollTargets(
    MAIN_PORT,
    (target) => Boolean(target.webSocketDebuggerUrl),
    "the Electron main-process inspector"
  );
  mainCdp = connectCdp(await openWebSocket(mainTarget.webSocketDebuggerUrl));
  await mainCdp.send("Runtime.enable");
  const mockStatus = await mainCdp.evaluate(buildMockExpression());
  log(`main fetch mock: ${mockStatus}`);

  await waitFor(() => evaluate("Boolean(window.kirea)"), "the preload bridge");

  const isolated = await evaluate(
    `window.kirea.updateSettings(${JSON.stringify({
      runtimeMode: "managed",
      managedComfyPath: VAULT_DIR,
    })})`
  );
  if (isolated?.runtimeMode !== "managed") {
    throw new Error("Could not point the app at the isolated managed ComfyUI folder.");
  }
  log(`isolated download root: ${MODELS_ROOT}`);

  await waitFor(() => bodyIncludes("Kirea"), "initial UI");
  await waitFor(() => bodyIncludes("Models"), "sidebar navigation");

  await openNavPage("Models", "Model Vault & Civitai Hub");
  await waitFor(() => bodyIncludes("01 // LOCAL VAULT"), "Models mode switcher");
  if (!(await bodyIncludes("Installed Local Models"))) {
    throw new Error("Local Vault sub-tabs did not render.");
  }
  notes.push("Local Vault rendered with installed/catalog sub-tabs");
  await screenshot("01-local-vault");

  await click("02 // CIVITAI HUB");
  await waitFor(
    () =>
      evaluate(
        `Boolean(document.querySelector('input[placeholder^="Search Civitai"]'))`
      ),
    "Civitai Hub filter bar"
  );
  const filterCount = await evaluate(`document.querySelectorAll('select').length`);
  if (filterCount < 3) throw new Error("Hub type/base/sort selects did not render.");

  const typed = await evaluate(`(() => {
    const input = document.querySelector('input[placeholder^="Search Civitai"]');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, "pony");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  if (!typed) throw new Error("Could not type into the Civitai search field.");

  await waitFor(() => bodyIncludes("Pony Dusk LoRA"), "mocked Civitai search results", 30000);
  if (!(await bodyIncludes("Pony Line Art LoRA"))) {
    throw new Error("Second mocked model card did not render.");
  }
  if (!(await bodyIncludes("Download to Vault"))) {
    throw new Error("Hub download CTA did not render.");
  }
  const versionSelects = await evaluate(
    `document.querySelectorAll('select[aria-label^="Select version of"]').length`
  );
  if (versionSelects < 2) throw new Error("Per-card version selectors did not render.");
  notes.push("Civitai Hub rendered mocked model cards, version selectors, and CTAs");
  await screenshot("02-civitai-hub");

  const opened = await evaluate(`(() => {
    const card = document.querySelector('button[title="Open model details"]');
    if (!card) return false;
    card.click();
    return true;
  })()`);
  if (!opened) throw new Error("Could not open the mocked model details modal.");
  await waitFor(() => bodyIncludes("About & Sample Prompts"), "details modal content");
  await waitFor(() => bodyIncludes("Versions (2)"), "details version list");
  if (!(await bodyIncludes("warm rim light"))) {
    throw new Error("Details modal did not render trigger words.");
  }
  notes.push("Civitai details modal rendered prompt copy, trigger words, and versions");
  await screenshot("03-civitai-details");
  await evaluate(`document.querySelector('[aria-label="Close dialog"]')?.click()`);
  await waitFor(
    async () => !(await bodyIncludes("Civitai Details")),
    "details modal closed"
  );

  await clickCardButton("Pony Dusk LoRA", "Download to Vault");
  await waitFor(
    () => bodyIncludes("Downloads stream into the active ComfyUI models folder"),
    "downloads queue after starting a download"
  );
  await waitFor(async () => (await cardText("Pony Dusk LoRA")) !== null, "download task card");
  await waitFor(
    async () => ((await cardText("Pony Dusk LoRA")) ?? "").toLowerCase().includes("installed"),
    "first Civitai download to complete",
    40000
  );
  const firstTarget = path.join(
    MODELS_ROOT,
    "loras",
    "pony",
    "PonyDusk_v2.safetensors"
  );
  await waitFor(() => fs.existsSync(firstTarget), "downloaded LoRA file on disk", 15000);
  if (fs.statSync(firstTarget).size !== 1280 * 1024) {
    throw new Error("Downloaded LoRA size does not match the mocked content length.");
  }
  if (fs.existsSync(`${firstTarget}.part`)) {
    throw new Error("Leftover .part file after a completed download.");
  }
  const firstSidecar = JSON.parse(
    fs.readFileSync(
      path.join(MODELS_ROOT, "loras", "pony", "PonyDusk_v2.civitai.info"),
      "utf8"
    )
  );
  if (
    firstSidecar.source !== "civitai" ||
    firstSidecar.baseModel !== "Pony Diffusion V6 XL" ||
    !Array.isArray(firstSidecar.trainedWords) ||
    !firstSidecar.trainedWords.includes("warm rim light")
  ) {
    throw new Error("Civitai sidecar metadata is missing expected fields.");
  }
  if (!fs.existsSync(path.join(MODELS_ROOT, "loras", "pony", "PonyDusk_v2.preview.png"))) {
    throw new Error("Preview image was not cached next to the downloaded model.");
  }
  notes.push("First download installed atomically with sidecar metadata and preview");
  await screenshot("04-download-complete");

  await click("02 // CIVITAI HUB");
  await waitFor(() => bodyIncludes("Pony Dusk LoRA"), "hub after completed download");
  await waitFor(
    async () => ((await cardText("Pony Dusk LoRA")) ?? "").toLowerCase().includes("installed in vault"),
    "installed badge in the Civitai Hub",
    20000
  );
  notes.push("Hub reflected the completed download as Installed in Vault");
  await screenshot("05-hub-installed");

  await clickCardButton("Pony Line Art LoRA", "Download to Vault");
  await waitFor(
    () => bodyIncludes("Downloads stream into the active ComfyUI models folder"),
    "downloads queue for the cancel test"
  );
  await waitFor(
    async () => ((await cardText("Pony Line Art LoRA")) ?? "").toLowerCase().includes("downloading"),
    "second download to start streaming",
    20000
  );
  await waitFor(
    async () => {
      const text = (await cardText("Pony Line Art LoRA")) ?? "";
      return text.length > 0 && !text.includes("0 B / 2.50 MB");
    },
    "byte progress on the active download",
    15000
  );
  await screenshot("06-download-active");
  await waitFor(
    async () => ((await cardText("Pony Line Art LoRA")) ?? "").toLowerCase().includes("cancel"),
    "cancel control while downloading"
  );
  await clickCardButton("Pony Line Art LoRA", "Cancel");
  await waitFor(
    async () => ((await cardText("Pony Line Art LoRA")) ?? "").toLowerCase().includes("cancelled"),
    "cancelled queue state",
    20000
  );
  const secondTarget = path.join(
    MODELS_ROOT,
    "loras",
    "pony",
    "PonyLineArt_v1.safetensors"
  );
  if (fs.existsSync(secondTarget)) {
    throw new Error("Cancelled download still produced a finished model file.");
  }
  if (fs.existsSync(`${secondTarget}.part`)) {
    throw new Error("Cancelled download left a .part file behind.");
  }
  notes.push("Cancel removed the partial transfer and surfaced a cancelled state");
  await screenshot("07-download-cancelled");

  await clickCardButton("Pony Line Art LoRA", "Retry");
  await waitFor(
    async () => ((await cardText("Pony Line Art LoRA")) ?? "").toLowerCase().includes("installed"),
    "retried download to complete",
    40000
  );
  await waitFor(() => fs.existsSync(secondTarget), "retried LoRA file on disk", 15000);
  if (fs.existsSync(`${secondTarget}.part`)) {
    throw new Error("Leftover .part file after the retried download.");
  }
  notes.push("Retry resumed the cancelled task and finished the install");
  await screenshot("08-download-retried");

  log(`notes: ${notes.join(" | ")}`);
  if (errors.length > 0) {
    for (const error of errors) log(`ERROR ${error}`);
    throw new Error(`${errors.length} console/page error(s) detected`);
  }
  log("PASS: Civitai hub, details, download, cancel, and retry verified with no console/page errors");
}

main()
  .then(async () => {
    await shutdown();
    await removeTempDir(PROFILE_DIR);
    await removeTempDir(VAULT_DIR);
    process.exit(0);
  })
  .catch(async (error) => {
    log(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
    try {
      log(`queue text: ${JSON.stringify(await cardText("Pony Dusk LoRA"))}`);
    } catch (ignored) {
      // renderer already gone
    }
    log(
      `target exists: ${fs.existsSync(
        path.join(MODELS_ROOT, "loras", "pony", "PonyDusk_v2.safetensors")
      )}`
    );
    for (const entry of errors) log(`ERROR ${entry}`);
    await shutdown();
    await removeTempDir(PROFILE_DIR);
    await removeTempDir(VAULT_DIR);
    process.exit(1);
  });
