"""
KIREA Studio — Checkpoint Progression & Concept Leakage Analyzer
Analyzes color histograms, pixel drift from baseline, and prompt adherence
across all 24 evaluation images.
"""

import os
import json
import numpy as np
from PIL import Image

eval_dir = r"c:\Users\Harris\Documents\Ultimate AI\Projects\Kirea Studio\ai-image-studio-desktop\temp\aurelia_eval_output"

checkpoints = [
    (0, "step_000"),
    (80, "step_080"),
    (160, "step_160"),
    (240, "step_240"),
    (320, "step_320"),
    (400, "step_400")
]

prompts = [
    "prompt1_sundress",
    "prompt2_portrait_noglasses",
    "prompt3_cyberpunk",
    "prompt4_canonical"
]

analysis = {}

for p_id in prompts:
    analysis[p_id] = {
        "baseline_diffs": {},
        "step_step_diffs": {},
        "red_ratios": {},  # For detecting red bikini leakage
        "brightness": {}
    }

    baseline_img_path = os.path.join(eval_dir, f"step_000_{p_id}.png")
    baseline_arr = np.array(Image.open(baseline_img_path).convert("RGB"), dtype=np.float32)
    prev_arr = baseline_arr

    for step_num, step_label in checkpoints:
        img_path = os.path.join(eval_dir, f"{step_label}_{p_id}.png")
        if not os.path.exists(img_path):
            continue
        arr = np.array(Image.open(img_path).convert("RGB"), dtype=np.float32)

        # Diff from baseline
        diff_base = float(np.abs(arr - baseline_arr).mean())
        analysis[p_id]["baseline_diffs"][step_num] = round(diff_base, 2)

        # Diff from previous step
        diff_prev = float(np.abs(arr - prev_arr).mean())
        analysis[p_id]["step_step_diffs"][step_num] = round(diff_prev, 2)
        prev_arr = arr

        # Red dominance ratio (R / (G + B + 1e-5))
        r = arr[:, :, 0]
        g = arr[:, :, 1]
        b = arr[:, :, 2]
        red_ratio = float((r / (g + b + 1.0)).mean())
        analysis[p_id]["red_ratios"][step_num] = round(red_ratio, 4)
        analysis[p_id]["brightness"][step_num] = round(float(arr.mean()), 2)

print("=== CHECKPOINT PROGRESSION ANALYSIS ===")
for p_id, data in analysis.items():
    print(f"\n--- {p_id} ---")
    print("Diff from Baseline:", data["baseline_diffs"])
    print("Step-to-Step Delta:", data["step_step_diffs"])
    print("Red Ratio (Leakage Check):", data["red_ratios"])

out_json = os.path.join(eval_dir, "checkpoint_progression_analysis.json")
with open(out_json, "w") as f:
    json.dump(analysis, f, indent=2)

print(f"\nSaved analysis to {out_json}")
