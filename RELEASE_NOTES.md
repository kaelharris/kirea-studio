# Release Notes — Kirea Studio v1.1.1

**Release Date:** 2026-11-23

**Target Platform:** Windows 10 / Windows 11 (x64)

## Highlights

- **MOSS-Image integration:** Native split-pipeline workflows for Base, SFT, Turbo, Layout, Edit, and color/depth control, with component dependency checks, curated model downloads, and provenance-aware labels.
- **Illustrious 10-LoRA expansion:** Dedicated text-to-image and image-to-image pipelines support up to ten sequential LoRA adapters with architecture-aware validation.
- **Studio enhancements:** Expanded model discovery and preview metadata, Civitai workflow browsing, Hugging Face Hub support, unified library tools, and Create editing refinements.
- **Workspace density:** Advanced Create keeps the prompt composer in the center creation flow with Generate embedded at the lower-right of the prompt input, and reserves the left panel for settings. The Create workspace flex-fills the available window height with no residual bottom shell gap, and ordinary cards/panels use open spacing or dividers instead of nested boxes while inputs, dialogs, and selectable media retain clear boundaries.
- **Release hygiene:** Current version surfaces are synchronized and releases now run a deterministic Node verification check before building.

---

# Release Notes — Kirea Studio v1.0.1

**Release Date:** 2026-11-13  
**Target Platform:** Windows 10 / Windows 11 (x64)

Renderer-only polish release. No changes to IPC contracts, SQLite schemas (v1–v5), ComfyUI workflow compilers, generation state machines, or export pipelines.

- **Craft visual language:** Manrope / Geist Mono typography, `#121216` ground, sharp uppercase mono buttons, no gradients; contrast and focus-ring accessibility pass across all pages.
- **Create:** the "Prompt cannot be empty" error no longer appears on first mount; a neutral hint shows until a prompt is written (Generate stays disabled). Ctrl+Enter on an empty prompt reveals the error.
- **Library:** records whose files were moved or deleted outside Kirea now show a "File missing" tile with Details and Remove, plus a banner to remove all missing entries after confirmation.
- **Accessibility:** generation start, completion, failure and cancellation are announced to screen readers via a polite live region; modal dialogs recapture focus if it escapes the panel.
- **Themes:** Dark, Light and Match system themes built on one token set (charcoal / warm ivory grounds, sand primary, electric-blue interaction). On first launch the UI stays hidden under the splash until the saved theme is known, so it no longer flashes the wrong theme.
- **Home:** new ultra-wide surreal hero artwork, matching the splash, that fades into the copy. An optional **Blur** toggle keeps Recent creations thumbnails blurred until hovered (handy when screen sharing; remembered on this machine).
- **Runtime banner:** shown only on Home, Create and Workflows. It always uses a friendly message, with the raw engine error behind a "Technical details" toggle. The duplicate header Start Engine / New generation buttons are gone.
- **Light mode contrast:** secondary text darkened to #67635B (≥ 4.5:1 on every light surface). Disabled Generate and other blue actions now use solid, legible tints instead of a faded look.
- **Models:** the Local Vault / Discover / Downloads tabs use the compact utility style, and the selected tab is announced as pressed.
- **App icon:** new line-art Aphrodite mark on a light rounded tile, used for the exe, installer, shortcuts, window/taskbar and favicons (the previous dark icon set is kept in `vibe_images/brand-source/icon-henix-v1/`). The sidebar logo uses the same mark and follows the theme ink in dark and light modes.
- **Network identity:** Civitai, model-download and runtime requests now send `KireaStudio/1.0.1` as the User-Agent.
- **Cleanup:** unused hero images were removed from the bundle.

---

# Release Notes — Kirea Studio v1.0.0

**Release Date:** 2026-11-11  
**Target Platform:** Windows 10 / Windows 11 (x64)

## Highlights

- **Standalone Windows Desktop Application:** Packaged via Electron Builder NSIS x64 installer with Desktop & Start Menu shortcuts and custom multi-resolution application icon (`Kirea Studio`).
- **Private Local Inference via ComfyUI API:** Connects safely over loopback HTTP & WebSocket (`127.0.0.1:8188` default) with zero external telemetry or mandatory accounts.
- **Non-Destructive Existing Install Support (Option A) & Managed Installer (Option B):** Auto-discovers existing ComfyUI folders without altering them, or guides installation of the official Comfy-Org Windows Portable NVIDIA runtime.
- **SeaArt-Inspired Creative Studio (`Create`):** Supports Text-to-Image, Image-to-Image, and standalone **4× AI Super-Resolution (`Upscale`)** workflows (`SDXL`, `Illustrious`, `Pony`, `SD 1.5`, `Z-Image Turbo`, `upscale_model_v1`), optional **2-Pass High-Res Fix** (`Latent Bislerp`/`Bicubic` or `.pth` AI upscalers like `RealESRGAN_x4plus`, `RealESRGAN_x4plus_anime_6B`, `4x-AnimeSharp`, `4x_foolhardy_Remacri`), multi-LoRA stacking, snapped aspect ratios, live WebSocket previews, queue controls, and performance profiles.
- **Complete Local Library & Asset Management:** Persistent SQLite metadata index, one-click **"Upscale Image"** routing from any Library creation or Result canvas bar, PNG `tEXt` metadata preservation (including `hiresFix` / `upscale` params), JPEG/WebP conversion + privacy metadata stripping export, collections, tags, saved prompts, curated opt-in model downloads with SHA-256 verification & pause/resume.

