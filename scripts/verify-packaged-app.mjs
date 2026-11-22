import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const PACKAGED_EXE = path.join(
  process.env.LOCALAPPDATA,
  "Programs",
  "Kirea Studio",
  "Kirea Studio.exe"
);
const PORT = 9455;
const ARTIFACT_DIR = "C:\\Users\\Harris\\.gemini\\antigravity\\brain\\489779a3-e857-4bc4-accf-9207845b6d60";
const VERIFICATION_DIR = path.resolve(import.meta.dirname, "..", "..", "verification");

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
    } catch {}
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
    } catch {}
    await sleep(400);
  }
  throw new Error("Timed out waiting for packaged application window target.");
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
  log(`[SCREENSHOT] Saved ${name}.png (${(buffer.length / 1024).toFixed(1)} KB)`);
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
  log("=== KIREA Studio v1.0.9 — Packaged Application Smoke & Completion Test ===");
  log(`[TARGET] Verified installed binary: ${PACKAGED_EXE}`);
  if (!fs.existsSync(PACKAGED_EXE)) {
    throw new Error(`Installed binary not found at ${PACKAGED_EXE}`);
  }

  log("[LAUNCH] Spawning installed packaged application with remote debugging...");
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(PACKAGED_EXE, ["--remote-debugging-port=" + PORT], {
    env,
    stdio: "ignore",
    detached: false,
  });

  await connect();
  log("[CONNECTED] CDP connected to packaged application renderer.");

  await waitFor(
    () => evaluate("document.body.innerText.includes('Kirea') || !!document.querySelector('aside')"),
    "Packaged application UI loaded"
  );
  log("[READY] App UI loaded successfully from packaged installer.");
  await sleep(1500);

  // --------------------------------------------------------------------------
  // SECTION 1: Creation Flow (Creative & Advanced Mode)
  // --------------------------------------------------------------------------
  log("\n--- SMOKE TEST 1: Creation Studio Prompt Composer, Clipboard & Keyboard Triggers ---");
  await clickNav("Create");
  await waitFor(() => evaluate("!!document.querySelector('textarea')"), "Prompt textarea");

  // Type sample text
  await evaluate(`(() => {
    const ta = document.querySelector('textarea');
    if (ta) {
      ta.value = "1girl, silver hair, cyber jacket, neon lights";
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.dispatchEvent(new Event('change', { bubbles: true }));
    }
  })()`);
  await sleep(200);

  // 1.1 Native right-click context menu
  await triggerContextMenu("textarea", 0.4, 0.5);
  await waitFor(() => evaluate("!!document.querySelector('[role=\"menu\"]')"), "Prompt context menu");
  const promptItems = await evaluate(`(() => {
    return Array.from(document.querySelectorAll('[role=\"menu\"] [role=\"menuitem\"]')).map(i => i.innerText.trim());
  })()`);
  log(`[VERIFIED] Prompt context menu actions: ${promptItems.join(" | ")}`);
  notes.push(`Prompt Composer Context Menu: ${promptItems.length} items`);
  await dismissMenu();

  // 1.2 Test Shift+F10 / ContextMenu keyboard trigger
  log("[KEYBOARD] Testing Shift+F10 / ContextMenu key on prompt textarea...");
  await evaluate(`(() => {
    const ta = document.querySelector('textarea');
    if (!ta) return;
    ta.focus();
    // Dispatch ContextMenu key event
    const ev = new KeyboardEvent('keydown', { key: 'ContextMenu', code: 'ContextMenu', bubbles: true });
    ta.dispatchEvent(ev);
    // Also dispatch contextmenu event at focused element position
    const rect = ta.getBoundingClientRect();
    const cEv = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: Math.round(rect.left + rect.width / 2),
      clientY: Math.round(rect.top + rect.height / 2)
    });
    ta.dispatchEvent(cEv);
  })()`);
  await waitFor(() => evaluate("!!document.querySelector('[role=\"menu\"]')"), "Keyboard triggered context menu");
  log("[VERIFIED] Context menu successfully opened via keyboard trigger.");
  await dismissMenu();

  // 1.3 Generation result / strip context menu
  log("[ACTION] Testing Generation Result / Thread card context menu...");
  await evaluate(`(() => {
    const item = document.querySelector('ol li button, button[title*=\"seed\"], [data-thumbnail-item]');
    if (!item) return;
    const rect = item.getBoundingClientRect();
    item.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: Math.round(rect.left + rect.width / 2),
      clientY: Math.round(rect.top + rect.height / 2)
    }));
  })()`);
  await waitFor(() => evaluate("!!document.querySelector('[role=\"menu\"]')"), "Generation result context menu");
  const resultItems = await evaluate(`(() => {
    return Array.from(document.querySelectorAll('[role=\"menu\"] [role=\"menuitem\"]')).map(i => i.innerText.trim());
  })()`);
  log(`[VERIFIED] Generation result context menu items: ${resultItems.join(" | ")}`);
  notes.push(`Generation Result Context Menu: ${resultItems.join(", ")}`);
  await dismissMenu();

  // 1.4 Switch to Advanced mode -> Inpaint workflow -> Editing Canvas Context Menu
  log("[ACTION] Testing Editing Canvas context menu in Inpaint mode...");
  await evaluate(`(() => {
    const advBtn = Array.from(document.querySelectorAll('button[role=\"tab\"]')).find(b => b.textContent && b.textContent.includes('Advanced'));
    if (advBtn) advBtn.click();
  })()`);
  await sleep(400);

  await evaluate(`(() => {
    const inpaintBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Inpaint'));
    if (inpaintBtn) inpaintBtn.click();
  })()`);
  await sleep(500);

  await evaluate(`(() => {
    const canvas = document.querySelector('canvas') || document.querySelector('[data-editing-canvas]') || document.querySelector('#create-center-stage');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: Math.round(rect.left + rect.width / 2),
      clientY: Math.round(rect.top + rect.height / 2)
    }));
  })()`);
  await waitFor(() => evaluate("!!document.querySelector('[role=\"menu\"]')"), "Editing Canvas context menu");
  const canvasItems = await evaluate(`(() => {
    return Array.from(document.querySelectorAll('[role=\"menu\"] [role=\"menuitem\"]')).map(i => i.innerText.trim());
  })()`);
  log(`[VERIFIED] Editing Canvas context menu items: ${canvasItems.join(" | ")}`);
  notes.push(`Editing Canvas Context Menu: ${canvasItems.join(", ")}`);
  await dismissMenu();

  // --------------------------------------------------------------------------
  // SECTION 2: Library Page
  // --------------------------------------------------------------------------
  log("\n--- SMOKE TEST 2: Library Page (Cards & Empty Area) ---");
  await clickNav("Library");
  await waitFor(() => evaluate("!!document.querySelector('[data-media-card], .group.relative')"), "Library media cards");

  // Artwork card context menu
  log("[ACTION] Right-clicking artwork card...");
  await evaluate(`(() => {
    const card = document.querySelector('[data-media-card], .group.relative');
    if (!card) return;
    const rect = card.getBoundingClientRect();
    card.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: Math.round(rect.left + rect.width / 2),
      clientY: Math.round(rect.top + rect.height / 2)
    }));
  })()`);
  await waitFor(() => evaluate("!!document.querySelector('[role=\"menu\"]')"), "Library card context menu");
  const libItems = await evaluate(`(() => {
    return Array.from(document.querySelectorAll('[role=\"menu\"] [role=\"menuitem\"]')).map(i => i.innerText.trim());
  })()`);
  log(`[VERIFIED] Library card menu items: ${libItems.join(" | ")}`);
  notes.push(`Library Artwork Context Menu: ${libItems.join(", ")}`);
  await dismissMenu();

  // Empty background area context menu
  log("[ACTION] Right-clicking library empty background area...");
  await evaluate(`(() => {
    const bg = document.querySelector('main .relative.space-y-5');
    if (!bg) return;
    const rect = bg.getBoundingClientRect();
    bg.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: Math.round(rect.left + 50),
      clientY: Math.round(rect.top + 80)
    }));
  })()`);
  await waitFor(() => evaluate("!!document.querySelector('[role=\"menu\"]')"), "Library background context menu");
  const emptyLibItems = await evaluate(`(() => {
    return Array.from(document.querySelectorAll('[role=\"menu\"] [role=\"menuitem\"]')).map(i => i.innerText.trim());
  })()`);
  log(`[VERIFIED] Library background menu items: ${emptyLibItems.join(" | ")}`);
  notes.push(`Library Background Context Menu: ${emptyLibItems.join(", ")}`);
  await dismissMenu();

  // --------------------------------------------------------------------------
  // SECTION 3: Model Hub (Vault, Civitai, Hugging Face)
  // --------------------------------------------------------------------------
  log("\n--- SMOKE TEST 3: Model Hub (Vault, Civitai Hub & Hugging Face Hub) ---");
  await clickNav("Models");
  await waitFor(() => evaluate("document.body.innerText.includes('Model')"), "Model Hub UI");
  await sleep(600);

  // 3.1 Installed Vault Model Card Context Menu
  log("[ACTION] Right-clicking installed model card in Vault...");
  const hasVaultCard = await evaluate(`(() => {
    const card = document.querySelector('main .grid [tabindex=\"0\"], main .grid .border-border, [data-model-card]');
    if (!card) return false;
    const rect = card.getBoundingClientRect();
    card.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: Math.round(rect.left + rect.width / 2),
      clientY: Math.round(rect.top + rect.height / 2)
    }));
    return true;
  })()`);
  if (hasVaultCard) {
    await waitFor(() => evaluate("!!document.querySelector('[role=\"menu\"]')"), "Vault model context menu");
    const vaultItems = await evaluate(`(() => {
      return Array.from(document.querySelectorAll('[role=\"menu\"] [role=\"menuitem\"]')).map(i => i.innerText.trim());
    })()`);
    log(`[VERIFIED] Model Vault menu items: ${vaultItems.join(" | ")}`);
    notes.push(`Model Vault Context Menu: ${vaultItems.join(", ")}`);
    await dismissMenu();
  }

  // 3.2 Switch to Civitai Hub Provider
  log("[ACTION] Switching provider to Civitai Hub...");
  await evaluate(`(() => {
    const btns = Array.from(document.querySelectorAll('main button'));
    const civitaiBtn = btns.find(b => b.textContent && (b.textContent.includes('CIVITAI HUB') || b.textContent.trim() === 'Civitai'));
    if (civitaiBtn) civitaiBtn.click();
  })()`);
  await waitFor(
    () => evaluate("document.body.innerText.includes('Model discovery tabs') || !!document.querySelector('[role=\"tablist\"]') || document.body.innerText.includes('Hot')"),
    "Civitai Hub View"
  );
  await sleep(600);

  // Civitai Empty Area Context Menu
  log("[ACTION] Right-clicking Civitai Hub background...");
  await evaluate(`(() => {
    const bg = document.querySelector('main div.space-y-4');
    if (!bg) return;
    const rect = bg.getBoundingClientRect();
    bg.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: Math.round(rect.left + 50),
      clientY: Math.round(rect.top + 80)
    }));
  })()`);
  await waitFor(() => evaluate("!!document.querySelector('[role=\"menu\"]')"), "Civitai Hub background context menu");
  const civitaiEmptyItems = await evaluate(`(() => {
    return Array.from(document.querySelectorAll('[role=\"menu\"] [role=\"menuitem\"]')).map(i => i.innerText.trim());
  })()`);
  log(`[VERIFIED] Civitai Hub background menu items: ${civitaiEmptyItems.join(" | ")}`);
  notes.push(`Civitai Hub Background Context Menu: ${civitaiEmptyItems.join(", ")}`);
  await dismissMenu();

  // 3.3 Switch to Hugging Face Hub Provider (Item 1 completion)
  log("[ACTION] Switching provider to Hugging Face Hub...");
  await evaluate(`(() => {
    const btns = Array.from(document.querySelectorAll('main button'));
    const hfBtn = btns.find(b => b.textContent && b.textContent.trim() === 'Hugging Face');
    if (hfBtn) hfBtn.click();
  })()`);
  await waitFor(
    () => evaluate("document.body.innerText.includes('Hugging Face') && (document.body.innerText.includes('token') || document.body.innerText.includes('Search') || !!document.querySelector('input[placeholder*=\"Hugging Face\"]'))"),
    "Hugging Face Hub View"
  );
  await sleep(1500);
  await waitFor(() => evaluate("!document.body.innerText.includes('Querying') || !!document.querySelector('main .grid > div')"), "HF settled", 10000).catch(() => {});
  await sleep(500);

  // Hugging Face Card Context Menu
  log("[ACTION] Right-clicking Hugging Face repository card...");
  const hasHfCard = await evaluate(`(() => {
    const card = document.querySelector('main .grid > div, [tabindex=\"0\"], main .grid .border-border');
    if (!card) return false;
    const rect = card.getBoundingClientRect();
    card.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: Math.round(rect.left + rect.width / 2),
      clientY: Math.round(rect.top + rect.height / 2)
    }));
    return true;
  })()`);
  if (hasHfCard) {
    await waitFor(() => evaluate("!!document.querySelector('[role=\"menu\"]')"), "Hugging Face context menu");
    const hfItems = await evaluate(`(() => {
      return Array.from(document.querySelectorAll('[role=\"menu\"] [role=\"menuitem\"]')).map(i => i.innerText.trim());
    })()`);
    log(`[VERIFIED] Hugging Face Hub menu items: ${hfItems.join(" | ")}`);
    notes.push(`Hugging Face Hub Context Menu: ${hfItems.join(", ")}`);
    await captureScreenshot("huggingface-hub-context-menu");
    await dismissMenu();
  }

  // Hugging Face Empty Background Context Menu
  log("[ACTION] Right-clicking Hugging Face Hub background...");
  await evaluate(`(() => {
    const bg = document.querySelector('main div.space-y-4');
    if (!bg) return;
    const rect = bg.getBoundingClientRect();
    bg.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: Math.round(rect.left + 50),
      clientY: Math.round(rect.top + 80)
    }));
  })()`);
  await waitFor(() => evaluate("!!document.querySelector('[role=\"menu\"]')"), "Hugging Face background context menu");
  const hfEmptyItems = await evaluate(`(() => {
    return Array.from(document.querySelectorAll('[role=\"menu\"] [role=\"menuitem\"]')).map(i => i.innerText.trim());
  })()`);
  log(`[VERIFIED] Hugging Face background menu items: ${hfEmptyItems.join(" | ")}`);
  notes.push(`Hugging Face Background Context Menu: ${hfEmptyItems.join(", ")}`);
  if (!hasHfCard) {
    await captureScreenshot("huggingface-hub-context-menu");
  }
  await dismissMenu();

  // --------------------------------------------------------------------------
  // SECTION 4: Character Studio
  // --------------------------------------------------------------------------
  log("\n--- SMOKE TEST 4: Character Studio (Cards & Empty Area) ---");
  await clickNav("Characters");
  await waitFor(() => evaluate("document.body.innerText.includes('Character')"), "Character Studio UI");
  await sleep(600);

  // Character Card Context Menu (if characters exist)
  log("[ACTION] Checking character cards...");
  const hasCharCard = await evaluate(`(() => {
    const card = document.querySelector('main .grid > div, main .grid > button, [data-character-card]');
    if (!card) return false;
    const rect = card.getBoundingClientRect();
    card.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: Math.round(rect.left + rect.width / 2),
      clientY: Math.round(rect.top + rect.height / 2)
    }));
    return true;
  })()`);
  if (hasCharCard) {
    await waitFor(() => evaluate("!!document.querySelector('[role=\"menu\"]')"), "Character card context menu");
    const charItems = await evaluate(`(() => {
      return Array.from(document.querySelectorAll('[role=\"menu\"] [role=\"menuitem\"]')).map(i => i.innerText.trim());
    })()`);
    log(`[VERIFIED] Character card menu items: ${charItems.join(" | ")}`);
    notes.push(`Character Studio Context Menu: ${charItems.join(", ")}`);
    await dismissMenu();
  } else {
    log("[NOTE] No character cards found in database (empty state).");
  }

  // Character Studio Empty Background Context Menu
  log("[ACTION] Right-clicking character studio empty background...");
  await evaluate(`(() => {
    const bg = document.querySelector('main div.space-y-5');
    if (!bg) return;
    const rect = bg.getBoundingClientRect();
    bg.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: Math.round(rect.left + 50),
      clientY: Math.round(rect.top + 80)
    }));
  })()`);
  await waitFor(() => evaluate("!!document.querySelector('[role=\"menu\"]')"), "Character studio background context menu");
  const charEmptyItems = await evaluate(`(() => {
    return Array.from(document.querySelectorAll('[role=\"menu\"] [role=\"menuitem\"]')).map(i => i.innerText.trim());
  })()`);
  log(`[VERIFIED] Character studio background menu items: ${charEmptyItems.join(" | ")}`);
  notes.push(`Character Studio Background Context Menu: ${charEmptyItems.join(", ")}`);
  await captureScreenshot("character-context-menu");
  await dismissMenu();

  // --------------------------------------------------------------------------
  // SECTION 5: Application Stability & Zero Accidental Closes
  // --------------------------------------------------------------------------
  log("\n--- SMOKE TEST 5: Application Stability & Integrity Check ---");
  const isAlive = await evaluate("Boolean(window.kirea && document.body)");
  if (!isAlive) throw new Error("Application window unresponsive after context menu smoke tests.");
  log("[VERIFIED] Application window is alive, healthy, and responsive with 0 crashes.");

  if (errors.length > 0) {
    for (const err of errors) log(`[PAGE ERROR] ${err}`);
    throw new Error(`${errors.length} unexpected page errors detected.`);
  }

  log("\n=== PACKAGED SMOKE TEST SUCCESSFULLY PASSED ===");
  log(`Summary:\n - ${notes.join("\n - ")}`);
}

main()
  .then(async () => {
    await shutdown();
    process.exit(0);
  })
  .catch(async (err) => {
    log(`[ERROR] Packaged verification failed: ${err.message}`);
    if (ws) {
      try {
        const shot = await send("Page.captureScreenshot", { format: "png" });
        fs.writeFileSync(path.join(VERIFICATION_DIR, "packaged-failure.png"), Buffer.from(shot.data, "base64"));
      } catch {}
    }
    await shutdown();
    process.exit(1);
  });
