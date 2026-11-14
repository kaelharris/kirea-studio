# Development

Everything you need to run, test, and package Kirea Studio. For how the pieces fit together, read [Architecture](ARCHITECTURE.md).

## Prerequisites

| Requirement | Notes |
|---|---|
| Windows 10/11 x64 | The app packages for Windows only; the renderer itself is ordinary web code |
| Node.js 22+ | Node 24 is what the release was built and tested with |
| npm 10+ | `package-lock.json` is committed |
| A local ComfyUI install | Optional. You can develop and browse the UI without one; generation needs an engine |

No Python, CUDA, or model weights are required to build the application.

## First run

```powershell
npm install
npm run rebuild:electron
```

`better-sqlite3` is a native module. `rebuild:electron` recompiles it against Electron's ABI; skipping it usually shows up as a `NODE_MODULE_VERSION` error when the main process opens the database.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Starts Vite on port 5173 with HMR. Does not launch Electron. |
| `npm run build:renderer` | Builds the renderer into `dist/` |
| `npm run build:electron` | Compiles the main and preload processes into `dist-electron/` |
| `npm run build` | Both of the above |
| `npm run start` | Builds everything, then runs `electron .` |
| `npm run typecheck` | `tsc --noEmit` for the renderer and the main project |
| `npm test` | Full Vitest suite |
| `npm run test:unit` | Unit tests only |
| `npm run test:integration` | Integration tests, including the live ComfyUI test when enabled |
| `npm run pack:win` | Unpacked Windows build (`electron-builder --dir`) |
| `npm run dist:win` | NSIS installer into `release/` |
| `npm run rebuild:electron` | Rebuilds `better-sqlite3` for Electron |

There is no lint script. TypeScript strictness and the tests are the gate.

## Recommended loop

Run the renderer with hot reload and the main process separately:

```powershell
# terminal 1
npm run dev

# terminal 2 — recompile after main-process edits, then launch
npm run build:electron
$env:VITE_DEV_SERVER_URL = "http://localhost:5173"
npx electron .
```

`VITE_DEV_SERVER_URL` switches the main window to the dev server and accepts that origin in the trusted-sender check. If the variable is absent, the window loads `dist/index.html`.

After changing anything in `src/main`, rerun `npm run build:electron` and restart Electron. Renderer changes only need HMR.

## Repository layout

```
src/
  main/            Electron main process
    comfy/         ComfyUI client, runtime manager, workflow registry
    db/            SQLite, migrations, repositories
    ipc/           Channel handlers and Zod schemas
    jobs/          Generation queue and lifecycle
    models/        Non-destructive model scanning
    downloads/     Verified download manager
    civitai/       Civitai client and key store
    images/        PNG/JPEG/WebP writing and export
    stories/       Story canvas export
  preload.ts       contextBridge API
  renderer/        React 19 + Tailwind 4 application
    pages/         Home, Create, Explore, Library, Characters, Stories, Models, Workflows, Queue, Settings
    components/    Shared UI, Create, Models, Story, dialogs
    app/           Navigation, theme, controller, constants
  shared/          Types, IPC channels, API contract, presets, layout math
tests/
  unit/            Pure logic, repositories, contracts, security
  integration/     ComfyUI lifecycle and the opt-in live generation test
```

## Testing

```powershell
npm run typecheck
npm test
```

The suite covers database migrations, repository behavior, model scanning and classification, aspect-ratio snapping, workflow compilation and validation, the PNG metadata reader/writer, Civitai requests and downloads, the secure key store, the canvas layout, and the IPC/preload contract.

The live end-to-end test is skipped unless you point it at a real engine:

```powershell
$env:KIREA_E2E_COMFY_PATH = "C:\ComfyUI"
npm run test:integration
```

It boots that installation in an isolated, read-only configuration on port 18190, generates a 512 px SD 1.5 image, verifies embedded metadata and the database record, then stops the process it started. It never modifies the external installation.

## Packaging

```powershell
npm run dist:win
```

Configuration is in `electron-builder.yml`: NSIS x64, per-user install, configurable install directory, Desktop and Start Menu shortcuts, and no app-data deletion on uninstall. The artifact is `release/Kirea-Studio-Setup-<version>-win-x64.exe`.

If a process holds files inside the workspace (antivirus, an editor indexing `node_modules`, or a running dev build), electron-builder can fail with `EBUSY` or `EPERM` while unlinking `default_app.asar`. Build to an output directory outside the repository instead:

```powershell
npx electron-builder --win nsis --config.directories.output=C:\temp\kirea-build
```

Release checklist: bump `version` in `package.json` and `package-lock.json`, update the splash version label, write the `RELEASE_NOTES.md` entry, run typecheck and tests, build the installer, install it once, and confirm the exe icon, shortcuts, and a real screen render.

## Local data

| What | Where |
|---|---|
| Database, logs, caches | `%APPDATA%\ai-image-studio-desktop` |
| Managed runtime | `%APPDATA%\ai-image-studio-desktop\runtime\comfyui-managed` |
| App-managed models | `%APPDATA%\ai-image-studio-desktop\models` |
| Generated images | `%USERPROFILE%\Pictures\Kirea Studio` |

To test a clean first-run experience without touching your real data, close the app, rename `%APPDATA%\ai-image-studio-desktop` to `ai-image-studio-desktop.bak`, and launch again. Rename it back when you are done; the app recreates the folder on first start.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `NODE_MODULE_VERSION` mismatch | `better-sqlite3` built for Node instead of Electron | `npm run rebuild:electron` |
| Header says disconnected on 127.0.0.1:8188 | No engine is listening, or it is bound to another port | Start ComfyUI or set the port in Settings |
| Generate stays disabled | Empty prompt, no checkpoint selected, or a validation error | Read the inline validation message; the engine must be connected to submit |
| Blank window in development | `VITE_DEV_SERVER_URL` is set but Vite is not running | Start `npm run dev` first |
| Installer build fails with `EBUSY` | Another process holds `release/` or `node_modules` | Build to an external output directory (see above) |
| Settings never persist | The database could not open and was quarantined | Check the log in `%APPDATA%\ai-image-studio-desktop\logs` and look for a `.corrupt.*.bak` database |

## Conventions

- Keep the renderer free of filesystem, database, and network access. New capabilities go through the typed IPC boundary.
- Validate every IPC payload with Zod and extend `src/shared/api.ts` and `ipc-channels.ts` together.
- Add migrations; never edit a migration that has shipped.
- Reuse the design tokens in `src/renderer/index.css` instead of hard-coded colors. Both themes must stay legible.
- Do not add dependencies without a clear reason; the runtime stays small on purpose.

See [Contributing](../CONTRIBUTING.md) for the submission workflow.
