# Third-Party Notices & Attribution — Kirea Studio

Kirea Studio (`ai-image-studio-desktop`) is original MIT-licensed desktop software.
This file documents external open-source packages, runtime boundaries, and architecture/workflow references.

---

## 1. Local Inference Engine Boundary

### ComfyUI (https://github.com/Comfy-Org/ComfyUI)
- **License:** GNU General Public License v3.0 (GPL-3.0)
- **Integration Boundary:** ComfyUI is NOT compiled, statically linked, or bundled as source/library code inside Kirea Studio. Kirea Studio communicates with either a user-selected existing ComfyUI installation (Option A) or an official isolated Comfy-Org Windows Portable release explicitly downloaded by the user into `userData/runtime` (Option B) strictly via localhost HTTP/WebSocket APIs (`/system_stats`, `/prompt`, `/queue`, `/history`, `/view`, `/upload/image`, `/interrupt`, `/ws`).

---

## 2. Permissive Open-Source Architecture & Workflow References

### Comfy-Org/workflow_templates (https://github.com/Comfy-Org/workflow_templates)
- **License:** MIT License
- **Usage:** Structural node wiring patterns for SDXL, SD 1.5, Img2Img, and Z-Image Turbo (`UNETLoader`, `CLIPLoader type="lumina2"`, `ModelSamplingAuraFlow`, `ConditioningZeroOut`, `EmptySD3LatentImage`) were adapted cleanly into Kirea Studio's independent workflow registry (`src/main/comfy/workflow-registry.ts`).

### SwarmUI (https://github.com/mcmonkeyprojects/SwarmUI)
- **License:** MIT License
- **Usage:** UX reference for desktop generation studio ergonomics, parameter presets, image metadata reuse, and local ComfyUI backend orchestration patterns. No C# source code was copied.

### SaladTechnologies/comfyui-api (https://github.com/SaladTechnologies/comfyui-api)
- **License:** MIT License
- **Usage:** Design inspiration for explicit lifecycle job states, output retrieval/retry handling, and error classification patterns. No source files were copied.

---

## 3. Pixel Studio Engines

### Pixelbolt 0.17.0 (https://github.com/kaelharris/pixelbolt — vendored under `external/pixel-engines/pixelbolt`)
- **License:** MIT License
- **Usage:** Bundled engine for deterministic pixel-art rendering and export encoders (PNG, APNG, GIF, sprite sheets, Godot/Unity/Phaser atlas metadata, ZIP). Loaded dynamically from `resources/pixel-engines/pixelbolt` in packaged builds. Its license and package metadata are copied alongside the source.

### SpriteKiln (vendored under `external/pixel-engines/spritekiln` for inspection only)
- **License:** GNU General Public License v3.0
- **Integration Boundary:** Not bundled, not packaged, and not installed into any ComfyUI instance. Kirea Studio reads workflow JSON files to report required custom nodes and model files, and never executes SpriteKiln code or downloads its model tiers automatically.

---

## 4. Bundled NPM Dependencies (All Permissive)

- **Electron** (`^45.3.0`) — MIT
- **React & React DOM** (`^19.3.1`) — MIT
- **Vite** (`^8.x`) — MIT
- **Tailwind CSS & @tailwindcss/vite** (`^4.3.5`) — MIT
- **better-sqlite3** (`^13.1.1`) — MIT
- **sharp / libvips** (`^0.34.5`) — Apache-2.0 / LGPL-3.0 dynamically loaded prebuilt binaries
- **ws** (`^8.22.2`) — MIT
- **zod** (`^4.3.6`) — MIT
- **lucide-react** (`^1.72.0`) — ISC
- **7zip-bin** (`^5.2.0`) — MIT (distributes 7-Zip standalone console binary `7za.exe` under LGPL / BSD 3-Clause for extracting official `.7z` ComfyUI releases)

---

## 5. Curated Optional Downloadable Model Sources (Opt-In Only)

Models in Kirea Studio's curated catalog are never bundled in the installer and are only downloaded when explicitly selected by the user:
- **Stable Diffusion 1.5 (FP16 Pruned EMA):** Comfy-Org / RunwayML — CreativeML Open RAIL-M License
- **SDXL VAE FP16 Fix (`madebyollin/sdxl-vae-fp16-fix`):** MIT License
- **RealESRGAN x4plus (`xinntao/Real-ESRGAN`):** BSD-3-Clause License

