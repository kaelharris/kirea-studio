import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const APP =
  process.env.KIREA_APP ??
  path.join(ROOT, "release-updater-verify2", "win-unpacked", "Kirea Studio.exe");
const PORT = Number(process.env.KIREA_PORT ?? 9465);
const SHOT_DIR = path.join(os.tmpdir(), "kirea-updater-packaged");
const PROFILE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-updater-pkg-profile-"));
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

async function pollTarget(timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const target = targets.find(
        (item) => item.type === "page" && !String(item.url).startsWith("devtools")
      );
      if (target?.webSocketDebuggerUrl) return target;
    } catch {
      // still booting
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error("Timed out waiting for the packaged renderer.");
}

const evaluate = (expression) => cdp.evaluate(expression);
const bodyIncludes = (text) =>
  evaluate(
    `(document.body ? document.body.innerText : "").includes(${JSON.stringify(text)})`
  );

async function waitFor(fn, label, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function clickText(text, selector = "button, a") {
  const clicked = await evaluate(`(() => {
    const target = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(
      (node) => (node.textContent || "").trim().includes(${JSON.stringify(text)}) && !node.disabled
    );
    if (!target) return false;
    target.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`No control matched "${text}"`);
}

async function screenshot(name) {
  // Occluded windows freeze CSS transitions; finish them for an honest still.
  await evaluate(`(() => {
    for (const animation of document.getAnimations()) {
      try { animation.finish(); } catch {}
    }
    return true;
  })()`);
  const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
  const file = path.join(SHOT_DIR, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
  console.log(`[verify] screenshot: ${file}`);
}

async function main() {
  if (!fs.existsSync(APP)) throw new Error(`Packaged app not found at ${APP}`);
  child = spawn(APP, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE_DIR}`], {
    cwd: path.dirname(APP),
    stdio: "ignore",
  });
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
  await cdp.send("Page.bringToFront");
  await waitFor(() => bodyIncludes("Create"), "packaged app shell", 60000);

  const initial = await evaluate(`window.kirea.getUpdateState()`);
  notes.push(`packaged initial state: ${JSON.stringify(initial)}`);
  if (initial.canCheck !== true) throw new Error("Packaged build did not enable the updater");
  if (initial.channel !== "stable") throw new Error("Packaged build did not default to stable");
  if (initial.currentVersion !== "1.0.4") {
    throw new Error(`Unexpected packaged version ${initial.currentVersion}`);
  }

  const checked = await evaluate(`window.kirea.checkForUpdates()`);
  notes.push(
    `packaged manual check: phase=${checked.phase}, latest=${checked.availableVersion}, error=${checked.error}`
  );
  if (!["up-to-date", "available", "error"].includes(checked.phase)) {
    throw new Error(`Unexpected packaged check phase ${checked.phase}`);
  }
  if (checked.phase === "error" && !checked.error) {
    throw new Error("Error state had no message");
  }

  await clickText("Settings");
  await waitFor(() => bodyIncludes("Settings & Engine Configuration"), "settings page");
  await clickText("About & Updates");
  await waitFor(() => bodyIncludes("Update Security & Data Safety"), "about tab");
  const about = await evaluate(`(() => {
    const text = document.body.innerText;
    const check = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent.trim().includes("Check for Updates")
    );
    return {
      installed: text.includes("v1.0.4"),
      latest: /Latest available/i.test(text),
      lastCheck: /Last update check/i.test(text),
      status: ["Up to date","Update available","Update check failed","Checking for updates"].find(
        (s) => text.includes(s)
      ) ?? null,
      devNotice: text.includes("This development build does not check for updates"),
      checkDisabled: check ? check.disabled : null,
      notice: !!document.querySelector('[aria-label="Kirea Studio update"]'),
    };
  })()`);
  notes.push(`packaged about: ${JSON.stringify(about)}`);
  if (!about.installed || !about.latest || !about.lastCheck) {
    throw new Error("About tab missing version metadata");
  }
  if (about.devNotice) throw new Error("Packaged build showed the dev-only notice");
  if (about.checkDisabled) throw new Error("Check button is disabled in the packaged build");
  if (about.notice && checked.phase !== "available") {
    throw new Error("Update banner shown without an available update");
  }
  await screenshot("01-packaged-about");

  notes.forEach((note) => console.log(`NOTE ${note}`));
  const realErrors = errors.filter(
    (entry) => !entry.includes("Autofill") && !entry.includes("devtools")
  );
  console.log(`ERRORS ${realErrors.length}`);
  realErrors.slice(0, 10).forEach((entry) => console.log(`ERR ${entry}`));
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
