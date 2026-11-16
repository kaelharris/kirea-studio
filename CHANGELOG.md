# Changelog

All notable changes to **Kirea Studio** are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

#### Global Media Aspect Ratio & Display Consistency
* **Intrinsic Media Display Preservation**:
  * Enforced universal `object-contain object-center` presentation standard across all workspaces, cards, previews, inspectors, and media viewers.
  * Completely eliminated unintended media cropping (`object-cover`) on portrait, landscape, ultrawide, square, and non-standard aspect ratio assets.
  * Added auto-normalization in `MediaImage` to detect and safely transform accidental `object-cover` into `object-contain object-center`.
* **Model & Civitai Previews**:
  * Updated `ModelPreview`, `RemotePreview`, `CivitaiHubView`, and `ModelModals` to center-letterbox models in neutral `bg-well` containers with comfortable padding (`p-1` / `p-1.5`), ensuring checkpoints, LoRA previews, and sample gallery cards display 100% of their original visual frame.
* **Workflows & Characters**:
  * Standardized workflow cards and detail modal previews in `WorkflowsPage` with `aspect-video bg-well` letterboxing and containment.
  * Updated `CharactersPage` character cards, covers, and reference thumbnails to preserve portrait and landscape reference proportions without edge clipping.
* **Unified Library & Video Studio**:
  * Updated `LibraryPage` grid cards, list rows, inspector character reference thumbnails, and video previews to maintain intrinsic aspect ratios.
  * Updated `VideoStudioPage` image-to-video source preview and history playback thumbnails with centered containment.
* **Pixel Studio & Story Studio**:
  * Updated pixel import asset previews with crisp `[image-rendering:pixelated]` containment.
  * Updated Story Studio canvas items and default story database repository to default panel fit to `contain`.

#### Unified Multi-Modal Library
* **Multi-Select & Batch Actions**:
  * Added selection mode toggle in the library header and selection checkboxes on every `MediaCard` (grid view) and `MediaRow` (list view).
  * Added sticky floating batch actions bar with real-time selection counter.
  * **Batch Delete**: Safety confirmation modal detailing counts across all media types (*Images, Videos, Pixel Assets, Characters*) with atomic disk cleanup and database deletion.
  * **Batch Export**: Native directory picker (`window.kirea.pickDirectory`) to export selected media items to any destination folder with collision-safe renaming.
  * **Batch Collection Assignment**: Assigns multiple images to an existing collection or removes them from collections in one click.
  * **Batch Favorite**: Toggles or applies favorite status across all selected media items supporting favorites.
* **Deep Filtering & Search**:
  * **Dynamic Model Filter**: Dynamically aggregates model and checkpoint names used across the user's library (`LibraryMediaResult.models`).
  * **Orientation / Aspect Ratio Filter**: Filter items by `All`, `Landscape`, `Portrait`, or `Square (1:1)` based on asset geometry.
  * Multi-field search across titles, prompts, tags, model checkpoints, character profiles, and animation clips.
* **Enhanced Multi-Modal Lightbox & Inspector**:
  * **Full Keyboard Navigation**: Cycle seamlessly through all media items in the active filtered view using `ArrowLeft` and `ArrowRight`. Header displays item counter (`Item X of Y`) and navigation chevrons.
  * **Interactive Video Player**: HTML5 video playback controls with seekable timeline scrubber, timestamp readouts (`00:02 / 00:05`), loop toggle button, playback speed multipliers (`0.5x`, `1.0x`, `1.5x`, `2.0x`), and volume/mute toggle.
  * **Pixel Art & Animation Viewer**: Zoom controls (`1x`, `2x`, `4x`, `8x`) with pixel-crisp rendering (`[image-rendering:pixelated]`) and transparency checkerboard background toggle.
  * **Character Profile Inspector**: Gallery of reference images with role tags (`primary`, `expression`, `outfit`, `pose`), and one-click copy buttons for prompt prefixes and trigger words.
  * **Image Inspector**: High-resolution image preview with generation parameters (sampler, scheduler, steps, CFG, seed, workflow), one-click prompt copy, and direct jump to Create Studio settings reuse.

#### Video Studio & AI Video Generation
* Added dedicated **Video Studio** workspace (`VideoStudioPage`) for text-to-video and image-to-video pipelines.
* Integrated Wan 2.1 and LTX Video ComfyUI workflow graph templates with duration, FPS, and container configuration (MP4/WebM).
* Video metadata tracking and native video export with disk sidecar cleanup.

#### Pixel Studio & SpriteKiln Game Engine Packaging
* Added **Pixel AI Generation** with provider status monitoring, job queueing, progress streaming, and cancellation.
* Added **SpriteKiln** game engine packager with tailored directory structures and manifest outputs for **Unity**, **Godot**, **Unreal Engine**, **Defold**, and **RPG Maker**.
* Multi-directional sprite sheet packing (4-direction and 8-direction character sets), frame sequencer, palette quantization, and asset version history.

#### Civitai Workflow Hub & Workflow Browser
* Added Civitai workflow exploration, model and workflow downloading, and archive extraction (`7zip-bin`).
* Added Workflow Ledger and validator verifying node dependencies, sampler presets, and graph configurations.

### Security & Hardening
* DevTools access restricted in production builds.
* DPAPI-protected encryption enforced for Civitai API key storage; plaintext key fallback rejected.
* Strict path boundary validation (`isPathInsideAnyRoot`) for all file deletions and preview loading.
* Sanitized filename handling and external preview URL validation.

### Architecture & Refactoring
* Modularized oversized source files into domain-driven submodules (`src/main/ipc/handlers/`, `src/main/db/repos/`, `src/renderer/components/create/`, etc.).
* Maintained clean zero-TypeScript-error compilation (`npm run typecheck`).
* Expanded unit test suites to 27 test files with **264 passing tests** (100% green).

---

## [1.0.1] - 2026-11-14

### Added
* Civitai download manager with HTTP Range pause/resume and SHA-256 hash verification.
* New application icon and installer finish-page artwork.

### Fixed
* Windows NSIS per-machine installer elevation handling.
* SQLite migration schema for workflow metadata table naming.

---

## [1.0.0] - 2026-11-10

### Added
* Initial release of Kirea Studio for Windows.
* Local ComfyUI engine discovery and automatic process lifecycle management.
* High-performance Text-to-Image and Image-to-Image generation studios.
* LoRA recipe builder, Character Studio, and Story Studio visual canvas.
* Local SQLite database with automated migration framework.
