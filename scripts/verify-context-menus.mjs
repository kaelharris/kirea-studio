import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const ELECTRON = path.join(ROOT, "node_modules", "electron", "dist", "electron.exe");
const PORT = 9455;
const ARTIFACT_DIR = "C:\\Users\\Harris\\.gemini\\antigravity\\brain\\489779a3-e857-4bc4-accf-9207845b6d60";
const VERIFICATION_DIR = path.resolve(ROOT, "..", "verification");

fs.mkdirSync(VERIFICATION_DIR, { recursive: true });

let ws;
let child;
let nextId = 1;
const pending = new Map();
const errors = [];
const notes = [];

function log(line) {
  const text = `[${new Date().toISOString()}] ${line}`;
  console.log(text);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function waitFor(fn, label, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await fn()) return true;
    } catch {
      // retry
    }
    await sleep(250);
  }
  const body = await evaluate("document.body.innerText.slice(0, 2000)").catch(() => "");
  throw new Error(`Timed out waiting for ${label}\n--- Page excerpt ---\n${body}`);
}

async function waitForTarget(timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const splash = targets.find((target) => String(target.url).includes("splash.html"));
        const main = targets.find(
          (target) =>
            target.type === "page" &&
            String(target.url).startsWith("file:") &&
            String(target.url).includes("index.html")
        );
        if (main && !splash && main.webSocketDebuggerUrl) return main;
      }
    } catch {
      // booting
    }
    await sleep(400);
  }
  throw new Error("Timed out waiting for Electron main window target.");
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
      const msg = message.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
      // Ignore innocuous websocket connection errors if any
      if (!msg.includes("WebSocket connection") && !msg.includes("favicon")) {
        errors.push(`console.error: ${msg}`);
      }
    }
  });
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
}

async function captureScreenshot(name) {
  await sleep(300);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  const buffer = Buffer.from(shot.data, "base64");

  const artifactPath = path.join(ARTIFACT_DIR, `${name}.png`);
  const verificationPath = path.join(VERIFICATION_DIR, `${name}.png`);

  fs.writeFileSync(artifactPath, buffer);
  fs.writeFileSync(verificationPath, buffer);
  log(`[SCREENSHOT] Saved ${name}.png (${(buffer.length / 1024).toFixed(1)} KB) to artifacts & verification`);
}

async function triggerContextMenu(selector, offsetX = 0.5, offsetY = 0.5) {
  const result = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return { success: false, reason: "Element not found" };
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return { success: false, reason: "Element zero size" };
    const clientX = Math.round(rect.left + rect.width * ${offsetX});
    const clientY = Math.round(rect.top + rect.height * ${offsetY});
    const ev = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      view: window,
      button: 2,
      buttons: 2,
      clientX,
      clientY
    });
    el.dispatchEvent(ev);
    return { success: true, clientX, clientY };
  })()`);
  if (!result.success) {
    throw new Error(`Failed to trigger context menu on "${selector}": ${result.reason}`);
  }
  return result;
}

async function dismissMenu() {
  await evaluate(`(() => {
    const ev = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true });
    window.dispatchEvent(ev);
  })()`);
  await sleep(150);
}

async function clickNav(title) {
  log(`[NAV] Navigating to ${title}...`);
  const ok = await evaluate(`(() => {
    const btn = document.querySelector('button[title="${title}"]');
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  if (!ok) throw new Error(`Navigation button "${title}" not found`);
  await sleep(400);
}

async function shutdown() {
  if (ws) {
    try {
      ws.close();
    } catch {}
    ws = null;
  }
  if (child) {
    try {
      if (process.platform === "win32") {
        execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      } else {
        child.kill();
      }
    } catch {}
    child = null;
    await sleep(1000);
  }
}

async function main() {
  log("=== KIREA Studio v1.0.9 — Context Menu Visual Verification Runner ===");

  log("[LAUNCH] Spawning Electron with remote debugging...");
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(ELECTRON, ["--remote-debugging-port=" + PORT, "."], {
    cwd: ROOT,
    env,
    stdio: "ignore",
    detached: false,
  });

  await connect();
  log("[CONNECTED] CDP connected to renderer target.");

  await waitFor(
    () => evaluate("document.body.innerText.includes('Kirea') || !!document.querySelector('aside')"),
    "App UI initialization"
  );
  log("[READY] App UI loaded.");
  await sleep(1500);

  // --------------------------------------------------------------------------
  // TEST 1: Creation Page - Prompt Composer Context Menu
  // --------------------------------------------------------------------------
  log("\n--- TEST 1: Prompt Composer Context Menu ---");
  await clickNav("Create");
  await waitFor(
    () => evaluate("!!document.querySelector('textarea')"),
    "Prompt composer textarea"
  );
  // Focus and insert sample text into textarea
  await evaluate(`(() => {
    const ta = document.querySelector('textarea');
    if (ta) {
      ta.value = "masterpiece, 1girl, silver hair, cyber jacket, glowing neon ambient, 8k anime render";
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.dispatchEvent(new Event('change', { bubbles: true }));
    }
  })()`);
  await sleep(300);

  // Right-click prompt textarea
  log("[ACTION] Right-clicking prompt composer textarea...");
  await triggerContextMenu("textarea", 0.3, 0.4);
  await waitFor(
    () => evaluate("!!document.querySelector('[role=\"menu\"]')"),
    "Prompt composer context menu"
  );
  const promptMenuItems = await evaluate(`(() => {
    const items = Array.from(document.querySelectorAll('[role=\"menu\"] [role=\"menuitem\"]'));
    return items.map(i => i.innerText.trim());
  })()`);
  log(`[VERIFIED] Prompt menu items found: ${promptMenuItems.join(" | ")}`);
  notes.push(`Prompt Composer Context Menu: ${promptMenuItems.length} actions (${promptMenuItems.slice(0, 4).join(", ")}...)`);
  await captureScreenshot("prompt-composer-context-menu");
  await dismissMenu();

  // --------------------------------------------------------------------------
  // TEST 2: Creation Page - Generation Result / Carousel Context Menu
  // --------------------------------------------------------------------------
  log("\n--- TEST 2: Generation Result / Recent Thumbnail Context Menu ---");
  // Check if a thread image or thumbnail exists
  await evaluate(`(() => {
    const threadImg = document.querySelector('ol li button, button[title*=\"seed\"], [data-thumbnail-item]');
    if (!threadImg) return;
    const rect = threadImg.getBoundingClientRect();
    const ev = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      view: window,
      button: 2,
      buttons: 2,
      clientX: Math.round(rect.left + rect.width / 2),
      clientY: Math.round(rect.top + rect.height / 2)
    });
    threadImg.dispatchEvent(ev);
  })()`);
  await waitFor(
    () => evaluate("!!document.querySelector('[role=\"menu\"]')"),
    "Generation result context menu"
  );
  const resultMenuItems = await evaluate(`(() => {
    const items = Array.from(document.querySelectorAll('[role=\"menu\"] [role=\"menuitem\"]'));
    return items.map(i => i.innerText.trim());
  })()`);
  log(`[VERIFIED] Generation result menu items: ${resultMenuItems.join(" | ")}`);
  notes.push(`Generation Result Context Menu: ${resultMenuItems.join(", ")}`);
  await captureScreenshot("create-result-context-menu");
  await dismissMenu();

  // --------------------------------------------------------------------------
  // TEST 3: Creation Page - Editing Canvas (Inpaint Mode) Context Menu
  // --------------------------------------------------------------------------
  log("\n--- TEST 3: Editing Canvas (Inpaint Mode) Context Menu ---");
  // Switch to Advanced Mode
  log("[ACTION] Switching to Advanced Mode...");
  await evaluate(`(() => {
    const advBtn = Array.from(document.querySelectorAll('button[role=\"tab\"]')).find(b => b.textContent && b.textContent.includes('Advanced'));
    if (advBtn) advBtn.click();
  })()`);
  await sleep(500);

  // Click Inpaint tab in WorkflowSelector
  log("[ACTION] Selecting Inpaint workflow...");
  await evaluate(`(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const inpaintBtn = btns.find(b => b.textContent && b.textContent.includes('Inpaint'));
    if (inpaintBtn) inpaintBtn.click();
  })()`);
  await sleep(600);

  // Right-click on the canvas or editing area
  log("[ACTION] Right-clicking editing canvas area...");
  await evaluate(`(() => {
    const target = document.querySelector('canvas') || document.querySelector('[data-editing-canvas]') || document.querySelector('#create-center-stage') || document.querySelector('main');
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const ev = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      view: window,
      button: 2,
      buttons: 2,
      clientX: Math.round(rect.left + rect.width / 2),
      clientY: Math.round(rect.top + rect.height / 2)
    });
    target.dispatchEvent(ev);
  })()`);
  await waitFor(
    () => evaluate("!!document.querySelector('[role=\"menu\"]')"),
    "Editing canvas context menu"
  );
  const canvasMenuItems = await evaluate(`(() => {
    const items = Array.from(document.querySelectorAll('[role=\"menu\"] [role=\"menuitem\"]'));
    return items.map(i => i.innerText.trim());
  })()`);
  log(`[VERIFIED] Editing canvas menu items: ${canvasMenuItems.join(" | ")}`);
  notes.push(`Editing Canvas Context Menu: ${canvasMenuItems.join(", ")}`);
  await captureScreenshot("editing-canvas-context-menu");
  await dismissMenu();

  // --------------------------------------------------------------------------
  // TEST 4: Library Page - Artwork Context Menu
  // --------------------------------------------------------------------------
  log("\n--- TEST 4: Library Page Artwork Context Menu ---");
  await clickNav("Library");
  await waitFor(
    () => evaluate("!!document.querySelector('[data-media-card], .group.relative')"),
    "Library media cards"
  );
  await sleep(600);

  log("[ACTION] Right-clicking first library artwork card...");
  await evaluate(`(() => {
    const card = document.querySelector('[data-media-card]') || document.querySelector('.group.relative');
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const ev = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      view: window,
      button: 2,
      buttons: 2,
      clientX: Math.round(rect.left + rect.width / 2),
      clientY: Math.round(rect.top + rect.height / 2)
    });
    card.dispatchEvent(ev);
  })()`);
  await waitFor(
    () => evaluate("!!document.querySelector('[role=\"menu\"]')"),
    "Library artwork context menu"
  );
  const libraryMenuItems = await evaluate(`(() => {
    const items = Array.from(document.querySelectorAll('[role=\"menu\"] [role=\"menuitem\"]'));
    return items.map(i => i.innerText.trim());
  })()`);
  log(`[VERIFIED] Library menu items: ${libraryMenuItems.join(" | ")}`);
  notes.push(`Library Artwork Context Menu: ${libraryMenuItems.join(", ")}`);
  await captureScreenshot("library-context-menu");
  await dismissMenu();

  // --------------------------------------------------------------------------
  // TEST 5: Model Hub Context Menu
  // --------------------------------------------------------------------------
  log("\n--- TEST 5: Model Hub Context Menu ---");
  await clickNav("Models");
  await waitFor(
    () => evaluate("document.body.innerText.includes('Model') || !!document.querySelector('input[placeholder*=\"Search\"]')"),
    "Model Hub page"
  );
  await sleep(800);

  // Look for a model card in installed list or catalog
  const hasModelCard = await evaluate(`(() => {
    const card = document.querySelector('.grid [tabindex=\"0\"], .grid .border-border, [data-model-card]');
    return Boolean(card);
  })()`);
  log(`[STATE] Model card present: ${hasModelCard}`);

  if (hasModelCard) {
    log("[ACTION] Right-clicking model card...");
    await evaluate(`(() => {
      const card = document.querySelector('.grid [tabindex=\"0\"], .grid .border-border, [data-model-card]');
      if (!card) return;
      const rect = card.getBoundingClientRect();
      const ev = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        view: window,
        button: 2,
        buttons: 2,
        clientX: Math.round(rect.left + rect.width / 2),
        clientY: Math.round(rect.top + rect.height / 2)
      });
      card.dispatchEvent(ev);
    })()`);
  } else {
    // Right click empty vault
    log("[ACTION] Right-clicking model vault background...");
    await evaluate(`(() => {
      const container = document.querySelector('main');
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const ev = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        view: window,
        button: 2,
        buttons: 2,
        clientX: Math.round(rect.left + rect.width / 2),
        clientY: Math.round(rect.top + rect.height / 2)
      });
      container.dispatchEvent(ev);
    })()`);
  }
  await waitFor(
    () => evaluate("!!document.querySelector('[role=\"menu\"]')"),
    "Model Hub context menu"
  );
  const modelMenuItems = await evaluate(`(() => {
    const items = Array.from(document.querySelectorAll('[role=\"menu\"] [role=\"menuitem\"]'));
    return items.map(i => i.innerText.trim());
  })()`);
  log(`[VERIFIED] Model Hub menu items: ${modelMenuItems.join(" | ")}`);
  notes.push(`Model Hub Context Menu: ${modelMenuItems.join(", ")}`);
  await captureScreenshot("model-hub-context-menu");
  await dismissMenu();

  // --------------------------------------------------------------------------
  // TEST 6: Character Studio Context Menu
  // --------------------------------------------------------------------------
  log("\n--- TEST 6: Character Studio Context Menu ---");
  await clickNav("Characters");
  await waitFor(
    () => evaluate("document.body.innerText.includes('Character')"),
    "Character Studio page"
  );
  await sleep(800);

  log("[ACTION] Right-clicking character card...");
  await evaluate(`(() => {
    // Look for the seeded character card (e.g. Kirea Mascot)
    const cards = Array.from(document.querySelectorAll('.grid > div, .grid > button, [data-character-card]'));
    const target = cards.find(c => c.textContent && c.textContent.includes('Kirea Mascot')) || cards[0] || document.querySelector('main');
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const ev = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      view: window,
      button: 2,
      buttons: 2,
      clientX: Math.round(rect.left + rect.width / 2),
      clientY: Math.round(rect.top + rect.height / 2)
    });
    target.dispatchEvent(ev);
  })()`);
  await waitFor(
    () => evaluate("!!document.querySelector('[role=\"menu\"]')"),
    "Character Studio context menu"
  );
  const characterMenuItems = await evaluate(`(() => {
    const items = Array.from(document.querySelectorAll('[role=\"menu\"] [role=\"menuitem\"]'));
    return items.map(i => i.innerText.trim());
  })()`);
  log(`[VERIFIED] Character Studio menu items: ${characterMenuItems.join(" | ")}`);
  notes.push(`Character Studio Context Menu: ${characterMenuItems.join(", ")}`);
  await captureScreenshot("character-context-menu");
  await dismissMenu();

  log("\n=== ALL 6 CONTEXT MENUS SUCCESSFULLY VERIFIED & CAPTURED ===");
  log(`Notes:\n - ${notes.join("\n - ")}`);
}

main()
  .then(async () => {
    await shutdown();
    process.exit(0);
  })
  .catch(async (err) => {
    log(`[ERROR] Verification failed: ${err.message}`);
    if (ws) {
      try {
        const shot = await send("Page.captureScreenshot", { format: "png" });
        fs.writeFileSync(path.join(VERIFICATION_DIR, "context-menu-failure.png"), Buffer.from(shot.data, "base64"));
        log("[SCREENSHOT] Saved context-menu-failure.png");
      } catch {}
    }
    await shutdown();
    process.exit(1);
  });
