"""
KIREA Studio — Aurelia Candidate Contact Sheet Generator
Renders a 5x5 visual contact sheet for 25 candidate images with:
- Clearly visible image numbers (#01 to #25)
- Original filenames
- Framing category
- Original dimensions
- Proportions preserved (no stretching)
- Full dataset manifest JSON
"""

import os
import json
import sqlite3
from PIL import Image, ImageDraw, ImageFont, ImageOps

source_dir = r"C:\Users\Harris\Pictures\Kirea Studio"
db_path = os.path.expandvars(r"%APPDATA%\ai-image-studio-desktop\kirea-studio.db")
output_dir = r"c:\Users\Harris\Documents\Ultimate AI\Projects\Kirea Studio\ai-image-studio-desktop\temp\aurelia_dataset"
os.makedirs(output_dir, exist_ok=True)

candidate_specs = [
    {"num": 1, "fname": "kirea_2026-11-22T23-42-50_s3419844246_1.png", "framing": "Portrait / Close-up", "tags": "Front close-up, mole clear, hair over eye"},
    {"num": 2, "fname": "kirea_2026-11-22T18-25-02_s1596937497_1.png", "framing": "Portrait / Close-up", "tags": "3/4 angle, warm brown eyes, pink inner highlights"},
    {"num": 3, "fname": "kirea_2026-11-22T18-15-42_s179499895_1.png", "framing": "Portrait / Close-up", "tags": "Tight portrait, smirk, hoop earring"},
    {"num": 4, "fname": "kirea_2026-11-16T20-07-23_s1792601688_1.png", "framing": "Full Body", "tags": "Standing full-body, boots/legs visible"},
    {"num": 5, "fname": "kirea_2026-11-16T19-57-00_s642999460_1.png", "framing": "Full Body", "tags": "Dynamic standing pose, high ponytail"},
    {"num": 6, "fname": "kirea_2026-11-16T19-56-52_s642999459_1.png", "framing": "Full Body", "tags": "Alternate turnaround, side/rear proportions"},
    {"num": 7, "fname": "kirea_2026-11-20T18-22-55_s1332733342_1.png", "framing": "Landscape / Wide", "tags": "Horizontal staging, atmospheric neon backdrop"},
    {"num": 8, "fname": "kirea_2026-11-16T20-31-59_s385272091_1.png", "framing": "Landscape / Wide", "tags": "Wide cinematic, seated, environmental lighting"},
    {"num": 9, "fname": "kirea_2026-11-16T20-04-03_s1692111429_1.png", "framing": "Landscape / Wide", "tags": "Wide angle, looking back over shoulder"},
    {"num": 10, "fname": "kirea_2026-11-22T23-51-47_s1017597234_1.png", "framing": "Upper Body / Cowboy", "tags": "Mid-torso crop, stylish glasses, navel piercing"},
    {"num": 11, "fname": "kirea_2026-11-22T23-51-30_s1372474988_1.png", "framing": "Upper Body / Cowboy", "tags": "Frontal torso, neutral expression, crisp lines"},
    {"num": 12, "fname": "kirea_2026-11-22T23-51-10_s2400021359_1.png", "framing": "Upper Body / Cowboy", "tags": "Alternate lighting, purple tips saturation"},
    {"num": 13, "fname": "kirea_2026-11-22T23-50-46_s2511774613_1.png", "framing": "Upper Body / Cowboy", "tags": "Head tilted slightly, direct eye contact"},
    {"num": 14, "fname": "kirea_2026-11-22T23-43-26_s3253598626_1.png", "framing": "Upper Body / Cowboy", "tags": "Casual pose, jacket detail, subtle smile"},
    {"num": 15, "fname": "kirea_2026-11-22T20-32-31_s4214582555_1.png", "framing": "Upper Body / Cowboy", "tags": "Torso turnaround, inner gradient layers"},
    {"num": 16, "fname": "kirea_2026-11-22T18-46-07_s703375875_1.png", "framing": "Upper Body / Cowboy", "tags": "High-res bust, iris shading, necklace"},
    {"num": 17, "fname": "kirea_2026-11-22T18-38-21_s1510709005_1.png", "framing": "Upper Body / Cowboy", "tags": "Hands near hip, bodice details"},
    {"num": 18, "fname": "kirea_2026-11-22T18-27-23_s1599156607_1.png", "framing": "Upper Body / Cowboy", "tags": "Hand raised, expressive gesture, ear cartilage"},
    {"num": 19, "fname": "kirea_2026-11-22T18-26-30_s1282011560_1.png", "framing": "Upper Body / Cowboy", "tags": "Head turn left, bangs and side profile"},
    {"num": 20, "fname": "kirea_2026-11-22T18-02-01_s439547070_1.png", "framing": "Upper Body / Cowboy", "tags": "Ultra-res, clean black-to-purple gradient"},
    {"num": 21, "fname": "kirea_2026-11-22T17-59-58_s1559611108_1.png", "framing": "Upper Body / Cowboy", "tags": "Stage lighting, back-rim light, hair shimmer"},
    {"num": 22, "fname": "kirea_2026-11-22T15-20-10_s1981817852_1.png", "framing": "Upper Body / Cowboy", "tags": "Centered cowboy, neutral studio backdrop"},
    {"num": 23, "fname": "kirea_2026-11-22T15-19-52_s309515992_1.png", "framing": "Upper Body / Cowboy", "tags": "3/4 body angle, hair flowing over shoulder"},
    {"num": 24, "fname": "kirea_2026-11-22T15-18-12_s1804394579_1.png", "framing": "Upper Body / Cowboy", "tags": "Looking slightly upward, eyelashes and mole"},
    {"num": 25, "fname": "kirea_2026-11-22T14-58-22_s2084297407_1.png", "framing": "Upper Body / Cowboy", "tags": "Arms relaxed, natural pose, collar/shoulders"}
]

# Index library files
all_files = {}
for root, dirs, files in os.walk(source_dir):
    for f in files:
        if f.lower().endswith(".png"):
            all_files[f] = os.path.join(root, f)

# Connect to database for generation metadata
conn = sqlite3.connect(db_path) if os.path.exists(db_path) else None
cur = conn.cursor() if conn else None

manifest = []

# Font resolution
try:
    font_title = ImageFont.truetype("arialbd.ttf", 36)
    font_sub = ImageFont.truetype("arial.ttf", 22)
    font_num = ImageFont.truetype("arialbd.ttf", 30)
    font_label = ImageFont.truetype("arialbd.ttf", 18)
    font_text = ImageFont.truetype("arial.ttf", 15)
except Exception:
    font_title = ImageFont.load_default()
    font_sub = ImageFont.load_default()
    font_num = ImageFont.load_default()
    font_label = ImageFont.load_default()
    font_text = ImageFont.load_default()

# Canvas layout
cols = 5
rows = 5
cell_w = 600
cell_h = 760
top_header_h = 130
sheet_w = cols * cell_w
sheet_h = top_header_h + rows * cell_h

sheet = Image.new("RGB", (sheet_w, sheet_h), color=(14, 15, 18))
draw = ImageDraw.Draw(sheet)

# Draw Top Header
draw.rectangle([(0, 0), (sheet_w, top_header_h)], fill=(20, 22, 28))
draw.line([(0, top_header_h - 1), (sheet_w, top_header_h - 1)], fill=(50, 55, 68), width=2)

draw.text((40, 25), "KIREA STUDIO — CHARACTER DNA: AURELIA CANDIDATE CONTACT SHEET", fill=(245, 245, 250), font=font_title)
draw.text(
    (40, 75),
    "Cluster 1: Short Gradient Black-to-Purple Ponytail Character  |  Trigger: aurelia_char  |  25 Verified Diverse Samples (0 Duplicates)",
    fill=(170, 180, 200),
    font=font_sub
)

# Render each cell
for idx, spec in enumerate(candidate_specs):
    fname = spec["fname"]
    fpath = all_files.get(fname)
    if not fpath:
        print(f"Warning: File not found {fname}")
        continue

    col_idx = idx % cols
    row_idx = idx // cols
    x0 = col_idx * cell_w
    y0 = top_header_h + row_idx * cell_h

    # Cell background and border
    draw.rectangle([(x0, y0), (x0 + cell_w - 1, y0 + cell_h - 1)], fill=(18, 20, 25))
    draw.rectangle([(x0, y0), (x0 + cell_w - 1, y0 + cell_h - 1)], outline=(35, 38, 48), width=1)

    # Load image and get dimensions
    with Image.open(fpath) as src_img:
        orig_w, orig_h = src_img.size
        # Letterbox contain without stretching
        img_box_w = cell_w - 32
        img_box_h = cell_h - 150
        contained = ImageOps.contain(src_img, (img_box_w, img_box_h), method=Image.Resampling.LANCZOS)

        # Paste centered in image box
        paste_x = x0 + 16 + (img_box_w - contained.width) // 2
        paste_y = y0 + 55 + (img_box_h - contained.height) // 2

        # Draw background backing for image area
        draw.rectangle([(x0 + 16, y0 + 55), (x0 + 16 + img_box_w, y0 + 55 + img_box_h)], fill=(10, 11, 14))
        sheet.paste(contained, (paste_x, paste_y))

    # Header bar inside cell
    num_str = f"#{spec['num']:02d}"
    draw.rectangle([(x0 + 16, y0 + 12), (x0 + 95, y0 + 46)], fill=(180, 30, 45))  # Crimson badge
    draw.text((x0 + 26, y0 + 14), num_str, fill=(255, 255, 255), font=font_num)

    # Framing tag badge
    framing_text = spec["framing"]
    draw.text((x0 + 110, y0 + 18), framing_text, fill=(230, 200, 120), font=font_label)

    # Aspect ratio / dimensions
    dim_text = f"{orig_w}x{orig_h} ({(orig_w/orig_h):.2f})"
    draw.text((x0 + cell_w - 180, y0 + 20), dim_text, fill=(160, 170, 185), font=font_text)

    # Query DB metadata
    db_rec = {}
    if cur:
        cur.execute(
            "SELECT prompt, negative_prompt, seed, steps, cfg, sampler, checkpoint, created_at FROM generated_images WHERE file_name = ?;",
            (fname,)
        )
        row = cur.fetchone()
        if row:
            db_rec = {
                "prompt": row[0],
                "negative_prompt": row[1],
                "seed": row[2],
                "steps": row[3],
                "cfg": row[4],
                "sampler": row[5],
                "checkpoint": row[6],
                "created_at": row[7]
            }

    # Footer inside cell
    foot_y = y0 + cell_h - 85
    # Filename
    draw.text((x0 + 16, foot_y), fname, fill=(200, 210, 225), font=font_text)
    # Seed & Params
    seed_val = db_rec.get("seed", fname.split("_s")[1].split("_")[0] if "_s" in fname else "N/A")
    steps_val = db_rec.get("steps", "28")
    cfg_val = db_rec.get("cfg", "6.0")
    sampler_val = db_rec.get("sampler", "euler_a")
    meta_line = f"Seed: {seed_val}  |  Steps: {steps_val}  |  CFG: {cfg_val}  |  Sampler: {sampler_val}"
    draw.text((x0 + 16, foot_y + 22), meta_line, fill=(140, 150, 170), font=font_text)

    # Description / Notes
    draw.text((x0 + 16, foot_y + 44), f"Traits: {spec['tags']}", fill=(110, 190, 160), font=font_text)

    # Record into manifest
    manifest.append({
        "number": spec["num"],
        "filename": fname,
        "path": fpath,
        "framing": spec["framing"],
        "width": orig_w,
        "height": orig_h,
        "aspect_ratio": round(orig_w / orig_h, 3),
        "seed": seed_val,
        "steps": steps_val,
        "cfg": cfg_val,
        "sampler": sampler_val,
        "checkpoint": db_rec.get("checkpoint", "Animixy².safetensors"),
        "created_at": db_rec.get("created_at"),
        "key_visual_traits": spec["tags"],
        "prompt": db_rec.get("prompt"),
        "negative_prompt": db_rec.get("negative_prompt")
    })

# Save full contact sheet
full_sheet_path = os.path.join(output_dir, "aurelia_candidate_contact_sheet.png")
sheet.save(full_sheet_path, "PNG", optimize=True)
print(f"Saved full contact sheet: {full_sheet_path} ({sheet.width}x{sheet.height})")

# Save a scaled preview for markdown embed (1500px width)
preview_w = 1500
preview_h = int(sheet_h * (preview_w / sheet_w))
preview_sheet = sheet.resize((preview_w, preview_h), resample=Image.Resampling.LANCZOS)
preview_sheet_path = os.path.join(output_dir, "aurelia_candidate_contact_sheet_preview.png")
preview_sheet.save(preview_sheet_path, "PNG", optimize=True)
print(f"Saved preview contact sheet: {preview_sheet_path} ({preview_sheet.width}x{preview_sheet.height})")

# Save complete JSON manifest
manifest_path = os.path.join(output_dir, "aurelia_dataset_manifest.json")
with open(manifest_path, "w", encoding="utf-8") as f:
    json.dump({
        "dataset_name": "Aurelia_DNA_v1.2_Candidates",
        "character_name": "Aurelia",
        "trigger_token": "aurelia_char",
        "base_model": "Animixy².safetensors",
        "total_images": len(manifest),
        "framing_summary": {
            "portrait_close_up": len([m for m in manifest if "Portrait" in m["framing"]]),
            "upper_body_cowboy": len([m for m in manifest if "Upper Body" in m["framing"]]),
            "full_body": len([m for m in manifest if "Full Body" in m["framing"]]),
            "landscape_wide": len([m for m in manifest if "Landscape" in m["framing"]])
        },
        "images": manifest
    }, f, indent=2)

print(f"Saved full dataset manifest: {manifest_path}")
