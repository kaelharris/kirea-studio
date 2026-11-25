"""
KIREA Studio — Contact Sheets Generator (v1.2.3)
Generates:
1. aurelia_full_25_contact_sheet.png (with Green SELECTED / Red REJECTED status badges)
2. aurelia_selected_13_contact_sheet.png (strictly the 13 chosen images with training captions)
"""

import os
import json
from PIL import Image, ImageDraw, ImageFont, ImageOps

manifest_path = r"c:\Users\Harris\Documents\Ultimate AI\Projects\Kirea Studio\ai-image-studio-desktop\temp\aurelia_dataset\aurelia_dataset_manifest_v123.json"
output_dir = r"c:\Users\Harris\Documents\Ultimate AI\Projects\Kirea Studio\ai-image-studio-desktop\temp\aurelia_dataset"

with open(manifest_path, "r", encoding="utf-8") as f:
    manifest = json.load(f)

# Fonts
try:
    font_title = ImageFont.truetype("arialbd.ttf", 34)
    font_sub = ImageFont.truetype("arial.ttf", 20)
    font_num = ImageFont.truetype("arialbd.ttf", 28)
    font_badge = ImageFont.truetype("arialbd.ttf", 16)
    font_label = ImageFont.truetype("arialbd.ttf", 16)
    font_text = ImageFont.truetype("arial.ttf", 14)
except Exception:
    font_title = ImageFont.load_default()
    font_sub = ImageFont.load_default()
    font_num = ImageFont.load_default()
    font_badge = ImageFont.load_default()
    font_label = ImageFont.load_default()
    font_text = ImageFont.load_default()

# -------------------------------------------------------------------------
# 1. GENERATE FULL 25-IMAGE CONTACT SHEET (WITH DECISION BADGES)
# -------------------------------------------------------------------------
print("Rendering 25-Image Annotated Contact Sheet...")
cols = 5
rows = 5
cell_w = 600
cell_h = 770
top_header_h = 130
sheet_w = cols * cell_w
sheet_h = top_header_h + rows * cell_h

sheet25 = Image.new("RGB", (sheet_w, sheet_h), color=(14, 15, 18))
draw25 = ImageDraw.Draw(sheet25)

# Top Banner
draw25.rectangle([(0, 0), (sheet_w, top_header_h)], fill=(20, 22, 28))
draw25.line([(0, top_header_h - 1), (sheet_w, top_header_h - 1)], fill=(50, 55, 68), width=2)

draw25.text((40, 25), "KIREA STUDIO — CHARACTER DNA: AURELIA 25-CANDIDATE AUDIT & SELECTION", fill=(245, 245, 250), font=font_title)
draw25.text(
    (40, 75),
    "Option A Decision Matrix: 10 Selected (Green)  |  15 Excluded (Red: 2 Artifacts + 10 Santa Duplicates + 3 Excluded (#7, #8, #10))",
    fill=(170, 180, 200),
    font=font_sub
)

for idx, rec in enumerate(manifest["candidates"]):
    col_idx = idx % cols
    row_idx = idx // cols
    x0 = col_idx * cell_w
    y0 = top_header_h + row_idx * cell_h

    is_selected = rec["decision"] == "SELECTED"
    bg_color = (18, 24, 20) if is_selected else (24, 16, 16)
    border_color = (40, 140, 70) if is_selected else (140, 40, 40)
    border_width = 2 if is_selected else 1

    draw25.rectangle([(x0, y0), (x0 + cell_w - 1, y0 + cell_h - 1)], fill=bg_color)
    draw25.rectangle([(x0, y0), (x0 + cell_w - 1, y0 + cell_h - 1)], outline=border_color, width=border_width)

    # Load image
    with Image.open(rec["absolute_path"]) as src_img:
        img_box_w = cell_w - 32
        img_box_h = cell_h - 160
        contained = ImageOps.contain(src_img, (img_box_w, img_box_h), method=Image.Resampling.LANCZOS)
        paste_x = x0 + 16 + (img_box_w - contained.width) // 2
        paste_y = y0 + 55 + (img_box_h - contained.height) // 2
        draw25.rectangle([(x0 + 16, y0 + 55), (x0 + 16 + img_box_w, y0 + 55 + img_box_h)], fill=(10, 11, 14))
        sheet25.paste(contained, (paste_x, paste_y))

    # Number badge
    num_str = f"#{rec['candidate_number']:02d}"
    draw25.rectangle([(x0 + 16, y0 + 12), (x0 + 90, y0 + 44)], fill=(30, 35, 45))
    draw25.text((x0 + 24, y0 + 14), num_str, fill=(255, 255, 255), font=font_num)

    # Status Badge
    if is_selected:
        draw25.rectangle([(x0 + 100, y0 + 14), (x0 + 225, y0 + 42)], fill=(35, 130, 60))
        draw25.text((x0 + 110, y0 + 18), "✓ SELECTED", fill=(255, 255, 255), font=font_badge)
    else:
        draw25.rectangle([(x0 + 100, y0 + 14), (x0 + 225, y0 + 42)], fill=(150, 35, 35))
        draw25.text((x0 + 110, y0 + 18), "✗ EXCLUDED", fill=(255, 255, 255), font=font_badge)

    # Dimensions
    dim_str = f"{rec['resolution'][0]}x{rec['resolution'][1]}"
    draw25.text((x0 + cell_w - 140, y0 + 20), dim_str, fill=(160, 170, 185), font=font_text)

    # Footer inside cell
    foot_y = y0 + cell_h - 95
    draw25.text((x0 + 16, foot_y), rec["filename"], fill=(200, 210, 225), font=font_text)
    draw25.text((x0 + 16, foot_y + 20), f"Framing: {rec['framing']}  |  Outfit: {rec['outfit'][:35]}...", fill=(150, 160, 180), font=font_text)

    # Reason text
    reason_color = (120, 220, 150) if is_selected else (240, 130, 130)
    reason_prefix = "Included: " if is_selected else "Reason: "
    draw25.text((x0 + 16, foot_y + 40), f"{reason_prefix}{rec['decision_reason'][:65]}...", fill=reason_color, font=font_text)
    draw25.text((x0 + 16, foot_y + 60), f"SHA: {rec['sha256'][:16]}...", fill=(100, 110, 125), font=font_text)

sheet25_path = os.path.join(output_dir, "aurelia_full_25_contact_sheet.png")
sheet25.save(sheet25_path, "PNG", optimize=True)
print(f"Saved: {sheet25_path}")

# Scaled preview
preview25 = sheet25.resize((1500, int(sheet_h * (1500 / sheet_w))), resample=Image.Resampling.LANCZOS)
preview25.save(os.path.join(output_dir, "aurelia_full_25_contact_sheet_preview.png"), "PNG", optimize=True)


# -------------------------------------------------------------------------
# 2. GENERATE DEDICATED 10-SELECTED CONTACT SHEET (5x2 Grid)
# -------------------------------------------------------------------------
print("\nRendering Dedicated 10-Selected Training Dataset Contact Sheet (5x2)...")
selected_candidates = [r for r in manifest["candidates"] if r["decision"] == "SELECTED"]

cols10 = 5
rows10 = 2  # Exactly 10 cells, 0 wasted space!
cell10_w = 600
cell10_h = 800
sheet10_w = cols10 * cell10_w
sheet10_h = top_header_h + rows10 * cell10_h

sheet10 = Image.new("RGB", (sheet10_w, sheet10_h), color=(14, 16, 20))
draw10 = ImageDraw.Draw(sheet10)

# Top Banner
draw10.rectangle([(0, 0), (sheet10_w, top_header_h)], fill=(18, 26, 22))
draw10.line([(0, top_header_h - 1), (sheet10_w, top_header_h - 1)], fill=(40, 120, 70), width=2)

draw10.text((40, 25), "KIREA STUDIO — CHARACTER DNA: AURELIA 10-IMAGE TRAINING DATASET", fill=(240, 255, 245), font=font_title)
draw10.text(
    (40, 75),
    "Verified Dataset: 10 Images  |  Trigger: aurelia_char  |  Outfit Balance: 7 Streetwear/Tops (70%), 3 Santa Bikini (30%)",
    fill=(150, 210, 180),
    font=font_sub
)

for idx, rec in enumerate(selected_candidates):
    col_idx = idx % cols10
    row_idx = idx // cols10
    x0 = col_idx * cell10_w
    y0 = top_header_h + row_idx * cell10_h

    # Cell background
    draw10.rectangle([(x0, y0), (x0 + cell10_w - 1, y0 + cell10_h - 1)], fill=(18, 22, 26))
    draw10.rectangle([(x0, y0), (x0 + cell10_w - 1, y0 + cell10_h - 1)], outline=(35, 60, 48), width=1)

    # Load image
    with Image.open(rec["absolute_path"]) as src_img:
        img_box_w = cell10_w - 32
        img_box_h = cell10_h - 190
        contained = ImageOps.contain(src_img, (img_box_w, img_box_h), method=Image.Resampling.LANCZOS)
        paste_x = x0 + 16 + (img_box_w - contained.width) // 2
        paste_y = y0 + 55 + (img_box_h - contained.height) // 2
        draw10.rectangle([(x0 + 16, y0 + 55), (x0 + 16 + img_box_w, y0 + 55 + img_box_h)], fill=(10, 12, 15))
        sheet10.paste(contained, (paste_x, paste_y))

    # Dataset Sequence Badge
    seq_str = f"Set #{idx+1:02d} (Orig #{rec['candidate_number']:02d})"
    draw10.rectangle([(x0 + 16, y0 + 12), (x0 + 185, y0 + 44)], fill=(30, 110, 65))
    draw10.text((x0 + 24, y0 + 16), seq_str, fill=(255, 255, 255), font=font_label)

    # Framing badge
    draw10.text((x0 + 200, y0 + 18), rec["framing"], fill=(220, 200, 130), font=font_label)
    dim_str = f"{rec['resolution'][0]}x{rec['resolution'][1]} ({rec['aspect_ratio']})"
    draw10.text((x0 + cell10_w - 170, y0 + 20), dim_str, fill=(160, 170, 185), font=font_text)

    # Footer inside cell
    foot_y = y0 + cell10_h - 125
    draw10.text((x0 + 16, foot_y), rec["filename"], fill=(200, 215, 235), font=font_text)
    draw10.text((x0 + 16, foot_y + 20), f"Outfit: {rec['outfit'][:45]}...", fill=(160, 175, 195), font=font_text)
    draw10.text((x0 + 16, foot_y + 40), f"Environment: {rec['background_environment'][:45]}...", fill=(140, 160, 180), font=font_text)

    # Suggested caption
    draw10.text((x0 + 16, foot_y + 65), "Training Caption:", fill=(120, 210, 160), font=font_label)
    draw10.text((x0 + 16, foot_y + 85), f"{rec['suggested_caption'][:70]}...", fill=(220, 230, 240), font=font_text)

# Save both names so existing links continue to work smoothly
sheet10_path = os.path.join(output_dir, "aurelia_selected_10_contact_sheet.png")
sheet10.save(sheet10_path, "PNG", optimize=True)
sheet10.save(os.path.join(output_dir, "aurelia_selected_13_contact_sheet.png"), "PNG", optimize=True)
print(f"Saved: {sheet10_path}")

# Scaled preview
preview10 = sheet10.resize((1500, int(sheet10_h * (1500 / sheet10_w))), resample=Image.Resampling.LANCZOS)
preview10_path = os.path.join(output_dir, "aurelia_selected_10_contact_sheet_preview.png")
preview10.save(preview10_path, "PNG", optimize=True)
preview10.save(os.path.join(output_dir, "aurelia_selected_13_contact_sheet_preview.png"), "PNG", optimize=True)

# Also WebP
preview10.save(os.path.join(output_dir, "aurelia_selected_10_contact_sheet_preview.webp"), "WEBP", quality=85)
preview10.save(os.path.join(output_dir, "aurelia_selected_13_contact_sheet_preview.webp"), "WEBP", quality=85)

print("Contact sheets rendered successfully!")
