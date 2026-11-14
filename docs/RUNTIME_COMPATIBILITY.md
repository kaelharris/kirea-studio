# Runtime Compatibility & Pinned Versions

## Target Platform & Hardware Baseline

- **OS:** Windows 10 / Windows 11 (64-bit x64)
- **Validated GPU Hardware:** NVIDIA GeForce RTX 4070 Ti SUPER (16 GB VRAM, 32 GB System RAM)
- **GPU Execution:** Adapts automatically for lower-VRAM GPUs (`8 GB`–`12 GB`) via **Memory Saver** profile (`--lowvram`, reduced latent dimensions, memory warnings) and higher-VRAM cards (`>= 16 GB`) via **Balanced** / **Quality** profiles.

---

## Option A — Connecting to Existing ComfyUI Installations

Verified compatibility against existing local ComfyUI installs:
- **ComfyUI v0.45.2** (Python `3.13.12`, PyTorch `2.12.1+cu130`)
- **ComfyUI v0.37.0+** (Python `3.11.x`, PyTorch `2.11.0+cu128`)

### Non-Mutation Isolation Flags

When Kirea Studio launches an Option A installation (only if not already running on loopback), it preserves the external installation intact by passing isolated studio flags:
- `--listen 127.0.0.1` (loopback-only binding)
- `--port <configuredPort>` (default `8188`)
- `--output-directory <userData>/temp/comfy-out`
- `--temp-directory <userData>/temp/comfy-tmp`
- `--input-directory <userData>/cache/inputs`
- `--user-directory <userData>/cache/comfy-user` *(when supported by `comfy/cli_args.py`)*
- `--database-url sqlite:///<userData>/cache/comfy-transient.sqlite` *(when supported by `comfy/cli_args.py`)*
- `--disable-auto-launch`

Kirea Studio inspects `comfy/cli_args.py` read-only prior to spawn so older ComfyUI versions without `--database-url` do not fail on unknown CLI flags.

Kirea Studio **never** terminates a ComfyUI process that it did not spawn (`managedOwned === false`).

---

## Option B — Managed ComfyUI Runtime

- **Source:** Official `Comfy-Org/ComfyUI` GitHub Releases API (`ComfyUI_windows_portable_nvidia.7z` asset).
- **Extraction:** Extracted inside `%APPDATA%\ai-image-studio-desktop\runtime\comfyui-managed` using bundled `7za.exe` (`7zip-bin`), avoiding system-wide Python or global CUDA changes.
- **Model Persistence Across Updates:** Model downloads live separately in `%APPDATA%\ai-image-studio-desktop\models` and are linked into the managed runtime via an isolated `ComfyUI/extra_model_paths.yaml` written only inside the managed runtime folder. Replacing or updating the managed runtime leaves all models, database history, and generated images untouched.

