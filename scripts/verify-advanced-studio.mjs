import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const ELECTRON =
  process.env.KIREA_ELECTRON ??
  path.join(ROOT, "node_modules", "electron", "dist", "electron.exe");
const PORT = Number(process.env.KIREA_PORT ?? 9455);
const SHOT_DIR = path.join(os.tmpdir(), "kirea-advanced-studio");
const PROFILE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-advanced-profile-"));
const SOURCE_PROFILE = path.join(process.env.APPDATA ?? "", "ai-image-studio-desktop");

fs.mkdirSync(SHOT_DIR, { recursive: true });

const notes = [];
const errors = [];
let child = null;
let cdp = null;

function log(line) {
  console.log(`[verify] ${line}`);
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

const evaluate = (expression) => cdp.evaluate(expression);
const bodyIncludes = (text) =>
  evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`);

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

async function clickAria(label) {
  const clicked = await evaluate(`(() => {
    const target = document.querySelector('[aria-label=${JSON.stringify(label)}]');
    if (!target) return false;
    target.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`No aria-label="${label}" element`);
  log(`clicked aria: ${label}`);
}

async function openNav(label, marker) {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    await clickText(label, "button, a");
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (await bodyIncludes(marker)) return;
  }
  throw new Error(`Could not open ${label}`);
}

async function screenshot(name) {
  const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
  const file = path.join(SHOT_DIR, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
  log(`screenshot: ${file}`);
  return file;
}

async function main() {
  child = spawn(
    ELECTRON,
    [
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${PROFILE_DIR}`,
      ...(process.env.KIREA_ELECTRON ? [] : ["."]),
    ],
    { cwd: ROOT, stdio: "ignore" }
  );
  process.on("exit", () => {
    try {
      child?.kill();
    } catch {
      // ignore
    }
  });

  const target = await pollTarget();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  cdp = connectCdp(socket);
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id) return;
    if (message.method === "Runtime.exceptionThrown") {
      const detail = message.params.exceptionDetails;
      errors.push(detail.exception?.description ?? detail.text ?? "page error");
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      errors.push(
        message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" ")
      );
    }
  });
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await waitFor(() => bodyIncludes("Create"), "app shell", 45000);
  await screenshot("01-home");

  // --- Model Hub ---
  await openNav("Models", "Model Vault");
  await clickText("CIVITAI HUB");
  await waitFor(() => bodyIncludes("Hot Models"), "hub tabs", 20000);

  const hubTabs = await evaluate(`(() => {
    const labels = ["Hot Models","Trending","Checkpoints","LoRAs","Recently Updated","Installed"];
    const text = document.body.innerText;
    return labels.filter((label) => text.includes(label));
  })()`);
  notes.push(`hub tabs visible: ${hubTabs.join(", ")}`);
  if (hubTabs.length !== 6) throw new Error("Not all hub tabs are visible");

  const providers = await evaluate(`(() => {
    const text = document.body.innerText;
    return ["Civitai","SeaArt","Local"].filter((p) => text.includes(p));
  })()`);
  notes.push(`providers visible: ${providers.join(", ")}`);
  if (providers.length < 3) throw new Error("Provider selector incomplete");

  const hasPeriod = await evaluate(
    `Array.from(document.querySelectorAll('select')).some((s) => Array.from(s.options).some((o) => o.textContent.includes('This week')))`
  );
  notes.push(`period selector present: ${hasPeriod}`);
  if (!hasPeriod) throw new Error("Period selector missing");

  const hasMature = await evaluate(`!!document.querySelector('[title*="Mature content"]')`);
  notes.push(`mature toggle present: ${hasMature}`);
  if (!hasMature) throw new Error("Mature toggle missing in Hub");

  await waitFor(
    () =>
      evaluate(`(() => {
        const text = document.body.innerText;
        return text.includes("Source: Civitai") || text.includes("Querying Civitai") || text.includes("Civitai");
      })()`),
    "civitai attribution",
    15000
  );
  await new Promise((resolve) => setTimeout(resolve, 6000));
  const cardCount = await evaluate(`document.querySelectorAll('h3').length`);
  const cardRects = await evaluate(`(() => {
    const card = Array.from(document.querySelectorAll('h3')).find((h) => h.closest('.flex.flex-col.overflow-hidden'));
    const frame = card?.closest('.flex.flex-col.overflow-hidden')?.querySelector('button');
    if (!frame) return null;
    const r = frame.getBoundingClientRect();
    return { width: Math.round(r.width), height: Math.round(r.height), ratio: +(r.width / r.height).toFixed(3) };
  })()`);
  notes.push(`hub cards: ${cardCount}; first preview frame: ${JSON.stringify(cardRects)}`);
  if (cardCount === 0) notes.push("note: no live Civitai cards rendered (offline or filtered)");
  await screenshot("02-model-hub");

  await clickText("Trending");
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const trendingActive = await evaluate(
    `Array.from(document.querySelectorAll('[role=tab]')).some((t) => t.textContent.includes('Trending') && t.getAttribute('aria-selected') === 'true')`
  );
  notes.push(`trending tab active: ${trendingActive}`);
  if (!trendingActive) throw new Error("Trending tab did not activate");
  await screenshot("03-hub-trending");

  await clickText("SeaArt", "button");
  await waitFor(() => bodyIncludes("SeaArt discovery"), "SeaArt fallback");
  await screenshot("04-hub-seaart");

  // --- Create Advanced workspace ---
  await openNav("Create", "Create");
  await clickText("Advanced", '[role=tab]');
  await waitFor(() => bodyIncludes("Prompt"), "advanced workspace");
  const views = await evaluate(`(() => {
    const labels = ["Canvas","History","Inspiration"];
    const text = document.body.innerText;
    return labels.filter((label) => text.includes(label));
  })()`);
  notes.push(`results views: ${views.join(", ")}`);
  if (views.length !== 3) throw new Error("Results workspace views missing");

  const layout = await evaluate(`(() => {
    const prompt = Array.from(document.querySelectorAll('span')).find((s) => (s.textContent||'').trim() === 'Prompt');
    const composer = prompt?.closest('.order-2');
    const canvas = document.querySelector('.order-1');
    if (!composer || !canvas) return null;
    const c = canvas.getBoundingClientRect();
    const p = composer.getBoundingClientRect();
    return { canvasTop: Math.round(c.top), canvasBottom: Math.round(c.bottom), composerTop: Math.round(p.top), promptBelowCanvas: p.top >= c.bottom - 4 };
  })()`);
  notes.push(`layout: ${JSON.stringify(layout)}`);
  if (!layout?.promptBelowCanvas) throw new Error("Prompt composer is not below the results canvas");

  const mossHint = await evaluate(`document.body.innerText.includes("MOSS-Image is installed as a workflow")`);
  notes.push(`moss readiness hint visible: ${mossHint}`);
  await screenshot("05-create-advanced");

  await clickText("History", '[role=tab]');
  await waitFor(
    () => evaluate(`!!document.querySelector('[aria-label="Search generation history"]')`),
    "history search"
  );
  await screenshot("06-create-history");
  const historyCount = await evaluate(
    `Array.from(document.querySelectorAll('button')).filter((b) => b.innerText.includes('seed')).length`
  );
  notes.push(`history cards: ${historyCount}`);

  await clickText("Inspiration", '[role=tab]');
  await waitFor(() => bodyIncludes("Use brief"), "inspiration presets");
  await screenshot("07-create-inspiration");

  // --- Advanced viewer & zoom ---
  if (historyCount > 0) {
    await clickText("History", '[role=tab]');
    await waitFor(
      () => evaluate(`!!document.querySelector('[aria-label="Search generation history"]')`),
      "history search again"
    );
    const opened = await evaluate(`(() => {
      const button = Array.from(document.querySelectorAll('button')).find((b) => b.innerText.includes('seed'));
      if (!button) return false;
      button.click();
      return true;
    })()`);
    if (opened) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      await clickAria("Open fullscreen lightbox");
      await waitFor(
        () => evaluate(`!!document.querySelector('[aria-label="Zoomable image viewer"]')`),
        "zoomable viewer"
      );
      const before = await evaluate(
        `document.querySelector('[aria-label="Zoomable image viewer"]').innerText`
      );
      await clickAria("Zoom in");
      await new Promise((resolve) => setTimeout(resolve, 400));
      const after = await evaluate(
        `document.querySelector('[aria-label="Zoomable image viewer"]').innerText`
      );
      notes.push(`viewer zoom: "${before.replace(/\\n/g, ' ')}" -> "${after.replace(/\\n/g, ' ')}"`);
      await screenshot("08-viewer-zoom");
      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await new Promise((resolve) => setTimeout(resolve, 500));
      const closed = await evaluate(
        `!document.querySelector('[aria-label="Zoomable image viewer"]')`
      );
      notes.push(`viewer closed with Escape: ${closed}`);
    }
  } else {
    notes.push("viewer zoom skipped: no history images in profile");
  }

  // --- Settings mature copy ---
  await openNav("Settings", "Settings");
  await clickText("Civitai");
  await waitFor(() => bodyIncludes("Mature Content"), "mature setting", 15000);
  const matureCopy = await evaluate(
    `document.body.innerText.includes("Off by default")`
  );
  notes.push(`settings mature copy present: ${matureCopy}`);
  await screenshot("09-settings-mature");

  notes.forEach((note) => console.log(`NOTE ${note}`));
  const realErrors = errors.filter(
    (entry) => !entry.includes("Autofill") && !entry.includes("devtools")
  );
  console.log(`ERRORS ${realErrors.length}`);
  realErrors.slice(0, 10).forEach((entry) => console.log(`ERR ${entry}`));
  console.log(`SHOTS ${SHOT_DIR}`);
  process.exitCode = realErrors.length === 0 ? 0 : 1;
}

main()
  .catch(async (err) => {
    console.error(`FAIL ${err.message}`);
    notes.forEach((note) => console.log(`NOTE ${note}`));
    try {
      await screenshot("99-failure");
    } catch {
      // ignore
    }
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      child?.kill();
    } catch {
      // ignore
    }
  });
