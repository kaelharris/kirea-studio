"""
KIREA Studio — Render Aurelia Evaluation Comparison Grid
Generates a 6x4 comparison grid of all checkpoints against all prompts:
Columns: Baseline, Step 80 (Ep 2), Step 160 (Ep 4), Step 240 (Ep 6), Step 320 (Ep 8), Step 400 (Ep 10)
Rows: Sundress (Leakage Check), Portrait (Likeness/Glasses), Cyberpunk (Environment), Canonical (Anchor)
"""

import os
import sys
from PIL import Image, ImageDraw, ImageFont

eval_dir = r"c:\Users\Harris\Documents\Ultimate AI\Projects\Kirea Studio\ai-image-studio-desktop\temp\aurelia_eval_output"
output_grid_path = os.path.join(eval_dir, "aurelia_checkpoint_progression_grid.png")

checkpoints = [
    ("step_000", "Baseline\n(No LoRA)"),
    ("step_080", "Step 80\n(Epoch 2)"),
    ("step_160", "Step 160\n(Epoch 4)"),
    ("step_240", "Step 240\n(Epoch 6)"),
    ("step_320", "Step 320\n(Epoch 8)"),
    ("step_400", "Step 400\n(Epoch 10)")
]

prompts = [
    ("prompt1_sundress", "Prompt 1: Outfit Transfer\n(White Sundress / Meadow)"),
    ("prompt2_portrait_noglasses", "Prompt 2: Facial Likeness\n(Close-up / No Glasses)"),
    ("prompt3_cyberpunk", "Prompt 3: Environment Versatility\n(Cyberpunk Neon Alley)"),
    ("prompt4_canonical", "Prompt 4: Canonical Anchor\n(Black Jacket / Crop Top)")
]

cell_w = 400
cell_h = 400
pad = 16
header_top = 80
header_left = 220

total_w = header_left + len(checkpoints) * (cell_w + pad) + pad
total_h = header_top + len(prompts) * (cell_h + pad) + pad

grid_img = Image.new("RGB", (total_w, total_h), (20, 24, 33))
draw = ImageDraw.Draw(grid_img)

try:
    font_title = ImageFont.truetype("arial.ttf", 22)
    font_header = ImageFont.truetype("arial.ttf", 18)
    font_label = ImageFont.truetype("arial.ttf", 15)
except Exception:
    font_title = ImageFont.load_default()
    font_header = ImageFont.load_default()
    font_label = ImageFont.load_default()

# Draw Column Headers
for col_idx, (cp_step, cp_label) in enumerate(checkpoints):
    x = header_left + col_idx * (cell_w + pad) + cell_w // 2
    lines = cp_label.split("\n")
    y = 15
    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=font_header)
        text_w = bbox[2] - bbox[0]
        draw.text((x - text_w // 2, y), line, fill=(240, 240, 245), font=font_header)
        y += 24

# Draw Rows
for row_idx, (p_id, p_label) in enumerate(prompts):
    y_row = header_top + row_idx * (cell_h + pad)

    # Row label on left
    lines = p_label.split("\n")
    y_lbl = y_row + cell_h // 2 - 20
    for line in lines:
        draw.text((20, y_lbl), line, fill=(200, 215, 230), font=font_label)
        y_lbl += 22

    for col_idx, (cp_step, cp_label) in enumerate(checkpoints):
        x_cell = header_left + col_idx * (cell_w + pad)
        y_cell = y_row

        img_name = f"{cp_step}_{p_id}.png"
        img_path = os.path.join(eval_dir, img_name)

        if os.path.exists(img_path):
            try:
                cell_img = Image.open(img_path).convert("RGB")
                cell_thumb = cell_img.resize((cell_w, cell_h), Image.Resampling.LANCZOS)
                grid_img.paste(cell_thumb, (x_cell, y_cell))
                draw.rectangle([x_cell, y_cell, x_cell + cell_w, y_cell + cell_h], outline=(55, 65, 81), width=1)
            except Exception as e:
                print(f"Error loading {img_name}: {e}")
        else:
            # Draw placeholder box
            draw.rectangle([x_cell, y_cell, x_cell + cell_w, y_cell + cell_h], fill=(30, 36, 48), outline=(75, 85, 99))
            draw.text((x_cell + cell_w // 2, y_cell + cell_h // 2), "Missing", fill=(156, 163, 175), font=font_label)

# Save high-res PNG and preview WebP
grid_img.save(output_grid_path, "PNG")
print(f"Saved comparison grid: {output_grid_path}")

webp_path = os.path.join(eval_dir, "aurelia_checkpoint_progression_grid.webp")
grid_img.save(webp_path, "WEBP", quality=85)
print(f"Saved webp preview: {webp_path}")
