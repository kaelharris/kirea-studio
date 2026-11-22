import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const EXE =
  process.env.KIREA_ELECTRON ??
  path.join(ROOT, "node_modules", "electron", "dist", "electron.exe");
const PORT = Number(process.env.KIREA_PORT ?? 9477);
const PROFILE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-mature-profile-"));
const SOURCE_PROFILE = path.join(process.env.APPDATA ?? "", "ai-image-studio-desktop");

for (const suffix of ["", "-wal", "-shm"]) {
  const source = path.join(SOURCE_PROFILE, `kirea-studio.db${suffix}`);
  if (fs.existsSync(source)) {
    fs.copyFileSync(source, path.join(PROFILE_DIR, `kirea-studio.db${suffix}`));
  }
}

function connect(socket) {
  let id = 1;
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
  return (expression) =>
    new Promise((resolve, reject) => {
      const requestId = id++;
      pending.set(requestId, {
        resolve: (result) => {
          if (result.exceptionDetails) {
            reject(new Error(result.exceptionDetails.text ?? "evaluation failed"));
            return;
          }
          resolve(result.result?.value);
        },
        reject,
      });
      socket.send(
        JSON.stringify({
          id: requestId,
          method: "Runtime.evaluate",
          params: { expression, returnByValue: true, awaitPromise: true },
        })
      );
    });
}

async function launch() {
  const child = spawn(
    EXE,
    [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE_DIR}`, ...(process.env.KIREA_ELECTRON ? [] : ["."])],
    { cwd: ROOT, stdio: "ignore" }
  );
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const target = targets.find(
        (item) => item.type === "page" && String(item.url).startsWith("file:")
      );
      if (target?.webSocketDebuggerUrl) {
        const socket = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          socket.addEventListener("open", resolve, { once: true });
          socket.addEventListener("error", reject, { once: true });
        });
        const evaluate = connect(socket);
        const shellDeadline = Date.now() + 45000;
        while (Date.now() < shellDeadline) {
          if (await evaluate(`document.body.innerText.includes('Create')`)) break;
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
        return { child, evaluate };
      }
    } catch {
      // still booting
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error("Renderer did not boot");
}

async function stop(child) {
  child.kill();
  await new Promise((resolve) => setTimeout(resolve, 2500));
}

const first = await launch();
const initial = await first.evaluate(`window.kirea.getSettings()`);
console.log("initial nsfwFilter:", initial.nsfwFilter);
await first.evaluate(`window.kirea.updateSettings({ nsfwFilter: true })`);
const afterSafe = await first.evaluate(`window.kirea.getSettings()`);
console.log("after switching safe browsing on:", afterSafe.nsfwFilter);
if (afterSafe.nsfwFilter !== true) throw new Error("Settings did not update");
await stop(first.child);

const second = await launch();
const safePersisted = await second.evaluate(`window.kirea.getSettings()`);
console.log("after restart (safe):", safePersisted.nsfwFilter);
await second.evaluate(`window.kirea.updateSettings({ nsfwFilter: false })`);
const afterMature = await second.evaluate(`window.kirea.getSettings()`);
console.log("after enabling mature:", afterMature.nsfwFilter, "(false = enabled)");
await stop(second.child);

const third = await launch();
const maturePersisted = await third.evaluate(`window.kirea.getSettings()`);
console.log("after restart (mature):", maturePersisted.nsfwFilter, "(false = enabled)");
await third.evaluate(`window.kirea.updateSettings({ nsfwFilter: true })`);
const restored = await third.evaluate(`window.kirea.getSettings()`);
console.log("restored safe default:", restored.nsfwFilter);
await stop(third.child);

if (safePersisted.nsfwFilter !== true) {
  console.error("FAIL safe-browsing setting did not persist across restart");
  process.exitCode = 1;
} else if (maturePersisted.nsfwFilter !== false) {
  console.error("FAIL mature setting did not persist across restart");
  process.exitCode = 1;
} else if (restored.nsfwFilter !== true) {
  console.error("FAIL safe default was not restorable");
  process.exitCode = 1;
} else {
  console.log("PASS mature/safe setting persists in both directions across restarts");
}
