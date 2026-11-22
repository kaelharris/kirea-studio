import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const ELECTRON =
  process.env.KIREA_ELECTRON ??
  path.join(ROOT, "node_modules", "electron", "dist", "electron.exe");
const PORT = Number(process.env.KIREA_PORT ?? 9456);
const SHOT_DIR = path.join(os.tmpdir(), "kirea-viewer-scope");
const PROFILE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-viewer-profile-"));
const SOURCE_PROFILE = path.join(process.env.APPDATA ?? "", "ai-image-studio-desktop");

fs.mkdirSync(SHOT_DIR, { recursive: true });

const notes = [];
const errors = [];
let child = null;
let cdp = null;

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

async function waitFor(fn, label, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function screenshot(name) {
  const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
  const file = path.join(SHOT_DIR, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
  return file;
}

const imageCardCount = () =>
  evaluate(`document.querySelectorAll('[aria-label^="Inspect "]').length`);

const setSelect = (label, value) =>
  evaluate(`(() => {
    const el = document.querySelector('[aria-label=${JSON.stringify(label)}]');
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);

async function readIndexBadge() {
  return evaluate(`(() => {
    const span = Array.from(document.querySelectorAll('span')).find((node) =>
      /^\\d+ \\/ \\d+$/.test((node.textContent || '').trim())
    );
    return span ? span.textContent.trim() : null;
  })()`);
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
    if (message.id) return;
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
  await waitFor(
    () => evaluate(`document.body.innerText.includes("Library")`),
    "app shell",
    45000
  );

  const clickedLibrary = await evaluate(`(() => {
    const nav = Array.from(document.querySelectorAll('button, a')).find(
      (node) => (node.textContent || '').trim() === 'Library'
    );
    if (!nav) return false;
    nav.click();
    return true;
  })()`);
  if (!clickedLibrary) throw new Error("Library navigation not found");
  await waitFor(
    () => evaluate(`!!document.querySelector('[aria-label="Search media library"]')`),
    "library filters"
  );

  const clickedImages = await evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('button[aria-pressed]')).find(
      (node) => (node.textContent || '').trim().startsWith('Images')
    );
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clickedImages) throw new Error("Images filter not found");
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const total = await imageCardCount();
  notes.push(`library image cards (all orientations): ${total}`);
  if (total < 2) throw new Error("Need at least two images to test viewer navigation");

  const candidates = [];
  for (const value of ["square", "portrait", "landscape"]) {
    await setSelect("Filter by orientation", value);
    await new Promise((resolve) => setTimeout(resolve, 900));
    candidates.push([value, await imageCardCount()]);
  }
  notes.push(
    `orientation counts: ${candidates.map(([value, count]) => `${value}=${count}`).join(", ")}`
  );
  const chosen = candidates.find(([, count]) => count >= 2 && count < total);
  if (!chosen) throw new Error("No orientation filter narrowed the list below the total");
  await setSelect("Filter by orientation", chosen[0]);
  await new Promise((resolve) => setTimeout(resolve, 900));
  const filtered = await imageCardCount();
  notes.push(`filtered subset: ${chosen[0]} = ${filtered}`);

  const opened = await evaluate(`(() => {
    const card = document.querySelector('[aria-label^="Inspect "]');
    if (!card) return false;
    card.click();
    return true;
  })()`);
  if (!opened) throw new Error("Could not open the first filtered image");
  await waitFor(
    () => evaluate(`!!document.querySelector('[aria-label="Zoomable image viewer"]')`),
    "image viewer"
  );

  const initialBadge = await readIndexBadge();
  notes.push(`viewer badge inside filter: ${initialBadge}`);
  if (initialBadge !== `1 / ${filtered}`) {
    throw new Error(
      `Viewer escaped the filter: expected "1 / ${filtered}", got "${initialBadge}"`
    );
  }

  const source = await evaluate(
    `document.querySelector('[aria-label="Zoomable image viewer"] img')?.src ?? null`
  );
  const decodedSource = source
    ? decodeURIComponent(new URL(source).searchParams.get("p") ?? "")
    : "";
  notes.push(
    `viewer loads original file path: ${Boolean(
      /\.(png|jpe?g|webp)$/i.test(decodedSource) && !/preview|thumb/i.test(decodedSource)
    )} (${decodedSource})`
  );
  await screenshot("01-filtered-viewer");

  const next = await evaluate(`(() => {
    const button = document.querySelector('[aria-label="Next generation"]');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (next) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const nextBadge = await readIndexBadge();
    notes.push(`viewer next inside filter: ${nextBadge}`);
    if (nextBadge !== `2 / ${filtered}`) {
      throw new Error(`Viewer navigation left the filter: got "${nextBadge}"`);
    }
    await screenshot("02-filtered-viewer-next");
  }

  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await new Promise((resolve) => setTimeout(resolve, 400));
  const closed = await evaluate(
    `!document.querySelector('[aria-label="Zoomable image viewer"]')`
  );
  notes.push(`viewer closed with Escape: ${closed}`);
  if (!closed) throw new Error("Escape did not close the viewer");

  notes.forEach((note) => console.log(`NOTE ${note}`));
  const realErrors = errors.filter(
    (entry) => !/Autofill|DevTools|Download the React DevTools/i.test(entry)
  );
  console.log(`ERRORS ${realErrors.length}`);
  realErrors.slice(0, 10).forEach((entry) => console.log(`ERR ${entry}`));
  console.log(`SHOTS ${SHOT_DIR}`);
  console.log("PASS viewer navigation stayed inside the filtered collection");
}

main()
  .catch((err) => {
    console.error(`FAIL ${err.message}`);
    notes.forEach((note) => console.log(`NOTE ${note}`));
    errors.slice(0, 10).forEach((entry) => console.log(`ERR ${entry}`));
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      child?.kill();
    } catch {
      // ignore
    }
  });
