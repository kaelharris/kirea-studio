import json
import os
from PIL import Image

manifest_file = r"c:\Users\Harris\Documents\Ultimate AI\Projects\Kirea Studio\ai-image-studio-desktop\temp\aurelia_dataset\aurelia_dataset_manifest.json"

with open(manifest_file, "r", encoding="utf-8") as f:
    manifest = json.load(f)

print(f"Total candidates to audit: {len(manifest['images'])}")

for img in manifest["images"]:
    num = img["number"]
    fname = img["filename"]
    fpath = img["path"]
    framing = img["framing"]
    w, h = img["width"], img["height"]
    seed = img["seed"]
    prompt = img.get("prompt") or ""

    # Check key tags in prompt
    has_glasses = "glasses" in prompt.lower()
    has_mole = "mole" in prompt.lower() or "beauty mark" in prompt.lower()
    has_ponytail = "ponytail" in prompt.lower()
    has_gradient = "gradient" in prompt.lower()
    has_piercing = "piercing" in prompt.lower() or "navel" in prompt.lower()

    print(f"\n--- [Image #{num:02d}] {fname} ---")
    print(f"Framing: {framing} | Dimensions: {w}x{h} (ar={img['aspect_ratio']}) | Seed: {seed}")
    print(f"Key Tokens: glasses={has_glasses}, mole={has_mole}, ponytail={has_ponytail}, gradient={has_gradient}, piercing={has_piercing}")
    print(f"Prompt: {prompt}")
