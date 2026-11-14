# Pixel Studio

Pixel Studio is the game-asset workspace inside Kirea Studio. It renders, edits, animates, versions, and exports real pixel art at native resolution — 8 to 256 pixels per side — without touching the ComfyUI image-generation path used by Create Studio.

Open it from the **Pixel Studio** item in the Studio navigation group. It is available with or without ComfyUI running.

## Engine boundary

| Engine | License | How Kirea uses it | Bundled in installer |
|---|---|---|---|
| Pixelbolt 0.17.0 (`external/pixel-engines/pixelbolt`) | MIT | Deterministic local spritesheet renderer. Renders recipes to PNG frames, sprite sheets, GIF/APNG, Godot `SpriteFrames`, Unity/Phaser atlas JSON, and ZIP bundles | Yes — `resources/pixel-engines/pixelbolt` |
| SpriteKiln (`external/pixel-engines/spritekiln`) | GPL-3.0 | Read-only inspection of workflow JSON and required node/model names, compared against the running ComfyUI's `object_info` | No. Never installed into a ComfyUI instance, never executed |

Pixel Studio does **not** modify SD 1.5, SDXL, LoRA, or ComfyUI model folders, and it does not download SpriteKiln's model tiers.

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
  └─ StudioRepository → SQLite         src/main/db/repos/pixel-repo.ts
        │
        ▼
Files on disk:  <userData>/pixel-assets/<assetId>/frame_###.png, preview.png, sheet.png
Exports:        <userData>/pixel-exports/<assetId>/…
```

The engine is loaded dynamically, so Pixelbolt stays replaceable and is never imported by the renderer. If the engine directory is missing, generation fails with an explicit error instead of a placeholder.

## Tabs

| Tab | What works |
|---|---|
| **Generate** | Nine asset kinds (character, creature, weapon, item, object, tileset, environment, effect), name, 8–256 px width/height, palette preset, seed with randomise, seed modes (random / fixed / derived from prompt), 1–4 sequential variations, optional character link, direction; writes a real multi-frame asset and shows it in Latest Render |
| **Characters** | Persistent identity (name, palette, seed, reference asset, description). Renders front, back, right, and mirrored left facings from one seed; each facing is a full 8-frame asset with Animate/Edit shortcuts and deletion |
| **Animation** | Asset picker, real per-frame playback with durations, 0.5–2× speed, loop, onion skin, 2–16× zoom, animation filter, timeline reorder/duplicate/delete, per-frame duration edits, rename via frame names, sheet/GIF export, clip metadata |
| **Environment** | Environment and tileset kinds with 16 px size snapping, seeded renders for terrain, backgrounds, and repeatable tiles |
| **Objects & FX** | Object, weapon, item, and effect presets with the same real frame pipeline |
| **Editor** | True `ImageData` canvas: pencil, eraser, picker, flood fill, rectangular select, move, crop, 1–3 px brush, palette swatches, pixel grid at ≥6× zoom, onion skin, clear frame, crop all frames, delete selection, nearest-neighbour resize for the whole asset, undo/redo (30 steps), Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y, and **Save version** |
| **Library** | Search, kind and character filters, thumbnails, rename, duplicate, delete, version history with previews, import from the Kirea image library (nearest-neighbour downsample, corner-colour knockout, palette snapping), and export |

The SpriteKiln panel inside Library reports which workflows are present and which custom nodes or model files are missing. It is informational only.

## Data model

Migration `v6` adds six tables. Image blobs are never stored in SQLite; the database keeps metadata and file paths.

| Table | Contents |
|---|---|
| `pixel_projects` | Project name, palette, default size, timestamps |
| `pixel_characters` | Identity name, palette, seed, reference asset, description |
| `pixel_assets` | Kind, engine, prompt, seed, palette, dimensions, frame count, version, recipe JSON, preview/sheet paths, parent asset |
| `pixel_frames` | Per-frame index, name, duration, file path |
| `pixel_asset_versions` | One row per saved version with preview path |
| `pixel_exports` | Export format, scale, output path, dimensions, frame count |

`recipeJson` holds the Pixelbolt recipe (frames as palette-keyed pixel lists plus animation clips), so every asset can be re-rendered deterministically. Saving edited frames increments the asset version, rewrites the recipe, re-renders the preview and sheet, and inserts a version row.

## Exports

| Format | Output |
|---|---|
| PNG frame | Single frame at the chosen scale |
| Transparent PNG | Single frame with alpha preserved |
| Sprite sheet | All frames atlased horizontally |
| Animated GIF | Real timing from frame durations |
| Animated APNG | Real timing, full alpha |
| ZIP bundle | Frames, sheet, recipe JSON, and metadata |
| Godot SpriteFrames | Ready-to-paste `SpriteFrames` resource |
| Unity atlas JSON | Frame rectangles and animation clips |
| Phaser atlas JSON | Texture atlas plus animation map |

Scales are whole numbers 1–8, applied with nearest-neighbour. Native pixel dimensions are never interpolated. Export files are written under the app data directory and can be opened from the dialog.

## What is deterministic vs. model-dependent

Everything currently shipped renders **locally with Pixelbolt** from a seeded procedural recipe. The prompt is stored on the asset and can drive the seed (“Derive from prompt”), so different prompts produce different output — but no diffusion model is invoked for pixel art yet.

Not implemented, because it requires explicit model downloads and a SpriteKiln workflow running inside a separate ComfyUI instance:

- Diffusion-based pixel generation (text-to-pixel and image-to-pixel SpriteKiln workflows)
- Negative prompt / CFG-style guidance
- Reference-image-conditioned generation for pixel assets (the identity reference is metadata today)
- 8-direction character sets (current facings: front, back, right, mirrored left)
- AI-driven frame interpolation

The SpriteKiln inspector is the groundwork for those workflows; it never installs nodes or downloads the ~73 GB model tiers.

## Hardware notes

Pixel rendering is CPU-only and completes in well under a second at these sizes. The installed RTX 4070 Ti SUPER (16 GB) and 32 GB system RAM are irrelevant to Pixelbolt rendering. Any future SpriteKiln integration would be gated behind explicit opt-in downloads with disk-space checks, and would run in an isolated ComfyUI instance so the existing SD1.5/SDXL/LoRA setup is untouched.

## Verification

```powershell
npm run typecheck     # renderer + main
npm test              # Vitest; includes tests/unit/pixel-studio.test.ts
npm run build
npm run dist:win
```

Current results: typecheck clean, 113 tests pass (1 opt-in live ComfyUI test skipped), production build succeeds, and a packaged build was produced and smoke-tested — the installed app launched from `win-unpacked`, generated an asset, and reported 9 assets, proving the bundled engine resolves from `resources/pixel-engines/pixelbolt`.

Note: in this session `npm run dist:win` hit a transient Windows `EBUSY` lock on Electron's `default_app.asar` while replacing `release/win-unpacked`. The packaging itself was verified by pointing electron-builder at the already-extracted local Electron runtime and a separate output directory; rerun `npm run dist:win` after the lock clears (or a reboot) to refresh `release/`.

The UI was exercised in the built Electron app through the DevTools protocol: generation, playback, editor drawing, version saving, 48×48 resize, character identity + four facings, duplicate, version history, export, and renderer reload persistence (8 assets, 1 character, 50 frames).

## Limitations

- Assets are capped at 256 px per side and 256 frames per animation by Pixelbolt.
- The crop tool requires a selection larger than 1 px and applies to every frame.
- Undo history resets when a version is saved.
- SpriteKiln workflows report `NEEDS SETUP` until their custom nodes and models are installed in a ComfyUI instance; Pixel Studio does not do that for you.
- There is no cloud sync or collaboration; everything stays in the local app data directory.
