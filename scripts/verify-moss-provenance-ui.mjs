import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import Database from "better-sqlite3";

const ROOT = path.resolve(import.meta.dirname, "..");
const ELECTRON =
  process.env.KIREA_ELECTRON ??
  path.join(ROOT, "node_modules", "electron", "dist", "electron.exe");
const PORT = Number(process.env.KIREA_PORT ?? 9457);
const SHOT_DIR = path.join(os.tmpdir(), "kirea-moss-provenance-ui");
const PROFILE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-moss-profile-"));
const SOURCE_PROFILE = path.join(process.env.APPDATA ?? "", "ai-image-studio-desktop");
const DB_NAME = "kirea-studio.db";

fs.mkdirSync(SHOT_DIR, { recursive: true });
for (const suffix of ["", "-wal", "-shm"]) {
  const source = path.join(SOURCE_PROFILE, `${DB_NAME}${suffix}`);
  if (fs.existsSync(source)) fs.copyFileSync(source, path.join(PROFILE_DIR, `${DB_NAME}${suffix}`));
}

const notes = [];
const errors = [];
const fixtureFiles = [];
let child = null;
let cdp = null;

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
  };
}

async function pollTarget(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await response.json();
      const target = targets.find(
        (item) => item.type === "page" && String(item.url).startsWith("file:")
      );
      if (target?.webSocketDebuggerUrl) return target;
    } catch {
      // still booting
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error("Timed out waiting for renderer target.");
}

async function waitFor(fn, label, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function shot(name) {
  const result = await cdp.send("Page.captureScreenshot", { format: "png" });
  const file = path.join(SHOT_DIR, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(result.data, "base64"));
}

async function launch() {
  log(`launching electron on port ${PORT}`);
  child = spawn(
    ELECTRON,
    [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE_DIR}`, ...(process.env.KIREA_ELECTRON ? [] : ["."])],
    { cwd: ROOT, stdio: "ignore" }
  );
  const target = await pollTarget();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  cdp = connectCdp(socket);
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id) return;
    if (message.method === "Runtime.exceptionThrown") {
      const detail = message.params.exceptionDetails;
      errors.push(detail.exception?.description ?? detail.text ?? "page error");
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      errors.push(message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "));
    }
  });
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await waitFor(
    () => cdp.evaluate(`document.body.innerText.includes("Library")`),
    "app shell",
    45000
  );
  log("app shell ready");
  await new Promise((resolve) => setTimeout(resolve, 1800));
}

async function close() {
  log("closing first launch");
  try {
    await cdp.evaluate("window.close()");
  } catch {
    // ignore
  }
  if (!child) return;
  const exited = await waitExit(8000);
  if (!exited) {
    log("first launch did not exit, killing process");
    child.kill();
    await waitExit(5000);
  }
  child = null;
  cdp = null;
  await new Promise((resolve) => setTimeout(resolve, 800));
}

function log(message) {
  process.stderr.write(`[verify] ${message}\n`);
}

function waitExit(timeoutMs) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
}

async function nav(label) {
  const ok = await cdp.evaluate(`(() => {
    const node = Array.from(document.querySelectorAll('button, a')).find(
      (el) => (el.textContent || '').trim() === ${JSON.stringify(label)}
    );
    if (!node) return false;
    node.click();
    return true;
  })()`);
  if (!ok) throw new Error(`Navigation '${label}' missing`);
}

async function clickText(label) {
  const ok = await cdp.evaluate(`(() => {
    const node = Array.from(document.querySelectorAll('button')).find(
      (el) => (el.textContent || '').trim() === ${JSON.stringify(label)}
    );
    if (!node) return false;
    node.click();
    return true;
  })()`);
  if (!ok) throw new Error(`Button '${label}' missing`);
}

async function setInput(ariaLabel, value) {
  const ok = await cdp.evaluate(`(() => {
    const el = document.querySelector('[aria-label=${JSON.stringify(ariaLabel)}]');
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  if (!ok) throw new Error(`Input '${ariaLabel}' missing`);
}

function insertProvenanceChain() {
  const db = new Database(path.join(PROFILE_DIR, DB_NAME));
  const root = db
    .prepare("SELECT * FROM generated_images ORDER BY created_at DESC LIMIT 1")
    .get();
  if (!root) throw new Error("No existing image available to clone for UI provenance fixture");
  const source = root.file_path;
  if (!fs.existsSync(source)) throw new Error(`Source image missing: ${source}`);
  const fixtureDir = path.dirname(source);

  const stages = [
    {
      id: "img_ui_moss_root",
      file: path.join(fixtureDir, "kirea-ui-fixture-moss.png"),
      workflowId: "t2i_moss_image",
      mode: "txt2img",
      operation: "moss_image",
      sequence: 0,
      parent: null,
    },
    {
      id: "img_ui_upscaled",
      file: path.join(fixtureDir, "kirea-ui-fixture-upscaled.png"),
      workflowId: "upscale_model_v1",
      mode: "upscale",
      operation: "upscale",
      sequence: 1,
      parent: "img_ui_moss_root",
    },
    {
      id: "img_ui_edited",
      file: path.join(fixtureDir, "kirea-ui-fixture-edited.png"),
      workflowId: "i2i_moss_image_edit",
      mode: "img2img",
      operation: "image_edit",
      sequence: 2,
      parent: "img_ui_upscaled",
    },
  ];

  const now = new Date().toISOString();
  const insertImage = db.prepare(
    `INSERT INTO generated_images (${Object.keys(root).join(", ")})
     VALUES (${Object.keys(root).map(() => "?").join(", ")})`
  );
  const insertOperation = db.prepare(
    `INSERT INTO image_operations (
      id, image_id, sequence, operation, workflow_id, workflow_version,
      checkpoint, prompt, seed, parameters_json, parent_image_id, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  db.transaction(() => {
    for (const stage of stages) {
      fs.copyFileSync(source, stage.file);
      fixtureFiles.push(stage.file);
      const row = {
        ...root,
        id: stage.id,
        file_path: stage.file,
        file_name: path.basename(stage.file),
        workflow_id: stage.workflowId,
        mode: stage.mode,
        parent_image_id: stage.parent,
        prompt: `ui provenance fixture ${stage.operation}`,
        created_at: now,
        collection_id: null,
      };
      insertImage.run(...Object.values(row));
      insertOperation.run(
        `op_${stage.id}`,
        stage.id,
        stage.sequence,
        stage.operation,
        stage.workflowId,
        "1.0.0",
        root.checkpoint,
        `${stage.workflowId} UI provenance fixture`,
        root.seed,
        JSON.stringify({ workflowId: stage.workflowId, uiFixture: true }),
        stage.parent,
        now
      );
    }
  })();
  db.close();
}

async function main() {
  await launch();
  await close();
  log("inserting provenance fixture");
  insertProvenanceChain();
  await launch();
  log("verifying provenance viewer");

  await nav("Library");
  await waitFor(
    () => cdp.evaluate(`document.body.innerText.includes("Media Library")`),
    "library page"
  );
  await waitFor(
    () => cdp.evaluate(`!!document.querySelector('[aria-label="Search media library"]')`),
    "library filters"
  );
  await cdp.evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('button[aria-pressed]')).find(
      (el) => (el.textContent || '').trim().startsWith('Images')
    );
    button?.click();
  })()`);
  await setInput("Search media library", "ui provenance fixture image_edit");
  const mediaProbe = await cdp.evaluate(`(async () => {
    const result = await window.kirea.listLibraryMedia({ search: "ui provenance fixture image_edit" });
    const input = document.querySelector('[aria-label="Search media library"]');
    const cards = Array.from(document.querySelectorAll('[aria-label^="Inspect "]'));
    return {
      count: result?.items?.length ?? -1,
      titles: (result?.items ?? []).map((item) => item.title).slice(0, 5),
      inputValue: input?.value ?? null,
      cardCount: cards.length,
      cardLabels: cards.slice(0, 5).map((node) => node.getAttribute('aria-label')),
      body: document.body.innerText.slice(0, 900),
    };
  })()`);
  log(`library probe: ${JSON.stringify(mediaProbe)}`);
  await waitFor(
    () => cdp.evaluate(`!!document.querySelector('[aria-label="Inspect ui provenance fixture image_edit"]')`),
    "provenance fixture card"
  );
  await waitFor(
    () => cdp.evaluate(`(() => {
      const card = document.querySelector('[aria-label="Inspect ui provenance fixture image_edit"]');
      if (!card) return false;
      card.click();
      return true;
    })()`),
    "open provenance fixture"
  );
  await waitFor(
    () => cdp.evaluate(`!!document.querySelector('[aria-label="Zoomable image viewer"]')`),
    "image viewer"
  );
  await new Promise((resolve) => setTimeout(resolve, 500));
  const provenanceText = await cdp.evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
    return dialog ? dialog.innerText : '';
  })()`);
  const upperProvenance = provenanceText.toUpperCase();
  for (const label of ["MOSS-IMAGE", "UPSCALED", "IMAGE EDITED", "ORIGINAL GENERATION", "STAGE 2", "STAGE 3"]) {
    if (!upperProvenance.includes(label)) {
      throw new Error(
        `Viewer missing provenance label: ${label}. Viewer text: ${JSON.stringify(
          provenanceText.slice(0, 600)
        )}`
      );
    }
  }
  notes.push("viewer shows MOSS-Image → Upscaled → Image Edited with stages");
  await shot("01-provenance-viewer");
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await waitFor(
    () => cdp.evaluate(`!document.querySelector('[role="dialog"][aria-modal="true"]')`),
    "viewer closed"
  );

  await nav("Models");
  await waitFor(
    () => cdp.evaluate(`document.body.innerText.includes("Model Vault & Civitai Hub")`),
    "models page"
  );
  await clickText("02 // CIVITAI HUB");
  await waitFor(
    () => cdp.evaluate(`!!document.querySelector('[aria-label="Model discovery tabs"]')`),
    "hub tabs"
  );
  await waitFor(
    () => cdp.evaluate(`Array.from(document.querySelectorAll('button')).some((el) => (el.textContent || '').trim() === 'SeaArt')`),
    "SeaArt provider button"
  );
  await clickText("SeaArt");
  await waitFor(
    () => cdp.evaluate(`document.body.innerText.includes("does not publish an official public model-discovery API")`),
    "SeaArt fallback copy"
  );
  const seaartText = await cdp.evaluate("document.body.innerText");
  if (!seaartText.includes("Provider attribution")) throw new Error("SeaArt attribution missing");
  notes.push("SeaArt fallback is explicit, external-link only, and attributed");

  await clickText("01 // LOCAL VAULT");
  await waitFor(
    () => cdp.evaluate(`document.body.innerText.includes("Curated Download Catalog")`),
    "catalog tab"
  );
  await cdp.evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('button')).find(
      (el) => (el.textContent || '').trim().startsWith('Curated Download Catalog')
    );
    button?.click();
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 600));
  const catalogText = await cdp.evaluate("document.body.innerText");
  for (const needle of [
    "MOSS-Image SFT — INT8 ConvRot",
    "Qwen3.5-9B Text Encoder — W4A8 GPTQ",
    "FLUX.2 Small VAE",
    "moss_image_sft_int8_convrot.safetensors",
    "models/diffusion_models/moss_image_sft_int8_convrot.safetensors",
  ]) {
    if (!catalogText.includes(needle)) throw new Error(`Catalog missing: ${needle}`);
  }
  notes.push("Model Vault catalog lists MOSS SFT, encoder, VAE with target paths");
  await shot("02-moss-catalog");

  await nav("Create");
  await waitFor(
    () => cdp.evaluate(`document.body.innerText.includes("Brief the render in plain language")`),
    "create page"
  );
  await clickText("Advanced");
  await waitFor(
    () => cdp.evaluate(`document.body.innerText.includes("Every parameter exposed")`),
    "advanced create mode"
  );
  const createText = await cdp.evaluate("document.body.innerText");
  if (!createText.includes("MOSS-Image workflows appear after the SFT or Base diffusion")) {
    throw new Error("Create page MOSS readiness hint missing");
  }
  notes.push("Create page exposes per-workflow MOSS readiness hint");
  await shot("03-create-moss-readiness");

  notes.forEach((note) => console.log(`NOTE ${note}`));
  const realErrors = errors.filter(
    (entry) => !/Autofill|DevTools|Download the React DevTools/i.test(entry)
  );
  console.log(`ERRORS ${realErrors.length}`);
  realErrors.slice(0, 10).forEach((entry) => console.log(`ERR ${entry}`));
  console.log(`SHOTS ${SHOT_DIR}`);
  console.log("PASS MOSS catalog, readiness, SeaArt fallback and multi-stage provenance UI");
}

main()
  .catch((err) => {
    console.error(`FAIL ${err.message}`);
    notes.forEach((note) => console.log(`NOTE ${note}`));
    errors.slice(0, 10).forEach((entry) => console.log(`ERR ${entry}`));
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      if (child) child.kill();
    } catch {
      // ignore
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    for (const file of fixtureFiles) {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        // ignore
      }
    }
    fs.rmSync(PROFILE_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
