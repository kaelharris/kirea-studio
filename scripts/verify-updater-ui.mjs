import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const ELECTRON =
  process.env.KIREA_ELECTRON ??
  path.join(ROOT, "node_modules", "electron", "dist", "electron.exe");
const PORT = Number(process.env.KIREA_PORT ?? 9463);
const SHOT_DIR = path.join(os.tmpdir(), "kirea-updater-ui");
const PROFILE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-updater-profile-"));
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

async function screenshot(name) {
  // The verification window can be occluded, which freezes CSS transitions at
  // their starting value. Freeze them to their final state for an honest still.
  await evaluate(`(() => {
    if (!document.getElementById("verify-no-transitions")) {
      const style = document.createElement("style");
      style.id = "verify-no-transitions";
      style.textContent = "*{transition:none!important;animation:none!important}";
      document.head.appendChild(style);
    }
    for (const animation of document.getAnimations()) {
      try { animation.finish(); } catch {}
    }
    return true;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 120));
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
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
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
  await cdp.send("Page.bringToFront");
  await waitFor(() => bodyIncludes("Create"), "app shell", 45000);

  const initialState = await evaluate(`window.kirea.getUpdateState()`);
  notes.push(`initial update state: ${JSON.stringify(initialState)}`);
  if (initialState.phase !== "disabled" || initialState.canCheck !== false) {
    throw new Error("Dev build did not report a disabled updater");
  }

  const checkInDev = await evaluate(`window.kirea.checkForUpdates()`);
  notes.push(`check in dev returned: phase=${checkInDev.phase}, error=${checkInDev.error}`);
  if (checkInDev.phase !== "disabled") {
    throw new Error("Dev build attempted an update check");
  }

  const noticeVisible = await evaluate(
    `!!document.querySelector('[aria-label="Kirea Studio update"]')`
  );
  notes.push(`update notice visible in dev: ${noticeVisible}`);
  if (noticeVisible) throw new Error("Update notice rendered in a dev build");

  await clickText("Settings", "button, a");
  await waitFor(() => bodyIncludes("Settings & Engine Configuration"), "settings page");
  await clickText("About & Updates", "button");
  await waitFor(() => bodyIncludes("Update Security & Data Safety"), "about tab");

  const about = await evaluate(`(() => {
    const text = document.body.innerText;
    const checkButton = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent.trim().includes("Check for Updates")
    );
    const channel = document.querySelector('select[aria-label="Release channel"]');
    const auto = Array.from(document.querySelectorAll("label")).find((l) =>
      l.textContent.includes("Check for updates automatically")
    )?.querySelector("input");
    return {
      hasInstalled: /Installed version/i.test(text),
      hasLatest: /Latest available/i.test(text),
      hasLastCheck: /Last update check/i.test(text),
      hasDevNotice: text.includes("This development build does not check for updates"),
      checkDisabled: checkButton ? checkButton.disabled : null,
      channelValue: channel ? channel.value : null,
      channelOptions: channel
        ? Array.from(channel.options).map((o) => o.value)
        : [],
      autoChecked: auto ? auto.checked : null,
      notice: !!document.querySelector('[aria-label="Kirea Studio update"]'),
    };
  })()`);
  notes.push(`about tab: ${JSON.stringify(about)}`);
  await evaluate(`(() => {
    for (const animation of document.getAnimations()) {
      try { animation.finish(); } catch {}
    }
    return document.getAnimations().length;
  })()`);
  const navState = await evaluate(
    `Array.from(document.querySelectorAll('nav[aria-label="Settings sections"] button')).map((b) => ({ label: b.textContent.trim(), current: b.getAttribute("aria-current"), cls: b.className, bg: getComputedStyle(b).backgroundColor, color: getComputedStyle(b).color }))`
  );
  notes.push(`settings nav: ${JSON.stringify(navState)}`);
  const sidebarState = await evaluate(
    `Array.from(document.querySelectorAll('aside button, nav button')).filter((b) => ["Home","Create","Settings"].includes(b.textContent.trim())).map((b) => ({ label: b.textContent.trim(), current: b.getAttribute("aria-current"), cls: b.className, bg: getComputedStyle(b).backgroundColor }))`
  );
  notes.push(`sidebar buttons: ${JSON.stringify(sidebarState)}`);
  if (!about.hasInstalled || !about.hasLatest || !about.hasLastCheck) {
    throw new Error("About tab is missing version or check metadata");
  }
  if (!about.hasDevNotice) throw new Error("Dev-only explanation missing");
  if (about.checkDisabled !== true) throw new Error("Check button should be disabled in dev");
  if (about.channelValue !== "stable") throw new Error("Default channel is not stable");
  if (about.channelOptions.join(",") !== "stable,prerelease") {
    throw new Error(`Unexpected channels: ${about.channelOptions.join(",")}`);
  }
  if (about.autoChecked !== true) throw new Error("Automatic checks should default to on");
  if (about.notice) throw new Error("Update notice rendered inside Settings");
  await screenshot("01-about-dev");

  const switched = await evaluate(`(async () => {
    const select = document.querySelector('select[aria-label="Release channel"]');
    select.value = "prerelease";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 500));
    return {
      ui: document.querySelector('select[aria-label="Release channel"]').value,
      ipc: (await window.kirea.getUpdateState()).channel,
    };
  })()`);
  notes.push(`channel switch: ${JSON.stringify(switched)}`);
  if (switched.ui !== "prerelease" || switched.ipc !== "prerelease") {
    throw new Error("Release channel did not switch");
  }
  const prefsPath = path.join(PROFILE_DIR, "update-preferences.json");
  await waitFor(() => fs.existsSync(prefsPath), "update preferences file");
  const prefs = JSON.parse(fs.readFileSync(prefsPath, "utf-8"));
  notes.push(`persisted preferences: ${JSON.stringify(prefs)}`);
  if (prefs.channel !== "prerelease") throw new Error("Channel was not persisted");

  const toggled = await evaluate(`(async () => {
    const label = Array.from(document.querySelectorAll("label")).find((l) =>
      l.textContent.includes("Check for updates automatically")
    );
    const input = label.querySelector("input");
    input.click();
    await new Promise((resolve) => setTimeout(resolve, 400));
    const settings = await window.kirea.getSettings();
    const after = label.querySelector("input").checked;
    input.click();
    await new Promise((resolve) => setTimeout(resolve, 400));
    const restored = (await window.kirea.getSettings()).checkUpdatesAutomatically;
    return { after, stored: settings.checkUpdatesAutomatically, restored };
  })()`);
  notes.push(`auto-check toggle: ${JSON.stringify(toggled)}`);
  if (toggled.after !== false || toggled.stored !== false || toggled.restored !== true) {
    throw new Error("Automatic check setting did not toggle and persist");
  }

  await evaluate(`(async () => {
    const select = document.querySelector('select[aria-label="Release channel"]');
    select.value = "stable";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 300));
  })()`);
  await screenshot("02-about-restored");

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
