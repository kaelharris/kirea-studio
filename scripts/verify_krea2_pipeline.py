"""
KIREA Studio — Krea 2 Pipeline Verification Test
Verifies end-to-end inference for Krea 2 in ComfyUI.
"""

import sys
import os
import time
import torch
import numpy as np
from PIL import Image

comfy_dir = r"C:\Users\Harris\Documents\ComfyUI\TES\ComfyUI"
sys.path.insert(0, comfy_dir)

import nodes
import comfy.sd
import comfy.model_management

model_path = r"krea2\Krea2cocoamix004.safetensors"
clip_name = "qwen3vl_4b_fp8_scaled.safetensors"
vae_name = "ae.safetensors"

prompt_pos = "1girl, solo, beautiful anime girl, detailed eyes, masterpiece"
prompt_neg = "worst quality, low quality, blurry"

output_dir = r"c:\Users\Harris\Documents\Ultimate AI\Projects\Kirea Studio\ai-image-studio-desktop\temp"
os.makedirs(output_dir, exist_ok=True)
out_img_path = os.path.join(output_dir, "krea2_verification_test.png")

print("=== KREA 2 PIPELINE VERIFICATION TEST ===")
print("1. Loading Krea 2 Diffusion Model...")
t0 = time.time()
ckpt_loader = nodes.CheckpointLoaderSimple()
res = ckpt_loader.load_checkpoint(model_path)
model = res[0]
print(f"Model loaded in {round(time.time() - t0, 2)}s")

print("2. Loading Qwen3-VL 4B Krea2 Text Encoder...")
t0 = time.time()
clip_loader = nodes.CLIPLoader()
clip = clip_loader.load_clip(clip_name, "krea2")[0]
print(f"CLIP loaded in {round(time.time() - t0, 2)}s")

print("3. Loading AE VAE...")
t0 = time.time()
vae_loader = nodes.VAELoader()
vae = vae_loader.load_vae(vae_name)[0]
print(f"VAE loaded in {round(time.time() - t0, 2)}s")

with torch.inference_mode():
    print("4. Encoding Conditioning Prompts...")
    clip_encoder = nodes.CLIPTextEncode()
    pos = clip_encoder.encode(clip, prompt_pos)[0]
    neg = clip_encoder.encode(clip, prompt_neg)[0]
    print("Prompts encoded successfully.")

    print("5. Creating 16-channel Latent...")
    # 512x512 for fast smoke verification
    width = 512
    height = 512
    # 16-channel latent: height//8, width//8
    latent_tensor = torch.zeros([1, 16, height // 8, width // 8], device=comfy.model_management.intermediate_device())
    latent = {"samples": latent_tensor}

    print("6. Sampling 4 steps with KSampler...")
    t0 = time.time()
    ksampler = nodes.KSampler()
    sampled_latent = ksampler.sample(
        model, seed=42, steps=4, cfg=1.8, sampler_name="euler", scheduler="simple",
        positive=pos, negative=neg, latent_image=latent, denoise=1.0
    )[0]
    print(f"Sampling completed in {round(time.time() - t0, 2)}s")

    print("7. Decoding Latent with VAE...")
    t0 = time.time()
    vae_decoder = nodes.VAEDecode()
    decoded = vae_decoder.decode(vae, sampled_latent)[0]
    print(f"Decoded in {round(time.time() - t0, 2)}s")

    img_arr = (decoded[0].detach().cpu().numpy() * 255.0).clip(0, 255).astype(np.uint8)
    img = Image.fromarray(img_arr)
    img.save(out_img_path, "PNG")
    print(f"Saved test image to: {out_img_path}")

print("=== KREA 2 PIPELINE VERIFIED SUCCESSFULLY! ===")
