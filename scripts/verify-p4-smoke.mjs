import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const PACKAGED_EXE = process.env.KIREA_SMOKE_EXE?.trim();
const ELECTRON = PACKAGED_EXE || path.join(ROOT, "node_modules", "electron", "dist", "electron.exe");
const PORT = 9333;
const LABEL = PACKAGED_EXE ? "packaged" : "dev";
const LOG_PATH = path.join(ROOT, `app-smoke-${LABEL}.log`);
const SHOT_PATH = path.join(os.tmpdir(), `kirea-p4-smoke-${LABEL}.png`);

const errors = [];
const notes = [];
let ws;
let nextId = 1;
const pending = new Map();

function log(line) {
  const text = `[${new Date().toISOString()}] ${line}`;
  console.log(text);
  fs.appendFileSync(LOG_PATH, `${text}\n`);
}

async function waitForTarget(timeoutMs = 40000) {
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
    await new Promise((resolve) => setTimeout(resolve, 500));
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

async function waitFor(fn, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function isMissingLocalMedia(url) {
  if (!url || !url.startsWith("kirea-media://")) return false;
  try {
    const parsed = new URL(url);
    const filePath = parsed.searchParams.get("p");
    return Boolean(filePath) && !fs.existsSync(filePath);
  } catch {
    return false;
  }
}

async function waitForSplashHandoff(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const splash = targets.find((target) =>
          String(target.url).includes("splash.html")
        );
        if (!splash) {
          await new Promise((resolve) => setTimeout(resolve, 400));
          return;
        }
      }
    } catch {
      // app booting
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for splash handoff");
}

function clickByText(text) {
  const needle = JSON.stringify(text);
  return evaluate(`(() => {
    const nodes = Array.from(document.querySelectorAll('button, [role="tab"], a'));
    const target = nodes.find((node) => (node.textContent || "").trim().includes(${needle}) && !node.disabled);
    if (!target) return false;
    target.click();
    return true;
  })()`);
}

async function click(text) {
  const clicked = await clickByText(text);
  if (!clicked) throw new Error(`No clickable element matched "${text}"`);
  log(`clicked: ${text}`);
}

const bodyIncludes = (text) =>
  evaluate(
    `document.body.innerText.toLowerCase().includes(${JSON.stringify(text)}.toLowerCase())`
  );

async function main() {
  fs.writeFileSync(LOG_PATH, "");
  const args = PACKAGED_EXE
    ? [`--remote-debugging-port=${PORT}`]
    : [".", `--remote-debugging-port=${PORT}`];
  const child = spawn(ELECTRON, args, {
    cwd: ROOT,
    stdio: "ignore",
    detached: false,
  });
  const shutdown = () => {
    try {
      child.kill();
    } catch {
      // already exited
    }
  };
  process.on("exit", shutdown);

  const target = await waitForTarget();
  log(`renderer target: ${target.url}`);

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
      const entry = message.params.entry;
      if (isMissingLocalMedia(entry.url)) {
        notes.push("stale library record points at a deleted file");
        return;
      }
      errors.push(
        `log: ${entry.text}${entry.url ? ` <${entry.url}>` : ""}`
      );
    }
  });

  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.enable");

  await waitFor(async () => (await evaluate("document.body.innerText.includes('Kirea')")), "initial UI");
  await waitFor(async () => (await bodyIncludes("Characters")), "sidebar navigation");
  await waitForSplashHandoff();
  notes.push("App shell rendered");

  await click("Characters");
  await waitFor(() => bodyIncludes("Character Hub"), "Characters page");
  notes.push("Characters page rendered");

  await click("Stories");
  await waitFor(() => bodyIncludes("Story Studio"), "Stories page");
  notes.push("Stories page rendered");

  await waitFor(
    () =>
      evaluate(
        `Array.from(document.querySelectorAll('[role="tab"]')).some((tab) => tab.textContent.includes("Story Canvas"))`
      ),
    "Story Canvas tab"
  );
  await click("Story Canvas");
  await waitFor(
    async () =>
      (await bodyIncludes("Story Canvas")) &&
      ((await bodyIncludes("No storyboard canvas yet")) ||
        (await bodyIncludes("Sync from Scenes"))),
    "Story Canvas mode"
  );
  notes.push("Story Canvas tab rendered");

  if (await bodyIncludes("No storyboard canvas yet")) {
    await click("Create storyboard");
    await waitFor(() => bodyIncludes("Create canvas"), "canvas modal");
    await click("Create canvas");
    await waitFor(() => bodyIncludes("Sync from Scenes"), "canvas toolbar");
    notes.push("Canvas created through UI");
  }

  if (
    (await evaluate(
      `Array.from(document.querySelectorAll('button')).some((b) => b.textContent.includes('Sync from Scenes') && !b.disabled)`
    ))
  ) {
    await click("Sync from Scenes");
    await waitFor(
      async () => (await bodyIncludes("panel")) && (await bodyIncludes("Page 1")),
      "canvas panels after sync"
    );
    notes.push("Synced canvas from scenes");
  }

  await click("Scene Builder");
  await waitFor(() => bodyIncludes("Scene timeline"), "Scene Builder mode");
  notes.push("Scene Builder tab rendered");

  const shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(SHOT_PATH, Buffer.from(shot.data, "base64"));
  log(`screenshot: ${SHOT_PATH}`);

  await click("Story Canvas");
  await waitFor(() => bodyIncludes("Sync from Scenes"), "final canvas view");
  const finalShot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(SHOT_PATH.replace(".png", "-canvas.png"), Buffer.from(finalShot.data, "base64"));

  log(`notes: ${notes.join(" | ")}`);
  if (errors.length > 0) {
    for (const error of errors) log(`ERROR ${error}`);
    throw new Error(`${errors.length} console/page error(s) detected`);
  }
  log("PASS: no console or page errors");
}

main()
  .then(() => {
    if (ws) ws.close();
    process.exit(0);
  })
  .catch((error) => {
    log(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
    if (ws) ws.close();
    process.exit(1);
  });
