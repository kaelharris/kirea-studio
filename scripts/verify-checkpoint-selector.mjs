import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const ELECTRON =
  process.env.KIREA_ELECTRON ??
  path.join(ROOT, "node_modules", "electron", "dist", "electron.exe");
const PORT = Number(process.env.KIREA_PORT ?? 9461);
const SHOT_DIR = path.join(os.tmpdir(), "kirea-checkpoint-selector");
const PROFILE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-checkpoint-profile-"));
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

  await openNav("Create", "Create");
  await clickText("Advanced", "[role=tab]");
  await waitFor(() => bodyIncludes("Checkpoint / Base Model"), "advanced workspace");

  const readPrimary = () =>
    evaluate(`(async () => {
      const all = await window.kirea.listModels();
      const arch = (m) => m.metadata?.architectureOverride ?? m.architecture;
      const unsupported = ["flux", "krea2", "ltx_video", "wan_video"];
      return all
        .filter(
          (m) =>
            m.installed &&
            (m.category === "checkpoint" ||
              (m.category === "diffusion_model" &&
                ["z_image", "anima", "moss_image"].includes(arch(m)))) &&
            !unsupported.includes(arch(m))
        )
        .map((m) => ({
          id: m.id,
          name: m.name,
          category: m.category,
          relativePath: m.relativePath,
          architecture: arch(m),
          displayName: m.metadata?.displayName ?? null,
          sourceName: m.discovery?.source?.modelName ?? null,
          embeddedTitle: m.discovery?.embeddedTitle ?? null,
          description: m.description ?? null,
        }));
    })()`);

  let scanned = await readPrimary();
  notes.push(`primary checkpoint/diffusion models: ${scanned.length}`);
  if (scanned.length === 0) throw new Error("No checkpoints scanned in profile");

  const fixtureModel = scanned.find((m) => m.category === "checkpoint");
  const FIXTURE_PREVIEW = path.join(PROFILE_DIR, "verify-checkpoint-preview.png");
  const FIXTURE_DESCRIPTION =
    "Fixture description for verifying the checkpoint description block removal.";
  if (fixtureModel) {
    fs.writeFileSync(
      FIXTURE_PREVIEW,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAP0lEQVR4nO3BAQ0AAADCoPdPbQ8HFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAvBsYAAAB4q3nAAAAAElFTkSuQmCC",
        "base64"
      )
    );
    await evaluate(`window.kirea.updateModelMetadata(${JSON.stringify(fixtureModel.id)}, {
      displayName: "Nova Anime (Test)",
      description: ${JSON.stringify(FIXTURE_DESCRIPTION)},
      previewMode: "custom",
      previewPath: ${JSON.stringify(FIXTURE_PREVIEW)}
    })`);
    log(`seeded metadata fixture on ${fixtureModel.relativePath}`);
    await cdp.send("Page.reload", { ignoreCache: false });
    await waitFor(() => bodyIncludes("Create"), "app shell after reload", 45000);
    await openNav("Create", "Create");
    await clickText("Advanced", "[role=tab]");
    await waitFor(() => bodyIncludes("Checkpoint / Base Model"), "advanced workspace after reload");
    scanned = await readPrimary();
  } else {
    notes.push("note: no checkpoint category model available for metadata fixture");
  }

  const withDisplayName = scanned.filter((m) => m.displayName && m.displayName.trim());
  const filenameOnly = scanned.filter((m) => !(m.displayName && m.displayName.trim()));
  notes.push(
    `metadata display names: ${withDisplayName.length} (${withDisplayName
      .slice(0, 3)
      .map((m) => m.displayName)
      .join(", ")}); filename-only: ${filenameOnly.length}`
  );

  const readSelect = () =>
    evaluate(`(() => {
      const label = Array.from(document.querySelectorAll("label")).find(
        (node) => node.textContent.trim() === "Checkpoint / Base Model"
      );
      const select = label?.parentElement?.nextElementSibling?.querySelector("select");
      if (!select) return null;
      return {
        value: select.value,
        options: Array.from(select.options).map((o) => ({ value: o.value, label: o.textContent })),
        rowHeight: Math.round(select.getBoundingClientRect().height),
        previewBox: (() => {
          const box = select.parentElement?.querySelector("div.overflow-hidden");
          if (!box) return null;
          const r = box.getBoundingClientRect();
          return { width: Math.round(r.width), height: Math.round(r.height) };
        })(),
        rowCenterDelta: (() => {
          const box = select.parentElement?.querySelector("div.overflow-hidden");
          if (!box) return null;
          const s = select.getBoundingClientRect();
          const b = box.getBoundingClientRect();
          return Math.round((s.top + s.height / 2) - (b.top + b.height / 2));
        })(),
      };
    })()`);

  const selectCheckpoint = (relativePath) =>
    evaluate(`(async () => {
      const label = Array.from(document.querySelectorAll("label")).find(
        (node) => node.textContent.trim() === "Checkpoint / Base Model"
      );
      const select = label?.parentElement?.nextElementSibling?.querySelector("select");
      if (!select) return false;
      select.value = ${JSON.stringify(relativePath)};
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return select.value === ${JSON.stringify(relativePath)};
    })()`);

  let initial = await readSelect();
  if (!initial) throw new Error("Checkpoint select not found");
  notes.push(
    `advanced select: ${initial.options.length} options, row height ${initial.rowHeight}px`
  );

  const technical = initial.options.filter(
    (o) => /\.(safetensors|ckpt|pt|pth|bin)$/i.test(o.label) || /[\\\\/]/.test(o.label)
  );
  notes.push(`option labels with technical filenames: ${technical.length}`);
  if (technical.length > 0) {
    throw new Error(`Technical labels rendered: ${technical.slice(0, 3).map((o) => o.label).join(", ")}`);
  }

  const humanize = (raw) => {
    const base = String(raw).replace(/\\\\/g, "/").split("/").pop() ?? String(raw);
    const withoutExt = base.replace(/(?:\\.(?:safetensors|ckpt|pt|pth|bin|gguf|part))+$/i, "");
    const spaced = withoutExt.replace(/[_-]+/g, " ").replace(/\\s+/g, " ").trim();
    return spaced || withoutExt;
  };

  const verifyLabels = (selectState, context) => {
    const mismatches = [];
    for (const model of scanned) {
      const option = selectState.options.find((o) => o.value === model.relativePath);
      if (!option) {
        mismatches.push(`${model.relativePath} missing from ${context} options`);
        continue;
      }
      const expected =
        (model.displayName && model.displayName.trim()) ||
        model.sourceName ||
        model.embeddedTitle ||
        humanize(model.name);
      if (option.label !== expected) {
        mismatches.push(`${model.relativePath}: "${option.label}" != "${expected}"`);
      }
    }
    notes.push(`${context} label mismatches: ${mismatches.length}`);
    if (mismatches.length > 0) throw new Error(mismatches.slice(0, 5).join(" | "));
  };
  verifyLabels(initial, "advanced");

  if (fixtureModel) {
    const fixture = scanned.find((m) => m.relativePath === fixtureModel.relativePath);
    const option = initial.options.find((o) => o.value === fixture.relativePath);
    notes.push(`fixture option label: "${option?.label}" (expected "Nova Anime (Test)")`);
    if (option?.label !== "Nova Anime (Test)") {
      throw new Error("Metadata displayName is not rendered in the selector");
    }
    if (!(await selectCheckpoint(fixture.relativePath))) {
      throw new Error("Could not select the metadata fixture checkpoint");
    }
    initial = await readSelect();
    notes.push(
      `fixture selected: preview ${JSON.stringify(initial.previewBox)}, center delta ${initial.rowCenterDelta}px, row height ${initial.rowHeight}px`
    );
    if (!initial.previewBox) throw new Error("Fixture preview thumbnail did not render");
    if (initial.previewBox.width !== 56 || initial.previewBox.height !== 56) {
      throw new Error(
        `Preview is ${initial.previewBox.width}x${initial.previewBox.height}, expected 56x56`
      );
    }
    if (Math.abs(initial.rowCenterDelta) > 2) {
      throw new Error(`Preview is not vertically centered (delta ${initial.rowCenterDelta}px)`);
    }
    if (initial.rowHeight > 40) {
      throw new Error(`Selector row grew to ${initial.rowHeight}px`);
    }
    const descriptionShown = await bodyIncludes(FIXTURE_DESCRIPTION);
    notes.push(`fixture description rendered: ${descriptionShown}`);
    if (descriptionShown) throw new Error("Checkpoint description is still visible");
    if (!fixture) throw new Error("Fixture model missing after metadata update");
    await screenshot("01-advanced-fixture-selector");
  }

  const alt = scanned.find((m) => m.relativePath !== fixtureModel?.relativePath);
  if (alt) {
    if (!(await selectCheckpoint(alt.relativePath))) {
      throw new Error("Select value no longer matches the model relativePath");
    }
    const after = await readSelect();
    const option = after.options.find((o) => o.value === alt.relativePath);
    const expected = (alt.displayName && alt.displayName.trim()) || humanize(alt.name);
    notes.push(
      `after selecting "${alt.relativePath}": value "${after.value}", label "${option?.label}", expected "${expected}"`
    );
    if (after.value !== alt.relativePath) throw new Error("Checkpoint value changed on selection");
    if (option?.label !== expected) throw new Error("Selected label is not humanized");
    await screenshot("02-advanced-switched");
  } else {
    notes.push("note: only one checkpoint available; selection change skipped");
  }

  const badge = await evaluate(
    `Array.from(document.querySelectorAll("span")).map((s) => s.textContent.trim()).filter((t) => ["SD 1.5","SDXL","Illustrious","Pony","Flux","Z-Image Turbo","Anima","MOSS-Image","Krea 2","LTX Video","Wan Video"].includes(t))`
  );
  notes.push(`architecture badges visible: ${badge.join(", ") || "(none)"}`);

  // Creative mode uses the same display-name helper through checkpointOptions.
  await clickText("Creative", "[role=tab]");
  await waitFor(
    () => evaluate(`!!document.querySelector("#creative-checkpoint")`),
    "creative checkpoint select"
  );
  const creative = await evaluate(`(() => {
    const select = document.querySelector("#creative-checkpoint");
    return {
      value: select.value,
      options: Array.from(select.options).map((o) => ({ value: o.value, label: o.textContent })),
    };
  })()`);
  const creativeMismatch = creative.options.filter(
    (o) => /\.(safetensors|ckpt|pt|pth|bin)$/i.test(o.label) || /[\\\\/]/.test(o.label)
  );
  notes.push(
    `creative select: ${creative.options.length} options, technical labels: ${creativeMismatch.length}`
  );
  if (creativeMismatch.length > 0) {
    throw new Error(
      `Creative labels not humanized: ${creativeMismatch.slice(0, 3).map((o) => o.label).join(", ")}`
    );
  }
  for (const model of scanned) {
    const option = creative.options.find((o) => o.value === model.relativePath);
    if (!option) continue;
    const expected =
      (model.displayName && model.displayName.trim()) || humanize(model.name);
    if (option.label !== expected) {
      throw new Error(`Creative label "${option.label}" != "${expected}"`);
    }
  }
  await screenshot("03-creative-selector");

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
