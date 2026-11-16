import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const ELECTRON = path.join(ROOT, "node_modules", "electron", "dist", "electron.exe");
const PORT = 9334;
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-p4-profile-"));
const LOG_PATH = path.join(os.tmpdir(), "kirea-priority4-editing.log");
const SHOT_DIR = path.join(os.tmpdir(), "kirea-priority4-shots");
fs.mkdirSync(SHOT_DIR, { recursive: true });

const errors = [];
const notes = [];
let ws;
let child;
let nextId = 1;
const pending = new Map();

function log(line) {
  const text = `[${new Date().toISOString()}] ${line}`;
  console.log(text);
  fs.appendFileSync(LOG_PATH, `${text}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function waitFor(fn, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await sleep(250);
  }
  const body = await evaluate("document.body.innerText.slice(0, 4000)").catch(() => "");
  throw new Error(`Timed out waiting for ${label}\n--- body ---\n${body}`);
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
    "sidebar navigation"
  );
  notes.push("App shell rendered");
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
      if (process.platform === "win32") {
        execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
        });
      } else {
        child.kill();
      }
    } catch {
      // already gone
    }
    child = null;
    await sleep(1500);
  }
}

async function screenshot(name) {
  const shot = await send("Page.captureScreenshot", { format: "png" });
  const file = path.join(SHOT_DIR, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
  log(`screenshot: ${file}`);
}

function clickSelector(selector) {
  return evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.click();
    return true;
  })()`);
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

function clickTextContains(text, scope = "document") {
  return evaluate(`(() => {
    const root = ${scope};
    const nodes = Array.from(root.querySelectorAll('button, [role="tab"], a'));
    const target = nodes.find(
      (node) => (node.textContent || "").includes(${JSON.stringify(text)}) && !node.disabled
    );
    if (!target) return false;
    target.click();
    return true;
  })()`);
}

async function click(text, scope = "document") {
  const clicked = (await clickText(text, scope)) || (await clickTextContains(text, scope));
  if (!clicked) throw new Error(`No clickable element matched "${text}"`);
  log(`clicked: ${text}`);
}

async function clickAria(label) {
  const selector = `[aria-label=${JSON.stringify(label)}]`;
  const clicked = await clickSelector(selector);
  if (!clicked) throw new Error(`No element with aria-label "${label}"`);
  log(`clicked aria: ${label}`);
}

function setInput(selector, value) {
  return evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    const proto = el instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
}

async function setPlaceholder(placeholder, value) {
  const ok = await setInput(`input[placeholder=${JSON.stringify(placeholder)}]`, value);
  if (!ok) throw new Error(`No input with placeholder "${placeholder}"`);
  log(`filled ${placeholder}`);
}

function selectByOptionText(match) {
  return evaluate(`(() => {
    const selects = Array.from(document.querySelectorAll('select'));
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
      return { value: option.value, text: option.textContent };
    }
    return null;
  })()`);
}

async function selectFrame(index) {
  const result = await evaluate(`(() => {
    const selects = Array.from(document.querySelectorAll('select'));
    const select = selects.find((entry) =>
      Array.from(entry.options).some((option) => /^1\\. /.test(option.textContent || ""))
    );
    if (!select) return false;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(
      select,
      String(${index})
    );
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  if (!result) throw new Error("Frame selector not found");
  log(`selected frame ${index + 1}`);
}

async function drawOnCanvas(clientX, clientY) {
  const box = await evaluate(`(() => {
    const canvas = document.querySelector('canvas[aria-label="Pixel canvas"]');
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  })()`);
  if (!box) throw new Error("Pixel canvas not found");
  const x = box.left + (clientX ?? box.width / 2);
  const y = box.top + (clientY ?? box.height / 2);
  await evaluate(`(() => {
    const canvas = document.querySelector('canvas[aria-label="Pixel canvas"]');
    const rect = canvas.getBoundingClientRect();
    const x = rect.left + ${Number(x)} - rect.left;
    const y = rect.top + ${Number(y)} - rect.top;
    const opts = { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 1, clientX: x, clientY: y };
    canvas.dispatchEvent(new PointerEvent("pointerdown", opts));
    canvas.dispatchEvent(new PointerEvent("pointermove", { ...opts, clientX: x + 8, clientY: y + 8 }));
    canvas.dispatchEvent(new PointerEvent("pointerup", { ...opts, buttons: 0, clientX: x + 8, clientY: y + 8 }));
    return true;
  })()`);
  log(`drew at ${Math.round(x)},${Math.round(y)}`);
}

async function assetApi(expression) {
  return evaluate(`(async () => {
    const assets = await window.kirea.listPixelAssets();
    ${expression}
  })()`);
}

async function targetAsset() {
  const assets = await assetApi(`
    const target = assets.find((asset) => asset.name === "UI Roundtrip Hero Front");
    if (!target) return null;
    const detail = await window.kirea.getPixelAsset(target.id);
    return {
      id: target.id,
      name: target.name,
      version: detail.version,
      width: detail.width,
      height: detail.height,
      frameCount: detail.frames.length,
      palette: detail.palette,
      animations: detail.animations,
    };
  `);
  if (!assets) throw new Error("Target asset was not found");
  return assets;
}

async function snapshotAssets() {
  return assetApi(`
    const out = {};
    for (const asset of assets) {
      const detail = await window.kirea.getPixelAsset(asset.id);
      out[asset.id] = {
        name: asset.name,
        version: detail.version,
        frames: detail.frames.map((frame) => ({ id: frame.id, check: frame.dataUrl.length + ":" + frame.dataUrl.slice(-24) })),
        animations: detail.animations,
      };
    }
    return out;
  `);
}

async function bodyHas(text) {
  return evaluate(
    `document.body.innerText.toLowerCase().includes(${JSON.stringify(text.toLowerCase())})`
  );
}

function textHas(text) {
  return evaluate(
    `document.body.textContent.toLowerCase().includes(${JSON.stringify(text.toLowerCase())})`
  );
}

async function waitBody(text, label, timeoutMs = 20000) {
  await waitFor(() => bodyHas(text), label ?? text, timeoutMs);
}

function waitButton(text, timeoutMs = 20000) {
  return waitFor(
    () =>
      evaluate(
        `Array.from(document.querySelectorAll('button')).some((button) => (button.textContent || '').trim() === ${JSON.stringify(text)} && !button.disabled)`
      ),
    `button ${text}`,
    timeoutMs
  );
}

function versionAction(version, action) {
  return evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return false;
    const cards = Array.from(dialog.querySelectorAll("div.border.rounded-lg"));
    const card = cards.find((entry) => {
      const label = Array.from(entry.querySelectorAll("p")).find((node) =>
        new RegExp("^v" + ${JSON.stringify(String(version))} + "$").test((node.textContent || "").trim())
      );
      return Boolean(label);
    });
    if (!card) return false;
    const target = Array.from(card.querySelectorAll("button")).find(
      (button) => (button.textContent || "").trim() === ${JSON.stringify(action)} && !button.disabled
    );
    if (!target) return false;
    target.click();
    return true;
  })()`);
}

async function waitForCanvas() {
  await waitFor(
    () => evaluate("!!document.querySelector('canvas[aria-label=\"Pixel canvas\"]')"),
    "editor canvas"
  );
}

async function waitEditorReady() {
  await sleep(500);
  await waitForCanvas();
  await waitFor(
    async () => !(await bodyHas("Decoding frames")),
    "editor decode complete"
  );
  await sleep(250);
}

async function frameOptionCount() {
  return evaluate(`(() => {
    const select = Array.from(document.querySelectorAll('select')).find((entry) =>
      Array.from(entry.options).some((option) => /^1\\. /.test(option.textContent || ""))
    );
    if (!select) return -1;
    return Array.from(select.options).filter((option) => /^\\d+\\. /.test(option.textContent || "")).length;
  })()`);
}

async function setDrawingColor(hex) {
  await evaluate(`(() => {
    const color = document.querySelector('[aria-label="Drawing colour"]');
    const input = color.parentElement.querySelector('input:not([type="color"])');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, ${JSON.stringify(hex)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    setter.call(color, ${JSON.stringify(hex)});
    color.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  await sleep(120);
}

async function openPixelStudio() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    await clickAria("Pixel Studio");
    await sleep(900);
    if (await bodyHas("Pixelbolt 0.17")) return;
  }
  throw new Error("Pixel Studio did not become active");
}

async function main() {
  fs.writeFileSync(LOG_PATH, "");
  await launch();
  await openPixelStudio();
  notes.push("Pixel Studio page rendered");

  const nav = `document.querySelector('[aria-label="Pixel Studio sections"]')`;
  await click("Characters", nav);
  await waitBody("New character identity", "character studio");

  await setPlaceholder("e.g. Sela, courier of the low quarter", "UI Roundtrip Hero");
  await click("Create character");
  await waitButton("Render 4 facings");
  await click("Render 4 facings");
  await waitFor(
    async () => (await assetApi("return assets.filter((asset) => asset.name.startsWith('UI Roundtrip Hero')).length;")) >= 4,
    "four directional assets",
    30000
  );
  notes.push("Created character identity and rendered 4 facings through UI");
  await screenshot("01-character");

  const before = await snapshotAssets();
  const target = await targetAsset();
  log(`target asset: ${JSON.stringify(target)}`);

  await click("Library", nav);
  await waitButton("Open editor");
  const opened = await clickSelector(`[aria-label="Open editor"]`);
  if (!opened) await click("Open editor");
  await waitEditorReady();
  notes.push("Opened asset in editor from Library");

  await evaluate(`(() => {
    const selects = Array.from(document.querySelectorAll('select'));
    const target = selects.find((select) =>
      Array.from(select.options).some((option) => (option.textContent || "").includes("UI Roundtrip Hero Front"))
    );
    if (!target) return false;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(
      target,
      Array.from(target.options).find((option) => (option.textContent || "").includes("UI Roundtrip Hero Front")).value
    );
    target.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  await waitFor(
    () => evaluate("document.body.innerText.includes('UI Roundtrip Hero Front')"),
    "editor target asset"
  );
  await waitEditorReady();

  await setDrawingColor("#ff00ff");
  await clickAria("Add the current colour to the asset palette");
  await waitBody("#ff00ff", "palette addition");
  notes.push("Added an asset palette colour through UI");

  await evaluate(`(() => {
    const replacement = document.querySelector('[aria-label="Replacement colour"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(replacement, "#00ff00");
    replacement.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  await click("Replace");
  await waitBody("#00ff00", "global replace");
  notes.push("Applied global palette replacement through UI");

  await click("Pencil");
  await drawOnCanvas();
  await waitBody("Unsaved", "unsaved frame edit");
  await click("Save version");
  await waitBody("v2", "version 2 badge", 30000);
  notes.push("Saved pixel + palette edits as v2");

  let after = await targetAsset();
  if (after.version !== 2) throw new Error(`Expected v2, found v${after.version}`);
  if (!after.palette.includes("#ff00ff")) throw new Error("Palette addition was not persisted");

  const siblings = Object.entries(before).filter(([id]) => id !== target.id);
  for (const [id, snapshot] of siblings) {
    const current = await assetApi(`
      const detail = await window.kirea.getPixelAsset(${JSON.stringify(id)});
      return {
        version: detail.version,
        checks: detail.frames.map((frame) => frame.dataUrl.length + ":" + frame.dataUrl.slice(-24)),
        animations: detail.animations,
      };
    `);
    if (current.version !== snapshot.version) throw new Error(`Sibling ${snapshot.name} changed version`);
    const expected = snapshot.frames.map((frame) => frame.check);
    if (JSON.stringify(current.checks) !== JSON.stringify(expected)) {
      throw new Error(`Sibling ${snapshot.name} artwork changed`);
    }
    if (JSON.stringify(current.animations) !== JSON.stringify(snapshot.animations)) {
      throw new Error(`Sibling ${snapshot.name} clip membership changed`);
    }
  }
  notes.push("Workflow C: editing one facing left the other three facing assets and lineage untouched");
  await screenshot("02-editor-v2");

  await selectFrame(1);
  await setDrawingColor("#00ffff");
  await drawOnCanvas(48, 48);
  const framesBeforeDuplicate = await frameOptionCount();
  await click("Duplicate frame");
  await waitBody("Unsaved", "duplicate unsaved");
  const framesAfterDuplicate = await frameOptionCount();
  if (framesAfterDuplicate !== framesBeforeDuplicate + 1) {
    throw new Error("Duplicate frame did not add a frame in the editor");
  }
  await clickAria("Undo");
  await waitFor(
    async () => (await frameOptionCount()) === framesBeforeDuplicate,
    "undo duplicate frame"
  );
  await click("Revert frame");
  await setDrawingColor("#00ffff");
  await drawOnCanvas(48, 48);
  await click("Save version");
  await waitBody("v3", "version 3 badge", 30000);
  notes.push("Workflow B: edited frame 2 only, exercised duplicate/undo/revert, saved v3");

  const frameAfter = await assetApi(`
    const detail = await window.kirea.getPixelAsset(${JSON.stringify(target.id)});
    const previous = await window.kirea.getPixelAssetVersion(${JSON.stringify(target.id)}, 2);
    return {
      version: detail.version,
      frameCount: detail.frames.length,
      previousFrameCount: previous.frames.length,
      animations: detail.animations,
      previousAnimations: previous.animations,
      changed: detail.frames.map((frame, index) => frame.dataUrl !== previous.frames[index]?.dataUrl),
    };
  `);
  if (frameAfter.version !== 3) throw new Error(`Expected v3, found v${frameAfter.version}`);
  if (JSON.stringify(frameAfter.animations) !== JSON.stringify(frameAfter.previousAnimations)) {
    throw new Error("Animation clip membership changed after frame edit");
  }
  if (!frameAfter.changed[1] || frameAfter.changed.filter(Boolean).length !== 1) {
    throw new Error(`Expected only frame 2 to change, got ${JSON.stringify(frameAfter.changed)}`);
  }
  if (frameAfter.frameCount !== frameAfter.previousFrameCount) {
    throw new Error("Duplicate/revert changed the saved frame count");
  }

  await click("Compare with saved");
  await waitBody("Comparing", "compare mode");
  await screenshot("03-frame-compare");
  await click("Compare with saved");

  await click("Open character");
  await waitButton("Save changes");
  notes.push("Opened parent character from the editor identity panel");
  await click("Library", nav);
  await waitButton("Open editor");

  await clickAria(`Version history for ${target.name}`);
  await waitBody("Version history", "version history modal");
  await waitBody("v1", "version list");
  if (!(await versionAction(1, "Compare"))) throw new Error("Could not compare v1");
  await waitBody("Compare current", "version compare");
  await screenshot("04-version-compare");
  if (!(await versionAction(1, "Restore"))) throw new Error("Could not open restore for v1");
  await waitButton("Restore as new version");
  await click("Restore as new version");
  await waitBody("v4", "restored v4", 30000);
  notes.push("Workflow D: restored v1 as v4 from the version history modal");
  const restored = await assetApi(`
    const detail = await window.kirea.getPixelAsset(${JSON.stringify(target.id)});
    const versions = await window.kirea.listPixelAssetVersions(${JSON.stringify(target.id)});
    const first = await window.kirea.getPixelAssetVersion(${JSON.stringify(target.id)}, 1);
    return {
      version: detail.version,
      width: detail.width,
      height: detail.height,
      palette: detail.palette,
      frameCount: detail.frames.length,
      firstWidth: first.width,
      firstHeight: first.height,
      firstPalette: first.palette,
      firstFrames: first.frames.length,
      versions: versions.map((entry) => entry.version),
    };
  `);
  if (restored.version !== 4) throw new Error(`Expected v4, found v${restored.version}`);
  if (JSON.stringify(restored.versions) !== JSON.stringify([4, 3, 2, 1])) {
    throw new Error(`Unexpected version list ${JSON.stringify(restored.versions)}`);
  }
  if (
    restored.width !== restored.firstWidth ||
    restored.height !== restored.firstHeight ||
    JSON.stringify(restored.palette) !== JSON.stringify(restored.firstPalette) ||
    restored.frameCount !== restored.firstFrames
  ) {
    throw new Error("Restored v4 does not match v1 dimensions/palette/frames");
  }
  notes.push("Restored contents, dimensions, transparency metadata and newer versions verified");
  await screenshot("05-restored-v4");

  await shutdown();
  await launch();
  await openPixelStudio();
  await click("Library", nav);
  await waitBody("UI Roundtrip Hero Front", "persisted library");
  await clickAria(`Version history for ${target.name}`);
  await waitBody("v4", "persisted current version");
  await waitBody("v1", "persisted older version");
  const reopened = await assetApi(`
    const versions = await window.kirea.listPixelAssetVersions(${JSON.stringify(target.id)});
    const detail = await window.kirea.getPixelAsset(${JSON.stringify(target.id)});
    return { version: detail.version, versions: versions.map((entry) => entry.version), frameCount: detail.frames.length };
  `);
  if (reopened.version !== 4) throw new Error(`After restart expected v4, found v${reopened.version}`);
  if (JSON.stringify(reopened.versions) !== JSON.stringify([4, 3, 2, 1])) {
    throw new Error(`After restart versions were ${JSON.stringify(reopened.versions)}`);
  }
  notes.push("Workflow A/D restart persistence verified: v4 current and v1-v4 recoverable");
  await screenshot("06-reopen");

  log(`notes: ${notes.join(" | ")}`);
  log(`profile: ${PROFILE}`);
  if (errors.length > 0) {
    for (const error of errors) log(`ERROR ${error}`);
    throw new Error(`${errors.length} console/page error(s) detected`);
  }
  log("PASS: all Priority 4 round-trip workflows verified through the UI");
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
