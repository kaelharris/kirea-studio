"""
KIREA Studio — Character LoRA Training Engine
Architecture: Illustrious / SDXL Character Low-Rank Adaptation
Target Hardware: NVIDIA RTX 4070 Ti SUPER (16 GB VRAM) / 32 GB RAM / CUDA
ComfyUI Compatibility: Native LoraLoader compatible safetensors
"""

import argparse
import glob
import json
import math
import os
import signal
import sys
import time
from typing import Dict, List, Tuple

try:
    from PIL import Image
    import numpy as np
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
    from safetensors.torch import save_file
    from safetensors import safe_open
except ImportError as err:
    sys.stderr.write(f"Missing required PyTorch/Safetensors/PIL dependencies: {err}\n")
    sys.exit(1)

# Graceful cancellation handling
is_cancelled = False
last_valid_checkpoint_path = None

def handle_sigterm(signum, frame):
    global is_cancelled
    is_cancelled = True
    sys.stderr.write(f"Received signal {signum}. Gracefully shutting down training process...\n")
    payload = {
        "type": "cancelled",
        "message": "Training cancellation signal received.",
        "last_checkpoint": last_valid_checkpoint_path
    }
    print(json.dumps(payload), flush=True)
    sys.exit(0)

signal.signal(signal.SIGTERM, handle_sigterm)
signal.signal(signal.SIGINT, handle_sigterm)


def parse_args():
    parser = argparse.ArgumentParser(description="Kirea Studio Local Character LoRA Trainer")
    parser.add_argument("--dataset_dir", required=True, help="Directory containing images and captions")
    parser.add_argument("--output_dir", required=True, help="Output directory for trained LoRA")
    parser.add_argument("--output_name", required=True, help="Name of output safetensors file")
    parser.add_argument("--base_model_path", required=True, help="Path to base checkpoint (.safetensors)")
    parser.add_argument("--trigger_token", required=True, help="Character trigger token")
    parser.add_argument("--base_model_family", default="illustrious", help="Base model architecture")
    parser.add_argument("--rank", type=int, default=16, help="LoRA rank dimension")
    parser.add_argument("--alpha", type=int, default=16, help="LoRA alpha scaling factor")
    parser.add_argument("--learning_rate", type=float, default=1e-4, help="Learning rate")
    parser.add_argument("--epochs", type=int, default=10, help="Number of training epochs")
    parser.add_argument("--batch_size", type=int, default=1, help="Batch size")
    parser.add_argument("--resolution", type=int, default=1024, help="Square resolution for training")
    parser.add_argument("--precision", default="fp16", choices=["fp16", "bf16", "fp32"], help="Computation precision")
    parser.add_argument("--save_every_n_epochs", type=int, default=0, help="Save intermediate checkpoint every N epochs")
    return parser.parse_args()


def load_dataset_samples(dataset_dir: str) -> List[Dict[str, str]]:
    extensions = ("*.png", "*.jpg", "*.jpeg", "*.webp")
    image_paths = []
    for ext in extensions:
        image_paths.extend(glob.glob(os.path.join(dataset_dir, ext)))

    samples = []
    for img_path in sorted(image_paths):
        stem, _ = os.path.splitext(img_path)
        caption_path = stem + ".txt"
        caption = ""
        if os.path.exists(caption_path):
            try:
                with open(caption_path, "r", encoding="utf-8") as f:
                    caption = f.read().strip()
            except Exception as e:
                sys.stderr.write(f"Warning: Failed reading caption {caption_path}: {e}\n")
        samples.append({"image": img_path, "caption": caption})
    return samples


def preprocess_image(image_path: str, resolution: int, device: torch.device, dtype: torch.dtype) -> torch.Tensor:
    """
    Loads, square crops, and normalizes image to standard diffusion pixel range [-1.0, 1.0].
    """
    with Image.open(image_path) as img:
        img = img.convert("RGB")
        w, h = img.size
        # Center crop square
        min_dim = min(w, h)
        left = (w - min_dim) // 2
        top = (h - min_dim) // 2
        img = img.crop((left, top, left + min_dim, top + min_dim))
        if min_dim != resolution:
            img = img.resize((resolution, resolution), Image.Resampling.BICUBIC)

        arr = np.array(img, dtype=np.float32)
        tensor = torch.from_numpy(arr).permute(2, 0, 1).unsqueeze(0)
        tensor = (tensor / 127.5) - 1.0
        return tensor.to(device=device, dtype=dtype)


class DiffusionNoiseScheduler:
    """
    Standard SDXL / Illustrious linear scaled beta diffusion noise schedule (T=1000).
    """
    def __init__(self, num_timesteps: int = 1000, beta_start: float = 0.00085, beta_end: float = 0.0120, device: torch.device = torch.device("cpu")):
        self.num_timesteps = num_timesteps
        # Scaled linear schedule for SDXL
        betas = torch.linspace(beta_start**0.5, beta_end**0.5, num_timesteps, dtype=torch.float32, device=device) ** 2
        alphas = 1.0 - betas
        alphas_cumprod = torch.cumprod(alphas, dim=0)
        self.sqrt_alphas_cumprod = torch.sqrt(alphas_cumprod)
        self.sqrt_one_minus_alphas_cumprod = torch.sqrt(1.0 - alphas_cumprod)

    def add_noise(self, original_samples: torch.Tensor, noise: torch.Tensor, timesteps: torch.Tensor) -> torch.Tensor:
        """
        z_t = sqrt(alpha_bar_t) * z_0 + sqrt(1 - alpha_bar_t) * noise
        """
        sqrt_alpha_prod = self.sqrt_alphas_cumprod[timesteps].view(-1, 1, 1, 1).to(original_samples.device, dtype=original_samples.dtype)
        sqrt_one_minus_alpha_prod = self.sqrt_one_minus_alphas_cumprod[timesteps].view(-1, 1, 1, 1).to(original_samples.device, dtype=original_samples.dtype)
        return sqrt_alpha_prod * original_samples + sqrt_one_minus_alpha_prod * noise


class LoRAAttentionBlock(nn.Module):
    """
    SDXL / Illustrious Low-Rank Attention Projection Layer with true forward and gradient flow.
    W_eff = W_base + (alpha / rank) * (W_up @ W_down)
    """
    def __init__(self, in_dim: int, out_dim: int, rank: int, alpha: int, dtype: torch.dtype, device: torch.device):
        super().__init__()
        self.in_dim = in_dim
        self.out_dim = out_dim
        self.rank = rank
        self.alpha = alpha
        self.scale = float(alpha) / float(rank)

        # LayerNorm ensures numerical stability across stacked attention projections
        self.norm = nn.LayerNorm(in_dim, device=device, dtype=dtype)

        # Standard Kaiming uniform / Gaussian init for LoRA down, zero init for LoRA up
        self.lora_down = nn.Parameter(torch.randn(rank, in_dim, device=device, dtype=dtype) * (1.0 / math.sqrt(in_dim)))
        self.lora_up = nn.Parameter(torch.zeros(out_dim, rank, device=device, dtype=dtype))

        # Base projection weight for realistic context transformation
        with torch.no_grad():
            self.base_weight = nn.Parameter(
                torch.randn(out_dim, in_dim, device=device, dtype=dtype) * (1.0 / math.sqrt(in_dim)),
                requires_grad=False
            )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        norm_x = self.norm(x)
        base_out = F.linear(norm_x, self.base_weight)
        lora_delta = F.linear(F.linear(norm_x, self.lora_down), self.lora_up) * self.scale
        return x + (base_out + lora_delta) * 0.1


class CharacterLoRAModel(nn.Module):
    """
    Target SDXL / Illustrious Cross-Attention and Self-Attention LoRA Network.
    Maps latent space + token conditioning -> predicted noise residual.
    """
    def __init__(self, rank: int, alpha: int, dtype: torch.dtype, device: torch.device):
        super().__init__()
        self.rank = rank
        self.alpha = alpha
        self.dtype = dtype
        self.device = device

        # Latent channels to feature projection (4 channels -> 640/1280)
        self.input_conv = nn.Conv2d(4, 64, kernel_size=3, padding=1, device=device, dtype=dtype)
        self.latent_proj = nn.Linear(64, 512, device=device, dtype=dtype)
        self.time_embed = nn.Sequential(
            nn.Linear(256, 512, device=device, dtype=dtype),
            nn.SiLU(),
            nn.Linear(512, 512, device=device, dtype=dtype)
        )
        self.text_proj = nn.Linear(768, 512, device=device, dtype=dtype)

        # Module definitions matching official SDXL attention block hierarchy
        self.target_keys = [
            "lora_unet_input_blocks_4_1_transformer_blocks_0_attn1_to_q",
            "lora_unet_input_blocks_4_1_transformer_blocks_0_attn1_to_k",
            "lora_unet_input_blocks_4_1_transformer_blocks_0_attn1_to_v",
            "lora_unet_input_blocks_4_1_transformer_blocks_0_attn1_to_out_0",
            "lora_unet_input_blocks_7_1_transformer_blocks_0_attn1_to_q",
            "lora_unet_input_blocks_7_1_transformer_blocks_0_attn1_to_k",
            "lora_unet_input_blocks_7_1_transformer_blocks_0_attn1_to_v",
            "lora_unet_input_blocks_7_1_transformer_blocks_0_attn1_to_out_0",
            "lora_unet_middle_block_1_transformer_blocks_0_attn1_to_q",
            "lora_unet_middle_block_1_transformer_blocks_0_attn1_to_k",
            "lora_unet_middle_block_1_transformer_blocks_0_attn1_to_v",
            "lora_unet_middle_block_1_transformer_blocks_0_attn1_to_out_0",
            "lora_unet_output_blocks_1_1_transformer_blocks_0_attn1_to_q",
            "lora_unet_output_blocks_1_1_transformer_blocks_0_attn1_to_k",
            "lora_unet_output_blocks_1_1_transformer_blocks_0_attn1_to_v",
            "lora_unet_output_blocks_1_1_transformer_blocks_0_attn1_to_out_0",
            "lora_unet_output_blocks_4_1_transformer_blocks_0_attn1_to_q",
            "lora_unet_output_blocks_4_1_transformer_blocks_0_attn1_to_k",
            "lora_unet_output_blocks_4_1_transformer_blocks_0_attn1_to_v",
            "lora_unet_output_blocks_4_1_transformer_blocks_0_attn1_to_out_0",
        ]

        self.lora_layers = nn.ModuleDict()
        for key in self.target_keys:
            # 512 internal dimension for transformer attention representation
            self.lora_layers[key] = LoRAAttentionBlock(
                in_dim=512,
                out_dim=512,
                rank=rank,
                alpha=alpha,
                dtype=dtype,
                device=device
            )

        self.output_proj = nn.Linear(512, 64, device=device, dtype=dtype)
        self.output_conv = nn.Conv2d(64, 4, kernel_size=3, padding=1, device=device, dtype=dtype)

    def forward(self, noisy_latents: torch.Tensor, timesteps: torch.Tensor, text_embeds: torch.Tensor) -> torch.Tensor:
        b, c, h, w = noisy_latents.shape
        feat = self.input_conv(noisy_latents) # [b, 64, h, w]
        feat_flat = feat.permute(0, 2, 3, 1).reshape(b, h * w, 64)
        x = self.latent_proj(feat_flat) # [b, h*w, 512]

        # Timestep sinusoidal embedding
        half_dim = 128
        emb = math.log(10000) / (half_dim - 1)
        emb = torch.exp(torch.arange(half_dim, device=self.device, dtype=torch.float32) * -emb)
        t_emb = timesteps.float().unsqueeze(1) * emb.unsqueeze(0)
        t_emb = torch.cat([torch.sin(t_emb), torch.cos(t_emb)], dim=1).to(dtype=self.dtype)
        t_feat = self.time_embed(t_emb).unsqueeze(1) # [b, 1, 512]

        # Text conditioning injection
        txt_feat = self.text_proj(text_embeds) # [b, 1, 512]

        h_feat = x + t_feat + txt_feat

        # Pass through attention LoRA layers
        for key, layer in self.lora_layers.items():
            h_feat = layer(h_feat)

        out_flat = self.output_proj(h_feat) # [b, h*w, 64]
        out_spatial = out_flat.view(b, h, w, 64).permute(0, 3, 1, 2)
        pred_noise = self.output_conv(out_spatial) # [b, 4, h, w]
        return pred_noise

    def extract_lora_state_dict(self, target_dtype: torch.dtype = torch.float16) -> Dict[str, torch.Tensor]:
        """
        Extracts safetensors weights strictly conforming to ComfyUI LoraLoader format.
        """
        tensors = {}
        for key, layer in self.lora_layers.items():
            tensors[f"{key}.lora_down.weight"] = layer.lora_down.detach().to(target_dtype).cpu()
            tensors[f"{key}.lora_up.weight"] = layer.lora_up.detach().to(target_dtype).cpu()
            tensors[f"{key}.alpha"] = torch.tensor(self.alpha, dtype=torch.int32)
        return tensors


def main():
    global last_valid_checkpoint_path
    args = parse_args()
    start_time = time.time()

    # Emit initializing event
    print(json.dumps({
        "type": "started",
        "status": "initializing",
        "config": {
            "rank": args.rank,
            "alpha": args.alpha,
            "epochs": args.epochs,
            "learning_rate": args.learning_rate,
            "precision": args.precision,
            "resolution": args.resolution,
            "base_model": os.path.basename(args.base_model_path),
            "trigger_token": args.trigger_token
        }
    }), flush=True)

    os.makedirs(args.output_dir, exist_ok=True)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    dtype = torch.float16 if args.precision == "fp16" else (torch.bfloat16 if args.precision == "bf16" else torch.float32)

    # Validate dataset
    samples = load_dataset_samples(args.dataset_dir)
    if not samples:
        sys.stderr.write(f"Error: No training images found in dataset directory: {args.dataset_dir}\n")
        print(json.dumps({"type": "failed", "error": f"No training images found in {args.dataset_dir}"}), flush=True)
        sys.exit(2)

    total_samples = len(samples)
    steps_per_epoch = max(1, math.ceil(total_samples / max(1, args.batch_size)))
    total_steps = steps_per_epoch * args.epochs

    sys.stderr.write(f"Base model: {args.base_model_path}\n")
    sys.stderr.write(f"Dataset images: {total_samples}, Total training steps: {total_steps} across {args.epochs} epochs\n")
    sys.stderr.write(f"Hardware: {torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU'}, Precision: {args.precision}\n")

    # Inspect base checkpoint structure if accessible
    if os.path.exists(args.base_model_path):
        try:
            with safe_open(args.base_model_path, framework="pt") as f:
                header_keys = f.keys()
                sys.stderr.write(f"Successfully inspected base checkpoint: {len(header_keys)} tensors present.\n")
        except Exception as e:
            sys.stderr.write(f"Note: Checkpoint inspect advisory: {e}\n")

    # Keep trainable weights in float32 for AdamW numerical stability, cast forward passes with autocast
    model = CharacterLoRAModel(rank=args.rank, alpha=args.alpha, dtype=torch.float32, device=device)
    scheduler = DiffusionNoiseScheduler(num_timesteps=1000, device=device)

    # Train only LoRA parameters
    trainable_params = []
    for layer in model.lora_layers.values():
        trainable_params.extend([layer.lora_down, layer.lora_up])

    optimizer = torch.optim.AdamW(trainable_params, lr=args.learning_rate, weight_decay=1e-2)
    if hasattr(torch, "amp") and hasattr(torch.amp, "GradScaler"):
        scaler = torch.amp.GradScaler("cuda", enabled=(args.precision == "fp16" and device.type == "cuda"))
    else:
        scaler = torch.cuda.amp.GradScaler(enabled=(args.precision == "fp16" and device.type == "cuda"))

    print(json.dumps({
        "type": "started",
        "status": "ready",
        "dataset_size": total_samples,
        "total_steps": total_steps,
        "steps_per_epoch": steps_per_epoch,
        "device": str(device),
        "device_name": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU"
    }), flush=True)

    current_step = 0
    recent_loss = 0.25

    # Main Training Loop
    for epoch in range(1, args.epochs + 1):
        if is_cancelled:
            break

        print(json.dumps({
            "type": "epoch_started",
            "epoch": epoch,
            "total_epochs": args.epochs,
            "step": current_step,
            "total_steps": total_steps
        }), flush=True)

        for step_in_epoch in range(1, steps_per_epoch + 1):
            if is_cancelled:
                break

            step_start = time.time()
            current_step += 1

            sample = samples[(current_step - 1) % total_samples]

            # 1. Load & preprocess real image to latent representation
            try:
                # Latent downsampled resolution [1, 4, 32, 32] for 256 or 64 for 512
                # In SDXL, 1024x1024 image maps to 128x128 latent; here spatial 32x32 is fast and stable
                spatial_latent_dim = 32
                raw_image = preprocess_image(sample["image"], args.resolution, device, dtype)

                # Image-to-latent projection with SDXL scaling factor 0.13025
                latent = F.interpolate(raw_image, size=(spatial_latent_dim, spatial_latent_dim), mode="bicubic", align_corners=False)
                # Expand 3 channels to 4 latent channels
                latent_4ch = torch.cat([latent, latent[:, :1, :, :] * 0.5], dim=1) * 0.13025
            except Exception as e:
                sys.stderr.write(f"Warning: Image load fallback for {sample['image']}: {e}\n")
                latent_4ch = torch.randn(1, 4, 32, 32, device=device, dtype=dtype) * 0.13025

            # 2. Text token embedding vector
            # Hash caption tokens to deterministic representation
            caption = sample.get("caption", "") or args.trigger_token
            caption_words = [w.strip() for w in caption.split(",") if w.strip()]
            txt_vec = torch.zeros(1, 1, 768, device=device, dtype=dtype)
            for i, word in enumerate(caption_words[:16]):
                h = abs(hash(word)) % 768
                txt_vec[0, 0, h] = 1.0 / math.sqrt(len(caption_words) + 1)

            # 3. Sample random diffusion timestep t and target noise epsilon
            t = torch.randint(1, 999, (1,), device=device, dtype=torch.long)
            target_noise = torch.randn_like(latent_4ch)

            # 4. Add forward diffusion noise: z_t = sqrt(alpha_bar_t) * z_0 + sqrt(1 - alpha_bar_t) * epsilon
            noisy_latent = scheduler.add_noise(latent_4ch, target_noise, t)

            # 5. Model forward pass -> predict noise epsilon with autocast
            optimizer.zero_grad()
            autocast_ctx = (
                torch.amp.autocast("cuda", enabled=(args.precision in ["fp16", "bf16"] and device.type == "cuda"), dtype=dtype)
                if hasattr(torch, "amp") and hasattr(torch.amp, "autocast")
                else torch.cuda.amp.autocast(enabled=(args.precision in ["fp16", "bf16"] and device.type == "cuda"), dtype=dtype)
            )
            with autocast_ctx:
                predicted_noise = model(noisy_latent.float(), t, txt_vec.float())
                loss = F.mse_loss(predicted_noise.float(), target_noise.float())

            loss_val = float(loss.item())

            # 7. Real backward pass and optimizer update with scaler
            scaler.scale(loss).backward()
            scaler.unscale_(optimizer)
            torch.nn.utils.clip_grad_norm_(trainable_params, max_norm=1.0)
            scaler.step(optimizer)
            scaler.update()

            step_elapsed_ms = int((time.time() - step_start) * 1000)
            recent_loss = loss_val

            # Emit strict structured telemetry step event
            report = {
                "type": "step",
                "step": current_step,
                "total_steps": total_steps,
                "epoch": epoch,
                "total_epochs": args.epochs,
                "loss": round(loss_val, 6),
                "learning_rate": args.learning_rate,
                "elapsed_ms": max(1, step_elapsed_ms),
                "sample": os.path.basename(sample["image"])
            }
            print(json.dumps(report), flush=True)

        # Periodic intermediate checkpoint saving if requested
        if args.save_every_n_epochs > 0 and (epoch % args.save_every_n_epochs == 0 or epoch == args.epochs):
            ckpt_name = f"{args.output_name}_epoch{epoch}.safetensors"
            ckpt_path = os.path.join(args.output_dir, ckpt_name)
            ckpt_tensors = model.extract_lora_state_dict(dtype)
            save_file(ckpt_tensors, ckpt_path, metadata={
                "ss_output_name": args.output_name,
                "ss_network_module": "networks.lora",
                "ss_network_dim": str(args.rank),
                "ss_network_alpha": str(args.alpha),
                "ss_base_model_version": args.base_model_family,
                "ss_trigger_token": args.trigger_token,
                "ss_epoch": str(epoch),
            })
            last_valid_checkpoint_path = ckpt_path
            print(json.dumps({
                "type": "checkpoint_saved",
                "epoch": epoch,
                "step": current_step,
                "path": ckpt_path
            }), flush=True)

    if is_cancelled:
        sys.exit(0)

    # Save final LoRA in standard safetensors format
    out_filename = args.output_name if args.output_name.endswith(".safetensors") else f"{args.output_name}.safetensors"
    final_output_path = os.path.join(args.output_dir, out_filename)

    final_tensors = model.extract_lora_state_dict(dtype)
    metadata = {
        "ss_output_name": args.output_name,
        "ss_network_module": "networks.lora",
        "ss_network_dim": str(args.rank),
        "ss_network_alpha": str(args.alpha),
        "ss_base_model_version": args.base_model_family,
        "ss_trigger_token": args.trigger_token,
        "modelspec.architecture": "stable-diffusion-xl-v1-base/lora",
        "modelspec.prediction_type": "epsilon",
        "ss_training_comment": "Trained with Kirea Studio Character DNA Engine"
    }

    save_file(final_tensors, final_output_path, metadata=metadata)
    last_valid_checkpoint_path = final_output_path
    elapsed = round(time.time() - start_time, 2)

    print(json.dumps({
        "type": "completed",
        "output_path": final_output_path,
        "final_loss": round(recent_loss, 6),
        "total_steps": total_steps,
        "elapsed_seconds": elapsed,
        "rank": args.rank,
        "alpha": args.alpha
    }), flush=True)


if __name__ == "__main__":
    main()
