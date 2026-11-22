import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const ELECTRON = path.join(ROOT, "node_modules", "electron", "dist", "electron.exe");
const PORT = 9455;
const SHOT_DIR = path.join(os.tmpdir(), "kirea-hf-ui");
const PROFILE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-hf-profile-"));

fs.mkdirSync(SHOT_DIR, { recursive: true });

let child = null;
let renderer = null;
const errors = [];

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
    close() {
      try {
        socket.close();
      } catch {
        // already closed
      }
    },
  };
}

async function openWebSocket(wsUrl) {
  const socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  return socket;
}

async function pollTarget(timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const target = targets.find(
          (item) =>
            item.type === "page" &&
            String(item.url).startsWith("file:") &&
            String(item.url).includes("index.html")
        );
        if (target?.webSocketDebuggerUrl) return target;
      }
    } catch {
      // booting
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error("Timed out waiting for the Electron renderer.");
}

const evaluate = (expression) => renderer.evaluate(expression);

async function waitFor(fn, label, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

const bodyIncludes = (text) =>
  evaluate(
    `document.body ? document.body.innerText.includes(${JSON.stringify(text)}) : false`
  );

const bodyIncludesFold = (text) =>
  evaluate(
    `document.body ? document.body.innerText.toLowerCase().includes(${JSON.stringify(
      text.toLowerCase()
    )}) : false`
  );

async function clickIfPresent(text) {
  return evaluate(`(() => {
    const needle = ${JSON.stringify(text)};
    const nodes = Array.from(document.querySelectorAll('button, [role="tab"], a'));
    const target = nodes.find((node) => (node.textContent || "").trim().includes(needle) && !node.disabled);
    if (!target) return false;
    target.click();
    return true;
  })()`);
}

async function click(text) {
  if (!(await clickIfPresent(text))) throw new Error(`No clickable element matched "${text}"`);
}

async function clickCardButton(name, label) {
  const clicked = await evaluate(`(() => {
    const heading = Array.from(document.querySelectorAll('h3')).find(
      (node) => (node.textContent || "").trim() === ${JSON.stringify(name)}
    );
    if (!heading) return false;
    let node = heading;
    while (node && !node.querySelector('button')) node = node.parentElement;
    if (!node) return false;
    const button = Array.from(node.querySelectorAll('button')).find(
      (candidate) => (candidate.textContent || "").includes(${JSON.stringify(label)}) && !candidate.disabled
    );
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`No "${label}" button found for "${name}".`);
}

async function screenshot(name) {
  const shot = await renderer.send("Page.captureScreenshot", { format: "png" });
  const file = path.join(SHOT_DIR, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
  console.log(`screenshot: ${file}`);
}

async function closeDialog() {
  const closed = await evaluate(`(() => {
    const button = document.querySelector('[aria-label="Close dialog"]');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!closed) throw new Error("Could not close the repository dialog.");
}

async function main() {
  console.log("launching Electron");
  child = spawn(
    ELECTRON,
    [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE_DIR}`, "."],
    { cwd: ROOT, stdio: "ignore" }
  );
  process.on("exit", () => {
    try {
      child?.kill();
    } catch {
      // exited
    }
  });

  const target = await pollTarget();
  console.log("renderer connected");
  renderer = connectCdp(await openWebSocket(target.webSocketDebuggerUrl));
  renderer.send("Runtime.enable");
  renderer.send("Page.enable");

  await waitFor(() => evaluate("Boolean(window.kirea)"), "the preload bridge");
  await waitFor(() => bodyIncludes("Kirea"), "the app shell");
  console.log("app shell ready");

  await click("Models");
  await waitFor(() => bodyIncludes("Model Vault & Civitai Hub"), "the Models page");
  await click("CIVITAI HUB");
  await waitFor(() => bodyIncludes("Hugging Face"), "the Hub provider bar");
  await click("Hugging Face");
  await waitFor(
    () => evaluate(`Boolean(document.querySelector('input[aria-label="Search Hugging Face"]'))`),
    "the Hugging Face provider"
  );
  console.log("Hugging Face provider open");
  await waitFor(
    () => bodyIncludes("Wan-AI/Wan2.1-T2V-1.3B"),
    "Hugging Face search results",
    45000
  );
  if (!(await evaluate("document.body.innerText.toLowerCase().includes('unsupported')"))) {
    throw new Error("Unsupported repositories were not labeled in search results.");
  }
  await screenshot("01-huggingface-search");

  await clickCardButton("Wan-AI/Wan2.1-T2V-1.3B-Diffusers", "Inspect");
  await waitFor(
    () => bodyIncludes("This repository contains only Diffusers-format weights"),
    "the sharded Diffusers limitation",
    45000
  );
  await waitFor(
    () => bodyIncludes("No loadable single-file weight"),
    "the compatibility block",
    45000
  );
  if (!(await bodyIncludes("No loadable weight"))) {
    throw new Error("The incompatible repository did not disable the download action.");
  }
  const blockedDisabled = await evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('button')).find(
      (node) => (node.textContent || "").includes("No loadable weight")
    );
    return button ? button.disabled : null;
  })()`);
  if (blockedDisabled !== true) {
    throw new Error("The no-loadable-weight download action was not disabled.");
  }
  await screenshot("02-diffusers-incompatible");
  await closeDialog();

  const bridge = await evaluate(`(async () => {
    const results = {};

    const raw = await window.kirea.getHuggingFaceRepo("Wan-AI/Wan2.1-T2V-1.3B");
    const rawPrimary = raw.files.find((file) => file.primary);
    const rawReport = await window.kirea.checkHuggingFaceCompatibility({
      repoId: raw.id,
      revision: raw.revision,
      selectedPaths: [rawPrimary.path],
    });
    let rawBlocked = false;
    try {
      await window.kirea.startHuggingFaceDownloads({
        repoId: raw.id,
        revision: raw.revision,
        files: [{ path: rawPrimary.path, category: "diffusion_model" }],
      });
    } catch (error) {
      rawBlocked = /Cannot download|Diffusers/.test(String(error));
    }
    results.raw = {
      runnable: raw.runnable,
      status: rawReport.status,
      formatFail: rawReport.checks.some(
        (check) => check.id === "format" && check.status === "fail"
      ),
      blocked: rawBlocked,
    };

    const native = await window.kirea.getHuggingFaceRepo(
      "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged"
    );
    const nativePrimary = native.files.find((file) => file.primary);
    const nativeReport = await window.kirea.checkHuggingFaceCompatibility({
      repoId: native.id,
      revision: native.revision,
      selectedPaths: [nativePrimary.path],
    });
    results.native = {
      runnable: native.runnable,
      primary: nativePrimary.path,
      status: nativeReport.status,
      workflow: nativeReport.workflowId,
      architectureFail: nativeReport.checks.some(
        (check) => check.id === "architecture" && check.status === "fail"
      ),
    };

    const ltx = await window.kirea.getHuggingFaceRepo("Lightricks/LTX-Video");
    const ltxPrimary = ltx.files.find((file) => file.primary);
    const ltxReport = await window.kirea.checkHuggingFaceCompatibility({
      repoId: ltx.id,
      revision: ltx.revision,
      selectedPaths: [ltxPrimary.path],
    });
    results.ltx = {
      runnable: ltx.runnable,
      primary: ltxPrimary.path,
      workflow: ltxReport.workflowId,
      blocking: ltxReport.blockingReasons,
    };

    return results;
  })()`);
  console.log(`bridge checks: ${JSON.stringify(bridge)}`);
  if (
    bridge.raw.runnable !== false ||
    bridge.raw.status !== "INCOMPATIBLE" ||
    bridge.raw.formatFail !== true ||
    bridge.raw.blocked !== true
  ) {
    throw new Error("The backend did not block the raw Diffusers repository.");
  }
  if (
    bridge.native.runnable !== true ||
    bridge.native.workflow !== "t2v_wan21_1_3b" ||
    bridge.native.architectureFail
  ) {
    throw new Error("The ComfyUI-native Wan repository was not classified as compatible.");
  }
  if (
    bridge.ltx.runnable !== true ||
    !String(bridge.ltx.primary).includes("2b") ||
    bridge.ltx.blocking.length > 0
  ) {
    throw new Error("The LTX 2B repository was not classified correctly.");
  }

  await click("Settings");
  await waitFor(() => bodyIncludes("Settings"), "the Settings page");
  await click("Hugging Face Hub");
  await waitFor(
    () => bodyIncludes("Hugging Face Access Token"),
    "the Hugging Face token settings",
    20000
  );
  if (!(await bodyIncludesFold("Anonymous access"))) {
    throw new Error("The Hugging Face token card did not show anonymous status.");
  }
  if (!(await bodyIncludesFold("compatibility report"))) {
    throw new Error("The Hugging Face compatibility policy copy is missing.");
  }
  await screenshot("04-huggingface-settings");

  await click("Models");
  await waitFor(() => bodyIncludes("Model Vault & Civitai Hub"), "the Models page");
  await click("CIVITAI HUB");
  await click("Civitai");
  await waitFor(() => bodyIncludes("Civitai"), "the Civitai provider");
  await screenshot("05-civitai-unchanged");

  if (errors.length > 0) {
    console.log(`renderer errors:\n${errors.join("\n")}`);
  }
  console.log("verification passed");
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  try {
    renderer?.close?.();
  } catch {
    // already closed
  }
  if (child && child.exitCode === null) {
    child.kill();
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
  }
  fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
}
