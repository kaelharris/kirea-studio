"""
KIREA Studio — sd-scripts Subprocess Adapter
Bridges Kirea TrainingManager with kohya-ss/sd-scripts for SDXL / Illustrious LoRA training.
Emits real-time JSON-lines telemetry matching Kirea Studio IPC event contracts.
"""

import argparse
import json
import os
import re
import signal
import subprocess
import sys
import tempfile
import time


def parse_args():
    parser = argparse.ArgumentParser(description="Kirea Studio sd-scripts Adapter")
    parser.add_argument("--dataset_dir", required=True, help="Directory containing images and captions")
    parser.add_argument("--output_dir", required=True, help="Output directory for trained LoRA")
    parser.add_argument("--output_name", required=True, help="Output safetensors filename (without extension)")
    parser.add_argument("--base_model_path", required=True, help="Path to base SDXL checkpoint (.safetensors)")
    parser.add_argument("--trigger_token", required=True, help="Trigger token for character")
    parser.add_argument("--base_model_family", default="illustrious", choices=["sdxl", "illustrious", "pony"], help="Base model architecture")
    parser.add_argument("--rank", type=int, default=16, help="LoRA rank dimension")
    parser.add_argument("--alpha", type=int, default=16, help="LoRA alpha scaling factor")
    parser.add_argument("--learning_rate", type=float, default=1e-4, help="Learning rate")
    parser.add_argument("--epochs", type=int, default=10, help="Number of epochs")
    parser.add_argument("--batch_size", type=int, default=1, help="Batch size")
    parser.add_argument("--resolution", type=int, default=1024, help="Square resolution")
    parser.add_argument("--precision", default="fp16", choices=["fp16", "bf16", "fp32"], help="Precision")
    parser.add_argument("--gradient_accumulation_steps", type=int, default=1, help="Optimizer gradient accumulation steps")
    parser.add_argument("--gradient_checkpointing", choices=["true", "false"], default="true", help="Enable gradient checkpointing")
    parser.add_argument("--save_every_n_epochs", type=int, default=0, help="Checkpoint frequency")
    parser.add_argument("--repeats", type=int, default=4, help="Number of repeats per image in subset")
    parser.add_argument("--network_train_unet_only", action="store_true", default=True, help="Train only UNet LoRA")
    return parser.parse_args()


def emit_json(payload: dict):
    print(json.dumps(payload), flush=True)


child_proc = None

def handle_sigterm(signum, frame):
    global child_proc
    sys.stderr.write(f"[ADAPTER] Signal {signum} received. Terminating sd-scripts child process...\n")
    if child_proc:
        try:
            child_proc.terminate()
            child_proc.wait(timeout=5)
        except Exception:
            try:
                child_proc.kill()
            except Exception:
                pass
    emit_json({"type": "cancelled", "message": "Training cancelled by user."})
    sys.exit(0)

signal.signal(signal.SIGTERM, handle_sigterm)
signal.signal(signal.SIGINT, handle_sigterm)


def create_dataset_config(dataset_dir: str, resolution: int, batch_size: int, repeats: int = 4) -> str:
    """
    Creates a temporary TOML dataset config for kohya-ss sd-scripts.
    """
    config_content = f"""[general]
enable_bucket = true

[[datasets]]
resolution = [{resolution}, {resolution}]
batch_size = {batch_size}

  [[datasets.subsets]]
  image_dir = '''{os.path.abspath(dataset_dir)}'''
  num_repeats = {repeats}
  caption_extension = ".txt"
"""
    fd, path = tempfile.mkstemp(prefix="kirea_dataset_", suffix=".toml")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(config_content)
    return path


def validate_output_paths(args):
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", args.output_name):
        raise ValueError("output_name must be a safe filename without path separators")
    output_dir = os.path.realpath(os.path.abspath(args.output_dir))
    output_path = os.path.realpath(os.path.join(output_dir, f"{args.output_name}.safetensors"))
    try:
        contained = os.path.commonpath([output_dir, output_path]) == output_dir
    except ValueError:
        contained = False
    if not contained:
        raise ValueError("output_path resolves outside output_dir")
    return output_dir, output_path


def build_command(args, train_script: str, dataset_toml: str):
    cmd = [
        sys.executable,
        train_script,
        f"--pretrained_model_name_or_path={args.base_model_path}",
        f"--dataset_config={dataset_toml}",
        f"--output_dir={args.output_dir}",
        f"--output_name={args.output_name}",
        "--network_module=networks.lora",
        f"--network_dim={args.rank}",
        f"--network_alpha={args.alpha}",
        f"--learning_rate={args.learning_rate}",
        f"--max_train_epochs={args.epochs}",
        f"--gradient_accumulation_steps={args.gradient_accumulation_steps}",
        f"--mixed_precision={args.precision}",
        f"--save_precision={args.precision}",
        "--save_model_as=safetensors",
        "--sdpa",
        "--cache_latents",
        "--cache_latents_to_disk",
        "--cache_text_encoder_outputs",
        "--cache_text_encoder_outputs_to_disk",
    ]
    if args.gradient_checkpointing == "true":
        cmd.append("--gradient_checkpointing")
    if args.network_train_unet_only:
        cmd.append("--network_train_unet_only")
    if args.save_every_n_epochs > 0:
        cmd.append(f"--save_every_n_epochs={args.save_every_n_epochs}")
    return cmd


def main():
    global child_proc
    args = parse_args()
    start_time = time.time()

    emit_json({
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
            "trigger_token": args.trigger_token,
            "backend": "kohya_sd_scripts"
        }
    })

    # Normalize paths to absolute to prevent cwd mismatches with child process
    args.base_model_path = os.path.abspath(args.base_model_path)
    args.dataset_dir = os.path.abspath(args.dataset_dir)
    try:
        args.output_dir, output_safetensors = validate_output_paths(args)
    except ValueError as err:
        sys.stderr.write(f"[ERROR] {err}\n")
        emit_json({"type": "failed", "error": str(err)})
        sys.exit(2)

    # Validate paths
    if not os.path.exists(args.base_model_path):
        err_msg = f"Base checkpoint not found: {args.base_model_path}"
        sys.stderr.write(f"[ERROR] {err_msg}\n")
        emit_json({"type": "failed", "error": err_msg})
        sys.exit(1)

    if not os.path.exists(args.dataset_dir):
        err_msg = f"Dataset directory not found: {args.dataset_dir}"
        sys.stderr.write(f"[ERROR] {err_msg}\n")
        emit_json({"type": "failed", "error": err_msg})
        sys.exit(1)

    os.makedirs(args.output_dir, exist_ok=True)

    # Locate sd-scripts
    script_candidates = [
        os.path.join(os.path.dirname(__file__), "..", "sd-scripts", "sdxl_train_network.py"),
        os.path.join(os.getcwd(), "external", "sd-scripts", "sdxl_train_network.py"),
        os.path.join(os.path.dirname(__file__), "sd-scripts", "sdxl_train_network.py"),
    ]
    train_script = None
    for cand in script_candidates:
        abs_cand = os.path.abspath(cand)
        if os.path.exists(abs_cand):
            train_script = abs_cand
            break

    if not train_script:
        err_msg = "sdxl_train_network.py not found in sd-scripts directory"
        sys.stderr.write(f"[ERROR] {err_msg}\n")
        emit_json({"type": "failed", "error": err_msg})
        sys.exit(2)

    sd_scripts_dir = os.path.dirname(train_script)

    dataset_toml = create_dataset_config(args.dataset_dir, args.resolution, args.batch_size, args.repeats)

    # Build command line for sdxl_train_network.py
    cmd = build_command(args, train_script, dataset_toml)

    sys.stderr.write(f"[ADAPTER] Spawning: {' '.join(cmd)}\n")

    # Set PYTHONPATH so sd-scripts finds its library and networks modules
    env = os.environ.copy()
    current_pythonpath = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = f"{sd_scripts_dir}{os.pathsep}{current_pythonpath}"
    env["PYTHONUNBUFFERED"] = "1"

    last_step = 0
    total_steps = 1
    current_epoch = 1
    last_loss = 0.0
    last_step_time = time.time()

    # Regex patterns for progress parsing
    # e.g.: steps:  10%|█         | 10/100 [00:15<02:18,  1.54s/it, loss=0.124, lr=1e-4]
    # or: epoch 1/10
    step_pattern = re.compile(r"(\d+)/(\d+)\s+\[.*?loss=([0-9.]+)")
    epoch_pattern = re.compile(r"epoch\s+(\d+)/(\d+)", re.I)
    checkpoint_pattern = re.compile(r"saving checkpoint.*?(?::|to)\s+([^\s]+\.safetensors)", re.I)

    try:
        child_proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            env=env,
            cwd=sd_scripts_dir
        )

        emit_json({
            "type": "started",
            "status": "ready",
            "backend": "kohya_sd_scripts"
        })

        # Read stderr and stdout simultaneously
        # Note: tqdm writes to stderr by default!
        import threading

        def stream_reader(pipe, is_stderr=False):
            nonlocal last_step, total_steps, current_epoch, last_loss, last_step_time
            for raw_line in iter(pipe.readline, ""):
                line = raw_line.strip()
                if not line:
                    continue

                # Echo diagnostic output to stderr for TrainingManager logger
                sys.stderr.write(f"[SD-SCRIPTS] {line}\n")
                sys.stderr.flush()

                # Check for epoch transitions
                ep_match = epoch_pattern.search(line)
                if ep_match:
                    current_epoch = int(ep_match.group(1))
                    total_ep = int(ep_match.group(2))
                    emit_json({
                        "type": "epoch_started",
                        "epoch": current_epoch,
                        "total_epochs": total_ep,
                        "step": last_step,
                        "total_steps": total_steps
                    })

                # Check for step progress
                step_match = step_pattern.search(line)
                if step_match:
                    step = int(step_match.group(1))
                    tot = int(step_match.group(2))
                    loss = float(step_match.group(3))
                    total_steps = tot
                    last_step = step
                    last_loss = loss
                    now = time.time()
                    elapsed_ms = max(10, int((now - last_step_time) * 1000))
                    last_step_time = now

                    emit_json({
                        "type": "step",
                        "step": step,
                        "total_steps": tot,
                        "epoch": current_epoch,
                        "total_epochs": args.epochs,
                        "loss": round(loss, 6),
                        "learning_rate": args.learning_rate,
                        "elapsed_ms": elapsed_ms
                    })

                # Check for checkpoint saving
                ckpt_match = checkpoint_pattern.search(line)
                if ckpt_match:
                    ckpt_file = ckpt_match.group(1)
                    emit_json({
                        "type": "checkpoint_saved",
                        "path": ckpt_file,
                        "step": last_step
                    })

        t_out = threading.Thread(target=stream_reader, args=(child_proc.stdout, False), daemon=True)
        t_err = threading.Thread(target=stream_reader, args=(child_proc.stderr, True), daemon=True)
        t_out.start()
        t_err.start()

        return_code = child_proc.wait()
        t_out.join(timeout=2)
        t_err.join(timeout=2)

        if return_code == 0 and os.path.exists(output_safetensors) and os.path.getsize(output_safetensors) > 0:
            total_elapsed = round(time.time() - start_time, 2)
            sys.stderr.write(f"[ADAPTER] Training completed successfully in {total_elapsed}s. Output: {output_safetensors}\n")
            emit_json({
                "type": "completed",
                "output_path": output_safetensors,
                "final_loss": last_loss,
                "total_steps": last_step,
                "elapsed_seconds": total_elapsed,
                "rank": args.rank,
                "alpha": args.alpha
            })
            sys.exit(0)
        else:
            err = f"sd-scripts exited with code {return_code}"
            sys.stderr.write(f"[ADAPTER ERROR] {err}\n")
            emit_json({
                "type": "failed",
                "error": err,
                "return_code": return_code
            })
            sys.exit(return_code if return_code != 0 else 1)

    finally:
        # Cleanup temp dataset toml
        try:
            if os.path.exists(dataset_toml):
                os.remove(dataset_toml)
        except Exception:
            pass


if __name__ == "__main__":
    main()
