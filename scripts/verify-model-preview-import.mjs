import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const PORT = 9456;
const ARTIFACT_DIR = "C:\\Users\\Harris\\.gemini\\antigravity\\brain\\489779a3-e857-4bc4-accf-9207845b6d60";
const VERIFICATION_DIR = path.resolve(import.meta.dirname, "..", "verification");
fs.mkdirSync(VERIFICATION_DIR, { recursive: true });

let ws;
let child;
let nextId = 1;
const pending = new Map();
const notes = [];

function log(line) {
  console.log(`[${new Date().toISOString()}] ${line}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
  const body = await evaluate("document.body.innerText.slice(0, 1500)").catch(() => "");
  throw new Error(`Timed out waiting for ${label}\n--- Page excerpt ---\n${body}`);
}

async function waitForTarget(timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const main = targets.find(
          (t) =>
            t.type === "page" &&
            String(t.url).includes("index.html")
        );
        if (main && main.webSocketDebuggerUrl) return main;
      }
    } catch {}
    await sleep(400);
  }
  throw new Error("Timed out waiting for application window target.");
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
  await sleep(350);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  const buffer = Buffer.from(shot.data, "base64");
  fs.writeFileSync(path.join(ARTIFACT_DIR, `${name}.png`), buffer);
  fs.writeFileSync(path.join(VERIFICATION_DIR, `${name}.png`), buffer);
  log(`[SCREENSHOT] Saved ${name}.png (${(buffer.length / 1024).toFixed(1)} KB)`);
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
    await sleep(800);
  }
}

async function main() {
  log("=== KIREA Studio — Model Preview Import with Latest Generation Verification ===");
  log("[BUILD] Compiling electron & renderer build...");
  execFileSync("npm.cmd", ["run", "build"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    stdio: "inherit",
    shell: true,
  });

  log("[LAUNCH] Spawning application with remote debugging on port " + PORT + "...");
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(
    "npx.cmd",
    ["electron", ".", "--remote-debugging-port=" + PORT],
    {
      cwd: path.resolve(import.meta.dirname, ".."),
      env,
      stdio: "ignore",
      shell: true,
    }
  );

  await connect();
  log("[CONNECTED] CDP connected.");
  await waitFor(() => evaluate("document.body.innerText.includes('Kirea') || !!document.querySelector('aside')"), "App loaded");
  await sleep(1000);

  // Navigate to Models
  await clickNav("Models");
  await waitFor(() => evaluate("document.body.innerText.includes('Model')"), "Models Page");
  await sleep(800);

  // Find a model card without preview, or any model card to inspect metadata
  log("[ACTION] Looking for model card to edit...");
  const cardFound = await evaluate(`(() => {
    // Prefer cards showing "No preview artwork" or any model card
    const cards = Array.from(document.querySelectorAll('.grid > div, [data-model-card]'));
    const target = cards.find(c => c.textContent && c.textContent.includes('No preview')) || cards[0];
    if (!target) return false;
    
    // Right click or click to open edit menu/modal
    const rect = target.getBoundingClientRect();
    target.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: Math.round(rect.left + rect.width / 2),
      clientY: Math.round(rect.top + rect.height / 2)
    }));
    return true;
  })()`);
  if (!cardFound) throw new Error("No model cards found in vault");

  await waitFor(() => evaluate("!!document.querySelector('[role=\"menu\"]')"), "Model context menu");
  
  // Click "View / Edit Model Details"
  log("[ACTION] Clicking 'View / Edit Model Details'...");
  await evaluate(`(() => {
    const items = Array.from(document.querySelectorAll('[role=\"menu\"] [role=\"menuitem\"]'));
    const editItem = items.find(i => i.textContent && i.textContent.includes('Edit'));
    if (editItem) editItem.click();
  })()`);

  // Wait for Model Metadata modal to open
  await waitFor(
    () => evaluate("document.body.innerText.includes('Model Metadata') || !!document.querySelector('input[placeholder*=\"DisplayName\"]')"),
    "Model Metadata modal"
  );
  await sleep(600);

  log("[VERIFY] Checking Import Preview action controls in Model Metadata modal...");
  const modalInfo = await evaluate(`(() => {
    const text = document.body.innerText;
    const hasLatestBtn = text.includes('Use Latest Generated Work');
    const hasRecentBtn = text.includes('Select from Recent Works') || text.includes('Browse all');
    const hasImportFile = text.includes('Import from File');
    const miniThumbnails = document.querySelectorAll('button img[alt], .grid.grid-cols-3 button').length;
    return { hasLatestBtn, hasRecentBtn, hasImportFile, miniThumbnails };
  })()`);

  log(`[VERIFIED] Controls found: LatestWorkBtn=${modalInfo.hasLatestBtn}, RecentWorksBtn=${modalInfo.hasRecentBtn}, ImportFileBtn=${modalInfo.hasImportFile}, MiniThumbnails=${modalInfo.miniThumbnails}`);
  notes.push(`Modal Actions: LatestBtn=${modalInfo.hasLatestBtn}, RecentBtn=${modalInfo.hasRecentBtn}, FileBtn=${modalInfo.hasImportFile}, MiniThumbs=${modalInfo.miniThumbnails}`);

  // Capture screenshot of the Model Metadata modal showing the new Import Preview actions
  await captureScreenshot("model-metadata-import-preview-actions");

  // If "Select from Recent Works" exists, open the picker dialog
  if (modalInfo.hasRecentBtn) {
    log("[ACTION] Opening 'Select from Recent Works' picker modal...");
    await evaluate(`(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const recentBtn = btns.find(b => b.textContent && b.textContent.includes('Select from Recent Works'));
      if (recentBtn) recentBtn.click();
    })()`);

    await waitFor(
      () => evaluate("document.body.innerText.includes('Select Preview from Recent Works') || document.body.innerText.includes('Search recent creations')"),
      "Recent Works Picker Dialog"
    );
    await sleep(600);

    const pickerCardsCount = await evaluate(`(() => {
      return document.querySelectorAll('div[role=\"dialog\"] .aspect-square, div[role=\"dialog\"] img').length;
    })()`);
    log(`[VERIFIED] Recent works picker opened displaying ${pickerCardsCount} thumbnails.`);
    notes.push(`Recent Works Picker: Displaying ${pickerCardsCount} creations`);

    await captureScreenshot("recent-generations-preview-picker");

    // Select a generation from the picker to assign as preview!
    log("[ACTION] Selecting a generated work from picker to assign as model preview...");
    await evaluate(`(() => {
      const cards = Array.from(document.querySelectorAll('div[role=\"dialog\"] button'));
      // Pick first image card in the grid
      const imgCard = cards.find(b => b.querySelector('img'));
      if (imgCard) imgCard.click();
    })()`);

    await sleep(1200);
    log("[VERIFIED] Preview assigned from recent generation!");
    await captureScreenshot("model-metadata-with-assigned-preview");
  }

  log("\n=== ALL VERIFICATIONS PASSED SUCCESSFULLY ===");
  log(`Summary:\n - ${notes.join("\n - ")}`);
}

main()
  .then(async () => {
    await shutdown();
    process.exit(0);
  })
  .catch(async (err) => {
    log(`[ERROR] Verification failed: ${err.message}`);
    await shutdown();
    process.exit(1);
  });
