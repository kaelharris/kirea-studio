import os
import glob
import json
import sqlite3
from PIL import Image

source_dir = r"C:\Users\Harris\Pictures\Kirea Studio"
db_path = os.path.expandvars(r"%APPDATA%\ai-image-studio-desktop\kirea-studio.db")

candidate_filenames = [
    "kirea_2026-11-22T23-42-50_s3419844246_1.png",
    "kirea_2026-11-22T18-25-02_s1596937497_1.png",
    "kirea_2026-11-22T18-15-42_s179499895_1.png",
    "kirea_2026-11-16T20-07-23_s1792601688_1.png",
    "kirea_2026-11-16T19-57-00_s642999460_1.png",
    "kirea_2026-11-16T19-56-52_s642999459_1.png",
    "kirea_2026-11-20T18-22-55_s1332733342_1.png",
    "kirea_2026-11-16T20-31-59_s385272091_1.png",
    "kirea_2026-11-16T20-04-03_s1692111429_1.png",
    "kirea_2026-11-22T23-51-47_s1017597234_1.png",
    "kirea_2026-11-22T23-51-30_s1372474988_1.png",
    "kirea_2026-11-22T23-51-10_s2400021359_1.png",
    "kirea_2026-11-22T23-50-46_s2511774613_1.png",
    "kirea_2026-11-22T23-43-26_s3253598626_1.png",
    "kirea_2026-11-22T20-32-31_s4214582555_1.png",
    "kirea_2026-11-22T18-46-07_s703375875_1.png",
    "kirea_2026-11-22T18-38-21_s1510709005_1.png",
    "kirea_2026-11-22T18-27-23_s1599156607_1.png",
    "kirea_2026-11-22T18-26-30_s1282011560_1.png",
    "kirea_2026-11-22T18-02-01_s439547070_1.png",
    "kirea_2026-11-22T17-59-58_s1559611108_1.png",
    "kirea_2026-11-22T15-20-10_s1981817852_1.png",
    "kirea_2026-11-22T15-19-52_s309515992_1.png",
    "kirea_2026-11-22T15-18-12_s1804394579_1.png",
    "kirea_2026-11-22T14-58-22_s2084297407_1.png"
]

framings = [
    "Portrait / Close-up",
    "Portrait / Close-up",
    "Portrait / Close-up",
    "Full Body",
    "Full Body",
    "Full Body",
    "Landscape / Wide",
    "Landscape / Wide",
    "Landscape / Wide",
    "Upper Body / Cowboy",
    "Upper Body / Cowboy",
    "Upper Body / Cowboy",
    "Upper Body / Cowboy",
    "Upper Body / Cowboy",
    "Upper Body / Cowboy",
    "Upper Body / Cowboy",
    "Upper Body / Cowboy",
    "Upper Body / Cowboy",
    "Upper Body / Cowboy",
    "Upper Body / Cowboy",
    "Upper Body / Cowboy",
    "Upper Body / Cowboy",
    "Upper Body / Cowboy",
    "Upper Body / Cowboy",
    "Upper Body / Cowboy"
]

# Find all files recursively in Pictures/Kirea Studio
all_files = {}
for root, dirs, files in os.walk(source_dir):
    for f in files:
        if f.lower().endswith(".png"):
            all_files[f] = os.path.join(root, f)

print(f"Total library PNG files indexed: {len(all_files)}")

# Connect to database for generation metadata
db_conn = sqlite3.connect(db_path) if os.path.exists(db_path) else None
db_cur = db_conn.cursor() if db_conn else None

manifest_items = []
missing = []

for idx, (fname, framing) in enumerate(zip(candidate_filenames, framings), start=1):
    fpath = all_files.get(fname)
    if not fpath:
        missing.append(fname)
        continue

    with Image.open(fpath) as img:
        w, h = img.size
        png_meta = img.info

    # Query database record
    db_rec = None
    if db_cur:
        db_cur.execute(
            "SELECT prompt, negative_prompt, seed, steps, cfg, sampler, checkpoint, created_at FROM generated_images WHERE file_name = ?;",
            (fname,)
        )
        row = db_cur.fetchone()
        if row:
            db_rec = {
                "prompt": row[0],
                "negative_prompt": row[1],
                "seed": row[2],
                "steps": row[3],
                "cfg": row[4],
                "sampler": row[5],
                "model": row[6],
                "created_at": row[7]
            }

    item = {
        "index": idx,
        "filename": fname,
        "path": fpath,
        "framing": framing,
        "width": w,
        "height": h,
        "aspect_ratio": round(w / h, 3),
        "seed": db_rec["seed"] if db_rec else int(fname.split("_s")[1].split("_")[0]) if "_s" in fname else None,
        "db_metadata": db_rec,
        "png_parameters": png_meta.get("parameters", "")[:500] if "parameters" in png_meta else None
    }
    manifest_items.append(item)

print(f"Matched {len(manifest_items)} / {len(candidate_filenames)} candidates.")
if missing:
    print("MISSING FILES:", missing)

# Save preliminary manifest
os.makedirs("temp/aurelia_dataset", exist_ok=True)
with open("temp/aurelia_dataset/manifest_preview.json", "w", encoding="utf-8") as f:
    json.dump(manifest_items, f, indent=2)

print("Saved manifest preview. First 3 items:")
for it in manifest_items[:3]:
    print(f"  #{it['index']}: {it['filename']} ({it['width']}x{it['height']}, {it['framing']}, seed={it['seed']})")
