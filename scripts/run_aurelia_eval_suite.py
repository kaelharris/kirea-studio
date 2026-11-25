"""
KIREA Studio — Character DNA Aurelia Checkpoint Evaluation Suite
Evaluates intermediate checkpoints (80, 160, 240, 320, 400 steps) and baseline
across 4 standard diagnostic prompts using ComfyUI native pipeline.
"""

import sys
import os
import shutil
import json
import time
import torch
import numpy as np
from PIL import Image

comfy_dir = r"C:\Users\Harris\Documents\ComfyUI\TES\ComfyUI"
sys.path.insert(0, comfy_dir)

import nodes
import folder_paths

output_dir = r"c:\Users\Harris\Documents\Ultimate AI\Projects\Kirea Studio\ai-image-studio-desktop\temp\aurelia_eval_output"
os.makedirs(output_dir, exist_ok=True)

comfy_lora_dir = os.path.join(comfy_dir, "models", "loras")
training_output_dir = r"c:\Users\Harris\Documents\Ultimate AI\Projects\Kirea Studio\ai-image-studio-desktop\temp\aurelia_training_output"

ckpt_name = r"illustrious\Animixy².safetensors"

# 4 Test Prompts
prompts = [
    {
        "id": "prompt1_sundress",
        "description": "Outfit Transfer & Bikini Leakage Check",
        "positive": "aurelia_char, 1girl, white sundress, green meadow, sunny day, masterpiece, best quality",
        "negative": "worst quality, low quality, blurry, deformed"
    },
    {
        "id": "prompt2_portrait_noglasses",
        "description": "Facial Likeness & Glasses Removal Check",
        "positive": "aurelia_char, 1girl, close-up portrait, no glasses, smiling, masterpiece, best quality",
        "negative": "worst quality, low quality, blurry, deformed"
    },
    {
        "id": "prompt3_cyberpunk",
        "description": "Environment Versatility Check",
        "positive": "aurelia_char, 1girl, cyberpunk neon alley, rainy night, cinematic lighting, masterpiece, best quality",
        "negative": "worst quality, low quality, blurry, deformed"
    },
    {
        "id": "prompt4_canonical",
        "description": "Canonical Anchor Outfit Check",
        "positive": "aurelia_char, 1girl, black open jacket, white crop top, studio background, masterpiece, best quality",
        "negative": "worst quality, low quality, blurry, deformed"
    }
]

# Checkpoint configurations
checkpoints = [
    {
        "step": 0,
        "name": "Baseline (No LoRA)",
        "file": None
    },
    {
        "step": 80,
        "name": "Epoch 2 (Step 80)",
        "file": "aurelia_illustrious_lora-000002.safetensors"
    },
    {
        "step": 160,
        "name": "Epoch 4 (Step 160)",
        "file": "aurelia_illustrious_lora-000004.safetensors"
    },
    {
        "step": 240,
        "name": "Epoch 6 (Step 240)",
        "file": "aurelia_illustrious_lora-000006.safetensors"
    },
    {
        "step": 320,
        "name": "Epoch 8 (Step 320)",
        "file": "aurelia_illustrious_lora-000008.safetensors"
    },
    {
        "step": 400,
        "name": "Epoch 10 (Step 400)",
        "file": "aurelia_illustrious_lora.safetensors"
    }
]

seed = 100
steps = 20
cfg = 7.0
sampler_name = "euler"
scheduler = "normal"
width = 1024
height = 1024

print("=== STARTING AURELIA EVALUATION SUITE ===")
print(f"Device: {torch.cuda.get_device_name(0)}")
print(f"Base Checkpoint: {ckpt_name}")

# Copy trained checkpoints to ComfyUI loras directory if not already there
for cp in checkpoints:
    if cp["file"]:
        src = os.path.join(training_output_dir, cp["file"])
        dst = os.path.join(comfy_lora_dir, cp["file"])
        if os.path.exists(src):
            shutil.copy2(src, dst)
            print(f"Staged {cp['file']} to ComfyUI loras directory.")
        else:
            print(f"WARNING: Source checkpoint {src} not found!")

# Load Base Checkpoint
print("\nLoading Animixy² Base Checkpoint...")
t0 = time.time()
ckpt_loader = nodes.CheckpointLoaderSimple()
base_model, base_clip, vae = ckpt_loader.load_checkpoint(ckpt_name)
print(f"Loaded base model in {round(time.time() - t0, 2)}s")

clip_encoder = nodes.CLIPTextEncode()
ksampler = nodes.KSampler()
vae_decoder = nodes.VAEDecode()
lora_loader = nodes.LoraLoader()

results = []

with torch.inference_mode():
    empty_latent = nodes.EmptyLatentImage().generate(width, height, batch_size=1)[0]

    for cp in checkpoints:
        step_label = f"step_{cp['step']:03d}"
        print(f"\n--- Evaluating Checkpoint: {cp['name']} ({cp['file'] or 'None'}) ---")

        if cp["file"] is None:
            model_to_use = base_model
            clip_to_use = base_clip
        else:
            model_to_use, clip_to_use = lora_loader.load_lora(base_model, base_clip, cp["file"], 1.0, 1.0)

        for p in prompts:
            p_id = p["id"]
            img_filename = f"{step_label}_{p_id}.png"
            img_path = os.path.join(output_dir, img_filename)

            t_start = time.time()
            pos = clip_encoder.encode(clip_to_use, p["positive"])[0]
            neg = clip_encoder.encode(clip_to_use, p["negative"])[0]

            latent = ksampler.sample(
                model_to_use, seed, steps, cfg, sampler_name, scheduler, pos, neg, empty_latent, denoise=1.0
            )[0]

            decoded = vae_decoder.decode(vae, latent)[0]
            elapsed = round(time.time() - t_start, 2)

            img_arr = (decoded[0].detach().cpu().numpy() * 255.0).clip(0, 255).astype(np.uint8)
            img = Image.fromarray(img_arr)
            img.save(img_path, "PNG")

            res_entry = {
                "checkpoint_step": cp["step"],
                "checkpoint_name": cp["name"],
                "checkpoint_file": cp["file"],
                "prompt_id": p_id,
                "prompt_description": p["description"],
                "prompt_positive": p["positive"],
                "prompt_negative": p["negative"],
                "seed": seed,
                "steps": steps,
                "cfg": cfg,
                "sampler": sampler_name,
                "scheduler": scheduler,
                "width": width,
                "height": height,
                "elapsed_seconds": elapsed,
                "image_filename": img_filename,
                "image_path": img_path
            }
            results.append(res_entry)
            print(f"  [Prompt: {p_id}] generated in {elapsed}s -> {img_filename}")

# Save full results JSON
results_json_path = os.path.join(output_dir, "aurelia_evaluation_results.json")
with open(results_json_path, "w") as f:
    json.dump(results, f, indent=2)

print(f"\nEvaluation Suite Complete! 24 images saved to {output_dir}")
print(f"Results manifest: {results_json_path}")
