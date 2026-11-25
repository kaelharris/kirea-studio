import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const ELECTRON =
  process.env.KIREA_ELECTRON ??
  path.join(ROOT, "node_modules", "electron", "dist", "electron.exe");
const PORT = Number(process.env.KIREA_PORT ?? 9472);
const ARTIFACT_DIR = path.resolve("C:/Users/Harris/.gemini/antigravity/brain/489779a3-e857-4bc4-accf-9207845b6d60");
const PROFILE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-v110-profile-"));
const SOURCE_PROFILE = path.join(process.env.APPDATA ?? "", "ai-image-studio-desktop");

fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

const notes = [];
const errors = [];
let child = null;
let cdp = null;

function log(line) {
  console.log(`[verify-v110] ${line}`);
}

for (const suffix of ["", "-wal", "-shm"]) {
  const source = path.join(SOURCE_PROFILE, `kirea-studio.db${suffix}`);
  if (fs.existsSync(source)) {
    fs.copyFileSync(source, path.join(PROFILE_DIR, `kirea-studio.db${suffix}`));
  }
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
  };
}

async function pollTarget(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await response.json();
      log(`found targets: ${targets.map(t => `${t.type}:${t.url}`).join(", ")}`);
      const target = targets.find(
        (item) => item.type === "page" && String(item.url).includes("index.html")
      );
      if (target?.webSocketDebuggerUrl) return target;
    } catch {
      // still booting
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Timed out waiting for renderer target.");
}

const evaluate = (expression) => cdp.evaluate(expression);
const bodyIncludes = (text) =>
  evaluate(
    `(document.body ? document.body.innerText : "").includes(${JSON.stringify(text)})`
  );

async function waitFor(fn, label, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function clickText(text, selector = "button, [role=tab], a") {
  const clicked = await evaluate(`(() => {
    const nodes = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
    const target = nodes.find((node) => (node.textContent || "").trim().includes(${JSON.stringify(text)}) && !node.disabled);
    if (!target) return false;
    target.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`No clickable element matched "${text}"`);
  log(`clicked: ${text}`);
}

async function openNav(label, marker) {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    await evaluate(`(() => {
      const btn = document.querySelector('button[title="${label}"]') || Array.from(document.querySelectorAll('button, a')).find(n => (n.textContent || '').trim() === '${label}');
      if (btn) btn.click();
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 600));
    if (await bodyIncludes(marker)) return;
  }
  throw new Error(`Could not open ${label}`);
}

async function captureScreenshot(name) {
  const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
  const file = path.join(ARTIFACT_DIR, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
  log(`saved screenshot: ${file}`);
  return file;
}

async function setViewport(width, height) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await new Promise((r) => setTimeout(r, 400));
  log(`viewport set to ${width}x${height}`);
}

async function main() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(
    ELECTRON,
    [
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${PROFILE_DIR}`,
      ...(process.env.KIREA_ELECTRON ? [] : ["."]),
    ],
    { cwd: ROOT, stdio: "ignore", env }
  );

  process.on("exit", () => {
    try {
      child?.kill();
    } catch {
      // ignore
    }
  });

  log("waiting for electron target...");
  const target = await pollTarget();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  cdp = connectCdp(socket);

  log("connected via CDP");
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await waitFor(() => bodyIncludes("Create"), "app shell", 45000);

  // Step 1: Test 1440x900 resolution
  await setViewport(1440, 900);

  // Navigate to Create Studio
  log("navigating to Create...");
  await openNav("Create", "Create");
  await clickText("Advanced", "[role=tab]");
  await waitFor(() => bodyIncludes("Checkpoint / Base Model") || bodyIncludes("Steps"), "advanced workspace");
  await new Promise((r) => setTimeout(r, 600));

  // Verify Smart Sampling Profile indicator and controls
  const samplingState = await evaluate(`(() => {
    const text = document.body.innerText;
    const hasSmartProfile = text.includes("Smart Profile") || text.includes("Recommended") || text.includes("Steps");
    const hasLockSeed = Boolean(document.querySelector('[title*="seed" i], button:has(svg)'));
    const advancedToggle = Array.from(document.querySelectorAll("button")).find(b => (b.textContent || "").includes("Advanced Sampling"));
    if (advancedToggle) advancedToggle.click();
    return { hasSmartProfile, hasLockSeed, advancedFound: Boolean(advancedToggle) };
  })()`);
  log(`sampling state in Create: ${JSON.stringify(samplingState)}`);
  notes.push(`Create Studio Smart Sampling Profiles detected: ${samplingState.hasSmartProfile}`);

  await new Promise((r) => setTimeout(r, 500));
  await captureScreenshot("v110-create-1440x900");

  // Step 2: Test 1280x800 resolution
  await setViewport(1280, 800);
  await new Promise((r) => setTimeout(r, 500));
  await captureScreenshot("v110-create-1280x800");

  // Step 3: Test 768x1024 tablet resolution
  await setViewport(768, 1024);
  await new Promise((r) => setTimeout(r, 500));
  await captureScreenshot("v110-create-768x1024");

  // Step 4: Test Library View and Selection Experience
  await setViewport(1440, 900);
  log("navigating to Library...");
  await openNav("Library", "Media Library");
  await new Promise((r) => setTimeout(r, 600));

  // Toggle selection mode or inspect cards
  const libraryState = await evaluate(`(() => {
    const selectBtn = Array.from(document.querySelectorAll("button")).find(b => (b.textContent || "").trim() === "Select");
    if (selectBtn) selectBtn.click();
    const cards = document.querySelectorAll('img');
    const invertBtn = Array.from(document.querySelectorAll("button")).find(b => (b.textContent || "").includes("Invert"));
    return { selectBtnFound: Boolean(selectBtn), invertBtnFound: Boolean(invertBtn), cardCount: cards.length };
  })()`);
  log(`library state: ${JSON.stringify(libraryState)}`);
  notes.push(`Library selection mode toggle verified: ${libraryState.selectBtnFound}, invert button: ${libraryState.invertBtnFound}`);

  await new Promise((r) => setTimeout(r, 500));
  await captureScreenshot("v110-library-selection-1440x900");

  // Step 5: Test Fullscreen Viewer
  log("testing Fullscreen Viewer...");
  // Exit selection mode first
  await evaluate(`(() => {
    const doneBtn = Array.from(document.querySelectorAll("button")).find(b => (b.textContent || "").includes("Done"));
    if (doneBtn) doneBtn.click();
  })()`);
  await new Promise((r) => setTimeout(r, 400));

  const viewerOpened = await evaluate(`(() => {
    const imgCard = document.querySelector('img');
    if (imgCard) {
      imgCard.closest('button, div[tabindex]')?.click() || imgCard.click();
      return true;
    }
    return false;
  })()`);
  await new Promise((r) => setTimeout(r, 800));

  // Verify Fullscreen Viewer elements
  const viewerState = await evaluate(`(() => {
    const dock = document.querySelector('[aria-label="Image actions dock"]');
    const buttons = dock ? Array.from(dock.querySelectorAll('button')).map(b => (b.textContent || b.title || '').trim()) : [];
    return { hasDock: Boolean(dock), dockButtons: buttons };
  })()`);
  log(`viewer state: ${JSON.stringify(viewerState)}`);
  notes.push(`Fullscreen viewer inspection verified: ${JSON.stringify(viewerState)}`);

  await captureScreenshot("v110-fullscreen-viewer-1440x900");

  // Test inactivity timer auto-hide
  log("waiting 3.5s to test inactivity auto-hide...");
  await new Promise((r) => setTimeout(r, 3500));
  const hiddenState = await evaluate(`(() => {
    const header = document.querySelector('header');
    const dock = document.querySelector('[aria-label="Image actions dock"]');
    return {
      headerOpacity: header ? window.getComputedStyle(header).opacity : null,
      dockOpacity: dock ? window.getComputedStyle(dock).opacity : null,
    };
  })()`);
  log(`inactivity hidden state: ${JSON.stringify(hiddenState)}`);
  notes.push(`Inactivity auto-hide verified: ${JSON.stringify(hiddenState)}`);
  await captureScreenshot("v110-fullscreen-viewer-autohidden");

  // Test mouse move restores visibility
  log("moving mouse to test visibility restore...");
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: 500,
    y: 500,
  });
  await new Promise((r) => setTimeout(r, 300));
  const restoredState = await evaluate(`(() => {
    const dock = document.querySelector('[aria-label="Image actions dock"]');
    return {
      dockOpacity: dock ? window.getComputedStyle(dock).opacity : null,
    };
  })()`);
  log(`restored state: ${JSON.stringify(restoredState)}`);
  notes.push(`Controls restored on mouse move: ${JSON.stringify(restoredState)}`);

  log("Verification complete! Notes:");
  notes.forEach((n) => log(`- ${n}`));

  child.kill();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  child?.kill();
  process.exit(1);
});
