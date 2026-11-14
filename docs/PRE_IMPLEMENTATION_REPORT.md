# Phase 0 Environment Audit & Repository Comparison Report
**Project:** `ai-image-studio-desktop` (Brand: **Kirea Studio**)  
**Audit Date:** 2026-11-11

---

## Part 1 — Phase 0 Environment Inventory

| Dimension | Verified Finding |
|---|---|
| **Workspace Path** | `<project workspace>` (empty; dedicated project directory `ai-image-studio-desktop` will be created inside it) |
| **OS & CPU** | Microsoft Windows 11 Pro (`10.0.26200`, 64-bit) · AMD Ryzen 7 7800X3D (8 cores / 16 logical processors) |
| **GPU & Driver** | NVIDIA GeForce RTX 4070 Ti SUPER · Driver `617.14` (WDDM `32.0.16.1714`, CUDA UMD `13.4`) |
| **Available VRAM & RAM** | **VRAM:** `16,376 MiB` (`17,170,956,288` bytes total; `~15,111 MiB` / `15.85 GB` free inside CUDA check) · **RAM:** `32,614,388 KB` (`~31.1 GB` total; `~6.7 GB` free at audit due to background apps) |
| **Build & Dev Tooling** | Node.js `v24.22.1`, npm `11.19.1`, Git `2.55.0.windows.3`, Python `3.12.10` (+ `3.10`, `uv` `cpython-3.11.15`), `uv.exe`, VS 2022 BuildTools (`C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools`) |
| **ComfyUI Status** | Not currently running (`127.0.0.1:8188` closed at audit). Two existing installations discovered; **neither modified** |
| **Primary ComfyUI Install** | `<ComfyUI install>` — ComfyUI `v0.45.2` (`local-desktop2-standalone`), `.venv` Python `3.13.12`, PyTorch `2.12.1+cu130` (CUDA `13.0`), `comfyui-frontend-package==1.58.5`, `comfyui-workflow-templates==0.11.106`, `comfyui-manager` |
| **Secondary ComfyUI Install** | `<second ComfyUI install>` — ComfyUI `v0.37.0`, `.venv` Python `3.11.15`, PyTorch `2.11.0+cu128` (CUDA `12.8`), `0 GB` models |
| **Live Inference Verification** | Booted `TES\ComfyUI` isolated on `127.0.0.1:18188` with temp user/output/db args (zero TES file mutations). `/system_stats`, `/models/checkpoints` (12 found), `/prompt`, `/history/{id}`, and `/view` succeeded: generated a valid `512x512` PNG (`260,291` bytes) using `v1-5-pruned-emaonly-fp16.safetensors` in `5.09s` |
| **Existing Models (`TES\ComfyUI\models`)** | **135 files / `162.44 GB` total**: `checkpoints`: 12 (`72.98 GB` — SD 1.5, Juggernaut XL, Illustrious/SDXL variants, plus `ltxv-2b-0.9.8-distilled.safetensors`); `diffusion_models`: 11 (`57.44 GB` — Anima variants, `z_image_turbo_bf16`, Krea2); `loras`: 47 (`7.10 GB`); `text_encoders`: 5 (`23.71 GB`); `upscale_models`: 4 (`0.20 GB`); `vae`: 2 (`0.55 GB`); `controlnet` & `embeddings`: `0` models |
| **Existing Workflows & Nodes** | Only default `websocket_image_save.py` in `custom_nodes`; `user/default/workflows` empty; `comfyui-workflow-templates` installed in `.venv` |
| **Available Storage** | `C:\` `464.43 GB` free · `D:\` `1,128.48 GB` free · `E:\` `809.22 GB` free |
| **Required Downloads** | npm packages for Electron + React + Vite + SQLite + Electron Builder (`~350–500 MB`). **Zero model weights required**. Optional Option B managed runtime targets official `ComfyUI_windows_portable_nvidia.7z` (`v0.45.0`, `1,975.52 MB` download) only when explicitly triggered by the user |

### Compatibility Concerns Identified
1. **Node v24 vs Electron ABI for `better-sqlite3`**: Native SQLite bindings must be compiled against Electron's Node ABI (`@electron/rebuild` / `electron-builder install-app-deps`) using VS 2022 BuildTools, while keeping unit tests runnable cleanly.
2. **Mixed Architecture Checkpoints & Split Models**: `checkpoints/` contains SD 1.5, SDXL/Illustrious, and a video model (`ltxv-2b-0.9.8-distilled.safetensors`), while `diffusion_models/` contains split UNET/DiT models (`z_image_turbo_bf16.safetensors`, Anima). Submitting the wrong checkpoint or incompatible LoRA to `CheckpointLoaderSimple` causes ComfyUI validation failures; the app must classify model families and validate workflow compatibility pre-submit.
3. **Windows Path Separators in `/object_info`**: ComfyUI on Windows can return `\` in relative subfolder model names. Display names can normalize `/`, while ComfyUI submission payloads must retain exact strings reported by `/object_info` or `/models/{folder}`.
4. **System RAM & VRAM Headroom**: With 32 GB system RAM already partially consumed by desktop tools (`~6.7 GB` free during audit), loading `t5xxl_fp16` (`9.33 GB`) or running high-batch SDXL jobs can trigger paging or CUDA OOM. Single active job default, conservative batch sizing, and explicit OOM classification are mandatory.

---

## Part 2 — Mandatory GitHub Repository Comparison Report

### 1. `PotionUI/PotionUI`
- **License:** `GPL-3.0` (GNU General Public License v3.0)
- **Relevant Architecture:** FastAPI + Python backend (`src/bootstrap`, `src/features/*`, `src/platform/*`) with SvelteKit 5 + Tailwind v3 frontend (`frontend/src/routes/*`). Runs its own direct `diffusers`/`transformers`/`torch` inference engine (`worker.py` + `api.py`) rather than wrapping ComfyUI.
- **Valuable Features:** Clean separation of creative workspace modes (`generate`, `library`, `models`, `inspirations`, `prompts`, `settings`), model capability/availability indexing (`model_library`, `memory_advisory.py`), structured form-driven parameter schemas instead of raw node graphs, error classification, and prompt history/tagging.
- **Potential Reusable Components:** UX concepts only (form-driven generation layout, memory advisory heuristics, structured error classification taxonomy). Zero code reuse due to stack difference (FastAPI/SvelteKit/Diffusers) and GPL-3.0 copyleft.
- **Integration Complexity:** Very High if adapting code (Python Diffusers backend replaces ComfyUI, SvelteKit frontend replaces React); Low as a UX/domain reference.
- **Compatibility Risks:** Directly competes with ComfyUI as an inference stack (`diffusers`, `xformers`, `chromadb`, `mediapipe`), heavy Linux-first constraints, and multi-user auth/SaaS subsystems outside our local single-user scope.
- **Legal / Licensing Restrictions:** **Strict GPL-3.0 copyleft.** Copying code would legally require distributing the entire combined desktop application under GPL-3.0.
- **Recommendation:** **Study only.** Learn from its product UX, memory advisories, and feature organization; do not import or copy GPL-3.0 code.

### 2. `mcmonkeyprojects/SwarmUI`
- **License:** `MIT` (MIT License)
- **Relevant Architecture:** C# / .NET 8 ASP.NET Core backend + vanilla JS/HTML frontend, plus an Avalonia WebView desktop shell (`Desktop/Desktop.csproj`). Includes a mature ComfyUI adapter (`src/BuiltinExtensions/ComfyUIBackend/`) supporting both external API (`ComfyUIAPIBackend.cs`) and managed self-start (`ComfyUISelfStartBackend.cs`), plus custom helper nodes (`SwarmComfyCommon/`).
- **Valuable Features:**
  - Dual external vs. self-started ComfyUI lifecycle management.
  - Parsing `/object_info` for checkpoints, LoRAs, VAEs, ControlNets, and Windows backslash vs. forward-slash folder normalization (`ModelFolderFormat`).
  - WebSocket socket pooling, `/features` health pings, explicit user-friendly generation controls backed by clean ComfyUI workflow generation, image metadata embedding, and preset/grid UX.
- **Potential Reusable Components:** ComfyUI lifecycle/discovery patterns, `/object_info` parsing logic, path-separator normalization rules, and backend error/OOM handling ideas (adapted conceptually to TypeScript; MIT permits code adaptation with notice if needed).
- **Integration Complexity:** Moderate-High to port C# classes directly; Low to adapt its ComfyUI discovery, `/object_info` indexing, and workflow-generation patterns into TypeScript.
- **Compatibility Risks:** Relies on .NET 8 + Avalonia + Swarm-specific custom nodes (`SwarmKSampler`, `SwarmSaveImageWS`) which are NOT installed in stock ComfyUI; our app must target stock ComfyUI core nodes so existing installations work untouched without adding Swarm custom nodes.
- **Legal / Licensing Restrictions:** Permissive `MIT`; allows reuse/adaptation provided copyright and permission notices are preserved.
- **Recommendation:** **Adapt (patterns & MIT reference).** Adopt its ComfyUI self-start/API lifecycle design, `/object_info` indexing, and Windows path normalization in our TypeScript adapter without requiring Swarm custom nodes or .NET.

### 3. `Comfy-Org/ComfyUI`
- **License:** `GPL-3.0` (GNU General Public License v3.0)
- **Relevant Architecture:** Python (`asyncio` + `aiohttp`) inference server (`server.py`, `execution.py`, `main.py`, `folder_paths.py`, `comfy/`, `comfy_extras/`). Exposes HTTP REST endpoints (`/system_stats`, `/prompt`, `/queue`, `/interrupt`, `/history`, `/view`, `/upload/image`, `/object_info`, `/models/{folder}`, `/api/jobs`) and WebSocket `/ws?clientId=...` streaming JSON execution events and binary latent preview frames.
- **Valuable Features:** Best-in-class local VRAM/RAM offloading (`comfy-aimdo`), asynchronous execution queue, partial graph caching, native support for SD1.5/SDXL/Flux/Anima/Z-Image/ControlNet/LoRA/Upscalers, and CLI isolation flags (`--listen`, `--port`, `--output-directory`, `--user-directory`, `--models-directory`, `--database-url`, `--offline`).
- **Potential Reusable Components:** Treated strictly as an **external runtime engine** invoked via its official HTTP/WebSocket API and official Windows portable release (`ComfyUI_windows_portable_nvidia.7z`, `v0.45.0`, `1,975.52 MB`).
- **Integration Complexity:** Low via documented HTTP/WS API and process spawn; already verified working against `TES\ComfyUI` (`v0.45.2`).
- **Compatibility Risks:** Endpoint/payload differences across older vs. newer ComfyUI versions (`/api/jobs` exists in v0.45.2, whereas `/prompt`, `/queue`, `/history`, `/interrupt`, `/view` are universal across v0.37+ and v0.45+); custom nodes may alter node schemas.
- **Legal / Licensing Restrictions:** `GPL-3.0`. We **must not** link or bundle ComfyUI Python source directly into proprietary/differently-licensed Electron JS source as a combined work; keeping ComfyUI as a separate external/user-installed engine communicating over localhost HTTP/WS preserves clean process & license boundaries.
- **Recommendation:** **Reuse (as external local inference engine only).** Connect to existing ComfyUI via API or download official Windows portable build from Comfy-Org GitHub Releases on user demand.

### 4. `Comfy-Org/workflow_templates`
- **License:** `MIT` (MIT License)
- **Relevant Architecture:** Official workflow repository (`templates/`, `bundles.json`, `site/`) distributed via PyPI (`comfyui-workflow-templates`) and GitHub. Stores ComfyUI LiteGraph **UI graph JSON** files (including `MarkdownNote` model download links and UUID subgraphs) alongside WebP thumbnails.
- **Valuable Features:** Curated, battle-tested node wirings and exact model URLs/sizes/directory mappings for SDXL (`image_sdxl_simple.json`), Z-Image Turbo (`image_z_image_turbo.json`), Anima (`image_anima_base_v1.json`), etc.
- **Potential Reusable Components:** Model compatibility pairings, recommended sampler/CFG/steps defaults, and official model repository links/folder layouts (`models/checkpoints`, `models/diffusion_models`, `models/text_encoders`, `models/vae`).
- **Integration Complexity:** Moderate — **cannot** be posted directly to `/prompt` because ComfyUI `/prompt` requires flat API prompt format (`{ nodeId: { class_type, inputs } }`), not LiteGraph UI `nodes`/`links`/subgraphs.
- **Compatibility Risks:** Templates using subgraphs or custom nodes won't run out-of-the-box on `/prompt` without flattening to core API nodes.
- **Legal / Licensing Restrictions:** Permissive `MIT`; safe to adapt graph recipes and metadata with attribution.
- **Recommendation:** **Adapt.** Translate proven SD 1.5, SDXL/Illustrious, img2img, and (optionally) Z-Image Turbo recipes into our clean, versioned TypeScript API prompt builders validated with Zod.

### 5. `SaladTechnologies/comfyui-api`
- **License:** `MIT` (MIT License)
- **Relevant Architecture:** TypeScript/Node.js wrapper around ComfyUI (`src/comfy.ts`, `src/types.ts`, `src/server.ts`, `example-workflows/*`) using Fastify, `ws`, `undici`, `zod`, and `sharp`.
- **Valuable Features:**
  - Strongly typed TypeScript definitions & type guards for every ComfyUI WebSocket message (`status`, `progress`, `progress_state`, `executing`, `execution_start`, `execution_cached`, `executed`, `execution_success`, `execution_interrupted`, `execution_error`).
  - Dual completion tracking: `Promise.race` / resilient fallback polling of `/history/{promptId}` alongside WebSocket events so transient WS drops never lose a running job.
  - Zod-validated workflow modules (`RequestSchema` + `generateWorkflow(input) -> ComfyPrompt`).
  - Handling non-file fields in ComfyUI node outputs (e.g., skipping metadata booleans without `filename`).
- **Potential Reusable Components:** TypeScript WebSocket event schemas/guards, history reconciliation poller pattern, and Zod-typed workflow generator pattern (`sd1.5` & `sdxl` `txt2img` / `img2img` prompt structures).
- **Integration Complexity:** Low — written in TypeScript/Node.js, matching our Electron main process directly.
- **Compatibility Risks:** Built as a stateless Docker/cloud HTTP microservice with S3/Azure/Fastify/Swagger/webhook infrastructure we explicitly do **not** want in a local desktop app.
- **Legal / Licensing Restrictions:** Permissive `MIT`; clean to adapt TypeScript types and adapter patterns with MIT attribution in Third-Party Notices.
- **Recommendation:** **Adapt (core TS ComfyUI WS/history/workflow typing patterns); Avoid (Fastify server, S3/Azure, webhook & Docker microservice scaffolding).**

### 6. `ai-dock/comfyui`
- **License:** `Custom Software License` (`NOASSERTION` — proprietary restrictions on modifying/distributing containers/templates without permission, source availability clauses)
- **Relevant Architecture:** Linux Docker base images (`build/COPY_ROOT_0`, `supervisord`, `micromamba`), FastAPI wrapper (`api-wrapper/`), and shell provisioning scripts (`config/provisioning/*.sh`).
- **Valuable Features:** Demonstrates model provisioning checklists (`sd3.sh`, `flux.sh`), environment variable conventions (`HF_TOKEN`, `CIVITAI_TOKEN`, `COMFYUI_ARGS`), and queue separation (`preprocess`, `generation`, `postprocess` workers).
- **Potential Reusable Components:** Conceptual provisioning separation only.
- **Integration Complexity:** High & incompatible — Linux/Docker/Bash/micromamba/Redis architecture does not target native Windows desktop deployment.
- **Compatibility Risks:** Non-Windows OS stack; `supervisord` + Docker + Redis are explicitly prohibited by our architecture rules unless needed.
- **Legal / Licensing Restrictions:** **Restrictive Custom License** forbidding overriding original code and restricting template/container derivative redistribution without separate licensing agreement.
- **Recommendation:** **Avoid** code reuse (study conceptual queue split only; zero code copied).

### 7. `runpod-workers/worker-comfyui`
- **License:** `AGPL-3.0` (GNU Affero General Public License v3.0)
- **Relevant Architecture:** Python serverless worker (`handler.py`, `src/start.sh`, `Dockerfile`) wrapping local `127.0.0.1:8188` ComfyUI for RunPod `/run` & `/runsync` jobs.
- **Valuable Features:** Clean `MODEL_LOADER_NODES` pre-flight check mapping loader node `class_type` (`CheckpointLoaderSimple`, `LoraLoader`, `VAELoader`, `UNETLoader`, etc.) to model folder types before submitting a workflow, plus WebSocket reconnection parameters and ComfyUI PID health checks.
- **Potential Reusable Components:** Conceptual pre-flight model-existence validation map and future remote worker contract reference.
- **Integration Complexity:** Low as reference; High/irrelevant as dependency (RunPod SDK + Docker).
- **Compatibility Risks:** Cloud serverless worker only; unnecessary external dependency for local-first v1.
- **Legal / Licensing Restrictions:** **Strict AGPL-3.0 copyleft.** Do not copy or incorporate any code.
- **Recommendation:** **Study only** (keep as architectural reference for future optional cloud GPU workers; copy zero code).

---

## Part 3 — Target Architecture Summary (`ai-image-studio-desktop`)

| Layer | Choice | License / Rationale |
|---|---|---|
| **Desktop Shell** | Electron + Electron Builder (Windows NSIS installer, desktop & Start Menu shortcuts, `contextIsolation: true`, `nodeIntegration: false`, sandboxed renderer, strict typed IPC) | Industry-standard Windows desktop distribution; clean process ownership |
| **Frontend UI** | React + TypeScript + Vite + Tailwind CSS + Lucide icons | Fast, responsive desktop studio UI with original **Kirea Studio** dark aesthetic |
| **Local Persistence** | SQLite (`better-sqlite3`) with versioned migrations & transactions in Electron main process | Embedded, zero-server, ACID local storage in `app.getPath('userData')` |
| **ComfyUI Adapter** | Dedicated TypeScript module in Electron main (`ComfyRuntimeManager`, `ComfyApiClient`, `ComfyWsClient`, `WorkflowRegistry` with Zod schemas) | Keeps GPL-3.0 ComfyUI isolated over localhost HTTP/WS; recovers from WS drops via `/history` & `/queue` |
| **Managed Runtime (Option B)** | Guided user-initiated download of official `ComfyUI_windows_portable_nvidia.7z` (from `Comfy-Org/ComfyUI` releases) with pause/resume/cancel/disk-space check/integrity verification into `userData/runtime/` | Official Windows CUDA-compatible runtime without touching system Python or existing user installs |
