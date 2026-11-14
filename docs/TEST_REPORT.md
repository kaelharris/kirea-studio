# Kirea Studio — Test & Verification Report

**Product Version:** `1.0.0`  
**Verification Date:** November 12, 2026  
**Target Platform:** Windows 11 64-bit (`Microsoft Windows NT 10.0.26200.0`, x64)  
**Verified Hardware:** `NVIDIA GeForce RTX 4070 Ti SUPER` (Driver `617.14`, `16376 MiB` VRAM)  
**Node / Electron Stack:** Node `v24.22.1`, Electron `45.3.0`, Electron Builder `26.18.0`, Vite `8.3.8`, Vitest `5.1.0`

---

## 1. Automated Verification Summary

All automated checks below were executed after the latest `2026-11-12` source edits (`src/shared/*`, `src/main/*`, `src/renderer/*`, `tests/*`).

### TypeScript Typechecking & Production Bundle

- **Typecheck Command:** `npm run typecheck` (`tsc --noEmit && tsc -p tsconfig.main.json --noEmit`)
  - **Result:** Passed (Exit code `0`, zero TypeScript errors across renderer and Electron main/preload/shared targets).
- **Build Command:** `npm run build` (`vite build && tsc -p tsconfig.main.json`)
  - **Result:** Passed (`2131` modules transformed in `622ms`, Electron main TypeScript compiled cleanly).

### Unit & Integration Test Suite (`vitest run`)

- **Command:** `npm test`
- **Result:** **16 / 16 test files passed, 109 / 109 tests passed** in `17.34s`.

| Test File | Scope | Result | Timing |
|---|---|---|---|
| `tests/unit/workflows-and-ratios.test.ts` | Workflow templates (`SDXL`, `Illustrious`, `Pony`, `SD1.5`, `Z-Image Turbo`, `Anima`, `upscale_model_v1`, `upscale_refiner_v1`), aspect ratio & Hires Fix dimension snapping, LoRA stacking, Latent & Refiner graphs | 11 / 11 passed | `10ms` |
| `tests/unit/security-and-contracts.test.ts` | Preload sandbox contract safety, loopback host restrictions, IPC channel parity | 3 / 3 passed | `5ms` |
| `tests/unit/model-scanner.test.ts` | Non-destructive ComfyUI & YAML scanning, `put_*_here` exclusion, sidecar/preview discovery | 7 / 7 passed | `72ms` |
| `tests/unit/characters.test.ts` | Character identity token composition/removal, reference mode planning, DB persistence | 18 / 18 passed | `81ms` |
| `tests/unit/stories.test.ts` | Story CRUD, scene cast resolution, prompt merging, story generation planning | 9 / 9 passed | `55ms` |
| `tests/unit/canvas-layout.test.ts` | Story canvas grid/filmstrip/freeform pagination, margins, slot layout | 9 / 9 passed | `8ms` |
| `tests/unit/canvas-repository.test.ts` | Story canvas item CRUD, overlays serialization, story sync, export records | 5 / 5 passed | `62ms` |
| `tests/unit/canvas-html.test.ts` | Storyboard HTML escaping, color sanitization, overlay markup rendering | 5 / 5 passed | `4ms` |
| `tests/unit/civitai-client.test.ts` | CivitAI API search/detail mapping, HTML stripping, local installed-model matching, auth errors | 23 / 23 passed | `38ms` |
| `tests/unit/civitai-key-store.test.ts` | DPAPI `safeStorage` encryption round-trip, plaintext fallback refusal, legacy unencrypted file rejection | 3 / 3 passed | `12ms` |
| `tests/unit/civitai-download-manager.test.ts` | Path sanitization, `.civitai.info` sidecars, streaming download, cancel `.part` cleanup, SHA-256 verification, cross-origin redirect auth stripping & preview URL validation | 8 / 8 passed | `406ms` |
| `tests/unit/image-exporter.test.ts` | PNG `tEXt` chunk embedding (`kirea_meta` + ComfyUI chunks), JPEG/WebP conversion & metadata stripping | 1 / 1 passed | `23ms` |
| `tests/unit/database.test.ts` | SQLite WAL initialization, schema v1–v5 migrations, corrupted DB backup & clean recovery | 4 / 4 passed | `106ms` |
| `tests/unit/download-manager.test.ts` | HTTP `Range` pause/resume, SHA-256 digest validation, mismatch rejection | 1 / 1 passed | `347ms` |
| `tests/integration/comfy-lifecycle.test.ts` | Mocked ComfyUI HTTP/WS lifecycle: `txt2img`, `img2img` upload, cancel interrupt, `CUDA_OOM` classification, WS drop `/history` recovery | 1 / 1 passed | `1720ms` |
| `tests/integration/live-comfy-e2e.test.ts` | Live isolated ComfyUI (`<ComfyUI install>`) on `127.0.0.1:18190`: real `512×512` SD 1.5 inference, standalone `2×` AI Upscale, `1.5×` 2-Pass High-Res Fix, PNG metadata & SQLite DB persistence, clean owned PID shutdown | 1 / 1 passed | `16844ms` |

---

## 2. Current Windows Installer Build (2026-11-12) & Historical Baseline

### Rebuilt NSIS Installer (`2026-11-12`)

- **Build Command:** `npm run dist:win` (`npm run build && electron-builder --win nsis`)
- **Result:** Exited with code `0` (`vite` transformed `2131` modules in `602ms`; includes asset/dependency cleanup, modular codebase refactor, and security hardening).
- **Packaged Installer:** `release/Kirea-Studio-Setup-1.0.0-win-x64.exe`
  - **Size:** `144,922,763` bytes (~138.2 MiB)
  - **SHA-256:** `F781DF6DA66C0E970BDBF1873E4B931B402FC017141EC1AAA54C289E88EBBC2B`
- **Packaged ASAR (`release/win-unpacked/resources/app.asar`):**
  - **Size:** `44,533,324` bytes
  - **SHA-256:** `A1504152FBA18DC21D99323BCE98DB3CC78EC8A4A225D46851E23555A91CEE81`

### Historical Phase 2 Baseline (`2026-11-11` Installer Walkthrough)

> Note: The interactive CDP UI walkthrough below in Section 3 was recorded on the prior `2026-11-11` installed build (`154,537,512` bytes, SHA-256 `CB6ECBB5D38CA56C09DDF40DE2FF638AE3A885D0029B99DD38C668CBC9E6CE71`, `6,600` packed ASAR entries verified against integrity hashes with `0` mismatches).

### NSIS Installer & Windows Shortcuts

- **Installation Command:** Executed `release\Kirea-Studio-Setup-1.0.0-win-x64.exe /S` (exit code `0`) after clearing prior test `userData` (`%APPDATA%\ai-image-studio-desktop`).
- **Installed Binary Path:** `%LOCALAPPDATA%\Programs\Kirea Studio\Kirea Studio.exe` (`249,303,040` bytes)
- **Uninstaller:** `%LOCALAPPDATA%\Programs\Kirea Studio\Uninstall Kirea Studio.exe` (`227,149` bytes)
- **Desktop Shortcut:** `%USERPROFILE%\Desktop\Kirea Studio.lnk`
  - Target: `%LOCALAPPDATA%\Programs\Kirea Studio\Kirea Studio.exe`
  - Working Directory: `%LOCALAPPDATA%\Programs\Kirea Studio`
  - Icon: `%LOCALAPPDATA%\Programs\Kirea Studio\Kirea Studio.exe,0`
- **Start Menu Shortcut:** `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Kirea Studio\Kirea Studio.lnk`

---

## 3. End-to-End Verification on the Installed Desktop Application

Executed against the installed binary (`%LOCALAPPDATA%\Programs\Kirea Studio\Kirea Studio.exe`) and the Windows Desktop shortcut (`Kirea Studio.lnk`):

1. **Cold Launch & Hardware / Runtime Auto-Discovery:**
   - Window opened with title `Kirea Studio`; renderer bridge (`window.kirea`) active; zero Chromium console errors/warnings (`[]`) and zero uncaught JS exceptions (`[]`).
   - Topbar and Home card displayed live GPU telemetry (`NVIDIA GeForce RTX 4070 Ti SUPER`, `13.7 / 16 GB VRAM free`).
   - Option A discovery automatically selected `<ComfyUI install>` (read-only) and scanned **81 local models** (`13 checkpoints`, `47 LoRAs`, VAEs/encoders/upscalers/embeddings; updated to **82 models** upon live engine connection).
2. **Engine Launch & Live Inference from UI:**
   - Clicked `Start Engine` in the installed UI; ComfyUI v0.45.2 (`PyTorch 2.12.1+cu130`, `Python 3.13.12`) started on `http://127.0.0.1:8188` (`1064` nodes) with `ComfyUI: Connected v0.45.2`.
   - Selected `[SD15] v1-5-pruned-emaonly-fp16`, pipeline `t2i_sd15_base`, `512×512`, and generated a real PNG image saved to `%USERPROFILE%\Pictures\Kirea Studio\2026-11-11\kirea_2026-11-11T19-41-04_s1856893878_1.png`.
   - Rendered preview and `Library` card via `kirea-media://` (`naturalWidth: 512`, `naturalHeight: 512`) and toggled Favorite (`favorite: true`).
3. **Graceful Exit & Process Cleanup:**
   - Closing the main window triggered clean shutdown of the owned ComfyUI subprocess (`Stopping owned ComfyUI PID 108824` -> `Kirea Studio shut down cleanly.`, process exit code `0`).
   - Post-exit process check confirmed `0` lingering `Kirea Studio` or ComfyUI `python` processes.
4. **Desktop Shortcut Launch & Persistence Across Restarts:**
   - Launched `%USERPROFILE%\Desktop\Kirea Studio.lnk` directly and confirmed main window creation (`MainWindowHandle: 1182306`) and clean shutdown.
   - Relaunched and verified SQLite (`kirea-studio.db`) retained the generated image record (`img_28019a86-855`), favorite state (`favorite: true`), configured external ComfyUI path, and scanned model catalog (`82` entries).
5. **Phase 2 UI & Upgrade Smoke Verification on Installed App (`Browser.close` exit `0`):**
   - Executed silent NSIS upgrade (`release\Kirea-Studio-Setup-1.0.0-win-x64.exe /S`, `ExitCode: 0`) preserving user SQLite library & `%USERPROFILE%\Pictures\Kirea Studio` outputs.
   - Inspected live `Create` view over CDP: verified all 3 mode tabs (`Text to Image`, `Image to Image`, `Upscale`), `High-Res Fix` toggle panel listing `latent_bislerp` + all 4 scanned `.pth` upscalers (`4x-AnimeSharp.pth`, `4x_foolhardy_Remacri.pth`, `RealESRGAN_x4plus.pth`, `RealESRGAN_x4plus_anime_6B.pth`), `Workflows` showing `upscale_model_v1`, and Library modal `Upscale Image` flow routing cleanly into `Upscale` (`consoleErrors: []`, `pageExceptions: []`, `exitCode: 0`).
6. **External ComfyUI Non-Mutation Check:**
   - Verified `<ComfyUI install>\output` remained at `227` items, `<ComfyUI install>\main.py` modification timestamp remained untouched (`2026-11-11 6:26:33 PM`), and `0` Kirea Studio or ComfyUI processes remained running after exit.

---

## 4. Known Scope Boundaries (v1.0.0 Initial Local Release)

- Option B (`Download & Install Managed Runtime`) download/extraction mechanics are verified via unit tests on `DownloadManager` (`Range` resume + SHA-256 verification) and bundled `7za.exe`; full live download of the ~1.5+ GB GitHub portable archive was not executed to avoid unneeded multi-gigabyte bandwidth/disk usage when a working local ComfyUI install is already present.
- Installer executable (`Kirea-Studio-Setup-1.0.0-win-x64.exe`) and `Kirea Studio.exe` are unsigned (no Authenticode code-signing certificate configured for local builds).

