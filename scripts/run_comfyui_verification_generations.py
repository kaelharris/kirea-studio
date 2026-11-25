"""
KIREA Studio — ComfyUI Generation Verification
Runs Baseline and LoRA generations using ComfyUI's native nodes and execution pipeline.
Saves resulting images and generation metadata.
"""

import sys
import os
import json
import time
import torch
import numpy as np
from PIL import Image

comfy_dir = r"C:\Users\Harris\Documents\ComfyUI\TES\ComfyUI"
sys.path.insert(0, comfy_dir)

import nodes
import folder_paths

output_dir = r"c:\Users\Harris\Documents\Ultimate AI\Projects\Kirea Studio\ai-image-studio-desktop\temp\comfyui_verification_output"
os.makedirs(output_dir, exist_ok=True)

ckpt_name = r"illustrious\Animixy².safetensors"
lora_name = "smoke_test_animixy_lora.safetensors"

prompt_pos = "1girl, solo, short hair, black hair, looking at viewer, masterpiece, best quality"
prompt_neg = "worst quality, low quality, blurry, deformed"
seed = 42
steps = 20
cfg = 7.0
sampler_name = "euler"
scheduler = "normal"
width = 1024
height = 1024

print("=== COMFYUI GENERATION VERIFICATION ===")
print(f"Device: {torch.cuda.get_device_name(0)}")
print(f"Base Checkpoint: {ckpt_name}")
print(f"LoRA: {lora_name}")
print(f"Prompt: {prompt_pos}")
print(f"Seed: {seed}, Steps: {steps}, CFG: {cfg}, Sampler: {sampler_name}/{scheduler}, Dimensions: {width}x{height}")

# 1. Load Checkpoint
print("\n[1/3] Loading Animixy² Checkpoint...")
t0 = time.time()
ckpt_loader = nodes.CheckpointLoaderSimple()
base_model, base_clip, vae = ckpt_loader.load_checkpoint(ckpt_name)
ckpt_load_sec = round(time.time() - t0, 2)
print(f"Loaded checkpoint in {ckpt_load_sec}s")

# Shared Latent
with torch.inference_mode():
    empty_latent = nodes.EmptyLatentImage().generate(width, height, batch_size=1)[0]
    clip_encoder = nodes.CLIPTextEncode()
    ksampler = nodes.KSampler()
    vae_decoder = nodes.VAEDecode()

    # --- RUN A: BASELINE (NO LORA) ---
    print("\n[2/3] Executing Run A — Baseline (No LoRA)...")
    t_start_a = time.time()
    pos_a = clip_encoder.encode(base_clip, prompt_pos)[0]
    neg_a = clip_encoder.encode(base_clip, prompt_neg)[0]

    latent_a = ksampler.sample(
        base_model, seed, steps, cfg, sampler_name, scheduler, pos_a, neg_a, empty_latent, denoise=1.0
    )[0]

    decoded_a = vae_decoder.decode(vae, latent_a)[0]
    elapsed_a = round(time.time() - t_start_a, 2)

    img_a_array = (decoded_a[0].detach().cpu().numpy() * 255.0).clip(0, 255).astype(np.uint8)
    img_a = Image.fromarray(img_a_array)
    path_a = os.path.join(output_dir, "generation_A_baseline.png")
    img_a.save(path_a, "PNG")

    meta_a = {
        "run": "A_baseline",
        "checkpoint": ckpt_name,
        "lora": None,
        "prompt": prompt_pos,
        "negative_prompt": prompt_neg,
        "seed": seed,
        "steps": steps,
        "cfg": cfg,
        "sampler": sampler_name,
        "scheduler": scheduler,
        "width": width,
        "height": height,
        "output_file": path_a,
        "elapsed_seconds": elapsed_a,
        "status": "COMPLETED"
    }
    with open(os.path.join(output_dir, "generation_A_baseline_metadata.json"), "w") as f:
        json.dump(meta_a, f, indent=2)

    print(f"Run A completed in {elapsed_a}s -> Saved to {path_a}")

    # --- RUN B: LORA (SMOKE TEST LORA AT WEIGHT 1.0) ---
    print("\n[3/3] Executing Run B — LoRA Enabled (Weight 1.0)...")
    t_start_b = time.time()

    lora_loader = nodes.LoraLoader()
    model_lora, clip_lora = lora_loader.load_lora(base_model, base_clip, lora_name, 1.0, 1.0)
    print(f"LoRA loaded via native LoraLoader node. Patched UNet keys count: {len(model_lora.patches)}")

    pos_b = clip_encoder.encode(clip_lora, prompt_pos)[0]
    neg_b = clip_encoder.encode(clip_lora, prompt_neg)[0]

    latent_b = ksampler.sample(
        model_lora, seed, steps, cfg, sampler_name, scheduler, pos_b, neg_b, empty_latent, denoise=1.0
    )[0]

    decoded_b = vae_decoder.decode(vae, latent_b)[0]
    elapsed_b = round(time.time() - t_start_b, 2)

    img_b_array = (decoded_b[0].detach().cpu().numpy() * 255.0).clip(0, 255).astype(np.uint8)
    img_b = Image.fromarray(img_b_array)
    path_b = os.path.join(output_dir, "generation_B_lora.png")
    img_b.save(path_b, "PNG")

    meta_b = {
        "run": "B_lora",
        "checkpoint": ckpt_name,
        "lora": lora_name,
        "lora_strength_model": 1.0,
        "lora_strength_clip": 1.0,
        "prompt": prompt_pos,
        "negative_prompt": prompt_neg,
        "seed": seed,
        "steps": steps,
        "cfg": cfg,
        "sampler": sampler_name,
        "scheduler": scheduler,
        "width": width,
        "height": height,
        "output_file": path_b,
        "elapsed_seconds": elapsed_b,
        "status": "COMPLETED"
    }
    with open(os.path.join(output_dir, "generation_B_lora_metadata.json"), "w") as f:
        json.dump(meta_b, f, indent=2)

    print(f"Run B completed in {elapsed_b}s -> Saved to {path_b}")

# Compare output images
pixel_diff = np.abs(img_a_array.astype(float) - img_b_array.astype(float)).mean()
print(f"\nMean RGB pixel difference between Baseline and LoRA: {pixel_diff:.4f}")
print(f"Max RGB pixel difference: {np.abs(img_a_array.astype(float) - img_b_array.astype(float)).max()}")
assert pixel_diff > 0, "LoRA image must differ from baseline image!"

print("\n=== GENERATION VERIFICATION COMPLETE: ALL CHECKS PASSED 100% ===")
