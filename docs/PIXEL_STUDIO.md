# Pixel Studio

Pixel Studio is the game-asset workspace inside Kirea Studio. It renders, edits, animates, versions, and exports real pixel art at native resolution — 8 to 256 pixels per side — and can generate pixel art with a diffusion backend over a dedicated external ComfyUI instance. It never touches the ComfyUI instance used by Create Studio.

Open it from the **Pixel Studio** item in the Studio navigation group. Everything except **AI Generate** works with or without a backend.

## Engine boundary

| Engine | License | How Kirea uses it | Bundled in installer |
|---|---|---|---|
| Pixelbolt 0.17.0 (`external/pixel-engines/pixelbolt`) | MIT | Deterministic local spritesheet renderer. Renders recipes to PNG frames, sprite sheets, GIF/APNG, Godot `SpriteFrames`, Unity/Phaser atlas JSON, and ZIP bundles | Yes — `resources/pixel-engines/pixelbolt` |
| SpriteKiln (`external/pixel-engines/spritekiln`) | GPL-3.0 | Prompt-driven pixel generation. Kirea reads SpriteKiln's published API-format workflow JSON and submits it over ComfyUI's documented HTTP/WebSocket API to a **separate, user-installed ComfyUI instance** | No. Not vendored, not copied, not modified, not shipped |

SpriteKiln code is never imported, linked, or executed by Kirea. The integration boundary is data (workflow JSON) plus ComfyUI's public API; the SpriteKiln custom nodes run inside the user's own ComfyUI process. See [Licensing boundary](#licensing-boundary).

Pixel Studio does **not** modify SD 1.5, SDXL, LoRA, or ComfyUI model folders, and it does not download SpriteKiln's model tiers or custom nodes.

## Architecture

```
Renderer (React 19)
  src/renderer/pages/PixelStudioPage.tsx
  src/renderer/components/pixel/*.tsx
        │  window.kirea (preload)
        ▼
IPC registrars + Zod schemas        src/main/ipc/handlers/pixel-handlers.ts
        │                           src/main/ipc/schemas.ts
        ▼
PixelService                        src/main/pixel/pixel-service.ts
  ├─ pixel-engine.ts  dynamic ESM import of Pixelbolt (dev path or resources path)
  ├─ sharp            nearest-neighbour imports, transparency, thumbnails
  ├─ PixelAiService   one active AI job, progress events, cancellation
  │    └─ SpriteKilnProvider   workflow JSON + ComfyApiClient/ComfyWsClient → separate ComfyUI
  └─ StudioRepository → SQLite         src/main/db/repos/pixel-repo.ts
        │
        ▼
Files on disk:  <userData>/pixel-assets/<assetId>/frame_###.png, preview.png, sheet.png
                <userData>/pixel-assets/<assetId>/versions/<n>/generation.json
Exports:        <userData>/pixel-exports/<assetId>/…, <userData>/pixel-exports/packages/…
AI temp files:  <userData>/temp/pixel-ai
```

The engine is loaded dynamically, so Pixelbolt stays replaceable and is never imported by the renderer. If the engine directory is missing, generation fails with an explicit error instead of a placeholder.

The AI provider is deliberately isolated from the primary Kirea ComfyUI adapter and workflow registry. It talks only to the host/port in the pixel backend settings and reads only its own workflow files.

## AI generation backend

The **AI Generate** tab sends a real prompt to a diffusion workflow running in a separate ComfyUI instance. It is not a procedural or seeded imitation: when the backend is unavailable, generation fails with an explicit readiness error instead of producing random output.

| Setting | Default | Meaning |
|---|---|---|
| `pixelBackendHost` | `127.0.0.1` | Backend host. Loopback only; enforced by the Zod schema and again by the provider |
| `pixelBackendPort` | `8189` | Backend port. Kirea's Create Studio ComfyUI defaults to `8188`, so the AI pixel backend is a distinct process |
| `pixelBackendWorkflowRoot` | empty | Optional explicit path to a SpriteKiln checkout. When empty, Kirea looks for a bundled-adjacent root (`resources/pixel-engines/spritekiln` when packaged, `external/pixel-engines/spritekiln` in development), then the working directory. Nothing is shipped in that location; the user must provide it |

Kirea never starts, installs, or configures that ComfyUI instance. It assumes the user has installed ComfyUI 0.41+, the SpriteKiln custom nodes, the SpriteKiln API workflows, and the model files required by those workflows. Nothing is downloaded automatically, and no button in the app installs nodes, models, or Python packages.

### Isolated backend setup

Phase 2 validation used a second, independent ComfyUI checkout so the existing Kirea Create Studio instance on `8188` was never opened, modified, or restarted:

| Item | Value |
|---|---|
| Backend root | `C:\Users\Harris\Documents\KireaPixelBackend` (separate from the Create Studio install) |
| ComfyUI | 0.45.2 source checkout with its own virtual environment and Python packages |
| Listen address | `127.0.0.1:8189` (`--listen 127.0.0.1 --port 8189 --disable-auto-launch`) |
| Custom nodes | Only `ComfyUI-SpriteKiln`; no other packs installed |
| Model reuse | `extra_model_paths.yaml` maps the existing TES model folders **read-only**; new pixel-only weights go into the isolated `models/` tree |
| Shutdown | Killing the 8189 process leaves the 8188 instance and all model files untouched |

The app reads the host, port, and workflow root from the pixel backend settings, so the same build works against any loopback instance.

### Minimum model requirements

Only the files a selected workflow actually loads are required. Install them in the isolated ComfyUI's `models/` folders and restart it; Kirea never downloads them.

| Workflow | Required models | Folder |
|---|---|---|
| Text to pixel | `z_image_turbo.safetensors`, `qwen_3_4b.safetensors`, `ae.safetensors`, `spritekiln_zimage_pixel_art.safetensors`, `birefnet.safetensors` | `diffusion_models/`, `text_encoders/`, `vae/`, `loras/`, `background_removal/` |
| Image → pixel (direct) | `birefnet.safetensors` | `background_removal/` |
| Image → pixel (AI redraw) | `z_image_turbo.safetensors`, `qwen_3_4b.safetensors`, `ae.safetensors`, `spritekiln_zimage_pixel_art.safetensors` | `diffusion_models/`, `text_encoders/`, `vae/`, `loras/` |
| Reference-guided | `flux-2-klein-4b.safetensors`, `qwen_3_4b.safetensors`, `flux2-vae.safetensors`, `spritekiln_klein_pixel_art.safetensors`, `birefnet.safetensors` | `diffusion_models/`, `text_encoders/`, `vae/`, `loras/`, `background_removal/` |
| Localized edit | Same as reference-guided | — |
| Directional set | Same as reference-guided (FLUX.2 klein path) | — |

`qwen_3_4b` serves as the text encoder in every generative workflow. The total across these workflows is roughly 9 GB, versus about 73 GB for SpriteKiln's full model tier collection; the other tiers are not needed by the workflows Kirea exposes.

ComfyUI 0.45 exposes some loader enumerations in the newer `["COMBO", { "options": [...] }]` shape instead of the legacy `[[...]]` list. The provider understands both, so model-presence checks do not degrade to `unverified` on current ComfyUI.

Readiness is evaluated **per workflow**. A text job runs when the text workflow is ready even if the reference workflow is still missing FLUX weights; only the capabilities with missing requirements are blocked, and each block names the missing files and the folder to place them in.

### Readiness states

| State | Meaning |
|---|---|
| `ready` | Every workflow file for the checked capabilities exists, every node class on its dependency chain is registered in `/object_info`, each loader's model enum contains the exact filename the workflow requests, and ComfyUI reports 0.41+ |
| `unverified` | ComfyUI is reachable and nodes exist, but at least one loader does not expose an enumerable model list, so model presence cannot be proven. Generation is still allowed with a visible warning |
| `setup_required` | A required node class or model file is missing |
| `workflows_missing` | The SpriteKiln API workflow files were not found at the configured or detected root |
| `unreachable` | Nothing answered at the configured loopback host/port |

`ready` is never inferred from node names alone. Unknown requirements are reported as unverified rather than assumed available.

### Supported workflows

| Mode | Workflow file | Output node | What runs |
|---|---|---|---|
| Text to pixel art | `01_text_to_pixel_art.api.json` | 20 | Diffusion; prompt, style preset, palette, seed, size, long side, steps, transparent background |
| Image → pixel (direct) | `02_image_to_pixel_art.api.json` | 8 | Deterministic palette/quantise path; does not load a generative model |
| Image → pixel (AI redraw) | `02_image_to_pixel_art.api.json` | 23 | Diffusion redraw at a user-controlled strength |
| Reference-guided | `03_reference_to_pixel_art.api.json` | 33 | Subject reference required; optional style reference; reference images are never overwritten |
| Localized edit | `05_inpaint_pixel_art.api.json` | 27 | Rectangular region mask merged back into the source sprite |
| Directional set | `06_rotate_8_directions.api.json` | 26 | Front-facing subject reference; 4 or 8 facings via SK_DirectionPrompts → FLUX.2 klein → SK_DirectionAssemble. West is mirrored from the east render |

Known upstream limitations are surfaced in the UI and recorded in metadata rather than hidden:

- **Negative prompts are stored but not applied.** The upstream distilled text workflow runs at cfg 1.0 and ignores negative conditioning.
- **AI redraw does not remove the background.** Transparency is not applied on that path.
- **Localized edit is rectangular.** Pixels outside the region are copied back from the source by `SK_MaskedMerge`.
- **Reference strength is a LoRA strength**, not a denoise value; image redraw strength is the denoise control.

Not exposed in Kirea: SpriteKiln's animation workflows (`09`, `09b`, `10`, `11`, `16`, `17`, `19`), rotation/multiview beyond the four/eight-direction set, autotile, and normal-map workflows. They exist upstream but are not wired into the panel.

SpriteKiln's animation chain is currently unrunnable on this machine rather than merely unwired: the workflows reference `flux-2-klein-base-4b`, `spritekiln_klein_base_4walk_sheet`, `umt5_xxl_fp16`, `wan_2.1_vae`, the Wan 2.2 GGUF models and LoRAs, and `spritekiln_wan22_pixel_animate`, none of which are installed, and the Wan paths load through `UnetLoaderGGUF`, which requires the ComfyUI-GGUF extension and is not registered on the isolated backend. Kirea does not download models or install nodes on its own. Local animation authoring (below) is the implemented animation path; AI frame generation and interpolation remain dependent on that missing stack.

### Job lifecycle

Jobs move through `queued → running → completed | failed | cancelled`. Progress comes from the ComfyUI WebSocket (`executing`, `progress`, `execution_*` events) and is pushed to the renderer. Cancellation deletes the queued prompt and issues an interrupt for that prompt id, and the provider also respects an abort signal during upload and normalization so a cancelled job cannot still submit. Only one AI job may be active at a time; a second submission is rejected. Backend errors, WebSocket disconnects, and timeouts end in `failed` with a readable message. Temporary uploads and downloaded outputs are removed when the job ends.

A completed PNG is normalized with `sharp` and Pixelbolt's decoder, then imported through the same crash-safe, versioned pipeline as any other Pixel Studio asset. Generation metadata is persisted as a `generation.json` sidecar per version (fields listed under [Data model](#data-model)).

## Tabs

| Tab | What works |
|---|---|
| **Generate** | Eight asset kinds (character, creature, weapon, item, object, tileset, environment, effect), name, 8–256 px width/height, palette preset, seed with randomise, seed modes (random / fixed / derived from prompt), 1–4 sequential variations, optional character link, direction; writes a real multi-frame asset and shows it in Latest Render |
| **AI Generate** | Four backend modes: text-to-pixel, image-to-pixel (direct quantise or AI redraw), reference-guided, and localized edit. Prompt/negative, style preset, palette, seed with randomise, output size, long side, steps, redraw/reference strength, transparent background, drag-and-drop or asset-library source images, inpaint region, live progress, cancel, backend readiness card. Completed images import as normal assets with a generation sidecar |
| **Characters** | Persistent identity (name, palette, seed, reference asset, description). Renders front, back, right, and mirrored left facings from one seed; each facing is a full 8-frame asset with Animate/Edit shortcuts and deletion. **SpriteKiln identity**: generate a character from text with the backend, auto-assign the result as the identity reference, then generate variations ("wearing a red cloak") through reference-guided generation; style preset, seed, and reference strength are adjustable, the job streams progress, and each generation records its parent asset and character id. Any non-reference asset can be promoted to the character reference. **Directional set**: rotates the saved identity reference into a 4-direction (S/E/N/W) or 8-direction (clockwise from S) set through workflow 06; each facing imports as its own asset linked to the character and the parent reference, with the last set shown in a labelled grid |
| **Animation** | Asset picker, real per-frame playback with durations, 0.5–2× speed, loop, onion skin, 2–16× zoom, timeline reorder/duplicate/delete, per-frame duration edits, rename via frame names, sheet/GIF export. **Clip authoring**: named clips (a new character ships idle, walk, run, attack, jump, hurt and death), chip selection, rename, per-clip loop, FPS normalization (writes one uniform duration to every member frame), add/remove individual frames, new/duplicate/delete/reorder clips. Clip edits save as versioned recipe metadata without re-rendering artwork, and GIF export honours the selected clip |
| **Environment** | Environment and tileset kinds with 16 px size snapping, seeded renders for terrain, backgrounds, and repeatable tiles |
| **Objects & FX** | Object, weapon, item, and effect presets with the same real frame pipeline |
| **Editor** | True `ImageData` canvas: pencil, eraser, picker, flood fill, line, rectangle, ellipse (outline or filled), rectangular select, move, crop, pan, 1–3 px brush, zoom, pixel grid at ≥6× zoom, transparency checkerboard toggle, onion skin, frame duplicate/revert/compare-with-saved, nearest-neighbour resize, undo/redo (30 steps), palette editing and recolouring, directional sibling comparison, and **Save version**. See [Unified asset editing](#unified-asset-editing-phase-3-priority-4) |
| **Library** | Search, kind and character filters, thumbnails, Edit, Animate, generation information, open parent character, open parent asset, rename, duplicate, delete, version history with previews, version compare and restore, import from the Kirea image library (nearest-neighbour downsample, corner-colour knockout, palette snapping), single-asset export, and **game-ready package export** (Generic, Godot, Unity, Phaser) |

The SpriteKiln readiness panel inside Library reports the same backend state as the AI Generate tab: workflow presence, registered node classes, model availability, versions, and hardware. It never installs or downloads anything.

## Data model

Migration `v6` adds six tables. Image blobs are never stored in SQLite; the database keeps metadata and file paths.

| Table | Contents |
|---|---|
| `pixel_projects` | Project name, palette, default size, timestamps |
| `pixel_characters` | Identity name, palette, seed, reference asset, description |
| `pixel_assets` | Kind, engine, prompt, seed, palette, dimensions, frame count, version, recipe JSON, preview/sheet paths, parent asset |
| `pixel_frames` | Per-frame index, name, duration, file path |
| `pixel_asset_versions` | One row per saved version with preview path; `palette_json` (migration `v9`) stores that version's palette |
| `pixel_exports` | Export format, scale, output path, dimensions, frame count |
| `pixel_palettes` | Reusable named palettes shared across characters and projects (migration `v8`) |

`recipeJson` holds the Pixelbolt recipe (frames as palette-keyed pixel lists plus animation clips), so every asset can be re-rendered deterministically. Clips are stored by frame name, so renaming a frame keeps the clip intact and deleting a frame removes it from every clip. Saving edited frames increments the asset version, rewrites the recipe, re-renders the preview and sheet, and inserts a version row. Saving only clip metadata also increments the version and inserts a version row, but it reuses the current preview path and does not rewrite frame PNGs or re-render artwork; the version row makes the clip change part of the same history, not a second asset system.

AI-generated assets use the same tables and the same versioned asset directories. Their per-version `generation.json` sidecar records backend, backend version, workflow id and file, model filename(s), prompt, negative prompt, seed, dimensions, palette id and colors, style, timestamp, ComfyUI prompt id, reference metadata (asset/upload source labels only), settings, and upstream notes. Editing and saving frames preserves the sidecar; duplicating an asset copies it. No schema change was needed.

## Exports

Pixel Studio exposes two export surfaces over the same stored frames and recipes. **Single-asset export** writes one file at a time from the asset dialog. **Game-ready packages** write a folder or ZIP with frames, sheets, previews, provenance, a manifest and optional engine files.

| Single-asset format | Output |
|---|---|
| PNG frame | Single frame at the chosen scale |
| Transparent PNG | Single frame with alpha preserved |
| Sprite sheet | All frames atlased horizontally |
| Animated GIF | Real timing from frame durations |
| Animated APNG | Real timing, full alpha |
| ZIP bundle | Frames, sheet, recipe JSON, and metadata |

Scales are whole numbers 1–8, applied with nearest-neighbour. Native pixel dimensions are never interpolated. Export files are written under the app data directory and can be opened from the dialog. The existing single-asset export path and its files are unchanged by packaging.

### Game-ready packages

Open the package dialog from the Library row (box icon, “Export … as a game-ready package”), the Character Studio, an Animation Studio clip, or the Pixel Studio header. Scope is **asset**, **animation**, **character** or **project**; the dialog plans first and exports only when the plan has no errors.

| Control | Effect |
|---|---|
| Preset | `Generic`, `Godot 4`, `Unity`, `Phaser 3`. Presets append `-godot`, `-unity`, `-phaser` to the package root |
| Container | ZIP archive or a folder written directly to the destination |
| Scale / pivot / pixels per unit | Nearest-neighbour export scale, sprite pivot (`bottom-centre`, `centre`, `top-left`), and Unity pixels-per-unit |
| Layout | Columns, rows, padding, spacing, edge extrusion, max sheet size, trim transparent edges, uniform cells |
| Outputs | Frames, direction stills, combined sheet, sheet per animation, sheet per direction, GIF, APNG |
| Version | Asset and animation scopes can export a historical version; characters and projects always export current data |
| Destination | Defaults to `<userData>/pixel-exports/packages`; existing packages are never overwritten (`-2`, `-3`, … is appended) |

Package layout (single asset, generic preset):

```
<root>/
  asset.json                     manifest, sources, sheets, animations, file hashes
  README.txt
  identity/                      palette swatches and character/asset identity card
  frames/                        exported frames in clip order
  stills/<key>.png               one still per exported asset/direction
  directions/<direction>/<key>.png
  animations/<clip>/000_<frame>.png
  spritesheets/<groupKey>.png|.json
  spritesheets/animations/<clip>.png|.json
  spritesheets/directions/<slot>.png|.json
  previews/<key>.gif|.apng
  metadata/generation/<key>.json
  metadata/recipes/<key>.v<version>.json
```

Character scope writes `character.json`; project scope writes `project.json` plus one sub-package per group (`characters/…`, `assets/…`) with its own manifest and file list. Every manifest records the source asset id, version, latest version, parent asset and character lineage, direction and direction source, palette, generation metadata reference, recipe, frame ids, clip membership, sheet regions, engine files and per-file SHA-256. Sheet JSON carries per-frame `kirea` data (`frameId`, `assetId`, `version`, index, slot, direction, pivot in pixels) next to standard `frames`, `animations` and `meta`.

**Integrity.** The plan reports root, file counts, sheets, directions, versions, warnings and a preview without writing anything. Export packs the sheets, writes the package, then reopens it — for ZIPs by reading the archive, for folders by reading the written files — and verifies every manifest reference, file hash, PNG signature, sheet region, non-overlap, pixel equality against the exported frame and preview timing. The dialog only shows “Package verified” after that pass. Cancellation stops packing/writing and removes the partial output; source assets, version rows and `generation.json` are read-only throughout.

| Preset | Adds | Validation at export | Real engine verification |
|---|---|---|---|
| Generic | Nothing engine-specific | Structure, hashes, images, regions, pixels | n/a |
| Godot 4 | `<root>.tres` SpriteFrames, `<root>.tscn` with AnimatedSprite2D, atlas textures, per-clip speeds | Resource/scene text, atlas regions inside the image, animation names | **Structural only.** A `.tres` is not opened by Godot during export or in the test suite |
| Unity | Uncompressed `TextureImporter` `.meta` (Sprite, Multiple, Point, no compression, PPU × scale), editor import script `Editor/KireaPixelImport_<id>.cs`, `.unity-animations.json` with clip frames and durations | Meta keys, sprite rects, pivots, unique file IDs, clip→sprite references, loop/fps | **Real:** Unity 6000.6.6f1 batch-mode imports the package, checks importer settings, sprites, rects and bottom-centre pivots, runs `KireaPixelImport.BuildAll()` and loads every generated `.anim` clip |
| Phaser 3 | JSONHash atlas sharing the PNG, `.anims.json` with frame keys, durations, frame rate and repeat | Atlas keys, frame lookup, animation keys, timing, repeat | **Real:** Phaser 3.90 in a hidden Electron window loads the atlas and animations, then checks frame count, cut sizes, trim flags, animation frame counts, per-frame durations and repeat |

Engine runs are opt-in so `npm test` stays fast:

```powershell
$env:KIREA_ENGINE_TESTS = "1"
npx vitest run tests/integration/package-engines.test.ts
```

Set `KIREA_UNITY_PATH` / `KIREA_PHASER_PATH` to override auto-detection. The suite creates a temporary Unity project, imports a freshly exported Unity package, and requires a clean report; the Phaser test reads the exported atlas and anims JSON directly. Godot has no equivalent runtime test, so it remains documented as structural validation.

**Limitations.** A package is validated per export at the data/structure level; the dialog does not open Unity, Godot or Phaser. The engine suite is a separate, explicit check and is not part of every export. Unity clips are generated by the package's editor script on import, not by Kirea. A Unity sheet is capped at 16384 px (the exporter warns above it). Project packages are a folder hierarchy, not a single merged manifest at the root — the root `project.json` is the index.

## What is deterministic vs. model-dependent

**Pixelbolt paths** — Generate, Characters, Environment, Objects & FX, editing, animation, versioning, and export — render locally from seeded recipes and complete in under a second. They work offline and do not involve a model.

**AI Generate** invokes the diffusion workflows described above in a separate ComfyUI instance. When that backend is not installed or reachable, the tab reports the exact missing requirement and does not generate. Prompt-derived seeds on the Pixelbolt side remain deterministic and are unrelated to the AI backend.

## Hardware notes

Pixelbolt rendering is CPU-only and completes in well under a second at these sizes. An RTX 4070 Ti SUPER (16 GB) with 32 GB RAM is ample for the SpriteKiln pixel workflows at their native output sizes, but the backend loads diffusion models into VRAM while running. Kirea runs one AI job at a time so a single large model is resident, reports the backend's GPU memory from `/system_stats`, and surfaces low-free-VRAM warnings. It does not promise 2K/4K output: the configured upstream workflows target pixel-art resolutions, and larger long-side values increase VRAM use and runtime.

Measured on the isolated backend (RTX 4070 Ti SUPER 16 GB, 32 GB RAM, ComfyUI 0.45.2), with `nvidia-smi` sampled every 400 ms and ComfyUI's own `/system_stats` polled during each job. The card reports 16,376 MiB total in `nvidia-smi` (15.99 GiB); `/system_stats` reports 17,170,956,288 B (16,384 MiB / 16.00 GiB). Both instruments agree the card stayed below its limit with no out-of-memory failure.

| Workflow | Generation time | Peak `nvidia-smi` | Peak `/system_stats` |
|---|---|---|---|
| Text to pixel, cold (model load) | 10.8 s | 15,416 MiB | 15,270 MiB (14.91 GiB) |
| Text to pixel, warm | 6.6 s | 15,416 MiB | 14,966 MiB (14.62 GiB) |
| Image → pixel (direct) | 13.2 s | 15,543 MiB | 15,834 MiB (15.46 GiB) |
| Image → pixel (AI redraw) | 9.1 s | 15,543 MiB | 15,996 MiB (15.62 GiB) |
| Reference-guided | 15.0 s | 15,650 MiB | 14,936 MiB (14.59 GiB) |
| Localized inpaint | 10.3 s | 15,553 MiB | 15,994 MiB (15.62 GiB) |

Cold-start model load costs roughly 4–6 s over warm runs (the text test runs both in one job, 18.0 s total). `nvidia-smi` and `/system_stats` do not agree exactly: `nvidia-smi` samples device memory every 400 ms, while `/system_stats` reports PyTorch's allocator view and can show transient troughs up to ~1.2 GiB lower. Peaks in either instrument are within ~0.4 GB of the card's 16,384 MiB total, so one job at a time is the safe operating mode; no workflow failed on VRAM in these runs.

Phase 3 direction runs were measured with `/system_stats` only (`nvidia-smi` was not sampled in those runs):

| Run | Generation time | Peak `/system_stats` |
|---|---|---|
| 4-direction set from an identity | 24.7 s | 16,737,737,478 B (15,962 MiB / 15.59 GiB) |
| 8-direction set from the same identity | 39.2 s | 16,896,534,778 B (16,113 MiB / 15.74 GiB) |

Both stayed below the 16,384 MiB limit. The 8-direction run is the closest approach observed so far; an 8-direction set on a 16 GB card leaves roughly 270 MiB of headroom in the allocator's own accounting.

## Licensing boundary

- SpriteKiln is GPL-3.0. The verified upstream checkout is commit `864d188071ed45e6f673029d2bc7eb918e17edd7`.
- No SpriteKiln source code is copied, vendored, linked, or imported into Kirea. Kirea reads the workflow JSON files that upstream publishes and drives them through ComfyUI's documented HTTP/WebSocket API.
- SpriteKiln is not included in the installer. `electron-builder.yml` ships only the MIT-licensed Pixelbolt engine. The workflow root is resolved from the user's own installation.
- Running SpriteKiln in a separate process does not, by itself, settle every GPL question. Whether Kirea's workflow-data integration or any future distribution model creates obligations is a legal question for counsel; until that review happens, keep the runtime external and unmodified. Workflow JSON supplied by the user is data, not Kirea source.
- Kirea does not download SpriteKiln's model tiers (~73 GB) and does not install custom nodes. Those remain explicit user actions in the user's own environment.

## Verification

```powershell
npm run typecheck     # renderer + main
npm test              # Vitest; includes Pixel AI provider, service, import and package tests
npm run build
npm run dist:win
```

Current results: typecheck clean, **194 passed | 11 skipped (205 tests, 23 files; 20 files passed, 3 skipped)**, and the production build succeeds. `tests/unit/pixel-package.test.ts` adds 15 package tests covering workflows A–G: single edited sprite with untouched sources, eight directions, a project with a child asset and a loose asset, Godot/Unity/Phaser artifacts, historical versions, missing-frame blocking, cancellation, no-overwrite folder output, project scope, and plan clamps. `tests/unit/pixel-studio.test.ts` holds 20 PixelService tests, including round-trip Workflows A–D, palette-only versions, the palette library, and palette-save failure recovery. Coverage includes provider workflow construction for all six capabilities, direction-label ordering and frame-count validation, cancellation before and during submission, timeouts, backend errors, readiness states (ready / unverified / setup_required / unreachable / workflows_missing), COMBO and legacy loader schemas, per-capability gating, HTTP 400 node-error parsing, loopback enforcement, service-level duplicate-job rejection, metadata-preserving import/versioning, character/parent lineage validation (a parent asset from another project is rejected), multi-frame directional import that keeps per-facing names, parent asset and direction settings, and clip authoring that saves names, membership, loop flags and durations as a new version without touching frame artwork or version directories.

### Game-ready package verification (Priority 5)

The engine tests are intentionally separate from `npm test`:

```powershell
$env:KIREA_ENGINE_TESTS = "1"
npx vitest run tests/integration/package-engines.test.ts
node scripts/verify-pixel-package-ui.mjs
```

Results on 2026-11-15:

| Check | Result |
|---|---|
| Package unit suite | 15/15 passed; every package is reopened from disk and every manifest file, size and hash is checked; extracted PNGs are decoded and sheet pixels compared with the exported frames |
| Unity import (workflow E) | Unity **6000.6.6f1** `-batchmode -nographics`: package imported, importer reports Sprite / Multiple / Point / Uncompressed / PPU 64, all 20 sprites load with rects inside the texture and bottom-centre pivots, `KireaPixelImport.BuildAll()` writes all 7 clips, and each clip loads with the expected loop flag, frame rate and one object-reference key per frame plus a final key |
| Phaser load (workflow F) | Phaser **3.90** in a hidden Electron window: atlas loads with 20 frames, all 7 animations resolve, per-frame durations and repeat flags match the package JSON, and every animation frame points at a real atlas frame |
| Export UI | CDP-driven run: Library → package dialog → Unity preset → export produced a 37-file, 81,032-byte ZIP with `Package verified`, 22 images, 20 sheet regions and 41,984 compared pixels; screenshots at generic plan, Unity plan and verified result |
| Godot | Structural validation only. The `.tres`/`.tscn` text, atlas regions and animation names are checked, but Godot is not launched |
| Source preservation | Unit tests assert source frame bytes and mtimes are unchanged, generation sidecars are preserved, version rows are intact, historical exports keep `isLatest: false`, and a second export never overwrites the first |

The engine suite writes its own temporary Unity project and package; it does not touch the user's project, SpriteKiln, ComfyUI or model directories. The Phaser check reads the exported atlas and anims JSON directly. The UI script seeds and exports a temporary asset under a throwaway Electron profile.

### Live backend validation (Phase 2)

The opt-in suite `tests/integration/live-pixel-backend.test.ts` runs against a real isolated ComfyUI 0.45.2 on `127.0.0.1:8189`:

```powershell
$env:KIREA_PIXEL_LIVE = "1"
npx vitest run tests/integration/live-pixel-backend.test.ts
```

Result: **8/8 passed** (the six Phase 2 tests, the Phase 3 identity test, and the Phase 3 direction test). All six capabilities reported `ready` with zero missing requirements, and each of these was exercised for real:

- **Status** — reports ComfyUI 0.45.2, every capability ready, no missing or unverified requirements.
- **Text to pixel (cold and warm)** — ComfyUI accepted workflow `01`, nodes executed, a valid 32×32 PNG was returned and imported, the `generation.json` sidecar records `backend: spritekiln`, workflow id/file, `z_image_turbo_bf16`, seed, prompt, backend version, and prompt id.
- **Image direct and AI redraw** — workflow `02` accepted; direct output is `image_to_pixel_direct`, redraw is `image_to_pixel_ai` with `settings.strength = 0.6`; both imported and sidecar-recorded.
- **Cancellation** — the job reached `cancelled` with no error, and the prompt id was gone from both the running and pending ComfyUI queue.
- **Reference-guided** — workflow `03` accepted with FLUX.2 klein, produced a valid imported 32×32 sprite, recorded `reference.subject` and `settings.referenceStrength`.
- **Localized inpaint** — workflow `05` accepted, produced a valid imported 32×32 sprite, recorded `settings.region = "8,8,16,16"`.
- **Character identity across variations** — one text-to-pixel identity, then two reference-guided generations of the same character (red cloak, brass lantern) through the saved identity asset. Both recorded `workflowId: reference_to_pixel`, the identity as `parentAssetId`, the character id, and their own seeds; imported 32×32 previews were valid.
- **Directional sets** — workflow 06 rotated the saved identity into a 4-direction set (S/E/N/W) and then an 8-direction set (S/SE/E/NE/N/NW/W/SW). Every facing was imported as its own asset with the character id, the identity as parent, and `settings.direction` / `settings.directions` in its sidecar. The west-facing render is an exact mirror of east (mask IoU 1.0), and for 8 directions the NW/NE, W/E and SW/SE pairs also match at IoU 1.0.

The mocked ComfyUI API/WebSocket tests remain in the suite; they verify error and edge-case paths that are impractical to trigger on a working backend (HTTP 400 rejection text, WebSocket drop, timeout). Live coverage is now the source of truth for "these workflows run on real hardware."

**Verified live:** all six workflow capabilities, image import, provenance sidecars, cancellation, queue cleanup, readiness reporting, identity-linked variations, and directional sets.
**Verified only against mocks:** HTTP 400 node-error phrasing, WebSocket disconnect recovery, request timeouts, and the `unverified` / `workflows_missing` states.
**Not verified:** behavior on GPUs with less than 16 GB VRAM, non-ASCII prompts beyond the tested prompts, and simultaneous jobs (the app permits only one).

### Character identity consistency (Phase 3)

Consistency is measured, not assumed. The identity test generates a character, then two variations at different seeds and prompts (strength 0.7) and compares the rendered PNGs:

| Pair | Alpha-silhouette IoU | Exact-colour overlap |
|---|---|---|
| identity vs variation A (red cloak) | 0.766 | 0.500 |
| identity vs variation B (brass lantern) | 0.707 | 0.875 |
| variation A vs variation B | 0.860 | 0.500 |

The suite asserts silhouette IoU ≥ 0.5 for every pair, which passes deterministically across repeated runs with the same seeds. Palette overlap is reported but not asserted: the Kirea palettes are small (6–8 colours in these renders), and a legitimate clothing change can replace colours entirely.

In the running app, an identity generated and auto-assigned as the reference produced a "wearing a red cloak" variation and a "wearing a bright yellow scarf" variation, both linked to the identity as parent and completing in 16–18 s. This exposed a real constraint: **the reference image is quantised to the selected pixel palette.** Red is not in the Kirea palette used by that character, so the red-cloak prompt produced zero red pixels (the garment stayed blue). The yellow scarf did change the render (accent colour 242,220,147 rose from 2 px to 16 px), but the change is subtle at 32×32. Prompt-driven clothing changes therefore work only within the palette's colour range; the Characters tab states this next to the variation field.

Note: `npm run dist:win` previously hit a transient Windows `EBUSY` lock on Electron's `default_app.asar` while replacing `release/win-unpacked`. Packaging was verified by pointing electron-builder at the already-extracted local Electron runtime and a separate output directory; rerun `npm run dist:win` after the lock clears (or a reboot) to refresh `release/`. That packaged smoke test predates the AI backend and only proves the bundled Pixelbolt engine resolves.

### Directional consistency (Phase 3)

The live direction test saves one identity (seed 717171), rotates it into a 4-direction set, then rotates the same identity into an 8-direction set. Each rendered facing is compared to the identity reference (alpha-silhouette IoU and exact-colour overlap) and mirrored pairs are compared to each other:

| Set | Facings | Silhouette IoU vs identity (S/E/N/W) | Palette overlap | Colours per facing |
|---|---|---|---|---|
| 4 directions | S, E, N, W | 1.000 · 0.496 · 0.984 · 0.478 | 1.000 · 0.727 · 0.909 · 0.727 | 11, 9, 11, 9 |
| 8 directions | S, SE, E, NE, N, NW, W, SW | reported only | reported only | 11, 10, 9, 7, 11, 7, 9, 10 |

The front view is the source itself (IoU 1.0). The back view keeps the same overall silhouette (~0.98); side views are naturally narrower (~0.48–0.50), which is the expected profile rather than a loss of identity. For 8 directions the mirror pairs NW/NE, W/E and SW/SE all measure mask IoU 1.0, and the 4-direction set's `westMirrorsEast` is exactly 1 — west is generated once and mirrored, so left and right cannot drift apart. All facings quantise to the character palette (9–11 distinct colours from the Kirea set).

In the running app (production build, Electron, fresh profile), the full flow was exercised against the live backend: generate an identity, let it auto-assign as the reference, click **Generate 4 directions**, and receive the completed set with an S/E/N/W grid. The Library then showed five linked assets (`UI Scout · identity` plus `UI Scout · 4 directions · S/E/N/W`) under one character, with no renderer errors. Identity generation took 11–16 s and the 4-direction set 24–26 s across repeated runs.

Eight directions run five generation passes (front, two three-quarter views, two side views, back) and cost 39.2 s versus 24.7 s for four; the extra time is model passes, not assembly. The direction workflow requires a front-facing source; a profile or back-facing reference will be rotated from whatever orientation it is in, so choose the identity reference deliberately.

## Animation Studio (Phase 3)

Local animation authoring runs on real Pixelbolt frame data — no placeholder controls. A character recipe is now 20 frames in seven clips: idle (2), walk (4), run (4), attack (2), jump (3), hurt (2) and death (3), with jump, hurt and death set non-looping. Every clip is a named list of frame names plus a loop flag in `recipeJson.animations`, and the panel edits that structure directly:

- **Clips** — select by chip, rename, toggle loop, create a custom clip, duplicate (the copy is inserted after its source), delete (at least one clip always remains), and move left/right in the ordered clip list.
- **Membership** — with a clip selected, each timeline card exposes **Add to clip** / **In clip**, so frames are added or removed one at a time; the last remaining frame of a clip cannot be removed.
- **Timing** — per-frame durations remain editable, and a clip-level FPS control normalizes every member frame to one duration (1–60 fps). Mixed-duration clips show `~mixed fps` and leave the FPS field empty rather than inventing a number.
- **Playback and export** — playback, speed, loop, onion skin and zoom operate on the selected clip's frame sequence; GIF export uses the selected clip, while sheet export still covers all frames.

Clip-only saves bump the asset version and record a version row, but reuse the existing preview and do not re-render frame PNGs. That keeps clip history in the same asset/version table as frame edits without duplicating assets.

### Live UI validation (fresh profile)

A CDP-driven run of the production build in Electron with a temporary profile generated one real 20-frame character through Pixelbolt, then exercised the panel end to end. After each UI action the version was confirmed through IPC, not just the DOM:

1. Generated character → 20 frames, 7 clips, version 1.
2. Renamed `walk` → `sprint` and read version 2; the clip stayed selected through the save.
3. Turned loop off on `sprint` → version 3.
4. Applied 12 fps → version 4, every `sprint` frame at 83 ms.
5. Added one frame to `walk` (4 → 5 frames) → version 5.
6. Duplicated `walk` → version 6; moved `walk_copy` before `death` → version 7.
7. Created a custom clip → version 8; deleted it → version 9.
8. Play advanced the playhead from frame 2 to 4 with onion skin enabled.
9. GIF export of the selected 5-frame clip reported 5 exported frames and named the file after the clip.
10. A fresh IPC read returned clip order `idle, walk, sprint, attack, jump, hurt, walk_copy, death`, `sprint` non-looping at 83 ms per frame, `walk` and `walk_copy` at 5 frames each, and no `custom` clip.

No page errors or uncaught renderer exceptions were logged. Screenshots: `%TEMP%\kirea-animation-studio-shots\animation-studio-clips.png` and `animation-studio-persisted.png`.

**What this does not do:** it authors and times clips on locally rendered frames. It does not generate new in-between frames or animate a still image with a model; that path is the SpriteKiln animation stack described above, which is not installed.

## Unified asset editing (Phase 3, Priority 4)

Every Pixel Studio asset — Pixelbolt renders, imports, SpriteKiln identities, variations and directional facings — is edited in the same Editor tab and saved through the same `PixelService.saveFrames` versioning pipeline. There is no second asset store.

### Canvas

- Native `ImageData` per frame, drawn at `width × zoom` with `imageSmoothingEnabled = false` and `image-rendering: pixelated`. Pixel coordinates are floored from the pointer position, so placement is exact at every zoom.
- Tools and shortcuts: pencil `B`, eraser `E` (paints transparency), picker `I`, fill `G`, line `L`, rectangle `R`, ellipse `O`, select `M`, move `V`, crop `C`, pan `H`. Shapes draw a pixel-exact preview while dragging; filled mode applies to rectangle and ellipse.
- Zoom in/out, pan and pan reset; pixel grid from 6×; checkerboard toggle for transparency; the toolbar shows native width × height.
- Undo/redo (30 steps) with Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y. Strokes mutate the active frame's buffer and redraw only that canvas.
- Resize uses nearest-neighbour only; native dimensions never change unless the user resizes.

### Palette

- **Used colours** lists every colour present in the asset, with counts. Colours that are not in the asset palette are flagged as out-of-palette and are never removed or quantised automatically; each can be added to the palette or mapped deliberately.
- Add (from the drawing colour or a used colour), change and remove palette colours (1–64).
- **Global replace** swaps one colour for another across the current frame or every frame. **Mapping** assigns a target to any number of used colours, with a preview of the active frame before applying. Both preserve each pixel's alpha, and fully transparent pixels are never touched.
- Import/export palettes as JSON (a colour array or `{ name, colors }`). Saved palettes live in `pixel_palettes` and are available across characters and projects.
- Palette-only changes save a new version that reuses the current preview, sheet and frame files. Palette edits never recolour pixels until a replace or mapping is applied.

### Frames

- Select any frame from the strip; edited frames are marked. **Duplicate frame** inserts a copy with a fresh id. **Revert frame** restores only the active frame from the last saved version. **Compare with saved** shows saved and editing pixels side by side.
- Frame ids, names and order are kept on save, so clip membership in `recipeJson.animations` is unchanged; the existing rename/removal remapping still applies.

### Directions and character lineage

- When the asset belongs to a character, the Editor shows the identity reference and sibling facings side by side, each with its version, and a shortcut to open any sibling.
- Editing a facing writes only that asset's version. Siblings, the identity reference, `characterId` and `parentAssetId` are untouched; the reference is never overwritten by a variation edit.

### Versioning

- Every save (pixels, dimensions, palette or clips) creates the next version and a version row. Frame saves write into a staging directory that is renamed into `versions/<n>` only after every file is written, and the database row commits last; a failed write or commit leaves the previous version intact.
- One version per save, not per stroke. Undo history resets on save.
- `generation.json` is carried forward to each new version, so provenance survives edits and restores.
- **Restore** reads the target version's frames, dimensions, palette and clips and saves them as a new version. Newer versions remain listed and recoverable. Version history in the Library shows previews, and **Compare** shows current versus selected with size, frame count, palette size and clip count.

### Round-trip verification

Service-level tests (`tests/unit/pixel-studio.test.ts`) and a CDP-driven UI run (`node scripts/verify-priority4-editing.mjs`, production build, fresh profile) cover:

| Workflow | Result |
|---|---|
| A. Create character → render facings → edit palette and pixels → save → restart | Pass. Palette add (#ff00ff), global replace to #00ff00 and pencil edits saved as v2 and persisted across an app restart |
| B. Edit one animation frame | Pass. Only frame 2 changed in v3; other frames and all clip membership identical |
| C. Edit one direction | Pass. Front facing at v2/v3; left, right and back stayed at v1 with identical pixels, same character and parent |
| D. Restore an earlier version | Pass. v1 restored as v4 with v1's dimensions, palette and frames; versions 4, 3, 2, 1 all listed after restart |

The UI run reported no console or page errors. Screenshots are written to `%TEMP%\kirea-priority4-shots\`.

## Limitations

- Assets are capped at 256 px per side and 256 frames per animation by Pixelbolt.
- The crop tool requires a selection larger than 1 px and applies to every frame.
- Undo history resets when a version is saved; use Revert frame or version Restore after saving.
- Selection is rectangular only; there is no lasso or magic-wand selection, and Move drags the selected pixels within the active frame only.
- Editing works on one frame at a time; there are no layers and no multi-frame brush.
- Duplicated frames have no saved baseline until the next save, so Revert and Compare are disabled for them.
- Palette-only versions reuse the current preview and sprite sheet images, which are identical because pixels did not change.
- Version previews in the Library show the first frame only; per-frame comparison across versions is done by restoring or opening the editor.
- AI frame generation and interpolation are unavailable. SpriteKiln workflows `09`/`09b`/`10`/`11`/`16`/`17`/`19` need Wan 2.2 GGUF models, `spritekiln_wan22_pixel_animate`, and the ComfyUI-GGUF `UnetLoaderGGUF` node, none of which are installed; Kirea does not download or install them. Animation Studio authors clips over locally rendered frames instead.
- Clip-only saves increment the version but reuse the asset's current preview and sprite sheet; those images show frame artwork, not clip order or timing. Clip duration is authoritative in the recipe and in GIF export.
- The clip FPS control writes one uniform duration to every member frame. Use the per-frame duration editors when a clip needs uneven timing.
- AI generation requires a separately installed ComfyUI 0.41+ instance with SpriteKiln nodes, workflows, and models. Pixel Studio does not install or download any of them.
- Variation prompts are quantised to the character's palette. Requests whose colour is outside that palette (red on the Kirea palette, for example) are mapped away; choose a palette that contains the requested colours. Character silhouette is preserved strongly at the default reference strength of 0.7; lower it to allow bigger shape changes.
- A character reference must be one of the project's own assets. Importing a new external image into the project happens through the AI Generate or Library import flows; the Characters tab does not open a file picker directly.
- Directional sets need a saved identity reference and that reference must face the viewer. Kirea does not auto-detect orientation, and the set is not re-aligned to the character's other facings beyond using the same identity and palette. Eight directions cost five model passes and peak near 16.1 GiB on a 16 GB card, so avoid running other GPU work at the same time.
- Negative prompts are recorded but not applied by the upstream distilled workflows; AI redraw does not remove backgrounds; localized edits use a rectangular mask.
- Style/reference labels in generation metadata describe where an image came from (asset or upload); the referenced image is uploaded to the backend but never modified in place.
- There is no cloud sync or collaboration; everything stays in the local app data directory.
