import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const ELECTRON = path.join(ROOT, "node_modules", "electron", "dist", "electron.exe");
const PORT = 9337;
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-package-ui-profile-"));
const SHOT_DIR = path.join(os.tmpdir(), "kirea-package-ui-shots");
const LOG_PATH = path.join(os.tmpdir(), "kirea-package-ui.log");
fs.mkdirSync(SHOT_DIR, { recursive: true });

const errors = [];
let ws;
let child;
let nextId = 1;
const pending = new Map();

function log(line) {
  const text = `[${new Date().toISOString()}] ${line}`;
  console.log(text);
  fs.appendFileSync(LOG_PATH, `${text}\n`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
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
}

async function waitFor(fn, label, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await sleep(250);
  }
  const body = await evaluate("document.body.innerText.slice(0, 3000)").catch(() => "");
  throw new Error(`Timed out waiting for ${label}\n--- body ---\n${body}`);
}

async function waitForTarget(timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find(
          (target) => target.type === "page" && String(target.url).startsWith("file:")
        );
        if (page?.webSocketDebuggerUrl) return page;
      }
    } catch {
      // app still booting
    }
    await sleep(400);
  }
  throw new Error("Timed out waiting for the Electron renderer target.");
}

async function connect() {
  const target = await waitForTarget();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id) {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
      return;
    }
    if (message.method === "Runtime.exceptionThrown") {
      const detail = message.params.exceptionDetails;
      errors.push(`pageerror: ${detail.exception?.description ?? detail.text ?? "unknown"}`);
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      errors.push(
        `console.error: ${message.params.args
          .map((arg) => arg.value ?? arg.description ?? "")
          .join(" ")}`
      );
    }
  });
  await send("Runtime.enable");
  await send("Page.enable");
}

async function launch() {
  child = spawn(ELECTRON, [".", `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`], {
    cwd: ROOT,
    stdio: "ignore",
    detached: false,
  });
  await connect();
  await waitFor(() => evaluate("document.body.textContent.includes('Kirea')"), "app shell");
  await waitFor(
    () => evaluate("!!document.querySelector('[aria-label=\"Pixel Studio\"]')"),
    "sidebar"
  );
}

async function shutdown() {
  if (ws) {
    try {
      ws.close();
    } catch {
      // ignore
    }
    ws = null;
  }
  if (child) {
    try {
      execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      // already gone
    }
    child = null;
    await sleep(1200);
  }
}

async function screenshot(name) {
  const shot = await send("Page.captureScreenshot", { format: "png" });
  const file = path.join(SHOT_DIR, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
  log(`screenshot: ${file}`);
}

function bodyHas(text) {
  return evaluate(
    `document.body.innerText.toLowerCase().includes(${JSON.stringify(text.toLowerCase())})`
  );
}

async function openPixelStudio() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const clicked = await evaluate(`(() => {
      const el = document.querySelector('[aria-label="Pixel Studio"]');
      if (!el) return false;
      el.click();
      return true;
    })()`);
    if (clicked) {
      await sleep(900);
      if (await bodyHas("Pixelbolt 0.17")) return;
    }
    await sleep(400);
  }
  throw new Error("Pixel Studio did not become active");
}

function clickText(text, scope = "document") {
  return evaluate(`(() => {
    const root = ${scope};
    const nodes = Array.from(root.querySelectorAll('button, [role="tab"], a'));
    const target = nodes.find(
      (node) => (node.textContent || "").trim() === ${JSON.stringify(text)} && !node.disabled
    );
    if (!target) return false;
    target.click();
    return true;
  })()`);
}

function clickAria(label) {
  return evaluate(`(() => {
    const el = document.querySelector('[aria-label=${JSON.stringify(label)}]');
    if (!el) return false;
    el.click();
    return true;
  })()`);
}

function selectByText(match) {
  return evaluate(`(() => {
    const selects = Array.from(document.querySelectorAll('[role="dialog"] select'));
    for (const select of selects) {
      const option = Array.from(select.options).find((entry) =>
        (entry.textContent || "").includes(${JSON.stringify(match)})
      );
      if (!option) continue;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(
        select,
        option.value
      );
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return option.textContent;
    }
    return null;
  })()`);
}

const NAME = "UI Package Hero";

async function main() {
  fs.writeFileSync(LOG_PATH, "");
  await launch();
  await openPixelStudio();
  log("Pixel Studio opened");

  const seeded = await evaluate(`(async () => {
    const projects = await window.kirea.listPixelProjects();
    const assets = await window.kirea.listPixelAssets();
    const existing = assets.find((asset) => asset.name === ${JSON.stringify(NAME)});
    if (existing) return existing.id;
    const detail = await window.kirea.generatePixelAsset({
      projectId: projects[0].id,
      kind: "character",
      name: ${JSON.stringify(NAME)},
      width: 32,
      height: 32,
      paletteId: "kirea",
      seed: 21,
      direction: "front",
    });
    return detail.id;
  })()`);
  if (!seeded) throw new Error("Could not seed the UI package asset");
  log(`seeded asset ${seeded}`);

  await send("Page.reload");
  await sleep(1200);
  await waitFor(() => evaluate("document.body.textContent.includes('Kirea')"), "app shell after reload");
  await openPixelStudio();
  await clickText("Library", `document.querySelector('[aria-label="Pixel Studio sections"]')`);
  await waitFor(() => bodyHas(NAME), "asset in library");
  const opened = await clickAria(`Export ${NAME} as a game-ready package`);
  if (!opened) throw new Error("Package export button was not found in the library");
  await waitFor(() => bodyHas("Export game-ready package"), "package dialog");
  await waitFor(() => bodyHas("Package contents"), "package plan");
  await waitFor(() => bodyHas("ui-package-hero"), "default plan root");
  log(`plan visible with root ui-package-hero`);
  await screenshot("01-package-dialog-generic");

  const presetText = await selectByText("Unity · sprites & clips");
  if (!presetText) throw new Error("Unity preset was not selectable");
  await waitFor(() => bodyHas("ui-package-hero-unity"), "unity plan root", 30000);
  await waitFor(() => bodyHas("Unity is not run at export time"), "honest Unity hint");
  await waitFor(
    () => bodyHas("real Unity 6 batch-mode import is part of KIREA's engine test suite"),
    "honest Unity footer note"
  );
  const unityFiles = await evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const text = dialog ? dialog.innerText : "";
    return {
      hasMeta: text.includes(".meta"),
      hasClipScript: text.includes("KireaPixelImport"),
      blocked: text.includes("Fix the errors above to export."),
    };
  })()`);
  if (!unityFiles.hasMeta || !unityFiles.hasClipScript) {
    throw new Error(`Unity plan files missing: ${JSON.stringify(unityFiles)}`);
  }
  if (unityFiles.blocked) throw new Error("Unity plan is blocked in the UI");
  await screenshot("02-package-dialog-unity");

  const started = await clickText("Export package", `document.querySelector('[role="dialog"]')`);
  if (!started) throw new Error("Export package button was not clickable");
  await waitFor(() => bodyHas("Package verified"), "verified package", 90000);
  const result = await evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return null;
    const pathNode = Array.from(dialog.querySelectorAll("p")).find((node) =>
      /\\.zip$/i.test((node.textContent || "").trim())
    );
    const statsNode = Array.from(dialog.querySelectorAll("p")).find((node) =>
      /files · \\d+ images · \\d+ sheet regions · \\d+ pixels compared/.test(node.textContent || "")
    );
    return {
      filePath: pathNode ? pathNode.textContent.trim() : null,
      stats: statsNode ? statsNode.textContent.trim() : null,
      note: (dialog.innerText || "").includes("Original assets, generation metadata and version history were read only"),
    };
  })()`);
  if (!result?.filePath) throw new Error("Verified package path was not shown");
  if (!fs.existsSync(result.filePath)) throw new Error(`Package file is missing: ${result.filePath}`);
  const bytes = fs.statSync(result.filePath).size;
  if (bytes < 5000) throw new Error(`Package looks too small: ${bytes} bytes`);
  if (!result.note) throw new Error("Read-only provenance note was not shown after export");
  log(`verified package ${result.filePath} (${bytes} bytes) · ${result.stats}`);
  await screenshot("03-package-verified");

  const zip = fs.readFileSync(result.filePath);
  if (zip.readUInt32LE(0) !== 0x04034b50) throw new Error("Exported file is not a ZIP archive");

  if (errors.length > 0) {
    for (const error of errors) log(`ERROR ${error}`);
    throw new Error(`${errors.length} console/page error(s) detected`);
  }
  log("PASS: package export dialog planned, exported and verified a Unity package through the UI");
  fs.writeFileSync(
    path.join(SHOT_DIR, "result.json"),
    JSON.stringify({ filePath: result.filePath, bytes, stats: result.stats }, null, 2)
  );
}

main()
  .then(async () => {
    await shutdown();
    process.exit(0);
  })
  .catch(async (error) => {
    log(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
    if (ws) {
      try {
        const shot = await send("Page.captureScreenshot", { format: "png" });
        fs.writeFileSync(path.join(SHOT_DIR, "failure.png"), Buffer.from(shot.data, "base64"));
      } catch {
        // ignore
      }
    }
    await shutdown();
    process.exit(1);
  });
